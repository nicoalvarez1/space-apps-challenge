"""Inventario legible por máquina de las fuentes que usa el motor (ver INVENTARIO_RECURSOS.md).

Cada resultado copia la entrada de su fuente, para que se sepa de dónde procede cada dato.
`verificacion` sigue la convención del inventario: V = verificado en metadatos o en el archivo;
D = según la documentación (el cargador lo comprueba al leer).
"""
from __future__ import annotations

RECURSO_OFICIAL = ("https://www.spaceappschallenge.org/2026/challenges/"
                   "permanent-moon-base-locations-and-mars/?tab=resources")

PDS_GEO = "https://pds-geosciences.wustl.edu"
LOLA_GDR = f"{PDS_GEO}/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr"
MOLA = f"{PDS_GEO}/mgs/urn-nasa-pds-mgs_mola_topography_derived"

FUENTES: dict[str, dict] = {
    "lola_gdr_16ppd": {
        "citas": [
            "Smith, D. E. (producer) (2019). LRO LOLA Gridded Data Record, LRO-L-LOLA-4-GDR-V1.0, product LDEM_16 V3.1. "
            "NASA Planetary Data System, PDS Geosciences Node. https://pds-geosciences.wustl.edu/missions/lro/lola.htm",
            "Smith, D. E. et al. (2010). The Lunar Orbiter Laser Altimeter investigation on the Lunar Reconnaissance "
            "Orbiter mission. Space Science Reviews, 150, 209–241. https://doi.org/10.1007/s11214-009-9512-y",
        ],
        "nombre": "LRO LOLA Gridded Data Record LDEM_16 (+ LDEC_16)",
        "agencia": "NASA (LRO / LOLA Science Team, GSFC); archivo PDS Geosciences Node",
        "recurso_oficial": "NASA Lunar Reconnaissance Orbiter (LRO) → PDS Geosciences Node",
        "cuerpo": "moon",
        "url": f"{LOLA_GDR}/cylindrical/img/ldem_16.img",
        "variables": {"altura": "m (DN × 0,5)", "conteos": "disparos LOLA por celda"},
        "resolucion": "16 px/° = 1895,21 m/px en el ecuador",
        "cobertura": "global",
        "coordenadas": "cilíndrica simple, planetocéntrica, longitud este 0–360°, esfera 1737,4 km",
        "referencia_vertical": "altura sobre la esfera de 1737,4 km (no el geoide lunar)",
        "incertidumbre": "LDEC_16 = 0 indica altura interpolada por GMT surface; sin cifra de exactitud en la etiqueta",
        "formato": "PDS3 IMG, int16 LSB",
        "acceso": "HTTPS público, sin cuenta",
        "version": "V3.1; datos 2009-07-13 → 2016-11-29; producto 2019-03-15",
        "verificacion": "V",
    },
    "lola_gdr_polar": {
        "citas": [
            "Smith, D. E. (producer) (2017). LRO LOLA Gridded Data Record, LRO-L-LOLA-4-GDR-V1.0, product LDEM_75S_240M / LDEM_75N_240M. "
            "NASA Planetary Data System, PDS Geosciences Node. https://pds-geosciences.wustl.edu/missions/lro/lola.htm",
            "Smith, D. E. et al. (2010). The Lunar Orbiter Laser Altimeter investigation on the Lunar Reconnaissance "
            "Orbiter mission. Space Science Reviews, 150, 209–241. https://doi.org/10.1007/s11214-009-9512-y",
        ],
        "nombre": "LRO LOLA Gridded Data Record polar (LDEM_<lat><N|S>_<escala>M + LDEC)",
        "agencia": "NASA (LRO / LOLA Science Team, GSFC); archivo PDS Geosciences Node",
        "recurso_oficial": "NASA Lunar Reconnaissance Orbiter (LRO) → PDS Geosciences Node",
        "cuerpo": "moon",
        "url": f"{LOLA_GDR}/polar/img/",
        "variables": {"altura": "m (DN × 0,5)", "conteos": "disparos LOLA por celda"},
        "resolucion": "5–400 m/px según el producto (MAP_SCALE exacto en el polo)",
        "cobertura": "casquete polar desde la latitud del nombre del producto",
        "coordenadas": ("estereográfica polar sobre esfera de 1737,4 km; fórmulas de DSMAP_POLAR.CAT: "
                        "X=(I−N/2−0,5)·s, Y=(J−N/2−0,5)·s·NS, LON=atan2(X,Y), "
                        "LAT=±(90−2·atan(R/2·1737400))"),
        "referencia_vertical": "altura sobre la esfera de 1737,4 km",
        "incertidumbre": "LDEC = 0 indica interpolación",
        "formato": "PDS3 IMG, int16 LSB",
        "acceso": "HTTPS público, sin cuenta",
        "version": "LDEM_80S_80M: datos hasta 2017-02-02; producto 2017-06-15",
        "verificacion": "V",
    },
    "mola_megdr_16ppd": {
        "citas": [
            "Smith, D. E. et al. (2003). MGS MOLA Mission Experiment Gridded Data Record, MGS-M-MOLA-5-MEGDR-L3-V1.0, "
            "product MEGT90N000EB v2.0. NASA Planetary Data System, PDS Geosciences Node. "
            "https://pds-geosciences.wustl.edu/missions/mgs/mola.html",
            "Smith, D. E. et al. (2001). Mars Orbiter Laser Altimeter: Experiment summary after the first year of global "
            "mapping of Mars. Journal of Geophysical Research, 106(E10), 23689–23722. https://doi.org/10.1029/2000JE001364",
        ],
        "nombre": "MGS MOLA Mission Experiment Gridded Data Record MEGT90N000EB (+ MEGC, MEGR)",
        "agencia": "NASA (MGS / MOLA Science Team, GSFC); archivo PDS Geosciences Node",
        "recurso_oficial": "NASA Planetary Data System (PDS)",
        "cuerpo": "mars",
        "url": f"{MOLA}/meg016/megt90n000eb.img",
        "variables": {"topografia": "m (radio − areoide)", "conteos": "disparos MOLA por celda"},
        "resolucion": "16 px/° = 3,705 km/px en el ecuador",
        "cobertura": "global",
        "coordenadas": "cilíndrica simple, planetocéntrica, longitud este, esfera 3396 km",
        "referencia_vertical": "areoide GMM3 (mgm1025) hasta grado y orden 50",
        "incertidumbre": ("en el ecuador ~55 % de las celdas con ≥ 1 disparo y huecos de hasta 12 km "
                          "entre trazas; celdas sin disparo = valor interpolado (etiqueta MEGT)"),
        "formato": "PDS3 IMG, int16 MSB",
        "acceso": "HTTPS público, sin cuenta",
        "version": "v2.0; datos 1997-09-15 → 2001-06-30; producto 2003-04-03",
        "verificacion": "V",
    },
    "srtmgl30": {
        "citas": [
            "NASA JPL (2013). NASA Shuttle Radar Topography Mission Global 30 arc second V002 [data set]. "
            "NASA Land Processes Distributed Active Archive Center. https://doi.org/10.5067/MEASURES/SRTM/SRTMGL30.002",
        ],
        "nombre": "NASA Shuttle Radar Topography Mission Global 30 arc second V002 (SRTMGL30)",
        "agencia": "NASA / NGA; distribuye NASA LP DAAC",
        "recurso_oficial": "NASA Earthdata Search",
        "cuerpo": "earth",
        "cmr": "C2763266346-LPCLOUD",
        "doi": "10.5067/MEaSUREs/SRTM/SRTMGL30.002",
        "url": "https://data.lpdaac.earthdatacloud.nasa.gov/lp-prod-protected/SRTMGL30.002/",
        "variables": {"altura": "m"},
        "resolucion": "30″ (≈ 926 m en latitud)",
        "cobertura": "27 teselas de 90°N a 60°S (no incluye la Antártida)",
        "coordenadas": "geográficas WGS84",
        "referencia_vertical": "geoide EGM96 (documentación LP DAAC; se lee de la cabecera cuando consta)",
        "incertidumbre": "sin mapa de nº de observaciones; al norte de 60°N procede de fuentes no SRTM (GTOPO30)",
        "formato": "int16 big-endian sin cabecera (un .DEM por zip, 6000×4800); geometría del nombre + guía de "
                   "usuario §2.1.4 + caja CMR de cada gránulo. El mar viene como 0 m, sin valor propio",
        "acceso": "HTTPS con Earthdata Login (cuenta gratuita; credenciales en ~/.netrc)",
        "version": "V002; adquisición SRTM 2000-02-11",
        "verificacion": "V (colección, granulos, acceso; formato interno: tamaño, caja CMR, orden de bytes y vacío "
                        "comprobados en los 27 archivos); D (registro por celda: lo fija la caja CMR, no los valores)",
    },
    "srtmswbd": {
        "citas": [
            "NASA JPL (2013). NASA Shuttle Radar Topography Mission Water Body Data Shapefiles & Raster Files V003 "
            "[data set]. NASA Land Processes Distributed Active Archive Center. "
            "https://doi.org/10.5067/MEaSUREs/SRTM/SRTMSWBD.003",
        ],
        "nombre": "NASA Shuttle Radar Topography Mission Water Body Data Shapefiles & Raster Files V003 (SRTMSWBD)",
        "agencia": "NASA JPL / NGA (SRTM Water Body Database, máscara con la que NGA editó SRTM v2); distribuye NASA LP DAAC",
        "recurso_oficial": "NASA Earthdata Search",
        "cuerpo": "earth",
        "cmr": "C2763268445-LPCLOUD",
        "doi": "10.5067/MEaSUREs/SRTM/SRTMSWBD.003",
        "url": "https://data.lpdaac.earthdatacloud.nasa.gov/lp-prod-protected/SRTMSWBD.003/",
        "variables": {"agua": "píxel de 1″: 255 = agua, 0 = tierra (comprobado frente a SRTMGL30)"},
        "resolucion": "1″ (≈ 31 m); el motor la agrega a la rejilla de 30″ de SRTMGL30 como fracción de agua por celda",
        "cobertura": ("60°N–56°S (caja de la colección en CMR); 12 229 teselas de 1°. Faltan teselas: las 2068 de "
                      "SRTMGL3 sin gránulo son casi todas tierra sin agua (2048 sin ninguna celda a 0 m en SRTMGL30), "
                      "pero dos son sobre todo mar (s11w139, n59e170), y sobre océano abierto no hay tesela"),
        "coordenadas": "geográficas WGS84",
        "referencia_vertical": "no aplica (máscara)",
        "incertidumbre": ("máscara binaria sin medida de exactitud; fecha de referencia SRTM (febrero de 2000). Uso en "
                          "el motor: celda de 30″ sin dato si fracción de agua > data_loader.UMBRAL_AGUA (0,5)"),
        "formato": ("zip con un único NnnEeee.raw: 3601×3601 bytes uint8 sin cabecera, fila 0 al norte, registro por "
                    "nodo (las líneas de borde se repiten en la tesela vecina). Tamaño en la guía de usuario (tabla 1); "
                    "valores, orientación y registro comprobados con los datos"),
        "acceso": ("HTTPS con Earthdata Login (cuenta gratuita; credenciales en ~/.netrc); 371 MB en total. Se guarda "
                   "FUERA del repositorio, en $SRTMSWBD_DIR (por defecto ~/.cache/landfall/srtmswbd), porque sus "
                   "12 229 archivos harían recargar sin parar el servidor de desarrollo de la web"),
        "version": "V003; publicación 2013-11-20; adquisición SRTM 2000-02-11 → 2000-02-21",
        "verificacion": ("V (colección, DOI, 12 229 gránulos, cajas CMR, acceso; formato en las 12 229 teselas: "
                         "3601×3601 bytes y solo valores 0/255; registro por nodo: 0 píxeles distintos en las líneas "
                         "compartidas de 20 918 pares de vecinas, frente a 63 035 en la línea adyacente; 255 = agua y "
                         "orientación: el 95 % de las celdas de 30″ con agua plena valen 0 m en SRTMGL30 frente al "
                         "0,1 % de las celdas sin agua, y el índice de Jaccard agua/0 m es máximo sin desplazar). La guía "
                         "de usuario solo da el tamaño 3601/3601 (tabla 1): el resto se comprueba con los datos"),
    },
    "srtmgl3": {
        "nombre": "NASA Shuttle Radar Topography Mission Global 3 arc second V003 (SRTMGL3)",
        "agencia": "NASA JPL / NGA; distribuye NASA LP DAAC",
        "recurso_oficial": "NASA Earthdata Search",
        "cuerpo": "earth",
        "doi": "10.5067/MEaSUREs/SRTM/SRTMGL3.003",
        "citas": [
            "NASA JPL (2013). NASA Shuttle Radar Topography Mission Global 3 arc second V003 [data set]. "
            "NASA Land Processes Distributed Active Archive Center. https://doi.org/10.5067/MEaSUREs/SRTM/SRTMGL3.003",
        ],
        "resolucion": "3″ (≈ 93 m)",
        "cobertura": "60°N–56°S, sin teselas sobre océano abierto",
        "acceso": "HTTPS con Earthdata Login",
        "uso": "comparación detallada (escala fina)",
        "verificacion": "V (colección, DOI, nombres de los granulos)",
    },
    "nasadem_hgt": {
        "citas": [
            "Buckley, S. (2020). NASADEM Merged DEM Global 1 arc second V001 [data set]. NASA Land Processes "
            "Distributed Active Archive Center. https://doi.org/10.5067/MEASURES/NASADEM/NASADEM_HGT.001",
        ],
        "nombre": "NASADEM Merged DEM Global 1 arc second V001",
        "agencia": "NASA JPL; distribuye NASA LP DAAC",
        "recurso_oficial": "NASA Earthdata Search",
        "cuerpo": "earth",
        "cmr": "C2763264762-LPCLOUD",
        "doi": "10.5067/MEASURES/NASADEM/NASADEM_HGT.001",
        "resolucion": "1″ (≈ 31 m)",
        "cobertura": "60°N–56°S",
        "acceso": "HTTPS con Earthdata Login",
        "uso": "comparación detallada (escala más fina)",
        "verificacion": "V (colección y acceso)",
    },
}


def fuente(clave: str) -> dict:
    out = dict(FUENTES[clave])
    out["clave"] = clave
    out["listado_en"] = RECURSO_OFICIAL
    return out
