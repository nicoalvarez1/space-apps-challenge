"""Graba el plano «planeta» (tools/video/planeta.html: mitad Marte, mitad Luna, con las capas de datos apilándose).

Uso:  .venv/bin/python tools/video/planeta.py   (con la web servida en http://localhost:8080)
Salida: video/tmp/planeta/000000.jpg … (1920×1080, un fotograma cada 1/30 s del tiempo de la escena)

A diferencia de grabar.py (screencast en tiempo real), esta escena es determinista: la página expone
window.__frame(t) y aquí se dibuja y se captura cada fotograma (canvas a 2× → reducido por Chrome: antialias limpio).
Antes se espera a window.__listo (texturas 8K, casquetes polares, cielo y las 8 capas de datos ya pintadas).
"""
import asyncio, os, shutil
from pathlib import Path
from playwright.async_api import async_playwright

RAIZ = Path(__file__).resolve().parents[2]
SAL = RAIZ / 'video' / 'tmp' / 'planeta'
URL = os.environ.get('LANDFALL_URL', 'http://localhost:8080/') + 'tools/video/planeta.html?rec'
W, H, FPS = 1920, 1080, 30


async def main():
    if SAL.exists(): shutil.rmtree(SAL)
    SAL.mkdir(parents=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, args=['--use-angle=metal', '--ignore-gpu-blocklist', '--hide-scrollbars'])
        pg = await b.new_page(viewport={'width': W, 'height': H}, device_scale_factor=1)
        pg.on('pageerror', lambda e: print('PAGEERROR', e, flush=True))
        pg.on('console', lambda m: m.type in ('error', 'warning') and print('CONSOLE', m.text[:300], flush=True))
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function('window.__listo !== undefined', timeout=30000)
        await pg.evaluate('window.__listo')
        await asyncio.sleep(1.0)
        dur = await pg.evaluate('window.__duracion')
        n = round(dur * FPS) + 1
        for k in range(n):
            await pg.evaluate('(t) => window.__frame(t)', k / FPS)
            await pg.screenshot(path=str(SAL / f'{k:06d}.jpg'), type='jpeg', quality=94)
            if k % 30 == 0: print(f'  {k}/{n}', flush=True)
        await b.close()
    print(f'{n} fotogramas → {SAL}')


if __name__ == '__main__':
    asyncio.run(main())
