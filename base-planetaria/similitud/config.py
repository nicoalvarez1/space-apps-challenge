"""Rutas y constantes del motor de similitud geomorfológica.

Todas las constantes físicas llevan su fuente. Los parámetros metodológicos (tamaño de ventana,
cobertura mínima…) no son constantes físicas: son decisiones explícitas, parametrizables, cuyo
efecto se mide en `validation.py`.
"""
from __future__ import annotations

import os
from pathlib import Path

PAQUETE = Path(__file__).resolve().parent
BASE_PLANETARIA = PAQUETE.parent
DATOS = BASE_PLANETARIA / "datos_pds"            # originales (los baja tools/descargar.py)
TOOLS = BASE_PLANETARIA / "tools"                # utilidades existentes (lector de etiquetas PDS3)
CACHE = Path(os.environ.get("SIMILITUD_CACHE", PAQUETE / "cache"))   # catálogos de ventanas
# Fuera del repositorio: la web se sirve con un servidor que recarga la página con cada archivo nuevo del proyecto.
# Las descargas de miles de archivos van aquí, y las cachés grandes se escriben aquí primero y se mueven a CACHE al
# terminar, en una sola operación por archivo.
FUERA_DEL_REPO = Path(os.environ.get("LANDFALL_FUERA", Path.home() / ".cache" / "landfall"))
TEMPORAL = FUERA_DEL_REPO / "tmp"

# --------------------------------------------------------------------------- constantes físicas
# WGS84 (NIMA TR8350.2): semieje mayor y aplanamiento que definen el elipsoide.
WGS84_A = 6_378_137.0
WGS84_F = 1.0 / 298.257223563

# --------------------------------------------------------------------------- parámetros por defecto
LADO_KM = 200.0            # lado físico de la ventana cuadrada
PASO_FRACCION = 0.5        # separación entre centros del catálogo = fracción del lado
MIN_CELDAS_LADO = 20       # por debajo, distribuciones y variograma no son estimables con fiabilidad
MIN_COBERTURA = 0.95       # fracción mínima de celdas válidas (Tierra: SRTMGL30 ≠ NODATA y no agua, ver data_loader)
N_CUANTILES = 200          # discretización de la función cuantil para el cribado del catálogo
DESPLAZAMIENTO_REF = 0.25  # desplazamiento (fracción de L) para la variabilidad intrínseca del objetivo
SEMILLA = 20261114         # semilla fija: bootstrap y perturbaciones son reproducibles

CRITERIOS = ("elev_rel", "pendiente", "rugosidad", "curv_perfil", "curv_planta", "variograma", "moran_pendiente")
VARIABLES_DISTRIBUCION = ("elev_rel", "pendiente", "rugosidad", "curv_perfil", "curv_planta")
