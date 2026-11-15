// ============================================================================
//  «DOS MEDICIONES A LA VEZ»: DISPERSIÓN DE LOS EMPLAZAMIENTOS  (panel «Comparar con datos medidos»)
//
//  Qué muestra: cada emplazamiento como un círculo con su número de puesto. Eje X = la capa en detalle (ctx.capa);
//  eje Y = otra capa medida que se elige en el desplegable «Comparar con» (se guarda en ctx.estado.y).
//
//  De dónde sale cada número (nada escrito a mano; no intervienen la puntuación ni las capas *_aprox):
//    · posición de un círculo   v.media de ctx.filas (js/analitica.js → medirTodo): media de las celdas publicadas con
//                               centro a menos de RADIO_ZONA grados de arco del emplazamiento (o la celda que lo contiene)
//    · barras de error          ± v.sigma: incertidumbre publicada con el dato (solo Odyssey GRS), en esas mismas celdas
//    · líneas de referencia     cuantil(capa, 0.5) de js/analitica.js: mediana de la superficie del cuerpo, ponderada por área
//    · percentil del tooltip    v.pct (fracción de la superficie con valor de celda ≤ media)
//    · ejes                     extensión de esos mismos valores (emplazamientos ± sigma y mediana) con un 8 % de aire
//  El número de puesto (sitio.rank) solo es una etiqueta. Un valor alto no es «mejor»: aquí no hay zonas buenas ni malas.
//
//  El dibujo se ajusta al ancho del contenedor en el momento de pintar (viewBox ≈ píxeles reales), para que los
//  círculos y los textos conserven su tamaño tanto a 300 px como a 1000 px.
// ============================================================================
import { RADIO_ZONA } from '../capas.js';
import { cuantil } from '../analitica.js';
import { esc, nf, pct, lineal, marcas, decimalesDe, tip, conTip, tipHtml, tabla, figura, leyenda, nombreCorto, fuenteDe, masAltoQue, nombreDe, unaParada } from './base.js';

const MARGEN = 0.08;                                   // aire alrededor de los datos, como fracción de su extensión
const R = 9, R_HIT = 14;                               // radio del círculo y de su zona de acierto (≥ 24 px de diámetro)
const ANCHO = { min: 340, max: 900, defecto: 520 };    // límites del viewBox (unidades ≈ píxeles)
const ALTO = { min: 270, max: 420 };
const CH = 5.6, CH_VAL = 6;                            // ancho medio estimado de un carácter a 10 px (normal y seminegrita)

// nombreDe (base.js): «Maximum», «Minimum» y «Mean» se escriben completas fuera del selector de capas
const conUnidad = (def) => `${nombreDe(def)} (${def.unidad})`;
const haySigma = (m) => m.sigma != null && m.sigma === m.sigma && m.sigma > 0;
// La incertidumbre se escribe con los decimales de la capa; si así se quedara en cero, con los que hagan falta
const decDe = (def) => (def.tick(0).split('.')[1] ?? '').length;
function sigmaTxt(def, s) { let d = decDe(def); while (d < 6 && s < 0.5 * 10 ** -d) d++; return nf(s, d); }
const valorTxt = (def, m) => (haySigma(m) ? `${def.tick(m.media)} ± ${sigmaTxt(def, m.sigma)} ${def.unidad}` : def.fmt(m.media));
const celdaTxt = (def, m) => (!m ? 'no data' : haySigma(m) ? `${def.tick(m.media)} ± ${sigmaTxt(def, m.sigma)}` : def.tick(m.media));
const px = (v) => v.toFixed(1);

// Ancho del dibujo: el del contenedor, dentro de unos límites. Si aún no se puede medir, un ancho intermedio.
const anchoDe = (el) => { const w = el.clientWidth; return w > 0 ? Math.round(Math.min(ANCHO.max, Math.max(ANCHO.min, w))) : ANCHO.defecto; };

// Dominio de un eje: de lo menor a lo mayor que hay que dibujar (emplazamientos, sus barras de error y la mediana)
function dominio(pts, eje, med) {
  let lo = Infinity, hi = -Infinity;
  const ve = (v) => { if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; } };
  for (const p of pts) { const m = p[eje], s = haySigma(m) ? m.sigma : 0; ve(m.media - s); ve(m.media + s); }
  ve(med);
  const aire = hi > lo ? (hi - lo) * MARGEN : Math.abs(lo) * MARGEN || 1;   // todos iguales: un margen cualquiera, no nulo
  return [lo - aire, hi + aire];
}

// pts: [{ s, x, y, aria }] con dato en las dos capas (hay al menos uno).
// → { svg, juntos }: el dibujo y los pares de emplazamientos cuyos círculos quedan casi uno encima del otro.
function dibujo({ W, X, Y, pts, medX, medY, sel, cuerpo }) {
  const H = Math.round(Math.min(ALTO.max, Math.max(ALTO.min, W * 0.6)));
  const [x0, x1] = dominio(pts, 'x', medX), [y0, y1] = dominio(pts, 'y', medY);
  // marcas() devuelve entre la mitad y el total de las que se le piden: se piden más cuanto más ancho es el dibujo
  const mx = marcas(x0, x1, W < 430 ? 4 : W < 700 ? 6 : 8), my = marcas(y0, y1, 5), dx = decimalesDe(mx), dy = decimalesDe(my);
  const ty = my.map((v) => nf(v, dy));
  // el margen izquierdo depende de lo largas que sean las marcas del eje Y (−8000 no ocupa lo mismo que 0,5)
  const m = { l: Math.round(30 + CH * Math.max(1, ...ty.map((t) => t.length))), r: 16, t: 24, b: 44 };
  const base = H - m.b, der = W - m.r, medio = (m.t + base) / 2;
  const sx = lineal(x0, x1, m.l, der), sy = lineal(y0, y1, base, m.t);
  const P = pts.map((p) => ({ ...p, cx: sx(p.x.media), cy: sy(p.y.media), sel: p.s.id === sel }));

  const rej = mx.map((v) => `<line class="g-rej" x1="${px(sx(v))}" x2="${px(sx(v))}" y1="${m.t}" y2="${base}"/>
      <text x="${px(sx(v))}" y="${base + 14}" text-anchor="middle">${esc(nf(v, dx))}</text>`).join('')
    + my.map((v, i) => `<line class="g-rej" x1="${m.l}" x2="${der}" y1="${px(sy(v))}" y2="${px(sy(v))}"/>
      <text x="${m.l - 6}" y="${px(sy(v) + 3.5)}" text-anchor="end">${esc(ty[i])}</text>`).join('');
  const ejes = `<line class="g-eje" x1="${m.l}" x2="${der}" y1="${base}" y2="${base}"/><line class="g-eje" x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${base}"/>
    <text class="g-txt" x="${px((m.l + der) / 2)}" y="${H - 8}" text-anchor="middle">${esc(conUnidad(X.def))}</text>
    <text class="g-txt" x="11" y="${px(medio)}" text-anchor="middle" transform="rotate(-90 11 ${px(medio)})">${esc(conUnidad(Y.def))}</text>`;

  // Medianas de la superficie: una línea por eje. El rótulo de la vertical va encima del gráfico; el de la horizontal,
  // dentro, en el extremo (y el lado de la línea) donde tape menos círculos.
  const rot = 'middle value', wRot = rot.length * CH;
  const zona = (eje, k, med, geo) => `<rect class="g-hit g-ds-med" data-med="${eje}" tabindex="0" role="img"
      aria-label="${esc(`Median of the surface ${cuerpo.de}: ${nombreDe(k.def)} ${k.def.fmt(med)}`)}" ${geo}/>`;
  let refs = '';
  if (medX === medX) {
    const x = sx(medX), tx = Math.min(der - wRot / 2, Math.max(m.l + wRot / 2, x));
    refs += `<line class="g-ref" x1="${px(x)}" x2="${px(x)}" y1="${m.t}" y2="${base}"/>
      <text class="g-txt" x="${px(tx)}" y="${m.t - 7}" text-anchor="middle">${esc(rot)}</text>
      ${zona('x', X, medX, `x="${px(x - 6)}" y="${m.t}" width="12" height="${base - m.t}"`)}`;
  }
  if (medY === medY) {
    const y = sy(medY), cand = [];
    for (const arriba of [true, false]) for (const aLaDer of [true, false]) {
      const by = arriba ? y - 5 : y + 12, bx = aLaDer ? der - 4 - wRot : m.l + 4;   // línea base y borde izquierdo del rótulo
      if (by - 9 < m.t || by + 2 > base) continue;
      const tapados = P.filter((p) => p.cx > bx - R && p.cx < bx + wRot + R && p.cy > by - 9 - R && p.cy < by + 2 + R).length;
      cand.push({ by, aLaDer, tapados });
    }
    const c = cand.sort((a, b) => a.tapados - b.tapados)[0];   // a igualdad, gana el primero: arriba a la derecha
    refs += `<line class="g-ref" x1="${m.l}" x2="${der}" y1="${px(y)}" y2="${px(y)}"/>
      ${c ? `<text class="g-txt g-ds-halo" x="${c.aLaDer ? der - 4 : m.l + 4}" y="${px(c.by)}" text-anchor="${c.aLaDer ? 'end' : 'start'}">${esc(rot)}</text>` : ''}
      ${zona('y', Y, medY, `x="${m.l}" y="${px(y - 6)}" width="${der - m.l}" height="12"`)}`;
  }

  // Barras de error: ± la incertidumbre publicada, en el eje de la capa que la trae (con remates de 6 px)
  const barras = (p) => {
    const cl = `g-ds-err${p.sel ? ' sel' : ''}`;
    let h = '';
    if (haySigma(p.x)) {
      const a = px(sx(p.x.media - p.x.sigma)), b = px(sx(p.x.media + p.x.sigma));
      h += `<path class="${cl}" d="M${a},${px(p.cy)}H${b}M${a},${px(p.cy - 3)}v6M${b},${px(p.cy - 3)}v6"/>`;
    }
    if (haySigma(p.y)) {
      const a = px(sy(p.y.media - p.y.sigma)), b = px(sy(p.y.media + p.y.sigma));
      h += `<path class="${cl}" d="M${px(p.cx)},${a}V${b}M${px(p.cx - 3)},${a}h6M${px(p.cx - 3)},${b}h6"/>`;
    }
    return h;
  };
  // El grupo entero es la marca: zona de acierto amplia, círculo y número de puesto (que no intercepta el puntero)
  const punto = (p) => `<g class="g-ds-p" data-sitio="${esc(p.s.id)}" tabindex="0" role="button" aria-label="${esc(p.aria)}">
      <circle class="g-hit" cx="${px(p.cx)}" cy="${px(p.cy)}" r="${R_HIT}"/>
      <circle class="g-m${p.sel ? ' sel' : ''}" cx="${px(p.cx)}" cy="${px(p.cy)}" r="${R}"/>
      <text class="g-ds-n" x="${px(p.cx)}" y="${px(p.cy + 3.2)}" text-anchor="middle">${esc(p.s.rank ?? '')}</text></g>`;
  // Etiqueta directa del destacado. Se prueban cuatro sitios (derecha, izquierda, encima, debajo), se meten dentro del
  // dibujo y se elige el que pisa menos círculos; a igualdad, en ese orden. Si lleva barra horizontal, la etiqueta
  // lateral sube justo encima de la barra. El ancho del texto es una estimación (no se puede medir antes de pintar).
  const etiqueta = (p) => {
    const t = nombreCorto(p.s.name), w = t.length * CH_VAL, sep = R + 5, lado = haySigma(p.x) ? p.cy - 5 : p.cy + 3.5;
    const cand = [
      { x: p.cx + sep, y: lado, ancla: 'start' }, { x: p.cx - sep - w, y: lado, ancla: 'end' },
      { x: p.cx - w / 2, y: p.cy - sep - 1, ancla: 'middle', cruza: haySigma(p.y) }, { x: p.cx - w / 2, y: p.cy + sep + 8, ancla: 'middle', cruza: haySigma(p.y) },
    ].map((c, i) => {
      const x = Math.max(4, Math.min(c.x, W - 4 - w)), y = Math.min(base - 3, Math.max(m.t + 9, c.y));   // borde izquierdo y línea base
      const pisados = P.filter((q) => q.cx > x - R && q.cx < x + w + R && q.cy > y - 9 - R && q.cy < y + 2 + R).length;   // cuenta también el propio círculo
      return { ...c, x, y, coste: 10 * pisados + (c.cruza ? 3 : 0) + i / 10 };
    });
    const c = cand.sort((a, b) => a.coste - b.coste)[0], x = c.ancla === 'start' ? c.x : c.ancla === 'end' ? c.x + w : c.x + w / 2;
    return `<text class="g-val g-ds-halo" x="${px(x)}" y="${px(c.y)}" text-anchor="${c.ancla}">${esc(t)}</text>`;
  };

  // Dos emplazamientos con valores casi iguales caen en el mismo sitio y uno tapa al otro: se avisa bajo el gráfico
  const juntos = [];
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    if (Math.hypot(P[i].cx - P[j].cx, P[i].cy - P[j].cy) < R) juntos.push([P[i].s, P[j].s]);
  }

  const resto = P.filter((p) => !p.sel), elegido = P.find((p) => p.sel);
  const svg = `<svg class="g-svg g-ds-svg" viewBox="0 0 ${W} ${H}" role="group"
      aria-label="${esc(`Scatter plot of the sites ${cuerpo.en}: ${nombreDe(X.def)} on the horizontal axis and ${nombreDe(Y.def)} on the vertical axis. The arrow keys move through the sites`)}">
    ${rej}${ejes}${refs}
    ${resto.map(barras).join('')}${resto.map(punto).join('')}
    ${elegido ? barras(elegido) + punto(elegido) + etiqueta(elegido) : ''}
  </svg>`;
  return { svg, juntos };
}

export function pintar(el, ctx) {
  const { cols, filas, cuerpo } = ctx;
  const X = cols.find((k) => k.def.id === ctx.capa) ?? cols[0];
  const otras = cols.filter((k) => k !== X);
  if (!X || !otras.length) { el.innerHTML = '<p class="g-vacio">At least two measured layers are needed to compare them.</p>'; return; }
  // La elección se conserva en ctx.estado.y; si ahora coincide con la capa en detalle (o ya no existe), se toma la primera distinta
  const Y = otras.find((k) => k.def.id === ctx.estado.y) ?? otras[0];
  const nx = nombreDe(X.def), ny = nombreDe(Y.def);

  // Emplazamientos con dato en las dos capas (los que se dibujan) y los que se quedan fuera, por capa
  const pts = [], sinX = [], sinY = [];
  for (const f of filas) {
    const x = f.v[X.def.id], y = f.v[Y.def.id], s = f.sitio;
    if (!x) sinX.push(s);
    if (!y) sinY.push(s);
    if (x && y) pts.push({ s, x, y, aria: `${s.rank}. ${s.name}: ${nx} ${valorTxt(X.def, x)}; ${ny} ${valorTxt(Y.def, y)}` });
  }
  const medX = cuantil(X.capa, 0.5), medY = cuantil(Y.capa, 0.5);
  const conErr = [[X, 'x'], [Y, 'y']].filter(([, eje]) => pts.some((p) => haySigma(p[eje]))).map(([k]) => k);
  const elegido = pts.find((p) => p.s.id === ctx.sel);

  const control = `<div class="g-ctl"><label>Compare with <select data-clave="ds-y">${otras.map((k) =>
    `<option value="${esc(k.def.id)}"${k === Y ? ' selected' : ''}>${esc(conUnidad(k.def))}</option>`).join('')}</select></label></div>`;
  const W = anchoDe(el);
  const ley = leyenda([
    elegido && { clase: 'g-m-sel', texto: nombreCorto(elegido.s.name) },
    pts.some((p) => p !== elegido) && { clase: 'g-m-ctx', texto: elegido ? 'The other sites' : 'Sites' },
    (medX === medX || medY === medY) && { clase: 'g-m-ref', texto: `Middle value ${cuerpo.de}` },
    conErr.length && { clase: 'g-ds-ley-err', texto: `margin of error (${conErr.map((k) => nombreDe(k.def)).join(' and ')})` },
  ].filter(Boolean));
  const nombres = (ss) => ss.map((s) => nombreCorto(s.name)).join(', ');
  const { svg, juntos } = pts.length ? dibujo({ W, X, Y, pts, medX, medY, sel: ctx.sel, cuerpo }) : { svg: '', juntos: [] };
  // Bajo el gráfico: lo que no se ha podido dibujar y lo que no se ve bien
  const notas = [];
  if (sinX.length) notas.push(`No data for ${nx}: ${nombres(sinX)}.`);
  if (sinY.length) notas.push(`No data for ${ny}: ${nombres(sinY)}.`);
  if (notas.length && pts.length) notas.push('They are not drawn.');
  if (juntos.length) notas.push(`Almost at the same point (one circle hides the other): ${juntos.map(([a, b]) => `${a.rank} ${nombreCorto(a.name)} and ${b.rank} ${nombreCorto(b.name)}`).join('; ')}.`);
  const cuerpoHtml = control
    + (pts.length ? ley + svg : '<p class="g-vacio">No site has data in both layers at once.</p>')
    ;
  const notasHtml = notas.length ? `<p class="g-ds-nota">${esc(notas.join(' '))}</p>` : '';

  const fuente = (k) => `<b>${esc(nombreDe(k.def))}</b>: ${esc(fuenteDe(k.capa))}${k.derivada ? ' (derived from elevation)' : ''}`;
  const pie = `Horizontal axis · ${fuente(X)}. Vertical axis · ${fuente(Y)}.
    Each site: mean of the cells whose center lies within ${esc(nf(RADIO_ZONA, 1))}° of arc (if there are none, the cell that contains it).
    Median: the value below which lies half of the surface ${esc(cuerpo.de)} with data, with each cell weighted by its area.
    Percentile (on hover): % of that surface with an equal or lower cell value.
    ${conErr.length ? `Bars: ± the uncertainty published with the data (${esc([...new Set(conErr.map((k) => fuenteDe(k.sigma ?? k.capa)))].join('; '))}), over those same cells; if a bar does not show, it is smaller than the circle.` : ''}
    These are the ${filas.length} candidate sites, chosen by hand; they are not a sample of ${esc(cuerpo.nombre)}: the chart is for comparing them with each other, not for inferring relationships between quantities.`;

  const tablaHtml = tabla({
    titulo: `${nx} and ${ny} for the ${filas.length} sites ${cuerpo.en}`,
    cabeceras: ['Site', conUnidad(X.def), conUnidad(Y.def)],
    filas: [
      ...filas.map((f) => [`${f.sitio.rank}. ${f.sitio.name}`, celdaTxt(X.def, f.v[X.def.id]), celdaTxt(Y.def, f.v[Y.def.id])]),
      [`Median of the surface ${cuerpo.de}`, medX === medX ? X.def.tick(medX) : 'no data', medY === medY ? Y.def.tick(medY) : 'no data'],
    ],
  });

  el.innerHTML = figura({
    titulo: `${nx} against ${ny}`,
    sub: `Each circle is a site. The thin lines mark the middle value ${cuerpo.de}.`,
    cuerpo: cuerpoHtml, mas: notasHtml, pie, tablaHtml, clase: 'g-ds',
  });

  // Cambiar la capa del eje Y: se guarda la elección y el panel vuelve a pintar este gráfico
  el.addEventListener('change', (e) => {
    const s = e.target.closest?.('select[data-clave="ds-y"]');
    if (!s) return;
    ctx.estado.y = s.value; tip(null); ctx.repintar();
  });

  unaParada(el, 'g.g-ds-p');                                    // los emplazamientos: una sola parada del tabulador

  // Tooltip (cursor y foco): emplazamientos y líneas de mediana
  const porId = new Map(pts.map((p) => [p.s.id, p]));
  const filaTip = (k, m) => { const p = pct(m.pct); return [`${nombreDe(k.def)}${p != null ? ` (${masAltoQue(m.pct)} of the surface)` : ''}`, valorTxt(k.def, m)]; };
  conTip(el, '[data-sitio], [data-med]', (t) => {
    if (t.dataset.med) {
      const k = t.dataset.med === 'x' ? X : Y, med = t.dataset.med === 'x' ? medX : medY;
      return tipHtml(`Median of the surface ${cuerpo.de}`, [[nombreDe(k.def), k.def.fmt(med)]], 'Half of the surface with data has an equal or lower cell value.');
    }
    const p = porId.get(t.dataset.sitio);
    if (!p) return null;
    return tipHtml(`${p.s.rank}. ${p.s.name}`, [filaTip(X, p.x), filaTip(Y, p.y)],
      `“Higher than N %”: share of the surface ${cuerpo.de} with an equal or lower value.${haySigma(p.x) || haySigma(p.y) ? ' ± = published uncertainty.' : ''}`);
  });

  // Si el contenedor cambia mucho de ancho (ventana o panel redimensionados), se pide al panel otro pintado para que el
  // dibujo vuelva a medirse. El contenedor es nuevo en cada pintado: el observador se suelta en cuanto deja de estar en la página.
  if (pts.length && typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => {
      if (!el.isConnected) { ro.disconnect(); return; }
      if (el.clientWidth > 0 && Math.abs(anchoDe(el) - W) > 40) { ro.disconnect(); tip(null); ctx.repintar(); }
    });
    ro.observe(el);
  }
}
