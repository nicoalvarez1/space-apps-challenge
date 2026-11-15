# Landfall · Frontend

A web app (no build step, plain JS + Three.js bundled in `vendor/`) to choose a destination (Moon/Mars) and a mission objective, simulate the trip in 3D, mark the best sites and recommend where to train on Earth.

## Running
It needs a static server (ES modules do not work with `file://`):

```
cd space-apps-challenge
python3 -m http.server 8080  # (Windows: py -m http.server 8080) or the "Live Server" extension for VS Code
```
Open http://localhost:8080

## Structure
- `index.html`, `css/style.css` – interface (setup wizard, HUD, panels).
- `js/main.js` – app flow: wizard → trip → results → site details → training.
- `js/scene.js` – 3D scene, camera, markers. **This is where the Blender models are configured.**
- `js/data.js` – objectives, weights, sites and Earth analogs (demonstration estimates).
- `js/capas.js` – reads the real PDS layers (`base-planetaria/web/data`), per-site measurements and layers on the globe.
- `js/api.js` – data layer; set `API_BASE` to use the backend.
- `js/analitica.js` – summaries of the real layers for the charts: distribution of each value over the surface (area-weighted), mean by latitude, local map and cross-section, regional slope. No hand-written data and no new sources.
- `js/graficos/` – results charts, all built from PDS measurements: relief thumbnails in the list, the “Compare with measured data” panel (matrix, distribution, latitude, scatter, day/night temperatures on the Moon and composition with uncertainty on Mars) and, in the site details panel, a map of the surroundings, a terrain profile and the percentile of each measurement. Styles in `css/graficos.css` and `css/g-*.css`.
- `js/textures.js` – fallback procedural textures.
- `js/saturno5.js` – procedural, full-scale Saturn V, CSM and lunar module (LM), with their stages, separations and plumes.
- `js/vuelo.js` – the mission: LC-39A launch pad, trajectory, trip camera, final orbit and LM descent.

## The trip (Saturn V)
Launching the simulation shows the complete mission (36 s to the Moon, 40 s to Mars; “Skip trip” jumps to the end):
1. **LC-39A launch pad** (28.61° N, 80.60° W): umbilical tower with its swing arms, mobile launcher, daytime sky and steam from the flame trench. The five F-1s ignite while the rocket is held down, and the arms swing away at liftoff.
2. **Ascent:** it climbs vertically until it clears the tower, then performs the gravity turn. Separations in their real order: S-IC (retro-rockets and fireball), interstage ring, launch escape tower and S-II. The plume widens with altitude.
3. **Parking orbit** at about 190 km and **second S-IVB burn** (translunar or trans-Mars injection).
4. **Transposition and docking:** the SLA adapter panels open, the CSM separates, turns 180° and docks with the LM, then extracts it from the S-IVB.
5. **Coast** (the blue line is the trajectory) and **orbit insertion** with the SPS engine firing forward. The vehicle stays in a circular orbit, in real time.
6. **When a site is selected, the LM descends to it.** It deploys its legs, releases from the CSM and brakes with the descent engine until it is upright (on Mars, with an entry glow). On touchdown it kicks up dust. If another site is selected, it hops to it. The CSM remains in orbit.

Dimensions and shapes follow the *Saturn V Flight Manual* and the *Apollo Operations Handbook*: 110.6 m tall, F-1 with turbine exhaust manifold, J-2, SPS, LM with legs, contact probes, ladder and antennas. Where the real vehicle carried “UNITED STATES” (S-IC, service module and LM), this one reads **TOP GIT**.

Simplifications, for readability:
- **Scale:** the vehicle is drawn ×300 relative to the planets and grows as the camera moves away, so it is always visible.
- **Time:** the 3 days (or 7 months) of travel are compressed into about 40 s.
- **Mars:** Apollo never went to Mars; there, the trip and the LM descent are illustrative.
- **Return:** neither the return trip nor the ascent stage liftoff is modeled.

## Real PDS data in the app
`js/capas.js` loads the grids in `base-planetaria/web/data/` (described in `capas.json`) directly in the browser:
- **Score:** for each site, the cells within 0.5° of arc (≈ 15 km on the Moon, ≈ 30 km on Mars) are averaged and four factors are computed from measured data. Each factor is a percentile in the NASA data: 100 × the share of the body’s surface whose value is worse than or equal to the site’s, using the area-weighted distribution of published cells that the charts use (`muestra()` / `percentil()` in `js/analitica.js`). The text shown when hovering over the `PDS` tag gives the value and the percentile.

  | Factor | Moon | Mars |
  |---|---|---|
  | Terrain | LOLA slope (lower is better) | MOLA regional slope (central differences, 15 km baseline; lower is better) |
  | Ice | Lunar Prospector hydrogen (higher is better) | GRS water equivalent (higher is better) |
  | Thermal | Diviner day-night swing (Tmax − Tmin, derived cell by cell in the browser; lower is better) | TES thermal inertia (higher is better) |
  | Resources | Lunar Prospector FeO (higher is better) | GRS iron (higher is better) |

  On Mars, sites outside NASA’s PRELIMINARY limits for human landing sites (Bussey and Hoffman 2016, NASA NTRS 20160002370: latitude “+/- 50 degrees”, elevation “no higher than +2 km (MOLA reference)”, compared with the zone-mean MOLA elevation) are flagged and listed after the others; none is removed. No limits are applied on the Moon.
  At lava tube sites the thermal factor remains the estimate (surface temperature does not describe the interior). **Solar, radiation, link and science remain demonstration estimates.**
- **Site details panel:** a “NASA PDS measurements” section with the mean and range of each layer.
- **Layers on the globe:** the “Data layers” panel, grouped by instrument (relief, temperature, composition). The layer tints the surface while keeping the relief and lighting; no data = gray. The color scale is piecewise linear between the 2nd, 25th, 50th, 75th and 98th percentiles of the surface (area-weighted), which are the legend ticks. The cursor reads the cell value, and each site shows its mean value in the active layer (markers and list). In fine grids each pixel takes the cell that contains it; in coarse grids (Odyssey GRS, 5°) and in the neutron map (2° equal-area blocks) the VIEW interpolates between cell or block centers so it does not look pixelated, but the cursor and the sites always use the published cell value. No data = hatching. The Mars poles for water, iron, silicon and chlorine have no published data (the Odyssey GRS team masked them: ice dilutes the signal). They are shown as an APPROXIMATION, with the same colors as the rest, “≈” in the cursor readout and never used in the scores (`mars_*_aprox` layers, `aprox` step of `base-planetaria/tools/construir_marte.py`): water by a regression of ln(H2O) against ln(epithermal neutron flux) fitted at mid-latitudes (R² 0.68; extrapolated at the south pole, where it probably underestimates the ice; low at the north pole because of the 2002 CO2 frost); iron, silicon and chlorine by harmonic interpolation from the measured edge (without ice dilution). In addition, for polar hydrogen there is the “Hydrogen (neutrons)” layer, the epithermal neutron flux from the Neutron Spectrometer (Feldman et al. 2002, 0.5°, fewer neutrons = more hydrogen).
- **Home screen:** the figures (layers, instruments) come from `capas.json`; the planets on the cards use `assets/textures/{moon,mars}_thumb.jpg` (generated by `tools/build_textures.py`).

If the layers cannot be loaded, the app falls back to the estimates and says so in the top bar (`DEMO DATA`).

## Blender models
Export as binary glTF (`.glb`) and copy to `assets/`: `moon.glb`, `mars.glb`, `earth.glb`.
If they exist they are used automatically (scaled to the scene radius); otherwise procedural textures are used.
- Sphere with equirectangular UVs. If longitudes come out shifted, adjust `lonOffset` (degrees) in `CONFIG` in `scene.js`.
- Animations in the `.glb` play in a loop.

## Scientific geomorphological similarity engine (`base-planetaria/similitud/`)
It searches the Earth for relief windows similar to a lunar or Martian region using deterministic statistics, with no weights, no machine learning and no similarity percentages. Documentation (in Spanish):
[inventory of official resources](base-planetaria/similitud/INVENTARIO_RECURSOS.md) ·
[architecture](base-planetaria/similitud/ARQUITECTURA.md) · [methodology and equations](base-planetaria/similitud/METODOLOGIA.md).

```
python3 -m venv .venv && .venv/bin/pip install -r base-planetaria/similitud/requirements.txt
cd base-planetaria
../.venv/bin/python -m similitud estado
../.venv/bin/python -m similitud descargar-tierra     # SRTMGL30 from NASA Earthdata: requires Earthdata Login in ~/.netrc
../.venv/bin/python -m similitud buscar --cuerpo mars --lat 18.4 --lon 77.7 --lado-km 200 --salida jezero.json
../.venv/bin/python -m similitud servidor             # API at http://localhost:8000 for the web app
../.venv/bin/python -m unittest discover -s similitud/tests -t .
```
- **Data**: Moon LOLA GDR (16 px/° and 240 m polar products: `python3 tools/descargar.py lola_polar`), Mars MOLA MEGDR and Earth SRTMGL30. All of them are in the official challenge resources.
- **API**: `GET /api/similitud/estado` and `POST /api/similitud/analogos` `{cuerpo, lat, lon, lado_km, k}`. It returns candidates, per-criterion distances with units, percentiles, Pareto dominance, an explanation, validation, sources and a GeoJSON. It does not replace `/api/sites` or `/api/training`.
- **Web**: the “Where to train?” panel includes the geomorphological analogs section if the engine is running. The candidates appear on the Earth globe and the map can be downloaded as GeoJSON. The “% similarity” of the demonstration analogs is labeled as a qualitative estimate.

## Backend contract (`js/api.js`)
- `POST /api/sites` `{body, objective, crew, duration}` → list of sites with `id, name, region, lat, lon, score, rank, metrics{solar,ice,terrain,thermal,radiation,comms,science,resources}, traits[], desc, facts[[k,v]], pros[], cons[], weights{}`
- `POST /api/training` `{site_id, body}` → list of analogs with `id, name, country, lat, lon, match, shared[], desc, activities[], season, access`

## High-fidelity NASA models (Earth, Moon, Mars)
`assets/textures/` contains real textures (≈ 120 MB) in two qualities: **8K** (default on capable devices) and **4K** (mobile / modest GPUs). Force one with `?q=hi` or `?q=lo`.
- **Moon:** LRO/LROC color mosaic + LOLA relief: normals from the 64 px/degree DEM (LDEM_64) and real mesh displacement (×3).
- **Mars:** Viking MDIM 2.1 mosaic + MOLA relief: normals from the 64 px/degree MEGDR and displacement (×3).
- **Moon and Mars poles:** caps in azimuthal equidistant projection (from 60° to the pole) that replace the global map from 64–68° latitude, to avoid equirectangular stretching. Color reprojected from the same mosaic; relief from LOLA LDEM_64 (Moon) and from the 128 px/degree MOLA polar stereographic `megt_n_128_1`/`megt_s_128_1` (Mars; includes observations up to the pole). Normals in object space: `{cuerpo}_polar_{n,s}_*`.
- **Earth:** Blue Marble NG + bathymetry, VIIRS Black Marble night lights, ETOPO2 relief and sun glint on the ocean.
- **Earth clouds:** VIIRS NOAA-20 + NOAA-21 (GIBS), imagery from real days: the 2026-09-22 equinox at low and mid-latitudes, Arctic 2026-06-21 and Antarctica 2025-12-21 (summer at each pole), blended in latitude. Cloud = excess whiteness over the clear ground (Blue Marble); the minimum of the two satellites removes sun glint on the sea; the M11 band (2.25 µm) rejects sea ice and snow (cyan chroma > 110). In the app the clouds cast shadows on the ground (a ray toward the Sun up to the cloud layer) and hide city lights.
- **Sky:** Deep Star Maps 2020 (NASA SVS).
Markers are placed on the real terrain height. Priority: `assets/<cuerpo>.glb` (Blender) > NASA textures > procedural.

Regenerating (downloads ≈ 2 GB to a cache outside the project; the LOLA/MOLA DEMs are checked against the MD5s published by the PDS):
```
py -m pip install numpy pillow OpenEXR
py tools/build_textures.py all
py tools/build_textures.py all --only clouds,polar   # clouds only / relief and poles only
```
Credits shown in the app (bottom-left corner on wide screens, and always in the ☰ side menu): NASA/GSFC/ASU, NASA/JPL/USGS, NASA Earth Observatory, NOAA, NASA SVS.
Limitations: the color of the polar caps is that of the reprojected global mosaic (at the Mars north pole the Viking mosaic has a small smudge and faint stripes that come from the source); the clouds blend three real dates with a smooth transition at 54–60°S and 70–78°N; the 0.01 % of pixels with no image are filled with the mean of neighboring clouds; ice clouds that are heavily saturated in M11 may be lost.

## Live NASA CMR data (training sites)
`js/cmr.js` queries `https://cmr.earthdata.nasa.gov/search/granules.json` from the browser (open CORS, no account) when a training site is opened:
- **HLS (Landsat 8/9 + Sentinel-2)**: cloud cover of each pass over 24 months → % of clear passes and a monthly chart; latest clear, complete scene (`SPATIAL_COVERAGE` ≥ 85 %, via `granules.umm_json`) with its preview.
- **ASTER GDEM v3**: relief preview. **MODIS MOD11A1**: available days of land surface temperature.
- Without HLS (Antarctica): a recent MODIS image from GIBS.

CMR is the **Earth science** catalog; it does not contain LROC, Diviner, HiRISE, CRISM, SHARAD or MOLA (they are in the PDS), which is why the Moon and Mars use PDS data already processed in `assets/textures`.
