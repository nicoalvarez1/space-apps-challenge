"""Validación del ranking (METODOLOGIA.md §7).

Cada prueba recalcula las distancias entre el objetivo y la LISTA CORTA de candidatos bajo una
perturbación, ordena con el mismo método (percentiles dentro de la lista → leximax) y compara con el
orden de referencia mediante la τ de Kendall y la fracción del top-k que se conserva.

Limitación declarada: la estabilidad se mide dentro de la lista corta; una perturbación podría
favorecer a ventanas que no estaban en ella.
"""
from __future__ import annotations

import math

import numpy as np
from scipy import stats

from . import config
from . import geomorphometry as gm
from . import preprocessing as pp
from . import spatial_analysis as sa
from . import statistical_distances as sd
from .similarity_engine import CRITERIOS, VARS, Firma, distancias, firma_de_campos, orden_leximax, percentiles


def _rangos(d: np.ndarray) -> np.ndarray:
    orden = orden_leximax(percentiles(d))
    r = np.empty(len(orden), int)
    r[orden] = np.arange(len(orden))
    return r


def _comparar(r0: np.ndarray, r1: np.ndarray, k: int) -> dict:
    tau = stats.kendalltau(r0, r1).statistic
    top0, top1 = set(np.argsort(r0)[:k]), set(np.argsort(r1)[:k])
    return {"tau_kendall": None if tau is None or math.isnan(tau) else float(tau),
            "top_k_conservado": len(top0 & top1) / k}


def _firma(r, la, lo, lado, h, transformar=None):
    v = pp.extraer_ventana(r, la, lo, lado, h)
    z = transformar(v.z) if transformar else v.z
    return firma_de_campos(gm.campos(z, h)[0], h)


def _matriz(f_obj: Firma, firmas: list[Firma]) -> np.ndarray:
    return np.vstack([distancias(f_obj, f.q[None], f.lg[None], np.array([f.moran]))[0] for f in firmas])


def _prueba(nombre, r_obj, r_bus, lat, lon, centros, lado, h, r0, k, t_obj=None, t_cand=None, r_obj_alt=None):
    try:
        f_obj = _firma(r_obj_alt or r_obj, lat, lon, lado, h, t_obj)
        firmas = [_firma(r_bus, la, lo, lado, h, t_cand) for la, lo in centros]
    except pp.VentanaInvalida as e:
        return {"prueba": nombre, "omitida": str(e)}
    if f_obj is None or any(f is None for f in firmas):
        return {"prueba": nombre, "omitida": "not enough samples after the perturbation"}
    return {"prueba": nombre, **_comparar(r0, _rangos(_matriz(f_obj, firmas)), k)}


def _huecos(fraccion: float, semilla: int):
    """Enmascara bloques de 3×3 celdas elegidos al azar (semilla fija) hasta cubrir `fraccion`."""
    def f(z):
        rng = np.random.default_rng(semilla)
        z = z.copy()
        n = z.shape[0]
        objetivo = int(fraccion * n * n)
        while np.isnan(z).sum() < objetivo:
            i, j = rng.integers(0, n - 2, size=2)
            z[i:i + 3, j:j + 3] = np.nan
        return z
    return f


def _ruido(sigma: float, semilla: int):
    def f(z):
        return z + np.random.default_rng(semilla).normal(0.0, sigma, z.shape)
    return f


def validar(r_obj, r_bus, lat, lon, lado, h, centros, k, campos_obj, campos_lista, rep_bootstrap: int = 50) -> dict:
    k = min(k, len(centros))
    f_obj = firma_de_campos(campos_obj, h)
    firmas0 = [firma_de_campos(c, h) for c in campos_lista]
    d0 = _matriz(f_obj, firmas0)
    r0 = _rangos(d0)
    pruebas = []

    # resolución y tamaño de ventana
    pruebas.append(_prueba("cell size h×2", r_obj, r_bus, lat, lon, centros, lado, 2 * h, r0, k))
    for fct in (0.75, 1.25):
        pruebas.append(_prueba(f"window L×{fct}", r_obj, r_bus, lat, lon, centros, lado * fct, h, r0, k))
    # incertidumbre vertical (σ de prueba, no exactitud publicada)
    for i, s in enumerate((1.0, 5.0, 20.0)):
        pruebas.append(_prueba(f"vertical noise σ = {s:g} m", r_obj, r_bus, lat, lon, centros, lado, h, r0, k,
                               t_obj=_ruido(s, config.SEMILLA + i), t_cand=_ruido(s, config.SEMILLA + 100 + i)))
    # cobertura incompleta del objetivo
    for fr in (0.10, 0.25):
        pruebas.append(_prueba(f"{fr:.0%} gaps in the target", r_obj, r_bus, lat, lon, centros, lado, h, r0, k,
                               t_obj=_huecos(fr, config.SEMILLA)))
    # referencia vertical (Marte: areoide frente a esfera)
    if r_obj.cuerpo == "mars":
        from .data_loader import cargar_mola
        try:
            alt = cargar_mola("esfera")
            p = _prueba("vertical reference: 3396 km sphere instead of areoid", r_obj, r_bus, lat, lon, centros,
                        lado, h, r0, k, r_obj_alt=alt)
            f_esf = _firma(alt, lat, lon, lado, h)
            p["distancia_objetivo_areoide_vs_esfera"] = dict(zip(CRITERIOS, map(float, _matriz(f_obj, [f_esf])[0])))
            pruebas.append(p)
        except Exception as e:  # noqa: BLE001  (falta MEGR: se informa, no se oculta)
            pruebas.append({"prueba": "vertical reference", "omitida": str(e)})

    # normalización: solo forma (distribuciones tipificadas y variograma / varianza)
    def firma_tipificada(c):
        q = np.array([sd.cuantiles(sd.tipificar(gm.valores(c[v])), config.N_CUANTILES) for v in VARS])
        var = np.nanvar(c["elev_rel"])
        return Firma(q, sa.log_variograma(c["elev_rel"], h) - math.log(var if var > 0 else 1.0), sa.moran_i(c["pendiente"]))
    d_tip = _matriz(firma_tipificada(campos_obj), [firma_tipificada(c) for c in campos_lista])
    pruebas.append({"prueba": "normalization: standardized distributions (shape only)", **_comparar(r0, _rangos(d_tip), k)})

    # métrica alternativa para las distribuciones
    for nombre, fn in (("KS", sd.ks), ("1-D energy", sd.energia)):
        d_alt = d0.copy()
        for j, v in enumerate(VARS):
            a = gm.valores(campos_obj[v])
            d_alt[:, j] = [fn(a, gm.valores(c[v])) for c in campos_lista]
        pruebas.append({"prueba": f"metric: {nombre} instead of W₁", **_comparar(r0, _rangos(d_alt), k)})

    # bootstrap de bloques sobre los campos del objetivo (incertidumbre muestral con autocorrelación)
    lc = sa.longitud_correlacion(campos_obj["elev_rel"], h)
    radio = max(sa.n_efectivo(campos_obj["pendiente"])["radio_celdas"], 2)
    b = int(max(2, radio))
    n = campos_obj["elev_rel"].shape[0]
    nb = n // b
    rng = np.random.default_rng(config.SEMILLA)
    en_top = np.zeros(len(centros))
    for _ in range(rep_bootstrap):
        bi, bj = rng.integers(0, nb, size=(2, nb * nb))
        q = []
        for v in VARS:
            bloques = [campos_obj[v][i * b:(i + 1) * b, j * b:(j + 1) * b].ravel() for i, j in zip(bi, bj)]
            x = np.concatenate(bloques)
            q.append(sd.cuantiles(x[np.isfinite(x)], config.N_CUANTILES))
        d_b = d0.copy()
        d_b[:, :len(VARS)] = _matriz(Firma(np.array(q), f_obj.lg, f_obj.moran), firmas0)[:, :len(VARS)]
        en_top[np.argsort(_rangos(d_b))[:k]] += 1
    bootstrap = {"replicas": rep_bootstrap, "bloque_celdas": b, "semilla": config.SEMILLA,
                 "frecuencia_en_top_k_por_rango_original": [float(en_top[i] / rep_bootstrap) for i in np.argsort(r0)],
                 "nota": "block resampling of the target (block = radius of positive autocorrelation of slope)"}

    dependencia = {v: {"n_pixeles": sa.n_efectivo(campos_obj[v])["n"],
                       "n_efectivo": round(sa.n_efectivo(campos_obj[v])["n_efectivo"], 1)} for v in VARS}
    taus = [p["tau_kendall"] for p in pruebas if p.get("tau_kendall") is not None]
    return {"pruebas": pruebas, "bootstrap_bloques": bootstrap,
            "dependencia_espacial_objetivo": dependencia, "longitud_correlacion_objetivo": lc,
            "resumen": {"tau_kendall_min": min(taus) if taus else None,
                        "tau_kendall_mediana": float(np.median(taus)) if taus else None},
            "ambito": f"short list of {len(centros)} candidates; top-k = {k}"}
