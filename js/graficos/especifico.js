// ============================================================================
//  GRÁFICO PROPIO DE CADA CUERPO  (última sección del panel «Comparar con datos medidos»)
//
//  LUNA · «Temperatura de día y de noche» (LRO · Diviner): una fila por emplazamiento, de la mínima a la máxima.
//    · Punto de la mínima, marca de la media y punto de la máxima = ctx.filas[i].v.moon_tmin / moon_tmedia / moon_tmax
//      (.media: media de las celdas con centro a menos de 0,5° de arco del emplazamiento; js/analitica.js → medirTodo).
//    · Oscilación = esa máxima menos esa mínima (una resta de dos números de ctx, nada más).
//    · Eje: de la menor a la mayor de esas temperaturas, con margen; marcas redondas (base.js → marcas).
//
//  MARTE · «Composición del suelo, con su incertidumbre» (Odyssey GRS): un panel por elemento con incertidumbre
//    publicada (las columnas de ctx.cols que traen k.sigma) y las mismas filas —los emplazamientos— en todos.
//    · Punto = v[id].media (rejilla de 5°: en la práctica, la celda que contiene el emplazamiento).
//    · Barra = media ± v[id].sigma, la incertidumbre que la fuente publica para esa misma celda (capa <id>_sigma).
//    · Línea vertical = mediana de la superficie con dato, ponderada por área (js/analitica.js → cuantil(capa, 0,5)).
//    · Percentil (tooltip) = v[id].pct. Cada panel tiene su propio eje: extensión de (media ± sigma) y la mediana.
//
//  Aquí no hay ningún valor escrito a mano, ni umbrales, ni «bueno/malo»: solo se colocan los números de ctx.
//  Los textos del pie que describen qué es cada magnitud se leen de los metadatos de la capa (meta.nombre,
//  meta.procesado, meta.nota), no se redactan aquí. No se usan la puntuación ni las capas *_aprox.
// ============================================================================
import { RADIO_ZONA } from '../capas.js';
import { cuantil } from '../analitica.js';
import { esc, nf, pct, COLOR, lineal, marcas, decimalesDe, conTip, tipHtml, tabla, figura, leyenda, nombreCorto, fuenteDe, pctTxt, unaParada } from './base.js';

const vacio = (t) => `<p class="g-vacio">${esc(t)}</p>`;
const px = (v) => Number(v.toFixed(1));
const may = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const corta = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const unicos = (xs) => [...new Set(xs.filter(Boolean))];
const rotulo = (s) => `${s.rank}. ${s.name}`;
const ARCO = `${nf(RADIO_ZONA, decimalesDe([RADIO_ZONA]))}°`;                    // radio de la zona de medirTodo: «0,5°»
const grados = (c) => { const d = Math.abs(c.meta.dlat); return `${nf(d, decimalesDe([d]))}°`; };   // paso de la rejilla

// Cómo se ha resumido una medición (z de medirTodo) en la rejilla de la capa c
const resumen = (z, c) => (z.unica ? `${grados(c)} cell that contains the site`
  : z.n === 1 ? `the only ${grados(c)} cell whose center lies within ${ARCO} of arc of the site`
  : `mean of ${nf(z.n)} ${grados(c)} cells whose center lies within ${ARCO} of arc of the site`);

// Varias capas del mismo producto comparten casi toda la descripción de su procesado: se separan las frases comunes
// (se dicen una vez) de las propias de cada capa. Solo se parte y se compara el texto de los metadatos; no se reescribe.
function separar(textos) {
  const p = textos.map((t) => String(t ?? '').split('. '));
  let n = 0;
  while (n < p[0].length && p.every((x) => x[n] === p[0][n])) n++;
  const comun = p[0].slice(0, n).join('. ');
  return { comun: comun && n < p[0].length ? `${comun}.` : comun, propio: p.map((x) => x.slice(n).join('. ')) };
}

// Fila de un emplazamiento: es la marca que el panel escucha (data-sitio; clic o Intro → lo destaca). La zona de
// acierto ocupa toda la fila y sirve también de banda de la fila destacada y de anillo de foco (css/g-especifico.css).
// clave (Marte): «<capa>:<sitio>», única aunque el emplazamiento se repita en cada panel; con ella el panel devuelve el
// foco a la fila del mismo panel tras repintar (panel.js → claveFoco), no a la del primero.
const grupoFila = (s, sel, aria, y, alto, W, dentro, clave = '') => `<g class="g-es-fila${sel ? ' sel' : ''}" data-sitio="${esc(s.id)}"${clave ? ` data-clave="${esc(clave)}"` : ''} tabindex="0" role="button" aria-pressed="${sel}" aria-label="${esc(aria)}">
  <rect class="g-hit g-es-zona" x="0" y="${px(y)}" width="${W}" height="${alto}" rx="3"/>${dentro}</g>`;

// ---------------------------------------------------------------------------
//  LUNA: temperatura mínima, media y máxima (Diviner)
// ---------------------------------------------------------------------------
function luna(el, ctx) {
  const col = (id) => ctx.cols.find((k) => k.def.id === id);
  const kMin = col('moon_tmin'), kMed = col('moon_tmedia'), kMax = col('moon_tmax');
  if (!kMin || !kMax) { el.innerHTML = vacio('The Diviner temperature layers (minimum and maximum) could not be loaded.'); return; }
  const ks = [kMin, kMed, kMax].filter(Boolean), nombres = ks.map((k) => (k === kMin ? 'Minimum' : k === kMax ? 'Maximum' : 'Mean'));
  const filas = ctx.filas.map((f) => ({ s: f.sitio, mi: f.v[kMin.def.id] ?? null, me: kMed ? f.v[kMed.def.id] ?? null : null, ma: f.v[kMax.def.id] ?? null }));
  const todos = filas.flatMap((r) => [r.mi, r.me, r.ma]).filter(Boolean).map((z) => z.media);
  if (!todos.length) { el.innerHTML = vacio('No site has Diviner temperature data.'); return; }

  // Eje X: de la menor a la mayor temperatura de los emplazamientos. Más margen a la izquierda (cabe el valor escrito
  // de la mínima del destacado sin pisar los nombres) que a la derecha (el de la máxima cabe en el margen derecho).
  // viewBox ≈ píxeles reales (entre 280 y 560): en móvil el texto no se encoge; con poco ancho, nombres más cortos
  const W = Math.round(Math.min(560, Math.max(280, el.clientWidth || 460)));
  const uni = kMax.def.unidad, mL = W < 380 ? 96 : 138, mR = 28, mT = 6, alto = 22, base = mT + filas.length * alto, H = base + 36;
  const lo = Math.min(...todos), hi = Math.max(...todos), span = hi - lo || 1;
  const x = lineal(lo - 0.09 * span, hi + 0.04 * span, mL, W - mR);
  const ms = marcas(x.d[0], x.d[1], 5), dec = decimalesDe(ms);
  const txt = (k, z) => (k && z ? k.def.fmt(z.media) : 'no data');
  const oscilacion = (r) => (r.mi && r.ma ? `${nf(r.ma.media - r.mi.media, 0)} ${uni}` : 'no data');

  const eje = `${ms.map((t) => `<line class="g-rej" x1="${px(x(t))}" x2="${px(x(t))}" y1="${mT}" y2="${base}"/>
      <text x="${px(x(t))}" y="${base + 14}" text-anchor="middle">${esc(nf(t, dec))}</text>`).join('')}
    <line class="g-eje" x1="${mL}" x2="${W - mR}" y1="${base}" y2="${base}"/>
    <text class="g-txt" x="${(mL + W - mR) / 2}" y="${base + 30}" text-anchor="middle">${esc(`Surface temperature (${uni})`)}</text>`;

  // Las filas van en el orden del ranking (también el del tabulador): no se solapan, así que el destacado no necesita
  // pintarse el último. No cambia de color —el color aquí distingue mínima de máxima—: lleva banda, negrita y valores.
  const dibujo = filas.map((r, i) => {
    const y = mT + i * alto, cy = px(y + alto / 2), ty = px(y + alto / 2 + 3.5), sel = r.s.id === ctx.sel, cls = sel ? 'g-val' : 'g-txt';
    const xi = r.mi ? px(x(r.mi.media)) : null, xm = r.me ? px(x(r.me.media)) : null, xa = r.ma ? px(x(r.ma.media)) : null;
    const hay = r.mi || r.me || r.ma;
    const aria = `${rotulo(r.s)}: ${hay ? `minimum ${txt(kMin, r.mi)}, mean ${txt(kMed, r.me)}, maximum ${txt(kMax, r.ma)}` : 'no temperature data'}`;
    return grupoFila(r.s, sel, aria, y, alto, W, `
      <text class="${cls}" x="16" y="${ty}" text-anchor="end">${esc(r.s.rank)}</text>
      <text class="${cls}" x="22" y="${ty}">${esc(corta(nombreCorto(r.s.name), W < 380 ? 13 : 21))}</text>
      ${hay ? '' : `<text class="g-es-nd" x="${mL + 6}" y="${ty}">no data</text>`}
      ${xi != null && xa != null ? `<line class="g-es-seg" x1="${xi}" x2="${xa}" y1="${cy}" y2="${cy}"/>` : ''}
      ${xm != null ? `<line class="g-es-med" x1="${xm}" x2="${xm}" y1="${px(cy - 7)}" y2="${px(cy + 7)}"/>` : ''}
      ${xi != null ? `<circle class="g-es-pt g-es-min" cx="${xi}" cy="${cy}" r="5"/>` : ''}
      ${xa != null ? `<circle class="g-es-pt g-es-max" cx="${xa}" cy="${cy}" r="5"/>` : ''}
      ${sel && xi != null ? `<text class="g-val" x="${px(xi - 9)}" y="${ty}" text-anchor="end">${esc(kMin.def.tick(r.mi.media))}</text>` : ''}
      ${sel && xa != null ? `<text class="g-val" x="${px(xa + 9)}" y="${ty}">${esc(kMax.def.tick(r.ma.media))}</text>` : ''}`);
  }).join('');

  const elegido = filas.find((r) => r.s.id === ctx.sel);
  const ley = leyenda([{ clase: 'g-es-ley-min', texto: 'minimum' }, ...(kMed ? [{ clase: 'g-es-ley-med', texto: 'mean' }] : []), { clase: 'g-es-ley-max', texto: 'maximum' },
    ...(elegido ? [{ clase: 'g-es-ley-sel', texto: `highlighted: ${nombreCorto(elegido.s.name)} (highlighted row, with its values)` }] : [])]);
  const incompletos = filas.filter((r) => !r.mi || !r.ma);
  const nota = incompletos.length ? `<p class="g-es-nota">No minimum or maximum data (that mark is not drawn): ${esc(incompletos.map((r) => `${r.s.rank}. ${nombreCorto(r.s.name)}`).join(', '))}.</p>` : '';
  // Los dos colores de serie salen de base.js (COLOR) y llegan al SVG y a la leyenda como variables CSS
  const cuerpo = `<div class="g-es-serie" style="--g-es-min: ${COLOR.serie1}; --g-es-max: ${COLOR.serie2}">${ley}
    <svg class="g-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(`Minimum, mean and maximum surface temperature at each site ${ctx.cuerpo.en}. The arrow keys move through the sites`)}">${eje}${dibujo}</svg></div>`;

  // Pie: qué es cada temperatura, con las palabras de los metadatos de cada capa. Se quitan las remisiones a capas que
  // la web no ofrece («(see the gap layer)», «(see the number-of-intervals layer)»): el lector no podría verlas.
  const sinRemision = (t) => String(t ?? '').replace(/\s*\(see the [^)]*layer\)/g, '');
  const proc = separar(ks.map((k) => k.capa.meta.procesado)), notas = unicos(ks.map((k) => k.capa.meta.nota));
  const pie = `<b>Source</b>: ${esc(unicos(ks.map((k) => fuenteDe(k.capa))).join('; '))}. ${esc(sinRemision(proc.comun))}
    ${ks.map((k, i) => `<b>${nombres[i]}</b>: ${esc(k.capa.meta.nombre ?? k.def.corto)}. ${esc(sinRemision(proc.propio[i]))}`).join(' ')}
    ${notas.map((t) => esc(sinRemision(t))).join(' ')}
    <b>At each site</b>: mean of the cells whose center lies within ${ARCO} of arc (if there are none, the cell that contains it). The swing is that maximum minus that minimum.`;

  const tablaHtml = tabla({ titulo: `Surface temperature at each site ${ctx.cuerpo.en} (Diviner)`,
    cabeceras: ['Site', 'Minimum', 'Mean', 'Maximum', 'Swing (maximum − minimum)'],
    filas: filas.map((r) => [rotulo(r.s), txt(kMin, r.mi), txt(kMed, r.me), txt(kMax, r.ma), oscilacion(r)]) });

  el.innerHTML = figura({ titulo: 'Daytime and nighttime temperature',
    sub: 'Coldest and hottest ground temperature at each site, measured from orbit.',
    cuerpo, mas: nota, pie, tablaHtml, clase: 'g-es g-es-luna' });

  unaParada(el, 'g.g-es-fila');                                 // las filas: una sola parada del tabulador
  const porId = new Map(filas.map((r) => [r.s.id, r]));
  conTip(el, '.g-es-fila', (g) => {
    const r = porId.get(g.dataset.sitio);
    if (!r) return null;
    const zs = [r.mi, r.me, r.ma].filter(Boolean);
    if (!zs.length) return tipHtml(rotulo(r.s), [], 'No temperature data in the cells of this site.');
    // nº de celdas promediadas: puede variar de una capa a otra si alguna celda no tiene dato en una de ellas
    const ns = zs.map((z) => z.n), a = Math.min(...ns), b = Math.max(...ns), c = kMax.capa;
    const como = a === b ? may(resumen(zs[0], c)) : `Mean of between ${nf(a)} and ${nf(b)} ${grados(c)} cells (depending on the layer) whose center lies within ${ARCO} of arc of the site`;
    return tipHtml(rotulo(r.s), [['Minimum', txt(kMin, r.mi)], ...(kMed ? [['Mean', txt(kMed, r.me)]] : []), ['Maximum', txt(kMax, r.ma)],
      ['Swing (maximum − minimum)', oscilacion(r)]], `${como}.`);
  });
}

// ---------------------------------------------------------------------------
//  MARTE: composición del suelo con su incertidumbre publicada (Odyssey GRS)
// ---------------------------------------------------------------------------
const conSigma = (z) => z.sigma != null && z.sigma === z.sigma;
// La incertidumbre con los decimales de la capa; si con ellos se quedara en cero, con una cifra significativa
const sigmaTxt = (def, s) => { const t = def.tick(s); return /[1-9]/.test(t) ? t : s.toLocaleString('en-US', { maximumSignificantDigits: 1 }); };
const valorSigma = (def, z, conUnidad = true) => (conSigma(z) ? `${def.tick(z.media)} ± ${sigmaTxt(def, z.sigma)}${conUnidad ? ` ${def.unidad}` : ''}` : conUnidad ? def.fmt(z.media) : def.tick(z.media));

function marte(el, ctx) {
  const cols = ctx.cols.filter((k) => k.sigma);
  if (!cols.length) { el.innerHTML = vacio('The Odyssey GRS composition layers with their uncertainty could not be loaded.'); return; }
  if (!ctx.filas.some((f) => cols.some((k) => f.v[k.def.id]))) { el.innerHTML = vacio('No site has Odyssey GRS composition data.'); return; }
  const W = 180, mL = 20, mR = 8, mT = 6, alto = 16, base = mT + ctx.filas.length * alto, H = base + 20;
  const mediana = new Map(cols.map((k) => [k.def.id, cuantil(k.capa, 0.5)]));
  const medianaTxt = (k, f = k.def.fmt) => { const m = mediana.get(k.def.id); return m === m ? f(m) : 'no data'; };

  const panel = (k) => {
    const id = k.def.id, med = mediana.get(id), ext = med === med ? [med] : [];
    for (const f of ctx.filas) { const z = f.v[id]; if (z) { const e = conSigma(z) ? z.sigma : 0; ext.push(z.media - e, z.media + e); } }
    const titulo = `<div class="g-es-ptit"><b>${esc(k.def.corto)}</b> <span>${esc(k.def.unidad)}</span></div>`;
    if (!ext.length) return `<div class="g-es-panel">${titulo}${vacio('No data.')}</div>`;
    // Eje propio del panel: extensión de (media ± incertidumbre) de los emplazamientos y la mediana, con margen
    const lo = Math.min(...ext), hi = Math.max(...ext), margen = 0.07 * (hi - lo || Math.abs(hi) || 1);
    const x = lineal(lo - margen, hi + margen, mL, W - mR);
    let ms = [];
    for (const n of [2, 3, 4, 5, 6]) { ms = marcas(x.d[0], x.d[1], n); if (ms.length >= 2) break; }   // 2–3 marcas redondas
    const dec = decimalesDe(ms);
    const eje = `${ms.map((t) => `<line class="g-rej" x1="${px(x(t))}" x2="${px(x(t))}" y1="${mT}" y2="${base}"/>
        <text x="${px(x(t))}" y="${base + 13}" text-anchor="middle">${esc(nf(t, dec))}</text>`).join('')}
      <line class="g-eje" x1="${mL}" x2="${W - mR}" y1="${base}" y2="${base}"/>
      ${med === med ? `<line class="g-ref" x1="${px(x(med))}" x2="${px(x(med))}" y1="${mT}" y2="${base}"/>` : ''}`;

    // Mismas filas en todos los paneles, en el orden del ranking (no se solapan: el destacado no necesita ir el último)
    const filas = ctx.filas.map((f, i) => {
      const s = f.sitio, z = f.v[id] ?? null, y = mT + i * alto, cy = px(y + alto / 2), ty = px(y + alto / 2 + 3.5), sel = s.id === ctx.sel;
      const puesto = `<text${sel ? ' class="g-val"' : ''} x="${mL - 6}" y="${ty}" text-anchor="end">${esc(s.rank)}</text>`;
      if (!z) return grupoFila(s, sel, `${rotulo(s)}: ${k.def.corto}, no data`, y, alto, W, puesto, `${id}:${s.id}`);   // sin dato: sin marca
      const e = conSigma(z) ? z.sigma : 0, cx = px(x(z.media)), x0 = px(x(z.media - e)), x1 = px(x(z.media + e));
      let marca = `${e ? `<line class="g-ml g-es-err${sel ? ' sel' : ''}" x1="${x0}" x2="${x1}" y1="${cy}" y2="${cy}"/>` : ''}
        <circle class="g-m${sel ? ' sel' : ''}" cx="${cx}" cy="${cy}" r="4.5"/>`;
      if (sel) {                                                // etiqueta directa del destacado, al lado donde quepa
        const t = k.def.tick(z.media), ancho = t.length * 6 + 4, der = Math.max(x1, cx + 6), izq = Math.min(x0, cx - 6);
        const aDerecha = der + 4 + ancho <= W || izq - 4 - ancho < mL;
        marca += `<text class="g-val g-es-halo" x="${px(aDerecha ? der + 4 : izq - 4)}" y="${ty}" text-anchor="${aDerecha ? 'start' : 'end'}">${esc(t)}</text>`;
      }
      return grupoFila(s, sel, `${rotulo(s)}: ${k.def.corto}, ${valorSigma(k.def, z)}`, y, alto, W, puesto + marca, `${id}:${s.id}`);
    }).join('');

    return `<div class="g-es-panel">${titulo}
      <svg class="g-svg" viewBox="0 0 ${W} ${H}" data-es-col="${esc(id)}" role="group" aria-label="${esc(`${k.def.corto} (${k.def.unidad}): value and published uncertainty at each site. Surface median ${ctx.cuerpo.en}: ${medianaTxt(k)}. The arrow keys move through the sites`)}">${eje}${filas}</svg></div>`;
  };

  const elegido = ctx.filas.find((f) => f.sitio.id === ctx.sel);
  const ley = leyenda([{ clase: 'g-m-ctx', texto: 'site' }, ...(elegido ? [{ clase: 'g-m-sel', texto: `highlighted: ${nombreCorto(elegido.sitio.name)}` }] : []),
    { clase: 'g-es-ley-err', texto: 'margin of error' }, { clase: 'g-es-ley-ref', texto: `middle value ${ctx.cuerpo.de}` }]);
  const sinDato = cols.map((k) => ({ k, quien: ctx.filas.filter((f) => !f.v[k.def.id]).map((f) => `${f.sitio.rank}. ${nombreCorto(f.sitio.name)}`) })).filter((d) => d.quien.length);
  const nota = sinDato.length ? `<p class="g-es-nota">No published data (no mark drawn): ${esc(sinDato.map((d) => `${d.k.def.corto}: ${d.quien.join(', ')}`).join(' · '))}.</p>` : '';
  const cuerpo = `${ley}<div class="g-es-rejilla">${cols.map(panel).join('')}</div>`;

  // Pie: lo que es la barra se dice con el texto de los metadatos de cada capa de incertidumbre (meta.procesado),
  // agrupando los elementos que comparten descripción. No se afirma nada más (ni nivel de confianza ni distribución).
  const medidas = ctx.filas.flatMap((f) => cols.map((k) => f.v[k.def.id])).filter(Boolean);
  const unaCelda = medidas.every((z) => z.unica || z.n === 1), paso = unicos(cols.map((k) => grados(k.capa))).join(' / ');
  const grupos = new Map();
  for (const k of cols) {
    const t = unicos([k.sigma.meta.procesado, k.sigma.meta.nota]).join(' ') || (k.sigma.meta.nombre ?? '');
    grupos.set(t, [...(grupos.get(t) ?? []), k.def.corto]);
  }
  const barras = [...grupos].map(([t, quien]) => `${esc(quien.join(', '))}: “${esc(t)}”`).join('; ');
  const citas = unicos(cols.map((k) => k.capa.meta.fuente?.cita));
  const pie = `<b>Source</b>: ${esc(unicos(cols.map((k) => fuenteDe(k.capa))).join('; '))}.
    <b>Point</b>: ${unaCelda ? `value of the ${esc(paso)} cell that contains the site` : `mean of the ${esc(paso)} cells whose center lies within ${ARCO} of arc of the site (if there are none, the cell that contains it)`};
    sites that fall in the same cell share a value.
    <b>Bar</b>: from the value minus the uncertainty to the value plus the uncertainty that the source publishes for that same cell (${barras}).
    <b>Vertical line</b>: median of the cells with data ${esc(ctx.cuerpo.en)}, weighted by their area; the cursor percentile refers to that same surface with data.
    ${citas.map(esc).join(' ')}`;

  const tablaHtml = tabla({ titulo: `Surface composition at each site ${ctx.cuerpo.en}: value ± published uncertainty (Odyssey GRS)`,
    cabeceras: ['Site', ...cols.map((k) => `${k.def.corto} (${k.def.unidad})`)],
    filas: [...ctx.filas.map((f) => [rotulo(f.sitio), ...cols.map((k) => { const z = f.v[k.def.id]; return z ? valorSigma(k.def, z, false) : 'no data'; })]),
      [`Median of the surface ${ctx.cuerpo.de}`, ...cols.map((k) => medianaTxt(k, k.def.tick))]] });

  el.innerHTML = figura({ titulo: 'What the ground is made of',
    sub: 'One box per chemical element, each with its own horizontal scale; one row per site. The line around each dot shows the margin of error.',
    cuerpo, mas: nota, pie, tablaHtml, clase: 'g-es g-es-marte' });

  el.querySelectorAll('svg[data-es-col]').forEach((sv) => unaParada(sv, 'g.g-es-fila'));   // una parada por panel, no una por fila
  const porId = new Map(ctx.filas.map((f) => [f.sitio.id, f])), porCol = new Map(cols.map((k) => [k.def.id, k]));
  conTip(el, '.g-es-fila', (g) => {
    const f = porId.get(g.dataset.sitio), k = porCol.get(g.closest('svg')?.dataset.esCol);
    if (!f || !k) return null;
    const z = f.v[k.def.id];
    if (!z) return tipHtml(rotulo(f.sitio), [[k.def.corto, 'no data']], 'The source publishes no data in the cell of this site.');
    const p = pct(z.pct);
    return tipHtml(rotulo(f.sitio), [[k.def.corto, valorSigma(k.def, z)], ['Higher than', p == null ? '—' : `${pctTxt(z.pct)} % of the surface`], ['Surface median', medianaTxt(k)]],
      `${may(resumen(z, k.capa))}. ${conSigma(z) ? '± = published uncertainty for that cell.' : 'No published uncertainty for that cell.'} “Higher than N %”: share of the surface with data that has an equal or lower value.`);
  });
}

// ---------------------------------------------------------------------------
//  Entrada del panel (js/graficos/panel.js): un gráfico distinto según el cuerpo
// ---------------------------------------------------------------------------
export function pintar(el, ctx) {
  if (ctx.body === 'moon') luna(el, ctx);
  else if (ctx.body === 'mars') marte(el, ctx);
  else el.innerHTML = vacio('There is no specific chart for this body.');
}
