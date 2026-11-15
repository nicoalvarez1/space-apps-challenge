"""Graba la web «Landfall» para el vídeo de 30 s (análogos en la Tierra para bases en Marte).

Uso:  .venv/bin/python tools/video/grabar.py   (con la web servida en http://localhost:8080)

Graba con el screencast de Chrome (CDP, JPEG de alta calidad, 1920×1080) en vez de record_video, que comprime mucho.
Cada fotograma se guarda con su marca de tiempo en video/tmp/frames/ y las acciones (clics, desplazamientos, planos
listos) se anotan en video/tmp/eventos.json: montar.py elige los tramos a partir de esas marcas.

Encuadre limpio (solo durante la grabación, con CSS/JS inyectado; la web no se toca):
- se ocultan el panel «Data layers», los créditos de la esquina, los chips e insignias de la barra superior, el botón
  y el cuadro flotante «Purpose chart», los avisos y todos los tooltips;
- el cursor solo aparece cuando va a hacer clic: entra con un fundido, sigue una curva suave con aceleración (jerk
  mínimo) y el clic se marca con un anillo fino; después desaparece;
- los desplazamientos son animados (ease in-out) y los planos estáticos llevan un zoom lento (Ken Burns) hecho con
  CSS sobre <html>, que Chrome rasteriza nítido;
- antes de cada plano se espera a que estén las texturas, la imagen Landsat, los datos de NASA POWER y el motor.
"""
import asyncio, base64, json, math, os, shutil, time
from pathlib import Path
from playwright.async_api import async_playwright

RAIZ = Path(__file__).resolve().parents[2]
TMP = RAIZ / 'video' / 'tmp'
FR = TMP / 'frames'
URL = os.environ.get('LANDFALL_URL', 'http://localhost:8080/')
W, H = 1920, 1080

INYECTADO = r"""
addEventListener('DOMContentLoaded', () => {
  const st = document.createElement('style');
  st.textContent = `
    /* lo que distrae y no aporta al vídeo */
    #layers, #credits, #perfil, #data-badge, #btn-grafico, #tip, .g-tip, .cmp-tip, #toast { display: none !important; }
    #chips { visibility: hidden !important; }   /* oculto, pero conserva el hueco: los botones siguen a la derecha */
    html { transform-origin: 50% 50%; }
    #__cur { position: fixed; left: 0; top: 0; width: 30px; height: 30px; z-index: 2147483647; pointer-events: none;
      transform: translate(-100px, -100px); opacity: 0; transition: opacity .28s ease; filter: drop-shadow(0 2px 5px rgba(0,0,0,.55)); }
    #__cur svg { transition: transform .12s ease; transform-origin: 3px 2px; }
    #__cur.press svg { transform: scale(.86); }
    .__ring { position: fixed; width: 18px; height: 18px; margin: -9px 0 0 -9px; border: 2px solid rgba(255,255,255,.95);
      border-radius: 50%; z-index: 2147483646; pointer-events: none; box-shadow: 0 0 0 1px rgba(93,255,208,.55);
      animation: __r .5s cubic-bezier(.2,.7,.3,1) forwards; }
    @keyframes __r { from { transform: scale(.5); opacity: .95 } to { transform: scale(2.6); opacity: 0 } }
  `;
  document.head.appendChild(st);
  const c = document.createElement('div'); c.id = '__cur';
  c.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M3 2 L3 19 L7.5 15 L10.5 22 L13.5 20.8 L10.6 14 L17 14 Z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  document.body.appendChild(c);
  window.__cursor = (v) => { c.style.opacity = v ? '1' : '0'; };
  addEventListener('mousemove', (e) => { c.style.transform = `translate(${e.clientX - 3}px, ${e.clientY - 2}px)`; }, true);
  addEventListener('mousedown', (e) => {
    if (c.style.opacity !== '1') return;
    c.classList.add('press');
    const r = document.createElement('div'); r.className = '__ring'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
    document.body.appendChild(r); setTimeout(() => r.remove(), 600);
  }, true);
  addEventListener('mouseup', () => c.classList.remove('press'), true);
});
"""

eventos = []
def marca(nombre, **kw):
    eventos.append({'t': time.time(), 'ev': nombre, **kw}); print(f'{time.strftime("%X")}  {nombre} {kw if kw else ""}', flush=True)


class Raton:
    """Cursor deliberado: curva de Bézier con un arco leve y perfil de jerk mínimo (arranca y frena suave)."""
    def __init__(self, pg): self.pg, self.x, self.y = pg, W * 0.62, H * 0.62

    async def ver(self, v=True, espera=0.3):
        await self.pg.evaluate('(v) => window.__cursor(v)', v); await asyncio.sleep(espera)

    async def saltar(self, x, y):
        """Coloca el ratón sin animación (cursor oculto)."""
        await self.pg.mouse.move(x, y); self.x, self.y = x, y

    async def mover(self, x, y, dur=None):
        x0, y0 = self.x, self.y
        d = math.hypot(x - x0, y - y0)
        if d < 1: return
        dur = dur or min(1.0, max(0.5, 0.42 + d / 2600))
        # punto de control desplazado en perpendicular (arco natural, siempre hacia el mismo lado)
        mx, my = (x0 + x) / 2, (y0 + y) / 2
        nx, ny = -(y - y0) / d, (x - x0) / d
        cx, cy = mx + nx * d * 0.08, my + ny * d * 0.08
        n = max(10, int(dur * 60)); t0 = time.perf_counter()
        for i in range(1, n + 1):
            u = i / n; e = u ** 3 * (10 - 15 * u + 6 * u * u)
            px = (1 - e) ** 2 * x0 + 2 * (1 - e) * e * cx + e * e * x
            py = (1 - e) ** 2 * y0 + 2 * (1 - e) * e * cy + e * e * y
            await self.pg.mouse.move(px, py)
            await asyncio.sleep(max(0, t0 + dur * i / n - time.perf_counter()))
        self.x, self.y = x, y

    async def a(self, sel, dur=None, dx=0.5, dy=0.5):
        loc = self.pg.locator(sel).first
        await loc.scroll_into_view_if_needed()
        b = await loc.bounding_box()
        await self.mover(b['x'] + b['width'] * dx, b['y'] + b['height'] * dy, dur)

    async def clic(self, sel=None, dur=None, nombre=None, **kw):
        if sel: await self.a(sel, dur, **kw)
        await asyncio.sleep(0.16)
        marca('clic', que=nombre or sel, x=self.x, y=self.y)
        await self.pg.mouse.down(); await asyncio.sleep(0.08); await self.pg.mouse.up()


async def desplazar(pg, cont, top, dur=1.0):
    """Desplazamiento suave de un panel (scrollTop) con aceleración y frenada."""
    await pg.evaluate("""([sel, top, dur]) => new Promise((r) => { const el = document.querySelector(sel), y0 = el.scrollTop, t0 = performance.now();
      const f = () => { const u = Math.min(1, (performance.now() - t0) / dur), e = u < .5 ? 4*u*u*u : 1 - (-2*u + 2) ** 3 / 2;
        el.scrollTop = y0 + (top - y0) * e; u < 1 ? requestAnimationFrame(f) : r(); }; f(); })""", [cont, top, dur * 1000])

async def posicion(pg, cont, sel, margen=20):
    """scrollTop de `cont` que deja `sel` arriba del todo."""
    return await pg.evaluate("""([c, s, m]) => { const C = document.querySelector(c), E = document.querySelector(s);
      return C.scrollTop + E.getBoundingClientRect().top - C.getBoundingClientRect().top - m; }""", [cont, sel, margen])

async def posicion_texto(pg, cont, texto, margen=20):
    return await pg.evaluate("""([c, t, m]) => { const C = document.querySelector(c);
      const E = [...C.querySelectorAll('h2,h3,h4,summary,.g-tit,figcaption,b,strong,p,span')].find((e) => e.textContent.trim().startsWith(t) && e.offsetParent);
      if (!E) return null; return C.scrollTop + E.getBoundingClientRect().top - C.getBoundingClientRect().top - m; }""", [cont, texto, margen])

async def centro(pg, sel):
    """Centro de un elemento en fracción de la pantalla (origen del zoom lento)."""
    b = await pg.locator(sel).first.bounding_box()
    return (b['x'] + b['width'] / 2) / W, (b['y'] + b['height'] / 2) / H

async def zoom_lento(pg, ox, oy, escala=1.035, dur=3.2):
    """Ken Burns: acercamiento lineal y lento de toda la página hacia (ox, oy)."""
    await pg.evaluate("""([ox, oy, s, d]) => { const h = document.documentElement;
      h.style.transition = 'none'; h.style.transform = 'none'; h.style.transformOrigin = `${ox * 100}% ${oy * 100}%`; h.offsetWidth;
      h.style.transition = `transform ${d}s linear`; h.style.transform = `scale(${s})`; }""", [ox, oy, escala, dur])

async def zoom_fuera(pg):
    await pg.evaluate("() => { const h = document.documentElement; h.style.transition = 'none'; h.style.transform = 'none'; }")


async def main():
    if FR.exists(): shutil.rmtree(FR)
    FR.mkdir(parents=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, args=['--use-angle=metal', '--ignore-gpu-blocklist', '--hide-scrollbars'])
        ctx = await b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=1, locale='en-US')
        await ctx.add_init_script(INYECTADO)
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: print('PAGEERROR', e, flush=True))
        pg.on('console', lambda m: m.type == 'error' and '.glb' not in m.location.get('url', '') and print('CONSOLE', m.text[:200], flush=True))
        r = Raton(pg)

        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("document.querySelector('#load-status')?.classList.contains('done')", timeout=120000)
        await pg.wait_for_function("/^\\d/.test(document.querySelector('#stats b')?.textContent || '') && document.querySelectorAll('#stats b')[3].textContent !== '—'", timeout=30000)
        await r.saltar(1180, 820)
        await asyncio.sleep(3.0)   # texturas 8K subidas a la GPU

        # ---- screencast ----
        cdp = await ctx.new_cdp_session(pg)
        n = {'i': 0}
        idx = []
        async def fotograma(ev):
            i = n['i']; n['i'] += 1
            (FR / f'{i:06d}.jpg').write_bytes(base64.b64decode(ev['data']))
            idx.append((i, ev['metadata']['timestamp']))
            try: await cdp.send('Page.screencastFrameAck', {'sessionId': ev['sessionId']})
            except Exception: pass
        cdp.on('Page.screencastFrame', lambda ev: asyncio.ensure_future(fotograma(ev)))
        await cdp.send('Page.startScreencast', {'format': 'jpeg', 'quality': 94, 'maxWidth': W, 'maxHeight': H, 'everyNthFrame': 1})
        await asyncio.sleep(0.8)

        # (1) portada → Marte, en un solo plano
        marca('portada')
        await asyncio.sleep(0.5)
        await r.ver(True, 0.35)
        await r.clic('#btn-empezar', 0.95, 'Start mission', dx=0.42)
        await asyncio.sleep(0.8)
        marca('destino')
        await r.clic('[data-body=mars]', 0.8, 'Mars')
        await asyncio.sleep(0.75)
        marca('marte_ok')
        await r.ver(False, 0.3)
        # resto del asistente fuera de plano (cursor oculto)
        await r.clic('#btn-next', 0.3, 'Next')
        await asyncio.sleep(0.6)
        await r.clic('#setup label.opcion >> text=Housing', 0.3, 'Housing', dx=0.3)
        await asyncio.sleep(0.4)
        await r.clic('#btn-next', 0.3, 'Next')
        await asyncio.sleep(0.5)
        await r.clic('#btn-next', 0.3, 'Launch')
        marca('lanzamiento')

        # (2) despegue real; «Skip trip» fuera de plano
        await r.saltar(1300, 640)
        await asyncio.sleep(7.0)
        await pg.click('#btn-skip')
        marca('saltado')
        await pg.wait_for_selector('#results:not([hidden])', timeout=60000)
        await pg.wait_for_function("document.querySelectorAll('#res-list li[data-id]').length >= 10", timeout=30000)
        await asyncio.sleep(2.6)   # la lista termina de entrar y el globo se asienta

        # (3) los 10 emplazamientos → «Compare with measured data»
        marca('resultados_ok')
        await asyncio.sleep(0.5)
        await r.ver(True, 0.3)
        await r.clic('#btn-comparar', 1.0, 'Compare with measured data')
        await pg.wait_for_selector('#analisis:not([hidden]) table', timeout=30000)
        await asyncio.sleep(0.2)
        await r.ver(False, 0.0)
        await asyncio.sleep(0.9)
        ox, oy = await centro(pg, '#analisis table')
        await zoom_lento(pg, ox, oy, 1.035, 3.2)
        marca('comparar')
        await asyncio.sleep(2.8)
        await pg.keyboard.press('Escape'); await asyncio.sleep(0.2)
        await zoom_fuera(pg)
        await pg.wait_for_selector('#analisis', state='hidden', timeout=10000)
        await r.saltar(1250, 560)
        await asyncio.sleep(1.0)

        # (4) ficha de Jezero (relieve MOLA) → «Where to train on Earth?»
        marca('jezero_pre')
        await r.ver(True, 0.3)
        await r.clic('#res-list li[data-id] >> text=Jezero', 0.9, 'Jezero crater', dx=0.35)
        marca('ficha')
        await pg.wait_for_selector('#detail-body [data-g="entorno"] svg, #detail-body [data-g="entorno"] canvas', timeout=30000)
        await asyncio.sleep(0.9)
        await r.a('#detail-body [data-g="entorno"] canvas, #detail-body [data-g="entorno"] svg', 0.8, 0.45, 0.5)
        await asyncio.sleep(0.45)
        await r.clic('#btn-train', 0.75, 'Where to train on Earth?', dx=0.4)
        await asyncio.sleep(0.25)
        await r.ver(False, 0.0)

        # (5) el globo vuela a la Tierra: Tabernas
        await pg.wait_for_function("window.landfall.viewer.focusId === 'earth'", timeout=30000, polling=30)
        marca('tierra')
        t_tierra = time.time()
        await pg.wait_for_function("(() => { const i = document.querySelector('#famosos-body img'); return i && i.complete && i.naturalWidth > 0; })()", timeout=60000)
        await pg.wait_for_function("[...document.querySelectorAll('#training svg')].length >= 1 && !document.querySelector('#famosos-body .g-cargando')", timeout=60000)
        marca('tierra_lista')
        await asyncio.sleep(max(0.0, t_tierra + 2.35 - time.time()))
        # «Same kind of ground»: Marte y la Tierra a la misma escala
        y = await posicion_texto(pg, '#training', 'Same kind of ground', 16)
        marca('mismo_suelo')
        await desplazar(pg, '#training', y, 1.0)
        await asyncio.sleep(2.2)
        # «When to go»: clima de NASA POWER
        y = await posicion_texto(pg, '#training', 'When to go', 16)
        marca('clima')
        await desplazar(pg, '#training', y, 0.9)
        ox, oy = await centro(pg, '#training svg')
        await zoom_lento(pg, ox, oy, 1.03, 3.0)
        await asyncio.sleep(2.6)
        await zoom_fuera(pg)

        # (6) «Places found by NASA terrain data» (motor de similitud) — se abre fuera de plano
        await pg.click('#an-motor-plg summary')
        await pg.wait_for_selector('#an-motor .an-cand', timeout=60000)
        await asyncio.sleep(0.6)
        y = await posicion(pg, '#training', '#an-motor-plg', 10)
        await desplazar(pg, '#training', y, 0.6)
        await asyncio.sleep(1.2)   # mapas de los candidatos y marcadores en el globo
        await r.saltar(380, 700)   # sobre el globo (cursor oculto), para la rueda del cierre
        ox, oy = await centro(pg, '#an-motor .an-cand')
        await zoom_lento(pg, ox, oy + 0.08, 1.03, 2.8)
        marca('motor')
        await asyncio.sleep(2.05)

        # (7) cierre: el panel se retira y el globo, con el análogo y los lugares del motor, ocupa el plano
        marca('cierre')
        # a la vez: el panel sale, el globo se desplaza a la derecha (deja sitio al título; la propia web suaviza
        # el cambio de encuadre) y se aleja un poco; luego gira solo, hacia el este, con la rotación de OrbitControls
        await pg.evaluate("""() => { const tr = document.querySelector('#training'), v = window.landfall.viewer;
          tr.style.transition = 'transform .6s cubic-bezier(.5,0,.75,0), opacity .6s'; tr.style.transform = 'translateX(110%)'; tr.style.opacity = '0';
          setTimeout(() => { tr.hidden = true; dispatchEvent(new Event('resize')); }, 620);
          const h = document.documentElement; h.style.transition = 'transform .9s cubic-bezier(.45,0,.55,1)'; h.style.transform = 'none';   // deshace el zoom lento sin salto
          const fija = () => { v.shiftX = 0.2; requestAnimationFrame(fija); }; fija(); }""")
        for _ in range(22):
            await pg.mouse.wheel(0, 55); await asyncio.sleep(0.05)
        await pg.evaluate("() => { const c = window.landfall.viewer.controls; c.autoRotate = true; c.autoRotateSpeed = -%s; }" % os.environ.get('GIRO', '2.2'))
        marca('giro')
        await asyncio.sleep(10.0)
        marca('fin')

        await cdp.send('Page.stopScreencast')
        await asyncio.sleep(0.5)
        await b.close()

    (TMP / 'frames.json').write_text(json.dumps(idx))
    (TMP / 'eventos.json').write_text(json.dumps(eventos, indent=1))
    dur = idx[-1][1] - idx[0][1]
    print(f'{len(idx)} fotogramas en {dur:.1f} s  ({len(idx) / dur:.1f} fps)')


if __name__ == '__main__':
    asyncio.run(main())
