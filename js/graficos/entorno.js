// ============================================================================
//  EL ENTORNO DEL EMPLAZAMIENTO  (ficha de un emplazamiento; no va en el panel de comparación)
//
//  Mapa local cuadrado, norte arriba, de lado 2·RADIO_ENTORNO_KM km y centrado en el emplazamiento: el color es una capa
//  real (elevación, pendiente, rugosidad o inercia térmica: las que cumplen esLocal) y el claroscuro es el relieve
//  sombreado de la elevación. Encima: el círculo de la zona que la web mide (RADIO_ZONA grados de arco), el centro,
//  el norte y una barra de escala.
//
//  De dónde sale cada número:
//  - Imagen: js/analitica.js → ventana(capa, lat, lon, R, 180, Rkm, { suave: true }) (azimutal equidistante; interpola
//    entre celdas SOLO para la vista). La escala de color es local: del mínimo al máximo de esa imagen.
//  - Lectura con el cursor, el dedo o las flechas: puntoVentana → [lat, lon] y Capa.en(lat, lon), es decir, el valor
//    de la celda publicada que contiene el punto (nunca el interpolado). Distancia y rumbo: geometría de la proyección.
//  - Tabla: Capa.en en el emplazamiento y mínimo/máximo de ventana(..., { suave: false }) muestreada a medio paso de rejilla.
//  - Círculo: RADIO_ZONA·π/180·Rkm km. Barra de escala: una marca redonda de marcas() cercana a un cuarto del lado.
//  - Exageración vertical del sombreado: ctx.exageracion (js/analitica.js → exageracionRelieve), solo ayuda visual.
//  Aquí no hay puntuación, umbrales ni estimaciones.
//
//  ctx = { body, cuerpo, Rkm, sitio, cols, exageracion, estado, repintar }   (sin filas ni sel: es la ficha de UN sitio)
// ============================================================================
import { RAMPAS, RADIO_KM, RADIO_ZONA } from '../capas.js';
import { ventana, puntoVentana, esLocal, RADIO_ENTORNO_KM } from '../analitica.js';
import { esc, nf, coord, marcas, decimalesDe, tip, tipHtml, tabla, figura, fuenteDe } from './base.js';
import { pintarRelieve } from './relieve.js';

const DEG = Math.PI / 180;
const N = 180;                                                  // píxeles de lado de la imagen (≈ 2 por celda de 0,125°)
const VIENTOS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const FLECHAS = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };   // [este, norte]
const r2 = (v) => Number(v.toFixed(2));
const valor = (k, v) => (v != null && v === v ? k.def.fmt(v) : 'no data');
const celdaKm = (c, Rkm) => Math.abs(c.meta.dlat) * DEG * Rkm; // lado de una celda de la rejilla, en km

// Las ventanas cuestan unos milisegundos cada una: se guardan en el estado (que sobrevive a los repintados) mientras
// no cambie el emplazamiento, de modo que cambiar de capa o mover el cursor no recalcula nada.
function memoria(estado, body, sitio, R) {
  const clave = [body, sitio.id, sitio.lat, sitio.lon, R].join('|');
  if (estado.memo?.clave !== clave) estado.memo = { clave, suave: new Map(), cruda: new Map() };
  return estado.memo;
}

// Trazos del SVG superpuesto: cada forma se dibuja dos veces (borde oscuro y trazo blanco) para leerse sobre cualquier color
const conBorde = (formas) => `<g class="g-en-halo">${formas}</g><g class="g-en-trazo">${formas}</g>`;

export function pintar(el, ctx) {
  const { body, sitio } = ctx, estado = ctx.estado ?? {}, Rkm = ctx.Rkm ?? RADIO_KM[body], R = RADIO_ENTORNO_KM[body];
  const elegibles = (ctx.cols ?? []).filter((k) => esLocal(k.capa));
  if (!sitio || !R || !Rkm || !elegibles.length) {
    el.innerHTML = figura({ titulo: 'Surroundings of the site', clase: 'g-en',
      cuerpo: '<p class="g-vacio">No layer has enough resolution to draw the surroundings.</p>' });
    return;
  }
  const { lat, lon } = sitio, lado = 2 * R, memo = memoria(estado, body, sitio, R);
  const kElev = elegibles.find((k) => k.def.id.endsWith('_elev')) ?? null;
  const k = elegibles.find((x) => x.def.id === estado.capa) ?? kElev ?? elegibles[0];   // por defecto, la elevación
  estado.capa = k.def.id;

  const suaveDe = (x) => {
    let v = memo.suave.get(x.def.id);
    if (!v) { v = ventana(x.capa, lat, lon, R, N, Rkm, { suave: true }); v.huecos = v.v.some((z) => z !== z); memo.suave.set(x.def.id, v); }
    return v;
  };
  // Extremos de las celdas publicadas (sin interpolar). La ventana se muestrea a MEDIO paso de rejilla (dos puntos por
  // celda de lado): a paso entero, como la proyección no está alineada con la rejilla, se saltan celdas y el máximo de
  // la tabla podía quedar por debajo del de la imagen. Muy cerca del polo las celdas se estrechan y aún puede saltarse alguna.
  const crudaDe = (x) => {
    let v = memo.cruda.get(x.def.id);
    if (!v) {
      const n = 2 * Math.max(1, Math.round(lado / celdaKm(x.capa, Rkm))), w = ventana(x.capa, lat, lon, R, n, Rkm, { suave: false });
      v = { n, min: w.min <= w.max ? w.min : NaN, max: w.min <= w.max ? w.max : NaN };
      memo.cruda.set(x.def.id, v);
    }
    return v;
  };

  const vElev = kElev ? suaveDe(kElev) : null, vTinte = k === kElev ? vElev : suaveDe(k);
  const hayDato = vTinte.min <= vTinte.max, tramo = vTinte.max - vTinte.min, inv = !!k.def.invertir;
  // Escala de color LOCAL y lineal entre el mínimo y el máximo de esta imagen (invertida si la capa lo pide, como en el globo)
  const pos = (v) => { const t = tramo > 0 ? (v - vTinte.min) / tramo : 0.5; return inv ? 1 - t : t; };
  const paradas = RAMPAS[k.def.rampa] ?? RAMPAS.relieve;
  const exa = ctx.exageracion > 0 ? ctx.exageracion : 1;

  // ---- SVG superpuesto (viewBox 0 0 100 100 = el cuadrado entero) ----
  const u = 100 / lado;                                         // unidades del viewBox por km
  const zonaKm = RADIO_ZONA * DEG * Rkm, rz = r2(zonaKm * u);
  const redondas = marcas(0, lado / 2, 4).filter((v) => v > 0);
  const barraKm = redondas.reduce((a, b) => (Math.abs(b - lado / 4) < Math.abs(a - lado / 4) ? b : a), redondas[0] ?? lado / 4);
  const xb = 4, yb = 95.5, lb = r2(barraKm * u);
  const brazo = 'M-4.6 0H-1.6M1.6 0H4.6M0 -4.6V-1.6M0 1.6V4.6';  // cruz con el centro abierto: no tapa el punto que se lee
  const svg = `<svg class="g-en-svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    ${conBorde(`<circle cx="50" cy="50" r="${rz}"/><path d="M50 48.7V51.3M48.7 50H51.3"/>
      <path d="M${xb} ${yb - 1.3}V${yb}H${r2(xb + lb)}V${yb - 1.3}"/><path d="M94 14.6V7.4M91.9 10.1L94 7.2L96.1 10.1"/>`)}
    <text x="${xb}" y="${yb - 2.6}">${esc(nf(barraKm, decimalesDe([barraKm])))} km</text>
    <text x="94" y="5.6" text-anchor="middle">N</text>
    <g class="g-en-cruz" display="none">${conBorde(`<path d="${brazo}"/>`)}</g>
  </svg>`;

  // ---- controles, mapa y leyenda ----
  const selector = elegibles.length > 1 ? `<div class="g-ctl" role="group" aria-label="Layer that sets the map color"><div class="g-seg">${elegibles.map((x) =>
    `<button type="button" data-clave="en-${esc(x.def.id)}" aria-pressed="${x === k}">${esc(x.def.corto)}</button>`).join('')}</div></div>` : '';
  const rotulo = `Map of ${k.def.corto.toLowerCase()} in a ${nf(lado)} km square centered on ${sitio.name}, north up. `
    + 'The arrow keys move the reading point one cell (five with Shift) and read its value; Escape hides it. The values are also in the table.';
  const degradado = (inv ? [...paradas].reverse() : paradas).join(', ');
  const ley = `<div class="g-en-ley">
    <i class="g-en-barra" style="background: linear-gradient(90deg, ${esc(degradado)})" aria-hidden="true"></i>
    <div class="g-en-ext">${hayDato ? `<span>${esc(k.def.fmt(vTinte.min))}</span><span>${esc(k.def.fmt(vTinte.max))}</span>` : '<span>no data in these surroundings</span>'}</div>
    <div class="g-en-nota"><span>${esc(k.def.corto)}: scale of this map${inv ? ' (inverted: light = low value)' : ''}</span>${
      vTinte.huecos ? '<span><i class="g-en-hueco" aria-hidden="true"></i>no data</span>' : ''}</div>
  </div>`;
  const cuerpo = `${selector}
    <div class="g-en-mapa" tabindex="0" role="application" aria-label="${esc(rotulo)}">
      <canvas class="g-en-cv" width="${N}" height="${N}" aria-hidden="true"></canvas>${svg}
    </div>
    <p class="g-en-vivo" role="status" aria-live="polite"></p>${ley}`;

  // ---- pie: de dónde sale cada número ----
  const fuentes = k === kElev ? `<b>Elevation and relief:</b> ${esc(fuenteDe(k.capa))}.`
    : `${kElev ? `<b>Relief:</b> ${esc(fuenteDe(kElev.capa))}. ` : ''}<b>${esc(k.def.corto)}${k.derivada ? ' (derived quantity)' : ''}:</b> ${esc(fuenteDe(k.capa))}.`;
  const pie = `${fuentes} Azimuthal equidistant projection centered on the site, north up: distances and bearings from the center are exact.
    ${kElev ? `The shading (light from the northwest, vertical exaggeration ×${esc(exa >= 1 ? nf(Math.round(exa)) : nf(exa, 1))}) only helps to read the relief; it is not data. ` : ''}
    The image interpolates between cells and its color scale runs from the minimum to the maximum of what is shown; the cursor and the table give the value of the published cell.
    Circle: the measured area, ${esc(nf(RADIO_ZONA, 1))}° of arc (${esc(nf(zonaKm, 0))} km).${
      Math.abs(lat) > 85 ? ' Near the pole, “north” is the direction of the site’s meridian.' : ''}`;

  // ---- alternativa en tabla: celdas publicadas, sin interpolar ----
  const tablaHtml = tabla({
    titulo: `Surroundings of ${sitio.name} (${coord(lat, lon)}): cell of the site and extremes of the published cells (not interpolated, sampled at half the grid spacing) in a ${nf(lado)} km square`,
    cabeceras: ['Layer', 'At the site', 'Minimum of the surroundings', 'Maximum of the surroundings'],
    filas: elegibles.map((x) => { const c = crudaDe(x); return [`${x.def.corto}${x.derivada ? ' (derived)' : ''}`, valor(x, x.capa.en(lat, lon)), valor(x, c.min), valor(x, c.max)]; }),
    abierta: !!estado.tabla,
  });

  el.innerHTML = figura({
    titulo: `Surroundings of the site: ${nf(lado)} × ${nf(lado)} km`,
    sub: `Real relief around the site; the circle is the measured area (${nf(RADIO_ZONA, 1)}° of arc).`,
    cuerpo, pie, tablaHtml, clase: 'g-en',
  });

  const mapa = el.querySelector('.g-en-mapa'), cruz = el.querySelector('.g-en-cruz'), vivo = el.querySelector('.g-en-vivo');
  pintarRelieve(el.querySelector('.g-en-cv'), { elev: vElev, tinte: vTinte, paradas, pos, exageracion: exa, suelo: 20 });

  // ---- lectura de un punto: (x km al este, y km al norte) del emplazamiento → celda publicada ----
  const leer = (x, y) => {
    const [la, lo] = puntoVentana(vTinte, x, y), d = Math.hypot(x, y), az = (Math.atan2(x, y) / DEG + 360) % 360;
    const km = nf(d, 0), donde = km === '0' ? 'at the site' : `${km} km ${VIENTOS[Math.round(az / 45) % 8]}`;
    const filas = [];
    if (kElev) filas.push([kElev.def.corto, valor(kElev, kElev.capa.en(la, lo))]);
    if (k !== kElev) filas.push([k.def.corto, valor(k, k.capa.en(la, lo))]);
    return { titulo: coord(la, lo), donde, filas };
  };
  let punto = { x: 0, y: 0 }, visible = false;                  // el punto de lectura empieza en el emplazamiento
  const mostrar = (x, y, cx, cy, anunciar) => {
    const l = leer(x, y);
    punto = { x, y }; visible = true;
    cruz.setAttribute('transform', `translate(${r2((x / lado + 0.5) * 100)} ${r2((0.5 - y / lado) * 100)})`);
    cruz.removeAttribute('display');
    tip(tipHtml(l.titulo, [['Position', l.donde], ...l.filas], 'Value of the published cell (not interpolated)'), cx, cy);
    if (anunciar) vivo.textContent = `${l.titulo}, ${l.donde}. ${l.filas.map(([a, b]) => `${a}: ${b}`).join('. ')}.`;
  };
  const ocultar = () => { visible = false; cruz.setAttribute('display', 'none'); tip(null); };

  // Cursor o dedo: la posición dentro de la caja del mapa da los km al este y al norte del centro
  const alPuntero = (e) => {
    const r = mapa.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), fy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    mostrar((fx - 0.5) * lado, (0.5 - fy) * lado, e.clientX, e.clientY, false);
  };
  mapa.addEventListener('pointermove', alPuntero);
  mapa.addEventListener('pointerdown', alPuntero);
  // Con el dedo, la lectura se queda al levantarlo (si no, la taparía el propio dedo); se va al tocar fuera o al desplazar.
  // Al salir el cursor, el punto de lectura vuelve al emplazamiento: quien siga con el teclado empieza en el centro.
  mapa.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') { ocultar(); punto = { x: 0, y: 0 }; } });
  mapa.addEventListener('pointercancel', ocultar);

  // Teclado: el mismo tooltip, colocado junto al punto de lectura
  const alTeclado = (x, y) => {
    const r = mapa.getBoundingClientRect();
    mostrar(x, y, r.left + (x / lado + 0.5) * r.width, r.top + (0.5 - y / lado) * r.height, true);
  };
  const paso = celdaKm(k.capa, Rkm), dentro = (v) => Math.min(R, Math.max(-R, v));
  mapa.addEventListener('focus', () => alTeclado(punto.x, punto.y));
  mapa.addEventListener('blur', ocultar);
  mapa.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (visible) { ocultar(); e.stopPropagation(); } return; }   // primero cierra la lectura, no la ficha
    const d = FLECHAS[e.key];
    if (!d || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault(); e.stopPropagation();                    // que las flechas no desplacen la ficha ni muevan otra cosa
    const m = paso * (e.shiftKey ? 5 : 1);
    alTeclado(dentro(punto.x + d[0] * m), dentro(punto.y + d[1] * m));
  });

  // ---- cambio de capa y estado de la tabla ----
  el.addEventListener('click', (e) => {
    const b = e.target.closest?.('button[data-clave^="en-"]');
    if (!b || !el.contains(b)) return;
    const id = b.dataset.clave.slice(3);
    if (id === estado.capa || !elegibles.some((x) => x.def.id === id)) return;
    estado.capa = id; estado.foco = b.dataset.clave;            // el foco vuelve al botón equivalente tras repintar
    tip(null);
    ctx.repintar?.();
  });
  el.querySelector('details.g-tabla')?.addEventListener('toggle', (e) => { estado.tabla = e.currentTarget.open; });
  if (estado.foco) {
    const b = [...el.querySelectorAll('button[data-clave]')].find((x) => x.dataset.clave === estado.foco);
    estado.foco = null;
    if (b) { if (el.isConnected) b.focus({ preventScroll: true }); else requestAnimationFrame(() => b.focus({ preventScroll: true })); }
  }
}
