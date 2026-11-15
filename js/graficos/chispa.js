// ============================================================================
//  CHISPA DE DISTRIBUCIÓN  (tarjetas «Mediciones NASA PDS» de la ficha)
//
//  Junto a cada medición del emplazamiento: un histograma diminuto de esa capa en TODA la superficie del cuerpo
//  (ponderado por área, js/analitica.js → histograma) con una marca en el valor del emplazamiento, y su percentil.
//  Responde a «¿este valor es alto o bajo para la Luna / Marte?» sin decir si es bueno o malo.
// ============================================================================
import { histograma, percentil } from '../analitica.js';
import { esc, pctTxt } from './base.js';

const W = 120, H = 22, N = 24;

// c: Capa. valor: media del emplazamiento en esa capa. cuerpo: { nombre, de } (js/graficos/base.js → CUERPO)
export function chispa(c, valor, cuerpo) {
  if (valor == null || valor !== valor) return '';
  const h = histograma(c, N), p = pctTxt(percentil(c, valor)), ancho = W / N;
  const barras = Array.from(h.area, (a, i) => { const alto = h.max ? Math.max(1, (a / h.max) * (H - 4)) : 1;
    return `<rect x="${(i * ancho + 0.5).toFixed(1)}" y="${(H - alto).toFixed(1)}" width="${(ancho - 1).toFixed(1)}" height="${alto.toFixed(1)}"/>`; }).join('');
  const x = Math.min(W - 1, Math.max(1, ((valor - h.lo) / (h.hi - h.lo || 1)) * W));
  const texto = `Percentile ${p} ${cuerpo.en}: ${p} % of the surface has an equal or lower value`.replace(': <1 %', ': less than 1 %').replace(': >99 %', ': more than 99 %');
  return `<span class="chispa" title="${esc(texto)}">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(texto)}"><g class="chispa-planeta">${barras}</g>
      <line class="chispa-marca" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="0" y2="${H}"/></svg>
    <span class="chispa-txt">higher than <b>${p} %</b></span></span>`;
}
