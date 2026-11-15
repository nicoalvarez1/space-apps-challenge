// Plano del vídeo: un globo mitad Marte (derecha), mitad Luna (izquierda) con las texturas reales de la web
// (assets/textures/: color, normales, relieve desplazado y casquetes polares, como js/scene.js) y, encima, las capas
// de datos reales de cada cuerpo (js/capas.js: capa() + pintarCapa() con CAPAS_GLOBO), que se despliegan desde el
// corte una tras otra y se separan hacia fuera como las capas de una cebolla (vista explosionada).
//
// Todo depende solo del tiempo t (s): window.__frame(t) dibuja el estado en t, y tools/video/planeta.py lo graba
// fotograma a fotograma. Sin ?rec se reproduce en bucle a tiempo real.
import * as THREE from 'three';
import { capa, pintarCapa, CAPAS_GLOBO, RAMPAS } from '../../js/capas.js';

const W = 1920, H = 1080, DEG = Math.PI / 180, TEX = 'assets/textures/';
const REC = new URLSearchParams(location.search).has('rec');
export const DURACION = 3.4;

// Capas por pares (misma familia de rampa en las dos mitades); nunca las *_aprox
// (la última es la que queda pegada a la superficie: el relieve, la más detallada). En Marte, potasio y no hierro:
// el hierro de GRS no tiene dato por encima de ~57° y el hueco escalonado de 5° se ve como un defecto en el vídeo.
const PARES = [
  ['mars_k', 'Odyssey GRS', 'moon_feo', 'Lunar Prospector'],
  ['mars_neutrones', 'Odyssey GRS', 'moon_h', 'Lunar Prospector'],
  ['mars_inercia', 'TES', 'moon_tmax', 'Diviner'],
  ['mars_elev', 'MOLA', 'moon_elev', 'LOLA'],
];
const NOMBRE = { mars_elev: 'Elevation', mars_inercia: 'Thermal inertia', mars_neutrones: 'Hydrogen', mars_k: 'Potassium',
  moon_elev: 'Elevation', moon_tmax: 'Max. temperature', moon_h: 'Hydrogen', moon_feo: 'Iron oxide' };
const T0 = 0.75, PASO = 0.36, DESPLIEGUE = 0.4, SEPARA = 0.45;   // s: tiempos de las capas

// ---------------------------------------------------------------- renderer, escena, luz (como js/scene.js)
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(REC ? 2 : Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02030a);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 4000);
scene.add(new THREE.AmbientLight(0x8890aa, 0.5));
const SOL = new THREE.Vector3(-0.32, 0.42, 1).normalize();
const sun = new THREE.DirectionalLight(0xfff4e6, 3.0);
sun.position.copy(SOL).multiplyScalar(50); scene.add(sun, sun.target);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

const loader = new THREE.TextureLoader();
const tex = async (f, srgb = false) => {
  const t = await loader.loadAsync(TEX + f);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
};

// el globo: grupo que gira; cada mitad es una esfera completa recortada por el plano x = 0 del grupo
const globo = new THREE.Group(); scene.add(globo);
const EJE = new THREE.Vector3(), CENTRO = new THREE.Vector3();
const corteU = () => ({ uN: { value: EJE }, uC: { value: new THREE.Vector3() }, uSide: { value: 1 } });

// GLSL común del recorte: se descarta lo que queda al otro lado del meridiano de corte
const CORTE_GLSL = `uniform vec3 uN, uC; uniform float uSide; varying vec3 vWP;`;

async function cuerpo(id, side, exager = 2.0) {
  const m = (await (await fetch(TEX + 'manifest.json')).json());
  const mm = m[id], t = mm.hi, p = mm.polar.hi;
  const [color, normal, hmap, cn, cs, nn, ns] = await Promise.all([tex(t.color, true), tex(t.normal), tex(mm.height),
    tex(p.n.color, true), tex(p.s.color, true), tex(p.n.normal), tex(p.s.normal)]);
  for (const x of [cn, cs, nn, ns]) x.wrapS = x.wrapT = THREE.ClampToEdgeWrapping;
  const k = (1 / mm.radius_m) * exager;
  const mat = new THREE.MeshStandardMaterial({ map: color, normalMap: normal, roughness: id === 'moon' ? 0.97 : 0.92, metalness: 0,
    displacementMap: hmap, displacementScale: (mm.hmax - mm.hmin) * k, displacementBias: mm.hmin * k });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 512, 256), mat);
  const u = { ...corteU(), uPolCN: { value: cn }, uPolCS: { value: cs }, uPolNN: { value: nn }, uPolNS: { value: ns },
    uPolCap: { value: (90 - mm.polar.lat0) * DEG }, uPolF0: { value: mm.polar.fade[0] * DEG }, uPolF1: { value: mm.polar.fade[1] * DEG },
    uPolNM: { value: mesh.normalMatrix } };
  u.uSide.value = side;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjDir; varying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjDir = position;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vObjDir; ${CORTE_GLSL}
        uniform sampler2D uPolCN, uPolCS, uPolNN, uPolNS; uniform float uPolCap, uPolF0, uPolF1; uniform mat3 uPolNM;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if ( uSide * dot( vWP - uC, uN ) < 0.0 ) discard;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 pDir = normalize( vObjDir );
        float pLat = asin( clamp( abs( pDir.y ), 0.0, 1.0 ) );
        float pW = smoothstep( uPolF0, uPolF1, pLat );
        float pRho = ( 1.57079633 - pLat ) / uPolCap, pLon = atan( -pDir.z, pDir.x );
        float pS = pRho * sin( pLon ), pC = pRho * cos( pLon );
        vec2 pUvN = vec2( 0.5 + 0.5 * pS, 0.5 - 0.5 * pC ), pUvS = vec2( 0.5 + 0.5 * pS, 0.5 + 0.5 * pC );
        float pIsN = step( 0.0, pDir.y );
        diffuseColor.rgb = mix( diffuseColor.rgb, mix( texture2D( uPolCS, pUvS ).rgb, texture2D( uPolCN, pUvN ).rgb, pIsN ), pW );`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 pN = mix( texture2D( uPolNS, pUvS ).xyz, texture2D( uPolNN, pUvN ).xyz, pIsN ) * 2.0 - 1.0;
        normal = normalize( mix( normal, normalize( uPolNM * pN ), pW ) );`);
  };
  mat.customProgramCacheKey = () => 'cuerpo-cortado';
  globo.add(mesh);
  for (const x of [color, normal, hmap, cn, cs, nn, ns]) renderer.initTexture(x);
  return { mesh, u };
}

// ---------------------------------------------------------------- capas: medias esferas por encima de la superficie
const geoCapa = new THREE.SphereGeometry(1, 256, 128);
const SHELL_VS = `varying vec2 vUv; varying vec3 vWP; varying vec3 vWN;
  void main() { vUv = uv; vec4 w = modelMatrix * vec4( position, 1.0 ); vWP = w.xyz; vWN = normalize( mat3( modelMatrix ) * normal );
    gl_Position = projectionMatrix * viewMatrix * w; }`;
const SHELL_FS = `${CORTE_GLSL}
  uniform sampler2D map; uniform float uReveal, uFront, uRim, uOpac; uniform vec3 uSun, uMenta; varying vec2 vUv; varying vec3 vWN;
  void main() {
    float d = uSide * dot( normalize( vWP - uC ), uN );            // 0 en el corte … 1 en el centro de la mitad
    if ( d < 0.0 ) discard;
    float frente = uReveal * 1.12;                                  // el borde del despliegue avanza desde el corte
    if ( d > frente ) discard;
    vec4 c = texture2D( map, vUv );
    vec3 N = normalize( vWN ) * ( gl_FrontFacing ? 1.0 : -1.0 ), V = normalize( cameraPosition - vWP );
    float luz = 0.42 + 0.78 * max( dot( N, uSun ), 0.0 );
    float fr = pow( 1.0 - abs( dot( normalize( vWN ), V ) ), 2.2 );
    float borde = smoothstep( frente - 0.07, frente, d ) * step( uReveal, 0.999 );
    vec3 col = c.rgb * luz + uMenta * borde * 1.4;
    float a = mix( uFront, 1.0, fr * uRim ) * ( gl_FrontFacing ? 1.0 : 0.45 );
    a = max( a, borde * 0.9 ) * smoothstep( 0.0, 0.012, d ) * uOpac * step( 0.99, c.a );   // sin dato (rayado de pintarCapa, alfa < 1): hueco
    gl_FragColor = vec4( col, a );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const MENTA = new THREE.Color('#5dffd0');
function capaGlobo(canvasCapa, side) {
  const t = new THREE.CanvasTexture(canvasCapa);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const u = { ...corteU(), map: { value: t }, uReveal: { value: 0 }, uFront: { value: 0.96 }, uRim: { value: 0 }, uOpac: { value: 1 },
    uSun: { value: SOL }, uMenta: { value: MENTA } };
  u.uSide.value = side;
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: SHELL_VS, fragmentShader: SHELL_FS, transparent: true,
    depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geoCapa, mat); mesh.visible = false;
  globo.add(mesh); renderer.initTexture(t);
  return { mesh, u, side };
}

// ---------------------------------------------------------------- cielo y costura
async function cielo() {
  const t = await tex('stars_hi.jpg', true);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2000, 64, 32),
    new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, depthWrite: false, toneMapped: false, color: 0x8c909c }));
  sky.rotation.set(0.45, 2.2, 0); sky.renderOrder = -10; scene.add(sky);
}
// núcleo oscuro (tapa los resquicios entre los dos relieves) y un filete menta finísimo a lo largo del corte
const nucleo = new THREE.Mesh(new THREE.SphereGeometry(0.985, 96, 48), new THREE.MeshBasicMaterial({ color: 0x07090f }));
globo.add(nucleo);
const costura = new THREE.Mesh(new THREE.TorusGeometry(1.012, 0.0028, 8, 384),
  new THREE.MeshBasicMaterial({ color: MENTA, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
costura.rotation.y = Math.PI / 2;   // en el plano x = 0 del grupo
globo.add(costura);

// ---------------------------------------------------------------- etiquetas (discretas)
const lista = { mars: document.getElementById('l-mars'), moon: document.getElementById('l-moon') };
const items = [];
function etiqueta(cuerpo, id, fuente, rampa) {
  const el = document.createElement('div'); el.className = 'it';
  el.innerHTML = `<i style="background:linear-gradient(90deg,${RAMPAS[rampa].join(',')})"></i><span>${NOMBRE[id]} <small>· ${fuente}</small></span>`;
  lista[cuerpo].appendChild(el); items.push(el);
  return el;
}

// ---------------------------------------------------------------- carga
const capas = [];   // [{ mars: shell, moon: shell, el: [..] }]
let marte, luna;
window.__listo = (async () => {
  [marte, luna] = await Promise.all([cuerpo('mars', 1), cuerpo('moon', -1), cielo()]);
  for (const [mid, mf, lid, lf] of PARES) {
    const [cm, cl] = await Promise.all([capa(mid), capa(lid)]);
    const dm = CAPAS_GLOBO.mars.find((x) => x.id === mid), dl = CAPAS_GLOBO.moon.find((x) => x.id === lid);
    capas.push({
      mars: capaGlobo(pintarCapa(cm, dm.rampa, { invertir: !!dm.invertir, bloques: !!dm.bloques }), 1),
      moon: capaGlobo(pintarCapa(cl, dl.rampa, { invertir: !!dl.invertir, bloques: !!dl.bloques }), -1),
      el: [etiqueta('mars', mid, mf, dm.rampa), etiqueta('moon', lid, lf, dl.rampa)],
    });
  }
  // que compile todo antes del primer fotograma grabado
  for (const c of capas) c.mars.mesh.visible = c.moon.mesh.visible = true;
  renderer.compile(scene, camera);
  frame(DURACION); frame(0);
  await document.fonts.ready;
  return true;
})();

// ---------------------------------------------------------------- estado en el instante t
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const easeIO = (x) => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
// orientación de cada textura dentro de su mitad (lo que mira a cámara): Marte, Valles Marineris y Tharsis; Luna, los mares
const GIRO_MARTE = 0.63, GIRO_LUNA = -2.25, INCL = 0.2;
const tmp = new THREE.Vector3();

function frame(t) {
  // giro lento de todo el globo; la cámara entra cerca (el globo, del tamaño del Marte de la web en el plano anterior)
  // y se aleja mientras se apilan las capas, para que quepa la vista explosionada
  globo.rotation.set(INCL, -0.16 + 0.06 * t, 0.05, 'XYZ');
  const D = 3.7 + 1.25 * easeIO((t - 0.55) / 2.0);
  camera.position.set(0, 0.065 * D, D); camera.lookAt(0, 0.02, 0);
  globo.updateMatrixWorld(true);
  EJE.setFromMatrixColumn(globo.matrixWorld, 0).normalize();
  globo.getWorldPosition(CENTRO);
  marte.mesh.rotation.y = GIRO_MARTE; luna.mesh.rotation.y = GIRO_LUNA;
  marte.u.uC.value.copy(CENTRO); luna.u.uC.value.copy(CENTRO);

  capas.forEach((c, i) => {
    const s = T0 + i * PASO;
    const rev = easeOut((t - s) / DESPLIEGUE);
    // «edad»: cuántas capas más nuevas han llegado ya (continuo) → se separa hacia fuera y se vuelve un velo
    let edad = 0;
    for (let j = i + 1; j < capas.length; j++) edad += easeIO((t - (T0 + j * PASO) - 0.05) / SEPARA);
    const r = 1.016 + 0.068 * edad, dx = 0.07 * edad, velo = clamp01(edad);
    for (const sh of [c.mars, c.moon]) {
      sh.mesh.visible = rev > 0.001;
      sh.mesh.scale.setScalar(r);
      sh.mesh.position.set(sh.side * dx, 0, 0);
      sh.mesh.rotation.y = sh.side > 0 ? GIRO_MARTE : GIRO_LUNA;
      sh.mesh.renderOrder = 10 + i;           // más antigua = más fuera = encima
      sh.u.uReveal.value = rev;
      sh.u.uFront.value = 0.95 - 0.83 * velo;
      sh.u.uRim.value = 0.9 * velo;
      sh.u.uOpac.value = 1 - 0.18 * clamp01(edad - 1.5);
      sh.mesh.updateMatrixWorld(true);
      sh.u.uC.value.copy(sh.mesh.getWorldPosition(tmp));
    }
    // etiquetas: entran con la capa; la más reciente en blanco, las anteriores atenuadas
    const a = clamp01((t - s) / 0.25);
    for (const el of c.el) {
      el.style.opacity = (a * (1 - 0.45 * velo)).toFixed(3);
      el.style.transform = `translateY(${((1 - easeOut((t - s) / 0.35)) * 8).toFixed(1)}px)`;
    }
  });
  for (const h of document.querySelectorAll('.lista h4')) h.style.opacity = (0.9 * clamp01((t - T0 + 0.15) / 0.3)).toFixed(3);
  renderer.render(scene, camera);
}
window.__frame = frame;
window.__duracion = DURACION;

if (!REC) {
  window.__listo.then(() => { const t0 = performance.now(); renderer.setAnimationLoop(() => frame(((performance.now() - t0) / 1000) % (DURACION + 0.8))); });
}
