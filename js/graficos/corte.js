// ============================================================================
//  PERFIL DEL TERRENO  (ficha de un emplazamiento, junto al mapa del entorno)
//
//  Qué muestra: dos cortes de la elevación que pasan por el emplazamiento —oeste → este y sur → norte— en un solo
//  gráfico de líneas: eje X = distancia al emplazamiento (km, de −R a +R) y UN eje Y = elevación (m). Las dos líneas
//  se cruzan en x = 0, que es el emplazamiento.
//
//  De dónde sale cada número (nada escrito a mano):
//  - Capa: la de elevación del cuerpo que llega en ctx.cols (id «…_elev»: LOLA en la Luna, MOLA en Marte).
//  - Recorrido: R = RADIO_ENTORNO_KM[body], el mismo medio lado que el mapa del entorno. 161 muestras por corte.
//  - Línea dibujada: js/analitica.js corte(…, { suave: true }) → interpolación bilineal entre centros de celda. Solo
//    sirve para dibujar; ninguna cifra sale de ahí.
//  - Cifras (etiqueta del emplazamiento, cursor, tabla, resumen para lectores de pantalla): corte(…, { suave: false })
//    y Capa.en → el valor de la celda publicada que contiene cada punto.
//  - Banda «zona medida»: ±RADIO_ZONA grados de arco pasados a km (RADIO_ZONA·π/180·Rkm): las celdas que se promedian
//    en las mediciones de la ficha.
//  - Exageración vertical: (px por metro en vertical) / (px por metro en horizontal) con las medidas del viewBox. El SVG
//    se escala entero, así que vale para cualquier ancho en pantalla.
//
//  Aquí no hay «bueno» ni «malo»: los colores solo distinguen los dos cortes.
// ============================================================================
import { RADIO_ZONA } from '../capas.js';
import { corte, RADIO_ENTORNO_KM } from '../analitica.js';
import { esc, nf, COLOR, lineal, marcas, decimalesDe, tip, conTip, tipHtml, tabla, figura, leyenda, nombreCorto, fuenteDe } from './base.js';

const N = 161;                                   // muestras por corte: impar, para que la central caiga en el emplazamiento
// La ficha mide ≈ 358 px: con un viewBox de 360 los textos de 10 px se ven casi a su tamaño
const W = 360, H = 218, M = { t: 28, r: 4, b: 34, l: 40 };
const HOLGURA = 14;                              // hueco a cada lado del trazo para las letras O/E y S/N
const SERIES = [
  { az: 90, nombre: 'West → East', ini: 'W', fin: 'E', antes: 'to the west', despues: 'to the east' },
  { az: 0, nombre: 'South → North', ini: 'S', fin: 'N', antes: 'to the south', despues: 'to the north' },
];

const vacio = (el, texto) => { el.innerHTML = `<p class="g-vacio">${esc(texto)}</p>`; };

export function pintar(el, ctx) {
  const { body, Rkm, sitio } = ctx, col = ctx.cols.find((k) => k.def.id.endsWith('_elev'));
  const R = RADIO_ENTORNO_KM[body];
  if (!col || !R) return vacio(el, 'There is no elevation layer to draw the terrain profile.');
  const c = col.capa, def = col.def;

  // ---- datos: cada corte dos veces (interpolado para la línea, celda publicada para las cifras) ----
  const series = SERIES.map((s) => {
    const suave = corte(c, sitio.lat, sitio.lon, s.az, R, N, Rkm, { suave: true }), celda = corte(c, sitio.lat, sitio.lon, s.az, R, N, Rkm, { suave: false });
    return { ...s, d: suave.d, suave: suave.v, celda: celda.v };
  });
  const d = series[0].d;                                         // distancias al emplazamiento (km): las mismas en los dos cortes
  const medio = (N - 1) / 2, paso = (2 * R) / (N - 1);
  const zSitio = c.en(sitio.lat, sitio.lon);                     // celda que contiene el emplazamiento
  // El punto del emplazamiento va en el cruce de las dos líneas (valor interpolado); su etiqueta, con la celda
  const zCruce = series[0].suave[medio] === series[0].suave[medio] ? series[0].suave[medio] : zSitio;

  let lo = Infinity, hi = -Infinity, cMin = Infinity, cMax = -Infinity;
  for (const s of series) for (let k = 0; k < N; k++) {
    const v = s.suave[k], z = s.celda[k];
    if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (z === z) { if (z < cMin) cMin = z; if (z > cMax) cMax = z; }
  }
  if (zCruce === zCruce) { if (zCruce < lo) lo = zCruce; if (zCruce > hi) hi = zCruce; }
  if (!(hi >= lo)) return vacio(el, 'The elevation layer has no data around this site.');
  if (hi === lo) { lo -= 1; hi += 1; }                           // terreno idéntico en todo el corte: el eje necesita algún recorrido

  // ---- escalas ----
  const x0 = M.l, x1 = W - M.r, y0 = H - M.b, yt = M.t, aire = 0.06 * (hi - lo);
  const x = lineal(-R, R, x0 + HOLGURA, x1 - HOLGURA), y = lineal(lo - aire, hi + aire, y0, yt);
  const my = marcas(y.d[0], y.d[1], 5), decY = decimalesDe(my);
  const mx = [-R, -R / 2, 0, R / 2, R], decX = Math.min(2, decimalesDe(mx));
  const zonaKm = RADIO_ZONA * (Math.PI / 180) * Rkm;
  // Exageración vertical real del dibujo: cuántas veces más píxeles ocupa un metro en vertical que en horizontal
  const pxmV = (y.r[0] - y.r[1]) / (y.d[1] - y.d[0]), pxmH = (x.r[1] - x.r[0]) / (2 * R * 1000), exag = pxmV / pxmH;
  const X = (v) => x(v).toFixed(1), Y = (v) => y(v).toFixed(1);

  // ---- piezas del SVG ----
  const rejilla = my.map((v) => `<line class="g-rej" x1="${x0}" x2="${x1}" y1="${Y(v)}" y2="${Y(v)}"/>
    <text x="${x0 - 5}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${esc(nf(v, decY))}</text>`).join('');
  const ejeX = `<line class="g-eje" x1="${x0}" x2="${x1}" y1="${y0}" y2="${y0}"/>${mx.map((v) => `<line class="g-eje" x1="${X(v)}" x2="${X(v)}" y1="${y0}" y2="${y0 + 4}"/>
    <text x="${X(v)}" y="${y0 + 15}" text-anchor="middle">${esc(nf(v, decX))}</text>`).join('')}
    <text x="${((x0 + x1) / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">Distance from the site (km)</text>`;
  const banda = `<rect class="g-banda" x="${X(-zonaKm)}" y="${yt}" width="${(x(zonaKm) - x(-zonaKm)).toFixed(1)}" height="${y0 - yt}"/>
    <text x="${X(0)}" y="${yt - 5}" text-anchor="middle">measured area</text>`;

  // Línea de cada corte; se interrumpe donde no hay dato en vez de unir por encima del hueco
  const trazo = (s) => {
    let p = '', pluma = false;
    for (let k = 0; k < N; k++) {
      const v = s.suave[k];
      if (v !== v) { pluma = false; continue; }
      p += `${pluma ? 'L' : 'M'}${X(d[k])} ${Y(v)}`; pluma = true;
    }
    return p;
  };
  const lineas = series.map((s, i) => `<path class="g-linea g-co-l${i + 1}" d="${trazo(s)}"/>`).join('');

  // Etiquetas directas en los extremos: O y E para un corte, S y N para el otro. Van pegadas al primer y al último
  // punto con dato; si las dos de un lado quedan a la misma altura, se separan lo justo para que no se pisen.
  const extremo = (s, desde, avance) => {
    for (let k = desde; k >= 0 && k < N; k += avance) if (s.suave[k] === s.suave[k]) return { px: x(d[k]), py: y(s.suave[k]) };
    return null;
  };
  const letras = (lado) => {
    const ps = series.map((s) => ({ p: lado < 0 ? extremo(s, 0, 1) : extremo(s, N - 1, -1), t: lado < 0 ? s.ini : s.fin })).filter((r) => r.p);
    if (ps.length === 2 && Math.abs(ps[0].p.py - ps[1].p.py) < 11) {
      const m = Math.max(yt + 9, Math.min(y0 - 9, (ps[0].p.py + ps[1].p.py) / 2)), alto = ps[0].p.py <= ps[1].p.py ? 0 : 1;
      ps[alto].p.py = m - 5.5; ps[1 - alto].p.py = m + 5.5;
    }
    return ps.map((r) => `<text class="g-txt" x="${(r.p.px + lado * 5).toFixed(1)}" y="${(r.p.py + 3.5).toFixed(1)}" text-anchor="${lado < 0 ? 'end' : 'start'}">${r.t}</text>`).join('');
  };

  // El emplazamiento: punto en el cruce y su elevación (celda). La etiqueta va encima o debajo del punto: donde quepa
  // y tape menos trazo (se cuentan las muestras de las dos líneas que caerían bajo el texto).
  const ys = zCruce === zCruce ? y(zCruce) : null, rotulo = zSitio === zSitio ? def.fmt(zSitio) : '';
  const tapa = (ya, yb) => {
    const medioAncho = rotulo.length * 3.1 + 2;                  // ≈ 6,2 px por carácter a 10 px
    let n = 0;
    for (const s of series) for (let k = 0; k < N; k++) {
      const v = s.suave[k];
      if (v === v && Math.abs(x(d[k]) - x(0)) <= medioAncho && y(v) >= ya && y(v) <= yb) n++;
    }
    return n;
  };
  const debajo = ys != null && rotulo && (ys < yt + 19 || (ys + 20 < y0 && tapa(ys + 8, ys + 20) < tapa(ys - 19, ys - 6)));
  const marcaSitio = ys == null ? '' : `<circle class="g-co-sitio" cx="${X(0)}" cy="${ys.toFixed(1)}" r="4.5"/>${rotulo
    ? `<text class="g-val g-co-halo" x="${X(0)}" y="${(debajo ? ys + 17 : ys - 9).toFixed(1)}" text-anchor="middle">${esc(rotulo)}</text>` : ''}`;

  // ---- textos de cada muestra (tooltip y lector de pantalla): siempre el valor de la celda publicada ----
  const valor = (v) => (v === v ? def.fmt(v) : 'no data');
  const donde = (k) => (k === medio ? 'At the site' : `${nf(Math.abs(d[k]), Number.isInteger(d[k]) ? 0 : 1)} km from the site`);
  const filasDe = (k) => series.map((s) => [k === medio ? s.nombre : `${s.nombre}, ${d[k] < 0 ? s.antes : s.despues}`, valor(s.celda[k])]);
  const html = (k) => tipHtml(donde(k), filasDe(k), 'Value of the published cell that contains each point.');
  const texto = (k) => `${donde(k)}. ${filasDe(k).map(([a, b]) => `${a}: ${b}`).join('. ')}.`;

  const resumen = `Terrain profile at ${sitio.name}: two ${nf(2 * R)} km cross-sections, west to east and south to north.${
    cMax >= cMin ? ` Cell elevation between ${def.fmt(cMin)} and ${def.fmt(cMax)}.` : ''}${zSitio === zSitio ? ` At the site: ${def.fmt(zSitio)}.` : ''}`;

  // La zona de acierto cubre todo el recuadro y es además el control de teclado: un deslizador cuya posición es la
  // distancia al emplazamiento (el lector de pantalla lee la distancia y las dos elevaciones en aria-valuetext).
  const svg = `<svg class="g-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(resumen)}">
    <g aria-hidden="true">
      ${banda}${rejilla}${ejeX}
      <text x="0" y="${yt - 15}">Elevation (${esc(def.unidad)})</text>
      ${lineas}${letras(-1)}${letras(1)}${marcaSitio}
      <g class="g-co-cursor" display="none"><line class="g-co-cur" x1="0" x2="0" y1="${yt}" y2="${y0}"/>${series.map((_, i) => `<circle class="g-co-p g-co-p${i + 1}" r="3.5"/>`).join('')}</g>
    </g>
    <rect class="g-hit g-co-hit" x="${x0}" y="${yt}" width="${x1 - x0}" height="${y0 - yt}" tabindex="0" role="slider" aria-orientation="horizontal"
      aria-label="Move along the profile with the left and right arrows: distance from the site in kilometers"
      aria-valuemin="${-R}" aria-valuemax="${R}" aria-valuenow="0" aria-valuetext="${esc(texto(medio))}"/>
  </svg>`;

  // ---- tabla: una fila cada R/8 km, con el valor de la celda ----
  const saltoT = Math.max(1, Math.round((N - 1) / 16)), ks = [];
  for (let k = 0; k < N; k += saltoT) ks.push(k);
  const decT = Math.min(2, decimalesDe(ks.map((k) => d[k])));
  const tablaHtml = tabla({
    titulo: `Terrain profile at ${sitio.name}: elevation of the published cell every ${nf(saltoT * paso, decT)} km. Negative distance: toward the west (west → east section) or toward the south (south → north section).`,
    cabeceras: ['Distance (km)', ...series.map((s) => `${s.nombre} (${def.unidad})`)],
    filas: ks.map((k) => [nf(d[k], decT), ...series.map((s) => (s.celda[k] === s.celda[k] ? def.tick(s.celda[k]) : 'no data'))]),
  });

  // Media de la zona medida (la «Elevation» de las mediciones de la ficha, Capa.zona): distinta de la celda del punto
  const zona = ctx.fila?.v?.[def.id];
  const pie = `<b>Source:</b> ${esc(fuenteDe(c))} · ${esc(c.meta.nombre)}. Two ${esc(nf(2 * R))} km cross-sections through the site; each follows a great circle
    and has ${N} samples (one every ≈ ${esc(nf(paso, 1))} km). The line interpolates between cells only for drawing; the cursor, the label and the table give the value of the
    published cell. Band: measured area, ±${esc(nf(zonaKm, 1))} km (${esc(nf(RADIO_ZONA, 1))}° of arc). <b>Vertical exaggeration ×${esc(nf(exag, exag < 10 ? 1 : 0))}</b>: the vertical
    scale is stretched that many times relative to the horizontal.${zSitio === zSitio ? '' : ' The site’s cell has no data.'}${
    zona && zSitio === zSitio ? ` The mean of the measured area (the “Elevation” among the site’s measurements) is ${esc(def.fmt(zona.media))}; the point’s label is its cell.` : ''}${
    Math.abs(sitio.lat) > 85 ? ' Near the pole, east and north refer to the site’s meridian.' : ''}`;

  // Los colores de las dos series salen de COLOR (base.js) y llegan al CSS como variables
  el.innerHTML = figura({
    titulo: 'Ups and downs around the site', sub: 'Height of the ground along two straight lines through the site (heights stretched to be visible).', clase: 'g-co', pie, tablaHtml,
    cuerpo: `<div class="g-co-caja" style="--g-co-s1:${COLOR.serie1};--g-co-s2:${COLOR.serie2}">
      ${leyenda([{ clase: 'g-co-k1', texto: SERIES[0].nombre }, { clase: 'g-co-k2', texto: SERIES[1].nombre }, { clase: 'g-m-sel', texto: nombreCorto(sitio.name) }])}
      ${svg}</div>`,
  });

  // ---- cursor: una línea vertical que se ajusta a la muestra más cercana, igual con el puntero que con el teclado ----
  const hit = el.querySelector('.g-co-hit'), cursor = el.querySelector('.g-co-cursor');
  const raya = cursor.querySelector('.g-co-cur'), puntos = [...cursor.querySelectorAll('.g-co-p')];
  let actual = medio, visible = false;
  const mover = (k) => {
    actual = k; visible = true;
    raya.setAttribute('x1', X(d[k])); raya.setAttribute('x2', X(d[k]));
    series.forEach((s, i) => {
      const v = s.suave[k];
      if (v === v) { puntos[i].setAttribute('cx', X(d[k])); puntos[i].setAttribute('cy', Y(v)); puntos[i].removeAttribute('display'); }
      else puntos[i].setAttribute('display', 'none');
    });
    cursor.removeAttribute('display');
    hit.setAttribute('aria-valuenow', String(Number(d[k].toFixed(2)))); hit.setAttribute('aria-valuetext', texto(k));
  };
  const ocultar = () => { visible = false; cursor.setAttribute('display', 'none'); };
  // Muestra más cercana a una posición horizontal de la ventana
  const muestraEn = (clientX) => {
    const r = hit.getBoundingClientRect(), vx = x0 + ((clientX - r.left) / (r.width || 1)) * (x1 - x0);
    return Math.max(0, Math.min(N - 1, Math.round(((x.inv(vx) + R) / (2 * R)) * (N - 1))));
  };
  // Con el teclado no hay puntero: el tooltip se coloca bajo el recuadro, a la altura de la línea del cursor
  const tipTeclado = (k) => {
    const r = hit.getBoundingClientRect();
    tip(html(k), r.left + ((x(d[k]) - x0) / (x1 - x0)) * r.width, r.bottom);
  };
  const focoTeclado = () => { try { return hit.matches(':focus-visible'); } catch { return true; } };

  // Puntero y dedo: conTip pone y quita el tooltip; aquí solo se mueve la línea. El foco lo atiende el escucha de abajo
  // (conTip lo centraría bajo el gráfico, no bajo la muestra).
  conTip(el, '.g-co-hit', (_, e) => {
    if (e.type === 'focusin') return null;
    const k = muestraEn(e.clientX);
    mover(k);
    return html(k);
  });
  // Con el dedo, la lectura se queda al levantarlo (como en el mapa del entorno); se va al tocar fuera (blur / focusout).
  // El tercer escucha va sobre `el` y después de conTip: se ejecuta tras su tip(null) y repone el tooltip bajo el recuadro.
  hit.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') ocultar(); });
  hit.addEventListener('pointercancel', ocultar);              // el gesto pasó a ser desplazamiento vertical
  el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'touch' && visible) tipTeclado(actual); });
  hit.addEventListener('focus', () => { if (focoTeclado()) { mover(actual); tipTeclado(actual); } });
  hit.addEventListener('blur', ocultar);
  hit.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {                                    // el primer Escape solo quita el cursor; el siguiente ya cierra la ficha
      if (visible) { ocultar(); tip(null); e.stopPropagation(); }
      return;
    }
    const salto = e.shiftKey ? 10 : 1;
    const k = e.key === 'ArrowLeft' ? actual - salto : e.key === 'ArrowRight' ? actual + salto : e.key === 'Home' ? 0 : e.key === 'End' ? N - 1 : null;
    if (k == null) return;
    e.preventDefault();
    const kk = Math.max(0, Math.min(N - 1, k));
    mover(kk); tipTeclado(kk);
  });
}
