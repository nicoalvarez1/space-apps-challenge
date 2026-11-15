"""Extracción de ventanas comparables: misma forma y tamaño FÍSICO, misma rejilla métrica.

Pasos (ecuaciones en METODOLOGIA.md §2):
1. Rejilla local de N×N celdas de lado h (metros) sobre una proyección azimutal equidistante
   centrada en la ventana (Snyder 1987, ec. 25-1 y 20-14/20-15). Filas de norte a sur.
2. Cada celda h×h toma la MEDIA de k×k muestras bilineales del producto original (filtro de caja
   de lado h): el valor de la celda es la altura media sobre su área, como en los productos de
   registro por píxel. h nunca es menor que el espaciado nativo → no se crea precisión artificial.
3. Una celda solo es válida si todas sus muestras lo son (sin rellenar huecos).
4. Se registran: cobertura válida y fracción de celdas con observación directa (si existe el mapa
   de conteos del producto).
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from . import config
from .data_loader import Raster


class VentanaInvalida(ValueError):
    pass


@dataclass
class Ventana:
    cuerpo: str
    producto: str
    lat: float
    lon: float                  # longitud este en [0, 360)
    n: int                      # celdas por lado
    h_m: float                  # tamaño de celda (m)
    k: int                      # muestras por lado de celda en el remuestreo
    radio_m: float              # esfera local usada en la proyección
    z: np.ndarray               # n×n, metros en la referencia vertical del producto, NaN = no válido
    cobertura: float            # fracción de celdas válidas
    fraccion_observada: float | None   # fracción de muestras cuya celda de origen tiene ≥ 1 observación

    @property
    def lado_m(self) -> float:
        return self.n * self.h_m

    def resumen(self) -> dict:
        return {
            "cuerpo": self.cuerpo, "producto": self.producto,
            "centro": {"lat": round(self.lat, 4), "lon_este": round(self.lon, 4),
                       "lon_180": round(((self.lon + 180) % 360) - 180, 4)},
            "lado_km": round(self.lado_m / 1000, 3), "celdas_por_lado": self.n,
            "resolucion_analisis_m": round(self.h_m, 1), "muestras_por_celda": self.k * self.k,
            "cobertura_valida": round(self.cobertura, 4),
            "fraccion_con_observacion_directa": (None if self.fraccion_observada is None
                                                 else round(self.fraccion_observada, 4)),
        }


# --------------------------------------------------------------------------- resolución común
def resolucion_comun_m(*rejillas: Raster, h_solicitada_m: float | None = None) -> float:
    """h = máximo de los espaciados nativos implicados. Solo se admite engrosarla, nunca afinarla."""
    h_min = max(r.espaciado_nativo_m() for r in rejillas)
    if h_solicitada_m is None:
        return h_min
    if h_solicitada_m < h_min * (1 - 1e-9):
        raise VentanaInvalida(
            f"h = {h_solicitada_m:.0f} m es más fina que el espaciado nativo más grueso ({h_min:.0f} m): "
            "se introduciría precisión artificial")
    return float(h_solicitada_m)


def celdas_por_lado(lado_km: float, h_m: float) -> int:
    n = int(round(lado_km * 1000.0 / h_m))
    if n < config.MIN_CELDAS_LADO:
        raise VentanaInvalida(
            f"La ventana de {lado_km} km tiene {n} celdas de {h_m:.0f} m por lado (< {config.MIN_CELDAS_LADO}): "
            "distribuciones y variograma no serían estimables. Aumenta el lado o usa un MDE más fino.")
    return n


# --------------------------------------------------------------------------- proyección
def azimutal_equidistante_inversa(x: np.ndarray, y: np.ndarray, lat0: float, lon0: float, radio: float):
    """(x, y) en metros sobre la esfera de radio `radio` → (lat, lon) en grados (Snyder 1987, ec. 20-14, 20-15)."""
    phi0, lam0 = math.radians(lat0), math.radians(lon0)
    rho = np.hypot(x, y)
    c = rho / radio
    sin_c, cos_c = np.sin(c), np.cos(c)
    with np.errstate(invalid="ignore", divide="ignore"):
        termino = np.where(rho > 0, y * sin_c * math.cos(phi0) / np.where(rho > 0, rho, 1), 0.0)
    phi = np.arcsin(np.clip(cos_c * math.sin(phi0) + termino, -1, 1))
    lam = lam0 + np.arctan2(x * sin_c, rho * math.cos(phi0) * cos_c - y * math.sin(phi0) * sin_c)
    return np.degrees(phi), np.degrees(lam) % 360.0


def coordenadas_muestras(n: int, k: int, h: float) -> tuple[np.ndarray, np.ndarray]:
    """Coordenadas (x, y) de las n·k × n·k muestras; la celda i agrupa las muestras i·k … i·k+k−1."""
    m = n * k
    idx = np.arange(m)
    paso = h / k
    x = (idx - (m - 1) / 2) * paso
    y = ((m - 1) / 2 - idx) * paso
    return np.meshgrid(x, y)


# --------------------------------------------------------------------------- muestreo
def factor_submuestreo(rejilla: Raster, h_m: float) -> int:
    """k tal que la separación entre muestras (h/k) no supere el espaciado nativo; mínimo 2."""
    return max(2, int(math.ceil(h_m / rejilla.espaciado_nativo_m() - 1e-9)) + 1)


def extraer_ventana(rejilla: Raster, lat: float, lon: float, lado_km: float, h_m: float,
                    k: int | None = None) -> Ventana:
    n = celdas_por_lado(lado_km, h_m)
    k = k or factor_submuestreo(rejilla, h_m)
    radio = rejilla.radio_local_m(lat)
    x, y = coordenadas_muestras(n, k, h_m)
    la, lo = azimutal_equidistante_inversa(x, y, lat, lon % 360.0, radio)
    v, valido, obs = rejilla.muestrear(la, lo)
    bloques = v.reshape(n, k, n, k)
    z = bloques.mean(axis=(1, 3))
    celda_valida = valido.reshape(n, k, n, k).all(axis=(1, 3))
    z = np.where(celda_valida, z, np.nan)
    return Ventana(
        cuerpo=rejilla.cuerpo, producto=rejilla.producto, lat=float(lat), lon=float(lon) % 360.0,
        n=n, h_m=float(h_m), k=k, radio_m=radio, z=z,
        cobertura=float(celda_valida.mean()),
        fraccion_observada=None if obs is None else float(obs.mean()),
    )


def cobertura_aproximada(rejilla: Raster, lat: float, lon: float, lado_km: float, puntos: int = 7) -> float:
    """Fracción de puntos válidos en una malla gruesa puntos×puntos (solo para descartar rápido ventanas oceánicas)."""
    lado = lado_km * 1000.0
    t = (np.arange(puntos) + 0.5) / puntos - 0.5
    x, y = np.meshgrid(t * lado, -t * lado)
    la, lo = azimutal_equidistante_inversa(x, y, lat, lon % 360.0, rejilla.radio_local_m(lat))
    _, valido, _ = rejilla.muestrear(la, lo)
    return float(valido.mean())


# --------------------------------------------------------------------------- tendencia
def quitar_plano(z: np.ndarray, h: float) -> tuple[np.ndarray, dict]:
    """z − (a + b·x + c·y) por mínimos cuadrados sobre las celdas válidas.

    Elimina el desplazamiento y la inclinación de la referencia vertical dentro de la ventana
    (esfera, areoide o geoide difieren entre sí, localmente, sobre todo en un plano).
    """
    n = z.shape[0]
    t = (np.arange(n) - (n - 1) / 2) * h
    X, Y = np.meshgrid(t, -t)
    m = np.isfinite(z)
    if m.sum() < 3:
        raise VentanaInvalida("menos de 3 celdas válidas")
    A = np.column_stack([np.ones(m.sum()), X[m], Y[m]])
    coef, *_ = np.linalg.lstsq(A, z[m], rcond=None)
    res = np.full_like(z, np.nan)
    res[m] = z[m] - A @ coef
    return res, {"media_m": float(coef[0]), "pendiente_este": float(coef[1]), "pendiente_norte": float(coef[2]),
                 "inclinacion_regional_grados": float(np.degrees(np.arctan(np.hypot(coef[1], coef[2]))))}
