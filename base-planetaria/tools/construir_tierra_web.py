"""Ventanas de relieve terrestre (NASA SRTMGL30) y de agua (SRTMSWBD) para los análogos de entrenamiento de la web.

Genera en base-planetaria/web/data/tierra/:
  srtm_<id>.bin  int16 little-endian, n×n, v[py*n+px] (py = 0 al norte), sin dato = −32768 (m, geoide EGM96)
  agua_<id>.bin  uint8, misma geometría: 1 = agua, 0 = tierra, 255 = sin dato (fuera de la máscara SRTMSWBD)
  indice.json    fuentes, geometría y estadísticas de cada ventana

Geometría (igual que ventana() de js/analitica.js): proyección azimutal equidistante centrada en el análogo, norte
arriba y este a la derecha; píxel (px, py) a x = (px + 0,5 − n/2)·km_px km al este e y = (n/2 − py − 0,5)·km_px km al
norte; su punto es el destino por acimut atan2(x, y) y distancia hypot(x, y) sobre la esfera de 6371,0088 km.

Muestreo del relieve: bilineal entre los cuatro centros de celda vecinos; si falta alguno (sin dato o fuera del
mosaico), la celda más cercana. Agua: la fracción de agua de SRTMSWBD agregada a 30″ (cache del motor) se interpola
igual y se clasifica con el umbral del motor (data_loader.UMBRAL_AGUA: agua si fracción > 0,5); donde la celda más
cercana no tiene máscara (al norte de 60°N, al sur de 56°S o tesela sin gránulo) vale 255.

Estadísticas sobre «tierra»: con máscara, agua = 0; sin máscara, la regla del motor (REGLA_SIN_MASCARA: la celda
más cercana a 0 m es sin dato, porque el mar viene como 0 m).

Uso:  .venv/bin/python base-planetaria/tools/construir_tierra_web.py
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sys
from pathlib import Path

import numpy as np

RAIZ = Path(__file__).resolve().parents[2]
BASE = RAIZ / "base-planetaria"
CACHE = BASE / "similitud" / "cache"
SALIDA = BASE / "web" / "data" / "tierra"
DATA_JS = RAIZ / "js" / "data.js"

sys.path.insert(0, str(BASE / "similitud"))
import data_catalog  # noqa: E402  (solo para las citas de las fuentes)

R_TIERRA_KM = 6371.0088
RADIO_KM = 300.0
N = 400
SIN_DATO = -32768
UMBRAL_AGUA = 0.5            # = similitud.data_loader.UMBRAL_AGUA
FUERA_COBERTURA_SWBD, SIN_TESELA_SWBD = 65535, 65534


def leer_analogos(ruta: Path) -> list[dict]:
    txt = ruta.read_text(encoding="utf-8")
    ini = txt.index("export const ANALOGS")
    bloque = txt[ini:]
    patron = re.compile(r"id:\s*'([^']+)',\s*name:\s*'((?:[^'\\]|\\.)*)'.*?lat:\s*(-?[\d.]+),\s*lon:\s*(-?[\d.]+)", re.S)
    out = []
    for m in patron.finditer(bloque):
        out.append({"id": m.group(1), "nombre": m.group(2).replace("\\'", "'"),
                    "lat": float(m.group(3)), "lon": float(m.group(4))})
    return out


def destino(lat, lon, az, d_km, R=R_TIERRA_KM):
    """Punto de destino por acimut (rad) y distancia; mismo cálculo que destino() de js/analitica.js."""
    d = d_km / R
    la = np.radians(lat)
    sen2 = np.clip(np.sin(la) * np.cos(d) + np.cos(la) * np.sin(d) * np.cos(az), -1, 1)
    lo2 = np.radians(lon) + np.arctan2(np.sin(az) * np.sin(d) * np.cos(la), np.cos(d) - np.sin(la) * sen2)
    lon2 = (((np.degrees(lo2) + 180) % 360) + 360) % 360 - 180
    return np.degrees(np.arcsin(sen2)), lon2


def malla(lat, lon, radio_km=RADIO_KM, n=N):
    km = 2 * radio_km / n
    k = np.arange(n)
    y = (n / 2 - k - 0.5) * km                  # fila py → km al norte
    x = (k + 0.5 - n / 2) * km                  # columna px → km al este
    X, Y = np.meshgrid(x, y)
    return destino(lat, lon, np.arctan2(X, Y), np.hypot(X, Y)), km


class Rejilla:
    def __init__(self, meta):
        self.f, self.c = meta["filas"], meta["columnas"]
        self.lat0, self.lon0, self.paso = meta["lat0"], meta["lon0"], meta["paso"]

    def posicion(self, la, lo):
        fi = (self.lat0 - la) / self.paso
        fj = ((lo - self.lon0) % 360.0) / self.paso
        return fi, fj

    def vecinos(self, la, lo):
        fi, fj = self.posicion(la, lo)
        i0, j0 = np.floor(fi).astype(np.int64), np.floor(fj).astype(np.int64)
        return fi, fj, i0, j0

    def cercana(self, la, lo):
        fi, fj = self.posicion(la, lo)
        i = np.rint(fi).astype(np.int64)
        j = np.rint(fj).astype(np.int64) % self.c
        dentro = (i >= 0) & (i < self.f)
        return np.clip(i, 0, self.f - 1), j, dentro


def muestrear(arr, rj: Rejilla, la, lo, valido_fn, transf=lambda v: v.astype(np.float64)):
    """Bilineal si los 4 vecinos son válidos; si no, la celda más cercana. Devuelve (valor float, ok_bilineal, cruda_cercana)."""
    fi, fj, i0, j0 = rj.vecinos(la, lo)
    ti, tj = fi - i0, fj - j0
    acum = np.zeros(la.shape)
    todos = np.ones(la.shape, bool)
    for di in (0, 1):
        for dj in (0, 1):
            i = i0 + di
            j = (j0 + dj) % rj.c
            dentro = (i >= 0) & (i < rj.f)
            v = arr[np.clip(i, 0, rj.f - 1), j]
            ok = dentro & valido_fn(v)
            todos &= ok
            w = (ti if di else 1 - ti) * (tj if dj else 1 - tj)
            acum += np.where(ok, transf(v), 0.0) * w
    ic, jc, dentro_c = rj.cercana(la, lo)
    cruda = arr[ic, jc]
    return acum, todos, cruda, dentro_c


def ventana_elev(dem, rj, la, lo):
    acum, todos, cruda, dentro = muestrear(dem, rj, la, lo, lambda v: v != SIN_DATO)
    cruda = np.where(dentro, cruda, SIN_DATO).astype(np.int32)
    val = np.where(todos, np.rint(acum), cruda)
    return val.astype(np.int16), cruda


def ventana_agua(cuentas, ppc, rj, la, lo):
    con_masc = lambda v: v <= ppc
    acum, todos, cruda, dentro = muestrear(cuentas, rj, la, lo, con_masc, lambda v: v.astype(np.float64) / ppc)
    frac_c = cruda.astype(np.float64) / ppc
    frac = np.where(todos, acum, frac_c)
    tiene = todos | (dentro & (cruda <= ppc))
    out = np.full(la.shape, 255, np.uint8)
    out[tiene] = (frac[tiene] > UMBRAL_AGUA).astype(np.uint8)
    return out, cruda


def pendiente(z, valido, km_px):
    """Pendiente (grados) por diferencias centrales; NaN donde falta un vecino o en el borde."""
    zf = np.where(valido, z.astype(np.float64), np.nan)
    h = 2 * km_px * 1000.0
    dzdx = np.full(z.shape, np.nan)
    dzdy = np.full(z.shape, np.nan)
    dzdx[:, 1:-1] = (zf[:, 2:] - zf[:, :-2]) / h
    dzdy[1:-1, :] = (zf[:-2, :] - zf[2:, :]) / h
    return np.degrees(np.arctan(np.hypot(dzdx, dzdy)))


def red(x, nd=2):
    return None if x is None or not np.isfinite(x) else round(float(x), nd)


def main():
    meta_dem = json.loads((CACHE / "srtmgl30_mosaico_i2le.json").read_text())
    meta_agua = json.loads((CACHE / "srtmswbd_agua30s_u2le.json").read_text())
    for k in ("filas", "columnas", "lat0", "lon0", "paso"):
        assert meta_dem[k] == meta_agua[k], f"geometría distinta: {k}"
    rj = Rejilla(meta_dem)
    dem = np.memmap(CACHE / "srtmgl30_mosaico_i2le.bin", dtype="<i2", mode="r", shape=(rj.f, rj.c))
    cuentas = np.memmap(CACHE / "srtmswbd_agua30s_u2le.bin", dtype="<u2", mode="r", shape=(rj.f, rj.c))
    ppc = int(meta_agua["pixeles_por_celda"])

    analogos = leer_analogos(DATA_JS)
    assert analogos, "no se encontraron análogos en js/data.js"
    SALIDA.mkdir(parents=True, exist_ok=True)

    f_dem, f_agua = data_catalog.fuente("srtmgl30"), data_catalog.fuente("srtmswbd")
    indice = {
        "esquema": "landfall-tierra-ventanas/1",
        "generado": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "fuente": {
            "relieve": {"mision": "Shuttle Radar Topography Mission (SRTM), NASA / NGA", "dataset": f_dem["nombre"],
                        "doi": f_dem["doi"], "cita": f_dem["citas"][0], "cmr": f_dem["cmr"],
                        "resolucion": f_dem["resolucion"], "referencia_vertical": f_dem["referencia_vertical"],
                        "incertidumbre": f_dem["incertidumbre"], "cobertura": f_dem["cobertura"],
                        "archivo_motor": "similitud/cache/srtmgl30_mosaico_i2le.bin"},
            "agua": {"mision": "Shuttle Radar Topography Mission (SRTM), NASA JPL / NGA", "dataset": f_agua["nombre"],
                     "doi": f_agua["doi"], "cita": f_agua["citas"][0], "cmr": f_agua["cmr"],
                     "resolucion": f_agua["resolucion"], "cobertura": f_agua["cobertura"],
                     "archivo_motor": "similitud/cache/srtmswbd_agua30s_u2le.bin (fracción de agua por celda de 30″)",
                     "clasificacion": (f"agua si la fracción de agua interpolada > {UMBRAL_AGUA} (umbral del motor, "
                                       "data_loader.UMBRAL_AGUA); 255 donde la celda más cercana no tiene máscara")},
        },
        "proyeccion": {
            "tipo": "azimutal equidistante centrada en el análogo (esfera), norte arriba, este a la derecha",
            "referencia": "Snyder, J. P. (1987). Map Projections — A Working Manual. USGS Professional Paper 1395. https://doi.org/10.3133/pp1395",
            "orden": "v[py*n + px]; py = 0 al norte",
            "pixel": "x = (px + 0.5 - n/2)·km_px km al este, y = (n/2 - py - 0.5)·km_px km al norte; punto = destino por acimut atan2(x, y) y distancia hypot(x, y)",
            "muestreo_relieve": "bilineal entre los 4 centros de celda vecinos; la celda más cercana si falta alguno",
            "muestreo_agua": "fracción de agua bilineal (más cercana si falta algún vecino con máscara) y umbral",
        },
        "radio_km_tierra": R_TIERRA_KM,
        "tierra_para_estadisticas": ("con máscara: agua = 0; sin máscara (agua = 255): celda más cercana con dato y "
                                     "≠ 0 m (regla del motor, el mar viene como 0 m en SRTMGL30)"),
        "pendiente": "diferencias centrales en la rejilla de la ventana (paso km_px), píxeles de tierra con los 4 vecinos con dato; sin bordes",
        "analogos": {},
    }

    for a in analogos:
        (la, lo), km = malla(a["lat"], a["lon"])
        z, z_cerc = ventana_elev(dem, rj, la, lo)
        agua, _ = ventana_agua(cuentas, ppc, rj, la, lo)
        con_dato = z != SIN_DATO
        tierra = con_dato & ((agua == 0) | ((agua == 255) & (z_cerc != 0)))
        es_agua = con_dato & ((agua == 1) | ((agua == 255) & (z_cerc == 0)))
        (SALIDA / f"srtm_{a['id']}.bin").write_bytes(z.astype("<i2").tobytes())
        (SALIDA / f"agua_{a['id']}.bin").write_bytes(agua.astype(np.uint8).tobytes())

        zt = z[tierra].astype(np.float64)
        s = pendiente(z, con_dato, km)[tierra]
        s = s[np.isfinite(s)]
        nd = int(con_dato.sum())
        ent = {
            "nombre": a["nombre"], "lat": a["lat"], "lon": a["lon"],
            "archivo": f"srtm_{a['id']}.bin", "agua": f"agua_{a['id']}.bin",
            "n": N, "radio_km": RADIO_KM, "km_px": km, "tipo": "int16", "orden_bytes": "little-endian",
            "sin_dato": SIN_DATO,
            "min": int(z[con_dato].min()) if nd else None, "max": int(z[con_dato].max()) if nd else None,
            "media_tierra": red(zt.mean(), 1) if zt.size else None,
            "pendiente_media_grados": red(s.mean()) if s.size else None,
            "pendiente_p90_grados": red(np.percentile(s, 90)) if s.size else None,
            "desnivel_m": red(np.percentile(zt, 98) - np.percentile(zt, 2), 0) if zt.size else None,
            "frac_agua": red(es_agua.sum() / nd, 4) if nd else None,
            "frac_con_dato": round(nd / z.size, 4),
            "frac_sin_mascara_agua": round(float((agua == 255).mean()), 4),
        }
        if nd == 0:
            ent["nota"] = "Fuera de la cobertura de SRTMGL30 (90°N–60°S): la ventana no tiene datos."
        elif ent["frac_sin_mascara_agua"] > 0:
            ent["nota"] = ("Parte de la ventana sin máscara SRTMSWBD (fuera de 60°N–56°S o tesela sin gránulo en CMR): "
                           "ahí el agua se deduce como en el motor (0 m = mar) solo para las estadísticas; en "
                           "agua_*.bin vale 255.")
        indice["analogos"][a["id"]] = ent
        print(f"{a['id']:10s} dato {ent['frac_con_dato']:.3f} agua {ent['frac_agua']} min {ent['min']} max {ent['max']} "
              f"pend {ent['pendiente_media_grados']}/{ent['pendiente_p90_grados']} desn {ent['desnivel_m']}")

    (SALIDA / "indice.json").write_text(json.dumps(indice, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(analogos)} análogos → {SALIDA}")


if __name__ == "__main__":
    main()
