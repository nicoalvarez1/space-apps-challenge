// ============================================================================
//  MATRIZ DE MEDICIONES  (panel «Comparar con datos medidos»: js/graficos/panel.js)
//
//  Una tabla HTML que es a la vez mapa de calor: filas = emplazamientos (ctx.filas, en el orden del ranking o según la
//  capa en detalle) y columnas = capas medidas del cuerpo (ctx.cols). Como ya es una tabla, no lleva «Ver en tabla».
//
//  De dónde sale cada número (nada se escribe a mano; todo viene de ctx, que rellena js/analitica.js → medirTodo):
//    · texto de la celda   v.media = media de las celdas con centro a menos de RADIO_ZONA grados de arco (Capa.zona);
//                          si ninguna queda tan cerca, la celda que contiene el emplazamiento (v.unica)
//    · color de la celda   v.pct = parte de la superficie del cuerpo con un valor de celda ≤ v.media, ponderada por área
//                          (analitica.percentil). Dice «bajo» o «alto» para ese cuerpo; nunca «bueno» o «malo»
//    · tooltip             v.min y v.max (rango de esas mismas celdas), v.n (cuántas son) y v.sigma (incertidumbre
//                          publicada: solo en las capas que la traen)
//    · pie                 radio de la zona en km = RADIO_ZONA · π/180 · ctx.Rkm; fuentes = meta de cada capa (fuenteDe)
//  No intervienen la puntuación, los factores ni las capas *_aprox. sitio.rank solo se usa como etiqueta y como orden.
//
//  Estado propio (ctx.estado): orden = 'puesto' | 'asc' | 'desc' y foco = celda que recibe el tabulador.
// ============================================================================
import { RADIO_ZONA } from '../capas.js';
import { muestra } from '../analitica.js';
import { esc, nf, pct, SEQ, colorSeq, tintaSobreSeq, decimalesDe, conTip, tipHtml, figura, nombreCorto, fuenteDe } from './base.js';

const DEG = Math.PI / 180;
const ORDENES = [['puesto', 'By rank'], ['asc', 'Low to high'], ['desc', 'High to low']];
// «a, b y c» («e» ante i- o hi-: «Inercia térmica e Hidrógeno»; no ante diptongo: «y Hierro»)
const lista = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] ?? '');

export function pintar(el, ctx) {
  const { cols, filas, sel, capa, cuerpo, Rkm, estado } = ctx;
  if (!cols?.length || !filas?.length) { el.innerHTML = '<p class="g-vacio">There are no measurements to show.</p>'; return; }

  // ---- orden de las filas: por puesto (el de ctx.filas) o por el valor de la capa en detalle; los sin dato, al final
  const kOrden = cols.find((k) => k.def.id === capa);
  const orden = kOrden && ORDENES.some(([clave]) => clave === estado.orden) ? estado.orden : 'puesto';
  const vista = filas.map((f, i) => ({ f, i }));               // i = índice en ctx.filas: identifica la celda (data-k)
  if (orden !== 'puesto') {
    const signo = orden === 'asc' ? 1 : -1, valor = (x) => x.f.v[capa]?.media;
    // la ordenación es estable: los empates y los sin dato conservan el orden del ranking
    vista.sort((a, b) => { const va = valor(a), vb = valor(b); return va == null ? (vb == null ? 0 : 1) : vb == null ? -1 : signo * (va - vb); });
  }
  const sinDatoEnOrden = !!kOrden && filas.some((f) => !f.v[capa]);
  const hayHuecos = filas.some((f) => cols.some((k) => !f.v[k.def.id]));
  const radio = nf(RADIO_ZONA, decimalesDe([RADIO_ZONA]));     // «0,5»

  // ---- cabecera: grupos (columnas contiguas del mismo grupo) y una cabecera-botón por capa
  const grupos = [];
  for (const k of cols) {
    const g = grupos[grupos.length - 1];
    if (g && g.nombre === k.def.grupo) g.n++; else grupos.push({ nombre: k.def.grupo, n: 1 });
  }
  const cabGrupos = grupos.map((g) => `<th scope="colgroup" colspan="${g.n}" class="g-mz-grupo">${esc(g.nombre)}</th>`).join('');
  const cabCapas = cols.map((k) => {
    const d = k.def, es = d.id === capa, ordena = es && orden !== 'puesto';
    return `<th scope="col"${ordena ? ` aria-sort="${orden === 'asc' ? 'ascending' : 'descending'}"` : ''}><button type="button" class="g-mz-capa${es ? ' sel' : ''}" data-capa="${esc(d.id)}" aria-pressed="${es}">
      <span>${esc(d.corto)}${ordena ? `<i aria-hidden="true"> ${orden === 'asc' ? '↑' : '↓'}</i>` : ''}</span><small>${esc(d.unidad)}</small></button></th>`;
  }).join('');

  // ---- celdas: el número es la medición; el color, su percentil en la superficie del cuerpo
  const celda = (f, i, k, j) => {
    const v = f.v[k.def.id];
    if (!v) return `<td class="g-mz-nd" data-k="${i},${j}" tabindex="-1"><span aria-hidden="true">—</span><span class="sr-only">no data</span></td>`;
    const N = pct(v.pct);
    const estilo = N == null ? '' : ` style="background:${colorSeq(v.pct)};color:${tintaSobreSeq(v.pct)}"`;
    return `<td data-k="${i},${j}" tabindex="-1"${estilo}>${esc(k.def.tick(v.media))}<span class="sr-only">, ${N == null ? 'no percentile' : `percentile ${N}`}</span></td>`;
  };
  const cuerpoTabla = vista.map(({ f, i }) => {
    const s = f.sitio, es = s.id === sel;
    return `<tr${es ? ' class="sel"' : ''}><th scope="row"><button type="button" class="g-mz-sitio" data-sitio="${esc(s.id)}" aria-pressed="${es}" title="${esc(s.name)}" aria-label="${esc(`${s.name}, rank ${s.rank}`)}">
      <b class="g-mz-n">${esc(s.rank)}</b><span>${esc(nombreCorto(s.name))}</span></button></th>${cols.map((k, j) => celda(f, i, k, j)).join('')}</tr>`;
  }).join('');

  // ---- control de orden (el rótulo dice qué capa ordena) y leyenda de la escala
  const rotOrden = !kOrden ? ''
    : orden === 'puesto' ? `Sorting by value uses the layer in detail: <b>${esc(kOrden.def.corto)}</b>. Click another column header to change it.`
    : `Sorted by <b>${esc(kOrden.def.corto)}</b> (${esc(kOrden.def.unidad)}), the layer in detail, ${orden === 'asc' ? 'from low to high' : 'from high to low'}${sinDatoEnOrden ? '; sites without data go last' : ''}.`;
  const control = `<div class="g-ctl" role="group" aria-label="Order of the matrix rows">
      <span class="g-mz-rot">Row order</span>
      <div class="g-seg">${ORDENES.map(([clave, texto]) => `<button type="button" data-clave="${clave}" aria-pressed="${clave === orden}"${clave !== 'puesto' && !kOrden ? ' disabled' : ''}>${texto}</button>`).join('')}</div>
      <span class="g-mz-por">${rotOrden}</span>
    </div>`;
  const escala = `<div class="g-mz-ley">
      <div class="g-mz-esc" role="img" aria-label="Color scale: from percentile 0 (dark) to percentile 100 (light)">
        <i style="background:linear-gradient(to right, ${SEQ.join(', ')})"></i>
        <span><b>percentile 0</b><b>50</b><b>100</b></span>
      </div>
      ${hayHuecos ? '<span class="g-mz-ley-nd"><i aria-hidden="true"></i>no data</span>' : ''}
      <p>The color tells whether the value is low or high for ${esc(cuerpo.nombre)}; it does not say whether it is good or bad.</p>
      <p class="g-mz-tec">With focus on a cell, the arrow keys move through the matrix.</p>
    </div>`;

  // ---- pie: de dónde sale cada número (todo se deduce de los datos recibidos)
  const km = Math.round(RADIO_ZONA * DEG * Rkm);
  const corto = (k) => k.def.corto;
  const unicas = cols.filter((k) => filas.some((f) => f.v[k.def.id]?.unica));      // capas en las que ninguna celda queda en la zona
  const pasos = [...new Set(unicas.map((k) => Math.abs(k.capa.meta.dlat)))].sort((a, b) => a - b).map((p) => `${nf(p, decimalesDe([p]))}°`);
  const muestreadas = cols.some((k) => muestra(k.capa).paso > 1);                   // ya calculada por medirTodo: no cuesta nada
  const conSigma = cols.filter((k) => k.sigma), derivadas = cols.filter((k) => k.derivada), invertidas = cols.filter((k) => k.def.invertir);
  const fuentes = new Map();                                                         // fuente → capas que la comparten
  for (const k of cols) { const f = fuenteDe(k.capa); fuentes.set(f, [...(fuentes.get(f) ?? []), corto(k)]); }
  const pie = [
    `<b>Value</b>: mean of the cells whose center lies within ${radio}° of arc of the site (≈ ${nf(km)} km).`,
    unicas.length ? `Where no cell is that close (${esc(lista(pasos))} grids: ${esc(lista(unicas.map(corto)))}), it is the value of the cell that contains the site.` : '',
    `<b>Percentile</b>: share of the surface ${esc(cuerpo.de)} with an equal or lower cell value, weighted by area; only cells with data count${muestreadas ? ' and, in the finest grids, a regular sample of them' : ''}.`,
    ...derivadas.map((k) => `“${esc(corto(k))}” is not a published grid: it is derived in the browser from the ${esc(k.capa.meta.fuente?.mision ?? k.def.grupo)} elevation (slope between neighboring cells).`),
    ...invertidas.map((k) => `In “${esc(corto(k))}” the color follows the measured value (${esc(k.def.unidad)}), as in the other columns.`),
    conSigma.length ? `The published uncertainty (${esc(lista(conSigma.map(corto)))}) and the range within the area are shown when pointing at each cell.` : 'The range within the area is shown when pointing at each cell.',
    `<br><b>Sources</b>: ${[...fuentes].map(([f, cs]) => `${esc(lista(cs))} — ${esc(f)}`).join('; ')}.`,
  ].filter(Boolean).join(' ');

  el.innerHTML = figura({
    clase: 'g-mz-fig',
    titulo: `Measurement matrix: ${filas.length} sites × ${cols.length} measured layers ${cuerpo.de}`,
    sub: `Each cell is the measured value of one layer at one site. The color places that value within the whole surface ${cuerpo.de}: dark, low; light, high.`,
    cuerpo: `${control}${escala}
      <div class="g-mz-caja" role="region" tabindex="0" aria-label="Measurement matrix ${esc(cuerpo.de)}: scrollable table; inside the cells, the arrow keys move the focus">
        <table class="g-mz">
          <caption class="sr-only">Measurements of each site ${esc(cuerpo.en)} in each layer, with its percentile on the surface</caption>
          <thead>
            <tr><th scope="col" rowspan="2" class="g-mz-esq">Site<small>rank and name</small></th>${cabGrupos}</tr>
            <tr>${cabCapas}</tr>
          </thead>
          <tbody>${cuerpoTabla}</tbody>
        </table>
      </div>`,
    pie,
  });

  // ---- foco itinerante: una sola celda entra en el orden del tabulador (si no, serían ~100 paradas); las flechas mueven
  const fijar = (td) => { el.querySelector('td[tabindex="0"]')?.setAttribute('tabindex', '-1'); td.setAttribute('tabindex', '0'); estado.foco = td.dataset.k; };
  const inicial = (typeof estado.foco === 'string' && /^\d+,\d+$/.test(estado.foco) && el.querySelector(`td[data-k="${estado.foco}"]`)) || el.querySelector('td[data-k]');
  if (inicial) inicial.setAttribute('tabindex', '0');
  el.addEventListener('focusin', (e) => { const td = e.target.closest?.('td[data-k]'); if (td && el.contains(td)) fijar(td); });
  el.addEventListener('keydown', (e) => {
    const td = e.target.closest?.('td[data-k]');
    if (!td || e.ctrlKey || e.metaKey || e.altKey) return;
    const tr = td.parentElement, j = td.cellIndex;
    const destino = { ArrowLeft: tr.cells[j - 1], ArrowRight: tr.cells[j + 1], ArrowUp: tr.previousElementSibling?.cells[j], ArrowDown: tr.nextElementSibling?.cells[j],
      Home: tr.cells[1], End: tr.cells[tr.cells.length - 1] }[e.key];
    if (!destino?.matches?.('td[data-k]')) return;              // en el borde (o sobre la cabecera de fila) se deja el desplazamiento normal
    e.preventDefault(); destino.focus();
  });

  // ---- orden: cambia el estado y pide al panel que vuelva a pintar (el panel devuelve el foco al mismo botón)
  el.addEventListener('click', (e) => {
    const b = e.target.closest?.('button[data-clave]');
    if (!b || !el.contains(b) || b.disabled || b.dataset.clave === orden) return;
    estado.orden = b.dataset.clave; ctx.repintar();
  });

  // ---- tooltip (cursor, dedo y foco): la medición completa de la celda, o la ficha de la capa en su cabecera
  conTip(el, 'td[data-k], button[data-capa]', (t) => {
    if (t.dataset.capa) {
      const k = cols.find((x) => x.def.id === t.dataset.capa);
      return k ? tipHtml(k.capa.meta.nombre ?? k.def.corto, [['Unit', k.def.unidad]], fuenteDe(k.capa)) : null;
    }
    const [i, j] = t.dataset.k.split(',').map(Number), f = filas[i], k = cols[j];
    if (!f || !k) return null;
    const d = k.def, v = f.v[d.id];
    if (!v) return tipHtml(f.sitio.name, [[d.corto, 'no data']], `No cell with data within ${radio}° of arc, nor the one that contains the site`);
    const N = pct(v.pct), fs = [[d.corto, d.fmt(v.media)], [`Percentile on ${cuerpo.nombre}`, N ?? '—']];
    // el rango va en formato breve (número y unidad corta): con el formato completo (p. ej. kelvin y °C) no cabe en una línea
    if (v.n > 1) fs.push(['Range within the area', `${d.breve(v.min)} … ${d.breve(v.max)}`]);
    if (v.sigma != null) fs.push(['Published uncertainty', `± ${d.fmt(v.sigma)}`]);
    const nota = v.unica ? 'Value of the cell that contains the site' : v.n > 1 ? `Mean of ${nf(v.n)} cells` : `A single cell with its center within ${radio}° of arc`;
    return tipHtml(f.sitio.name, fs, `${nota}${k.derivada ? ' · derived quantity' : ''}`);
  });
}
