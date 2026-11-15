// ============================================================================
//  COMPARACIÓN DETALLADA objetivo (Luna/Marte) ↔ lugar terrestre
//  Pide al motor (base-planetaria/similitud/comparacion.py) el análisis multiescala de un par y lo muestra:
//  mapas a la misma escala, distribuciones acumuladas, variogramas, pruebas por escala y fuentes.
//  Colores: serie 1 (objetivo) y serie 2 (Tierra) = primeros huecos categóricos del modo oscuro;
//  relieve relativo = divergente azul–gris–rojo; pendiente = secuencial azul.
// ============================================================================
import { fetchComparacion } from './api.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enlazar = (t) => esc(t).replace(/(https?:\/\/[^\s<]+[^\s<.,;)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
const num = (x, d = 3) => (x == null || !Number.isFinite(x) ? '—' : Math.abs(x) >= 1000 ? x.toFixed(0) : Number(x.toPrecision(d)).toString());
const km = (m) => `${num(m / 1000)} km`;
const ll = (lat, lon) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
const CUERPO = { moon: 'Moon', mars: 'Mars', earth: 'Earth' };
const COL = { obj: '#3987e5', tie: '#d95926' };
const VERED = {
  compatibles: { icon: '✓', txt: 'compatible', cls: 'ok' },
  distintas: { icon: '✕', txt: 'different', cls: 'bad' },
  no_concluyente: { icon: '?', txt: 'inconclusive', cls: 'warn' },
  dentro: { icon: '✓', txt: 'within ref.', cls: 'ok' },
  fuera: { icon: '△', txt: 'outside ref.', cls: 'warn' },
};
const cache = new Map();

// ---------------------------------------------------------------------------- color
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mezcla = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const DIV = [hex('#3987e5'), hex('#383835'), hex('#e66767')];
const SEQ = ['#0d366b', '#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'].map(hex);
function colorDiv(v, lim) { const t = Math.max(-1, Math.min(1, v / lim)); return t < 0 ? mezcla(DIV[1], DIV[0], -t) : mezcla(DIV[1], DIV[2], t); }
function colorSeq(v, lim) {
  const t = Math.max(0, Math.min(1, v / lim)) * (SEQ.length - 1), i = Math.min(SEQ.length - 2, Math.floor(t));
  return mezcla(SEQ[i], SEQ[i + 1], t - i);
}

// ---------------------------------------------------------------------------- mapas
function percentil(arrs, p) {
  const v = arrs.flat(2).filter((x) => x != null).map(Math.abs).sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : 1;
}

function sombreado(g, celda) {                       // iluminación desde el NO, 45° de altura (solo visual)
  const n = g.length, out = g.map((f) => f.map(() => 1));
  const az = (315 * Math.PI) / 180, alt = Math.PI / 4;
  for (let i = 1; i < n - 1; i++) for (let j = 1; j < n - 1; j++) {
    const z = (a, b) => g[a][b];
    if ([z(i - 1, j), z(i + 1, j), z(i, j - 1), z(i, j + 1)].some((x) => x == null)) continue;
    const dx = (z(i, j + 1) - z(i, j - 1)) / (2 * celda), dy = (z(i - 1, j) - z(i + 1, j)) / (2 * celda);
    const pend = Math.atan(Math.hypot(dx, dy)), asp = Math.atan2(dy, -dx);
    out[i][j] = Math.max(0, Math.cos(alt) * Math.cos(pend) + Math.sin(alt) * Math.sin(pend) * Math.cos(az - Math.PI / 2 - asp));
  }
  return out;
}

function pintarMapa(canvas, g, modo, lim, celda, relieve) {
  const n = g.length, ctx = canvas.getContext('2d');
  canvas.width = n; canvas.height = n;
  const img = ctx.createImageData(n, n), hs = relieve ? sombreado(relieve, celda) : null;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = g[i][j], k = (i * n + j) * 4;
    if (v == null) { img.data.set([26, 26, 25, 255], k); continue; }
    let c = modo === 'elev_rel' ? colorDiv(v, lim) : colorSeq(v, lim);
    if (hs) { const f = 0.55 + 0.45 * hs[i][j]; c = c.map((x) => Math.round(x * f)); }
    img.data.set([...c, 255], k);
  }
  ctx.putImageData(img, 0, 0);
}

function barraColor(modo, lim, uni) {
  const stops = modo === 'elev_rel' ? [DIV[0], DIV[1], DIV[2]] : SEQ;
  const grad = stops.map((c, i) => `rgb(${c}) ${(100 * i) / (stops.length - 1)}%`).join(', ');
  const ticks = modo === 'elev_rel' ? [`−${num(lim)}`, '0', `+${num(lim)}`] : ['0', num(lim / 2), `≥ ${num(lim)}`];
  return `<div class="cmp-bar" style="background:linear-gradient(90deg, ${grad})"></div>
    <div class="cmp-ticks">${ticks.map((t) => `<span>${t} ${uni}</span>`).join('')}</div>`;
}

// ---------------------------------------------------------------------------- gráficos SVG
function ejes(W, H, m, xs, ys, xlab, ylab, fx = num, fy = num) {
  const xt = xs.ticks.map((t) => `<g><line x1="${xs.f(t)}" x2="${xs.f(t)}" y1="${m.t}" y2="${H - m.b}" class="grid"/>
    <text x="${xs.f(t)}" y="${H - m.b + 14}" text-anchor="middle">${fx(t)}</text></g>`).join('');
  const yt = ys.ticks.map((t) => `<g><line x1="${m.l}" x2="${W - m.r}" y1="${ys.f(t)}" y2="${ys.f(t)}" class="grid"/>
    <text x="${m.l - 6}" y="${ys.f(t) + 3}" text-anchor="end">${fy(t)}</text></g>`).join('');
  return `${xt}${yt}<text x="${(W + m.l - m.r) / 2}" y="${H - 4}" text-anchor="middle" class="lab">${esc(xlab)}</text>
    <text x="12" y="${(H - m.b + m.t) / 2}" text-anchor="middle" class="lab" transform="rotate(-90 12 ${(H - m.b + m.t) / 2})">${esc(ylab)}</text>`;
}

function ticksRedondos(min, max, n = 4) {
  const span = max - min || 1, crudo = span / n, mag = 10 ** Math.floor(Math.log10(crudo));
  const paso = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((x) => x >= crudo);
  const out = [];
  for (let v = Math.ceil(min / paso) * paso; v <= max + 1e-9 * span; v += paso) out.push(Number(v.toPrecision(12)));
  return out;
}

function escala(min, max, a, b, n = 4, log = false) {
  if (max === min) { max = min + 1; }
  const f = (v) => a + ((v - min) / (max - min)) * (b - a);
  const ticks = log ? Array.from({ length: Math.floor(max) - Math.ceil(min) + 1 }, (_, i) => Math.ceil(min) + i) : ticksRedondos(min, max, n);
  return { f, ticks, min, max };
}

const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const potencia = (t) => `10${String(t).split('').map((c) => SUP[c]).join('')}`;

function graficoCdf(id, d, vered) {
  const W = 300, H = 170, m = { l: 44, r: 10, t: 10, b: 32 };
  const todos = [...d.objetivo, ...d.candidato];
  const lo = Math.min(...todos), hi = Math.max(...todos);
  const xs = escala(lo, hi, m.l, W - m.r), ys = escala(0, 1, H - m.b, m.t);
  const u = d.objetivo.map((_, i) => i / (d.objetivo.length - 1));
  const linea = (q) => q.map((v, i) => `${i ? 'L' : 'M'}${xs.f(v).toFixed(1)},${ys.f(u[i]).toFixed(1)}`).join('');
  return `<figure class="cmp-fig"><figcaption>${esc(d.nombre)} ${vered}</figcaption>
    <svg viewBox="0 0 ${W} ${H}" class="cmp-svg" data-cdf="${id}" role="img" aria-label="Cumulative distribution of ${esc(d.nombre)} in the two regions">
      ${ejes(W, H, m, xs, ys, d.unidades, 'cumulative fraction', (t) => num(t, 2), (t) => num(t, 2))}
      <path d="${linea(d.objetivo)}" class="ln" stroke="${COL.obj}"/><path d="${linea(d.candidato)}" class="ln" stroke="${COL.tie}"/>
      <line class="xh" x1="${m.l}" x2="${W - m.r}" y1="0" y2="0" visibility="hidden"/>
      <rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}"/>
    </svg></figure>`;
}

function graficoVariograma(v) {
  const W = 300, H = 190, m = { l: 48, r: 10, t: 10, b: 32 };
  const pts = (s) => s.r_m.map((r, i) => [r, s.gamma_m2[i]]).filter(([r, g]) => r > 0 && g > 0);
  const a = pts(v.objetivo), b = pts(v.candidato), todos = [...a, ...b];
  const lx = todos.map(([r]) => Math.log10(r)), ly = todos.map(([, g]) => Math.log10(g));
  const xs = escala(Math.min(...lx), Math.max(...lx), m.l, W - m.r, 4, true), ys = escala(Math.min(...ly), Math.max(...ly), H - m.b, m.t, 4, true);
  const p = (s) => s.map(([r, g], i) => `${i ? 'L' : 'M'}${xs.f(Math.log10(r)).toFixed(1)},${ys.f(Math.log10(g)).toFixed(1)}`).join('');
  const dots = (s, c, k) => s.map(([r, g]) => `<circle cx="${xs.f(Math.log10(r))}" cy="${ys.f(Math.log10(g))}" r="4" fill="${c}" class="dot">
    <title>${k}: γ(${km(r)}) = ${num(g)} m²</title></circle>`).join('');
  return `<figure class="cmp-fig"><figcaption>Semivariogram γ(r) · log–log scale</figcaption>
    <svg viewBox="0 0 ${W} ${H}" class="cmp-svg" role="img" aria-label="Semivariogram of the two regions">
      ${ejes(W, H, m, xs, ys, 'distance r (km)', 'γ (m²)', (t) => num(10 ** t / 1000, 2), potencia)}
      <path d="${p(a)}" class="ln" stroke="${COL.obj}"/><path d="${p(b)}" class="ln" stroke="${COL.tie}"/>
      ${dots(a, COL.obj, 'Target')}${dots(b, COL.tie, 'Earth')}
    </svg></figure>`;
}

// ---------------------------------------------------------------------------- panel
function chip(v) { const x = VERED[v] ?? { icon: '·', txt: v ?? '—', cls: '' }; return `<span class="vchip ${x.cls}">${x.icon} ${x.txt}</span>`; }

function render(el, r, ctx) {
  const P = r.parametros, V = r.visual, e0 = r.escalas.find((e) => e.variables);
  const leyenda = `<div class="cmp-ley"><span><i style="background:${COL.obj}"></i>Target · ${CUERPO[r.objetivo.cuerpo]}</span>
    <span><i style="background:${COL.tie}"></i>Candidate · ${CUERPO[r.candidato.cuerpo]}</span></div>`;
  const filaEscala = (e) => (e.variables ? `<tr><th>${km(e.h_m)}<br><small class="muted">${e.celdas_por_lado}² cells</small></th>
      ${Object.values(e.variables).map((x) => `<td>${chip(x.veredicto)}<br><small>W₁ ${num(x.w1)} ${esc(x.unidades)}<br>chance ≤ ${num(x.permutacion_bloques.w1_azar_p95)}<br>p Holm ${num(x.permutacion_bloques.p_valor_holm, 2)}</small></td>`).join('')}
      <td>${chip(e.estructura.variograma.dentro_de_variabilidad_del_objetivo ? 'dentro' : 'fuera')}<br><small>×${num(e.estructura.variograma.factor_tipico)} (ref. ×${num(Math.exp(e.estructura.variograma.referencia_intrinseca))})</small></td>
      <td>${chip(e.estructura.moran_pendiente.dentro_de_variabilidad_del_objetivo ? 'dentro' : 'fuera')}<br><small>I ${num(e.estructura.moran_pendiente.objetivo)} / ${num(e.estructura.moran_pendiente.candidato)}<br>|Δ| ${num(e.estructura.moran_pendiente.distancia, 2)} (ref. ${num(e.estructura.moran_pendiente.referencia_intrinseca, 2)})</small></td></tr>`
    : `<tr><th>${km(e.h_m)}</th><td colspan="7" class="muted">${esc(e.omitida)}</td></tr>`);
  const desc = (k) => `<tr><td>${esc(e0.variables[k].nombre)} <small class="muted">(${esc(e0.variables[k].unidades)})</small></td>
      ${['p05', 'mediana', 'p95', 'desv_tipica'].map((s) => `<td>${num(e0.variables[k].objetivo[s])}</td><td>${num(e0.variables[k].candidato[s])}</td>`).join('')}</tr>`;
  const res = r.resumen_por_escala.map((x) => `<li><b>${km(x.h_m)}</b>: ${x.distribuciones_compatibles.length} of ${x.n_distribuciones} distributions compatible${x.estructura_dentro_de_variabilidad.length ? `; structure within the target’s variability (${x.estructura_dentro_de_variabilidad.join(', ')})` : '; spatial structure outside the target’s variability'}.</li>`).join('');
  const varsOrden = Object.keys(V.cdf);
  el.innerHTML = `
    <button class="close" id="cmp-close" aria-label="Close">✕</button>
    <span class="tag">DETAILED COMPARISON</span>
    <h2>${esc(ctx.siteName)} ↔ Earth site #${ctx.rango}</h2>
    <p class="small muted">${CUERPO[r.objetivo.cuerpo]} ${ll(r.objetivo.lat, r.objetivo.lon > 180 ? r.objetivo.lon - 360 : r.objetivo.lon)} · ${esc(r.objetivo.datos.producto)} (${km(r.objetivo.datos.espaciado_nativo_m)} native)
      &nbsp;↔&nbsp; ${CUERPO[r.candidato.cuerpo]} ${ll(r.candidato.lat, r.candidato.lon)} · ${esc(r.candidato.datos.producto)} (${km(r.candidato.datos.espaciado_nativo_m)} native).
      ${num(P.lado_km)} km windows; scales ${P.escalas_m.map(km).join(', ')}. <b>Geomorphological</b> similarity: neither environmental similarity nor suitability for a mission.</p>

    <h4>Result by scale</h4>
    <ul class="small">${res}</ul>
    <p class="small muted">Precision: the finest common scale is ${km(P.h0_m)}, limited by the DEM of the ${r.precision.limita}. ${esc(r.precision.nota)}</p>

    <h4>Relief at the same scale (${km(V.h_m)} per cell)</h4>
    <div class="cmp-tabs" role="tablist"><button data-m="elev_rel" class="sel" role="tab">Relative elevation</button><button data-m="pendiente" role="tab">Slope</button></div>
    <div class="cmp-mapas">
      <figure><canvas id="cmp-c-obj" aria-label="Target map"></canvas><figcaption><i style="background:${COL.obj}"></i>Target · ${CUERPO[r.objetivo.cuerpo]}</figcaption></figure>
      <figure><canvas id="cmp-c-tie" aria-label="Candidate map"></canvas><figcaption><i style="background:${COL.tie}"></i>Candidate · ${CUERPO[r.candidato.cuerpo]}</figcaption></figure>
    </div>
    <div id="cmp-barra"></div>
    <p class="small muted">Same color scale and same physical size (${num(V.lado_km)} km per side, north up); shading is only a visual aid. The cursor reads the value at the same position on both maps.</p>
    <div id="cmp-tip" class="cmp-tip" hidden></div>

    <h4>Cumulative distributions (scale ${km(V.h_m)})</h4>
    ${leyenda}
    <div class="cmp-grid">${varsOrden.map((k) => graficoCdf(k, V.cdf[k], chip(e0.variables[k]?.veredicto))).join('')}${graficoVariograma(V.variograma)}</div>

    <h4>Tests by scale</h4>
    <p class="small muted">Block permutation (${P.permutaciones} permutations, blocks the size of the autocorrelation radius) with ${esc(P.correccion)}, α = ${P.alfa}.
      “Chance ≤” is the 95th percentile of W₁ between patches of the same landscape. “Inconclusive” means there are too few independent blocks to claim compatibility.
      Structure (not a statistical test): variogram and Moran’s I compared with the difference between the target and itself shifted by ±L/4 (“ref.”); with a very small reference, minimal differences fall “outside”.</p>
    <div class="cmp-scroll"><table class="mtab cmp-tab"><tr><th>Cell</th>${Object.values(e0.variables).map((x) => `<th>${esc(x.nombre.replace('distribución de ', ''))}</th>`).join('')}<th>variogram</th><th>Moran slope</th></tr>
      ${r.escalas.map(filaEscala).join('')}</table></div>

    <h4>Descriptive statistics (scale ${km(e0.h_m)})</h4>
    <div class="cmp-scroll"><table class="mtab cmp-tab"><tr><th rowspan="2">Variable</th><th colspan="2">P5</th><th colspan="2">Median</th><th colspan="2">P95</th><th colspan="2">Std. dev.</th></tr>
      <tr>${'<th>target</th><th>Earth</th>'.repeat(4)}</tr>${Object.keys(e0.variables).map(desc).join('')}
      <tr><td>Hurst exponent</td><td colspan="4">${num(e0.estructura.hurst[0])}</td><td colspan="4">${num(e0.estructura.hurst[1])}</td></tr>
      <tr><td>Correlation length</td><td colspan="4">${e0.estructura.longitud_correlacion_m[0] ? km(e0.estructura.longitud_correlacion_m[0]) : '> L/2'}</td><td colspan="4">${e0.estructura.longitud_correlacion_m[1] ? km(e0.estructura.longitud_correlacion_m[1]) : '> L/2'}</td></tr>
      <tr><td>Anisotropy (max./min.)</td><td colspan="4">${num(e0.estructura.anisotropia[0])}</td><td colspan="4">${num(e0.estructura.anisotropia[1])}</td></tr>
      <tr><td>Coverage · direct observation</td><td colspan="4">${num(100 * e0.ventana_objetivo.cobertura_valida)} % · ${e0.ventana_objetivo.fraccion_con_observacion_directa == null ? 'n/a' : num(100 * e0.ventana_objetivo.fraccion_con_observacion_directa) + ' %'}</td>
        <td colspan="4">${num(100 * e0.ventana_candidata.cobertura_valida)} % · ${e0.ventana_candidata.fraccion_con_observacion_directa == null ? 'n/a' : num(100 * e0.ventana_candidata.fraccion_con_observacion_directa) + ' %'}</td></tr>
    </table></div>

    <h4>Limitations</h4><ul class="small">${r.limitaciones.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <h4>Data sources</h4><ol class="small refs">${r.referencias.datos.map((c) => `<li>${enlazar(c)}</li>`).join('')}</ol>
    <h4>Methods</h4><ol class="small refs">${r.referencias.metodos.map((m) => `<li>${enlazar(m.cita)}${m.url ? ` <a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.url)}</a>` : ''} <span class="muted">— ${esc(m.uso)}</span></li>`).join('')}</ol>
    <p class="small muted">Deterministic computation (seed ${P.semilla}) in ${num(r.segundos)} s.</p>`;

  // mapas interactivos
  let modo = 'elev_rel';
  const dibujar = () => {
    const M = V.mapas[modo], lim = modo === 'elev_rel' ? percentil([M.objetivo, M.candidato], 0.98) : percentil([M.objetivo, M.candidato], 0.98);
    const rel = V.mapas.elev_rel;
    pintarMapa(el.querySelector('#cmp-c-obj'), M.objetivo, modo, lim, V.celda_mapa_m, rel.objetivo);
    pintarMapa(el.querySelector('#cmp-c-tie'), M.candidato, modo, lim, V.celda_mapa_m, rel.candidato);
    el.querySelector('#cmp-barra').innerHTML = barraColor(modo, lim, modo === 'elev_rel' ? 'm' : '°');
  };
  dibujar();
  el.querySelectorAll('.cmp-tabs button').forEach((b) => (b.onclick = () => {
    modo = b.dataset.m; el.querySelectorAll('.cmp-tabs button').forEach((x) => x.classList.toggle('sel', x === b)); dibujar();
  }));
  const tip = el.querySelector('#cmp-tip');
  el.querySelectorAll('.cmp-mapas canvas').forEach((cv) => {
    cv.onmousemove = (ev) => {
      const b = cv.getBoundingClientRect(), n = V.mapas[modo].objetivo.length;
      const j = Math.min(n - 1, Math.floor(((ev.clientX - b.left) / b.width) * n)), i = Math.min(n - 1, Math.floor(((ev.clientY - b.top) / b.height) * n));
      const u = modo === 'elev_rel' ? 'm' : '°', o = V.mapas[modo].objetivo[i]?.[j], t = V.mapas[modo].candidato[i]?.[j];
      const x = ((j + 0.5) / n - 0.5) * V.lado_km, y = (0.5 - (i + 0.5) / n) * V.lado_km;
      tip.hidden = false; tip.style.left = `${ev.clientX + 14}px`; tip.style.top = `${ev.clientY + 14}px`;
      tip.innerHTML = `<b>${x >= 0 ? '+' : ''}${num(x, 2)} km E, ${y >= 0 ? '+' : ''}${num(y, 2)} km N</b><br>
        <i style="background:${COL.obj}"></i>Target: ${o == null ? 'no data' : `${num(o)} ${u}`}<br><i style="background:${COL.tie}"></i>Earth: ${t == null ? 'no data' : `${num(t)} ${u}`}`;
    };
    cv.onmouseleave = () => (tip.hidden = true);
  });
  // cursor en las distribuciones acumuladas: lee el mismo percentil en las dos curvas
  el.querySelectorAll('svg[data-cdf]').forEach((svg) => {
    const d = V.cdf[svg.dataset.cdf], hit = svg.querySelector('.hit'), xh = svg.querySelector('.xh');
    hit.onmousemove = (ev) => {
      const b = svg.getBoundingClientRect(), H = 170, m = { t: 10, b: 32 };
      const yv = ((ev.clientY - b.top) / b.height) * H, u = Math.max(0, Math.min(1, (H - m.b - yv) / (H - m.b - m.t)));
      const k = Math.round(u * (d.objetivo.length - 1));
      xh.setAttribute('y1', yv); xh.setAttribute('y2', yv); xh.setAttribute('visibility', 'visible');
      tip.hidden = false; tip.style.left = `${ev.clientX + 14}px`; tip.style.top = `${ev.clientY + 14}px`;
      tip.innerHTML = `<b>Percentile ${k}</b><br><i style="background:${COL.obj}"></i>Target: ${num(d.objetivo[k])} ${esc(d.unidades)}<br><i style="background:${COL.tie}"></i>Earth: ${num(d.candidato[k])} ${esc(d.unidades)}`;
    };
    hit.onmouseleave = () => { tip.hidden = true; xh.setAttribute('visibility', 'hidden'); };
  });
  el.querySelector('#cmp-close').onclick = () => { el.hidden = true; };
}

// ctx: { body, site:{lat,lon,name,id}, analogo:{lat,lon,rango}, lado_km, producto }
export async function abrirComparacion(ctx) {
  const el = document.getElementById('comparacion');
  el.hidden = false; el.scrollTop = 0;
  const clave = `${ctx.body}:${ctx.site.id}:${ctx.analogo.lat}:${ctx.analogo.lon}:${ctx.lado_km}`;
  el.innerHTML = `<button class="close" id="cmp-close" aria-label="Close">✕</button><span class="tag">DETAILED COMPARISON</span>
    <h2>${esc(ctx.site.name)} ↔ Earth site #${ctx.analogo.rango}</h2>
    <p class="small muted">Computing the multiscale analysis with the finest DEM available on each side, block permutation tests and variograms. This may take 10 to 60 s.</p>`;
  el.querySelector('#cmp-close').onclick = () => { el.hidden = true; };
  try {
    if (!cache.has(clave)) cache.set(clave, await fetchComparacion(ctx));
    if (!el.hidden) render(el, cache.get(clave), { siteName: ctx.site.name, rango: ctx.analogo.rango });
  } catch (e) {
    el.insertAdjacentHTML('beforeend', `<p class="small">Could not compute: ${esc(e.message)}</p>`);
  }
}
