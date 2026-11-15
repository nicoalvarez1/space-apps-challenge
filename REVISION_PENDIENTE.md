# Revisión del código de los gráficos: hallazgos confirmados (sin aplicar)

Cada hallazgo fue confirmado por un verificador independiente leyendo el código. Ninguno está aplicado todavía.


## [alta] Neutrones de Marte: el panel dice «claro = más hidrógeno» y la matriz pinta justo lo contrario
**Archivo:** js/graficos/panel.js

**Por qué:** Confirmado leyendo el código y con numpy. panel.js:72 escribe `k.def.por` entero, y el de mars_neutrones (js/capas.js:207) acaba en «Escala invertida: claro = más hidrógeno.». En el panel nada invierte: matriz.js:63 usa `colorSeq(v.pct)` y matriz.js:105 solo dice «el color sigue al valor medido». Con los .bin: Jezero 8,27 cuentas/s (percentil 89, celda clara) con 3,5 % de agua (percentil 36); Arcadia 5,17 cuentas/s (percentil 22, celda oscura) con 5,3 % de agua. El texto bajo el selector contradice el color de la matriz. distribucion.js:154 ya lo evita con `primeraFrase`, que es local a ese archivo, así que el arreglo repite el `split` en línea.

**Arreglo:**

panel.js:72, sustituir la línea por:
`const porTxt = (d) => (d.invertir ? `${String(d.por).split(/\.\s/)[0]}. En estos gráficos el color y los ejes siguen al valor medido (${d.unidad}), sin invertir.` : d.por);`
`if (por) por.textContent = k ? `${k.capa.meta.nombre} (${k.def.unidad}). ${porTxt(k.def)}` : '';`

matriz.js:105, sustituir por:
`...invertidas.map((k) => `En «${esc(corto(k))}» el color sigue al valor medido (${esc(k.def.unidad)}): claro = valor alto. ${esc(String(k.def.por).split(/\.\s/)[0])}.`),`

La primera frase de def.por es «…cuanto MENOS neutrones, MÁS hidrógeno (hielo) en el primer metro»: texto que ya existe. No toca entorno.js (neutrones no es capa local).


## [media] «Percentil 0» y «percentil 100» en el panel para valores que no son el mínimo ni el máximo
**Archivo:** js/graficos/matriz.js

**Por qué:** Confirmado. base.js:20-21 define `pctTxt` precisamente para esto y solo lo usa chispa.js:16. El panel usa `pct()` (Math.round) en matriz.js:62/64/160, distribucion.js:100/106-107/163, dispersion.js:227 y especifico.js:229-230. Con numpy: Shackleton, hidrógeno 146,7 ppm, fracción 0,9980, sale «percentil 100» con máximo de capa 195,6 ppm; Peary, T máxima 162 K, fracción 0,0004, sale «percentil 0» con mínimo 51,3 K. La ficha dice «>99» y «<1» para el mismo dato. tipHtml y tabla ya escapan los valores; el único punto sin escapar es el span sr-only de matriz.js:64, donde hay que añadir esc().

**Arreglo:**

Importar `pctTxt` de './base.js' en matriz.js, distribucion.js, dispersion.js y especifico.js (`pct` puede quitarse del import si deja de usarse) y cambiar:
- matriz.js:62 → `const N = v.pct === v.pct ? pctTxt(v.pct) : null;`
- matriz.js:64 → `` `percentil ${esc(N)}` `` (añadir esc: «<1» va a innerHTML)
- matriz.js:160 → `const N = v.pct === v.pct ? pctTxt(v.pct) : null, fs = [...]` (el resto de la línea igual)
- distribucion.js:100 → `const percentilDe = (v) => (v.pct === v.pct ? `percentil ${pctTxt(v.pct)}` : '');`
- distribucion.js:106-107 → `const v = p.v, filas = [[def.corto, def.fmt(v.media)]]; if (v.pct === v.pct) filas.push(['Percentil en la superficie', pctTxt(v.pct)]);`
- distribucion.js:163 → `pctTxt(p.v.pct)` en lugar de `pct(p.v.pct) ?? '—'`
- dispersion.js:227 → `const p = m.pct === m.pct ? pctTxt(m.pct) : null;`
- especifico.js:229-230 → quitar `const p = pct(z.pct);` y usar `pctTxt(z.pct)` en lugar de `p == null ? '—' : String(p)`.
El color (colorSeq(v.pct)) no cambia.


## [media] Tabla del entorno: «Mínimo/Máximo del entorno» no son los extremos de las celdas en los emplazamientos polares
**Archivo:** js/graficos/entorno.js

**Por qué:** Confirmado con numpy reproduciendo `ventana(..., {suave:false})` con n = 2·round(lado/celdaKm). En Shackleton el muestreo toca 23 584 celdas de las 127 884 con centro dentro del cuadrado: rugosidad máxima 3,42 m frente a 6,21 m reales; pendiente 1,61…33,99° frente a 1,09…37,79°; elevación −5 318…6 895 m frente a −5 368…6 907 m. En Peary, rugosidad mínima 0,36 m frente a 0,03 m. En Cabeus (84,9°S) ya coinciden. El comentario de las líneas 63-65 admite el fallo, y la tabla lo presenta como «extremos de las celdas publicadas». He comprobado en numpy que la proyección del arreglo propuesto (azimutal equidistante, |x| y |y| ≤ R) da los valores «reales» de arriba. El arreglo es correcto: usa fila/lat/lon/celda, que existen en Capa, y recorre unas 112 filas × 2880 columnas por capa, una vez, porque está memoizado. Solo añado un descarte del hemisferio opuesto para evitar un NaN teórico (k·sin(dl) = ∞·0 en el antípoda exacto).

**Arreglo:**

Añadir en js/analitica.js (tras `ventana`):
```js
// Extremos de las celdas con dato cuyo centro cae dentro del cuadrado de lado 2·radioKm (misma proyección que ventana)
export function extremosVentana(c, lat, lon, radioKm, Rkm) {
  const s0 = Math.sin(lat * DEG), c0 = Math.cos(lat * DEG), alc = (radioKm * Math.SQRT2 / Rkm) / DEG;
  const a = c.fila(Math.min(90, lat + alc)), b = c.fila(Math.max(-90, lat - alc));
  let min = Infinity, max = -Infinity;
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
    const la = c.lat(i) * DEG, s = Math.sin(la), co = Math.cos(la);
    for (let j = 0; j < c.w; j++) {
      const dl = (c.lon(j) - lon) * DEG, cc = Math.acos(Math.max(-1, Math.min(1, s0 * s + c0 * co * Math.cos(dl))));
      if (cc > Math.PI / 2) continue;
      const k = cc > 1e-9 ? cc / Math.sin(cc) : 1;
      if (Math.abs(Rkm * k * co * Math.sin(dl)) > radioKm || Math.abs(Rkm * k * (c0 * s - s0 * co * Math.cos(dl))) > radioKm) continue;
      const v = c.celda(i, j); if (v === v) { if (v < min) min = v; if (v > max) max = v; }
    }
  }
  return { min: min <= max ? min : NaN, max: min <= max ? max : NaN };
}
```
entorno.js: importar `extremosVentana` y sustituir las líneas 69-70 por `v = extremosVentana(x.capa, lat, lon, R, Rkm);`. En la línea 127 cambiar «(sin interpolar, muestreadas a medio paso de rejilla)» por «(sin interpolar: celdas con el centro dentro del cuadrado)». Actualizar el comentario de las líneas 63-65. `ventana` sigue usándose en suaveDe y `celdaKm` en la línea 181, así que no se quita ningún import.


## [media] Las advertencias de la fuente (meta.nota) solo se muestran en capas derivadas
**Archivo:** js/graficos/distribucion.js

**Por qué:** Confirmado. distribucion.js:155 y latitud.js:162 condicionan la nota a `k.derivada`. capas.json trae para moon_h «Contiene 4180 celdas con valor negativo (no físico)… NO es un archivo PDS revisado por pares» y para mars_neutrones «Sobre el casquete norte la escarcha estacional de CO2 tapa parte de la señal… por eso allí el flujo es alto». Con numpy, el 1,9 % del área lunar tiene hidrógeno ≤ 0, de modo que el histograma, que es la capa por defecto del panel, enseña ppm negativos sin explicación. No he recalculado la media zonal del polo norte de Marte; el fallo no depende de ella. El arreglo solo muestra texto que ya existe y se escapa con esc(). especifico.js:109 ya enseña meta.nota de sus capas, así que sigue el patrón del código. Único coste: notas largas repetidas en dos pies (p. ej. moon_pendiente); es aceptable.

**Arreglo:**

distribucion.js:155 → `c.meta.nota ? esc(c.meta.nota) : '',`
latitud.js:162 → `c.meta.nota ? esc(c.meta.nota) : '',`
(quitar `k.derivada &&` en ambas).


## [baja] «Percentil en Marte» y «mediana de Marte» de agua, hierro, silicio y cloro se calculan sobre el 79 % del planeta, sin los polos
**Archivo:** js/graficos/matriz.js

**Por qué:** Los hechos son ciertos. `muestra()` solo guarda celdas con dato (analitica.js:34) y, con numpy, mars_h2o cubre el 78,9 % del área (Meridiani 5,68 %, percentil 92 de esa parte). Los rótulos dicen «Percentil en Marte» y «mediana de Marte». Ya hay aviso genérico: pie de la matriz («solo cuentan las celdas con dato»), especifico.js:211 y :231 («superficie con dato») y def.por del agua («entre ~57°S y ~57°N»). Por eso la bajo a gravedad baja: falta decir cuánta superficie queda fuera. El arreglo propuesto toca `muestra()`, que ya está contrastada con numpy, y reutiliza def.nodata, cuyo texto dice «Se muestran como APROXIMACIÓN, marcada en la leyenda y el cursor». Eso es falso en el panel, que no usa las capas *_aprox. Propongo un arreglo que no toca `muestra()` ni usa def.nodata.

**Arreglo:**

Añadir en js/analitica.js (tras `cuantil`), sin tocar `muestra()`:
```js
// Parte (0…1) del área muestreada que tiene dato
export function cobertura(c) {
  const m = muestra(c); let todo = 0;
  for (let i = 0; i < c.n; i += m.paso) todo += Math.cos(c.lat(i) * DEG) * Math.ceil(c.w / m.paso);
  return todo > 0 ? m.total / todo : NaN;
}
```
matriz.js: importar `cobertura`; antes de `const pie = [` añadir `const parciales = cols.map((k) => [k, cobertura(k.capa)]).filter(([, q]) => q < 0.995);` y, tras la línea del <b>Percentil</b> (103), esta entrada:
`parciales.length ? `Sin dato en parte de la superficie (el percentil y la mediana se refieren solo a la parte con dato): ${esc(lista(parciales.map(([k, q]) => `${corto(k)}, ${nf(q * 100)} % con dato`)))}.` : '',`
matriz.js:160: `[cobertura(k.capa) < 0.995 ? 'Percentil en la superficie con dato' : `Percentil en ${cuerpo.nombre}`, N ?? '—']`.
dispersion.js:77 y especifico.js:191 pueden quedarse: sus pies ya dicen «superficie con dato». No usar def.nodata.


## [baja] El panel afirma «Aquí no interviene la puntuación» pero numera y ordena todo por el puesto
**Archivo:** js/graficos/panel.js

**Por qué:** Confirmado. panel.js:82 dice «Aquí no interviene la puntuación ni ninguna estimación». Sin embargo `s.rank` aparece en panel.js:85 (botones «Destacar»), en matriz.js:68-69 y :119 («puesto y nombre», orden por defecto «Por puesto») y en la dispersión («el número es su puesto», dispersion.js:214). Ningún valor ni color depende de la puntuación, así que es solo una frase demasiado tajante. El arreglo es de texto y no rompe nada: va en innerHTML, sin caracteres que escapar.

**Arreglo:**

panel.js:82, cambiar la última frase «Aquí no interviene la puntuación ni ninguna estimación.» por: «Ningún valor ni color de estos gráficos depende de la puntuación ni de estimaciones; el número de cada emplazamiento es solo su puesto en la lista de resultados y sirve para identificarlo y ordenarlo.»


## [baja] La nota de la ficha llama «dato publicado» al histograma de la pendiente regional de Marte, que se deriva en el navegador
**Archivo:** js/main.js

**Por qué:** Confirmado. main.js:270 dice «toda la superficie … con dato publicado». chispasFicha (main.js:315) usa `pendienteCeldas(body)` cuando `m.derivada === 'pendiente'`; capas.js:312 y :345 marcan así la medida «Pendiente regional» de Marte. Esa rejilla se calcula en el navegador y su propia meta.nota lo dice. Es una imprecisión de texto, real pero menor. La segunda parte también es cierta: distribucion.js:84 pone en el aria-label de la primera y la última barra solo «tramo: parte de la superficie», aunque esas barras acumulan las colas (analitica.js:76-77), y solo el tooltip lo aclara. En la Luna ninguna medida lleva derivada, así que el condicional no cambia nada allí.

**Arreglo:**

main.js:270, sustituir «con dato publicado y la marca» por:
`con dato${s.medidas.some((m) => m.derivada) ? ' (la pendiente regional no es una rejilla publicada: se deriva de la elevación MOLA celda a celda)' : ' publicado'} y la marca`
(dentro de la plantilla; es texto fijo, sin esc necesario).

distribucion.js: mover la definición de `tipColumna` no hace falta; basta con calcular antes de `columnas`:
`const cola = (b) => (b === 0 && h.colaBaja > 0 ? ` Incluye el ${nf(h.colaBaja * 100, 1)} % de la superficie con valores por debajo del eje.` : '') + (b === h.n - 1 && h.colaAlta > 0 ? ` Incluye el ${nf(h.colaAlta * 100, 1)} % de la superficie con valores por encima del eje.` : '');`
y en la línea 84: `aria-label="${esc(`${tramo(b)}: ${parte(a)} de la superficie.${cola(b)}`)}"`.


## [media] Distribución: los emplazamientos fuera del eje se dibujan pegados al borde
**Archivo:** /Users/martiquimmargot/Nasa/space-apps-challenge/js/graficos/distribucion.js

**Por qué:** Confirmado en el código (l. 46 y 53: la x se recorta a [h.lo, h.hi]; solo el tooltip lo avisa, l. 111-112) y con numpy replicando muestra()/cuantil()/zona(). Luna, capa por defecto moon_h: eje −14,4 … 134,2 ppm; Shackleton 146,7, Shackleton–de Gerlache 145,0, Cabeus 140,8 y Peary 153,5 quedan los cuatro en x = 134,2, apilados en las 4 filas, y la etiqueta «Shackleton · 147 ppm» cuelga de esa x. También: Máxima (Shackleton 202, Cabeus 205, Peary 162 con eje desde 224,9), Mínima (Cabeus 40,5, Peary 36,5; Aristarco 115 con eje 51,9–97,1), Media (3), Rugosidad (Aristarco 2,51 con eje hasta 1,86) y Marte Elevación (Arsia 16 420 m con eje hasta 7 401). Es un comportamiento intencionado (comentario l. 49), pero la posición dibujada es falsa y no hay marca visible; por eso media y no alta: el valor correcto sí aparece escrito en la etiqueta, el tooltip y la tabla. El arreglo propuesto es correcto y no inventa nada (solo cambia el dominio del eje).

**Arreglo:**

distribucion.js:
- l. 46: `const medias = ctx.filas.map((f) => f.v[def.id]?.media).filter((v) => v != null && v === v);`
  `const x = lineal(Math.min(h.lo, ...medias), Math.max(h.hi, ...medias), M.l, W - M.r);`
- l. 53: `x: x(v.media)` (se conserva `fuera` para la nota).
- l. 73-74: `marcas(x.d[0], x.d[1], 5)` y `marcas(x.d[0], x.d[1], n)`.
- l. 78: `const bx = (b) => x(h.lo + b * h.ancho), bw = bx(1) - bx(0);` y en l. 85-86 sustituir `M.l + b * bw + 1` por `bx(b) + 1` y `M.l + b * bw` por `bx(b)`.
- l. 111-112: «Queda por debajo/por encima del tramo de las barras (percentil 0,5 / 99,5 de la superficie).» (quitar «el punto se dibuja en el borde»).
- l. 152: «Las barras van del percentil 0,5 al 99,5 de la superficie; …» (resto igual). Actualizar los comentarios de las l. 10 y 49.
No tocar intervaloDe (los de fuera siguen contando en la barra extrema, que es donde histograma() acumula las colas).


## [alta] Neutrones de Marte: «Escala invertida: claro = más hidrógeno» bajo el selector contradice el color de la matriz
**Archivo:** /Users/martiquimmargot/Nasa/space-apps-challenge/js/graficos/panel.js

**Por qué:** Confirmado. panel.js:72 copia def.por entero; para mars_neutrones (capas.js:207) acaba en «Escala invertida: claro = más hidrógeno.». La matriz colorea con colorSeq(v.pct) (matriz.js:63) y SEQ va de oscuro a claro al crecer el percentil del valor: claro = más cuentas/s = menos hidrógeno. Con numpy: Jezero 8,27 cuentas/s (percentil 89, claro) y Arcadia 5,17 (percentil 22, oscuro), mientras que su agua GRS es 3,5 % (p36) y 5,3 % (p87). matriz.js:105 solo dice «el color sigue al valor medido»; latitud.js no lleva el «Cómo leerla» que sí tiene distribucion.js:154. Los dobles paréntesis también son ciertos (meta.nombre = «Neutrones epitermales (indicador de hidrógeno)» + « (cuentas/s)»). OJO: el arreglo propuesto para panel.js elimina la guarda `k ?` y lanzaría TypeError si no hay capa; se corrige abajo.

**Arreglo:**

panel.js:72:
`por.textContent = k ? `${k.capa.meta.nombre} · ${k.def.unidad}. ${String(k.def.por).replace(/\s*Escala invertida:[^.]*\./, '')}` : '';`
matriz.js:105:
`...invertidas.map((k) => `En «${esc(corto(k))}» el color sigue al valor medido (${esc(k.def.unidad)}): ${esc(String(k.def.por).split(/\.\s/)[0])}.`),`
latitud.js, en la lista del pie tras la l. 161:
`def.invertir ? `<b>Cómo leerla:</b> ${esc(String(def.por).split(/\.\s/)[0])}.` : '',`
(la primera frase de def.por es «Flujo de neutrones epitermales: cuanto MENOS neutrones, MÁS hidrógeno (hielo) en el primer metro»: texto que ya existe).


## [media] El mismo percentil se escribe «100»/«0» en el panel y «>99»/«<1» en la ficha
**Archivo:** /Users/martiquimmargot/Nasa/space-apps-challenge/js/graficos/distribucion.js

**Por qué:** Confirmado: pctTxt (base.js:21) solo se usa en chispa.js; distribucion.js:100/107/163, matriz.js:64/160, dispersion.js:227 y especifico.js:229-230 escriben pct() redondeado. Con numpy: Shackleton H 0,9980, Peary 0,9988, Cabeus 0,9970, Sh.–de Gerlache 0,9978 (todos > 0,995 → «100» en el panel, «>99» en la ficha); Aristarco Rugosidad 0,9994 y Mínima 0,9999; Peary Máxima 0,0004, Cabeus Mínima 0,0008 (→ «0» frente a «<1»); Arsia Elevación 0,9996. El arreglo es seguro: pctTxt devuelve '—' con NaN.

**Arreglo:**

Importar `pctTxt` de ./base.js en los cuatro módulos y:
- distribucion.js:100 `const percentilDe = (v) => (v.pct === v.pct ? `percentil ${pctTxt(v.pct)}` : '');`
- :107 `if (P != null) filas.push(['Percentil en la superficie', pctTxt(v.pct)]);`
- :163 `pctTxt(p.v.pct)` en lugar de `pct(p.v.pct) ?? '—'`
- matriz.js:64 `percentil ${pctTxt(v.pct)}`; :160 `[`Percentil en ${cuerpo.nombre}`, pctTxt(v.pct)]`
- dispersion.js:227 `(percentil ${pctTxt(m.pct)})`
- especifico.js:230 `p == null ? '—' : pctTxt(z.pct)`
Mantener `pct()` solo para las comprobaciones de null y el color.


## [baja] Pie de «Composición del suelo» (Marte): metadatos de procesado copiados tal cual
**Archivo:** /Users/martiquimmargot/Nasa/space-apps-challenge/js/graficos/especifico.js

**Por qué:** El hecho es cierto: l. 207 vuelca separar(meta.procesado).comun, que para las capas GRS es el texto entero («Copia de la columna CONCENTRATION de la tabla PDS (9999.999 = sin dato → NaN). La tabla ya viene suavizada con una ventana de 10° y rebineada a 5°. Sin interpolar.»), y la l. 210 cita el procesado de las capas sigma. Pero es una decisión deliberada (comentario l. 196-197: decir qué es la barra con las palabras de los metadatos) y coherente con «no inventes nada»; es un problema de redacción, no de datos: baja, no media. El arreglo propuesto se pasa: quitar `(${barras})` elimina el único sitio donde se dice qué incertidumbre es (SIGMA WITH CFS frente a SIGMA en K y Th), que es información real. Lo que sí conviene: quitar proc.comun (repite el suavizado de 10° que ya da fuenteDe y añade el «9999.999 → NaN») y subir al subtítulo que cada panel tiene su escala.

**Arreglo:**

especifico.js:
- l. 207: quitar ` ${esc(proc.comun)}` (y `proc` de la l. 206, dejando `const citas = …`).
- l. 212: quitar «Cada panel tiene su propia escala horizontal. » (dejar `${citas.map(esc).join(' ')}`).
- l. 220: `sub: 'Cada panel es un elemento, con su propia escala horizontal; cada fila, un emplazamiento (por su puesto).'`
Conservar la l. 210 con `(${barras})`.


## [baja] Pie de «Temperatura de día y de noche» (Luna): remisiones a capas que la web no ofrece
**Archivo:** /Users/martiquimmargot/Nasa/space-apps-challenge/js/graficos/especifico.js

**Por qué:** Confirmado: l. 109-112 imprimen meta.procesado y meta.nota de moon_tmin/tmedia/tmax, que contienen «(ver capa de hueco)» y «(ver capa de nº de intervalos)»; moon_t_hueco y moon_t_nbins existen en capas.json pero no están en CAPAS_GLOBO.moon (capas.js:194-201), así que el lector no puede verlas. Eso es el defecto real. La «jerga» (tbol, poligonal periódica) es texto fiel de los metadatos y una decisión deliberada (comentario l. 108): no es un error. El arreglo propuesto elimina todo el procesado, que es más de lo necesario; basta quitar las remisiones colgantes.

**Arreglo:**

especifico.js, antes de la l. 109:
`const sinRemision = (t) => String(t ?? '').replace(/\s*\(ver capa de [^)]*\)/g, '');`
y en las l. 110-112 envolver los tres textos: `${esc(sinRemision(proc.comun))}`, `${esc(sinRemision(proc.propio[i]))}`, `${notas.map((t) => esc(sinRemision(t))).join(' ')}`. Nada más.


## [media] Capas de temperatura: «Media: cómo cambia con la latitud» / leyenda «Media por franja de latitud»
**Archivo:** /Users/martiquimmargot/Nasa/space-apps-challenge/js/graficos/latitud.js

**Por qué:** Confirmado: capas.js:197-199 definen corto = «Máxima», «Mínima», «Media»; latitud.js:41, 89, 104, 142, 166-167 y distribucion.js:39, 106, 136, 160-161 usan def.corto a secas, mientras que dispersion.js:30 ya tiene nombreDe() («Temperatura media»). Con moon_tmedia, latitud muestra título «Media: cómo cambia…», leyenda «Media por franja de latitud» (l. 150), tooltip de franja `['Media', …]` (l. 91) y de emplazamiento «Media … / Media de su franja de latitud …», y cabeceras «Media (K)» / «Media de su franja (K)». El arreglo es correcto; hay que borrar la definición local de dispersion.js para no duplicar el identificador.

**Arreglo:**

base.js (añadir):
`export const nombreDe = (def) => (def.grupo?.startsWith('Temperatura') ? `Temperatura ${def.corto.toLowerCase()}` : def.corto);`
dispersion.js: borrar la l. 30 e importar `nombreDe` de ./base.js.
latitud.js y distribucion.js: importar `nombreDe` y sustituir `def.corto` por `nombreDe(def)` en latitud.js l. 41, 89, 104, 142, 166 y 167, y distribucion.js l. 39, 106, 136, 160 y 161. Selector de capas y cabeceras de la matriz siguen con `corto`.


## [baja] Capas GRS de Marte: «Superficie de Marte» / «percentil en Marte» sobre el 79 % del planeta
**Archivo:** /Users/martiquimmargot/Nasa/space-apps-challenge/js/graficos/distribucion.js

**Por qué:** Los hechos son ciertos: con numpy, la cobertura ponderada por cos(lat) de mars_h2o y mars_cl es 0,7891 (sin dato en los polos), Meridiani sale 5,68 % · percentil 92, y la leyenda (l. 143), el eje (l. 137) y matriz.js:160 dicen «superficie de Marte». Pero no está oculto: el pie de la distribución dice «histograma de las celdas con dato», el de la matriz «solo cuentan las celdas con dato», el tooltip de especifico «superficie con dato», y para el agua el texto bajo el selector dice «entre ~57°S y ~57°N». Lo que falta es cuánta superficie queda fuera; por eso baja. El arreglo es válido y no inventa datos (la cobertura sale de la misma muestra; el umbral 0,995 ya se usa igual en latitud.js:90). Basta la leyenda; el añadido al tooltip de la matriz es opcional.

**Arreglo:**

analitica.js, muestra():
- l. 31: añadir `let todo = 0;`
- l. 34: `for (let j = 0; j < c.w; j += paso) { todo += w; const v = c.celda(i, j); if (v === v) { vs.push(v); ws.push(w); } }`
- l. 40: `return (c._muestra = { v, acum, total, paso, cobertura: todo ? total / todo : 1 });`
distribucion.js: subir `const m = muestra(c);` (l. 148) antes de la l. 142 y en la l. 143:
`{ clase: 'g-m-planeta', texto: m.cobertura < 0.995 ? `Superficie ${cuerpo.de} con dato (${nf(m.cobertura * 100)} % del total)` : `Superficie ${cuerpo.de}` },`


## [baja] Ficha: dos «Elevación» distintas para el mismo emplazamiento (zona en la tarjeta, celda en el perfil y la tabla)
**Archivo:** /Users/martiquimmargot/Nasa/space-apps-challenge/js/graficos/corte.js

**Por qué:** Mecanismo confirmado: corte.js:50/112 rotula c.en(lat, lon) (celda) y entorno.js:129 da lo mismo bajo «En el emplazamiento»; la tarjeta de mediciones usa Capa.zona (media de 0,5°). Con numpy: Malapert celda 4874 m frente a zona ≈ 2665 m; Shackleton 821 frente a ≈ −292; Taurus-Littrow −2638 frente a −1942; Gale −1541 frente a −2214 (las cifras de zona del revisor para Malapert y Shackleton, 2714 y 3, no me salen, pero la discrepancia de cientos/miles de metros sí). Ambas cifras son reales y el pie ya dice que la etiqueta es la celda, así que es baja: falta solo ponerlas en relación. main.js:297 pasa efectivamente `fila: datos.filas[0]` (medirTodo(body, [s])), de modo que el arreglo funciona.

**Arreglo:**

corte.js, antes de la l. 160: `const zona = ctx.fila?.v?.[def.id];`
y al final del pie (tras «…La celda del emplazamiento no tiene dato.» de la l. 163) añadir:
`${zona && zSitio === zSitio ? ` La media de la zona medida (la «Elevación» de las mediciones de la ficha) es ${esc(def.fmt(zona.media))}; la etiqueta del punto es su celda.` : ''}`
entorno.js:128: `'En el emplazamiento'` → `'Celda del emplazamiento'`.


## [media] Hidrógeno lunar: el histograma empieza en −14 ppm y nada explica los valores negativos
**Archivo:** /Users/martiquimmargot/Nasa/space-apps-challenge/js/graficos/distribucion.js

**Por qué:** Confirmado con numpy: para moon_h cuantil 0,5 % = −14,43 ppm y el 1,92 % del área tiene valor negativo; es la capa que se abre por defecto en la Luna (panel.js:143). La explicación está en capas.json (nota: «Contiene 4180 celdas con valor negativo (no físico)…») pero distribucion.js:155 solo imprime meta.nota en capas derivadas. El arreglo propuesto escribe a mano en capas.js una frase nueva que duplica el metadato; es más fiel y más pequeño mostrar la nota existente cuando el eje baja de cero en una capa que no es de elevación... pero eso exigiría una regla ad hoc. Lo mínimo y sin texto nuevo: mostrar la nota de la fuente cuando menciona los negativos.

**Arreglo:**

distribucion.js:155, sustituir la línea por:
`(k.derivada || h.lo < 0) && c.meta.nota && (k.derivada || /negativo/.test(c.meta.nota)) ? esc(c.meta.nota) : '',`
(solo moon_h tiene «negativo» en su nota; moon_elev y mars_elev también tienen h.lo < 0 pero su nota no lo menciona y no se imprime). Si se prefiere más simple y explícito: `k.derivada || def.id === 'moon_h'` como condición. No añadir texto nuevo en capas.js.


## [baja] Dispersión: «y Inercia térmica», «y Hidrógeno» en el título, la leyenda y la tabla
**Archivo:** /Users/martiquimmargot/Nasa/space-apps-challenge/js/graficos/dispersion.js

**Por qué:** Confirmado: l. 213 `${nx} y ${ny}`, l. 204 igual, l. 181 `.join(' y ')` y aria-label de la l. 145; el selector «Comparar con» ofrece las demás capas (Inercia térmica en Marte, Hidrógeno en la Luna). matriz.js:26 ya tiene lista() con la regla «e» ante i-/hi- (regex /^h?i(?![aeo])/i: «e Inercia», «e Hidrógeno», «y Hierro»). El arreglo es correcto; al mover lista a base.js hay que importarla en matriz.js.

**Arreglo:**

base.js: añadir `export const lista = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} ${/^h?i(?![aeo])/i.test(xs[xs.length - 1]) ? 'e' : 'y'} ${xs[xs.length - 1]}` : xs[0] ?? '');`
matriz.js: borrar la l. 26 e importar `lista` de ./base.js.
dispersion.js (importar `lista`):
- l. 213 `titulo: `Dos mediciones a la vez: ${lista([nx, ny])}`,`
- l. 204 `titulo: `${lista([nx, ny])} de los ${filas.length} emplazamientos ${cuerpo.de}`,`
- l. 181 `± incertidumbre publicada (${lista(conErr.map((k) => nombreDe(k.def)))})`


## [baja] Entorno: los extremos de la leyenda de color no coinciden con los de la tabla ni con el cursor
**Archivo:** /Users/martiquimmargot/Nasa/space-apps-challenge/js/graficos/entorno.js

**Por qué:** Mecanismo confirmado leyendo el código: la leyenda (l. 106) rotula vTinte.min/max de la ventana suave (bilineal, analitica.js:133, que nunca supera los extremos de las celdas y recorta picos), y la tabla (l. 129) y el cursor dan celdas publicadas (crudaDe / Capa.en); por tanto el cursor puede leer un valor fuera de la escala rotulada. No he reproducido las cifras concretas (Jezero 9,2° frente a 10,0°), pero la diferencia es estructural. Está documentado en el pie (l. 121: «su escala de color va del mínimo al máximo de lo que se ve; el cursor y la tabla dan el valor de la celda publicada»), por eso baja. El arreglo propuesto necesita una guarda: crudaDe devuelve NaN si no hay dato y Math.min(NaN, x) = NaN rompería pos().

**Arreglo:**

entorno.js, l. 77-79:
```js
const ext = crudaDe(k), hayDato = vTinte.min <= vTinte.max, inv = !!k.def.invertir;
const eMin = ext.min === ext.min ? Math.min(ext.min, vTinte.min) : vTinte.min, eMax = ext.max === ext.max ? Math.max(ext.max, vTinte.max) : vTinte.max, tramo = eMax - eMin;
const pos = (v) => { const t = tramo > 0 ? (v - eMin) / tramo : 0.5; return inv ? 1 - t : t; };
```
l. 106: `k.def.fmt(eMin)` y `k.def.fmt(eMax)`.
l. 121 del pie: «…su escala de color va del mínimo al máximo de las celdas publicadas de este entorno; …». La tabla no hace falta tocarla.


## [baja] Ficha: coordenadas con punto decimal en la cabecera y con coma en los gráficos nuevos
**Archivo:** /Users/martiquimmargot/Nasa/space-apps-challenge/js/main.js

**Por qué:** Confirmado: la cabecera de renderDetail usa toFixed(1) (punto) y el `coord` local de main.js está en la l. 519 (no 512), usado en el tooltip del globo (l. 574, no 567); entorno.js:127 y el tooltip del mapa usan coord() de base.js (nf es-ES, coma). Solo hay esas dos apariciones de `coord` en main.js, así que sustituir la definición local por la importada es seguro (misma firma; el tooltip del globo pasa también a coma, coherente con el resto). Hay que borrar la const local o el import daría SyntaxError por identificador duplicado.

**Arreglo:**

main.js:
- l. 13: `import { CUERPO, tip as tipGrafico, coord } from './graficos/base.js';`
- borrar la l. 519 (`const coord = (lat, lon) => …toFixed(1)…`).
- en la cabecera de renderDetail: `<small>${esc(s.region)} · ${coord(s.lat, s.lon)}</small>`


## [alta] Las cabeceras de la matriz usan data-capa, que ya escucha proposito.js: cambian la capa del globo, se desmarcan y en Marte lanzan un TypeError
**Archivo:** /Users/martiquimmargot/Nasa/space-apps-challenge/js/graficos/matriz.js

**Por qué:** Confirmado leyendo el código. matriz.js:54 pinta `data-capa`. proposito.js:744-760 tiene un escucha de clic en `document` que captura `[data-capa]` y ejecuta `ctx.setLayer(id)`, `cerrarDialogos()` y `anunciar(… etiquetaCapa(id) …)`. Aunque el panel repinte antes la matriz, `closest` sigue encontrando el botón en el subárbol desprendido, así que el escucha global se ejecuta igual. `setLayer` (main.js:548) pinta la capa en el globo, o la quita si ya estaba; después `renderLayers` llama a `alCambiarCapa` (proposito.js:513), que reescribe `aria-pressed` y `.sel` de todas las cabeceras según la capa del globo. Con `mars_pend`: no está en capas.json (comprobado) ni en CAPAS_GLOBO, `setLayer` no hace nada y `etiquetaCapa` evalúa `cfg.capas['mars_pend'].nombre`, que lanza TypeError (proposito.js:150). Solo matriz.js y panel.js usan `data-capa` dentro de js/graficos. El arreglo propuesto es correcto: `pintarControles` ya mantiene `aria-pressed` de `[data-an-capa]`.

**Arreglo:**

matriz.js:54: cambiar `data-capa="${esc(d.id)}"` por `data-an-capa="${esc(d.id)}"`.
matriz.js:151-153: `conTip(el, 'td[data-k], button[data-an-capa]', (t) => { if (t.dataset.anCapa) { const k = cols.find((x) => x.def.id === t.dataset.anCapa);` (el resto igual).
panel.js:60: `for (const at of ['data-clave', 'data-sitio', 'data-an-capa'])`, para que el foco vuelva a la cabecera tras repintar.
Opcional: quitar la rama `t.dataset.capa` (panel.js:162) y `[data-capa]` del selector (panel.js:167), y corregir el comentario de panel.js:16.


## [media] Tres gráficos con viewBox fijo de 460: en móvil el texto queda a 5,7–6,9 px y las marcas pulsables a 9–11 px
**Archivo:** /Users/martiquimmargot/Nasa/space-apps-challenge/js/graficos/distribucion.js

**Por qué:** Confirmado por lectura y aritmética sobre el CSS, sin navegador. distribucion.js:21 y latitud.js:21 fijan `W = 460` y especifico.js:68 también; `.g-svg { width: 100%; height: auto }` con texto de 10 px lo escala entero. En móvil `.about` mide `100% − 1,2rem` con relleno de 1,1rem (style.css:345), unos 318 px a 375: factor 0,69 y texto a unos 6,9 px. `W` solo se usa dentro de `pintar` en los dos archivos, y el contenedor ya está en el DOM al pintar (panel.js:50-51), así que medir `el.clientWidth` es viable. Bajo la gravedad a media: es legibilidad, no rotura. Rechazo dos partes del arreglo. Las zonas de acierto de 24 px se solaparían entre puntos vecinos (HUECO = 11, FILA = 12 en distribucion.js:24) y el clic iría al emplazamiento equivocado; con el viewBox a escala 1 las de 16 px ya miden 16 px reales. Tampoco hace falta tocar dispersion.js ni corte.js: a 375 px quedan a 0,94 y 0,87.

**Arreglo:**

distribucion.js:21: `const M = { l: 40, r: 12, b: 36 };` y, al principio de `pintar(el, ctx)`: `const W = Math.round(Math.min(560, Math.max(280, el.clientWidth || 460)));`.
latitud.js:21: `const H = 236, M = { l: 50, r: 14, t: 18, b: 36 };` y la misma línea de `W` al principio de `pintar`.
especifico.js:68 (Luna): `const uni = kMax.def.unidad, W = Math.round(Math.min(560, Math.max(280, el.clientWidth || 460))), mL = W < 380 ? 96 : 138, mR = 28, …`; en la línea 89: `corta(nombreCorto(r.s.name), W < 380 ? 13 : 21)`.
Opcional: copiar al final de cada `pintar` el ResizeObserver de dispersion.js:241-246, comparando `el.clientWidth` con `W`, para repintar al girar el móvil.
No cambiar las zonas de acierto, `ANCHO.min` ni corte.js.


## [baja] 98 paradas de tabulador en el panel de la Luna y 146 en el de Marte; 60 solo en «Composición del suelo»
**Archivo:** /Users/martiquimmargot/Nasa/space-apps-challenge/js/graficos/especifico.js

**Por qué:** El recuento cuadra con el código: `tabindex="0"` en cada fila de especifico.js:51 (repetida en los paneles de Marte, líneas 173 y 182), en cada círculo de distribucion.js:102 y latitud.js:100, en cada `g.g-ds-p` de dispersion.js:116 y en los botones de matriz.js:68. Es un problema de eficiencia con teclado, no una rotura: todo es alcanzable y existe «Ver en tabla». Por eso lo bajo a gravedad baja. El arreglo propuesto funciona, pero le falta sincronizar la parada cuando el foco llega por otra vía: panel.js:53 devuelve el foco tras repintar a un elemento que quedaría con `tabindex="-1"`, y en dispersión `.sel` está en el círculo interior, no en el `<g>`.

**Arreglo:**

En base.js añadir:
```js
export function unaParada(raiz, selector) {
  const els = () => [...raiz.querySelectorAll(selector)];
  const fijar = (el) => els().forEach((x) => x.setAttribute('tabindex', x === el ? '0' : '-1'));
  fijar(raiz.querySelector(`${selector}.sel`) ?? els()[0]);
  raiz.addEventListener('focusin', (e) => { const a = e.target.closest?.(selector); if (a && raiz.contains(a)) fijar(a); });
  raiz.addEventListener('keydown', (e) => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key], a = e.target.closest?.(selector);
    if (!d || !a || e.ctrlKey || e.metaKey || e.altKey) return;
    const xs = els(), o = xs[xs.indexOf(a) + d];
    if (o) { e.preventDefault(); o.focus(); }
  });
}
```
Llamarla tras `el.innerHTML = …`:
- distribucion.js y latitud.js: `unaParada(el, 'circle[data-sitio]')`.
- dispersion.js: `unaParada(el, 'g.g-ds-p')`.
- especifico.js, Luna: `unaParada(el, 'g.g-es-fila')`.
- especifico.js, Marte: `el.querySelectorAll('svg[data-es-col]').forEach((s) => unaParada(s, 'g.g-es-fila'))`, que deja 6 paradas en vez de 60.
- matriz.js: `unaParada(el, '.g-mz-sitio')`.
Añadir «flechas para recorrer los emplazamientos» al aria-label del grupo. Aplicar junto con el arreglo de `data-clave` del hallazgo de Marte.


## [media] El foco se pierde al elegir un emplazamiento con el teclado, al cerrar la ficha y con «Ver la ficha de…»; el <li> pulsable no tiene rol
**Archivo:** /Users/martiquimmargot/Nasa/space-apps-challenge/js/main.js

**Por qué:** Confirmado. main.js:173 pinta `<li … tabindex="0">` y 229-232 atiende Intro y espacio. `selectSite` (234-244) oculta `#results` sin mover el foco, así que el `<li>` enfocado queda en un panel oculto y el foco cae en `<body>`. `closeDetail` (325-330) oculta `#detail` con el foco dentro, también desde Escape (main.js:594-597), y no lo devuelve. panel.js:159 hace `cerrar()`, que enfoca el origen, y luego `selectSite` lo oculta. No hay otra gestión de foco en ese camino. El arreglo del foco es correcto y seguro: `#detail-close` es estático (main.js:324). Rechazo envolver la fila en un `<button>`: dentro lleva un `<div class="nm">`, que no es contenido válido de botón, y todo el diseño cuelga de `#res-list li { display: flex … }` (style.css:137), así que rompería la maquetación. La falta de rol es cierta pero menor.

**Arreglo:**

En `selectSite`, tras `$('#detail').scrollTop = 0;` añadir `$('#detail-close').focus({ preventScroll: true });`.
En `closeDetail`: `const id = current?.id;` al principio y, después de `document.querySelectorAll('#res-list li').forEach(…)`, añadir ``if (id) document.querySelector(`#res-list li[data-id="${id}"]`)?.focus({ preventScroll: true });``.
No envolver la fila en `<button>`; el rol queda como mejora aparte.


## [media] Texto blanco con contraste de 3,0 a 4,4:1 en las celdas de la matriz entre los percentiles 42 y 58
**Archivo:** /Users/martiquimmargot/Nasa/space-apps-challenge/js/graficos/base.js

**Por qué:** Recalculado con la rampa SEQ del archivo y la fórmula de base.js:50-53. Con el umbral 0,3 el texto blanco baja de 4,5:1 entre los percentiles 41 y 58,5, con un mínimo de 3,01:1 en el 58,5 (percentil 50: 3,64; 55: 3,24). El texto de celda es de .7rem. Con umbral 0,179 y `#000000` el mínimo de toda la rampa es 4,59:1; con `#0b0b0b` sería 4,31:1, así que hace falta negro puro. El cambio solo afecta al color de la tinta, no a ningún dato. `tintaSobreSeq` solo se usa en matriz.js.

**Arreglo:**

base.js:52: `return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? '#000000' : '#ffffff';`


## [baja] Indicador de foco casi invisible (1,1–1,8:1) en columnas del histograma, franjas de latitud y líneas de mediana
**Archivo:** /Users/martiquimmargot/Nasa/space-apps-challenge/css/g-capa.css

**Por qué:** Confirmado. g-capa.css:10 y 19 y g-dispersion.css:23 anulan el contorno. Lo sustituyen por `stroke: var(--g-eje)`, que da 1,80:1 sobre `#070a16`, o por rellenos de 1,14:1 (franjas) y 1,37:1 (medianas), según mi cálculo. Lo bajo a gravedad baja porque el tooltip aparece junto al elemento enfocado (`focusin` de conTip) y ya indica dónde está el foco. El arreglo es solo CSS y seguro: la regla tiene más especificidad que `.g-hit { stroke: none }`, y el acento da 15,7:1.

**Arreglo:**

css/g-capa.css:13: `.g-di-col:focus-visible .g-hit { stroke: var(--accent); stroke-width: 1.5; }`
css/g-capa.css:21: `.g-svg .g-la-fr:focus-visible { stroke: var(--accent); stroke-width: 1.5; }`
css/g-dispersion.css:24: `.g-ds-med:focus-visible { fill: rgba(198, 205, 228, .16); stroke: var(--accent); stroke-width: 1.5; }`


## [baja] En «Composición del suelo» (Marte), al destacar un emplazamiento con el teclado el foco salta al primer panel
**Archivo:** /Users/martiquimmargot/Nasa/space-apps-challenge/js/graficos/panel.js

**Por qué:** Confirmado. `claveFoco` (panel.js:57-62) devuelve `g[data-sitio="…"]` y panel.js:53 hace `$(foco, nuevo)`, un `querySelector` que da la primera coincidencia. En Marte cada emplazamiento se repite en todos los paneles con el mismo `data-sitio` y sin `data-clave` (especifico.js:51, 173 y 182), así que el foco vuelve siempre a la fila del primer panel. `data-clave` es el primer atributo que mira `claveFoco`, y `CSS.escape` protege los dos puntos. Ningún otro escucha de especifico.js ni de panel.js lee `data-clave`; el de matriz.js:145 está limitado a `button[data-clave]` dentro de su propio contenedor.

**Arreglo:**

especifico.js:51: ``const grupoFila = (s, sel, aria, y, alto, W, dentro, clave = '') => `<g class="g-es-fila${sel ? ' sel' : ''}" data-sitio="${esc(s.id)}"${clave ? ` data-clave="${esc(clave)}"` : ''} tabindex="0" role="button" …`` (el resto igual).
especifico.js:173: `return grupoFila(s, sel, …, y, alto, W, puesto, `${id}:${s.id}`);`
especifico.js:182: `return grupoFila(s, sel, …, y, alto, W, puesto + marca, `${id}:${s.id}`);`


## [baja] Las barras del histograma y de las chispas tienen 2,1:1 de contraste con el fondo, y la banda de cuartiles 1,4:1
**Archivo:** /Users/martiquimmargot/Nasa/space-apps-challenge/css/graficos.css

**Por qué:** Cifras recalculadas: `#3d4763` da 2,14:1 sobre `#070a16` y 2,09:1 sobre `#0a0e1c`; `.g-banda` con opacidad .55 da 1,42:1. Queda por debajo del 3:1 exigible a marcas que llevan el dato (barras del histograma y de las chispas). Es en parte decisión de diseño, por eso gravedad baja; el cambio es solo de color. `#56628a` da 3,30:1 y 3,21:1. `COLOR.planeta` de base.js:30 no se usa en ningún lienzo, pero conviene igualarlo. El realce de g-capa.css:11 usa hoy `#56628a` y hay que subirlo para que siga distinguiéndose. Corrección al revisor: la banda con el color nuevo y opacidad .7 solo llega a 2,19:1, así que necesita el borde.

**Arreglo:**

css/graficos.css:10: `--g-planeta: #56628a;`
css/graficos.css:33: `.g-banda { fill: var(--g-planeta); opacity: .7; stroke: var(--g-planeta); stroke-width: 1; }`
css/g-capa.css:11: `.g-di-col:hover .g-area, .g-di-col:focus-visible .g-area { fill: #7c86a6; }`
js/graficos/base.js:30: `planeta: '#56628a',`


## [baja] El tooltip .g-tip (position: fixed) no se oculta ni se recoloca al desplazar el panel o la ficha
**Archivo:** /Users/martiquimmargot/Nasa/space-apps-challenge/js/graficos/base.js

**Por qué:** Confirmado. `tip()` (base.js:87-98) coloca la caja en coordenadas de ventana. Solo se oculta en `pointerleave` y `focusout` (base.js:107 y 112) y en `blur`, `pointerleave` no táctil y `pointercancel` del mapa (entorno.js:173-174 y 183). No hay ningún escucha de `scroll` en js/graficos ni en js/*.js. Al desplazar con la rueda o con el dedo fuera del mapa, el tooltip se queda sobre otro contenido. El arreglo propuesto es correcto. El ancla es necesaria: ocultar sin más en `scroll` borraría el tooltip cuando el propio Tab o las flechas de la matriz provocan desplazamiento.

**Arreglo:**

En base.js:
```js
let cajaTip = null, anclaTip = null;   // anclaTip: () => [x, y] si lo abrió el foco
export function tip(html, x = 0, y = 0, ancla = null) {
  …
  if (html == null) { cajaTip.hidden = true; anclaTip = null; return; }
  anclaTip = ancla;
  …resto igual…
}
addEventListener('scroll', () => {
  if (!cajaTip || cajaTip.hidden) return;
  if (!anclaTip) { tip(null); return; }
  const a = anclaTip, [x, y] = a(); tip(cajaTip.innerHTML, x, y, a);
}, { capture: true, passive: true });
```
En el `focusin` de conTip (base.js:110): `if (h) { const pos = () => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.bottom]; }; tip(h, ...pos(), pos); }`.
Pasar un ancla equivalente en `tipTeclado` (corte.js:196-199) y en la llamada a `tip` del camino de teclado de entorno.js (`alTeclado`, 177-180). Si no, sus lecturas con teclado se ocultarían al desplazarse la ficha.


## [media] Marte, «Composición del suelo»: al destacar un emplazamiento el foco (y su tooltip) saltan al primer panel
**Archivo:** js/graficos/panel.js

**Por qué:** Confirmado leyendo. especifico.js:51 (grupoFila) pinta `<g class="g-es-fila" data-sitio="<id>" tabindex="0">` y marte() lo repite en un `<svg data-es-col="<capa>">` por cada capa con sigma (especifico.js:146 y 186), de modo que cada emplazamiento tiene una fila por panel. claveFoco (panel.js:60) devuelve `g[data-sitio="x"]`, y `$(foco, nuevo)` (panel.js:53) toma la primera coincidencia, la del primer panel. Además el focusin de conTip saca el tooltip de ese primer panel. En la Luna y en los demás gráficos el selector es único (matriz: button; distribución y latitud: circle, el rect gemelo es otra etiqueta; dispersión: un g por emplazamiento), así que solo afecta a Marte. El arreglo propuesto para claveFoco es correcto: `nuevo.querySelector('[data-es-col="…"] g[data-sitio="…"]')` resuelve dentro del contenedor nuevo. El añadido de data-clave a los rect[data-med] de dispersion.js es otro asunto menor y no hace falta para este fallo; lo dejo fuera.

**Arreglo:**

js/graficos/panel.js, función claveFoco: sustituir la línea 60
```js
for (const at of ['data-clave', 'data-sitio', 'data-capa']) if (a.hasAttribute(at)) return `${a.tagName.toLowerCase()}[${at}="${CSS.escape(a.getAttribute(at))}"]`;
```
por
```js
const col = a.closest('[data-es-col]');
const pre = col && cont.contains(col) ? `[data-es-col="${CSS.escape(col.dataset.esCol)}"] ` : '';
for (const at of ['data-clave', 'data-sitio', 'data-capa']) if (a.hasAttribute(at)) return `${pre}${a.tagName.toLowerCase()}[${at}="${CSS.escape(a.getAttribute(at))}"]`;
```
No tocar dispersion.js.


## [baja] El tooltip puesto por el foco se queda clavado en la pantalla al desplazar el panel
**Archivo:** js/graficos/base.js

**Por qué:** Confirmado leyendo. `.g-tip` es `position: fixed` (css/graficos.css:59) y se coloca una sola vez con transform (base.js:97). No hay ningún escucha de scroll en js/graficos (grep). El tooltip de focusin (base.js:108-111) solo se quita con focusout o pointerleave, así que al desplazar #analisis, o la caja de la matriz en horizontal, con el foco en una marca se queda flotando sobre otro contenido. Es estético y no da datos erróneos: lo bajo a gravedad baja. El arreglo propuesto tiene un efecto secundario: oculta en cualquier scroll los tooltips sin ancla. Los que entorno.js y corte.js ponen con tip() directo al recibir el foco desaparecerían nada más mostrarse cuando Tab trae el gráfico a la vista, porque el scroll que provoca el foco llega después del evento focus. Corregido: sin ancla no se hace nada (comportamiento actual).

**Arreglo:**

js/graficos/base.js:
1) junto a `let cajaTip = null;` añadir `let ancla = null;   // { el, h } del tooltip puesto por el foco`
2) en tip(), cambiar `if (html == null) { cajaTip.hidden = true; return; }` por `if (html == null) { ancla = null; cajaTip.hidden = true; return; }`
3) en conTip, alPuntero: `const alPuntero = (e) => { const el = de(e), h = el && contenido(el, e); ancla = null; if (h) tip(h, e.clientX, e.clientY); else tip(null); };`
4) en conTip, focusin: `if (h) { const r = el.getBoundingClientRect(); tip(h, r.left + r.width / 2, r.bottom); ancla = { el, h }; }`
5) al final del bloque del tooltip, una sola vez a nivel de módulo:
```js
addEventListener('scroll', () => {
  const a = ancla;
  if (!a || !cajaTip || cajaTip.hidden) return;          // los tooltips sin ancla (puntero, entorno, corte) se dejan como están
  if (!a.el.isConnected) { tip(null); return; }
  const r = a.el.getBoundingClientRect(); tip(a.h, r.left + r.width / 2, r.bottom);
}, { capture: true, passive: true });
```


## [media] Matriz: cada repintado devuelve el desplazamiento horizontal a 0 y la columna elegida queda fuera de la vista
**Archivo:** js/graficos/panel.js

**Por qué:** Confirmado leyendo. `.g-mz-caja` es el contenedor con `overflow-x: auto` (css/g-matriz.css:32) y se vuelve a crear con `el.innerHTML = figura(...)` en cada pintado (matriz.js:111-126) sobre un contenedor nuevo (panel.js:49-50). Nada guarda ni repone scrollLeft, y el foco vuelve con `preventScroll: true`. Las celdas tienen `min-width: 58px` (g-matriz.css:66) más la columna fija, así que con 8-10 columnas la tabla no cabe en los ~320 px útiles del panel en móvil y se desplaza. Pulsar una cabecera de capa, un nombre de fila o el orden estando desplazado devuelve la tabla al principio. El arreglo propuesto es correcto y no interfiere con nada.

**Arreglo:**

js/graficos/panel.js, pintarGrafico():
```js
const foco = claveFoco(viejo), nuevo = viejo.cloneNode(false);
const sl = $('.g-mz-caja', viejo)?.scrollLeft ?? 0;        // nueva
viejo.replaceWith(nuevo);
try { ... } catch (e) { ... }                               // igual que ahora
if (sl) { const c = $('.g-mz-caja', nuevo); if (c) c.scrollLeft = sl; }   // nueva, antes de devolver el foco
if (foco) $(foco, nuevo)?.focus({ preventScroll: true });
```


## [media] Repintar la dispersión fuerza un cálculo de página con su contenedor vacío: el panel salta hacia arriba si se está cerca del final
**Archivo:** js/graficos/panel.js

**Por qué:** Confirmado por lectura, no ejecutado en navegador. panel.js:49-51 deja el contenedor nuevo vacío en el documento y luego llama a pintar(). dispersion.js:176 lee `anchoDe(el)` → `el.clientWidth` (dispersion.js:41) antes de `el.innerHTML` (línea 211). Es la única lectura de geometría de todo js/graficos previa al pintado (grep de clientWidth/offsetWidth/getBoundingClientRect). Esa lectura obliga a calcular la página con la dispersión a altura 0; #analisis es el contenedor desplazable (`.about { overflow-y: auto }`, style.css:343) y, si scrollTop supera el nuevo máximo, el navegador lo recorta y no lo repone al volver a llenarse. Ningún CSS reserva altura a `[data-g]`. Se da cuando se está a menos de la altura de la dispersión del final, es decir, mirando el último gráfico (especifico, que todavía no se ha repintado y conserva su altura). Pulsar ahí una fila de «Temperatura de día y de noche» o de «Composición del suelo» es el uso normal. El arreglo propuesto es correcto: min-height no cambia el ancho, así que no dispara el ResizeObserver.

**Arreglo:**

js/graficos/panel.js, pintarGrafico():
```js
const foco = claveFoco(viejo), nuevo = viejo.cloneNode(false);
nuevo.style.minHeight = `${viejo.offsetHeight}px`;        // nueva: reserva la altura mientras se repinta
viejo.replaceWith(nuevo);
try { GRAFICOS[nombre].pintar(nuevo, contexto(nombre)); }
catch (e) { ... }                                           // igual que ahora
nuevo.style.minHeight = '';                                // nueva
```
Conviene comprobarlo en un navegador (sobre todo Safari/iOS) desplazando el panel hasta el final.


## [baja] Perfil del terreno en táctil: la lectura solo existe mientras el dedo está apoyado y sale debajo de él
**Archivo:** js/graficos/corte.js

**Por qué:** Confirmado leyendo; el comportamiento táctil se deduce de la especificación de Pointer Events, no se ha probado en un dispositivo. corte.js:210 hace `hit.addEventListener('pointerleave', ocultar)` y conTip (base.js:107) hace `tip(null)` en pointerleave. Con un dedo, pointerleave llega justo después de pointerup. El foco posterior no repone nada: el callback de conTip devuelve null en focusin (corte.js:205) y el escucha de focus exige `:focus-visible` (línea 211), que no se cumple tras un toque en un rect. entorno.js:173 sí lo contempla (`if (e.pointerType !== 'touch')`), así que es una incoherencia real entre los dos gráficos de la ficha. El arreglo propuesto es malo en su parte de base.js: cambiar el pointerleave de conTip afecta a todos los gráficos y deja tooltips clavados en marcas no enfocables, por ejemplo los `rect.g-hit[data-sitio]` con aria-hidden de distribucion.js:101 y latitud.js:99 cuando el emplazamiento ya está destacado, porque elegir() sale sin tip(null). Lo limito a corte.js.

**Arreglo:**

Solo js/graficos/corte.js; no tocar base.js. Sustituir la línea 210 `hit.addEventListener('pointerleave', ocultar);` por:
```js
// Con el dedo, la lectura se queda al levantarlo (como en el mapa del entorno); se va al tocar fuera (blur / focusout)
hit.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') ocultar(); });
hit.addEventListener('pointercancel', ocultar);              // el gesto pasó a ser desplazamiento vertical
el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'touch' && visible) tipTeclado(actual); });
```
El tercer escucha va sobre `el` y se registra después de conTip(el, …) (línea 204), así que se ejecuta tras su `tip(null)` y vuelve a poner el tooltip bajo el recuadro, no bajo el dedo. Tras pointercancel `visible` ya es false y no se repone. Probar en un móvil real antes de darlo por bueno.


## [baja] «Ver en tabla» se cierra solo cada vez que se destaca un emplazamiento o se cambia de capa
**Archivo:** js/graficos/panel.js

**Por qué:** Confirmado leyendo. tabla() (base.js:124) abre el `<details>` solo con `abierta: true`, y las llamadas del panel no lo pasan (dispersion.js:203, especifico.js:115 y 214; distribución y latitud igual). Cada pintado estrena contenedor (panel.js:49) y elegir() repinta los cinco gráficos, así que la tabla vuelve plegada. entorno.js sí lo conserva (estado.tabla más el escucha de toggle, línea 203). Hay como mucho un `details.g-tabla` por gráfico; la matriz no tiene. El arreglo propuesto es correcto.

**Arreglo:**

js/graficos/panel.js, pintarGrafico():
```js
const abierta = !!$('details.g-tabla', viejo)?.open;        // nueva, antes de replaceWith
// ... replaceWith + pintar, igual que ahora ...
if (abierta) { const d = $('details.g-tabla', nuevo); if (d) d.open = true; }   // nueva, antes de devolver el foco
```


## [baja] abrirComparativa: abrir() no se espera y los argumentos se leen después del await del import
**Archivo:** js/main.js

**Por qué:** Confirmado leyendo main.js:214-217. `mission.body` y `sites` se evalúan después de `await panelGraficos()`. resetMission() (main.js:585-591) pone `mission.body = null` y oculta #analisis, pero no vacía `sites`, así que la guarda `if (!sites.length)` no protege. Si la misión se reinicia durante el primer import, abrir({ body: null }) ejecuta `el.hidden = false` (panel.js:132) antes de que `CUERPO[null].de` lance en la línea 134. Como abrir() es async y no se espera, el rechazo no llega al catch ni al toast, y #analisis queda visible sobre el asistente. La ventana es estrecha: solo la primera pulsación, mientras cargan panel.js y sus módulos. El arreglo propuesto es correcto: runId solo cambia al lanzar o reiniciar (main.js:120 y 586), el mismo patrón que pintarMiniaturas (main.js:196-199), y abrir() ya captura sus propios fallos de carga, así que esperarla no añade toasts indebidos.

**Arreglo:**

js/main.js, sustituir las líneas 214-218 por:
```js
async function abrirComparativa(sel = null, origen = document.activeElement) {
  const body = mission.body, lista = sites, id = runId;
  if (!body || !lista.length) return;
  try {
    const p = await panelGraficos();
    if (id !== runId || mission.body !== body) return;
    await p.abrir({ body, sitios: lista, sel, alVerFicha: selectSite, origen });
  } catch (e) { console.error('Panel de comparación', e); toast('No se pudo abrir la comparación con datos'); }
}
```


## [baja] «Ver la ficha de X →» deja el foco en un botón que se oculta o se destruye a continuación
**Archivo:** js/main.js

**Por qué:** Confirmado leyendo. panel.js:159 llama a cerrar(), que enfoca `st.origen` o `#btn-comparar` (panel.js:122), y luego a alVerFicha = selectSite. selectSite (main.js:234-244) hace de forma síncrona `renderDetail(s); $('#results').hidden = true; $('#detail').hidden = false;`. #btn-comparar está dentro de #results (index.html:142) y queda oculto; `#btn-comparar-ficha` se destruye al reescribir `#detail-body.innerHTML` (main.js:271). En ambos casos el foco cae en body. El arreglo propuesto es válido: #detail ya es visible antes del primer await de selectSite y #detail-close es estático (index.html:152).

**Arreglo:**

js/main.js, en abrirComparativa, cambiar `alVerFicha: selectSite` por:
```js
alVerFicha: (id) => { selectSite(id); $('#detail-close')?.focus(); },
```
No hace falta tocar panel.js.
