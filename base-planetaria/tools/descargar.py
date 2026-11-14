#!/usr/bin/env python3
"""Descarga y verifica los archivos originales (PDS) que usa la herramienta.

Uso:
    python3 tools/descargar.py                 # lista los grupos
    python3 tools/descargar.py mola lola grs   # baja esos grupos
    python3 tools/descargar.py todo            # baja todo (≈3,2 GB; Diviner son 2,8 GB)
    python3 tools/descargar.py --comprobar     # solo comprueba MD5 de lo ya descargado

Solo usa la biblioteca estándar y `curl`. No pide ni guarda credenciales: todas las URL son públicas.
"""
from __future__ import annotations

import sys
from concurrent.futures import ThreadPoolExecutor

from comun import DATOS, descargar, md5_archivo
from fuentes import GRUPOS


def bajar_grupo(nombre: str, paralelo: int = 3) -> None:
    g = GRUPOS[nombre]
    print(f"[{nombre}] {g['descripcion']}")
    with ThreadPoolExecutor(max_workers=paralelo) as ex:
        list(ex.map(lambda a: descargar(a["url"], DATOS / a["destino"], md5=a["md5"]), g["archivos"]))


def comprobar() -> int:
    fallos = 0
    for nombre, g in GRUPOS.items():
        for a in g["archivos"]:
            ruta = DATOS / a["destino"]
            if not ruta.exists():
                print(f"  falta        {a['destino']}")
                continue
            if not a["md5"]:
                print(f"  sin MD5 pub. {a['destino']} ({ruta.stat().st_size:,} bytes)")
                continue
            ok = md5_archivo(ruta) == a["md5"].upper()
            fallos += not ok
            print(f"  {'MD5 OK      ' if ok else 'MD5 DISTINTO'} {a['destino']}")
    return fallos


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        print("Grupos disponibles:")
        for n, g in GRUPOS.items():
            print(f"  {n:8s} {g['descripcion']}")
        return 0
    if argv[0] == "--comprobar":
        return 1 if comprobar() else 0
    nombres = list(GRUPOS) if argv == ["todo"] else argv
    for n in nombres:
        if n not in GRUPOS:
            print(f"Grupo desconocido: {n}. Opciones: {', '.join(GRUPOS)}")
            return 2
    for n in nombres:
        bajar_grupo(n)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
