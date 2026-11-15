// Capa de acceso a datos. Sin backend: emplazamientos locales puntuados con las capas reales del PDS (js/capas.js).
// Para conectar el backend (main.py), pon API_BASE = 'http://localhost:8000'.
//
// Contrato esperado:
//   POST {API_BASE}/api/sites   body: { body, objective, crew, duration }
//     -> [{ id, name, region, lat, lon, score, rank, metrics:{solar,ice,terrain,thermal,radiation,comms,science,resources},
//           traits:[], desc, facts:[[label,value]], pros:[], cons:[] }]
//   POST {API_BASE}/api/training body: { site_id, body }
//     -> [{ id, name, country, lat, lon, match, shared:[], desc, activities:[], season, access }]
import { scoreSites, rankAnalogs, SITES } from './data.js';
import { medirSitios } from './capas.js';

export const API_BASE = null;

async function post(path, payload) {
  const r = await fetch(API_BASE + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

export async function fetchSites(mission) {
  const { body, objective, crew, duration } = mission;
  if (API_BASE) {
    try {
      const data = await post('/api/sites', { body, objective, crew, duration });
      return data.map((s) => ({ ...s, contrib: s.contrib ?? {}, pros: s.pros ?? [], cons: s.cons ?? [] }));
    } catch (e) { console.warn('API no disponible, usando datos locales', e); }
  }
  let medidas = {};
  try { medidas = await medirSitios(body, SITES[body]); }
  catch (e) { console.warn('Capas PDS no disponibles: se usan solo las estimaciones de demostración', e); }
  return scoreSites(body, objective, { crew, duration }, medidas);
}

// ---------------------------------------------------------------------------
// Motor científico de similitud geomorfológica (base-planetaria/similitud, `python -m similitud servidor`).
// Es independiente de /api/training: si no está en marcha, la web funciona exactamente igual.
export const MOTOR_BASE = 'http://localhost:8000';
// El motor solo existe en el ordenador del equipo. En la web publicada (topgit.earth) no se intenta llamar a localhost:
// el navegador lo bloquearía o pediría permiso de «acceso a la red local» al visitante.
export const MOTOR_LOCAL = ['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname) || location.hostname.endsWith('.localhost');

// El estado se pregunta una vez cada pocos segundos aunque lo pidan a la vez la búsqueda y las comparaciones
let estado = { t: -Infinity, p: null };
export function estadoMotor() {
  if (!MOTOR_LOCAL) return Promise.resolve(null);
  if (performance.now() - estado.t < 5000) return estado.p;
  const p = (async () => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 1500);
    try {
      const r = await fetch(`${MOTOR_BASE}/api/similitud/estado`, { signal: ctl.signal });
      return r.ok ? await r.json() : null;
    } catch { return null; } finally { clearTimeout(t); }
  })();
  estado = { t: performance.now(), p };
  return p;
}

// site: {lat, lon}; body: 'moon' | 'mars'. Devuelve el JSON completo del motor o lanza Error(detalle).
export async function fetchAnalogosGeomorfologicos(site, body, { lado_km = 200, k = 5, producto } = {}) {
  const r = await fetch(`${MOTOR_BASE}/api/similitud/analogos`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cuerpo: body, lat: site.lat, lon: site.lon, lado_km, k, producto, validar: true }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.detalle || d.error || String(r.status));
  return d;
}

// Comparación detallada multiescala de un par objetivo ↔ candidato (comparacion.py), en vivo. La misma petición se
// hace una sola vez por sesión: el panel de la Tierra y la comparación completa (js/comparacion.js) la comparten.
const compVivas = new Map();
function comparacionViva({ body, site, analogo, lado_km = 200, producto, buscar_en = 'earth' }) {
  const clave = [body, site.lat, site.lon, analogo.lat, analogo.lon, lado_km, producto ?? '', buscar_en].join(':');
  if (!compVivas.has(clave)) {
    const p = (async () => {
      const r = await fetch(`${MOTOR_BASE}/api/similitud/comparar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cuerpo: body, lat: site.lat, lon: site.lon, lat_candidato: analogo.lat, lon_candidato: analogo.lon,
          lado_km, producto, buscar_en }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detalle || d.error || String(r.status));
      return { ...d, origen: { tipo: 'motor' } };
    })();
    compVivas.set(clave, p); p.catch(() => compVivas.delete(clave));
  }
  return compVivas.get(clave);
}

// Una sola respuesta: la del motor si está en marcha; si no, la precalculada (mismo emplazamiento y candidato).
export async function fetchComparacion(ctx) {
  if (await estadoMotor()) return comparacionViva(ctx);
  const pre = await comparacionPrecalculada(ctx.body, ctx.site, ctx.analogo);
  if (pre) return pre;
  throw new Error('the similarity engine is not running and this comparison was not precomputed');
}

// ---------------------------------------------------------------------------
// Análogos precalculados (base-planetaria/web/data/analogos, `python -m similitud precalcular-web`): la misma respuesta
// que da el motor, guardada para que la web estática los tenga sin servidor. Llevan `precalculado.fecha`.
export const PRECALC_BASE = 'base-planetaria/web/data/analogos';
const precalc = new Map();
async function leerPrecalculado(nombre) {
  if (!precalc.has(nombre)) {
    precalc.set(nombre, fetch(`${PRECALC_BASE}/${nombre}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }
  return precalc.get(nombre);
}
// Índice de lo precalculado (fecha, emplazamientos y candidatos), o null
export const indicePrecalculado = () => leerPrecalculado('indice.json');
const conOrigen = (d) => (d ? { ...d, origen: { tipo: 'precalculado', fecha: d.precalculado?.fecha ?? null } } : null);
const mismaPos = (a, b) => Math.abs(a - b) < 1e-6;

// La búsqueda de un emplazamiento de js/data.js, o null si no está precalculada (o es de otras coordenadas)
export async function analogosPrecalculados(body, site) {
  const d = await leerPrecalculado(`${body}_${site.id}.json`);
  const c = d?.precalculado?.configuracion;
  return c && mismaPos(c.lat, site.lat) && mismaPos(c.lon, site.lon) ? conOrigen(d) : null;
}

// La comparación del candidato `analogo.rango`, solo si es el mismo punto que se pide
export async function comparacionPrecalculada(body, site, analogo) {
  if (!site?.id || !analogo?.rango) return null;
  const d = await leerPrecalculado(`${body}_${site.id}_${analogo.rango}.json`);
  const c = d?.precalculado?.configuracion;
  return c && mismaPos(c.lat, site.lat) && mismaPos(c.lon, site.lon) && mismaPos(c.lat_candidato, analogo.lat)
    && mismaPos(c.lon_candidato, analogo.lon) ? conOrigen(d) : null;
}

// MDE que pide la web para la búsqueda: el polar de LOLA del hemisferio con |lat| ≥ 78° si el motor lo tiene.
// La misma regla está en base-planetaria/similitud/precalcular_web.py (LAT_POLAR) para los precalculados.
export function productoMotor(site, body, est) {
  if (body !== 'moon' || Math.abs(site.lat) < 78) return undefined;
  const pol = site.lat < 0 ? 'ldem_75s_240m' : 'ldem_75n_240m';
  return est?.datos?.moon?.polares?.includes(pol) ? pol : undefined;
}

// Dos fuentes para lo mismo: lo precalculado (si existe) llega enseguida y, si el motor está en marcha, su respuesta
// en vivo llega después y manda (alLlegar se llama otra vez). alLlegar(r) recibe el JSON del motor con
// `origen = {tipo: 'motor' | 'precalculado', fecha}`. Si no hay ninguna de las dos: alFallar(mensaje, estado del motor).
function dosFuentes(pre, vivo, { alLlegar, alFallar }) {
  let vivoListo = false, preListo = false, fallos = 0, ultimo = 'not available';
  const fallo = (msg, est) => { ultimo = msg ?? ultimo; if (++fallos === 2 && !preListo && !vivoListo) alFallar?.(ultimo, est); };
  pre.then((d) => { if (d && !vivoListo) { preListo = true; alLlegar(d); } else if (!d) fallo(null); });
  (async () => {
    const est = await estadoMotor();
    if (!est) return fallo('engine not running', null);
    if (!est.datos?.earth?.srtmgl30_teselas) return fallo('the SRTMGL30 Earth elevation model is missing', est);
    try { const d = await vivo(est); vivoListo = true; alLlegar(d); } catch (e) { fallo(e.message, est); }
  })();
}

// Análogos terrestres de un emplazamiento (k = 5, lado 200 km, la configuración de la web)
export function analogosTierra(site, body, avisos) {
  dosFuentes(analogosPrecalculados(body, site),
    async (est) => ({ ...(await fetchAnalogosGeomorfologicos(site, body, { producto: productoMotor(site, body, est) })), origen: { tipo: 'motor' } }),
    avisos);
}

// Comparación de un candidato (para los mapas del panel de la Tierra). ctx como en fetchComparacion.
export function comparacionTierra(ctx, avisos) {
  dosFuentes(comparacionPrecalculada(ctx.body, ctx.site, ctx.analogo), () => comparacionViva(ctx), avisos);
}

export async function fetchTraining(site, mission) {
  if (API_BASE) {
    try { return await post('/api/training', { site_id: site.id, body: mission.body }); }
    catch (e) { console.warn('API no disponible, usando datos locales', e); }
  }
  return rankAnalogs(site, 4);
}
