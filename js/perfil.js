// ============================================================================
//  GRÁFICO DE PROPÓSITOS  (panel #perfil de los resultados)
//
//  - Cinco barras, una por propósito, que suman 100 %. Si subes una, las demás bajan en proporción.
//  - Al soltar, dice qué emplazamiento del mapa tiene el reparto más parecido.
//  - Al revés: al elegir un emplazamiento (lista o mapa), las barras pasan a su reparto.
//
//  El reparto de un emplazamiento sale de la puntuación que ya tenía la web (js/data.js → scoreSites, con las
//  capas del PDS de js/capas.js → medirSitios): su puntuación en cada propósito, convertida a porcentaje del total.
//  «Más parecido» = la menor suma de diferencias entre tus barras y las del emplazamiento.
//  Aquí no se escribe ningún dato; las barras arrancan iguales (decisión de diseño, no un dato).
// ============================================================================
import { SITES, scoreSites } from './data.js';
import { medirSitios } from './capas.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TOTAL = 100;

let api = null, props = [], valores = [], abierto = !matchMedia('(max-width: 800px)').matches;
let datos = null, turno = 0, actual = null, fijo = false, guardado = null;

// Reparto en enteros que suman exactamente 100 (mayor resto)
function enteros(v) {
  const base = v.map(Math.floor), resto = TOTAL - base.reduce((a, b) => a + b, 0);
  v.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]).slice(0, resto).forEach(([, i]) => base[i]++);
  return base;
}
const iguales = () => props.map(() => TOTAL / props.length);
const reparto = (puntos) => { const t = props.reduce((a, p) => a + (puntos[p.id] ?? 0), 0); return props.map((p) => (t ? (TOTAL * (puntos[p.id] ?? 0)) / t : TOTAL / props.length)); };
const diferencia = (a, b) => a.reduce((s, x, i) => s + Math.abs(x - b[i]), 0);

// Sube o baja una barra; las demás se reparten lo que queda en proporción a lo que tenían
function mover(i, v) {
  const resto = TOTAL - v, otros = valores.reduce((s, x, j) => (j === i ? s : s + x), 0);
  valores = valores.map((x, j) => (j === i ? v : otros > 0 ? (x * resto) / otros : resto / (valores.length - 1)));
}

// El emplazamiento más parecido a las barras y el que más puntúa con ese reparto
function buscar() {
  if (!datos) return null;
  let parecido = null, mejor = null;
  for (const s of datos.sitios) {
    const d = diferencia(valores, s.reparto), p = props.reduce((a, q, i) => a + (valores[i] * (s.puntos[q.id] ?? 0)) / TOTAL, 0);
    if (!parecido || d < parecido.d) parecido = { s, d };
    if (!mejor || p > mejor.p) mejor = { s, p };
  }
  return { parecido: parecido.s, mejor: mejor.s };
}

// ---------------------------------------------------------------------------
//  Pintar
// ---------------------------------------------------------------------------
function pintarBarras() {
  const ent = enteros(valores);
  $$('#perfil [data-barra]').forEach((inp) => {
    const i = +inp.dataset.barra, p = props[i];
    if (document.activeElement !== inp) inp.value = ent[i];
    inp.setAttribute('aria-valuetext', `${p.nombre}: ${ent[i]} %`);
    inp.style.setProperty('--v', ent[i]);
    $(`[data-pct="${i}"]`).textContent = `${ent[i]} %`;
    $(`[data-pts="${i}"]`).textContent = actual ? actual.puntos[p.id] ?? '—' : '';
  });
}

function pintarResultado() {
  const res = $('#perfil-res');
  if (!datos) { res.innerHTML = '<span class="muted">Computing the distribution for each site…</span>'; return; }
  const r = buscar();
  actual = fijo && actual ? actual : r.parecido;
  api.marcar('parecido', actual.id);
  const base = api.hayProyecto() ? `<button type="button" class="btn ghost small-btn" data-perfil-base="${esc(actual.id)}">📍 Place the base here</button>` : '';
  res.innerHTML = `${fijo ? 'Chart for' : 'Closest match'}: <b>${esc(actual.nombre)}</b>
    <button type="button" class="btn ghost small-btn" data-perfil-ver="${esc(actual.id)}">Show on the map</button> ${base}
    ${!fijo && r.mejor.id !== r.parecido.id ? `<small>Best score with your distribution: <button type="button" class="enlace-btn" data-perfil-ver="${esc(r.mejor.id)}">${esc(r.mejor.nombre)}</button></small>` : ''}`;
  pintarBarras();
}

function pintarTabla() {
  const caja = $('#perfil-tabla');
  if (!datos || !caja) return;
  const filas = datos.sitios.map((s) => ({ s, d: diferencia(valores, s.reparto) })).sort((a, b) => a.d - b.d);
  caja.innerHTML = `<table class="tabla"><caption>Score of each site for each purpose (0–100) and difference from your bars (0 = identical)</caption>
    <thead><tr><th scope="col">Site</th>${props.map((p) => `<th scope="col">${esc(p.nombre)}</th>`).join('')}<th scope="col">Difference</th></tr></thead>
    <tbody>${filas.map(({ s, d }) => `<tr><th scope="row">${esc(s.nombre)}</th>${props.map((p) => `<td class="num">${s.puntos[p.id] ?? '—'}</td>`).join('')}<td class="num">${Math.round(d)}</td></tr>`).join('')}</tbody></table>`;
}

function pintar() {
  const el = $('#perfil');
  el.innerHTML = `
    <div class="perfil-cab"><h3 id="perfil-tit">Purpose chart</h3>
      <button type="button" class="lg-x" data-perfil-cerrar aria-label="Hide the chart" title="Hide">✕</button></div>
    <p class="perfil-ayuda" id="perfil-ayuda">Raise one purpose and the others go down. Click a site on the map to see its chart.</p>
    <div class="barras" role="group" aria-labelledby="perfil-tit" aria-describedby="perfil-ayuda">
      ${props.map((p, i) => `<div class="barra">
        <span class="pct" data-pct="${i}"></span>
        <input type="range" class="vertical" data-barra="${i}" min="0" max="${TOTAL}" step="1" aria-label="${esc(p.nombre)}">
        <span class="ini" aria-hidden="true">${esc(p.inicial ?? p.nombre[0])}</span><small>${esc(p.nombre)}</small>
        <span class="pts" data-pts="${i}" title="Score of the site for this purpose"></span></div>`).join('')}
    </div>
    <p class="perfil-res" id="perfil-res"></p>
    <details class="perfil-mas"><summary>Show as table</summary><div class="tabla-scroll" id="perfil-tabla" tabindex="0" role="region" aria-label="Chart table"></div></details>
    <p class="perfil-nota">Each site splits 100 points according to its score for each purpose (the site’s score: PDS data and team estimates). Below each bar, the score of the site.</p>`;
  pintarResultado(); pintarTabla();
}

function aplicarAbierto() {
  $('#perfil').hidden = !abierto || !datosPedidos;
  const b = $('#btn-grafico'); b.hidden = !datosPedidos; b.setAttribute('aria-expanded', String(abierto));
}

// ---------------------------------------------------------------------------
//  API
// ---------------------------------------------------------------------------
let datosPedidos = false;

export function iniciar(a) {
  api = a; props = a.propositos;
  valores = guardado ?? iguales();
  const el = $('#perfil');
  el.addEventListener('input', (e) => {
    const i = e.target.dataset?.barra; if (i == null) return;
    fijo = false; mover(+i, +e.target.value); pintarResultado();
  });
  el.addEventListener('change', (e) => {
    if (e.target.dataset?.barra == null) return;
    pintarTabla(); api.alCambiar();
    const ent = enteros(valores), r = buscar();
    if (r) api.anunciar(`${props.map((p, i) => `${p.nombre} ${ent[i]} %`).join(', ')}. Closest match: ${r.parecido.nombre}.`);
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-perfil-ver], [data-perfil-base], [data-perfil-cerrar]'); if (!b) return;
    if (b.dataset.perfilVer) api.seleccionar(b.dataset.perfilVer);
    else if (b.dataset.perfilBase) api.ponerBase(b.dataset.perfilBase);
    else { abierto = false; aplicarAbierto(); $('#btn-grafico').focus(); }
  });
  $('#btn-grafico').addEventListener('click', () => { abierto = !abierto; aplicarAbierto(); if (abierto) $('#perfil [data-barra]')?.focus(); });
}

// Pliega el gráfico igual que su botón (#btn-grafico) y dice si estaba abierto; desplegar() lo vuelve a abrir. Lo usa el
// panel de entrenamiento en la Tierra (js/main.js), que es ancho y ocupa el mismo sitio de la pantalla.
export function plegar() { const era = abierto; if (abierto) { abierto = false; aplicarAbierto(); } return era; }
export function desplegar() { if (!abierto) { abierto = true; aplicarAbierto(); } }

// Al mostrar los resultados: calcula el reparto de cada emplazamiento con la puntuación existente
export async function mostrar({ body, mission, sitios }) {
  if (!api || !props.length) return;
  const t = ++turno;
  datos = null; actual = null; fijo = false; datosPedidos = true;
  pintar(); aplicarAbierto();
  let med = {};
  try { med = await medirSitios(body, SITES[body]); } catch (e) { console.warn('Gráfico: capas del PDS no disponibles', e); }
  if (t !== turno) return;
  const puntos = new Map(sitios.map((s) => [s.id, { id: s.id, nombre: s.name, puntos: {} }]));
  for (const p of props) for (const s of scoreSites(body, p.objetivo, { crew: mission.crew, duration: mission.duration }, med)) puntos.get(s.id) && (puntos.get(s.id).puntos[p.id] = s.score);
  datos = { sitios: [...puntos.values()].map((s) => ({ ...s, reparto: reparto(s.puntos) })) };
  pintarResultado(); pintarTabla();
}

export function ocultar() {
  turno++; datos = null; actual = null; datosPedidos = false;
  api?.marcar('parecido', null);
  if (api) aplicarAbierto();
}

// Al revés: un lugar elegido en la lista o en el mapa pone las barras con su reparto
export function verSitio(id) {
  const s = datos?.sitios.find((x) => x.id === id);
  if (!s) return;
  valores = [...s.reparto]; actual = s; fijo = true;
  pintarResultado(); pintarTabla(); api.alCambiar();
  const ent = enteros(valores);
  api.anunciar(`Chart for ${s.nombre}: ${props.map((p, i) => `${p.nombre} ${ent[i]} %`).join(', ')}.`, 900);
}

// Reparto en la URL: «20,30,10,20,20»; sin parámetro, barras iguales
export function repartoTexto() {
  const ent = enteros(valores);
  return ent.every((x) => x === ent[0]) && TOTAL % ent.length === 0 ? null : ent.join(',');
}
export function leerReparto(t) {
  const v = String(t ?? '').split(',').map(Number);
  const ok = props.length ? v.length === props.length : v.length > 1;
  guardado = ok && v.every((x) => x >= 0) && v.reduce((a, b) => a + b, 0) === TOTAL ? v : null;
  valores = guardado ?? (props.length ? iguales() : []);
}
