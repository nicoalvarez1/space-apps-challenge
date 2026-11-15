"""CLI del motor. Ejecutar desde `base-planetaria/`:

    python -m similitud estado
    python -m similitud descargar-tierra                     # SRTMGL30 vía Earthdata Login (~/.netrc)
    python -m similitud descargar-agua                       # máscara SRTMSWBD (1″) y su agregado a 30″
    python -m similitud catalogo --buscar-en earth --objetivo mars --lado-km 200
    python -m similitud buscar --cuerpo mars --lat 18.4 --lon 77.7 --lado-km 200 --salida jezero.json
    python -m similitud comparar --cuerpo mars --lat 18.4 --lon 77.7 --lat-candidato 38.4 --lon-candidato -110.8
    python -m similitud descargar-detalle --lat 38.4 --lon -110.8 --producto srtmgl3   # 90 m, Earthdata Login
    python -m similitud servidor --puerto 8000
"""
from __future__ import annotations

import argparse
import json
import sys

from . import config


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m similitud", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="orden", required=True)
    sub.add_parser("estado")
    sub.add_parser("descargar-tierra")
    da = sub.add_parser("descargar-agua", help="máscara de agua SRTMSWBD V003 (Earthdata Login) y su agregado a 30″")
    da.add_argument("--simultaneas", type=int, default=8)
    da.add_argument("--sin-agregar", action="store_true", help="solo descargar, sin construir la rejilla de 30″")
    c = sub.add_parser("catalogo")
    c.add_argument("--buscar-en", default="earth", choices=["earth", "moon", "mars"])
    c.add_argument("--objetivo", default="mars", choices=["moon", "mars"], help="fija la resolución común h")
    c.add_argument("--producto-objetivo")
    c.add_argument("--lado-km", type=float, default=config.LADO_KM)
    b = sub.add_parser("buscar")
    b.add_argument("--cuerpo", required=True, choices=["moon", "mars"])
    b.add_argument("--lat", type=float, required=True)
    b.add_argument("--lon", type=float, required=True)
    b.add_argument("--lado-km", type=float, default=config.LADO_KM)
    b.add_argument("--k", type=int, default=10)
    b.add_argument("--buscar-en", default="earth", choices=["earth", "moon", "mars"])
    b.add_argument("--producto", help="p. ej. ldem_75s_240m para el MDE polar de LOLA")
    b.add_argument("--h-m", type=float)
    b.add_argument("--sin-validar", action="store_true")
    b.add_argument("--salida", help="archivo JSON con el resultado completo")
    cp = sub.add_parser("comparar", help="comparación detallada multiescala de un par")
    cp.add_argument("--cuerpo", required=True, choices=["moon", "mars"])
    cp.add_argument("--lat", type=float, required=True)
    cp.add_argument("--lon", type=float, required=True)
    cp.add_argument("--lat-candidato", type=float, required=True)
    cp.add_argument("--lon-candidato", type=float, required=True)
    cp.add_argument("--lado-km", type=float, default=config.LADO_KM)
    cp.add_argument("--buscar-en", default="earth", choices=["earth", "moon", "mars"])
    cp.add_argument("--producto")
    cp.add_argument("--salida")
    dd = sub.add_parser("descargar-detalle", help="teselas SRTMGL3/NASADEM de Earthdata para una ventana terrestre")
    dd.add_argument("--lat", type=float, required=True)
    dd.add_argument("--lon", type=float, required=True)
    dd.add_argument("--lado-km", type=float, default=config.LADO_KM)
    dd.add_argument("--producto", default="srtmgl3", choices=["srtmgl3", "nasadem"])
    s = sub.add_parser("servidor")
    s.add_argument("--puerto", type=int, default=8000)
    a = ap.parse_args(argv)

    from .data_loader import DatosNoDisponibles
    try:
        if a.orden == "estado":
            from .data_loader import disponibilidad
            print(json.dumps(disponibilidad(), ensure_ascii=False, indent=1))
        elif a.orden == "descargar-tierra":
            from .data_loader import construir_mosaico_srtmgl30, descargar_srtmgl30
            zips = descargar_srtmgl30()
            print(f"{len(zips)} teselas SRTMGL30; construyendo el mosaico…")
            print(construir_mosaico_srtmgl30())
        elif a.orden == "descargar-agua":
            from .data_loader import descargar_srtmswbd
            r = descargar_srtmswbd(simultaneas=a.simultaneas,
                                   progreso=lambda i, n: print(f"  {i}/{n} teselas", file=sys.stderr, flush=True))
            print(json.dumps(r, ensure_ascii=False, indent=1), flush=True)
            if r["errores"]:
                return 4
            if not a.sin_agregar:
                from .data_loader import construir_fraccion_agua
                print("Agregando a la rejilla de 30″ de SRTMGL30…", flush=True)
                print(construir_fraccion_agua())
        elif a.orden == "catalogo":
            from .data_loader import cargar
            from .preprocessing import resolucion_comun_m
            from .similarity_engine import obtener_catalogo
            r_bus, r_obj = cargar(a.buscar_en), cargar(a.objetivo, a.producto_objetivo)
            h = resolucion_comun_m(r_obj, r_bus)
            cat = obtener_catalogo(r_bus, a.lado_km, h, progreso=lambda i, n: print(f"  {i}/{n}", file=sys.stderr))
            print(json.dumps(cat.meta, ensure_ascii=False, indent=1))
        elif a.orden == "buscar":
            from .servidor import limpiar
            from .similarity_engine import buscar_analogos
            r = buscar_analogos(a.cuerpo, a.lat, a.lon, a.lado_km, a.k, a.buscar_en, a.producto, a.h_m,
                                validar=not a.sin_validar,
                                progreso=lambda i, n: print(f"  catálogo {i}/{n}", file=sys.stderr))
            for x in r["analogos"]:
                print(f"{x['rango']:2d}. {x['lat']:8.3f} {x['lon']:9.3f}  peor percentil {100 * x['peor_percentil']:5.1f} % "
                      f"({x['criterio_peor']}), dominada por {x['ventanas_que_la_dominan']}")
                print("    " + x["explicacion"])
            if a.salida:
                with open(a.salida, "w", encoding="utf-8") as f:
                    json.dump(limpiar(r), f, ensure_ascii=False, indent=1, allow_nan=False)
                print(f"Resultado completo: {a.salida}")
        elif a.orden == "comparar":
            from .comparacion import comparar
            from .servidor import limpiar
            r = comparar(a.cuerpo, a.lat, a.lon, a.lat_candidato, a.lon_candidato, a.lado_km, a.producto, a.buscar_en)
            print(f"Datos: {r['objetivo']['datos']['producto']} frente a {r['candidato']['datos']['producto']}; "
                  f"escalas {[round(h) for h in r['parametros']['escalas_m']]} m")
            for e in r["resumen_por_escala"]:
                print(f"  h = {e['h_m']:7.0f} m: {len(e['distribuciones_compatibles'])}/{e['n_distribuciones']} distribuciones "
                      f"compatibles {e['distribuciones_compatibles']}; estructura dentro de la variabilidad: "
                      f"{e['estructura_dentro_de_variabilidad']}")
            if a.salida:
                with open(a.salida, "w", encoding="utf-8") as f:
                    json.dump(limpiar(r), f, ensure_ascii=False, indent=1, allow_nan=False)
        elif a.orden == "descargar-detalle":
            from .data_loader import descargar_hgt
            print(json.dumps(descargar_hgt(a.producto, a.lat, a.lon, a.lado_km), ensure_ascii=False, indent=1))
        elif a.orden == "servidor":
            from .servidor import servir
            servir(a.puerto)
    except DatosNoDisponibles as e:
        print(f"Faltan datos: {e}", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
