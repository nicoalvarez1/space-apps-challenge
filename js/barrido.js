// ============================================================================
//  BARRIDO DE LA SUPERFICIE CON LAS CAPAS DEL PDS
//
//  Busca más emplazamientos candidatos que los escritos a mano (js/data.js → SITES) recorriendo toda la superficie
//  con las mismas capas y las mismas escalas que ya puntúan esos emplazamientos (js/capas.js → PLAN.metricas):
//  terreno, hielo, térmica y recursos. Nada más: solar, radiación, enlace y ciencia son estimaciones escritas a mano
//  para cada emplazamiento y no existen para un punto cualquiera, así que aquí no se usan ni se inventan.
//
//  - Rejilla regular de latitud/longitud con paso 2 · RADIO_ZONA (= 1°): en el ecuador las zonas de medida de dos
//    puntos vecinos se tocan sin solaparse. Se mide en el centro de cada celda.
//  - Cada punto se mide como un emplazamiento (media de zona o pendiente regional) y se puntúa con las mismas
//    funciones del PLAN (percentil de cada factor en la superficie del cuerpo). Si falta alguno de los factores
//    medidos (sin dato), el punto no cuenta. En Marte tampoco cuentan los puntos fuera de los límites PRELIMINARES de
//    NASA para aterrizajes humanos (capas.js → LIMITES_NASA: latitud y elevación de MOLA).
//  - Nota del barrido = Σ wₖ·factorₖ / Σ wₖ sobre esos factores, con los pesos del objetivo y de los parámetros de la
//    misión (effectiveWeights, js/data.js). No es comparable con la nota de la lista principal (que suma estimaciones).
//  - Candidatos = máximos locales de esa nota en la rejilla (≥ que sus 8 vecinos, con la longitud cíclica y, en la
//    fila polar, los vecinos del otro lado del polo; empates resueltos por el orden de la rejilla), los mejores
//    primero. Se devuelven TODOS; la interfaz los enseña por páginas de SITES[body].length (tantos como la lista) y
//    las mediciones completas de cada página se piden con detallar().
// ============================================================================
import { SITES, effectiveWeights } from './data.js';
import { RADIO_ZONA, RADIO_KM, FACTORES_MEDIDOS, capasAnalisis, distribucionesDe, medirPunto, metricasDe, limitesDe, medirSitios } from './capas.js';

export const PASO = 2 * RADIO_ZONA;                                // grados entre puntos de la rejilla
const NLAT = Math.round(180 / PASO), NLON = Math.round(360 / PASO);
const latDe = (i) => 90 - PASO * (i + 0.5);                        // fila 0 = la más al norte
const lonDe = (j) => -180 + PASO * (j + 0.5);                      // misma convención que SITES: −180…180, positivo al este
const DEG = Math.PI / 180;
const SIN_DATO = -1;

// ---------------------------------------------------------------------------
//  Mediciones de la rejilla (lo costoso): una sola vez por cuerpo.
//  → { v: { factor: Int16Array con la puntuación 0-100 de cada punto o SIN_DATO }, ms, puntos }
// ---------------------------------------------------------------------------
const rejillas = new Map(), oyentes = new Map(), medidas = new Set();   // medidas: cuerpos ya terminados
function rejilla(body, alAvanzar) {
  if (alAvanzar && !medidas.has(body)) { if (!oyentes.has(body)) oyentes.set(body, new Set()); oyentes.get(body).add(alAvanzar); }
  if (!rejillas.has(body)) {
    const p = (async () => {
      const capas = await capasAnalisis(body), D = await distribucionesDe(body), ks = FACTORES_MEDIDOS[body], v = {};
      for (const k of ks) v[k] = new Int16Array(NLAT * NLON).fill(SIN_DATO);
      const t0 = performance.now();
      let corte = t0, calculo = 0, fuera = 0;
      for (let i = 0; i < NLAT; i++) {
        const lat = latDe(i);
        if (limitesDe(body, lat, {})?.fallos.length) { fuera += NLON; continue; }   // fila fuera del límite de latitud
        for (let j = 0; j < NLON; j++) {
          const m = medirPunto(body, capas, lat, lonDe(j)), lim = limitesDe(body, lat, m);
          // un punto que no cumple los límites de NASA del cuerpo (o en el que no se pueden comprobar) cuenta como sin dato
          if (lim && (lim.fallos.length || lim.sinDato)) fuera++;
          else { const met = metricasDe(body, m, D); for (const k of ks) if (met[k]) v[k][i * NLON + j] = met[k].v; }
          // cede el hilo cada pocos milisegundos (no cambia el resultado): el globo y la interfaz siguen respondiendo.
          // Junto a los polos un solo punto recorre filas enteras de la rejilla fina, por eso se mira punto a punto.
          const ahora = performance.now();
          if (ahora - corte > 12) {
            calculo += ahora - corte;
            for (const f of oyentes.get(body) ?? []) f((i * NLON + j + 1) / (NLAT * NLON));
            await new Promise((r) => setTimeout(r, 0)); corte = performance.now();
          }
        }
      }
      calculo += performance.now() - corte;
      medidas.add(body);
      // ms: tiempo real de principio a fin (incluye lo que la página hace entre bloque y bloque); calculo: solo el barrido
      return { v, ms: performance.now() - t0, calculo, puntos: NLAT * NLON, fuera };
    })();
    rejillas.set(body, p);
    p.catch(() => rejillas.delete(body)).finally(() => oyentes.delete(body));
  }
  return rejillas.get(body);
}

// distancia de círculo máximo (km) sobre la esfera de referencia del cuerpo
function distanciaKm(body, a, b) {
  const s = Math.sin(((b.lat - a.lat) * DEG) / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(((b.lon - a.lon) * DEG) / 2) ** 2;
  return 2 * RADIO_KM[body] * Math.asin(Math.min(1, Math.sqrt(s)));
}

// vecinos de un punto de la rejilla: 8 alrededor; la longitud da la vuelta y, más allá del polo, se sigue por el
// meridiano opuesto (la fila polar es vecina de sí misma girada 180°)
function vecinos(i, j) {
  const out = [];
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    if (!di && !dj) continue;
    let ii = i + di, jj = j + dj;
    if (ii < 0 || ii >= NLAT) { ii = ii < 0 ? 0 : NLAT - 1; jj += NLON / 2; }
    jj = ((jj % NLON) + NLON) % NLON;
    if (ii !== i || jj !== j) out.push(ii * NLON + jj);
  }
  return out;
}

// ---------------------------------------------------------------------------
//  Candidatos para un objetivo y unos parámetros (pesos). Se guardan por cuerpo + pesos.
// ---------------------------------------------------------------------------
const resultados = new Map();

// → { candidatos: [{ id, rank, lat, lon, score, metricas: { k: { v, de } }, medidas, cercano: { name, km } }],
//     factores, pesos, ms, puntos, validos, maximos }
export function buscarCandidatos(body, objectiveId, params, { alAvanzar } = {}) {
  const ks = FACTORES_MEDIDOS[body], w = effectiveWeights(objectiveId, params);
  const clave = `${body}|${ks.map((k) => w[k]).join(',')}`;          // mismos pesos → mismo resultado
  if (!resultados.has(clave)) {
    const p = (async () => {
      const r = await rejilla(body, alAvanzar), sw = ks.reduce((a, k) => a + w[k], 0), n = NLAT * NLON;
      const nota = new Float64Array(n).fill(NaN);
      let validos = 0;
      for (let q = 0; q < n; q++) {
        if (ks.some((k) => r.v[k][q] === SIN_DATO)) continue;
        nota[q] = ks.reduce((a, k) => a + w[k] * r.v[k][q], 0) / sw; validos++;
      }
      // a «gana» a b si tiene más nota o, con la misma, va antes en la rejilla (orden total: un máximo por meseta)
      const gana = (a, b) => nota[a] > nota[b] || (nota[a] === nota[b] && a < b);
      const maximos = [];
      for (let q = 0; q < n; q++) {
        if (nota[q] !== nota[q]) continue;
        const i = Math.floor(q / NLON), j = q % NLON;
        if (vecinos(i, j).every((o) => nota[o] !== nota[o] || gana(q, o))) maximos.push(q);
      }
      maximos.sort((a, b) => (gana(a, b) ? -1 : 1));
      const elegidos = maximos.map((q, k) => {
        const lat = latDe(Math.floor(q / NLON)), lon = lonDe(q % NLON);
        const cerca = SITES[body].map((s) => ({ name: s.name, id: s.id, km: distanciaKm(body, { lat, lon }, s) })).sort((a, b) => a.km - b.km)[0];
        return { id: `scan-${body}-${k + 1}`, rank: k + 1, lat, lon, score: Math.round(nota[q]), cercano: cerca };
      });
      return { candidatos: elegidos, factores: ks, pesos: Object.fromEntries(ks.map((k) => [k, w[k] / sw])), ms: r.ms, calculo: r.calculo, puntos: r.puntos, fuera: r.fuera, validos, maximos: maximos.length };
    })();
    resultados.set(clave, p);
    p.catch(() => resultados.delete(clave));
  } else if (alAvanzar) rejilla(body, alAvanzar);                     // si la rejilla aún se está midiendo, que avise también
  return resultados.get(clave);
}

// Mediciones completas (las mismas que los emplazamientos de la lista, medirSitios) de los candidatos que aún no las
// tienen: se piden por páginas, cuando la interfaz las va a enseñar.
export async function detallar(body, candidatos) {
  const faltan = candidatos.filter((c) => !c.medidas);
  if (!faltan.length) return;
  const med = await medirSitios(body, faltan);
  for (const c of faltan) { c.medidas = med[c.id]?.medidas ?? []; c.metricas = med[c.id]?.metricas ?? {}; }
}
