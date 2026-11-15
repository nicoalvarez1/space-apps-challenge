"""Análogos terrestres precalculados para la web estática (cuando el servidor del motor no está en marcha).

Para cada emplazamiento de `js/data.js` (SITES.moon y SITES.mars; id, nombre, lat y lon se leen del propio archivo,
no se copian a mano) se ejecuta exactamente lo que pide la web:

  1. Búsqueda de análogos en la Tierra = POST /api/similitud/analogos de `js/api.js`:
     lado 200 km, k = 5, validación activada y, en la Luna con |lat| ≥ 78°, el MDE polar de LOLA del hemisferio
     (`ldem_75s_240m` / `ldem_75n_240m`) si está en disco; la misma regla que `renderMotor` en `js/main.js`.
  2. Para cada uno de los 5 candidatos, la comparación detallada = POST /api/similitud/comparar de `js/comparacion.js`
     (mismo lado, sin producto fijo: `mejor_raster` elige el MDE más fino que cubre cada ventana).

Salida en `base-planetaria/web/data/analogos/`:
    indice.json                    fecha, parámetros, emplazamientos, archivos y tamaños
    {cuerpo}_{id}.json             respuesta de la búsqueda (la misma que daría el servidor) + "precalculado"
    {cuerpo}_{id}_{rango}.json     respuesta de la comparación del candidato `rango` + "precalculado"

Lo único que cambia respecto a la respuesta del servidor (y queda escrito en indice.json → "cuantizacion"):
  - JSON compacto (sin sangría).
  - Mapas de la comparación (`visual.mapas`): la elevación relativa se redondea a 0,1 m (el servidor da 0,01 m); la
    pendiente sigue a 0,01°. Ningún MDE usado tiene una precisión vertical cercana a 0,1 m (SRTMGL30 y MOLA MEGT se
    publican en metros enteros), así que el redondeo no cambia lo que se ve. Las demás cifras van tal cual.

Cada archivo se escribe primero FUERA del repositorio (config.TEMPORAL/analogos_web) y todos se mueven a la carpeta de
la web al terminar: el servidor de desarrollo de la web no ve archivos a medio escribir. Si se interrumpe, al volver a
lanzarlo se aprovechan los archivos ya calculados en esa carpeta temporal (misma configuración).

    python -m similitud precalcular-web [--trabajos 4] [--solo jezero,shackleton]
"""
from __future__ import annotations

import json
import re
import shutil
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

from . import config

RAIZ_WEB = config.BASE_PLANETARIA.parent
DATA_JS = RAIZ_WEB / "js" / "data.js"
DESTINO = config.BASE_PLANETARIA / "web" / "data" / "analogos"
TEMPORAL = config.TEMPORAL / "analogos_web"

# La configuración que usa la web (js/api.js → fetchAnalogosGeomorfologicos, js/main.js → renderMotor)
LADO_KM = 200.0
K = 5
LAT_POLAR = 78.0
BUSCAR_EN = "earth"
DECIMALES_MAPA = {"elev_rel": 1, "pendiente": 2}


# --------------------------------------------------------------------------- emplazamientos de la web
def sitios_web(ruta: Path = DATA_JS) -> list[dict]:
    """Lee `export const SITES = { moon: [S('id', 'nombre', 'región', lat, lon, …)…], mars: […] }` de js/data.js."""
    src = ruta.read_text(encoding="utf-8")
    ini = src.index("export const SITES = {")
    fin = src.index("\n};", ini)
    bloque = src[ini:fin]
    i_moon, i_mars = bloque.index("moon: ["), bloque.index("mars: [")
    patron = re.compile(r"S\(\s*'([^']+)',\s*'((?:[^'\\]|\\.)*)',\s*'((?:[^'\\]|\\.)*)',\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)")
    out = []
    for cuerpo, trozo in (("moon", bloque[i_moon:i_mars]), ("mars", bloque[i_mars:])):
        for m in patron.finditer(trozo):
            out.append({"cuerpo": cuerpo, "id": m[1], "nombre": m[2], "region": m[3],
                        "lat": float(m[4]), "lon": float(m[5])})
    if not out:
        raise RuntimeError(f"No se ha encontrado ningún emplazamiento en {ruta}")
    return out


def producto_web(sitio: dict, polares: list[str]) -> str | None:
    """El MDE que pide la web: polar de LOLA para |lat| ≥ 78° en la Luna si está en disco; si no, el de por defecto."""
    if sitio["cuerpo"] != "moon" or abs(sitio["lat"]) < LAT_POLAR:
        return None
    pol = "ldem_75s_240m" if sitio["lat"] < 0 else "ldem_75n_240m"
    return pol if pol in polares else None


def _base(sitio: dict) -> str:
    return f"{sitio['cuerpo']}_{sitio['id']}"


def _firma_config(sitio: dict, producto: str | None) -> dict:
    return {"cuerpo": sitio["cuerpo"], "id": sitio["id"], "lat": sitio["lat"], "lon": sitio["lon"],
            "lado_km": LADO_KM, "k": K, "producto": producto, "buscar_en": BUSCAR_EN}


# --------------------------------------------------------------------------- escritura
def _escribir(nombre: str, datos: dict) -> int:
    from .servidor import limpiar
    TEMPORAL.mkdir(parents=True, exist_ok=True)
    txt = json.dumps(limpiar(datos), ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    parcial = TEMPORAL / (nombre + ".parcial")
    parcial.write_text(txt, encoding="utf-8")
    parcial.replace(TEMPORAL / nombre)
    return len(txt.encode("utf-8"))


def _ya_hecho(nombre: str, firma: dict) -> bool:
    ruta = TEMPORAL / nombre
    if not ruta.exists():
        return False
    try:
        return json.loads(ruta.read_text(encoding="utf-8")).get("precalculado", {}).get("configuracion") == firma
    except (ValueError, OSError):
        return False


def _cuantizar_mapas(comp: dict) -> None:
    mapas = (comp.get("visual") or {}).get("mapas") or {}
    for var, dec in DECIMALES_MAPA.items():
        for lado in ("objetivo", "candidato"):
            m = mapas.get(var, {}).get(lado)
            if m:
                mapas[var][lado] = [[None if v is None else round(v, dec) for v in fila] for fila in m]


# --------------------------------------------------------------------------- un emplazamiento
def procesar(sitio: dict, producto: str | None, fecha: str) -> dict:
    """Búsqueda + 5 comparaciones de un emplazamiento. Devuelve un resumen para el índice."""
    from .comparacion import comparar
    from .similarity_engine import buscar_analogos

    firma = _firma_config(sitio, producto)
    base, t0 = _base(sitio), time.time()
    nombre = f"{base}.json"
    if _ya_hecho(nombre, firma):
        r = json.loads((TEMPORAL / nombre).read_text(encoding="utf-8"))
    else:
        r = buscar_analogos(sitio["cuerpo"], sitio["lat"], sitio["lon"], LADO_KM, K, BUSCAR_EN, producto, validar=True)
        r["precalculado"] = {"fecha": fecha, "configuracion": firma, "sitio": sitio["nombre"]}
        _escribir(nombre, r)
    comps = []
    for a in r["analogos"]:
        nc = f"{base}_{a['rango']}.json"
        fc = {**firma, "rango": a["rango"], "lat_candidato": a["lat"], "lon_candidato": a["lon"]}
        if not _ya_hecho(nc, fc):
            c = comparar(sitio["cuerpo"], sitio["lat"], sitio["lon"], a["lat"], a["lon"], LADO_KM, None, BUSCAR_EN)
            _cuantizar_mapas(c)
            c["precalculado"] = {"fecha": fecha, "configuracion": fc, "sitio": sitio["nombre"]}
            _escribir(nc, c)
        comps.append(nc)
    return {"sitio": sitio, "producto": producto, "archivo": nombre, "comparaciones": comps,
            "candidatos": [{"rango": a["rango"], "lat": a["lat"], "lon": a["lon"], "peor_percentil": a["peor_percentil"]}
                           for a in r["analogos"]],
            "segundos": round(time.time() - t0, 1)}


# --------------------------------------------------------------------------- todo
def precalcular(trabajos: int = 4, solo: list[str] | None = None) -> dict:
    from .data_loader import disponibilidad

    t0 = time.time()
    fecha = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    sitios = sitios_web()
    if solo:
        sitios = [s for s in sitios if s["id"] in solo]
    polares = disponibilidad()["moon"]["polares"]
    tareas = [(s, producto_web(s, polares)) for s in sitios]
    log = lambda m: print(f"[{time.time() - t0:7.0f} s] {m}", file=sys.stderr, flush=True)  # noqa: E731
    log(f"{len(tareas)} emplazamientos; archivos temporales en {TEMPORAL}")

    # 1) El primero de cada configuración en serie: construye (o lee) el catálogo terrestre de su resolución una sola
    #    vez, antes de repartir el resto entre procesos (dos procesos no construyen el mismo catálogo a la vez).
    resultados, vistos, resto = [], set(), []
    for s, p in tareas:
        clave = (s["cuerpo"], p)
        if clave in vistos:
            resto.append((s, p))
            continue
        vistos.add(clave)
        log(f"{s['cuerpo']}/{s['id']} (producto {p or 'por defecto'}): búsqueda + comparaciones…")
        resultados.append(procesar(s, p, fecha))
        log(f"  hecho en {resultados[-1]['segundos']} s")
    # 2) El resto en paralelo
    with ProcessPoolExecutor(max_workers=max(1, trabajos)) as ex:
        fut = {ex.submit(procesar, s, p, fecha): s for s, p in resto}
        for f in as_completed(fut):
            s = fut[f]
            resultados.append(f.result())
            log(f"{s['cuerpo']}/{s['id']} hecho en {resultados[-1]['segundos']} s")

    # 3) Mover a la carpeta de la web, todos a la vez al final
    DESTINO.mkdir(parents=True, exist_ok=True)
    nombres = [x for r in resultados for x in (r["archivo"], *r["comparaciones"])]
    tam = {}
    for n in nombres:                   # se copia dentro de TEMPORAL (queda para reanudar) y la copia se mueve entera
        tam[n] = (TEMPORAL / n).stat().st_size
        shutil.copyfile(TEMPORAL / n, TEMPORAL / (n + ".mover"))
        shutil.move(TEMPORAL / (n + ".mover"), DESTINO / n)
    orden = {(s["cuerpo"], s["id"]): i for i, (s, _) in enumerate(tareas)}
    resultados.sort(key=lambda r: orden[(r["sitio"]["cuerpo"], r["sitio"]["id"])])
    indice = {
        "generado": fecha,
        "segundos": round(time.time() - t0, 1),
        "descripcion": ("Earth analogs precomputed by the similarity engine (python -m similitud precalcular-web) for "
                        "the sites in js/data.js, used by the web when the engine server is not running."),
        "parametros": {"lado_km": LADO_KM, "k": K, "buscar_en": BUSCAR_EN, "validar": True,
                       "lat_mde_polar_luna": LAT_POLAR, "polares_en_disco": polares},
        "cuantizacion": {"json": "compact (no indentation)",
                         "visual.mapas": {k: f"rounded to {v} decimals" for k, v in DECIMALES_MAPA.items()},
                         "resto": "unchanged (the same numbers the server returns)"},
        "sitios": {f"{r['sitio']['cuerpo']}:{r['sitio']['id']}": {
            "cuerpo": r["sitio"]["cuerpo"], "id": r["sitio"]["id"], "nombre": r["sitio"]["nombre"],
            "lat": r["sitio"]["lat"], "lon": r["sitio"]["lon"], "producto": r["producto"],
            "archivo": r["archivo"], "comparaciones": r["comparaciones"], "candidatos": r["candidatos"],
            "segundos": r["segundos"]} for r in resultados},
        "archivos": {n: tam[n] for n in nombres},
        "bytes_total": sum(tam.values()),
    }
    from .servidor import limpiar
    txt = json.dumps(limpiar(indice), ensure_ascii=False, allow_nan=False, indent=1)
    (TEMPORAL / "indice.json").write_text(txt, encoding="utf-8")
    shutil.move(TEMPORAL / "indice.json", DESTINO / "indice.json")
    log(f"Listo: {len(nombres) + 1} archivos, {indice['bytes_total'] / 1e6:.1f} MB en {DESTINO}")
    return indice
