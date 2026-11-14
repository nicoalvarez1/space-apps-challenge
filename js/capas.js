// Capas de datos reales de la Luna y Marte (NASA PDS), generadas por base-planetaria/tools/.
//
// Cada capa es una rejilla equirectangular en un .bin (little-endian) descrita en capas.json:
// tipo, filas × columnas, lat/lon del centro de la celda (0,0), paso, escala y valor «sin dato».
// Aquí NO se interpola ni se inventa nada: se leen celdas y se hacen medias explícitas.
//
//   capa(id)            → rejilla cargada (se descarga una sola vez)
//   medirSitios(...)    → mediciones alrededor de cada emplazamiento + puntuaciones 0-100 derivadas
//   pintarCapa(capa)    → lienzo equirectangular coloreado para proyectarlo sobre el globo

const DIR = 'base-planetaria/web/data/';
const TIPOS = { int16: Int16Array, uint16: Uint16Array, uint8: Uint8Array, float32: Float32Array };
const DEG = Math.PI / 180;
export const RADIO_KM = { moon: 1737.4, mars: 3389.5 };
export const RADIO_ZONA = 0.5;                       // grados de arco alrededor del sitio (≈15 km Luna, ≈30 km Marte)

let cat = null;
const mem = new Map();

export function catalogo() {
  if (!cat) {
    cat = fetch(DIR + 'capas.json').then((r) => { if (!r.ok) throw new Error(`capas.json ${r.status}`); return r.json(); }).then((j) => j.capas);
    cat.catch(() => { cat = null; });
  }
  return cat;
}

export function capa(id) {
  if (!mem.has(id)) {
    const p = (async () => {
      const m = (await catalogo())[id];
      if (!m) throw new Error(`Capa desconocida: ${id}`);
      const r = await fetch(DIR + m.archivo);
      if (!r.ok) throw new Error(`${m.archivo} ${r.status}`);
      const buf = await r.arrayBuffer();
      if (buf.byteLength !== m.bytes) throw new Error(`${m.archivo}: tamaño inesperado`);
      return new Capa(id, m, new TIPOS[m.tipo](buf));
    })();
    mem.set(id, p);
    p.catch(() => mem.delete(id));
  }
  return mem.get(id);
}

export class Capa {
  constructor(id, meta, datos) { this.id = id; this.meta = meta; this.d = datos; this.n = meta.filas; this.w = meta.columnas; this._anclas = null; }

  lat(i) { return this.meta.lat_centro_0 + i * this.meta.dlat; }
  lon(j) { return this.meta.lon_centro_0 + j * this.meta.dlon; }
  fila(lat) { return Math.min(this.n - 1, Math.max(0, Math.round((lat - this.meta.lat_centro_0) / this.meta.dlat))); }
  col(lon) { const x = Math.round((((lon - this.meta.lon_centro_0) % 360) + 360) % 360 / this.meta.dlon); return ((x % this.w) + this.w) % this.w; }

  // valor físico de la celda (NaN = sin dato)
  celda(i, j) {
    const v = this.d[i * this.w + j], m = this.meta;
    return v !== v || (m.sin_dato != null && v === m.sin_dato) ? NaN : v * m.escala + m.desplazamiento;
  }

  en(lat, lon) { return this.celda(this.fila(lat), this.col(lon)); }   // celda que contiene el punto

  // recorre las celdas cuyo centro está a menos de `r` grados de arco del punto
  cadaCelda(lat, lon, r, fn) {
    const m = this.meta, sl = Math.sin(lat * DEG), cl = Math.cos(lat * DEG), cr = Math.cos(r * DEG);
    const i0 = this.fila(lat + r), i1 = this.fila(lat - r), jc = this.col(lon);
    for (let i = Math.min(i0, i1); i <= Math.max(i0, i1); i++) {
      const la = this.lat(i), c = Math.cos(la * DEG), s = Math.sin(la * DEG);
      const polo = Math.abs(la) + r >= 89.9 || Math.abs(lat) + r >= 89.9;
      const half = polo ? Math.floor(this.w / 2) : Math.min(Math.floor(this.w / 2), Math.ceil((r * 1.2) / (c * Math.abs(m.dlon))) + 1);
      for (let k = -half; k <= half; k++) {
        if (k === half && half * 2 >= this.w) continue;                 // no repetir la columna opuesta
        const j = (((jc + k) % this.w) + this.w) % this.w;
        if (s * sl + c * cl * Math.cos((this.lon(j) - lon) * DEG) >= cr) fn(i, j, la);
      }
    }
  }

  // media / mín / máx de las celdas con dato en la zona; si no cae ningún centro dentro, la celda que contiene el punto
  zona(lat, lon, r = RADIO_ZONA) {
    let n = 0, sum = 0, min = Infinity, max = -Infinity;
    this.cadaCelda(lat, lon, r, (i, j) => { const v = this.celda(i, j); if (v === v) { n++; sum += v; if (v < min) min = v; if (v > max) max = v; } });
    if (n) return { media: sum / n, min, max, n };
    const v = this.en(lat, lon);
    return v === v ? { media: v, min: v, max: v, n: 1, unica: true } : null;
  }

  // pendiente media (°) calculada por diferencias centrales sobre una capa de elevación en metros
  pendiente(lat, lon, radioKm, r = RADIO_ZONA) {
    const m = this.meta, dy = 2 * Math.abs(m.dlat) * DEG * radioKm * 1000;
    let n = 0, sum = 0, max = 0;
    this.cadaCelda(lat, lon, r, (i, j, la) => {
      if (i < 1 || i > this.n - 2) return;
      const dx = 2 * Math.abs(m.dlon) * DEG * radioKm * 1000 * Math.cos(la * DEG);
      const gx = (this.celda(i, (j + 1) % this.w) - this.celda(i, (j + this.w - 1) % this.w)) / dx;
      const gy = (this.celda(i - 1, j) - this.celda(i + 1, j)) / dy;
      const p = Math.atan(Math.hypot(gx, gy)) / DEG;
      if (p === p) { n++; sum += p; if (p > max) max = p; }
    });
    return n ? { media: sum / n, min: 0, max, n } : null;
  }

  // Anclas de la escala de color: cuantiles 2, 25, 50, 75 y 98 de la superficie (cada celda pesa cos(lat),
  // porque en una rejilla equirectangular las celdas polares cubren menos área). Muestreo regular.
  anclas() {
    if (this._anclas) return this._anclas;
    const paso = Math.max(1, Math.floor(this.w / 720)), vs = [], ws = [];
    for (let i = 0; i < this.n; i += paso) {
      const w = Math.cos(this.lat(i) * DEG);
      for (let j = 0; j < this.w; j += paso) { const v = this.celda(i, j); if (v === v) { vs.push(v); ws.push(w); } }
    }
    const idx = Uint32Array.from(vs, (_, k) => k).sort((a, b) => vs[a] - vs[b]);
    let total = 0; for (const w of ws) total += w;
    const qs = [0.02, 0.25, 0.5, 0.75, 0.98], out = [];
    let acc = 0, q = 0;
    for (const k of idx) { acc += ws[k]; while (q < qs.length && acc >= qs[q] * total) { out.push(vs[k]); q++; } }
    while (out.length < qs.length) out.push(vs[idx[idx.length - 1]]);
    return (this._anclas = out);
  }

  // posición 0..1 de un valor en la escala (lineal a tramos entre anclas: cada tramo ocupa 1/4 de la rampa)
  pos(v) {
    const a = this.anclas(), n = a.length - 1;
    if (v <= a[0]) return 0; if (v >= a[n]) return 1;
    let k = 0; while (k < n - 1 && v > a[k + 1]) k++;
    const d = a[k + 1] - a[k];
    return (k + (d > 0 ? (v - a[k]) / d : 0)) / n;
  }
}

// ---------------------------------------------------------------------------
//  Formato
// ---------------------------------------------------------------------------
const nf = (v, d = 0) => v.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
const kelvin = (v) => `${nf(v, 0)} K (${nf(v - 273.15, 0)} °C)`;
const U = (dec, unidad) => (v) => `${nf(v, dec)}${unidad === '°' ? '' : ' '}${unidad}`;

// ---------------------------------------------------------------------------
//  Capas que se pueden proyectar sobre el globo (una rampa de un solo tono por tipo de magnitud)
// ---------------------------------------------------------------------------
// Luminosidad siempre creciente (oscuro = poco, claro = mucho) dentro de una familia de tonos vecinos.
export const RAMPAS = {
  relieve: ['#150b38', '#1d4a7a', '#17827f', '#4bbf6b', '#d8e84a'],
  calor:   ['#120a2e', '#5c1a5e', '#b83452', '#f0803a', '#fbe36a'],
  agua:    ['#0a0f2c', '#1b3f8f', '#2f86c9', '#5fd0d6', '#dcfbe9'],
  mineral: ['#170b2b', '#522073', '#a13a8c', '#e8718a', '#fcd9b0'],
};

// fmt = valor completo (cursor); breve = valor compacto (marcadores y lista); tick = solo el número (escala)
const L = (id, corto, grupo, rampa, dec, unidad, por, enKelvin = false) => ({ id, corto, grupo, rampa, unidad, por,
  tick: (v) => nf(v, dec), fmt: enKelvin ? kelvin : U(dec, unidad), breve: U(dec, unidad.length > 9 ? '' : unidad.replace(' en peso', '')) });

export const CAPAS_GLOBO = {
  moon: [
    L('moon_elev', 'Elevación', 'Relieve · LOLA', 'relieve', 0, 'm', 'Altura del terreno respecto a una esfera de 1737,4 km. Cuencas profundas y bordes altos condicionan la luz, el enlace y los accesos.'),
    L('moon_pendiente', 'Pendiente', 'Relieve · LOLA', 'relieve', 1, '°', 'Cuanto menor es la pendiente, más seguro es alunizar, rodar y construir.'),
    L('moon_rugosidad', 'Rugosidad', 'Relieve · LOLA', 'relieve', 2, 'm', 'Irregularidad del suelo a escala de metros: afecta al alunizaje y a los rovers.'),
    L('moon_tmax', 'Máxima', 'Temperatura · Diviner', 'calor', 0, 'K', 'Pico de calor del día lunar: marca el esfuerzo de refrigeración de la base.', true),
    L('moon_tmin', 'Mínima', 'Temperatura · Diviner', 'calor', 0, 'K', 'Frío de la noche lunar. Donde nunca se superan ~110 K el hielo de agua puede conservarse.', true),
    L('moon_tmedia', 'Media', 'Temperatura · Diviner', 'calor', 0, 'K', 'Temperatura media del ciclo día-noche: orienta sobre la del subsuelo somero.', true),
    L('moon_h', 'Hidrógeno', 'Composición · Lunar Prospector', 'agua', 0, 'ppm', 'Hidrógeno en el primer metro de suelo: el mejor indicio orbital de hielo de agua (máximos en los polos).'),
    L('moon_feo', 'FeO', 'Composición · Lunar Prospector', 'mineral', 1, '% en peso', 'Hierro en el regolito: los mares basálticos ricos en FeO son mejores para extraer oxígeno y metales.'),
  ],
  mars: [
    L('mars_elev', 'Elevación', 'Relieve · MOLA', 'relieve', 0, 'm', 'Altura sobre el areoide. Cuanto más bajo, más atmósfera encima para frenar el aterrizaje y atenuar la radiación.'),
    L('mars_inercia', 'Inercia térmica', 'Suelo · TES', 'calor', 0, 'J m⁻² K⁻¹ s⁻½', 'Baja = polvo suelto; alta = roca o suelo compacto, con menos oscilación de temperatura entre el día y la noche.'),
    L('mars_h2o', 'Agua (H₂O)', 'Composición · Odyssey GRS', 'agua', 1, '% en peso', 'Agua equivalente en el primer metro (hielo o minerales hidratados). Sin dato cerca de los polos.'),
    L('mars_fe', 'Hierro', 'Composición · Odyssey GRS', 'mineral', 1, '% en peso', 'Materia prima para acero y construcción in situ.'),
    L('mars_si', 'Silicio', 'Composición · Odyssey GRS', 'mineral', 1, '% en peso', 'Base para fabricar vidrio y células solares in situ.'),
    L('mars_cl', 'Cloro', 'Composición · Odyssey GRS', 'mineral', 2, '% en peso', 'Indica sales y percloratos: un recurso, pero también un riesgo tóxico para la tripulación.'),
    L('mars_k', 'Potasio', 'Composición · Odyssey GRS', 'mineral', 2, '% en peso', 'Trazador de la historia geológica y nutriente potencial para cultivos.'),
    L('mars_th', 'Torio', 'Composición · Odyssey GRS', 'mineral', 2, 'ppm', 'Elemento radiactivo que traza la composición de la corteza.'),
  ],
};

function lut(stops) {
  const rgb = stops.map((h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16))), out = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * (rgb.length - 1), a = Math.min(rgb.length - 2, Math.floor(t)), f = t - a;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(rgb[a][c] + (rgb[a + 1][c] - rgb[a][c]) * f);
  }
  return out;
}

// Lienzo equirectangular (x=0 ↔ 180°O, y=0 ↔ 90°N). Cada píxel toma la celda que lo contiene; sin dato = transparente.
export function pintarCapa(c, rampa) {
  const W = Math.min(2048, Math.max(720, c.w)), H = W / 2, L = lut(RAMPAS[rampa]);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H), px = img.data;
  const cols = new Int32Array(W); for (let x = 0; x < W; x++) cols[x] = c.col(-180 + ((x + 0.5) / W) * 360);
  for (let y = 0, o = 0; y < H; y++) {
    const i = c.fila(90 - ((y + 0.5) / H) * 180);
    for (let x = 0; x < W; x++, o += 4) {
      const v = c.celda(i, cols[x]); if (v !== v) continue;
      const k = Math.round(c.pos(v) * 255) * 3;
      px[o] = L[k]; px[o + 1] = L[k + 1]; px[o + 2] = L[k + 2]; px[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

// ---------------------------------------------------------------------------
//  Mediciones por emplazamiento y puntuaciones derivadas
//  Cada puntuación es una escala lineal explícita entre dos umbrales (0 → 100), recortada.
// ---------------------------------------------------------------------------
const lin = (v, cero, cien) => Math.round(Math.max(0, Math.min(1, (v - cero) / (cien - cero))) * 100);

const PLAN = {
  moon: {
    medidas: [
      ['elev', 'moon_elev', 'Elevación', U(0, 'm'), 'LOLA'],
      ['pend', 'moon_pendiente', 'Pendiente media', U(1, '°'), 'LOLA'],
      ['rug', 'moon_rugosidad', 'Rugosidad', U(2, 'm'), 'LOLA'],
      ['h', 'moon_h', 'Hidrógeno', U(0, 'ppm'), 'Lunar Prospector'],
      ['feo', 'moon_feo', 'FeO', U(1, '% en peso'), 'Lunar Prospector'],
      ['tmax', 'moon_tmax', 'Temp. máxima diurna', kelvin, 'Diviner'],
      ['tmin', 'moon_tmin', 'Temp. mínima diurna', kelvin, 'Diviner'],
      ['tmed', 'moon_tmedia', 'Temp. media', kelvin, 'Diviner'],
    ],
    metricas: {
      terrain: (m) => m.pend && { v: lin(m.pend.media, 25, 0), de: `Pendiente media LOLA ${nf(m.pend.media, 1)}° · escala 25° → 0, 0° → 100` },
      ice: (m) => m.h && { v: lin(m.h.media, 50, 150), de: `Hidrógeno Lunar Prospector ${nf(m.h.media, 0)} ppm · escala 50 ppm → 0, 150 ppm → 100` },
      thermal: (m) => m.tmax && m.tmin && { v: lin(m.tmax.media - m.tmin.media, 300, 0),
        de: `Oscilación diurna Diviner ${nf(m.tmax.media - m.tmin.media, 0)} K · escala 300 K → 0, 0 K → 100` },
      resources: (m) => m.feo && { v: lin(m.feo.media, 4, 20), de: `FeO Lunar Prospector ${nf(m.feo.media, 1)} % · escala 4 % → 0, 20 % → 100` },
    },
  },
  mars: {
    medidas: [
      ['elev', 'mars_elev', 'Elevación', U(0, 'm'), 'MOLA'],
      ['pend', 'mars_elev', 'Pendiente regional', U(1, '°'), 'MOLA · base 15 km', 'pendiente'],
      ['h2o', 'mars_h2o', 'Agua equivalente (1 m)', U(1, '% en peso'), 'Odyssey GRS'],
      ['inercia', 'mars_inercia', 'Inercia térmica', U(0, 'J m⁻² K⁻¹ s⁻½'), 'TES'],
      ['fe', 'mars_fe', 'Hierro', U(1, '% en peso'), 'Odyssey GRS'],
      ['si', 'mars_si', 'Silicio', U(1, '% en peso'), 'Odyssey GRS'],
      ['k', 'mars_k', 'Potasio', U(2, '% en peso'), 'Odyssey GRS'],
      ['th', 'mars_th', 'Torio', U(2, 'ppm'), 'Odyssey GRS'],
    ],
    metricas: {
      terrain: (m) => m.pend && { v: lin(m.pend.media, 5, 0), de: `Pendiente regional MOLA ${nf(m.pend.media, 1)}° · escala 5° → 0, 0° → 100` },
      ice: (m) => m.h2o && { v: lin(m.h2o.media, 2, 7), de: `Agua equivalente GRS ${nf(m.h2o.media, 1)} % · escala 2 % → 0, 7 % → 100` },
      thermal: (m) => m.inercia && { v: lin(m.inercia.media, 50, 400), de: `Inercia térmica TES ${nf(m.inercia.media, 0)} · escala 50 → 0, 400 → 100 (más inercia = menos oscilación día-noche)` },
      resources: (m) => m.fe && { v: lin(m.fe.media, 11, 18), de: `Hierro GRS ${nf(m.fe.media, 1)} % · escala 11 % → 0, 18 % → 100` },
    },
  },
};

export const CAPAS_ANALISIS = Object.fromEntries(Object.entries(PLAN).map(([b, p]) => [b, [...new Set(p.medidas.map((x) => x[1]))]]));

// → { [site.id]: { medidas: [{ nombre, texto, rango, fuente }], metricas: { terrain: { v, de }, … } } }
export async function medirSitios(body, sitios) {
  const plan = PLAN[body], ids = CAPAS_ANALISIS[body];
  const cargadas = await Promise.allSettled(ids.map(capa)), capas = {};
  cargadas.forEach((r, i) => { if (r.status === 'fulfilled') capas[ids[i]] = r.value; else console.warn('Capa no disponible', ids[i], r.reason); });
  if (!Object.keys(capas).length) throw new Error('Ninguna capa disponible');
  const out = {};
  for (const s of sitios) {
    const m = {}, medidas = [];
    for (const [clave, id, nombre, fmt, fuente, modo] of plan.medidas) {
      const c = capas[id]; if (!c) continue;
      const z = modo === 'pendiente' ? c.pendiente(s.lat, s.lon, RADIO_KM[body]) : c.zona(s.lat, s.lon);
      m[clave] = z;
      medidas.push({ nombre, fuente, texto: z ? fmt(z.media) : 'Sin dato',
        rango: z && z.n > 1 && !modo ? `${fmt(z.min)} … ${fmt(z.max)}` : z && modo ? `máx. ${fmt(z.max)}` : z?.unica ? `celda de ${c.meta.resolucion.split(' (')[0]}` : '' });
    }
    const metricas = {};
    for (const [k, f] of Object.entries(plan.metricas)) { const r = f(m); if (r) metricas[k] = r; }
    out[s.id] = { medidas, metricas };
  }
  return out;
}
