// Saturno V (Apolo) + CSM + módulo lunar (LM), procedurales y a escala: todas las cotas están en METROS.
// Dimensiones reales (NASA, Saturn V Flight Manual / Apollo Operations Handbook): 110,6 m de alto, 10,1 m de
// diámetro en S-IC y S-II, 6,6 m en el S-IVB, 3,9 m en el módulo de servicio; LM de 7 m de alto y 9,4 m entre patas.
//
// Secuencia de vuelo (la de las misiones lunares, comprimida a la duración de la animación):
//   encendido de los 5 F-1 sujeto a la plataforma → despegue → S-IC → separación (retrocohetes, bola de fuego)
//   → S-II (5 J-2) → suelta del anillo interetapa y de la torre de escape → S-IVB (1.er encendido: órbita de
//   aparcamiento) → 2.º encendido (inyección translunar) → apertura del adaptador SLA → transposición del CSM,
//   acoplamiento con el LM y extracción → crucero → inserción orbital con el motor SPS (tobera hacia delante).
// Rotulación: donde el vehículo real llevaba «UNITED STATES» (S-IC, módulo de servicio, LM) aquí pone «TOP GIT».
import * as THREE from 'three';

// instantes (fracción 0..1 de la animación del viaje) de cada evento
export const EV = { ign: 0.018, lift: 0.05, sic: 0.15, anillo: 0.172, les: 0.182, sii: 0.28, orb: 0.315,
  tli0: 0.43, tli1: 0.5, sla: 0.515, giro0: 0.528, giro1: 0.572, dock: 0.598, ext0: 0.612, ext1: 0.645, loi0: 0.86, loi1: 0.925 };

// cotas (m) sobre la base del S-IC
export const Y = { sic: 42.1, anillo: 47.6, sii: 67.0, cono: 72.8, sivb: 84.8, iu: 85.7, sla: 94.2, sm: 98.1, cm: 101.3, tope: 110.6 };
const R = { s1: 5.03, s4: 3.3, sm: 1.95 };
const ROTULO = 'TOP GIT';

export const sm = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
const tramo = (p, a, b, sube = 0.003, baja = 0.002) => sm(a, a + sube, p) * (1 - sm(b - baja, b, p));
const FUENTE = '"Arial Black", "Helvetica Neue", Helvetica, Arial, sans-serif';

// ---------------------------------------------------------------------------
//  Texturas pintadas en metros sobre el desarrollo de cada pieza
// ---------------------------------------------------------------------------
function lienzo(w, h, pintar, fondo = '#f1f1ec') {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); if (fondo) { g.fillStyle = fondo; g.fillRect(0, 0, w, h); }
  pintar(g, w, h); return c;
}
function tex(c, color = true) {
  const t = new THREE.CanvasTexture(c); if (color) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
// C = perímetro (m), H = altura (m). Coordenadas en metros: x alrededor (u = x / C), y desde la base hacia arriba.
function plano(g, w, h, C, H) {
  g.setTransform(w / C, 0, 0, -h / H, 0, h);
  const P = {
    rect(x0, y0, x1, y1, color) { g.fillStyle = color; g.fillRect(x0, y0, x1 - x0, y1 - y0); },
    // franjas en cuadrantes: u0 = fracción del perímetro donde empieza la primera
    cuadrantes(u0, ancho, y0, y1, color, n = 4) { for (let i = 0; i < n; i++) { const x = (u0 + i / n) * C; P.rect(x, y0, x + ancho * C, y1, color); P.rect(x - C, y0, x - C + ancho * C, y1, color); } },
    letra(ch, x, y, alto, color) {
      g.save(); g.translate(x, y); g.scale(0.01, -0.01); g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.font = `900 ${(alto / 0.72) * 100}px ${FUENTE}`; g.fillText(ch, 0, (alto / 2) * 100); g.restore();
    },
    vertical(txt, x, y0, y1, color) { const n = txt.length, paso = (y1 - y0) / n; [...txt].forEach((ch, i) => ch !== ' ' && P.letra(ch, x, y1 - paso * (i + 0.5), paso * 0.74, color)); },
    horizontal(txt, x, y, alto, color) {
      g.save(); g.translate(x, y); g.scale(0.01, -0.01); g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.font = `900 ${(alto / 0.72) * 100}px ${FUENTE}`; g.letterSpacing = `${alto * 12}px`; g.fillText(txt, 0, (alto / 2) * 100); g.restore();
    },
    bandera(xc, y0, ancho) {                                         // bandera de EE. UU., proporción 10:19
      const alto = (ancho * 10) / 19, f = alto / 13, x0 = xc - ancho / 2;
      for (let i = 0; i < 13; i++) P.rect(x0, y0 + i * f, x0 + ancho, y0 + (i + 1) * f, i % 2 ? '#f4f4f0' : '#b22234');
      const cw = ancho * 0.4, ch = f * 7; P.rect(x0, y0 + alto - ch, x0 + cw, y0 + alto, '#3c3b6e');
      g.fillStyle = '#f4f4f0';
      for (let r = 0; r < 9; r++) for (let c = 0; c < (r % 2 ? 5 : 6); c++) {
        const sx = x0 + (cw / 12) * (2 * c + 1 + (r % 2)), sy = y0 + alto - (ch / 10) * (r + 1);
        g.beginPath(); g.ellipse(sx, sy, f * 0.24, f * 0.24, 0, 0, Math.PI * 2); g.fill();
      }
    },
    linea(y, color, grosor) { P.rect(-1, y - grosor / 2, C + 1, y + grosor / 2, color); },
    hollin(y0, y1, a) { const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, `rgba(38,32,26,${a})`); gr.addColorStop(1, 'rgba(38,32,26,0)'); g.fillStyle = gr; g.fillRect(-1, y0, C + 2, y1 - y0); },
  };
  return P;
}
// relieve: largueros verticales (n por vuelta) en las franjas de altura indicadas
function largueros(w, h, H, tramos, n) {
  return lienzo(w, h, (g) => {
    for (const [y0, y1] of tramos) {
      const a = h - (y1 / H) * h, b = h - (y0 / H) * h;
      for (let i = 0; i < n; i++) { const x = (i / n) * w; g.fillStyle = '#9a9a9a'; g.fillRect(x, a, (w / n) * 0.35, b - a); }
    }
  }, '#808080');
}

// ---------------------------------------------------------------------------
//  Penachos de motor: cono deformable en el shader (se ensancha con la altitud), núcleo brillante,
//  diamantes de choque a nivel del mar, parpadeo turbulento y, en el F-1, la cortina oscura de los gases de la turbina.
// ---------------------------------------------------------------------------
let _halo = null;
function texHalo() {
  if (_halo) return _halo;
  const c = lienzo(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }, null);
  return (_halo = tex(c));
}
export function halo(color, tam) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texHalo(), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
  s.scale.setScalar(tam); s.userData.tam = tam; return s;
}
export function penacho({ r, largo, c0, c1, k = 1, diam = 0, humo = 0 }) {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 28, 40, true); geo.translate(0, -0.5, 0);
  const u = { uK: { value: k }, uOn: { value: 0 }, uOp: { value: 0 }, uExp: { value: 0 }, uT: { value: 0 }, uR: { value: r }, uL: { value: largo },
    uC0: { value: new THREE.Color(c0) }, uC1: { value: new THREE.Color(c1) }, uDiam: { value: diam }, uHumo: { value: humo } };
  const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: `uniform float uR, uL, uExp, uOn; varying float vS; varying vec3 vN; varying vec3 vV;
      void main() {
        float s = -position.y;
        float rad = uR * (0.9 + s * (0.22 + 1.6 * uExp) + uExp * 1.5 * sqrt(s));
        vec3 p = vec3(position.x * rad, -s * uL * (0.35 + 0.65 * uOn) * (1.0 + 0.7 * uExp), position.z * rad);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * vec3(position.x, 0.0, position.z)); vV = normalize(-mv.xyz); vS = s;
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uK, uOn, uOp, uExp, uT, uDiam, uHumo; uniform vec3 uC0, uC1; varying float vS; varying vec3 vN; varying vec3 vV;
      void main() {
        float s = vS;
        float borde = mix(0.3, 1.0, pow(abs(dot(normalize(vN), normalize(vV))), 1.2));
        float a = pow(1.0 - s, 1.4 + uExp * 1.8);
        float choque = 1.0 + uDiam * (1.0 - uExp) * smoothstep(0.5, 0.05, s) * pow(0.5 + 0.5 * cos(s * 52.0 - uT * 3.0), 8.0) * 1.8;
        float turb = 0.82 + 0.18 * sin(uT * 41.0 + s * 23.0) * sin(uT * 27.0 - s * 15.0 + 1.3);
        float humo = 1.0 - uHumo * smoothstep(0.1, 0.0, s) * 0.8;
        vec3 col = mix(uC1, uC0, smoothstep(0.0, 0.6, s));
        float I = a * borde * choque * turb * humo * uK * uOn;
        gl_FragColor = vec4(col * I, clamp(I, 0.0, 1.0) * uOp); }`,
    // uOp = 0: luz pura (vacío); uOp > 0: en la atmósfera la llama tapa el cielo y se ve su color
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  }));
  m.frustumCulled = false; m.userData.u = u; return m;
}

// ---------------------------------------------------------------------------
const mat = (o) => new THREE.MeshStandardMaterial({ roughness: 0.58, metalness: 0.04, side: THREE.DoubleSide, ...o });
const cil = (r0, r1, y0, y1, m, abierto = true, seg = 64) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, y1 - y0, seg, 1, abierto), m); c.position.y = (y0 + y1) / 2; return c; };
// tobera de campana (perfil de Rao aproximado): garganta arriba (y = 0), salida abajo (y = −largo)
function campana(rSalida, largo, m, rGarganta = rSalida * 0.3) {
  const pts = []; for (let i = 0; i <= 20; i++) { const s = i / 20; pts.push(new THREE.Vector2(rGarganta + (rSalida - rGarganta) * Math.pow(s, 0.55), -s * largo)); }
  return new THREE.Mesh(new THREE.LatheGeometry(pts, 40), m);
}
function varilla(a, b, r, m, seg = 8) {
  const d = new THREE.Vector3().subVectors(b, a), c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), seg), m);
  c.position.copy(a).addScaledVector(d, 0.5); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return c;
}

// ---------------------------------------------------------------------------
//  Módulo lunar (LM). Origen en el plano de las patas desplegadas, frente (escotilla y escalera) hacia +z.
// ---------------------------------------------------------------------------
export function crearLM() {
  const lm = new THREE.Group();
  // etapa de descenso: octógono forrado de lámina dorada (Kapton) con paneles negros y plateados
  const C = 8 * 2 * 2.1 * Math.sin(Math.PI / 8), H = 1.65;
  const oro = lienzo(2048, 512, (g, w, h) => {
    const P = plano(g, w, h, C, H);
    for (let i = 0; i < 2600; i++) {                                    // arrugas de la lámina
      const x = Math.random() * C, y = Math.random() * H, s = 0.04 + Math.random() * 0.16, l = Math.random();
      g.fillStyle = l < 0.4 ? 'rgba(255,226,140,0.30)' : l < 0.75 ? 'rgba(120,78,18,0.30)' : 'rgba(255,245,210,0.22)';
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + s, y + s * (Math.random() - 0.5)); g.lineTo(x + s * Math.random(), y + s); g.fill();
    }
    const cara = C / 8;
    P.rect(cara * 1, 0, cara * 2, H * 0.55, '#1b1a18'); P.rect(cara * 5, 0, cara * 6, H * 0.55, '#1b1a18');   // paneles negros (diagonales)
    P.rect(cara * 3, H * 0.62, cara * 4, H, '#b9b9b4'); P.rect(cara * 7, H * 0.62, cara * 8, H, '#b9b9b4');   // paneles plateados
    P.rect(0, 0, C, 0.07, '#1b1a18');
    const xc = cara * 2.5;                                              // cara +x: bandera y rótulo
    P.bandera(xc, H * 0.56, cara * 0.5);
    P.horizontal(ROTULO, xc, H * 0.3, 0.2, '#111111');
  }, '#c6963a');
  const descenso = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, H, 8, 1, false),
    mat({ map: tex(oro), metalness: 0.75, roughness: 0.36, side: THREE.FrontSide }));
  descenso.rotation.y = -Math.PI / 8; descenso.position.y = 1.5 + H / 2; lm.add(descenso);
  const tobera = mat({ color: 0x3a3836, roughness: 0.45, metalness: 0.7 });
  const dps = campana(0.75, 1.0, tobera, 0.3); dps.position.y = 1.5; lm.add(dps);
  const llama = penacho({ r: 0.72, largo: 9, c0: 0xff9a66, c1: 0xfff0e0, k: 0.5 }); llama.position.y = 0.5; lm.add(llama);
  const brillo = halo(0xffc8a0, 2.4); brillo.position.y = 0.45; lm.add(brillo);

  // patas: 4 a 90°, con amortiguador principal, puntales secundarios, plato y sonda de contacto (salvo la delantera)
  const plataM = mat({ color: 0xcfcfc8, roughness: 0.3, metalness: 0.85 }), oroM = mat({ color: 0xd8a640, roughness: 0.35, metalness: 0.9 });
  const bisagras = [];
  for (let i = 0; i < 4; i++) {
    const pata = new THREE.Group(); pata.rotation.y = (i * Math.PI) / 2; lm.add(pata);
    const bis = new THREE.Group(); bis.position.set(0, 2.9, 1.9); pata.add(bis); bisagras.push(bis);
    const pie = new THREE.Vector3(0, -2.84, 2.35);
    bis.add(varilla(new THREE.Vector3(), pie, 0.1, oroM, 10));
    const medio = pie.clone().multiplyScalar(0.56);
    for (const s of [-1, 1]) bis.add(varilla(new THREE.Vector3(s * 0.95, -1.25, -0.2), medio, 0.055, plataM));
    bis.add(varilla(new THREE.Vector3(0, -1.35, -0.25), medio, 0.05, plataM));
    const plato = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.4, 0.14, 24), plataM); plato.position.copy(pie).add(new THREE.Vector3(0, -0.02, 0)); bis.add(plato);
    if (i !== 0) bis.add(varilla(pie.clone().add(new THREE.Vector3(0, -0.05, 0.25)), pie.clone().add(new THREE.Vector3(0, -1.6, 0.4)), 0.02, plataM, 4));
    else for (let k = 0; k < 9; k++) {                                   // escalera de la pata delantera
      const a = pie.clone().multiplyScalar(0.12 + k * 0.09), e = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.035, 0.05), plataM);
      e.position.copy(a).add(new THREE.Vector3(0, 0, 0.12)); bis.add(e);
    }
  }
  // etapa de ascenso: perfil lateral facetado extruido (cabina delante, bahía de equipos detrás)
  const perfil = new THREE.Shape([[1.35, 0], [1.5, 0.95], [1.05, 1.75], [-0.35, 1.9], [-1.35, 1.5], [-1.45, 0.25], [-0.6, -0.05]].map(([z, y]) => new THREE.Vector2(z, y)));
  const gAsc = new THREE.ExtrudeGeometry(perfil, { depth: 2.7, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 });
  gAsc.rotateY(-Math.PI / 2); gAsc.translate(1.35, 3.2, 0);
  const gris = mat({ color: 0x9d9c96, roughness: 0.5, metalness: 0.45 }), negroAsc = mat({ color: 0x222120, roughness: 0.55, metalness: 0.3 });
  const ascenso = new THREE.Mesh(gAsc, gris); lm.add(ascenso);
  const frente = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 0.05), negroAsc); frente.position.set(0, 4.55, 1.37); frente.rotation.x = -0.6; lm.add(frente);
  for (const s of [-1, 1]) {                                            // ventanas triangulares
    const v = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.62 * s, 0), new THREE.Vector2(0.1 * s, 0.52)]);
    const ve = new THREE.Mesh(new THREE.ShapeGeometry(v), mat({ color: 0x0a0c10, roughness: 0.08, metalness: 0.9 }));
    ve.position.set(0.12 * s, 4.2, 1.53); ve.rotation.x = -0.6; lm.add(ve);
  }
  const escotilla = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.82, 0.04), negroAsc); escotilla.position.set(0, 3.62, 1.47); escotilla.rotation.x = -0.15; lm.add(escotilla);
  const porche = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.7), plataM); porche.position.set(0, 3.12, 1.85); lm.add(porche);
  for (const s of [-1, 1]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.42, 24), negroAsc); t.rotation.z = Math.PI / 2; t.position.set(s * 1.5, 3.85, -0.4); lm.add(t); }
  lm.add(cil(0.45, 0.42, 5.05, 5.5, gris, false, 24)); lm.add(cil(0.5, 0.5, 5.5, 5.62, plataM, false, 24));   // túnel y anillo de acoplamiento
  const rad = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 10, 0, Math.PI * 2, 0, 1.1), plataM); rad.position.set(0, 5.05, 1.05); rad.rotation.x = 1.1; lm.add(rad);   // radar de encuentro
  lm.add(varilla(new THREE.Vector3(0.8, 4.9, -0.4), new THREE.Vector3(1.45, 5.55, -0.3), 0.03, plataM));
  const banda = new THREE.Mesh(new THREE.SphereGeometry(0.38, 20, 10, 0, Math.PI * 2, 0, 1.1), plataM); banda.position.set(1.45, 5.6, -0.3); banda.rotation.z = -0.9; lm.add(banda);   // antena banda S
  for (const s of [-1, 1]) lm.add(varilla(new THREE.Vector3(s * 0.7, 5.0, -0.9), new THREE.Vector3(s * 1.1, 6.0, -1.3), 0.015, plataM, 4));        // antenas VHF
  for (let i = 0; i < 4; i++) {                                         // 4 cuádruples de RCS en las esquinas
    const a = (i * Math.PI) / 2 + Math.PI / 4, q = new THREE.Group(); q.position.set(Math.sin(a) * 1.85, 4.55, Math.cos(a) * 1.55); lm.add(q);
    q.add(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), negroAsc));
    for (const [x, y, z] of [[0, 0.28, 0], [0, -0.28, 0], [0.28 * Math.sin(a), 0, 0.28 * Math.cos(a)], [0.2 * Math.cos(a), 0, -0.2 * Math.sin(a)]]) {
      const n = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 10, 1, true), tobera); n.position.set(x, y, z);
      n.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(x, y, z).normalize()); q.add(n);
    }
  }
  lm.userData = {
    alto: 7,
    patas(f) { for (const b of bisagras) b.rotation.x = -2.3 * (1 - f); },        // 0 = plegadas (en el SLA), 1 = desplegadas
    motor(k, t, exp = 1) { const u = llama.userData.u; u.uOn.value = k; u.uT.value = t; u.uExp.value = exp; llama.visible = k > 0.002; brillo.visible = llama.visible; brillo.material.opacity = k * 0.55; },
  };
  lm.userData.patas(1); lm.userData.motor(0, 0);
  return lm;
}

// ---------------------------------------------------------------------------
//  Saturno V
// ---------------------------------------------------------------------------
export function crearSaturnoV() {
  const raiz = new THREE.Group(), pila = new THREE.Group(); raiz.add(pila);
  const blanco = mat({ color: 0xf2f2ee }), negro = mat({ color: 0x151515, roughness: 0.7 });
  const metal = mat({ color: 0x9a9da3, roughness: 0.35, metalness: 0.75 }), plata = mat({ color: 0xdfe2e6, roughness: 0.16, metalness: 1.0 });
  const toberaF1 = mat({ color: 0x2a2826, roughness: 0.55, metalness: 0.55 }), toberaJ2 = mat({ color: 0x4a4744, roughness: 0.45, metalness: 0.65 });
  const motores = [];                       // { llamas, halos, k(p), exp(p) }
  const destellos = [];                     // halos breves: retrocohetes, separación, RCS { s, k(p) }

  // ---------- S-IC ----------
  const sic = new THREE.Group(), C1 = 2 * Math.PI * R.s1;
  const pintaSIC = lienzo(2048, 2048, (g, w, h) => {
    const P = plano(g, w, h, C1, Y.sic);
    P.cuadrantes(1 / 16, 1 / 8, 0, 15.6, '#121212');                              // patrón de balanceo inferior
    P.cuadrantes(-1 / 16, 1 / 8, 19.0, 24.8, '#121212');                          // intertanque
    P.cuadrantes(1 / 16, 1 / 8, 37.9, 41.5, '#121212'); P.rect(0, 41.5, C1, 42.1, '#121212');   // faldón delantero
    for (const y of [6.1, 19.0, 24.8, 37.9]) P.linea(y, 'rgba(0,0,0,0.25)', 0.05);              // juntas de los tanques
    for (const u of [0.25, 0.75]) { P.vertical(ROTULO, u * C1, 1.6, 18.4, '#101010'); P.bandera(u * C1, 26.2, 4.6); }
    P.hollin(0, 7, 0.32);
  });
  const reliSIC = largueros(512, 1024, Y.sic, [[0, 6.1], [19, 24.8], [37.9, 42.1]], 216);
  sic.add(cil(R.s1, R.s1, 0, Y.sic, mat({ map: tex(pintaSIC), bumpMap: tex(reliSIC, false), bumpScale: 1.5 })));
  sic.add(cil(R.s1, R.s1, 0, 0.01, negro, false));
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4, x = Math.sin(a), z = Math.cos(a);
    const car = cil(2.3, 0.25, -0.6, 7.6, blanco, false, 32); car.position.x = x * 4.3; car.position.z = z * 4.3; sic.add(car);       // carenado de motor
    const f = new THREE.Shape(); f.moveTo(5.6, -0.4); f.lineTo(9.3, -0.4); f.lineTo(8.4, 1.8); f.lineTo(5.9, 5.8); f.closePath();
    const geo = new THREE.ExtrudeGeometry(f, { depth: 0.3, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 1 }); geo.translate(0, 0, -0.15);
    const fin = new THREE.Mesh(geo, i % 2 ? negro : blanco); fin.rotation.y = a - Math.PI / 2; sic.add(fin);                       // aleta
    const r = halo(0xffe2b0, 5); r.position.set(x * 4.3, 7.8, z * 4.3); sic.add(r); destellos.push({ s: r, k: (p) => tramo(p, EV.sic, EV.sic + 0.006, 0.0008, 0.004) });   // retrocohetes
  }
  const f1 = (x, z) => {
    const m = campana(1.83, 5.8, toberaF1, 0.55); m.position.set(x, 0, z); sic.add(m);
    const tor = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.16, 10, 36), toberaF1); tor.rotation.x = Math.PI / 2; tor.position.set(x, -2.2, z); sic.add(tor);   // colector de la turbina
    const l = penacho({ r: 1.8, largo: 95, c0: 0xff4a06, c1: 0xffd27a, k: 1.2, diam: 1, humo: 1 }); l.position.set(x, -5.8, z); sic.add(l);
    const n = penacho({ r: 1.1, largo: 38, c0: 0xffa030, c1: 0xfff4d8, k: 0.7, diam: 0.6 }); n.position.set(x, -5.8, z); sic.add(n);
    const hl = halo(0xffb060, 26); hl.position.set(x, -9, z); sic.add(hl);
    motores.push({ llamas: [l, n], halos: [hl], k: (p) => tramo(p, EV.ign, EV.sic, 0.012, 0.002), exp: (p) => 0.7 * sm(EV.lift, EV.sic, p), op: (p) => 0.85 * (1 - sm(EV.lift + 0.03, EV.sic, p)) });
  };
  for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2 + Math.PI / 4; f1(Math.sin(a) * 3.7, Math.cos(a) * 3.7); }
  f1(0, 0);
  const bola = halo(0xff8a30, 40); bola.position.y = Y.sic + 2; sic.add(bola);                                                       // «fire in the hole» al separarse
  destellos.push({ s: bola, k: (p) => tramo(p, EV.sic, EV.sic + 0.016, 0.001, 0.014), crece: 2.6 });
  pila.add(sic);

  // ---------- anillo interetapa S-IC/S-II ----------
  const anillo = new THREE.Group();
  const pintaAni = lienzo(1024, 256, (g, w, h) => { const P = plano(g, w, h, C1, 5.5); P.cuadrantes(-1 / 16, 1 / 8, 0, 2.4, '#121212'); });
  anillo.add(cil(R.s1, R.s1, Y.sic, Y.anillo, mat({ map: tex(pintaAni), bumpMap: tex(largueros(512, 128, 5.5, [[0, 5.5]], 216), false), bumpScale: 1.5 })));
  pila.add(anillo);
  const ull = []; for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2, s = halo(0xfff0d0, 3.5); s.position.set(Math.sin(a) * 5.4, Y.anillo + 0.5, Math.cos(a) * 5.4); anillo.add(s); ull.push(s); destellos.push({ s, k: (p) => tramo(p, EV.sic + 0.001, EV.sic + 0.009, 0.001, 0.003) }); }

  // ---------- S-II (con el cono interetapa del S-IVB, que se va con él) ----------
  const sii = new THREE.Group();
  const pintaSII = lienzo(2048, 1024, (g, w, h) => {
    const P = plano(g, w, h, C1, Y.sii - Y.anillo);
    P.rect(0, 0, C1, 0.5, '#121212'); P.cuadrantes(1 / 16, 1 / 8, 16.4, 19.4, '#121212');
    for (const u of [0.25, 0.75]) P.vertical('USA', u * C1, 4.5, 14.5, '#101010');
    for (const y of [4.1, 12.0]) P.linea(y, 'rgba(0,0,0,0.18)', 0.04);
  });
  sii.add(cil(R.s1, R.s1, Y.anillo, Y.sii, mat({ map: tex(pintaSII) })));
  const pintaCono = lienzo(1024, 128, (g, w, h) => { const P = plano(g, w, h, C1, 5.8); P.cuadrantes(1 / 16, 1 / 8, 0, 5.8, '#121212'); });
  sii.add(cil(R.s1, R.s4, Y.sii, Y.cono, mat({ map: tex(pintaCono), bumpMap: tex(largueros(512, 128, 5.8, [[0, 5.8]], 160), false), bumpScale: 1.2 })));
  sii.add(cil(R.s1 - 0.05, R.s1 - 0.05, Y.anillo, Y.anillo + 0.01, metal, false));
  for (let i = 0; i < 5; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4, rr = i < 4 ? 2.7 : 0, y = Y.anillo - 0.2;
    const m = campana(1.0, 3.2, toberaJ2, 0.32); m.position.set(Math.sin(a) * rr, y, Math.cos(a) * rr); sii.add(m);
    const l = penacho({ r: 0.98, largo: 26, c0: 0x6f8dff, c1: 0xf0f4ff, k: 0.5, diam: 0.4 }); l.position.set(Math.sin(a) * rr, y - 3.2, Math.cos(a) * rr); sii.add(l);
    const hl = halo(0xb8c8ff, 6); hl.position.set(Math.sin(a) * rr, y - 4, Math.cos(a) * rr); sii.add(hl);
    motores.push({ llamas: [l], halos: [hl], k: (p) => tramo(p, EV.sic + 0.006, EV.sii), exp: () => 0.85 });
  }
  pila.add(sii);

  // ---------- S-IVB + unidad de instrumentos ----------
  const sivb = new THREE.Group(), C4 = 2 * Math.PI * R.s4;
  const pintaS4 = lienzo(1024, 512, (g, w, h) => {
    const P = plano(g, w, h, C4, Y.sivb - Y.cono);
    P.cuadrantes(1 / 16, 1 / 8, 0, 1.9, '#121212'); P.rect(0, 11.6, C4, 12, '#121212'); P.linea(6.5, 'rgba(0,0,0,0.2)', 0.04);
    for (const u of [0, 0.5]) P.rect(u * C4 - 0.5, 2.6, u * C4 + 0.5, 4.8, '#1a1a1a');            // módulos APS
  });
  sivb.add(cil(R.s4, R.s4, Y.cono, Y.sivb, mat({ map: tex(pintaS4) })));
  sivb.add(cil(R.s4, R.s4, Y.sivb, Y.iu, mat({ color: 0xe8e8e2, roughness: 0.5, bumpMap: tex(largueros(256, 64, 0.9, [[0, 0.9]], 90), false), bumpScale: 1 })));   // unidad de instrumentos
  sivb.add(cil(R.s4 - 0.03, 1.2, Y.cono - 1.6, Y.cono, metal, true, 40));
  sivb.add((() => { const m = campana(1.0, 3.2, toberaJ2, 0.32); m.position.y = Y.cono - 1.4; return m; })());
  { const l = penacho({ r: 0.98, largo: 30, c0: 0x7090ff, c1: 0xf3f6ff, k: 0.55, diam: 0.3 }); l.position.y = Y.cono - 4.6; sivb.add(l);
    const hl = halo(0xc0d0ff, 6.5); hl.position.y = Y.cono - 5.4; sivb.add(hl);
    motores.push({ llamas: [l], halos: [hl], k: (p) => Math.max(tramo(p, EV.sii + 0.006, EV.orb), tramo(p, EV.tli0, EV.tli1, 0.004)), exp: () => 1 }); }
  pila.add(sivb);

  // ---------- adaptador SLA: 4 paneles que se abren y se sueltan ----------
  const paneles = [];
  for (let i = 0; i < 4; i++) {
    const giro = new THREE.Group(); giro.rotation.y = (i * Math.PI) / 2; giro.position.y = Y.iu;
    const bisagra = new THREE.Group(); bisagra.position.x = R.s4;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(R.sm, R.s4, Y.sla - Y.iu, 24, 1, true, Math.PI / 4, Math.PI / 2), blanco);
    p.position.set(-R.s4, (Y.sla - Y.iu) / 2, 0); bisagra.add(p); giro.add(bisagra); pila.add(giro); paneles.push({ giro, bisagra });
  }

  // ---------- LM dentro del SLA, con las patas plegadas ----------
  const lm = crearLM(); lm.userData.patas(0); lm.position.y = Y.iu - 0.15; pila.add(lm);
  const yTopeLM = lm.position.y + 5.62;

  // ---------- CSM (módulo de servicio + módulo de mando) ----------
  const yC0 = (Y.sla + Y.cm) / 2, yCd = (yTopeLM + Y.cm + 0.45) / 2;          // centro inicial y tras acoplarse al LM (proa contra el túnel)
  const csm = new THREE.Group(); csm.position.y = yC0;
  const cuerpo = new THREE.Group(); cuerpo.position.y = -yC0; csm.add(cuerpo);
  const Csm = 2 * Math.PI * R.sm;
  const pintaSM = lienzo(1024, 512, (g, w, h) => {
    const P = plano(g, w, h, Csm, Y.sm - Y.sla);
    g.fillStyle = '#c9ccd0'; g.fillRect(0, 0, Csm, 3.9);
    for (let i = 0; i < 6; i++) P.rect((i / 6 + 0.1) * Csm, 0.5, (i / 6 + 0.06 + 0.1) * Csm + 0.6, 3.2, '#f4f4f0');      // radiadores
    P.rect(0, 3.7, Csm, 3.9, '#eeeeea'); P.rect(0, 0, Csm, 0.12, '#7d8085');
    P.horizontal(ROTULO, 0.25 * Csm, 1.9, 0.5, '#111111'); P.horizontal(ROTULO, 0.75 * Csm, 1.9, 0.5, '#111111');
  }, '#c9ccd0');
  cuerpo.add(cil(R.sm, R.sm, Y.sla, Y.sm, mat({ color: 0xffffff, roughness: 0.32, metalness: 0.55, map: tex(pintaSM) })));
  const pintaCM = lienzo(1024, 512, (g, w, h) => {
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '90,95,105'},${0.05 + Math.random() * 0.08})`; g.fillRect(Math.random() * w, 0, 2 + Math.random() * 10, h); }
    g.fillStyle = '#0c0e12'; for (const u of [0.18, 0.32, 0.68, 0.82]) g.fillRect(u * w - 14, h * 0.42, 28, 30); g.fillRect(0.5 * w - 26, h * 0.5, 52, 60);   // ventanas y escotilla
  }, '#d6d9dd');
  cuerpo.add(cil(R.sm, 0.38, Y.sm, Y.cm, mat({ color: 0xffffff, map: tex(pintaCM), roughness: 0.14, metalness: 1.0 }), false, 64));
  cuerpo.add(cil(0.38, 0.12, Y.cm, Y.cm + 0.3, metal, false, 24)); cuerpo.add(cil(0.05, 0.02, Y.cm + 0.3, Y.cm + 0.45, metal, false, 8));    // sonda de acoplamiento
  cuerpo.add(cil(R.sm, R.sm, Y.sla, Y.sla + 0.01, metal, false));
  { const m = campana(1.25, 2.8, mat({ color: 0x55524f, roughness: 0.4, metalness: 0.7 }), 0.4); m.position.y = Y.sla; cuerpo.add(m);
    const l = penacho({ r: 1.22, largo: 16, c0: 0x9fb0ff, c1: 0xfff4f0, k: 0.45 }); l.position.y = Y.sla - 2.8; cuerpo.add(l);
    const hl = halo(0xd0d8ff, 4); hl.position.y = Y.sla - 3.4; cuerpo.add(hl);
    motores.push({ llamas: [l], halos: [hl], k: (p) => tramo(p, EV.loi0, EV.loi1, 0.004, 0.004), exp: () => 1 }); }
  for (let i = 0; i < 4; i++) {                                                  // 4 cuádruples de RCS
    const a = (i * Math.PI) / 2 + Math.PI / 4, q = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.6, 0.3), metal);
    q.position.set(Math.sin(a) * (R.sm + 0.13), Y.sm - 1.0, Math.cos(a) * (R.sm + 0.13)); q.rotation.y = a; cuerpo.add(q);
    const s = halo(0xffffff, 1.6); s.position.set(Math.sin(a) * (R.sm + 0.6), Y.sm - 1.0, Math.cos(a) * (R.sm + 0.6)); cuerpo.add(s);
    destellos.push({ s, k: (p) => (p > EV.sla && p < EV.ext1 ? Math.max(0, Math.sin(p * 2400 + i * 1.7)) ** 8 : 0) });
  }
  const antena = new THREE.Group(); antena.position.set(0, Y.sla + 0.3, -R.sm); cuerpo.add(antena);   // antena de alta ganancia
  antena.add(varilla(new THREE.Vector3(), new THREE.Vector3(0, -2.6, 0), 0.05, metal));
  for (let i = 0; i < 4; i++) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 8, 0, Math.PI * 2, 0, 0.9), plata);
    d.position.set((i % 2 ? 0.45 : -0.45), -2.6 + (i < 2 ? 0.45 : -0.45), 0); d.rotation.x = -Math.PI / 2; antena.add(d); }
  pila.add(csm);

  // ---------- torre de escape (LES) + cubierta protectora del CM ----------
  const les = new THREE.Group(), rojo = mat({ color: 0x9c2f22, roughness: 0.6 });
  les.add(cil(R.sm + 0.04, 0.34, Y.sm, Y.cm + 0.05, blanco, true, 64));
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4, b0 = new THREE.Vector3(Math.sin(a) * 0.75, Y.cm, Math.cos(a) * 0.75), b1 = new THREE.Vector3(Math.sin(a) * 0.36, Y.cm + 3.3, Math.cos(a) * 0.36);
    les.add(varilla(b0, b1, 0.06, rojo));
    const a2 = a + Math.PI / 2, c0 = new THREE.Vector3(Math.sin(a2) * 0.75, Y.cm, Math.cos(a2) * 0.75);
    les.add(varilla(b0.clone().lerp(b1, 0.1), c0.clone().lerp(new THREE.Vector3(Math.sin(a2) * 0.36, Y.cm + 3.3, Math.cos(a2) * 0.36), 0.9), 0.035, rojo));
  }
  les.add(cil(0.34, 0.34, Y.cm + 3.3, Y.cm + 8.3, blanco, false, 24)); les.add(cil(0.34, 0.03, Y.cm + 8.3, Y.tope, blanco, false, 24));
  les.add(cil(0.25, 0.25, Y.tope - 0.9, Y.tope - 0.6, negro, false, 24));
  { const l = penacho({ r: 0.35, largo: 14, c0: 0xffa040, c1: 0xffffff, k: 1.1 }); l.position.set(0.3, Y.cm + 3.6, 0); l.rotation.z = -0.5; les.add(l);
    const l2 = penacho({ r: 0.35, largo: 14, c0: 0xffa040, c1: 0xffffff, k: 1.1 }); l2.position.set(-0.3, Y.cm + 3.6, 0); l2.rotation.z = 0.5; les.add(l2);
    motores.push({ llamas: [l, l2], halos: [], k: (p) => tramo(p, EV.les, EV.les + 0.007, 0.0008, 0.003), exp: () => 0.5 }); }
  pila.add(les);

  // ---------- luz de los motores (ilumina la base del cohete, el humo y el suelo) ----------
  const luz = new THREE.PointLight(0xff9a50, 0, 0, 2); luz.position.y = -12; raiz.add(luz);

  // ---------- animación: todo es función de p, así que saltar o congelar el viaje sigue siendo coherente ----------
  const caer = (gr, u, vel, deriva, giro, hasta = 0.05) => {        // etapa soltada: se queda atrás, deriva y cabecea
    gr.visible = u < hasta; if (u <= 0) { gr.position.set(0, 0, 0); gr.rotation.set(0, 0, 0); return; }
    gr.position.set(u * deriva, -u * vel - u * u * vel * 20, 0); gr.rotation.set(u * giro, 0, u * giro * 0.4);
  };
  const yDock = yCd, topeAcop = yCd + (yC0 - (Y.sla - 2.8));
  function actualizar(p, marte) {
    caer(sic, p - EV.sic, 1800, 120, 4);
    caer(anillo, p - EV.anillo, 1400, -160, 9);
    caer(sii, p - EV.sii, 1100, 80, 3);
    caer(sivb, p - EV.ext0, 240, -20, 0.6, 0.09);
    const uL = p - EV.les; les.visible = uL < 0.05;
    les.position.set(uL > 0 ? uL * 400 : 0, uL > 0 ? uL * 2600 + uL * uL * 9e4 : 0, 0); les.rotation.z = uL > 0 ? -uL * 14 : 0;
    const uP = p - EV.sla;
    for (const q of paneles) {
      q.giro.visible = uP < 0.06; q.bisagra.rotation.z = uP > 0 ? -Math.min(0.8, uP * 120) : 0;
      q.bisagra.position.x = R.s4 + (uP > 0.006 ? (uP - 0.006) * 900 : 0);
      q.giro.position.y = Y.iu - (p > EV.ext0 ? (p - EV.ext0) * 240 : 0);
    }
    // transposición: el CSM se aleja 18 m, gira 180° y vuelve a acoplarse con la proa contra el túnel del LM
    csm.position.y = yC0 + 18 * sm(EV.sla, EV.giro0 + 0.006, p) - (18 + yC0 - yDock) * sm(EV.giro1, EV.dock, p);
    csm.rotation.x = Math.PI * sm(EV.giro0, EV.giro1, p);
    antena.rotation.x = -1.35 * sm(EV.giro0, EV.giro1, p);
    // encuadre: centro y longitud de lo que queda unido, para que la cámara siga a la parte activa
    const a1 = sm(EV.sic, EV.sic + 0.03, p), a2 = sm(EV.sii, EV.sii + 0.03, p), a3 = sm(EV.ext0, EV.ext1, p), aL = sm(EV.les, EV.les + 0.02, p);
    const base = -6 + a1 * (Y.sic + 6) + a2 * (Y.cono - 4.6 - Y.sic) + a3 * (lm.position.y + 0.5 - (Y.cono - 4.6));
    const tope = Y.tope - aL * (Y.tope - Y.cm - 0.5) + sm(EV.giro1, EV.dock, p) * (topeAcop - Y.cm - 0.5);
    pila.position.y = -(base + tope) / 2;
    const dest = marte ? 'Trans-Mars' : 'Translunar', orbita = marte ? 'Mars' : 'lunar';
    const fase = p < EV.ign ? 'Countdown · LC-39A' : p < EV.lift ? 'Ignition of the five F-1s · held down on the pad'
      : p < EV.lift + 0.02 ? 'Liftoff' : p < EV.sic ? 'S-IC first stage · five F-1 engines'
      : p < EV.anillo ? 'S-IC separation · S-II ignition' : p < EV.les ? 'Interstage ring jettison'
      : p < EV.les + 0.02 ? 'Launch escape tower jettison' : p < EV.sii ? 'S-II second stage · five J-2 engines'
      : p < EV.orb ? 'S-II separation · first S-IVB burn' : p < EV.tli0 ? 'Earth parking orbit'
      : p < EV.tli1 ? `${dest} injection · second S-IVB burn` : p < EV.giro0 ? 'CSM separation · adapter panels open'
      : p < EV.giro1 ? 'CSM transposition' : p < EV.dock ? 'Docking with the lunar module'
      : p < EV.ext1 ? 'Lunar module extraction' : p < EV.loi0 ? `${dest} coast · CSM + LM`
      : p < EV.loi1 ? 'Orbit insertion · SPS engine' : `In ${orbita} orbit`;
    estado.p = p;
    return { fase, largo: tope - base };
  }
  const estado = { p: 0 };
  function animar(seg, escala) {                                     // llamas, halos y luz (se llama en cada fotograma)
    const p = estado.p; let luzK = 0;
    for (const m of motores) {
      const k = m.k(p), e = m.exp(p), op = m.op ? m.op(p) : 0;
      for (const l of m.llamas) { const u = l.userData.u; u.uOn.value = k; u.uExp.value = e; u.uOp.value = op; u.uT.value = seg; l.visible = k > 0.002; l.scale.set(1, 0.94 + 0.06 * Math.sin(seg * 53 + l.id), 1); }
      for (const h of m.halos) { h.visible = k > 0.002; h.material.opacity = k * (0.55 + 0.1 * Math.sin(seg * 61 + h.id)); }
      if (m.halos.length && m.halos[0].userData.tam > 20) luzK = Math.max(luzK, k);
    }
    for (const d of destellos) {
      const k = d.k(p); d.s.visible = k > 0.002; d.s.material.opacity = k;
      if (d.crece) d.s.scale.setScalar(d.s.userData.tam * (1 + d.crece * sm(EV.sic, EV.sic + 0.016, p)));
    }
    luz.intensity = luzK * 9e3 * escala * escala; luz.visible = luzK > 0.002;
  }

  raiz.userData = { actualizar, animar, lm, csm, estado, ponLM() { lm.position.set(0, Y.iu - 0.15, 0); lm.quaternion.identity(); lm.scale.setScalar(1); lm.userData.patas(0); lm.userData.motor(0, 0); lm.visible = true; pila.add(lm); } };
  raiz.visible = false; actualizar(0, false);
  return raiz;
}
