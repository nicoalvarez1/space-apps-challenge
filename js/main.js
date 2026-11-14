import { BODIES, OBJECTIVES, DURATIONS, METRICS, TRAIT_LABELS } from './data.js';
import { fetchSites, fetchTraining } from './api.js';
import { Viewer } from './scene.js';
import { earthSiteData } from './cmr.js';
import { CAPAS_GLOBO, RAMPAS, RADIO_KM, RADIO_ZONA, capa, pintarCapa } from './capas.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const viewer = new Viewer($('#stage'), $('#markers'));

// Estado de carga de los modelos (texturas NASA de varios MB)
viewer.onProgress = (p) => {
  $('#load-bar').style.width = `${Math.round(p * 100)}%`;
  $('#load-text').textContent = `Cargando modelos de la NASA… ${Math.round(p * 100)} %`;
};
viewer.worldsReady.then(() => {
  const nasa = viewer.manifest ? `texturas NASA · calidad ${viewer.quality === 'hi' ? '8K' : '4K'}` : 'texturas procedurales (ejecuta tools/build_textures.py)';
  $('#load-bar').style.width = '100%'; $('#load-text').textContent = `✔ Tierra, Luna y Marte listos · ${nasa}`;
  $('#load-status').classList.add('done');
  if (viewer.credits) $('#credits').innerHTML = `<b>Datos e imágenes:</b> ${Object.values(viewer.credits).join(' · ')}`;
}).catch((e) => { console.error(e); $('#load-text').textContent = 'No se pudieron cargar algunos modelos'; });
const mission = { body: null, objective: null, crew: 6, duration: 'long' };
let step = 1, sites = [], current = null, runId = 0;

// ============================ ASISTENTE ====================================
function renderSetup() {
  $('#g-body').innerHTML = Object.values(BODIES).map((b) => `
    <button class="opt big ${mission.body === b.id ? 'sel' : ''}" data-body="${b.id}">
      <span class="ico">${b.id === 'moon' ? '🌕' : '🔴'}</span><b>${b.name}</b>
      <small>${b.tagline}<br>Gravedad ${b.gravity} · ${b.temp}</small><small style="margin-top:.4rem">${b.blurb}</small>
    </button>`).join('');
  $('#g-obj').innerHTML = Object.values(OBJECTIVES).map((o) => `
    <button class="opt ${mission.objective === o.id ? 'sel' : ''}" data-obj="${o.id}">
      <span class="ico">${o.icon}</span><b>${o.name}</b><small>${o.desc}</small></button>`).join('');
  $('#g-dur').innerHTML = Object.values(DURATIONS).map((d) => `<button data-dur="${d.id}" class="${mission.duration === d.id ? 'sel' : ''}">${d.name}</button>`).join('');
  $('#crew-val').textContent = mission.crew;
  document.querySelectorAll('[data-step]').forEach((el) => (el.hidden = +el.dataset.step !== step));
  document.querySelectorAll('#steps i').forEach((el, i) => el.classList.toggle('on', i < step));
  $('#btn-back').disabled = step === 1;
  const ok = step === 1 ? mission.body : step === 2 ? mission.objective : true;
  $('#btn-next').disabled = !ok;
  $('#btn-next').textContent = step === 3 ? '🚀 Lanzar simulación' : 'Siguiente →';
  if (step === 3) {
    const b = BODIES[mission.body], o = OBJECTIVES[mission.objective];
    $('#summary').innerHTML = `Misión a <b>${b.name}</b> · <b>${o.name}</b><br>Tripulación de <b>${mission.crew}</b> durante <b>${DURATIONS[mission.duration].name}</b>.<br>
      Se analizarán datos reales de ${b.layers.length} instrumentos: ${b.layers.map((l) => l.split(' (')[0]).join(', ')}.`;
  }
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
$('#btn-next').onclick = () => { if (step < 3) { step++; renderSetup(); } else launch(); };
$('#btn-new').onclick = resetMission;
$('#btn-skip').onclick = () => { if (viewer.tween && viewer.mode === 'flight') viewer.tween.t0 = performance.now() - viewer.tween.dur; };

// ============================ SIMULACIÓN ===================================
const fmtKm = (km) => (km >= 1e6 ? (km / 1e6).toFixed(1) + ' M km' : Math.round(km).toLocaleString('es-ES') + ' km');

async function launch() {
  const id = ++runId, b = BODIES[mission.body], o = OBJECTIVES[mission.objective];
  $('#setup').hidden = true; $('#hud').hidden = false;
  $('#chips').innerHTML = `<span class="chip">Destino <b>${b.name}</b></span><span class="chip">Objetivo <b>${o.name}</b></span>
    <span class="chip">Tripulación <b>${mission.crew}</b></span><span class="chip">Estancia <b>${DURATIONS[mission.duration].name}</b></span>`;
  $('#flight').hidden = false; $('#btn-skip').hidden = false;
  $('#f-layers').textContent = '—'; $('#f-phase').textContent = `Trayectoria ${b.travel}`;
  const sitesPromise = fetchSites(mission);
  $('#f-state').textContent = 'Cargando modelo…';
  await viewer.ready;

  await viewer.flyToBody(mission.body, {
    duration: mission.body === 'mars' ? 9 : 7,
    onProgress: (t, remaining) => {
      $('#f-bar').style.width = `${t * 70}%`;
      $('#f-dist').textContent = fmtKm(b.distanceKm * remaining);
      $('#f-state').textContent = t < 0.2 ? 'Inyección translunar'.replace('translunar', mission.body === 'mars' ? 'transmarciana' : 'translunar') : t < 0.8 ? 'Crucero' : 'Inserción orbital';
    },
  });
  if (id !== runId) return;

  // Análisis de capas de datos
  $('#btn-skip').hidden = true; $('#f-phase').textContent = `Analizando la superficie de ${b.name}`;
  $('#f-dist').textContent = 'En órbita'; $('#f-state').textContent = 'Escaneo multicapa';
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

function showResults() {
  const b = BODIES[mission.body];
  $('#res-sub').textContent = `${sites.length} regiones analizadas · ${OBJECTIVES[mission.objective].name}`;
  $('#res-list').innerHTML = sites.map((s, i) => `
    <li data-id="${s.id}" style="--d:${i * 90}ms">
      <span class="rk">${s.rank}</span>
      <div class="nm"><b>${esc(s.name)}</b><small>${esc(s.region)}</small><div class="mini"><i style="width:${s.score}%"></i></div></div>
      <span class="sc">${s.score}</span></li>`).join('');
  $('#res-layers').innerHTML = `<b>Capas:</b> ${b.layers.join(' · ')}`;
  $('#results').hidden = false;
  const real = sites.some((s) => Object.keys(s.real ?? {}).length);
  $('#data-badge').textContent = real ? 'PDS + ESTIMACIONES' : 'DATOS DEMO';
  $('#data-badge').title = real ? 'Terreno, hielo, térmica y recursos se calculan con datos medidos (NASA PDS). Solar, radiación, enlace y ciencia son estimaciones de demostración.'
    : 'No se pudieron cargar las capas del PDS: todas las puntuaciones son estimaciones de demostración.';
  $('#layers').hidden = !viewer.bodies[mission.body]?.surfaceMat; renderLayers();
  viewer.setSites(sites, selectSite);
  viewer.controls.autoRotate = true;
  toast(`Mejor emplazamiento: ${sites[0].name}`);
}

$('#res-list').addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) selectSite(li.dataset.id); });

async function selectSite(id) {
  const s = sites.find((x) => x.id === id); if (!s) return;
  current = s;
  document.querySelectorAll('#res-list li').forEach((li) => li.classList.toggle('sel', li.dataset.id === id));
  $('#training').hidden = true; viewer.clearAnalogs();
  renderDetail(s); $('#results').hidden = true; $('#detail').hidden = false;
  await viewer.focusSite(s);
}

function radar(metrics) {
  const keys = Object.keys(METRICS), n = keys.length, c = 120, R = 82;
  const pt = (i, v) => { const a = -Math.PI / 2 + (i / n) * Math.PI * 2; return [c + Math.cos(a) * R * v / 100, c + Math.sin(a) * R * v / 100]; };
  const grid = [25, 50, 75, 100].map((l) => `<polygon points="${keys.map((_, i) => pt(i, l).join(',')).join(' ')}" fill="none" stroke="rgba(160,190,255,.15)"/>`).join('');
  const axes = keys.map((k, i) => { const [x, y] = pt(i, 100), [lx, ly] = pt(i, 122);
    return `<line x1="${c}" y1="${c}" x2="${x}" y2="${y}" stroke="rgba(160,190,255,.12)"/><text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle">${METRICS[k].short}</text>`; }).join('');
  const poly = keys.map((k, i) => pt(i, metrics[k]).join(',')).join(' ');
  return `<svg class="radar" viewBox="0 0 240 240" width="240" height="240" role="img" aria-label="Gráfico de radar de factores">${grid}${axes}
    <polygon points="${poly}" fill="rgba(93,255,208,.25)" stroke="#5dffd0" stroke-width="2"/></svg>`;
}

function renderDetail(s) {
  const bars = Object.entries(s.metrics).map(([k, v]) => [k, v, s.weights?.[k] ?? 0]).sort((a, b) => b[2] - a[2])
    .map(([k, v, w]) => `<div class="row"><span>${METRICS[k].icon} ${METRICS[k].short} <small>${Math.round(w * 100)}%</small>${s.real?.[k] ? ` <abbr class="pds" title="${esc(s.real[k])}">PDS</abbr>` : ''}</span>
      <div class="t"><i class="${v < 45 ? 'low' : v < 65 ? 'mid' : ''}" style="width:${v}%"></i></div><span class="v">${v}</span></div>`).join('');
  $('#detail-body').innerHTML = `
    <div class="d-head"><div class="ring" style="--p:${s.score}"><b>${s.score}</b></div>
      <div><span class="tag ${s.rank === 1 ? '' : 'gold'}">#${s.rank} DE ${sites.length}</span><h2>${esc(s.name)}</h2>
      <small>${esc(s.region)} · ${Math.abs(s.lat).toFixed(1)}°${s.lat >= 0 ? 'N' : 'S'} ${Math.abs(s.lon).toFixed(1)}°${s.lon >= 0 ? 'E' : 'O'}</small></div></div>
    <p class="desc">${esc(s.desc)}</p>
    ${radar(s.metrics)}
    ${s.medidas?.length ? `<h4>Mediciones NASA PDS <span class="muted">(media en ≈ ${zonaKm()} km de radio)</span></h4>
      <div class="facts">${s.medidas.map((m) => `<div class="fact"><small>${esc(m.nombre)} · ${esc(m.fuente)}</small><b>${esc(m.texto)}</b>${m.rango ? `<small class="rg">${esc(m.rango)}</small>` : ''}</div>`).join('')}</div>` : ''}
    <h4>Datos de referencia <span class="muted">(estimación)</span></h4><div class="facts">${(s.facts || []).map(([l, v]) => `<div class="fact"><small>${esc(l)}</small><b>${esc(v)}</b></div>`).join('')}</div>
    <h4>Factores para tu objetivo <span class="muted">(peso)</span></h4><div class="bars">${bars}</div>
    ${Object.keys(s.real ?? {}).length ? '<p class="small muted"><abbr class="pds">PDS</abbr> = calculado con datos medidos (pasa el cursor para ver la fórmula). El resto son estimaciones de demostración.</p>' : ''}
    ${s.pros?.length ? `<h4>Ventajas</h4><ul class="pc">${s.pros.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
    ${s.cons?.length ? `<h4>Riesgos</h4><ul class="pc con">${s.cons.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
    <button class="btn primary cta" id="btn-train">🌍 ¿Dónde entrenar en la Tierra?</button>`;
  $('#btn-train').onclick = () => openTraining(s);
  $('#detail').scrollTop = 0;
}

$('#detail-close').onclick = closeDetail;
async function closeDetail() {
  $('#detail').hidden = true; $('#results').hidden = false; current = null;
  document.querySelectorAll('#res-list li').forEach((li) => li.classList.remove('sel'));
  await viewer.backToBody();
}

// ============================ ENTRENAMIENTO ================================
async function openTraining(site, pick = 0) {
  $('#detail').hidden = true; $('#training').hidden = false; $('#layers').hidden = true;
  $('#training-body').innerHTML = `<p class="muted">Buscando el análogo terrestre más parecido a ${esc(site.name)}…</p>`;
  const list = await fetchTraining(site, mission);
  const a = list[pick];
  $('#training-body').innerHTML = `
    <span class="tag">ENTRENAMIENTO RECOMENDADO</span>
    <h2 style="margin:.2rem 0 .1rem">${esc(a.name)}</h2><small class="muted">${esc(a.country)} · ${Math.abs(a.lat).toFixed(1)}°${a.lat >= 0 ? 'N' : 'S'} ${Math.abs(a.lon).toFixed(1)}°${a.lon >= 0 ? 'E' : 'O'}</small>
    <div class="match" style="margin-top:.8rem"><b>${a.match}%</b><span class="muted">de similitud con ${esc(site.name)}</span></div>
    <p class="desc">${esc(a.desc)}</p>
    <section class="cmr" id="cmr" aria-live="polite"><h4>Datos NASA del lugar <span class="muted">· CMR</span></h4><p class="muted small">Consultando el catálogo de NASA Earthdata…</p></section>
    <h4>Qué comparten</h4><div class="traits">${a.shared.map((t) => `<span>${esc(TRAIT_LABELS[t] || t)}</span>`).join('')}</div>
    <h4>Programa de entrenamiento</h4><ul class="acts">${a.activities.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <div class="facts" style="margin-top:1rem"><div class="fact"><small>Mejor época</small><b>${esc(a.season)}</b></div><div class="fact"><small>Acceso</small><b>${esc(a.access)}</b></div></div>
    <h4>Otras alternativas</h4>
    ${list.map((x, i) => `<button class="alt ${i === pick ? 'sel' : ''}" data-i="${i}"><span>${esc(x.name)}</span><span>${x.match}%</span></button>`).join('')}
    <button class="btn ghost cta" id="btn-train-back">← Volver al emplazamiento</button>`;
  $('#training-body').querySelectorAll('.alt').forEach((b) => (b.onclick = () => { if (+b.dataset.i !== pick) openTraining(site, +b.dataset.i); }));
  $('#btn-train-back').onclick = closeTraining;
  $('#training').scrollTop = 0;
  renderCmr(a);
  await viewer.flyToEarth(a);
}

// ---- datos reales de NASA CMR para el lugar de entrenamiento -------------
const MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const fmtDate = (d) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });

function clearChart(months) {
  const W = 300, H = 92, top = 8, base = 70, bw = W / 12;
  const bars = months.map((m, i) => {
    const x = i * bw + 1, w = bw - 2;                         // 2px de separación entre barras
    const label = `<text x="${x + w / 2}" y="${H - 8}" text-anchor="middle">${MES[i][0]}</text>`;
    if (m.total < 3) return `<g><title>${MES[i]}: sin pasadas suficientes (noche polar o sin datos)</title>
      <rect x="${x}" y="${base - 2}" width="${w}" height="2" class="nodata"/>${label}</g>`;
    const r = m.clear / m.total, h = Math.max(2, r * (base - top));
    return `<g tabindex="0"><title>${MES[i]}: ${Math.round(r * 100)} % despejadas (${m.clear} de ${m.total} pasadas)</title>
      <rect x="${x}" y="${top}" width="${w}" height="${base - top}" class="hit"/>
      <path d="M${x},${base}V${base - h + 4}q0,-4 4,-4h${w - 8}q4,0 4,4V${base}Z" class="bar"/>${label}</g>`;
  }).join('');
  return `<svg class="mchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Porcentaje de pasadas de satélite despejadas por mes">
    <line x1="0" x2="${W}" y1="${base}" y2="${base}" class="axis"/>${bars}</svg>`;
}

async function renderCmr(a) {
  const box = () => document.getElementById('cmr');
  try {
    const d = await earthSiteData(a);
    if (!box() || $('#training-body h2')?.textContent !== a.name) return;   // el usuario cambió de lugar
    const img = d.image;
    const cap = img.date ? `${img.sensor} · ${fmtDate(img.date)} · nubes ${Math.round(img.cloud)} %` : `${img.sensor} · imagen reciente`;
    box().innerHTML = `<h4>Datos NASA del lugar <span class="muted">· CMR</span></h4>
      <figure class="sat"><a href="${img.src}" target="_blank" rel="noopener"><img src="${img.src}" alt="Última imagen de satélite despejada de ${esc(a.name)}" loading="lazy"></a>
        <figcaption>${esc(cap)}${img.id ? ` · <code>${esc(img.id)}</code>` : ''}</figcaption></figure>
      ${d.scenes ? `<div class="facts"><div class="fact"><small>Pasadas Landsat/Sentinel-2 (24 meses)</small><b>${d.scenes}</b></div>
        <div class="fact"><small>Despejadas (&lt; 15 % nubes)</small><b>${d.clearPct} %</b></div></div>
        <p class="small muted" style="margin:.8rem 0 .2rem">Cielo despejado por mes · mejor: <b class="ink">${d.bestMonths.map((m) => MES[m]).join(', ') || '—'}</b></p>
        ${clearChart(d.months)}` : '<p class="small muted">Sin cobertura Landsat/Sentinel-2 (HLS) en esta latitud; imagen de MODIS.</p>'}
      ${d.dem ? `<figure class="sat dem"><img src="${d.dem}" alt="Relieve ASTER GDEM" loading="lazy"><figcaption>Relieve · ASTER GDEM v3${d.demId ? ` · <code>${esc(d.demId)}</code>` : ''}</figcaption></figure>` : ''}
      ${d.lstLast ? `<p class="small muted">Temperatura de superficie MODIS (MOD11A1): ${d.lstDays.toLocaleString('es-ES')} días de datos, último el ${fmtDate(d.lstLast)}.</p>` : ''}`;
  } catch (e) {
    console.warn('CMR no disponible', e);
    if (box()) box().innerHTML = '<h4>Datos NASA del lugar</h4><p class="small muted">No se pudo consultar NASA CMR (¿sin conexión?).</p>';
  }
}

$('#training-close').onclick = closeTraining;
async function closeTraining() {
  const s = current; $('#training').hidden = true; viewer.clearAnalogs();
  $('#layers').hidden = !viewer.bodies[mission.body]?.surfaceMat;
  if (s) { renderDetail(s); $('#detail').hidden = false; await viewer.backToBody(); await viewer.focusSite(s); }
}

// ============================ CAPAS DE DATOS ===============================
// Proyecta sobre el globo una capa real del PDS y muestra su leyenda; el cursor lee el valor de la celda.
let layer = null, layerRun = 0, probeRaf = 0;
const zonaKm = () => Math.round(RADIO_ZONA * (Math.PI / 180) * RADIO_KM[mission.body]);
const coord = (lat, lon) => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'O'}`;
const PROBE_HINT = 'Pasa el cursor por el globo para leer el valor';

function renderLayers() {
  $('#layer-list').innerHTML = (CAPAS_GLOBO[mission.body] ?? []).map((d) =>
    `<button data-layer="${d.id}" class="${layer?.def.id === d.id ? 'sel' : ''}" aria-pressed="${layer?.def.id === d.id}">${d.corto}</button>`).join('');
  $('#legend').hidden = !layer;
  if (!layer) return;
  const { def, capa: c, min, max } = layer, m = c.meta;
  $('#legend').innerHTML = `<b>${esc(m.nombre)}</b>
    <div class="lg-bar" style="background:linear-gradient(90deg, ${RAMPAS[def.rampa].join(', ')})"></div>
    <div class="lg-ends"><span>≤ ${esc(def.fmt(min))}</span><span>≥ ${esc(def.fmt(max))}</span></div>
    <div class="lg-probe" id="lg-probe">${PROBE_HINT}</div>
    <small>${esc(m.fuente.mision)} · ${esc(m.resolucion)}. Escala entre los percentiles 2 y 98; sin dato = sin color.</small>`;
}

async function setLayer(id) {
  const body = mission.body, def = CAPAS_GLOBO[body]?.find((d) => d.id === id), run = ++layerRun;
  if (!def) return;
  if (layer?.def.id === id) { layer = null; viewer.setOverlay(body, null); renderLayers(); return; }
  document.querySelector(`[data-layer="${id}"]`)?.classList.add('busy');
  try {
    const c = await capa(id);
    if (run !== layerRun || mission.body !== body) return;
    const p = pintarCapa(c, def.rampa);
    if (viewer.setOverlay(body, p.canvas)) layer = { def, capa: c, min: p.min, max: p.max };
  } catch (e) { console.warn('Capa no disponible', e); toast('No se pudo cargar la capa de datos'); }
  if (run === layerRun) renderLayers();
}

$('#layer-list').addEventListener('click', (e) => { const b = e.target.closest('[data-layer]'); if (b) setLayer(b.dataset.layer); });
$('#stage').addEventListener('pointermove', (e) => {
  if (!layer || probeRaf) return;
  probeRaf = requestAnimationFrame(() => {
    probeRaf = 0; const el = document.getElementById('lg-probe'); if (!el || !layer) return;
    const p = viewer.probe(e.clientX, e.clientY);
    if (!p) { el.textContent = PROBE_HINT; return; }
    const v = layer.capa.en(p.lat, p.lon);
    el.innerHTML = `${coord(p.lat, p.lon)} · <b>${v === v ? esc(layer.def.fmt(v)) : 'sin dato'}</b>`;
  });
});

// ============================ UTILIDADES ===================================
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3500); }

function resetMission() {
  runId++; viewer.tween = null;
  viewer.clearSites(); viewer.clearAnalogs(); viewer.setIntro();
  if (layer) { viewer.setOverlay(mission.body, null); layer = null; } layerRun++;
  ['#hud', '#flight', '#results', '#detail', '#training', '#layers'].forEach((s) => ($(s).hidden = true));
  $('#setup').hidden = false; step = 1; mission.body = mission.objective = null; current = null; renderSetup();
}

addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#training').hidden) closeTraining(); else if (!$('#detail').hidden) closeDetail();
});

renderSetup();

// Depuración desde la consola del navegador: window.landfall.viewer
window.landfall = { viewer, mission };
