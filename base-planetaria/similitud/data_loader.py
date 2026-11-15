"""Cargadores de modelos digitales de elevación (MDE), uno por fuente oficial.

Todos devuelven un `Raster` con la misma interfaz (`muestrear`, `espaciado_nativo_m`,
`radio_local_m`, `resumen`), pero cada uno lee su propio formato y comprueba su propia
geometría a partir de los metadatos del producto (etiqueta PDS3 o cabecera BIL). Si los
metadatos no cuadran con el archivo, se detiene. Los valores ausentes nunca se rellenan.

Referencias verticales (no comparables en valor absoluto, ver METODOLOGIA.md §1):
  Luna   LOLA:      altura sobre la ESFERA de 1737,4 km.
  Marte  MOLA MEGT: radio − AREOIDE.
  Tierra SRTMGL30:  altura sobre el geoide EGM96, latitudes geodésicas WGS84.
"""
from __future__ import annotations

import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import numpy as np

from . import config, data_catalog


class DatosNoDisponibles(RuntimeError):
    """Falta un archivo de entrada. El mensaje explica cómo obtenerlo."""


class MetadatosInconsistentes(RuntimeError):
    """Los metadatos del producto no coinciden con el archivo o con lo esperado."""


def _exigir(cond: bool, msg: str) -> None:
    if not cond:
        raise MetadatosInconsistentes(msg)


def _comun():
    """Lector de etiquetas PDS3 del proyecto (base-planetaria/tools/comun.py, solo biblioteca estándar)."""
    ruta = str(config.TOOLS)
    if ruta not in sys.path:
        sys.path.insert(0, ruta)
    import comun  # noqa: E402
    return comun


# =========================================================================== interfaz común
@dataclass
class Raster:
    cuerpo: str
    producto: str
    fuente: str                          # clave en data_catalog.FUENTES
    crudo: np.ndarray                    # números digitales (puede ser np.memmap)
    escala: float                        # valor físico (m) = crudo × escala + desplazamiento
    desplazamiento: float
    radio_m: float | None                # esfera del producto (None si es elipsoide)
    elipsoide: tuple[float, float] | None
    referencia_vertical: str
    conteos: np.ndarray | None = None    # nº de observaciones por celda (0 = interpolado)
    sin_dato: int | None = None          # valor centinela del archivo
    mascara: "MascaraAgua | None" = None  # validez adicional por celda, en la misma rejilla que `crudo`
    criterio_validez: str = "todas las celdas tienen valor"
    procedencia: dict = field(default_factory=dict)

    # ---- lo que cada subclase define
    def indices(self, lat: np.ndarray, lon: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """(fila, columna) fraccionarias y máscara «dentro del producto»."""
        raise NotImplementedError

    def espaciado_nativo_m(self) -> float:
        raise NotImplementedError

    def _columna(self, c: np.ndarray) -> np.ndarray:
        return c                                   # las rejillas globales lo hacen cíclico

    # ---- común
    @property
    def filas(self) -> int:
        return int(self.crudo.shape[0])

    @property
    def columnas(self) -> int:
        return int(self.crudo.shape[1])

    def radio_local_m(self, lat: float) -> float:
        """Esfera: radio del producto. Elipsoide: radio de Gauss R_G = a√(1−e²)/(1−e² sin²φ)."""
        if self.elipsoide is None:
            return float(self.radio_m)
        a, f = self.elipsoide
        e2 = f * (2 - f)
        s = math.sin(math.radians(lat))
        return a * math.sqrt(1 - e2) / (1 - e2 * s * s)

    def muestrear(self, lat: np.ndarray, lon: np.ndarray):
        """Interpolación bilineal. Devuelve (valor m, válido, observado|None).

        Una muestra es válida solo si sus 4 celdas vecinas lo son (≠ sin_dato y, si hay `mascara`, válidas según
        ella). «Observado» = la celda más
        cercana tiene ≥ 1 observación según el mapa de conteos del producto.
        """
        f, c, dentro = self.indices(lat, lon)
        nf, nc = self.filas, self.columnas
        f0 = np.clip(np.floor(f).astype(np.int64), 0, nf - 2)
        tf = np.clip(f - f0, 0.0, 1.0)
        c0r = np.floor(c).astype(np.int64)
        tc = c - c0r
        c0 = self._columna(c0r)
        c1 = self._columna(c0r + 1)
        c0c, c1c = np.clip(c0, 0, nc - 1), np.clip(c1, 0, nc - 1)
        tc = np.clip(tc, 0.0, 1.0)
        f1 = f0 + 1
        a = self.crudo
        q = [a[f0, c0c], a[f0, c1c], a[f1, c0c], a[f1, c1c]]
        valido = dentro & (c0 == c0c) & (c1 == c1c)
        for (ff, cc), x in zip(((f0, c0c), (f0, c1c), (f1, c0c), (f1, c1c)), q):
            if self.sin_dato is not None:
                valido &= x != self.sin_dato
            if self.mascara is not None:
                valido &= self.mascara.valida(ff, cc, x)
        q = [x.astype(np.float64) for x in q]
        v = (1 - tf) * ((1 - tc) * q[0] + tc * q[1]) + tf * ((1 - tc) * q[2] + tc * q[3])
        v = np.where(valido, v * self.escala + self.desplazamiento, np.nan)
        obs = None
        if self.conteos is not None:
            fn = np.clip(np.rint(f).astype(np.int64), 0, nf - 1)
            cn = np.clip(self._columna(np.rint(c).astype(np.int64)), 0, nc - 1)
            obs = self.conteos[fn, cn] > 0
        return v, valido, obs

    def resumen(self) -> dict:
        return {
            "cuerpo": self.cuerpo, "producto": self.producto,
            "fuente": data_catalog.fuente(self.fuente),
            "filas": self.filas, "columnas": self.columnas,
            "espaciado_nativo_m": round(self.espaciado_nativo_m(), 1),
            "referencia_vertical": self.referencia_vertical,
            "superficie_horizontal": (f"sphere R = {self.radio_m / 1000:.1f} km" if self.elipsoide is None else
                                      f"WGS84 ellipsoid (a = {self.elipsoide[0]:.0f} m, 1/f = {1 / self.elipsoide[1]:.9f})"),
            "conteos_de_observacion": self.conteos is not None,
            "criterio_validez": self.criterio_validez,
            **self.procedencia,
        }


@dataclass
class MascaraAgua:
    """Validez de las celdas de SRTMGL30 según la rejilla de agua de SRTMSWBD (misma geometría que el mosaico).

    Celda con máscara (0…`pixeles_por_celda` píxeles de agua): sin dato si la fracción de agua es > `umbral`.
    Celda sin máscara (FUERA_COBERTURA_SWBD, SIN_TESELA_SWBD): sin dato si vale 0 m (REGLA_SIN_MASCARA)."""
    cuentas: np.ndarray                  # uint16 (puede ser np.memmap)
    umbral: float
    pixeles_por_celda: int
    huella: str                          # identifica las teselas agregadas (nombre y tamaño de cada zip)

    def valida(self, f: np.ndarray, c: np.ndarray, dn: np.ndarray) -> np.ndarray:
        n = self.cuentas[f, c]
        con = n <= self.pixeles_por_celda
        return np.where(con, n <= self.umbral * self.pixeles_por_celda, dn != 0)

    def clave(self) -> str:
        """Entra en la clave del catálogo: otra máscara, otro umbral u otra regla ⇒ otro catálogo."""
        return f"agua=SRTMSWBD:{self.huella}|umbral_agua={self.umbral!r}|sin_mascara={REGLA_SIN_MASCARA}"


@dataclass
class RejillaGeografica(Raster):
    """Rejilla regular lat/lon. Fila 0 al norte; valores en el centro de celda."""
    lat0: float = 0.0          # latitud del centro de la fila 0
    dlat: float = 1.0
    lon0: float = 0.0          # longitud del centro de la columna 0 (grados este)
    dlon: float = 1.0

    @property
    def ciclica(self) -> bool:
        return abs(self.columnas * self.dlon - 360.0) < 1e-6

    def _columna(self, c):
        return c % self.columnas if self.ciclica else c

    def indices(self, lat, lon):
        f = (self.lat0 - lat) / self.dlat
        c = ((lon - self.lon0) % 360.0) / self.dlon
        dentro = (f >= -0.5) & (f <= self.filas - 0.5)
        return f, c, dentro

    def espaciado_nativo_m(self) -> float:
        """Mayor separación entre centros de celda (m): cota inferior para la rejilla común."""
        if self.elipsoide is None:
            return float(self.radio_m) * math.radians(max(self.dlat, self.dlon))
        a, f = self.elipsoide
        e2 = f * (2 - f)
        return max(a / math.sqrt(1 - e2) * math.radians(self.dlat),    # radio meridiano máximo (polo)
                   a * math.radians(self.dlon))                         # paso E-O máximo (ecuador)


@dataclass
class RejillaPolar(Raster):
    """Estereográfica polar de LOLA sobre esfera (fórmulas de DSMAP_POLAR.CAT, ver data_catalog)."""
    polo: int = -1             # +1 norte, −1 sur
    escala_m: float = 1.0      # MAP_SCALE (exacto en el polo)
    lpo: float = 0.0           # LINE_PROJECTION_OFFSET (base 0 = N/2 − 0,5)
    spo: float = 0.0
    lat_borde: float = 0.0     # |latitud| del borde de la cobertura

    def indices(self, lat, lon):
        colat = np.radians(90.0 - self.polo * lat)                 # distancia angular al polo
        rho = 2.0 * self.radio_m * np.tan(colat / 2.0)
        lam = np.radians(lon)
        x, y = rho * np.sin(lam), rho * np.cos(lam)                 # LON = atan2(X, Y)
        c = x / self.escala_m + self.spo                            # X = (j − SPO)·s
        f = self.lpo + self.polo * y / self.escala_m                # Y = (i − LPO)·s·NS
        dentro = ((f >= -0.5) & (f <= self.filas - 0.5) & (c >= -0.5) & (c <= self.columnas - 0.5)
                  & (self.polo * lat >= 0))
        return f, c, dentro

    def espaciado_nativo_m(self) -> float:
        return float(self.escala_m)       # el tamaño en el terreno es ≤ MAP_SCALE fuera del polo


# =========================================================================== PDS3
def _leer_pds3(base: Path, grupo: str) -> tuple[np.ndarray, dict]:
    comun = _comun()
    lbl, img = base.with_suffix(".lbl"), base.with_suffix(".img")
    for r in (lbl, img):
        if not r.exists():
            raise DatosNoDisponibles(f"Missing {r}. Download it with `python3 base-planetaria/tools/descargar.py {grupo}`.")
    et = comun.leer_etiqueta_pds3(lbl)
    lineas = int(comun.numero(et["IMAGE.LINES"]))
    muestras = int(comun.numero(et["IMAGE.LINE_SAMPLES"]))
    bits = int(comun.numero(et["IMAGE.SAMPLE_BITS"]))
    tipo = comun.limpio(et["IMAGE.SAMPLE_TYPE"])
    _exigir(tipo in ("MSB_INTEGER", "LSB_INTEGER") and bits == 16, f"{lbl.name}: tipo {tipo}/{bits} bits no previsto")
    dtype = np.dtype((">" if tipo == "MSB_INTEGER" else "<") + "i2")
    _exigir(img.stat().st_size == lineas * muestras * 2,
            f"{img.name}: {img.stat().st_size} bytes ≠ {lineas}×{muestras}×2 de la etiqueta")
    return np.memmap(img, dtype=dtype, mode="r", shape=(lineas, muestras)), et


def _geometria_cilindrica(et: dict, lineas: int, muestras: int) -> tuple[float, float, float, float, float]:
    """Rejilla SIMPLE CYLINDRICAL global con registro por píxel; se comprueba con los PROJECTION_OFFSET
    (LOLA los da en base 0 y MOLA en base 1: ambas convenciones describen la misma rejilla)."""
    comun = _comun()
    _exigir(comun.limpio(et["MAP_PROJECTION_TYPE"]) == "SIMPLE CYLINDRICAL", "proyección no cilíndrica simple")
    res = comun.numero(et["MAP_RESOLUTION"])
    lat_max, lat_min = comun.numero(et["MAXIMUM_LATITUDE"]), comun.numero(et["MINIMUM_LATITUDE"])
    lon_o, lon_e = comun.numero(et["WESTERNMOST_LONGITUDE"]), comun.numero(et["EASTERNMOST_LONGITUDE"])
    radio_km = comun.numero(et["A_AXIS_RADIUS"])
    _exigir(comun.numero(et["B_AXIS_RADIUS"]) == radio_km == comun.numero(et["C_AXIS_RADIUS"]), "no es una esfera")
    _exigir(lineas == round((lat_max - lat_min) * res) and muestras == round((lon_e - lon_o) * res),
            "LINES/LINE_SAMPLES no cuadran con la extensión y la resolución")
    lpo, spo = comun.numero(et["LINE_PROJECTION_OFFSET"]), comun.numero(et["SAMPLE_PROJECTION_OFFSET"])
    clon = comun.numero(et["CENTER_LONGITUDE"])
    _exigir(min(abs(lpo - (lat_max * res - 0.5)), abs(lpo - (lat_max * res + 0.5))) < 1e-6,
            f"LINE_PROJECTION_OFFSET {lpo} incompatible con registro por píxel")
    _exigir(min(abs(spo - ((clon - lon_o) * res - 0.5)), abs(spo - ((clon - lon_o) * res + 0.5))) < 1e-6,
            f"SAMPLE_PROJECTION_OFFSET {spo} incompatible con registro por píxel")
    paso = 1.0 / res
    return lat_max - paso / 2, paso, lon_o + paso / 2, paso, radio_km * 1000.0


def _version(et: dict) -> dict:
    comun = _comun()
    return {k.lower(): comun.limpio(et[k]) for k in ("DATA_SET_ID", "PRODUCT_ID", "PRODUCT_VERSION_ID",
                                                        "START_TIME", "STOP_TIME", "PRODUCT_CREATION_TIME") if k in et}


@lru_cache(maxsize=None)
def cargar_lola_16() -> RejillaGeografica:
    comun = _comun()
    base = config.DATOS / "lola_gdr" / "ldem_16"
    dn, et = _leer_pds3(base, "lola")
    _exigir(comun.limpio(et.get("TARGET_NAME", "")) == "MOON", "la etiqueta no es de la Luna")
    lat0, dlat, lon0, dlon, radio = _geometria_cilindrica(et, *dn.shape)
    _exigir(abs(comun.numero(et["IMAGE.OFFSET"]) - radio) < 1e-3, "OFFSET de altura ≠ radio de proyección")
    conteos = None
    if (config.DATOS / "lola_gdr" / "ldec_16.img").exists():
        conteos, et_c = _leer_pds3(config.DATOS / "lola_gdr" / "ldec_16", "lola")
        _exigir(_geometria_cilindrica(et_c, *conteos.shape) == (lat0, dlat, lon0, dlon, radio), "LDEC_16 ≠ geometría de LDEM_16")
    escala = comun.numero(et["IMAGE.SCALING_FACTOR"])
    return RejillaGeografica(
        cuerpo="moon", producto="LDEM_16", fuente="lola_gdr_16ppd", crudo=dn, escala=escala, desplazamiento=0.0,
        radio_m=radio, elipsoide=None, conteos=conteos,
        referencia_vertical=f"height above the {radio / 1000:.1f} km sphere (not the lunar geoid)",
        procedencia={"archivo": "ldem_16.img", "conversion": f"altura (m) = DN × {escala}", **_version(et)},
        lat0=lat0, dlat=dlat, lon0=lon0, dlon=dlon)


@lru_cache(maxsize=None)
def cargar_lola_polar(nombre: str = "ldem_75s_240m") -> RejillaPolar:
    """Producto polar de LOLA, p. ej. `ldem_75s_240m` (con su `ldec_*` si está descargado)."""
    comun = _comun()
    base = config.DATOS / "lola_gdr_polar" / nombre
    dn, et = _leer_pds3(base, "lola_polar")
    _exigir(comun.limpio(et["MAP_PROJECTION_TYPE"]) == "POLAR STEREOGRAPHIC", "no es estereográfica polar")
    _exigir(comun.limpio(et.get("KEYWORD_LATITUDE_TYPE", "PLANETOCENTRIC")) == "PLANETOCENTRIC", "latitud no planetocéntrica")
    radio = comun.numero(et["A_AXIS_RADIUS"]) * 1000.0
    _exigir(abs(radio - 1_737_400.0) < 1e-3, "DSMAP_POLAR.CAT fija R = 1737400 m; la etiqueta dice otra cosa")
    _exigir(comun.numero(et["CENTER_LONGITUDE"]) == 0 and comun.numero(et.get("MAP_PROJECTION_ROTATION", "0")) == 0,
            "longitud central o rotación distintas de 0")
    polo = 1 if comun.numero(et["CENTER_LATITUDE"]) > 0 else -1
    n = dn.shape[0]
    _exigir(dn.shape[0] == dn.shape[1], "las imágenes polares de LOLA son cuadradas")
    lpo, spo = comun.numero(et["LINE_PROJECTION_OFFSET"]), comun.numero(et["SAMPLE_PROJECTION_OFFSET"])
    _exigir(abs(lpo - (n / 2 - 0.5)) < 1e-6 and abs(spo - (n / 2 - 0.5)) < 1e-6,
            "PROJECTION_OFFSET ≠ N/2 − 0,5 (convención de DSMAP_POLAR.CAT)")
    escala_m = comun.numero(et["MAP_SCALE"])
    borde = comun.numero(et["MAXIMUM_LATITUDE"] if polo < 0 else et["MINIMUM_LATITUDE"])
    conteos = None
    cbase = config.DATOS / "lola_gdr_polar" / ("ldec" + nombre[4:])
    if cbase.with_suffix(".img").exists():
        conteos, et_c = _leer_pds3(cbase, "lola_polar")
        _exigir(conteos.shape == dn.shape and comun.numero(et_c["MAP_SCALE"]) == escala_m, "LDEC polar ≠ geometría")
    escala = comun.numero(et["IMAGE.SCALING_FACTOR"])
    return RejillaPolar(
        cuerpo="moon", producto=nombre.upper(), fuente="lola_gdr_polar", crudo=dn, escala=escala, desplazamiento=0.0,
        radio_m=radio, elipsoide=None, conteos=conteos,
        referencia_vertical="height above the 1737.4 km sphere (not the lunar geoid)",
        procedencia={"archivo": f"{nombre}.img", "conversion": f"altura (m) = DN × {escala}", **_version(et)},
        polo=polo, escala_m=escala_m, lpo=lpo, spo=spo, lat_borde=abs(borde))


@lru_cache(maxsize=None)
def cargar_mola(referencia: str = "areoide") -> RejillaGeografica:
    """`areoide`: MEGT. `esfera`: MEGR sin OFFSET = altura sobre la esfera de 3396 km (solo para validar)."""
    comun = _comun()
    d = config.DATOS / "mola_meg016"
    if referencia == "areoide":
        dn, et = _leer_pds3(d / "megt90n000eb", "mola")
        _exigir("IMAGE.SCALING_FACTOR" not in et, "MEGT con factor de escala inesperado")
        escala, ref = 1.0, "radius − areoid (GMM3 up to degree 50)"
    elif referencia == "esfera":
        dn, et = _leer_pds3(d / "megr90n000eb", "mola")
        escala, ref = comun.numero(et["IMAGE.SCALING_FACTOR"]), "radius − 3396 km sphere"
    else:
        raise ValueError(referencia)
    _exigir(comun.limpio(et.get("TARGET_NAME", "")) == "MARS", "la etiqueta no es de Marte")
    lat0, dlat, lon0, dlon, radio = _geometria_cilindrica(et, *dn.shape)
    if referencia == "esfera":
        _exigir(abs(comun.numero(et["IMAGE.OFFSET"]) - radio) < 1e-3, "OFFSET de MEGR ≠ radio de proyección")
    conteos = None
    if (d / "megc90n000eb.img").exists():
        conteos, et_c = _leer_pds3(d / "megc90n000eb", "mola")
        _exigir(_geometria_cilindrica(et_c, *conteos.shape) == (lat0, dlat, lon0, dlon, radio), "MEGC ≠ geometría")
    return RejillaGeografica(
        cuerpo="mars", producto="MEGT90N000EB" if referencia == "areoide" else "MEGR90N000EB",
        fuente="mola_megdr_16ppd", crudo=dn, escala=escala, desplazamiento=0.0,
        radio_m=radio, elipsoide=None, conteos=conteos, referencia_vertical=ref,
        procedencia={"archivo": ("megt" if referencia == "areoide" else "megr") + "90n000eb.img", **_version(et)},
        lat0=lat0, dlat=dlat, lon0=lon0, dlon=dlon)


# =========================================================================== Tierra: SRTMGL30 (Earthdata)
SRTMGL30_CMR = "C2763266346-LPCLOUD"
DIR_SRTMGL30 = config.DATOS / "srtmgl30"
CMR_GRANULOS = "cmr_granulos.json"       # respuesta de CMR guardada al listar las URLs (cajas de cada gránulo)
PASO_30S = 1.0 / 120.0
# Los zips de LP DAAC traen solo `XXXXXXX.DEM`, sin .hdr, y CMR no enlaza ninguna cabecera. Formato documentado
# (GUIA_SRTM §2.1.4): 27 teselas de 6000 filas × 4800 columnas a 30″, sin solape («se unen adosándolas»), enteros de
# 16 bits con signo, big-endian, fila 1 al norte, sin bytes de cabecera; vacíos de las versiones 1.0 y 2.1 = −32768.
# El nombre (W020N40) da la esquina NO; la caja que publica CMR por gránulo (W020N40: S −10, O −20, N 40, E 20)
# fija la extensión de 50° × 40° con bordes en grados enteros, es decir, centros de celda a ±1/240° de ellos.
# Orden de bytes y vacío se comprueban con los datos (`_verificar_valores`), no se dan por buenos.
GUIA_SRTM = ("The Shuttle Radar Topography Mission (SRTM) Collection User Guide, LP DAAC, rev. octubre 2015, §2.1.4. "
             "https://lpdaac.usgs.gov/documents/179/SRTM_User_Guide_V3.pdf")
FILAS_30S, COLUMNAS_30S = 6000, 4800
VACIO_SRTM = -32768
RANGO_FISICO_M = (-500, 9000)            # holgado: orilla del mar Muerto ≈ −430 m, Everest 8849 m


# --------------------------------------------------------------------------- máscara de agua SRTMSWBD V003
# En SRTMGL30 el mar no es «sin dato»: vale 0 m, indistinguible de la tierra a 0 m. La máscara de masas de agua de
# NGA (SWBD, la misma con la que se editó SRTM v2, GUIA_SRTM §2.1.1) la publica LP DAAC rasterizada a 1″.
# Formato (GUIA_SRTM, tabla 1: «SRTMSWBD … 3601/3601, 1 arc-second»; el resto, comprobado con los datos al leer):
# un zip por tesela de 1°×1° con un único `NnnEeee.raw` de 3601×3601 bytes (uint8, fila 0 al norte, sin cabecera).
# 3601 muestras por grado = registro por nodo, como los HGT de SRTMGL1: la primera y la última fila/columna caen
# sobre los grados enteros y se repiten en la tesela vecina (se comprueba con los datos al agregar). La caja CMR
# (N00E021: −0,0002778…1,0002778) da ±1″ y no decide el registro. Valores: 0 y 255; cuál es agua lo fija
# `VALOR_AGUA_SWBD` y lo comprueban los datos frente a SRTMGL30 (`comprobar_alineacion_agua`), no se da por bueno.
SRTMSWBD_CMR = "C2763268445-LPCLOUD"
# Fuera del repositorio (12 229 zips: el servidor de desarrollo de la web recargaría la página con cada uno).
DIR_SRTMSWBD = Path(os.environ.get("SRTMSWBD_DIR", Path.home() / ".cache" / "landfall" / "srtmswbd"))
M_SWBD = 3601
VALOR_AGUA_SWBD, VALOR_TIERRA_SWBD = 255, 0
COBERTURA_SWBD = (-56.0, 60.0)           # caja de la colección en CMR (S, N); se comprueba con la lista de gránulos
CELDA_SWBD = 30                          # píxeles de 1″ por lado de una celda de 30″
MASCARA_AGUA = "srtmswbd_agua30s_u2le.bin"   # en config.CACHE, con su .json de procedencia
# Rejilla auxiliar (uint16 LE, misma geometría que el mosaico SRTMGL30): nº de píxeles de agua de 1″ de cada celda de
# 30″ (0…900, es decir, 30×30). Dos códigos para las celdas sin máscara:
FUERA_COBERTURA_SWBD = 65535             # latitud fuera de COBERTURA_SWBD (al norte de 60°N, entre 56°S y 60°S)
SIN_TESELA_SWBD = 65534                  # dentro de la cobertura, pero CMR no tiene gránulo para esa tesela de 1°
# Umbral de MAYORÍA: una celda de 30″ pasa a sin dato si su fracción de agua es > UMBRAL_AGUA (con 0,5: si más de la
# mitad de su área es agua según SWBD). Es una decisión metodológica, no una constante física. Con 0 («cualquier
# agua») se pierden además todas las celdas de costa y las que tocan un río o un lago cartografiado. El efecto de
# ambos valores se mide al construir la rejilla y se publica en la procedencia (`efecto_por_umbral`).
UMBRAL_AGUA = 0.5
# Celdas sin máscara (los dos códigos de arriba): 0 m = sin dato, la regla anterior a la máscara, porque el mar viene
# como 0 m y no hay otra forma de distinguirlo. Una tesela ausente NO equivale a «toda tierra» ni a «todo océano»: de
# las 2068 teselas de SRTMGL3 sin gránulo SWBD, 2048 no tienen ninguna celda a 0 m en SRTMGL30 (tierra sin masas de
# agua), pero dos (s11w139, n59e170) son > 98 % mar a 0 m; y las 27 463 teselas de −56…60° sin gránulo en ninguno
# de los dos productos son océano (≥ 86 % de celdas a 0 m) con islas que sí tienen relieve (Nunivak, n59w167).
# Comprobado el 15-11-2026 con las listas de CMR de SRTMSWBD y SRTMGL3 V003 (ver INVENTARIO_RECURSOS.md §2.3).
REGLA_SIN_MASCARA = "0 m = sin dato"

def leer_cabecera_bil(texto: str) -> dict:
    """Cabecera ESRI BIL (`CLAVE valor`) → geometría normalizada. No presupone ningún valor."""
    cab = {}
    for linea in texto.splitlines():
        p = linea.strip().split(None, 1)
        if len(p) == 2:
            cab[p[0].upper()] = p[1].strip()
    nbits = int(float(cab.get("NBITS", "16")))
    _exigir(nbits == 16 and int(float(cab.get("NBANDS", "1"))) == 1, "se esperaba una banda de 16 bits")
    orden = cab.get("BYTEORDER", "M").upper()
    _exigir(orden in ("I", "M", "LSBFIRST", "MSBFIRST"), f"BYTEORDER {orden} desconocido")
    pixeltype = cab.get("PIXELTYPE", "SIGNEDINT").upper()
    _exigir(pixeltype.startswith("SIGNED"), f"PIXELTYPE {pixeltype}: se esperaban enteros con signo")
    geo = {
        "filas": int(float(cab["NROWS"])), "columnas": int(float(cab["NCOLS"])),
        "endian": "<" if orden in ("I", "LSBFIRST") else ">",
        "sin_dato": int(float(cab["NODATA"])) if "NODATA" in cab else None,
    }
    if "ULXMAP" in cab:
        geo.update(lon0=float(cab["ULXMAP"]), lat0=float(cab["ULYMAP"]), dlon=float(cab["XDIM"]), dlat=float(cab["YDIM"]))
    else:
        celda = float(cab["CELLSIZE"])
        x0 = float(cab["XLLCENTER"]) if "XLLCENTER" in cab else float(cab["XLLCORNER"]) + celda / 2
        y0 = float(cab["YLLCENTER"]) if "YLLCENTER" in cab else float(cab["YLLCORNER"]) + celda / 2
        geo.update(lon0=x0, lat0=y0 + (geo["filas"] - 1) * celda, dlon=celda, dlat=celda)
    return geo


def cajas_cmr(directorio: Path) -> dict | None:
    """Caja (S, O, N, E) de cada gránulo según el JSON de CMR guardado al listar las URLs; None si no está."""
    ruta = directorio / CMR_GRANULOS
    if not ruta.exists():
        return None
    cajas = {}
    for g in json.loads(ruta.read_text(encoding="utf-8"))["feed"]["entry"]:
        gid = g.get("producer_granule_id") or g["title"]
        _exigir(g.get("collection_concept_id") == SRTMGL30_CMR, f"{ruta.name}: {gid} es de otra colección")
        _exigir(len(g.get("boxes") or []) == 1, f"{ruta.name}: {gid} no trae una única caja")
        s, o, n, e = (float(x) for x in g["boxes"][0].split())     # orden de CMR: sur oeste norte este
        cajas[gid.lower()] = (s, o, n, e)
    return cajas


def geometria_srtm30_por_nombre(nombre: str, n_bytes: int) -> dict:
    """Geometría de una tesela de 30″ sin cabecera: esquina NO del nombre + formato documentado (GUIA_SRTM).

    Las coordenadas devueltas son de CENTRO de celda, como las de `leer_cabecera_bil` con ULXMAP/ULYMAP.
    """
    m = re.fullmatch(r"([ew])(\d{3})([ns])(\d{2})", nombre, re.IGNORECASE)
    _exigir(m is not None, f"{nombre}: el nombre no sigue el patrón [EW]ddd[NS]dd de las teselas de 30″")
    oeste = int(m[2]) * (1 if m[1].lower() == "e" else -1)
    norte = int(m[4]) * (1 if m[3].lower() == "n" else -1)
    _exigir(-180 <= oeste and oeste + COLUMNAS_30S * PASO_30S <= 180
            and norte <= 90 and norte - FILAS_30S * PASO_30S >= -90, f"{nombre}: la tesela se sale del globo")
    _exigir(n_bytes == FILAS_30S * COLUMNAS_30S * 2,
            f"{nombre}: {n_bytes} bytes ≠ {FILAS_30S}×{COLUMNAS_30S}×2 del formato documentado")
    return {"filas": FILAS_30S, "columnas": COLUMNAS_30S, "endian": ">", "sin_dato": VACIO_SRTM,
            "lon0": oeste + PASO_30S / 2, "lat0": norte - PASO_30S / 2, "dlon": PASO_30S, "dlat": PASO_30S}


def _comprobar_caja_cmr(geo: dict, granulo: str, cajas: dict | None) -> str:
    """Compara los bordes de la rejilla (centros ± medio paso) con la caja que publica CMR para el gránulo."""
    if cajas is None:
        return f"no comprobada: falta {CMR_GRANULOS} (se guarda al listar las URLs con `descargar-tierra`)"
    _exigir(granulo in cajas, f"{granulo}: no figura en {CMR_GRANULOS}")
    o = geo["lon0"] - geo["dlon"] / 2
    n = geo["lat0"] + geo["dlat"] / 2
    propia = (n - geo["filas"] * geo["dlat"], o, n, o + geo["columnas"] * geo["dlon"])
    _exigir(max(abs(a - b) for a, b in zip(propia, cajas[granulo])) < 1e-6,
            f"{granulo}: caja deducida (S, O, N, E) = {propia} ≠ CMR {cajas[granulo]}")
    return "coincide con CMR: S {:g} O {:g} N {:g} E {:g}".format(*cajas[granulo])


def _verificar_valores(nombre: str, crudo: bytes, geo: dict) -> dict:
    """Sin cabecera, el orden de bytes y el vacío se comprueban con los datos: con el orden elegido no puede haber
    ninguna celda fuera de RANGO_FISICO_M salvo el vacío; con el orden contrario se cuentan (si también salen 0, los
    datos no discriminan y se dice). Un −9999 (convención GTOPO30) caería fuera del rango y se rechazaría."""
    lo, hi = RANGO_FISICO_M
    fuera, a = {}, None
    for e in (">", "<"):
        x = np.frombuffer(crudo, dtype=e + "i2")
        fuera[e] = int((((x < lo) | (x > hi)) & (x != geo["sin_dato"])).sum())
        if e == geo["endian"]:
            a = x
    otro = "<" if geo["endian"] == ">" else ">"
    _exigir(fuera[geo["endian"]] == 0, f"{nombre}: {fuera[geo['endian']]} celdas fuera de {RANGO_FISICO_M} m "
                                       f"con el orden documentado ({geo['endian']}): orden o vacío erróneos")
    validos = a[a != geo["sin_dato"]]
    return {"orden_bytes": "big-endian" if geo["endian"] == ">" else "little-endian",
            "fuera_de_rango_con_el_orden_contrario": fuera[otro], "orden_discriminado_por_datos": fuera[otro] > 0,
            "celdas_vacio": int(a.size - validos.size), "min_m": int(validos.min()) if validos.size else None,
            "max_m": int(validos.max()) if validos.size else None, "fraccion_cero": round(float((a == 0).mean()), 6)}


def _abrir_tesela(z: zipfile.ZipFile, ruta: Path, cajas: dict | None) -> tuple[str, dict, dict]:
    """(miembro con los datos, geometría, procedencia de la geometría) sin descomprimir los datos."""
    nombres = z.namelist()
    dem = [n for n in nombres if n.lower().endswith((".dem", ".bil"))]
    hdr = [n for n in nombres if n.lower().endswith(".hdr")]
    _exigir(len(dem) == 1 and len(hdr) <= 1, f"{ruta.name}: se esperaba un .dem/.bil y como mucho un .hdr ({nombres})")
    granulo = ruta.name[:-4].lower() if ruta.name.lower().endswith(".zip") else ruta.name.lower()
    n_bytes = z.getinfo(dem[0]).file_size
    if hdr:
        geo = leer_cabecera_bil(z.read(hdr[0]).decode("latin-1"))
        _exigir(n_bytes == geo["filas"] * geo["columnas"] * 2, f"{ruta.name}: tamaño ≠ cabecera")
        origen = {"geometria": f"cabecera {hdr[0]}"}
    else:
        base = Path(dem[0]).name.split(".")[0]
        _exigir(granulo.startswith(base.lower() + "."), f"{ruta.name}: el zip contiene {dem[0]}, de otra tesela")
        geo = geometria_srtm30_por_nombre(base, n_bytes)
        origen = {"geometria": "nombre + formato documentado (sin .hdr)",
                  "bytes": f"{n_bytes} = {FILAS_30S}×{COLUMNAS_30S}×2"}
    origen["caja_cmr"] = _comprobar_caja_cmr(geo, granulo, cajas)
    return dem[0], geo, origen


def _leer_tesela_zip(ruta: Path, cajas: dict | None = None) -> tuple[np.ndarray, dict]:
    """Tesela → (array, geometría). Con .hdr, la geometría sale de la cabecera; sin ella, del nombre y del
    formato documentado, comprobada con el tamaño, la caja de CMR (si está guardada) y los propios valores.
    `geo["procedencia"]` dice de dónde salió cada cosa."""
    if cajas is None:
        cajas = cajas_cmr(ruta.parent)
    with zipfile.ZipFile(ruta) as z:
        dem, geo, origen = _abrir_tesela(z, ruta, cajas)
        crudo = z.read(dem)
    _exigir(len(crudo) == geo["filas"] * geo["columnas"] * 2, f"{ruta.name}: tamaño ≠ geometría")
    if not origen["geometria"].startswith("cabecera"):
        origen.update(_verificar_valores(ruta.name, crudo, geo))
    a = np.frombuffer(crudo, dtype=np.dtype(geo["endian"] + "i2")).reshape(geo["filas"], geo["columnas"])
    return a, {**geo, "procedencia": origen}


def _continuidad_costuras(mm: np.ndarray, huecos: list) -> dict | None:
    """Medida (no criterio de rechazo): mediana de |Δh| entre las dos celdas que se tocan a ambos lados de las
    costuras entre teselas, frente a la misma medida un paso más adentro. Si una tesela estuviera desplazada,
    volteada o mal asignada, la costura saldría muy por encima del interior. Solo pares con ambas celdas ≠ 0
    (el mar viene como 0 y daría Δ = 0 trivial)."""
    def mediana(x, y):
        m = (x != 0) & (y != 0)
        return float(np.median(np.abs(x[m].astype(np.int32) - y[m]))) if m.sum() >= 1000 else None
    bordes_c = sorted({c0 for _, (_, c0, _, _) in huecos} - {0})
    bordes_f = sorted({f0 for _, (f0, _, _, _) in huecos} - {0})
    if not bordes_c and not bordes_f:
        return None
    pares = [(mediana(mm[:, c - 1], mm[:, c]), mediana(mm[:, c - 2], mm[:, c - 1])) for c in bordes_c]
    pares += [(mediana(mm[f - 1], mm[f]), mediana(mm[f - 2], mm[f - 1])) for f in bordes_f]
    pares = [(a, b) for a, b in pares if a is not None and b is not None]
    return {"costuras_medidas": len(pares), "mediana_dh_costura_m": [a for a, _ in pares],
            "mediana_dh_interior_m": [b for _, b in pares]}


def construir_mosaico_srtmgl30(directorio: Path = DIR_SRTMGL30, destino: Path | None = None) -> Path:
    """Une las 27 teselas en un mosaico global (memmap int16 LE, 30″, 90°N–60°S). Sin remuestrear.

    Dos pasadas: la primera solo lee geometrías (no descomprime), la segunda escribe tesela a tesela, para no
    tener las 27 (≈ 1,5 GB) en memoria a la vez."""
    zips = sorted(directorio.glob("*.zip"))
    if not zips:
        raise DatosNoDisponibles(f"No SRTMGL30 tiles in {directorio}. Use `python -m similitud descargar-tierra`.")
    cajas = cajas_cmr(directorio)
    geos = []
    for ruta in zips:
        with zipfile.ZipFile(ruta) as z:
            _, geo, _ = _abrir_tesela(z, ruta, cajas)
        _exigir(abs(geo["dlat"] - PASO_30S) < 1e-9 and abs(geo["dlon"] - PASO_30S) < 1e-9, f"{ruta.name}: paso ≠ 30″")
        geos.append(geo)
    lat_n = max(g["lat0"] for g in geos) + PASO_30S / 2
    lat_s = min(g["lat0"] - (g["filas"] - 1) * PASO_30S for g in geos) - PASO_30S / 2
    filas, columnas = int(round((lat_n - lat_s) / PASO_30S)), int(round(360 / PASO_30S))
    sin_datos = {g["sin_dato"] for g in geos}
    _exigir(len(sin_datos) == 1 and None not in sin_datos, f"NODATA distinto entre teselas: {sin_datos}")
    sd = sin_datos.pop()
    config.CACHE.mkdir(parents=True, exist_ok=True)
    destino = destino or config.CACHE / "srtmgl30_mosaico_i2le.bin"
    mm = np.memmap(destino, dtype="<i2", mode="w+", shape=(filas, columnas))
    mm[:] = sd
    lon_oeste = -180.0 + PASO_30S / 2
    procedencia, huecos = {}, []
    for ruta in zips:
        a, g = _leer_tesela_zip(ruta, cajas)
        f0 = int(round((lat_n - PASO_30S / 2 - g["lat0"]) / PASO_30S))
        c0 = int(round((g["lon0"] - lon_oeste) / PASO_30S))
        _exigir(abs(lat_n - PASO_30S / 2 - f0 * PASO_30S - g["lat0"]) < 1e-6
                and abs(lon_oeste + c0 * PASO_30S - g["lon0"]) < 1e-6, f"{ruta.name}: fuera de la rejilla común")
        _exigir(0 <= c0 and c0 + a.shape[1] <= columnas, f"{ruta.name}: se sale de −180…180°")
        f1, c1 = f0 + a.shape[0], c0 + a.shape[1]
        otra = next((n for n, (p0, q0, p1, q1) in huecos if f0 < p1 and p0 < f1 and c0 < q1 and q0 < c1), None)
        _exigir(otra is None, f"{ruta.name}: se solapa con {otra} (el formato documentado no tiene solapes)")
        huecos.append((ruta.name, (f0, c0, f1, c1)))
        mm[f0:f1, c0:c1] = a
        procedencia[ruta.name] = g["procedencia"]
        del a
    mm.flush()
    costuras = _continuidad_costuras(mm, huecos)
    origenes = {}
    for nombre, p in procedencia.items():
        origenes.setdefault(p["geometria"], []).append(nombre)
    cmr_ok = sum(p["caja_cmr"].startswith("coincide") for p in procedencia.values())
    sin_hdr = [p for p in procedencia.values() if "fraccion_cero" in p]
    meta = {"filas": filas, "columnas": columnas, "lat0": lat_n - PASO_30S / 2, "lon0": lon_oeste,
            "paso": PASO_30S, "sin_dato": sd, "teselas": [z.name for z in zips],
            "bytes_teselas": {z.name: z.stat().st_size for z in zips},
            "geometria": {"origen": {k: len(v) for k, v in origenes.items()},
                          "caja_cmr": f"{cmr_ok}/{len(zips)} teselas coinciden con la caja publicada en CMR"
                                      + ("" if cajas is not None else f" (falta {CMR_GRANULOS})"),
                          "referencia_formato": GUIA_SRTM if sin_hdr else None,
                          "orden_bytes_discriminado_por_datos":
                              f"{sum(p['orden_discriminado_por_datos'] for p in sin_hdr)}/{len(sin_hdr)} teselas sin .hdr",
                          "continuidad_costuras": costuras},
            "procedencia_teselas": procedencia}
    if sin_hdr:
        meta["valores_sin_cabecera"] = {
            "celdas_vacio": sum(p["celdas_vacio"] for p in sin_hdr),
            "min_m": min(p["min_m"] for p in sin_hdr if p["min_m"] is not None),
            "max_m": max(p["max_m"] for p in sin_hdr if p["max_m"] is not None),
            "fraccion_cero": round(sum(p["fraccion_cero"] for p in sin_hdr) / len(sin_hdr), 4),
            "nota": f"sin_dato = {sd} es el vacío documentado (GUIA_SRTM §2.1.4). Estos archivos no traen ningún "
                    "−9999 ni valor de océano propio: el mar figura como 0 m, indistinguible de la tierra a 0 m."}
    destino.with_suffix(".json").write_text(json.dumps(meta, indent=1, ensure_ascii=False), encoding="utf-8")
    return destino


def _mascara_para(meta_mosaico: dict, umbral: float,
                  directorio: Path | None = None) -> tuple[MascaraAgua | None, dict]:
    """(máscara, procedencia). Sin máscara utilizable devuelve None y dice por qué: el cargador sigue como antes."""
    directorio = directorio or DIR_SRTMSWBD
    ruta = config.CACHE / MASCARA_AGUA
    if not ruta.with_suffix(".json").exists():
        est = estado_swbd(directorio)
        if not est["completa"]:
            return None, {"aplicada": False,
                          "motivo": ("SRTMSWBD no descargada" if est["granulos_cmr"] is None else
                                     f"SRTMSWBD incompleta: {est['teselas_en_disco']}/{est['granulos_cmr']} teselas"),
                          "como_obtener": "python -m similitud descargar-agua (Earthdata Login en ~/.netrc)"}
        construir_fraccion_agua(directorio)
    meta = json.loads(ruta.with_suffix(".json").read_text(encoding="utf-8"))
    _exigir(all(abs(meta[k] - meta_mosaico[k]) < 1e-12 for k in ("filas", "columnas", "lat0", "lon0", "paso")),
            f"{ruta.name}: geometría ≠ mosaico SRTMGL30; bórralo y vuelve a lanzar `descargar-agua`")
    _exigir(0.0 <= umbral < 1.0, f"umbral de agua {umbral} fuera de [0, 1)")
    cuentas = np.memmap(ruta, dtype="<u2", mode="r", shape=(meta["filas"], meta["columnas"]))
    masc = MascaraAgua(cuentas=cuentas, umbral=float(umbral), pixeles_por_celda=meta["pixeles_por_celda"],
                       huella=meta["huella"])
    comp = meta.get("comprobacion_con_srtmgl30", {})
    hist = np.array(comp["histograma_pixeles_agua"]) if comp else None
    pasan = int(hist[np.arange(hist.size) > umbral * masc.pixeles_por_celda].sum()) if hist is not None else None
    return masc, {
        "aplicada": True, "producto": meta["producto"], "fuente": data_catalog.fuente("srtmswbd"), "archivo": ruta.name,
        "teselas": meta["teselas_agregadas"], "huella": meta["huella"], "umbral_fraccion_agua": umbral,
        "regla": (f"celda con tesela SWBD: sin dato si fracción de agua > {umbral}; sin tesela o fuera de "
                  f"{COBERTURA_SWBD[0]:g}…{COBERTURA_SWBD[1]:g}° de latitud: {REGLA_SIN_MASCARA}"),
        "celdas_a_sin_dato_por_la_mascara": pasan,
        "efecto_por_umbral": comp.get("efecto_por_umbral"),
        "celdas_a_sin_dato_sin_mascara_0m": {k: v["a_0_m_pasan_a_sin_dato"] for k, v in comp.get("sin_mascara", {}).items()},
        "registro": meta["registro"],
        "bordes_compartidos": meta["bordes_compartidos"],
        "alineacion": {k: comp.get(k) for k in ("desplazamiento_optimo",
                                                "jaccard_agua_plena_vs_0m_por_desplazamiento_filas_columnas")}}


@lru_cache(maxsize=None)
def cargar_srtmgl30(umbral_agua: float = UMBRAL_AGUA) -> RejillaGeografica:
    """Mosaico SRTMGL30 con la máscara de agua SRTMSWBD si está en disco (ver `MascaraAgua`); si no, como antes."""
    mosaico = config.CACHE / "srtmgl30_mosaico_i2le.bin"
    if not mosaico.with_suffix(".json").exists():
        construir_mosaico_srtmgl30()
    meta = json.loads(mosaico.with_suffix(".json").read_text(encoding="utf-8"))
    if "geometria" not in meta:                     # mosaico de una versión anterior, sin procedencia de la geometría
        construir_mosaico_srtmgl30()
        meta = json.loads(mosaico.with_suffix(".json").read_text(encoding="utf-8"))
    dn = np.memmap(mosaico, dtype="<i2", mode="r", shape=(meta["filas"], meta["columnas"]))
    vals = meta.get("valores_sin_cabecera")
    masc, proc_masc = _mascara_para(meta, umbral_agua)
    vacio = (f"celda ≠ {meta['sin_dato']} (vacío documentado; {vals['celdas_vacio']} celdas en el mosaico)" if vals
             else f"celda ≠ NODATA ({meta['sin_dato']}) de la cabecera")
    if masc is not None:
        criterio = (f"{vacio} y no agua: con tesela SRTMSWBD, fracción de agua ≤ {umbral_agua} (si es mayor, sin "
                    f"dato); sin tesela SRTMSWBD (al norte de {COBERTURA_SWBD[1]:g}°N, entre {-COBERTURA_SWBD[0]:g}°S "
                    "y 60°S y en las teselas de 1° sin gránulo), 0 m = sin dato: ahí el mar solo se distingue por "
                    "valer 0 m, y se pierde también la tierra que esté exactamente a 0 m")
        nota_agua = ("Agua según la máscara SWBD de NGA (mar, lagos y ríos que contiene); el hielo figura como "
                     "superficie.")
    else:
        criterio = vacio + (". El mar viene como 0 m y CUENTA como superficie válida: el producto no lo marca y la "
                            "máscara SRTMSWBD no está disponible (" + proc_masc["motivo"] + ")")
        nota_agua = "Lagos y hielo figuran como superficie."
    geometria = {k: v for k, v in meta["geometria"].items() if v is not None}
    return RejillaGeografica(
        cuerpo="earth", producto="SRTMGL30 V002", fuente="srtmgl30", crudo=dn, escala=1.0, desplazamiento=0.0,
        radio_m=None, elipsoide=(config.WGS84_A, config.WGS84_F), sin_dato=meta["sin_dato"], mascara=masc,
        referencia_vertical="height above the EGM96 geoid (LP DAAC documentation); WGS84 geodetic latitudes",
        criterio_validez=criterio,
        procedencia={"teselas": len(meta["teselas"]), "mosaico": mosaico.name,
                     "cobertura_lat": [round(meta["lat0"] - (meta["filas"] - 0.5) * meta["paso"], 4), 90.0],
                     "geometria": geometria, "mascara_agua": proc_masc,
                     "nota": "Sin mapa de observaciones: no se distingue medición de relleno. " + nota_agua
                             + (" " + vals["nota"] if vals else "")},
        lat0=meta["lat0"], dlat=meta["paso"], lon0=meta["lon0"], dlon=meta["paso"])


def urls_srtmgl30(guardar: Path | None = None) -> list[str]:
    """URLs de los zips de SRTMGL30 según la API pública de CMR (sin credenciales). Con `guardar`, deja la
    respuesta en ese archivo: trae la caja de cada gránulo, con la que se comprueba la geometría sin red."""
    url = f"https://cmr.earthdata.nasa.gov/search/granules.json?collection_concept_id={SRTMGL30_CMR}&page_size=100"
    r = subprocess.run(["curl", "-sS", "-L", "--fail", "-m", "120", url], capture_output=True, check=True)
    entradas = json.loads(r.stdout)["feed"]["entry"]
    if guardar is not None:
        guardar.write_bytes(r.stdout)
    out = []
    for g in entradas:
        out += [l["href"] for l in g["links"] if l["href"].startswith("https") and l["href"].endswith(".zip")]
    return sorted(set(out))


def descargar_srtmgl30(directorio: Path = DIR_SRTMGL30) -> list[Path]:
    """Descarga las teselas con Earthdata Login vía `curl --netrc`. Este código no lee la contraseña."""
    if not (Path.home() / ".netrc").exists() and not os.environ.get("NETRC"):
        raise DatosNoDisponibles(
            "Missing ~/.netrc with `machine urs.earthdata.nasa.gov login … password …` (free account at "
            "https://urs.earthdata.nasa.gov). The engine never asks for or stores credentials.")
    directorio.mkdir(parents=True, exist_ok=True)
    hechos = []
    with tempfile.TemporaryDirectory() as tmp:
        tarro = Path(tmp) / "cookies"
        for url in urls_srtmgl30(guardar=directorio / CMR_GRANULOS):
            destino = directorio / url.rsplit("/", 1)[1]
            if destino.exists() and zipfile.is_zipfile(destino):
                hechos.append(destino)
                continue
            parcial = destino.with_suffix(".parcial")
            r = subprocess.run(["curl", "-sS", "-L", "--fail", "-n", "-c", str(tarro), "-b", str(tarro),
                                "-m", "1800", "-o", str(parcial), url], capture_output=True, text=True)
            if r.returncode != 0 or not zipfile.is_zipfile(parcial):
                parcial.unlink(missing_ok=True)
                raise DatosNoDisponibles(f"Earthdata rejected {destino.name}: {r.stderr.strip()[:200]} "
                                         "(credentials in ~/.netrc? LP DAAC application authorized in your profile?)")
            shutil.move(parcial, destino)
            hechos.append(destino)
    return hechos


# =========================================================================== Tierra: máscara de agua SRTMSWBD V003
# (constantes y formato junto a las de SRTMGL30, más arriba: `cargar_srtmgl30` las usa)


def granulos_cmr(parametros: str, guardar: Path | None = None) -> list[dict]:
    """Todos los gránulos de una consulta pública de CMR (sin credenciales), paginando con `CMR-Search-After`.

    Se exige que el nº recibido coincida con `CMR-Hits`. Con `guardar`, deja la respuesta completa en ese archivo
    (formato `{"feed": {"entry": [...]}}`, como el JSON de una sola página), con la consulta y el nº de hits."""
    url = f"https://cmr.earthdata.nasa.gov/search/granules.json?{parametros}&page_size=2000"
    entradas, despues, hits = [], None, None
    with tempfile.TemporaryDirectory() as tmp:
        cab = Path(tmp) / "cabeceras"
        while True:
            orden = ["curl", "-sS", "-L", "--fail", "-m", "300", "-D", str(cab), url]
            if despues:
                orden[1:1] = ["-H", f"CMR-Search-After: {despues}"]
            r = subprocess.run(orden, capture_output=True, check=True)
            cabeceras = {}
            for linea in cab.read_text(encoding="latin-1").splitlines():
                if ":" in linea:
                    k, v = linea.split(":", 1)
                    cabeceras[k.strip().lower()] = v.strip()
            hits = int(cabeceras["cmr-hits"])
            pagina = json.loads(r.stdout)["feed"]["entry"]
            entradas += pagina
            despues = cabeceras.get("cmr-search-after")
            if not pagina or len(entradas) >= hits or not despues:
                break
    _exigir(len(entradas) == hits, f"CMR: {len(entradas)} gránulos recibidos ≠ CMR-Hits {hits} ({parametros})")
    ids = [g["id"] for g in entradas]
    _exigir(len(set(ids)) == len(ids), f"CMR: gránulos repetidos al paginar ({parametros})")
    if guardar is not None:
        guardar.write_text(json.dumps({"consulta": url, "cmr_hits": hits, "feed": {"entry": entradas}},
                                      ensure_ascii=False), encoding="utf-8")
    return entradas


def _tesela_de_nombre(nombre: str) -> tuple[int, int]:
    """'N36W006…' → (36, −6): latitud sur y longitud oeste (esquina SO) de la tesela de 1°."""
    m = re.match(r"([NS])(\d{2})([EW])(\d{3})", nombre, re.IGNORECASE)
    _exigir(m is not None, f"{nombre}: el nombre no sigue el patrón [NS]dd[EW]ddd de las teselas de 1°")
    return (int(m[2]) * (1 if m[1].upper() == "N" else -1), int(m[4]) * (1 if m[3].upper() == "E" else -1))


def cajas_swbd(directorio: Path = DIR_SRTMSWBD) -> dict | None:
    """{(lat_s, lon_o): caja (S, O, N, E) de CMR} de cada tesela SRTMSWBD; None si falta el JSON de CMR.

    Comprueba que la caja de cada gránulo es la tesela de 1° de su nombre ampliada por un margen igual en los cuatro
    lados y como mucho de 1″. Ese margen NO fija el registro: CMR publica ±1″ (3602″ de ancho para 3601 muestras,
    lo que no corresponde ni a registro por nodo ni por píxel). El registro se comprueba con los datos (bordes
    compartidos entre teselas vecinas, `construir_fraccion_agua`)."""
    ruta = directorio / CMR_GRANULOS
    if not ruta.exists():
        return None
    cajas = {}
    for g in json.loads(ruta.read_text(encoding="utf-8"))["feed"]["entry"]:
        gid = g.get("producer_granule_id") or g["title"]
        _exigir(g.get("collection_concept_id") == SRTMSWBD_CMR, f"{ruta.name}: {gid} es de otra colección")
        _exigir(len(g.get("boxes") or []) == 1, f"{ruta.name}: {gid} no trae una única caja")
        s, o, n, e = (float(x) for x in g["boxes"][0].split())
        la, lo = _tesela_de_nombre(gid)
        margenes = [la - s, n - la - 1] + [m for m, borde in ((lo - o, o), (e - lo - 1, e)) if abs(borde) != 180.0]
        _exigir(max(margenes) - min(margenes) < 1e-6 and -1e-6 < min(margenes) and max(margenes) < 1 / 3600 + 1e-6,
                f"{gid}: caja CMR {(s, o, n, e)} no es la tesela 1° de su nombre con un margen ≤ 1″")
        _exigir((la, lo) not in cajas, f"{ruta.name}: tesela {gid} repetida")
        cajas[(la, lo)] = (s, o, n, e)
    return cajas


def urls_srtmswbd(guardar: Path | None = None) -> list[str]:
    """URLs HTTPS de los zips de SRTMSWBD V003 según CMR (≈ 12 000 gránulos, paginados)."""
    out = []
    for g in granulos_cmr(f"collection_concept_id={SRTMSWBD_CMR}", guardar):
        out += [l["href"] for l in g["links"] if l["href"].startswith("https") and l["href"].endswith(".raw.zip")]
    return sorted(set(out))


def descargar_srtmswbd(directorio: Path = DIR_SRTMSWBD, simultaneas: int = 8, progreso=None) -> dict:
    """Descarga las teselas SRTMSWBD (Earthdata Login vía `curl --netrc`; este código no lee la contraseña).

    Reanudable: salta los zips que ya están y se abren como zip. Si Earthdata rechaza una descarga, se cancelan las
    pendientes y se devuelve el mensaje exacto (no se reintenta ni se rodea)."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    if not (Path.home() / ".netrc").exists() and not os.environ.get("NETRC"):
        raise DatosNoDisponibles("Missing ~/.netrc with the Earthdata Login credentials.")
    directorio.mkdir(parents=True, exist_ok=True)
    urls = urls_srtmswbd(guardar=directorio / CMR_GRANULOS)
    pendientes = [u for u in urls if not ((directorio / u.rsplit("/", 1)[1]).exists()
                                          and zipfile.is_zipfile(directorio / u.rsplit("/", 1)[1]))]
    hechas, errores = 0, []
    with tempfile.TemporaryDirectory() as tmp:
        def bajar(i_url):
            import time
            i, url = i_url                                    # un tarro de cookies por hilo: curl no los comparte bien
            for intento in range(4):
                try:
                    return _curl_earthdata(url, directorio / url.rsplit("/", 1)[1], Path(tmp) / f"cookies_{i % simultaneas}")
                except DatosNoDisponibles as e:
                    # 401/403 = credenciales o autorización: no se reintenta. Un fallo de red (conexión reiniciada,
                    # tiempo agotado, 5xx) sí, hasta 3 veces con espera creciente.
                    if re.search(r"error: 40[13]\b", str(e)) or intento == 3:
                        raise
                    time.sleep(5 * (intento + 1))
        ex = ThreadPoolExecutor(max_workers=simultaneas)
        futuros = {ex.submit(bajar, (i, u)): u for i, u in enumerate(pendientes)}
        try:
            for fut in as_completed(futuros):
                try:
                    fut.result()
                    hechas += 1
                except DatosNoDisponibles as e:
                    errores.append(str(e))
                    break                                     # primer rechazo: no seguir
                if progreso and hechas % 250 == 0:
                    progreso(hechas, len(pendientes))
        finally:
            ex.shutdown(wait=True, cancel_futures=True)
    zips = sorted(directorio.glob("*.raw.zip"))
    return {"granulos_cmr": len(urls), "ya_estaban": len(urls) - len(pendientes), "descargadas_ahora": hechas,
            "en_disco": len(zips), "errores": errores}


def _zips_swbd(directorio: Path) -> dict:
    return {_tesela_de_nombre(z.name): z for z in directorio.glob("*.SRTMSWBD.raw.zip")}


def estado_swbd(directorio: Path = DIR_SRTMSWBD) -> dict:
    """Cuántas teselas hay en disco frente a las que lista CMR (sin abrir los zips)."""
    cajas = cajas_swbd(directorio) if directorio.exists() else None
    zips = _zips_swbd(directorio) if directorio.exists() else {}
    return {"directorio": str(directorio), "variable_de_entorno": "SRTMSWBD_DIR (por defecto ~/.cache/landfall/srtmswbd, "
            "fuera del repositorio)",
            "teselas_en_disco": len(zips), "granulos_cmr": None if cajas is None else len(cajas),
            "faltan": None if cajas is None else len(set(cajas) - set(zips)),
            "completa": cajas is not None and not (set(cajas) - set(zips))}


def cuentas_tesela_swbd(crudo: bytes, nombre: str, celda: int = CELDA_SWBD) -> tuple[np.ndarray, dict, dict]:
    """Bytes de un `.raw` → (nº de píxeles de agua por celda de `celda`×`celda` píxeles, bordes, valores).

    Registro por nodo: la fila 3601.ª (sur) y la columna 3601.ª (este) son la primera fila / columna de las teselas
    vecinas y NO se cuentan aquí; así cada celda recibe exactamente celda² píxeles, cada píxel una sola vez, y cada
    celda queda dentro de una sola tesela. Consecuencia: los 30×30 píxeles de una celda de 30″ son los de sus bordes
    norte y oeste hacia dentro, desplazados 0,5″ (≈ 15 m) al NO respecto al centro de la celda."""
    _exigir(len(crudo) == M_SWBD * M_SWBD, f"{nombre}: {len(crudo)} bytes ≠ {M_SWBD}×{M_SWBD}×1 del formato documentado")
    _exigir((M_SWBD - 1) % celda == 0, f"{M_SWBD - 1} píxeles por grado no son múltiplo de {celda}")
    a = np.frombuffer(crudo, dtype=np.uint8).reshape(M_SWBD, M_SWBD)
    hist = np.bincount(a.ravel(), minlength=256)
    otros = {int(v): int(hist[v]) for v in np.nonzero(hist)[0] if v not in (VALOR_AGUA_SWBD, VALOR_TIERRA_SWBD)}
    _exigir(not otros, f"{nombre}: valores no documentados {otros} (se esperaban solo "
                       f"{VALOR_TIERRA_SWBD} y {VALOR_AGUA_SWBD})")
    agua = a == VALOR_AGUA_SWBD
    n, k = M_SWBD - 1, (M_SWBD - 1) // celda
    cuentas = agua[:n, :n].reshape(k, celda, k, celda).sum(axis=(1, 3), dtype=np.uint16)
    bordes = {lado: np.packbits(x) for lado, x in (("n", agua[0]), ("s", agua[-1]), ("s1", agua[-2]),
                                                    ("o", agua[:, 0]), ("e", agua[:, -1]), ("e1", agua[:, -2]))}
    return cuentas, bordes, {"agua": int(hist[VALOR_AGUA_SWBD]), "tierra": int(hist[VALOR_TIERRA_SWBD])}


def _bordes_compartidos(bordes: dict) -> dict:
    """Con registro por nodo, la última fila de una tesela y la primera de la vecina del sur son el MISMO paralelo
    (y lo mismo con las columnas al este): deben coincidir. Control: la penúltima línea frente a la misma primera
    línea de la vecina (líneas a 1″ de distancia), que solo coincide donde la máscara no cambia."""
    out = {}
    for nombre, (dla, dlo, mio, mio_1, suyo) in {"sur": (-1, 0, "s", "s1", "n"), "este": (0, 1, "e", "e1", "o")}.items():
        pares = dif = dif_ctrl = pares_dif = pares_dif_ctrl = 0
        for (la, lo), b in bordes.items():
            v = bordes.get((la + dla, ((lo + dlo + 180) % 360) - 180))
            if v is None:
                continue
            x, y, z = (np.unpackbits(t)[:M_SWBD] for t in (b[mio], v[suyo], b[mio_1]))
            d, dc = int((x != y).sum()), int((z != y).sum())
            pares += 1
            dif += d
            dif_ctrl += dc
            pares_dif += d > 0
            pares_dif_ctrl += dc > 0
        out[nombre] = {"pares_de_teselas": pares, "pixeles_comparados": pares * M_SWBD,
                       "distintos_en_la_linea_compartida": dif, "pares_con_alguna_diferencia": pares_dif,
                       "control_linea_adyacente_distintos": dif_ctrl, "control_pares_con_diferencia": pares_dif_ctrl}
    return out


def _geometria_mosaico() -> dict:
    ruta = (config.CACHE / "srtmgl30_mosaico_i2le.bin").with_suffix(".json")
    if not ruta.exists():
        raise DatosNoDisponibles("Missing the SRTMGL30 mosaic: run `python -m similitud descargar-tierra` first.")
    meta = json.loads(ruta.read_text(encoding="utf-8"))
    return {k: meta[k] for k in ("filas", "columnas", "lat0", "lon0", "paso")}


def construir_fraccion_agua(directorio: Path = DIR_SRTMSWBD, geometria: dict | None = None,
                            destino: Path | None = None, simultaneas: int = 8, comprobar: bool = True) -> Path:
    """Agrega la máscara de 1″ a la rejilla de 30″ del mosaico SRTMGL30 (u otra `geometria` alineada con los grados
    enteros): nº de píxeles de agua por celda, más los códigos FUERA_COBERTURA_SWBD / SIN_TESELA_SWBD.

    Exige la lista de CMR y todas sus teselas en disco (si falta alguna, no se sabría si es tierra, agua o una
    descarga pendiente). Con `comprobar`, mide la alineación con SRTMGL30 y el efecto de los umbrales."""
    import hashlib
    import time
    from concurrent.futures import ThreadPoolExecutor
    t0 = time.time()
    cajas = cajas_swbd(directorio)
    if cajas is None:
        raise DatosNoDisponibles(f"Missing {directorio / CMR_GRANULOS}: run `python -m similitud descargar-agua`.")
    zips = _zips_swbd(directorio)
    _exigir(not (set(zips) - set(cajas)), f"teselas en disco que CMR no lista: {sorted(set(zips) - set(cajas))[:5]}")
    faltan = set(cajas) - set(zips)
    if faltan:
        raise DatosNoDisponibles(f"{len(faltan)} of {len(cajas)} SRTMSWBD tiles missing in {directorio}: run "
                                 "`python -m similitud descargar-agua` again (it skips tiles already downloaded).")
    s_cob, n_cob = COBERTURA_SWBD
    _exigir(all(s_cob <= la and la + 1 <= n_cob for la, _ in cajas), f"hay teselas fuera de {COBERTURA_SWBD}")
    desde_mosaico = geometria is None
    geo = geometria or _geometria_mosaico()
    paso = geo["paso"]
    celda = int(round(paso * (M_SWBD - 1)))
    _exigir(abs(celda / (M_SWBD - 1) - paso) < 1e-12 and (M_SWBD - 1) % celda == 0,
            f"paso {paso}° no es un nº entero de píxeles de 1″ que divida al grado")
    lat_n, lon_o = geo["lat0"] + paso / 2, geo["lon0"] - paso / 2
    _exigir(abs(lat_n - round(lat_n)) < 1e-9 and abs(lon_o - round(lon_o)) < 1e-9,
            "los bordes de la rejilla no caen en grados enteros: las celdas no encajan en las teselas de 1°")
    lat_n, lon_o, por_grado = round(lat_n), round(lon_o), (M_SWBD - 1) // celda
    filas, columnas = geo["filas"], geo["columnas"]
    config.CACHE.mkdir(parents=True, exist_ok=True)
    destino = destino or config.CACHE / MASCARA_AGUA
    config.TEMPORAL.mkdir(parents=True, exist_ok=True)
    tmpdir = Path(tempfile.mkdtemp(prefix="agua_", dir=config.TEMPORAL))     # se escribe fuera y se mueve al final
    tmp = tmpdir / destino.name
    mm = np.memmap(tmp, dtype="<u2", mode="w+", shape=(filas, columnas))
    lat_centro = geo["lat0"] - np.arange(filas) * paso
    dentro = (lat_centro > s_cob) & (lat_centro < n_cob)
    mm[dentro] = SIN_TESELA_SWBD
    mm[~dentro] = FUERA_COBERTURA_SWBD

    def una(item):
        (la, lo), ruta = item
        f0 = int(round((lat_n - (la + 1)) / paso))
        c0 = int(round(((lo - lon_o) % 360) / paso))
        if f0 + por_grado <= 0 or f0 >= filas or c0 >= columnas:
            return (la, lo), None, None, None                 # fuera de esta rejilla (solo en rejillas parciales)
        _exigir(0 <= f0 and f0 + por_grado <= filas and c0 + por_grado <= columnas,
                f"{ruta.name}: la tesela cae a medias en la rejilla")
        with zipfile.ZipFile(ruta) as z:
            miembros = z.namelist()
            _exigir(len(miembros) == 1 and miembros[0].lower().endswith(".raw"),
                    f"{ruta.name}: se esperaba un único .raw ({miembros})")
            crudo = z.read(miembros[0])                       # zipfile comprueba el CRC
        cuentas, bordes, valores = cuentas_tesela_swbd(crudo, ruta.name, celda)
        mm[f0:f0 + por_grado, c0:c0 + por_grado] = cuentas
        return (la, lo), bordes, valores, ruta.stat().st_size

    bordes, valores, tamanos = {}, {"agua": 0, "tierra": 0}, {}
    with ThreadPoolExecutor(max_workers=simultaneas) as ex:              # zlib y numpy liberan el GIL
        for t, b, v, tam in ex.map(una, sorted(zips.items())):
            if b is None:
                continue
            bordes[t], tamanos[t] = b, tam
            for k in valores:
                valores[k] += v[k]
    mm.flush()
    huella = hashlib.sha1("".join(f"{nombre_tesela(*t)}:{tamanos[t]};" for t in sorted(tamanos)).encode()).hexdigest()
    meta = {**geo, "tipo": "uint16 little-endian", "pixeles_por_celda": celda * celda,
            "contenido": f"nº de píxeles de agua de 1″ (valor {VALOR_AGUA_SWBD} del .raw) por celda; fracción = "
                         f"valor / {celda * celda}",
            "codigos": {str(FUERA_COBERTURA_SWBD): f"fuera de la cobertura de SRTMSWBD {COBERTURA_SWBD}",
                        str(SIN_TESELA_SWBD): "dentro de la cobertura, sin gránulo en CMR"},
            "registro": f"por nodo, {M_SWBD}×{M_SWBD}: se usan las filas y columnas 0…{M_SWBD - 2} de cada tesela; "
                        f"la {M_SWBD}.ª es la 1.ª de la vecina. Cada celda: sus {celda}×{celda} píxeles desde los "
                        "bordes norte y oeste (desplazamiento de 0,5″ ≈ 15 m al NO respecto al centro)",
            "producto": "SRTMSWBD V003", "cmr": SRTMSWBD_CMR, "granulos_cmr": len(cajas),
            "teselas_agregadas": len(tamanos), "huella": huella, "valores_pixeles": valores,
            "bordes_compartidos": _bordes_compartidos(bordes), "segundos_agregado": round(time.time() - t0, 1)}
    if comprobar and desde_mosaico:
        meta["comprobacion_con_srtmgl30"] = comprobar_alineacion_agua(tmp, meta)
    del mm
    tmp.with_suffix(".json").write_text(json.dumps(meta, indent=1, ensure_ascii=False), encoding="utf-8")
    destino.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(tmp, destino)                      # primero los datos y después el .json: sin .json no se usa
    shutil.move(tmp.with_suffix(".json"), destino.with_suffix(".json"))
    shutil.rmtree(tmpdir, ignore_errors=True)
    cargar_srtmgl30.cache_clear()
    return destino


def comprobar_alineacion_agua(mascara: Path | None = None, meta: dict | None = None, bloque: int = 600) -> dict:
    """Mide, con los datos, que la rejilla de agua y el mosaico SRTMGL30 están alineados y qué cambia cada regla.

    - Por clases de fracción de agua: cuántas celdas valen 0 m en SRTMGL30 (agua plena ⇒ casi todas 0 m, salvo
      lagos con cota; sin agua ⇒ casi ninguna).
    - Desplazamiento: índice de Jaccard entre «agua plena» y «0 m» con la máscara movida ±1 celda; debe ser máximo
      sin mover (una tesela volteada o corrida 1° lo hundiría).
    - Celdas a 0 m que la máscara deja como tierra, y en qué teselas de 1° se concentran.
    - Celdas válidas de SRTMGL30 que pasan a sin dato con > 0,5, con > 0 y con la regla «0 m» donde no hay máscara."""
    mascara = mascara or config.CACHE / MASCARA_AGUA
    meta = meta or json.loads(mascara.with_suffix(".json").read_text(encoding="utf-8"))
    mos = config.CACHE / "srtmgl30_mosaico_i2le.bin"
    mmeta = json.loads(mos.with_suffix(".json").read_text(encoding="utf-8"))
    _exigir(all(abs(mmeta[k] - meta[k]) < 1e-12 for k in ("filas", "columnas", "lat0", "lon0", "paso")),
            "la rejilla de agua no tiene la geometría del mosaico SRTMGL30")
    filas, columnas, sd, ppc = mmeta["filas"], mmeta["columnas"], mmeta["sin_dato"], meta["pixeles_por_celda"]
    dn = np.memmap(mos, dtype="<i2", mode="r", shape=(filas, columnas))
    ag = np.memmap(mascara, dtype="<u2", mode="r", shape=(filas, columnas))
    pg = int(round(1 / mmeta["paso"]))                 # celdas por grado
    clases = {"0": (0, 0), "(0, 0,5]": (1, ppc // 2), "(0,5, 1)": (ppc // 2 + 1, ppc - 1), "1": (ppc, ppc)}
    tabla = {k: [0, 0] for k in clases}
    desp = [(df, dc) for df in (-1, 0, 1) for dc in (-1, 0, 1)]
    inter, union = {d: 0 for d in desp}, {d: 0 for d in desp}
    hist = np.zeros(ppc + 1, np.int64)                 # celdas válidas de SRTMGL30 por nº de píxeles de agua
    sin_masc = {str(FUERA_COBERTURA_SWBD): [0, 0], str(SIN_TESELA_SWBD): [0, 0]}   # [válidas, de ellas a 0 m]
    ceros_tierra = {}
    for f0 in range(0, filas, bloque):
        f1 = min(filas, f0 + bloque)
        d, a = np.asarray(dn[f0:f1]), np.asarray(ag[f0:f1])
        valida = d != sd
        con = a <= ppc
        for k, (lo_, hi_) in clases.items():
            m = con & valida & (a >= lo_) & (a <= hi_)
            tabla[k][0] += int(m.sum())
            tabla[k][1] += int((m & (d == 0)).sum())
        hist += np.bincount(a[con & valida], minlength=ppc + 1)[:ppc + 1]
        for cod in sin_masc:
            m = (a == int(cod)) & valida
            sin_masc[cod][0] += int(m.sum())
            sin_masc[cod][1] += int((m & (d == 0)).sum())
        m = con & valida & (d == 0) & (a <= ppc // 2)          # 0 m que la máscara (> 0,5) deja como tierra
        if m.any():
            ff, cc = np.nonzero(m)
            for t, n in zip(*np.unique((ff + f0) // pg * 1000 + cc // pg, return_counts=True)):
                ceros_tierra[int(t)] = ceros_tierra.get(int(t), 0) + int(n)
        # Jaccard con desplazamientos, solo en celdas con máscara (fuera de la rejilla: sin máscara; en longitud la
        # rejilla es cíclica). Desplazar +1 fila = comparar cada celda de SRTMGL30 con la máscara de la celda del sur.
        cero = (d == 0) & valida & con
        for df, dc in desp:
            sub = np.full((f1 - f0, columnas), FUERA_COBERTURA_SWBD, np.uint16)
            g0, g1 = max(0, f0 + df), min(filas, f1 + df)
            sub[g0 - f0 - df:g1 - f0 - df] = ag[g0:g1]
            lleno = np.roll(sub, -dc, axis=1) == ppc
            inter[(df, dc)] += int((lleno & cero).sum())
            union[(df, dc)] += int(((lleno & valida) | cero).sum())
    jac = {f"{df:+d},{dc:+d}": round(inter[(df, dc)] / union[(df, dc)], 5) for df, dc in desp if union[(df, dc)]}
    lat_n, lon_o = mmeta["lat0"] + mmeta["paso"] / 2, mmeta["lon0"] - mmeta["paso"] / 2
    top = sorted(ceros_tierra.items(), key=lambda x: -x[1])[:15]

    def efecto(umbral):
        return int(hist[np.arange(ppc + 1) > umbral * ppc].sum())
    total_validas = int(hist.sum()) + sum(v[0] for v in sin_masc.values())
    return {
        "celdas_por_clase_de_agua": {k: {"celdas_validas": v[0], "a_0_m": v[1],
                                         "fraccion_a_0_m": round(v[1] / v[0], 5) if v[0] else None}
                                     for k, v in tabla.items()},
        "jaccard_agua_plena_vs_0m_por_desplazamiento_filas_columnas": jac,
        "desplazamiento_optimo": max(jac, key=jac.get),
        "ceros_que_quedan_como_tierra_con_umbral_0_5": {
            "celdas": sum(ceros_tierra.values()),
            "teselas_con_mas": [{"tesela": nombre_tesela(int(round(lat_n)) - 1 - t // 1000, int(round(lon_o)) + t % 1000),
                                 "celdas": n} for t, n in top]},
        "celdas_validas_srtmgl30": total_validas,
        "efecto_por_umbral": {f"> {u}": efecto(u) for u in (0.5, 0.0)},
        "sin_mascara": {("fuera_de_cobertura" if c == str(FUERA_COBERTURA_SWBD) else "sin_tesela"):
                        {"celdas_validas": v[0], "a_0_m_pasan_a_sin_dato": v[1]} for c, v in sin_masc.items()},
        "histograma_pixeles_agua": hist.tolist(),
    }


# =========================================================================== Tierra: teselas HGT (SRTMGL3 / NASADEM)
# Formato HGT: una tesela de 1°×1° por archivo, enteros de 16 bits big-endian, m×m muestras con registro de
# rejilla (los centros de la primera y la última fila/columna caen sobre los grados enteros: el recuadro de CMR
# de NASADEM_HGT_s01w047 es −47,0001389…−45,9998611, medio píxel de 1″ más allá). m = 3601 (1″) o 1201 (3″).
# Vacíos: −32768. Sobre océano abierto no existe tesela: eso se averigua en CMR, no se supone.
PRODUCTOS_HGT = {
    "nasadem": {"corto": "NASADEM_HGT", "version": "001", "dir": config.DATOS / "nasadem", "m": 3601,
                "fuente": "nasadem_hgt", "producto": "NASADEM_HGT V001"},
    "srtmgl3": {"corto": "SRTMGL3", "version": "003", "dir": config.DATOS / "srtmgl3", "m": 1201,
                "fuente": "srtmgl3", "producto": "SRTMGL3 V003"},
}
VACIO_HGT = -32768


def nombre_tesela(lat_s: int, lon_w: int) -> str:
    return f"{'n' if lat_s >= 0 else 's'}{abs(lat_s):02d}{'e' if lon_w >= 0 else 'w'}{abs(lon_w):03d}"


def teselas_necesarias(lat: float, lon: float, lado_km: float) -> list[tuple[int, int]]:
    """Teselas de 1° que toca la huella de la ventana (perímetro e interior muestreados cada ~L/40)."""
    from .preprocessing import azimutal_equidistante_inversa       # import local: evita ciclo
    t = np.linspace(-0.5, 0.5, 41) * lado_km * 1000.0
    x, y = np.meshgrid(t, t)
    a, f = config.WGS84_A, config.WGS84_F
    e2 = f * (2 - f)
    s = math.sin(math.radians(lat))
    radio = a * math.sqrt(1 - e2) / (1 - e2 * s * s)
    la, lo = azimutal_equidistante_inversa(x, y, lat, lon % 360.0, radio)
    lo = ((lo + 180.0) % 360.0) - 180.0
    return sorted({(int(math.floor(a_)), int(math.floor(b_))) for a_, b_ in zip(la.ravel(), lo.ravel())})


def _zip_tesela(prod: dict, nombre: str) -> Path | None:
    for z in prod["dir"].glob("*.zip"):
        if nombre in z.name.lower():
            return z
    return None


def _leer_hgt(ruta: Path, m_esperado: int) -> np.ndarray:
    with zipfile.ZipFile(ruta) as z:
        hgt = [n for n in z.namelist() if n.lower().endswith(".hgt")]
        _exigir(len(hgt) == 1, f"{ruta.name}: se esperaba un .hgt y contiene {z.namelist()}")
        crudo = z.read(hgt[0])
    m = int(round(math.sqrt(len(crudo) / 2)))
    _exigir(m * m * 2 == len(crudo) and m == m_esperado, f"{ruta.name}: {len(crudo)} bytes ≠ {m_esperado}²×2")
    return np.frombuffer(crudo, dtype=">i2").reshape(m, m)


def _sin_tesela(prod: dict) -> set[str]:
    ruta = prod["dir"] / "sin_tesela_en_cmr.json"
    return set(json.loads(ruta.read_text())) if ruta.exists() else set()


@lru_cache(maxsize=4)
def cargar_hgt_region(clave: str, lat: float, lon: float, lado_km: float) -> RejillaGeografica | None:
    """Mosaico regional de teselas HGT que cubre la ventana, o None si falta alguna tesela por descargar."""
    prod = PRODUCTOS_HGT[clave]
    nec = teselas_necesarias(lat, lon, lado_km)
    lons = {b for _, b in nec}
    if max(lons) - min(lons) > 180:
        return None                                       # cruza el antimeridiano: no se monta aquí
    vacias, leidas = _sin_tesela(prod), {}
    for la, lo in nec:
        n = nombre_tesela(la, lo)
        z = _zip_tesela(prod, n)
        if z is not None:
            leidas[(la, lo)] = (z, _leer_hgt(z, prod["m"]))
        elif n not in vacias:
            return None
    if not leidas:
        return None
    m = prod["m"]
    lat_top, lon_izq = max(a for a, _ in nec) + 1, min(b for _, b in nec)
    nlat, nlon = lat_top - min(a for a, _ in nec), max(b for _, b in nec) + 1 - lon_izq
    mos = np.full((nlat * (m - 1) + 1, nlon * (m - 1) + 1), VACIO_HGT, dtype=">i2")
    for (la, lo), (_, a) in leidas.items():
        f0, c0 = (lat_top - (la + 1)) * (m - 1), (lo - lon_izq) * (m - 1)
        mos[f0:f0 + m, c0:c0 + m] = a
    paso = 1.0 / (m - 1)
    return RejillaGeografica(
        cuerpo="earth", producto=prod["producto"], fuente=prod["fuente"], crudo=mos, escala=1.0, desplazamiento=0.0,
        radio_m=None, elipsoide=(config.WGS84_A, config.WGS84_F), sin_dato=VACIO_HGT,
        referencia_vertical="height above the EGM96 geoid (LP DAAC documentation); WGS84 geodetic latitudes",
        criterio_validez="celda ≠ −32768 (vacío) y dentro de teselas existentes (sin tesela = océano según CMR)",
        procedencia={"teselas": sorted(z.name for z, _ in leidas.values()),
                     "teselas_oceano_segun_cmr": sorted(nombre_tesela(a, b) for a, b in nec if (a, b) not in leidas)},
        lat0=float(lat_top), dlat=paso, lon0=float(lon_izq), dlon=paso)


def _curl_earthdata(url: str, destino: Path, tarro: Path) -> None:
    parcial = destino.with_suffix(".parcial")
    r = subprocess.run(["curl", "-sS", "-L", "--fail", "-n", "-c", str(tarro), "-b", str(tarro),
                        "-m", "1800", "-o", str(parcial), url], capture_output=True, text=True)
    if r.returncode != 0 or not zipfile.is_zipfile(parcial):
        parcial.unlink(missing_ok=True)
        raise DatosNoDisponibles(f"Earthdata rejected {destino.name}: {r.stderr.strip()[:200]} "
                                 "(credentials in ~/.netrc? LP DAAC application authorized in your profile?)")
    shutil.move(parcial, destino)


def descargar_hgt(clave: str, lat: float, lon: float, lado_km: float) -> dict:
    """Descarga (Earthdata Login vía ~/.netrc) las teselas que cubren la ventana y anota cuáles no existen en CMR."""
    prod = PRODUCTOS_HGT[clave]
    if not (Path.home() / ".netrc").exists() and not os.environ.get("NETRC"):
        raise DatosNoDisponibles("Missing ~/.netrc with the Earthdata Login credentials.")
    nec = teselas_necesarias(lat, lon, lado_km)
    s_, w_ = min(a for a, _ in nec), min(b for _, b in nec)
    n_, e_ = max(a for a, _ in nec) + 1, max(b for _, b in nec) + 1
    url = (f"https://cmr.earthdata.nasa.gov/search/granules.json?short_name={prod['corto']}&version={prod['version']}"
           f"&bounding_box={w_ + 0.01},{s_ + 0.01},{e_ - 0.01},{n_ - 0.01}&page_size=200")
    r = subprocess.run(["curl", "-sS", "-L", "--fail", "-m", "120", url], capture_output=True, check=True)
    urls = sorted({l["href"] for g in json.loads(r.stdout)["feed"]["entry"] for l in g["links"]
                   if l["href"].startswith("https") and l["href"].endswith(".zip")})
    prod["dir"].mkdir(parents=True, exist_ok=True)
    hechas = []
    with tempfile.TemporaryDirectory() as tmp:
        for u in urls:
            destino = prod["dir"] / u.rsplit("/", 1)[1]
            if not (destino.exists() and zipfile.is_zipfile(destino)):
                _curl_earthdata(u, destino, Path(tmp) / "cookies")
            hechas.append(destino.name)
    en_cmr = {n for n in (nombre_tesela(a, b) for a, b in nec) if any(n in u.lower() for u in urls)}
    vacias = _sin_tesela(prod) | ({nombre_tesela(a, b) for a, b in nec} - en_cmr)
    (prod["dir"] / "sin_tesela_en_cmr.json").write_text(json.dumps(sorted(vacias)))
    cargar_hgt_region.cache_clear()
    return {"producto": prod["producto"], "teselas": hechas, "sin_tesela_en_cmr": sorted(vacias)}


def mejor_raster(cuerpo: str, lat: float, lon: float, lado_km: float, producto: str | None = None) -> Raster:
    """MDE oficial más fino disponible en disco que cubre TODA la ventana."""
    if producto:
        return cargar(cuerpo, producto)
    if cuerpo == "earth":
        for clave in ("nasadem", "srtmgl3"):
            r = cargar_hgt_region(clave, round(lat, 4), round(lon, 4), lado_km)
            if r is not None:
                return r
        return cargar_srtmgl30()
    if cuerpo == "moon":
        from .preprocessing import cobertura_aproximada
        hemis = "s" if lat < 0 else "n"
        polares = []
        for img in (config.DATOS / "lola_gdr_polar").glob(f"ldem_*{hemis}_*m.img"):
            r = cargar_lola_polar(img.stem)
            if cobertura_aproximada(r, lat, lon, lado_km, puntos=9) == 1.0:
                polares.append(r)
        if polares:
            return min(polares, key=lambda r: r.espaciado_nativo_m())
        return cargar_lola_16()
    return cargar(cuerpo)


# =========================================================================== acceso por cuerpo
def cargar(cuerpo: str, producto: str | None = None) -> Raster:
    if cuerpo == "moon":
        return cargar_lola_polar(producto) if producto and producto.startswith("ldem_") and producto != "ldem_16" \
            else cargar_lola_16()
    if cuerpo == "mars":
        return cargar_mola(producto or "areoide")
    if cuerpo == "earth":
        return cargar_srtmgl30()
    raise ValueError(f"cuerpo desconocido: {cuerpo!r}")


def disponibilidad() -> dict:
    """Qué MDE hay en disco, sin cargarlos."""
    polares = sorted(p.stem for p in (config.DATOS / "lola_gdr_polar").glob("ldem_*.img"))
    return {
        "moon": {"ldem_16": (config.DATOS / "lola_gdr" / "ldem_16.img").exists(), "polares": polares},
        "mars": {"megt_16ppd": (config.DATOS / "mola_meg016" / "megt90n000eb.img").exists()},
        "earth": {"srtmgl30_teselas": len(list(DIR_SRTMGL30.glob("*.zip"))) if DIR_SRTMGL30.exists() else 0,
                  "srtmswbd": {**estado_swbd(), "rejilla_30s": (config.CACHE / MASCARA_AGUA).with_suffix(".json").exists(),
                               "umbral_agua": UMBRAL_AGUA},
                  "earthdata_netrc": (Path.home() / ".netrc").exists(),
                  "como_obtener": "python -m similitud descargar-tierra (requiere Earthdata Login en ~/.netrc); "
                                  "máscara de agua: python -m similitud descargar-agua"},
    }
