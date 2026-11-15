"""Monta el vídeo de 30 s a partir de la grabación de grabar.py, sincronizado con la locución.

Uso:  .venv/bin/python tools/video/montar.py   →  video/landfall_30s.mp4  (3840×2160 «4K», 30 fps, H.264 yuv420p + AAC)
      después: .venv/bin/python tools/video/voz.py  →  video/landfall_30s_voz.mp4

1. Sincronía: locucion.frases() detecta las frases de la locución (silencedetect) y cada plano empieza LEAD s antes de
   la frase que lo describe (video/guion_v2_estructura.md). Cada plano es un tramo de la grabación anclado a una marca de
   video/tmp/eventos.json (por su inicio o por su final, p. ej. el clic que lleva al plano siguiente) y con una
   velocidad casi real (1,0–1,3×): nada de movimientos frenéticos. El plano «planeta» (mitad Marte, mitad Luna, con
   las capas de datos apilándose) sale de otra fuente: video/tmp/planeta/, grabada por planeta.py en tiempo de escena.
2. Transiciones: siempre la misma, un fundido muy corto (FUNDIDO fotogramas); entre tramos continuos de la grabación,
   ninguna. Fundido de entrada desde negro al principio.
3. Rótulos: un único estilo (el de los paneles de la web: Avenir Next sobre panel oscuro con filete de acento),
   abajo a la izquierda dentro del margen seguro, máximo 5 palabras y solo donde aportan un dato. Título final en la
   serifa de la web. Se dibujan con Chromium (PNG con transparencia) y se componen en numpy.
4. Audio: audio.py (música propia con el compás ajustado al título y pocos efectos: clics, dos transiciones y el
   golpe del título).
"""
import bisect, json, shutil, subprocess, sys, tempfile
from pathlib import Path
import numpy as np
import imageio_ffmpeg

sys.path.insert(0, str(Path(__file__).parent))
import audio, locucion  # noqa: E402

RAIZ = Path(__file__).resolve().parents[2]
TMP = RAIZ / 'video' / 'tmp'
PLANETA = TMP / 'planeta'          # fotogramas de planeta.py (k ↔ t = k / FPS de la escena)
SALIDA = RAIZ / 'video' / 'landfall_30s.mp4'
FF = imageio_ffmpeg.get_ffmpeg_exe()
W, H, FPS, DUR = 3840, 2160, 30, 30.0     # salida 4K; la grabación (1920×1080) se escala con lanczos
W0 = W // 2                        # ancho en px CSS de los rótulos (se dibujan a 2× para 4K)
ESC = W // W0                      # factor de escala de los rótulos
N_TOTAL = round(DUR * FPS)
LEAD = 0.15        # s: el corte llega un poco antes que la frase
FUNDIDO = 4        # fotogramas del fundido entre planos (0,13 s)
ENTRADA = 8        # fotogramas del fundido desde negro inicial
MARGEN = 96 * ESC  # margen seguro (px) de los rótulos

idx = json.loads((TMP / 'frames.json').read_text())
ts = [t for _, t in idx]
T0 = ts[0]
evs = json.loads((TMP / 'eventos.json').read_text())


def ev(nombre, n=1):
    """Tiempo (s desde el primer fotograma) de la n-ésima marca `nombre` (o del clic cuyo 'que' empieza por `nombre`)."""
    c = [e for e in evs if e['ev'] == nombre or (e['ev'] == 'clic' and e.get('que', '').startswith(nombre))]
    return c[n - 1]['t'] - T0


# ---------------------------------------------------------------- planos sincronizados con la voz
# Guion v2 con la estructura oficial de Space Apps (video/guion_v2_estructura.md; la v1 en video/copia_2026-11-15_30s_v1/)
F = locucion.frases()   # 17 tramos, en el orden de locucion.FRASES
CORTES = {
    'despegue':   F[1][0] - LEAD,             # «Astronauts can't rehearse on Mars.»       (despega el Saturno V)
    'jezero':     F[2][0] - LEAD,             # «So where on Earth should they train?»    (clic en «Where to train on Earth?»)
    'nombre':     F[3][0] - LEAD,             # «For NASA's analog challenge, we built Landfall: where to land, where to train.»
    'destino':    F[7][0] - LEAD,             # «Pick Mars or the Moon.»
    'resultados': F[8][0] - LEAD,             # «NASA orbiter data ranks the landing sites.»
    'tierra':     F[9][0] - LEAD,             # «Then NASA elevation maps find the closest terrain on Earth.»
    'suelo':      F[10][0] - LEAD,            # «Jezero Crater? Tabernas, Spain.»
    'clima':      F[12][0] - LEAD,            # «Picture every crew rehearsing here,»
    'motor':      F[13][0] - LEAD,            # «on the same kind of ground they'll walk on Mars.»
    'globo':      F[13][0] - LEAD + 1.45,     #   … el panel se retira y el globo queda para el cierre
}
# Bloques de título: (título, «Where to land.», «Where to train.», web | None, hasta)
TITULOS = [
    (F[5][0], F[6][0], F[6][0] + 0.8, None, CORTES['destino']),     # «Landfall: where to land, where to train.»
    (F[14][0], F[14][0] + 0.35, F[14][0] + 0.7, None, DUR + 1),      # cierre: «Landfall.» (sin la web: se quitó «topgit dot earth»)
]
T_TITULO = F[14][0]

# (nombre, ancla en la grabación, 'ini' | 'fin' (el ancla es el principio o el final del tramo), velocidad[, fuente])
# fuente 'web' (grabar.py, por defecto), 'planeta' (planeta.py: el ancla es el tiempo de la escena) o 'fija' (un fotograma)
GLOBO_FIJO = 58.0                 # s de la grabación del fotograma de la fuente 'fija' (sin uso en la v2)
PLANETA_T0 = 0.2                   # s de la escena en que entra el plano (deja fotogramas antes para el fundido)
CAPAS_T = [0.75 + 0.36 * i for i in range(4)]   # s de la escena en que llega cada par de capas (planeta.js: T0, PASO)
PLANOS = [
    ('portada',    ev('Start mission') - 0.15,   'fin', 1.0),    # portada de Landfall (antes del clic)
    ('despegue',   ev('lanzamiento') + 3.6,      'ini', 1.3),    # astronautas: el Saturno V despega
    ('jezero',     ev('Where to train') + 0.12,  'fin', 1.05),   # ficha de Jezero → clic en «Where to train on Earth?»
    ('nombre',     ev('giro') + 3.0,             'ini', 1.0),    # el globo gira con los lugares; título y eslogan a la izquierda
    ('destino',    ev('Mars') + 0.55,            'fin', 1.0),    # elegir destino → clic en Marte
    ('resultados', ev('saltado') + 0.5,          'ini', 1.2),    # en órbita: «Analyzing the surface of Mars» (MOLA, GRS) → los 10 sitios
    ('tierra',     ev('tierra') + 0.3,           'fin', 1.3),    # el globo vuela de Marte a la Tierra y marca Tabernas
    ('suelo',      ev('mismo_suelo') - 0.3,      'ini', 1.0),    # «Jezero Crater? Tabernas, Spain.»: los dos mapas a la misma escala
    ('clima',      ev('clima') + 1.5,            'ini', 1.0),    # «rehearsing here»: Tabernas marcada en el globo + «What you would train»
    ('motor',      ev('cierre') - 0.1,           'fin', 1.0),    # lugares hallados por el motor de similitud (sigue sin corte en el cierre)
    ('globo',      ev('cierre') - 0.1,           'ini', 1.0),    # el panel se retira; el globo se aleja y gira; título
]

# Rótulos: (desde, hasta, texto). Solo datos que la voz no dice.
ROTULOS = [
    (0.35,                        CORTES['despegue'] - 0.15,  'Team Top Git'),
    (CORTES['jezero'] + 0.35,     CORTES['nombre'] - 0.2,     'Jezero Crater · 18.4°N 77.7°E'),
    (CORTES['nombre'] + 0.3,      F[5][0] - 0.25,             'NASA Space Apps 2026 · analog challenge'),
    (CORTES['resultados'] + 0.4,  CORTES['tierra'] - 0.2,     'MOLA · TES · Odyssey GRS'),
    (CORTES['tierra'] + 0.6,      CORTES['suelo'] - 0.2,      'SRTM elevation · 8,401 places compared'),
    (CORTES['clima'] + 0.4,       CORTES['motor'] - 0.2,      'Tabernas · rover tests, delta geology'),
    (CORTES['motor'] + 0.2,       CORTES['globo'] - 0.15,     'Found in NASA elevation data'),
]


def tramos():
    """[(nombre, salida_ini, salida_fin, grab_ini, velocidad, fuente)] con los cortes en fotogramas enteros."""
    bordes = [0.0] + [CORTES[p[0]] for p in PLANOS[1:]] + [DUR]
    bordes = [round(b * FPS) / FPS for b in bordes]
    out = []
    for i, (nom, ancla, tipo, v, *f) in enumerate(PLANOS):
        a, b = bordes[i], bordes[i + 1]
        g = ancla if tipo == 'ini' else ancla - (b - a) * v
        out.append((nom, a, b, g, v, f[0] if f else 'web'))
        if b - a < 1.45: print(f'  AVISO: plano {nom} dura {b - a:.2f} s')
    return out


def linea_tiempo(planos):
    """Fotogramas de salida: [ruta_A, ruta_B | None, alfa, plano]."""
    n_planeta = len(list(PLANETA.glob('*.jpg')))
    def frame_at(t, fuente='web'):
        if fuente == 'fija':   # plano quieto: el globo con los lugares, sin giros ni saltos de cámara
            t = GLOBO_FIJO
        if fuente == 'planeta':
            k = round(t * FPS)
            if not 0 <= k < n_planeta: raise RuntimeError(f'planeta: falta el fotograma {k} (hay {n_planeta}): ejecuta planeta.py')
            return PLANETA / f'{k:06d}.jpg'
        k = min(bisect.bisect_left(ts, T0 + t), len(ts) - 1)
        if k > 0 and abs(ts[k - 1] - T0 - t) < abs(ts[k] - T0 - t): k -= 1
        return TMP / 'frames' / f'{idx[k][0]:06d}.jpg'
    salida = []
    for i, (nom, a, b, g, v, fu) in enumerate(planos):
        for k in range(round((b - a) * FPS)):
            salida.append([frame_at(g + (k + 0.5) / FPS * v, fu), None, 0.0, i])
    pos = 0
    for i, (nom, a, b, g, v, fu) in enumerate(planos):
        if i > 0:
            pn, pa, pb, pg, pv, pf = planos[i - 1]
            continuo = pf == fu and abs(pg + (pb - pa) * pv - g) < 0.05 and abs(pv - v) < 0.01
            if not continuo:   # los últimos FUNDIDO fotogramas del anterior se mezclan con el arranque del siguiente
                for j in range(FUNDIDO):
                    o = pos - FUNDIDO + j
                    salida[o][1] = frame_at(g - (FUNDIDO - j - 0.5) / FPS * v, fu); salida[o][2] = (j + 1) / (FUNDIDO + 1)
        pos += round((b - a) * FPS)
    assert len(salida) == N_TOTAL, len(salida)
    return salida


def efectos(planos):
    sfx = []
    for e in evs:   # clics visibles en la imagen
        if e['ev'] != 'clic': continue
        tc = e['t'] - T0
        for nom, a, b, g, v, fu in planos:
            if fu == 'web' and g <= tc < g + (b - a) * v:
                sfx.append({'t': a + (tc - g) / v, 'tipo': 'clic'}); break
    pl = next((p for p in planos if p[0] == 'planeta'), None)     # las capas de datos se apilan sobre el planeta
    if pl:
        llegadas = [pl[1] + (t - pl[3]) / pl[4] for t in CAPAS_T]
        sfx.append({'t': llegadas[0], 'tipo': 'capas', 'pulsos': [round(t - llegadas[0], 3) for t in llegadas]})
    sfx.append({'t': CORTES['tierra'], 'tipo': 'whoosh'})     # de Marte a la Tierra
    sfx.append({'t': CORTES['globo'] + 0.05, 'tipo': 'whoosh'})   # el panel se retira
    sfx.append({'t': T_TITULO, 'tipo': 'golpe'})
    sfx.append({'t': T_TITULO, 'tipo': 'logo'})
    return sorted(sfx, key=lambda x: x['t'])


# ---------------------------------------------------------------- rótulos (Chromium → PNG con alfa)
CSS = """
  html, body { margin: 0; background: transparent; }
  .lab { position: absolute; left: 0; display: inline-flex; align-items: center; gap: 16px; padding: 14px 24px 14px 18px;
    background: rgba(10, 14, 28, .80); border: 1px solid rgba(200, 205, 225, .17); border-radius: 12px;
    font: 600 31px/1.15 "Avenir Next", "Helvetica Neue", sans-serif; color: #efece5; letter-spacing: .005em; white-space: nowrap;
    font-variant-numeric: lining-nums; -webkit-font-smoothing: antialiased; }
  .lab i { width: 4px; height: 30px; border-radius: 2px; background: #5dffd0; }
  .tit { position: absolute; left: 0; font: 600 92px/1 "Iowan Old Style", Palatino, Georgia, serif; letter-spacing: .14em; color: #efece5;
    white-space: nowrap; text-shadow: 0 3px 18px rgba(0,0,0,.55); }
  .tit span { font-size: .8em; margin-right: .32em; letter-spacing: 0; }
  .lema { position: absolute; left: 0; font: italic 500 46px/1.2 "Iowan Old Style", Palatino, Georgia, serif; color: #efece5;
    white-space: nowrap; text-shadow: 0 2px 14px rgba(0,0,0,.6); }
  .web { position: absolute; left: 0; display: inline-flex; align-items: center; gap: 14px; font: 600 36px/1 "Avenir Next", sans-serif;
    color: #efece5; white-space: nowrap; padding: 12px 22px 12px 18px; background: rgba(10, 14, 28, .80);
    border: 1px solid rgba(200, 205, 225, .17); border-radius: 12px; }
  .web i { width: 4px; height: 30px; border-radius: 2px; background: #5dffd0; }
"""


def _png_rgba(ruta):
    raw = Path(ruta).read_bytes()
    w, h = int.from_bytes(raw[16:20], 'big'), int.from_bytes(raw[20:24], 'big')
    px = subprocess.run([FF, '-v', 'error', '-i', str(ruta), '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], check=True, capture_output=True).stdout
    a = np.frombuffer(px, np.uint8).reshape(h, w, 4).astype(np.float32) / 255
    return a[..., :3] * 255, a[..., 3:]


def capas():
    """Lista de capas: dict(rgb, a, x, y, desde, hasta, sube). Cada una se funde y sube unos px al entrar."""
    from playwright.sync_api import sync_playwright
    elems = [('lab', f'<i></i>{t}') for _, _, t in ROTULOS] + [
        ('tit', '<span>◐</span>LANDFALL'), ('lema', 'Where to land.'), ('lema', 'Where to train.'),
        ('web', '<i></i>topgit.earth')]
    html = f'<style>{CSS}</style>' + ''.join(f'<div class="{c}" id="e{k}" style="top:{k * 160}px">{t}</div>' for k, (c, t) in enumerate(elems))
    d = Path(tempfile.mkdtemp())
    pngs = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': W0, 'height': 160 * len(elems)}, device_scale_factor=ESC)
        pg.set_content(html); pg.wait_for_timeout(300)
        for k in range(len(elems)):
            ruta = d / f'e{k}.png'; pg.locator(f'#e{k}').screenshot(path=str(ruta), omit_background=True); pngs.append(_png_rgba(ruta))
        b.close()
    shutil.rmtree(d)
    out = []
    for k, (desde, hasta, _) in enumerate(ROTULOS):
        rgb, a = pngs[k]
        out.append(dict(rgb=rgb, a=a, x=MARGEN, y=H - MARGEN - rgb.shape[0], desde=desde, hasta=hasta, sube=10 * ESC))
    # título: bloque a la izquierda del globo, centrado en vertical (mismo sitio en cada aparición)
    tit, l1, l2, web = pngs[len(ROTULOS):]
    alto = tit[0].shape[0] + 34 * ESC + l1[0].shape[0] + l2[0].shape[0] + 44 * ESC + web[0].shape[0]
    for t_tit, t_l1, t_l2, t_web, hasta in TITULOS:
        y = (H - alto) // 2 - 10 * ESC; x = 150 * ESC
        for (rgb, a), t, extra in [(tit, t_tit, 34 * ESC), (l1, t_l1, 0), (l2, t_l2, 44 * ESC), (web, t_web, 0)]:
            if t is not None: out.append(dict(rgb=rgb, a=a, x=x, y=y, desde=t, hasta=hasta, sube=12 * ESC))
            y += rgb.shape[0] + extra
    return out


def componer(img, t, capas_):
    for c in capas_:
        if not (c['desde'] <= t < c['hasta']): continue
        f = 0.22
        al = min(1.0, (t - c['desde']) / f, (c['hasta'] - t) / f)
        u = min(1.0, (t - c['desde']) / 0.35); dy = round(c['sube'] * (1 - u) ** 3)
        y0, x0 = c['y'] + dy, c['x']; h, w = c['rgb'].shape[:2]
        zona = img[y0:y0 + h, x0:x0 + w]
        a = c['a'] * al
        zona[:] = zona * (1 - a) + c['rgb'] * a
    return img


def main():
    planos = tramos()
    salida = linea_tiempo(planos)
    sfx = efectos(planos)
    (TMP / 'sfx.json').write_text(json.dumps(sfx, indent=1))
    wav = audio.generar(sfx, DUR, TMP / 'audio.wav', t_titulo=T_TITULO)
    print('audio:', wav)
    capas_ = capas()

    necesarios = []
    for a_, b_, al, _ in salida:
        necesarios.append(a_)
        if b_ is not None: necesarios.append(b_)
    seq = TMP / 'seq'
    if seq.exists(): shutil.rmtree(seq)
    seq.mkdir()
    for k, ruta in enumerate(necesarios): (seq / f'{k:06d}.jpg').symlink_to(ruta)
    dec = subprocess.Popen([FF, '-nostdin', '-loglevel', 'error', '-f', 'image2', '-framerate', str(FPS), '-i', str(seq / '%06d.jpg'),
                            '-vf', f'scale={W}:{H}:flags=lanczos', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
    enc = subprocess.Popen([FF, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                            '-i', str(wav), '-map', '0:v', '-map', '1:a', '-vf', 'format=yuv420p',
                            '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high', '-tune', 'film', '-pix_fmt', 'yuv420p',
                            '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', '-t', str(DUR), str(SALIDA)],
                           stdin=subprocess.PIPE)
    tam = W * H * 3
    def leer():
        buf = dec.stdout.read(tam)
        if len(buf) < tam: raise RuntimeError('faltan fotogramas al decodificar')
        return np.frombuffer(buf, np.uint8).reshape(H, W, 3).astype(np.float32)
    for n, (a_, b_, al, _) in enumerate(salida):
        fa = leer()
        if b_ is not None: fa = fa * (1 - al) + leer() * al
        if n < ENTRADA: fa *= (n + 1) / (ENTRADA + 1)
        fa = componer(fa, n / FPS, capas_)
        enc.stdin.write(np.clip(fa + 0.5, 0, 255).astype(np.uint8).tobytes())
        if n % 150 == 0: print(f'  {n}/{len(salida)}', flush=True)
    enc.stdin.close(); enc.wait(); dec.wait()
    print('planos:')
    for nom, a, b, g, v, fu in planos:
        print(f'  {a:6.2f}–{b:6.2f}  ({b - a:4.2f} s)  {nom:11s}  {"grabación" if fu == "web" else "escena   "} {g:6.2f}–{g + (b - a) * v:6.2f}  ×{v:.2f}')
    print('rótulos:'); [print(f'  {a:6.2f}–{b:6.2f}  {t}') for a, b, t in ROTULOS]
    for t in TITULOS: print('  título', ' · '.join('—' if x is None else f'{x:.2f}' for x in t))
    print(SALIDA)


if __name__ == '__main__':
    main()
