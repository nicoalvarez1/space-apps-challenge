"""Distancias entre distribuciones empíricas (definiciones en METODOLOGIA.md §4).

- Wasserstein-1: ∫₀¹ |F_A⁻¹(u) − F_B⁻¹(u)| du. Unidades de la variable. Criterio principal.
- Kolmogorov–Smirnov: sup |F_A − F_B|. Adimensional. Su p-valor se calcula con el tamaño muestral
  efectivo, nunca con el nº de píxeles (están autocorrelacionados).
- Energía: 2E‖X−Y‖ − E‖X−X′‖ − E‖Y−Y′‖ (Székely & Rizzo 2013). Solo para vectores cuyas
  componentes comparten unidad (curvaturas k_v, k_h en 1/km): la norma euclídea no necesita pesos.
"""
from __future__ import annotations

import numpy as np
from scipy import stats
from scipy.spatial.distance import cdist


def niveles(m: int) -> np.ndarray:
    return (np.arange(m) + 0.5) / m


def cuantiles(x: np.ndarray, m: int) -> np.ndarray:
    """Función cuantil empírica (sin interpolar) en los m niveles de punto medio."""
    return np.quantile(x, niveles(m), method="inverted_cdf")


def wasserstein_cuantiles(q_catalogo: np.ndarray, q_objetivo: np.ndarray) -> np.ndarray:
    """W₁ ≈ (1/m)·Σ|Q_A(uᵢ) − Q_B(uᵢ)| (regla del punto medio), vectorizado sobre el catálogo.

    Cota del error: (rango_A + rango_B)/m (variación total de |Q_A − Q_B| entre m).
    """
    return np.abs(q_catalogo - q_objetivo).mean(axis=-1)


def cota_error_cuantiles(a: np.ndarray, b: np.ndarray, m: int) -> float:
    return float((np.ptp(a) + np.ptp(b)) / m)


def wasserstein(a: np.ndarray, b: np.ndarray) -> float:
    return float(stats.wasserstein_distance(a, b))


def ks(a: np.ndarray, b: np.ndarray) -> float:
    return float(stats.ks_2samp(a, b, method="asymp").statistic)


def ks_pvalor(d: float, n_a: float, n_b: float) -> float:
    """p-valor asintótico de KS (distribución de Kolmogorov con la corrección de Stephens 1970)."""
    ne = n_a * n_b / (n_a + n_b)
    s = np.sqrt(ne)
    return float(stats.kstwobign.sf((s + 0.12 + 0.11 / s) * d))


def energia(a: np.ndarray, b: np.ndarray) -> float:
    """Distancia de energía. 1-D: SciPy (exacta). n-D: pares completos (usar con muestras ≤ ~3000)."""
    if a.ndim == 1:
        return float(stats.energy_distance(a, b))
    dab, daa, dbb = cdist(a, b).mean(), cdist(a, a).mean(), cdist(b, b).mean()
    return float(np.sqrt(max(2 * dab - daa - dbb, 0.0)))


def submalla(campo: np.ndarray, max_puntos: int) -> tuple[np.ndarray, int]:
    """Índices de una submalla regular (determinista) con ≤ max_puntos celdas válidas.

    Además de limitar el coste O(n²), separar las muestras reduce su autocorrelación.
    """
    n = campo.shape[0]
    validas = np.isfinite(campo)
    paso = 1
    while validas[::paso, ::paso].sum() > max_puntos:
        paso += 1
    sel = np.zeros_like(validas)
    sel[::paso, ::paso] = True
    return sel & validas, paso


def distancia_variograma(lg_a: np.ndarray, lg_b: np.ndarray) -> np.ndarray:
    """√mean_j (ln γ_A − ln γ_B)²; e^D es el factor típico entre las amplitudes de relieve por escala."""
    return np.sqrt(((lg_a - lg_b) ** 2).mean(axis=-1))


def tipificar(x: np.ndarray) -> np.ndarray:
    """(x − media)/desv. típica: deja solo la forma de la distribución (prueba de normalización)."""
    s = x.std()
    return (x - x.mean()) / s if s > 0 else x - x.mean()
