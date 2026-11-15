"""API HTTP mínima (biblioteca estándar) para que la web pida comparaciones.

    GET  /api/similitud/estado     qué datos hay y qué catálogos están en caché
    POST /api/similitud/analogos   {cuerpo, lat, lon, lado_km?, k?, buscar_en?, producto?, validar?}
    POST /api/similitud/comparar   {cuerpo, lat, lon, lat_candidato, lon_candidato, lado_km?, buscar_en?, producto?}

No implementa `/api/sites` ni `/api/training` (contrato de demostración de js/api.js, sin backend
real en el repositorio): esos flujos siguen funcionando igual en la web.
"""
from __future__ import annotations

import json
import math
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

from . import config
from .data_loader import DatosNoDisponibles, MetadatosInconsistentes, disponibilidad
from .preprocessing import VentanaInvalida
from .comparacion import comparar
from .similarity_engine import buscar_analogos

_bloqueo = threading.Lock()     # el primer cálculo construye el catálogo: no se duplica en paralelo


def limpiar(x):
    """JSON estricto: NaN/inf → null, tipos de NumPy → Python."""
    if isinstance(x, dict):
        return {str(k): limpiar(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [limpiar(v) for v in x]
    if isinstance(x, np.ndarray):
        return limpiar(x.tolist())
    if isinstance(x, (np.floating, float)):
        return None if not math.isfinite(float(x)) else float(x)
    if isinstance(x, np.integer):
        return int(x)
    if isinstance(x, np.bool_):
        return bool(x)
    return x


def _parametros(d: dict) -> dict:
    if d.get("cuerpo") not in ("moon", "mars"):
        raise ValueError("`cuerpo` must be 'moon' or 'mars'")
    lat, lon = float(d["lat"]), float(d["lon"])
    if not (-90 <= lat <= 90):
        raise ValueError("latitude outside [-90, 90]")
    p = {"cuerpo": d["cuerpo"], "lat": lat, "lon": lon,
         "lado_km": float(d.get("lado_km", config.LADO_KM)), "k": int(d.get("k", 10)),
         "buscar_en": d.get("buscar_en", "earth"), "validar": bool(d.get("validar", True))}
    if p["buscar_en"] not in ("earth", "moon", "mars"):
        raise ValueError("invalid `buscar_en`")
    if not (1 <= p["k"] <= 50):
        raise ValueError("`k` must be between 1 and 50")
    if d.get("producto"):
        p["producto"] = str(d["producto"])
    if d.get("h_m"):
        p["h_m"] = float(d["h_m"])
    return p


def _parametros_comparar(d: dict) -> dict:
    base = _parametros({**d, "k": 1})
    lat_t, lon_t = float(d["lat_candidato"]), float(d["lon_candidato"])
    if not (-90 <= lat_t <= 90):
        raise ValueError("candidate latitude outside [-90, 90]")
    p = {"cuerpo": base["cuerpo"], "lat": base["lat"], "lon": base["lon"], "lat_t": lat_t, "lon_t": lon_t,
         "lado_km": base["lado_km"], "buscar_en": base["buscar_en"]}
    if base.get("producto"):
        p["producto"] = base["producto"]
    return p


class Manejador(BaseHTTPRequestHandler):
    def _responder(self, codigo: int, cuerpo: dict) -> None:
        datos = json.dumps(limpiar(cuerpo), ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(datos)))
        self.end_headers()
        self.wfile.write(datos)

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):  # noqa: N802
        if self.path.rstrip("/") == "/api/similitud/estado":
            cats = sorted(p.name for p in config.CACHE.glob("catalogo_*.npz")) if config.CACHE.exists() else []
            return self._responder(200, {"datos": disponibilidad(), "catalogos_en_cache": cats})
        self._responder(404, {"error": "unknown route"})

    def do_POST(self):  # noqa: N802
        ruta = self.path.rstrip("/")
        if ruta not in ("/api/similitud/analogos", "/api/similitud/comparar"):
            return self._responder(404, {"error": "unknown route"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            datos = json.loads(self.rfile.read(n) or b"{}")
            p = _parametros(datos) if ruta.endswith("analogos") else _parametros_comparar(datos)
        except (ValueError, KeyError, json.JSONDecodeError) as e:
            return self._responder(400, {"error": f"invalid request: {e}"})
        try:
            with _bloqueo:
                if ruta.endswith("comparar"):
                    return self._responder(200, comparar(**p))
                return self._responder(200, buscar_analogos(**p))
        except DatosNoDisponibles as e:
            return self._responder(503, {"error": "missing data", "detalle": str(e), "datos": disponibilidad()})
        except VentanaInvalida as e:
            return self._responder(422, {"error": str(e)})
        except MetadatosInconsistentes as e:
            # Comprobaciones de integridad de los productos (solo saltan si un archivo está dañado o no es el esperado):
            # la web muestra `error`, en inglés; el detalle técnico va aparte, sin traducir.
            return self._responder(422, {"error": "the product metadata do not match the file (integrity check failed)",
                                         "diagnostico": str(e)})


def servir(puerto: int = 8000, anfitrion: str = "127.0.0.1") -> None:
    srv = ThreadingHTTPServer((anfitrion, puerto), Manejador)
    print(f"Motor de similitud en http://{anfitrion}:{puerto}/api/similitud/estado")
    srv.serve_forever()
