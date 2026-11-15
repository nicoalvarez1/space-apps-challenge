"""Comparación detallada entre una región objetivo (Luna o Marte) y una región candidata (Tierra).

La búsqueda global (similarity_engine) trabaja con la resolución del catálogo. Esta comparación de
un solo par usa en cada lado el MDE oficial más fino disponible y la máxima precisión que permiten
los datos. El algoritmo (METODOLOGIA.md §10):

1. Resolución base h₀ = máximo de los espaciados nativos de los dos MDE elegidos. Nunca se afina
   por debajo, para no crear precisión artificial.
2. Análisis MULTIESCALA: celdas h₀, 2h₀, 4h₀ y 8h₀ con el mismo lado físico L. Un relieve puede
   parecerse a 4 km y no a 500 m: se informa escala por escala.
3. En cada escala y variable (elevación relativa, pendiente, rugosidad, curvaturas):
   - W₁, KS y energía EXACTOS sobre todas las celdas (sin discretizar cuantiles).
   - Prueba de PERMUTACIÓN POR BLOQUES de la hipótesis «misma distribución»: los bloques (lado =
     radio de autocorrelación positiva) se reparten al azar entre las dos regiones y se recalcula
     W₁. Respeta la dependencia espacial: los píxeles no se tratan como independientes.
   - W₁ «esperable por azar»: mediana y percentil 95 de la distribución de permutación (dos trozos del
     mismo paisaje). Error típico de W₁ por bootstrap de bloques (Künsch 1989). No se da un IC
     percentil: para distancias está sesgado al alza y puede no contener el valor observado.
   - Corrección de Holm por comparaciones múltiples (todas las variables y escalas).
   - Tamaño del efecto: W₁ / rango intercuartílico del objetivo.
4. Estructura espacial en cada escala: variograma, I de Moran, Hurst, escala de correlación y
   anisotropía, comparados con la variabilidad del propio objetivo desplazado ±L/4.
5. Para la visualización: mapas de elevación relativa y pendiente de las dos regiones, funciones de
   distribución y variogramas.

Pruebas y bootstrap se calculan sobre una submalla regular (≤ MAX_MUESTRAS_PRUEBA celdas, determinista)
para que el coste sea razonable. W₁, KS y los estadísticos descriptivos usan todas las celdas.
"""
from __future__ import annotations

import math
import time
import warnings

import numpy as np

from . import config, data_catalog, referencias
from . import geomorphometry as gm
from . import preprocessing as pp
from . import spatial_analysis as sa
from . import statistical_distances as sd
from .data_loader import mejor_raster
from .similarity_engine import NOMBRE, VARS, _curvaturas, describir, huella, ventana_desplazada

MAX_CELDAS = 768            # celdas por lado en la escala más fina (memoria y tiempo)
N_ESCALAS = 4
PERMUTACIONES = 499         # p mínimo = 1/500: con Holm sobre 5 pruebas aún puede bajar de α = 0,05
REPLICAS_BOOT = 199
MAX_MUESTRAS_PRUEBA = 12_000
ALFA = 0.05
MIN_BLOQUES = 9            # con menos bloques independientes por región, no rechazar no es evidencia de igualdad
MAPA_PX = 192               # lado máximo de los mapas enviados a la web


def escalas(lado_km: float, h0: float, n: int = N_ESCALAS) -> tuple[list[float], list[float]]:
    usadas, omitidas, h = [], [], h0
    while len(usadas) < n:
        celdas = round(lado_km * 1000.0 / h)
        if celdas < config.MIN_CELDAS_LADO:
            break
        (usadas if celdas <= MAX_CELDAS else omitidas).append(h)
        h *= 2
    return usadas, omitidas


def _adelgazar(campo: np.ndarray) -> tuple[np.ndarray, int]:
    paso = max(1, math.ceil(math.sqrt(np.isfinite(campo).sum() / MAX_MUESTRAS_PRUEBA)))
    return campo[::paso, ::paso], paso


def _bloques(campo: np.ndarray, b: int) -> list[np.ndarray]:
    n0, n1 = campo.shape
    out = []
    for i in range(0, n0 - b + 1, b):
        for j in range(0, n1 - b + 1, b):
            x = campo[i:i + b, j:j + b].ravel()
            x = x[np.isfinite(x)]
            if x.size:
                out.append(x)
    return out


def prueba_bloques(fa: np.ndarray, fb: np.ndarray, rng: np.random.Generator, reps: int = PERMUTACIONES,
                   reps_boot: int = REPLICAS_BOOT) -> dict:
    """Permutación por bloques (H₀: misma distribución) e IC95 bootstrap de W₁, con dependencia espacial."""
    ta, pa = _adelgazar(fa)
    tb, pb = _adelgazar(fb)
    radio = max(sa.n_efectivo(ta)["radio_celdas"], sa.n_efectivo(tb)["radio_celdas"])
    b = int(np.clip(radio, 2, max(2, min(ta.shape[0], tb.shape[0]) // 4)))
    ba, bb = _bloques(ta, b), _bloques(tb, b)
    if len(ba) < 4 or len(bb) < 4:
        return {"omitida": "menos de 4 bloques por región"}
    cat = np.concatenate
    obs = sd.wasserstein(cat(ba), cat(bb))
    pool, na = ba + bb, len(ba)
    nulo = np.empty(reps)
    for r in range(reps):
        perm = rng.permutation(len(pool))
        nulo[r] = sd.wasserstein(cat([pool[k] for k in perm[:na]]), cat([pool[k] for k in perm[na:]]))
    boot = np.empty(reps_boot)
    for r in range(reps_boot):
        ia, ib = rng.integers(0, len(ba), len(ba)), rng.integers(0, len(bb), len(bb))
        boot[r] = sd.wasserstein(cat([ba[k] for k in ia]), cat([bb[k] for k in ib]))
    # No se da un IC percentil de W₁: con distribuciones parecidas el remuestreo con reemplazo sesga W₁ al alza
    # (medido: W₁ = 108 m con IC «95 %» [123, 764] m). Se informa el nulo de permutación y el error típico.
    return {"p_valor": float((1 + (nulo >= obs).sum()) / (reps + 1)),
            "w1_submalla": float(obs),
            "w1_azar_mediana": float(np.median(nulo)), "w1_azar_p95": float(np.percentile(nulo, 95)),
            "error_tipico_bootstrap": float(boot.std(ddof=1)), "sesgo_bootstrap": float(boot.mean() - obs),
            "bloque_celdas": b, "bloques": [len(ba), len(bb)], "submalla_paso": [pa, pb],
            "permutaciones": reps, "replicas_bootstrap": reps_boot}


def holm(pvalores: list[float]) -> list[float]:
    """Ajuste de Holm (1979) para comparaciones múltiples."""
    m = len(pvalores)
    orden = np.argsort(pvalores)
    ajust, previo = np.empty(m), 0.0
    for rango, i in enumerate(orden):
        previo = max(previo, min(1.0, (m - rango) * pvalores[i]))
        ajust[i] = previo
    return ajust.tolist()


def _reducir(campo: np.ndarray, px: int = MAPA_PX) -> list[list[float | None]]:
    f = max(1, math.ceil(campo.shape[0] / px))
    n = (campo.shape[0] // f) * f
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)          # bloques sin celdas válidas → NaN (borde)
        m = np.nanmean(campo[:n, :n].reshape(n // f, f, n // f, f), axis=(1, 3))
    return [[None if not np.isfinite(v) else round(float(v), 2) for v in fila] for fila in m]


def _cdf(x: np.ndarray, m: int = 101) -> list[float]:
    return np.quantile(x, np.linspace(0, 1, m)).round(6).tolist()


def comparar(cuerpo: str, lat: float, lon: float, lat_t: float, lon_t: float, lado_km: float = config.LADO_KM,
             producto: str | None = None, buscar_en: str = "earth") -> dict:
    t0 = time.time()
    r_obj = mejor_raster(cuerpo, lat, lon, lado_km, producto)
    r_can = mejor_raster(buscar_en, lat_t, lon_t, lado_km)
    h0 = pp.resolucion_comun_m(r_obj, r_can)
    hs, omitidas = escalas(lado_km, h0)
    if not hs:
        raise pp.VentanaInvalida("ninguna escala con 20–768 celdas por lado: cambia el lado de la ventana")
    rng = np.random.default_rng(config.SEMILLA)
    por_escala, pruebas, visual = [], [], None
    for h in hs:
        vo = pp.extraer_ventana(r_obj, lat, lon, lado_km, h)
        vc = pp.extraer_ventana(r_can, lat_t, lon_t, lado_km, h)
        if min(vo.cobertura, vc.cobertura) < config.MIN_COBERTURA:
            por_escala.append({"h_m": h, "omitida": f"cobertura {vo.cobertura:.1%} / {vc.cobertura:.1%}"})
            continue
        co, do = gm.campos(vo.z, h)
        cc, dc = gm.campos(vc.z, h)
        desc_o, desc_c = describir(co, do, h), describir(cc, dc, h)
        variables = {}
        for v in VARS:
            a, b = gm.valores(co[v]), gm.valores(cc[v])
            d_ks = sd.ks(a, b)
            na, nb = desc_o["n_efectivo"][v]["n_efectivo"], desc_c["n_efectivo"][v]["n_efectivo"]
            ric = desc_o["estadisticos"][v]["rango_intercuartilico"]
            w1 = sd.wasserstein(a, b)
            pr = prueba_bloques(co[v], cc[v], rng)
            variables[v] = {
                "nombre": NOMBRE[v], "unidades": gm.UNIDADES[v],
                "w1": w1, "ks": d_ks, "energia_1d": sd.energia(a, b),
                "ks_p_valor_n_efectivo": sd.ks_pvalor(d_ks, na, nb), "n_efectivo": [na, nb],
                "efecto_w1_sobre_ric_objetivo": (w1 / ric) if ric > 0 else None,
                "permutacion_bloques": pr,
                "objetivo": {k: desc_o["estadisticos"][v][k] for k in ("p05", "p25", "mediana", "p75", "p95", "desv_tipica")},
                "candidato": {k: desc_c["estadisticos"][v][k] for k in ("p05", "p25", "mediana", "p75", "p95", "desv_tipica")},
            }
            if "p_valor" in pr:
                pruebas.append((len(por_escala), v, pr["p_valor"]))
        # estructura: comparada con el objetivo desplazado ±L/4 a esta misma escala
        lg_o, lg_c = sa.log_variograma(co["elev_rel"], h), sa.log_variograma(cc["elev_rel"], h)
        ref_v, ref_m = [], []
        s = lado_km * config.DESPLAZAMIENTO_REF
        for dx, dy in ((s, 0), (-s, 0), (0, s), (0, -s)):
            la, lo = ventana_desplazada(r_obj, lat, lon, dx, dy)
            cd = gm.campos(pp.extraer_ventana(r_obj, la, lo, lado_km, h).z, h)[0]
            ref_v.append(float(sd.distancia_variograma(lg_o, sa.log_variograma(cd["elev_rel"], h))))
            ref_m.append(abs(sa.moran_i(co["pendiente"]) - sa.moran_i(cd["pendiente"])))
        d_v = float(sd.distancia_variograma(lg_o, lg_c))
        d_m = abs(desc_o["moran_pendiente"] - desc_c["moran_pendiente"])
        estructura = {
            "variograma": {"distancia": d_v, "factor_tipico": math.exp(d_v), "referencia_intrinseca": max(ref_v),
                           "dentro_de_variabilidad_del_objetivo": d_v <= max(ref_v)},
            "moran_pendiente": {"objetivo": desc_o["moran_pendiente"], "candidato": desc_c["moran_pendiente"],
                                "distancia": d_m, "referencia_intrinseca": max(ref_m),
                                "dentro_de_variabilidad_del_objetivo": d_m <= max(ref_m)},
            "hurst": [desc_o["hurst"].get("H"), desc_c["hurst"].get("H")],
            "longitud_correlacion_m": [desc_o["longitud_correlacion"].get("longitud_m"),
                                       desc_c["longitud_correlacion"].get("longitud_m")],
            "anisotropia": [desc_o["anisotropia"].get("razon"), desc_c["anisotropia"].get("razon")],
            "energia_curvaturas_1_km": sd.energia(_curvaturas(co), _curvaturas(cc)),
        }
        por_escala.append({"h_m": h, "celdas_por_lado": vo.n, "ventana_objetivo": vo.resumen(),
                           "ventana_candidata": vc.resumen(), "variables": variables, "estructura": estructura})
        if visual is None:                                   # la escala más fina con datos
            visual = {
                "h_m": h, "lado_km": vo.lado_m / 1000.0,
                "mapas": {c: {"objetivo": _reducir(co[c]), "candidato": _reducir(cc[c])} for c in ("elev_rel", "pendiente")},
                "celda_mapa_m": vo.lado_m / len(_reducir(co["elev_rel"])),
                "cdf": {v: {"objetivo": _cdf(gm.valores(co[v])), "candidato": _cdf(gm.valores(cc[v])),
                            "unidades": gm.UNIDADES[v], "nombre": NOMBRE[v]} for v in VARS},
                "variograma": {"objetivo": desc_o["variograma"], "candidato": desc_c["variograma"]},
            }

    # Holm dentro de cada escala (familia = «¿son compatibles a la escala h?», 5 pruebas). Se rechaza si p ≤ α.
    for i in {i for i, _, _ in pruebas}:
        fam = [(v, p) for j, v, p in pruebas if j == i]
        for (v, _), pa in zip(fam, holm([p for _, p in fam])):
            x = por_escala[i]["variables"][v]
            x["permutacion_bloques"]["p_valor_holm"] = pa
            pocos = min(x["permutacion_bloques"]["bloques"]) < MIN_BLOQUES
            x["veredicto"] = "distintas" if pa <= ALFA else ("no_concluyente" if pocos else "compatibles")
    resumen = []
    for e in por_escala:
        if "variables" not in e:
            continue
        comp = [v for v, x in e["variables"].items() if x.get("veredicto") == "compatibles"]
        est = [k for k in ("variograma", "moran_pendiente") if e["estructura"][k]["dentro_de_variabilidad_del_objetivo"]]
        resumen.append({"h_m": e["h_m"], "distribuciones_compatibles": comp, "n_distribuciones": len(VARS),
                        "estructura_dentro_de_variabilidad": est})
    return {
        "tipo": "comparación detallada de un par (semejanza geomorfológica)",
        "objetivo": {"cuerpo": cuerpo, "lat": lat, "lon": lon, "datos": r_obj.resumen(),
                     "huella": huella(lat, lon, lado_km, r_obj.radio_local_m(lat))},
        "candidato": {"cuerpo": buscar_en, "lat": lat_t, "lon": ((lon_t + 180) % 360) - 180, "datos": r_can.resumen(),
                      "huella": huella(lat_t, lon_t, lado_km, r_can.radio_local_m(lat_t))},
        "parametros": {"lado_km": lado_km, "h0_m": h0, "escalas_m": hs,
                       "escalas_omitidas_m": omitidas, "max_celdas_por_lado": MAX_CELDAS,
                       "alfa": ALFA, "correccion": "Holm (1979) dentro de cada escala (5 pruebas); se rechaza si p ≤ α",
                       "permutaciones": PERMUTACIONES, "replicas_bootstrap": REPLICAS_BOOT,
                       "max_muestras_prueba": MAX_MUESTRAS_PRUEBA, "semilla": config.SEMILLA},
        "precision": {
            "resolucion_nativa_m": {"objetivo": r_obj.espaciado_nativo_m(), "candidato": r_can.espaciado_nativo_m()},
            "limita": "objetivo" if r_obj.espaciado_nativo_m() >= r_can.espaciado_nativo_m() else "candidato",
            "nota": ("h₀ es el espaciado del MDE más grueso de los dos: por debajo de h₀ no hay información común. "
                     "Para afinar en la Tierra: `python -m similitud descargar-detalle` (SRTMGL3 de 90 m o NASADEM "
                     "de 30 m, Earthdata Login)."),
        },
        "escalas": por_escala,
        "resumen_por_escala": resumen,
        "visual": visual,
        "referencias": {
            "datos": list(dict.fromkeys(data_catalog.FUENTES[r_obj.fuente]["citas"]
                                        + data_catalog.FUENTES[r_can.fuente]["citas"])),
            "metodos": referencias.lista(["snyder1987", "evans1979", "florinsky2016", "vallender1974", "stephens1970",
                                          "bretherton1999", "kunsch1989", "holm1979", "marcotte1996", "moran1950",
                                          "shepard2001", "szekely2013"]),
        },
        "limitaciones": [
            "Semejanza geomorfológica a escalas ≥ h₀; no dice nada de materiales, origen, ambiente ni aptitud para una misión.",
            "Las pruebas usan una submalla regular y bloques del tamaño del radio de autocorrelación; un bloque menor "
            "subestimaría la dependencia espacial y produciría p-valores demasiado pequeños.",
            "«Compatibles» significa que no se rechaza la igualdad de distribuciones con estos datos; no demuestra que sean iguales.",
            "La exactitud vertical de cada MDE (no siempre publicada como cifra única) limita sobre todo la rugosidad y "
            "las curvaturas a la escala más fina.",
        ],
        "segundos": round(time.time() - t0, 1),
    }
