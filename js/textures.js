// Texturas procedurales de respaldo (se usan si no hay modelo .glb de Blender en /assets).
import * as THREE from 'three';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function makeNoise(seed) {
  const r = rng(seed), N = 256, p = new Float32Array(N * N);
  for (let i = 0; i < p.length; i++) p[i] = r();
  const sm = (t) => t * t * (3 - 2 * t);
  const at = (x, y) => p[((y & 255) << 8) | (x & 255)];
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = sm(x - xi), fy = sm(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  // fBm periódico en longitud usando coordenadas 3D -> aquí aproximado con 2D (la costura se disimula)
  return (x, y, oct = 5) => {
    let v = 0, amp = 0.5, f = 1;
    for (let i = 0; i < oct; i++) { v += amp * noise(x * f, y * f); f *= 2; amp *= 0.5; }
    return v;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

function craters(ctx, w, h, count, seed, strength = 1) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const big = Math.pow(r(), 3.2);
    const rad = 3 + big * 55, x = r() * w, y = r() * h;
    // más pequeños cerca de los polos por la distorsión equirectangular: compensar ancho
    const sx = 1 / Math.max(0.35, Math.cos(((y / h) - 0.5) * Math.PI));
    ctx.save();
    ctx.translate(x, y); ctx.scale(Math.min(sx, 3), 1);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
    g.addColorStop(0, `rgba(0,0,0,${0.45 * strength})`);
    g.addColorStop(0.72, `rgba(0,0,0,${0.25 * strength})`);
    g.addColorStop(0.86, `rgba(255,255,255,${0.5 * strength})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, rad, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

function tex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

function ramp(stops, t) {
  t = Math.min(1, Math.max(0, t));
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i], k = (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return stops[stops.length - 1][1];
}

function planetTexture(W, H, seed, stops, scale, contrast) {
  const noise = makeNoise(seed), c = canvas(W, H), ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const n = noise((x / W) * scale, (y / H) * scale * 0.5);
    const [r, g, b] = ramp(stops, (n - 0.5) * contrast + 0.5);
    const i = (y * W + x) * 4;
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { c, ctx };
}

export function moonTextures() {
  const W = 1024, H = 512;
  const { c, ctx } = planetTexture(W, H, 7, [[0, [70, 70, 72]], [0.5, [140, 140, 142]], [1, [200, 200, 202]]], 6, 1.6);
  // mares oscuros
  const mare = canvas(W, H), mctx = mare.getContext('2d'), r = rng(3);
  for (let i = 0; i < 9; i++) {
    const x = r() * W, y = H * (0.25 + r() * 0.5), rad = 40 + r() * 70;
    const g = mctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(20,22,28,.55)'); g.addColorStop(1, 'rgba(20,22,28,0)');
    mctx.fillStyle = g; mctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  ctx.drawImage(mare, 0, 0);
  craters(ctx, W, H, 900, 11, 0.7);
  const bump = canvas(W, H), bctx = bump.getContext('2d');
  bctx.fillStyle = '#808080'; bctx.fillRect(0, 0, W, H);
  craters(bctx, W, H, 900, 11, 1);
  return { map: tex(c), bump: tex(bump, false), bumpScale: 0.035 };
}

export function marsTextures() {
  const W = 1024, H = 512;
  const { c, ctx } = planetTexture(W, H, 21,
    [[0, [70, 38, 26]], [0.35, [150, 74, 42]], [0.65, [196, 112, 64]], [1, [226, 160, 104]]], 5, 1.8);
  // zonas oscuras (Syrtis, etc.)
  const r = rng(5);
  for (let i = 0; i < 7; i++) {
    const x = r() * W, y = H * (0.3 + r() * 0.4), rad = 30 + r() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(45,25,20,.5)'); g.addColorStop(1, 'rgba(45,25,20,0)');
    ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  craters(ctx, W, H, 450, 17, 0.5);
  // casquetes polares
  for (const [y0, dir] of [[0, 1], [H, -1]]) {
    const g = ctx.createLinearGradient(0, y0, 0, y0 + dir * H * 0.1);
    g.addColorStop(0, 'rgba(245,245,250,.95)'); g.addColorStop(1, 'rgba(245,245,250,0)');
    ctx.fillStyle = g; ctx.fillRect(0, Math.min(y0, y0 + dir * H * 0.1), W, H * 0.1);
  }
  const bump = canvas(W, H), bctx = bump.getContext('2d');
  bctx.fillStyle = '#808080'; bctx.fillRect(0, 0, W, H);
  craters(bctx, W, H, 450, 17, 1);
  return { map: tex(c), bump: tex(bump, false), bumpScale: 0.03 };
}

export function earthTextures() {
  const W = 1024, H = 512, noise = makeNoise(42), c = canvas(W, H), ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H), clouds = canvas(W, H), cctx = clouds.getContext('2d');
  const cimg = cctx.createImageData(W, H), cn = makeNoise(99);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const lat = Math.abs(y / H - 0.5) * 2;
    const n = noise((x / W) * 4.5, (y / H) * 2.5, 6);
    const i = (y * W + x) * 4;
    let col;
    if (lat > 0.88) col = [235, 240, 248];
    else if (n > 0.52) {
      const e = (n - 0.52) / 0.3;
      col = ramp([[0, [60, 120, 60]], [0.4, [150, 140, 80]], [0.8, [130, 100, 70]], [1, [240, 240, 240]]], e + lat * 0.2);
      if (lat < 0.35 && n > 0.56 && n < 0.62) col = [190, 165, 100]; // desiertos
    } else col = ramp([[0, [6, 25, 70]], [1, [20, 80, 150]]], n / 0.52);
    img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
    const k = Math.max(0, cn((x / W) * 6, (y / H) * 3, 5) - 0.52) * 4;
    cimg.data[i] = cimg.data[i + 1] = cimg.data[i + 2] = 255; cimg.data[i + 3] = Math.min(255, k * 255);
  }
  ctx.putImageData(img, 0, 0); cctx.putImageData(cimg, 0, 0);
  return { map: tex(c), clouds: tex(clouds) };
}
