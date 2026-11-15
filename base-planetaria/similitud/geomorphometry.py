"""Variables geomorfométricas locales sobre una rejilla métrica regular de paso h.

Derivadas por el polinomio de segundo grado ajustado por mínimos cuadrados a la vecindad 3×3
(Evans 1979; Young 1978; formulación en Florinsky 2016, cap. 4). Vecinos:

    z1 z2 z3        x crece hacia el este (columnas), y hacia el norte (filas hacia arriba)
    z4 z5 z6
    z7 z8 z9

    p = ∂z/∂x  = (z3 + z6 + z9 − z1 − z4 − z7) / 6h
    q = ∂z/∂y  = (z1 + z2 + z3 − z7 − z8 − z9) / 6h
    r = ∂²z/∂x² = (z1 + z3 + z4 + z6 + z7 + z9 − 2(z2 + z5 + z8)) / 3h²
    t = ∂²z/∂y² = (z1 + z2 + z3 + z7 + z8 + z9 − 2(z4 + z5 + z6)) / 3h²
    s = ∂²z/∂x∂y = (z3 + z7 − z1 − z9) / 4h²

Curvaturas (Florinsky 2016, tabla 2.1; convención: positivo = convexo / divergente):
    k_v (perfil)  = −(p²r + 2pqs + q²t) / [(p²+q²)(1+p²+q²)^{3/2}]
    k_h (planta)  = −(q²r − 2pqs + p²t) / [(p²+q²)(1+p²+q²)^{1/2}]
    H   (media)   = −[(1+q²)r − 2pqs + (1+p²)t] / [2(1+p²+q²)^{3/2}]
k_v y k_h no están definidas donde el gradiente es nulo (se dejan como NaN y se contabilizan).

Rugosidad: raíz cuadrática media de los residuos del plano ajustado por mínimos cuadrados a la
vecindad 3×3. Con regresores 1, x, y ortogonales en la rejilla 3×3 (Σx² = Σy² = 6h²):
    RSS = Σ(zᵢ − z̄)² − 6h²(p² + q²),   rugosidad = √(RSS / 9)
Al quitar el plano, la rugosidad no repite la información de la pendiente.

Todas las magnitudes dependen de la escala h: solo son comparables entre ventanas con el mismo h.
"""
from __future__ import annotations

import numpy as np

from .preprocessing import quitar_plano

UMBRAL_GRADIENTE2 = 1e-12      # |∇z|² por debajo del cual k_v y k_h son numéricamente indefinidas
UMBRAL_PLANO_GRADOS = 0.01     # celdas "planas": candidatas a superficie de agua o interpolación

UNIDADES = {
    "elev_rel": "m", "pendiente": "°", "rugosidad": "m",
    "curv_perfil": "1/km", "curv_planta": "1/km", "curv_media": "1/km", "relieve_local": "m",
}
DESCRIPCION = {
    "elev_rel": "altura relativa: residuo tras quitar el plano de mínimos cuadrados de la ventana",
    "pendiente": "pendiente (polinomio de Evans–Young, vecindad 3×3)",
    "rugosidad": "RMS de residuos del plano local 3×3",
    "curv_perfil": "curvatura de perfil k_v (positivo = convexo)",
    "curv_planta": "curvatura de planta k_h (positivo = divergente)",
    "curv_media": "curvatura media (general) H (positivo = convexo)",
    "relieve_local": "relieve local: máximo − mínimo en la vecindad 3×3",
}


def _vecinos(z: np.ndarray):
    return (z[:-2, :-2], z[:-2, 1:-1], z[:-2, 2:],
            z[1:-1, :-2], z[1:-1, 1:-1], z[1:-1, 2:],
            z[2:, :-2], z[2:, 1:-1], z[2:, 2:])


def _rellenar_borde(interior: np.ndarray) -> np.ndarray:
    out = np.full((interior.shape[0] + 2, interior.shape[1] + 2), np.nan)
    out[1:-1, 1:-1] = interior
    return out


def derivadas(z: np.ndarray, h: float) -> dict[str, np.ndarray]:
    """p, q, r, t, s en el interior (las celdas con algún vecino NaN quedan NaN)."""
    z1, z2, z3, z4, z5, z6, z7, z8, z9 = _vecinos(z)
    return {
        "p": (z3 + z6 + z9 - z1 - z4 - z7) / (6 * h),
        "q": (z1 + z2 + z3 - z7 - z8 - z9) / (6 * h),
        "r": (z1 + z3 + z4 + z6 + z7 + z9 - 2 * (z2 + z5 + z8)) / (3 * h * h),
        "t": (z1 + z2 + z3 + z7 + z8 + z9 - 2 * (z4 + z5 + z6)) / (3 * h * h),
        "s": (z3 + z7 - z1 - z9) / (4 * h * h),
    }


def campos(z: np.ndarray, h: float) -> tuple[dict[str, np.ndarray], dict]:
    """Calcula todos los campos (n×n, NaN en bordes e inválidos) y diagnósticos."""
    zr, plano = quitar_plano(z, h)
    d = derivadas(z, h)
    p, q, r, t, s = d["p"], d["q"], d["r"], d["t"], d["s"]
    g2 = p * p + q * q
    pendiente = np.degrees(np.arctan(np.sqrt(g2)))
    definida = g2 > UMBRAL_GRADIENTE2
    with np.errstate(invalid="ignore", divide="ignore"):
        g2s = np.where(definida, g2, np.nan)
        kv = -(p * p * r + 2 * p * q * s + q * q * t) / (g2s * (1 + g2) ** 1.5)
        kh = -(q * q * r - 2 * p * q * s + p * p * t) / (g2s * np.sqrt(1 + g2))
    hm = -((1 + q * q) * r - 2 * p * q * s + (1 + p * p) * t) / (2 * (1 + g2) ** 1.5)

    v = _vecinos(z)
    pila = np.stack(v)
    media = pila.mean(axis=0)
    ss = ((pila - media) ** 2).sum(axis=0)
    rss = np.maximum(ss - 6 * h * h * g2, 0.0)
    rug = np.sqrt(rss / 9.0)
    relieve = pila.max(axis=0) - pila.min(axis=0)

    f = {
        "elev_rel": zr,
        "pendiente": _rellenar_borde(pendiente),
        "rugosidad": _rellenar_borde(rug),
        "curv_perfil": _rellenar_borde(kv * 1000.0),     # 1/m → 1/km
        "curv_planta": _rellenar_borde(kh * 1000.0),
        "curv_media": _rellenar_borde(hm * 1000.0),
        "relieve_local": _rellenar_borde(relieve),
    }
    validas_int = np.isfinite(pendiente)
    diag = {
        "plano_ventana": plano,
        "celdas_interiores_validas": int(validas_int.sum()),
        "fraccion_plana": float((pendiente[validas_int] < UMBRAL_PLANO_GRADOS).mean()) if validas_int.any() else None,
        "curvatura_indefinida_por_gradiente_nulo": int((validas_int & ~definida).sum()),
    }
    return f, diag


def valores(campo: np.ndarray) -> np.ndarray:
    """Muestra 1-D de las celdas válidas (orden fijo: por filas)."""
    return campo[np.isfinite(campo)]


def estadisticos(x: np.ndarray) -> dict:
    """Estadística descriptiva de una muestra (sin suponer independencia: es solo descripción)."""
    if x.size == 0:
        return {"n": 0}
    p = np.percentile(x, [2, 5, 25, 50, 75, 95, 98])
    return {
        "n": int(x.size), "media": float(x.mean()), "desv_tipica": float(x.std(ddof=1)) if x.size > 1 else 0.0,
        "min": float(x.min()), "p02": float(p[0]), "p05": float(p[1]), "p25": float(p[2]), "mediana": float(p[3]),
        "p75": float(p[4]), "p95": float(p[5]), "p98": float(p[6]), "max": float(x.max()),
        "rango_intercuartilico": float(p[4] - p[2]), "rango_p02_p98": float(p[6] - p[0]),
    }
