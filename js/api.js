// Capa de acceso a datos. Ahora mismo usa los datos de demostración locales.
// Para conectar el backend (main.py), pon API_BASE = 'http://localhost:8000'.
//
// Contrato esperado:
//   POST {API_BASE}/api/sites   body: { body, objective, crew, duration }
//     -> [{ id, name, region, lat, lon, score, rank, metrics:{solar,ice,terrain,thermal,radiation,comms,science,resources},
//           traits:[], desc, facts:[[label,value]], pros:[], cons:[] }]
//   POST {API_BASE}/api/training body: { site_id, body }
//     -> [{ id, name, country, lat, lon, match, shared:[], desc, activities:[], season, access }]
import { scoreSites, rankAnalogs } from './data.js';

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
  return scoreSites(body, objective, { crew, duration });
}

export async function fetchTraining(site, mission) {
  if (API_BASE) {
    try { return await post('/api/training', { site_id: site.id, body: mission.body }); }
    catch (e) { console.warn('API no disponible, usando datos locales', e); }
  }
  return rankAnalogs(site, 4);
}
