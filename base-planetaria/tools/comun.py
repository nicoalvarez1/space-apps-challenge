"""Utilidades comunes de los scripts de datos.

Regla del proyecto: ningún valor se inventa. Todo lo que sale de estos scripts es
(a) una copia numérica de un producto publicado, o (b) un cálculo explícito y
documentado sobre ese producto. Cada capa generada queda descrita en
`web/data/capas.json` con su fuente, URL, suma MD5 del original y pasos de procesado.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DATOS = RAIZ / "datos_pds"          # originales descargados (no se sirven en la web)
WEB_DATOS = RAIZ / "web" / "data"   # capas reducidas que carga la página
MANIFIESTO = WEB_DATOS / "capas.json"


# --------------------------------------------------------------------------- descarga
def curl_disponible() -> bool:
    return shutil.which("curl") is not None


def descargar(url: str, destino: Path, *, md5: str | None = None, reintentos: int = 4,
              silencioso: bool = False) -> Path:
    """Descarga `url` en `destino` con curl (reanuda si quedó a medias) y comprueba el MD5 si se da.

    Se usa curl y no urllib porque en muchas instalaciones de Python para macOS faltan los
    certificados raíz y urllib falla con CERTIFICATE_VERIFY_FAILED.
    """
    destino = Path(destino)
    destino.parent.mkdir(parents=True, exist_ok=True)
    if destino.exists() and destino.stat().st_size > 0:
        if md5 is None:
            if not silencioso:
                print(f"  ya está (sin MD5 publicado): {destino.name}")
            return destino
        if md5_archivo(destino).lower() == md5.lower():
            if not silencioso:
                print(f"  ya está (MD5 correcto): {destino.name}")
            return destino
        if not silencioso:
            print(f"  MD5 distinto en {destino.name}: se vuelve a descargar")
        destino.unlink()
    if not curl_disponible():
        raise SystemExit("Hace falta `curl` en el PATH para descargar.")
    parcial = destino.with_suffix(destino.suffix + ".parcial")
    for intento in range(1, reintentos + 1):
        orden = ["curl", "-sS", "-L", "--fail", "-C", "-", "-m", "7200", "-o", str(parcial), url]
        r = subprocess.run(orden, capture_output=True, text=True)
        # código 33 = el servidor no admite reanudar; 416 = ya estaba completo
        if r.returncode == 0 or "416" in r.stderr:
            break
        if not silencioso:
            print(f"  intento {intento} fallido ({r.stderr.strip()[:120]}); reintento…")
        if r.returncode == 33 and parcial.exists():
            parcial.unlink()
        time.sleep(3 * intento)
    else:
        raise SystemExit(f"No se pudo descargar {url}")
    parcial.replace(destino)
    if md5:
        real = md5_archivo(destino)
        if real.lower() != md5.lower():
            raise SystemExit(f"MD5 incorrecto en {destino.name}: {real} ≠ {md5} (publicado)")
    if not silencioso:
        print(f"  descargado: {destino.name} ({destino.stat().st_size:,} bytes)" + (" · MD5 verificado" if md5 else ""))
    return destino


def curl_texto(url: str, *, cabeceras: list[str] | None = None, datos: str | None = None,
               max_seg: int = 120, reintentos: int = 4) -> str:
    """GET (o POST si hay `datos`) que devuelve el cuerpo como texto. Reintenta ante fallos de red."""
    orden = ["curl", "-sS", "-L", "--fail", "-m", str(max_seg)]
    for c in cabeceras or []:
        orden += ["-H", c]
    if datos is not None:
        orden += ["--data", datos]
    orden.append(url)
    ultimo = ""
    for intento in range(1, reintentos + 1):
        r = subprocess.run(orden, capture_output=True)
        if r.returncode == 0:
            return r.stdout.decode("utf-8", "replace")
        ultimo = r.stderr.decode("utf-8", "replace").strip()
        time.sleep(2 * intento)
    raise RuntimeError(f"curl falló para {url}: {ultimo[:200]}")


def curl_bytes(url: str, *, cabeceras: list[str] | None = None, max_seg: int = 300, reintentos: int = 4) -> bytes:
    orden = ["curl", "-sS", "-L", "--fail", "-m", str(max_seg)]
    for c in cabeceras or []:
        orden += ["-H", c]
    orden.append(url)
    ultimo = ""
    for intento in range(1, reintentos + 1):
        r = subprocess.run(orden, capture_output=True)
        if r.returncode == 0:
            return r.stdout
        ultimo = r.stderr.decode("utf-8", "replace").strip()
        time.sleep(2 * intento)
    raise RuntimeError(f"curl falló para {url}: {ultimo[:200]}")


# --------------------------------------------------------------------------- sumas
def md5_archivo(ruta: Path) -> str:
    h = hashlib.md5()
    with open(ruta, "rb") as f:
        for bloque in iter(lambda: f.read(1 << 20), b""):
            h.update(bloque)
    return h.hexdigest().upper()


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def md5_publicados(ruta_lista: Path) -> dict[str, str]:
    """Lee una lista de sumas del PDS (`MD5  ruta\\archivo`) y devuelve {nombre_de_archivo_en_minúsculas: md5}."""
    sumas: dict[str, str] = {}
    if not ruta_lista.exists():
        return sumas
    for linea in ruta_lista.read_text(encoding="latin-1").splitlines():
        partes = linea.split(None, 1)
        if len(partes) == 2 and re.fullmatch(r"[0-9A-Fa-f]{32}", partes[0]):
            sumas[partes[1].strip().replace("\\", "/").lower()] = partes[0].upper()
    return sumas


# --------------------------------------------------------------------------- etiquetas PDS3
def leer_etiqueta_pds3(ruta: Path) -> dict[str, str]:
    """Lector mínimo de etiquetas PDS3: devuelve {CLAVE: valor} (la última aparición gana, salvo
    las claves de OBJECT = IMAGE, que se guardan también con el prefijo `IMAGE.`).

    Basta para lo que necesitamos: LINES, LINE_SAMPLES, SAMPLE_TYPE, SAMPLE_BITS, SCALING_FACTOR,
    OFFSET, MISSING_CONSTANT, MAP_RESOLUTION, CENTER_LONGITUDE, PRODUCT_ID, DATA_SET_ID…
    """
    texto = Path(ruta).read_text(encoding="latin-1")
    texto = re.sub(r"/\*.*?\*/", "", texto, flags=re.S)
    valores: dict[str, str] = {}
    pila: list[str] = []
    clave = None
    for linea in texto.splitlines():
        m = re.match(r"^\s*([A-Z^][A-Z0-9_:^]*)\s*=\s*(.*?)\s*$", linea)
        if m:
            clave, valor = m.group(1), m.group(2)
            if clave == "OBJECT":
                pila.append(valor)
                continue
            if clave == "END_OBJECT":
                if pila:
                    pila.pop()
                continue
            valores[clave] = valor
            if pila:
                valores[f"{pila[-1]}.{clave}"] = valor
        elif clave and linea.strip() and not linea.strip().startswith("END"):
            # continuación de un valor de varias líneas
            valores[clave] = (valores[clave] + " " + linea.strip()).strip()
            if pila:
                valores[f"{pila[-1]}.{clave}"] = valores[clave]
    return valores


def numero(valor: str) -> float:
    """Extrae el número de un valor de etiqueta como `16 <pix/deg>` o `1737400.`"""
    m = re.search(r"-?\d+(?:\.\d*)?(?:[eE][-+]?\d+)?", valor)
    if not m:
        raise ValueError(f"sin número en {valor!r}")
    return float(m.group(0))


def limpio(valor: str) -> str:
    return valor.strip().strip('"').strip("'").strip()


# --------------------------------------------------------------------------- manifiesto de capas
def _cargar_manifiesto() -> dict:
    if MANIFIESTO.exists():
        return json.loads(MANIFIESTO.read_text(encoding="utf-8"))
    return {"esquema": 1, "capas": {}}


def registrar_capa(ident: str, datos, meta: dict) -> dict:
    """Escribe `datos` (numpy array 2D, C-order, little-endian) en web/data y lo anota en capas.json.

    `meta` debe traer: cuerpo, variable, nombre, unidades, archivo, lat_centro_0, dlat,
    lon_centro_0, dlon, lon_ciclica, escala, desplazamiento, sin_dato, resolucion, procesado, fuente.
    """
    import numpy as np  # import perezoso: solo los scripts de conversión necesitan numpy

    WEB_DATOS.mkdir(parents=True, exist_ok=True)
    a = np.ascontiguousarray(datos)
    if a.dtype.byteorder == ">":
        a = a.byteswap().view(a.dtype.newbyteorder("<"))
    crudo = a.tobytes()
    (WEB_DATOS / meta["archivo"]).write_bytes(crudo)

    sin_dato = meta.get("sin_dato")
    fisico = a.astype(np.float64) * meta.get("escala", 1) + meta.get("desplazamiento", 0)
    validos = np.ones(a.shape, bool) if sin_dato is None else (a != sin_dato)
    if a.dtype.kind == "f":
        validos &= np.isfinite(a)
    nv = int(validos.sum())
    estad = {"validos": nv, "total": int(a.size)}
    if nv:
        v = fisico[validos]
        estad.update(min=round(float(v.min()), 4), max=round(float(v.max()), 4), media=round(float(v.mean()), 4))

    entrada = dict(meta)
    entrada.update(tipo=str(a.dtype.name), filas=int(a.shape[0]), columnas=int(a.shape[1]),
                   bytes=len(crudo), sha256=sha256_bytes(crudo), estadisticas=estad,
                   generado=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    man = _cargar_manifiesto()
    man["capas"][ident] = entrada
    man["actualizado"] = entrada["generado"]
    MANIFIESTO.write_text(json.dumps(man, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"  capa {ident}: {meta['archivo']} {a.shape} {a.dtype.name} · válidos {nv:,}/{a.size:,}"
          + (f" · min {estad['min']} · max {estad['max']}" if nv else ""))
    return entrada


def quitar_capa(ident: str) -> None:
    man = _cargar_manifiesto()
    if ident in man["capas"]:
        archivo = WEB_DATOS / man["capas"][ident]["archivo"]
        del man["capas"][ident]
        MANIFIESTO.write_text(json.dumps(man, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        if archivo.exists():
            archivo.unlink()


def exigir(condicion: bool, mensaje: str) -> None:
    """Comprobación dura: si un dato no cuadra con lo publicado, el script se detiene."""
    if not condicion:
        print(f"ERROR DE VERIFICACIÓN: {mensaje}", file=sys.stderr)
        raise SystemExit(2)
