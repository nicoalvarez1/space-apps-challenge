# Landfall · Frontend

Web (sin build, JS puro + Three.js incluido en `vendor/`) para elegir destino (Luna/Marte) y objetivo de misión, simular el viaje en 3D, marcar los mejores emplazamientos y recomendar dónde entrenar en la Tierra.

## Ejecutar
Necesita un servidor estático (los módulos ES no funcionan con `file://`):

```
cd space-apps-challenge
python3 -m http.server 8080  # (Windows: py -m http.server 8080) o la extensión "Live Server" de VS Code
```
Abre http://localhost:8080

## Estructura
- `index.html`, `css/style.css` – interfaz (asistente, HUD, paneles).
- `js/main.js` – flujo de la app: asistente → viaje → resultados → detalle → entrenamiento.
- `js/scene.js` – escena 3D, cámara, marcadores. **Aquí se configuran los modelos de Blender.**
- `js/data.js` – objetivos, pesos, emplazamientos y análogos terrestres (estimaciones de demostración).
- `js/capas.js` – lectura de las capas reales del PDS (`base-planetaria/web/data`), mediciones por sitio y capas sobre el globo.
- `js/api.js` – capa de datos; pon `API_BASE` para usar el backend.
- `js/textures.js` – texturas procedurales de respaldo.

## Datos reales del PDS en la web
`js/capas.js` carga las rejillas de `base-planetaria/web/data/` (descritas en `capas.json`) directamente en el navegador:
- **Puntuación:** para cada emplazamiento se promedian las celdas en 0,5° de arco (≈ 15 km en la Luna, ≈ 30 km en Marte) y cuatro factores pasan a calcularse con datos medidos, con una escala lineal explícita (visible al pasar el cursor por la etiqueta `PDS`):

  | Factor | Luna | Marte |
  |---|---|---|
  | Terreno | pendiente LOLA: 25° → 0, 0° → 100 | pendiente regional MOLA (diferencias centrales, base 15 km): 5° → 0, 0° → 100 |
  | Hielo | hidrógeno Lunar Prospector: 50 → 0, 150 ppm → 100 | agua equivalente GRS: 2 % → 0, 7 % → 100 |
  | Térmica | oscilación diurna Diviner (Tmáx − Tmín): 300 K → 0, 0 K → 100 | inercia térmica TES: 50 → 0, 400 → 100 |
  | Recursos | FeO Lunar Prospector: 4 % → 0, 20 % → 100 | hierro GRS: 11 % → 0, 18 % → 100 |

  En los sitios con tubos de lava la térmica sigue siendo la estimación (la temperatura de superficie no describe el interior). **Solar, radiación, enlace y ciencia siguen siendo estimaciones de demostración.**
- **Ficha del sitio:** sección «Mediciones NASA PDS» con media y rango de cada capa.
- **Capas sobre el globo:** panel «Capas de datos», agrupado por instrumento (relieve, temperatura, composición). La capa tiñe la superficie conservando el relieve y la iluminación; sin dato = gris. La escala de color es lineal a tramos entre los percentiles 2, 25, 50, 75 y 98 de la superficie (ponderados por área), que son las marcas de la leyenda. El cursor lee el valor de la celda, y cada emplazamiento muestra su valor medio en la capa activa (marcadores y lista). Sin interpolar: cada píxel toma la celda que lo contiene.
- **Portada:** las cifras (capas, instrumentos) salen de `capas.json`; los planetas de las tarjetas usan `assets/textures/{moon,mars}_thumb.jpg` (los genera `tools/build_textures.py`).

Si las capas no se pueden cargar, la web vuelve a las estimaciones y lo indica en la barra superior (`DATOS DEMO`).

## Modelos de Blender
Exporta como glTF binario (`.glb`) y copia a `assets/`: `moon.glb`, `mars.glb`, `earth.glb`.
Si existen se usan automáticamente (se escalan al radio de la escena); si no, se usan texturas procedurales.
- Esfera con UV equirectangular. Si las longitudes salen desplazadas, ajusta `lonOffset` (grados) en `CONFIG` de `scene.js`.
- Las animaciones del `.glb` se reproducen en bucle.

## Contrato con el backend (`js/api.js`)
- `POST /api/sites` `{body, objective, crew, duration}` → lista de sitios con `id, name, region, lat, lon, score, rank, metrics{solar,ice,terrain,thermal,radiation,comms,science,resources}, traits[], desc, facts[[k,v]], pros[], cons[], weights{}`
- `POST /api/training` `{site_id, body}` → lista de análogos con `id, name, country, lat, lon, match, shared[], desc, activities[], season, access`

## Modelos NASA de alta fidelidad (Tierra, Luna, Marte)
`assets/textures/` contiene texturas reales (≈ 85 MB) en dos calidades: **8K** (por defecto en equipos potentes) y **4K** (móviles / GPU modestas). Fuerza una con `?q=hi` o `?q=lo`.
- **Luna:** mosaico en color LRO/LROC + relieve LOLA (normales + desplazamiento real de la malla, ×3).
- **Marte:** mosaico Viking MDIM 2.1 + relieve MOLA (normales + desplazamiento ×3).
- **Tierra:** Blue Marble NG + batimetría, luces nocturnas VIIRS Black Marble, relieve ETOPO2, nubes MODIS reales y brillo solar en el océano.
- **Cielo:** Deep Star Maps 2020 (NASA SVS).
Los marcadores se colocan sobre la altura real del terreno. Prioridad: `assets/<cuerpo>.glb` (Blender) > texturas NASA > procedural.

Regenerar (descarga ≈ 600 MB a una caché fuera del proyecto):
```
py -m pip install numpy pillow OpenEXR
py tools/build_textures.py all
```
Créditos mostrados en la web (esquina inferior izquierda): NASA/GSFC/ASU, NASA/JPL/USGS, NASA Earth Observatory, NOAA, NASA SVS.
Limitaciones: los polos del color lunar son suaves (límite del mosaico); las nubes son una composición de 4 días y pueden mostrar leves costuras.

## Datos en vivo de NASA CMR (lugares de entrenamiento)
`js/cmr.js` consulta `https://cmr.earthdata.nasa.gov/search/granules.json` desde el navegador (CORS abierto, sin cuenta) cuando se abre un lugar de entrenamiento:
- **HLS (Landsat 8/9 + Sentinel-2)**: nubosidad de cada pasada en 24 meses → % de pasadas despejadas y gráfico mensual; última escena despejada y completa (`SPATIAL_COVERAGE` ≥ 85 %, vía `granules.umm_json`) con su vista previa.
- **ASTER GDEM v3**: vista previa del relieve. **MODIS MOD11A1**: días disponibles de temperatura de superficie.
- Sin HLS (Antártida): imagen MODIS reciente de GIBS.

CMR es el catálogo de **ciencias de la Tierra**; no contiene LROC, Diviner, HiRISE, CRISM, SHARAD ni MOLA (están en el PDS), por eso la Luna y Marte usan datos PDS ya procesados en `assets/textures`.
