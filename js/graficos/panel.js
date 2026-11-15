// ============================================================================
//  PANEL «COMPARAR CON DATOS MEDIDOS»  (#analisis, se abre desde la lista de resultados)
//
//  Todos los emplazamientos del cuerpo frente a las capas reales del NASA PDS que ya carga la web. Ningún valor ni color
//  depende de la puntuación ni de estimaciones: cada número es una celda de una rejilla publicada o un resumen de celdas
//  (js/analitica.js); sitio.rank solo sirve para identificar y ordenar los emplazamientos. El panel solo reparte los datos entre los gráficos y lleva dos elecciones compartidas:
//    · el emplazamiento destacado (énfasis: uno en color y los demás en gris, en todos los gráficos a la vez);
//    · la capa en detalle (la de los gráficos de distribución, latitud y dispersión).
//
//  Contrato de cada gráfico (js/graficos/<nombre>.js):  export function pintar(el, ctx)
//    el   contenedor NUEVO en cada pintado (los escuchas que se pongan sobre él no se acumulan)
//    ctx  { body, cuerpo, Rkm, cols, filas, sel, capa, estado, repintar() }
//         cols, filas → js/analitica.js medirTodo (filas en el orden del ranking); sel = id del emplazamiento destacado
//         capa = id de la capa en detalle; estado = objeto propio del gráfico que se conserva entre pintados;
//         repintar() = vuelve a pintar ese gráfico (tras cambiar su estado). Un gráfico nunca se llama a sí mismo.
//    Marcas de emplazamiento: data-sitio="<id>" (clic o Intro → lo destaca). Cabeceras o botones de capa: data-an-capa="<id>" (no data-capa: ese lo escucha proposito.js para las capas del globo).
// ============================================================================
import { medirTodo } from '../analitica.js';
import { RADIO_KM } from '../capas.js';
import { esc, tip, nombreCorto, CUERPO, masInfo } from './base.js';
import * as matriz from './matriz.js';
import * as distribucion from './distribucion.js';
import * as latitud from './latitud.js';
import * as dispersion from './dispersion.js';
import * as especifico from './especifico.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const GRAFICOS = { matriz, distribucion, latitud, dispersion, especifico };

let st = null;                 // { body, sitios, datos, sel, capa, estado: { [grafico]: {} }, alVerFicha, origen }
let turno = 0;

const caja = () => $('#analisis');
export const abierto = () => !!st && !caja().hidden;

function contexto(nombre) {
  const { body, datos, sel, capa } = st;
  return {
    body, cuerpo: CUERPO[body], Rkm: RADIO_KM[body], cols: datos.cols, filas: datos.filas, sel, capa,
    estado: (st.estado[nombre] ??= {}), repintar: () => pintarGrafico(nombre),
  };
}

// Cada pintado estrena contenedor: así los escuchas del gráfico anterior desaparecen con él. Del contenedor viejo se
// conservan el desplazamiento horizontal de la matriz, si «Show as table» estaba abierto y, mientras se pinta, su alto
// (si no, al leer el ancho del contenedor vacío el panel se acorta y salta hacia arriba cerca del final).
function pintarGrafico(nombre) {
  const viejo = $(`[data-g="${nombre}"]`, caja());
  if (!viejo || !st?.datos) return;
  const foco = claveFoco(viejo), nuevo = viejo.cloneNode(false);
  const sl = $('.g-mz-caja', viejo)?.scrollLeft ?? 0, abierta = !!$('details.g-tabla', viejo)?.open;
  nuevo.style.minHeight = `${viejo.offsetHeight}px`;
  viejo.replaceWith(nuevo);
  try { GRAFICOS[nombre].pintar(nuevo, contexto(nombre)); }
  catch (e) { console.error(`Gráfico «${nombre}»`, e); nuevo.innerHTML = '<p class="g-vacio">This chart could not be drawn.</p>'; }
  nuevo.style.minHeight = '';
  if (abierta) { const d = $('details.g-tabla', nuevo); if (d) d.open = true; }
  if (sl) { const c = $('.g-mz-caja', nuevo); if (c) c.scrollLeft = sl; }
  if (foco) $(foco, nuevo)?.focus({ preventScroll: true });
}

// Si el foco del teclado estaba dentro del gráfico, se devuelve al elemento equivalente tras repintar
function claveFoco(cont) {
  const a = document.activeElement;
  if (!a || !cont.contains(a)) return null;
  for (const at of ['data-clave', 'data-sitio', 'data-an-capa']) if (a.hasAttribute(at)) return `${a.tagName.toLowerCase()}[${at}="${CSS.escape(a.getAttribute(at))}"]`;
  return a.id ? `#${CSS.escape(a.id)}` : null;
}

function pintarControles() {
  const { sitios, sel, datos, capa } = st;
  $$('[data-an-sitio]', caja()).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.anSitio === sel)));
  $$('[data-an-capa]', caja()).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.anCapa === capa)));
  const s = sitios.find((x) => x.id === sel), k = datos?.cols.find((x) => x.def.id === capa);
  const ficha = $('[data-an-ficha]', caja());
  if (ficha) { ficha.hidden = !s; if (s) ficha.textContent = `Open the ${nombreCorto(s.name)} site sheet →`; }
  const por = $('#an-capa-por', caja());
  // Visible: qué se mide; la explicación larga de la capa, tras «Learn more». La frase «Inverted scale…» de def.por
  // habla del globo: en estos gráficos el color y los ejes siguen al valor medido, sin invertir, y no se copia.
  const porTxt = (d) => String(d.por ?? '').replace(/\s*Inverted scale:[^.]*\./, '');
  if (por) por.innerHTML = k ? `${esc(k.capa.meta.nombre)} · ${esc(k.def.unidad)}.${masInfo(k.def.por ? `<p class="g-pie">${esc(porTxt(k.def))}</p>` : '')}` : '';
}

function pintarTodo() {
  const { body, sitios, datos } = st, c = CUERPO[body];
  caja().innerHTML = `
    <button type="button" class="close" data-an-cerrar aria-label="Close">✕</button>
    <span class="tag">MEASURED DATA · NASA PDS</span>
    <h2 id="analisis-tit" tabindex="-1">Sites ${esc(c.en)}, compared with measured data</h2>
    <p class="an-intro">How each site compares with the rest ${esc(c.de)}, using real NASA measurements. Pick a site to highlight it.</p>
    ${masInfo(`<p class="g-pie">Every number comes from the NASA PDS grids the site already uses: the area-weighted mean of the cells within 0.5° of arc of each
      site, with the whole surface ${esc(c.de)} as reference. No value or color in these charts depends on the score or on estimates; each site’s
      number is only its rank in the results list, used to identify and sort it.</p>`)}
    <div class="g-ctl an-sitios" role="group" aria-label="Highlighted site">
      <span class="an-rot">Highlight</span>
      <div class="g-seg">${sitios.map((s) => `<button type="button" data-an-sitio="${esc(s.id)}" aria-pressed="false" title="${esc(s.name)}"><b>${s.rank}</b> ${esc(nombreCorto(s.name))}</button>`).join('')}</div>
      <button type="button" class="enlace-btn" data-an-ficha hidden></button>
    </div>
    <section class="an-sec" aria-label="Measurement matrix"><div data-g="matriz"></div></section>
    <section class="an-sec" aria-label="One layer in detail">
      <div class="g-ctl" role="group" aria-label="Layer in detail">
        <span class="an-rot">Look closer at</span>
        <div class="g-seg">${datos.cols.map((k) => `<button type="button" data-an-capa="${esc(k.def.id)}" aria-pressed="false">${esc(k.def.corto)}</button>`).join('')}</div>
      </div>
      <div class="an-por" id="an-capa-por"></div>
      <div class="an-dos"><div data-g="distribucion"></div><div data-g="latitud"></div></div>
      <div data-g="dispersion"></div>
    </section>
    <section class="an-sec" aria-label="Measurements specific to ${esc(c.nombre)}"><div data-g="especifico"></div></section>`;
  pintarControles();
  Object.keys(GRAFICOS).forEach(pintarGrafico);
}

// Destaca un emplazamiento en todos los gráficos a la vez
export function elegir(id) {
  if (!st?.datos || id === st.sel || !st.sitios.some((s) => s.id === id)) return;
  st.sel = id; tip(null);
  pintarControles();
  Object.keys(GRAFICOS).forEach(pintarGrafico);
}

function elegirCapa(id) {
  if (!st?.datos || id === st.capa || !st.datos.cols.some((k) => k.def.id === id)) return;
  st.capa = id; tip(null);
  pintarControles();
  ['matriz', 'distribucion', 'latitud', 'dispersion'].forEach(pintarGrafico);
}

export function cerrar() {
  const el = caja();
  if (el.hidden) return;
  el.hidden = true; tip(null);
  (st?.origen?.isConnected ? st.origen : $('#btn-comparar'))?.focus();
}

// body: 'moon' | 'mars'. sitios: los emplazamientos de los resultados, en el orden del ranking. sel: el destacado al
// abrir (por defecto, el primero). alVerFicha(id): abre la ficha de un emplazamiento. origen: quien abrió (recibe el foco al cerrar).
export async function abrir({ body, sitios, sel = null, alVerFicha, origen = document.activeElement }) {
  const el = caja(), mio = ++turno;
  const previo = st && st.body === body ? st : null;          // se conservan la capa en detalle y el estado de cada gráfico
  st = { body, sitios, datos: null, sel: sel ?? previo?.sel ?? sitios[0]?.id ?? null, capa: previo?.capa ?? null, estado: previo?.estado ?? {}, alVerFicha, origen };
  if (!sitios.some((s) => s.id === st.sel)) st.sel = sitios[0]?.id ?? null;
  el.hidden = false; el.scrollTop = 0;
  el.innerHTML = `<button type="button" class="close" data-an-cerrar aria-label="Close">✕</button><span class="tag">MEASURED DATA · NASA PDS</span>
    <h2 id="analisis-tit" tabindex="-1">Sites ${esc(CUERPO[body].en)}, compared with measured data</h2>
    <p class="g-cargando" role="status">Reading the NASA PDS layers…</p>`;
  $('#analisis-tit', el).focus({ preventScroll: true });
  try {
    const datos = await medirTodo(body, sitios);
    if (mio !== turno || el.hidden) return;
    st.datos = datos;
    // Al abrir: el indicio de agua como capa en detalle y, frente a él, la pendiente (¿hay agua y además terreno llano?)
    const tiene = (id) => datos.cols.some((k) => k.def.id === id);
    if (!tiene(st.capa)) st.capa = ['moon_h', 'mars_h2o'].find(tiene) ?? datos.cols[0].def.id;
    st.estado.dispersion ??= {}; st.estado.dispersion.y ??= ['moon_pendiente', 'mars_pend'].find(tiene);
    pintarTodo();
    $('#analisis-tit', el).focus({ preventScroll: true });
  } catch (e) {
    console.warn('Panel de comparación: capas no disponibles', e);
    if (mio === turno) $('.g-cargando', el).textContent = 'The NASA PDS data layers could not be loaded.';
  }
}

// Eventos (una sola vez): elegir emplazamiento o capa desde cualquier gráfico, cerrar y abrir la ficha
export function iniciar() {
  const el = caja();
  const actuar = (t) => {
    if (!t) return false;
    if (t.dataset.anCerrar != null) cerrar();
    else if (t.dataset.anFicha != null) { const id = st?.sel, ver = st?.alVerFicha; cerrar(); if (id) ver?.(id); }
    else if (t.dataset.anSitio) elegir(t.dataset.anSitio);
    else if (t.dataset.anCapa) elegirCapa(t.dataset.anCapa);
    else if (t.dataset.sitio) elegir(t.dataset.sitio);
    else return false;
    return true;
  };
  const objetivo = (e) => e.target.closest?.('[data-an-cerrar], [data-an-ficha], [data-an-sitio], [data-an-capa], [data-sitio]');
  el.addEventListener('click', (e) => { actuar(objetivo(e)); });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = objetivo(e);
    if (t && e.target === t && !/^(BUTTON|A|SELECT|INPUT|SUMMARY)$/.test(t.tagName) && actuar(t)) e.preventDefault();   // los botones ya emiten «click»
  });
}
