// ============================================================================
//  BASE DE LOS GRÁFICOS DE RESULTADOS  (js/graficos/*.js)
//
//  Piezas comunes: formato de números, escalas y marcas de eje, color, tooltip compartido (cursor y foco de teclado),
//  alternativa en tabla y el envoltorio <figure>. Los gráficos son SVG o lienzo hechos a mano, sin librerías.
//
//  Normas que cumplen todos (css/graficos.css trae las clases):
//  - Una serie importa y el resto es contexto: los emplazamientos van en gris y el elegido en el color de énfasis.
//    Cada marca de un emplazamiento lleva data-sitio="<id>"; la clase .sel la pone el panel que contiene el gráfico.
//  - El color nunca es el único canal: hay etiqueta, posición o tabla. Cada gráfico tiene su tabla («Ver en tabla»).
//  - El texto usa los colores de texto, nunca el de la serie. Rejilla y ejes: líneas finas, continuas y tenues.
//  - Lo que se ve al pasar el cursor se ve igual con el foco del teclado (conTip).
//  - Los nombres y valores que se insertan en HTML pasan por esc().
// ============================================================================
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const nf = (v, dec = 0) => (v === v && v != null ? v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '—');
export const coord = (lat, lon) => `${nf(Math.abs(lat), 1)}°${lat >= 0 ? 'N' : 'S'} ${nf(Math.abs(lon), 1)}°${lon >= 0 ? 'E' : 'W'}`;
// Percentil como entero 0-100 («percentil 93» = el 93 % de la superficie tiene un valor menor o igual)
export const pct = (p) => (p === p ? Math.round(p * 100) : null);
// El mismo percentil para escribirlo: «<1» y «>99» en los extremos (0 y 100 darían a entender que no hay nada más allá)
export const pctTxt = (p) => (p !== p ? '—' : p < 0.005 ? '<1' : p > 0.995 ? '>99' : String(Math.round(p * 100)));
// El percentil dicho en llano para lo visible: «higher than 93 %» (la definición exacta va en «Learn more»)
// Igual que pctTxt pero para ir dentro de una frase («higher than over 99 %» en vez de «higher than >99 %»)
export const pctFrase = (p) => (p !== p ? '—' : p < 0.005 ? 'under 1' : p > 0.995 ? 'over 99' : String(Math.round(p * 100)));
export const masAltoQue = (p) => (p == null || p !== p ? '' : `higher than ${pctFrase(p)} %`);

// ---------------------------------------------------------------------------
//  Color
// ---------------------------------------------------------------------------
// Para lienzos (el SVG usa las clases de css/graficos.css, que leen las mismas variables)
export const COLOR = {
  enfasis: '#5dffd0',               // el emplazamiento elegido (el acento de la web)
  contexto: '#7c86a6',              // los demás emplazamientos
  planeta: '#56628a',               // la distribución de toda la superficie (fondo del gráfico; ≥ 3:1 sobre el fondo)
  serie1: '#3987e5', serie2: '#d95926',
  tinta: '#e8ecf8', tinta2: '#c6cde4', mudo: '#8e98b8', fondo: '#0a0e1c',
};

// Secuencial de un solo tono (azul). En tema oscuro lo poco queda cerca del fondo y lo mucho, claro.
export const SEQ = ['#0d366b', '#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'];
const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));

// Rampa continua a partir de paradas hexadecimales: t (0…1) → [r, g, b]
export function rampa(paradas) {
  const rgb = paradas.map(hex), n = rgb.length - 1;
  return (t) => {
    const x = Math.min(1, Math.max(0, t === t ? t : 0)) * n, a = Math.min(n - 1, Math.floor(x)), f = x - a;
    return [0, 1, 2].map((k) => Math.round(rgb[a][k] + (rgb[a + 1][k] - rgb[a][k]) * f));
  };
}
const seq = rampa(SEQ);
export const colorSeq = (t) => `rgb(${seq(t).join(', ')})`;
// Texto legible dentro de una celda pintada con colorSeq(t): negro sobre los pasos claros, blanco sobre los oscuros.
// Umbral 0,179 (luminancia en la que el contraste con negro y con blanco se iguala): así ningún paso de SEQ baja de 4,5:1.
export function tintaSobreSeq(t) {
  const [r, g, b] = seq(t).map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? '#000000' : '#ffffff';
}

// ---------------------------------------------------------------------------
//  Escalas y ejes
// ---------------------------------------------------------------------------
// Escala lineal dominio → píxeles. f(v) → px; f.inv(px) → v; f.d = [d0, d1]; f.r = [r0, r1]
export function lineal(d0, d1, r0, r1) {
  if (d1 === d0) d1 = d0 + 1;
  const f = (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
  f.inv = (px) => d0 + ((px - r0) / (r1 - r0)) * (d1 - d0);
  f.d = [d0, d1]; f.r = [r0, r1];
  return f;
}

// Marcas «redondas» (1, 2, 2,5 o 5 × 10ⁿ) dentro de [min, max]
export function marcas(min, max, n = 4) {
  if (!(max > min)) return [min];
  const crudo = (max - min) / n, mag = 10 ** Math.floor(Math.log10(crudo));
  const paso = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((x) => x >= crudo);
  const out = [];
  for (let v = Math.ceil(min / paso - 1e-9) * paso; v <= max + paso * 1e-9; v += paso) out.push(Number(v.toPrecision(12)));
  return out;
}
// Decimales necesarios para escribir esas marcas tal cual (0,5 → 1; 0,25 → 2; 100 → 0)
export function decimalesDe(ms) {
  for (let d = 0; d < 6; d++) if (ms.every((v) => Math.abs(v - Number(v.toFixed(d))) < 1e-9 * Math.max(1, Math.abs(v)))) return d;
  return 6;
}

// ---------------------------------------------------------------------------
//  Tooltip compartido
// ---------------------------------------------------------------------------
let cajaTip = null;
let ancla = null;   // { el, h } del tooltip puesto por el foco (conTip): al desplazar la página, se recoloca bajo su elemento
// tip(html, x, y): lo muestra junto al punto (x, y) de la ventana sin salirse de ella; tip(null) lo oculta
export function tip(html, x = 0, y = 0) {
  if (!cajaTip) {
    cajaTip = document.createElement('div');
    cajaTip.className = 'g-tip'; cajaTip.setAttribute('role', 'tooltip'); cajaTip.hidden = true;
    document.body.appendChild(cajaTip);
  }
  if (html == null) { ancla = null; cajaTip.hidden = true; return; }
  cajaTip.innerHTML = html; cajaTip.hidden = false;
  const w = cajaTip.offsetWidth, h = cajaTip.offsetHeight;
  const px = Math.max(8, Math.min(x + 14, innerWidth - w - 8)), py = y + 16 + h > innerHeight - 8 ? Math.max(8, y - h - 12) : y + 16;
  cajaTip.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px)`;
}

// Conecta el tooltip a las marcas de un gráfico por delegación: `contenido(el, evento)` devuelve el HTML del tooltip del
// elemento que cumple `selector` (o null). Vale igual para el cursor, el dedo y el foco del teclado.
export function conTip(raiz, selector, contenido) {
  const de = (e) => { const el = e.target.closest?.(selector); return el && raiz.contains(el) ? el : null; };
  const alPuntero = (e) => { const el = de(e), h = el && contenido(el, e); ancla = null; if (h) tip(h, e.clientX, e.clientY); else tip(null); };
  raiz.addEventListener('pointermove', alPuntero);
  raiz.addEventListener('pointerdown', alPuntero);
  raiz.addEventListener('pointerleave', () => tip(null));
  raiz.addEventListener('focusin', (e) => {
    const el = de(e), h = el && contenido(el, e);
    if (h) { const r = el.getBoundingClientRect(); tip(h, r.left + r.width / 2, r.bottom); ancla = { el, h }; }
  });
  raiz.addEventListener('focusout', () => tip(null));
}

// El tooltip es position: fixed. Si lo puso el foco y la página (o el panel) se desplaza, se recoloca bajo su elemento.
// Los tooltips sin ancla (puntero, mapa del entorno, perfil del terreno) se dejan como están: ocultarlos aquí los
// borraría nada más aparecer cuando el propio foco trae el gráfico a la vista (ese desplazamiento llega después del foco).
if (typeof addEventListener === 'function') addEventListener('scroll', () => {
  const a = ancla;
  if (!a || !cajaTip || cajaTip.hidden) return;
  if (!a.el.isConnected) { tip(null); return; }
  const r = a.el.getBoundingClientRect(); tip(a.h, r.left + r.width / 2, r.bottom); ancla = a;
}, { capture: true, passive: true });

// Una sola parada del tabulador para un grupo de marcas (p. ej. los emplazamientos de un gráfico): entra la destacada
// (.sel) o la primera, y las flechas recorren las demás en el orden del documento. Si el foco llega por otra vía
// (clic, o el panel que lo devuelve tras repintar), esa marca pasa a ser la parada.
export function unaParada(raiz, selector) {
  const els = () => [...raiz.querySelectorAll(selector)];
  const fijar = (el) => { if (el) els().forEach((x) => x.setAttribute('tabindex', x === el ? '0' : '-1')); };
  fijar(raiz.querySelector(`${selector}.sel`) ?? els()[0]);
  raiz.addEventListener('focusin', (e) => { const a = e.target.closest?.(selector); if (a && raiz.contains(a)) fijar(a); });
  raiz.addEventListener('keydown', (e) => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key], a = e.target.closest?.(selector);
    if (!d || !a || !raiz.contains(a) || e.ctrlKey || e.metaKey || e.altKey) return;
    const xs = els(), o = xs[xs.indexOf(a) + d];
    if (o) { e.preventDefault(); o.focus(); }
  });
}

// Filas del tooltip: valor destacado y etiqueta secundaria. filas = [[etiqueta, valor], …]
export const tipHtml = (titulo, filas = [], nota = '') => `<b class="g-tip-tit">${esc(titulo)}</b>${filas.map(([k, v]) =>
  `<span class="g-tip-fila"><span>${esc(k)}</span><b>${esc(v)}</b></span>`).join('')}${nota ? `<small>${esc(nota)}</small>` : ''}`;

// ---------------------------------------------------------------------------
//  Tabla alternativa y envoltorio
// ---------------------------------------------------------------------------
// Alternativa en tabla de un gráfico. cabeceras = ['Emplazamiento', …]; filas = [[celda, …], …] (texto ya formateado).
// La primera columna es la cabecera de la fila. Usa los estilos .tabla y .tabla-scroll de css/proposito.css.
export function tabla({ titulo, cabeceras, filas, abierta = false }) {
  return `<details class="g-tabla"${abierta ? ' open' : ''}><summary>Show as table</summary>
    <div class="tabla-scroll" tabindex="0" role="region" aria-label="Table: ${esc(titulo)}"><table class="tabla">
      <caption>${esc(titulo)}</caption>
      <thead><tr>${cabeceras.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${filas.map((f) => `<tr>${f.map((c, i) => (i ? `<td class="num">${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`)).join('')}</tr>`).join('')}</tbody>
    </table></div></details>`;
}

// Envoltorio de un gráfico: título (qué se ve), subtítulo (una frase llana: cómo leerlo), cuerpo y, plegado tras
// «Learn more», el pie (de dónde sale cada número), notas largas (`mas`) y la tabla. Nada se pierde: solo se pliega.
// `cuerpo`, `pie`, `mas` y `tablaHtml` son HTML ya escapado; `titulo` y `sub` son texto.
export function figura({ titulo, sub = '', cuerpo, pie = '', mas = '', tablaHtml = '', clase = '' }) {
  const extra = `${mas}${pie ? `<p class="g-pie">${pie}</p>` : ''}${tablaHtml}`;
  return `<figure class="g-fig ${clase}"><figcaption><b class="g-tit">${esc(titulo)}</b>${sub ? `<span class="g-sub">${esc(sub)}</span>` : ''}</figcaption>
    ${cuerpo}${masInfo(extra, '', clase.trim() || titulo)}</figure>`;
}

// Bloque plegable «Learn more» / «Show less» con HTML ya escapado dentro. Vacío → nada.
// El texto del botón cambia por CSS (details[open]), así que no necesita JS y funciona con teclado (Intro / espacio).
// `clave` (opcional): recuerda si el lector lo dejó abierto, para que siga abierto cuando el gráfico se repinta
// (p. ej. al destacar otro emplazamiento). También se abre si dentro hay una tabla que debe ir abierta.
const masAbiertos = new Set();
if (typeof document !== 'undefined') document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (d?.classList?.contains('g-mas') && d.dataset.masClave) (d.open ? masAbiertos.add(d.dataset.masClave) : masAbiertos.delete(d.dataset.masClave));
}, true);
export const masInfo = (html, clase = '', clave = '') => {
  if (!html || !html.trim()) return '';
  const abierto = (clave && masAbiertos.has(clave)) || /class="g-tabla"\s+open/.test(html);
  return `<details class="g-mas ${clase}"${clave ? ` data-mas-clave="${esc(clave)}"` : ''}${abierto ? ' open' : ''}><summary><span class="g-mas-ver">Learn more</span><span class="g-mas-menos">Show less</span></summary><div class="g-mas-cuerpo">${html}</div></details>`;
};

// Leyenda: entradas = [{ clase, texto }] donde `clase` es la clase de la muestra (g-m-sel, g-m-ctx, g-m-planeta…)
export const leyenda = (entradas) => `<div class="g-ley">${entradas.map((e) => `<span><i class="${esc(e.clase)}" aria-hidden="true"></i>${esc(e.texto)}</span>`).join('')}</div>`;

// Nombre corto de un emplazamiento para etiquetas con poco sitio: «Shackleton», «Marius Hills»
export const nombreCorto = (nombre) => nombre.replace(/\s+(crater rim|crater|massif|ridge|pit|skylight|plateau|basin|plain|lava tubes)$/i, '');

// «Maximum», «Minimum» y «Mean» solo se entienden junto a su grupo: fuera del selector de capas y de las cabeceras de
// la matriz se escriben completas («Mean temperature»)
export const nombreDe = (def) => (def.grupo?.startsWith('Temperature') ? `${def.corto} temperature` : def.corto);

// Nombre del cuerpo con su artículo y sus preposiciones
export const CUERPO = { moon: { nombre: 'the Moon', en: 'on the Moon', de: 'of the Moon' }, mars: { nombre: 'Mars', en: 'on Mars', de: 'of Mars' } };

// Fuente de una capa en una línea: «LRO · LOLA, 0,125° (≈3,8 km en el ecuador)»
export const fuenteDe = (c) => `${c.meta.fuente?.mision ?? ''}${c.meta.resolucion ? `, ${c.meta.resolucion}` : ''}`;

// Ficha técnica de una capa para los «Learn more»: SOLO campos que ya trae capas.json (meta), sin calcular ni redactar
// datos nuevos. Las estadísticas son las del archivo publicado (cuentan celdas, no área). La media no se muestra porque
// los metadatos no dicen si está ponderada por área. Los productos se nombran por el archivo de su URL (los textos de
// «productos» están en español). Un campo que falta no se pinta.
const numMeta = (v) => (typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 3 }) : '');
export function fichaCapa(meta, titulo = '') {
  if (!meta) return '';
  const f = meta.fuente ?? {}, e = meta.estadisticas, u = meta.unidades ? ` ${meta.unidades}` : '';
  const archivos = [...new Set(f.urls ?? [])].map((url) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url.split('/').pop())}</a>`);
  const filas = [
    ['Instrument', f.mision && esc(f.mision)],
    ['Dataset', f.dataset && esc(f.dataset)],
    ['Grid', meta.resolucion && `${esc(meta.resolucion)}${meta.filas && meta.columnas ? ` · ${numMeta(meta.filas)} × ${numMeta(meta.columnas)} cells` : ''}`],
    ['Cells with data', e?.total ? `${numMeta(e.validos)} of ${numMeta(e.total)} (${nf((e.validos / e.total) * 100, 1)} %)` : ''],
    ['Range in the grid', e && typeof e.min === 'number' ? `${numMeta(e.min)} … ${numMeta(e.max)}${esc(u)}` : ''],
    ['Processing', meta.procesado && esc(meta.procesado)],
    ['Note', meta.nota && esc(meta.nota)],
    ['Original files', archivos.join(' · ')],
    ['Citation', f.cita && esc(f.cita)],
    ['Prepared', meta.generado && esc(String(meta.generado).slice(0, 10))],
  ].filter(([, v]) => v);
  return filas.length ? `<div class="g-ficha">${titulo ? `<b class="g-ficha-tit">${esc(titulo)}</b>` : ''}<dl>${filas.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></div>` : '';
}
