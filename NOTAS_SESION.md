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
4. **Cohete más realista** (`js/saturno5.js`, `js/vuelo.js`): pintura con desgaste/remaches/AO pintada y rugosidad, escarcha en tanques de LOX que se desprende al despegar, toberas con tubos y brillo interior, penachos con ruido y vaina de hollín del F-1, retrocohetes/ullage con llama, sombras del Sol solo para vehículo y plataforma (cámara de sombras que sigue al cohete, `Vuelo._sombras/_sol`), Sol fijo en el marco de LC-39A hasta p≈0,33, vapor de venteo y placas de hielo, brazos de la torre en celosía, nube de separación del S-IC. Humo: corregido el canal (salían discos de borde duro) y la deriva de la estela (iba en unidades de mundo). Coste medido ≈ +0,4 ms/fotograma por las sombras.
   - Pasada de mini detalles (15-11): partículas como cuadriláteros instanciados (los puntos se topaban en 511 px), humo de la trinchera blanco-gris sin rotación ni cortes contra el suelo, plataforma y humo que se desvanecen (p 0,108–0,136), cielo que se oscurece antes de volverse transparente (sin estrellas de día), nube de separación del S-IC a escala del vehículo, escarcha como alphaMap real con huecos en banderas/«USA», etapas soltadas que se encogen en vez de desaparecer, polvo del LM (Luna: láminas radiales rasantes; Marte: nube ocre), LM apoyado en el relieve real de la malla (`_sueloLM`) con sombra de contacto y sin salto de tamaño al soltarse.

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

## Publicar en topgit.earth
- `bash tools/publicar.sh` crea `publicar/` (≈171 MB, solo lo que usa la web; ignorada por git). Subir su CONTENIDO a la raíz del alojamiento.
- En la web publicada no se llama al motor local (`MOTOR_LOCAL` en `js/api.js`) y su sección no aparece en el panel de entrenamiento.
- Probado: `publicar/` servida aparte carga todo; solo fallan los `assets/*.glb` opcionales (también fallan en local).
- Live Server de VS Code tiene la recarga automática desactivada (`.vscode/settings.json`, `"**"`) porque varias sesiones editaban a la vez.

## Entrenamiento en la Tierra (centro del proyecto)
- Datos nuevos: relieve SRTMGL30 + agua SRTMSWBD por análogo en `base-planetaria/web/data/tierra/` (script `base-planetaria/tools/construir_tierra_web.py`); clima NASA POWER en vivo (aprobado por el usuario) en `js/graficos/tierra-datos.js`.
- Panel: `js/graficos/tierra-{panel,cara,clima,alternativas}.js`, `css/g-tierra.css`. Secciones: cara a cara (relieve a la misma escala + perfil), clima por meses, comparar alternativas, programa.
- OTRA SESIÓN hizo en paralelo «Earth analogs found in NASA data» (`js/graficos/analogo.js`, `base-planetaria/web/data/analogos/`), que va arriba del panel. Hay duplicado: `tierra/motor/` (21 JSON del motor, `precalcular_motor_web.py`) NO lo usa la web; decidir con esa sesión cuál carpeta queda y borrar la otra.
- Concordia: sin relieve (SRTMGL30 no cubre al sur de 60°S).
- Botón de entrenamiento destacado arriba (ficha y panel de resultados: `ctaEntreno`, `ctaResultados` en js/main.js, `css/entreno.css`). Mapas de entrenamiento con vista «Realistic» por defecto (`js/graficos/realista.js`: Blue Marble / LROC / Viking reproyectados + sombreado).
- Textos simplificados para público general: cada gráfico muestra título + frase + gráfico; el detalle técnico va tras «Learn more» (figura()/masInfo() en js/graficos/base.js).
- Panel de entrenamiento COMPACTO (una sola historia): tarjeta del lugar con nombre (rankAnalogs n.º 1, imagen CMR, chips, globo) → «Same kind of ground» (solo mapas) → «When to go» (temperatura + meses despejados + frase) → «Other places» (lista corta) → «What you would train» → plegado «Places found by NASA terrain data» (motor; su ficha se construye al abrirlo). Modo `compacto: true` en tierra-cara/clima/alternativas; el resto tras «Learn more». Medido: Marte 136 palabras / 5 gráficos, Luna 158 / 5.
