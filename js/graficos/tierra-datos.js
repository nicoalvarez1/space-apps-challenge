// ============================================================================
//  DATOS DEL PANEL «¿DÓNDE ENTRENAR EN LA TIERRA?»  (js/graficos/tierra-*.js)
//
//  Dos fuentes, reales y ninguna escrita a mano (el informe precalculado del motor lo lee js/api.js):
//  - NASA POWER (climatología mensual en el punto del análogo), en vivo desde el navegador:
//      https://power.larc.nasa.gov/api/temporal/climatology/point  → properties.parameter.<P>.{JAN…DEC, ANN}
//    Se guarda en memoria por lugar; si no hay conexión, la promesa falla y el gráfico lo dice.
//  - Ventanas de relieve SRTM y máscara de agua precalculadas en base-planetaria/web/data/tierra/ (indice.json,
//    srtm_<id>.bin int16 LE, agua_<id>.bin uint8: 1 agua, 0 tierra, 255 sin máscara; se pinta como agua también 255 con 0 m). Misma geometría que ventana() de
//    js/analitica.js: azimutal equidistante centrada en el lugar, norte arriba, v[py·n + px] con py = 0 al norte.
//    Si los archivos no existen, las funciones devuelven null y las secciones que los usan se ocultan.
//
//  También calcula las cifras del relieve que se comparan (mismo lado en km, misma rejilla y misma fórmula para el
//  emplazamiento planetario y para el análogo). Aquí no hay umbrales ni valores inventados: solo se leen y se cuentan píxeles.
// ============================================================================
import { capa, RADIO_KM } from '../capas.js';
import { ventana, corte } from '../analitica.js';

const DIR = 'base-planetaria/web/data/tierra/';
const POWER = 'https://power.larc.nasa.gov/api/temporal/climatology/point';
export const POWER_WEB = 'https://power.larc.nasa.gov';
export const PARAM_POWER = ['T2M', 'T2M_MAX', 'T2M_MIN', 'ALLSKY_SFC_SW_DWN', 'PRECTOTCORR', 'RH2M', 'WS2M'];
const MESES_POWER = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
// Unidades tal como llegan de POWER → como se escriben en la interfaz
const UNIDAD = { C: '°C', 'kW-hr/m^2/day': 'kWh/m²/day', 'mm/day': 'mm/day', '%': '%', 'm/s': 'm/s' };
export const unidad = (u) => UNIDAD[u] ?? u ?? '';

// Lado del cuadrado que se compara, en km: el mismo para el emplazamiento y para el análogo
export const LADO_KM = { moon: 300, mars: 600 };
const DEG = Math.PI / 180;

const memo = new Map();
// Una sola petición por clave; si falla, se olvida para poder reintentar
function una(clave, f) {
  if (!memo.has(clave)) { const p = f(); memo.set(clave, p); p.catch(() => memo.delete(clave)); }
  return memo.get(clave);
}

// ---------------------------------------------------------------------------
//  NASA POWER
// ---------------------------------------------------------------------------
// → { series: { <P>: { meses: [12], anual, unidades, nombre } }, periodo, fuentes, version, punto: [lon, lat, elev] }
// Los valores de relleno (header.fill_value, −999) pasan a NaN.
export function climaPower(lat, lon) {
  return una(`power:${lat}:${lon}`, async () => {
    const u = new URL(POWER);
    Object.entries({ parameters: PARAM_POWER.join(','), community: 'RE', longitude: lon, latitude: lat, format: 'JSON' })
      .forEach(([k, v]) => u.searchParams.set(k, v));
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 30000);
    let j;
    try {
      const r = await fetch(u, { signal: ctl.signal });
      if (!r.ok) throw new Error(`POWER ${r.status}`);
      j = await r.json();
    } finally { clearTimeout(t); }
    const relleno = j.header?.fill_value ?? -999, P = j.properties?.parameter ?? {};
    const val = (x) => (typeof x === 'number' && Number.isFinite(x) && x !== relleno ? x : NaN);
    const series = {};
    for (const k of PARAM_POWER) {
      const s = P[k];
      if (!s) continue;
      series[k] = { meses: MESES_POWER.map((m) => val(s[m])), anual: val(s.ANN), unidades: unidad(j.parameters?.[k]?.units), nombre: j.parameters?.[k]?.longname ?? k };
    }
    if (!Object.keys(series).length) throw new Error('POWER: respuesta sin parámetros');
    const rango = j.header?.range ?? '';
    return {
      series, rango,
      periodo: rango.match(/\(([^)]+)\)/)?.[1] ?? rango ?? null,   // «January 2001 - December 2025»
      fuentes: j.header?.sources ?? [], version: j.header?.api?.version ?? null,
      punto: j.geometry?.coordinates ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
//  Relieve SRTM y agua precalculados
// ---------------------------------------------------------------------------
const pedirJson = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); };

// indice.json o null si no existe
export const indiceTierra = () => una('indice', () => pedirJson(DIR + 'indice.json').catch((e) => { console.info('Relieve terrestre precalculado no disponible', e.message); return null; }));

// Ventana completa de un análogo → { meta, fuente, n, km, radioKm, v (Float32, NaN = sin dato), agua (Uint8 | null) } o null
export function relieveTierra(id) {
  return una(`srtm:${id}`, async () => {
    const ind = await indiceTierra(), m = ind?.analogos?.[id];
    if (!m?.archivo || !(m.n > 0)) return null;
    const n = m.n;
    const [rb, ra] = await Promise.all([fetch(DIR + m.archivo), m.agua ? fetch(DIR + m.agua).catch(() => null) : null]);
    if (!rb.ok) throw new Error(`${m.archivo} ${rb.status}`);
    const buf = await rb.arrayBuffer();
    if (buf.byteLength !== n * n * 2) throw new Error(`${m.archivo}: tamaño inesperado`);
    const dv = new DataView(buf), v = new Float32Array(n * n), nd = m.sin_dato ?? -32768;
    for (let k = 0; k < n * n; k++) { const x = dv.getInt16(2 * k, true); v[k] = x === nd ? NaN : x; }
    let crudo = null;
    if (ra?.ok) { const b = new Uint8Array(await ra.arrayBuffer()); if (b.length === n * n) crudo = b; }
    // Regla del motor de similitud: agua = máscara 1, o sin máscara (255) y elevación exactamente 0 m (mar abierto sin
    // teselas SRTMSWBD y todo lo que queda al norte de 60°N). Resultado: 1 agua, 0 tierra, 255 sin saber.
    const agua = new Uint8Array(n * n);
    for (let k = 0; k < n * n; k++) { const a = crudo ? crudo[k] : 255; agua[k] = a === 1 || (a === 255 && v[k] === 0) ? 1 : a === 0 ? 0 : 255; }
    const radioKm = m.radio_km, km = m.km_px ?? (2 * radioKm) / n;
    return { meta: m, fuente: ind.fuente ?? {}, n, km, radioKm, v, agua };
  });
}

// Recorte central de lado ≈ ladoKm (nunca mayor que la ventana). Se conserva la paridad de n para que quede centrado.
export function recorte(t, ladoKm) {
  let m = Math.min(t.n, Math.round(ladoKm / t.km));
  if ((t.n - m) % 2) m -= 1;
  const o = (t.n - m) / 2, v = new Float32Array(m * m), agua = t.agua ? new Uint8Array(m * m) : null;
  for (let y = 0; y < m; y++) {
    const de = (y + o) * t.n + o;
    v.set(t.v.subarray(de, de + m), y * m);
    if (agua) agua.set(t.agua.subarray(de, de + m), y * m);
  }
  return { n: m, km: t.km, v, agua, ladoKm: m * t.km };
}

// Valor del recorte en el punto (x km al este, y km al norte del centro) → { z, agua } (agua: true/false/null)
export function enRecorte(r, x, y) {
  const px = Math.floor(x / r.km + r.n / 2), py = Math.floor(r.n / 2 - y / r.km);
  if (px < 0 || py < 0 || px >= r.n || py >= r.n) return { z: NaN, agua: null };
  const k = py * r.n + px, a = r.agua?.[k];
  return { z: r.v[k], agua: a === 1 ? true : a === 0 ? false : null };
}

// Elevación del centro: media de los píxeles centrales con dato (los 2×2 si n es par)
function centroDe(r) {
  const a = Math.floor((r.n - 1) / 2), b = Math.floor(r.n / 2);
  let s = 0, c = 0;
  for (const y of new Set([a, b])) for (const x of new Set([a, b])) { const z = r.v[y * r.n + x]; if (z === z) { s += z; c++; } }
  return c ? s / c : NaN;
}

// Remuestreo por media de bloques a ns × ns (los píxeles sin dato no cuentan; con menos de la mitad válidos → NaN)
function remuestrear(r, ns) {
  const s = new Float64Array(ns * ns), c = new Uint32Array(ns * ns), t = new Uint32Array(ns * ns);
  for (let py = 0; py < r.n; py++) {
    const Y = Math.min(ns - 1, Math.floor((py * ns) / r.n));
    for (let px = 0; px < r.n; px++) {
      const X = Math.min(ns - 1, Math.floor((px * ns) / r.n)), k = Y * ns + X, z = r.v[py * r.n + px];
      t[k]++; if (z === z) { s[k] += z; c[k]++; }
    }
  }
  const v = new Float32Array(ns * ns);
  for (let k = 0; k < v.length; k++) v[k] = c[k] && c[k] >= t[k] / 2 ? s[k] / c[k] : NaN;
  return v;
}

// Cifras del relieve de una rejilla ns × ns de paso kmPx. Pendiente entre píxeles vecinos (diferencias centrales).
function cifras(v, ns, kmPx, z0) {
  let min = Infinity, max = -Infinity, s = 0, s2 = 0, c = 0;
  for (const z of v) if (z === z) { if (z < min) min = z; if (z > max) max = z; s += z; s2 += z * z; c++; }
  const pend = [], m = 2 * kmPx * 1000;
  for (let y = 1; y < ns - 1; y++) for (let x = 1; x < ns - 1; x++) {
    const o = v[y * ns + x - 1], e = v[y * ns + x + 1], n = v[(y - 1) * ns + x], su = v[(y + 1) * ns + x];
    if (o !== o || e !== e || n !== n || su !== su) continue;
    pend.push(Math.atan(Math.hypot((e - o) / m, (n - su) / m)) / DEG);
  }
  pend.sort((a, b) => a - b);
  const media = c ? s / c : NaN;
  return {
    validos: c, total: v.length, centro: z0,
    min: c ? min : NaN, max: c ? max : NaN, rango: c ? max - min : NaN,
    bajo: c ? min - z0 : NaN, alto: c ? max - z0 : NaN,
    sd: c > 1 ? Math.sqrt(Math.max(0, s2 / c - media * media)) : NaN,
    pendMedia: pend.length ? pend.reduce((a, b) => a + b, 0) / pend.length : NaN,
    pendP90: pend.length ? pend[Math.min(pend.length - 1, Math.floor(0.9 * pend.length))] : NaN,
  };
}

// Tamaño de una celda de la rejilla de elevación del cuerpo, en km (LOLA y MOLA: 0,125°)
const celdaKm = (c, Rkm) => Math.abs(c.meta.dlat) * DEG * Rkm;

// Emplazamiento planetario: ventanas para la vista y para las cifras, perfil O–E y elevación del centro (memo por sitio)
export function relievePlaneta(body, sitio, ladoKm) {
  return una(`planeta:${body}:${sitio.id}:${sitio.lat}:${sitio.lon}:${ladoKm}`, async () => {
    const e = await capa(`${body}_elev`), Rkm = RADIO_KM[body], R = ladoKm / 2;
    const ns = Math.max(8, Math.round(ladoKm / celdaKm(e, Rkm)));
    const vista = ventana(e, sitio.lat, sitio.lon, R, 160, Rkm, { suave: true });
    const rej = ventana(e, sitio.lat, sitio.lon, R, ns, Rkm, { suave: true });
    const z0 = e.en(sitio.lat, sitio.lon);
    return { capa: e, Rkm, ladoKm, ns, kmNs: ladoKm / ns, vista, z0, cifras: cifras(rej.v, ns, ladoKm / ns, z0) };
  });
}

// Comparación completa emplazamiento ↔ análogo al mismo lado en km. null si no hay ventana SRTM del análogo.
// → { lado, planeta (relievePlaneta), tierra: { r (recorte), z0, cifras, agua: { frac, n } }, perfil: { x, p, t, agua } }
export function caraACara(body, sitio, analogo) {
  return una(`cara:${body}:${sitio.id}:${analogo.id}`, async () => {
    const t = await relieveTierra(analogo.id);
    if (!t) return null;
    const r = recorte(t, Math.min(LADO_KM[body], 2 * t.radioKm)), lado = r.ladoKm;
    const pl = await relievePlaneta(body, sitio, lado);
    const z0 = centroDe(r), cf = cifras(remuestrear(r, pl.ns), pl.ns, lado / pl.ns, z0);
    // Fracción de agua entre los píxeles con elevación (agua según la regla de relieveTierra)
    let agua = null;
    if (r.agua) { let a = 0, c = 0; r.v.forEach((z, k) => { if (z === z) { c++; if (r.agua[k] === 1) a++; } }); agua = c ? { frac: a / c, n: c } : null; }
    // Perfil oeste → este por el centro, en los mismos puntos para los dos
    const NP = 121, semi = lado / 2;
    const cp = corte(pl.capa, sitio.lat, sitio.lon, 90, semi, NP, pl.Rkm, { suave: true });
    const x = Array.from(cp.d), p = Array.from(cp.v, (z) => z - pl.z0), te = [], ag = [];
    for (const d of x) {
      // las dos filas centrales del recorte (n par): media de las dos
      const a = enRecorte(r, d, r.km / 2), b = enRecorte(r, d, -r.km / 2), zs = [a.z, b.z].filter((z) => z === z);
      te.push(zs.length ? zs.reduce((u, w) => u + w, 0) / zs.length - z0 : NaN);
      ag.push(a.agua === true || b.agua === true);
    }
    return { lado, planeta: pl, tierra: { r, z0, cifras: cf, agua, meta: t.meta, fuente: t.fuente }, perfil: { x, p, t: te, agua: ag } };
  });
}
