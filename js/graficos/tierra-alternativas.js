// ============================================================================
//  COMPARAR ALTERNATIVAS  (panel de entrenamiento)
//
//  Los análogos que propone rankAnalogs (js/data.js), lado a lado, en una tabla con barras: cada columna tiene su
//  propia escala (de 0 al mayor valor de la columna; la temperatura, del mínimo al máximo de la columna) y el número
//  escrito al lado, así que nada depende solo del color ni de la longitud. Pulsar una fila cambia de análogo.
//  De dónde sale cada número:
//  - Coincidencia: rankAnalogs (rasgos cualitativos compartidos). Es una estimación cualitativa, no una medida.
//  - Clima anual: NASA POWER, valor ANN de T2M, T2M_MIN, T2M_MAX, ALLSKY_SFC_SW_DWN y PRECTOTCORR.
//  - Pasadas despejadas: NASA CMR (js/cmr.js → clearPct, 24 meses, nubosidad ≤ 15 %).
//  - Relieve: las mismas cifras que «cara a cara» (tierra-datos.js → caraACara: mismo lado, misma malla y fórmula),
//    con el emplazamiento planetario como fila y marca de referencia.
//  Las celdas se rellenan a medida que llegan los datos; lo que falta se queda en «—».
//
//  ctx = { body, sitio, lista, pick, alElegir(i) }
// ============================================================================
import { esc, nf, tip, tipHtml, figura, masInfo } from './base.js';
import { climaPower, caraACara, LADO_KM, POWER_WEB } from './tierra-datos.js';
import { earthSiteData } from '../cmr.js';

const NOMBRE = { moon: 'Moon', mars: 'Mars' };
const fin = (v) => v === v && v != null;
const pc = (v, d0, d1) => (d1 > d0 ? Math.max(0, Math.min(100, ((v - d0) / (d1 - d0)) * 100)) : 0);

export function pintar(el, ctx) {
  const { body, sitio, lista, pick } = ctx, cuerpo = NOMBRE[body];
  const datos = lista.map(() => ({ pw: undefined, cm: undefined, cara: undefined }));
  let planeta = null, lado = LADO_KM[body], pendiente = 0;

  const columnas = () => {
    const S = (i, k, c = 'anual') => datos[i].pw?.series?.[k]?.[c];
    const col = {
      match: { max: 100 },
      sol: { max: Math.max(0, ...lista.map((_, i) => S(i, 'ALLSKY_SFC_SW_DWN')).filter(fin)) },
      lluvia: { max: Math.max(0, ...lista.map((_, i) => S(i, 'PRECTOTCORR')).filter(fin)) },
      claro: { max: 100 },
      rango: { max: Math.max(0, ...[...lista.map((_, i) => datos[i].cara?.tierra.cifras.rango), planeta?.rango].filter(fin)) },
      pend: { max: Math.max(0, ...[...lista.map((_, i) => datos[i].cara?.tierra.cifras.pendMedia), planeta?.pendMedia].filter(fin)) },
    };
    const ts = lista.flatMap((_, i) => [S(i, 'T2M_MIN'), S(i, 'T2M_MAX')]).filter(fin);
    col.temp = { min: ts.length ? Math.min(...ts) : 0, max: ts.length ? Math.max(...ts) : 1 };
    return { S, col };
  };

  const barra = (v, max, txt, ref = null) => (fin(v)
    ? `<span class="g-tr-b" aria-hidden="true"><i style="width:${pc(v, 0, max).toFixed(1)}%"></i>${fin(ref) ? `<span class="g-tr-ref" style="left:${pc(ref, 0, max).toFixed(1)}%"></span>` : ''}</span><span class="g-tr-bv">${esc(txt)}</span>`
    : `<span class="g-tr-bv muted">${txt === null ? '…' : txt === 'no data' ? 'no data' : '—'}</span>`);

  const render = () => {
    pendiente = 0;
    const ae = document.activeElement, foco = el.contains(ae) && ae.matches?.('.g-tr-elegir[data-i], .tr-otro[data-i]')   // se devuelve tras repintar
      ? [ae.classList.contains('tr-otro') ? 'tr-otro' : 'g-tr-elegir', ae.dataset.i] : null;
    const { S, col } = columnas(), cargando = (x) => (x === undefined ? null : x?.tierra && !x.tierra.cifras.validos ? 'no data' : '—');
    const filas = lista.map((a, i) => {
      const d = datos[i], c = d.cara?.tierra.cifras;
      const tmin = S(i, 'T2M_MIN'), tmax = S(i, 'T2M_MAX'), tmed = S(i, 'T2M');
      const temp = fin(tmin) && fin(tmax)
        ? `<span class="g-tr-b g-tr-bt" aria-hidden="true"><i style="left:${pc(tmin, col.temp.min, col.temp.max).toFixed(1)}%;width:${(pc(tmax, col.temp.min, col.temp.max) - pc(tmin, col.temp.min, col.temp.max)).toFixed(1)}%"></i>${
          fin(tmed) ? `<span class="g-tr-ref g-tr-med" style="left:${pc(tmed, col.temp.min, col.temp.max).toFixed(1)}%"></span>` : ''}</span><span class="g-tr-bv">${esc(`${nf(tmed, 1)} °C`)}<small>${esc(`${nf(tmin, 0)} … ${nf(tmax, 0)} °C`)}</small></span>`
        : `<span class="g-tr-bv muted">${d.pw === undefined ? '…' : '—'}</span>`;
      const sol = S(i, 'ALLSKY_SFC_SW_DWN'), ll = S(i, 'PRECTOTCORR'), cl = d.cm?.scenes ? d.cm.clearPct : NaN;
      return `<tr data-i="${i}" class="${i === pick ? 'sel' : ''}">
        <th scope="row"><button type="button" class="g-tr-elegir" data-i="${i}" aria-pressed="${i === pick}"><b>${esc(a.name)}</b><small>${esc(a.country)}${i === pick ? ' · shown above' : ''}</small></button></th>
        <td>${barra(a.match, col.match.max, `${a.match} %`)}</td>
        <td>${temp}</td>
        <td>${barra(sol, col.sol.max, fin(sol) ? nf(sol, 2) : cargando(d.pw))}</td>
        <td>${barra(ll, col.lluvia.max, fin(ll) ? nf(ll, 2) : cargando(d.pw))}</td>
        <td>${barra(cl, col.claro.max, fin(cl) ? `${nf(cl)} %` : d.cm === undefined ? null : '—')}</td>
        <td>${barra(c?.rango, col.rango.max, fin(c?.rango) ? `${nf(c.rango)} m` : cargando(d.cara), planeta?.rango)}</td>
        <td>${barra(c?.pendMedia, col.pend.max, fin(c?.pendMedia) ? `${nf(c.pendMedia, 1)}°` : cargando(d.cara), planeta?.pendMedia)}</td>
      </tr>`;
    }).join('');
    const ref = planeta ? `<tr class="g-tr-fref"><th scope="row"><span class="g-tr-elegir"><b>${esc(cuerpo)} · ${esc(sitio.name)}</b><small>reference: the site you are training for</small></span></th>
      <td colspan="5" class="muted g-tr-nota">Climate and clear sky only apply on Earth.</td>
      <td>${barra(planeta.rango, col.rango.max, `${nf(planeta.rango)} m`)}</td><td>${barra(planeta.pendMedia, col.pend.max, `${nf(planeta.pendMedia, 1)}°`)}</td></tr>` : '';
    const pie = `<b>Match:</b> qualitative estimate from the shared traits of the analog catalog (rankAnalogs), not a measurement.
      <b>Climate:</b> NASA POWER Project, NASA Langley Research Center (<a href="${POWER_WEB}" target="_blank" rel="noopener">power.larc.nasa.gov</a>), annual climatological values (ANN): mean T2M, lowest T2M_MIN and highest T2M_MAX of the year, ALLSKY_SFC_SW_DWN and PRECTOTCORR${datos.find((d) => d.pw?.periodo)?.pw.periodo ? `, ${esc(datos.find((d) => d.pw?.periodo).pw.periodo)}` : ''}.
      <b>Clear passes:</b> NASA CMR, share of HLS (Landsat 8/9, Sentinel-2) passes with ≤ 15 % cloud in the last 24 months.
      <b>Relief:</b> SRTM window of each analog (precomputed), the same ${esc(nf(lado))} km square, grid and formulas as “Same scale”; the vertical mark in each bar is the ${esc(cuerpo)} site (${esc(sitio.name)}), from ${esc(body === 'moon' ? 'LRO LOLA' : 'MGS MOLA')}.
      Each column has its own scale: bars start at 0 (temperature: from the lowest to the highest value of the column, with a mark at the mean).`;
    // Modo compacto: una línea por alternativa (nombre, país, temperatura media y cielo despejado); la tabla, en «Learn more»
    const corta = ctx.compacto ? `<div class="tr-otros" role="list" aria-label="Other places on Earth to train">${lista.map((a, i) => {
      if (i === pick) return '';
      const tmed = S(i, 'T2M'), cl = datos[i].cm?.scenes ? datos[i].cm.clearPct : NaN;
      const cifras = [fin(tmed) ? `${nf(tmed, 0).replace('-', '−')} °C average` : datos[i].pw === undefined ? '…' : '', fin(cl) ? `${nf(cl)} % clear passes` : ''].filter(Boolean).join(' · ');
      return `<div role="listitem"><button type="button" class="tr-otro" data-i="${i}"><b>${esc(a.name)}</b><span class="tr-otro-p">${esc(a.country)}</span>${cifras ? `<span class="tr-otro-c">${esc(cifras)}</span>` : ''}</button></div>`;
    }).join('')}</div>` : '';
    const tablaCompleta = figura({
      titulo: `${lista.length} places on Earth, side by side`, sub: `Tap a row to show that place above. In the terrain bars, the thin mark is the ${cuerpo} site.`,
      cuerpo: `<div class="tabla-scroll g-tr-altscroll" tabindex="0" role="region" aria-label="Comparison of the suggested analogs"><table class="tabla g-tr-alt">
        <caption>Suggested analogs for ${esc(sitio.name)} (${esc(cuerpo)}): match, annual climate, clear sky and relief</caption>
        <thead><tr><th scope="col">Analog</th><th scope="col">Match <small>rough estimate</small></th><th scope="col">Temperature <small>average · daily low…high</small></th>
          <th scope="col">Sunshine <small>kWh/m²/day</small></th><th scope="col">Rain <small>mm/day</small></th><th scope="col">Clear skies <small>satellite passes</small></th>
          <th scope="col">Height range <small>${esc(nf(lado))} km square</small></th><th scope="col">Average slope <small>same square</small></th></tr></thead>
        <tbody>${filas}${ref}</tbody></table></div>`,
      pie, clase: 'g-tr-alts',
    });
    el.innerHTML = ctx.compacto ? `${corta}${masInfo(tablaCompleta, '', 'tr-alt-tabla')}` : tablaCompleta;
    if (foco != null) el.querySelector(`.${foco[0]}[data-i="${foco[1]}"]`)?.focus({ preventScroll: true });
  };
  const pronto = () => { if (!pendiente) pendiente = requestAnimationFrame(() => { if (el.isConnected) render(); }); };

  // ---- tooltip de una fila (cursor, dedo y foco) ----
  const tipFila = (i) => {
    const a = lista[i], d = datos[i], S = (k) => d.pw?.series?.[k], c = d.cara?.tierra.cifras;
    const f = (k, u, dec) => (fin(S(k)?.anual) ? `${nf(S(k).anual, dec)} ${u}` : '—');
    return tipHtml(a.name, [['Match (rough estimate)', `${a.match} %`], ['Average temperature', f('T2M', '°C', 1)], ['Daily low … high', fin(S('T2M_MIN')?.anual) ? `${nf(S('T2M_MIN').anual, 1)} … ${nf(S('T2M_MAX')?.anual, 1)} °C` : '—'],
      ['Sunshine', f('ALLSKY_SFC_SW_DWN', 'kWh/m²/day', 2)], ['Rain', f('PRECTOTCORR', 'mm/day', 2)], ['Clear skies', d.cm?.scenes ? `${d.cm.clearPct} % of ${d.cm.scenes}` : '—'],
      ['Height range', fin(c?.rango) ? `${nf(c.rango)} m` : '—'], ['Average slope', fin(c?.pendMedia) ? `${nf(c.pendMedia, 1)}°` : '—']],
      i === pick ? 'Shown above' : 'Select to show this analog');
  };
  el.addEventListener('pointermove', (e) => { const tr = e.target.closest?.('tr[data-i]'); if (tr && el.contains(tr)) tip(tipFila(+tr.dataset.i), e.clientX, e.clientY); else tip(null); });
  el.addEventListener('pointerleave', () => tip(null));
  el.addEventListener('focusin', (e) => { const b = e.target.closest?.('.g-tr-elegir[data-i]'); if (!b) return; const r = b.getBoundingClientRect(); tip(tipFila(+b.dataset.i), r.right, r.bottom); });
  el.addEventListener('focusout', () => { tip(null); });
  el.addEventListener('click', (e) => {
    const tr = e.target.closest?.('tr[data-i], .tr-otro[data-i]');
    if (!tr || !el.contains(tr)) return;
    const i = +tr.dataset.i;
    if (i !== pick) { tip(null); ctx.alElegir?.(i); }
  });

  render();
  // ---- datos: cada uno repinta la tabla al llegar ----
  lista.forEach((a, i) => {
    climaPower(a.lat, a.lon).then((x) => { datos[i].pw = x; }, () => { datos[i].pw = null; }).then(pronto);
    earthSiteData(a).then((x) => { datos[i].cm = x; }, () => { datos[i].cm = null; }).then(pronto);
    caraACara(body, sitio, a).then((x) => {
      datos[i].cara = x;
      if (x) { lado = x.lado; planeta ??= x.planeta.cifras; }
    }, () => { datos[i].cara = null; }).then(pronto);
  });
}
