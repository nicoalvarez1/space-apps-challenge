// Misión completa del Saturno V: plataforma LC-39A, ascenso, órbita de aparcamiento, inyección, crucero,
// captura en órbita del destino y, al elegir un emplazamiento, descenso del módulo lunar hasta él.
//
// Escala: los planetas están a 1 unidad = 1000 km (Tierra R = 6,37). El vehículo se dibuja a K0 unidades por metro
// (×300 sobre la escala de los planetas) y, cuando la cámara se aleja, crece para seguir viéndose (tamaño mínimo en
// pantalla). Altitudes, ángulos de la trayectoria y orden de las fases siguen las misiones Apolo; los tiempos, no:
// el viaje real de 3 días (o 7 meses a Marte) se comprime en unos 40 s.
import * as THREE from 'three';
import { EV, Y, sm, crearSaturnoV, halo } from './saturno5.js';

const K0 = 3e-4;
const VISTA = 2 * Math.tan((22.5 * Math.PI) / 180);       // alto visible a distancia 1 con el FOV de 45°
const LC39A = { lat: 28.6082, lon: -80.6041 };            // Complejo de lanzamiento 39A, Centro Espacial Kennedy
const CUBIERTA = 14.0;                                     // m: base del S-IC sobre el suelo (pedestales + plataforma móvil)
const V3 = THREE.Vector3;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function lienzo(w, h, pintar) { const c = document.createElement('canvas'); c.width = w; c.height = h; pintar(c.getContext('2d'), w, h); return c; }
function tex(c, color = true) { const t = new THREE.CanvasTexture(c); if (color) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }

let _bocanada = null, _sombraTex = null;
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

// Partículas de humo/polvo calculadas en el shader como función del tiempo de misión (saltar o congelar es coherente).
// Son cuadriláteros instanciados orientados a la cámara, no THREE.Points: los puntos tienen un tamaño máximo en
// píxeles (511 en muchos portátiles) y las bocanadas grandes dejaban de crecer al acercarse. Tipos de emisor (aB.z):
//   0/1 extremos de la trinchera de llamas · 2 alrededor de la plataforma · 3 estela del ascenso · 4 polvo del LM
//   (aB.w = 1 Luna, 0 Marte) · 5 placas de hielo · 6 vapor de los venteos · 7 nube de la separación del S-IC
function nubeParticulas(n, emisor, { color0, color1, alfa = 0.85, mundo = false }) {
  const aS = new Float32Array(n * 4), aB = new Float32Array(n * 4), pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { for (let k = 0; k < 4; k++) aS[i * 4 + k] = Math.random(); emisor(i, aB, pos); }
  const g = new THREE.InstancedBufferGeometry(), q = new THREE.PlaneGeometry(1, 1);
  g.index = q.index; g.setAttribute('position', q.attributes.position); g.instanceCount = n;
  g.setAttribute('aP', new THREE.InstancedBufferAttribute(pos, 3)); g.setAttribute('aS', new THREE.InstancedBufferAttribute(aS, 4)); g.setAttribute('aB', new THREE.InstancedBufferAttribute(aB, 4));
  const u = { uT: { value: -1 }, uDur: { value: 1 }, uPx: { value: 500 }, uLuz: { value: 0 }, uEsc: { value: 1 }, uTex: { value: texBocanada() }, uSolV: { value: new V3(0.6, 0.6, 0.5) },
    uC0: { value: new THREE.Color(color0) }, uC1: { value: new THREE.Color(color1) }, uAlfa: { value: alfa } };
  const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false,
    vertexShader: `uniform float uT, uDur, uLuz, uEsc; attribute vec3 aP; attribute vec4 aS; attribute vec4 aB;
      varying float vA; varying float vL; varying float vCal; varying float vB; varying vec2 vUv; varying vec2 vQ;
      void main() {
        vB = 0.9 + 0.18 * aS.y;
        float edad = (uT - aB.x) * uDur; vA = 0.0; vL = 0.0; vCal = 0.0; vUv = vec2(0.5); vQ = vec2(0.0);
        if (edad < 0.0 || edad > aB.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        float vida = aB.y, e = aB.z, tam, entra = 0.3, estira = 1.0, lejos = 1.0; vec3 p, dir = vec3(1.0, 0.0, 0.0);
        if (e < 1.5) {                                   // vapor de agua (supresión de sonido) y gases que salen por los
          float sg = e < 0.5 ? 1.0 : -1.0, ang = (aS.x - 0.5) * 1.3;   // dos extremos de la trinchera: se frenan por el
          float d = 230.0 * (0.4 + 0.8 * aS.y) * (1.0 - exp(-edad / 1.6));   // arrastre y suben por flotación
          tam = 16.0 + edad * (12.0 + 14.0 * aS.w) + d * 0.2;
          p = vec3(sin(ang) * d * 0.9, edad * (2.5 + 8.0 * aS.z) + edad * edad * (0.6 + 1.4 * aS.z), sg * (60.0 + cos(ang) * d));
          vCal = clamp(0.25 + p.y / 110.0, 0.0, 1.0);
        } else if (e < 2.5) {                            // vapor del agua que inunda la plataforma móvil
          float a = aS.x * 6.2832, d = 22.0 + 48.0 * (1.0 - exp(-edad / 2.0)) * aS.y;
          tam = 12.0 + edad * (9.0 + 10.0 * aS.w);
          p = vec3(cos(a) * d, 4.0 + edad * (5.0 + 8.0 * aS.z), sin(a) * d);
          if (aB.w > 0.5) {                              // bajo la plataforma: el chorro entra en la trinchera y el vapor
            d = 3.0 + 17.0 * (1.0 - exp(-edad / 0.7)) * aS.y;   // sale por el hueco entre la cubierta y el suelo
            tam = 7.0 + edad * (6.0 + 8.0 * aS.w); entra = 0.12;
            p = vec3(cos(a) * d, 1.5 + edad * (1.5 + 3.0 * aS.z), sin(a) * d - 4.0);
          }
          vCal = clamp(0.3 + p.y / 110.0, 0.0, 1.0);
        } else if (e < 3.5) {                            // estela del ascenso (nacimiento en aP, en mundo: la deriva va
          p = aP + (aS.xyz - 0.5) * edad * 14.0 * uEsc;  // en metros, a la escala del vehículo)
          tam = 14.0 + edad * (14.0 + 16.0 * aS.w); vCal = 0.4 + 0.6 * aS.z;
        } else if (e < 4.5) {                            // polvo bajo el motor de descenso del LM (m del LM, y = normal)
          float a = aS.x * 6.2832 + aB.w * 0.25 * sin(aS.x * 37.0); dir = vec3(cos(a), 0.0, sin(a));   // en la Luna, en rayos
          if (aB.w > 0.5) {                              // Luna: sin aire, láminas rasantes que salen en línea recta y deprisa
            float d = 1.8 + edad * (28.0 + 46.0 * aS.y);  // (1–3° sobre el suelo); no flotan ni suben: se adelgazan y se van
            tam = 0.7 + 0.5 * aS.w + d * 0.035; estira = 3.0 + 3.0 * aS.z; entra = 0.05;
            p = dir * d + vec3(0.0, max(0.12 + d * (0.012 + 0.035 * aS.z), tam * 0.3), 0.0);
            lejos = exp(-d / 38.0);
          } else {                                       // Marte: el aire tenue frena el polvo, que sube en nube y se dispersa
            float d = 2.0 + (8.0 + 15.0 * aS.y) * (1.0 - exp(-edad / 1.2));
            tam = 2.0 + edad * (1.5 + 2.0 * aS.w) + d * 0.1; entra = 0.25;
            p = dir * d + vec3(edad * 1.1, 0.4 + (1.2 + 3.8 * aS.z) * (1.0 - exp(-edad / 1.6)) + edad * 0.35 * aS.z, edad * 0.4);
            p.y = max(p.y, tam * 0.36);
          }
          vCal = 0.25 + 0.75 * aS.z;
        } else if (e < 5.5) {                            // placas de hielo que se desprenden de los tanques en el despegue
          vec2 r = normalize(aP.xz + 1e-4);
          p = aP + vec3(r.x, 0.0, r.y) * edad * (1.5 + 3.0 * aS.y) + vec3(0.0, -(14.0 + 6.0 * aS.z) * edad * edad, 0.0);
          p.y = max(p.y, 14.0); tam = 0.5 + 1.1 * aS.w; vCal = 1.0;
        } else if (e < 6.5) {                            // vapor de los venteos y de la escarcha: el gas frío cae por el costado
          vec2 r = normalize(aP.xz + 1e-4);
          p = aP + vec3(r.x, 0.0, r.y) * edad * (1.2 + 2.5 * aS.y) + vec3(2.5 * edad, -(2.0 + 4.0 * aS.z) * edad, 0.8 * edad);
          tam = 2.5 + edad * (3.5 + 3.0 * aS.w); vCal = 0.7;
        } else {                                         // separación del S-IC: globo de gases de los retrocohetes y de los
          vec3 r = normalize(aS.xyz - 0.5 + 1e-3);       // J-2 que se abre en el aire enrarecido (en m del vehículo)
          p = aP + r * uEsc * 75.0 * (0.35 + 0.65 * aS.y) * (1.0 - exp(-edad / 0.9));
          tam = 22.0 + edad * (24.0 + 22.0 * aS.w); entra = 0.08; vCal = 0.5 + 0.5 * aS.z;
        }
        if (e < 2.5) p.y = max(p.y, tam * 0.38);         // la bocanada nunca se corta contra el suelo
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float S = tam * uEsc, rot = aS.w * 6.2832 + edad * 0.05 * (aS.z - 0.5), cs = cos(rot), sn = sin(rot);
        vec2 c = position.xy, cr = vec2(cs * c.x - sn * c.y, sn * c.x + cs * c.y);
        vUv = c + 0.5; vQ = cr;
        if (estira > 1.0) {                              // lámina: alargada en la dirección del movimiento vista en pantalla
          vec2 dv = (modelViewMatrix * vec4(dir, 0.0)).xy; float l = length(dv) / uEsc;
          vec2 ax = l > 1e-4 ? normalize(dv) : vec2(1.0, 0.0), ay = vec2(-ax.y, ax.x);
          mv.xy += (c.x * (1.0 + (estira - 1.0) * clamp(l, 0.0, 1.0)) * ax + c.y * ay) * S; vQ = c;
        } else mv.xy += cr * S;
        gl_Position = projectionMatrix * mv;
        vA = smoothstep(0.0, entra, edad) * (1.0 - smoothstep(vida * 0.5, vida, edad)) * lejos;
        vL = (e < 2.5 || (e > 4.5 && e < 6.5)) ? uLuz * exp(-length(p.xz) / 70.0) * exp(-p.y / 35.0) : 0.0;   // resplandor de las llamas, solo cerca
      }`,
    fragmentShader: `uniform sampler2D uTex; uniform vec3 uC0, uC1, uSolV; uniform float uAlfa; varying float vA; varying float vL; varying float vCal; varying float vB; varying vec2 vUv; varying vec2 vQ;
      void main() {
        // canal alfa: el lienzo se sube sin premultiplicar y su rojo vale 1 hasta el borde (salían discos de canto duro)
        float d = texture2D(uTex, vUv).a;
        float a = smoothstep(0.0, 0.75, d) * vA * uAlfa; if (a < 0.004) discard;
        // volumen: cada bocanada se sombrea como una esfera iluminada por el Sol (en espacio de vista), algo más clara
        // por arriba (luz del cielo) y un poco más oscura donde es más densa
        vec3 nrm = vec3(vQ * 2.0, sqrt(max(0.0, 1.0 - 4.0 * dot(vQ, vQ))));
        float sol = clamp(0.5 + 0.5 * dot(nrm, uSolV), 0.0, 1.0);
        float sombra = mix(0.64, 1.1, sol) * mix(0.93, 1.04, vQ.y + 0.5) * mix(1.03, 0.92, d);
        vec3 col = mix(uC0, uC1, vCal) * vB * sombra + vec3(1.0, 0.74, 0.5) * vL * (0.55 - vQ.y);
        gl_FragColor = vec4(col, a); }`,
  }));
  m.frustumCulled = false; m.renderOrder = 1; m.userData.u = u; m.userData.mundo = mundo; return m;
}

export class Vuelo {
  constructor(viewer, { POS, latLonToLocal }) {
    this.v = viewer; this.POS = POS; this.ll = latLonToLocal;
    this.cohete = crearSaturnoV(); viewer.scene.add(this.cohete);
    this.lm = this.cohete.userData.lm;
    this.pad = this._plataforma(); this.pad.visible = false; viewer.scene.add(this.pad);
    this.cielo = this._cielo(); viewer.scene.add(this.cielo);
    this.traza = null; this.estela = null; this.anilloOrb = null; this.polvo = null;
    this.plan = null; this.orb = null; this.lmModo = 'pila'; this.escala = K0; this.largo = 110;
    this._entorno();
    this._sombras();
  }

  // Sombras del Sol solo para el vehículo y la plataforma: la cámara de sombras es un cubo pequeño que sigue al cohete
  // (frame()), así el mapa de 2048² da ~10 cm por texel en la plataforma. El globo ni proyecta ni recibe.
  _sombras() {
    const r = this.v.renderer, sol = this.v.sun;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    sol.castShadow = true; sol.shadow.mapSize.set(2048, 2048); sol.shadow.bias = -0.0004;
    const marcar = (o) => o.traverse((m) => { if (m.isMesh && m.material?.isMeshStandardMaterial && !m.userData.sinSombra) { m.castShadow = true; m.receiveShadow = true; } });
    marcar(this.cohete); marcar(this.pad);
    this.suelo.castShadow = false;
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
    this.suelo = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex(suelo), alphaMap: tex(alfa, false), transparent: true, roughness: 1, metalness: 0 }));
    g.add(this.suelo);

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
      // brazo en celosía (como la torre) con el conducto blanco de los umbilicales por dentro
      const L = -zT - 6 - r - 0.4, tb = tc.clone(); tb.needsUpdate = true; tb.repeat.set(L / 2.4, 1);
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, L), new THREE.MeshStandardMaterial({ color: 0xa63a28, roughness: 0.65, metalness: 0.3, alphaMap: tb, alphaTest: 0.5, side: THREE.DoubleSide }));
      b.position.set(-3.5, 0, L / 2); piv.add(b);
      const ducto = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, L, 10), new THREE.MeshStandardMaterial({ color: 0xd9d7d0, roughness: 0.6 }));
      ducto.rotation.x = Math.PI / 2; ducto.position.set(-3.5, -0.4, L / 2); piv.add(ducto);
      if (antes) { const cab = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3, 3), new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.7 })); cab.position.set(-3.5, 0, L - 1); piv.add(cab); }
      this.brazos.push({ piv, antes });
    }
    this.anclajes = [];
    for (let i = 0; i < 4; i++) {                                                // brazos de sujeción
      const a = (i * Math.PI) / 2 + Math.PI / 4, piv = new THREE.Group(); piv.position.set(Math.sin(a) * 7.2, 13.7, Math.cos(a) * 7.2); piv.rotation.y = a; g.add(piv);
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 3.2, 2.6), oscuro); b.position.set(0, 1.6, -0.6); piv.add(b); this.anclajes.push(piv);
    }
    // humo y vapor de la trinchera y de la plataforma
    // Es sobre todo vapor de agua (el sistema de supresión de sonido vierte cientos de m³ en la trinchera y la
    // plataforma) mezclado con el escape del F-1: blanco y gris claro, sin tono marrón; el sombreado lo pone el Sol.
    const n = 1500, ign = EV.ign;
    this.humo = nubeParticulas(n, (i, aB) => {
      const e = i < n * 0.4 ? 0 : i < n * 0.8 ? 1 : 2, fin = e === 2 ? EV.lift + 0.02 : EV.lift + 0.05;
      aB[i * 4] = ign + 0.004 + Math.random() ** 1.3 * (fin - ign - 0.004); aB[i * 4 + 1] = 5 + Math.random() * 4; aB[i * 4 + 2] = e;
      if (e === 2 && Math.random() < 0.4) { aB[i * 4] = ign + 0.002 + Math.random() * (EV.lift + 0.01 - ign); aB[i * 4 + 1] = 2.5 + Math.random() * 2; aB[i * 4 + 3] = 1; }
    }, { color0: 0xcfcfcd, color1: 0xfbfbfa, alfa: 0.8 });
    this.humo.userData.u.uEsc.value = K0; g.add(this.humo);
    // vapor de los venteos de LOX/LH2 y de la escarcha (antes del despegue) y placas de hielo que caen al subir
    const zonas = [[14 + 25, 14 + 38, 5.1], [14 + 48, 14 + 54, 5.1], [14 + 73, 14 + 78, 3.4], [14 + 40.5, 14 + 42, 5.1], [14 + 66, 14 + 67.5, 5.1]];
    this.vapor = nubeParticulas(520, (i, aB, P) => {
      const hielo = i < 160, z = zonas[hielo ? i % 3 : i % 5], a = Math.random() * Math.PI * 2, y = z[0] + Math.random() * (z[1] - z[0]);
      P.set([Math.sin(a) * z[2], y, Math.cos(a) * z[2]], i * 3);
      if (hielo) { aB[i * 4] = EV.lift - 0.001 + Math.random() * 0.022; aB[i * 4 + 1] = 1.6 + Math.random() * 1.2; aB[i * 4 + 2] = 5; }
      else { aB[i * 4] = -0.07 + Math.random() * (EV.lift + 0.004 + 0.07); aB[i * 4 + 1] = 2.2 + Math.random() * 1.8; aB[i * 4 + 2] = 6; }
    }, { color0: 0xd4dae2, color1: 0xffffff, alfa: 0.24 });
    this.vapor.userData.u.uEsc.value = K0; g.add(this.vapor);
    return g;
  }

  // cielo diurno alrededor de la cámara mientras está en la atmósfera baja; el suelo lo tapa por profundidad
  _cielo() {
    const u = { uUp: { value: new V3(0, 1, 0) }, uA: { value: 0 }, uK: { value: 0 } };
    const m = new THREE.Mesh(new THREE.SphereGeometry(3, 48, 24), new THREE.ShaderMaterial({
      uniforms: u, side: THREE.BackSide, transparent: true, depthWrite: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }',
      // al subir, el cielo se oscurece primero (cénit casi negro, franja azul en el horizonte) y solo al final se vuelve
      // transparente: antes se desvanecía siendo aún azul claro y las estrellas se veían a través de un cielo de día
      fragmentShader: `uniform vec3 uUp; uniform float uA, uK; varying vec3 vD; void main(){
        float h = dot(normalize(vD), uUp);
        vec3 dia = mix(vec3(0.74, 0.84, 0.97), vec3(0.2, 0.42, 0.86), smoothstep(0.0, 0.55, h));
        vec3 alto = mix(vec3(0.2, 0.34, 0.62), vec3(0.01, 0.018, 0.05), smoothstep(-0.04, 0.35, h));
        gl_FragColor = vec4(mix(dia, alto, uK), uA); }`,
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
    this.humo.userData.u.uDur.value = dur; this.vapor.userData.u.uDur.value = dur;
    // nube de la separación del S-IC: los retrocohetes y el escape de los J-2 al encenderse dejan un globo de humo atrás
    this.nubeSep = nubeParticulas(170, (i, aB, P) => {
      const p = EV.sic + Math.random() ** 1.5 * 0.006, c = pos(p); P.set([c.x, c.y, c.z], i * 3);
      aB[i * 4] = p; aB[i * 4 + 1] = 2.6 + Math.random() * 1.8; aB[i * 4 + 2] = 7;
    }, { color0: 0xc9c4bc, color1: 0xfaf8f4, alfa: 0.42, mundo: true });
    this.nubeSep.userData.u.uDur.value = dur; v.scene.add(this.nubeSep);
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
    this._fundirPad(1 - sm(0.108, 0.136, p));
    // mientras está la plataforma, el chorro del S-IC no se dibuja por debajo de la cubierta de la plataforma móvil
    // (13,65 m): ahí está la trinchera con el deflector; antes asomaba un rectángulo naranja cortado por el suelo
    if (this.pad.visible) this.cohete.userData.recortar(P.u0, P.u0.dot(this.pad.position) + 13.65 * K0, 2.5 * K0);
    else this.cohete.userData.recortar(null);
    this.humo.userData.u.uT.value = p; this.vapor.userData.u.uT.value = p; this.estela.userData.u.uT.value = p; this.largo = st.largo;
    // la nube nace en el plano de separación (Y.sic, 10 m por debajo del centro de la pila entera), no en el centro
    if (p < EV.sic + 0.002) this.nubeSep.position.copy(M.f).multiplyScalar((Y.sic - (Y.tope - 6) / 2) * s);
    this.nubeSep.userData.u.uT.value = p; this.nubeSep.userData.u.uEsc.value = s; this.nubeSep.visible = p > EV.sic && p < 0.3;
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
    // tamaño de partida: el que tenía al soltarse (el de la pila en órbita, fijo con el zoom) o en el suelo; el del
    // descenso (tamaño mínimo en pantalla) se alcanza poco a poco. Antes saltaba de golpe (hasta ×7) en el primer fotograma.
    const esc0 = desdeSuelo && this.lmEsc ? this.lmEsc : lm.scale.x;
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
    // punto de contacto real: el relieve de la malla bajo las 4 patas, con el tamaño que tendrá el LM al final (antes se
    // posaba en surfaceR del centro y, con el relieve exagerado, alguna pata se hundía o el polvo quedaba bajo el suelo)
    const suelo = this._sueloLM(b, n, lado, Math.max(K0, (camFin.distanceTo(S) * VISTA * 0.09) / 7)), Sf = suelo.S, nf = suelo.up;
    const cam0 = cam.position.clone(), tgt0 = v.controls.target.clone();
    const ruta = (t, o) => (t < 0.78 ? arco(t / 0.78, o) : o.copy(Hh).lerp(Sf, 1 - (1 - (t - 0.78) / 0.19) ** 2 * (t < 0.97 ? 1 : 0)));
    // la cámara también rodea el cuerpo (misma idea: dirección que gira y radio aparte) en vez de ir en línea recta
    const cr0 = cam0.clone().sub(P.D), rc0 = cr0.length(), c0 = cr0.divideScalar(rc0);
    const crF = camFin.clone().sub(P.D), rcF = crF.length(), cF = crF.divideScalar(rcF);
    const qC = new THREE.Quaternion().setFromUnitVectors(c0, cF), qCi = new THREE.Quaternion(), subeCam = b.R * 0.5 * (c0.angleTo(cF) / Math.PI);
    const polvo = this._polvo(id, Sf, nf, (0.968 - 0.8) * dur);
    const plasma = id === 'mars' ? halo(0xff8a40, 1) : null; if (plasma) { v.scene.add(plasma); this.plasma = plasma; }
    // Deja el LM posado y vertical en el emplazamiento. Se llama al acabar el descenso o, con interrumpido = true, si otra
    // animación de cámara lo corta (cerrar la ficha, ir a la Tierra): el módulo no se queda colgado a medio camino.
    const posar = (interrumpido = false) => {
      this.alPosar = null; this._quitarPlasma();
      const fr = lado.clone().addScaledVector(nf, -lado.dot(nf)).normalize();
      lm.position.copy(Sf); lm.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new V3().crossVectors(nf, fr), nf, fr));
      lm.userData.patas(1); lm.userData.motor(0, 0); polvo.userData.sombra.material.opacity = 0.55;
      this.lmEsc = lm.scale.x;                                                   // se queda con el tamaño del final del descenso
      this.lmModo = 'suelo'; this.lmSuelo = { S: Sf, n: nf };
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
      const vert = a.clone().sub(P.D).normalize().lerp(nf, sm(0.78, 0.95, t)).normalize();   // acaba con la inclinación del suelo: sin salto al posarse
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
      const kE = sm(0, 0.3, t); lm.scale.setScalar(Math.exp(Math.log(esc0) * (1 - kE) + Math.log(lm.scale.x) * kE));
      if (plasma) { const kp = sm(0.08, 0.16, t) * (1 - sm(0.3, 0.45, t)); plasma.visible = kp > 0.01; plasma.position.copy(a); plasma.scale.setScalar(lm.scale.x * 16); plasma.material.opacity = kp * 0.9; }
      polvo.userData.u.uT.value = (t - 0.8) * dur; polvo.scale.setScalar(lm.scale.x); polvo.userData.u.uEsc.value = lm.scale.x;
      const hLM = a.clone().sub(Sf).dot(nf) / lm.scale.x;                                   // altura del LM sobre el apoyo (m)
      polvo.userData.sombra.material.opacity = 0.55 * (1 - sm(0, 9, hLM));
    });
    this.alPosar = posar;                                                        // después de _run: _run corta el descenso anterior, no este
    await descenso;
    posar();
    // la cámara queda libre girando alrededor del LM
    v.controls.target.copy(S); v.controls.minDistance = b.R * 0.04; v.controls.maxDistance = b.R * 4;
    v.controls.enabled = true; v.controls.autoRotate = false; v.controls.update(); v.focusId = id;
  }

  // La plataforma se desvanece en vez de desaparecer de golpe (antes se apagaba en p = 0,14 con la torre aún en pantalla,
  // y con ella el humo, que es hijo suyo). Los materiales opacos pasan a transparentes solo mientras dura el fundido.
  _fundirPad(k) {
    const pad = this.pad;
    if (!this._matsPad) {
      this._matsPad = [];
      pad.traverse((o) => { if (o.isMesh && o.material?.isMeshStandardMaterial && !this._matsPad.some((x) => x.m === o.material)) this._matsPad.push({ m: o.material, op: o.material.opacity, tr: o.material.transparent, at: o.material.alphaTest }); });
    }
    pad.visible = k > 0.003;
    if (this._kPad === k) return; this._kPad = k;
    // la celosía usa alphaTest: se baja con la opacidad para que no se recorte entera a mitad del fundido
    for (const { m, op, tr, at } of this._matsPad) { m.opacity = op * k; m.transparent = tr || k < 0.999; m.depthWrite = k > 0.5 || tr; if (at) m.alphaTest = at * Math.max(k, 0.02); }
    this.humo.userData.u.uAlfa.value = 0.8 * k; this.vapor.userData.u.uAlfa.value = 0.24 * k;
  }

  // Otra animación de cámara empieza mientras el LM baja (lo llama Viewer._run): el módulo queda posado en su destino
  interrumpir() { this.alPosar?.(true); }

  _quitarPlasma() {
    if (!this.plasma) return;
    this.v.scene.remove(this.plasma); this.plasma.material.dispose(); this.plasma = null;
  }

  // Radio de la superficie que se ve en (lat, lon): la malla es una esfera de W×H segmentos desplazada en los vértices,
  // así que entre vértices el relieve es plano (interpolación en el triángulo de SphereGeometry), no el bilineal de surfaceR
  _radioMalla(b, lat, lon) {
    const f = b.surfaceR; if (!f) return b.R;
    const pr = (b._malla ??= b.pivot.children.find((o) => o.material?.displacementMap)?.geometry.parameters ?? { widthSegments: 512, heightSegments: 256 });
    const W = pr.widthSegments, H = pr.heightSegments, x = ((lon + 180) / 360) * W, y = Math.min(H - 1e-6, Math.max(0, ((90 - lat) / 180) * H));
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, r = (i, j) => f(90 - (j / H) * 180, (i / W) * 360 - 180);
    const hb = r(ix, iy), ha = r(ix + 1, iy), hc = r(ix, iy + 1), hd = r(ix + 1, iy + 1);
    return fx >= fy ? hb + (ha - hb) * fx + (hd - ha) * fy : hb + (hc - hb) * fy + (hd - hc) * fx;
  }

  // Apoyo del LM: plano por el suelo bajo las 4 patas (a 4,25 m del eje), inclinación limitada a 10° y altura tal que
  // ninguna pata se hunde ni la tobera toca un bulto bajo el centro. s = metros → unidades del LM al posarse.
  _sueloLM(b, n, fr, s) {
    const D = this.plan.D, qi = b.pivot.quaternion.clone().invert(), x = new V3().crossVectors(n, fr).normalize(), G = 180 / Math.PI;
    const punto = (dir) => {
      const l = dir.clone().applyQuaternion(qi).normalize();
      return D.clone().addScaledVector(dir, this._radioMalla(b, Math.asin(l.y) * G, Math.atan2(l.z, -l.x) * G - 180));
    };
    const pie = [x, fr, x.clone().negate(), fr.clone().negate()].map((e) => punto(n.clone().multiplyScalar(b.R).addScaledVector(e, 4.25 * s).normalize()));
    const up = new V3().subVectors(pie[1], pie[3]).cross(new V3().subVectors(pie[0], pie[2])).normalize();
    if (up.dot(n) < 0) up.negate();
    const tope = 10 / G, ang = up.angleTo(n);
    if (ang > tope) up.copy(n).lerp(up, tope / ang).normalize();
    const C = pie.reduce((a, p) => a.add(p), new V3()).multiplyScalar(0.25);
    let alza = punto(n).sub(C).dot(up) - 0.4 * s;                                   // la tobera acaba 0,5 m sobre el suelo
    for (const p of pie) alza = Math.max(alza, p.clone().sub(C).dot(up));
    return { S: C.addScaledVector(up, alza), up };
  }

  _polvo(id, S, n, fin) {
    if (this.polvo) { this.polvo.parent?.remove(this.polvo); this.polvo.geometry.dispose(); }
    const marte = id === 'mars';
    // Nace entre que el motor está a ~12 m del suelo (t = 0,8 del descenso) y el apagado del motor (t ≈ 0,968: fin),
    // cada vez más denso al acercarse. Luna: vidas cortas (las láminas salen del encuadre); Marte: la nube dura más.
    this.polvo = nubeParticulas(marte ? 560 : 560, (i, aB) => {
      aB[i * 4] = fin * Math.sqrt(Math.random()); aB[i * 4 + 1] = marte ? 4.5 + Math.random() * 3.5 : 1.0 + Math.random() * 0.8; aB[i * 4 + 2] = 4; aB[i * 4 + 3] = marte ? 0 : 1;
    }, { color0: marte ? 0x9c7a5e : 0xb0aca4, color1: marte ? 0xd6b893 : 0xe6e3dc, alfa: marte ? 0.24 : 0.42 });   // el polvo fino iluminado por el Sol se ve más claro que el suelo
    this.polvo.position.copy(S); this.polvo.quaternion.setFromUnitVectors(new V3(0, 1, 0), n);
    // sombra de contacto bajo el LM (el globo no recibe sombras): un disco oscuro difuminado en el plano de apoyo, hijo
    // del polvo (misma posición, normal y escala). Aparece a medida que el módulo baja: posado, no parece flotar.
    if (!_sombraTex) _sombraTex = tex(lienzo(128, 128, (g) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, '#fff'); gr.addColorStop(0.45, '#bbb'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }), false);
    const sombra = new THREE.Mesh(new THREE.CircleGeometry(6, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: _sombraTex, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    sombra.position.y = 0.03; sombra.renderOrder = 0; this.polvo.add(sombra); this.polvo.userData.sombra = sombra;
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
    for (const m of [this.humo, this.vapor, this.estela, this.nubeSep]) if (m) m.userData.u.uPx.value = v.renderer.domElement.height / VISTA;
    const luzHumo = this.pT != null && this.pT < EV.lift + 0.03 ? sm(EV.ign, EV.ign + 0.01, this.pT) * (1 - sm(EV.lift, EV.lift + 0.03, this.pT)) * 0.3 : 0;
    if (this.humo) this.humo.userData.u.uLuz.value = luzHumo;
    if (this.vapor) this.vapor.userData.u.uLuz.value = luzHumo * 0.6;
    this._sol();
    cam.updateMatrixWorld();
    const solV = v.sunDir.clone().transformDirection(cam.matrixWorldInverse);
    for (const m of [this.humo, this.vapor, this.estela, this.nubeSep, this.polvo]) if (m) m.userData.u.uSolV.value.copy(solV);
    // cielo diurno y plano cercano según la altitud y la distancia a lo que se mira
    const E = this.POS.earth, alt = cam.position.distanceTo(E) - (v.bodies.earth?.R ?? 6.37), u = this.cielo.userData.u;
    u.uA.value = v.mode === 'flight' ? 1 - sm(0.045, 0.08, alt) : 0; u.uK.value = sm(0.006, 0.05, alt);
    this.cielo.visible = u.uA.value > 0.003;
    if (this.cielo.visible) { this.cielo.position.copy(cam.position); u.uUp.value.copy(cam.position).sub(E).normalize(); }
    const foco = v.mode === 'flight' ? this.cohete.position : v.controls.target;
    const near = Math.min(0.1, Math.max(0.0006, cam.position.distanceTo(foco) * 0.04));
    if (Math.abs(near - cam.near) / cam.near > 0.05) { cam.near = near; cam.updateProjectionMatrix(); }
  }

  // Sol coherente durante el ascenso: fijo en el marco de la plataforma (a ~41° de altura, de tres cuartos por el lado
  // contrario a la torre: la sombra del cohete cae hacia atrás, sobre la explanada), y no pegado a la cámara. Al ganar altura vuelve poco a poco a la
  // regla general de la escena (el Sol acompaña a la cámara para que siempre se vea la cara iluminada de los cuerpos).
  _sol() {
    const v = this.v, sol = v.sun;
    if (v.mode === 'flight' && this.plan && this.pT != null) {
      const w = 1 - sm(0.2, 0.33, this.pT), P = this.plan;
      if (w > 0) v.sunDir.lerp(P.f0.clone().multiplyScalar(0.6).addScaledVector(P.Np, 0.45).addScaledVector(P.u0, 0.66).normalize(), w).normalize();
    }
    if (!this.cohete.visible) return;
    // cámara de sombras alrededor del cohete: en la plataforma abarca la torre y el suelo; después, solo lo que queda unido
    const enPad = this.pad.visible, s = this.escala, c = enPad ? this.pad.position.clone().addScaledVector(this.plan.u0, 60 * K0) : this.cohete.position;
    const h = enPad ? 120 * K0 : 0.6 * (this.orb ? this.orb.L : this.largo) * s, sc = sol.shadow.camera;
    sol.position.copy(c).addScaledVector(v.sunDir, h * 3); sol.target.position.copy(c); sol.target.updateMatrixWorld();
    if (sc.right !== h) { sc.left = -h; sc.right = h; sc.top = h; sc.bottom = -h; sc.near = 0; sc.far = h * 6; sc.updateProjectionMatrix(); }
    sol.shadow.normalBias = (h * 2 / 2048) * 1.5;
  }

  reiniciar() {
    const v = this.v;
    this.alPosar = null; this._quitarPlasma();
    this.cohete.userData.ponLM(); this.lmModo = 'pila'; this.lmSuelo = null; this.lmVel = null; this.lmEsc = null;
    this.cohete.userData.actualizar(0, false); this.cohete.visible = false;
    for (const k of ['estela', 'nubeSep', 'traza', 'anilloOrb', 'polvo']) { const o = this[k]; if (o) { v.scene.remove(o); o.geometry.dispose(); o.material.dispose?.(); this[k] = null; } }
    this.pad.visible = false; this.cielo.visible = false; this.orb = null; this.plan = null; this.pT = null;
    v.camera.up.set(0, 1, 0);
  }
}
