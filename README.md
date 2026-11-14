# Landfall · Frontend

Web (sin build, JS puro + Three.js incluido en `vendor/`) para elegir destino (Luna/Marte) y objetivo de misión, simular el viaje en 3D, marcar los mejores emplazamientos y recomendar dónde entrenar en la Tierra.

## Ejecutar
Necesita un servidor estático (los módulos ES no funcionan con `file://`):

```
cd space-apps-challenge
py -m http.server 8080      # o la extensión "Live Server" de VS Code
```
Abre http://localhost:8080

## Estructura
- `index.html`, `css/style.css` – interfaz (asistente, HUD, paneles).
- `js/main.js` – flujo de la app: asistente → viaje → resultados → detalle → entrenamiento.
- `js/scene.js` – escena 3D, cámara, marcadores. **Aquí se configuran los modelos de Blender.**
- `js/data.js` – objetivos, pesos, emplazamientos y análogos terrestres (**datos de demostración**).
- `js/api.js` – capa de datos; pon `API_BASE` para usar el backend.
- `js/textures.js` – texturas procedurales de respaldo.

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
