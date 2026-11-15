// ============================================================================
//  CAPA EN DETALLE · DISTRIBUCIÓN  («{capa}: cómo se reparte en la superficie de la Luna / de Marte»)
//
//  Qué muestra: un histograma de toda la superficie del cuerpo para la capa elegida y, en una franja encima, un punto
//  por emplazamiento en el valor que tiene esa capa allí. Sirve para ver si un emplazamiento es corriente o raro
//  para ese cuerpo (bajo / alto), no si es «bueno» o «malo».
//
//  De dónde sale cada número:
//    · Barras     → js/analitica.js histograma(capa): fracción del área en cada intervalo (cada celda pesa el coseno de
//                   su latitud). El eje va del percentil 0,5 al 99,5; las colas (h.colaBaja, h.colaAlta) se acumulan en
//                   la primera y la última barra.
//    · Puntos     → ctx.filas[].v[capa].media: media de las celdas con centro a menos de 0,5° de arco del emplazamiento
//                   (Capa.zona); .pct es su percentil en la superficie; .min/.max, el rango entre esas celdas.
//    · Nada más: aquí no hay umbrales, ni puntuación, ni valores escritos a mano. La posición vertical de los puntos
//      no significa nada (solo se apilan para no taparse).
// ============================================================================
import { histograma, muestra } from '../analitica.js';
import { RADIO_ZONA } from '../capas.js';
import { esc, nf, pct, pctTxt, masAltoQue, lineal, marcas, decimalesDe, conTip, tipHtml, tabla, figura, leyenda, nombreCorto, fuenteDe } from './base.js';

const W = 460, M = { l: 40, r: 12, b: 36 };              // viewBox: ancho fijo; el alto depende de las filas de puntos
const ALTO = 132;                                         // alto del histograma
const ETIQUETA = 16;                                      // renglón de arriba para la etiqueta del destacado
const R = 5, FILA = 12, HUECO = 11, FILAS_MAX = 4;        // puntos: radio, alto de fila, separación mínima y filas
const ANCHO_LETRA = 5.7;                                  // ancho medio de un carácter de 10 px en negrita (para anclar la etiqueta)
const f1 = (v) => Math.round(v * 10) / 10;

// Rótulo de las marcas del eje: el formato de la capa (def.tick) salvo que las marcas necesiten más decimales de los
// que da (0,25 con un decimal saldría «0,3»): entonces, los decimales justos.
function rotulador(def, ms) {
  const propios = (def.tick(1).split('.')[1] ?? '').length, d = decimalesDe(ms);
  return d > propios ? (v) => nf(v, d) : def.tick;
}

export function pintar(el, ctx) {
  const k = ctx.cols.find((x) => x.def.id === ctx.capa);
  if (!k) { el.innerHTML = '<p class="g-vacio">Choose a layer to see how it is distributed over the surface.</p>'; return; }
  const { def, capa: c } = k, cuerpo = ctx.cuerpo, h = histograma(c);
  const titulo = `${def.corto}: common or rare ${cuerpo.en}?`;
  if (h.lo !== h.lo || h.hi !== h.hi) {
    el.innerHTML = figura({ titulo, cuerpo: '<p class="g-vacio">This layer has no cell with data.</p>' });
    return;
  }
  const un = def.unidad === '°' ? '°' : ` ${def.unidad}`;
  const breve = (v) => def.breve(v).trim();               // las unidades largas se omiten en «breve» y dejan un espacio al final
  const x = lineal(h.lo, h.hi, M.l, W - M.r);
  const intervaloDe = (v) => Math.min(h.n - 1, Math.max(0, Math.floor((v - h.lo) / h.ancho)));   // igual que histograma()

  // ---- emplazamientos: x = su media; los que caen fuera del eje se pegan al borde (y se dice en el tooltip)
  const sin = ctx.filas.filter((f) => !f.v[def.id]);
  const pts = ctx.filas.filter((f) => f.v[def.id]).map((f) => {
    const v = f.v[def.id];
    return { f, v, fuera: v.media < h.lo ? -1 : v.media > h.hi ? 1 : 0, x: x(Math.min(h.hi, Math.max(h.lo, v.media))), sel: f.sitio.id === ctx.sel, fila: 0 };
  });
  // Apilado: cada punto va a la fila más baja en la que no toca a otro. El destacado elige primero (fila de abajo),
  // así su línea guía no cruza otros puntos. Si las cuatro filas están ocupadas, a la que menos tape.
  const ocupadas = Array.from({ length: FILAS_MAX }, () => []);
  [...pts].sort((a, b) => b.sel - a.sel || a.x - b.x).forEach((p) => {
    let fila = ocupadas.findIndex((xs) => xs.every((q) => Math.abs(q - p.x) >= HUECO));
    if (fila < 0) {
      let mejor = -1;
      ocupadas.forEach((xs, i) => { const d = Math.min(...xs.map((q) => Math.abs(q - p.x))); if (d > mejor) { mejor = d; fila = i; } });
    }
    p.fila = fila; ocupadas[fila].push(p.x);
  });
  const nFilas = Math.max(1, ...pts.map((p) => p.fila + 1));

  // ---- geometría vertical: etiqueta · franja de puntos · histograma · eje
  const y0 = ETIQUETA + nFilas * FILA + 6, y1 = y0 + ALTO, H = y1 + M.b;
  const cy = (p) => y0 - 6 - R - p.fila * FILA;
  const yMax = h.max * 100 || 1, y = lineal(0, yMax, y1, y0);
  const my = marcas(0, yMax, 3), dy = decimalesDe(my);
  let mx = marcas(h.lo, h.hi, 5);
  for (let n = 6; mx.length < 3 && n <= 9; n++) mx = marcas(h.lo, h.hi, n);   // con menos de tres marcas el eje no se lee
  const rot = rotulador(def, mx);

  // ---- columnas del histograma
  const bw = (W - M.l - M.r) / h.n;
  const dBorde = Math.max((def.tick(1).split('.')[1] ?? '').length, Math.min(6, Math.max(0, 1 - Math.floor(Math.log10(h.ancho)))));
  const tramo = (b) => `From ${nf(h.lo + b * h.ancho, dBorde)} to ${nf(h.lo + (b + 1) * h.ancho, dBorde)}${un}`;
  const parte = (a) => `${nf(a * 100, a * 100 < 1 ? 2 : 1)} %`;
  const columnas = Array.from(h.area, (a, b) => {
    const alto = a > 0 ? Math.max(1, y1 - y(a * 100)) : 0;
    return `<g class="g-di-col" data-b="${b}" data-clave="b${b}" tabindex="${b ? -1 : 0}" role="img" aria-label="${esc(`${tramo(b)}: ${parte(a)} of the surface`)}">
      ${alto ? `<rect class="g-area" x="${f1(M.l + b * bw + 1)}" y="${f1(y1 - alto)}" width="${f1(bw - 2)}" height="${f1(alto)}"/>` : ''}
      <rect class="g-hit" x="${f1(M.l + b * bw)}" y="${y0}" width="${f1(bw)}" height="${ALTO}"/></g>`;
  }).join('');
  const tipColumna = (b) => {
    const dentro = pts.filter((p) => intervaloDe(p.v.media) === b).map((p) => nombreCorto(p.f.sitio.name));
    const nota = [
      b === 0 && h.colaBaja > 0 ? `Includes the ${nf(h.colaBaja * 100, 1)} % of the surface with values below the axis.` : '',
      b === h.n - 1 && h.colaAlta > 0 ? `Includes the ${nf(h.colaAlta * 100, 1)} % of the surface with values above the axis.` : '',
      dentro.length ? `Sites in this interval: ${dentro.join(', ')}.` : '',
    ].filter(Boolean).join(' ');
    return tipHtml(tramo(b), [['Share of the surface', parte(h.area[b])]], nota);
  };

  // ---- puntos de los emplazamientos (el destacado, el último: queda encima)
  const orden = [...pts.filter((p) => !p.sel), ...pts.filter((p) => p.sel)];
  const percentilDe = (v) => masAltoQue(v.pct);
  const zonas = orden.map((p) => `<rect class="g-hit" data-sitio="${esc(p.f.sitio.id)}" aria-hidden="true" x="${f1(p.x - 8)}" y="${cy(p) - 8}" width="16" height="16" rx="8"/>`).join('');
  const puntos = orden.map((p) => `<circle class="g-m${p.sel ? ' sel' : ''}" data-sitio="${esc(p.f.sitio.id)}" tabindex="0" role="button"
      aria-label="${esc(`${p.f.sitio.name}: ${def.fmt(p.v.media)}${percentilDe(p.v) ? `, ${percentilDe(p.v)} of the surface ${cuerpo.de}` : ''}`)}"
      cx="${f1(p.x)}" cy="${cy(p)}" r="${R}"/>`).join('');
  const tipSitio = new Map(pts.map((p) => {
    const v = p.v, P = pct(v.pct), filas = [[def.corto, def.fmt(v.media)]];
    if (P != null) filas.push(['Higher than', `${pctTxt(v.pct)} % of the surface`]);
    if (v.n > 1) filas.push(['Across its cells', `${breve(v.min)} … ${breve(v.max)}`]);
    if (v.sigma != null) filas.push(['Published uncertainty', `± ${breve(v.sigma)}`]);
    const nota = [
      p.fuera < 0 ? 'Among the lowest 0.5 % of the surface: the point is drawn at the edge.' : '',
      p.fuera > 0 ? 'Among the highest 0.5 % of the surface: the point is drawn at the edge.' : '',
      v.unica ? `No cell has its center within ${nf(RADIO_ZONA, 1)}°: this is the cell that contains the point.` : '',
    ].filter(Boolean).join(' ');
    return [p.f.sitio.id, tipHtml(p.f.sitio.name, filas, nota)];
  }));

  // ---- el destacado: línea guía hasta la base y etiqueta directa, centrada en el punto sin salirse del gráfico
  const s = pts.find((p) => p.sel);
  let guia = '', etiqueta = '';                                // la guía va bajo los puntos; la etiqueta, encima de todo
  if (s) {
    const texto = [nombreCorto(s.f.sitio.name), breve(s.v.media), percentilDe(s.v)].filter(Boolean).join(' · ');
    const medio = (texto.length * ANCHO_LETRA) / 2, tx = Math.max(medio + 2, Math.min(W - 2 - medio, s.x));
    guia = `<line class="g-di-guia" x1="${f1(s.x)}" x2="${f1(s.x)}" y1="${ETIQUETA}" y2="${y1}"/>`;
    etiqueta = `<text class="g-val g-di-et" x="${f1(tx)}" y="11" text-anchor="middle">${esc(texto)}</text>`;
  }

  const yM = (y0 + y1) / 2;
  const svg = `<svg class="g-svg g-di-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(titulo)}">
    ${my.map((v) => `<line class="g-rej" x1="${M.l}" x2="${W - M.r}" y1="${f1(y(v))}" y2="${f1(y(v))}"/>
      <text x="${M.l - 6}" y="${f1(y(v) + 3.5)}" text-anchor="end">${esc(nf(v, dy))}</text>`).join('')}
    <g class="g-di-cols" role="group" aria-label="Surface histogram: left and right arrows move through the intervals">${columnas}</g>
    <line class="g-eje" x1="${M.l}" x2="${W - M.r}" y1="${y1}" y2="${y1}"/>
    ${mx.map((v) => `<line class="g-eje" x1="${f1(x(v))}" x2="${f1(x(v))}" y1="${y1}" y2="${y1 + 4}"/>
      <text x="${f1(x(v))}" y="${y1 + 15}" text-anchor="middle">${esc(rot(v))}</text>`).join('')}
    <text class="g-txt" x="${(M.l + W - M.r) / 2}" y="${H - 5}" text-anchor="middle">${esc(`${def.corto} (${def.unidad})`)}</text>
    <text class="g-txt" x="11" y="${yM}" text-anchor="middle" transform="rotate(-90 11 ${yM})">% of the surface</text>
    ${guia}${zonas}${puntos}${etiqueta}
  </svg>`;

  // ---- textos: leyenda, nota de los que no tienen dato, pie y tabla
  const ley = leyenda([
    { clase: 'g-m-planeta', texto: `Surface ${cuerpo.de}` },
    { clase: 'g-m-ctx', texto: 'Sites' },
    ...(s ? [{ clase: 'g-m-sel', texto: nombreCorto(s.f.sitio.name) }] : []),
  ]);
  const nota = sin.length ? `<p class="g-di-nota">No data in this layer (not drawn): ${esc(sin.map((f) => nombreCorto(f.sitio.name)).join(', '))}.${sin.some((f) => f.sitio.id === ctx.sel) ? ' The highlighted site is among them.' : ''}</p>` : '';
  const m = muestra(c);
  const pie = [
    `<b>Source:</b> ${esc(fuenteDe(c))}.`,
    `<b>Bars:</b> histogram of the cells with data${m.paso > 1 ? ` (regular sample: one in every ${nf(m.paso * m.paso)})` : ''}, each weighted by its area, in ${nf(h.n)} equal intervals.`,
    `The axis runs from the 0.5th to the 99.5th percentile of the surface; whatever falls outside (${nf(h.colaBaja * 100, 1)} % below and ${nf(h.colaAlta * 100, 1)} % above) is added to the end bars.`,
    `<b>Points:</b> mean of the cells whose center lies within ${nf(RADIO_ZONA, 1)}° of arc of each site; its percentile is the share of the surface with an equal or lower cell value. The height of the points means nothing: they are stacked so they do not overlap.`,
    def.invertir ? `<b>How to read it:</b> ${esc(primeraFrase(def.por))}` : '',
    k.derivada && c.meta.nota ? esc(c.meta.nota) : '',
  ].filter(Boolean).join(' ');

  const porValor = [...pts].sort((a, b) => b.v.media - a.v.media);
  const tablaHtml = tabla({
    titulo: `${def.corto} at the sites ${cuerpo.en}, from high to low`,
    cabeceras: ['Site', `${def.corto} (${def.unidad})`, 'Percentile on the surface'],
    filas: [
      ...porValor.map((p) => [p.f.sitio.name, def.tick(p.v.media), pct(p.v.pct) ?? '—']),
      ...sin.map((f) => [f.sitio.name, 'no data', '—']),
    ],
  });

  el.innerHTML = figura({
    titulo, sub: `Bars: how much of ${cuerpo.nombre} has each value. Dots: the sites.`,
    cuerpo: ley + svg, mas: nota, pie, tablaHtml, clase: 'g-di',
  });

  // Un solo conTip para puntos y columnas: dos escuchas sobre el mismo contenedor se ocultarían el tooltip el uno al otro
  conTip(el, '[data-sitio], .g-di-col', (t) => (t.dataset.sitio ? tipSitio.get(t.dataset.sitio) ?? null : tipColumna(Number(t.dataset.b))));

  // Las columnas son una sola parada del tabulador; dentro se recorren con las flechas (si no, serían 20-40 paradas)
  el.addEventListener('keydown', (e) => {
    const col = e.target.closest?.('.g-di-col');
    if (!col || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const otra = e.key === 'ArrowLeft' ? col.previousElementSibling : col.nextElementSibling;
    if (!otra?.classList.contains('g-di-col')) return;
    e.preventDefault();
    col.setAttribute('tabindex', '-1'); otra.setAttribute('tabindex', '0'); otra.focus();
  });
}

// Primera frase de la explicación de la capa (def.por): la que dice cómo leer el valor, sin lo que habla del globo
function primeraFrase(por) {
  const f = String(por).split(/\.\s/)[0];
  return /[.!?]$/.test(f) ? f : `${f}.`;
}
