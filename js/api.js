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

export async function estadoMotor() {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 1500);
  try {
    const r = await fetch(`${MOTOR_BASE}/api/similitud/estado`, { signal: ctl.signal });
    return r.ok ? await r.json() : null;
  } catch { return null; } finally { clearTimeout(t); }
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

// Comparación detallada multiescala de un par objetivo ↔ candidato (comparacion.py)
export async function fetchComparacion({ body, site, analogo, lado_km = 200, producto, buscar_en = 'earth' }) {
  const r = await fetch(`${MOTOR_BASE}/api/similitud/comparar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cuerpo: body, lat: site.lat, lon: site.lon, lat_candidato: analogo.lat, lon_candidato: analogo.lon,
      lado_km, producto, buscar_en }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.detalle || d.error || String(r.status));
  return d;
}

export async function fetchTraining(site, mission) {
  if (API_BASE) {
    try { return await post('/api/training', { site_id: site.id, body: mission.body }); }
    catch (e) { console.warn('API no disponible, usando datos locales', e); }
  }
  return rankAnalogs(site, 4);
}
