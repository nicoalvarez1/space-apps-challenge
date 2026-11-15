"""Estructura espacial: variograma, autocorrelación, escala característica y tamaño muestral efectivo.

Dos terrenos con el mismo histograma pueden tener organizaciones espaciales opuestas (cráteres
aislados frente a crestas periódicas). Estas funciones describen esa organización.

Semivariograma con máscara por FFT (Marcotte 1996, Computers & Geosciences 22(10)):
    N(τ) = Σ m(x)m(x+τ),   γ(τ) = Σ m m′ (z′ − z)² / 2N(τ) = [A + B − 2C] / 2N
    A = Σ m·m′z′²,  B = Σ m z²·m′,  C = Σ m z·m′z′      (correlaciones cruzadas por FFT con relleno)
"""
from __future__ import annotations

import math
from functools import lru_cache

import numpy as np
from scipy import fft as sfft


def _xcorr(a_f: np.ndarray, b_f: np.ndarray, forma) -> np.ndarray:
    """Σₓ a(x)·b(x+τ) para todo τ (relleno de ceros 2n: sin efectos circulares)."""
    return sfft.irfft2(np.conj(a_f) * b_f, s=forma)


@lru_cache(maxsize=32)
def _mapa_desfases(n0: int, n1: int | None = None):
    """Distancia (celdas) y ángulo (0° = este, 90° = norte) de cada desfase de la rejilla 2n0×2n1 (orden FFT)."""
    n1 = n0 if n1 is None else n1
    dy = np.fft.fftfreq(2 * n0, 1.0 / (2 * n0))
    dx = np.fft.fftfreq(2 * n1, 1.0 / (2 * n1))
    dy, dx = np.meshgrid(dy, dx, indexing="ij")
    return np.hypot(dx, dy), np.degrees(np.arctan2(-dy, dx)) % 180.0


@lru_cache(maxsize=32)
def desfases_semioctava(n: int) -> np.ndarray:
    """1, √2, 2, 2√2, … ≤ n/2 celdas: cada factor de escala pesa lo mismo en la distancia entre variogramas."""
    r = 2.0 ** (np.arange(64) / 2.0)
    return r[r <= n / 2.0 + 1e-9]


@lru_cache(maxsize=32)
def _clases_semioctava(n: int) -> np.ndarray:
    centros = desfases_semioctava(n)
    dist, _ = _mapa_desfases(n)
    bordes = np.sqrt(centros[:-1] * centros[1:])          # medias geométricas entre centros
    idx = np.searchsorted(bordes, dist, side="right")
    idx[(dist < centros[0] / 2 ** 0.25) | (dist >= centros[-1] * 2 ** 0.25)] = -1
    return idx


def _componentes(z: np.ndarray):
    m = np.isfinite(z).astype(float)
    z0 = np.where(m > 0, z, 0.0)
    forma = (2 * z.shape[0], 2 * z.shape[1])
    fm, fz, fz2 = (sfft.rfft2(a, s=forma) for a in (m, z0, z0 * z0))
    npar = np.rint(_xcorr(fm, fm, forma))
    suma = np.maximum(_xcorr(fm, fz2, forma) + _xcorr(fz2, fm, forma) - 2 * _xcorr(fz, fz, forma), 0.0)
    return npar, suma                                     # suma = 2·N·γ


def _agrupar(npar, suma, idx, nclases):
    ok = idx >= 0
    num = np.bincount(idx[ok], weights=suma[ok], minlength=nclases)[:nclases]
    den = np.bincount(idx[ok], weights=npar[ok], minlength=nclases)[:nclases]
    with np.errstate(invalid="ignore", divide="ignore"):
        return num / (2 * den), den


def variograma(z: np.ndarray, h: float) -> dict:
    """γ(r) isótropo (m²) en desfases de media octava r_j = h·2^{j/2} ≤ L/2."""
    n = z.shape[0]
    centros = desfases_semioctava(n)
    npar, suma = _componentes(z)
    g, pares = _agrupar(npar, suma, _clases_semioctava(n), len(centros))
    return {"r_m": centros * h, "gamma_m2": g, "pares": pares}


def variograma_lineal(z: np.ndarray, h: float) -> dict:
    """γ(r) en clases lineales r = h, 2h, …, ⌊n/2⌋h (para la escala característica)."""
    n = z.shape[0]
    npar, suma = _componentes(z)
    dist, _ = _mapa_desfases(n)
    kmax = n // 2
    idx = np.rint(dist).astype(int) - 1
    idx[(idx < 0) | (idx >= kmax)] = -1
    g, pares = _agrupar(npar, suma, idx, kmax)
    return {"r_m": (np.arange(kmax) + 1) * h, "gamma_m2": g, "pares": pares}


def log_variograma(z: np.ndarray, h: float, piso_m2: float = 1e-6) -> np.ndarray:
    """ln γ(r_j); el piso solo evita log(0) en superficies exactamente planas."""
    g = variograma(z, h)["gamma_m2"]
    return np.log(np.maximum(np.nan_to_num(g, nan=piso_m2), piso_m2))


def exponente_hurst(z: np.ndarray, h: float, max_celdas: float = 4.0) -> dict:
    """γ(r) ∝ r^{2H} en r ≤ max_celdas·h (Shepard et al. 2001, JGR 106(E12))."""
    v = variograma(z, h)
    sel = (v["r_m"] <= max_celdas * h + 1e-9) & (v["gamma_m2"] > 0)
    if sel.sum() < 3:
        return {"H": None, "r2": None}
    x, y = np.log(v["r_m"][sel]), np.log(v["gamma_m2"][sel])
    pend, ordenada = np.polyfit(x, y, 1)
    res = y - (pend * x + ordenada)
    sst = float(((y - y.mean()) ** 2).sum())
    return {"H": float(pend / 2), "r2": float(1 - (res ** 2).sum() / sst) if sst > 0 else None,
            "rango_ajuste_m": [float(v["r_m"][sel].min()), float(v["r_m"][sel].max())]}


def longitud_correlacion(z: np.ndarray, h: float) -> dict:
    """Primera r con ρ(r) = 1 − γ(r)/σ² < 1/e. Si no se alcanza: CENSURADA (> ⌊n/2⌋h)."""
    zz = z[np.isfinite(z)]
    var = float(zz.var()) if zz.size else 0.0
    v = variograma_lineal(z, h)
    if var <= 0:
        return {"longitud_m": None, "censurada": True}
    rho = 1 - v["gamma_m2"] / var
    debajo = np.nonzero(rho < 1 / math.e)[0]
    if debajo.size == 0:
        return {"longitud_m": None, "censurada": True, "mayor_que_m": float(v["r_m"][-1])}
    i = int(debajo[0])
    if i == 0:
        return {"longitud_m": float(v["r_m"][0]), "censurada": False, "cota_superior": True}
    r0, r1, p0, p1 = v["r_m"][i - 1], v["r_m"][i], rho[i - 1], rho[i]
    return {"longitud_m": float(r0 + (p0 - 1 / math.e) * (r1 - r0) / (p0 - p1)), "censurada": False}


def anisotropia(z: np.ndarray, h: float) -> dict:
    """γ medio en 0°, 45°, 90°, 135° (±22,5°) para 1 ≤ |τ| ≤ n/4. Solo se compara la razón max/min."""
    n = z.shape[0]
    npar, suma = _componentes(z)
    dist, ang = _mapa_desfases(n)
    gam = {}
    for a0 in (0, 45, 90, 135):
        sel = (dist >= 1) & (dist <= n / 4) & (np.abs(((ang - a0) + 90) % 180 - 90) <= 22.5)
        den = npar[sel].sum()
        gam[a0] = float(suma[sel].sum() / (2 * den)) if den > 0 else float("nan")
    v = np.array(list(gam.values()))
    return {"gamma_por_direccion_m2": gam, "razon": float(v.max() / v.min()) if np.all(v > 0) else None}


_REINA = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def moran_i(campo: np.ndarray) -> float:
    """I de Moran, vecindad de reina, pesos binarios: (n/W)·Σwᵢⱼ(xᵢ−x̄)(xⱼ−x̄)/Σ(xᵢ−x̄)²."""
    m = np.isfinite(campo)
    n = int(m.sum())
    if n < 3:
        return float("nan")
    x = np.where(m, campo - campo[m].mean(), 0.0)
    den = float((x[m] ** 2).sum())
    if den == 0:
        return float("nan")
    a0, a1 = campo.shape
    num, w = 0.0, 0
    for di, dj in _REINA:
        sa = (slice(max(0, -di), a0 - max(0, di)), slice(max(0, -dj), a1 - max(0, dj)))
        sb = (slice(max(0, di), a0 - max(0, -di)), slice(max(0, dj), a1 - max(0, -dj)))
        par = m[sa] & m[sb]
        num += float((x[sa] * x[sb])[par].sum())
        w += int(par.sum())
    return (n / w) * num / den if w else float("nan")


def n_efectivo(campo: np.ndarray) -> dict:
    """n_ef = n² / Σ_{|τ|<τ₀} N(τ)ρ(τ), con τ₀ = primer desfase con correlograma isótropo ≤ 0.

    La suma completa de la autocovarianza muestral de un campo centrado es exactamente 0, por eso
    se trunca (Bretherton et al. 1999, J. Climate 12). Es una aproximación para la media; se usa
    también, como aproximación, en los p-valores de distribuciones.
    """
    m = np.isfinite(campo)
    n = int(m.sum())
    if n < 3:
        return {"n": n, "n_efectivo": float(max(n, 1)), "radio_celdas": 0}
    x = np.where(m, campo - campo[m].mean(), 0.0)
    var = float((x[m] ** 2).sum() / n)
    if var == 0:
        return {"n": n, "n_efectivo": 1.0, "radio_celdas": 0}
    forma = (2 * campo.shape[0], 2 * campo.shape[1])
    fm, fx = sfft.rfft2(m.astype(float), s=forma), sfft.rfft2(x, s=forma)
    npar = np.rint(_xcorr(fm, fm, forma))
    cov = _xcorr(fx, fx, forma)                         # Σ x(x)x(x+τ) = N(τ)·C(τ)
    dist, _ = _mapa_desfases(*campo.shape)
    kmax = min(campo.shape) // 2
    clase = np.rint(dist).astype(int)
    ok = clase <= kmax
    num = np.bincount(clase[ok], weights=cov[ok], minlength=kmax + 1)
    den = np.bincount(clase[ok], weights=npar[ok], minlength=kmax + 1)
    with np.errstate(invalid="ignore", divide="ignore"):
        rho_iso = num / den / var
    no_pos = np.nonzero(~(rho_iso[1:] > 0))[0]
    radio = int(no_pos[0]) + 1 if no_pos.size else kmax
    s = float(cov[dist < radio].sum() / var)            # Σ N(τ)ρ(τ)
    n_ef = float(np.clip(n * n / s, 1.0, n)) if s > 0 else float(n)
    return {"n": n, "n_efectivo": n_ef, "radio_celdas": radio}
