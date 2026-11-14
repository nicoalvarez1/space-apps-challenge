#!/usr/bin/env python3
"""Convierte los productos PDS de la Luna en capas ligeras para la web.

Entradas (datos_pds/, se bajan con `python3 tools/descargar.py lola diviner lp`):
  LOLA GDR 16 px/grado -> elevación, nº de disparos, pendiente y rugosidad a 8 px/grado
  Diviner GCP 0,5°     -> temperatura bolométrica máx/mín/media de la curva diurna
  Lunar Prospector 0,5°-> hidrógeno (ppm) y FeO (% en peso)

Requiere numpy. La geometría se lee de las etiquetas PDS.
"""
from __future__ import annotations

import sys

import numpy as np

from comun import DATOS, exigir, leer_etiqueta_pds3, limpio, numero, registrar_capa
from fuentes import BANDAS_DIVINER, DIVINER, GRUPOS, LOLA, LP, MD5_DIVINER


def _md5(grupo: str, destino: str) -> str | None:
    return next((a["md5"] for a in GRUPOS[grupo]["archivos"] if a["destino"] == destino), None)


def leer_lola(nombre: str):
    et = leer_etiqueta_pds3(DATOS / "lola_gdr" / f"{nombre}.lbl")
    lineas, muestras = int(numero(et["IMAGE.LINES"])), int(numero(et["IMAGE.LINE_SAMPLES"]))
    exigir(limpio(et["IMAGE.SAMPLE_TYPE"]) == "LSB_INTEGER" and numero(et["IMAGE.SAMPLE_BITS"]) == 16, f"{nombre}: tipo de muestra inesperado")
    exigir(numero(et["MAP_RESOLUTION"]) == 16 and numero(et["MAXIMUM_LATITUDE"]) == 90 and numero(et["CENTER_LONGITUDE"]) == 180,
           f"{nombre}: geometría inesperada")
    ruta = DATOS / "lola_gdr" / f"{nombre}.img"
    exigir(ruta.stat().st_size == lineas * muestras * 2, f"{nombre}: tamaño de archivo ≠ etiqueta")
    return np.fromfile(ruta, dtype="<i2").reshape(lineas, muestras), et


GEO_8PPD = dict(lat_centro_0=90 - 0.5 / 8, dlat=-1 / 8, lon_centro_0=0.5 / 8, dlon=1 / 8, lon_ciclica=True,
                resolucion="0,125° (≈3,8 km en el ecuador)")


def _fuente_lola(et, nombre: str, descr: str) -> dict:
    return {
        "mision": "Lunar Reconnaissance Orbiter · LOLA", "dataset": limpio(et["DATA_SET_ID"]),
        "productos": [f"{limpio(et['PRODUCT_ID'])} ({descr}), versión {limpio(et['PRODUCT_VERSION_ID'])}"],
        "urls": [f"{LOLA}/data/lola_gdr/cylindrical/img/{nombre}.img", f"{LOLA}/data/lola_gdr/cylindrical/img/{nombre}.lbl"],
        "md5_originales": {f"{nombre}.img": _md5("lola", f"lola_gdr/{nombre}.img")},
        "cita": "Smith, D. E. et al., LRO LOLA Gridded Data Record (GDR), NASA Planetary Data System, LRO-L-LOLA-4-GDR-V1.0.",
    }


# --------------------------------------------------------------------------- LOLA
def construir_lola() -> None:
    print("[LOLA] 16 → 8 px/grado")
    dem, et = leer_lola("ldem_16")
    escala, radio_ref = numero(et["IMAGE.SCALING_FACTOR"]), numero(et["IMAGE.OFFSET"])
    exigir(escala == 0.5 and radio_ref == 1737400, "LDEM_16: SCALING_FACTOR/OFFSET inesperados")
    altura16 = dem.astype(np.float64) * escala                               # m sobre la esfera de 1737,4 km
    altura8 = np.rint(altura16.reshape(1440, 2, 2880, 2).mean(axis=(1, 3))).astype("<i2")
    i, j = np.unravel_index(dem.argmax(), dem.shape)
    k, l = np.unravel_index(dem.argmin(), dem.shape)
    extremos = {"dn_min_archivo": int(dem.min()), "dn_max_archivo": int(dem.max()),
                "dn_min_etiqueta": int(numero(et["IMAGE.MINIMUM"])), "dn_max_etiqueta": int(numero(et["IMAGE.MAXIMUM"])),
                "max_m": float(dem.max() * escala), "max_lat": round(90 - (i + .5) / 16, 4), "max_lonE": round((j + .5) / 16, 4),
                "min_m": float(dem.min() * escala), "min_lat": round(90 - (k + .5) / 16, 4), "min_lonE": round((l + .5) / 16, 4)}
    print(f"  extremos a 1/16°: {extremos}")
    registrar_capa("moon_elev", altura8, dict(
        cuerpo="moon", variable="elevacion", nombre="Altura sobre la esfera de 1737,4 km", unidades="m",
        archivo="lola_elev_8ppd.bin", escala=1, desplazamiento=0, sin_dato=None, **GEO_8PPD,
        procesado="Altura = DN × 0,5 m (SCALING_FACTOR de la etiqueta) respecto a una esfera de 1737,4 km. "
                  "Media de cada bloque 2×2 de 1/16° → 1/8°, redondeada al metro. "
                  "Fila 0 = 90°N, columna 0 = 0°E; lat = 90 − (i+0,5)/8; lon = (j+0,5)/8.",
        nota="Es altura respecto a una esfera, no respecto al geoide lunar. La etiqueta declara MINIMUM/MAXIMUM "
             f"{extremos['dn_min_etiqueta']}/{extremos['dn_max_etiqueta']} DN, pero el archivo (MD5 verificado) contiene "
             f"{extremos['dn_min_archivo']}/{extremos['dn_max_archivo']} DN.",
        extremos_16ppd=extremos, fuente=_fuente_lola(et, "ldem_16", "altura")))

    cnt, et_c = leer_lola("ldec_16")
    disparos8 = cnt.astype(np.int32).reshape(1440, 2, 2880, 2).sum(axis=(1, 3))
    registrar_capa("moon_disparos", np.minimum(disparos8, 255).astype("u1"), dict(
        cuerpo="moon", variable="disparos", nombre="Disparos LOLA en la celda", unidades="disparos (tope 255)",
        archivo="lola_disparos_8ppd.bin", escala=1, desplazamiento=0, sin_dato=None, **GEO_8PPD,
        procesado="Suma de LDEC_16 (disparos por celda de 1/16°) en cada bloque 2×2; tope 255. 0 = altura interpolada.",
        fuente=_fuente_lola(et_c, "ldec_16", "nº de observaciones")))
    print(f"  celdas de 1/8° sin ningún disparo: {100 * float((disparos8 == 0).mean()):.3f} %")

    for nombre, ident, variable, titulo, unidad, factor_guardado, descr in (
            ("ldsm_16", "moon_pendiente", "pendiente_lola", "Pendiente bidireccional LOLA", "°", 100, "pendiente"),
            ("ldrm_16", "moon_rugosidad", "rugosidad_lola", "Rugosidad LOLA (desviación típica de alturas)", "m", 1000, "rugosidad")):
        img, et_s = leer_lola(nombre)
        falta = int(numero(et_s["IMAGE.MISSING_CONSTANT"]))
        fisico = np.where(img == falta, np.nan, img.astype(np.float64) * numero(et_s["IMAGE.SCALING_FACTOR"]) + numero(et_s["IMAGE.OFFSET"]))
        bloques = fisico.reshape(1440, 2, 2880, 2)
        n = np.isfinite(bloques).sum(axis=(1, 3))
        media = np.where(n > 0, np.nansum(bloques, axis=(1, 3)) / np.maximum(n, 1), np.nan)
        guard = np.where(np.isfinite(media), np.rint(media * factor_guardado), 65535)
        exigir(float(np.nanmax(media)) * factor_guardado < 65535, f"{nombre}: valor fuera de uint16")
        nota = ("La etiqueta describe el producto como pendiente «a partir de un ajuste plano a tres disparos sucesivos» con "
                "base variable de 30 a 120 m, y en la descripción de la imagen cita «a baseline of 240 meters»: "
                "la propia etiqueta no es consistente; se toma como pendiente a escala de decenas–centenas de metros. "
                "Datos de 2009–2011 (hasta la fase LRO_SM_17)." if nombre == "ldsm_16" else
                "Desviación típica residual de alturas tras ajustar un plano a 5–15 retornos de tres disparos sucesivos "
                "(base 30–120 m). Datos de 2009–2011.")
        registrar_capa(ident, guard.astype("<u2"), dict(
            cuerpo="moon", variable=variable, nombre=titulo, unidades=unidad,
            archivo=f"lola_{descr}_8ppd.bin", escala=1 / factor_guardado, desplazamiento=0, sin_dato=65535, **GEO_8PPD,
            procesado=f"Valor físico = DN × {numero(et_s['IMAGE.SCALING_FACTOR'])} + {numero(et_s['IMAGE.OFFSET'])} "
                      f"(etiqueta); {falta} = sin dato. Media de las celdas válidas de cada bloque 2×2 de 1/16° → 1/8°. "
                      f"Guardado como entero = valor × {factor_guardado}.",
            nota=nota, fuente=_fuente_lola(et_s, nombre, descr)))
        print(f"  {descr}: celdas de 1/8° sin dato {100 * float((n == 0).mean()):.2f} %")


# --------------------------------------------------------------------------- Diviner
def construir_diviner() -> None:
    print("[Diviner] GCP 0,5° × 0,25 h → máx/mín/media de la curva diurna de temperatura bolométrica")
    NLAT, NLON, NH = 360, 720, 96
    tmax = np.full((NLAT, NLON), np.nan); tmin = np.full((NLAT, NLON), np.nan); tmed = np.full((NLAT, NLON), np.nan)
    nbin = np.zeros((NLAT, NLON), np.int32); hueco = np.full((NLAT, NLON), NH, np.int32)
    hmax = np.full((NLAT, NLON), 255, np.int32); hmin = np.full((NLAT, NLON), 255, np.int32)
    horas = (np.arange(NH) + 0.5) * 0.25                                   # centros de intervalo: 0,125 h … 23,875 h
    et0 = None
    for banda in BANDAS_DIVINER:
        base = f"global_cumul_avg_cyl_{banda}_002"
        et = leer_etiqueta_pds3(DATOS / "diviner_gcp" / f"{base}.lbl")
        et0 = et0 or et
        exigir(int(numero(et["TABLE.ROWS"])) == NLON * 20 * NH, f"{base}: nº de filas inesperado")
        a = np.loadtxt(DATOS / "diviner_gcp" / f"{base}.tab", delimiter=",", skiprows=1, usecols=(0, 1, 2, 10), dtype=np.float64)
        exigir(a.shape[0] == NLON * 20 * NH, f"{base}: filas leídas ≠ etiqueta")
        lon = a[:, 0].reshape(NLON, 20, NH); lat = a[:, 1].reshape(NLON, 20, NH); lt = a[:, 2].reshape(NLON, 20, NH)
        tb = a[:, 3].reshape(NLON, 20, NH)
        # la tabla va ordenada por longitud, latitud y hora local: se comprueba, no se presupone
        exigir(np.all(lon == lon[:, :1, :1]) and np.all(lat == lat[:1, :, :1]) and np.allclose(lt[0, 0], horas, atol=0.006),
               f"{base}: orden de filas inesperado")
        valido = tb > 0                                                    # −9999 = intervalo sin observaciones
        exigir(not np.any((tb <= 0) & (tb != -9999)), f"{base}: temperaturas bolométricas ≤ 0 inesperadas")
        fi = np.rint((89.75 - lat[0, :, 0]) / 0.5).astype(int)             # fila global (norte primero)
        cj = np.rint((lon[:, 0, 0] + 179.75) / 0.5).astype(int)            # columna global (−179,75°E primero)
        exigir(len(set(fi)) == 20 and len(set(cj)) == NLON, f"{base}: celdas repetidas")
        n = valido.sum(axis=2)
        mx = np.where(valido, tb, -np.inf); mn = np.where(valido, tb, np.inf)
        # hueco máximo (en intervalos de 0,25 h) entre dos intervalos con dato, tratando la hora local como cíclica
        inv2 = np.concatenate([~valido, ~valido], axis=2)
        racha = np.zeros((NLON, 20), np.int32); peor = np.zeros((NLON, 20), np.int32)
        for k in range(2 * NH):
            racha = (racha + 1) * inv2[:, :, k]
            np.maximum(peor, racha, out=peor)
        peor = np.minimum(peor, NH)
        # media de la curva diurna: integral de la poligonal periódica que une los intervalos con dato, dividida por 24 h
        media = np.full((NLON, 20), np.nan)
        for x in range(NLON):
            for y in range(20):
                idx = np.flatnonzero(valido[x, y])
                if idx.size >= 2:
                    t = horas[idx]; v = tb[x, y, idx]
                    dt = np.diff(np.append(t, t[0] + 24.0)); vm = (v + np.append(v[1:], v[0])) / 2
                    media[x, y] = float((vm * dt).sum() / 24.0)
        hay = n > 0
        for g, valores in ((tmax, np.where(hay, mx.max(axis=2), np.nan)), (tmin, np.where(hay, mn.min(axis=2), np.nan)), (tmed, media),
                           (nbin, n), (hueco, peor), (hmax, np.where(hay, mx.argmax(axis=2), 255)), (hmin, np.where(hay, mn.argmin(axis=2), 255))):
            g[np.ix_(fi, cj)] = valores.T
        print(f"  {banda}: intervalos con dato {100 * float(valido.mean()):.1f} % · Tbol {tb[valido].min():.1f}–{tb[valido].max():.1f} K")

    geo = dict(lat_centro_0=89.75, dlat=-0.5, lon_centro_0=-179.75, dlon=0.5, lon_ciclica=True, resolucion="0,5° (≈15 km en el ecuador)")
    fuente = {
        "mision": "Lunar Reconnaissance Orbiter · Diviner", "dataset": limpio(et0["DATA_SET_ID"]),
        "productos": ["GLOBAL_CUMUL_AVG_CYL_<banda>_002.TAB (18 bandas de 10° de latitud), columna tbol"],
        "urls": [f"{DIVINER}/data_derived_gcp/", f"{DIVINER}/label/dlre_gcp.fmt"],
        "md5_originales": {f"global_cumul_avg_cyl_{b}_002.tab": MD5_DIVINER[b] for b in BANDAS_DIVINER},
        "cita": "Williams, J.-P. et al. (2017), The global surface temperatures of the Moon as measured by the Diviner "
                "Lunar Radiometer Experiment, Icarus, 283, 300–325. Datos: LRO-L-DLRE-5-GCP-V1.0, NASA PDS.",
    }
    comun = ("Temperatura de brillo bolométrica media (tbol) de observaciones nadir 2009-07-05 → 2015-04-01, "
             "agrupada por la fuente en celdas de 0,5° y 96 intervalos de 0,25 h de hora local. ")
    aviso = ("Solo una parte de los 96 intervalos horarios tiene observaciones en cada celda (ver capa de nº de intervalos): "
             "la máxima y la mínima son las de los intervalos observados. A 0,5° no se resuelven sombras permanentes individuales.")
    k10 = lambda x: np.where(np.isfinite(x), np.rint(x * 10), -32768).astype("<i2")
    for ident, datos, var, nombre, proc in (
            ("moon_tmax", tmax, "temp_max", "Temperatura bolométrica máxima de la curva diurna", "Máximo de tbol entre los intervalos horarios con dato."),
            ("moon_tmin", tmin, "temp_min", "Temperatura bolométrica mínima de la curva diurna", "Mínimo de tbol entre los intervalos horarios con dato."),
            ("moon_tmedia", tmed, "temp_media", "Temperatura bolométrica media diurna",
             "Integral de la poligonal periódica que une los intervalos con dato (interpolación lineal en hora local) dividida por 24 h. "
             "Solo es representativa si el hueco máximo sin datos es pequeño (ver capa de hueco).")):
        registrar_capa(ident, k10(datos), dict(cuerpo="moon", variable=var, nombre=nombre, unidades="K", archivo=f"diviner_{var}_05deg.bin",
                                               escala=0.1, desplazamiento=0, sin_dato=-32768, **geo, procesado=comun + proc, nota=aviso, fuente=fuente))
    for ident, datos, var, nombre, unid, esc, sd, proc in (
            ("moon_t_nbins", nbin, "temp_n_intervalos", "Intervalos horarios con dato (de 96)", "intervalos", 1, None, "Número de intervalos de 0,25 h con tbol válido."),
            ("moon_t_hueco", hueco, "temp_hueco", "Mayor hueco sin datos en la curva diurna", "h", 0.25, None,
             "Mayor racha de intervalos consecutivos sin dato (hora local cíclica) × 0,25 h. 24 h = celda sin ninguna observación."),
            ("moon_t_hmax", hmax, "temp_hora_max", "Hora local de la temperatura máxima", "h", 1, 255, "Índice k del intervalo; hora local = (k + 0,5) × 0,25 h."),
            ("moon_t_hmin", hmin, "temp_hora_min", "Hora local de la temperatura mínima", "h", 1, 255, "Índice k del intervalo; hora local = (k + 0,5) × 0,25 h.")):
        registrar_capa(ident, datos.astype("u1"), dict(cuerpo="moon", variable=var, nombre=nombre, unidades=unid, archivo=f"diviner_{var}_05deg.bin",
                                                       escala=esc, desplazamiento=0, sin_dato=sd, **geo, procesado=comun + proc, fuente=fuente))
    print(f"  celdas sin ninguna observación: {int((nbin == 0).sum())} · mediana de intervalos con dato: {int(np.median(nbin))}/96 · "
          f"celdas con hueco ≤ 3 h: {100 * float((hueco <= 12).mean()):.1f} %")


# --------------------------------------------------------------------------- Lunar Prospector
def construir_lp() -> None:
    print("[Lunar Prospector] hidrógeno y FeO a 0,5° (productos especiales, no archivo PDS revisado por pares)")
    conv = lambda s: float("nan") if "*" in s else float(s)
    for nombre, ident, var, titulo, unidad, cita in (
            ("hydrogenhd", "moon_h", "hidrogeno", "Hidrógeno (espectrómetro de neutrones)", "ppm",
             "Feldman, W. C. et al. (2001), Evidence for water ice near the lunar poles, J. Geophys. Res., 106(E10), 23231–23251."),
            ("ironhd", "moon_feo", "feo", "Óxido de hierro FeO (espectrómetro gamma)", "% en peso",
             "Lawrence, D. J. et al. (2002), Iron abundances on the lunar surface as measured by the Lunar Prospector "
             "gamma-ray and neutron spectrometers, J. Geophys. Res., 107(E12), 5130.")):
        a = np.loadtxt(DATOS / "lp_special" / f"{nombre}.txt", delimiter=",", comments="#", dtype=np.float64, converters={4: conv})
        exigir(a.shape == (259200, 5), f"{nombre}: se esperaban 259200 filas × 5 columnas")
        # filas: sur → norte; columnas: −180° → +180°E (se comprueba con las propias coordenadas de la tabla)
        exigir(np.allclose(a[:, 0].reshape(360, 720)[:, 0], -90 + 0.5 * np.arange(360)) and
               np.allclose(a[:, 2].reshape(360, 720)[0], -180 + 0.5 * np.arange(720)), f"{nombre}: orden de celdas inesperado")
        rejilla = a[:, 4].reshape(360, 720)[::-1]                          # norte primero
        binario = np.fromfile(DATOS / "lp_special" / f"{nombre}.dat", dtype=">i2").reshape(360, 720)[::-1]
        ok = np.isfinite(rejilla)
        exigir(float(np.abs(binario[ok] - rejilla[ok] * 10).max()) <= 1.0, f"{nombre}: .txt y .dat no concuerdan")
        negativos = int((rejilla[ok] < 0).sum())
        nota = ("Producto especial del equipo de Lunar Prospector alojado en el PDS Geosciences Node: la propia página advierte de que "
                "NO es un archivo PDS revisado por pares.")
        if nombre == "hydrogenhd":
            nota += (f" Contiene {negativos} celdas con valor negativo (no físico) y 1 celda con desbordamiento de formato («***», se deja sin dato). "
                     "La fuente avisa: las abundancias «no son necesariamente fiables en regiones con mucho torio y tierras raras».")
        registrar_capa(ident, np.where(ok, rejilla, np.nan).astype("<f4"), dict(
            cuerpo="moon", variable=var, nombre=titulo, unidades=unidad, archivo=f"lp_{var}_05deg.bin", escala=1, desplazamiento=0, sin_dato=None,
            lat_centro_0=89.75, dlat=-0.5, lon_centro_0=-179.75, dlon=0.5, lon_ciclica=True, resolucion="0,5° (≈15 km); huella real del instrumento mayor",
            procesado="Copia de la tabla ASCII publicada (última columna), reordenada con el norte en la fila 0. "
                      "Se comprobó que coincide con la versión binaria .dat (valor × 10) con diferencia ≤ 1 unidad.",
            nota=nota,
            fuente={"mision": "Lunar Prospector · espectrómetros de neutrones y rayos gamma", "dataset": "Productos especiales (no archivo PDS)",
                    "productos": [f"{nombre}.txt", f"{nombre}.dat"],
                    "urls": [f"{LP}/{nombre}.txt", f"{LP}/{nombre}.dat", "https://pds-geosciences.wustl.edu/missions/lunarp/reduced_special.html"],
                    "md5_originales": {}, "cita": cita}))
        print(f"  {nombre}: {negativos} valores negativos · {int((~ok).sum())} sin dato")


PASOS = {"lola": construir_lola, "diviner": construir_diviner, "lp": construir_lp}

if __name__ == "__main__":
    elegidos = sys.argv[1:] or list(PASOS)
    for p in elegidos:
        if p not in PASOS:
            sys.exit(f"Paso desconocido: {p}. Opciones: {', '.join(PASOS)}")
    for p in elegidos:
        PASOS[p]()
