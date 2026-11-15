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
    // media ponderada por área: cada celda pesa cos(latitud). Junto a los polos las filas más cercanas al polo tienen
    // muchas más celdas por km² y, sin ponderar, dominarían la media.
    let n = 0, sum = 0, peso = 0, min = Infinity, max = -Infinity;
    this.cadaCelda(lat, lon, r, (i, j, la) => { const v = this.celda(i, j); if (v === v) { const w = Math.cos(la * DEG); n++; sum += v * w; peso += w; if (v < min) min = v; if (v > max) max = v; } });
    if (n && peso > 0) return { media: sum / peso, min, max, n };
    const v = this.en(lat, lon);
    return v === v ? { media: v, min: v, max: v, n: 1, unica: true } : null;
  }

  // pendiente media (°) calculada por diferencias centrales sobre una capa de elevación en metros
  pendiente(lat, lon, radioKm, r = RADIO_ZONA) {
    const m = this.meta, dy = 2 * Math.abs(m.dlat) * DEG * radioKm * 1000;
    let n = 0, sum = 0, peso = 0, max = 0;
    this.cadaCelda(lat, lon, r, (i, j, la) => {
      if (i < 1 || i > this.n - 2) return;
      const dx = 2 * Math.abs(m.dlon) * DEG * radioKm * 1000 * Math.cos(la * DEG);
      const gx = (this.celda(i, (j + 1) % this.w) - this.celda(i, (j + this.w - 1) % this.w)) / dx;
      const gy = (this.celda(i - 1, j) - this.celda(i + 1, j)) / dy;
      const p = Math.atan(Math.hypot(gx, gy)) / DEG;
      if (p === p) { const w = Math.cos(la * DEG); n++; sum += p * w; peso += w; if (p > max) max = p; }   // ponderada por área, como zona()
    });
    return n && peso > 0 ? { media: sum / peso, min: 0, max, n } : null;
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

  // Solo para la vista, en productos publicados en bloques mayores que la celda (p. ej. neutrones de Odyssey: bloques de
  // igual área de 2° de latitud, repetidos en la rejilla de 0,5°). El tamaño de bloque se mide en los datos (mediana de
  // las rachas de valores iguales en cada fila y en las columnas) y se aplica un filtro de caja de ese tamaño: sobre
  // datos escalonados equivale a interpolar linealmente entre los centros de los bloques. Celdas sin dato no cuentan.
  suavizadoBloques() {
    if (this._suave) return this._suave;
    const n = this.n, w = this.w, src = new Float32Array(n * w), out = new Float32Array(n * w);
    for (let i = 0; i < n; i++) for (let j = 0; j < w; j++) src[i * w + j] = this.celda(i, j);
    const racha = (get, len) => {                                     // mediana de las rachas de valores iguales
      const rs = []; let r = 1;
      for (let k = 1; k < len; k++) { const a = get(k), b = get(k - 1); if (a === b || (a !== a && b !== b)) r++; else { rs.push(r); r = 1; } }
      rs.push(r); rs.sort((x, y) => x - y); return Math.max(1, rs[rs.length >> 1]);
    };
    const tmp = new Float32Array(n * w);
    for (let i = 0; i < n; i++) {                                     // a lo largo de la longitud (cíclico)
      const k = racha((j) => src[i * w + j], w), h = k / 2;
      for (let j = 0; j < w; j++) {
        let s = 0, ws = 0;
        for (let d = -Math.floor(h); d <= Math.floor(h); d++) {
          const wt = Math.abs(d) <= h - 0.5 ? 1 : h - Math.abs(d) + 0.5; // bordes fraccionarios para rachas pares
          const v = src[i * w + (((j + d) % w) + w) % w]; if (v === v && wt > 0) { s += v * wt; ws += wt; }
        }
        tmp[i * w + j] = ws ? s / ws : NaN;
      }
    }
    const kc = racha((i) => src[i * w + (w >> 1)], n), hc = kc / 2;   // a lo largo de la latitud
    for (let i = 0; i < n; i++) for (let j = 0; j < w; j++) {
      if (src[i * w + j] !== src[i * w + j]) { out[i * w + j] = NaN; continue; }
      let s = 0, ws = 0;
      for (let d = -Math.floor(hc); d <= Math.floor(hc); d++) {
        const ii = i + d; if (ii < 0 || ii >= n) continue;
        const wt = Math.abs(d) <= hc - 0.5 ? 1 : hc - Math.abs(d) + 0.5;
        const v = tmp[ii * w + j]; if (v === v && wt > 0) { s += v * wt; ws += wt; }
      }
      out[i * w + j] = ws ? s / ws : NaN;
    }
    return (this._suave = out);
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
const nf = (v, d = 0) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
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
const L = (id, corto, grupo, rampa, dec, unidad, por, enKelvin = false, extra = {}) => ({ id, corto, grupo, rampa, unidad, por, ...extra,
  tick: (v) => nf(v, dec), fmt: enKelvin ? kelvin : U(dec, unidad), breve: U(dec, unidad.length > 9 ? '' : unidad.replace('wt ', '')) });

export const CAPAS_GLOBO = {
  moon: [
    L('moon_elev', 'Elevation', 'Relief · LOLA', 'relieve', 0, 'm', 'Terrain height relative to a 1737.4 km sphere. Deep basins and high rims affect light, the Earth link and access routes.'),
    L('moon_pendiente', 'Slope', 'Relief · LOLA', 'relieve', 1, '°', 'The lower the slope, the safer it is to land, drive and build.'),
    L('moon_rugosidad', 'Roughness', 'Relief · LOLA', 'relieve', 2, 'm', 'Ground irregularity at the meter scale: it affects landing and rovers.'),
    L('moon_tmax', 'Maximum', 'Temperature · Diviner', 'calor', 0, 'K', 'Peak heat of the lunar day: it sets the cooling load of the base.', true),
    L('moon_tmin', 'Minimum', 'Temperature · Diviner', 'calor', 0, 'K', 'Cold of the lunar night. Where ~110 K is never exceeded, water ice can survive.', true),
    L('moon_tmedia', 'Mean', 'Temperature · Diviner', 'calor', 0, 'K', 'Mean temperature over the day-night cycle: a guide to that of the shallow subsurface.', true),
    L('moon_h', 'Hydrogen', 'Composition · Lunar Prospector', 'agua', 0, 'ppm', 'Hydrogen in the top meter of soil: the best orbital indicator of water ice (maxima at the poles).'),
    L('moon_feo', 'FeO', 'Composition · Lunar Prospector', 'mineral', 1, 'wt %', 'Iron in the regolith: FeO-rich basaltic maria are better for extracting oxygen and metals.'),
  ],
  mars: [
    L('mars_elev', 'Elevation', 'Relief · MOLA', 'relieve', 0, 'm', 'Height above the areoid. The lower the site, the more atmosphere above it to slow the landing and attenuate radiation.'),
    L('mars_inercia', 'Thermal inertia', 'Soil · TES', 'calor', 0, 'J m⁻² K⁻¹ s⁻½', 'Low = loose dust; high = rock or compact soil, with smaller temperature swings between day and night.'),
    L('mars_h2o', 'Water (H₂O)', 'Composition · Odyssey GRS', 'agua', 1, 'wt %', 'Water equivalent in the top meter (ice or hydrated minerals), between ~57°S and ~57°N.', false, { nodata: 'Poles: the Odyssey GRS team publishes no data (ice dilutes the signal). Shown as an APPROXIMATION, flagged in the legend and the cursor readout.', aprox: 'mars_h2o_aprox' }),
    L('mars_neutrones', 'Hydrogen (neutrons)', 'Composition · Odyssey GRS', 'agua', 1, 'counts/s', 'Epithermal neutron flux: the FEWER neutrons, the MORE hydrogen (ice) in the top meter. Covers the poles. Inverted scale: light = more hydrogen.', false,
      { invertir: true, bloques: true, nodata: 'No data only in the last half degree around each pole. On the north cap, CO₂ frost from the winter of 2002 masks part of the signal.' }),
    L('mars_fe', 'Iron', 'Composition · Odyssey GRS', 'mineral', 1, 'wt %', 'Raw material for steel and in-situ construction.', false, { nodata: 'Poles: the Odyssey GRS team publishes no data (ice dilutes the signal). Shown as an APPROXIMATION, flagged in the legend and the cursor readout.', aprox: 'mars_fe_aprox' }),
    L('mars_si', 'Silicon', 'Composition · Odyssey GRS', 'mineral', 1, 'wt %', 'Feedstock for making glass and solar cells in situ.', false, { nodata: 'Poles: the Odyssey GRS team publishes no data (ice dilutes the signal). Shown as an APPROXIMATION, flagged in the legend and the cursor readout.', aprox: 'mars_si_aprox' }),
    L('mars_cl', 'Chlorine', 'Composition · Odyssey GRS', 'mineral', 2, 'wt %', 'Indicates salts and perchlorates: a resource, but also a toxic hazard for the crew.', false, { nodata: 'Poles: the Odyssey GRS team publishes no data (ice dilutes the signal). Shown as an APPROXIMATION, flagged in the legend and the cursor readout.', aprox: 'mars_cl_aprox' }),
    L('mars_k', 'Potassium', 'Composition · Odyssey GRS', 'mineral', 2, 'wt %', 'A tracer of geological history and a potential nutrient for crops.'),
    L('mars_th', 'Thorium', 'Composition · Odyssey GRS', 'mineral', 2, 'ppm', 'A radioactive element that traces crustal composition.'),
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

// Lienzo equirectangular (x=0 ↔ 180°O, y=0 ↔ 90°N) para proyectar sobre el globo.
// - Rejillas finas (celda ≤ ~1,5 píxeles): cada píxel toma la celda que lo contiene.
// - Rejillas gruesas (p. ej. Odyssey GRS, 5°): SOLO PARA LA VISTA se interpola bilinealmente entre los centros de
//   las celdas con dato (pesos renormalizados, sin extrapolar más allá de media celda), para no ver bloques. El valor
//   que se lee con el cursor y en los emplazamientos sigue siendo el de la celda publicada.
// - Sin dato: rayado diagonal (para distinguirlo de un valor bajo).
// - invertir: la rampa se recorre al revés (p. ej. neutrones: menos flujo = más hidrógeno = más claro).
export function pintarCapa(c, rampa, { invertir = false, bloques = false, aprox = null } = {}) {
  const W = Math.min(2048, Math.max(720, c.w)), H = W / 2, L = lut(RAMPAS[rampa]), m = c.meta;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H), px = img.data;
  const suave = Math.abs(m.dlon) > 1.5 * (360 / W);
  const color = (o, v, a) => {
    let k = Math.round(c.pos(v) * 255); if (invertir) k = 255 - k; k *= 3;
    px[o] = L[k]; px[o + 1] = L[k + 1]; px[o + 2] = L[k + 2]; px[o + 3] = a;
  };
  // rayas a lo largo de los paralelos: sobre el globo son círculos alrededor del polo (no un abanico)
  const raya = (o, x, y) => { if (y % 8 < 2) { px[o] = 170; px[o + 1] = 178; px[o + 2] = 196; px[o + 3] = 150; } };
  if (!suave) {
    const cols = new Int32Array(W); for (let x = 0; x < W; x++) cols[x] = c.col(-180 + ((x + 0.5) / W) * 360);
    const sv = bloques ? c.suavizadoBloques() : null;
    for (let y = 0, o = 0; y < H; y++) {
      const i = c.fila(90 - ((y + 0.5) / H) * 180);
      for (let x = 0; x < W; x++, o += 4) {
        const v = sv ? sv[i * c.w + cols[x]] : c.celda(i, cols[x]);
        if (v === v) color(o, v, 255); else raya(o, x, y);
      }
    }
  } else {
    // índices fraccionarios de fila/columna de cada píxel respecto a los centros de celda
    const fx = new Float64Array(W); for (let x = 0; x < W; x++) fx[x] = (-180 + ((x + 0.5) / W) * 360 - m.lon_centro_0) / m.dlon;
    for (let y = 0, o = 0; y < H; y++) {
      const fy = (90 - ((y + 0.5) / H) * 180 - m.lat_centro_0) / m.dlat;
      const i0 = Math.floor(fy), ty = fy - i0;
      for (let x = 0; x < W; x++, o += 4) {
        const j0 = Math.floor(fx[x]), tx = fx[x] - j0;
        let s = 0, wsum = 0;
        for (let di = 0; di < 2; di++) {
          const i = i0 + di; if (i < 0 || i >= c.n) continue;                 // sin extrapolar más allá de la primera/última fila
          const wy = di ? ty : 1 - ty;
          for (let dj = 0; dj < 2; dj++) {
            const j = (((j0 + dj) % c.w) + c.w) % c.w, w = wy * (dj ? tx : 1 - tx);
            let v = c.celda(i, j);
            if (v !== v && aprox) v = aprox.celda(i, j);
            if (v === v && w > 0) { s += v * w; wsum += w; }
          }
        }
        // cobertura < 0,5 = más cerca de una celda sin dato que de una con dato
        if (wsum >= 0.5 || (i0 < 0 && wsum > 0) || (i0 >= c.n - 1 && wsum > 0)) color(o, s / wsum, 255);
        else raya(o, x, y);
      }
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
      ['elev', 'moon_elev', 'Elevation', U(0, 'm'), 'LOLA'],
      ['pend', 'moon_pendiente', 'Mean slope', U(1, '°'), 'LOLA'],
      ['rug', 'moon_rugosidad', 'Roughness', U(2, 'm'), 'LOLA'],
      ['h', 'moon_h', 'Hydrogen', U(0, 'ppm'), 'Lunar Prospector'],
      ['feo', 'moon_feo', 'FeO', U(1, 'wt %'), 'Lunar Prospector'],
      ['tmax', 'moon_tmax', 'Max. daily temp.', kelvin, 'Diviner'],
      ['tmin', 'moon_tmin', 'Min. daily temp.', kelvin, 'Diviner'],
      ['tmed', 'moon_tmedia', 'Mean temp.', kelvin, 'Diviner'],
    ],
    metricas: {
      terrain: (m) => m.pend && { v: lin(m.pend.media, 25, 0), de: `LOLA mean slope ${nf(m.pend.media, 1)}° · scale 25° → 0, 0° → 100` },
      ice: (m) => m.h && { v: lin(m.h.media, 50, 150), de: `Lunar Prospector hydrogen ${nf(m.h.media, 0)} ppm · scale 50 ppm → 0, 150 ppm → 100` },
      thermal: (m) => m.tmax && m.tmin && { v: lin(m.tmax.media - m.tmin.media, 300, 0),
        de: `Diviner day-night swing ${nf(m.tmax.media - m.tmin.media, 0)} K · scale 300 K → 0, 0 K → 100` },
      resources: (m) => m.feo && { v: lin(m.feo.media, 4, 20), de: `Lunar Prospector FeO ${nf(m.feo.media, 1)} % · scale 4 % → 0, 20 % → 100` },
    },
  },
  mars: {
    medidas: [
      ['elev', 'mars_elev', 'Elevation', U(0, 'm'), 'MOLA'],
      ['pend', 'mars_elev', 'Regional slope', U(1, '°'), 'MOLA · 15 km baseline', 'pendiente'],
      ['h2o', 'mars_h2o', 'Water equivalent (1 m)', U(1, 'wt %'), 'Odyssey GRS'],
      ['inercia', 'mars_inercia', 'Thermal inertia', U(0, 'J m⁻² K⁻¹ s⁻½'), 'TES'],
      ['fe', 'mars_fe', 'Iron', U(1, 'wt %'), 'Odyssey GRS'],
      ['si', 'mars_si', 'Silicon', U(1, 'wt %'), 'Odyssey GRS'],
      ['k', 'mars_k', 'Potassium', U(2, 'wt %'), 'Odyssey GRS'],
      ['th', 'mars_th', 'Thorium', U(2, 'ppm'), 'Odyssey GRS'],
    ],
    metricas: {
      terrain: (m) => m.pend && { v: lin(m.pend.media, 5, 0), de: `MOLA regional slope ${nf(m.pend.media, 1)}° · scale 5° → 0, 0° → 100` },
      ice: (m) => m.h2o && { v: lin(m.h2o.media, 2, 7), de: `GRS water equivalent ${nf(m.h2o.media, 1)} % · scale 2 % → 0, 7 % → 100` },
      thermal: (m) => m.inercia && { v: lin(m.inercia.media, 50, 400), de: `TES thermal inertia ${nf(m.inercia.media, 0)} · scale 50 → 0, 400 → 100 (more inertia = smaller day-night swing)` },
      resources: (m) => m.fe && { v: lin(m.fe.media, 11, 18), de: `GRS iron ${nf(m.fe.media, 1)} % · scale 11 % → 0, 18 % → 100` },
    },
  },
};

export const CAPAS_ANALISIS = Object.fromEntries(Object.entries(PLAN).map(([b, p]) => [b, [...new Set(p.medidas.map((x) => x[1]))]]));

// → { [site.id]: { medidas: [{ nombre, texto, rango, fuente, cita }], metricas: { terrain: { v, de }, … } } }
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
      // capa / valor / derivada: para situar la medición en la distribución de la superficie (js/analitica.js, js/graficos/)
      medidas.push({ nombre, fuente, cita: c.meta.fuente?.cita, capa: id, valor: z ? z.media : null, derivada: modo ?? null, texto: z ? fmt(z.media) : 'No data',
        rango: z && z.n > 1 && !modo ? `${fmt(z.min)} … ${fmt(z.max)}` : z && modo ? `max. ${fmt(z.max)}` : z?.unica ? `${c.meta.resolucion.split(' (')[0]} cell` : '' });
    }
    const metricas = {};
    for (const [k, f] of Object.entries(plan.metricas)) { const r = f(m); if (r) metricas[k] = r; }
    out[s.id] = { medidas, metricas };
  }
  return out;
}
