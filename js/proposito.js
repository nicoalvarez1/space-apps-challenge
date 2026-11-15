// ============================================================================
//  FLUJO DE PROPÓSITO  (pasos 2-4 del asistente y panel de criterios de los resultados)
//
//  Después de «Luna o Marte» la web pregunta para qué servirá la base: propósito → subapartado → criterios.
//  Este módulo SOLO AÑADE: el asistente, la puntuación, las capas y las fichas siguen en js/main.js.
//
//  Reglas que cumple:
//  - Ningún dato se escribe aquí. Textos, fuentes, estados, limitaciones y coordenadas salen de data/sources.json
//    (registro de fuentes), data/propositos.json y data/glosario.json. Los valores salen de las capas ya cargadas
//    (base-planetaria/web/data, vía js/capas.js) y los rangos de los filtros, del mínimo y el máximo de cada capa.
//  - No hay ningún sistema de puntuación nuevo ni pesos entre criterios: los criterios activos deciden qué capas
//    se ofrecen en el globo, en la tabla y en la ficha. El orden sigue siendo el de la puntuación existente.
//  - Lo que no tiene capa cargada se muestra como «Pendiente de datos» o «Pendiente de verificar».
//  - El estado del flujo vive en la URL (?cuerpo=…&proposito=…&sub=…&criterios=…&paso=…) y cada paso es una
//    entrada del historial, para que el botón Atrás funcione y el enlace se pueda compartir.
// ============================================================================
import { BODIES, OBJECTIVES, DURATIONS } from './data.js';
import { catalogo, capa, CAPAS_GLOBO, RADIO_KM } from './capas.js';
import * as perfil from './perfil.js';
import * as proyectos from './proyectos.js';

export const PASOS = 3;            // 1 destino · 2 propósito (árbol propósito › tipo › criterios) · 3 tripulación
const TITULOS = [null, 'Destination', 'Purpose', 'Crew'];
const DATOS = 'data/';
const POSICIONES = 200;            // posiciones de cada control de filtro (resolución del control, no un dato)

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (v, d) => v.toLocaleString('en-US', { maximumFractionDigits: d });
const fecha = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// vista: null = portada · 'mision' = asistente · 'resultados'
const est = { proposito: null, sub: null, off: new Set(), experto: false, vista: null };
let ctx = null, cfg = null, cfgError = null;
let suspendido = false, desdeHistorial = false, mensaje = '';
let previo = { paso: null, cuerpo: null, proposito: null, sub: null, vista: null };
const filtros = new Map();         // id de capa → { a, b } posiciones 0…POSICIONES del mínimo y el máximo elegidos
let sitios = [], valores = null, medicion = 0, capaGlobo = null;

const ESTADOS = {
  datos:          { ico: '✔', txt: 'With data',              msg: '' },
  pendiente:      { ico: '◌', txt: 'Data pending',           msg: 'This layer does not have data loaded on the site yet.' },
  verificar:      { ico: '?', txt: 'Pending verification',   msg: 'The source or the product has not been verified yet.' },
  enlace:         { ico: '↗', txt: 'Link only',              msg: 'External tool: it is linked and its values are not copied.' },
  enlace_interno: { ico: '→', txt: 'Other purpose',          msg: '' },
  contexto:       { ico: 'ℹ', txt: 'Context',                msg: 'Context text: not a data layer.' },
};
const COS = { Lluna: 'Moon', Mart: 'Mars', Terra: 'Earth' };
const ESTAT = { verificat: 'Verified', pendent_de_verificar: 'Pending verification', pendent_de_dades: 'Data pending' };

// ---------------------------------------------------------------------------
//  Configuración (registro de fuentes, propósitos y glosario)
// ---------------------------------------------------------------------------
async function cargar() {
  const leer = async (f) => { const r = await fetch(DATOS + f); if (!r.ok) throw new Error(`${f}: ${r.status}`); return r.json(); };
  const [s, p, g] = await Promise.all([leer('sources.json'), leer('propositos.json'), leer('glosario.json')]);
  let capas = {};
  try { capas = await catalogo(); } catch (e) { console.warn('Catálogo de capas no disponible: todos los criterios quedan pendientes de datos', e); }
  cfg = {
    fuentes: new Map(s.fonts.map((f) => [f.id, f])), vacios: new Map(s.buits.map((b) => [b.id, b])),
    propositos: p.propositos, cuerpos: p.cuerpos, pesos: p.pesos, glosario: new Map(g.terminos.map((t) => [t.id, t])), capas,
  };
}

const cuerpo = () => ctx.mission.body;
const prop = () => cfg?.propositos.find((p) => p.id === est.proposito) ?? null;
const subDe = (P) => P?.subapartados.find((s) => s.id === est.sub) ?? null;
const predet = (P) => P.subapartados.find((s) => s.predeterminado) ?? P.subapartados[0];
// Tercer nivel del árbol (propósito › tipo › criterio). Cada capa cargada de un criterio es un criterio propio
// («Sólido › Hierro»); lo que no tiene capa queda con el nombre del criterio, o con el de su fuente si el criterio
// ya tiene capas. Si un criterio no tiene entrada para el destino, no aplica y no se muestra.
function visibles(S) {
  const b = cuerpo(), out = [], ids = new Set();
  const nuevo = (f) => { let id = f.id, n = 2; while (ids.has(id)) id = `${f.id}~${n++}`; ids.add(id); out.push({ ...f, id }); return out.at(-1); };
  for (const c of S?.criterios ?? []) {
    const items = c[b];
    if (!Array.isArray(items)) continue;
    const conCapa = [], resto = [];
    for (const it of items) {
      const capas = (it.capas ?? []).filter((id) => cfg.capas[id]);
      if (!capas.length) resto.push(it);
      else if (it.derivada) conCapa.push({ id: `${c.id}:${capas[0]}:${it.derivada}`, nombre: 'Regional slope (derived)', capa: capas[0], derivada: it.derivada, items: [it] });
      else capas.forEach((id) => conCapa.push({ id: `${c.id}:${id}`, nombre: nombreCapa(id), capa: id, items: [it] }));
    }
    if (!conCapa.length) { nuevo({ id: c.id, nombre: plano(c.nombre), items, criterio: c, solo: true }); continue; }
    const fs = conCapa.map((f) => nuevo({ ...f, criterio: c }));
    for (const it of resto) {
      if (it.contexto) { fs[0].items = [...fs[0].items, it]; continue; }
      fs.push(nuevo({ id: `${c.id}:${it.fuente ?? it.vacio ?? it.ver}`, nombre: nombreItem(it), items: [it], criterio: c }));
    }
  }
  return out;
}
const activos = () => visibles(subDe(prop())).filter((f) => !est.off.has(f.id));
const nombreItem = (it) => (it.fuente ? cfg.fuentes.get(it.fuente).nom : it.vacio ? cfg.vacios.get(it.vacio).descripcio.split(':')[0] : 'Other purpose');

// Textos: {cuerpo}, {a_cuerpo}… según el destino; [[id|texto]] = término del glosario
const TERM = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;
const txt = (t) => String(t ?? '').replace(/\{(\w+)\}/g, (m, k) => cfg?.cuerpos[cuerpo()]?.[k] ?? 'the destination');
const plano = (t) => txt(t).replace(TERM, (_, id, vis) => vis ?? id);
const rico = (t) => esc(txt(t)).replace(TERM, (_, id, vis) => (cfg.glosario.has(id)
  ? `<button type="button" class="termino" data-term="${id}" aria-expanded="false">${vis ?? id}</button>` : (vis ?? id)));

// ---------------------------------------------------------------------------
//  Estados: una capa cargada en la web = datos; si no, pendiente de datos o de verificar
// ---------------------------------------------------------------------------
function estadoItem(it) {
  if (it.ver) return 'enlace_interno';
  if (it.vacio) return cfg.vacios.get(it.vacio)?.estat === 'pendent_de_verificar' ? 'verificar' : 'pendiente';
  if (it.capas?.some((id) => cfg.capas[id])) return 'datos';
  if (it.contexto) return 'contexto';
  if (it.enlace) return 'enlace';
  if (it.verificar || cfg.fuentes.get(it.fuente)?.estat === 'pendent_de_verificar') return 'verificar';
  return 'pendiente';
}

function estadoCriterio(items) {
  const e = items.map(estadoItem).filter((x) => x !== 'contexto');
  if (e.includes('datos')) return 'datos';
  if (e.length && e.every((x) => x === 'enlace' || x === 'enlace_interno')) return e[0];
  if (e.includes('pendiente') || !e.length) return 'pendiente';
  return e.includes('verificar') ? 'verificar' : 'pendiente';
}

function recuento() {
  const r = { total: 0, datos: 0, pendiente: 0, verificar: 0, enlace: 0 };
  for (const f of activos()) { r.total++; const e = estadoCriterio(f.items); r[e === 'enlace_interno' ? 'enlace' : e]++; }
  return r;
}
const recuentoTxt = (r) => [r.datos && `${r.datos} with data loaded`, r.pendiente && `${r.pendiente} data pending`,
  r.verificar && `${r.verificar} pending verification`, r.enlace && `${r.enlace} link only`].filter(Boolean).join(', ');
const recuentoHtml = (r) => `<b>${plural(r.total, 'active criterion', 'active criteria')}</b>${r.total ? ': ' : ''}${[['datos', r.datos, 'with data loaded'],
  ['pendiente', r.pendiente, 'data pending'], ['verificar', r.verificar, 'pending verification'],
  ['enlace', r.enlace, 'link only']].filter((x) => x[1]).map(([e, n, t]) => `<span class="estado e-${e}"><span aria-hidden="true">${ESTADOS[e].ico}</span> ${n} ${t}</span>`).join(' ')}`;

// ---------------------------------------------------------------------------
//  Piezas de interfaz: estado, fuente, criterio, contexto
// ---------------------------------------------------------------------------
const chip = (e) => `<span class="estado e-${e}"><span aria-hidden="true">${ESTADOS[e].ico}</span> ${ESTADOS[e].txt}</span>`;
const nuevaPestana = '<span class="sr-only"> (opens in a new tab)</span><span aria-hidden="true"> ↗</span>';
const enlace = (f, texto = 'Open the source') => `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(texto)}${texto === f.nom ? '' : `<span class="sr-only">: ${esc(f.nom)}</span>`}${nuevaPestana}</a>`;
const meta = (f) => `<span class="f-meta">Source: ${esc(f.agencia)} · ${enlace(f)} · accessed ${fecha(f.data_consulta)}</span>`;
const limitaciones = (f) => (f.limitacions ?? []).map((l) => `<span class="limitacion"><span aria-hidden="true">⚠ </span><b>Limitation:</b> ${esc(l.text)}${
  l.url && l.url !== f.url ? ` <a href="${esc(l.url)}" target="_blank" rel="noopener">See the notice${nuevaPestana}</a>` : ''}</span>`).join('');

// Nombre entendible de una capa cargada: «Relieve: Pendiente» (tema y nombre corto que ya usa el panel de capas)
const defCapa = (id) => CAPAS_GLOBO[cfg.capas[id]?.cuerpo]?.find((d) => d.id === id);
const etiquetaCapa = (id) => { const d = defCapa(id); return d ? `${d.grupo.split(' · ')[0]}: ${d.corto}` : cfg.capas[id].nombre; };
// Nombre del criterio de una capa: «Hierro», «Pendiente», «Temperatura máxima»
const nombreCapa = (id) => {
  const d = defCapa(id); if (!d) return cfg.capas[id].nombre;
  if (d.grupo.startsWith('Temperature')) return `${d.corto} temperature`;
  return d.corto === 'FeO' ? 'Iron (FeO)' : d.corto;
};
const capaExperto = (id) => { const m = cfg.capas[id]; return ` · Site layer: <code>${esc(id)}</code>, ${esc(m.nombre)} (${esc(m.fuente?.dataset ?? 'no identifier')}; ${esc(m.resolucion)})`; };
const botonCapa = (id) => `<button type="button" data-capa="${esc(id)}" aria-pressed="${capaGlobo === id}"${capaGlobo === id ? ' class="sel"' : ''}>${esc(etiquetaCapa(id))}</button>`;
const globoDisponible = () => !$('#layers').hidden;

// solo: id de la capa del criterio que se está pintando. Una fuente con varias capas (p. ej. los elementos de Odyssey GRS)
// da un criterio por capa; cada uno muestra la suya y no la lista entera repetida.
function itemHtml(it, P, { globo = false, solo = null } = {}) {
  const e = estadoItem(it);
  if (it.ver) {
    const D = cfg.propositos.find((p) => p.id === it.ver), DS = D.subapartados.find((s) => s.id === it.ver_sub);
    return `<li class="fuente">${chip(e)} <span class="f-que">${rico(it.que)}</span>
      <button type="button" class="enlace-btn" data-ver="${esc(D.id)}" data-ver-sub="${esc(DS?.id ?? '')}">Go to ${esc(D.nombre)}${DS ? ` › ${esc(plano(DS.nombre))}` : ''}</button></li>`;
  }
  if (it.vacio) {
    const v = cfg.vacios.get(it.vacio), b = it.buscar_en && cfg.fuentes.get(it.buscar_en);
    return `<li class="fuente">${chip(e)} <span class="f-que">${esc(v.descripcio)}</span>
      ${b ? `<span class="f-meta">Can be searched in ${enlace(b, b.nom)} · ${esc(b.agencia)} · accessed ${fecha(b.data_consulta)}</span>`
    : `<span class="f-meta">Data gap recorded in the source registry · reviewed ${fecha(v.data_consulta)}</span>`}
      <span class="solo-experto f-id">Registry: <code>${esc(v.id)}</code></span></li>`;
  }
  const f = cfg.fuentes.get(it.fuente), todas = (it.capas ?? []).filter((id) => cfg.capas[id]), capas = solo && todas.includes(solo) ? [solo] : todas;
  const msg = e === 'verificar' ? (it.nota ?? f.estat_nota ?? ESTADOS.verificar.msg) : ESTADOS[e].msg;
  const repetido = plano(it.que).replace(/\.$/, '').trim().toLowerCase() === f.nom.trim().toLowerCase();   // «qué» igual al nombre de la fuente: no se dice dos veces
  return `<li class="fuente">${chip(e)} <b class="f-nom">${esc(f.nom)}</b>${repetido ? '' : ` <span class="f-que">${rico(it.que)}</span>`}
    ${P.aviso_capa && !it.contexto && !it.enlace ? `<span class="f-aviso">${esc(P.aviso_capa)}</span>` : ''}
    ${msg ? `<span class="f-msg">${esc(msg)}</span>` : ''}${e !== 'verificar' && it.nota ? `<span class="f-msg">${esc(it.nota)}</span>` : ''}
    ${capas.length ? `<span class="f-msg">Layer loaded on the site: ${capas.map((id) => esc(etiquetaCapa(id))).join(', ')}${it.derivada ? ' and regional slope (derived quantity)' : ''}.</span>` : ''}
    ${meta(f)}
    <span class="solo-experto f-id">${f.producte ? `Product: <code>${esc(f.producte)}</code> · ` : ''}Registry: <code>${esc(f.id)}</code> (${esc(ESTAT[f.estat])}${f.estat_nota ? `: ${esc(f.estat_nota)}` : ''})${capas.map(capaExperto).join('')}</span>
    ${globo && capas.length && globoDisponible() ? `<span class="f-globo lchips"><span>Show on the globe:</span> ${capas.map(botonCapa).join(' ')}</span>` : ''}
    ${limitaciones(f)}</li>`;
}

function criterioHtml(f, P, { pre, casilla = false, globo = false, plegado = false }) {
  const c = f.criterio, items = f.items, e = estadoCriterio(items), id = `${pre}-${f.id.replace(/[^\w-]/g, '_')}`, nombre = esc(f.nombre);
  const detalle = `<p class="crit-frase" id="${id}-d">${f.solo ? '' : `${esc(plano(c.nombre))}. `}${rico(c.frase)}</p>
    <ul class="fuentes" aria-label="Sources ${esc(txt('{en_cuerpo}'))}: ${nombre}">${items.map((it) => itemHtml(it, P, { globo, solo: f.derivada ? null : f.capa })).join('')}</ul>
    ${c.earth ? `<p class="crit-sub">Analog on Earth</p>
    <ul class="fuentes" aria-label="Sources for the Earth analog: ${nombre}">${c.earth.map((it) => itemHtml(it, P)).join('')}</ul>` : ''}`;
  return `<div class="criterio${plegado ? ' plegado' : ''}" data-criterio="${esc(f.id)}">
    <div class="crit-cab">
      ${casilla ? `<input type="checkbox" id="${id}" data-crit="${esc(f.id)}" aria-describedby="${id}-d"${est.off.has(f.id) ? '' : ' checked'}>
      <label class="crit-nom" for="${id}">${nombre}</label>` : `<h4 class="crit-nom">${nombre}</h4>`}
      ${chip(e)}
    </div>
    ${plegado ? `<details class="crit-det"><summary>Sources<span class="sr-only">: ${nombre}</span></summary>${detalle}</details>` : detalle}
  </div>`;
}

function avisosHtml(P, S) {
  const l = [...(P.avisos ?? []), ...(S?.avisos ?? []), ...(S?.avisos_cuerpo?.[cuerpo()] ?? [])];
  return l.length ? `<ul class="avisos">${l.map((a) => `<li><span aria-hidden="true">ℹ </span>${rico(a)}</li>`).join('')}</ul>` : '';
}

// Contexto informativo: texto de una página oficial, separado visualmente de los datos
function contextoHtml(S, pre) {
  const l = (S.contexto ?? []).filter((c) => !c.cuerpo || c.cuerpo === cuerpo());
  if (!l.length) return '';
  const grupos = new Map();
  for (const c of l) grupos.set(c.fuente, [...(grupos.get(c.fuente) ?? []), c.texto]);
  return `<section class="bloque contexto" aria-labelledby="${pre}-ctx"><h3 id="${pre}-ctx"><span aria-hidden="true">ℹ </span>Informational context</h3>
    <p class="bloque-nota">Text taken from an official page. These are not values from a data layer, and they do not filter locations.</p>
    ${[...grupos].map(([id, textos]) => { const f = cfg.fuentes.get(id);
    return `<div class="ctx"><b class="f-nom">${esc(f.nom)}</b><ul>${textos.map((t) => `<li>${rico(t)}</li>`).join('')}</ul>${meta(f)}
      <span class="solo-experto f-id">Registry: <code>${esc(f.id)}</code></span></div>`; }).join('')}</section>`;
}

// Medidas puntuales (geotérmica): tabla con los mismos puntos que se pintan sobre el globo
const grados = (v, pos, neg) => `${nf(Math.abs(v), 5)}° ${v >= 0 ? pos : neg}`;
function puntosHtml(S, pre) {
  const pts = S.puntos?.[cuerpo()];
  if (!pts?.length) return '';
  return `<section class="bloque datos" aria-labelledby="${pre}-pts"><h3 id="${pre}-pts">Point measurements</h3>
    <p class="bloque-nota">Point measurement. There is no verified global map. There is no interpolation between points. In the results, each site is marked with a diamond on the globe; this table contains the same points.</p>
    <div class="tabla-scroll" tabindex="0" role="region" aria-label="Table of point measurements"><table class="tabla">
      <caption>Sites with heat flow measurements ${esc(txt('{en_cuerpo}'))}</caption>
      <thead><tr><th scope="col">Site</th><th scope="col">Latitude</th><th scope="col">Longitude</th><th scope="col">Measurement</th><th scope="col">Coordinates</th></tr></thead>
      <tbody>${pts.map((p) => { const f = cfg.fuentes.get(p.fuente), fc = cfg.fuentes.get(p.fuente_coordenadas);
    return `<tr><th scope="row">${esc(p.nombre)}</th><td class="num">${grados(p.lat, 'N', 'S')}</td><td class="num">${grados(p.lon, 'E', 'W')}</td>
        <td>${esc(f.nom)}${meta(f)}</td><td>${esc(p.nota)}${meta(fc)}</td></tr>`; }).join('')}</tbody></table></div></section>`;
}

// ---------------------------------------------------------------------------
//  Asistente: propósito (paso 2), subapartado (paso 3) y criterios (paso 4)
// ---------------------------------------------------------------------------
function pintarSiCambia(el, clave, html) {
  if (el.dataset.clave === clave) return;
  el.dataset.clave = clave; el.innerHTML = html();
}
const marcar = (el, nombre, valor) => $$(`input[name="${nombre}"]`, el).forEach((i) => { i.checked = i.value === valor; i.closest('label').classList.toggle('sel', i.checked); });

// Criterios agrupados: los que salen de un mismo criterio del registro (p. ej. «Elementos químicos») van juntos
function criteriosHtml(S, P, pre, opts) {
  const fs = visibles(S), grupos = [];
  for (const f of fs) { const g = grupos.at(-1); if (g && !f.solo && g.c === f.criterio) g.fs.push(f); else grupos.push({ c: f.criterio, solo: f.solo, fs: [f] }); }
  return grupos.map((g) => (g.solo || g.fs.length === 1 && g.fs[0].nombre === plano(g.c.nombre)
    ? criterioHtml(g.fs[0], P, { pre, ...opts })
    : `<fieldset class="grupo-crit"><legend>${esc(plano(g.c.nombre))}</legend>${g.fs.map((f) => criterioHtml(f, P, { pre, ...opts })).join('')}</fieldset>`)).join('');
}

// Paso 2: árbol propósito › tipo › criterios. Al elegir un propósito se despliegan sus tipos (con el predeterminado
// ya marcado) y, debajo del tipo elegido, sus criterios (todos activados).
function ramaHtml(p) {
  const abierta = p.id === est.proposito, D = predet(p), S = abierta ? subDe(p) : null;
  const nota = S?.tipo === 'contexto' ? ' Context information only: it does not filter locations.'
    : S?.tipo === 'puntos' ? ' Only measurements at specific points: it does not filter locations.' : '';
  return `<div class="rama${abierta ? ' abierta' : ''}">
    <label class="opt opcion"><input type="radio" name="proposito" value="${esc(p.id)}"${abierta ? ' checked' : ''}>
      <span class="ico" aria-hidden="true">${p.icono}</span><b>${esc(p.nombre)} <span class="predet">(${esc(plano(D.nombre))})</span></b><small>${esc(plano(p.frase))}</small></label>
    ${abierta ? `<div class="hijos">
      <p class="nivel" id="tipo-${esc(p.id)}">Type of ${esc(p.nombre.toLowerCase())}</p>
      <div class="tipos" role="radiogroup" aria-labelledby="tipo-${esc(p.id)}">${p.subapartados.map((s) => `
        <label class="opt opcion sin-ico tipo${s.id === est.sub ? ' sel' : ''}"><input type="radio" name="sub" value="${esc(s.id)}"${s.id === est.sub ? ' checked' : ''}>
          <b>${esc(plano(s.nombre))}${s.predeterminado ? ' <span class="predet">(default)</span>' : ''}</b><small>${esc(plano(s.frase))}</small></label>`).join('')}</div>
      ${S ? `<fieldset class="nietos"><legend>What should be taken into account? <small>All count equally. Untick what you do not want.${nota}</small></legend>
        ${criteriosHtml(S, p, 'w', { casilla: true, plegado: true }) || '<p class="paso-ayuda">There are no criteria for this destination.</p>'}</fieldset>` : ''}
    </div>` : ''}
  </div>`;
}

function pintarArbol() {
  const el = $('#g-proposito');
  $('#g-obj').hidden = !cfgError;                                            // sin configuración: objetivos de la versión anterior
  if (!cfg) { el.innerHTML = `<p class="paso-ayuda" role="status">${cfgError ? 'The purposes could not be loaded: choose an objective.' : 'Loading…'}</p>`; return; }
  const clave = `${cuerpo()}|${est.proposito}|${est.sub}|${Object.keys(cfg.capas).length}`;
  if (el.dataset.clave !== clave) {
    // se vuelve a pintar: el foco vuelve al mismo control (radio de propósito o de tipo)
    const f = document.activeElement, sel = el.contains(f) && f.name ? `input[name="${f.name}"][value="${CSS.escape(f.value)}"]` : null;
    el.dataset.clave = clave;
    el.innerHTML = cfg.propositos.map(ramaHtml).join('');
    if (sel) $(sel, el)?.focus();
  }
  $$('input[name="proposito"]', el).forEach((i) => i.closest('label').classList.toggle('sel', i.checked));
  $$('input[data-crit]', el).forEach((i) => { i.checked = !est.off.has(i.dataset.crit); });
}

// Línea de resumen «Marte › Recursos › Líquido › 3 criterios», con un enlace para volver a cada paso
function migas(pasoActual = null) {
  const b = cuerpo(), P = prop(), S = subDe(P);
  if (!b) return '';
  const partes = [[1, 'Destination', BODIES[b].short]];
  if (P) partes.push([2, 'Purpose', P.nombre]);
  if (S) partes.push([2, 'Type', plano(S.nombre)], [2, 'Criteria', plural(activos().length, 'criterion', 'criteria')]);
  return `<ol>${partes.map(([n, et, v]) => `<li><button type="button" data-ir="${n}"${n === pasoActual ? ' aria-current="step"' : ''}><span class="sr-only">${et}: </span>${esc(v)}<span class="sr-only">. Go to step ${n}</span></button></li>`).join('')}</ol>`;
}

// Cada botón de paso muestra lo elegido: «1 · Marte», «2 · Minería › Sólido»
function pintarPasos() {
  const b = cuerpo(), P = prop(), S = subDe(P);
  const valor = [null, b && BODIES[b].short, P && S && `${P.nombre} › ${plano(S.nombre)}`, null];
  $$('#steps [data-go]').forEach((btn) => { const n = +btn.dataset.go; $('.tit', btn).textContent = valor[n] ?? TITULOS[n]; });
}

function mostrarVista() {
  const inicio = est.vista == null;
  $('#inicio').hidden = !inicio; $('#wizard').hidden = inicio;
  $('#btn-empezar').textContent = cuerpo() ? 'Continue mission' : 'Start mission';
}

const utilHtml = (pre) => `<fieldset class="modo"><legend class="sr-only">Level of detail</legend>
    <label><input type="radio" name="modo-${pre}" data-modo="basico"${est.experto ? '' : ' checked'}><span>Basic mode</span></label>
    <label><input type="radio" name="modo-${pre}" data-modo="experto"${est.experto ? ' checked' : ''}><span>Expert mode</span></label></fieldset>
  <button type="button" class="btn ghost small-btn" data-abrir="glosario" aria-haspopup="dialog">Glossary</button>`;

function pintarExtras(step) {
  const P = prop(), S = subDe(P), o = OBJECTIVES[ctx.mission.objective];
  if (step === PASOS) $('#summary').insertAdjacentHTML('beforeend', S
    ? `<br><b>${esc(P.nombre)} › ${esc(plano(S.nombre))}</b> · ${plural(activos().length, 'criterion', 'criteria')}`
    : o ? `<br><b>${esc(o.name)}</b>` : '');
  $$('#steps [data-go]').forEach((b) => (+b.dataset.go === step ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current')));
}

// ---------------------------------------------------------------------------
//  Anuncios para lectores de pantalla (región aria-live «polite»)
// ---------------------------------------------------------------------------
let anuncioT = 0;
function anunciar(t, espera = 80) {
  const el = $('#anuncio');
  clearTimeout(anuncioT); el.textContent = '';
  anuncioT = setTimeout(() => { el.textContent = t; }, espera);
}
const tituloPaso = (n) => TITULOS[n] ?? '';

function anunciarCambios(step) {
  const b = cuerpo(), P = prop(), S = subDe(P), partes = [];
  if (previo.paso == null) return;                                           // primera pintura: nada que anunciar
  if (previo.paso !== step) partes.push(`Step ${step} of ${PASOS}: ${tituloPaso(step)}.`);
  if (b && previo.cuerpo !== b) partes.push(`Destination: ${BODIES[b].short}.`);
  if (P && S && (previo.proposito !== P.id || previo.sub !== S.id || (previo.cuerpo !== b && previo.cuerpo)))
    partes.push(`Purpose: ${P.nombre}. Type: ${plano(S.nombre)}${S.predeterminado ? ' (default)' : ''}. ${plural(activos().length, 'active criterion', 'active criteria')}, below.`);
  if (mensaje) partes.push(mensaje);
  mensaje = '';
  if (partes.length) anunciar(partes.join(' '));
}

// ---------------------------------------------------------------------------
//  Estado en la URL e historial
// ---------------------------------------------------------------------------
function listaCriterios() {
  const S = subDe(prop());
  if (!S || !est.off.size) return null;                                      // sin parámetro = todos activos
  return activos().map((f) => f.id).join(',') || 'ninguno';
}

// Nombre automático del proyecto: «Minería en la Luna», «Energía en Marte» (con el artículo que toca: data/propositos.json → cuerpos)
const nombreAuto = () => {
  const b = cuerpo(), P = prop(), c = cfg?.cuerpos[b];
  return !b ? null : P ? `${P.nombre} ${c?.en_cuerpo ?? `on ${BODIES[b].short}`}` : `Mission ${c?.a_cuerpo ?? `to ${BODIES[b].short}`}`;
};

let urlT = 0;
function escribirUrl(push) {
  clearTimeout(urlT);
  const escribir = (modo) => {
    const q = new URLSearchParams(location.search), m = ctx.mission, paso = ctx.getStep();
    const pon = (k, v) => (v == null || v === '' ? q.delete(k) : q.set(k, v));
    pon('cuerpo', m.body); pon('proposito', est.proposito); pon('sub', est.sub); pon('criterios', listaCriterios());
    pon('objetivo', m.body ? m.objective : null); pon('tripulacion', m.body ? m.crew : null); pon('estancia', m.body ? m.duration : null);
    pon('modo', est.experto ? 'experto' : null); pon('vista', est.vista); pon('paso', est.vista === 'mision' && paso > 1 ? paso : null);
    pon('reparto', est.vista === 'resultados' ? perfil.repartoTexto() : null);
    // Cada proyecto guarda su estado (en este navegador). Se crea al empezar una misión.
    if (est.vista && !proyectos.activo()) proyectos.crear();
    pon('proyecto', proyectos.activo()?.id);
    if (est.vista) { const g = new URLSearchParams(q); g.delete('proyecto'); proyectos.guardarEstado(g.toString(), nombreAuto()); }
    const s = q.toString(), url = location.pathname + (s ? `?${s}` : '') + location.hash;
    if (url === location.pathname + location.search + location.hash) return;
    try { history[modo](null, '', url); } catch (e) { console.warn('No se pudo actualizar la URL', e); }
  };
  if (push) escribir('pushState'); else urlT = setTimeout(() => escribir('replaceState'), 150);   // los cambios seguidos (p. ej. un control deslizante) se agrupan
}

// Lee la URL y la aplica a la misión y al flujo. Devuelve el paso que toca mostrar.
function aplicarUrl() {
  const q = new URLSearchParams(location.search), m = ctx.mission;
  m.body = BODIES[q.get('cuerpo')] ? q.get('cuerpo') : null;
  const P = m.body ? cfg?.propositos.find((p) => p.id === q.get('proposito')) : null;
  const S = P ? (P.subapartados.find((s) => s.id === q.get('sub')) ?? predet(P)) : null;
  est.proposito = P?.id ?? null; est.sub = S?.id ?? null; est.off = new Set();
  if (S && q.has('criterios')) { const on = new Set(q.get('criterios').split(',')); visibles(S).forEach((f) => { if (!on.has(f.id)) est.off.add(f.id); }); }
  if (!proyectos.activar(q.get('proyecto'))) proyectos.desactivar();         // proyecto de la URL (o ninguno)
  perfil.leerReparto(q.get('reparto'));
  m.objective = !m.body ? null : OBJECTIVES[q.get('objetivo')] ? q.get('objetivo') : (P?.objetivo_existente ?? null);
  const crew = $('#crew'), t = parseInt(q.get('tripulacion'), 10);
  if (t >= +crew.min && t <= +crew.max) m.crew = t;
  crew.value = m.crew;
  if (DURATIONS[q.get('estancia')]) m.duration = q.get('estancia');
  est.experto = q.get('modo') === 'experto';
  est.vista = q.get('vista') === 'resultados' && m.body && m.objective && (P || !cfg) ? 'resultados'
    : q.get('vista') ? 'mision' : q.has('paso') ? 'mision' : null;
  const tope = !m.body ? 1 : !(P || (cfgError && m.objective)) ? 2 : PASOS;
  return Math.min(Math.max(parseInt(q.get('paso'), 10) || 1, 1), tope);
}

function aplicarModo() {
  document.body.classList.toggle('modo-experto', est.experto);
  $$('input[data-modo]').forEach((i) => { i.checked = (i.dataset.modo === 'experto') === est.experto; });
}

const enResultados = () => $('#setup').hidden;
const cerrarDialogos = () => $$('dialog.dlg[open]').forEach((d) => d.close());

function alPopstate() {
  if (!ctx) return;
  clearTimeout(urlT); cerrarDialogos();
  desdeHistorial = true;
  try {
    if (enResultados()) { suspendido = true; ctx.reiniciar(); suspendido = false; }
    const paso = aplicarUrl();
    aplicarModo();
    if (est.vista === 'resultados') { ctx.setStep(PASOS); ctx.render(); ctx.lanzar(true); }
    else { ctx.setStep(paso); ctx.render(); enfocarPaso(paso); }
  } finally { desdeHistorial = false; }
}

function enfocarPaso(n) {
  const h = $(`#setup [data-step="${n}"] h2`);
  if (h) { h.tabIndex = -1; h.focus(); }
}

// Ir a un paso desde la línea de resumen. Desde los resultados vuelve al asistente conservando las elecciones.
function irAlPaso(n) {
  cerrarDialogos();
  if (enResultados()) {
    const m = ctx.mission, guardado = { body: m.body, objective: m.objective };
    suspendido = true; ctx.reiniciar(); suspendido = false;
    Object.assign(m, guardado);
  }
  est.vista = 'mision';
  ctx.setStep(n); ctx.render(); enfocarPaso(n);
}

function elegirProposito(id, subId = null) {
  const P = cfg.propositos.find((p) => p.id === id);
  if (!P) return;
  est.proposito = P.id; est.sub = (P.subapartados.find((s) => s.id === subId) ?? predet(P)).id;
  est.off.clear(); filtros.clear();
  ctx.mission.objective = P.objetivo_existente;                              // perfil de pesos del sistema de puntuación existente
}

// ---------------------------------------------------------------------------
//  API para js/main.js
// ---------------------------------------------------------------------------
// ¿Se puede pasar del paso? Solo el propósito (paso 2) es obligatorio; subapartado y criterios son opcionales.
export function pasoOk(step) { return step !== 2 || !!est.proposito || (!!cfgError && !!ctx?.mission.objective); }

// Se llama al final de renderSetup(): pinta los pasos nuevos, la línea de resumen y sincroniza la URL.
export function render(step) {
  if (!ctx || suspendido) return;
  const b = cuerpo();
  mostrarVista();
  // Cambio de destino: se conservan el propósito y el subapartado, y los criterios se recalculan para el nuevo cuerpo
  if (previo.paso != null && previo.cuerpo !== b && !desdeHistorial) { est.off.clear(); filtros.clear(); }
  pintarPasos(); pintarArbol(); pintarExtras(step);
  const cambioDePaso = previo.paso != null && (previo.paso !== step || previo.vista !== est.vista);
  if (desdeHistorial) clearTimeout(urlT); else escribirUrl(cambioDePaso);
  // Si el botón que tenía el foco se ha desactivado (p. ej. «Siguiente» sin propósito elegido), el foco pasa al título del paso
  const foco = document.activeElement;
  if (cambioDePaso && !desdeHistorial && (!foco || foco === document.body || foco.disabled)) enfocarPaso(step);
  anunciarCambios(step);
  previo = { paso: step, cuerpo: b, proposito: est.proposito, sub: est.sub, vista: est.vista };
}

export function alLanzar() {
  if (!ctx) return;
  est.vista = 'resultados';
  if (!desdeHistorial) escribirUrl(true);
  const P = prop(), S = subDe(P), o = OBJECTIVES[ctx.mission.objective];
  $('#chips .chip')?.insertAdjacentHTML('afterend', P ? `<span class="chip">Purpose <b>${esc(P.nombre)} › ${esc(plano(S.nombre))}</b></span>`
    : `<span class="chip">Objective <b>${esc(o.name)}</b></span>`);
}

export function alMostrarResultados(lista) {
  if (!ctx) return;
  sitios = lista; valores = null;
  const P = prop(), S = subDe(P);
  if (!P) { $('#res-criterios').hidden = true; return; }
  pintarResumenResultados();
  ctx.viewer.setBases?.(proyectos.bases(cuerpo()));
  perfil.mostrar({ body: cuerpo(), mission: ctx.mission, sitios: lista });
  const pts = S.tipo === 'puntos' ? (S.puntos?.[cuerpo()] ?? []) : [];
  ctx.viewer.setPuntos?.(pts.map((p) => ({ id: p.id, lat: p.lat, lon: p.lon, label: `Point measurement · ${esc(p.nombre)}`, title: `Heat flow point measurement: ${p.nombre}. ${p.nota}` })));
  const turno = ++medicion;
  medir(lista).then((v) => {
    if (turno !== medicion) return;
    valores = v;
    const ficha = $('#ficha-crit'), s = ficha && sitios.find((x) => x.id === ficha.dataset.site);
    if (s) ficha.outerHTML = fichaHtml(s);
    if ($('#criterios').open) { $('#dlg-tabla-cuerpo').innerHTML = tablaHtml(S); aplicarFiltros(); }
  }).catch((e) => console.warn('No se pudieron leer las capas de los criterios', e));
  const r = recuento();
  anunciar(`Results ready: ${plural(lista.length, 'site', 'sites')}. ${P.nombre}, ${plano(S.nombre)}: ${plural(r.total, 'active criterion', 'active criteria')}${r.total ? `, ${recuentoTxt(r)}` : ''}.${pts.length ? ` ${plural(pts.length, 'point measurement', 'point measurements')} on the globe.` : ''}`, 600);
}

// La capa pintada sobre el globo ha cambiado (panel «Capas de datos» o botones de este módulo)
export function alCambiarCapa(id) {
  capaGlobo = id;
  $$('[data-capa]').forEach((b) => { const on = b.dataset.capa === id; b.setAttribute('aria-pressed', on); b.classList.toggle('sel', on); });
}

export function alReiniciar() {
  cerrarDialogos();
  $('#res-criterios').hidden = true; perfil.ocultar();
  sitios = []; valores = null; medicion++; capaGlobo = null;
  if (suspendido) return;                                                    // vuelta al asistente conservando las elecciones
  est.proposito = est.sub = null; est.off.clear(); filtros.clear();
  perfil.leerReparto(null);                                                  // el gráfico del proyecto nuevo arranca con las barras iguales
  // «Nuevo proyecto»: un proyecto nuevo, salvo que el activo todavía esté vacío
  if (new URLSearchParams(proyectos.activo()?.q ?? '').has('cuerpo')) proyectos.crear();
  est.vista = 'mision';                                                      // abre el asistente, no la portada
}

// Se ha elegido un emplazamiento (lista, marcador del mapa o gráfico): el gráfico muestra su reparto
export function alSeleccionar(s) { perfil.verSitio(s.id); }

function ponerBase(id) {
  const s = sitios.find((x) => x.id === id);
  if (!s) return;
  proyectos.ponerBase({ body: cuerpo(), id: s.id, nombre: s.name });
  ctx.viewer.setBases?.(proyectos.bases(cuerpo()));
  const ficha = $('#ficha-crit'); if (ficha?.dataset.site === id) ficha.outerHTML = fichaHtml(s);
  anunciar(`Base for “${proyectos.activo().nombre}” placed at ${s.name}. It is shown on the map with a flag.`);
}

// Sección de la ficha de un emplazamiento: sus valores en las capas de los criterios activos
export function fichaHtml(s) {
  const P = prop(), S = subDe(P);
  if (!cfg || !S) return '';
  const cols = columnas();
  const lis = activos().map((f) => {
    const vals = cols.filter((k) => k.criterios.some((x) => x.id === f.id)).map((k) => { const z = valores?.[s.id]?.[k.id];
      return `<b>${valores ? (z ? esc(fmtCol(k, z.media)) : 'no data') : 'computing…'}</b>`; }).join(' · ');
    return `<li>${chip(estadoCriterio(f.items))} <span class="ficha-nom">${esc(f.nombre)}</span>${vals ? `<span class="ficha-val">${vals}</span>` : ''}</li>`;
  }).join('');
  const pr = proyectos.activo(), aqui = pr?.base?.body === cuerpo() && pr.base.id === s.id;
  return `<section class="ficha-crit" id="ficha-crit" data-site="${esc(s.id)}">
    <h4>Criteria for your purpose <span class="muted">(${esc(P.nombre)} › ${esc(plano(S.nombre))})</span></h4>
    ${lis ? `<ul class="ficha-lista">${lis}</ul>` : '<p class="small muted">There are no active criteria.</p>'}
    <p class="small muted">Mean of each layer within a ≈ ${ctx.zonaKm()} km radius. The criteria do not change the score.</p>
    <button type="button" class="btn ghost small-btn" data-abrir="criterios" aria-haspopup="dialog">Sources, limitations and table</button>
    ${pr ? (aqui ? `<p class="base-aqui"><span aria-hidden="true">🚩</span> The base for “${esc(pr.nombre)}” is here.</p>`
    : `<button type="button" class="btn primary small-btn" data-base="${esc(s.id)}">📍 Place the base for “${esc(pr.nombre)}” here</button>`) : ''}</section>`;
}

// ---------------------------------------------------------------------------
//  Resultados: capas de los criterios activos, tabla alternativa al globo y filtros ajustables
// ---------------------------------------------------------------------------
// Una columna por capa cargada (y por dato derivado) de los criterios activos
function columnas() {
  const cols = new Map();
  const pon = (id, extra, c, it) => { const k = cols.get(id) ?? { id, criterios: [], fuente: cfg.fuentes.get(it.fuente), ...extra }; if (!k.criterios.includes(c)) k.criterios.push(c); cols.set(id, k); };
  for (const f of activos()) if (f.capa) pon(f.derivada ? `${f.capa}:${f.derivada}` : f.capa, { capa: f.capa, derivada: f.derivada }, f, f.items[0]);
  return [...cols.values()];
}
const tituloCol = (k) => (k.derivada ? 'Regional slope (derived quantity)' : etiquetaCapa(k.capa));
const fmtCol = (k, v) => (k.derivada ? `${nf(v, 1)}°` : defCapa(k.capa)?.fmt(v) ?? `${nf(v, 2)} ${cfg.capas[k.capa].unidades}`);

// Media de cada capa alrededor de cada emplazamiento, con las mismas funciones que usa la puntuación existente
async function medir(lista) {
  const cols = columnas(), b = cuerpo(), out = {};
  const cargadas = await Promise.all(cols.map((k) => capa(k.capa).catch(() => null)));
  for (const s of lista) {
    out[s.id] = {};
    cols.forEach((k, i) => { const c = cargadas[i]; out[s.id][k.id] = !c ? null : k.derivada === 'pendiente' ? c.pendiente(s.lat, s.lon, RADIO_KM[b]) : c.zona(s.lat, s.lon); });
  }
  return out;
}

function pintarResumenResultados() {
  const el = $('#res-criterios'), S = subDe(prop()), capas = columnas().filter((k) => !k.derivada);
  el.hidden = false;
  el.innerHTML = `<nav class="resumen" aria-label="Summary of your selection">${migas()}</nav>
    <p class="crit-res-estado">${recuentoHtml(recuento())}</p>
    ${S.no_filtra ? '<p>This type does not filter locations.</p>' : ''}
    ${capas.length && globoDisponible() ? `<div class="lchips crit-capas" role="group" aria-label="Layers for your criteria on the globe">${capas.map((k) => botonCapa(k.capa)).join('')}</div>` : ''}
    <button type="button" class="btn ghost small-btn" data-abrir="criterios" aria-haspopup="dialog">Criteria, sources and table</button>`;
}

// Valor físico de una posición del control: los extremos son exactamente el mínimo y el máximo reales de la capa
const limite = (id, pos) => { const e = cfg.capas[id].estadisticas; return pos <= 0 ? e.min : pos >= POSICIONES ? e.max : e.min + (pos / POSICIONES) * (e.max - e.min); };

function filtrosHtml(cols) {
  const fs = cols.filter((k) => !k.derivada && cfg.capas[k.capa].estadisticas);
  if (!fs.length) return '';
  return `<details class="filtros-caja"${filtros.size ? ' open' : ''}><summary>Filter the sites by value (optional)</summary>
    <p class="bloque-nota">There are no fixed thresholds: you choose them. Each control runs from the actual minimum to the actual maximum of the loaded layer. The filter only marks which sites fall inside; it does not change the ranking or the score.</p>
    <div class="filtros">${fs.map((k) => { const f = filtros.get(k.capa) ?? { a: 0, b: POSICIONES }, id = esc(k.capa);
    const control = (lim, nombre, pos) => `<label><span>${nombre}</span><input type="range" data-lim="${lim}" min="0" max="${POSICIONES}" step="1" value="${pos}" aria-valuetext="${esc(fmtCol(k, limite(k.capa, pos)))}">
        <output data-out="${lim}">${esc(fmtCol(k, limite(k.capa, pos)))}</output></label>`;
    return `<fieldset class="filtro" data-filtro-capa="${id}"><legend>${esc(tituloCol(k))}</legend>${control('a', 'Minimum', f.a)}${control('b', 'Maximum', f.b)}
        <small>Actual range of the layer: from ${esc(fmtCol(k, limite(k.capa, 0)))} to ${esc(fmtCol(k, limite(k.capa, POSICIONES)))}</small></fieldset>`; }).join('')}</div>
    <p class="filtros-resumen" id="filtros-resumen"></p>
    <button type="button" class="btn ghost small-btn" id="filtros-quitar">Clear the filters</button></details>`;
}

function tablaHtml(S) {
  const cols = columnas(), b = cuerpo(), o = OBJECTIVES[ctx.mission.objective];
  if (!sitios.length) return '<p class="bloque-nota">There are no results yet.</p>';
  const celda = (s, k) => { const z = valores?.[s.id]?.[k.id]; return !valores ? 'computing…' : z ? esc(fmtCol(k, z.media)) : 'No data'; };
  const sinDatos = activos().filter((f) => estadoCriterio(f.items) !== 'datos');
  return `${S.no_filtra ? '' : filtrosHtml(cols)}
    <div class="tabla-scroll" tabindex="0" role="region" aria-label="Table of sites and criteria layers"><table class="tabla" id="tabla-crit">
      <caption>Candidate sites ${esc(cfg.cuerpos[b]?.en_cuerpo ?? `on ${BODIES[b].short}`)}, in the order of the site’s existing score (“${esc(o.name)}” profile).
        ${cols.length ? `Each value is the mean of the layer within a radius of about ${ctx.zonaKm()} km around the site.` : 'No active criterion has a loaded layer yet: there are no layer values to show.'}</caption>
      <thead><tr><th scope="col">No.</th><th scope="col">Site</th><th scope="col">Existing score</th>
        ${cols.map((k) => `<th scope="col">${esc(tituloCol(k))}<small>${[...new Set(k.criterios.map((f) => plano(f.criterio.nombre)))].map(esc).join(' · ')}</small></th>`).join('')}
        ${S.no_filtra || !cols.length ? '' : '<th scope="col">Your filters</th>'}</tr></thead>
      <tbody>${sitios.map((s) => `<tr data-site="${esc(s.id)}"><td class="num">${s.rank}</td><th scope="row">${esc(s.name)}<small>${esc(s.region)}</small></th><td class="num">${s.score}</td>
        ${cols.map((k) => `<td class="num">${celda(s, k)}</td>`).join('')}${S.no_filtra || !cols.length ? '' : '<td data-filtro>—</td>'}</tr>`).join('')}</tbody></table></div>
    ${cols.length ? `<p class="crit-sub">Column sources</p><ul class="fuentes">${cols.map((k) => { const f = k.fuente, m = cfg.capas[k.capa];
    return `<li class="fuente"><b class="f-nom">${esc(tituloCol(k))}</b> <span class="f-que">${esc(f.nom)}${k.derivada ? '. Derived quantity: the slope is computed on the site from the elevation model.' : ''}</span>${meta(f)}
        <span class="solo-experto f-id">${f.producte ? `Product: <code>${esc(f.producte)}</code> · ` : ''}Registry: <code>${esc(f.id)}</code>${capaExperto(k.capa)}${m.fuente?.cita ? ` · Citation: ${esc(m.fuente.cita)}` : ''}</span>${limitaciones(f)}</li>`; }).join('')}</ul>` : ''}
    ${sinDatos.length ? `<p class="crit-sub">Active criteria without a loaded layer</p><ul class="fuentes">${sinDatos.map((f) => `<li class="fuente">${chip(estadoCriterio(f.items))} <span class="f-que">${esc(f.nombre)}</span></li>`).join('')}</ul>` : ''}`;
}

let filtroT = 0;
function aplicarFiltros(hablar = false) {
  const act = [...filtros], resumen = $('#filtros-resumen');
  if (!resumen) return;
  let dentro = 0;
  for (const tr of $$('#tabla-crit tbody tr')) {
    const td = $('[data-filtro]', tr), v = valores?.[tr.dataset.site];
    if (!td) continue;
    if (!act.length || !v) { td.textContent = '—'; continue; }
    const fuera = [], sin = [];
    for (const [id, f] of act) { const z = v[id]; if (!z) sin.push(id); else if (z.media < limite(id, f.a) || z.media > limite(id, f.b)) fuera.push(id); }
    td.textContent = fuera.length ? `✕ Outside: ${fuera.map(etiquetaCapa).join(', ')}` : sin.length ? `? No data: ${sin.map(etiquetaCapa).join(', ')}` : '✔ Inside';
    if (!fuera.length && !sin.length) dentro++;
  }
  resumen.textContent = act.length ? `${dentro} of ${plural(sitios.length, 'site', 'sites')} within your filters.` : 'No active filters: no site is excluded.';
  if (hablar) { clearTimeout(filtroT); filtroT = setTimeout(() => anunciar(resumen.textContent), 500); }
}

function pintarDialogo() {
  const P = prop(), S = subDe(P), b = cuerpo(), o = OBJECTIVES[ctx.mission.objective], act = activos(), inact = visibles(S).filter((f) => est.off.has(f.id));
  const cuerpos = (f) => f.cos.map((c) => COS[c] ?? c).join(', ');
  $('#criterios').innerHTML = `
    <button type="button" class="close" data-cerrar aria-label="Close">✕</button>
    <span class="tag">CRITERIA AND SOURCES</span>
    <h2 id="criterios-titulo" tabindex="-1">${esc(BODIES[b].short)} › ${esc(P.nombre)} › ${esc(plano(S.nombre))}</h2>
    <div class="flujo-barra"><nav class="resumen" aria-label="Summary of your selection">${migas()}</nav><div class="flujo-util">${utilHtml('d')}</div></div>
    <p class="dlg-nota">The ranking and the 0–100 score come from the site’s existing system (“${esc(o.name)}” profile, with weights set by the team). The active criteria do not change that score: they decide which layers are offered on the globe, in the table and in each site’s details panel. ${esc(cfg.pesos)}</p>
    ${avisosHtml(P, S)}
    <section class="bloque datos" aria-labelledby="d-datos"><h3 id="d-datos">Data · ${plural(act.length, 'active criterion', 'active criteria')}</h3>
      ${act.map((f) => criterioHtml(f, P, { pre: 'd', globo: true })).join('') || '<p class="bloque-nota">There are no active criteria.</p>'}
      ${inact.length ? `<p class="bloque-nota">Turned off: ${inact.map((f) => esc(f.nombre)).join(', ')}.</p>` : ''}
      <button type="button" class="enlace-btn" data-ir="2">Change the criteria (back to the setup wizard)</button>
    </section>
    ${puntosHtml(S, 'd')}
    <section class="bloque datos" aria-labelledby="d-tabla"><h3 id="d-tabla">Site table</h3>
      <p class="bloque-nota">A table alternative to the globe: the same sites, the same layers and the same sources.</p>
      <div id="dlg-tabla-cuerpo">${tablaHtml(S)}</div>
    </section>
    ${contextoHtml(S, 'd')}
    <details class="registro"><summary>Recorded data gaps (${cfg.vacios.size})</summary>
      <ul class="fuentes">${[...cfg.vacios.values()].map((v) => `<li class="fuente">${chip(v.estat === 'pendent_de_verificar' ? 'verificar' : 'pendiente')} <span class="f-que">${esc(v.descripcio)}</span>
        <span class="f-meta">${esc(v.cos.map((c) => COS[c] ?? c).join(', '))} · reviewed ${fecha(v.data_consulta)}</span></li>`).join('')}</ul></details>
    <details class="registro"><summary>Source registry (${cfg.fuentes.size})</summary>
      <div class="tabla-scroll" tabindex="0" role="region" aria-label="Source registry"><table class="tabla">
        <caption>All sources in the registry (data/sources.json)</caption>
        <thead><tr><th scope="col">Source</th><th scope="col">Agency</th><th scope="col">Body</th><th scope="col">Status</th><th scope="col" class="solo-experto">Product</th><th scope="col">Accessed</th></tr></thead>
        <tbody>${[...cfg.fuentes.values()].map((f) => `<tr><th scope="row">${enlace(f, f.nom)}</th><td>${esc(f.agencia)}</td><td>${esc(cuerpos(f))}</td>
          <td>${chip(f.estat === 'verificat' ? 'datos' : 'verificar').replace(ESTADOS.datos.txt, ESTAT.verificat)}${f.estat_nota ? `<small>${esc(f.estat_nota)}</small>` : ''}</td>
          <td class="solo-experto">${f.producte ? `<code>${esc(f.producte)}</code>` : '—'}<small><code>${esc(f.id)}</code></small></td><td>${fecha(f.data_consulta)}</td></tr>`).join('')}</tbody></table></div></details>`;
  aplicarFiltros();
}

function pintarGlosario() {
  const terminos = [...cfg.glosario.values()].sort((a, b) => a.termino.localeCompare(b.termino, 'en'));
  $('#glosario').innerHTML = `
    <button type="button" class="close" data-cerrar aria-label="Close">✕</button>
    <span class="tag">GLOSSARY</span>
    <h2 id="glosario-titulo" tabindex="-1">Technical terms</h2>
    <p class="dlg-nota">Each definition is written from its source’s documentation, without adding values.</p>
    <dl class="glosario">${terminos.map((g) => `<dt>${esc(g.termino)}</dt><dd>${esc(g.definicion)}${g.nota ? ` <i>${esc(g.nota)}</i>` : ''}${meta(cfg.fuentes.get(g.fuente))}</dd>`).join('')}</dl>`;
}

function abrir(cual) {
  if (!cfg) return;
  if (cual === 'criterios') { if (!subDe(prop())) return; pintarDialogo(); } else pintarGlosario();
  const d = $(`#${cual}`);
  if (!d.open) d.showModal();
  $('h2', d).focus(); d.scrollTop = 0;
}

// ---------------------------------------------------------------------------
//  Definiciones emergentes de los términos técnicos (se abren y se cierran con el teclado)
// ---------------------------------------------------------------------------
function cerrarDefiniciones() {
  const abiertas = $$('.def');
  abiertas.forEach((d) => d.remove());
  $$('.termino[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  return abiertas.length > 0;
}

function abrirDefinicion(b) {
  const g = cfg.glosario.get(b.dataset.term), d = document.createElement('span');
  d.className = 'def';
  d.innerHTML = `<b>${esc(g.termino)}.</b> ${esc(g.definicion)}${g.nota ? ` <i>${esc(g.nota)}</i>` : ''}${meta(cfg.fuentes.get(g.fuente))}`;
  b.setAttribute('aria-expanded', 'true'); b.after(d);
  anunciar(`${g.termino}. ${g.definicion}${g.nota ? ` ${g.nota}` : ''}`);
}

// ---------------------------------------------------------------------------
//  Eventos
// ---------------------------------------------------------------------------
function montar() {
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!cfg || !(t instanceof HTMLInputElement)) return;
    if (t.name === 'proposito') { elegirProposito(t.value); ctx.render(); }
    else if (t.name === 'sub') { est.sub = t.value; est.off.clear(); filtros.clear(); ctx.render(); }
    else if (t.dataset.crit) {
      const S = subDe(prop()), f = visibles(S).find((x) => x.id === t.dataset.crit);
      if (t.checked) est.off.delete(f.id); else est.off.add(f.id);
      mensaje = `Criterion “${f.nombre}” ${t.checked ? 'turned on' : 'turned off'}. ${activos().length} of ${visibles(S).length} criteria active.`;
      ctx.render();
    } else if (t.dataset.modo) {
      est.experto = t.dataset.modo === 'experto'; aplicarModo(); escribirUrl(false);
      anunciar(est.experto ? 'Expert mode: product and registry identifiers are shown.' : 'Basic mode: only the plain-language name of each layer is shown.');
    }
  });

  document.addEventListener('click', (e) => {
    if (!cfg) return;
    const termino = e.target.closest('.termino');
    if (termino) { const abierta = termino.getAttribute('aria-expanded') === 'true'; cerrarDefiniciones(); if (!abierta) abrirDefinicion(termino); return; }
    if (!e.target.closest('.def')) cerrarDefiniciones();
    const b = e.target.closest('[data-ir], [data-ver], [data-abrir], [data-capa], [data-cerrar], [data-base], #filtros-quitar');
    if (!b) {                                                                // clic en el fondo oscuro, fuera del diálogo
      const d = e.target;
      if (d instanceof HTMLDialogElement && d.classList.contains('dlg')) {
        const r = d.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
      }
      return;
    }
    if (b.dataset.ir) irAlPaso(+b.dataset.ir);
    else if (b.dataset.ver) { elegirProposito(b.dataset.ver, b.dataset.verSub || null); irAlPaso(2); }
    else if (b.dataset.base) ponerBase(b.dataset.base);
    else if (b.dataset.abrir) abrir(b.dataset.abrir);
    else if (b.dataset.capa) {
      const id = b.dataset.capa, quitar = ctx.capaActiva() === id;
      ctx.setLayer(id); cerrarDialogos();
      anunciar(quitar ? `Layer “${etiquetaCapa(id)}” removed from the globe.` : `Layer “${etiquetaCapa(id)}” painted on the globe. Its legend is in the Data layers panel.`, 300);
    } else if (b.hasAttribute('data-cerrar')) b.closest('dialog').close();
    else if (b.id === 'filtros-quitar') {
      filtros.clear();
      const S = subDe(prop()); $('#dlg-tabla-cuerpo').innerHTML = tablaHtml(S); $('.filtros-caja').open = true; aplicarFiltros(true); $('#filtros-quitar').focus();
    }
  });

  // Controles de filtro: el rango sale de la capa; el usuario elige mínimo y máximo
  document.addEventListener('input', (e) => {
    const inp = e.target.closest?.('[data-lim]');
    if (!inp) return;
    const caja = inp.closest('[data-filtro-capa]'), id = caja.dataset.filtroCapa, ia = $('[data-lim="a"]', caja), ib = $('[data-lim="b"]', caja);
    if (+ia.value > +ib.value) { if (inp === ia) ib.value = ia.value; else ia.value = ib.value; }   // el mínimo no supera al máximo
    const a = +ia.value, b = +ib.value, k = { capa: id };
    if (a <= 0 && b >= POSICIONES) filtros.delete(id); else filtros.set(id, { a, b });
    for (const [i, lim] of [[ia, 'a'], [ib, 'b']]) { const t = fmtCol(k, limite(id, +i.value)); i.setAttribute('aria-valuetext', t); $(`[data-out="${lim}"]`, caja).textContent = t; }
    aplicarFiltros(true);
  });

  // Portada: empezar (o continuar) la misión, lo trabajado (panel #about, ya existente)
  $('#btn-empezar').addEventListener('click', () => {
    est.vista = 'mision'; ctx.render(); enfocarPaso(ctx.getStep());
  });
  $('#btn-inicio').addEventListener('click', () => {
    est.vista = null; ctx.render(); $('#btn-empezar').focus();
  });

  // Escape cierra primero una definición abierta; dentro de un diálogo no llega al resto de la página
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (cerrarDefiniciones()) { e.preventDefault(); e.stopPropagation(); return; }
    if (e.target.closest?.('dialog.dlg')) { e.stopPropagation(); return; }
    for (const id of ['comparacion', 'analisis', 'about']) if (!$(`#${id}`).hidden) { $(`#${id}`).hidden = true; e.stopPropagation(); return; }
  }, true);

  addEventListener('popstate', alPopstate);
}

// Arranque: carga la configuración y aplica el estado que venga en la URL
export async function iniciar(c) {
  ctx = c;
  montar();
  { const q = new URLSearchParams(location.search); est.vista = q.get('vista') ? 'mision' : q.has('paso') ? 'mision' : null; mostrarVista(); }
  try { await cargar(); } catch (e) { cfgError = e; console.error('No se pudo cargar la configuración del flujo de propósito', e); }
  proyectos.iniciar({
    abrir: alPopstate,                                                       // el proyecto ya está escrito en la URL
    nuevo: () => $('#btn-new').click(),                                      // misma acción que «Nuevo proyecto» de la barra superior
    inicio: () => { if (enResultados()) { suspendido = true; ctx.reiniciar(); suspendido = false; } est.vista = null; ctx.setStep(1); ctx.render(); },
    cuerpo: (b) => BODIES[b]?.short,
  });
  perfil.iniciar({
    propositos: (cfg?.propositos ?? []).map((p) => ({ id: p.id, nombre: p.nombre, inicial: p.inicial, objetivo: p.objetivo_existente })),
    anunciar, seleccionar: (id) => ctx.seleccionar(id), ponerBase, hayProyecto: () => !!proyectos.activo(),
    alCambiar: () => escribirUrl(false), marcar: (clase, id) => ctx.viewer.marcar?.(clase, id),
  });
  desdeHistorial = true;
  try {
    const q = new URLSearchParams(location.search);
    if (q.has('cuerpo') && !q.has('proyecto')) {                             // enlace compartido: se guarda como proyecto nuevo
      q.set('proyecto', proyectos.crear().id);
      history.replaceState(null, '', `${location.pathname}?${q}${location.hash}`);
    }
    const paso = aplicarUrl();
    aplicarModo();
    if (est.vista === 'resultados') { ctx.setStep(PASOS); ctx.render(); ctx.lanzar(true); }
    else { ctx.setStep(paso); ctx.render(); }
  } finally { desdeHistorial = false; }
}
