# Notas para continuar (sesión del 15-11-2026)

Estado del trabajo en la web «Landfall» al cerrar la sesión. Nada está en git: todo son cambios sin commit en el árbol de trabajo.

## Cómo arrancar
- Servidor: `python3 -m http.server 8080` en la raíz (suele haber uno ya en marcha en el puerto 8080; si `preview_start {name: "web"}` falla por puerto ocupado, abrir `http://localhost:8080/` directamente).
- Ir directo a resultados: `http://localhost:8080/?vista=resultados&cuerpo=moon&proposito=recursos&sub=liquido&objetivo=isru` (o `cuerpo=mars`).
- No hay `node`. Para comprobar números: `.venv/bin/python` con numpy sobre `base-planetaria/web/data/*.bin` (descritos en `capas.json`).

## Hecho en esta sesión
1. **Pasada de calidad** (primera petición): vista móvil arreglada (barra superior en una fila, globo encuadrado sobre la hoja inferior, `viewer.shiftY`, `_dist()` en `js/scene.js`), botón ✕ pegajoso, telemetría estable, descenso del LM interrumpido queda posado (`js/vuelo.js`: `alPosar`, `interrumpir`), textos.
2. **Gráficos de resultados con datos reales del PDS** (sin fuentes nuevas, sin capas `*_aprox`, sin estimaciones):
   - `js/analitica.js`: percentil/cuantil/histograma ponderados por área, `perfilLatitud`, `destino`, `ventana`, `corte`, `sombreado`, `pendienteCeldas`, `exageracionRelieve`, `medirTodo`. Contrastado con numpy.
   - `js/graficos/`: `base.js` (utilidades), `relieve.js` (miniaturas), `chispa.js` (percentil en tarjetas), `panel.js` (controlador de `#analisis`), `matriz.js`, `distribucion.js`, `latitud.js`, `dispersion.js`, `especifico.js` (panel de comparación), `entorno.js`, `corte.js` (ficha).
   - CSS: `css/graficos.css` y `css/g-*.css` (enlazados en `index.html`).
   - Integración en `js/main.js`: `barraNota`, `pintarMiniaturas`, `abrirComparativa`, `graficosFicha`, `chispasFicha`; `js/capas.js` → `medirSitios` añade `capa/valor/derivada`.
3. **Media de zona ponderada por área** (`js/capas.js` → `Capa.zona` y `Capa.pendiente`, peso cos(lat)). Shackleton: pendiente 17,5° → 14,9°, elevación +3 m → −292 m (coincide con numpy). Cambia ligeramente la puntuación: en Luna/minería Shackleton pasa por delante de la Cresta (55 y 55).

## Pendiente
- **Revisión adversarial del código** (workflow `wf_713bd211-d7a`): no había devuelto hallazgos al cerrar. Si llega, aplicar los confirmados. Puntos que ya se sabían flojos: muchas paradas de tabulador en los gráficos, textos de pie largos/técnicos copiados de metadatos en `especifico.js`, texto pequeño de SVG a 320 px, el gráfico de latitud de `mars_inercia` se aplasta por las franjas polares.
- Los pies de los gráficos dicen «media de las celdas»; ahora es media **ponderada por área**: actualizar esos textos (`matriz.js`, `distribucion.js`, `latitud.js`, `dispersion.js`, `especifico.js`) y la tabla del README.
- Los «Datos de referencia (estimación)» escritos a mano en `js/data.js` contradicen lo medido (Shackleton pendiente ~12° frente a 14,9°; Taurus-Littrow < 5° frente a 12,8° de LOLA). Sin tocar: decisión del usuario.
- Meridiani cae en el borde entre dos celdas GRS de 5°: el valor depende del redondeo (se usa la celda del este).
- Panel «Nuestro grupo» sigue vacío (faltan los datos del equipo).
- Ideas de los jueces de diseño sin hacer: eje en °C en el gráfico de temperaturas, escala vertical común en los perfiles, hoja móvil ampliable, columna de calidad/cobertura (`*_disparos`).
- Cualquier gráfico que necesite datos nuevos (curva diurna completa de Diviner, iluminación polar, radiación, hielo SWIM/SHARAD) requiere **preguntar antes** al usuario.
- **Sin commit.** Ojo al hacerlo: hay carpetas enormes sin seguimiento (`base-planetaria/datos_pds/…`, ~3 GB); no usar `git add -A`.

## Reglas del usuario
- Gráficos solo con datos reales que ya tiene el código; no inventar valores ni umbrales; preguntar antes de añadir otra base de datos.
- Interfaz y comentarios en español.

## Revisión del código (llegó al cerrar)
Los hallazgos confirmados, con su arreglo exacto, están en `REVISION_PENDIENTE.md`. No están aplicados.
