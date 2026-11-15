// ============================================================================
//  CAPA EN DETALLE · LATITUD  («{capa}: cómo cambia con la latitud»)
//
//  Qué muestra: el perfil de la capa elegida de polo a polo (la media de todas las longitudes en cada franja de
//  latitud, con la banda entre los cuartiles 25 % y 75 %) y, encima, un punto por emplazamiento en su latitud y su
//  valor. Sirve para ver si un emplazamiento es como el resto de su latitud o se aparta de ella.
//
//  De dónde sale cada número:
//    · Línea y banda → js/analitica.js perfilLatitud(capa, paso): media ponderada por área y cuartiles de las celdas con
//                      dato de cada franja. paso = el mayor entre 2° y el tamaño de celda de la capa (5° en Odyssey GRS).
//                      Una franja sin dato es NaN: ahí la línea y la banda se cortan, no se unen los huecos.
//    · Puntos        → ctx.filas[]: x = sitio.lat; y = v[capa].media (media de las celdas con centro a menos de 0,5° de
//                      arco del emplazamiento, Capa.zona).
//    · Entre franjas contiguas la línea une sus medias (solo es dibujo): el valor de cada franja está en su tooltip.
//  Aquí no hay umbrales, ni puntuación, ni valores escritos a mano.
// ============================================================================
import { perfilLatitud } from '../analitica.js';
import { RADIO_ZONA } from '../capas.js';
import { esc, nf, lineal, marcas, decimalesDe, conTip, tipHtml, tabla, figura, leyenda, nombreCorto, fuenteDe } from './base.js';

const W = 460, H = 236, M = { l: 50, r: 14, t: 18, b: 36 };
const R = 5;
const LATS = [-90, -60, -30, 0, 30, 60, 90];              // marcas del eje de latitud
const ANCHO_LETRA = 5.7;                                  // ancho medio de un carácter de 10 px en negrita (para anclar la etiqueta)
const f1 = (v) => Math.round(v * 10) / 10;
const latTxt = (la, dec = 0) => (la === 0 ? '0°' : `${nf(Math.abs(la), dec)}°${la > 0 ? 'N' : 'S'}`);

// Rótulo de las marcas del eje: el formato de la capa (def.tick) salvo que las marcas necesiten más decimales de los
// que da (0,25 con un decimal saldría «0,3»): entonces, los decimales justos.
function rotulador(def, ms) {
  const propios = (def.tick(1).split('.')[1] ?? '').length, d = decimalesDe(ms);
  return d > propios ? (v) => nf(v, d) : def.tick;
}

export function pintar(el, ctx) {
  const k = ctx.cols.find((x) => x.def.id === ctx.capa);
  if (!k) { el.innerHTML = '<p class="g-vacio">Choose a layer to see how it changes with latitude.</p>'; return; }
  const { def, capa: c } = k;
  const breve = (v) => def.breve(v).trim();               // las unidades largas se omiten en «breve» y dejan un espacio al final
  const paso = Math.max(2, Math.abs(c.meta.dlat)), p = perfilLatitud(c, paso), nb = p.lat.length, dPaso = decimalesDe([paso]);
  const titulo = `${def.corto}: from pole to pole`;
  const conDato = (b) => Number.isFinite(p.media[b]) && Number.isFinite(p.q25[b]) && Number.isFinite(p.q75[b]);
  const franjaDe = (lat) => Math.min(nb - 1, Math.max(0, Math.floor((lat + 90) / paso)));        // igual que perfilLatitud()
  const limites = (b) => [-90 + b * paso, Math.min(90, -90 + (b + 1) * paso)];
  const franja = (b) => { const [a, z] = limites(b); return `Band from ${latTxt(a, dPaso)} to ${latTxt(z, dPaso)}`; };

  // ---- emplazamientos con dato en esta capa
  const sin = ctx.filas.filter((f) => !f.v[def.id]);
  const pts = ctx.filas.filter((f) => f.v[def.id]).map((f) => ({ f, v: f.v[def.id], b: franjaDe(f.sitio.lat), sel: f.sitio.id === ctx.sel }));

  // ---- dominio de y: la banda, la media y los puntos, con un margen
  const vals = pts.map((q) => q.v.media);
  for (let b = 0; b < nb; b++) if (conDato(b)) vals.push(p.q25[b], p.q75[b], p.media[b]);
  if (!vals.length) {
    el.innerHTML = figura({ titulo, cuerpo: '<p class="g-vacio">This layer has no cell with data.</p>' });
    return;
  }
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const margen = (hi - lo) * 0.06 || Math.abs(hi) * 0.06 || 1;
  lo -= margen; hi += margen;
  const yB = H - M.b, x = lineal(-90, 90, M.l, W - M.r), y = lineal(lo, hi, yB, M.t);
  let my = marcas(lo, hi, 4);
  for (let n = 5; my.length < 3 && n <= 8; n++) my = marcas(lo, hi, n);       // con menos de tres marcas el eje no se lee
  const rot = rotulador(def, my);

  // ---- tramos de franjas contiguas con dato: la línea y la banda se cortan entre un tramo y el siguiente
  const tramos = [];
  for (let b = 0, t = null; b < nb; b++) {
    if (conDato(b)) { if (!t) tramos.push((t = [])); t.push(b); } else t = null;
  }
  // Cada tramo va de borde a borde de sus franjas: en los extremos se prolonga en horizontal media franja (el valor de
  // una franja vale para toda ella), así una franja aislada también se ve.
  const puntosDe = (t) => { const a = t[0], z = t[t.length - 1]; return [[x(limites(a)[0]), a], ...t.map((b) => [x(p.lat[b]), b]), [x(limites(z)[1]), z]]; };
  const camino = (ps, serie) => ps.map(([px, b], i) => `${i ? 'L' : 'M'}${f1(px)},${f1(y(serie[b]))}`).join('');
  const bandas = tramos.map((t) => { const ps = puntosDe(t); return `<path class="g-banda" d="${camino(ps, p.q75)}${camino([...ps].reverse(), p.q25).replace('M', 'L')}Z"/>`; }).join('');
  const lineas = tramos.map((t) => `<path class="g-linea" d="${camino(puntosDe(t), p.media)}"/>`).join('');
  const huecos = tramos.length !== 1 || tramos[0].length !== nb;     // hay franjas sin dato

  // ---- zonas de acierto de las franjas (toda la altura): el valor exacto de cada franja, sin interpolar
  const textoFranja = (b) => (conDato(b) ? `${franja(b)}: mean ${def.fmt(p.media[b])}; quartiles ${breve(p.q25[b])} and ${breve(p.q75[b])}` : `${franja(b)}: no data`);
  const franjas = Array.from({ length: nb }, (_, b) => {
    const [a, z] = limites(b);
    return `<rect class="g-hit g-la-fr" data-b="${b}" data-clave="f${b}" tabindex="${b ? -1 : 0}" role="img" aria-label="${esc(textoFranja(b))}"
      x="${f1(x(a))}" y="${M.t}" width="${f1(x(z) - x(a))}" height="${yB - M.t}"/>`;
  }).join('');
  const tipFranja = (b) => {
    const aqui = ctx.filas.filter((f) => franjaDe(f.sitio.lat) === b).map((f) => nombreCorto(f.sitio.name));
    const notaSitios = aqui.length ? `Sites in this band: ${aqui.join(', ')}.` : '';
    if (!conDato(b)) return tipHtml(franja(b), [[def.corto, 'no data']], `The layer has no published data in this band. ${notaSitios}`.trim());
    const cobertura = p.fraccion[b] < 0.995 ? `${nf(p.fraccion[b] * 100)} % of the cells in the band have data.` : '';
    return tipHtml(franja(b), [['Mean', def.fmt(p.media[b])], ['25 % quartile', breve(p.q25[b])], ['75 % quartile', breve(p.q75[b])]],
      [cobertura, notaSitios].filter(Boolean).join(' '));
  };

  // ---- puntos de los emplazamientos (el destacado, el último: queda encima)
  const mediaFranja = (q) => (conDato(q.b) ? def.fmt(p.media[q.b]) : 'no data');
  const orden = [...pts.filter((q) => !q.sel), ...pts.filter((q) => q.sel)];
  const cx = (q) => f1(x(q.f.sitio.lat)), cy = (q) => f1(y(q.v.media));
  const zonas = orden.map((q) => `<rect class="g-hit" data-sitio="${esc(q.f.sitio.id)}" aria-hidden="true" x="${f1(cx(q) - 8)}" y="${f1(cy(q) - 8)}" width="16" height="16" rx="8"/>`).join('');
  const puntos = orden.map((q) => `<circle class="g-m${q.sel ? ' sel' : ''}" data-sitio="${esc(q.f.sitio.id)}" tabindex="0" role="button"
      aria-label="${esc(`${q.f.sitio.name}: ${def.fmt(q.v.media)} at ${latTxt(q.f.sitio.lat, 1)}; mean of its latitude band: ${mediaFranja(q)}`)}"
      cx="${cx(q)}" cy="${cy(q)}" r="${R}"/>`).join('');
  const tipSitio = new Map(pts.map((q) => {
    const filas = [['Latitude', latTxt(q.f.sitio.lat, 1)], [def.corto, def.fmt(q.v.media)], ['Mean of its latitude band', mediaFranja(q)]];
    const nota = [
      `${franja(q.b)}.`,
      q.v.unica ? `No cell has its center within ${nf(RADIO_ZONA, 1)}°: this is the cell that contains the point.` : '',
    ].filter(Boolean).join(' ');
    return [q.f.sitio.id, tipHtml(q.f.sitio.name, filas, nota)];
  }));

  // ---- etiqueta directa del destacado: encima, debajo, a la derecha o a la izquierda del punto. Gana el primer sitio
  //      que cabe en el gráfico y pisa menos puntos (en los polos se juntan varios emplazamientos).
  const s = pts.find((q) => q.sel);
  let etiqueta = '';
  if (s) {
    const texto = `${nombreCorto(s.f.sitio.name)} · ${breve(s.v.media)}`, w = texto.length * ANCHO_LETRA, px = cx(s), py = cy(s);
    const centro = Math.max(M.l + 2 + w / 2, Math.min(W - 2 - w / 2, px));          // dentro del área de dibujo: no pisa los rótulos del eje
    const sitios = [
      { x: centro, y: py - 10, ancla: 'middle', x0: centro - w / 2 },
      { x: centro, y: py + 18, ancla: 'middle', x0: centro - w / 2 },
      { x: px + 9, y: py + 3.5, ancla: 'start', x0: px + 9 },
      { x: px - 9, y: py + 3.5, ancla: 'end', x0: px - 9 - w },
    ];
    const coste = (e) => {
      const x0 = e.x0, x1 = e.x0 + w, y0 = e.y - 10, y1 = e.y + 2;                 // caja aproximada del texto
      const fuera = x0 < M.l || x1 > W || y0 < 0 || y1 > yB ? 100 : 0;
      return fuera + pts.filter((q) => q !== s && cx(q) + R > x0 && cx(q) - R < x1 && cy(q) + R > y0 && cy(q) - R < y1).length;
    };
    const mejor = sitios.reduce((a, b) => (coste(b) < coste(a) ? b : a));
    etiqueta = `<text class="g-val g-la-et" x="${f1(mejor.x)}" y="${f1(mejor.y)}" text-anchor="${mejor.ancla}">${esc(texto)}</text>`;
  }

  const yM = (M.t + yB) / 2;
  const svg = `<svg class="g-svg g-la-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(titulo)}">
    ${my.map((v) => `<line class="g-rej" x1="${M.l}" x2="${W - M.r}" y1="${f1(y(v))}" y2="${f1(y(v))}"/>
      <text x="${M.l - 6}" y="${f1(y(v) + 3.5)}" text-anchor="end">${esc(rot(v))}</text>`).join('')}
    ${LATS.map((la) => `<line class="g-rej" x1="${f1(x(la))}" x2="${f1(x(la))}" y1="${M.t}" y2="${yB}"/>
      <text x="${f1(x(la))}" y="${yB + 15}" text-anchor="middle">${esc(latTxt(la))}</text>`).join('')}
    <line class="g-eje" x1="${M.l}" x2="${W - M.r}" y1="${yB}" y2="${yB}"/>
    <text class="g-txt" x="${(M.l + W - M.r) / 2}" y="${H - 5}" text-anchor="middle">Latitude</text>
    <text class="g-txt" x="11" y="${yM}" text-anchor="middle" transform="rotate(-90 11 ${yM})">${esc(`${def.corto} (${def.unidad})`)}</text>
    ${bandas}${lineas}
    <g class="g-la-frs" role="group" aria-label="Profile by latitude bands: left and right arrows move through them">${franjas}</g>
    ${zonas}${puntos}${etiqueta}
  </svg>`;

  // ---- textos: leyenda, nota de los que no tienen dato, pie y tabla
  const ley = leyenda([
    { clase: 'g-m-linea', texto: 'Average at that latitude' },
    { clase: 'g-m-planeta', texto: 'Where the middle half of values lie' },
    { clase: 'g-m-ctx', texto: 'Sites' },
    ...(s ? [{ clase: 'g-m-sel', texto: nombreCorto(s.f.sitio.name) }] : []),
  ]);
  const nota = sin.length ? `<p class="g-la-nota">No data in this layer (not drawn): ${esc(sin.map((f) => nombreCorto(f.sitio.name)).join(', '))}.${sin.some((f) => f.sitio.id === ctx.sel) ? ' The highlighted site is among them.' : ''}</p>` : '';
  const pie = [
    `<b>Source:</b> ${esc(fuenteDe(c))}.`,
    `<b>Line:</b> area-weighted mean of the cells with data in each ${nf(paso, dPaso)}° latitude band (in the finest grids, a regular sample of longitudes); <b>band:</b> 25 % and 75 % quartiles of those same cells.`,
    'Between adjacent bands the line joins their means; the value of each band is in its tooltip.',
    huecos ? 'The line breaks where the layer has no published data.' : '',
    `<b>Points:</b> mean of the cells whose center lies within ${nf(RADIO_ZONA, 1)}° of arc of each site.`,
    k.derivada && c.meta.nota ? esc(c.meta.nota) : '',
  ].filter(Boolean).join(' ');

  const tablaHtml = tabla({
    titulo: `${def.corto}: each site and the mean of its latitude band (${nf(paso, dPaso)}° bands)`,
    cabeceras: ['Site', 'Latitude', `${def.corto} (${def.unidad})`, `Mean of its band (${def.unidad})`],
    filas: ctx.filas.map((f) => {
      const v = f.v[def.id], b = franjaDe(f.sitio.lat);
      return [f.sitio.name, latTxt(f.sitio.lat, 1), v ? def.tick(v.media) : 'no data', conDato(b) ? def.tick(p.media[b]) : 'no data'];
    }),
  });

  el.innerHTML = figura({
    titulo, sub: 'Line: the average at each distance from the equator. Dots: the sites.',
    cuerpo: ley + svg, mas: nota, pie, tablaHtml, clase: 'g-la',
  });

  // Un solo conTip para puntos y franjas: dos escuchas sobre el mismo contenedor se ocultarían el tooltip el uno al otro
  conTip(el, '[data-sitio], .g-la-fr', (t) => (t.dataset.sitio ? tipSitio.get(t.dataset.sitio) ?? null : tipFranja(Number(t.dataset.b))));

  // Las franjas son una sola parada del tabulador; dentro se recorren con las flechas (si no, serían hasta 90 paradas)
  el.addEventListener('keydown', (e) => {
    const fr = e.target.closest?.('.g-la-fr');
    if (!fr || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const otra = e.key === 'ArrowLeft' ? fr.previousElementSibling : fr.nextElementSibling;
    if (!otra?.classList.contains('g-la-fr')) return;
    e.preventDefault();
    fr.setAttribute('tabindex', '-1'); otra.setAttribute('tabindex', '0'); otra.focus();
  });
}
