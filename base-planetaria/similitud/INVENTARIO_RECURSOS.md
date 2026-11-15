# Inventario científico de los recursos oficiales — Fase 1

Desafío: *Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars* (NASA Space Apps 2026).
Auditoría realizada el 14-11-2026 leyendo directamente la pestaña **Resources**, la pestaña **Details**,
los índices del PDS Geosciences Node, la API pública de NASA CMR, el STAC de Copernicus Data Space
y el catálogo de datos de la CSA.

Convención de fiabilidad de cada dato de este documento:
- **[V]** verificado en esta auditoría (página, etiqueta PDS, metadatos CMR/STAC/CKAN leídos).
- **[D]** según la documentación del producto, aún sin leer el archivo: el cargador debe comprobarlo.
- **[?]** desconocido o no verificado: no se usará como hecho.

## 1. Qué contiene la pestaña Resources [V]

La pestaña no enumera datasets concretos: enumera **portales**. Son estos (las URL oficiales llevan
un parámetro de seguimiento `utm_source`, que aquí se omite):

| Cuerpo | Recurso | Agencia | URL | Tipo |
|---|---|---|---|---|
| Tierra | NASA Earthdata Search | NASA | https://search.earthdata.nasa.gov/ | buscador de datos (API: CMR) |
| Tierra | NASA Worldview | NASA | https://worldview.earthdata.nasa.gov/ | visor de imágenes (GIBS) |
| Luna y Marte | NASA Planetary Data System (PDS) | NASA | https://pds.nasa.gov/ | archivo planetario |
| Luna | Lunar Reconnaissance Orbiter (LRO) | NASA / PDS Geosciences Node | https://pds-geosciences.wustl.edu/missions/lro/ | archivo de la misión |
| Luna | LRO Diviner Lunar Data | NASA / PDS Geosciences Node | https://pds-geosciences.wustl.edu/missions/lro/diviner.htm | archivo del instrumento |
| Tierra | RADARSAT Constellation Mission (RCM) | CSA | https://donnees-data.asc-csa.gc.ca/en/dataset/rcm | SAR banda C |
| Tierra | RADARSAT-1 | CSA | https://donnees-data.asc-csa.gc.ca/en/dataset/radarsat1 | SAR banda C (archivo 1995–2013) |
| — | SAR Python Tutorial | CSA | https://github.com/asc-csa/Synthetic_Aperture_Radar_Tutorial | tutorial |
| Tierra | Copernicus Data Space Ecosystem | ESA / UE | https://dataspace.copernicus.eu/ | Sentinel + Copernicus DEM |
| Tierra | ESA Open Science Catalog | ESA | https://opensciencedata.esa.int/ | catálogo |
| Tierra | JAXA G-Portal | JAXA | https://gportal.jaxa.jp/ | productos de observación terrestre |

La pestaña **Details** pide: análogos para bases lunares permanentes o sitios de aterrizaje/exploración
marcianos; explicar **qué es análogo y qué no**; considerar la **escala** («un cráter, un valle… dentro de
una región mayor puede ser un análogo mucho mejor»); y reconocer lo que la Tierra no reproduce
(gravedad, vacío, atmósfera marciana, radiación). Cita expresamente «similarity metrics» como enfoque válido.

## 2. Datasets concretos identificados dentro de esos portales

### 2.1 Luna — PDS Geosciences Node (LRO)

| Dataset | Variables | Resolución | Proyección / referencia | Formato | Versión / fechas | Acceso |
|---|---|---|---|---|---|---|
| **LOLA GDR cilíndrico** `LDEM_16` (+ `LDEC_16` conteos) | altura (m); nº de disparos por celda | 16 px/° = 1895,21 m/px **[V]** | cilíndrica simple, esfera R = 1737,4 km; **altura sobre esfera, no geoide** **[V]** | PDS3 IMG int16 LSB, ×0,5 m **[V]** | V3.1, datos 2009-07-13 → 2016-11-29, creado 2019-03-15 **[V]** | HTTPS público; **ya en el repo** |
| **LOLA GDR polar** `LDEM_{45..875}{N,S}_{5..400}M` (+ `LDEC_*`) | altura; conteos | de 5 m a 400 m según producto **[V]** | estereográfica polar, centro ±90°, esfera 1737,4 km **[V]** (`LDEM_80S_80M`: 7600×7600, 80 m/px, 80–90°S) | PDS3 IMG int16 ×0,5 m **[V]** | `LDEM_80S_80M`: datos hasta 2017-02-02, creado 2017-06-15 **[V]** | HTTPS público; **no descargado** |
| LOLA `LDSM_16`, `LDRM_16` | pendiente y rugosidad propias de LOLA | 16 px/° | base de 30–240 m (la propia etiqueta es inconsistente; ver `tools/construir_luna.py`) **[V]** | PDS3 | — | ya en el repo |
| **Diviner PRP** (Polar Resource Products) `dlre_prp_{north,south}.tab` | `temp_avg` y `temp_max` anuales (K), `ice_depth` (profundidad de estabilidad del hielo) sobre una malla triangular **[V]** | malla irregular (2 880 000 triángulos en el sur) **[V]** | coordenadas planetocéntricas por triángulo **[V]** | tabla ASCII, 605 MB (sur) **[V]** | release 67 del archivo LRO (15-09-2026) **[V]** | HTTPS público; **no descargado** |
| Diviner GCP | temperatura de brillo por hora local | 0,5° | cilíndrica | ASCII | — | ya en el repo (2,8 GB) |
| Diviner PCP/RCP/GDR/GHRM | productos acumulados polares, regionales y globales | varios | — | — | — | público; no examinados en detalle **[?]** |

Incertidumbre: los conteos `LDEC` indican dónde la altura es medida (≥ 1 disparo) o interpolada.
No se ha leído en esta auditoría una cifra de exactitud vertical en las etiquetas **[?]**.

### 2.2 Marte — PDS (Geosciences Node, MGS MOLA)

| Dataset | Variables | Resolución | Referencia | Formato | Versión | Acceso |
|---|---|---|---|---|---|---|
| **MOLA MEGDR** `meg016` (MEGT, MEGR, MEGA, MEGC) | topografía (radio − areoide), radio, areoide, nº de disparos | 16 px/° = 3,705 km/px **[V]** | cilíndrica simple, esfera 3396 km; areoide GMM3 hasta grado 50 **[V]** | PDS3 IMG int16 MSB **[V]** | v2.0, datos 1997-09 → 2001-06 **[V]** | ya en el repo |
| **MOLA MEGDR** `meg032`, `meg064`, `meg128` | ídem | 32, 64 y 128 px/° (128 px/° ≈ 463 m) **[V: directorios]** | ídem **[D]** | PDS3, en teselas (`megc44n000hb`…) **[V]** | — | HTTPS público; no descargado |
| MOLA `polar`, `shadr` | DEM polares; armónicos esféricos | — | — | — | — | público; no examinados **[?]** |
| Odyssey GRS, MGS TES | composición (H₂O, Fe, Si, Cl, K, Th); inercia térmica | 5°; 20 px/° | — | — | — | ya en el repo |

Incertidumbre documentada en la etiqueta de MEGT **[V]**: en el ecuador solo ~55 % de las celdas tienen al
menos un disparo y hay huecos de hasta 12 km entre trazas; las celdas vacías llevan un valor interpolado.

El PDS también aloja DTM de alta resolución de Marte (HiRISE, CTX, HRSC) en otros nodos; la pestaña
Resources solo enlaza el PDS en general, así que no se han auditado aún **[?]**.

### 2.3 Tierra — topografía disponible a través de los recursos oficiales

Consultado en la API pública de CMR (la misma que usa `js/cmr.js`):

| Dataset (CMR) | Agencia / DAAC | Resolución | Cobertura | Versión, fechas | Acceso |
|---|---|---|---|---|---|
| **SRTMGL30** `C2763266346-LPCLOUD` | NASA LP DAAC | 30″ (~0,9 km) | 27 teselas de 90°N a 60°S, **sin la Antártida** **[V: nombres de los granulos]** | V002, adquisición 2000-02-11 **[V]** | **requiere Earthdata Login** **[V: HTTP 401]** |
| **SRTMGL3** `C2763266377-LPCLOUD` | NASA LP DAAC | 3″ (~90 m) | 60°N–56°S **[D]** | V003 **[V]** | requiere Earthdata Login **[V]** |
| **NASADEM_HGT** `C2763264762-LPCLOUD` | NASA LP DAAC | 1″ (~30 m) | 60°N–56°S **[D]** | V001 **[V]** | requiere Earthdata Login **[V: HTTP 401]** |
| **ASTGTM** `C1711961296-LPCLOUD` | NASA LP DAAC | 1″ (~30 m); incluye `_num.tif` = nº de escenas por píxel **[V]** | 83°N–83°S **[D]** | V003 **[V]** | requiere Earthdata Login **[V]** |
| **SRTMSWBD** `C2763268445-LPCLOUD` | NASA LP DAAC (máscara SWBD de NGA) | 1″, máscara binaria de agua | 60°N–56°S, 12 229 teselas de 1° **[V: caja de la colección y gránulos]** | V003, publicada 2013-11-20 **[V]** | requiere Earthdata Login **[V]**; **descargada** (371 MB) fuera del repositorio, en `$SRTMSWBD_DIR` (por defecto `~/.cache/landfall/srtmswbd`), y usada para marcar el agua de SRTMGL30 |
| GMTED2010 `C1220567856-USGS_LTA` | USGS / NGA | 30″, 15″, 7,5″ | 84°N–56°S (algunos productos hasta 90°S) **[V: resumen CMR]** | — | EarthExplorer (cuenta USGS) **[V: enlace]** |
| **Copernicus DEM** GLO-90 / GLO-30 (Copernicus Data Space) | ESA / Copernicus | 90 m / 30 m | global | COG en `s3://eodata/auxdata/CopDEM_COG/…` **[V: STAC]** | requiere cuenta CDSE (S3) **[D]** |

Referencia vertical de SRTM/NASADEM/ASTER GDEM: geoide EGM96, horizontal WGS84 **[D]** (el cargador
debe leerlo de los metadatos del archivo).

**Agua en SRTMGL30 y máscara SRTMSWBD (15-11-2026).** En SRTMGL30 el mar vale 0 m, no «sin dato» **[V]**: el 71 %
de las celdas del mosaico son 0 y ninguna vale −9999 ni −32768. Para no comparar media ventana de mar plano, el
cargador usa la máscara SRTMSWBD V003 (DOI 10.5067/MEaSUREs/SRTM/SRTMSWBD.003):

- **Formato.** Un zip por tesela con un único `NnnEeee.raw` de 3601×3601 bytes **[V: todas las teselas]** (la guía
  de usuario de LP DAAC solo da «3601/3601, 1 arc-second» en su tabla 1 y no describe el archivo **[V]**). Valores
  0 y 255, sin ningún otro **[V]**. 255 = agua, fila 0 al norte: comprobado frente a SRTMGL30, ver METODOLOGIA §9
  **[V]**. Registro por nodo: la última línea de cada tesela coincide con la primera de la vecina **[V]**. La caja
  CMR de cada gránulo da ±1″ alrededor del grado, y eso no decide el registro.
- **Teselas ausentes.** CMR lista 12 229 teselas SRTMSWBD frente a 14 297 de SRTMGL3 V003 y SRTMGL1 V003 (ambas
  listas son idénticas) **[V]**. Todas las de SRTMSWBD están en SRTMGL3. Las 2068 de SRTMGL3 sin gránulo SWBD son
  interiores áridos (Sáhara, Arabia, Australia, Gobi…): 2048 no tienen ni una celda a 0 m en SRTMGL30, y otras 18
  tienen entre 3 y 1431 (depresiones que cruzan el nivel del mar en Egipto y Libia, costa de Mauritania). Hay dos excepciones, s11w139 (Fatu Hiva,
  99 % a 0 m) y n59e170 (98 %): son sobre todo mar y tampoco tienen gránulo. Las 27 463 teselas de −56…60° que no
  están en ninguno de los dos productos son océano (≥ 86,5 % a 0 m, mediana 100 %), pero algunas tienen islas con
  relieve en SRTMGL30 (Nunivak, n59w167). **Conclusión: una tesela ausente no es ni «toda tierra» ni «todo
  océano».** En ellas, igual que fuera de 60°N–56°S, no hay máscara y se aplica 0 m = sin dato.

**Worldview** sirve imágenes renderizadas (WMTS de GIBS). Una capa de relieve sombreado es una
imagen, no un campo de alturas: **no sirve para geomorfometría** y no se usará como dato numérico.

### 2.4 Tierra — otros recursos de agencias socias

| Recurso | Contenido | Licencia | Utilidad para este motor |
|---|---|---|---|
| CSA RADARSAT-1 | SAR banda C, 1995–2013; espejo en AWS Open Data **[V]** | Open Government Licence – Canada **[V]** | retrodispersión ≈ rugosidad a escala de longitud de onda (cm–dm). No es comparable directamente con la Luna sin calibración de ángulo de incidencia y longitud de onda (Mini-RF es banda S). **No se usa en la primera versión.** |
| CSA RCM | SAR banda C; datos abiertos en `donnees-data.asc-csa.gc.ca/.../RCM/` **[V]** | Open Government Licence – Canada **[V]** | ídem |
| ESA Open Science Catalog | catálogo de productos | — | catálogo, no dataset; no auditado en profundidad **[?]** |
| JAXA G-Portal | productos JAXA (precipitación, nieve, vegetación…) | términos JAXA **[?]** | requiere registro **[D]**; no auditado **[?]** |

## 3. Qué falta — bloqueo esencial

**No hay ningún modelo digital de elevación terrestre descargable sin cuenta** entre los recursos oficiales:
NASADEM, SRTM y ASTER GDEM (Earthdata) exigen Earthdata Login (comprobado: HTTP 401). El Copernicus DEM
(CDSE) exige una cuenta de CDSE, y G-Portal exige registro. Sin un MDE terrestre **no se puede buscar ningún
análogo terrestre**.

Además, el repositorio no contiene ningún MDE terrestre. `tools/build_textures.py` usa NOAA ETOPO2 solo
para las texturas, y ETOPO2 **no figura en los recursos oficiales**, así que no debe ser la fuente del motor.
El borrador de `data_loader.py` escrito antes de esta auditoría apuntaba a ETOPO2 y debe corregirse.

Opción recomendada (todo dentro de Earthdata, el recurso oficial):
1. **SRTMGL30** (27 teselas, decenas de MB): catálogo de ventanas a escala regional (~1 km), de 90°N a 60°S.
2. **NASADEM_HGT** o **ASTGTM** (1″) bajo demanda: solo para las teselas de los mejores candidatos, a la
   escala de un sitio de base (decenas–centenas de metros), comparables con LOLA polar de 20–80 m.

Para eso hace falta que **el usuario** cree una cuenta gratuita de Earthdata Login y deje sus credenciales
en `~/.netrc` (o un token en una variable de entorno). El motor nunca pedirá ni guardará contraseñas.

## 4. Qué se puede hacer ya con los datos disponibles

- Cargadores, preprocesamiento, geomorfometría y estadística para la Luna (LOLA 16 px/° y polar) y Marte (MOLA).
- Pruebas de extremo a extremo con datos reales **Luna↔Luna, Marte↔Marte y Luna↔Marte**: identidad (la
  ventana objetivo debe encontrarse a sí misma), invariancia ante la referencia vertical y sensibilidad a la
  resolución y a la ventana.
- Pruebas sintéticas con solución analítica (planos, paraboloides, superficies fractales de H conocido).

## 5. Comparabilidad de variables entre cuerpos (para la Fase 3)

| Dimensión | Tierra (oficial) | Luna (oficial) | Marte (oficial) | ¿Comparable? |
|---|---|---|---|---|
| Topografía relativa, pendiente, rugosidad, curvaturas, variograma | SRTM/NASADEM/ASTER | LOLA | MOLA | **Sí**, en la misma escala h y el mismo lado físico L, sin alturas absolutas |
| Temperatura de superficie | MODIS LST (Earthdata) **[D]** | Diviner | TES/MCS | Solo como **semejanza ambiental** con rangos que apenas se solapan; se informará por separado, nunca como semejanza geomorfológica |
| Profundidad de estabilidad del hielo | — | Diviner PRP | — | **No** (sin equivalente terrestre) |
| Composición elemental | — | Lunar Prospector | Odyssey GRS | **No** con la Tierra (no hay mapas γ terrestres equivalentes) |
| Densidad y tamaños de cráteres | sin catálogo oficial | sin catálogo en los recursos auditados | ídem | **No calculable** con los recursos verificados |
| Retrodispersión radar | RADARSAT-1/RCM (banda C) | Mini-RF (banda S, en LRO) | — | Requiere calibración física; fuera de la primera versión |
