"""Frases de la locución en la línea de tiempo del vídeo (para que montar.py corte cada plano con su frase).

Uso:  .venv/bin/python tools/video/locucion.py [locucion.mp3]   → imprime las frases detectadas

La voz se prepara igual que en voz.py (sin silencio inicial, INICIO s de margen, pausas acortadas si no cabe) y se
buscan las pausas con el filtro silencedetect de ffmpeg:
- pausas ≥ 0,25 s a −38 dB → las 10 frases del guion (video/guion_locucion.md);
- la frase 2 («Landfall ranks ten candidate sites, scored with real NASA orbiter data.») se parte en su pausa interna
  más larga (silencedetect −32 dB, ≥ 0,08 s): «…sites,» | «scored…».
Devuelve 11 tramos (inicio, fin) en segundos del vídeo, en el orden de FRASES. Si la detección no cuadra con el guion
se usan los tiempos medidos en la locución aprobada (RESERVA).
"""
import os, re, subprocess, sys
from pathlib import Path
import imageio_ffmpeg

sys.path.insert(0, str(Path(__file__).parent))
import voz  # noqa: E402

FF = imageio_ffmpeg.get_ffmpeg_exe()
MP3 = Path('/Users/martiquimmargot/Downloads/ElevenLabs_2026-11-15T06_12_36_Hale - Smooth, Confident and Persuasive_pvc_s50_sim75_v4.mp3')

FRASES = [
    'Where should the first crew land on Mars?',
    'Landfall ranks ten candidate sites,',
    'scored with real NASA orbiter data.',
    "Here's Jezero Crater, mapped by Mars Global Surveyor.",
    'Before launch, the crew trains on Earth.',
    'Tabernas, in Spain, has similar ground…',
    'and NASA climate data picks the season.',
    'And it maps more terrain twins across the globe.',
    'Landfall.',
    'Real NASA data on where to land — and where to train.',
    'topgit dot earth.',
]
# medidos en la toma aprobada (28,7 s), ya en tiempo de vídeo
RESERVA = [(0.25, 2.42), (2.93, 5.11), (5.24, 7.42), (7.89, 11.09), (11.57, 13.84), (14.29, 16.68), (17.03, 19.14),
           (19.58, 22.29), (22.78, 23.47), (23.83, 27.08), (27.49, 28.65)]


def ruta():
    return Path(os.environ.get('LANDFALL_VOZ', MP3))


def _silencios(wav, ruido, minimo):
    err = subprocess.run([FF, '-nostdin', '-i', str(wav), '-af', f'silencedetect=noise={ruido}dB:d={minimo}', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    ini = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', err)]
    fin = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', err)]
    return list(zip(ini, fin))


def frases(mp3=None):
    mp3 = Path(mp3 or ruta())
    if not mp3.exists():
        print(f'[locucion] no está {mp3}: tiempos de reserva'); return RESERVA
    wav, tempo = voz.preparar(mp3)
    dur = voz.leer(wav).size / voz.SR
    sil = [(a, b) for a, b in _silencios(wav, -38, 0.25) if a > voz.INICIO + 0.05 and b < dur - 0.05]
    bordes = [voz.INICIO] + [x for a, b in sil for x in (a, b)] + [dur]
    tramos = [(bordes[i], bordes[i + 1]) for i in range(0, len(bordes) - 1, 2)]
    if len(tramos) != 10:
        print(f'[locucion] {len(tramos)} frases detectadas (se esperaban 10): tiempos de reserva'); return RESERVA
    a, b = tramos[1]
    dentro = [(s, e) for s, e in _silencios(wav, -32, 0.08) if a + 0.3 < s and e < b - 0.3]
    if not dentro:
        print('[locucion] sin pausa interna en la frase 2: tiempos de reserva'); return RESERVA
    s, e = max(dentro, key=lambda p: p[1] - p[0])
    tramos[1:2] = [(a, s), (e, b)]
    return [(round(a / tempo, 3), round(b / tempo, 3)) for a, b in tramos]


if __name__ == '__main__':
    for (a, b), txt in zip(frases(sys.argv[1] if len(sys.argv) > 1 else None), FRASES):
        print(f'{a:6.2f}–{b:6.2f}  {txt}')
