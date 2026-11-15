// ============================================================================
//  CLIMA PARA ENTRENAR  (panel de entrenamiento)
//
//  Pequeños múltiplos con el mismo eje de meses (enero → diciembre), un eje Y por gráfico:
//    temperatura (banda T2M_MIN–T2M_MAX y línea T2M) · radiación solar · precipitación · pasadas despejadas (CMR) ·
//    humedad relativa · viento.
//  De dónde sale cada número:
//  - NASA POWER, climatología mensual del punto (js/graficos/tierra-datos.js → climaPower). Periodo, versión y fuentes
//    se leen de la propia respuesta (header.range, header.api.version, header.sources).
//  - NASA CMR (js/cmr.js → earthSiteData): por mes, pasadas HLS de 24 meses y cuántas con nubosidad ≤ 15 %. Los meses
//    resaltados son los tres con mayor fracción de pasadas despejadas que ya calcula cmr.js (bestMonths). No hay
//    ningún otro umbral ni ninguna «mejor época» calculada aquí; la de data.js se muestra rotulada como nota del equipo.
//
//  ctx = { analogo: { name, lat, lon, season? }, power: Promise, cmr: Promise, estado }
// ============================================================================
import { esc, nf, coord, marcas, decimalesDe, lineal, tip, tipHtml, tabla, figura, masInfo } from './base.js';
import { POWER_WEB } from './tierra-datos.js';

const MES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MES_LARGO = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const W = 260, H = 112, ml = 34, mr = 6, mt = 8, mb = 20, bw = (W - ml - mr) / 12;
const cx = (i) => ml + bw * (i + 0.5);
const r2 = (v) => Number(v.toFixed(2));
const MIN_PASADAS = 3;                                          // el mismo mínimo que usa js/cmr.js para clasificar un mes

const fmt = (v, u, dec) => (v === v && v != null ? `${nf(v, dec)} ${u}`.trim() : '—');
const decDe = (u) => (u === '°C' ? 1 : u === '%' ? 0 : u === 'm/s' ? 1 : 2);

// Eje Y y rejilla de un panel; devuelve { Y, svg }
function eje(min, max, u) {
  const ms = marcas(min, max, 3), d0 = Math.min(min, ms[0]), d1 = Math.max(max, ms.at(-1)), Y = lineal(d0, d1, H - mb, mt), dec = decimalesDe(ms);
  return {
    Y,
    svg: ms.map((v) => `<line class="${v === 0 && d0 < 0 ? 'g-ref' : 'g-rej'}" x1="${ml}" x2="${W - mr}" y1="${r2(Y(v))}" y2="${r2(Y(v))}"/><text x="${ml - 4}" y="${r2(Y(v)) + 3}" text-anchor="end">${esc(nf(v, dec))}</text>`).join('')
      + `<line class="g-eje" x1="${ml}" x2="${W - mr}" y1="${H - mb}" y2="${H - mb}"/>`,
  };
}

// Fondo común de cada panel: meses destacados, etiquetas de mes y resaltado del mes elegido
const fondo = (mejores) => mejores.map((i) => `<rect class="g-tr-mejor" x="${r2(ml + bw * i)}" y="${mt}" width="${r2(bw)}" height="${H - mt - mb}"/>`).join('')
  + `<rect class="g-tr-mes" x="0" y="${mt}" width="${r2(bw)}" height="${H - mt - mb}" display="none"/>`;
const meses = (mejores) => MES.map((m, i) => `<text class="${mejores.includes(i) ? 'g-val' : ''}" x="${r2(cx(i))}" y="${H - mb + 11}" text-anchor="middle">${m[0]}</text>${
  mejores.includes(i) ? `<path class="g-tr-mejor-m" d="M${r2(cx(i) - 3)} ${H - 2}H${r2(cx(i) + 3)}"/>` : ''}`).join('');

function columnas(vs, max, u, mejores, { sinDato = [] } = {}) {
  const fin = vs.filter((v) => v === v), top = max ?? Math.max(...fin, 0) ?? 1;
  const { Y, svg } = eje(0, top > 0 ? top : 1, u);
  const barras = vs.map((v, i) => {
    if (sinDato[i] || v !== v) return `<rect class="g-tr-nd" x="${r2(ml + bw * i + 2)}" y="${H - mb - 2}" width="${r2(bw - 4)}" height="2"/>`;
    const y = Y(v);
    return `<rect class="g-tr-col${mejores.includes(i) ? ' sel' : ''}" x="${r2(ml + bw * i + 2)}" y="${r2(Math.min(y, H - mb - 1))}" width="${r2(bw - 4)}" height="${r2(Math.max(1, H - mb - y))}"/>`;
  }).join('');
  return `${fondo(mejores)}${svg}${barras}${meses(mejores)}`;
}

function temperatura(tmin, tmed, tmax, u, mejores) {
  const fin = [...tmin, ...tmed, ...tmax].filter((v) => v === v);
  const { Y, svg } = eje(Math.min(...fin), Math.max(...fin), u);
  const ok = (i) => tmin[i] === tmin[i] && tmax[i] === tmax[i];
  const idx = MES.map((_, i) => i).filter(ok);
  const banda = idx.length > 1 ? `<path class="g-tr-banda" d="M${idx.map((i) => `${r2(cx(i))} ${r2(Y(tmax[i]))}`).join('L')}L${idx.slice().reverse().map((i) => `${r2(cx(i))} ${r2(Y(tmin[i]))}`).join('L')}Z"/>` : '';
  let d = '', pen = false;
  tmed.forEach((v, i) => { if (v !== v) { pen = false; return; } d += `${pen ? 'L' : 'M'}${r2(cx(i))} ${r2(Y(v))}`; pen = true; });
  const puntos = tmed.map((v, i) => (v === v ? `<circle class="g-tr-pto" cx="${r2(cx(i))}" cy="${r2(Y(v))}" r="2.2"/>` : '')).join('');
  return `${fondo(mejores)}${svg}${banda}<path class="g-tr-lin" d="${d}"/>${puntos}${meses(mejores)}`;
}

const panel = (id, titulo, unidad, cuerpo) => `<div class="g-tr-pan" data-pan="${id}"><b class="g-tr-ptit">${esc(titulo)} <span>${esc(unidad)}</span></b>
  <svg class="g-svg g-tr-csvg" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">${cuerpo}</svg></div>`;
const vacio = (id, titulo, texto) => `<div class="g-tr-pan g-tr-pan-vacio" data-pan="${id}"><b class="g-tr-ptit">${esc(titulo)}</b><p class="g-vacio">${esc(texto)}</p></div>`;

export async function pintar(el, ctx) {
  const { analogo } = ctx, estado = ctx.estado ?? {};
  el.innerHTML = '<p class="g-cargando" role="status">Loading the NASA POWER climatology and the NASA CMR passes…</p>';
  const [rp, rc] = await Promise.allSettled([ctx.power, ctx.cmr]);
  if (!el.isConnected) return;
  const pw = rp.status === 'fulfilled' ? rp.value : null, cm = rc.status === 'fulfilled' ? rc.value : null;
  if (!pw) console.warn('NASA POWER no disponible', rp.reason);
  const S = pw?.series ?? {};
  const hayCmr = !!cm?.scenes, mejores = hayCmr ? cm.bestMonths ?? [] : [];
  const despejado = MES.map((_, i) => { const x = cm?.months?.[i]; return x && x.total >= MIN_PASADAS ? (100 * x.clear) / x.total : NaN; });
  const pocas = MES.map((_, i) => !(cm?.months?.[i]?.total >= MIN_PASADAS));

  const paneles = [];
  if (S.T2M && S.T2M_MIN && S.T2M_MAX) paneles.push(panel('temp', 'Temperature', S.T2M.unidades, temperatura(S.T2M_MIN.meses, S.T2M.meses, S.T2M_MAX.meses, S.T2M.unidades, mejores)));
  if (S.ALLSKY_SFC_SW_DWN) paneles.push(panel('sol', 'Sunlight', S.ALLSKY_SFC_SW_DWN.unidades, columnas(S.ALLSKY_SFC_SW_DWN.meses, null, S.ALLSKY_SFC_SW_DWN.unidades, mejores)));
  if (S.PRECTOTCORR) paneles.push(panel('lluvia', 'Rain and snow', S.PRECTOTCORR.unidades, columnas(S.PRECTOTCORR.meses, null, S.PRECTOTCORR.unidades, mejores)));
  if (!pw) paneles.push(vacio('power', 'Climate · NASA POWER', 'NASA POWER could not be reached (offline?). The climate panels will appear when it responds.'));
  paneles.push(hayCmr ? panel('cmr', 'Clear skies seen by satellites', '%', columnas(despejado, 100, '%', mejores, { sinDato: pocas }))
    : vacio('cmr', 'Clear satellite passes', cm ? 'No Landsat/Sentinel-2 (HLS) passes at this point in the last 24 months.' : 'NASA CMR could not be queried (offline?).'));
  if (S.RH2M) paneles.push(panel('hr', 'Humidity', S.RH2M.unidades, columnas(S.RH2M.meses, 100, S.RH2M.unidades, mejores)));
  if (S.WS2M) paneles.push(panel('viento', 'Wind', S.WS2M.unidades, columnas(S.WS2M.meses, null, S.WS2M.unidades, mejores)));

  // ---- valores de un mes (tooltip, lectura y tabla) ----
  const v = (k, i) => (S[k] ? fmt(S[k].meses[i], S[k].unidades, decDe(S[k].unidades)) : null);
  const pasadas = (i) => { const x = cm?.months?.[i]; return !cm ? null : !hayCmr ? 'no HLS passes' : x.total >= MIN_PASADAS ? `${nf(despejado[i])} % (${x.clear} of ${x.total})` : `too few passes (${x.total})`; };
  const filasMes = (i) => [
    ['Temperature, min', v('T2M_MIN', i)], ['Temperature, mean', v('T2M', i)], ['Temperature, max', v('T2M_MAX', i)],
    ['Solar irradiance', v('ALLSKY_SFC_SW_DWN', i)], ['Precipitation', v('PRECTOTCORR', i)], ['Clear passes', pasadas(i)],
    ['Relative humidity', v('RH2M', i)], ['Wind speed', v('WS2M', i)],
  ].filter(([, x]) => x != null);

  const anual = pw ? [['T2M', 'Average temperature'], ['T2M_MIN', 'Coldest of the year'], ['T2M_MAX', 'Hottest of the year'],
    ['ALLSKY_SFC_SW_DWN', 'Sunlight'], ['PRECTOTCORR', 'Rain and snow']].filter(([k]) => S[k]).map(([k, t]) =>
    `<div class="fact"><small>${esc(t)}</small><b>${esc(fmt(S[k].anual, S[k].unidades, decDe(S[k].unidades)))}</b></div>`).join('') : '';
  const clarosTxt = hayCmr ? `<div class="fact"><small>Clear-sky satellite passes (24 months)</small><b>${esc(nf(cm.clearPct))} % of ${esc(nf(cm.scenes))}</b></div>` : '';

  const tablaHtml = tabla({
    titulo: `Monthly climate of ${analogo.name} (NASA POWER climatology) and clear satellite passes (NASA CMR, 24 months)`,
    cabeceras: ['Month', 'T min', 'T mean', 'T max', 'Solar', 'Precipitation', 'Clear passes', 'Humidity', 'Wind'],
    filas: [...MES_LARGO.map((m, i) => [m + (mejores.includes(i) ? ' (most clear passes)' : ''), v('T2M_MIN', i) ?? '—', v('T2M', i) ?? '—', v('T2M_MAX', i) ?? '—',
      v('ALLSKY_SFC_SW_DWN', i) ?? '—', v('PRECTOTCORR', i) ?? '—', pasadas(i) ?? '—', v('RH2M', i) ?? '—', v('WS2M', i) ?? '—']),
    ...(pw ? [['Year (POWER ANN)', ...['T2M_MIN', 'T2M', 'T2M_MAX', 'ALLSKY_SFC_SW_DWN', 'PRECTOTCORR'].map((k) => (S[k] ? fmt(S[k].anual, S[k].unidades, decDe(S[k].unidades)) : '—')),
      hayCmr ? `${nf(cm.clearPct)} % of ${nf(cm.scenes)}` : '—', ...['RH2M', 'WS2M'].map((k) => (S[k] ? fmt(S[k].anual, S[k].unidades, decDe(S[k].unidades)) : '—'))]] : [])],
    abierta: !!estado.tabla,
  });

  const nombres = pw ? ['T2M', 'T2M_MIN', 'T2M_MAX', 'ALLSKY_SFC_SW_DWN', 'PRECTOTCORR', 'RH2M', 'WS2M'].filter((k) => S[k]).map((k) => `${k} (${S[k].nombre})`).join('; ') : '';
  const celda = pw?.punto ? ` (POWER cell reported at ${coord(pw.punto[1], pw.punto[0])}${pw.punto[2] != null ? `, ${nf(pw.punto[2])} m` : ''})` : '';
  const pie = `${pw ? `<b>Climate:</b> NASA POWER Project, NASA Langley Research Center, <a href="${POWER_WEB}" target="_blank" rel="noopener">power.larc.nasa.gov</a>${pw.version ? `, Climatology API ${esc(pw.version)}` : ''}.
      ${pw.periodo ? `Climatology period: <b>${esc(pw.periodo)}</b>. ` : ''}${pw.fuentes.length ? `Sources: ${esc(pw.fuentes.join(', '))}. ` : ''}
      Values of the POWER grid cell that contains ${esc(coord(analogo.lat, analogo.lon))}${esc(celda)}. Parameters: ${esc(nombres)}.
      The temperature band runs from T2M_MIN to T2M_MAX, which POWER defines as the minimum and maximum hourly air temperature at 2 m in the period; the line is T2M. ` : '<b>Climate:</b> NASA POWER could not be reached. '}
    <b>Clear passes:</b> NASA CMR, cloud cover in the metadata of every HLSL30 and HLSS30 (Landsat 8/9 and Sentinel-2) granule over the point in the last 24 months; a pass counts as clear at ≤ 15 % cloud (the criterion of this app), and months with fewer than ${MIN_PASADAS} passes are not rated.
    ${mejores.length ? `Shaded and underlined months: the ${mejores.length} with the highest share of clear passes (${esc(mejores.map((i) => MES[i]).join(', '))}).` : ''}`;

  const ariaCl = esc(`Monthly climate of ${analogo.name}. Left and right arrows choose a month and read all its values; Home and End go to January and December. The values are also in the table.`);
  if (ctx.compacto) {
    // Modo compacto: una frase hecha con las cifras ya calculadas + el gráfico de temperatura (meses despejados sombreados);
    // los demás paneles, las cifras anuales, la tabla, las fuentes y la nota de época, en «Learn more»
    const visible = paneles.find((p) => p.includes('data-pan="temp"')) ?? paneles.find((p) => p.includes('data-pan="cmr"')) ?? paneles[0];
    const resto = paneles.filter((p) => p !== visible);
    const tMin = S.T2M_MIN?.meses ?? [], tMax = S.T2M_MAX?.meses ?? [];
    const rango = (ids) => { const lo = ids.map((i) => tMin[i]).filter((x) => x === x && x != null), hi = ids.map((i) => tMax[i]).filter((x) => x === x && x != null);
      const t = (v) => nf(v).replace('-', '−');
      return lo.length && hi.length ? `${t(Math.min(...lo))} to ${t(Math.max(...hi))} °C` : ''; };
    const todos = MES.map((_, i) => i);
    const frase = mejores.length
      ? `Clearest skies: ${[...mejores].sort((x, y) => x - y).map((i) => MES[i]).join(', ')}${rango(mejores) ? ` · ${rango(mejores)} in those months` : ''}`
      : rango(todos) ? `Through the year: ${rango(todos)}` : '';
    el.innerHTML = `
      ${frase ? `<p class="tr-por tr-frase"><b>${esc(frase)}</b></p>` : ''}
      <div class="g-fig g-tr-clima g-tr-clima-c">
        <div class="g-tr-cl" tabindex="0" role="application" aria-label="${ariaCl}">${visible ?? ''}</div>
        ${mejores.length && visible?.includes('data-pan="temp"') ? '<div class="g-ley"><span><i class="g-tr-m-mejor" aria-hidden="true"></i>clearest months</span></div>' : ''}
        <p class="g-en-vivo" role="status" aria-live="polite"></p></div>
      ${masInfo(`${pw || hayCmr ? `<div class="facts g-tr-anual">${anual}${clarosTxt}</div>` : ''}
        ${resto.length ? `<div class="g-tr-cl" tabindex="0" role="application" aria-label="${ariaCl}">${resto.join('')}</div>` : ''}
        <p class="g-pie">Each chart has its own scale. The line is the monthly mean temperature; the band runs from the daily low to the daily high.</p>
        <p class="g-pie">${pie}</p>${tablaHtml}
        ${analogo.season ? `<p class="g-pie"><b>Best season (team note):</b> ${esc(analogo.season)}. Written by the Landfall team in the analog catalog, not computed from these data.</p>` : ''}`, '', 'tr-clima-mas')}`;
  } else el.innerHTML = `
    ${pw || hayCmr ? `<div class="facts g-tr-anual">${anual}${clarosTxt}</div>` : ''}
    ${figura({ titulo: 'The weather, month by month', sub: mejores.length ? 'Shaded: the months when satellites most often saw clear skies.' : 'Point at a month to read all its values.',
      cuerpo: `<div class="g-tr-cl" tabindex="0" role="application" aria-label="${esc(`Monthly climate of ${analogo.name}. Left and right arrows choose a month and read all its values; Home and End go to January and December. The values are also in the table.`)}">${paneles.join('')}</div>
        <p class="g-en-vivo" role="status" aria-live="polite"></p>`,
      mas: '<p class="g-pie">Each chart has its own scale.</p>', pie, tablaHtml, clase: 'g-tr-clima' })}
    ${analogo.season ? `<p class="g-tr-epoca"><b>Best season (team note):</b> ${esc(analogo.season)}</p>${masInfo('<p class="g-pie">Written by the Landfall team in the analog catalog, not computed from these data.</p>')}` : ''}`;

  // ---- interacción: el mismo mes en todos los paneles (en modo compacto hay dos cajas: la visible y la de «Learn more») ----
  const vivo = el.querySelector('.g-en-vivo');
  let mes = new Date().getMonth(), activo = false;
  const marcar = (i) => el.querySelectorAll('.g-tr-mes').forEach((r) => { r.setAttribute('x', r2(ml + bw * i)); r.removeAttribute('display'); });
  const ocultar = () => { activo = false; el.querySelectorAll('.g-tr-mes').forEach((r) => r.setAttribute('display', 'none')); tip(null); };
  el.querySelectorAll('.g-tr-cl').forEach((caja) => conectar(caja));
  el.querySelector('details.g-tabla')?.addEventListener('toggle', (e) => { estado.tabla = e.currentTarget.open; });
  function conectar(caja) {
  const ver = (i, x, y, anunciar) => {
    mes = Math.max(0, Math.min(11, i)); activo = true; marcar(mes);
    const filas = filasMes(mes), t = `${MES_LARGO[mes]}${mejores.includes(mes) ? ' · most clear passes' : ''}`;
    if (x == null) { const b = (caja.querySelector('.g-tr-csvg') ?? caja).getBoundingClientRect(); x = b.left + (cx(mes) / W) * b.width; y = b.bottom; }
    tip(tipHtml(t, filas, pw ? `POWER climatology${pw.periodo ? ` ${pw.periodo}` : ''}; clear passes: CMR, 24 months` : 'Clear passes: CMR, 24 months'), x, y);
    if (anunciar) vivo.textContent = `${t}. ${filas.map(([k, x2]) => `${k}: ${x2}`).join('. ')}.`;
  };
  const alPuntero = (e) => {
    const svg = e.target.closest?.('.g-tr-csvg');
    if (!svg) { if (activo) ocultar(); return; }
    const b = svg.getBoundingClientRect(), sx = ((e.clientX - b.left) / b.width) * W;
    if (sx < ml || sx > W - mr) { ocultar(); return; }
    ver(Math.floor((sx - ml) / bw), e.clientX, e.clientY, false);
  };
  caja.addEventListener('pointermove', alPuntero);
  caja.addEventListener('pointerdown', alPuntero);
  caja.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') ocultar(); });
  caja.addEventListener('focus', () => ver(mes, null, null, true));
  caja.addEventListener('blur', ocultar);
  caja.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (activo) { ocultar(); e.stopPropagation(); } return; }
    const k = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 }[e.key];
    if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); ver(e.key === 'Home' ? 0 : 11, null, null, true); return; }
    if (!k || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault(); e.stopPropagation();
    ver((mes + k + 12) % 12, null, null, true);
  });
  }
}
