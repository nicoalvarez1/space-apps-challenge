// ============================================================================
//  LUGAR DE ENTRENAMIENTO EN LA TIERRA  (la historia principal de #training)
//
//  Una sola historia, de arriba abajo, pensada para cualquier persona; todo lo técnico va tras «Learn more»:
//    1. Tarjeta del lugar elegido de rankAnalogs (js/data.js): nombre, país, imagen de satélite de NASA CMR, rasgos
//       compartidos en chips y «Show on the globe». En «Learn more»: la estimación de coincidencia, coordenadas,
//       descripción, fuentes y el bloque CMR completo (lo rellena js/main.js → renderCmr en #cmr-fam).
//    2. «Same kind of ground»: los dos mapas a la misma escala (tierra-cara.js, modo compacto).
//    3. «When to go»: temperatura por mes con los meses más despejados (tierra-clima.js, modo compacto).
//    4. «Other places»: lista corta de las demás alternativas (tierra-alternativas.js, modo compacto).
//    5. «What you would train»: actividades, acceso y época (notas del equipo en js/data.js, rotuladas así).
//
//  ctx = { body, sitio, lista, pick, aviso, alElegir(i), alGlobo(), desplazar }
// ============================================================================
import { TRAIT_LABELS } from '../data.js';
import { earthSiteData } from '../cmr.js';
import { esc, coord, tip, masInfo } from './base.js';
import { climaPower } from './tierra-datos.js';
import * as cara from './tierra-cara.js';
import * as clima from './tierra-clima.js';
import * as alternativas from './tierra-alternativas.js';

const NOMBRE = { moon: 'Moon', mars: 'Mars' };
const estados = { cara: {}, clima: {} };                        // lo abierto (tablas, vista) se conserva al cambiar de lugar
// Citas oficiales de las colecciones (las mismas que usa js/main.js para el panel de CMR)
const CITAS = {
  hls: ['Neigh, C. et al. (2021). HLS Operational Land Imager Surface Reflectance and TOA Brightness Daily Global 30m v2.0. NASA Land Processes DAAC. https://doi.org/10.5067/HLS/HLSL30.002',
    'Neigh, C. et al. (2021). HLS Sentinel-2 Multi-spectral Instrument Surface Reflectance Daily Global 30m v2.0. NASA Land Processes DAAC. https://doi.org/10.5067/HLS/HLSS30.002'],
  gibs: ['NASA Global Imagery Browse Services (GIBS), MODIS Terra Corrected Reflectance (True Color) layer. https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api'],
};
const enlazar = (t) => esc(t).replace(/(https?:\/\/[^\s<]+[^\s<.,;)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
const fecha = (d) => d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });

export function pintar(caja, ctx) {
  const { body, sitio, lista, pick } = ctx, a = lista[pick], cuerpo = NOMBRE[body], panel = caja.closest('#training');
  tip(null);
  caja.innerHTML = `
    <article class="tr-tarjeta" id="tr-tarjeta" aria-live="polite">
      <div class="tr-foto" data-tr="sat"><p class="small muted">Loading the satellite image…</p></div>
      <div class="tr-tinfo">
        <span class="tag">${pick === 0 ? 'SUGGESTED PLACE' : `OPTION ${pick + 1} OF ${lista.length}`}</span>
        <h3>${esc(a.name)}</h3>
        <p class="tr-donde">${esc(a.country)}</p>
        <p class="tr-por">Shares these traits with ${esc(sitio.name)}:</p>
        <div class="traits">${a.shared.map((t) => `<span class="chip">${esc(TRAIT_LABELS[t] || t)}</span>`).join('')}</div>
        <button type="button" class="btn ghost small-btn" data-tr-globo aria-pressed="false">Show on the globe</button>
      </div>
    </article>
    ${masInfo(`<p class="g-pie"><b>${esc(a.match)} %</b> of the traits in common with ${esc(sitio.name)} (${esc(cuerpo)}, ${esc(coord(sitio.lat, sitio.lon))}).
        ${ctx.aviso ? esc(ctx.aviso) : 'A qualitative estimate from the written traits of the analog catalog, not a measurement.'}</p>
      <p class="g-pie">${esc(a.name)} · ${esc(a.country)} · ${esc(coord(a.lat, a.lon))}. ${esc(a.desc)}</p>
      <div data-tr="fuentes"></div>
      <section class="cmr" id="cmr-fam" data-para="${esc(a.id)}" aria-live="polite"><p class="muted small">Querying the NASA Earthdata catalog…</p></section>`, '', 'tr-tarjeta')}
    <section class="tr-sec" id="tr-cara"><h3>Same kind of ground</h3><div data-tr="cara"></div></section>
    <section class="tr-sec" id="tr-clima"><h3>When to go</h3><div data-tr="clima"></div></section>
    <section class="tr-sec" id="tr-alt"><h3>Other places</h3><div data-tr="alt"></div></section>
    <section class="tr-sec" id="tr-prog"><h3>What you would train</h3>
      <div class="traits tr-acts">${a.activities.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>
      <p class="tr-por tr-nota">Access: ${esc(a.access)} · Season: ${esc(a.season)} <span class="muted">(team notes)</span></p>
      ${masInfo('<p class="g-pie">Activities, access and season are written by the Landfall team in the analog catalog, not computed from data.</p>')}
    </section>`;

  // botón del globo (en móvil también pliega el panel para dejar ver el globo)
  const globo = caja.querySelector('[data-tr-globo]');
  panel?.classList.remove('tr-min');
  globo.onclick = () => {
    const movil = matchMedia('(max-width: 800px)').matches, plegar = movil && !panel?.classList.contains('tr-min');
    if (!panel?.classList.contains('tr-min')) ctx.alGlobo?.();
    if (movil && panel) {
      panel.classList.toggle('tr-min', plegar);
      globo.textContent = plegar ? 'Back to the details' : 'Show on the globe';
      globo.setAttribute('aria-pressed', String(plegar));
      if (plegar) globo.scrollIntoView({ block: 'nearest' });
    }
  };

  const hueco = (k) => caja.querySelector(`[data-tr="${k}"]`);
  cara.pintar(hueco('cara'), { body, sitio, analogo: a, estado: estados.cara, compacto: true })
    .then(() => { if (hueco('cara')?.hidden) caja.querySelector('#tr-cara').hidden = true; }, (e) => console.warn('Cara a cara', e));
  const cmr = earthSiteData(a);
  clima.pintar(hueco('clima'), { analogo: a, power: climaPower(a.lat, a.lon), cmr, estado: estados.clima, compacto: true }).catch((e) => console.warn('Clima', e));
  if (lista.length > 1) alternativas.pintar(hueco('alt'), { body, sitio, lista, pick, alElegir: ctx.alElegir, compacto: true });
  else caja.querySelector('#tr-alt').hidden = true;

  // imagen de satélite más reciente y despejada (NASA CMR; GIBS donde no hay HLS)
  cmr.then((d) => {
    const el = hueco('sat'), fu = hueco('fuentes');
    if (!el?.isConnected) return;
    const img = d.image, cap = img.date ? `${img.sensor} · ${fecha(img.date)}` : `${img.sensor} · recent image`;
    const citas = d.scenes ? CITAS.hls : CITAS.gibs;
    el.innerHTML = `<a href="${esc(img.src)}" target="_blank" rel="noopener"><img src="${esc(img.src)}" alt="Latest clear satellite image of ${esc(a.name)}" loading="lazy"></a>
      <span class="tr-foto-pie">${esc(cap)}</span>`;
    if (fu) fu.innerHTML = `<p class="g-pie">Satellite image: ${esc(img.sensor)}${img.date ? `, ${esc(fecha(img.date))}, ${esc(String(Math.round(img.cloud)))} % cloud` : ''}${img.id ? ` · <code>${esc(img.id)}</code>` : ''}. Sources (${citas.length}):</p>
      <ol class="citas">${citas.map((c) => `<li>${enlazar(c)}</li>`).join('')}</ol>`;
  }, () => { const el = hueco('sat'); if (el?.isConnected) el.innerHTML = '<p class="small muted">NASA CMR could not be queried (offline?).</p>'; });

  if (ctx.desplazar) caja.querySelector('#tr-tarjeta')?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
