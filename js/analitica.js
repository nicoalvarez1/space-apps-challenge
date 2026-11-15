// ============================================================================
//  ANALÍTICA SOBRE LAS CAPAS REALES  (alimenta los gráficos de los resultados: js/graficos/)
//
//  Entra: las rejillas del NASA PDS que ya carga js/capas.js (base-planetaria/web/data). Sale: resúmenes de esas
//  mismas celdas. Aquí no hay ningún dato escrito a mano, ningún umbral y ninguna fuente nueva: solo se leen celdas
//  y se cuentan. Las capas *_aprox (aproximaciones en los polos de Marte) no se usan nunca.
//
//    percentil(c, v) · cuantil(c, q) · histograma(c, n)   distribución de la SUPERFICIE del cuerpo, ponderada por área
//    perfilLatitud(c, paso)      media zonal (y cuartiles) por banda de latitud
//    destino(lat, lon, az, km)   punto a esa distancia en ese acimut (trigonometría esférica)
//    ventana(...) · corte(...)   entorno del emplazamiento: mapa local (azimutal equidistante) y corte por un círculo máximo
//    sombreado(vent)             relieve sombreado de una ventana de elevación (solo ayuda visual)
//    pendienteRegional()         capa derivada de MOLA con la MISMA fórmula que Capa.pendiente (ya se usa en la puntuación)
//    medirTodo(body, sitios)     tabla emplazamiento × capa medida, con percentil planetario e incertidumbre publicada
//
//  Convenciones: latitud en grados (norte +), longitud en grados (este +, de −180 a 180 a la salida), distancias en km.
//  «Sin dato» es NaN, igual que en js/capas.js.
// ============================================================================
import { capa, catalogo, Capa, CAPAS_GLOBO, RADIO_KM } from './capas.js';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
//  Distribución de la superficie (ponderada por área)
// ---------------------------------------------------------------------------
// Muestra regular de la rejilla —la misma que usa Capa.anclas() para la leyenda del globo—: valores con dato
// ordenados de menor a mayor y área acumulada. Cada celda pesa cos(latitud), porque en una rejilla equirrectangular
// las celdas cercanas a los polos cubren menos superficie.
export function muestra(c) {
  if (c._muestra) return c._muestra;
  const paso = Math.max(1, Math.floor(c.w / 720)), vs = [], ws = [];
  for (let i = 0; i < c.n; i += paso) {
    const w = Math.cos(c.lat(i) * DEG);
    for (let j = 0; j < c.w; j += paso) { const v = c.celda(i, j); if (v === v) { vs.push(v); ws.push(w); } }
  }
  const idx = Uint32Array.from(vs, (_, k) => k).sort((a, b) => vs[a] - vs[b]);
  const v = new Float32Array(idx.length), acum = new Float64Array(idx.length);   // los valores de las rejillas caben exactos en 32 bits
  let total = 0;
  for (let r = 0; r < idx.length; r++) { const k = idx[r]; v[r] = vs[k]; total += ws[k]; acum[r] = total; }
  return (c._muestra = { v, acum, total, paso });
}

// Fracción (0…1) de la superficie con dato cuyo valor de celda es menor o igual que v
export function percentil(c, v) {
  if (v !== v) return NaN;
  const m = muestra(c), n = m.v.length;
  if (!n) return NaN;
  let a = 0, b = n;                                           // primer índice con valor > v
  while (a < b) { const k = (a + b) >> 1; if (m.v[k] <= v) a = k + 1; else b = k; }
  return a ? m.acum[a - 1] / m.total : 0;
}

// Valor por debajo del cual queda la fracción q (0…1) de la superficie con dato
export function cuantil(c, q) {
  const m = muestra(c), n = m.v.length;
  if (!n) return NaN;
  const objetivo = Math.min(1, Math.max(0, q)) * m.total;
  let a = 0, b = n - 1;                                       // primer índice cuya área acumulada llega al objetivo
  while (a < b) { const k = (a + b) >> 1; if (m.acum[k] >= objetivo) b = k; else a = k + 1; }
  return m.v[a];
}

// Intervalos adecuados al tamaño de la rejilla: las de 5° (Odyssey GRS) solo tienen ~2 000 celdas con dato
export const intervalosPara = (c) => (c.n * c.w < 10000 ? 20 : 40);

// Histograma de la superficie: fracción del área en cada intervalo. El eje va del cuantil 0,5 % al 99,5 % para que una
// cola larga no aplaste el resto; lo que queda fuera se acumula en el primer y el último intervalo (colaBaja, colaAlta).
export function histograma(c, n = intervalosPara(c)) {
  const clave = `_hist${n}`;
  if (c[clave]) return c[clave];
  const m = muestra(c), lo = cuantil(c, 0.005), hi = cuantil(c, 0.995), ancho = (hi - lo) / n || 1;
  const area = new Float64Array(n);
  let previo = 0, colaBaja = 0, colaAlta = 0;
  for (let k = 0; k < m.v.length; k++) {
    const w = m.acum[k] - previo, v = m.v[k]; previo = m.acum[k];
    if (v < lo) colaBaja += w; else if (v > hi) colaAlta += w;
    area[Math.min(n - 1, Math.max(0, Math.floor((v - lo) / ancho)))] += w;
  }
  let max = 0;
  for (let b = 0; b < n; b++) { area[b] /= m.total; if (area[b] > max) max = area[b]; }
  return (c[clave] = { lo, hi, ancho, n, area, max, colaBaja: colaBaja / m.total, colaAlta: colaAlta / m.total });
}

// ---------------------------------------------------------------------------
//  Variación con la latitud
// ---------------------------------------------------------------------------
// Para cada banda de `paso` grados de latitud (de 90°S a 90°N): media de las celdas con dato de la banda, ponderada por
// área, y cuartiles 25 % y 75 % (también ponderados). `fraccion` = parte de las celdas muestreadas de la banda que
// tienen dato. Una banda sin dato devuelve NaN.
export function perfilLatitud(c, paso = 2) {
  const clave = `_zonal${paso}`;
  if (c[clave]) return c[clave];
  const nb = Math.round(180 / paso), sj = Math.max(1, Math.floor(c.w / 720));
  const vals = Array.from({ length: nb }, () => []), pesos = Array.from({ length: nb }, () => []), vistas = new Float64Array(nb);
  for (let i = 0; i < c.n; i++) {
    const la = c.lat(i), b = Math.min(nb - 1, Math.max(0, Math.floor((la + 90) / paso))), w = Math.cos(la * DEG);
    for (let j = 0; j < c.w; j += sj) { vistas[b]++; const v = c.celda(i, j); if (v === v) { vals[b].push(v); pesos[b].push(w); } }
  }
  const lat = new Float64Array(nb), media = new Float64Array(nb), q25 = new Float64Array(nb), q75 = new Float64Array(nb), fraccion = new Float64Array(nb);
  for (let b = 0; b < nb; b++) {
    lat[b] = -90 + (b + 0.5) * paso;
    const v = vals[b], w = pesos[b], n = v.length;
    fraccion[b] = vistas[b] ? n / vistas[b] : 0;
    if (!n) { media[b] = q25[b] = q75[b] = NaN; continue; }
    const idx = Uint32Array.from(v, (_, k) => k).sort((x, y) => v[x] - v[y]);
    let total = 0, suma = 0;
    for (let k = 0; k < n; k++) { total += w[k]; suma += v[k] * w[k]; }
    media[b] = suma / total;
    let acum = 0, a = NaN, d = NaN;
    for (let r = 0; r < n; r++) {
      acum += w[idx[r]];
      if (a !== a && acum >= 0.25 * total) a = v[idx[r]];
      if (d !== d && acum >= 0.75 * total) { d = v[idx[r]]; break; }
    }
    q25[b] = a; q75[b] = d === d ? d : v[idx[n - 1]];
  }
  return (c[clave] = { paso, lat, media, q25, q75, fraccion });
}

// ---------------------------------------------------------------------------
//  Geometría sobre la esfera
// ---------------------------------------------------------------------------
// Punto situado a dKm del origen siguiendo el acimut az (0 = norte, 90 = este) → [lat, lon]
export function destino(lat, lon, azDeg, dKm, Rkm) {
  const d = dKm / Rkm, la = lat * DEG, az = azDeg * DEG;
  const sen2 = Math.max(-1, Math.min(1, Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(az)));
  const lo2 = lon * DEG + Math.atan2(Math.sin(az) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * sen2);
  return [Math.asin(sen2) / DEG, ((((lo2 / DEG + 180) % 360) + 360) % 360) - 180];
}

// Valor interpolado bilinealmente entre los cuatro centros de celda vecinos (los que no tienen dato no cuentan).
// SOLO PARA LA VISTA de mapas y cortes locales: cualquier cifra que se muestre como dato usa la celda (Capa.en).
export function bilineal(c, lat, lon) {
  const m = c.meta, fi = (lat - m.lat_centro_0) / m.dlat, fj = ((((lon - m.lon_centro_0) % 360) + 360) % 360) / m.dlon;
  const i0 = Math.floor(fi), j0 = Math.floor(fj), ti = fi - i0, tj = fj - j0;
  let s = 0, w = 0;
  for (let di = 0; di < 2; di++) {
    const i = Math.min(c.n - 1, Math.max(0, i0 + di)), wi = di ? ti : 1 - ti;
    for (let dj = 0; dj < 2; dj++) {
      const j = (((j0 + dj) % c.w) + c.w) % c.w, ww = wi * (dj ? tj : 1 - tj), z = c.celda(i, j);
      if (z === z && ww > 0) { s += z * ww; w += ww; }
    }
  }
  return w >= 0.5 ? s / w : NaN;                              // más cerca de celdas sin dato que con dato → sin dato
}

// Ventana cuadrada de lado 2·radioKm centrada en el emplazamiento, de n × n píxeles, en proyección azimutal
// equidistante (norte arriba, este a la derecha: las distancias y los rumbos desde el centro son exactos).
// v[py·n + px] = valor en ese punto (NaN = sin dato). suave: interpolación bilineal solo para la vista.
export function ventana(c, lat, lon, radioKm, n, Rkm, { suave = false } = {}) {
  const v = new Float32Array(n * n), km = (2 * radioKm) / n;
  let min = Infinity, max = -Infinity;
  for (let py = 0, o = 0; py < n; py++) {
    const y = (n / 2 - py - 0.5) * km;                        // km hacia el norte
    for (let px = 0; px < n; px++, o++) {
      const x = (px + 0.5 - n / 2) * km;                      // km hacia el este
      const [la, lo] = destino(lat, lon, Math.atan2(x, y) / DEG, Math.hypot(x, y), Rkm);
      const z = suave ? bilineal(c, la, lo) : c.en(la, lo);
      v[o] = z;
      if (z === z) { if (z < min) min = z; if (z > max) max = z; }
    }
  }
  return { n, km, radioKm, v, min, max, lat, lon, Rkm };
}

// Coordenadas [lat, lon] del punto de una ventana situado a (xKm al este, yKm al norte) del centro
export const puntoVentana = (vent, xKm, yKm) => destino(vent.lat, vent.lon, Math.atan2(xKm, yKm) / DEG, Math.hypot(xKm, yKm), vent.Rkm);

// Corte por el emplazamiento a lo largo del círculo máximo de acimut az: n puntos de −semiKm a +semiKm
// (los negativos quedan en el sentido contrario al acimut). v = valor de la celda que contiene cada punto.
export function corte(c, lat, lon, azDeg, semiKm, n, Rkm, { suave = false } = {}) {
  const d = new Float32Array(n), v = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const s = -semiKm + (2 * semiKm * k) / (n - 1);
    const [la, lo] = s >= 0 ? destino(lat, lon, azDeg, s, Rkm) : destino(lat, lon, azDeg + 180, -s, Rkm);
    d[k] = s; v[k] = suave ? bilineal(c, la, lo) : c.en(la, lo);
  }
  return { d, v, az: azDeg, semiKm };
}

// Relieve sombreado de una ventana de elevación en metros: 0 (sombra) … 1 (de cara a la luz), con la luz desde el
// noroeste a 45° de altura. Solo es una ayuda visual para leer el relieve; no es un dato.
export function sombreado(vent, exageracion = 1) {
  const { n, km, v } = vent, out = new Float32Array(n * n).fill(Math.SQRT1_2), m = km * 1000;
  const az = 315 * DEG, alt = 45 * DEG, lx = Math.sin(az) * Math.cos(alt), ly = Math.cos(az) * Math.cos(alt), lz = Math.sin(alt);
  for (let y = 0; y < n; y++) {
    const y0 = Math.max(0, y - 1), y1 = Math.min(n - 1, y + 1);
    for (let x = 0; x < n; x++) {
      const x0 = Math.max(0, x - 1), x1 = Math.min(n - 1, x + 1);
      const oeste = v[y * n + x0], este = v[y * n + x1], norte = v[y0 * n + x], sur = v[y1 * n + x];
      if (oeste !== oeste || este !== este || norte !== norte || sur !== sur) continue;
      const gx = ((este - oeste) * exageracion) / ((x1 - x0) * m), gy = ((norte - sur) * exageracion) / ((y1 - y0) * m);
      out[y * n + x] = Math.max(0, (-gx * lx - gy * ly + lz) / Math.hypot(gx, gy, 1));   // normal (−gx, −gy, 1) · luz
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
//  Pendiente regional de Marte (dato derivado de MOLA)
// ---------------------------------------------------------------------------
// MOLA no trae una rejilla de pendientes como la de LOLA. La web ya deriva una «pendiente regional» de la elevación
// para puntuar el terreno (Capa.pendiente: diferencias centrales entre celdas vecinas, base ≈ 15 km). Aquí se calcula
// esa MISMA pendiente en todas las celdas para poder situar cada emplazamiento en el conjunto del planeta.
export const DEF_PENDIENTE_MARTE = {
  id: 'mars_pend', corto: 'Regional slope', grupo: 'Relief · MOLA (derived)', rampa: 'relieve', unidad: '°', derivada: true,
  por: 'Slope between neighboring cells of the MOLA elevation (≈ 15 km baseline). It is a derived quantity: the lower it is, the flatter the terrain at regional scale.',
  tick: (v) => v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  fmt: (v) => `${v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}°`,
  breve: (v) => `${v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}°`,
};

// Pendiente entre celdas vecinas de la rejilla de elevación de un cuerpo, en todas las celdas (misma fórmula que
// Capa.pendiente). En Marte es la «pendiente regional» que se muestra; en la Luna solo sirve para fijar la exageración
// del sombreado (la Luna ya tiene su rejilla de pendientes de LOLA, que es la que se enseña).
const pendientes = new Map();                                   // body → Promise<Capa>
export function pendienteCeldas(body) {
  if (!pendientes.has(body)) {
    const p = capa(`${body}_elev`).then((e) => {
      const n = e.n, w = e.w, out = new Float32Array(n * w), R = RADIO_KM[body] * 1000;
      const dy = 2 * Math.abs(e.meta.dlat) * DEG * R;
      for (let i = 0; i < n; i++) {
        if (i < 1 || i > n - 2) { out.fill(NaN, i * w, (i + 1) * w); continue; }
        const dx = 2 * Math.abs(e.meta.dlon) * DEG * R * Math.cos(e.lat(i) * DEG);
        for (let j = 0; j < w; j++) {
          const gx = (e.celda(i, (j + 1) % w) - e.celda(i, (j + w - 1) % w)) / dx, gy = (e.celda(i - 1, j) - e.celda(i + 1, j)) / dy;
          out[i * w + j] = Math.atan(Math.hypot(gx, gy)) / DEG;
        }
      }
      const m = e.meta;
      return new Capa(`${body}_pend`, {
        ...m, variable: 'pendiente_regional', unidades: '°',
        nombre: body === 'mars' ? 'Regional slope (derived from MOLA elevation)' : 'Slope between neighboring cells (derived from LOLA elevation)',
        tipo: 'float32', escala: 1, desplazamiento: 0, sin_dato: null, estadisticas: null,
        resolucion: `${m.resolucion}; slope between neighboring cells (two-cell baseline)`,
        nota: 'Derived in the browser: central differences of elevation between neighboring cells.',
      }, out);
    });
    pendientes.set(body, p);
    p.catch(() => pendientes.delete(body));
  }
  return pendientes.get(body);
}
export const pendienteRegional = () => pendienteCeldas('mars');

// Exageración vertical del relieve sombreado, la misma para todos los emplazamientos de un cuerpo: la que hace que el
// 10 % de la superficie con más pendiente entre celdas se vea a 45° o más. Así un llano se ve llano y una sierra,
// abrupta, y dos emplazamientos se pueden comparar a simple vista. Sale de los datos, no es un número elegido a mano.
export async function exageracionRelieve(body) {
  const p90 = cuantil(await pendienteCeldas(body), 0.9);
  return p90 > 0 ? 1 / Math.tan(p90 * DEG) : 1;
}

// ---------------------------------------------------------------------------
//  Tabla emplazamiento × capa medida
// ---------------------------------------------------------------------------
// Columnas: las capas medidas del cuerpo (las del panel «Capas de datos») y, en Marte, la pendiente regional derivada.
// → { body, cols: [{ def, capa, sigma?, derivada? }], filas: [{ sitio, v: { [id]: { media, min, max, n, pct, sigma } | null } }] }
//   media/min/max = celdas a menos de 0,5° de arco (Capa.zona); pct = percentil de la media en la superficie del cuerpo;
//   sigma = incertidumbre publicada de la celda (solo Odyssey GRS: capas <id>_sigma), o null.
const columnas = new Map();                                     // body → Promise<cols>
function columnasDe(body) {
  if (!columnas.has(body)) {
    const p = (async () => {
      const defs = CAPAS_GLOBO[body] ?? [], cols = [];
      const cargadas = await Promise.allSettled(defs.map((d) => capa(d.id)));
      cargadas.forEach((r, i) => { if (r.status === 'fulfilled') cols.push({ def: defs[i], capa: r.value }); else console.warn('Capa no disponible', defs[i].id, r.reason); });
      if (!cols.length) throw new Error('Ninguna capa disponible');
      if (body === 'mars') {
        try {
          const pend = await pendienteRegional(), k = cols.findIndex((x) => x.def.id === 'mars_elev');
          cols.splice(k + 1, 0, { def: DEF_PENDIENTE_MARTE, capa: pend, derivada: true });
        } catch (e) { console.warn('Pendiente regional no disponible', e); }
      }
      const cat = await catalogo().catch(() => ({}));
      await Promise.all(cols.map(async (k) => {
        const id = `${k.def.id}_sigma`;
        if (cat[id]) { try { k.sigma = await capa(id); } catch (e) { console.warn('Incertidumbre no disponible', id, e); } }
      }));
      return cols;
    })();
    columnas.set(body, p);
    p.catch(() => columnas.delete(body));
  }
  return columnas.get(body);
}

export async function medirTodo(body, sitios) {
  const cols = await columnasDe(body);
  const filas = sitios.map((s) => {
    const v = {};
    for (const k of cols) {
      const z = k.capa.zona(s.lat, s.lon);
      v[k.def.id] = z ? { ...z, pct: percentil(k.capa, z.media), sigma: k.sigma ? (k.sigma.zona(s.lat, s.lon)?.media ?? null) : null } : null;
    }
    return { sitio: s, v };
  });
  return { body, cols, filas };
}

// Capas con resolución suficiente para un mapa local del entorno (celda ≤ 0,25°): relieve, pendiente, rugosidad, inercia
export const esLocal = (c) => Math.abs(c.meta.dlat) <= 0.25;

// Radio del entorno que se dibuja alrededor de un emplazamiento: unas 80 celdas de la rejilla de elevación de lado
export const RADIO_ENTORNO_KM = { moon: 150, mars: 300 };
