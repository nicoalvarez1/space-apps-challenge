// ============================================================================
//  ANÁLOGOS TERRESTRES DEL MOTOR DE SIMILITUD  (panel «Earth analogs», #training)
//
//  Convierte la respuesta del motor (base-planetaria/similitud: POST /api/similitud/analogos y /comparar, o los mismos
//  JSON precalculados) en lo que ve la persona: la lista de candidatos dicha en llano, la cabecera del lugar elegido,
//  los mapas de relieve lado a lado, «How close, criterion by criterion», las distribuciones y «Where the analogy
//  holds / where it breaks». Sigue las normas de js/graficos/base.js (colores, tooltip, tabla plegada).
//
//  De dónde sale cada número (nada se escribe a mano):
//    · Percentil de un criterio → analogo.criterios[c].percentil_catalogo: fracción de las ventanas terrestres del
//      catálogo cuya distancia al objetivo es ≤ la de este candidato (similarity_engine.percentiles).
//    · Clase («indistinguishable», «very close»…) → criterios[c].clase, que fija el motor (_clase): distancia ≤ la del
//      objetivo consigo mismo desplazado ±L/4, o percentil ≤ 5 % / ≤ 25 %.
//    · «Closer than X % … on every criterion» → X = 100·(1 − peor_percentil), redondeado hacia abajo a 0,1.
//    · Distribuciones → descriptores.estadisticos (p02, p25, mediana, p75, p98) del objetivo y del candidato.
//    · Mapas → visual.mapas de la comparación detallada (comparacion.py), pintados igual que en js/comparacion.js.
//    · Límites físicos (gravedad, atmósfera, radiación): hechos generales, sin cifras.
// ============================================================================
import { esc, nf, lineal, marcas, decimalesDe, conTip, tipHtml, tabla, figura, leyenda, tip, masInfo } from './base.js';
import { COL, percentil, pintarMapa, barraColor } from '../comparacion.js';
import { exageracionRelieve } from '../analitica.js';
import { realistaAparte, copiar, ampliarSuave, pieMosaico } from './realista.js';

// Nombres cortos de los criterios del motor (las claves son los identificadores del motor y no se traducen)
// `llano`: nombre corto para el público (lo visible); `corto`: nombre técnico (tablas y detalle tras «Learn more»)
export const CRIT = {
  elev_rel: { corto: 'Relative elevation', llano: 'Ups and downs', que: 'highs and lows around the window’s best-fit plane' },
  pendiente: { corto: 'Slope', llano: 'Steepness', que: 'how steep the ground is' },
  rugosidad: { corto: 'Roughness', llano: 'Bumpiness', que: 'small bumps left after removing the local slope' },
  curv_perfil: { corto: 'Profile curvature', llano: 'Slope bends', que: 'convex or concave along the slope' },
  curv_planta: { corto: 'Plan curvature', llano: 'Ridges, hollows', que: 'spurs versus hollows across the slope' },
  variograma: { corto: 'Scale structure', llano: 'Big vs small relief', que: 'how relief grows with distance (variogram)' },
  moran_pendiente: { corto: 'Slope clustering', llano: 'Steep spots grouped', que: 'whether steep cells group together (Moran’s I)' },
};
const llano = (id) => CRIT[id]?.llano ?? CRIT[id]?.corto ?? id;
export const CLASE = { indistinguible: 'indistinguishable', muy_proxima: 'very close', proxima: 'close', distinta: 'different' };
const ORDEN_CLASE = ['indistinguible', 'muy_proxima', 'proxima', 'distinta'];
const DIST_VARS = ['elev_rel', 'pendiente', 'rugosidad'];
const NOMBRE = { moon: 'the Moon', mars: 'Mars', earth: 'Earth' };
const CORTO = { moon: 'Moon', mars: 'Mars' };

export const ll = (lat, lon) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
const may = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const pctTxt = (p) => `${nf(100 * p, p < 0.01 ? 2 : 1)} %`;
// Distancia con 3 cifras significativas y su unidad («0.000580 1/km», «0.272°», «23.1 m»)
const distTxt = (v, u) => `${v == null ? '—' : Number(v.toPrecision(3)).toLocaleString('en-US', { maximumSignificantDigits: 3 })}${u === '°' ? '°' : ` ${u}`}`;

// --------------------------------------------------------------------------- en llano
// «Closer than 94.3 % of all places on Earth, on every measure» (X = 100·(1 − peor percentil), hacia abajo a 0,1)
const mejorQue = (p) => Math.floor((1 - p) * 1000) / 10;
export function cercania(a) {
  return `Closer than ${nf(mejorQue(a.peor_percentil), 1)} % of all places on Earth, on every measure`;
}
// Versión técnica (para «Learn more»): «Closer than 94.3 % of Earth’s 8,401 land windows on every criterion»
export const cercaniaTecnica = (a, nCat) => `Closer than ${nf(mejorQue(a.peor_percentil), 1)} % of Earth’s ${nf(nCat)} land windows on every criterion (worst percentile ${pctTxt(a.peor_percentil)})`;
// «Least alike on steepness»
export const peor = (a) => `Least alike on ${llano(a.criterio_peor).toLowerCase()}`;

function cuenta(a) {
  const n = Object.fromEntries(ORDEN_CLASE.map((c) => [c, 0]));
  for (const x of Object.values(a.criterios)) n[x.clase] = (n[x.clase] ?? 0) + 1;
  return n;
}

// «Its terrain is indistinguishable from Jezero crater on 5 of 7 measures, very close on 1, close on 1.»
// Con hKm, la versión técnica: «At the 3.7 km scale, its terrain is … on 5 of 7 relief criteria, …»
export function frase(a, sitio, hKm = null) {
  const n = cuenta(a), total = Object.keys(a.criterios).length, partes = [];
  for (const c of ORDEN_CLASE) {
    if (!n[c]) continue;
    partes.push(partes.length ? `${CLASE[c]} on ${n[c]}`
      : `${CLASE[c]} ${c === 'distinta' ? 'from' : c === 'indistinguible' ? 'from' : 'to'} ${sitio} on ${n[c]} of ${total} ${hKm == null ? 'measures' : 'relief criteria'}`);
  }
  return hKm == null ? `Its terrain is ${partes.join(', ')}.`
    : `At the ${nf(hKm, hKm < 1 ? 2 : hKm < 10 ? 1 : 0)} km scale, its terrain is ${partes.join(', ')}.`;
}
// Lectura llana de un criterio (reformula percentil_catalogo y la clase del motor; sin cifras nuevas)
export function lecturaLlana(c, sitio) {
  if (c.clase === 'indistinguible') return `no more different than two nearby parts of ${sitio}`;
  if (c.clase === 'distinta') return `${pctTxt(c.percentil_catalogo)} of places on Earth match as well or better`;
  return `closer than ${nf(mejorQue(c.percentil_catalogo), 1)} % of places on Earth`;
}

// --------------------------------------------------------------------------- lista de candidatos
export function listaCandidatos(r, sel) {
  const nCat = r.datos.catalogo.ventanas_validas;
  return `<ol class="an-lista" aria-label="Earth analogs, best first">${r.analogos.map((a, i) => `
    <li><button type="button" class="an-cand${i === sel ? ' sel' : ''}" data-cand="${i}" aria-pressed="${i === sel}" title="${esc(peor(a))}">
      <span class="an-rk" aria-hidden="true">${a.rango}</span>
      <span class="an-txt"><b>${ll(a.lat, a.lon)}</b><small>${esc(cercania(a, nCat))}</small></span>
    </button></li>`).join('')}</ol>`;
}

// --------------------------------------------------------------------------- (b) mapas lado a lado
export function mapasHtml() {
  return `<div class="an-mapas" data-an-mapas><p class="g-cargando" role="status">Drawing the relief of both windows…</p></div>`;
}

// Radio (km) de la proyección de cada ventana del motor: el de su producto (preprocessing.extraer_ventana →
// radio_local_m: esfera del producto, o radio de Gauss del elipsoide WGS84 en la latitud del centro)
const RADIO_DEF = { moon: 1737.4, mars: 3396, earth: 6371.0088 };
function radioVentana(lado, lat) {
  const s = lado.datos?.superficie_horizontal ?? '';
  let m = s.match(/sphere R = ([\d.]+) km/);
  if (m) return +m[1];
  m = s.match(/a = ([\d.]+) m, 1\/f = ([\d.]+)/);
  if (m) { const a = +m[1] / 1000, f = 1 / +m[2], e2 = f * (2 - f), sn = Math.sin((lat * Math.PI) / 180); return (a * Math.sqrt(1 - e2)) / (1 - e2 * sn * sn); }
  return RADIO_DEF[lado.cuerpo] ?? 6371.0088;
}
// Rejilla del motor (filas de arriba abajo, null = sin dato) → { n, v: Float32Array con NaN }
const plana = (g) => {
  const n = g.length, v = new Float32Array(n * n);
  g.forEach((f, i) => f.forEach((z, j) => { v[i * n + j] = z == null ? NaN : z; }));
  return { n, v };
};

// comp: respuesta de /api/similitud/comparar. ctx: { sitio, rango, body, alAbrir }
// Vistas: «Realistic» (por defecto: color de la imagen real del globo + sombreado del relieve, js/graficos/realista.js)
// y los dos campos del motor (elevación relativa, pendiente), ampliados con interpolación suave.
export function pintarMapas(el, comp, ctx) {
  const V = comp.visual;
  if (!V) { el.innerHTML = '<p class="g-vacio">No common scale with enough data to draw the maps.</p>'; return; }
  let modo = 'real', turno = 0, pieHecho = false;
  const UNI = { elev_rel: 'm', pendiente: '°' }, NOM = { real: 'Realistic', elev_rel: 'Ups and downs', pendiente: 'Steepness' };
  const cuerpoId = comp.objetivo.cuerpo, nomCuerpo = CORTO[cuerpoId] ?? '';
  const cuerpo = `
    <div class="g-ctl"><span class="g-seg" role="group" aria-label="Map view">
      <button type="button" data-m="real" aria-pressed="true">Realistic</button><button type="button" data-m="elev_rel" aria-pressed="false">Ups and downs</button><button type="button" data-m="pendiente" aria-pressed="false">Steepness</button></span></div>
    <div class="cmp-mapas">
      <figure><canvas data-lado="objetivo" role="img" aria-label="Relief map of the target window"></canvas>
        <figcaption><i style="background:${COL.obj}"></i>${esc(ctx.sitio)} · ${nomCuerpo}</figcaption></figure>
      <figure><canvas data-lado="candidato" role="img" aria-label="Relief map of the Earth window"></canvas>
        <figcaption><i style="background:${COL.tie}"></i>Earth match #${ctx.rango} · ${ll(comp.candidato.lat, comp.candidato.lon)}</figcaption></figure>
    </div>
    <div data-barra></div>`;
  const pie = `Same color scale and same physical size: ${nf(V.lado_km)} km per side, north up, ${nf(V.h_m / 1000, 2)} km per cell.
    <b>Ups and downs</b> (relative elevation) = height above or below the best-fit plane of each window, so regional tilt does not count. Shading is only a visual aid.
    Data: ${esc(comp.objetivo.datos.producto)} (${esc(NOMBRE[cuerpoId] ?? '')}) and ${esc(comp.candidato.datos.producto)} (Earth).
    <span data-pie-real></span>`;
  el.innerHTML = figura({ titulo: 'The two landscapes side by side', sub: 'Left: the target region. Right: the Earth place. Point at one to read the same spot on both.',
    cuerpo, pie }) + `<button type="button" class="btn ghost small-btn an-mas" data-an-abrir>Detailed comparison →</button>`;
  const cvO = el.querySelector('[data-lado="objetivo"]'), cvC = el.querySelector('[data-lado="candidato"]'), barra = el.querySelector('[data-barra]');
  const pieR = el.querySelector('[data-pie-real]');
  const etiqueta = (txt) => [cvO, cvC].forEach((cv) => cv.setAttribute('aria-label',
    `${NOM[modo]} map of the ${cv === cvO ? 'target' : 'Earth'} window, ${nf(V.lado_km)} km per side${txt}`));
  // vista de datos: una celda por píxel en un lienzo aparte (pintarMapa de js/comparacion.js), ampliado suave
  const datos = () => {
    const M = V.mapas[modo], lim = percentil([M.objetivo, M.candidato], 0.98);
    for (const [cv, lado] of [[cvO, 'objetivo'], [cvC, 'candidato']]) {
      const aparte = document.createElement('canvas');
      pintarMapa(aparte, M[lado], modo, lim, V.celda_mapa_m, V.mapas.elev_rel[lado]);
      ampliarSuave(cv, aparte);
    }
    barra.innerHTML = barraColor(modo, lim, UNI[modo]);
    etiqueta(`; color scale up to ${nf(lim, 1)} ${UNI[modo]}`);
  };
  const real = async () => {
    const t = turno;
    barra.innerHTML = '<p class="g-en-nota rl-nota">Real colors of each place, with its relief shaded.</p>';
    etiqueta(': real image colors shaded with the relief');
    try {
      const ex = await exageracionRelieve(ctx.body ?? cuerpoId).catch(() => 1), exa = ex > 0 ? ex : 1;
      const base = { ladoKm: V.lado_km, exageracion: exa };
      const [a, b] = await Promise.all([
        realistaAparte(cvO, { ...base, body: cuerpoId, lat: comp.objetivo.lat, lon: comp.objetivo.lon,
          Rkm: radioVentana(comp.objetivo, comp.objetivo.lat), elev: plana(V.mapas.elev_rel.objetivo) }),
        realistaAparte(cvC, { ...base, body: 'earth', lat: comp.candidato.lat, lon: comp.candidato.lon,
          Rkm: radioVentana(comp.candidato, comp.candidato.lat), elev: plana(V.mapas.elev_rel.candidato) })]);
      if (t !== turno || !el.isConnected) return;
      copiar(cvO, a.aparte); copiar(cvC, b.aparte);
      console.debug(`[análogo] vista realista: ${a.info.ms.toFixed(0)} ms + ${b.info.ms.toFixed(0)} ms`);
      if (!pieHecho) {
        pieHecho = true;
        const km = V.celda_mapa_m / 1000, x = exa >= 1 ? nf(Math.round(exa)) : nf(exa, 1);
        pieR.innerHTML = `${pieMosaico(a.info, km, esc(nomCuerpo))} ${pieMosaico(b.info, km, 'Earth')}
          The shading (light from the northwest, vertical exaggeration ×${esc(x)} on both maps, the factor derived from the slopes ${esc(NOMBRE[cuerpoId] ? `of ${NOMBRE[cuerpoId]}` : '')}; the Earth map uses the same factor so both are lit alike) only helps to read the relief.
          In the realistic view the sea is the mosaic’s own ocean color, and the cursor still reads the engine’s cells.`;
      }
    } catch (e) {
      console.warn('Vista realista no disponible', e);
      if (t !== turno) return;
      pieR.textContent = 'The color mosaic could not be loaded, so the relative elevation view is shown.';
      el.querySelector('[data-m="real"]')?.setAttribute('disabled', '');
      elegir('elev_rel');
    }
  };
  const elegir = (m) => {
    modo = m; turno++;
    el.querySelectorAll('[data-m]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.m === m)));
    if (m === 'real') real(); else datos();
  };
  elegir('real');
  el.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => elegir(b.dataset.m)));
  [cvO, cvC].forEach((cv) => {
    cv.onpointermove = (ev) => {
      // en la vista realista se leen las celdas de elevación relativa y de pendiente del motor
      const vars = modo === 'real' ? ['elev_rel', 'pendiente'] : [modo];
      const b = cv.getBoundingClientRect(), n = V.mapas[vars[0]].objetivo.length;
      const j = Math.min(n - 1, Math.max(0, Math.floor(((ev.clientX - b.left) / b.width) * n)));
      const i = Math.min(n - 1, Math.max(0, Math.floor(((ev.clientY - b.top) / b.height) * n)));
      const x = ((j + 0.5) / n - 0.5) * V.lado_km, y = (0.5 - (i + 0.5) / n) * V.lado_km;
      const v = (w, u) => (w == null ? 'no data' : `${nf(w, Math.abs(w) < 10 ? 1 : 0)} ${u}`);
      const filas = vars.flatMap((k) => {
        const g = V.mapas[k], pre = vars.length > 1 ? `${NOM[k]} · ` : '';
        return [[`${pre}${ctx.sitio}`, v(g.objetivo[i]?.[j], UNI[k])], [`${pre}Earth match #${ctx.rango}`, v(g.candidato[i]?.[j], UNI[k])]];
      });
      tip(tipHtml(`${nf(Math.abs(x), 0)} km ${x >= 0 ? 'E' : 'W'}, ${nf(Math.abs(y), 0)} km ${y >= 0 ? 'N' : 'S'} of the center`,
        filas, modo === 'real' ? 'Engine cells under the cursor' : NOM[modo]), ev.clientX, ev.clientY);
    };
    cv.onpointerleave = () => tip(null);
  });
  el.querySelector("[data-an-abrir]").onclick = ctx.alAbrir;
}

// --------------------------------------------------------------------------- (c) criterio a criterio
const LOG0 = -4;                                            // eje de 0,01 % (10⁻⁴) a 100 % (10⁰)
export function graficoCriterios(r, a, ctx) {
  const W = 360, FILA = 30, ARR = 16, IZQ = 122, DER = 78, ABJ = 34;
  const ids = r.criterios.map((c) => c.id), H = ARR + ids.length * FILA + ABJ;
  const x = lineal(LOG0, 0, IZQ, W - DER), lg = (p) => Math.log10(Math.max(10 ** LOG0, p));
  const ticks = [-4, -3, -2, -1, 0], txtTick = { '-4': '', '-3': '0.1 %', '-2': '1 %', '-1': '10 %', 0: '100 %' };
  const y = (i) => ARR + i * FILA + FILA / 2, abajo = ARR + ids.length * FILA;
  const zonas = `<rect class="an-zona an-z5" x="${x(LOG0)}" y="${ARR}" width="${x(lg(0.05)) - x(LOG0)}" height="${abajo - ARR}"/>
    <rect class="an-zona an-z25" x="${x(lg(0.05))}" y="${ARR}" width="${x(lg(0.25)) - x(lg(0.05))}" height="${abajo - ARR}"/>
    <text x="${x(lg(0.05)) - 2}" y="${ARR - 4}" text-anchor="end" class="an-zt">closest 5 %</text>
    <text x="${x(lg(0.25)) - 2}" y="${ARR - 4}" text-anchor="end" class="an-zt">25 %</text>`;
  const eje = ticks.map((t) => `<line class="g-rej" x1="${x(t)}" x2="${x(t)}" y1="${ARR}" y2="${abajo}"/>
    <text x="${x(t)}" y="${abajo + 13}" text-anchor="${t === 0 ? 'end' : t === LOG0 ? 'start' : 'middle'}">${txtTick[t]}</text>`).join('')
    + `<line class="g-eje" x1="${IZQ}" x2="${W - DER}" y1="${abajo}" y2="${abajo}"/>
    <text x="${W}" y="${abajo + 27}" text-anchor="end" class="g-txt">← more alike · share of places on Earth that match as well</text>`;
  const filas = ids.map((id, i) => {
    const c = a.criterios[id], px = x(lg(c.percentil_catalogo)), cls = c.clase;
    return `<g class="an-fila" data-crit="${id}" tabindex="0" role="listitem" aria-label="${esc(`${llano(id)}: ${CLASE[cls] ?? cls}, ${lecturaLlana(c, ctx.sitio)}`)}">
      <rect class="g-hit" x="0" y="${y(i) - FILA / 2}" width="${W}" height="${FILA}"/>
      <text x="0" y="${y(i) + 3.5}" class="g-txt">${esc(llano(id))}</text>
      <line class="an-guia" x1="${IZQ}" x2="${px}" y1="${y(i)}" y2="${y(i)}"/>
      <circle class="an-punto an-${cls}" cx="${px}" cy="${y(i)}" r="5"/>
      <text x="${W}" y="${y(i) + 3.5}" text-anchor="end" class="g-val an-cl-${cls}">${esc(CLASE[cls] ?? cls)}</text></g>`;
  }).join('');
  const svg = `<svg class="g-svg an-crit" viewBox="0 0 ${W} ${H}" role="list" aria-label="How alike the Earth place is to ${esc(ctx.sitio)} on each terrain measure">${zonas}${eje}${filas}</svg>`;
  const nCat = r.datos.catalogo.ventanas_validas, desp = r.parametros.desplazamiento_referencia_km;
  const sub = 'One row per terrain measure. A dot further left means fewer places on Earth match as well.';
  const masCrit = `<p class="g-pie">Each dot is the share of Earth’s ${nf(nCat)} land windows that match ${esc(ctx.sitio)} at least as well on that criterion: further left is closer.
    “Indistinguishable” means the difference is no larger than between ${esc(ctx.sitio)} and itself shifted ${nf(desp)} km. The horizontal axis is on a log scale.</p>
    <p class="g-pie">Measures, by their technical names: ${ids.map((id) => `${esc(llano(id))} = ${esc(CRIT[id]?.corto ?? id)} (${esc(CRIT[id]?.que ?? '')})`).join('; ')}.</p>`;
  const pie = `Distances: ${esc([...new Set(r.criterios.map((c) => c.metrica))].join(' · '))}, each in its own units; percentile = rank of the distance among all ${nf(nCat)} windows
    (${esc(r.datos.busqueda.producto)}, ${nf(r.parametros.lado_km)} km, ${nf(r.parametros.h_m / 1000, 2)} km cells). No weights and no similarity percentage.`;
  const tablaHtml = tabla({ titulo: `Criteria for Earth window #${a.rango}`, cabeceras: ['Criterion', 'Percentile', 'Class', 'Distance', 'Metric'],
    filas: ids.map((id) => { const c = a.criterios[id]; return [`${CRIT[id]?.corto ?? id} (${llano(id)})`, pctTxt(c.percentil_catalogo), CLASE[c.clase] ?? c.clase, distTxt(c.distancia, c.unidades), c.metrica]; }) });
  return figura({ titulo: 'How alike, point by point', sub, cuerpo: svg, mas: masCrit, pie, tablaHtml, clase: 'an-fig-crit' });
}

// Tooltip en llano; la distancia, la métrica y el percentil exactos están en la tabla de «Learn more»
export function tipCriterios(raiz, a, sitio = 'the target') {
  conTip(raiz, '.an-fila', (el) => {
    const id = el.dataset.crit, c = a.criterios[id];
    return c && tipHtml(llano(id), [['How alike', CLASE[c.clase] ?? c.clase], ['Places on Earth that match as well', pctTxt(c.percentil_catalogo)]],
      `${may(lecturaLlana(c, sitio))}. ${may((CRIT[id]?.que ?? '').replace(/\s*\([^)]*\)/, ''))}.`);
  });
}

// --------------------------------------------------------------------------- (d) distribuciones
export function graficoDistribuciones(r, a, ctx) {
  const eo = r.objetivo.descriptores.estadisticos, ec = a.descriptores.estadisticos, un = r.objetivo.descriptores.unidades;
  const W = 360, FILA = 18, IZQ = 104, DER = 8;
  const panel = (v) => {
    const o = eo[v], c = ec[v];
    const lo = Math.min(o.p02, c.p02), hi = Math.max(o.p98, c.p98), ms = marcas(lo, hi, 6), d = decimalesDe(ms);
    const x = lineal(Math.min(lo, ms[0]), Math.max(hi, ms.at(-1)), IZQ, W - DER), H = 2 * FILA + 30;
    const fila = (s, i, col, nom, quien) => {
      const yc = 6 + i * FILA + FILA / 2;
      return `<g class="an-dfila" data-var="${v}" data-quien="${quien}" tabindex="0">
        <rect class="g-hit" x="0" y="${yc - FILA / 2}" width="${W}" height="${FILA}"/>
        <text x="0" y="${yc + 3.5}" class="g-txt">${esc(nom)}</text>
        <line x1="${x(s.p02)}" x2="${x(s.p98)}" y1="${yc}" y2="${yc}" stroke="${col}" stroke-width="1.5"/>
        <rect x="${x(s.p25)}" y="${yc - 5}" width="${Math.max(1.5, x(s.p75) - x(s.p25))}" height="10" rx="2" fill="${col}"/>
        <line x1="${x(s.mediana)}" x2="${x(s.mediana)}" y1="${yc - 7}" y2="${yc + 7}" class="an-med"/></g>`;
    };
    const base = 6 + 2 * FILA;
    const eje = ms.map((t) => `<line class="g-rej" x1="${x(t)}" x2="${x(t)}" y1="4" y2="${base}"/><text x="${x(t)}" y="${base + 13}" text-anchor="middle">${nf(t, d)}</text>`).join('')
      + `<line class="g-eje" x1="${IZQ}" x2="${W - DER}" y1="${base}" y2="${base}"/>`;
    return `<div class="an-dpanel"><b class="an-dtit">${esc(llano(v))} <span class="muted">(${esc(un[v])})</span></b>
      <svg class="g-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(`${llano(v)} in ${un[v]}: typically ${nf(o.mediana, 2)} in ${ctx.sitio}, ${nf(c.mediana, 2)} in Earth match #${a.rango}`)}">
      ${eje}${fila(o, 0, COL.obj, ctx.sitioCorto, 'obj')}${fila(c, 1, COL.tie, `Earth #${a.rango}`, 'tie')}</svg></div>`;
  };
  const ley = `<div class="g-ley"><span><i style="background:${COL.obj}" aria-hidden="true"></i>${esc(ctx.sitio)} (${CORTO[r.objetivo.ventana.cuerpo]})</span>
    <span><i style="background:${COL.tie}" aria-hidden="true"></i>Earth match #${a.rango}</span></div>`;
  const sub = 'Bars that overlap mean similar terrain.';
  const masDist = '<p class="g-pie">Thick bar: the middle half of the cells (25th–75th percentile); thin line: 2nd–98th percentile; tick: median. Ups and downs = relative elevation; steepness = slope; bumpiness = roughness.</p>';
  const pie = `Computed by the engine over every valid ${nf(r.parametros.h_m / 1000, 2)} km cell of each ${nf(r.parametros.lado_km)} km window.
    Relative elevation = height above or below the window’s best-fit plane; roughness = RMS of the residuals of a local 3×3 plane.`;
  const filasT = DIST_VARS.flatMap((v) => [[`${CRIT[v].corto} · ${ctx.sitioCorto}`, eo[v]], [`${CRIT[v].corto} · Earth #${a.rango}`, ec[v]]].map(([n, s]) =>
    [n, ...['p02', 'p25', 'mediana', 'p75', 'p98', 'desv_tipica'].map((k) => `${nf(s[k], 2)} ${un[v]}`)]));
  const tablaHtml = tabla({ titulo: 'Distribution quantiles', cabeceras: ['Variable', 'P2', 'P25', 'Median', 'P75', 'P98', 'Std. dev.'], filas: filasT });
  return figura({ titulo: 'Height, steepness and bumpiness compared', sub, cuerpo: ley + DIST_VARS.map(panel).join(''), mas: masDist, pie, tablaHtml, clase: 'an-fig-dist' });
}

export function tipDistribuciones(raiz, r, a, ctx) {
  const un = r.objetivo.descriptores.unidades;
  conTip(raiz, '.an-dfila', (el) => {
    const v = el.dataset.var, s = el.dataset.quien === 'obj' ? r.objetivo.descriptores.estadisticos[v] : a.descriptores.estadisticos[v];
    const f = (k) => `${nf(s[k], 2)} ${un[v]}`, de = (k1, k2) => `${nf(s[k1], 2)} to ${nf(s[k2], 2)} ${un[v]}`;
    return tipHtml(`${llano(v)} · ${el.dataset.quien === 'obj' ? ctx.sitio : `Earth match #${a.rango}`}`,
      [['Typical value', f('mediana')], ['Middle half of the ground', de('p25', 'p75')], ['Almost all of it', de('p02', 'p98')]],
      `${nf(s.n)} map cells measured`);
  });
}

// --------------------------------------------------------------------------- (e) dónde se sostiene y dónde falla
const FISICA = {
  moon: [
    ['Gravity', 'Earth’s gravity is much stronger than the Moon’s: dust, loose soil, loads and people behave differently.'],
    ['Vacuum', 'The Moon has essentially no atmosphere: no wind, no weather, no air to carry heat. No place on Earth reproduces it.'],
    ['Radiation', 'Earth’s atmosphere and magnetic field shield its surface; the lunar surface receives cosmic and solar radiation that no Earth site reproduces.'],
  ],
  mars: [
    ['Gravity', 'Earth’s gravity is much stronger than Mars’s: dust, loose soil, loads and people behave differently.'],
    ['Thin atmosphere', 'Mars has a thin, mostly carbon-dioxide atmosphere; Earth’s denser air changes wind, dust, erosion and how heat moves.'],
    ['Radiation', 'Earth’s atmosphere and magnetic field shield its surface; much more cosmic and solar radiation reaches the Martian surface.'],
  ],
};

export function sostieneFalla(r, a, ctx) {
  const ids = r.criterios.map((c) => c.id);
  const si = ids.filter((id) => a.criterios[id].clase !== 'distinta'), no = ids.filter((id) => a.criterios[id].clase === 'distinta');
  const li = (id) => `<li><b>${esc(llano(id))}</b> — ${esc(lecturaLlana(a.criterios[id], ctx.sitio))}</li>`;
  // lectura técnica del motor, criterio a criterio (tras «Learn more»)
  const tec = (lista) => (lista.length ? `<ul class="small muted">${lista.map((id) => { const c = a.criterios[id];
    return `<li>${esc(CRIT[id]?.corto ?? id)}: ${esc(c.lectura)}${c.clase === 'distinta' ? ' (outside the closest 25 % of Earth windows)' : ''}</li>`; }).join('')}</ul>` : '');
  const fis = FISICA[r.objetivo.ventana.cuerpo] ?? [];
  return `<div class="an-sf">
    <section class="an-si"><h5>Where the analogy holds</h5>
      ${si.length ? `<ul>${si.map(li).join('')}</ul>` : '<p class="small muted">On no terrain measure is it closer than 75 % of places on Earth.</p>'}
      ${masInfo(`<p class="small muted">What matches is the shape of the land at the ${nf(r.parametros.h_m / 1000, 2)} km scale over ${nf(r.parametros.lado_km)} km: terrain of comparable form on which traverse planning, geological mapping and rover driving can be practised.</p>${tec(si)}`)}</section>
    <section class="an-no"><h5>Where it breaks</h5>
      <ul>${no.map(li).join('')}
        ${fis.map(([t, x]) => `<li><b>${esc(t)}</b> — ${esc(x)}</li>`).join('')}
      </ul>
      ${masInfo(`${tec(no)}<ul>${(r.limitaciones ?? []).slice(0, 2).map((x) => `<li>${esc(x.replace('scale is h:', `scale is h = ${nf(r.parametros.h_m / 1000, 2)} km:`))}</li>`).join('')}</ul>
      <p class="small muted an-nc">Not compared by the engine:</p>
      <ul class="an-nc-l">${(r.variables_no_comparadas ?? []).map((x) => `<li><b>${esc(may(x.variable))}</b>: ${esc(x.motivo)}.</li>`).join('')}</ul>`)}</section>
  </div>`;
}
