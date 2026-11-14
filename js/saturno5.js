// Saturno V (Apolo) procedural, a escala: todas las cotas están en METROS sobre la base del S-IC.
// Dimensiones reales del vehículo (NASA, Saturn V Flight Manual): 110,6 m de alto, 10,1 m de diámetro
// en S-IC y S-II, 6,6 m en el S-IVB, 3,9 m en el módulo de servicio.
//
// Secuencia de vuelo que se reproduce (la real de las misiones lunares, comprimida a la duración del viaje):
//   1. S-IC: 5 motores F-1 (queroseno/LOX, penacho naranja)            → se separa
//   2. Anillo interetapa del S-II (cae unos 30 s después)  y torre de escape (LES) con la cubierta del CM
//   3. S-II: 5 motores J-2 (hidrógeno/LOX, llama azul casi invisible)   → se separa junto con el cono interetapa
//   4. S-IVB: 1 motor J-2 → inyección translunar → apagado
//   5. Se sueltan los 4 paneles del adaptador (SLA) y el CSM se separa del S-IVB y se da la vuelta
//   6. Inserción orbital: motor SPS del módulo de servicio, encendido con la tobera hacia delante (frenado)
// No se modela: la extracción del módulo lunar (transposición y acoplamiento) ni el retraso real entre fases.
import * as THREE from 'three';

// instantes (fracción 0..1 del viaje) de cada evento
export const T = { sic: 0.13, anillo: 0.17, les: 0.20, sii: 0.33, tliFin: 0.47, csm: 0.56, giro0: 0.60, giro1: 0.72, loi: 0.80 };

// cotas (m)
const Y = { sic: 42.1, anillo: 47.6, sii: 67.0, cono: 72.8, sivb: 84.8, iu: 85.7, sla: 94.2, sm: 98.1, cm: 101.3, tope: 111.3 };
const R = { s1: 5.03, s4: 3.3, sm: 1.95 };

const sm = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };

function textura(w, h, pintar) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.fillStyle = '#f4f4f1'; g.fillRect(0, 0, w, h); pintar(g, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
// v = 0 abajo … 1 arriba (el lienzo tiene el origen arriba)
const banda = (g, w, h, u0, u1, v0, v1, color = '#111') => { g.fillStyle = color; g.fillRect(u0 * w, (1 - v1) * h, (u1 - u0) * w, (v1 - v0) * h); };
function letrasUSA(g, w, h, u, v0, v1) {
  g.fillStyle = '#b3191f'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const paso = ((v1 - v0) * h) / 3; g.font = `bold ${Math.round(paso * 0.82)}px Helvetica, Arial, sans-serif`;
  'USA'.split('').forEach((l, i) => g.fillText(l, u * w, (1 - v1) * h + paso * (i + 0.5)));
}

function llama(radio, largo, c0, c1, k) {
  const geo = new THREE.ConeGeometry(radio, largo, 24, 1, true); geo.rotateX(Math.PI); geo.translate(0, -largo / 2, 0);
  // el penacho se ensancha en el vacío: se invierte el cono (estrecho en la tobera, ancho al final) para F-1 a gran altitud no;
  // se deja en punta, que es lo que se ve en las filmaciones de seguimiento.
  return new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: { k: { value: k }, c0: { value: new THREE.Color(c0) }, c1: { value: new THREE.Color(c1) } },
    vertexShader: 'varying float vT; void main(){ vT = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying float vT; uniform float k; uniform vec3 c0; uniform vec3 c1;
      void main(){ float a = pow(1.0 - vT, 1.6); gl_FragColor = vec4(mix(c0, c1, a) * a * k, 1.0); }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  }));
}

export function crearSaturnoV() {
  const raiz = new THREE.Group(), pila = new THREE.Group(); raiz.add(pila);
  const mat = (o) => new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.05, side: THREE.DoubleSide, ...o });
  const blanco = mat({ color: 0xf4f4f1 }), negro = mat({ color: 0x141414 }), metal = mat({ color: 0x9a9da3, roughness: 0.35, metalness: 0.75 });
  const plata = mat({ color: 0xcfd2d6, roughness: 0.28, metalness: 0.85 }), tobera = mat({ color: 0x2b2a29, roughness: 0.5, metalness: 0.6 });
  const cil = (r0, r1, y0, y1, m, abierto = true, seg = 48) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, y1 - y0, seg, 1, abierto), m); c.position.y = (y0 + y1) / 2; return c; };
  const motor = (rSalida, largo, ySalida) => cil(rSalida, rSalida * 0.28, ySalida, ySalida + largo, tobera, true, 24);
  const llamas = [];

  // ---------- S-IC ----------
  const sic = new THREE.Group();
  sic.add(cil(R.s1, R.s1, 0, Y.sic, mat({ map: textura(1024, 1024, (g, w, h) => {
    for (let i = 0; i < 4; i++) banda(g, w, h, i / 4 + 0.0625, i / 4 + 0.1875, 0.0, 0.37);          // franjas negras entre aletas
    for (let i = 0; i < 4; i++) banda(g, w, h, i / 4 - 0.0625, i / 4 + 0.0625, 0.50, 0.60);         // intertanque
    banda(g, w, h, 0, 1, 0.985, 1);
    for (let i = 0; i < 4; i++) banda(g, w, h, i / 4 + 0.0625, i / 4 + 0.1875, 0.90, 0.985);        // faldón delantero
    letrasUSA(g, w, h, 0.25, 0.64, 0.88); letrasUSA(g, w, h, 0.75, 0.64, 0.88);
  }) })));
  sic.add(cil(R.s1, R.s1, 0, 0.01, negro, false));                                                   // escudo térmico de la base
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2, x = Math.sin(a), z = Math.cos(a);
    const car = cil(2.3, 0.2, 0, 7.6, blanco, true, 20); car.position.x = x * 4.3; car.position.z = z * 4.3; sic.add(car);   // carenado de motor
    const f = new THREE.Shape(); f.moveTo(5.6, 0.2); f.lineTo(9.2, 0.2); f.lineTo(8.3, 2.3); f.lineTo(5.9, 5.6); f.closePath();
    const geo = new THREE.ExtrudeGeometry(f, { depth: 0.25, bevelEnabled: false }); geo.translate(0, 0, -0.125);
    const fin = new THREE.Mesh(geo, i % 2 ? negro : blanco); fin.rotation.y = a - Math.PI / 2; sic.add(fin);                  // aleta
    const m = motor(1.85, 5.6, -2.9); m.position.x = x * 3.7; m.position.z = z * 3.7; sic.add(m);                            // F-1 exterior
    const l = llama(2.6, 62, 0xff5a12, 0xfff0c8, 1.0); l.position.set(x * 3.7, -2.9, z * 3.7); sic.add(l); llamas.push({ m: l, on: (t) => t < T.sic });
  }
  sic.add(motor(1.85, 5.6, -2.9));                                                                   // F-1 central
  { const l = llama(3.2, 78, 0xff6a1a, 0xfff6dc, 1.1); l.position.y = -2.9; sic.add(l); llamas.push({ m: l, on: (t) => t < T.sic }); }
  pila.add(sic);

  // ---------- anillo interetapa S-IC/S-II ----------
  const anillo = new THREE.Group();
  anillo.add(cil(R.s1, R.s1, Y.sic, Y.anillo, mat({ map: textura(512, 64, (g, w, h) => { for (let i = 0; i < 4; i++) banda(g, w, h, i / 4, i / 4 + 0.125, 0, 0.45); }) })));
  pila.add(anillo);

  // ---------- S-II (con el cono interetapa del S-IVB, que se va con él) ----------
  const sii = new THREE.Group();
  sii.add(cil(R.s1, R.s1, Y.anillo, Y.sii, mat({ map: textura(1024, 512, (g, w, h) => {
    banda(g, w, h, 0, 1, 0, 0.03); for (let i = 0; i < 4; i++) banda(g, w, h, i / 4 + 0.0625, i / 4 + 0.1875, 0.84, 1);
    letrasUSA(g, w, h, 0.5, 0.25, 0.7); letrasUSA(g, w, h, 0.0, 0.25, 0.7); letrasUSA(g, w, h, 1.0, 0.25, 0.7);
  }) })));
  sii.add(cil(R.s1, R.s4, Y.sii, Y.cono, mat({ map: textura(512, 64, (g, w, h) => { for (let i = 0; i < 4; i++) banda(g, w, h, i / 4, i / 4 + 0.125, 0, 1); }) })));
  sii.add(cil(R.s1 - 0.05, R.s1 - 0.05, Y.anillo, Y.anillo + 0.01, metal, false));                  // fondo del tanque
  for (let i = 0; i < 5; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4, rr = i < 4 ? 2.7 : 0, y = Y.anillo - 3.4;
    const m = motor(1.02, 3.4, y); m.position.x = Math.sin(a) * rr; m.position.z = Math.cos(a) * rr; sii.add(m);            // J-2
    const l = llama(1.5, 20, 0x5f86ff, 0xe8f0ff, 0.42); l.position.set(Math.sin(a) * rr, y, Math.cos(a) * rr); sii.add(l);
    llamas.push({ m: l, on: (t) => t > T.sic + 0.012 && t < T.sii });
  }
  pila.add(sii);

  // ---------- S-IVB + unidad de instrumentos ----------
  const sivb = new THREE.Group();
  sivb.add(cil(R.s4, R.s4, Y.cono, Y.sivb, mat({ map: textura(512, 256, (g, w, h) => { for (let i = 0; i < 4; i++) banda(g, w, h, i / 4, i / 4 + 0.125, 0, 0.14); banda(g, w, h, 0, 1, 0.97, 1); }) })));
  sivb.add(cil(R.s4, R.s4, Y.sivb, Y.iu, negro));                                                    // unidad de instrumentos
  sivb.add(cil(R.s4 - 0.03, 1.2, Y.cono - 1.6, Y.cono, metal, true, 32));                           // cúpula trasera
  sivb.add(motor(1.02, 3.4, Y.cono - 4.6));
  { const l = llama(1.5, 22, 0x5f86ff, 0xe8f0ff, 0.45); l.position.y = Y.cono - 4.6; sivb.add(l); llamas.push({ m: l, on: (t) => t > T.sii + 0.012 && t < T.tliFin }); }
  pila.add(sivb);

  // ---------- adaptador SLA: 4 paneles que se sueltan ----------
  const paneles = [];
  for (let i = 0; i < 4; i++) {
    const giro = new THREE.Group(); giro.rotation.y = (i * Math.PI) / 2; giro.position.y = Y.iu;
    const bisagra = new THREE.Group(); bisagra.position.x = R.s4;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(R.sm, R.s4, Y.sla - Y.iu, 16, 1, true, Math.PI / 4, Math.PI / 2), blanco);
    p.position.set(-R.s4, (Y.sla - Y.iu) / 2, 0); bisagra.add(p); giro.add(bisagra); pila.add(giro); paneles.push({ giro, bisagra });
  }

  // ---------- CSM (módulo de servicio + módulo de mando) ----------
  const yCsm = (Y.sla + Y.cm) / 2, csm = new THREE.Group(); csm.position.y = yCsm;
  const cuerpo = new THREE.Group(); cuerpo.position.y = -yCsm; csm.add(cuerpo);
  cuerpo.add(cil(R.sm, R.sm, Y.sla, Y.sm, mat({ color: 0xd9dbde, roughness: 0.3, metalness: 0.8, map: textura(512, 128, (g, w, h) => {
    g.fillStyle = '#c9ccd0'; g.fillRect(0, 0, w, h); for (let i = 0; i < 8; i++) banda(g, w, h, i / 8 + 0.02, i / 8 + 0.075, 0.15, 0.8, '#f2f2ee');   // radiadores
    banda(g, w, h, 0, 1, 0.94, 1, '#eeeeea');
  }) })));
  cuerpo.add(cil(R.sm, 0.25, Y.sm, Y.cm, plata, true, 40));                                          // módulo de mando
  cuerpo.add(cil(R.sm, R.sm, Y.sla, Y.sla + 0.01, metal, false));
  cuerpo.add(motor(1.25, 2.8, Y.sla - 2.8));                                                         // motor SPS
  { const l = llama(1.4, 13, 0x8fa8ff, 0xf2f5ff, 0.38); l.position.y = Y.sla - 2.8; cuerpo.add(l); llamas.push({ m: l, on: (t) => t > T.loi }); }
  for (let i = 0; i < 4; i++) {                                                                       // 4 grupos de propulsores RCS
    const a = (i * Math.PI) / 2 + Math.PI / 4, q = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.45, 0.35), metal);
    q.position.set(Math.sin(a) * (R.sm + 0.15), Y.sm - 1.1, Math.cos(a) * (R.sm + 0.15)); cuerpo.add(q);
  }
  pila.add(csm);

  // ---------- torre de escape (LES) + cubierta protectora del CM ----------
  const les = new THREE.Group();
  les.add(cil(R.sm + 0.04, 0.3, Y.sm, Y.cm + 0.05, blanco, true, 40));                               // cubierta protectora
  for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2 + Math.PI / 4, b = cil(0.05, 0.05, Y.cm, Y.cm + 3.2, metal, true, 6);
    b.position.x = Math.sin(a) * 0.45; b.position.z = Math.cos(a) * 0.45; b.rotation.z = -Math.sin(a) * 0.07; b.rotation.x = Math.cos(a) * 0.07; les.add(b); }   // celosía
  les.add(cil(0.33, 0.33, Y.cm + 3.2, Y.cm + 8.6, blanco, true, 20)); les.add(cil(0.33, 0.02, Y.cm + 8.6, Y.tope, blanco, true, 20));
  pila.add(les);

  // ---------- animación: todo es función de t, así que saltar o congelar el viaje sigue siendo coherente ----------
  const caer = (g, u, vel, deriva, giro) => {                    // etapa soltada: se queda atrás, deriva y cabecea
    g.visible = u < 0.3; g.position.set(u > 0 ? u * deriva : 0, u > 0 ? -u * vel : 0, 0); g.rotation.set(u > 0 ? u * giro : 0, 0, u > 0 ? u * giro * 0.4 : 0);
  };
  function actualizar(t, marte) {
    caer(sic, t - T.sic, 1500, 60, 2.2);
    caer(anillo, t - T.anillo, 1300, -90, 5);
    caer(sii, t - T.sii, 900, 40, 1.6);
    caer(sivb, t - T.csm, 260, -30, 0.5);
    const uL = t - T.les; les.visible = uL < 0.2; les.position.set(uL > 0 ? uL * 700 : 0, uL > 0 ? uL * 1400 : 0, 0); les.rotation.z = uL > 0 ? -uL * 9 : 0;
    const uP = t - (T.csm - 0.015);
    for (const p of paneles) { p.giro.visible = uP < 0.25; p.bisagra.rotation.z = uP > 0 ? -Math.min(1.1, uP * 40) : 0; p.bisagra.position.x = R.s4 + (uP > 0.03 ? (uP - 0.03) * 500 : 0);
      p.giro.position.y = Y.iu - (t > T.csm ? (t - T.csm) * 260 : 0); }
    csm.rotation.x = Math.PI * sm(T.giro0, T.giro1, t);                                              // el CSM se da la vuelta: frenará con la tobera por delante
    for (const l of llamas) l.m.visible = l.on(t);
    // encuadre: centro y longitud de lo que queda unido, para que la cámara «siga» a la parte activa
    const a1 = sm(T.sic, T.sic + 0.06, t), a2 = sm(T.sii, T.sii + 0.06, t), a3 = sm(T.csm, T.csm + 0.06, t), aL = sm(T.les, T.les + 0.04, t);
    const base = -3 + a1 * (Y.sic + 3) + a2 * (Y.cono - 4.6 - Y.sic) + a3 * (Y.sla - 2.8 - (Y.cono - 4.6));
    const tope = Y.tope - aL * (Y.tope - Y.cm);
    pila.position.y = -(base + tope) / 2;
    const tli = marte ? 'transmarciana' : 'translunar';
    const fase = t < T.sic ? '1.ª etapa S-IC · 5 motores F-1' : t < T.anillo ? 'Separación del S-IC · encendido del S-II'
      : t < T.les ? 'Suelta del anillo interetapa' : t < T.les + 0.05 ? 'Suelta de la torre de escape'
      : t < T.sii ? '2.ª etapa S-II · 5 motores J-2' : t < T.sii + 0.04 ? 'Separación del S-II · encendido del S-IVB'
      : t < T.tliFin ? `3.ª etapa S-IVB · inyección ${tli}` : t < T.csm ? 'Apagado del S-IVB' : t < T.giro0 ? 'Separación del CSM y paneles del adaptador'
      : t < T.loi ? 'Crucero · CSM Apolo' : 'Inserción orbital · motor SPS';
    return { fase, escala: 1.3 / (tope - base) };
  }
  function parpadeo(seg) { const k = 0.9 + 0.1 * Math.sin(seg * 47) + 0.05 * Math.sin(seg * 113); for (const l of llamas) l.m.scale.set(1, k, 1); }

  raiz.userData = { actualizar, parpadeo };
  raiz.visible = false; actualizar(0, false);
  return raiz;
}
