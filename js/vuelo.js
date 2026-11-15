// Misión completa del Saturno V: plataforma LC-39A, ascenso, órbita de aparcamiento, inyección, crucero,
// captura en órbita del destino y, al elegir un emplazamiento, descenso del módulo lunar hasta él.
//
// Escala: los planetas están a 1 unidad = 1000 km (Tierra R = 6,37). El vehículo se dibuja a K0 unidades por metro
// (×300 sobre la escala de los planetas) y, cuando la cámara se aleja, crece para seguir viéndose (tamaño mínimo en
// pantalla). Altitudes, ángulos de la trayectoria y orden de las fases siguen las misiones Apolo; los tiempos, no:
// el viaje real de 3 días (o 7 meses a Marte) se comprime en unos 40 s.
import * as THREE from 'three';
import { EV, sm, crearSaturnoV, halo } from './saturno5.js';

const K0 = 3e-4;
const VISTA = 2 * Math.tan((22.5 * Math.PI) / 180);       // alto visible a distancia 1 con el FOV de 45°
const LC39A = { lat: 28.6082, lon: -80.6041 };            // Complejo de lanzamiento 39A, Centro Espacial Kennedy
const CUBIERTA = 14.0;                                     // m: base del S-IC sobre el suelo (pedestales + plataforma móvil)
const V3 = THREE.Vector3;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function lienzo(w, h, pintar) { const c = document.createElement('canvas'); c.width = w; c.height = h; pintar(c.getContext('2d'), w, h); return c; }
function tex(c, color = true) { const t = new THREE.CanvasTexture(c); if (color) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }

let _bocanada = null;
function texBocanada() {                                   // bocanada de humo: varios círculos difusos superpuestos
  if (_bocanada) return _bocanada;
  const c = lienzo(128, 128, (g) => {
    for (let i = 0; i < 18; i++) {                         // grumos suaves: no llegan a saturar, así no se ven discos de borde duro
      const a = Math.random() * Math.PI * 2, d = Math.random() * 24, x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d, r = 18 + Math.random() * 20;
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.17)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.07)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    }
    const borde = g.createRadialGradient(64, 64, 26, 64, 64, 64);   // el contorno se deshace hacia fuera
    borde.addColorStop(0, 'rgba(0,0,0,1)'); borde.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'destination-in'; g.fillStyle = borde; g.fillRect(0, 0, 128, 128);
  });
  return (_bocanada = tex(c, false));
}

// partículas de humo/polvo calculadas en el shader como función del tiempo de misión (saltar o congelar es coherente)
function nubeParticulas(n, emisor, { color0, color1, alfa = 0.85, mundo = false }) {
  const aS = new Float32Array(n * 4), aB = new Float32Array(n * 4), pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { for (let k = 0; k < 4; k++) aS[i * 4 + k] = Math.random(); emisor(i, aB, pos); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aS', new THREE.BufferAttribute(aS, 4)); g.setAttribute('aB', new THREE.BufferAttribute(aB, 4));
  const u = { uT: { value: -1 }, uDur: { value: 1 }, uPx: { value: 500 }, uLuz: { value: 0 }, uEsc: { value: 1 }, uTex: { value: texBocanada() },
    uC0: { value: new THREE.Color(color0) }, uC1: { value: new THREE.Color(color1) }, uAlfa: { value: alfa } };
  const m = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false,
    vertexShader: `uniform float uT, uDur, uPx, uLuz, uEsc; attribute vec4 aS; attribute vec4 aB; varying float vA; varying float vL; varying float vRot; varying float vCal; varying float vB;
      void main() {
        vB = 0.72 + 0.4 * aS.y;
        float edad = (uT - aB.x) * uDur; vA = 0.0; vL = 0.0; vRot = 0.0; vCal = 0.0;
        if (edad < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
        float vida = aB.y, e = aB.z; vec3 p;
        if (e < 1.5) {                                   // salidas de la trinchera de llamas (±z)
          float sg = e < 0.5 ? 1.0 : -1.0, ang = (aS.x - 0.5) * 1.1;
          float d = 190.0 * (1.0 - exp(-edad / 1.4)) * (0.55 + 0.7 * aS.y);
          p = vec3(sin(ang) * d * 0.8, 3.0 + edad * (5.0 + 12.0 * aS.z) + edad * edad * 2.0, sg * (45.0 + cos(ang) * d));
        } else if (e < 2.5) {                            // alrededor de la plataforma
          float a = aS.x * 6.2832, d = 18.0 + 50.0 * (1.0 - exp(-edad / 1.8)) * aS.y;
          p = vec3(cos(a) * d, 2.0 + edad * (7.0 + 9.0 * aS.z), sin(a) * d);
        } else if (e < 3.5) {                            // estela del ascenso (posición de nacimiento en position)
          p = position + (aS.xyz - 0.5) * edad * 14.0;
        } else {                                         // polvo del alunizaje: lámina radial (Luna) o nube que sube (Marte)
          float a = aS.x * 6.2832, d = 2.5 + edad * (5.0 + 9.0 * aS.y) * aB.w;
          p = vec3(cos(a) * d, 0.15 + edad * (0.3 + 2.5 * aS.z * (1.0 - aB.w * 0.7)), sin(a) * d);
        }
        float tam = (e < 3.5 ? 14.0 + edad * (14.0 + 16.0 * aS.w) : 1.2 + edad * (1.5 + 2.0 * aS.w));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(tam * uEsc * uPx / -mv.z, 0.0, 1400.0);
        vA = smoothstep(0.0, 0.3, edad) * (1.0 - smoothstep(vida * 0.5, vida, edad));
        vL = e < 2.5 ? uLuz * exp(-length(p.xz) / 90.0) * exp(-p.y / 50.0) : 0.0;
        vRot = aS.w * 6.2832 + edad * 0.25 * (aS.z - 0.5);
        vCal = clamp(p.y / 140.0, 0.0, 1.0);
      }`,
    fragmentShader: `uniform sampler2D uTex; uniform vec3 uC0, uC1; uniform float uAlfa; varying float vA; varying float vL; varying float vRot; varying float vCal; varying float vB;
      void main() {
        vec2 c = gl_PointCoord - 0.5; float cs = cos(vRot), sn = sin(vRot);
        c = vec2(cs * c.x - sn * c.y, sn * c.x + cs * c.y) + 0.5;
        float d = texture2D(uTex, c).r;
        float a = smoothstep(0.0, 0.75, d) * vA * uAlfa; if (a < 0.004) discard;
        // volumen: cada bocanada es más clara por arriba (luz del cielo) y más densa y oscura en el centro
        float sombra = mix(0.7, 1.1, 1.0 - gl_PointCoord.y) * mix(1.05, 0.86, d);
        vec3 col = mix(uC0, uC1, 0.3 + 0.7 * vCal) * vB * sombra + vec3(1.0, 0.6, 0.28) * vL;
        gl_FragColor = vec4(col, a); }`,
  }));
  m.frustumCulled = false; m.userData.u = u; m.userData.mundo = mundo; return m;
}

export class Vuelo {
  constructor(viewer, { POS, latLonToLocal }) {
    this.v = viewer; this.POS = POS; this.ll = latLonToLocal;
    this.cohete = crearSaturnoV(); viewer.scene.add(this.cohete);
    this.lm = this.cohete.userData.lm;
    this.pad = this._plataforma(); this.pad.visible = false; viewer.scene.add(this.pad);
    this.cielo = this._cielo(); viewer.scene.add(this.cielo);
    this.traza = null; this.estela = null; this.anilloOrb = null; this.polvo = null;
    this.plan = null; this.orb = null; this.lmModo = 'pila'; this.escala = K0;
    this._entorno();
  }

  // reflejos para el metal del vehículo: cielo negro, resplandor azul de la Tierra por debajo y el Sol
  _entorno() {
    const pm = new THREE.PMREMGenerator(this.v.renderer), esc = new THREE.Scene();
    esc.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vD; void main(){
        vec3 c = mix(vec3(0.16, 0.26, 0.42), vec3(0.025, 0.03, 0.045), smoothstep(-0.25, 0.35, vD.y));
        c += vec3(0.55, 0.6, 0.68) * pow(max(0.0, 1.0 - abs(vD.y + 0.05)), 8.0) * 0.5;
        c += vec3(1.0, 0.96, 0.9) * pow(max(dot(vD, normalize(vec3(0.8, 0.5, 0.35))), 0.0), 300.0) * 60.0;
        gl_FragColor = vec4(c, 1.0); }`,
    })));
    const env = pm.fromScene(esc, 0).texture; pm.dispose();
    const poner = (o) => o.traverse((m) => { if (m.material?.isMeshStandardMaterial) { m.material.envMap = env; m.material.envMapIntensity = 1.0; } });
    poner(this.cohete); poner(this.pad);
  }

  // ---------- LC-39A: suelo, plataforma móvil (MLP), torre umbilical (LUT) con brazos ----------
  _plataforma() {
    const g = new THREE.Group(), RS = 800;
    const suelo = lienzo(1024, 1024, (c, w, h) => {
      const px = (m) => (m / RS) * (w / 2), X = (x) => w / 2 + px(x), Z = (z) => h / 2 + px(z);   // z = +abajo en el lienzo
      c.fillStyle = '#8f8a6e'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) {                                          // matorral y arena
        const x = Math.random() * w, y = Math.random() * h, r = 1 + Math.random() * 5, k = Math.random();
        c.fillStyle = k < 0.55 ? `rgba(70,88,52,${0.25 + Math.random() * 0.35})` : k < 0.8 ? 'rgba(160,150,118,0.35)' : 'rgba(54,66,44,0.4)';
        c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
      }
      c.fillStyle = '#d9d2b4'; c.fillRect(0, Z(640), w, px(50)); c.fillStyle = '#2c5c7a'; c.fillRect(0, Z(690), w, h);     // playa y Atlántico
      c.fillStyle = '#7d7a72'; c.fillRect(X(-22), 0, px(12), Z(-120)); c.fillRect(X(10), 0, px(12), Z(-120));                // camino de la oruga
      c.fillStyle = '#a19c90'; c.beginPath();                                    // explanada octogonal de hormigón
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; c.lineTo(X(Math.cos(a) * 170), Z(Math.sin(a) * 170)); } c.fill();
      c.fillStyle = '#b3aea2'; c.fillRect(X(-40), Z(-40), px(80), px(80));
      c.fillStyle = '#26241f'; c.fillRect(X(-9), Z(-130), px(18), px(260));      // trinchera de llamas
      c.fillStyle = 'rgba(40,36,30,0.5)'; c.fillRect(X(-16), Z(-150), px(32), px(300));
    });
    const alfa = lienzo(256, 256, (c, w) => { const gr = c.createRadialGradient(w / 2, w / 2, w * 0.3, w / 2, w / 2, w / 2); gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#000'); c.fillStyle = gr; c.fillRect(0, 0, w, w); });
    const geo = new THREE.RingGeometry(1, RS, 128, 24); geo.rotateX(-Math.PI / 2);
    const RE = 6.37 / K0, P = geo.attributes.position;                          // se curva con la Tierra (a la escala del cohete)
    for (let i = 0; i < P.count; i++) { const x = P.getX(i), z = P.getZ(i); P.setY(i, -(x * x + z * z) / (2 * RE) + 0.6); }
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex(suelo), alphaMap: tex(alfa, false), transparent: true, roughness: 1, metalness: 0 })));

    const gris = new THREE.MeshStandardMaterial({ color: 0x74777b, roughness: 0.8, metalness: 0.2 });
    const oscuro = new THREE.MeshStandardMaterial({ color: 0x3a3b3d, roughness: 0.8, metalness: 0.3 });
    const caja = (w, h, d, x, y, z, m = gris) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); g.add(b); return b; };
    for (const [x, z] of [[-18, -14], [18, -14], [-18, 14], [18, 14], [-18, 0], [18, 0]]) caja(3, 6, 3, x, 3, z);     // pedestales
    const mlp = caja(49, 7.6, 41, 0, 9.8, -4);                                                                           // plataforma móvil de lanzamiento
    mlp.material = new THREE.MeshStandardMaterial({ color: 0x7a7d80, roughness: 0.75, metalness: 0.25 });
    caja(14, 0.2, 14, 0, 13.65, 0, oscuro);                                                                              // hueco de escape
    // torre umbilical: celosía roja de 12 × 12 m y 121 m sobre la plataforma, con grúa en lo alto
    const celosia = lienzo(128, 128, (c, w, h) => {
      c.strokeStyle = '#fff'; c.lineWidth = 9; c.strokeRect(0, 0, w, h);
      c.lineWidth = 5; c.beginPath(); c.moveTo(0, 0); c.lineTo(w, h); c.moveTo(w, 0); c.lineTo(0, h); c.stroke();
    });
    const tc = tex(celosia, false); tc.wrapS = tc.wrapT = THREE.RepeatWrapping; tc.repeat.set(2, 20);
    const rojoT = new THREE.MeshStandardMaterial({ color: 0xa63a28, roughness: 0.65, metalness: 0.3, alphaMap: tc, alphaTest: 0.5, side: THREE.DoubleSide });
    const rojo = new THREE.MeshStandardMaterial({ color: 0xa63a28, roughness: 0.65, metalness: 0.3 });
    const yT = 13.6, zT = -22;
    caja(12, 121, 12, 0, yT + 60.5, zT, rojoT);
    caja(12, 1.2, 12, 0, yT + 121, zT, new THREE.MeshStandardMaterial({ color: 0xa63a28, roughness: 0.7 }));
    caja(3, 3, 26, 0, yT + 124, zT + 2, rojo);
    caja(0.6, 12, 0.6, 0, yT + 131, zT, oscuro);                                                                         // pararrayos
    this.brazos = [];
    for (const [h, r, antes] of [[20, 5.03, 0], [40, 5.03, 0], [52, 5.03, 0], [64, 5.03, 0], [78, 3.3, 0], [86, 3.3, 0], [99, 1.95, 1]]) {
      const piv = new THREE.Group(); piv.position.set(3.5, yT + h, zT + 6); g.add(piv);
      const L = -zT - 6 - r - 0.4, b = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, L), rojo); b.position.set(-3.5, 0, L / 2); piv.add(b);
      if (antes) { const cab = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3, 3), new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.7 })); cab.position.set(-3.5, 0, L - 1); piv.add(cab); }
      this.brazos.push({ piv, antes });
    }
    this.anclajes = [];
    for (let i = 0; i < 4; i++) {                                                // brazos de sujeción
      const a = (i * Math.PI) / 2 + Math.PI / 4, piv = new THREE.Group(); piv.position.set(Math.sin(a) * 7.2, 13.7, Math.cos(a) * 7.2); piv.rotation.y = a; g.add(piv);
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 3.2, 2.6), oscuro); b.position.set(0, 1.6, -0.6); piv.add(b); this.anclajes.push(piv);
    }
    // humo y vapor de la trinchera y de la plataforma
    const n = 1300, ign = EV.ign;
    this.humo = nubeParticulas(n, (i, aB) => {
      const e = i < n * 0.38 ? 0 : i < n * 0.76 ? 1 : 2, fin = e === 2 ? EV.lift + 0.02 : EV.lift + 0.05;
      aB[i * 4] = ign + Math.random() * (fin - ign); aB[i * 4 + 1] = 5 + Math.random() * 4; aB[i * 4 + 2] = e;
    }, { color0: 0x8c8b88, color1: 0xf1f0ec });
    this.humo.userData.u.uEsc.value = K0; g.add(this.humo);
    return g;
  }

  // cielo diurno alrededor de la cámara mientras está en la atmósfera baja; el suelo lo tapa por profundidad
  _cielo() {
    const u = { uUp: { value: new V3(0, 1, 0) }, uA: { value: 0 } };
    const m = new THREE.Mesh(new THREE.SphereGeometry(3, 48, 24), new THREE.ShaderMaterial({
      uniforms: u, side: THREE.BackSide, transparent: true, depthWrite: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uUp; uniform float uA; varying vec3 vD; void main(){
        float h = dot(normalize(vD), uUp);
        vec3 c = mix(vec3(0.74, 0.84, 0.97), vec3(0.2, 0.42, 0.86), smoothstep(0.0, 0.55, h));
        float a = uA;
        gl_FragColor = vec4(c, a); }`,
    }));
    m.renderOrder = -5; m.frustumCulled = false; m.visible = false; m.userData.u = u; return m;
  }

  // ---------- trayectoria ----------
  preparar(id, dur, fin) {
    this.reiniciar();
    const v = this.v, E = this.POS.earth, D = this.POS[id], bE = v.bodies.earth, bD = v.bodies[id];
    const u0 = this.ll(LC39A.lat, LC39A.lon, 1).applyQuaternion(bE.pivot.quaternion).normalize();
    const d = D.clone().sub(E).normalize();
    const f0 = d.clone().addScaledVector(u0, -d.dot(u0)); if (f0.lengthSq() < 1e-6) f0.crossVectors(new V3(0, 1, 0), u0); f0.normalize();
    const Np = new V3().crossVectors(u0, f0).normalize();
    const thD = Math.atan2(d.dot(f0), d.dot(u0));
    let thT = thD - 1.25; while (thT < 0.85) thT += Math.PI * 2;             // inyección ~70° antes de la dirección del destino
    const RE = bE.R, Rp = RE * 1.03, Rpad = RE + K0 * (CUBIERTA + 52.3);
    // velocidad angular: nula en el despegue (subida vertical), giro gravitatorio, órbita, aceleración en la inyección
    const N = 3000, p0 = EV.lift, p1 = EV.tli1, tab = new Float32Array(N + 1);
    const g = (p) => sm(EV.lift, EV.orb, p) ** 3 * (1 + 0.5 * sm(EV.tli0, EV.tli1, p));   // sube vertical hasta librar la torre
    for (let i = 1; i <= N; i++) { const a = p0 + ((i - 1) / N) * (p1 - p0), b = p0 + (i / N) * (p1 - p0); tab[i] = tab[i - 1] + 0.5 * (g(a) + g(b)) * (b - a); }
    const G = (p) => { const x = Math.min(N, Math.max(0, ((p - p0) / (p1 - p0)) * N)), i = Math.floor(x), f = x - i; return i >= N ? tab[N] : tab[i] + (tab[i + 1] - tab[i]) * f; };
    const W = thT / G(EV.tli0);
    const rT = (p) => {
      if (p <= EV.lift) return Rpad;
      const s = Math.min(1, ((p - EV.lift) / (EV.orb - EV.lift)) ** 1.7);
      return Rpad + (Rp - Rpad) * (1 - (1 - s) ** 2) + Rp * 0.45 * sm(EV.tli0, EV.tli1, p) ** 2;
    };
    const tierra = (p, o) => { const th = p <= EV.lift ? 0 : W * G(p), r = rT(p); return o.copy(u0).multiplyScalar(Math.cos(th) * r).addScaledVector(f0, Math.sin(th) * r).add(E); };
    // destino: órbita en el plano (e1 = hacia la Tierra, e2 = lado que ve la cámara final), llegada tangente
    const e1 = E.clone().sub(D).normalize();
    const e2 = new V3().crossVectors(new V3(0, 1, 0), e1).normalize().addScaledVector(new V3(0, 1, 0), 0.35);
    e2.addScaledVector(e1, -e2.dot(e1)).normalize();
    if (e2.dot(fin.pos.clone().sub(D)) < 0) e2.negate();
    const No = new V3().crossVectors(e1, e2).normalize();
    const ro = bD.R * 1.16, Wd = ((Math.PI * 2) / 45) * dur;                   // una vuelta cada 45 s
    const fiP = (p) => {                                                        // ∫ ω: frena de 1,8·W a W durante la inserción
      const a = EV.loi0, b = EV.loi1, n = 60, q = Math.min(p, 1.5); let x = 0;
      for (let i = 0; i < n; i++) { const t = a + ((i + 0.5) / n) * (q - a); x += (1 + 0.8 * (1 - sm(a, b, t))) * ((q - a) / n); }
      return Math.PI / 2 + Wd * x;
    };
    const rD = (p) => ro * (1 + 0.1 * (1 - sm(EV.loi0, EV.loi1, p)));
    const destino = (p, o) => { const f = fiP(p), r = rD(p); return o.copy(e1).multiplyScalar(Math.cos(f) * r).addScaledVector(e2, Math.sin(f) * r).add(D); };
    // transferencia: Bézier cúbica con las velocidades de los extremos (continuidad C1)
    const h = 1e-4, A = tierra(EV.tli1, new V3()), Va = tierra(EV.tli1, new V3()).sub(tierra(EV.tli1 - h, new V3())).divideScalar(h);
    const B = destino(EV.loi0, new V3()), Vb = destino(EV.loi0 + h, new V3()).sub(B).divideScalar(h);
    const dT = EV.loi0 - EV.tli1, P1 = A.clone().addScaledVector(Va, dT / 3), P2 = B.clone().addScaledVector(Vb, -dT / 3);
    const curva = new THREE.CubicBezierCurve3(A, P1, P2, B);
    const pos = (p, o = new V3()) => (p <= EV.tli1 ? tierra(p, o) : p < EV.loi0 ? o.copy(curva.getPoint((p - EV.tli1) / dT)) : destino(p, o));
    this.plan = { id, dur, fin, E, D, RE, Rd: bD.R, u0, f0, Np, No, e1, e2, ro, Wd, pos, fiP };

    // plataforma en LC-39A, con su sistema de referencia (x = normal de la órbita, y = vertical, z = rumbo)
    this.pad.position.copy(u0).multiplyScalar(RE).add(E);
    this.pad.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(Np, u0, f0));
    this.pad.scale.setScalar(K0); this.pad.visible = true;
    // estela del ascenso (en coordenadas de mundo)
    this.estela = nubeParticulas(900, (i, aB, P) => {
      const p = EV.lift + 0.006 + Math.random() * 0.07, c = pos(p), t = pos(p + 1e-4).sub(c).normalize();
      c.addScaledVector(t, -K0 * 60); P.set([c.x, c.y, c.z], i * 3);
      aB[i * 4] = p; aB[i * 4 + 1] = 4 + Math.random() * 3; aB[i * 4 + 2] = 3;
    }, { color0: 0xb9b7b2, color1: 0xeeeeea, alfa: 0.55, mundo: true });
    this.estela.userData.u.uEsc.value = K0; this.estela.userData.u.uDur.value = dur; v.scene.add(this.estela);
    this.humo.userData.u.uDur.value = dur;
    // línea de la trayectoria, que se dibuja tras el vehículo
    const n = 900, tp = new Float32Array(n * 3), tq = new Float32Array(n);
    for (let i = 0; i < n; i++) { const p = EV.orb + (i / (n - 1)) * (EV.loi1 - EV.orb), c = pos(p); tp.set([c.x, c.y, c.z], i * 3); tq[i] = p; }
    const gl = new THREE.BufferGeometry(); gl.setAttribute('position', new THREE.BufferAttribute(tp, 3)); gl.setAttribute('aP', new THREE.BufferAttribute(tq, 1));
    this.traza = new THREE.Line(gl, new THREE.ShaderMaterial({
      uniforms: { uP: { value: 0 }, uVis: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'attribute float aP; varying float vP; void main(){ vP = aP; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uP, uVis; varying float vP; void main(){ if (vP > uP) discard; float a = (0.18 + 0.6 * smoothstep(uP - 0.2, uP, vP)) * uVis; gl_FragColor = vec4(vec3(0.55, 0.85, 1.0) * a, 1.0); }',
    }));
    this.traza.frustumCulled = false; v.scene.add(this.traza);
    // órbita final
    const ap = []; for (let i = 0; i <= 256; i++) { const f = (i / 256) * Math.PI * 2; ap.push(e1.clone().multiplyScalar(Math.cos(f) * ro).addScaledVector(e2, Math.sin(f) * ro).add(D)); }
    this.anilloOrb = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ap), new THREE.LineBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    v.scene.add(this.anilloOrb);
    this.cohete.visible = true;
  }

  // marco del vehículo en p: centro, proa (y), costado (x, hacia el momento angular) y «arriba» (−z, radial)
  _marco(p, c) {
    const P = this.plan, h = 2e-4;
    const f = p <= EV.lift ? P.u0.clone() : P.pos(Math.min(p + h, 1.6)).sub(P.pos(p - h)).normalize();
    const ref = P.Np.clone().lerp(P.No, sm(EV.tli1, EV.loi0, p)); if (ref.lengthSq() < 1e-4) ref.copy(P.No);
    const x = ref.addScaledVector(f, -ref.dot(f)).normalize(), z = new V3().crossVectors(x, f);
    return { c, f, x, z, up: z.clone().negate() };
  }

  // planos de cámara: cada uno da desplazamiento (respecto al vehículo), punto al que mira y tamaño mínimo en pantalla
  _plano(i, p, M) {
    const P = this.plan, o = (a, b, c, d) => M.x.clone().multiplyScalar(a).addScaledVector(M.f, b).addScaledVector(M.up, c).normalize().multiplyScalar(d);
    const haciaDestino = () => M.c.clone().add(P.D.clone().sub(M.c).normalize().multiplyScalar(0.35));
    switch (i) {
      case 0: { const cam = this.pad.position.clone().addScaledVector(P.Np, 0.07).addScaledVector(P.f0, 0.03).addScaledVector(P.u0, 0.0045);
        return { off: cam.sub(M.c), tgt: M.c.clone().addScaledVector(P.u0, -0.004), frac: 0.4 }; }
      case 1: return { off: o(1, -0.45, 0.2, 0.085), tgt: M.c.clone().addScaledVector(M.f, 0.004), frac: 0.4 };
      case 2: return { off: o(1, -0.9, 0.45, 0.13), tgt: M.c.clone(), frac: 0.35 };
      case 3: return { off: o(0.5, -0.9, 1.0, 1.1), tgt: M.c.clone(), frac: 0.1 };
      case 4: return { off: o(0.6, -1, 0.9, 0.32), tgt: M.c.clone(), frac: 0.22 };
      case 5: return { off: o(1, 0.1, 0.15, 0.16), tgt: M.c.clone(), frac: 0.32 };
      case 6: case 8: return { off: o(0.35, -1, 0.3, 0.22), tgt: haciaDestino(), frac: 0.2 };
      case 7: return { off: o(0.6, 1, 0.2, 0.2), tgt: M.c.clone().add(P.E.clone().sub(M.c).normalize().multiplyScalar(0.12)), frac: 0.22 };   // mirando atrás: la Tierra se aleja
      case 9: return { off: o(1, 0.35, 0.5, 0.45), tgt: M.c.clone(), frac: 0.14 };
      default: return { off: P.fin.pos.clone().sub(M.c), tgt: P.fin.target.clone(), frac: 0.03 };
    }
  }

  pose(p) {
    const v = this.v, P = this.plan, cam = v.camera;
    const c = P.pos(p), M = this._marco(p, c);
    const st = this.cohete.userData.actualizar(p, P.id === 'mars');
    // mezcla de planos: pesos que suman 1 (transiciones suaves en cada límite)
    const B = [0, 0.068, 0.152, 0.296, 0.426, 0.507, 0.66, 0.715, 0.775, 0.866, 0.935], Hw = [0, 0.012, 0.01, 0.016, 0.012, 0.008, 0.012, 0.012, 0.012, 0.014, 0.03];
    const A = (i) => (i === 0 ? 1 : i >= B.length ? 0 : sm(B[i] - Hw[i], B[i] + Hw[i], p));
    const dir = new V3(), tgt = new V3(); let ld = 0, frac = 0;
    for (let i = 0; i < B.length; i++) {
      const w = A(i) * (1 - A(i + 1)); if (w < 1e-5) continue;
      const s = this._plano(i, p, M), d = s.off.length();
      dir.addScaledVector(s.off.divideScalar(d), w); ld += w * Math.log(d); tgt.addScaledVector(s.tgt, w); frac += w * s.frac;
    }
    const dist = Math.exp(ld); cam.position.copy(c).addScaledVector(dir.normalize(), dist);
    // la cámara nunca se mete bajo el suelo: al mezclar dos planos (p. ej. del de la plataforma al de seguimiento) podía
    // bajar hasta quedar por debajo de la explanada y se veía a través de la Tierra
    for (const [O, rMin] of [[P.E, P.RE + K0 * 12], [P.D, P.Rd * 1.03]]) {
      const rel = cam.position.clone().sub(O), r = rel.length();
      if (r < rMin) cam.position.copy(O).addScaledVector(rel, rMin / r);
    }
    const upT = cam.position.clone().sub(P.E).normalize();                      // horizonte nivelado cerca de la Tierra
    cam.up.copy(upT.lerp(new V3(0, 1, 0), sm(0.3, 0.45, p))).normalize();
    cam.lookAt(tgt); v.controls.target.copy(tgt);
    const s = Math.max(K0, (dist * VISTA * frac) / st.largo); this.escala = s;
    this.cohete.position.copy(c); this.cohete.scale.setScalar(s);
    // maniobra de alabeo al librar la torre (como el programa de balanceo real); se deshace en la órbita de aparcamiento
    const alabeo = 0.6 * sm(0.115, 0.15, p) * (1 - sm(0.32, 0.42, p)), ca = Math.cos(alabeo), sa = Math.sin(alabeo);
    const xr = M.x.clone().multiplyScalar(ca).addScaledVector(M.z, sa), zr = new V3().crossVectors(xr, M.f);
    this.cohete.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xr, M.f, zr));
    this.cohete.visible = true; this.pT = p;
    // vibración de la cámara: máxima con el encendido y el despegue, se apaga al ganar altura
    const tiembla = sm(EV.ign, EV.ign + 0.012, p) * (1 - sm(EV.lift + 0.03, EV.lift + 0.1, p));
    if (tiembla > 0.002) { const seg = performance.now() / 1000, k = 0.0035 * tiembla;
      cam.rotateX(k * (Math.sin(seg * 61) + 0.6 * Math.sin(seg * 97 + 1.3))); cam.rotateY(k * 0.7 * (Math.sin(seg * 53 + 0.7) + 0.6 * Math.sin(seg * 113))); }
    // plataforma: brazos que se retiran y anclajes que se abren
    for (const b of this.brazos) b.piv.rotation.y = 1.25 * (b.antes ? sm(0.0, 0.016, p) : sm(EV.lift - 0.006, EV.lift + 0.004, p));
    for (const a of this.anclajes) a.rotation.x = -0.6 * sm(EV.lift - 0.002, EV.lift + 0.003, p);
    this.pad.visible = p < 0.14;
    this.humo.userData.u.uT.value = p; this.estela.userData.u.uT.value = p;
    this.estela.visible = p < 0.4;
    this.traza.material.uniforms.uP.value = p; this.traza.material.uniforms.uVis.value = 1 - 0.7 * sm(0.93, 1, p);
    this.anilloOrb.material.opacity = 0.22 * sm(0.9, 1, p);
    return { fase: st.fase, resta: 1 - sm(EV.tli1, EV.loi0, p) };
  }

  // fin del viaje: la cámara vuelve a ser libre y el vehículo queda en órbita circular, en tiempo real
  llegar() {
    const P = this.plan; this.v.camera.up.set(0, 1, 0);
    // escala fija en órbita: la del último fotograma del viaje (sin salto al llegar). Antes crecía con la distancia de la
    // cámara para mantener un tamaño mínimo en pantalla, y al acercar o alejar el zoom el vehículo cambiaba de tamaño.
    this.orb = { t0: performance.now() / 1000, f0: P.fiP(1), w: (Math.PI * 2) / 45, L: 16.7, esc: this.escala };
    this.traza.material.uniforms.uVis.value = 0.3;
  }

  puedeAterrizar(id) { return !!this.orb && this.plan?.id === id; }

  // posición en la órbita final para el instante t (s)
  _enOrbita(t, o = new V3()) {
    const P = this.plan, f = this.orb.f0 + this.orb.w * (t - this.orb.t0);
    return o.copy(P.e1).multiplyScalar(Math.cos(f) * P.ro).addScaledVector(P.e2, Math.sin(f) * P.ro).add(P.D);
  }

  // ---------- descenso del LM hasta el emplazamiento elegido ----------
  async aterrizar(site) {
    const v = this.v, P = this.plan, id = P.id, b = v.bodies[id], cam = v.camera, lm = this.lm;
    const n = this.ll(site.lat, site.lon, 1).applyQuaternion(b.pivot.quaternion).normalize();
    const S = P.D.clone().addScaledVector(n, b.surfaceR?.(site.lat, site.lon) ?? b.R);
    const desdeSuelo = this.lmModo === 'suelo', desdePila = this.lmModo === 'pila';
    this.alPosar = null; this._quitarPlasma();                                   // si ya bajaba hacia otro emplazamiento, sigue desde donde está
    if (desdePila) {                                                             // se suelta del CSM: pasa a coordenadas de mundo
      lm.updateWorldMatrix(true, false); v.scene.attach(lm); this.orb.L = 11;
    }
    const P0 = lm.position.clone();
    const ahora = performance.now() / 1000;
    const vel0 = desdeSuelo ? new V3() : desdePila                               // velocidad inicial (unidades/s)
      ? this._enOrbita(ahora + 0.05).sub(this._enOrbita(ahora - 0.05)).multiplyScalar(10) : (this.lmVel ?? new V3()).clone();
    const Hh = S.clone().addScaledVector(n, b.R * 0.05);
    const dur = desdeSuelo ? 7 : 10;
    // Ruta: arco alrededor del cuerpo (dirección que gira de la de salida a la del emplazamiento) con el radio mandado
    // aparte. El radio nunca baja del de salida ni del de llegada, y se eleva más cuanto más lejos queda el lugar:
    // aunque esté al otro lado, el módulo rodea el planeta en vez de cruzarlo.
    const rel0 = P0.clone().sub(P.D), r0 = rel0.length(), d0 = rel0.divideScalar(r0), rH = Hh.distanceTo(P.D);
    const giro0 = vel0.addScaledVector(d0, -vel0.dot(d0)).divideScalar(r0);       // velocidad tangencial inicial (rad/s): sigue la órbita y se frena
    const Tarco = 0.78 * dur, FRENO = 0.6, lejos = d0.angleTo(n) / Math.PI;
    const sube = Math.max(0, b.R * (1.04 + 0.14 * lejos) - (r0 + rH) / 2);
    const dI = new V3(), qA = new THREE.Quaternion(), qI = new THREE.Quaternion();
    const arco = (u, o) => {
      dI.copy(d0).addScaledVector(giro0, Tarco * (u < FRENO ? u - (u * u) / (2 * FRENO) : FRENO / 2)).normalize();
      const s = u * u * u * (10 - 15 * u + 6 * u * u), su = u * u * (3 - 2 * u), sn = Math.sin(Math.PI * u);
      qA.setFromUnitVectors(dI, n); o.copy(dI).applyQuaternion(qI.identity().slerp(qA, s));
      return o.multiplyScalar(r0 + (rH - r0) * su + sube * sn * sn).add(P.D);
    };
    // cámara final: a ~0,35 R del lugar, del lado desde el que se miraba, algo elevada
    const lado = cam.position.clone().sub(S); lado.addScaledVector(n, -lado.dot(n));
    if (lado.lengthSq() < 1e-8) lado.crossVectors(n, new V3(0, 1, 0)); lado.normalize();
    const camFin = S.clone().addScaledVector(n, b.R * 0.2).addScaledVector(lado, b.R * 0.3);
    const cam0 = cam.position.clone(), tgt0 = v.controls.target.clone();
    const ruta = (t, o) => (t < 0.78 ? arco(t / 0.78, o) : o.copy(Hh).lerp(S, 1 - (1 - (t - 0.78) / 0.19) ** 2 * (t < 0.97 ? 1 : 0)));
    // la cámara también rodea el cuerpo (misma idea: dirección que gira y radio aparte) en vez de ir en línea recta
    const cr0 = cam0.clone().sub(P.D), rc0 = cr0.length(), c0 = cr0.divideScalar(rc0);
    const crF = camFin.clone().sub(P.D), rcF = crF.length(), cF = crF.divideScalar(rcF);
    const qC = new THREE.Quaternion().setFromUnitVectors(c0, cF), qCi = new THREE.Quaternion(), subeCam = b.R * 0.5 * (c0.angleTo(cF) / Math.PI);
    const polvo = this._polvo(id, S, n);
    const plasma = id === 'mars' ? halo(0xff8a40, 1) : null; if (plasma) { v.scene.add(plasma); this.plasma = plasma; }
    // Deja el LM posado y vertical en el emplazamiento. Se llama al acabar el descenso o, con interrumpido = true, si otra
    // animación de cámara lo corta (cerrar la ficha, ir a la Tierra): el módulo no se queda colgado a medio camino.
    const posar = (interrumpido = false) => {
      this.alPosar = null; this._quitarPlasma();
      const fr = lado.clone().addScaledVector(n, -lado.dot(n)).normalize();
      lm.position.copy(S); lm.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new V3().crossVectors(n, fr), n, fr));
      lm.userData.patas(1); lm.userData.motor(0, 0);
      this.lmEsc = lm.scale.x;                                                   // se queda con el tamaño del final del descenso
      this.lmModo = 'suelo'; this.lmSuelo = { S, n };
      this.polvoT0 = performance.now() / 1000 - (interrumpido ? 99 : polvo.userData.u.uT.value);   // interrumpido: sin nube de polvo
    };
    this.lmModo = 'vuelo'; lm.visible = true;
    const a = new V3(), q = new THREE.Quaternion(), M = new THREE.Matrix4();
    const descenso = v._run(dur, (t) => {
      const te = Math.min(t, 0.97); ruta(te, a); const sig = ruta(Math.min(te + 0.004, 0.97), new V3());
      const vel = sig.sub(a); if (vel.lengthSq() > 1e-12) this.lmVel = vel.clone().divideScalar(0.004 * dur);
      lm.position.copy(a);
      // actitud: motor de descenso contra la velocidad (frenado) y cabeceo hasta quedar vertical sobre el suelo que
      // tiene debajo (puerta alta → baja); en un salto entre emplazamientos va siempre vertical
      const vert = a.clone().sub(P.D).normalize();
      const arriba = (vel.lengthSq() > 1e-12 ? vel.clone().normalize().negate() : vert.clone()).lerp(vert, desdeSuelo ? 1 : sm(0.5, 0.8, t)).normalize();
      const fr = lado.clone().addScaledVector(arriba, -lado.dot(arriba)).normalize(), xx = new V3().crossVectors(arriba, fr);
      lm.quaternion.copy(q.setFromRotationMatrix(M.makeBasis(xx, arriba, fr)));
      lm.userData.patas(desdePila ? sm(0, 0.08, t) : 1);
      const k = (desdeSuelo ? sm(0, 0.05, t) : sm(0.08, 0.11, t)) * (1 - sm(0.965, 0.975, t));
      lm.userData.motor(k * (id === 'mars' ? 1.3 : 1), performance.now() / 1000, id === 'mars' ? 0.35 : 1);
      // cámara
      const kc = ease(Math.min(1, t * 1.15));
      cam.position.copy(c0).applyQuaternion(qCi.identity().slerp(qC, kc))
        .multiplyScalar(rc0 + (rcF - rc0) * kc + subeCam * Math.sin(Math.PI * kc) ** 2).add(P.D);
      const tg = tgt0.clone().lerp(a, sm(0, 0.3, t)); cam.lookAt(tg); v.controls.target.copy(tg);
      this._escalaLM();
      if (plasma) { const kp = sm(0.08, 0.16, t) * (1 - sm(0.3, 0.45, t)); plasma.visible = kp > 0.01; plasma.position.copy(a); plasma.scale.setScalar(lm.scale.x * 16); plasma.material.opacity = kp * 0.9; }
      polvo.userData.u.uT.value = (t - 0.8) * dur; polvo.scale.setScalar(lm.scale.x); polvo.userData.u.uEsc.value = lm.scale.x;
    });
    this.alPosar = posar;                                                        // después de _run: _run corta el descenso anterior, no este
    await descenso;
    posar();
    // la cámara queda libre girando alrededor del LM
    v.controls.target.copy(S); v.controls.minDistance = b.R * 0.04; v.controls.maxDistance = b.R * 4;
    v.controls.enabled = true; v.controls.autoRotate = false; v.controls.update(); v.focusId = id;
  }

  // Otra animación de cámara empieza mientras el LM baja (lo llama Viewer._run): el módulo queda posado en su destino
  interrumpir() { this.alPosar?.(true); }

  _quitarPlasma() {
    if (!this.plasma) return;
    this.v.scene.remove(this.plasma); this.plasma.material.dispose(); this.plasma = null;
  }

  _polvo(id, S, n) {
    if (this.polvo) { this.polvo.parent?.remove(this.polvo); this.polvo.geometry.dispose(); }
    const marte = id === 'mars';
    this.polvo = nubeParticulas(500, (i, aB) => { aB[i * 4] = Math.random() * 2.0; aB[i * 4 + 1] = marte ? 3.5 : 1.6; aB[i * 4 + 2] = 4; aB[i * 4 + 3] = marte ? 0.55 : 1; },
      { color0: marte ? 0xb07a52 : 0xa9a69e, color1: marte ? 0xd6a77c : 0xcfccc4, alfa: marte ? 0.45 : 0.3 });
    this.polvo.position.copy(S); this.polvo.quaternion.setFromUnitVectors(new V3(0, 1, 0), n);
    this.v.scene.add(this.polvo); return this.polvo;
  }

  _escalaLM() {
    if (this.lmModo === 'suelo' && this.lmEsc) { this.lm.scale.setScalar(this.lmEsc); return; }   // posado: tamaño estable con el zoom
    const d = this.v.camera.position.distanceTo(this.lm.position);
    this.lm.scale.setScalar(Math.max(K0, (d * VISTA * 0.09) / 7));
  }

  // ---------- cada fotograma ----------
  frame() {
    const v = this.v, cam = v.camera, seg = performance.now() / 1000;
    if (this.orb && v.mode !== 'flight') {                                      // CSM (+ LM) en órbita circular
      const P = this.plan, c = this._enOrbita(seg), f = this._enOrbita(seg + 0.02).sub(c).normalize();
      const x = P.No.clone().addScaledVector(f, -P.No.dot(f)).normalize(), z = new V3().crossVectors(x, f);
      this.cohete.position.copy(c); this.cohete.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, f, z));
      this.escala = this.orb.esc; this.cohete.scale.setScalar(this.escala);   // tamaño estable con el zoom
      this.cohete.visible = this.plan.D && v.bodies[P.id].group.visible;
      this.anilloOrb.visible = this.cohete.visible;
    }
    if (this.lmModo === 'suelo') {
      this._escalaLM(); this.lm.visible = v.bodies[this.plan.id].group.visible;
      if (this.polvo) { this.polvo.userData.u.uT.value = seg - this.polvoT0; this.polvo.scale.setScalar(this.lm.scale.x); this.polvo.userData.u.uEsc.value = this.lm.scale.x; }
    }
    if (this.cohete.visible) this.cohete.userData.animar(seg, this.escala);
    if (this.polvo) this.polvo.userData.u.uPx.value = v.renderer.domElement.height / VISTA;
    for (const m of [this.humo, this.estela]) if (m) m.userData.u.uPx.value = v.renderer.domElement.height / VISTA;
    if (this.humo) this.humo.userData.u.uLuz.value = this.pT != null && this.pT < EV.lift + 0.03 ? sm(EV.ign, EV.ign + 0.01, this.pT) * 0.5 : 0;
    // cielo diurno y plano cercano según la altitud y la distancia a lo que se mira
    const E = this.POS.earth, alt = cam.position.distanceTo(E) - (v.bodies.earth?.R ?? 6.37), u = this.cielo.userData.u;
    u.uA.value = v.mode === 'flight' ? 1 - sm(0.012, 0.075, alt) : 0;
    this.cielo.visible = u.uA.value > 0.003;
    if (this.cielo.visible) { this.cielo.position.copy(cam.position); u.uUp.value.copy(cam.position).sub(E).normalize(); }
    const foco = v.mode === 'flight' ? this.cohete.position : v.controls.target;
    const near = Math.min(0.1, Math.max(0.0006, cam.position.distanceTo(foco) * 0.04));
    if (Math.abs(near - cam.near) / cam.near > 0.05) { cam.near = near; cam.updateProjectionMatrix(); }
  }

  reiniciar() {
    const v = this.v;
    this.alPosar = null; this._quitarPlasma();
    this.cohete.userData.ponLM(); this.lmModo = 'pila'; this.lmSuelo = null; this.lmVel = null; this.lmEsc = null;
    this.cohete.userData.actualizar(0, false); this.cohete.visible = false;
    for (const k of ['estela', 'traza', 'anilloOrb', 'polvo']) { const o = this[k]; if (o) { v.scene.remove(o); o.geometry.dispose(); o.material.dispose?.(); this[k] = null; } }
    this.pad.visible = false; this.cielo.visible = false; this.orb = null; this.plan = null; this.pT = null;
    v.camera.up.set(0, 1, 0);
  }
}
