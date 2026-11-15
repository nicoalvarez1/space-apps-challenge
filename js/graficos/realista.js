// ============================================================================
//  VISTA «REALISTA» DE UNA VENTANA LOCAL  (mapas del entrenamiento: js/graficos/analogo.js y tierra-cara.js)
//
//  Color de la imagen real que ya usa el globo (assets/textures/, manifest.json; misma carga que js/scene.js):
//    Tierra = earth_color_*.jpg (Blue Marble NG, equirrectangular, con su versión de batimetría sobre el océano)
//    Luna   = moon_color_*.jpg (LRO LROC WAC)      + casquetes moon_polar_{n,s}_color_*.jpg
//    Marte  = mars_color_*.jpg (Viking MDIM 2.1)   + casquetes mars_polar_{n,s}_color_*.jpg
//  reproyectado a la MISMA ventana que los datos (azimutal equidistante centrada, norte arriba: la geometría de
//  ventana() en js/analitica.js) y modulado por un relieve sombreado suave calculado de la elevación de esa ventana
//  (sombreado() de js/analitica.js, luz del NO). El sombreado es solo una ayuda visual; el color no es un dato medido
//  del relieve. Los casquetes (azimutal equidistante polar desde lat0 = 60°) se usan con |lat| ≥ fade[0] y se funden
//  con el mapa global entre fade[0] y fade[1] (64–68°), con la misma fórmula que el shader de scene.js (_overlayHook).
//
//  Para no leer una imagen de 8K × 4K entera, se recorta con drawImage SOLO el rectángulo de píxeles que cubre la
//  ventana en un lienzo pequeño y se leen sus píxeles con getImageData (caché por imagen y región).
//  Muestreo bilineal en todo (color y sombreado); lienzo a la resolución de pantalla (devicePixelRatio, mínimo 2×).
// ============================================================================
import { sombreado } from '../analitica.js';

const DEG = Math.PI / 180;
const DIR = 'assets/textures/';
const MAX_N = 720;                                              // lado máximo del lienzo (rendimiento: < ~100 ms)

let manifiestoP = null;
export const manifiesto = () => (manifiestoP ??= fetch(DIR + 'manifest.json')
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`manifest.json ${r.status}`))))
  .catch((e) => { manifiestoP = null; throw e; }));

// Misma regla que scene.js → _detectQuality, sin el límite de texturas de WebGL (aquí no hay GPU de por medio)
function calidadPreferida() {
  const q = new URLSearchParams(location.search).get('q');
  if (q === 'hi' || q === 'lo') return q;
  const movil = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  return !movil && (navigator.deviceMemory ?? 8) >= 4 ? 'hi' : 'lo';
}

const imagenes = new Map();                                     // archivo → Promise<HTMLImageElement>
function imagen(archivo) {
  if (!imagenes.has(archivo)) {
    const p = new Promise((ok, mal) => {
      const im = new Image();
      im.decoding = 'async';
      im.onload = () => ok(im);
      im.onerror = () => mal(new Error(`${archivo} no se pudo cargar`));
      im.src = DIR + archivo;
    });
    p.catch(() => imagenes.delete(archivo));
    imagenes.set(archivo, p);
  }
  return imagenes.get(archivo);
}

// Recorte [x0, x1) × [y0, y1) de la imagen (x puede salirse por los lados: el mapa global se repite en longitud)
const recortes = new Map();                                     // clave → { w, h, d }
function recorte(im, archivo, x0, y0, x1, y1, envolver) {
  const clave = `${archivo}|${x0}|${y0}|${x1}|${y1}`;
  if (recortes.has(clave)) { const r = recortes.get(clave); recortes.delete(clave); recortes.set(clave, r); return r; }
  const W = im.naturalWidth, w = x1 - x0, h = y1 - y0;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d', { willReadFrequently: true });
  if (envolver) {
    for (let k = Math.floor(x0 / W); k * W < x1; k++) {          // trozos [a, b) dentro de la copia k-ésima del mapa
      const a = Math.max(x0, k * W), b = Math.min(x1, (k + 1) * W);
      if (b > a) c.drawImage(im, a - k * W, y0, b - a, h, a - x0, 0, b - a, h);
    }
  } else c.drawImage(im, x0, y0, w, h, 0, 0, w, h);
  const r = { w, h, d: c.getImageData(0, 0, w, h).data };
  recortes.set(clave, r);
  while (recortes.size > 16) recortes.delete(recortes.keys().next().value);
  return r;
}

// Bilineal sobre un recorte RGBA; (fx, fy) en píxeles del recorte (centro del píxel 0 = 0). Escribe en out[0..2].
function muestraRGB(r, fx, fy, out) {
  const x0 = Math.max(0, Math.min(r.w - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(r.h - 1, Math.floor(fy)));
  const x1 = Math.min(r.w - 1, x0 + 1), y1 = Math.min(r.h - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0)), d = r.d;
  const a = 4 * (y0 * r.w + x0), b = 4 * (y0 * r.w + x1), c = 4 * (y1 * r.w + x0), e = 4 * (y1 * r.w + x1);
  for (let k = 0; k < 3; k++) {
    const s = d[a + k] + (d[b + k] - d[a + k]) * tx, t = d[c + k] + (d[e + k] - d[c + k]) * tx;
    out[k] = s + (t - s) * ty;
  }
}

// Bilineal sobre una rejilla n × n (fila 0 al norte) en la fracción (u, v) ∈ [0, 1] de la ventana
function muestraRejilla(g, n, u, v) {
  const fx = Math.max(0, Math.min(n - 1, u * n - 0.5)), fy = Math.max(0, Math.min(n - 1, v * n - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(n - 1, x0 + 1), y1 = Math.min(n - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
  const s = g[y0 * n + x0] + (g[y0 * n + x1] - g[y0 * n + x0]) * tx, t = g[y1 * n + x0] + (g[y1 * n + x1] - g[y1 * n + x0]) * tx;
  return s + (t - s) * ty;
}

const suave = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Lado del lienzo: resolución de pantalla (devicePixelRatio), al menos 2× el tamaño CSS
export function ladoLienzo(cv) {
  const css = cv.getBoundingClientRect().width || cv.parentElement?.getBoundingClientRect().width || 300;
  return Math.max(256, Math.min(MAX_N, Math.round(css * Math.max(2, devicePixelRatio || 1))));
}

// Nombre corto del mosaico desde los créditos del manifiesto («Agencia · Mosaico · …»)
const nombreMosaico = (man, body) => {
  const p = (man.credits?.[body] ?? '').split(' · ');
  return { agencia: p[0] ?? 'NASA', nombre: p[1] ?? 'color mosaic' };
};

// Pinta la vista realista.
// o = { body: 'moon' | 'mars' | 'earth', lat, lon (centro), Rkm (radio de la proyección), ladoKm,
//       elev: { n, v: Float32Array (m, NaN sin dato, fila 0 al norte) }, exageracion, lado (px; por defecto ladoLienzo) }
// → { nombre, agencia, archivo, kmPx (píxel del mosaico usado, en el ecuador), polar (se usó un casquete), ms }
export async function pintarRealista(cv, o) {
  const t0 = performance.now();
  const man = await manifiesto(), m = man[o.body];
  if (!m) throw new Error(`sin texturas para ${o.body}`);
  const N = o.lado ?? ladoLienzo(cv), R = o.Rkm, semi = o.ladoKm / 2, kmOut = o.ladoKm / N;
  const pol = m.polar, f0 = pol?.fade?.[0] ?? 90, f1 = pol?.fade?.[1] ?? 90, cap = 90 - (pol?.lat0 ?? 60);

  // ---- 1) lat y longitud (relativa al centro) de cada píxel del lienzo: inversa azimutal equidistante ----
  const LA = new Float32Array(N * N), DL = new Float32Array(N * N);
  const sf0 = Math.sin(o.lat * DEG), cf0 = Math.cos(o.lat * DEG);
  let eq = null;                                                // { la0, la1, dl0, dl1 } de los píxeles que usan el mapa global
  const caja = { n: null, s: null };                            // { x0, x1, v0, v1 } de los píxeles de cada casquete
  for (let py = 0, k = 0; py < N; py++) {
    const y = semi - (py + 0.5) * kmOut;
    for (let px = 0; px < N; px++, k++) {
      const x = (px + 0.5) * kmOut - semi, rho = Math.hypot(x, y), d = rho / R, sd = Math.sin(d), cd = Math.cos(d);
      const ca = rho > 0 ? y / rho : 1, sa = rho > 0 ? x / rho : 0;
      const s2 = Math.max(-1, Math.min(1, sf0 * cd + cf0 * sd * ca));
      const la = Math.asin(s2) / DEG, dl = Math.atan2(sa * sd * cf0, cd - sf0 * s2) / DEG;
      LA[k] = la; DL[k] = dl;
      const w = pol ? suave(f0, f1, Math.abs(la)) : 0;
      if (w < 1) {
        if (!eq) eq = { la0: la, la1: la, dl0: dl, dl1: dl };
        else { if (la < eq.la0) eq.la0 = la; if (la > eq.la1) eq.la1 = la; if (dl < eq.dl0) eq.dl0 = dl; if (dl > eq.dl1) eq.dl1 = dl; }
      }
      if (w > 0) {
        const lado = la >= 0 ? 'n' : 's', [X, V] = coordPolar(la, o.lon + dl, cap);
        const b = caja[lado];
        if (!b) caja[lado] = { x0: X, x1: X, v0: V, v1: V };
        else { if (X < b.x0) b.x0 = X; if (X > b.x1) b.x1 = X; if (V < b.v0) b.v0 = V; if (V > b.v1) b.v1 = V; }
      }
    }
  }

  // ---- 2) calidad: «lo» si su píxel ya es más fino que el del lienzo; si no, «hi» (salvo móvil / poca memoria) ----
  const circ = 2 * Math.PI * R;
  const anchoLo = man[o.body]?.lo ? 4096 : 0;                   // tamaños de build_textures.py: lo 4096 × 2048, hi 8192 × 4096
  const q = calidadPreferida() === 'lo' || (anchoLo && circ / anchoLo <= kmOut) ? 'lo' : 'hi';
  const archivo = m[q]?.color ?? m.hi?.color ?? m.lo?.color;

  // ---- 3) recortes de las imágenes ----
  let reEq = null, gEq = null;
  if (eq) {
    const im = await imagen(archivo), W = im.naturalWidth, H = im.naturalHeight;
    const Xf = (dl) => ((o.lon + dl + 180) / 360) * W - 0.5, Yf = (la) => ((90 - la) / 180) * H - 0.5;
    let x0 = Math.floor(Xf(eq.dl0)) - 1, x1 = Math.ceil(Xf(eq.dl1)) + 2;
    const y0 = Math.max(0, Math.floor(Yf(eq.la1)) - 1), y1 = Math.min(H, Math.ceil(Yf(eq.la0)) + 2);
    const todo = x1 - x0 >= W;
    if (todo) { x0 = 0; x1 = W; }
    reEq = recorte(im, archivo, x0, y0, x1, y1, !todo);
    gEq = { W, H, x0, y0, todo, kmPx: circ / W };
  }
  const reP = {}, gP = {};
  for (const lado of ['n', 's']) {
    const b = caja[lado], ap = pol?.[q]?.[lado]?.color ?? pol?.hi?.[lado]?.color;
    if (!b || !ap) continue;
    const im = await imagen(ap), P = im.naturalWidth;
    const col = (X) => ((X + 1) / 2) * P - 0.5, fil = (V) => ((1 - V) / 2) * P - 0.5;
    const x0 = Math.max(0, Math.floor(col(b.x0)) - 1), x1 = Math.min(P, Math.ceil(col(b.x1)) + 2);
    const y0 = Math.max(0, Math.floor(fil(b.v1)) - 1), y1 = Math.min(P, Math.ceil(fil(b.v0)) + 2);
    reP[lado] = recorte(im, ap, x0, y0, x1, y1, false);
    gP[lado] = { P, x0, y0 };
  }

  // ---- 4) relieve sombreado de los datos (rejilla n × n), interpolado bilinealmente ----
  const { n, v } = o.elev, luz = sombreado({ n, km: o.ladoKm / n, v }, o.exageracion > 0 ? o.exageracion : 1);

  // ---- 5) composición ----
  cv.width = N; cv.height = N;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(N, N), px = img.data;
  const cE = [0, 0, 0], cP = [0, 0, 0];
  for (let py = 0, k = 0; py < N; py++) {
    const vv = (py + 0.5) / N;
    for (let pxi = 0; pxi < N; pxi++, k++) {
      const la = LA[k], dl = DL[k], w = pol ? suave(f0, f1, Math.abs(la)) : 0;
      if (w < 1) {
        let X = ((o.lon + dl + 180) / 360) * gEq.W - 0.5 - gEq.x0;
        if (gEq.todo) X = ((X % gEq.W) + gEq.W) % gEq.W;
        muestraRGB(reEq, X, ((90 - la) / 180) * gEq.H - 0.5 - gEq.y0, cE);
      }
      if (w > 0) {
        const lado = la >= 0 ? 'n' : 's', g = gP[lado], r = reP[lado];
        if (g) {
          const [X, V] = coordPolar(la, o.lon + dl, cap);
          muestraRGB(r, ((X + 1) / 2) * g.P - 0.5 - g.x0, ((1 - V) / 2) * g.P - 0.5 - g.y0, cP);
        } else { cP[0] = cE[0]; cP[1] = cE[1]; cP[2] = cE[2]; }
      }
      const s = muestraRejilla(luz, n, (pxi + 0.5) / N, vv), f = 0.4 + 0.85 * s;   // llano (0,707) ≈ ×1: conserva el color real
      const q4 = 4 * k;
      for (let c = 0; c < 3; c++) {
        const base = w <= 0 ? cE[c] : w >= 1 ? cP[c] : cE[c] + (cP[c] - cE[c]) * w;
        px[q4 + c] = Math.max(0, Math.min(255, base * f + 60 * (f - 1)));   // término aditivo: el relieve se lee también en mares oscuros
      }
      px[q4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const nom = nombreMosaico(man, o.body);
  return { ...nom, archivo, kmPx: circ / (q === 'lo' ? 4096 : 8192), polar: !!(caja.n || caja.s), ms: performance.now() - t0 };
}

// Casquete polar: u = 0,5 + 0,5·ρ·sen λ ; v = 0,5 ∓ 0,5·ρ·cos λ (− norte, + sur), ρ = colatitud / cap (scene.js).
// Devuelve (X, V) = (2u − 1, 2v − 1), con la fila 0 de la imagen en V = 1 (tools/build_textures.py → polar_grid).
function coordPolar(la, lon, cap) {
  const rho = (90 - Math.abs(la)) / cap, l = lon * DEG, s = rho * Math.sin(l), c = rho * Math.cos(l);
  return [s, la >= 0 ? -c : c];
}

// Amplía un mapa de datos (lienzo de n × n píxeles, uno por celda) al lienzo visible con interpolación suave del
// navegador: sin pixelado. El dato de cada celda no cambia; la lectura del cursor sigue usando la rejilla.
export function ampliarSuave(cv, origen) {
  const N = ladoLienzo(cv);
  cv.width = N; cv.height = N;
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(origen, 0, 0, N, N);
}

// Vista realista en un lienzo aparte del tamaño del visible (para poder descartarla si entretanto se cambia de vista)
export async function realistaAparte(cv, o) {
  const aparte = document.createElement('canvas');
  const info = await pintarRealista(aparte, { ...o, lado: ladoLienzo(cv) });
  return { aparte, info };
}
export function copiar(cv, origen) {
  cv.width = origen.width; cv.height = origen.height;
  cv.getContext('2d').drawImage(origen, 0, 0);
}

// Texto del pie sobre el mosaico. kmCelda: tamaño de la celda de los datos del mapa (km).
export function pieMosaico(info, kmCelda, cuerpo) {
  const km = (x) => (x >= 10 ? Math.round(x) : x.toFixed(1)).toLocaleString('en-US');
  const grueso = info.kmPx > kmCelda * 1.05
    ? ` That is coarser than the relief grid (${km(kmCelda)} km per cell), so the colors are smoother than the relief.` : '';
  return `<b>Realistic view, ${cuerpo}:</b> colors from the ${info.nombre} (${info.agencia}), the image used on the globe, about ${km(info.kmPx)} km per pixel at the equator${info.polar ? '; near the pole, its polar cap reprojected from the same mosaic' : ''}, reprojected to this window.${grueso}`;
}
