# Notas para continuar (actualizado el 15-11-2026, noche)

Web «Landfall» (NASA Space Apps 2026). Interfaz en inglés (otra sesión la tradujo); comentarios del código en español.

## Estado
- **Git:** todo está commiteado y subido a GitHub (`main` de nicoalvarez1/space-apps-challenge, último commit 756766a). Se reescribieron los 5 commits que no estaban subidos para sacar `base-planetaria/datos_pds/` (3 GB, archivos de 149 MB que GitHub rechaza); esos datos siguen en disco y ahora están en `.gitignore`. Rama local `respaldo-antes-de-limpiar` = copia del historial anterior (se puede borrar cuando se confirme que no falta nada).
- **Despliegue:** el usuario lo está publicando en **Render** (Static Site: Build `bash tools/publicar.sh`, Publish directory `publicar`; o Web Service con Start `python3 -m http.server $PORT --directory publicar`). Dominio **topgit.earth** (registrado en Porkbun): añadir el dominio en Render y los registros DNS en Porkbun.
- **Tarea en curso al cerrar:** el usuario pidió una AUDITORÍA a fondo de la web («hasta el último píxel»): primero listar fallos SIN corregir; corregirlos solo cuando el usuario lo indique. El informe de esa auditoría está en `AUDITORIA.md` (si existe; si no, la auditoría quedó a medias y hay que rehacerla).

## Cómo arrancar
- Servidor: `python3 -m http.server 8080` en la raíz (suele haber uno ya en marcha). Live Server de VS Code (5500) tiene la recarga automática desactivada (`.vscode/settings.json`, `"**"`).
- Ir directo a resultados: `http://localhost:8080/?vista=resultados&cuerpo=mars&proposito=recursos&sub=liquido&objetivo=isru` (o `cuerpo=moon`).
- No hay `node`. Python con numpy, Playwright + Chromium e imageio-ffmpeg en `.venv`.
- El panel del navegador integrado debe estar VISIBLE para que la animación 3D avance (si está oculto, el viaje no termina).

## Qué hay hecho (resumen)
1. **Calidad general y móvil:** barra superior en una fila, globo encuadrado sobre la hoja inferior, ✕ fijo, telemetría estable, descenso del LM interrumpible.
2. **Gráficos con datos reales del PDS** (`js/analitica.js`, `js/graficos/*`): miniaturas de relieve, barra medido/estimado, panel «Compare with measured data» (matriz, distribución, latitud, dispersión, composición/temperatura), ficha con mapa del entorno, perfil y percentiles. Media de zona ponderada por área (`Capa.zona`, `Capa.pendiente`).
3. **Entrenamiento en la Tierra = sección principal:** botón destacado arriba (`ctaEntreno`, `ctaResultados`, `css/entreno.css`); panel compacto en una sola historia (`js/graficos/tierra-{panel,cara,clima,alternativas,datos}.js`): lugar recomendado con nombre e imagen CMR → «Same kind of ground» (mapas realistas `realista.js`, relieve SRTMGL30 en `base-planetaria/web/data/tierra/`) → «When to go» (NASA POWER en vivo, aprobado por el usuario) → «Other places» → «What you would train» → plegado «Places found by NASA terrain data» (motor precalculado en `base-planetaria/web/data/analogos/`, `js/graficos/analogo.js`, comparación detallada `js/comparacion.js`).
4. **Textos para público general:** título + frase + gráfico; lo técnico tras «Learn more» (`figura()`/`masInfo()` en `js/graficos/base.js`).
5. **Saturno V realista y mini detalles** (`js/saturno5.js`, `js/vuelo.js`): materiales, escarcha, motores, penachos, sombras, humo blanco, polvo del LM (Luna láminas rasantes, Marte nube ocre), LM apoyado en el relieve.
6. **Publicación:** `bash tools/publicar.sh` → `publicar/` (≈200 MB, ignorada por git). Fuera de localhost no se llama al motor local (`MOTOR_LOCAL`, `js/api.js`).
7. **Vídeo de 30 s:** `video/landfall_30s_voz.mp4` (y sin voz `video/landfall_30s.mp4`; los MP4 están en `.gitignore`). Scripts en `tools/video/` (`grabar.py` → `planeta.py` → `montar.py` → `voz.py`); guion de la locución en `video/guion_locucion.md`; locución aprobada: ElevenLabs «Hale» (ruta por defecto en `tools/video/locucion.py`).
8. Análogo del Teide renombrado a «Teide, Tenerife» · «Canary Islands, Spain».

## Pendiente conocido
- Cuatro detalles del cohete que quedaron a medias (se paró al agente): flames F-1 como columnas planas, rectángulo naranja de la llama bajo la plataforma, el LM no proyecta sombra solar, tono azulado del suelo de Marte de cerca.
- `REVISION_PENDIENTE.md`: aplicados todos (15-11-2026, sin commitear; ver su cabecera). También corregidos: TypeError al pulsar «Slope» en la matriz de Marte (cabeceras con `data-an-capa`), «Purpose chart» tapando el entrenamiento (se pliega al abrirlo) y cuña negra de la foto Landsat (cmr.js elige la escena de mayor cobertura).
- Duplicado sin usar: `base-planetaria/web/data/tierra/motor/` (la web usa `analogos/`; `publicar.sh` ya lo excluye).
- «Datos de referencia (estimación)» escritos a mano en `js/data.js` contradicen lo medido (Shackleton, Taurus-Littrow). Decisión del usuario.
- Recuentos distintos para el mismo lugar entre la comparación detallada y el panel (dos métodos del motor).
- Los 3 avisos 404 de `assets/*.glb` (modelos opcionales de Blender) son inofensivos.

## Reglas del usuario
- Solo datos reales que ya tiene el código; no inventar valores ni umbrales; preguntar antes de añadir otra fuente de datos.
- Corregir solo cuando el usuario lo pida (para la auditoría).
- No usar `git add -A` sin revisar tamaños; nada de archivos > 100 MB en git.
