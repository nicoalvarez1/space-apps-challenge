// ============================================================================
//  PROYECTOS  (menú lateral #cajon, como la lista de chats de Claude pero con «Nuevo proyecto»)
//
//  Cada proyecto es una base: destino, propósito, criterios, tripulación y el lugar donde
//  se ha puesto la base. Se guardan en este navegador (localStorage); si no se puede guardar, la web funciona
//  igual pero los proyectos se pierden al recargar. Las bases de todos los proyectos de un mismo cuerpo se ven a
//  la vez en su mapa.
// ============================================================================
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CLAVE = 'landfall.proyectos.v1';
const ICONO = { moon: '🌙', mars: '🔴' };

let todos = [], activoId = null, api = null, editando = null;

function leer() { try { const v = JSON.parse(localStorage.getItem(CLAVE)); return Array.isArray(v) ? v : []; } catch { return []; } }
function guardar() { try { localStorage.setItem(CLAVE, JSON.stringify(todos)); } catch (e) { console.warn('No se pudieron guardar los proyectos', e); } }
const nuevoId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 8);
const cuerpoDe = (p) => new URLSearchParams(p.q).get('cuerpo');

export const lista = () => todos;
export const activo = () => todos.find((p) => p.id === activoId) ?? null;
export function activar(id) { if (!id || !todos.some((p) => p.id === id)) return false; activoId = id; pintar(); return true; }
export function desactivar() { activoId = null; pintar(); }

export function crear() {
  const n = todos.length + 1, p = { id: nuevoId(), nombre: `Project ${n}`, auto: true, q: 'vista=mision', base: null, t: Date.now() };
  todos.unshift(p); activoId = p.id; guardar(); pintar();
  return p;
}

// Estado del proyecto activo (la consulta de la URL sin «proyecto») y su nombre automático, si no se ha renombrado
export function guardarEstado(q, nombreAuto) {
  const p = activo(); if (!p) return;
  if (p.q === q && (!p.auto || !nombreAuto || p.nombre === nombreAuto)) return;
  p.q = q; if (p.auto && nombreAuto) p.nombre = nombreAuto;
  p.t = Date.now(); guardar(); pintar();
}

export function ponerBase(base) { const p = activo(); if (!p) return; p.base = base; p.t = Date.now(); guardar(); pintar(); }

// Bases de todos los proyectos en un cuerpo: id del emplazamiento → nombres de los proyectos
export function bases(body) {
  const m = new Map();
  for (const p of todos) if (p.base?.body === body) m.set(p.base.id, [...(m.get(p.base.id) ?? []), p.nombre]);
  return m;
}

// ---------------------------------------------------------------------------
//  Menú lateral
// ---------------------------------------------------------------------------
function pintar() {
  const ul = $('#lista-proyectos'); if (!ul) return;
  $('#proyectos-vacio').hidden = todos.length > 0;
  ul.innerHTML = todos.map((p) => {
    const b = cuerpoDe(p), act = p.id === activoId;
    const sub = p.base ? `🚩 ${esc(p.base.nombre)}` : b ? `${esc(api?.cuerpo(b) ?? b)} · no base` : 'Not started';
    return `<li class="proy${act ? ' act' : ''}">
      ${editando === p.id
    ? `<input class="proy-input" data-renombrar="${p.id}" value="${esc(p.nombre)}" aria-label="New project name" maxlength="60">`
    : `<button type="button" class="proy-abrir" data-abrir-proyecto="${p.id}"${act ? ' aria-current="page"' : ''}>
          <span class="proy-ico" aria-hidden="true">${ICONO[b] ?? '◌'}</span><span class="proy-txt"><b>${esc(p.nombre)}</b><small>${sub}</small></span></button>
        <button type="button" class="proy-acc" data-editar-proyecto="${p.id}" aria-label="Rename “${esc(p.nombre)}”" title="Rename">✎</button>
        <button type="button" class="proy-acc" data-borrar-proyecto="${p.id}" aria-label="Delete “${esc(p.nombre)}”" title="Delete">🗑</button>`}</li>`;
  }).join('');
  if (editando) { const i = $(`[data-renombrar="${editando}"]`); i?.focus(); i?.select(); }
}

function abrirCajon(si) {
  const c = $('#cajon'), b = $('#btn-menu');
  c.hidden = !si; $('#cajon-fondo').hidden = !si; b.setAttribute('aria-expanded', String(si));
  if (si) $('#btn-nuevo-proyecto').focus(); else if (c.contains(document.activeElement) || document.activeElement === document.body) b.focus();
}

function abrirProyecto(id) {
  const p = todos.find((x) => x.id === id); if (!p) return;
  activoId = id; pintar(); abrirCajon(false);
  const q = new URLSearchParams(p.q); q.set('proyecto', id);
  history.pushState(null, '', `${location.pathname}?${q}${location.hash}`);
  api.abrir();
}

function terminarEdicion(guardarNombre) {
  const i = $(`[data-renombrar="${editando}"]`), p = todos.find((x) => x.id === editando);
  if (p && guardarNombre && i.value.trim()) { p.nombre = i.value.trim(); p.auto = false; guardar(); }
  const id = editando; editando = null; pintar();
  $(`[data-editar-proyecto="${id}"]`)?.focus();
}

export function iniciar(a) {
  api = a; todos = leer();
  $('#btn-menu').addEventListener('click', () => abrirCajon($('#cajon').hidden));
  $('#cajon-fondo').addEventListener('click', () => abrirCajon(false));     // pulsar fuera del menú lo cierra
  $('#cajon').addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.id === 'btn-nuevo-proyecto') { abrirCajon(false); api.nuevo(); }
    else if (t.dataset.cerrarCajon != null) abrirCajon(false);
    else if (t.dataset.abrirProyecto) abrirProyecto(t.dataset.abrirProyecto);
    else if (t.dataset.editarProyecto) { editando = t.dataset.editarProyecto; pintar(); }
    else if (t.dataset.borrarProyecto) {
      const p = todos.find((x) => x.id === t.dataset.borrarProyecto);
      if (!confirm(`Delete the project “${p.nombre}”? This cannot be undone.`)) return;
      todos = todos.filter((x) => x !== p); guardar();
      if (p.id === activoId) { activoId = null; abrirCajon(false); api.inicio(); }
      pintar();
    }
  });
  $('#cajon').addEventListener('keydown', (e) => {
    if (e.target.dataset?.renombrar) {
      if (e.key === 'Enter') { e.preventDefault(); terminarEdicion(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); terminarEdicion(false); }
      return;
    }
    if (e.key === 'Escape') { e.stopPropagation(); abrirCajon(false); }
  });
  $('#cajon').addEventListener('focusout', (e) => { if (e.target.dataset?.renombrar && editando) terminarEdicion(true); });
  pintar();
}
