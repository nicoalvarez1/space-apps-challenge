import { BODIES, OBJECTIVES, DURATIONS, METRICS, TRAIT_LABELS, SITES, ANALOGS, fueraDeLimites } from './data.js';
import { fetchSites, fetchTraining, analogosTierra, comparacionTierra, analogosPrecalculados, indicePrecalculado, MOTOR_LOCAL } from './api.js';
import { Viewer } from './scene.js';
import { earthSiteData } from './cmr.js';
import { abrirComparacion, fechaCorta } from './comparacion.js';
import { CAPAS_GLOBO, RAMPAS, RADIO_KM, RADIO_ZONA, LIMITES_NASA, capa, pintarCapa, catalogo } from './capas.js';
import { buscarCandidatos, PASO as PASO_BARRIDO } from './barrido.js';   // más puntos, buscados en toda la superficie
import * as flujo from './proposito.js';   // pasos 2-4 (propósito, subapartado, criterios) y panel de criterios
import { plegar as plegarPerfil, desplegar as desplegarPerfil } from './perfil.js';   // gráfico de propósitos (#perfil)
// Gráficos de los resultados con las capas reales del PDS (js/analitica.js, js/graficos/). El panel de comparación y los
// gráficos de la ficha se cargan la primera vez que hacen falta (import dinámico).
import { medirTodo, exageracionRelieve, pendienteCeldas, percentil } from './analitica.js';
import { miniatura, RADIO_MINIATURA_KM } from './graficos/relieve.js';
import { chispa } from './graficos/chispa.js';
import { CUERPO, tip as tipGrafico, nombreCorto, masInfo, pctTxt, fichaCapa } from './graficos/base.js';
// Panel de la Tierra: análogos del motor de similitud dichos en llano y sus gráficos
import { listaCandidatos, cercania, cercaniaTecnica, frase, mapasHtml, pintarMapas, graficoCriterios, tipCriterios, graficoDistribuciones, tipDistribuciones,
  sostieneFalla, CRIT } from './graficos/analogo.js';
// Lugar de entrenamiento (análogos de js/data.js): relieve cara a cara, clima NASA POWER y alternativas (js/graficos/tierra-*.js)
import { pintar as pintarFamoso } from './graficos/tierra-panel.js';
import { pintar as pintarClima } from './graficos/tierra-clima.js';
import { climaPower } from './graficos/tierra-datos.js';

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
  // análogos terrestres: los que el motor encontró para cada emplazamiento (precalculados); si no hay, los de referencia
  const nAn = indiceAn ? Object.values(indiceAn.sitios).reduce((t, x) => t + x.candidatos.length, 0) : 0;
  const tiles = [[n ?? '—', 'real data layers'], [inst ?? '—', 'orbiting instruments'], [SITES.moon.length + SITES.mars.length, 'candidate sites'],
    nAn ? [nAn, 'Earth analogs found in NASA data'] : [ANALOGS.length, 'analogs on Earth']];
  $('#stats').innerHTML = tiles.map(([v, l]) => `<div><b>${v}</b><small>${l}</small></div>`).join('');
}
let capasPortada = null, indiceAn = null;
renderStats(null);
catalogo().then((c) => renderStats((capasPortada = c))).catch((e) => console.warn('Catálogo de capas no disponible', e));
indicePrecalculado().then((d) => { indiceAn = d; renderStats(capasPortada); });
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
  $('#res-sub').textContent = `${sites.length} places compared · best first · ${OBJECTIVES[mission.objective].name}`;
  $('#res-list').innerHTML = sites.map((s, i) => `
    <li data-id="${s.id}" style="--d:${i * 90}ms" tabindex="0">
      <span class="thumb"><canvas data-mini="${s.id}" width="96" height="96" aria-hidden="true"></canvas><span class="rk">${s.rank}</span></span>
      <div class="nm"><b>${esc(s.name)}</b><small>${esc(s.region)}<span class="lv"></span></small>${barraNota(s)}${fueraDeLimites(s) ? '<small class="lim-nasa">Outside NASA’s preliminary limits</small>' : ''}</div>
      <span class="sc">${s.score}</span></li>`).join('');
  $('#res-layers').innerHTML = masInfo(`<p class="g-pie"><b>Layers:</b> ${b.layers.map(esc).join(' · ')}</p>`);   // la lista de capas, plegada
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
  ctaResultados();
  flujo.alMostrarResultados(sites);
  setTimeout(pintarMiniaturas, 400);                             // después de la animación de entrada de la lista
  iniciarBarrido();
}

// ---- más puntos encontrados recorriendo toda la superficie (js/barrido.js) -------------------------------------
// Plegado bajo la lista. Al abrirlo se recorre la superficie (la primera vez por cuerpo; luego sale de la caché) y se
// listan los candidatos: solo coordenadas, la nota de los cuatro factores medidos, sus mediciones y el emplazamiento
// de la lista más cercano. No entran en `sites` ni abren la ficha (que necesita los datos escritos a mano).
let barridoAbierto = false, barridoRun = 0, barrido = null;
function iniciarBarrido() {
  const d = $('#res-barrido');
  barrido = null; barridoRun++; $('#barrido-body').innerHTML = '';
  d.hidden = false; d.open = barridoAbierto;
  if (barridoAbierto) pintarBarrido();
}
$('#res-barrido').addEventListener('toggle', (e) => {
  barridoAbierto = e.currentTarget.open;
  if (barridoAbierto && !$('#barrido-body').innerHTML) pintarBarrido();   // vacío = todavía sin pedir para estos resultados
});

const FACTOR_TXT = (ks) => ks.map((k) => METRICS[k].short.toLowerCase()).join(', ');
async function pintarBarrido() {
  const run = ++barridoRun, body = mission.body, box = $('#barrido-body');
  const estado = (p) => { if (run === barridoRun) box.innerHTML = `<p class="g-cargando" role="status">Scanning the whole surface with NASA data… ${Math.round(p * 100)} %</p>`; };
  estado(0);
  let r;
  try { r = await buscarCandidatos(body, mission.objective, { crew: mission.crew, duration: mission.duration }, { alAvanzar: estado }); }
  catch (e) { console.warn('Barrido no disponible', e); if (run === barridoRun) box.innerHTML = '<p class="g-vacio">The scan could not be completed: the NASA PDS layers are not available.</p>'; return; }
  if (run !== barridoRun || mission.body !== body) return;
  barrido = r;
  const ks = r.factores, R = RADIO_KM[body], lim = LIMITES_NASA[body];
  const pesos = ks.map((k) => `${METRICS[k].short.toLowerCase()} ${Math.round(r.pesos[k] * 100)} %`).join(', ');
  box.innerHTML = `
    <p class="g-pie">Points from a scan of the whole surface ${esc(CUERPO[body].de)} where the factors computed from NASA measurements (${FACTOR_TXT(ks)}) score highest with the weights of your objective. They are shown by their coordinates only.</p>
    <p class="g-pie"><b>Score:</b> measured factors only (${FACTOR_TXT(ks)}), each scored by percentile in the NASA data. It is not comparable with the scores of the list above, which also include estimates.</p>
    ${masInfo(`<p class="g-pie"><b>How they are found.</b> The surface is sampled every ${PASO_BARRIDO.toLocaleString('en-US')}° of latitude and longitude: twice the ${RADIO_ZONA.toLocaleString('en-US')}° radius (≈ ${zonaKm()} km) within which every site is measured, so at the equator neighbouring zones touch without overlapping (towards the poles, points of the same row get closer together).
      Each point is measured like the sites of the list, with the same layers. Each factor is scored by percentile in the NASA data: the share of the surface ${esc(CUERPO[body].de)} whose value is worse than or equal to the point’s (area-weighted, among published cells), the same scoring as the list.
      ${lim ? `Points outside NASA’s PRELIMINARY limits for human landing sites are skipped (${r.fuera.toLocaleString('en-US')} points): latitude “${esc(lim.textoLat)}” and elevation “${esc(lim.textoElev)}”, compared with the mean MOLA elevation within ≈ ${zonaKm()} km. Source: ${enlazar(`${lim.cita} ${lim.url}`)}` : ''}
      Points where one of these factors has no data are skipped too (${r.validos.toLocaleString('en-US')} of ${r.puntos.toLocaleString('en-US')} points kept).</p>
      <p class="g-pie">Score = weighted mean of the ${ks.length} measured factors with the weights of your objective (${pesos}). A point is a candidate when its score is at least that of its 8 neighbours on the grid (a local maximum: ${r.maximos.toLocaleString('en-US')} found); the ${r.candidatos.length} highest are shown, as many as the sites written for the list.</p>
      <p class="g-pie">Solar, radiation, link and science are not included: they are estimates written for each site of the list and do not exist for an arbitrary point. The nearest listed site and its distance are measured along the surface (great circle on a sphere of ${R.toLocaleString('en-US')} km).
      Scan time in this browser: ${(r.ms / 1000).toFixed(1)} s.</p>`)}
    <ol class="bar-lista">${r.candidatos.map((c, i) => `
      <li class="bar-c" data-barrido="${i}">
        <div class="bar-cab"><span class="rk">${c.rank}</span>
          <div class="nm"><b>Scan candidate · ${coord(c.lat, c.lon)}</b><small>Nearest listed site: ${esc(c.cercano.name)}, ${Math.round(c.cercano.km).toLocaleString('en-US')} km</small></div>
          <span class="sc" title="Measured factors only (${FACTOR_TXT(ks)})">${c.score}</span></div>
        <ul class="bar-med">${ks.filter((k) => c.metricas[k]).map((k) => `<li><span>${METRICS[k].icon} ${METRICS[k].short} <b>${c.metricas[k].v}</b></span><small>${esc(c.metricas[k].de)}</small></li>`).join('')}</ul>
        <button type="button" class="btn ghost small-btn" data-barrido-ver="${i}">Show on the globe</button>
        ${c.medidas.length ? masInfo(`<h4>All NASA PDS measurements <span class="muted">(mean within a ≈ ${zonaKm()} km radius)</span></h4>
          <div class="facts">${c.medidas.map((m) => `<div class="fact"><small>${esc(m.nombre)} · ${esc(m.fuente)}</small><b>${esc(m.texto)}</b>${m.rango ? `<small class="rg">${esc(m.rango)}</small>` : ''}</div>`).join('')}</div>`) : ''}
      </li>`).join('')}</ol>`;
  box.querySelectorAll('[data-barrido-ver]').forEach((b) => (b.onclick = () => verCandidato(+b.dataset.barridoVer)));
}

function verCandidato(i) {
  const c = barrido?.candidatos[i]; if (!c) return;
  document.querySelectorAll('#barrido-body .bar-c').forEach((li) => li.classList.toggle('sel', +li.dataset.barrido === i));
  viewer.verCandidato({ id: c.id, lat: c.lat, lon: c.lon, text: String(c.rank), label: `Scan candidate #${c.rank} · ${coord(c.lat, c.lon)}` });
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
// El cuerpo y la lista se leen ANTES de esperar la carga del módulo: si la misión se reinicia mientras tanto, no se abre.
// abrir() se espera para que sus fallos lleguen al catch (y al aviso). selectSite deja el foco en el cierre de la ficha.
async function abrirComparativa(sel = null, origen = document.activeElement) {
  const body = mission.body, lista = sites, id = runId;
  if (!body || !lista.length) return;
  try {
    const p = await panelGraficos();
    if (id !== runId || mission.body !== body) return;
    await p.abrir({ body, sitios: lista, sel, alVerFicha: selectSite, origen });
  } catch (e) { console.error('Panel de comparación', e); toast('The data comparison could not be opened'); }
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
  $('#training').hidden = true; viewer.clearAnalogs(); viewer.quitarCandidato(); restaurarPerfil();
  $('#layers').hidden = !viewer.bodies[mission.body]?.surfaceMat;   // por si se llega desde el entrenamiento (gráfico → «Ver en el mapa»)
  renderDetail(s); $('#results').hidden = true; $('#detail').hidden = false;
  $('#detail').scrollTop = 0;                                    // con el panel ya visible: oculto, el navegador ignora el desplazamiento
  // el elemento que tenía el foco (fila de la lista, botón del panel de comparación) acaba de ocultarse: el foco pasa a la ficha
  $('#detail-close').focus({ preventScroll: true });
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

// Llamada principal al entrenamiento en la Tierra (arriba de la ficha y de los resultados): es la función central de
// la web. En la ficha, data-pista recibe, si llega, el número real de análogos precalculados por el motor (renderDetail).
function ctaEntreno(id, s, { res = false } = {}) {
  return `<button type="button" class="cta-train${res ? ' res' : ''}" id="${id}">
    <span class="cta-ico" aria-hidden="true">🌍</span>
    <span class="cta-txt"><b>Where to train on Earth?</b>
      <span class="cta-sub">${res ? `For <b>${esc(s.name)}</b> · analogs, terrain, climate` : 'Earth analogs · terrain side by side · climate'}</span>
      ${res ? '' : '<span class="cta-dato" data-pista></span>'}</span>
    <span class="cta-fl" aria-hidden="true">→</span></button>`;
}
const pistaAnalogos = (d) => {
  // En llano; la cercanía exacta del más próximo («closer than X % of Earth’s N land windows…») queda en el panel de entrenamiento
  return `<b>${d.analogos.length} places on Earth</b> with similar terrain, found in NASA elevation data`;
};
// En el panel de resultados: para el emplazamiento elegido o, si no hay, para el n.º 1
function ctaResultados() {
  const cont = $('#res-entreno'), s = current ?? sites[0];
  if (!cont) return;
  if (!s) { cont.hidden = true; cont.innerHTML = ''; return; }
  cont.innerHTML = ctaEntreno('btn-train-res', s, { res: true }); cont.hidden = false;
  $('#btn-train-res').onclick = () => {
    current = s; flujo.alSeleccionar(s);
    document.querySelectorAll('#res-list li').forEach((li) => li.classList.toggle('sel', li.dataset.id === s.id));
    $('#results').hidden = true; openTraining(s);              // al volver («Back to the site») se abre la ficha de este lugar
  };
}

// Ficha técnica de cada capa medida en la ficha (campos de capas.json, ver fichaCapa), plegada en «Data behind these
// measurements». Una por capa: la pendiente regional de Marte sale de la misma capa que la elevación.
function fichasMedidas(s) {
  if (!capasPortada) return '';
  const ids = [...new Set((s.medidas ?? []).map((m) => m.capa).filter((id) => capasPortada[id]))];
  const nombres = (id) => s.medidas.filter((m) => m.capa === id).map((m) => m.nombre).join(' · ');
  return ids.length ? `<details class="citas"><summary>Data behind these measurements (${ids.length})</summary>${ids.map((id) => fichaCapa(capasPortada[id], nombres(id))).join('')}</details>` : '';
}

// Frase de la ficha para un emplazamiento fuera de los límites PRELIMINARES de NASA (capas.js → LIMITES_NASA): el valor
// medido, el límite (citado tal cual) y la fuente
function limitesHtml(s) {
  const L = LIMITES_NASA[mission.body];
  if (!L || !fueraDeLimites(s)) return '';
  const partes = s.limites.fallos.map((f) => (f.que === 'lat'
    ? `latitude ${Math.abs(f.valor).toFixed(1)}°${f.valor >= 0 ? 'N' : 'S'} (limit: “${esc(L.textoLat)}”)`
    : `mean MOLA elevation ${f.valor > 0 ? '+' : ''}${Math.round(f.valor).toLocaleString('en-US')} m within ≈ ${zonaKm()} km (limit: “${esc(L.textoElev)}”)`));
  return `<p class="aviso-lim"><b>Outside NASA’s PRELIMINARY limits for human landing sites:</b> ${partes.join('; ')}.
    <small>Source: ${enlazar(`${L.cita} ${L.url}`)}</small></p>`;
}

function renderDetail(s) {
  const bars = Object.entries(s.metrics).map(([k, v]) => [k, v, s.weights?.[k] ?? 0]).sort((a, b) => b[2] - a[2])
    .map(([k, v, w]) => `<div class="row"><span>${METRICS[k].icon} ${METRICS[k].short} <small>${Math.round(w * 100)}%</small>${s.real?.[k] ? ` <abbr class="pds" title="${esc(s.real[k])}">PDS</abbr>` : ''}</span>
      <div class="t"><i class="${v < 45 ? 'low' : v < 65 ? 'mid' : ''}" style="width:${v}%"></i></div><span class="v">${v}</span></div>`).join('');
  // Arriba, lo esencial (nombre, puntuación, descripción, entrenamiento, mapa y 4 datos clave en llano); todo lo demás,
  // sin quitar nada, plegado tras «Learn more» (masInfo de js/graficos/base.js) en bloques con título.
  const clave = (s.medidas ?? []).slice(0, 4);
  const masFicha = `
    <div data-g="corte"></div>
    <h4>Score by factor <span class="muted">(weight for your objective)</span></h4>
    ${radar(s.metrics)}
    <div class="bars">${bars}</div>
    ${Object.keys(s.real ?? {}).length ? '<p class="small muted"><abbr class="pds">PDS</abbr> = computed from measured data (hover to see how it is computed). The rest are demonstration estimates.</p>' : ''}
    ${s.medidas?.length ? `<h4>All NASA PDS measurements <span class="muted">(mean within a ≈ ${zonaKm()} km radius)</span></h4>
      <div class="facts">${s.medidas.map((m, i) => `<div class="fact"><small>${esc(m.nombre)} · ${esc(m.fuente)}</small><b>${esc(m.texto)}</b>${m.rango ? `<small class="rg">${esc(m.rango)}</small>` : ''}<span data-chispa="${i}"></span></div>`).join('')}</div>
      <p class="small muted">The histogram of each measurement covers the whole surface ${esc(CUERPO[mission.body].de)} with ${s.medidas.some((m) => m.derivada) ? 'data (the regional slope is not a published grid: it is derived from the MOLA elevation cell by cell)' : 'published data'}, and the mark is this site: “higher than 90 %” (the 90th percentile) means that 90 % of that surface has an equal or lower value. It tells whether the value is low or high for that body, not whether it is good or bad.</p>
      ${citas([...new Set(s.medidas.map((m) => m.cita).filter(Boolean))])}
      ${fichasMedidas(s)}` : ''}
    <h4>Reference data <span class="muted">(estimate)</span></h4><div class="facts">${(s.facts || []).map(([l, v]) => `<div class="fact"><small>${esc(l)}</small><b>${esc(v)}</b></div>`).join('')}</div>
    ${s.pros?.length ? `<h4>Advantages</h4><ul class="pc">${s.pros.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
    ${s.cons?.length ? `<h4>Risks</h4><ul class="pc con">${s.cons.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
    ${flujo.fichaHtml(s)}`;
  $('#detail-body').innerHTML = `
    <div class="d-head"><div class="ring" style="--p:${s.score}"><b>${s.score}</b></div>
      <div><span class="tag ${s.rank === 1 ? '' : 'gold'}">#${s.rank} OF ${sites.length}</span><h2>${esc(s.name)}</h2>
      <small>${esc(s.region)} · ${Math.abs(s.lat).toFixed(1)}°${s.lat >= 0 ? 'N' : 'S'} ${Math.abs(s.lon).toFixed(1)}°${s.lon >= 0 ? 'E' : 'W'}</small></div></div>
    ${ctaEntreno('btn-train', s)}
    <p class="desc">${esc(s.desc)}</p>
    ${limitesHtml(s)}
    <section class="ficha-graf" id="ficha-graf" aria-label="Surroundings from measured data"><p class="g-cargando" role="status">Drawing the surroundings from the relief data…</p></section>
    ${clave.length ? `<h4>Key facts <span class="muted">(NASA measurements)</span></h4>
      <div class="facts ficha-clave">${clave.map((m, i) => `<div class="fact"><small>${esc(m.nombre)}</small><b>${esc(m.texto)}</b><small class="llano" data-llano="${i}"></small></div>`).join('')}</div>
      <button type="button" class="btn ghost small-btn" id="btn-comparar-ficha">📊 Compare with the other sites</button>` : ''}
    ${masInfo(masFicha, 'ficha-mas')}
    <button type="button" class="btn ghost small-btn cta-arriba" id="btn-train-arriba">↑ Back to “Where to train on Earth?”</button>`;
  $('#btn-train').onclick = () => openTraining(s);
  $('#btn-train-arriba').onclick = () => {                       // vuelve arriba de la ficha y deja el foco en la llamada principal
    $('#detail').scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    $('#btn-train').focus({ preventScroll: true });
  };
  // Indicio con datos reales: cuántos análogos tiene precalculados este emplazamiento y el más próximo
  analogosPrecalculados(mission.body, s).then((d) => {
    const hueco = document.querySelector('#detail-body [data-pista]');
    if (!d?.analogos?.length || !hueco || current?.id !== s.id) return;
    hueco.innerHTML = pistaAnalogos(d);
  });
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
      const viejo = $('#detail-body')?.querySelector(`[data-g="${nombre}"]`);
      if (!viejo) return;
      const nuevo = viejo.cloneNode(false);
      viejo.replaceWith(nuevo);                                   // contenedor nuevo: los escuchas del pintado anterior se van con él
      try {
        mod.pintar(nuevo, { body, cuerpo: CUERPO[body], Rkm: RADIO_KM[body], sitio: s, cols: datos.cols, fila: datos.filas[0], exageracion: ex,
          estado: (estadoFicha[nombre] ??= {}), repintar: () => pintar(nombre, mod) });
      } catch (e) { console.error(`Gráfico «${nombre}»`, e); nuevo.innerHTML = '<p class="g-vacio">This chart could not be drawn.</p>'; }
    };
    cont.innerHTML = '<div data-g="entorno"></div>';                // el perfil (data-g="corte") está en «Learn more»
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
      const llano = document.querySelector(`#detail-body [data-llano="${i}"]`);   // la misma cifra, dicha en llano
      if (llano) { const p = percentil(c, m.valor); llano.textContent = p !== p ? '' : p < 0.005 ? `Among the lowest 1 % ${cuerpo.de}` : `Higher than ${p > 0.995 ? '99' : pctTxt(p)} % ${cuerpo.de}`; }
    } catch (e) { console.warn('Distribución no disponible', m.capa, e); }
  }
}

$('#detail-close').onclick = closeDetail;
async function closeDetail() {
  const id = current?.id;
  tipGrafico(null);
  $('#detail').hidden = true; $('#results').hidden = false; current = null;
  ctaResultados();
  document.querySelectorAll('#res-list li').forEach((li) => li.classList.remove('sel'));
  if (id) document.querySelector(`#res-list li[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });   // el foco vuelve a su fila
  await viewer.backToBody();
}

// ============================ ENTRENAMIENTO ================================
// Panel de la Tierra. Arriba, una sola historia para el público: el lugar de entrenamiento con nombre (js/data.js →
// ANALOGS, renderFamosos). Al final, plegado, lo que el motor de similitud encuentra en el relieve medido por NASA (en vivo
// o precalculado: js/api.js → analogosTierra): candidatos, ficha (js/graficos/analogo.js), NASA CMR e informe completo.
let entreno = { run: 0, ficha: 0, site: null, r: null, sel: 0, vista: null };

// El panel de la Tierra es ancho y ocupa el sitio del gráfico de propósitos (#perfil): al abrirlo, el gráfico se pliega
// como con su botón, y al cerrarlo vuelve a abrirse si estaba abierto
let perfilPlegado = false;
function restaurarPerfil() { if (perfilPlegado) { perfilPlegado = false; desplegarPerfil(); } }

async function openTraining(site) {
  $('#detail').hidden = true; $('#training').hidden = false; $('#layers').hidden = true; hideTip();
  if (plegarPerfil()) perfilPlegado = true;
  const run = entreno.run + 1, body = mission.body;
  entreno = { run, ficha: entreno.ficha, site, r: null, sel: 0, vista: null };
  // Una sola historia: el lugar de entrenamiento con nombre (renderFamosos → js/graficos/tierra-panel.js) y, plegadas
  // al final, las ventanas terrestres que encuentra el motor en el relieve de NASA (pintarAnalogos)
  $('#training-body').innerHTML = `
    <span class="tag">EARTH TRAINING</span>
    <h2 class="an-tit">Train on Earth for ${esc(site.name)}</h2>
    <div id="famosos-body" class="an-famosos"><p class="g-cargando" role="status">Loading…</p></div>
    <details class="an-plegable an-motor-plg" id="an-motor-plg"><summary>Places found by NASA terrain data</summary>
      <p class="g-pie">The places on Earth whose terrain is statistically closest to the ${num(200)} km around <b class="ink">${esc(site.name)}</b>
        (${NOMBRE_CUERPO[body]}), found by comparing NASA elevation data: ${body === 'moon' ? 'LRO LOLA' : 'MGS MOLA'} there, SRTM on Earth.
        They share the shape of the land, not its rocks, air or gravity.</p>
      <section id="an-motor" aria-live="polite"><p class="g-cargando" role="status">Searching Earth for the most similar terrain…</p></section></details>
    <button class="btn ghost cta" id="btn-train-back">← Back to the site</button>`;
  $('#btn-train-back').onclick = closeTraining;
  $('#training').scrollTop = 0;
  // el bloque del motor se construye al abrirlo (mapas, CMR y clima de su candidato: muchas peticiones)
  $('#an-motor-plg').addEventListener('toggle', (e) => { if (e.currentTarget.open && entreno.r) pintarAnalogos(); });
  viewer.onMotorClick = (id) => {                                 // pulsar un candidato en el globo abre su bloque
    const d = $('#an-motor-plg'), i = +String(id).split('-')[1] - 1;
    if (d && !d.open && entreno.r?.analogos[i]) { entreno.sel = i; d.open = true; d.scrollIntoView({ block: 'start' }); } else elegirAnalogo(i);
  };
  renderFamosos(site, 0);
  const clave = `${body}:${site.id}`;
  const llegan = (r) => {
    if (run !== entreno.run || !r.analogos?.length) return;
    // la respuesta en vivo puede llegar después de la precalculada: se conserva el candidato elegido
    entreno.r = r; entreno.sel = Math.min(entreno.sel, r.analogos.length - 1); motorCache.set(clave, r);
    pintarAnalogos();
  };
  if (motorCache.get(clave)?.origen?.tipo === 'motor') { llegan(motorCache.get(clave)); return; }
  analogosTierra(site, body, {
    alLlegar: llegan,
    alFallar: async (msg, est) => {
      if (run !== entreno.run) return;
      const box = $('#an-motor');
      if (box) box.innerHTML = `<p class="small muted">${!MOTOR_LOCAL ? 'The Earth analogs for this site are not available.'
        : !est ? 'No precomputed analogs for this site, and the similarity engine is not running. In a terminal: <code>cd base-planetaria && ../.venv/bin/python -m similitud servidor</code>'
        : !est.datos?.earth?.srtmgl30_teselas ? 'The SRTMGL30 Earth elevation model is missing (NASA Earthdata, requires Earthdata Login): <code>python -m similitud descargar-tierra</code>'
        : `The engine could not compute the analogs: ${esc(msg)}`}</p>`;
      if (!MOTOR_LOCAL && $('#an-motor-plg')) $('#an-motor-plg').hidden = true;   // web publicada: sin motor, sin bloque
    },
  });
}

// Lista de candidatos y ficha del elegido
function pintarAnalogos() {
  const { r, sel } = entreno, box = $('#an-motor');
  if (!box) return;
  const o = r.origen ?? {}, pre = o.tipo === 'precalculado';
  box.innerHTML = `
    <p class="an-origen${pre ? ' pre' : ''}"><i aria-hidden="true"></i>We compared this terrain with ${r.datos.catalogo.ventanas_validas.toLocaleString('en-US')} places on Earth, each ${num(r.parametros.lado_km)} km wide. These are the closest.</p>
    ${masInfo(`<p class="g-pie">${pre ? `Precomputed on ${fechaCorta(o.fecha)} by the similarity engine` : 'Computed live by the similarity engine'}: ${r.datos.catalogo.ventanas_validas.toLocaleString('en-US')} Earth land windows of ${num(r.parametros.lado_km)} km.</p>`)}
    ${listaCandidatos(r, sel)}
    <article class="an-ficha" id="an-ficha" aria-live="polite"></article>`;
  box.querySelectorAll('[data-cand]').forEach((b) => (b.onclick = () => elegirAnalogo(+b.dataset.cand)));
  if ($('#an-motor-plg')?.open) fichaAnalogo();
  else viewer.showMotorAnalogs(r.analogos);                       // plegado: solo los marcadores en el globo
}

function elegirAnalogo(i) {
  if (!entreno.r?.analogos[i] || $('#training').hidden) return;
  entreno.sel = i;
  if (!$('#an-motor-plg')?.open) return;
  document.querySelectorAll('#an-motor [data-cand]').forEach((b) => { const s = +b.dataset.cand === i; b.classList.toggle('sel', s); b.setAttribute('aria-pressed', String(s)); });
  fichaAnalogo();
  document.getElementById('an-ficha')?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

// (a) cabecera · (b) mapas · (c) criterios · (d) distribuciones · (e) se sostiene / falla · (f) NASA CMR · (g) método
function fichaAnalogo() {
  const { site, r, sel } = entreno, a = r.analogos[sel], el = $('#an-ficha'), tok = ++entreno.ficha;
  if (!el) return;
  const ctx = { sitio: site.name, sitioCorto: nombreCorto(site.name), rango: a.rango, body: mission.body };
  const nCat = r.datos.catalogo.ventanas_validas;
  const punto = { id: `tierra:${a.lat.toFixed(4)},${a.lon.toFixed(4)}`, name: `Earth match #${a.rango} · ${ll(a.lat, a.lon)}`, lat: a.lat, lon: a.lon };
  el.innerHTML = `
    <header class="an-cab"><span class="tag">EARTH MATCH #${a.rango} OF ${r.analogos.length}</span>
      <h3>${ll(a.lat, a.lon)}</h3>
      <small>${num(r.parametros.lado_km)} × ${num(r.parametros.lado_km)} km of land · ${esc(cercania(a))}</small>
      <p class="an-frase">${esc(frase(a, site.name))}</p>
      ${masInfo(`<p class="g-pie">${esc(frase(a, site.name, r.parametros.h_m / 1000))} ${esc(cercaniaTecnica(a, nCat))}.</p>`)}</header>
    <h4 class="an-paso">1 · Why it looks alike</h4>
    ${mapasHtml()}
    <div data-an-crit>${graficoCriterios(r, a, ctx)}</div>
    ${sostieneFalla(r, a, ctx)}
    <section class="an-clima"><h4 class="an-paso">2 · When to go: the weather here</h4><div data-an-clima></div></section>
    ${masInfo(`<div data-an-dist>${graficoDistribuciones(r, a, ctx)}</div>
    <section class="cmr" id="cmr" data-para="${esc(punto.id)}" aria-live="polite"><h4>NASA data for this point <span class="muted">· CMR</span></h4><p class="muted small">Querying the NASA Earthdata catalog…</p></section>
    <details class="an-plegable"><summary>Sources and method (full engine report)</summary><section class="motor" id="motor"></section></details>`, 'an-mas')}`;
  tipCriterios(el.querySelector('[data-an-crit]'), a, site.name);
  tipDistribuciones(el.querySelector('[data-an-dist]'), r, a, ctx);
  pintarMotor(site, r);
  const cctx = { body: r.objetivo.ventana.cuerpo, site, analogo: { lat: a.lat, lon: a.lon, rango: a.rango },
    lado_km: r.parametros.lado_km, buscar_en: r.datos.busqueda.cuerpo };
  const mapas = el.querySelector('[data-an-mapas]');
  comparacionTierra(cctx, {
    alLlegar: (comp) => { if (tok === entreno.ficha) pintarMapas(mapas, comp, { ...ctx, alAbrir: () => abrirComparacion(cctx) }); },
    alFallar: (msg) => { if (tok === entreno.ficha) mapas.innerHTML = `<p class="g-vacio">The relief maps could not be loaded (${esc(msg)}).</p>`; },
  });
  renderCmr(punto);
  pintarClima(el.querySelector('[data-an-clima]'), { analogo: punto, power: climaPower(a.lat, a.lon), cmr: earthSiteData(punto) }).catch((e) => console.warn('Clima', e));
  if (entreno.vista !== punto.id) { entreno.vista = punto.id; viewer.flyToEarth(punto); }   // borra los marcadores (síncrono)
  viewer.showMotorAnalogs(r.analogos.filter((x) => x !== a));     // el elegido ya lleva la estrella de flyToEarth
}

// Lugar de entrenamiento con nombre (rankAnalogs sobre las etiquetas escritas a mano en js/data.js): la historia principal
// del panel (js/graficos/tierra-panel.js): tarjeta, relieve, cuándo ir, otros lugares y qué entrenar; CMR completo en #cmr-fam
async function renderFamosos(site, pick = 0, desplazar = false) {
  const caja = () => document.getElementById('famosos-body');
  const list = await fetchTraining(site, mission);
  if (!caja() || entreno.site !== site) return list;
  const a = list[pick];
  const alGlobo = () => { entreno.vista = `fam:${a.id}`; viewer.flyToEarth(a); if (entreno.r) viewer.showMotorAnalogs(entreno.r.analogos); };
  pintarFamoso(caja(), {
    body: mission.body, sitio: site, lista: list, pick, desplazar,
    aviso: `Picked by hand from written traits, not by the engine: the % is a rough estimate.`,
    alElegir: (i) => { if (i !== pick) renderFamosos(site, i, true); },
    alGlobo,
  });
  renderCmr(a, 'cmr-fam');
  if (!$('#an-motor-plg')?.open) alGlobo();                        // el globo acompaña al lugar elegido
  return list;
}

// ---- motor científico de similitud geomorfológica (base-planetaria/similitud, opcional) ----------
const MOTOR_TIT = '<h4>Geomorphological analog report <span class="muted">· scientific engine</span></h4>';
const motorCache = new Map();                       // `${cuerpo}:${sitio}` → resultado completo del motor
const pct = (p) => `${(100 * p).toFixed(1)} %`;
const num = (x) => (x == null ? '—' : Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 1 ? x.toFixed(2) : x.toPrecision(2));
const ll = (lat, lon) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
const CLASE = { indistinguible: 'indistinguishable', muy_proxima: 'very close', proxima: 'close', distinta: 'different' };

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
      Effective sample size of the target ${nref(['bretherton1999'])}: ${Object.entries(v.dependencia_espacial_objetivo).map(([k, d]) => `${(CRIT[k]?.corto ?? k).toLowerCase()} ${num(d.n_efectivo)} of ${d.n_pixeles}`).join(' · ')}.</p>` : '';
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
    <p class="small muted">Challenge: <a href="${esc(r.recurso_oficial)}" target="_blank" rel="noopener">NASA Space Apps 2026, Resources tab</a> · computed in ${num(r.segundos)} s${r.origen?.tipo === 'precalculado' ? `, precomputed on ${fechaCorta(r.origen.fecha)}` : ''}.</p>
    <a class="btn ghost" id="motor-geojson" download="analogos_${esc(site.id)}.geojson">Download map (GeoJSON)</a>
    </div>`;
  box.querySelector('#motor-geojson').href = URL.createObjectURL(new Blob([JSON.stringify(r.geojson)], { type: 'application/geo+json' }));
  const comparar = (rango) => {
    const a = r.analogos.find((x) => x.rango === rango);
    if (a) abrirComparacion({ body: r.objetivo.ventana.cuerpo, site, analogo: { lat: a.lat, lon: a.lon, rango },
      lado_km: r.parametros.lado_km, buscar_en: r.datos.busqueda.cuerpo });
  };
  box.querySelectorAll('[data-cmp]').forEach((b) => (b.onclick = () => comparar(+b.dataset.cmp)));
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

async function renderCmr(a, id = 'cmr') {
  const box = () => document.getElementById(id);
  try {
    const d = await earthSiteData(a);
    if (!box() || box().dataset.para !== a.id) return;           // el usuario eligió otro lugar
    const img = d.image;
    const cap = img.date ? `${img.sensor} · ${fmtDate(img.date)} · ${Math.round(img.cloud)} % cloud` : `${img.sensor} · recent image`;
    box().innerHTML = `<h4>NASA data for this point <span class="muted">· CMR</span></h4>
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
    if (box()?.dataset.para === a.id) box().innerHTML = '<h4>NASA data for this point</h4><p class="small muted">NASA CMR could not be queried (offline?).</p>';
  }
}

$('#training-close').onclick = closeTraining;
async function closeTraining() {
  const s = current; tipGrafico(null); $('#training').classList.remove('tr-min'); $('#training').hidden = true; viewer.clearAnalogs(); restaurarPerfil();
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
  $('#setup').hidden = false; step = 1; maxStep = 1; mission.body = mission.objective = null; current = null; perfilPlegado = false;
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
  // En escritorio el panel de la Tierra es ancho (css/g-tierra.css): el globo se centra en el hueco que queda a la izquierda
  const tr = $('#training');
  viewer.shiftX = !MOVIL.matches && !tr.hidden ? -(tr.getBoundingClientRect().width + 16) / (2 * innerWidth) : 0;
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
