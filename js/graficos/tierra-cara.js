// ============================================================================
//  CARA A CARA: EL EMPLAZAMIENTO Y SU ANÁLOGO TERRESTRE A LA MISMA ESCALA  (panel de entrenamiento)
//
//  Dos mapas cuadrados del mismo lado en km (300 km en la Luna, 600 km en Marte), norte arriba, con la MISMA escala de
//  color —elevación relativa al centro de cada cuadrado— y la misma exageración del sombreado; un perfil oeste–este de
//  los dos en un solo eje (metros relativos al centro) y una tabla con las cifras del relieve de ambos.
//
//  De dónde sale cada número (js/graficos/tierra-datos.js → caraACara):
//  - Emplazamiento: capa `${body}_elev` (LOLA / MOLA) → ventana() azimutal equidistante. La imagen interpola entre
//    celdas (solo vista); el cursor lee la celda publicada (Capa.en). Centro = celda que contiene el emplazamiento.
//  - Análogo: ventana SRTM precalculada (tierra/srtm_<id>.bin), recortada al mismo lado; agua de tierra/agua_<id>.bin.
//    Centro = media de los 2×2 píxeles centrales.
//  - Tabla: las dos rejillas llevadas a la misma malla (≈ una celda de LOLA/MOLA por píxel) y la misma fórmula de
//    pendiente (diferencias centrales entre píxeles vecinos). Sin umbrales ni puntuaciones.
//
//  ctx = { body, sitio, analogo, estado }
// ============================================================================
import { RAMPAS } from '../capas.js';
import { exageracionRelieve, puntoVentana } from '../analitica.js';
import { esc, nf, coord, marcas, decimalesDe, lineal, tip, tipHtml, tabla, figura, fuenteDe, masInfo } from './base.js';
import { pintarRelieve } from './relieve.js';
import { caraACara, enRecorte } from './tierra-datos.js';
import { realistaAparte, copiar, ampliarSuave, pieMosaico } from './realista.js';

const R_TIERRA_KM = 6371.0088;                                  // esfera de las ventanas SRTM (construir_tierra_web.py)
const DEG = Math.PI / 180;
const NOMBRE = { moon: 'Moon', mars: 'Mars' };
const VIENTOS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const FLECHAS = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
const AGUA = [46, 112, 196];                                    // azul del agua del análogo (con rayas: no depende solo del color)
const r2 = (v) => Number(v.toFixed(2));
const conSigno = (v, dec = 0) => (v === v && v != null ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf(Math.abs(v), dec)} m` : '—');
const m = (v) => (v === v && v != null ? `${nf(v)} m` : '—');
const grados = (v) => (v === v && v != null ? `${nf(v, 1)}°` : '—');
const conBorde = (formas) => `<g class="g-en-halo">${formas}</g><g class="g-en-trazo">${formas}</g>`;
// Fuente de indice.json (objeto con mision, dataset, doi…) en una línea
const fuenteTxt = (f, def) => (typeof f === 'string' ? f : f ? [f.dataset ?? f.mision, f.doi ? `doi:${f.doi}` : ''].filter(Boolean).join(', ') : def);
const refVertical = (f) => (/EGM96/i.test(f?.referencia_vertical ?? '') ? 'EGM96 geoid' : 'SRTM vertical datum');
const donde = (x, y) => {
  const d = Math.hypot(x, y), km = nf(d, 0);
  return km === '0' ? 'at the center' : `${km} km ${VIENTOS[Math.round(((Math.atan2(x, y) / DEG + 360) % 360) / 45) % 8]} of the center`;
};

export async function pintar(el, ctx) {
  const { body, sitio, analogo } = ctx, estado = ctx.estado ?? {};
  el.innerHTML = '<p class="g-cargando" role="status">Drawing both terrains at the same scale…</p>';
  let cmp, ex;
  try { [cmp, ex] = await Promise.all([caraACara(body, sitio, analogo), exageracionRelieve(body)]); }
  catch (e) {
    console.warn('Cara a cara no disponible', e);
    el.innerHTML = '<p class="g-vacio">The relief data for this comparison could not be loaded.</p>';
    return;
  }
  if (!el.isConnected) return;
  if (!cmp) { el.hidden = true; return; }                       // sin ventana SRTM del análogo: la sección no se muestra
  el.hidden = false;
  if (!cmp.tierra.cifras.validos) {                             // ventana sin ningún dato (p. ej. la Antártida, fuera de SRTMGL30)
    const f = cmp.tierra.fuente.relieve;
    el.innerHTML = `<p class="g-vacio">No relief comparison for ${esc(analogo.name)}: ${esc(fuenteTxt(f, 'SRTMGL30'))} does not cover the Earth south of 60°S, so every pixel of its window is “no data”.</p>`;
    return;
  }

  const { lado, planeta: pl, tierra: tr, perfil } = cmp, r = tr.r, semi = lado / 2, cuerpo = NOMBRE[body];
  const exa = ex > 0 ? ex : 1;

  // ---- escala de color común: elevación relativa al centro de cada cuadrado ----
  let lo = Infinity, hi = -Infinity;
  for (const z of pl.vista.v) if (z === z) { lo = Math.min(lo, z - pl.z0); hi = Math.max(hi, z - pl.z0); }
  for (const z of r.v) if (z === z) { lo = Math.min(lo, z - tr.z0); hi = Math.max(hi, z - tr.z0); }
  const tramo = hi - lo, hay = tramo === tramo && tramo >= 0;
  const posDe = (z0) => (z) => (tramo > 0 ? (z - z0 - lo) / tramo : 0.5);

  // ---- SVG superpuesto de cada mapa (viewBox 0 0 100 100) ----
  const redondas = marcas(0, semi, 4).filter((v) => v > 0);
  const barraKm = redondas.reduce((a, b) => (Math.abs(b - lado / 4) < Math.abs(a - lado / 4) ? b : a), redondas[0] ?? lado / 4);
  const lb = r2((barraKm / lado) * 100);
  const capaSvg = `<svg class="g-en-svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    ${conBorde(`<path class="g-tr-traza" d="M2 50H98"/><path d="M50 48.7V51.3M48.7 50H51.3"/>
      <path d="M4 94.2V95.5H${r2(4 + lb)}V94.2"/><path d="M94 14.6V7.4M91.9 10.1L94 7.2L96.1 10.1"/>`)}
    <text x="4" y="92.9">${esc(nf(barraKm, decimalesDe([barraKm])))} km</text>
    <text x="94" y="5.6" text-anchor="middle">N</text><text x="3" y="47.6">W</text><text x="97" y="47.6" text-anchor="end">E</text>
    <g class="g-en-cruz" display="none">${conBorde('<path d="M-4.6 0H-1.6M1.6 0H4.6M0 -4.6V-1.6M0 1.6V4.6"/>')}</g>
  </svg>`;
  const rotulo = (quien) => `${quien}: relief map of a ${nf(lado)} km square, north up, same scale and colors as the other map. `
    + 'The arrow keys move the reading point on both maps (Shift: five steps); Escape hides it. The numbers are in the table below.';
  const mapa = (cual, titulo, quien) => `<figure class="g-tr-mfig"><figcaption><b>${esc(titulo)}</b></figcaption>
    <div class="g-en-mapa g-tr-mapa" data-mapa="${cual}" tabindex="0" role="application" aria-label="${esc(rotulo(quien))}">
      <canvas class="g-en-cv" aria-hidden="true"></canvas>${capaSvg}</div></figure>`;
  const huecos = pl.vista.v.some((z) => z !== z) || r.v.some((z) => z !== z), hayAgua = !!tr.agua && tr.agua.frac > 0;
  const vista0 = estado.vistaCara ?? 'real';
  const control = `<div class="g-ctl"><span class="g-seg" role="group" aria-label="Map view">
    <button type="button" data-vista="real" aria-pressed="${vista0 === 'real'}">Realistic</button><button type="button" data-vista="elev" aria-pressed="${vista0 !== 'real'}">Height</button></span></div>`;
  const leyReal = `<div class="g-en-ley rl-ley" data-ley-real${vista0 === 'real' ? '' : ' hidden'}><div class="g-en-nota">
    <span>Real colors of each place, with its relief shaded</span></div></div>`;
  const ley = `${leyReal}<div class="g-en-ley" data-ley-elev${vista0 === 'real' ? ' hidden' : ''}>
    <i class="g-en-barra" style="background: linear-gradient(90deg, ${esc(RAMPAS.relieve.join(', '))})" aria-hidden="true"></i>
    <div class="g-en-ext">${hay ? `<span>${esc(conSigno(lo))}</span><span>0 = center</span><span>${esc(conSigno(hi))}</span>` : '<span>no data</span>'}</div>
    <div class="g-en-nota"><span>Height above or below the center (same colors for both maps)</span>
      ${hayAgua ? '<span><i class="g-tr-m-agua" aria-hidden="true"></i>water (Earth)</span>' : ''}
      ${huecos ? '<span><i class="g-en-hueco" aria-hidden="true"></i>no data</span>' : ''}</div></div>`;

  const titP = `${cuerpo} · ${sitio.name}`, titT = `Earth · ${analogo.name}`;
  const pieMapas = `<b>${esc(cuerpo)}:</b> ${esc(fuenteDe(pl.capa))} (${esc(pl.capa.meta.nombre)}).
    <b>Earth:</b> ${esc(fuenteTxt(tr.fuente.relieve, 'SRTM'))}${tr.agua ? `; water: ${esc(fuenteTxt(tr.fuente.agua, 'SRTM water mask'))}` : ''} (precomputed window, ${esc(nf(r.km, 2))} km per pixel).
    Water: mask value 1, or no mask and exactly 0 m (the similarity engine’s rule for open sea and north of 60°N).
    ${analogo.lat > 60 ? 'North of 60°N this product’s elevation comes from GTOPO30, not from the SRTM radar (product documentation). ' : ''}${tr.meta.nota ? `Note from the data file: ${esc(tr.meta.nota)} ` : ''}
    Both squares: azimuthal equidistant projection centered on the site, north up, ${esc(nf(lado))} km per side, one color scale from ${esc(conSigno(lo))} to ${esc(conSigno(hi))} relative to each center.
    The shading (light from the northwest, vertical exaggeration ×${esc(exa >= 1 ? nf(Math.round(exa)) : nf(exa, 1))} for both, derived from the slopes ${esc(body === 'moon' ? 'of the Moon' : 'of Mars')}; the Earth map uses that same factor so both reliefs are lit and exaggerated alike) only helps to read the relief; it is not data.
    The ${esc(cuerpo)} image interpolates between cells; the cursor gives the published cell. The horizontal line is the west–east profile below.
    <span data-pie-real></span>`;

  // ---- perfil oeste–este ----
  const W = 640, H = 230, ml = 54, mr = 112, mt = 14, mb = 34;
  const vals = [...perfil.p, ...perfil.t].filter((v) => v === v);
  const yMin = vals.length ? Math.min(0, ...vals) : -1, yMax = vals.length ? Math.max(0, ...vals) : 1;
  const ms = marcas(yMin, yMax, 5), dY = [Math.min(yMin, ms[0]), Math.max(yMax, ms.at(-1))];
  const X = lineal(-semi, semi, ml, W - mr), Y = lineal(dY[0], dY[1], H - mb, mt);
  const ruta = (ys) => { let d = '', pen = false; ys.forEach((v, i) => { if (v !== v) { pen = false; return; } d += `${pen ? 'L' : 'M'}${r2(X(perfil.x[i]))} ${r2(Y(v))}`; pen = true; }); return d; };
  const xs = marcas(-semi, semi, 6), decY = decimalesDe(ms);
  const ultimo = (ys) => { for (let i = ys.length - 1; i >= 0; i--) if (ys[i] === ys[i]) return i; return -1; };
  const iP = ultimo(perfil.p), iT = ultimo(perfil.t);
  let yP = iP >= 0 ? Y(perfil.p[iP]) : null, yT = iT >= 0 ? Y(perfil.t[iT]) : null;
  if (yP != null && yT != null && Math.abs(yP - yT) < 13) { const c = (yP + yT) / 2, s = yP <= yT ? -1 : 1; yP = c + s * 6.5; yT = c - s * 6.5; }
  const agua = perfil.agua.map((a, i) => (a ? `<rect class="g-tr-agua" x="${r2(X(perfil.x[i]) - (X(perfil.x[1]) - X(perfil.x[0])) / 2)}" y="${H - mb - 5}" width="${r2(X(perfil.x[1]) - X(perfil.x[0]))}" height="5"/>` : '')).join('');
  const svgPerfil = `<svg class="g-svg g-tr-psvg" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">
    ${ms.map((v) => `<line class="${v === 0 ? 'g-ref' : 'g-rej'}" x1="${ml}" x2="${W - mr}" y1="${r2(Y(v))}" y2="${r2(Y(v))}"/><text x="${ml - 6}" y="${r2(Y(v)) + 3}" text-anchor="end">${esc(v > 0 ? '+' : '')}${esc(nf(v, decY))}</text>`).join('')}
    ${xs.map((v) => `<line class="g-eje" x1="${r2(X(v))}" x2="${r2(X(v))}" y1="${H - mb}" y2="${H - mb + 4}"/><text x="${r2(X(v))}" y="${H - mb + 15}" text-anchor="middle">${esc(nf(Math.abs(v)))}${v ? (v < 0 ? ' W' : ' E') : ''}</text>`).join('')}
    <line class="g-eje" x1="${ml}" x2="${W - mr}" y1="${H - mb}" y2="${H - mb}"/>
    <text x="${ml}" y="${mt - 4}">m relative to the center</text>
    <text x="${(ml + W - mr) / 2}" y="${H - 4}" text-anchor="middle">km from the center (west ← → east)</text>
    ${agua}
    <path class="g-tr-le" d="${ruta(perfil.t)}"/><path class="g-tr-lp" d="${ruta(perfil.p)}"/>
    ${yT != null ? `<text class="g-txt" x="${W - mr + 6}" y="${r2(yT) + 3}">Earth · analog</text>` : ''}
    ${yP != null ? `<text class="g-val" x="${W - mr + 6}" y="${r2(yP) + 3}">${esc(cuerpo)} · site</text>` : ''}
    <g class="g-tr-cursor" display="none"><line class="g-tr-regla" y1="${mt}" y2="${H - mb}"/><circle class="g-tr-pp" r="3.5"/><circle class="g-tr-pt" r="3.5"/></g>
    <rect class="g-hit" x="${ml}" y="${mt}" width="${W - ml - mr}" height="${H - mt - mb}"/>
  </svg>`;
  const tablaPerfil = tabla({
    titulo: `West–east profile through the center (${nf(lado)} km): elevation relative to the center, every 4th sample`,
    cabeceras: ['km from the center (− = west)', `${cuerpo} site`, 'Earth analog', 'Water (Earth)'],
    filas: perfil.x.map((x, i) => [i, x]).filter(([i]) => i % 4 === 0).map(([i, x]) => [nf(x, 1), conSigno(perfil.p[i]), conSigno(perfil.t[i]), perfil.agua[i] ? 'yes' : '—']),
    abierta: !!estado.tablaPerfil,
  });
  const piePerfil = `West–east line through the center of each square, ${nf(perfil.x.length)} points at the same distances for both.
    <b>${esc(cuerpo)}:</b> great circle eastward from the site, interpolated between ${esc(pl.capa.meta.fuente?.mision ?? '')} cells, minus the cell at the site (${esc(m(pl.z0))}).
    <b>Earth:</b> mean of the two central rows of the SRTM window, minus the center (${esc(m(tr.z0))}).${tr.agua ? ' Blue ticks on the axis: water pixels along the Earth line.' : ''}
    Vertical references differ between bodies, so only heights relative to each center are compared.`;

  // ---- tabla de cifras (visible) ----
  const a = pl.cifras, b = tr.cifras, km = nf(pl.kmNs, 1);
  const filas = [
    ['Elevation at the center', `${m(a.centro)}`, `${m(b.centro)}`],
    ['Lowest point, relative to the center', conSigno(a.bajo), conSigno(b.bajo)],
    ['Highest point, relative to the center', conSigno(a.alto), conSigno(b.alto)],
    ['Relief range (highest − lowest)', m(a.rango), m(b.rango)],
    ['Standard deviation of elevation', m(a.sd), m(b.sd)],
    [`Mean slope (${km} km pixels)`, grados(a.pendMedia), grados(b.pendMedia)],
    ['90th percentile of slope', grados(a.pendP90), grados(b.pendP90)],
    ['Water in the square', '—', tr.agua ? `${nf(100 * tr.agua.frac, 1)} %` : 'no mask'],
    ['Pixels with data', `${nf(a.validos)} of ${nf(a.total)}`, `${nf(b.validos)} of ${nf(b.total)}`],
  ];
  const tablaCifras = `<div class="tabla-scroll" tabindex="0" role="region" aria-label="Relief figures of both squares"><table class="tabla g-tr-tab">
    <caption>Relief of both ${esc(nf(lado))} km squares, computed the same way</caption>
    <thead><tr><th scope="col">Figure</th><th scope="col">${esc(cuerpo)} · ${esc(sitio.name)}</th><th scope="col">Earth · ${esc(analogo.name)}</th></tr></thead>
    <tbody>${filas.map(([k, x, y]) => `<tr><th scope="row">${esc(k)}</th><td class="num">${esc(x)}</td><td class="num">${esc(y)}</td></tr>`).join('')}</tbody></table></div>`;
  // Lo visible: tres cifras en llano (las mismas de la tabla completa, que va en «Learn more»)
  const llanas = [['Height difference (highest − lowest)', m(a.rango), m(b.rango)], ['Average steepness', grados(a.pendMedia), grados(b.pendMedia)],
    ...(tr.agua ? [['Water in the square', '—', `${nf(100 * tr.agua.frac, 1)} %`]] : [])];
  const tablaLlana = `<div class="tabla-scroll" tabindex="0" role="region" aria-label="Key relief figures of both squares"><table class="tabla g-tr-tab">
    <thead><tr><th scope="col"></th><th scope="col">${esc(cuerpo)} · ${esc(sitio.name)}</th><th scope="col">Earth · ${esc(analogo.name)}</th></tr></thead>
    <tbody>${llanas.map(([k, x, y]) => `<tr><th scope="row">${esc(k)}</th><td class="num">${esc(x)}</td><td class="num">${esc(y)}</td></tr>`).join('')}</tbody></table></div>`;
  const pieCifras = `Both squares resampled to the same ${esc(nf(pl.ns))} × ${esc(nf(pl.ns))} grid (${esc(km)} km per pixel, about one ${esc(pl.capa.meta.fuente?.mision ?? '')} cell):
    ${esc(cuerpo)} by bilinear interpolation between cell centers, Earth by averaging the SRTM pixels of each block. Slope = angle of the elevation gradient between neighboring pixels (central differences), same formula for both.
    Elevation at the center uses each body’s own vertical reference (${esc(pl.capa.meta.nombre)}; Earth: ${esc(refVertical(tr.fuente.relieve))}, ${esc(fuenteTxt(tr.fuente.relieve, 'SRTM'))}).${tr.agua ? ' Water: share of the pixels with elevation that are water (mask = 1, or no mask and 0 m).' : ''}`;

  const cuerpoMapas = `${control}<div class="g-tr-mapas">${mapa('p', titP, `${cuerpo} site ${sitio.name}`)}${mapa('t', titT, `Earth analog ${analogo.name}`)}</div>${ley}
        <p class="g-en-vivo" role="status" aria-live="polite"></p>`;
  // Modo compacto (historia principal del panel): los mapas y una frase; el perfil, las cifras y las fuentes, en «Learn more»
  const figMapas = ctx.compacto
    ? `<div class="g-fig g-tr-cara">${cuerpoMapas}
        <p class="tr-por tr-frase">${esc(`Both places as ${nf(lado)} km squares, north up, drawn the same way.`)}</p></div>`
    : figura({ titulo: `Two squares of ${nf(lado)} × ${nf(lado)} km, same size, north up`, sub: `Left: the ${cuerpo} site. Right: the Earth place. Both drawn at the same size.`,
      cuerpo: cuerpoMapas, pie: pieMapas, clase: 'g-tr-cara' });
  const detalle = `
    ${figura({ titulo: 'Side view: the ups and downs from west to east', sub: 'Both lines are drawn on the same scale.',
      cuerpo: `<div class="g-ley"><span><i class="g-tr-m-lp" aria-hidden="true"></i>${esc(cuerpo)} · ${esc(sitio.name)}</span><span><i class="g-tr-m-le" aria-hidden="true"></i>Earth · ${esc(analogo.name)}</span>${tr.agua && perfil.agua.some(Boolean) ? '<span><i class="g-tr-m-agua" aria-hidden="true"></i>water (Earth)</span>' : ''}</div>
        <div class="g-tr-perfil" tabindex="0" role="application" aria-label="${esc(`West–east profile of both terrains. Left and right arrows move along the line and read both heights; Shift moves five steps. The values are also in the table.`)}">${svgPerfil}</div>`,
      pie: piePerfil, tablaHtml: tablaPerfil, clase: 'g-tr-pfig' })}
    ${figura({ titulo: 'The relief in numbers', sub: 'Both squares measured the same way.', cuerpo: tablaLlana, mas: tablaCifras, pie: pieCifras, clase: 'g-tr-cifras' })}`;
  el.innerHTML = ctx.compacto
    ? `${figMapas}${masInfo(`<p class="g-pie">${pieMapas}</p>${detalle}`, '', 'tr-cara-mas')}`
    : `${figMapas}${detalle}`;

  // ---- pintado de los mapas: vista realista (por defecto) o elevación relativa; las dos suaves, sin pixelado ----
  const cvP = el.querySelector('[data-mapa="p"] canvas'), cvT = el.querySelector('[data-mapa="t"] canvas');
  const elevT = { n: r.n, km: r.km, v: r.v };
  // vista de datos: una celda por píxel en un lienzo aparte, ampliado con interpolación suave al visible
  const pintarDatos = () => {
    const oP = document.createElement('canvas'), oT = document.createElement('canvas');
    pintarRelieve(oP, { elev: pl.vista, pos: posDe(pl.z0), exageracion: exa, suelo: 20 });
    pintarRelieve(oT, { elev: elevT, pos: posDe(tr.z0), exageracion: exa, suelo: 20 });
    if (r.agua) {                                               // agua del análogo: azul con rayas finas
      const c = oT.getContext('2d'), img = c.getImageData(0, 0, r.n, r.n), px = img.data;
      for (let o = 0; o < r.n * r.n; o++) {
        if (r.agua[o] !== 1) continue;
        const raya = ((o % r.n) - Math.floor(o / r.n) + 6000) % 7 < 2 ? 34 : 0, k = 4 * o;
        px[k] = AGUA[0] + raya; px[k + 1] = AGUA[1] + raya; px[k + 2] = AGUA[2] + raya; px[k + 3] = 255;
      }
      c.putImageData(img, 0, 0);
    }
    ampliarSuave(cvP, oP); ampliarSuave(cvT, oT);
  };
  const leyE = el.querySelector('[data-ley-elev]'), leyR = el.querySelector('[data-ley-real]'), pieR = el.querySelector('[data-pie-real]');
  const botones = [...el.querySelectorAll('[data-vista]')];
  let turno = 0, pieHecho = false;
  const verVista = async (vista) => {
    const t = ++turno;
    estado.vistaCara = vista;
    botones.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.vista === vista)));
    leyE.hidden = vista === 'real'; leyR.hidden = vista !== 'real';
    if (vista !== 'real') { pintarDatos(); return; }
    try {
      const [a, b] = await Promise.all([
        realistaAparte(cvP, { body, lat: sitio.lat, lon: sitio.lon, Rkm: pl.Rkm, ladoKm: lado, elev: pl.vista, exageracion: exa }),
        realistaAparte(cvT, { body: 'earth', lat: tr.meta.lat ?? analogo.lat, lon: tr.meta.lon ?? analogo.lon, Rkm: R_TIERRA_KM, ladoKm: lado, elev: elevT, exageracion: exa })]);
      if (t !== turno || !el.isConnected) return;
      copiar(cvP, a.aparte); copiar(cvT, b.aparte);
      console.debug(`[cara a cara] vista realista: ${a.info.ms.toFixed(0)} ms + ${b.info.ms.toFixed(0)} ms`);
      if (!pieHecho) {
        pieHecho = true;
        pieR.innerHTML = `${pieMosaico(a.info, pl.capa.meta.dlat ? Math.abs(pl.capa.meta.dlat) * DEG * pl.Rkm : lado / pl.vista.n, esc(cuerpo))}
          ${pieMosaico(b.info, r.km, 'Earth')} In this view the sea is the mosaic’s own ocean color. The colors are not measured relief data;
          the cursor still reads the relief cells.`;
      }
    } catch (e) {
      console.warn('Vista realista no disponible', e);
      if (t !== turno) return;
      pieR.textContent = 'The color mosaic could not be loaded, so the relief view is shown.';
      botones.find((x) => x.dataset.vista === 'real')?.setAttribute('disabled', '');
      verVista('elev');
    }
  };
  botones.forEach((b) => b.addEventListener('click', () => verVista(b.dataset.vista)));
  verVista(vista0);

  // ---- lectura de un punto, la misma en los dos mapas ----
  const cajas = [...el.querySelectorAll('.g-tr-mapa')], cruces = cajas.map((c) => c.querySelector('.g-en-cruz')), vivo = el.querySelector('.g-en-vivo');
  const curP = el.querySelector('.g-tr-cursor');
  const leer = (x, y) => {
    const [la, lo2] = puntoVentana(pl.vista, x, y), zp = pl.capa.en(la, lo2), t = enRecorte(r, x, y);
    return {
      titulo: donde(x, y),
      filas: [[`${cuerpo} site`, zp === zp ? conSigno(zp - pl.z0) : 'no data'],
        ['Earth analog', t.agua ? `water (${conSigno(t.z - tr.z0)})` : t.z === t.z ? conSigno(t.z - tr.z0) : 'no data']],
      nota: `${cuerpo}: published cell at ${coord(la, lo2)}. Earth: SRTM window pixel. Heights relative to each center.`,
    };
  };
  let punto = { x: 0, y: 0 }, visible = false;
  const marcar = (x, y) => cruces.forEach((c) => { c.setAttribute('transform', `translate(${r2((x / lado + 0.5) * 100)} ${r2((0.5 - y / lado) * 100)})`); c.removeAttribute('display'); });
  const mostrar = (x, y, cx, cy, anunciar) => {
    const l = leer(x, y);
    punto = { x, y }; visible = true; marcar(x, y);
    tip(tipHtml(l.titulo, l.filas, l.nota), cx, cy);
    if (anunciar) vivo.textContent = `${l.titulo}. ${l.filas.map(([k, v]) => `${k}: ${v}`).join('. ')}.`;
  };
  const ocultar = () => { visible = false; cruces.forEach((c) => c.setAttribute('display', 'none')); curP?.setAttribute('display', 'none'); tip(null); };
  const dentro = (v) => Math.min(semi, Math.max(-semi, v));
  for (const caja of cajas) {
    const alPuntero = (e) => {
      const b = caja.getBoundingClientRect();
      if (!b.width) return;
      const fx = Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), fy = Math.min(1, Math.max(0, (e.clientY - b.top) / b.height));
      mostrar((fx - 0.5) * lado, (0.5 - fy) * lado, e.clientX, e.clientY, false);
    };
    caja.addEventListener('pointermove', alPuntero);
    caja.addEventListener('pointerdown', alPuntero);
    caja.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') { ocultar(); punto = { x: 0, y: 0 }; } });
    caja.addEventListener('pointercancel', ocultar);
    const alTeclado = (x, y) => { const b = caja.getBoundingClientRect(); mostrar(x, y, b.left + (x / lado + 0.5) * b.width, b.top + (0.5 - y / lado) * b.height, true); };
    caja.addEventListener('focus', () => alTeclado(punto.x, punto.y));
    caja.addEventListener('blur', ocultar);
    caja.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { if (visible) { ocultar(); e.stopPropagation(); } return; }
      const d = FLECHAS[e.key];
      if (!d || e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault(); e.stopPropagation();
      const paso = pl.kmNs * (e.shiftKey ? 5 : 1);
      alTeclado(dentro(punto.x + d[0] * paso), dentro(punto.y + d[1] * paso));
    });
  }

  // ---- lectura del perfil (cursor, dedo y flechas) ----
  const cajaP = el.querySelector('.g-tr-perfil'), svg = cajaP.querySelector('svg');
  const regla = curP.querySelector('.g-tr-regla'), pp = curP.querySelector('.g-tr-pp'), pt = curP.querySelector('.g-tr-pt');
  let iSel = Math.floor(perfil.x.length / 2);
  const verI = (i, cx, cy, anunciar) => {
    iSel = Math.max(0, Math.min(perfil.x.length - 1, i));
    const x = perfil.x[iSel], vp = perfil.p[iSel], vt = perfil.t[iSel], sx = r2(X(x));
    curP.removeAttribute('display');
    regla.setAttribute('x1', sx); regla.setAttribute('x2', sx);
    pp.setAttribute('cx', sx); pp.setAttribute('cy', vp === vp ? r2(Y(vp)) : -99);
    pt.setAttribute('cx', sx); pt.setAttribute('cy', vt === vt ? r2(Y(vt)) : -99);
    marcar(x, 0);
    const titulo = donde(x, 0), filas = [[`${cuerpo} site`, conSigno(vp)], ['Earth analog', `${conSigno(vt)}${perfil.agua[iSel] ? ' · water' : ''}`]];
    if (cx == null) { const b = svg.getBoundingClientRect(); cx = b.left + (sx / W) * b.width; cy = b.top + (Y(Math.max(vp === vp ? vp : 0, vt === vt ? vt : 0)) / H) * b.height; }
    tip(tipHtml(titulo, filas, 'Height relative to each center'), cx, cy);
    if (anunciar) vivo.textContent = `${titulo}. ${filas.map(([k, v]) => `${k}: ${v}`).join('. ')}.`;
  };
  const alPunteroP = (e) => {
    const b = svg.getBoundingClientRect();
    if (!b.width) return;
    const sx = ((e.clientX - b.left) / b.width) * W;
    if (sx < ml - 4 || sx > W - mr + 4) { ocultar(); return; }
    const x = X.inv(sx), paso = perfil.x[1] - perfil.x[0];
    verI(Math.round((x - perfil.x[0]) / paso), e.clientX, e.clientY, false);
  };
  cajaP.addEventListener('pointermove', alPunteroP);
  cajaP.addEventListener('pointerdown', alPunteroP);
  cajaP.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') ocultar(); });
  cajaP.addEventListener('focus', () => verI(iSel, null, null, true));
  cajaP.addEventListener('blur', ocultar);
  cajaP.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (!curP.hasAttribute('display')) { ocultar(); e.stopPropagation(); } return; }
    const k = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1 }[e.key];
    if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); verI(e.key === 'Home' ? 0 : perfil.x.length - 1, null, null, true); return; }
    if (!k || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault(); e.stopPropagation();
    verI(iSel + k * (e.shiftKey ? 5 : 1), null, null, true);
  });
  el.querySelector('.g-tr-pfig details.g-tabla')?.addEventListener('toggle', (e) => { estado.tablaPerfil = e.currentTarget.open; });
}
