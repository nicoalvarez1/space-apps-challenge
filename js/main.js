import { BODIES, OBJECTIVES, DURATIONS, METRICS, TRAIT_LABELS, SITES, ANALOGS } from './data.js';
import { fetchSites, fetchTraining, estadoMotor, fetchAnalogosGeomorfologicos } from './api.js';
import { Viewer } from './scene.js';
import { earthSiteData } from './cmr.js';
import { abrirComparacion } from './comparacion.js';
import { CAPAS_GLOBO, RAMPAS, RADIO_KM, RADIO_ZONA, capa, pintarCapa, catalogo } from './capas.js';
import * as flujo from './proposito.js';   // pasos 2-4 (propósito, subapartado, criterios) y panel de criterios
// Gráficos de los resultados con las capas reales del PDS (js/analitica.js, js/graficos/). El panel de comparación y los
// gráficos de la ficha se cargan la primera vez que hacen falta (import dinámico).
import { medirTodo, exageracionRelieve, pendienteCeldas } from './analitica.js';
import { miniatura, RADIO_MINIATURA_KM } from './graficos/relieve.js';
import { chispa } from './graficos/chispa.js';
import { CUERPO, tip as tipGrafico } from './graficos/base.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Citas: los enlaces (DOI/URL) de una cita se vuelven clicables; el texto se escapa.
const enlazar = (t) => esc(t).replace(/(https?:\/\/[^\s<]+[^\s<.,;)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
const citas = (lista, titulo = 'Sources') => (lista.length
  ? `<details class="citas"><summary>${titulo} (${lista.length})</summary><ol>${lista.map((c) => `<li>${enlazar(c)}</li>`).join('')}</ol></details>` : '');
// Citas oficiales de las colecciones de NASA Earthdata (CollectionCitations y DOI de los metadatos UMM de CMR)
const CITAS_CMR = {
  hlsl30: 'Neigh, C. et al. (2021). HLS Operational Land Imager Surface Reflectance and TOA Brightness Daily Global 30m v2.0. NASA Land Processes DAAC. https://doi.org/10.5067/HLS/HLSL30.002',
  hlss30: 'Neigh, C. et al. (2021). HLS Sentinel-2 Multi-spectral Instrument Surface Reflectance Daily Global 30m v2.0. NASA Land Processes DAAC. https://doi.org/10.5067/HLS/HLSS30.002',
  astgtm: 'NASA/METI/AIST/Japan Spacesystems and U.S./Japan ASTER Science Team (2019). ASTER Global Digital Elevation Model V003. NASA Land Processes DAAC. https://doi.org/10.5067/ASTER/ASTGTM.003',
  mod11a1: 'Wan, Z., Hook, S. and Hulley, G. MODIS/Terra Land Surface Temperature/Emissivity Daily L3 Global 1km SIN Grid V061. NASA Land Processes DAAC. https://doi.org/10.5067/MODIS/MOD11A1.061',
  gibs: 'NASA Global Imagery Browse Services (GIBS), MODIS Terra Corrected Reflectance (True Color) layer. https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api',
};

const viewer = new Viewer($('#stage'), $('#markers'));

// Estado de carga de los modelos (texturas NASA de varios MB)
viewer.onProgress = (p) => {
  $('#load-bar').style.width = `${Math.round(p * 100)}%`;
  $('#load-text').textContent = `Loading NASA models… ${Math.round(p * 100)} %`;
};
viewer.worldsReady.then(() => {
  const nasa = viewer.manifest ? `NASA textures · ${viewer.quality === 'hi' ? '8K' : '4K'} quality` : 'procedural textures (run tools/build_textures.py)';
  $('#load-bar').style.width = '100%'; $('#load-text').textContent = `Earth, Moon and Mars ready · ${nasa}`;
  $('#load-status').classList.add('done');
  if (viewer.credits) {                                          // pie de página (pantallas anchas) y menú lateral (siempre)
    const creditos = `<b>Data and imagery:</b> ${Object.values(viewer.credits).map(esc).join(' · ')}`;
    $('#credits').innerHTML = creditos; $('#cajon-creditos').innerHTML = creditos;
  }
}).catch((e) => { console.error(e); $('#load-text').textContent = 'Some models could not be loaded'; });
const mission = { body: null, objective: null, crew: 6, duration: 'long' };
let step = 1, maxStep = 1, sites = [], current = null, runId = 0;
const ULTIMO = flujo.PASOS;   // 1 destino · 2 propósito (árbol) · 3 tripulación (el objetivo sale del propósito)

// ============================ ASISTENTE ====================================
function renderSetup() {
  // Las tarjetas se vuelven a pintar: se recuerda cuál tenía el foco del teclado para devolvérselo
  const foco = document.activeElement?.closest?.('#setup [data-body], #setup [data-obj], #setup [data-dur]');
  const focoSel = foco && ['body', 'obj', 'dur'].map((k) => foco.dataset[k] && `#setup [data-${k}="${foco.dataset[k]}"]`).find(Boolean);
  $('#g-body').innerHTML = Object.values(BODIES).map((b) => `
    <button class="opt dest ${mission.body === b.id ? 'sel' : ''}" data-body="${b.id}" aria-pressed="${mission.body === b.id}">
      <span class="planet ${b.id}" aria-hidden="true"></span>
      <span class="dest-txt"><b>${b.name}</b><small>${b.tagline}</small></span>
      <span class="dest-facts"><span><small>Gravity</small>${b.gravity}</span><span><small>Temperature</small>${b.temp}</span></span>
      <small class="dest-data">${CAPAS_GLOBO[b.id].length} data layers · ${b.layers.map((l) => l.split(' (')[0].split(' · ').pop()).join(', ')}</small>
    </button>`).join('');
  $('#g-obj').innerHTML = Object.values(OBJECTIVES).map((o) => `
    <button class="opt ${mission.objective === o.id ? 'sel' : ''}" data-obj="${o.id}" aria-pressed="${mission.objective === o.id}">
      <span class="ico">${o.icon}</span><b>${o.name}</b><small>${o.desc}</small>
      <span class="keys">${Object.entries(o.weights).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, w]) => `<i>${METRICS[k].short} ${Math.round(w * 100)}%</i>`).join('')}</span></button>`).join('');
  $('#g-dur').innerHTML = Object.values(DURATIONS).map((d) => `<button data-dur="${d.id}" class="${mission.duration === d.id ? 'sel' : ''}">${d.name}</button>`).join('');
  $('#crew-val').textContent = mission.crew;
  document.querySelectorAll('[data-step]').forEach((el) => (el.hidden = +el.dataset.step !== step));
  maxStep = Math.max(step, !mission.body ? 1 : !flujo.pasoOk(2) ? 2 : ULTIMO);
  $('#wizard').dataset.at = step;
  document.querySelectorAll('#steps button').forEach((el, i) => { el.classList.toggle('on', i < step); el.classList.toggle('cur', i + 1 === step); el.disabled = i + 1 > maxStep; });
  $('#btn-back').disabled = step === 1;
  const ok = step === 1 ? mission.body : flujo.pasoOk(step);
  $('#btn-next').disabled = !ok;
  $('#btn-next').textContent = step === ULTIMO ? '🚀 Launch simulation' : 'Next →';
  if (step === ULTIMO) {
    const b = BODIES[mission.body];
    $('#summary').innerHTML = `<b>${b.name}</b> · <b>${mission.crew}</b> people · <b>${DURATIONS[mission.duration].name}</b>`;
  }
  if (focoSel) $(focoSel)?.focus();
  flujo.render(step);
}

$('#setup').addEventListener('click', (e) => {
  const t = e.target.closest('[data-body],[data-obj],[data-dur]'); if (!t) return;
  if (t.dataset.body) { mission.body = t.dataset.body; if (viewer.mode === 'intro') { /* previsualización futura */ } }
  if (t.dataset.obj) mission.objective = t.dataset.obj;
  if (t.dataset.dur) mission.duration = t.dataset.dur;
  renderSetup();
});
$('#crew').addEventListener('input', (e) => { mission.crew = +e.target.value; renderSetup(); });
$('#btn-back').onclick = () => { step = Math.max(1, step - 1); renderSetup(); };
$('#btn-next').onclick = () => { if (step < ULTIMO) { step++; renderSetup(); } else launch(); };
$('#btn-new').onclick = resetMission;
// Nosotros: el reto y cómo lo resolvemos
const abrirNosotros = () => { $('#about').hidden = false; $('#about').scrollTop = 0; $('#about-close').focus(); };
$('#btn-about').onclick = abrirNosotros;
$('#btn-about-intro').onclick = abrirNosotros;
$('#about-close').onclick = () => { $('#about').hidden = true; };
$('#steps').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b && !b.disabled) { step = +b.dataset.go; renderSetup(); } });
addEventListener('keydown', (e) => { if (e.key === 'Enter' && !$('#setup').hidden && !$('#wizard').hidden && !$('#btn-next').disabled && !e.target.closest('button, a, summary, dialog, .about')) $('#btn-next').click(); });

// Cifras de la portada: salen del catálogo real de capas y de los datos de la app
function renderStats(capas) {
  const n = capas ? Object.keys(capas).length : null, inst = capas ? new Set(Object.values(capas).map((c) => c.fuente.mision)).size : null;
  const tiles = [[n ?? '—', 'real data layers'], [inst ?? '—', 'orbiting instruments'], [SITES.moon.length + SITES.mars.length, 'candidate sites'], [ANALOGS.length, 'analogs on Earth']];
  $('#stats').innerHTML = tiles.map(([v, l]) => `<div><b>${v}</b><small>${l}</small></div>`).join('');
}
renderStats(null);
catalogo().then(renderStats).catch((e) => console.warn('Catálogo de capas no disponible', e));
$('#btn-skip').onclick = () => { if (viewer.tween && viewer.mode === 'flight') viewer.tween.t0 = performance.now() - viewer.tween.dur; };

// ============================ SIMULACIÓN ===================================
const fmtKm = (km) => (km >= 1e6 ? (km / 1e6).toFixed(1) + ' M km' : Math.round(km).toLocaleString('en-US') + ' km');

// rapido: sin la animación del viaje (navegación por el historial o preferencia de movimiento reducido)
async function launch(rapido = false) {
  rapido = rapido === true || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const id = ++runId, b = BODIES[mission.body];
  $('#setup').hidden = true; $('#hud').hidden = false;
  $('#chips').innerHTML = `<span class="chip">Destination <b>${b.name}</b></span>
    <span class="chip">Crew <b>${mission.crew}</b></span><span class="chip">Stay <b>${DURATIONS[mission.duration].name}</b></span>`;
  flujo.alLanzar();
  $('#chips').title = [...$('#chips').children].map((c) => c.textContent.trim().replace(/\s+/g, ' ')).join(' · ');   // por si algún chip no cabe en la fila
  $('#data-badge').hidden = true;                                // todavía no hay datos que etiquetar: aparece con los resultados
  $('#flight').hidden = false; $('#btn-skip').hidden = false;
  $('#f-layers').textContent = '—'; $('#f-phase').textContent = `Trajectory ${b.travel}`;
  const sitesPromise = fetchSites(mission);
  $('#f-state').textContent = 'Loading model…';
  await viewer.ready;

  await viewer.flyToBody(mission.body, {
    duration: mission.body === 'mars' ? 40 : 36,   // misión completa: plataforma, ascenso, órbita, inyección, crucero y captura
    onProgress: (t, remaining) => {
      if (rapido && t < 1) $('#btn-skip').onclick();   // la misma acción que «Saltar viaje»
      $('#f-bar').style.width = `${t * 70}%`;
      $('#f-dist').textContent = fmtKm(b.distanceKm * remaining);
      $('#f-state').textContent = viewer.rocketPhase || 'Cruise';   // fase real del Saturno V (js/saturno5.js)
    },
  });
  if (id !== runId) return;

  // Análisis de capas de datos
  $('#btn-skip').hidden = true; $('#f-phase').textContent = `Analyzing the surface of ${CUERPO[mission.body]?.nombre ?? b.name}`;
  $('#f-dist').textContent = 'In orbit'; $('#f-state').textContent = 'Multilayer scan';
  for (let i = 0; i < b.layers.length; i++) {
    if (id !== runId) return;
    $('#f-layers').textContent = b.layers[i].split(' (')[0];
    $('#f-bar').style.width = `${70 + ((i + 1) / b.layers.length) * 30}%`;
    await sleep(650);
  }
  sites = await sitesPromise;
  if (id !== runId) return;
  $('#flight').hidden = true;
  showResults();
}

// Barra de la nota partida en dos: los puntos que salen de factores calculados con mediciones del PDS (s.real) y los que
// salen de estimaciones de demostración. La longitud total sigue siendo la puntuación. Son números que ya daba scoreSites.
const puntosMedidos = (s) => Object.keys(s.real ?? {}).reduce((a, k) => a + (s.contrib?.[k] ?? 0), 0);
function barraNota(s) {
  const m = Math.min(s.score, puntosMedidos(s)), e = Math.max(0, s.score - m), cuales = Object.keys(s.real ?? {}).map((k) => METRICS[k].short.toLowerCase());
  const texto = cuales.length ? `${Math.round(m)} of ${s.score} points come from factors computed with NASA PDS measurements (${cuales.join(', ')}); the rest, from estimates`
    : `${s.score} points, all from demonstration estimates`;
  return `<div class="mini" title="${esc(texto)}"><i class="med" style="width:${m}%"></i><i class="est" style="width:${e}%"></i></div><span class="sr-only">${esc(texto)}</span>`;
}

function showResults() {
  const b = BODIES[mission.body];
  $('#res-sub').textContent = `${sites.length} regions analyzed · ${OBJECTIVES[mission.objective].name}`;
  $('#res-list').innerHTML = sites.map((s, i) => `
    <li data-id="${s.id}" style="--d:${i * 90}ms" tabindex="0">
      <span class="thumb"><canvas data-mini="${s.id}" width="96" height="96" aria-hidden="true"></canvas><span class="rk">${s.rank}</span></span>
      <div class="nm"><b>${esc(s.name)}</b><small>${esc(s.region)}<span class="lv"></span></small>${barraNota(s)}</div>
      <span class="sc">${s.score}</span></li>`).join('');
  $('#res-layers').innerHTML = `<b>Layers:</b> ${b.layers.join(' · ')}`;
  $('#results').hidden = false;
  const real = sites.some((s) => Object.keys(s.real ?? {}).length);
  $('#res-leyenda').hidden = !real;                              // leyenda de la barra partida, solo si hay factores medidos
  $('#data-badge').hidden = false;
  $('#data-badge').textContent = real ? 'PDS + ESTIMATES' : 'DEMO DATA';
  $('#data-badge').title = real ? 'Terrain, ice, thermal and resources are computed from measured data (NASA PDS). Solar, radiation, link and science are demonstration estimates.'
    : 'The PDS layers could not be loaded: all scores are demonstration estimates.';
  viewer.setSites(sites, selectSite);
  $('#layers').hidden = !viewer.bodies[mission.body]?.surfaceMat; renderLayers();
  viewer.controls.autoRotate = true;
  toast(`Best site: ${sites[0].name}`);
  flujo.alMostrarResultados(sites);
  setTimeout(pintarMiniaturas, 400);                             // después de la animación de entrada de la lista
}

// Miniatura del relieve real (LOLA / MOLA) alrededor de cada emplazamiento, en su fila de la lista. Todas usan la escala
// de color de la capa de elevación del globo y la misma exageración del sombreado: se pueden comparar a simple vista.
async function pintarMiniaturas() {
  const body = mission.body, id = runId;
  try {
    const [e, ex] = await Promise.all([capa(`${body}_elev`), exageracionRelieve(body)]);
    if (id !== runId || mission.body !== body) return;
    const km = RADIO_MINIATURA_KM[body];
    for (const cv of document.querySelectorAll('#res-list canvas[data-mini]')) {
      const s = sites.find((x) => x.id === cv.dataset.mini);
      if (!s) continue;
      miniatura(cv, e, s, body, { radioKm: km, n: 96, exageracion: ex });
      cv.parentElement.classList.add('lista');
      cv.parentElement.title = `Real relief within ±${km} km (${e.meta.fuente?.mision ?? 'NASA PDS'}); same colors as the globe’s Elevation layer`;
    }
  } catch (err) { console.warn('Miniaturas de relieve no disponibles', err); }
}

// ---- panel «Comparar con datos medidos» (js/graficos/panel.js) -----------
let panelP = null;
const panelGraficos = () => (panelP ??= import('./graficos/panel.js').then((m) => { m.iniciar(); return m; }).catch((e) => { panelP = null; throw e; }));
async function abrirComparativa(sel = null, origen = document.activeElement) {
  if (!sites.length) return;
  try { (await panelGraficos()).abrir({ body: mission.body, sitios: sites, sel, alVerFicha: selectSite, origen }); }
  catch (e) { console.error('Panel de comparación', e); toast('The data comparison could not be opened'); }
}
$('#btn-comparar').onclick = () => abrirComparativa(current?.id ?? null, $('#btn-comparar'));
// Escape con el panel de comparación abierto lo cierra a él (y devuelve el foco), no a la ficha que queda debajo.
// En fase de captura y registrado antes que los demás escuchas de Escape de la página.
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || $('#analisis').hidden || e.target.closest?.('dialog')) return;
  e.stopImmediatePropagation(); e.preventDefault();
  panelGraficos().then((p) => p.cerrar()).catch(() => { $('#analisis').hidden = true; });
}, true);

$('#res-list').addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) selectSite(li.dataset.id); });
$('#res-list').addEventListener('keydown', (e) => {               // la lista también se recorre y se elige con el teclado
  const li = e.target.closest?.('li');
  if (li && e.target === li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectSite(li.dataset.id); }
});

async function selectSite(id) {
  const s = sites.find((x) => x.id === id); if (!s) return;
  tipGrafico(null);                                              // la lectura del mapa de la ficha anterior no debe quedarse en pantalla
  current = s; flujo.alSeleccionar(s);   // el gráfico de propósitos pasa al reparto de este lugar
  document.querySelectorAll('#res-list li').forEach((li) => li.classList.toggle('sel', li.dataset.id === id));
  $('#training').hidden = true; viewer.clearAnalogs();
  $('#layers').hidden = !viewer.bodies[mission.body]?.surfaceMat;   // por si se llega desde el entrenamiento (gráfico → «Ver en el mapa»)
  renderDetail(s); $('#results').hidden = true; $('#detail').hidden = false;
  $('#detail').scrollTop = 0;                                    // con el panel ya visible: oculto, el navegador ignora el desplazamiento
  await viewer.focusSite(s);
}

function radar(metrics) {
  const keys = Object.keys(METRICS), n = keys.length, c = 120, R = 82;
  const pt = (i, v) => { const a = -Math.PI / 2 + (i / n) * Math.PI * 2; return [c + Math.cos(a) * R * v / 100, c + Math.sin(a) * R * v / 100]; };
  const grid = [25, 50, 75, 100].map((l) => `<polygon points="${keys.map((_, i) => pt(i, l).join(',')).join(' ')}" fill="none" stroke="rgba(160,190,255,.15)"/>`).join('');
  const axes = keys.map((k, i) => { const [x, y] = pt(i, 100), [lx, ly] = pt(i, 122);
    return `<line x1="${c}" y1="${c}" x2="${x}" y2="${y}" stroke="rgba(160,190,255,.12)"/><text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle">${METRICS[k].short}</text>`; }).join('');
  const poly = keys.map((k, i) => pt(i, metrics[k]).join(',')).join(' ');
  return `<svg class="radar" viewBox="0 0 240 240" width="240" height="240" role="img" aria-label="Radar chart of factors">${grid}${axes}
    <polygon points="${poly}" fill="rgba(93,255,208,.25)" stroke="#5dffd0" stroke-width="2"/></svg>`;
}

function renderDetail(s) {
  const bars = Object.entries(s.metrics).map(([k, v]) => [k, v, s.weights?.[k] ?? 0]).sort((a, b) => b[2] - a[2])
    .map(([k, v, w]) => `<div class="row"><span>${METRICS[k].icon} ${METRICS[k].short} <small>${Math.round(w * 100)}%</small>${s.real?.[k] ? ` <abbr class="pds" title="${esc(s.real[k])}">PDS</abbr>` : ''}</span>
      <div class="t"><i class="${v < 45 ? 'low' : v < 65 ? 'mid' : ''}" style="width:${v}%"></i></div><span class="v">${v}</span></div>`).join('');
  $('#detail-body').innerHTML = `
    <div class="d-head"><div class="ring" style="--p:${s.score}"><b>${s.score}</b></div>
      <div><span class="tag ${s.rank === 1 ? '' : 'gold'}">#${s.rank} OF ${sites.length}</span><h2>${esc(s.name)}</h2>
      <small>${esc(s.region)} · ${Math.abs(s.lat).toFixed(1)}°${s.lat >= 0 ? 'N' : 'S'} ${Math.abs(s.lon).toFixed(1)}°${s.lon >= 0 ? 'E' : 'W'}</small></div></div>
    <p class="desc">${esc(s.desc)}</p>
    <section class="ficha-graf" id="ficha-graf" aria-label="Surroundings and terrain profile from measured data"><p class="g-cargando" role="status">Drawing the surroundings from the relief data…</p></section>
    ${radar(s.metrics)}
    ${s.medidas?.length ? `<h4>NASA PDS measurements <span class="muted">(mean within a ≈ ${zonaKm()} km radius)</span></h4>
      <div class="facts">${s.medidas.map((m, i) => `<div class="fact"><small>${esc(m.nombre)} · ${esc(m.fuente)}</small><b>${esc(m.texto)}</b>${m.rango ? `<small class="rg">${esc(m.rango)}</small>` : ''}<span data-chispa="${i}"></span></div>`).join('')}</div>
      <p class="small muted">The histogram of each measurement covers the whole surface ${esc(CUERPO[mission.body].de)} with published data, and the mark is this site: “90th percentile” means that 90 % of that surface has an equal or lower value. It tells whether the value is low or high for that body, not whether it is good or bad.</p>
      <button type="button" class="btn ghost small-btn" id="btn-comparar-ficha">📊 Compare with the other sites</button>
      ${citas([...new Set(s.medidas.map((m) => m.cita).filter(Boolean))])}` : ''}
    <h4>Reference data <span class="muted">(estimate)</span></h4><div class="facts">${(s.facts || []).map(([l, v]) => `<div class="fact"><small>${esc(l)}</small><b>${esc(v)}</b></div>`).join('')}</div>
    <h4>Factors for your objective <span class="muted">(weight)</span></h4><div class="bars">${bars}</div>
    ${Object.keys(s.real ?? {}).length ? '<p class="small muted"><abbr class="pds">PDS</abbr> = computed from measured data (hover to see the formula). The rest are demonstration estimates.</p>' : ''}
    ${s.pros?.length ? `<h4>Advantages</h4><ul class="pc">${s.pros.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
    ${s.cons?.length ? `<h4>Risks</h4><ul class="pc con">${s.cons.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
    ${flujo.fichaHtml(s)}
    <button class="btn primary cta" id="btn-train">🌍 Where to train on Earth?</button>`;
  $('#btn-train').onclick = () => openTraining(s);
  const cmp = $('#btn-comparar-ficha'); if (cmp) cmp.onclick = () => abrirComparativa(s.id, cmp);
  graficosFicha(s); chispasFicha(s);
}

// Gráficos de la ficha con datos medidos: mapa del entorno y perfil del terreno (js/graficos/entorno.js, corte.js)
const estadoFicha = {};                                          // lo elegido en cada gráfico se conserva al cambiar de emplazamiento
async function graficosFicha(s) {
  const cont = $('#ficha-graf'), body = mission.body;
  if (!cont) return;
  try {
    const [entorno, corte, datos, ex] = await Promise.all([import('./graficos/entorno.js'), import('./graficos/corte.js'), medirTodo(body, [s]), exageracionRelieve(body)]);
    if ($('#ficha-graf') !== cont || mission.body !== body) return;   // la ficha ya es otra
    const pintar = (nombre, mod) => {
      const viejo = cont.querySelector(`[data-g="${nombre}"]`), nuevo = viejo.cloneNode(false);
      viejo.replaceWith(nuevo);                                   // contenedor nuevo: los escuchas del pintado anterior se van con él
      try {
        mod.pintar(nuevo, { body, cuerpo: CUERPO[body], Rkm: RADIO_KM[body], sitio: s, cols: datos.cols, fila: datos.filas[0], exageracion: ex,
          estado: (estadoFicha[nombre] ??= {}), repintar: () => pintar(nombre, mod) });
      } catch (e) { console.error(`Gráfico «${nombre}»`, e); nuevo.innerHTML = '<p class="g-vacio">This chart could not be drawn.</p>'; }
    };
    cont.innerHTML = '<div data-g="entorno"></div><div data-g="corte"></div>';
    pintar('entorno', entorno); pintar('corte', corte);
  } catch (e) {
    console.warn('Gráficos de la ficha no disponibles', e);
    if ($('#ficha-graf') === cont) cont.innerHTML = '<p class="g-vacio">The relief data for this site could not be loaded.</p>';
  }
}

// Junto a cada medición: dónde cae en la distribución de toda la superficie del cuerpo (js/graficos/chispa.js)
async function chispasFicha(s) {
  const body = mission.body, cuerpo = CUERPO[body];
  for (const [i, m] of (s.medidas ?? []).entries()) {
    if (!m.capa || m.valor == null) continue;
    try {
      const c = await (m.derivada === 'pendiente' ? pendienteCeldas(body) : capa(m.capa));
      await new Promise((r) => setTimeout(r));                   // un respiro entre capas: ordenar una rejilla grande tarda decenas de ms
      const hueco = document.querySelector(`#detail-body [data-chispa="${i}"]`);
      if (current?.id !== s.id || !hueco) return;
      hueco.innerHTML = chispa(c, m.valor, cuerpo);
    } catch (e) { console.warn('Distribución no disponible', m.capa, e); }
  }
}

$('#detail-close').onclick = closeDetail;
async function closeDetail() {
  tipGrafico(null);
  $('#detail').hidden = true; $('#results').hidden = false; current = null;
  document.querySelectorAll('#res-list li').forEach((li) => li.classList.remove('sel'));
  await viewer.backToBody();
}

// ============================ ENTRENAMIENTO ================================
async function openTraining(site, pick = 0) {
  $('#detail').hidden = true; $('#training').hidden = false; $('#layers').hidden = true; hideTip();
  $('#training-body').innerHTML = `<p class="muted">Looking for the Earth analog most similar to ${esc(site.name)}…</p>`;
  const list = await fetchTraining(site, mission);
  const a = list[pick];
  $('#training-body').innerHTML = `
    <span class="tag">RECOMMENDED TRAINING</span>
    <h2 style="margin:.2rem 0 .1rem">${esc(a.name)}</h2><small class="muted">${esc(a.country)} · ${Math.abs(a.lat).toFixed(1)}°${a.lat >= 0 ? 'N' : 'S'} ${Math.abs(a.lon).toFixed(1)}°${a.lon >= 0 ? 'E' : 'W'}</small>
    <div class="match" style="margin-top:.8rem"><b>${a.match}%</b><span class="muted">similarity with ${esc(site.name)} <small>(demonstration estimate from qualitative traits)</small></span></div>
    <p class="desc">${esc(a.desc)}</p>
    <section class="cmr" id="cmr" aria-live="polite"><h4>NASA data for this site <span class="muted">· CMR</span></h4><p class="muted small">Querying the NASA Earthdata catalog…</p></section>
    <section class="motor" id="motor" aria-live="polite">${MOTOR_TIT}<p class="muted small">Checking the scientific engine…</p></section>
    <h4>What they share</h4><div class="traits">${a.shared.map((t) => `<span>${esc(TRAIT_LABELS[t] || t)}</span>`).join('')}</div>
    <h4>Training program</h4><ul class="acts">${a.activities.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <div class="facts" style="margin-top:1rem"><div class="fact"><small>Best season</small><b>${esc(a.season)}</b></div><div class="fact"><small>Access</small><b>${esc(a.access)}</b></div></div>
    <h4>Other options</h4>
    ${list.map((x, i) => `<button class="alt ${i === pick ? 'sel' : ''}" data-i="${i}"><span>${esc(x.name)}</span><span>${x.match}%</span></button>`).join('')}
    <button class="btn ghost cta" id="btn-train-back">← Back to the site</button>`;
  $('#training-body').querySelectorAll('.alt').forEach((b) => (b.onclick = () => { if (+b.dataset.i !== pick) openTraining(site, +b.dataset.i); }));
  $('#btn-train-back').onclick = closeTraining;
  $('#training').scrollTop = 0;
  renderCmr(a);
  const vuelo = viewer.flyToEarth(a);   // borra los marcadores de análogos al empezar (síncrono)
  renderMotor(site);
  await vuelo;
}

// ---- motor científico de similitud geomorfológica (base-planetaria/similitud, opcional) ----------
const MOTOR_TIT = '<h4>Geomorphological analog report <span class="muted">· scientific engine</span></h4>';
const motorCache = new Map();                       // `${cuerpo}:${sitio}` → resultado completo del motor
const pct = (p) => `${(100 * p).toFixed(1)} %`;
const num = (x) => (x == null ? '—' : Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 1 ? x.toFixed(2) : x.toPrecision(2));
const ll = (lat, lon) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
const CLASE = { indistinguible: 'indistinguishable', muy_proxima: 'very close', proxima: 'close', distinta: 'different' };

async function renderMotor(site) {
  const box = () => document.getElementById('motor');
  const clave = `${mission.body}:${site.id}`;
  if (motorCache.has(clave)) return pintarMotor(site, motorCache.get(clave));
  const est = await estadoMotor();
  if (!box()) return;
  if (!est) {
    box().innerHTML = `${MOTOR_TIT}<p class="small muted">Not running. In a terminal: <code>cd base-planetaria && ../.venv/bin/python -m similitud servidor</code></p>`;
    return;
  }
  if (!est.datos.earth.srtmgl30_teselas) {
    box().innerHTML = `${MOTOR_TIT}<p class="small muted">The SRTMGL30 Earth elevation model is missing (NASA Earthdata, requires Earthdata Login): <code>python -m similitud descargar-tierra</code></p>`;
    return;
  }
  box().innerHTML = `${MOTOR_TIT}<p class="small muted">Searches the whole Earth for 200 km windows with similar distributions of slope, roughness, curvature and spatial structure, using LOLA/MOLA and SRTMGL30 data.</p>
    <button class="btn ghost" id="motor-go">Find geomorphological analogs</button>`;
  $('#motor-go').onclick = async () => {
    box().innerHTML = `${MOTOR_TIT}<p class="small muted">Computing… The first time, the Earth catalog is built and this takes several minutes.</p>`;
    const pol = mission.body === 'moon' && Math.abs(site.lat) >= 78 ? (site.lat < 0 ? 'ldem_75s_240m' : 'ldem_75n_240m') : null;
    const producto = pol && est.datos.moon.polares.includes(pol) ? pol : undefined;
    try {
      const r = await fetchAnalogosGeomorfologicos(site, mission.body, { producto });
      motorCache.set(clave, r);
      if (box()) pintarMotor(site, r);
    } catch (e) { if (box()) box().innerHTML = `${MOTOR_TIT}<p class="small muted">Could not compute: ${esc(e.message)}</p>`; }
  };
}

const NOMBRE_CUERPO = { moon: 'Moon', mars: 'Mars', earth: 'Earth' };
const fmtCob = (x) => (x == null ? 'not available in the product' : pct(x));

function pintarMotor(site, r) {
  const box = document.getElementById('motor');
  if (!box) return;
  const p = r.parametros, ob = r.objetivo.ventana, dO = r.datos.objetivo, dB = r.datos.busqueda, cat = r.datos.catalogo;
  const refs = Object.fromEntries(r.referencias.metodos.map((m, i) => [m.clave, i + 1]));
  const nref = (claves) => claves.map((k) => `[${refs[k]}]`).join('');
  const cand = (a) => {
    const crit = Object.entries(a.criterios);
    const mejor = crit.filter(([, x]) => x.clase === 'indistinguible' || x.clase === 'muy_proxima').map(([, x]) => x.nombre);
    return `<details class="mot"><summary><b>${a.rango}.</b> ${ll(a.lat, a.lon)} · worst percentile ${pct(a.peor_percentil)} ·
        ${a.ventanas_que_la_dominan === 0 ? 'not dominated (Pareto)' : `dominated by ${a.ventanas_que_la_dominan} windows`}</summary>
      <p class="small">${esc(a.explicacion)}</p>
      <table class="mtab"><tr><th>Criterion</th><th>Distance</th><th>Percentile</th><th>Reading</th></tr>
        ${r.criterios.map((c) => { const x = a.criterios[c.id]; return `<tr><td>${esc(c.nombre)}<br><small class="muted">${esc(x.metrica)} ${nref(x.referencias)}</small></td>
          <td>${num(x.distancia)}<br><small class="muted">${esc(x.unidades)}</small></td><td>${pct(x.percentil_catalogo)}</td><td>${CLASE[x.clase] ?? x.clase}</td></tr>`; }).join('')}
      </table>
      <p class="small muted">Valid coverage ${pct(a.ventana.cobertura_valida)} · direct observation ${fmtCob(a.ventana.fraccion_con_observacion_directa)}${mejor.length ? '' : ' · no criterion within the closest 5 %'}.</p>
      <button class="btn ghost small-btn" data-cmp="${a.rango}">Detailed comparison →</button>
    </details>`;
  };
  const v = r.validacion;
  const val = v ? `<table class="mtab val"><tr><th>Sensitivity test</th><th>Kendall τ</th><th>Top-${p.k} retained</th></tr>
      ${v.pruebas.map((t) => `<tr><td>${esc(t.prueba)}</td><td>${t.omitida ? '—' : num(t.tau_kendall)}</td><td>${t.omitida ? esc(t.omitida) : pct(t.top_k_conservado)}</td></tr>`).join('')}
    </table>
    <p class="small muted">Block bootstrap ${nref(['kunsch1989'])} (${v.bootstrap_bloques.replicas} replicates, seed ${v.bootstrap_bloques.semilla}): frequency in the top ${p.k} for each candidate,
      ${v.bootstrap_bloques.frecuencia_en_top_k_por_rango_original.slice(0, p.k).map((f) => pct(f)).join(' · ')}.
      Effective sample size of the target ${nref(['bretherton1999'])}: ${Object.entries(v.dependencia_espacial_objetivo).map(([k, d]) => `${k} ${num(d.n_efectivo)} of ${d.n_pixeles}`).join(' · ')}.</p>` : '';
  box.innerHTML = `${MOTOR_TIT}
    <div class="informe">
    <p class="small"><b>Type of similarity:</b> geomorphological. It does not assess environmental conditions (temperature, atmosphere, radiation) or suitability for a mission.</p>
    <h5>1 · Target region</h5>
    <p class="small">${NOMBRE_CUERPO[ob.cuerpo]} · center ${ll(ob.centro.lat, ob.centro.lon_180)} · ${num(ob.lado_km)} km window (${ob.celdas_por_lado}×${ob.celdas_por_lado} cells of ${num(p.h_m / 1000)} km) ${nref(['snyder1987'])}.
      Product ${esc(dO.producto)}; vertical reference: ${esc(dO.referencia_vertical)}. Valid coverage ${pct(ob.cobertura_valida)}; cells with direct observation ${fmtCob(ob.fraccion_con_observacion_directa)}.</p>
    <h5>2 · Method</h5>
    <p class="small">Catalog of ${cat.ventanas_validas.toLocaleString('en-US')} ${esc(dB.producto)} windows (${NOMBRE_CUERPO[dB.cuerpo]}) with the same side length and the same cell size.
      Seven criteria, each in its own units: distributions compared with Wasserstein-1, variogram and Moran’s I. Ranking without weights: percentile of each distance, then a Pareto-compatible leximax ordering ${nref(['ehrgott2005'])}.
      <a href="base-planetaria/similitud/METODOLOGIA.md" target="_blank" rel="noopener">Full equations</a>.</p>
    <h5>3 · Candidates</h5>
    <p class="small muted">“Worst percentile” means that, on every criterion, the window is within that percentage of catalog windows closest to the target. It is not a similarity percentage.</p>
    ${r.analogos.map(cand).join('')}
    <h5>4 · Uncertainty and validation</h5>
    ${val}
    <h5>5 · What was not compared</h5>
    <ul class="small">${r.variables_no_comparadas.map((x) => `<li><b>${esc(x.variable)}</b>: ${esc(x.motivo)}</li>`).join('')}</ul>
    <h5>6 · Limitations</h5>
    <ul class="small">${r.limitaciones.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <h5>7 · Data sources</h5>
    <ol class="small refs">${r.referencias.datos.map((c) => `<li>${enlazar(c)}</li>`).join('')}</ol>
    <h5>8 · Method references</h5>
    <ol class="small refs">${r.referencias.metodos.map((m) => `<li>${enlazar(m.cita)}${m.url ? ` <a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.url)}</a>` : ''} <span class="muted">— ${esc(m.uso)}</span></li>`).join('')}</ol>
    <p class="small muted">Challenge: <a href="${esc(r.recurso_oficial)}" target="_blank" rel="noopener">NASA Space Apps 2026, Resources tab</a> · computed in ${num(r.segundos)} s.</p>
    <a class="btn ghost" id="motor-geojson" download="analogos_${esc(site.id)}.geojson">Download map (GeoJSON)</a>
    </div>`;
  box.querySelector('#motor-geojson').href = URL.createObjectURL(new Blob([JSON.stringify(r.geojson)], { type: 'application/geo+json' }));
  const comparar = (rango) => {
    const a = r.analogos.find((x) => x.rango === rango);
    if (a) abrirComparacion({ body: r.objetivo.ventana.cuerpo, site, analogo: { lat: a.lat, lon: a.lon, rango },
      lado_km: r.parametros.lado_km, buscar_en: r.datos.busqueda.cuerpo });
  };
  box.querySelectorAll('[data-cmp]').forEach((b) => (b.onclick = () => comparar(+b.dataset.cmp)));
  viewer.onMotorClick = (id) => comparar(+String(id).split('-')[1]);   // pulsar el lugar en el globo
  viewer.showMotorAnalogs(r.analogos);
}

// ---- datos reales de NASA CMR para el lugar de entrenamiento -------------
const MES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (d) => d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });

function clearChart(months) {
  const W = 300, H = 92, top = 8, base = 70, bw = W / 12;
  const bars = months.map((m, i) => {
    const x = i * bw + 1, w = bw - 2;                         // 2px de separación entre barras
    const label = `<text x="${x + w / 2}" y="${H - 8}" text-anchor="middle">${MES[i][0]}</text>`;
    if (m.total < 3) return `<g><title>${MES[i]}: not enough passes (polar night or no data)</title>
      <rect x="${x}" y="${base - 2}" width="${w}" height="2" class="nodata"/>${label}</g>`;
    const r = m.clear / m.total, h = Math.max(2, r * (base - top));
    return `<g tabindex="0"><title>${MES[i]}: ${Math.round(r * 100)} % clear (${m.clear} of ${m.total} passes)</title>
      <rect x="${x}" y="${top}" width="${w}" height="${base - top}" class="hit"/>
      <path d="M${x},${base}V${base - h + 4}q0,-4 4,-4h${w - 8}q4,0 4,4V${base}Z" class="bar"/>${label}</g>`;
  }).join('');
  return `<svg class="mchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Percentage of clear satellite passes per month">
    <line x1="0" x2="${W}" y1="${base}" y2="${base}" class="axis"/>${bars}</svg>`;
}

async function renderCmr(a) {
  const box = () => document.getElementById('cmr');
  try {
    const d = await earthSiteData(a);
    if (!box() || $('#training-body h2')?.textContent !== a.name) return;   // el usuario cambió de lugar
    const img = d.image;
    const cap = img.date ? `${img.sensor} · ${fmtDate(img.date)} · ${Math.round(img.cloud)} % cloud` : `${img.sensor} · recent image`;
    box().innerHTML = `<h4>NASA data for this site <span class="muted">· CMR</span></h4>
      <figure class="sat"><a href="${img.src}" target="_blank" rel="noopener"><img src="${img.src}" alt="Latest clear satellite image of ${esc(a.name)}" loading="lazy"></a>
        <figcaption>${esc(cap)}${img.id ? ` · <code>${esc(img.id)}</code>` : ''}</figcaption></figure>
      ${d.scenes ? `<div class="facts"><div class="fact"><small>Landsat/Sentinel-2 passes (24 months)</small><b>${d.scenes}</b></div>
        <div class="fact"><small>Clear (&lt; 15 % cloud)</small><b>${d.clearPct} %</b></div></div>
        <p class="small muted" style="margin:.8rem 0 .2rem">Clear sky by month · best: <b class="ink">${d.bestMonths.map((m) => MES[m]).join(', ') || '—'}</b></p>
        ${clearChart(d.months)}` : '<p class="small muted">No Landsat/Sentinel-2 (HLS) coverage at this latitude; MODIS image.</p>'}
      ${d.dem ? `<figure class="sat dem"><img src="${d.dem}" alt="ASTER GDEM relief" loading="lazy"><figcaption>Relief · ASTER GDEM v3${d.demId ? ` · <code>${esc(d.demId)}</code>` : ''}</figcaption></figure>` : ''}
      ${d.lstLast ? `<p class="small muted">MODIS land surface temperature (MOD11A1): ${d.lstDays.toLocaleString('en-US')} days of data, latest on ${fmtDate(d.lstLast)}.</p>` : ''}
      ${citas([d.scenes ? CITAS_CMR.hlsl30 : null, d.scenes ? CITAS_CMR.hlss30 : null, d.scenes ? null : CITAS_CMR.gibs,
        d.dem ? CITAS_CMR.astgtm : null, d.lstLast ? CITAS_CMR.mod11a1 : null].filter(Boolean))}`;
  } catch (e) {
    console.warn('CMR no disponible', e);
    if (box()) box().innerHTML = '<h4>NASA data for this site</h4><p class="small muted">NASA CMR could not be queried (offline?).</p>';
  }
}

$('#training-close').onclick = closeTraining;
async function closeTraining() {
  const s = current; $('#training').hidden = true; viewer.clearAnalogs();
  $('#layers').hidden = !viewer.bodies[mission.body]?.surfaceMat;
  if (s) { renderDetail(s); $('#detail').hidden = false; await viewer.backToBody(); await viewer.focusSite(s); }
}

// ============================ CAPAS DE DATOS ===============================
// Proyecta sobre el globo una capa real del PDS, con leyenda; el cursor lee el valor de la celda y cada
// emplazamiento muestra su valor medio en la capa activa.
let layer = null, layerRun = 0, probeRaf = 0, layerOpacity = 0.9;
const zonaKm = () => Math.round(RADIO_ZONA * (Math.PI / 180) * RADIO_KM[mission.body]);
const coord = (lat, lon) => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
const siteValue = (s) => { const z = layer?.capa.zona(s.lat, s.lon); return z ? layer.def.breve(z.media) : layer ? 'no data' : ''; };

function renderLayers() {
  const defs = CAPAS_GLOBO[mission.body] ?? [], grupos = [...new Set(defs.map((d) => d.grupo))];
  $('#layer-list').innerHTML = grupos.map((g) => `<div class="lgroup"><small>${esc(g)}</small><div class="lchips">${defs.filter((d) => d.grupo === g).map((d) =>
    `<button data-layer="${d.id}" class="${layer?.def.id === d.id ? 'sel' : ''}" aria-pressed="${layer?.def.id === d.id}">${d.corto}</button>`).join('')}</div></div>`).join('');
  $('#layers').classList.toggle('on', !!layer);
  $('#legend').hidden = !layer; $('#layer-hint').hidden = !!layer; $('#tip').hidden = true;
  // valor de la capa en cada emplazamiento (lista y marcadores)
  document.querySelectorAll('#res-list li').forEach((li) => { const s = sites.find((x) => x.id === li.dataset.id); li.querySelector('.lv').textContent = s && layer ? ` · ${siteValue(s)}` : ''; });
  viewer.setMarkerValues(layer ? (m) => siteValue(m) : null);
  flujo.alCambiarCapa(layer?.def.id ?? null);
  if (!layer) return;
  const { def, capa: c } = layer, m = c.meta;
  $('#legend').innerHTML = `<div class="lg-head"><b>${esc(m.nombre)}</b><button class="lg-x" id="lg-x" aria-label="Remove layer" title="Remove layer">✕</button></div>
    <p class="lg-why">${esc(def.por)}</p>
    <div class="lg-bar" style="background:linear-gradient(${def.invertir ? 270 : 90}deg, ${RAMPAS[def.rampa].join(', ')})"><i id="lg-mark" hidden></i></div>
    <div class="lg-ticks">${c.anclas().map((v, i, a) => `<span>${i === 0 ? '≤ ' : i === a.length - 1 ? '≥ ' : ''}${esc(def.tick(v))}</span>`).join('')}</div>
    <div class="lg-unit">Scale in ${esc(def.unidad === '°' ? 'degrees' : def.unidad)} · <span class="nodata"></span> no data</div>
    ${def.nodata ? `<small class="lg-nodata">${esc(def.nodata)}</small>` : ''}
    ${layer.aprox ? `<small class="lg-nodata lg-aprox"><b>Approximation at the poles (not measured data; not used in the scores).</b> ${esc(layer.aprox.meta.metodo)} ${esc(layer.aprox.meta.nota)}</small>` : ''}
    <label class="lg-op">Opacity <input id="lg-op" type="range" min="30" max="100" value="${Math.round(layerOpacity * 100)}" aria-label="Layer opacity"></label>
    <small>${esc(m.fuente.mision)} · ${esc(m.resolucion)}. The scale marks are the 2nd, 25th, 50th, 75th and 98th percentiles of the surface.${Math.abs(m.dlon) >= 2 || def.bloques ? ' The view interpolates between cell or block centers; the cursor gives the published value.' : ''}</small>
    ${m.fuente.cita ? `<small class="cita">Source: ${enlazar(m.fuente.cita)}</small>` : ''}`;
  $('#lg-x').onclick = () => setLayer(def.id);
  $('#lg-op').oninput = (e) => { layerOpacity = e.target.value / 100; viewer.setOverlayOpacity(mission.body, layerOpacity); };
}

async function setLayer(id) {
  const body = mission.body, def = CAPAS_GLOBO[body]?.find((d) => d.id === id), run = ++layerRun;
  if (!def) return;
  if (layer?.def.id === id) { layer = null; viewer.setOverlay(body, null); renderLayers(); return; }
  document.querySelector(`[data-layer="${id}"]`)?.classList.add('busy');
  try {
    const [c, ap] = await Promise.all([capa(id), def.aprox ? capa(def.aprox).catch(() => null) : null]);
    if (run !== layerRun || mission.body !== body) return;
    if (viewer.setOverlay(body, pintarCapa(c, def.rampa, { invertir: def.invertir, bloques: def.bloques, aprox: ap }), layerOpacity)) layer = { def, capa: c, aprox: ap };
  } catch (e) { console.warn('Capa no disponible', e); toast('The data layer could not be loaded'); }
  if (run === layerRun) renderLayers();
}

function hideTip() { $('#tip').hidden = true; const mk = document.getElementById('lg-mark'); if (mk) mk.hidden = true; }

$('#layer-list').addEventListener('click', (e) => { const b = e.target.closest('[data-layer]'); if (b) setLayer(b.dataset.layer); });
$('#stage').addEventListener('pointerleave', hideTip);
$('#stage').addEventListener('pointermove', (e) => {
  if (!layer || probeRaf) return;
  probeRaf = requestAnimationFrame(() => {
    probeRaf = 0; if (!layer) return;
    const p = e.buttons ? null : viewer.probe(e.clientX, e.clientY);       // al arrastrar el globo no se sondea
    if (!p) { hideTip(); return; }
    let v = layer.capa.en(p.lat, p.lon), aprox = false;
    if (v !== v && layer.aprox) { v = layer.aprox.en(p.lat, p.lon); aprox = v === v; }
    const tip = $('#tip'), mk = document.getElementById('lg-mark');
    tip.innerHTML = `<small>${coord(p.lat, p.lon)}</small><b>${v === v ? (aprox ? '≈ ' : '') + esc(layer.def.fmt(v)) : 'No data'}</b>${aprox ? '<small>approximation, not measured</small>' : ''}`;
    tip.hidden = false;
    tip.style.transform = `translate(${Math.min(e.clientX + 16, innerWidth - tip.offsetWidth - 8)}px, ${Math.min(e.clientY + 18, innerHeight - tip.offsetHeight - 8)}px)`;
    if (mk) { mk.hidden = v !== v; const q = layer.capa.pos(v); mk.style.left = `${(layer.def.invertir ? 1 - q : q) * 100}%`; }
  });
});

// ============================ UTILIDADES ===================================
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3500); }

function resetMission() {
  runId++; viewer.tween = null;
  viewer.clearSites(); viewer.clearAnalogs(); viewer.setIntro();
  if (layer) { viewer.setOverlay(mission.body, null); layer = null; } layerRun++; hideTip();
  ['#hud', '#flight', '#results', '#detail', '#training', '#layers', '#analisis'].forEach((s) => ($(s).hidden = true));
  $('#setup').hidden = false; step = 1; maxStep = 1; mission.body = mission.objective = null; current = null;
  flujo.alReiniciar(); renderSetup();
}

addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#training').hidden) closeTraining(); else if (!$('#detail').hidden) closeDetail();
});

// En móvil los resultados, la ficha y el entrenamiento son hojas que tapan la mitad inferior de la pantalla: el
// encuadre sube lo justo para que el globo (y el módulo lunar) queden centrados en la parte que sigue a la vista.
const HOJAS = ['#results', '#detail', '#training'].map($), MOVIL = matchMedia('(max-width: 800px)');
const BARRA_PX = 100;                                            // alto de la barra superior más la fila de capas
function encuadrar() {
  const hoja = MOVIL.matches && HOJAS.find((el) => !el.hidden);
  viewer.shiftY = hoja ? Math.max(0, 0.5 - (BARRA_PX + hoja.getBoundingClientRect().top) / (2 * innerHeight)) : 0;
}
const obsHojas = new ResizeObserver(encuadrar);                  // se abre, se cierra o cambia de alto (p. ej. al llegar los datos de CMR)
HOJAS.forEach((el) => obsHojas.observe(el));
MOVIL.addEventListener('change', encuadrar);
addEventListener('resize', encuadrar);

renderSetup();
flujo.iniciar({
  mission, viewer, getStep: () => step, setStep: (n) => { step = n; }, render: renderSetup, lanzar: launch, reiniciar: resetMission,
  setLayer, capaActiva: () => layer?.def.id ?? null, getSites: () => sites, zonaKm, seleccionar: selectSite,
});

// Depuración desde la consola del navegador: window.landfall.viewer
window.landfall = { viewer, mission };
