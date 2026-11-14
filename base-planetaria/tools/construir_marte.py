#!/usr/bin/env python3
"""Convierte los productos PDS de Marte en capas ligeras para la web.

Entradas (datos_pds/, se bajan con `python3 tools/descargar.py mola grs tes`):
  MOLA MEGDR 16 px/grado  -> elevación 8 px/grado (`mola_elev_8ppd.bin`) y nº de disparos
  Odyssey GRS 5°×5°       -> H2O, Fe, Si, Cl, K, Th (concentración y su error)
  TES inercia térmica     -> 4 px/grado (solo píxeles medidos, no interpolados)

Cada paso lee la geometría de la etiqueta PDS (no la presupone) y comprueba el resultado
contra valores de referencia. Requiere numpy.
"""
from __future__ import annotations

import sys

import numpy as np

from comun import DATOS, exigir, leer_etiqueta_pds3, limpio, numero, registrar_capa
from fuentes import GRS, GRUPOS, MOLA, TES

R_MARTE_M = 3_396_000.0  # A_AXIS_RADIUS de la etiqueta MEGDR (esfera de proyección)


def leer_img(nombre_base: str, carpeta: str):
    """Lee una imagen PDS3 de 8/16 bits usando su etiqueta. Devuelve (array 2D, etiqueta)."""
    et = leer_etiqueta_pds3(DATOS / carpeta / f"{nombre_base}.lbl")
    lineas, muestras = int(numero(et["IMAGE.LINES"])), int(numero(et["IMAGE.LINE_SAMPLES"]))
    bits = int(numero(et["IMAGE.SAMPLE_BITS"]))
    tipo = limpio(et["IMAGE.SAMPLE_TYPE"])
    orden = {"MSB_INTEGER": ">", "LSB_INTEGER": "<"}[tipo]
    dtype = np.dtype(f"{orden}i{bits // 8}") if bits > 8 else np.dtype("u1")
    ruta = DATOS / carpeta / f"{nombre_base}.img"
    exigir(ruta.stat().st_size == lineas * muestras * dtype.itemsize,
           f"{ruta.name}: tamaño {ruta.stat().st_size} ≠ {lineas}×{muestras}×{dtype.itemsize} de la etiqueta")
    return np.fromfile(ruta, dtype=dtype).reshape(lineas, muestras), et


def _md5(grupo: str, destino: str) -> str | None:
    return next((a["md5"] for a in GRUPOS[grupo]["archivos"] if a["destino"] == destino), None)


# --------------------------------------------------------------------------- MOLA
def construir_mola() -> None:
    print("[MOLA] elevación = radio medio (MEGR) − areoide (MEGA), 16 → 8 px/grado")
    megr, et_r = leer_img("megr90n000eb", "mola_meg016")
    mega, et_a = leer_img("mega90n000eb", "mola_meg016")
    megt, et_t = leer_img("megt90n000eb", "mola_meg016")
    megc, _ = leer_img("megc90n000eb", "mola_meg016")
    for et in (et_r, et_a, et_t):
        exigir(numero(et["MAP_RESOLUTION"]) == 16 and numero(et["WESTERNMOST_LONGITUDE"]) == 0
               and numero(et["MAXIMUM_LATITUDE"]) == 90, "geometría MEGDR inesperada")
    # MEGR y MEGA comparten OFFSET = 3 396 000 m y SCALING_FACTOR = 1, así que la resta de los DN ya es metros.
    exigir(numero(et_r["IMAGE.OFFSET"]) == numero(et_a["IMAGE.OFFSET"]) == 3396000
           and numero(et_r["IMAGE.SCALING_FACTOR"]) == numero(et_a["IMAGE.SCALING_FACTOR"]) == 1,
           "OFFSET/SCALING_FACTOR de MEGR y MEGA no coinciden")

    topo16 = megr.astype(np.int32) - mega.astype(np.int32)                  # metros sobre el areoide
    # media de cada bloque 2×2 (4 celdas de 1/16°) y redondeo al entero más próximo (mitades al par)
    topo8 = np.rint(topo16.reshape(1440, 2, 2880, 2).mean(axis=(1, 3))).astype("<i2")
    disparos8 = megc.astype(np.int32).reshape(1440, 2, 2880, 2).sum(axis=(1, 3))

    # --- comprobaciones con los valores de referencia del enunciado (celda que contiene el punto)
    def celda(lat, lon):
        return int(topo8[int((90 - lat) * 8), int((lon % 360) * 8)])
    refs = {"Olympus Mons (18,65°N 226,2°E)": ((18.65, 226.2), 19963), "Hellas (42,4°S 70,5°E)": ((-42.4, 70.5), -6062),
            "Valles Marineris (13,9°S 300,8°E)": ((-13.9, 300.8), -1645), "Ecuador (0°, 0°E)": ((0.0, 0.0), -1530)}
    for nombre, ((lat, lon), esperado) in refs.items():
        exigir(celda(lat, lon) == esperado, f"{nombre}: {celda(lat, lon)} m ≠ {esperado} m")
        print(f"  ✔ {nombre}: {esperado} m")

    # --- diferencia con la topografía oficial (mediana) para documentarla
    d16 = topo16 - megt.astype(np.int32)
    megt8 = megt.astype(np.int32).reshape(1440, 2, 2880, 2).mean(axis=(1, 3))
    d8 = topo8 - megt8
    difer = {"celdas_16ppd_iguales_pct": round(100 * float((d16 == 0).mean()), 2),
             "dif_16ppd_min_m": int(d16.min()), "dif_16ppd_max_m": int(d16.max()),
             "dif_8ppd_abs_p50_m": round(float(np.percentile(np.abs(d8), 50)), 1),
             "dif_8ppd_abs_p99_m": round(float(np.percentile(np.abs(d8), 99)), 1),
             "dif_8ppd_abs_max_m": round(float(np.abs(d8).max()), 1)}
    print(f"  (radio−areoide) frente a MEGT (mediana): {difer}")

    fuente = {
        "mision": "Mars Global Surveyor · MOLA", "dataset": limpio(et_r["DATA_SET_ID"]),
        "productos": ["MEGR90N000EB.IMG (radio medio)", "MEGA90N000EB.IMG (areoide)"],
        "urls": [f"{MOLA}/meg016/megr90n000eb.img", f"{MOLA}/meg016/mega90n000eb.img",
                 f"{MOLA}/meg016/megr90n000eb.lbl", f"{MOLA}/meg016/mega90n000eb.lbl"],
        "md5_originales": {"megr90n000eb.img": _md5("mola", "mola_meg016/megr90n000eb.img"),
                           "mega90n000eb.img": _md5("mola", "mola_meg016/mega90n000eb.img")},
        "cita": "Smith, D. E. et al., MGS MOLA Mission Experiment Gridded Data Record (MEGDR), "
                "NASA Planetary Data System, MGS-M-MOLA-5-MEGDR-L3-V1.0, 2003.",
    }
    geo = dict(lat_centro_0=90 - 0.5 / 8, dlat=-1 / 8, lon_centro_0=0.5 / 8, dlon=1 / 8, lon_ciclica=True,
               resolucion="0,125° (≈7,4 km en el ecuador)")
    registrar_capa("mars_elev", topo8, dict(
        cuerpo="mars", variable="elevacion", nombre="Elevación sobre el areoide", unidades="m",
        archivo="mola_elev_8ppd.bin", escala=1, desplazamiento=0, sin_dato=None, **geo,
        procesado="Elevación = radio medio (MEGR) − radio del areoide (MEGA), ambos a 1/16°. "
                  "Media de cada bloque 2×2 → 1/8°, redondeada al metro (mitades al par). "
                  "Fila 0 = 90°N, columna 0 = 0°E; lat = 90 − (i+0,5)/8; lon = (j+0,5)/8.",
        nota="No es idéntica a MEGT (topografía MEDIANA oficial): MEGR es la MEDIA del radio en la celda. "
             f"Comparación a 1/8°: |dif| mediana {difer['dif_8ppd_abs_p50_m']} m, p99 {difer['dif_8ppd_abs_p99_m']} m, "
             f"máx {difer['dif_8ppd_abs_max_m']} m (en escarpes).",
        comparacion_megt=difer, fuente=fuente))

    exigir(int(disparos8.max()) < 65536, "nº de disparos fuera de uint16")
    registrar_capa("mars_disparos", np.minimum(disparos8, 255).astype("u1"), dict(
        cuerpo="mars", variable="disparos", nombre="Disparos MOLA en la celda", unidades="disparos (tope 255)",
        archivo="mola_disparos_8ppd.bin", escala=1, desplazamiento=0, sin_dato=None, **geo,
        procesado="Suma de MEGC (disparos por celda de 1/16°) en cada bloque 2×2; se guarda con tope 255. "
                  "0 = la elevación de la celda es interpolada (ningún disparo).",
        fuente=dict(fuente, productos=["MEGC90N000EB.IMG (nº de observaciones)"],
                    urls=[f"{MOLA}/meg016/megc90n000eb.img", f"{MOLA}/meg016/megc90n000eb.lbl"],
                    md5_originales={"megc90n000eb.img": _md5("mola", "mola_meg016/megc90n000eb.img")})))
    print(f"  celdas de 1/8° sin ningún disparo (interpoladas): {100 * float((disparos8 == 0).mean()):.2f} %")


# --------------------------------------------------------------------------- GRS
ELEMENTOS_GRS = {
    "h2o": ("agua", "Agua equivalente (H2O) en el primer metro", "% en peso"),
    "fe": ("hierro", "Hierro (Fe)", "% en peso"),
    "si": ("silicio", "Silicio (Si)", "% en peso"),
    "cl": ("cloro", "Cloro (Cl)", "% en peso"),
    "k": ("potasio", "Potasio (K)", "% en peso"),
    "th": ("torio", "Torio (Th)", "ppm"),
}


def construir_grs() -> None:
    print("[GRS] concentraciones elementales 5°×5° (suavizadas)")
    for el, (variable, nombre, _unid) in ELEMENTOS_GRS.items():
        et = leer_etiqueta_pds3(DATOS / "odyssey_grs" / f"{el}_sr_5x5.lbl")
        filas = int(numero(et["TABLE.ROWS"]))
        exigir(int(numero(et["TABLE.COLUMNS"])) == 5, f"{el}: se esperaban 5 columnas")
        texto_et = (DATOS / "odyssey_grs" / f"{el}_sr_5x5.lbl").read_text(encoding="latin-1")
        unidad = limpio(texto_et.split('NAME                       = "CONCENTRATION"')[1].split("UNIT")[1].split("=")[1].split("\n")[0])
        unid = {"WEIGHT PERCENT": "% en peso", "PARTS PER MILLION": "ppm"}[unidad.upper()]
        na = 9999.999
        conc = np.full((36, 72), np.nan, "<f4")
        sigma = np.full((36, 72), np.nan, "<f4")
        n = 0
        con_cfs = sin_cfs = 0
        vistas = set()
        for linea in (DATOS / "odyssey_grs" / f"{el}_sr_5x5.tab").read_text(encoding="ascii").splitlines():
            if not linea.strip():
                continue
            lat, lon, c, s, s_cfs = (float(x) for x in linea.split())
            n += 1
            i = round((87.5 - lat) / 5)
            j = round((((lon + 180) % 360) - 180 + 177.5) / 5)      # columnas de −177,5° a +177,5°E
            exigir(0 <= i < 36 and 0 <= j < 72 and (i, j) not in vistas, f"{el}: celda repetida o fuera de rango ({lat}, {lon})")
            vistas.add((i, j))
            if c != na:
                conc[i, j] = c
                if s_cfs != na:                      # error que incluye los factores de corrección
                    sigma[i, j] = s_cfs
                    con_cfs += 1
                elif s != na:                        # K y Th no traen esa columna: se usa SIGMA
                    sigma[i, j] = s
                    sin_cfs += 1
        exigir(con_cfs == 0 or sin_cfs == 0, f"{el}: mezcla de columnas de error")
        col_sigma = "SIGMA WITH CFS (error con factores de corrección)" if con_cfs else "SIGMA (la columna SIGMA WITH CFS no aplica a este elemento)"
        exigir(n == filas == 2592, f"{el}: {n} filas leídas ≠ {filas} de la etiqueta")
        fuente = {
            "mision": "2001 Mars Odyssey · Gamma Ray Spectrometer", "dataset": limpio(et["DATA_SET_ID"]),
            "productos": [f"{limpio(et['PRODUCT_ID'])}.TAB"],
            "urls": [f"{GRS}/data/smoothed/{el}_sr_5x5.tab", f"{GRS}/data/smoothed/{el}_sr_5x5.lbl"],
            "md5_originales": {f"{el}_sr_5x5.tab": _md5("grs", f"odyssey_grs/{el}_sr_5x5.tab")},
            "cita": "Boynton, W. V. et al. (2007), Concentration of H, Si, Cl, K, Fe, and Th in the low- and "
                    "mid-latitude regions of Mars, J. Geophys. Res., 112, E12S99, doi:10.1029/2007JE002887. "
                    "Datos: ODY-M-GRS-5-ELEMENTS-V1.0, NASA PDS.",
        }
        geo = dict(lat_centro_0=87.5, dlat=-5.0, lon_centro_0=-177.5, dlon=5.0, lon_ciclica=True,
                   resolucion="5° × 5° (≈300 km), suavizado con ventana de 10°")
        proc = ("Copia de la columna CONCENTRATION de la tabla PDS (9999.999 = sin dato → NaN). "
                "La tabla ya viene suavizada con una ventana de 10° y rebineada a 5°. Sin interpolar.")
        registrar_capa(f"mars_{el}", conc, dict(
            cuerpo="mars", variable=variable, nombre=nombre, unidades=unid,
            archivo=f"grs_{el}_5deg.bin", escala=1, desplazamiento=0, sin_dato=None, **geo, procesado=proc, fuente=fuente))
        registrar_capa(f"mars_{el}_sigma", sigma, dict(
            cuerpo="mars", variable=f"{variable}_sigma", nombre=f"Incertidumbre de {nombre}",
            unidades=unid,
            archivo=f"grs_{el}_sigma_5deg.bin", escala=1, desplazamiento=0, sin_dato=None, **geo,
            procesado=f"Columna {col_sigma} de la misma tabla.", fuente=fuente))


# --------------------------------------------------------------------------- TES
def construir_tes() -> None:
    print("[TES] inercia térmica nocturna 20 → 4 px/grado (solo píxeles medidos)")
    ti, et = leer_img("global_ti_night_2007", "tes_timap")
    mk, _ = leer_img("global_ti_msk_night_2007", "tes_timap")
    exigir(numero(et["MAP_RESOLUTION"]) == 20 and numero(et["WESTERNMOST_LONGITUDE"]) == -180
           and numero(et["MAXIMUM_LATITUDE"]) == 90, "geometría TES inesperada")
    medido = (mk != 0) & (ti > 0)                      # máscara 0 = interpolado; TI 0 = no calculado
    b = 5
    suma = np.where(medido, ti, 0).astype(np.float64).reshape(720, b, 1440, b).sum(axis=(1, 3))
    cuenta = medido.reshape(720, b, 1440, b).sum(axis=(1, 3))
    media = np.where(cuenta > 0, suma / np.maximum(cuenta, 1), 0)
    salida = np.rint(media).astype("<i2")              # 0 = sin dato (ningún píxel medido en el bloque)
    exigir(int(salida.max()) <= 5000, "inercia térmica fuera del rango 5–5000 de la etiqueta")
    registrar_capa("mars_inercia", salida, dict(
        cuerpo="mars", variable="inercia_termica", nombre="Inercia térmica nocturna (TES)",
        unidades="J m⁻² K⁻¹ s⁻¹ᐟ²", archivo="tes_inercia_noche_4ppd.bin", escala=1, desplazamiento=0, sin_dato=0,
        lat_centro_0=90 - 0.125, dlat=-0.25, lon_centro_0=-180 + 0.125, dlon=0.25, lon_ciclica=True,
        resolucion="0,25° (≈15 km en el ecuador)",
        procesado="Media, en cada bloque 5×5 del mapa de 1/20°, de los píxeles MEDIDOS "
                  "(máscara de interpolación ≠ 0 e inercia > 0). Bloques sin ningún píxel medido = sin dato.",
        nota="Rango derivado 5–5000; el mapa usa temperaturas nocturnas de 3 años marcianos (1999–2004). "
             "En latitudes polares el valor está afectado por hielos estacionales (ver DATASET.CAT).",
        fuente={
            "mision": "Mars Global Surveyor · TES", "dataset": limpio(et["DATA_SET_ID"]),
            "productos": ["GLOBAL_TI_NIGHT_2007.IMG", "GLOBAL_TI_MSK_NIGHT_2007.IMG"],
            "urls": [f"{TES}/data/global_ti_night_2007.img", f"{TES}/data/global_ti_night_2007.lbl",
                     f"{TES}/data/global_ti_msk_night_2007.img", f"{TES}/catalog/dataset.cat"],
            "md5_originales": {"global_ti_night_2007.img": _md5("tes", "tes_timap/global_ti_night_2007.img"),
                               "global_ti_msk_night_2007.img": _md5("tes", "tes_timap/global_ti_msk_night_2007.img")},
            "cita": "Putzig, N. E. y Mellon, M. T. (2007), Apparent thermal inertia and the surface heterogeneity of Mars, "
                    "Icarus, 191, 68–94. Datos: MGS-M-TES-5-TIMAP-V1.0, NASA PDS.",
        }))
    print(f"  bloques de 0,25° con algún píxel medido: {100 * float((cuenta > 0).mean()):.1f} %")


PASOS = {"mola": construir_mola, "grs": construir_grs, "tes": construir_tes}

if __name__ == "__main__":
    elegidos = sys.argv[1:] or list(PASOS)
    for p in elegidos:
        if p not in PASOS:
            sys.exit(f"Paso desconocido: {p}. Opciones: {', '.join(PASOS)}")
    for p in elegidos:
        PASOS[p]()
