# Arquitectura — Fase 2

## Estado del repositorio (auditado el 14-11-2026)

| Pieza | Qué hay | Consecuencia |
|---|---|---|
| Web (`index.html`, `js/*.js`) | JS puro + Three.js, sin compilación. Flujo asistente → viaje → sitios → ficha → entrenamiento. | Se conserva sin cambios de comportamiento. |
| `js/api.js` | `API_BASE = null`. Contrato documentado: `POST /api/sites`, `POST /api/training`. | **No existe backend que lo implemente** (el README cita un `main.py` que no está en el repositorio). |
| `js/data.js` → `rankAnalogs` | «match %» = 0,7·(rasgos compartidos/rasgos del sitio) + 0,3·Jaccard, sobre etiquetas escritas a mano. | Es una puntuación de demostración **sin base física**. El motor no la sustituye en silencio: añade un resultado aparte, etiquetado y trazable. |
| Supabase | Ninguna referencia en el código. | No hay conexión que integrar ni conservar. |
| `base-planetaria/tools/` | Descarga con MD5 (`descargar.py`, `fuentes.py`), lector de etiquetas PDS3 (`comun.py`), capas web. | Se reutilizan el lector PDS3 y el registro de descargas. |
| `base-planetaria/datos_pds/` | LOLA 16 px/°, MOLA 16 px/°, Diviner GCP, LP, GRS, TES. | Luna y Marte, disponibles. **No hay ningún MDE terrestre.** |

## Paquete `base-planetaria/similitud/`

```
data_catalog.py         inventario legible por máquina: producto, agencia, URL, referencia, resolución,
                        estado de verificación (fuente de la trazabilidad de cada resultado)
data_loader.py          un cargador por fuente, todos devuelven un Raster con la misma interfaz:
                          LolaCilindrico (LDEM_16 + LDEC_16)         PDS3, cilíndrica simple
                          LolaPolar (LDEM_*S/N_*M + LDEC)            PDS3, estereográfica polar
                          MolaMegdr (MEGT + MEGC, 16 px/°)           PDS3, cilíndrica simple
                          Srtmgl30 (27 teselas, Earthdata)           BIL int16 + .hdr, en mosaico memmap
                        descarga de Earthdata con `curl --netrc` (el código nunca lee la contraseña)
preprocessing.py        resolución común h, ventana de lado físico L en proyección azimutal
                        equidistante local, remuestreo por media de área, plano de referencia
geomorphometry.py       pendiente, rugosidad, curvaturas, relieve local, estadística descriptiva
spatial_analysis.py     variograma (FFT con máscara), Hurst, escala de correlación, anisotropía,
                        I de Moran, tamaño muestral efectivo
statistical_distances.py  Wasserstein-1, Kolmogorov–Smirnov (con n efectivo), energía (bivariante),
                        distancia entre variogramas
similarity_engine.py    firma de ventana, catálogo terrestre en caché, distancias, percentiles,
                        dominancia de Pareto, orden leximax, supresión de solapes, explicación
validation.py           sensibilidad a resolución, ventana, ruido vertical, huecos, normalización,
                        métrica, referencia vertical; estabilidad del ranking por bootstrap de bloques
servidor.py             HTTP de la biblioteca estándar: GET /api/similitud/estado,
                        POST /api/similitud/analogos (JSON + GeoJSON para el mapa)
__main__.py             CLI: `python -m similitud {estado,descargar-tierra,catalogo,buscar}`
tests/                  unittest: casos analíticos, invariancias, datos reales Luna/Marte
```

Dependencias: **NumPy y SciPy**. Rasterio, GeoPandas, PyProj, xarray, Shapely y scikit-image no hacen
falta: los formatos de entrada (PDS3 IMG y BIL con cabecera) se leen con NumPy, y las proyecciones
necesarias (azimutal equidistante y estereográfica polar sobre esfera) tienen fórmulas cerradas (Snyder
1987) que se prueban contra casos conocidos.

## Escalas de análisis

Una pendiente o una curvatura solo tiene sentido a una escala concreta. El motor siempre compara con la
misma celda h y el mismo lado L, y h nunca es menor que el espaciado nativo más grueso de los productos
implicados.

| Escala | Tierra | Luna | Marte | h típico | L típico |
|---|---|---|---|---|---|
| Regional (catálogo global) | SRTMGL30 (30″ ≈ 0,93 km) | LOLA 16 px/° (1,9 km) | MOLA 16 px/° (3,7 km) | 1,9 km (Luna) · 3,7 km (Marte) | 100–300 km |
| Sitio de base (refinamiento) | NASADEM 1″ (≈ 31 m) | LOLA polar 20–80 m | MOLA 128 px/° (463 m) | ≥ 80 m | 10–30 km |

La escala de sitio es la **segunda etapa** y solo busca dentro de las teselas de los mejores candidatos
regionales. Esta restricción se declara en cada resultado: no es una búsqueda global a 30 m.

## Contrato JSON nuevo (no rompe el existente)

`POST /api/similitud/analogos`
```json
{"cuerpo": "mars", "lat": 18.4, "lon": 77.7, "lado_km": 200, "k": 10, "validar": true}
```
Devuelve `objetivo`, `parametros`, `datos` (fuentes, versiones, resolución, cobertura), `criterios`,
`analogos[]` (centro, huella, distancias por criterio con unidades, percentil, dominancia, incertidumbre,
explicación), `validacion`, `variables_no_comparadas`, `limitaciones` y `geojson`.
`/api/sites` y `/api/training` no se tocan; `js/api.js` solo gana una función nueva, y la web añade una
sección y marcadores propios, separados del «match %» de demostración.

## Distinción obligatoria en todas las salidas

- **Semejanza geomorfológica**: la calcula este motor (topografía relativa a la escala h, L).
- **Semejanza ambiental** (temperatura, hielo, atmósfera): no se mezcla con la anterior; solo se informa
  cuando hay datos comparables (hoy, ninguno terrestre en el repositorio).
- **Aptitud para una misión**: no la evalúa el motor.
