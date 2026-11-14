// Escena 3D: Tierra, Luna, Marte, cielo estrellado, trayectoria de la cámara y marcadores.
//
// Prioridad de modelos para cada cuerpo:
//   1) assets/<cuerpo>.glb         → tu modelo exportado desde Blender (si existe)
//   2) assets/textures/manifest.json → texturas reales de NASA generadas con tools/build_textures.py
//   3) texturas procedurales (solo como último recurso, sin datos reales)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { moonTextures, marsTextures, earthTextures } from './textures.js';
import { crearSaturnoV } from './saturno5.js';

export const CONFIG = {
  assets: {
    earth: { url: 'assets/earth.glb', lonOffset: 0 },
    moon:  { url: 'assets/moon.glb',  lonOffset: 0 },
    mars:  { url: 'assets/mars.glb',  lonOffset: 0 },
  },
  texturesDir: 'assets/textures/',
  // Exageración vertical del relieve real (1 = a escala). La Luna y Marte son casi esferas perfectas.
  exaggeration: { moon: 3, mars: 3 },
};

const RADIUS = { earth: 6.37, moon: 3.2, mars: 4.2 };
const POS = {
  earth: new THREE.Vector3(0, 0, 0),
  moon: new THREE.Vector3(34, 3, -92),
  mars: new THREE.Vector3(-46, 6, -168),
};

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const DEG = Math.PI / 180;

export function latLonToLocal(lat, lon, r) {
  const phi = ((lon + 180) / 360) * Math.PI * 2, la = lat * DEG;
  return new THREE.Vector3(-r * Math.cos(phi) * Math.cos(la), r * Math.sin(la), r * Math.sin(phi) * Math.cos(la));
}

async function exists(url) {
  try { return (await fetch(url, { method: 'HEAD' })).ok; } catch { return false; }
}

export class Viewer {
  constructor(canvas, markerLayer) {
    this.canvas = canvas; this.layer = markerLayer;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x02030a);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 4000);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.06, enablePan: false, rotateSpeed: 0.6, zoomSpeed: 0.7 });

    this.scene.add(new THREE.AmbientLight(0x8890aa, 0.5));
    this.sun = new THREE.DirectionalLight(0xfff4e6, 3.0);
    this.scene.add(this.sun, this.sun.target);
    this.sunDir = new THREE.Vector3(1, 0.3, 0.5).normalize();   // dirección al Sol (mundo), se actualiza cada frame

    this.bodies = {}; this.markers = []; this.tween = null; this.current = null; this.mode = 'intro';
    this.markersOn = false; this.selected = null; this.focusId = 'earth';
    this.viewShift = 0;                                          // desplaza la Tierra a la derecha tras el asistente
    this.loader = new GLTFLoader();
    this.mixers = []; this.clock = new THREE.Clock();
    this.quality = this._detectQuality();
    this.manager = new THREE.LoadingManager();
    this.manager.onProgress = (_u, done, total) => this.onProgress?.(Math.min(1, done / total));
    this.texLoader = new THREE.TextureLoader(this.manager);
    this.onProgress = null; this.manifest = null; this.credits = null;
    this.rocket = this._makeRocket(); this.scene.add(this.rocket);   // cohete del viaje Tierra → Luna/Marte
    this.ready = this._init();
    this.worldsReady = this.ready.then(() => this.allReady);      // Tierra + Luna + Marte listos
    addEventListener('resize', () => this._resize()); this._resize();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  _detectQuality() {
    const q = new URLSearchParams(location.search).get('q');
    if (q === 'hi' || q === 'lo') return q;
    const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    const mem = navigator.deviceMemory ?? 8;
    return this.renderer.capabilities.maxTextureSize >= 8192 && !mobile && mem >= 4 ? 'hi' : 'lo';
  }

  // ---------- carga ----------
  async _init() {
    try {
      const r = await fetch(CONFIG.texturesDir + 'manifest.json');
      if (r.ok) { this.manifest = await r.json(); this.credits = this.manifest.credits; }
    } catch { /* sin texturas NASA: se usarán las procedurales */ }
    console.info(`[viewer] calidad: ${this.quality} · texturas NASA: ${this.manifest ? 'sí' : 'no (procedural)'}`);
    await Promise.all([this._makeBody('earth'), this._makeSky()]);
    this.setIntro();
    // La Luna y Marte se cargan en segundo plano mientras el usuario configura la misión
    this.loading = { moon: this._makeBody('moon'), mars: this._makeBody('mars') };
    this.allReady = Promise.all(Object.values(this.loading));
  }

  async _tex(file, { srgb = false } = {}) {
    const t = await this.texLoader.loadAsync(CONFIG.texturesDir + file);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }

  async _heightSampler(file) {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = CONFIG.texturesDir + file; });
    const w = img.width, h = img.height, c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, w, h).data, g = new Uint8Array(w * h);
    for (let i = 0; i < g.length; i++) g[i] = d[i * 4];
    return (lat, lon) => {                                       // altura normalizada 0..1 (bilineal)
      const x = (((lon + 180) / 360) * w - 0.5), y = Math.min(h - 1.001, Math.max(0, ((90 - lat) / 180) * h - 0.5));
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, X = (v) => ((v % w) + w) % w;
      const a = g[y0 * w + X(x0)], b = g[y0 * w + X(x0 + 1)], c2 = g[(y0 + 1) * w + X(x0)], d2 = g[(y0 + 1) * w + X(x0 + 1)];
      return (a + (b - a) * fx + (c2 - a) * fy + (a - b - c2 + d2) * fx * fy) / 255;
    };
  }

  _upload(...textures) { textures.filter(Boolean).forEach((t) => this.renderer.initTexture(t)); }

  async _makeSky() {
    const file = this.manifest?.stars?.[this.quality];
    if (file) {
      try {
        const t = await this._tex(file, { srgb: true });
        const sky = new THREE.Mesh(new THREE.SphereGeometry(2000, 64, 32),
          new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, depthWrite: false, toneMapped: false, color: 0x8c909c }));
        sky.rotation.set(0.45, 0.6, 0); sky.renderOrder = -10; this.scene.add(sky); this.sky = sky;
        return;
      } catch (e) { console.warn('Mapa estelar no disponible', e); }
    }
    const n = 5000, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u), r = 1200;
      p.set([r * s * Math.cos(t), r * u, r * s * Math.sin(t)], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.85 })));
  }

  // ---------- cuerpos ----------
  async _makeBody(id) {
    const R = RADIUS[id], group = new THREE.Group(), pivot = new THREE.Group();
    group.position.copy(POS[id]); group.add(pivot);
    const body = { id, R, group, pivot, clouds: null, surfaceR: null, source: 'procedural' };
    const cfg = CONFIG.assets[id];

    if (await exists(cfg.url)) {                                // 1) modelo de Blender
      try {
        const gltf = await this.loader.loadAsync(cfg.url), model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
        model.scale.setScalar((R * 2) / Math.max(size.x, size.y, size.z));
        model.position.sub(new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3())); pivot.add(model);
        if (gltf.animations?.length) { const m = new THREE.AnimationMixer(model); gltf.animations.forEach((a) => m.clipAction(a).play()); this.mixers.push(m); }
        pivot.rotation.y = cfg.lonOffset * DEG; body.source = 'blender';
        console.info(`[viewer] ${id}: modelo Blender (${cfg.url})`);
      } catch (e) { console.warn(`${id}: GLB inválido`, e); }
    }
    if (body.source === 'procedural' && this.manifest?.[id]) {  // 2) texturas NASA
      try { await this._nasaBody(body); body.source = 'nasa'; console.info(`[viewer] ${id}: texturas NASA (${this.quality})`); }
      catch (e) { console.warn(`${id}: texturas NASA no disponibles, uso procedurales`, e); pivot.clear(); }
    }
    if (body.source === 'procedural') this._proceduralBody(body);   // 3) respaldo

    // atmósfera: la de la Tierra es fina y azul (dispersión de Rayleigh); la de Marte, tenue y color polvo
    if (id === 'earth') { group.add(this._atmosphere(R, 0x5aa2ff, 1.045, 0.75)); group.add(this._rim(R * 1.004, 0x6aaeff, 0.5)); }
    if (id === 'mars') group.add(this._atmosphere(R, 0xffa070, 1.03, 0.45));
    group.visible = id === 'earth';                              // Luna y Marte solo se muestran al viajar allí
    this.scene.add(group);
    this.bodies[id] = body;
    return body;
  }

  async _nasaBody(body) {
    const { id, R, pivot, group } = body, m = this.manifest[id], t = m[this.quality];
    if (id === 'earth') {
      const [color, night, normal, rough, clouds] = await Promise.all([
        this._tex(t.color, { srgb: true }), this._tex(t.night, { srgb: true }), this._tex(t.normal),
        this._tex(t.rough), this._tex(t.clouds)]);
      const mat = new THREE.MeshStandardMaterial({
        map: color, normalMap: normal, normalScale: new THREE.Vector2(0.7, 0.7),
        roughnessMap: rough, roughness: 1, metalness: 0,
        emissive: 0xffffff, emissiveMap: night, emissiveIntensity: 1.25,
      });
      // las luces de las ciudades solo se ven en la cara nocturna
      mat.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `
          #ifdef USE_EMISSIVEMAP
            vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
            float nightMask = 1.0 - smoothstep( -0.10, 0.08, dot( nonPerturbedNormal, directionalLights[0].direction ) );
            totalEmissiveRadiance *= emissiveColor.rgb * nightMask;
          #endif`);
      };
      pivot.add(new THREE.Mesh(new THREE.SphereGeometry(R, 128, 96), mat));
      const cl = new THREE.Mesh(new THREE.SphereGeometry(R * 1.006, 96, 64), new THREE.MeshStandardMaterial({
        color: 0xffffff, alphaMap: clouds, transparent: true, opacity: 0.92, depthWrite: false, roughness: 1, metalness: 0 }));
      group.add(cl); body.clouds = cl;
      this._upload(color, night, normal, rough, clouds);
      return;
    }
    // Luna y Marte: color + normales + relieve real (desplazamiento de la malla)
    const [color, normal, hmap, sample] = await Promise.all([
      this._tex(t.color, { srgb: true }), this._tex(t.normal), this._tex(m.height), this._heightSampler(m.height)]);
    const ex = CONFIG.exaggeration[id] ?? 1, k = (R / m.radius_m) * ex;
    const mat = new THREE.MeshStandardMaterial({
      map: color, normalMap: normal, normalScale: new THREE.Vector2(1, 1), roughness: id === 'moon' ? 0.97 : 0.92, metalness: 0,
      displacementMap: hmap, displacementScale: (m.hmax - m.hmin) * k, displacementBias: m.hmin * k,
    });
    pivot.add(new THREE.Mesh(new THREE.SphereGeometry(R, 512, 256), mat));
    this._overlayHook(body, mat);
    // radio local de la superficie (para colocar marcadores justo sobre el terreno)
    body.surfaceR = (lat, lon) => R + (m.hmin + sample(lat, lon) * (m.hmax - m.hmin)) * k;
    this._upload(color, normal, hmap);
  }

  _proceduralBody(body) {
    const { id, R, pivot, group } = body;
    const t = id === 'earth' ? earthTextures() : id === 'moon' ? moonTextures() : marsTextures();
    const mat = new THREE.MeshStandardMaterial({ map: t.map, roughness: id === 'earth' ? 0.7 : 0.95, metalness: 0 });
    if (t.bump) { mat.bumpMap = t.bump; mat.bumpScale = t.bumpScale * R; }
    pivot.add(new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), mat));
    if (id !== 'earth') this._overlayHook(body, mat);
    if (t.clouds) {
      body.clouds = new THREE.Mesh(new THREE.SphereGeometry(R * 1.012, 64, 48),
        new THREE.MeshStandardMaterial({ map: t.clouds, transparent: true, opacity: 0.55, depthWrite: false }));
      group.add(body.clouds);
    }
  }

  // Halo de la atmósfera fuera del disco: máximo junto al borde del planeta y se desvanece hasta 0
  // en el borde exterior de la capa (sin "anillo" duro). Solo brilla en el lado iluminado.
  _atmosphere(R, color, scale, k) {
    const m = new THREE.ShaderMaterial({
      uniforms: { c: { value: new THREE.Color(color) }, sun: { value: this.sunDir }, k: { value: k },
        edge: { value: Math.sqrt(1 - 1 / (scale * scale)) } },
      vertexShader: `varying vec3 vW; varying vec3 vP;
        void main(){ vW = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `varying vec3 vW; varying vec3 vP; uniform vec3 c; uniform vec3 sun; uniform float k; uniform float edge;
        void main(){ vec3 N = normalize(vW), V = normalize(cameraPosition - vP);
          float g = pow(clamp(-dot(N, V) / edge, 0.0, 1.0), 2.2);
          float day = smoothstep(-0.4, 0.45, dot(N, sun));
          gl_FragColor = vec4(c, 1.0) * g * k * (0.06 + 0.94 * day); }`,
      side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    });
    return new THREE.Mesh(new THREE.SphereGeometry(R * scale, 96, 64), m);
  }

  // velo fino sobre el propio disco del planeta (el azul que se ve al mirar el borde de la Tierra)
  _rim(R, color, k) {
    const m = new THREE.ShaderMaterial({
      uniforms: { c: { value: new THREE.Color(color) }, sun: { value: this.sunDir }, k: { value: k } },
      vertexShader: `varying vec3 vW; varying vec3 vP;
        void main(){ vW = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `varying vec3 vW; varying vec3 vP; uniform vec3 c; uniform vec3 sun; uniform float k;
        void main(){ vec3 N = normalize(vW), V = normalize(cameraPosition - vP);
          float f = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
          float day = smoothstep(-0.25, 0.5, dot(N, sun));
          gl_FragColor = vec4(c, 1.0) * f * k * day; }`,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    });
    return new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), m);
  }

  _resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // ---------- cámara ----------
  _earthPose() { return { pos: new THREE.Vector3(7, 5, 19), target: POS.earth.clone() }; }
  _orbitPose(id, dir = new THREE.Vector3(0.28, 0.22, 1)) {
    const b = this.bodies[id];
    return { pos: POS[id].clone().add(dir.clone().normalize().multiplyScalar(b.R * 3.6)), target: POS[id].clone() };
  }

  setIntro() {
    const p = this._earthPose(); this.camera.position.copy(p.pos); this.controls.target.copy(p.target);
    this.controls.enabled = false; this.controls.autoRotate = true; this.controls.autoRotateSpeed = 0.35; this.mode = 'intro';
    this.focusId = 'earth'; this._showOnly('earth');
    if (this.rocket) this.rocket.visible = false;
  }

  _showOnly(...ids) {
    for (const id of Object.keys(this.bodies)) this.bodies[id].group.visible = id === 'earth' || ids.includes(id);
  }

  _limits(id) {
    const R = this.bodies[id].R; this.controls.minDistance = R * 1.16; this.controls.maxDistance = R * 10;
  }

  _run(dur, fn) {
    this.controls.enabled = false; this.controls.autoRotate = false;
    return new Promise((res) => { this.tween = { t0: performance.now(), dur: dur * 1000, fn, res }; });
  }

  // viaje Tierra -> cuerpo
  async flyToBody(id, { duration = 7.5, onProgress } = {}) {
    await this.ready; await this.loading[id];
    this.clearSites(); this.current = id; this.mode = 'flight'; this._showOnly(id);
    const a = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
    const b = this._orbitPose(id);
    const ctrl = a.pos.clone().lerp(b.pos, 0.5).add(new THREE.Vector3(-18, 22, 14));
    const tmp = new THREE.Vector3(), ps = new THREE.Vector3(), ts = new THREE.Vector3();
    await this._run(duration, (t) => {
      const k = ease(t), kt = ease(Math.min(1, t * 1.15));
      ps.copy(a.pos).multiplyScalar((1 - k) * (1 - k)).add(tmp.copy(ctrl).multiplyScalar(2 * (1 - k) * k)).add(tmp.copy(b.pos).multiplyScalar(k * k));
      this.camera.position.copy(ps);
      ts.lerpVectors(a.target, b.target, kt); this.camera.lookAt(ts); this.controls.target.copy(ts);
      this._poseRocket(t, b.target);
      onProgress?.(t, Math.max(0, 1 - k));
    });
    this.rocket.visible = false;
    this._endOrbit(id, b);
  }

  // ---------- cohete del viaje ----------
  // Saturno V a escala con sus etapas y separaciones (js/saturno5.js)
  _makeRocket() { return crearSaturnoV(); }

  // Coloca el cohete delante de la cámara (vista 3/4 trasera) durante el viaje. t = 0..1
  //   0–0,16  sube desde abajo (lanzamiento)   ·   crucero   ·   0,78–1  se adelanta hacia el destino y se pierde de vista
  _poseRocket(t, dest) {
    const r = this.rocket, cam = this.camera, q = cam.quaternion, now = performance.now() / 1000;
    const sm = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
    const enter = sm(0, 0.07, t), leave = sm(0.78, 1, t);
    const wide = Math.min(1, cam.aspect / 1.6);                     // en pantallas estrechas se acerca al centro
    const off = new THREE.Vector3(
      0.7 * wide * (1 - leave),
      -0.1 - (1 - enter) * 1.5 + Math.sin(now * 1.3) * 0.02 + leave * 0.1,
      -(2.5 + leave * leave * 4.5));
    r.position.copy(off).applyQuaternion(q).add(cam.position);
    // proa hacia donde se ve el destino en pantalla (vista casi lateral, para que se vean las etapas)
    const d = new THREE.Vector3().copy(dest).project(cam), s = new THREE.Vector3().copy(r.position).project(cam);
    let nx = (d.x - s.x) * cam.aspect, ny = d.y - s.y; const nl = Math.hypot(nx, ny);
    if (d.z > 1 || nl < 1e-4) { nx = -0.8; ny = 1.0; } else { nx *= 1.3 / nl; ny *= 1.3 / nl; }   // destino detrás de la cámara: rumbo por defecto
    const nose = new THREE.Vector3(nx, ny, -1).normalize().applyQuaternion(q);
    nose.lerp(new THREE.Vector3().copy(dest).sub(r.position).normalize(), leave).normalize();
    r.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), nose);
    const st = r.userData.actualizar(t, this.current === 'mars');    // etapas, separaciones y llamas según el instante
    r.scale.setScalar(st.escala * (1 - 0.6 * leave)); this.rocketPhase = st.fase;
    r.visible = t < 0.995;
  }

  _endOrbit(id, pose) {
    this.controls.target.copy(pose.target); this.camera.position.copy(pose.pos);
    this._limits(id);
    this.controls.enabled = true; this.controls.autoRotate = true; this.controls.autoRotateSpeed = 0.3;
    this.controls.update(); this.mode = 'orbit'; this.focusId = id;
  }

  // Mover cámara alrededor de un cuerpo hasta mirar a (lat, lon)
  async _lookAtSurface(id, lat, lon, distMul = 2.2, duration = 2.2) {
    const b = this.bodies[id], center = POS[id];
    const worldDir = latLonToLocal(lat, lon, 1).applyQuaternion(b.pivot.quaternion).normalize();
    const from = this.camera.position.clone().sub(center);
    const fromDist = from.length(), fromDir = from.clone().normalize();
    const qa = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), fromDir);
    const qb = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), worldDir.clone().add(new THREE.Vector3(0, 0.12, 0)).normalize());
    const toDist = b.R * distMul, ts = this.controls.target.clone(), q = new THREE.Quaternion();
    await this._run(duration, (t) => {
      const k = ease(t);
      q.slerpQuaternions(qa, qb, k);
      this.camera.position.copy(new THREE.Vector3(0, 0, 1).applyQuaternion(q).multiplyScalar(fromDist + (toDist - fromDist) * k).add(center));
      const tt = ts.clone().lerp(center, k); this.controls.target.copy(tt); this.camera.lookAt(tt);
    });
    this._limits(id);
    this.controls.enabled = true; this.controls.autoRotate = false; this.controls.update(); this.focusId = id;
  }

  async focusSite(site) {
    this.selected = site.id; this._select(site.id);
    if (this.mode === 'orbit' && this.focusId !== this.current) await this._travel(this.current);
    await this._lookAtSurface(this.current, site.lat, site.lon, 1.9);
  }

  async _travel(id, duration = 3) {
    const a = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
    const b = this._orbitPose(id);
    const mid = a.pos.clone().lerp(b.pos, 0.5).add(new THREE.Vector3(0, 12, 0));
    const tmp = new THREE.Vector3(), ts = new THREE.Vector3();
    await this._run(duration, (t) => {
      const k = ease(t);
      this.camera.position.copy(a.pos).multiplyScalar((1 - k) * (1 - k)).add(tmp.copy(mid).multiplyScalar(2 * (1 - k) * k)).add(tmp.copy(b.pos).multiplyScalar(k * k));
      ts.lerpVectors(a.target, b.target, k); this.controls.target.copy(ts); this.camera.lookAt(ts);
    });
    this._endOrbit(id, b); this.controls.autoRotate = false;
  }

  async backToBody() {
    this._select(null); this.selected = null;
    await this._travel(this.current, this.focusId === 'earth' ? 4 : 2);
  }

  // Ir a la Tierra y mostrar el análogo
  async flyToEarth(analog, onReady) {
    this.clearAnalogs();
    const b = this.bodies.earth; this._showOnly(this.current, 'earth');
    this._addMarker({ id: 'analog', label: analog.name, lat: analog.lat, lon: analog.lon, body: 'earth', cls: 'analog', text: '★' });
    this.markersOn = true;
    const a = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
    const dir = latLonToLocal(analog.lat, analog.lon, 1).applyQuaternion(b.pivot.quaternion).normalize();
    const to = { pos: POS.earth.clone().add(dir.clone().add(new THREE.Vector3(0, 0.1, 0)).normalize().multiplyScalar(b.R * 2.5)), target: POS.earth.clone() };
    const mid = a.pos.clone().lerp(to.pos, 0.5).add(new THREE.Vector3(0, 18, 20));
    const tmp = new THREE.Vector3(), ts = new THREE.Vector3();
    await this._run(5, (t) => {
      const k = ease(t);
      this.camera.position.copy(a.pos).multiplyScalar((1 - k) * (1 - k)).add(tmp.copy(mid).multiplyScalar(2 * (1 - k) * k)).add(tmp.copy(to.pos).multiplyScalar(k * k));
      ts.lerpVectors(a.target, to.target, k); this.controls.target.copy(ts); this.camera.lookAt(ts);
    });
    this._limits('earth');
    this.controls.enabled = true; this.controls.update(); this.focusId = 'earth';
    onReady?.();
  }

  clearAnalogs() {
    this.markers = this.markers.filter((m) => { if (m.cls === 'analog') { m.el.remove(); return false; } return true; });
  }

  // ---------- capas de datos sobre el globo ----------
  // La capa (lienzo equirectangular: x=0 ↔ 180°O, arriba = norte) sustituye al color de la superficie, pero
  // modulada por el brillo de la textura original y con la iluminación normal: los cráteres y el relieve
  // siguen leyéndose debajo del dato. Sin dato (alfa 0) = gris. Un poco de emisión mantiene legible la cara nocturna.
  _overlayHook(body, mat) {
    if (!this._blank) { this._blank = new THREE.DataTexture(new Uint8Array(4), 1, 1); this._blank.needsUpdate = true; }
    const u = { uOverlay: { value: this._blank }, uOverlayMix: { value: 0 } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uOverlay; uniform float uOverlayMix;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec4 ovl = texture2D( uOverlay, vMapUv );
          float ovLum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
          vec3 ovCol = mix( vec3( ovLum * 0.45 ), ovl.rgb * mix( 1.0, clamp( ovLum * 5.0, 0.3, 1.6 ), 0.6 ), ovl.a );
          diffuseColor.rgb = mix( diffuseColor.rgb, ovCol, uOverlayMix );`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += ovl.rgb * ovl.a * 0.3 * uOverlayMix;`);
    };
    body.surfaceMat = mat; body.overlay = u;
  }

  setOverlay(id, canvas, opacity = 1) {
    const b = this.bodies[id], u = b?.overlay; if (!u) return false;
    b.overlayTex?.dispose(); b.overlayTex = null;
    if (canvas) {
      const t = new THREE.CanvasTexture(canvas);
      t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
      t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      b.overlayTex = t; u.uOverlay.value = t; u.uOverlayMix.value = opacity;
    } else { u.uOverlay.value = this._blank; u.uOverlayMix.value = 0; }
    return true;
  }

  setOverlayOpacity(id, opacity) { const u = this.bodies[id]?.overlay; if (u && u.uOverlay.value !== this._blank) u.uOverlayMix.value = opacity; }

  // Texto junto a cada marcador de emplazamiento (p. ej. el valor de la capa activa); fn(m) → texto o nada
  setMarkerValues(fn) {
    for (const m of this.markers) {
      if (m.cls === 'analog') continue;
      m.el.querySelector('.m-val').textContent = fn?.(m) ?? '';
    }
  }

  // Latitud/longitud bajo el cursor en el cuerpo actual (esfera de referencia, sin relieve) o null
  probe(clientX, clientY) {
    const id = this.current, b = this.bodies[id];
    if (!b || this.mode !== 'orbit' || this.focusId !== id || this.tween) return null;
    const r = this.canvas.getBoundingClientRect();
    this._ray ??= new THREE.Raycaster();
    this._ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hit = this._ray.ray.intersectSphere(new THREE.Sphere(POS[id], b.R), new THREE.Vector3());
    if (!hit) return null;
    const p = hit.sub(POS[id]).applyQuaternion(b.pivot.quaternion.clone().invert()).normalize();
    let lon = Math.atan2(p.z, -p.x) / DEG - 180; if (lon < -180) lon += 360;
    return { lat: Math.asin(Math.max(-1, Math.min(1, p.y))) / DEG, lon };
  }

  // ---------- marcadores ----------
  setSites(sites, onClick) {
    this.clearSites(); this.onSiteClick = onClick;
    sites.forEach((s, i) => this._addMarker({ id: s.id, label: s.name, lat: s.lat, lon: s.lon, body: this.current, rank: s.rank, text: s.rank, delay: i * 140, score: s.score }, true));
    this.markersOn = true;
  }

  clearSites() {
    this.markers.forEach((m) => { m.el.remove(); m.beacon?.parent?.remove(m.beacon); });
    this.markers = []; this.markersOn = false; this.selected = null;
  }

  _addMarker({ id, label, lat, lon, body, rank, text, cls = '', delay = 0, score }, beacon = false) {
    const el = document.createElement('button');
    el.className = `marker ${cls} ${rank === 1 ? 'top' : ''}`; el.style.setProperty('--d', `${delay}ms`);
    el.innerHTML = `<span class="m-dot">${text}</span><span class="m-val"></span><span class="m-label">${label}${score != null ? ` <b>${score}</b>` : ''}</span>`;
    el.title = label;
    el.addEventListener('click', (e) => { e.stopPropagation(); if (cls !== 'analog') this.onSiteClick?.(id); });
    this.layer.appendChild(el);
    const b = this.bodies[body], r = (b.surfaceR?.(lat, lon) ?? b.R) + b.R * 0.002;   // sobre el terreno real
    const local = latLonToLocal(lat, lon, r).applyQuaternion(b.pivot.quaternion);
    const m = { id, el, body, local, cls, lat, lon };
    if (beacon) {
      const normal = local.clone().normalize(), h = b.R * 0.09;
      const pil = new THREE.Mesh(new THREE.CylinderGeometry(b.R * 0.0025, b.R * 0.0025, h, 6),
        new THREE.MeshBasicMaterial({ color: rank === 1 ? 0x5dffd0 : 0xffc857, transparent: true, opacity: 0.75, depthWrite: false }));
      pil.position.copy(local).addScaledVector(normal, h / 2);
      pil.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      b.group.add(pil); m.beacon = pil;
    }
    this.markers.push(m); return m;
  }

  _select(id) { this.markers.forEach((m) => m.el.classList.toggle('sel', m.id === id)); }

  _updateMarkers() {
    const cam = this.camera.position, w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const v = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Vector3();
    for (const m of this.markers) {
      const b = this.bodies[m.body];
      if (!(this.markersOn && this.mode !== 'flight' && b.group.visible && (this.focusId !== 'earth' || m.cls === 'analog'))) { m.el.style.display = 'none'; continue; }
      v.copy(m.local); b.group.localToWorld(v);
      n.copy(v).sub(POS[m.body]); c.copy(cam).sub(v);
      const front = n.dot(c) > 0;
      v.project(this.camera);
      if (!(front && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05)) { m.el.style.display = 'none'; continue; }
      m.el.style.display = ''; m.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
    }
  }

  // ---------- bucle ----------
  _frame() {
    const dt = this.clock.getDelta();
    this.mixers.forEach((m) => m.update(dt));
    if (this.tween) {
      const t = Math.min(1, (performance.now() - this.tween.t0) / this.tween.dur);
      this.tween.fn(t);
      if (t >= 1) { const r = this.tween.res; this.tween = null; r(); }
    } else this.controls.update();
    // El Sol sigue a la cámara con un ángulo fijo: siempre se ve la zona iluminada
    const off = new THREE.Vector3(0.9, 0.5, 0.35).applyQuaternion(this.camera.quaternion).normalize();
    this.sunDir.copy(off);
    this.sun.position.copy(this.controls.target).addScaledVector(off, 80); this.sun.target.position.copy(this.controls.target);
    const e = this.bodies.earth; if (e?.clouds) e.clouds.rotation.y += dt * 0.012;
    if (this.rocket.visible) this.rocket.userData.parpadeo(performance.now() / 1000);   // parpadeo de las llamas
    // En el asistente la tarjeta ocupa la izquierda: desplazamos el encuadre para que la Tierra quede a la derecha
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const goal = this.mode === 'intro' && w > 1000 ? 0.2 : 0;
    this.viewShift += (goal - this.viewShift) * Math.min(1, dt * 2.5);
    if (this.viewShift > 0.002) this.camera.setViewOffset(w, h, -w * this.viewShift, 0, w, h);
    else if (this.camera.view?.enabled) this.camera.clearViewOffset();
    this._updateMarkers();
    this.renderer.render(this.scene, this.camera);
  }
}
