"""Frases de la locución en la línea de tiempo del vídeo (para que montar.py corte cada plano con su frase).

Uso:  .venv/bin/python tools/video/locucion.py [locucion.mp3]   → imprime las frases detectadas

La voz se prepara igual que en voz.py (sin silencio inicial, INICIO s de margen, pausas acortadas si no cabe) y se
buscan las pausas con el filtro silencedetect de ffmpeg:
- pausas ≥ 0,12 s a −38 dB (tras acortarlas) → los 17 tramos del guion v2 (video/guion_v2_estructura.md).
Devuelve 17 tramos (inicio, fin) en segundos del vídeo, en el orden de FRASES. Si la detección no cuadra con el guion
se usan los tiempos medidos en la locución aprobada (RESERVA).
"""
import os, re, subprocess, sys
from pathlib import Path
import imageio_ffmpeg

sys.path.insert(0, str(Path(__file__).parent))
import voz  # noqa: E402

FF = imageio_ffmpeg.get_ffmpeg_exe()
MP3 = Path('/Users/martiquimmargot/Downloads/ElevenLabs_2026-11-15T11_45_19_Hale - Smooth, Confident and Persuasive_pvc_s55_sim75_v4.mp3')

# Guion v2 (video/guion_v2_estructura.md): un tramo por cada pausa de la toma (la v1 está en video/copia_2026-11-15_30s_v1/)
FRASES = [
    "We're Team Top Git.",                                              # 0  preséntate
    "Astronauts can't rehearse on Mars.",                               # 1  desafío
    'So where on Earth should they train?',                             # 2
    "For NASA's analog challenge,",                                     # 3  nombre y eslogan
    'we built',                                                         # 4
    'Landfall:',                                                        # 5
    'where to land, where to train.',                                   # 6
    'Pick Mars or the Moon.',                                           # 7  cómo funciona
    'NASA orbiter data ranks the landing sites.',                       # 8
    'Then NASA elevation maps find the closest terrain on Earth.',      # 9
    'Jezero Crater?',                                                   # 10
    'Tabernas, Spain.',                                                 # 11
    'Picture every crew rehearsing here,',                              # 12 futuro
    "on the same kind of ground they'll walk on Mars.",                 # 13
    'Landfall.',                                                        # 14
    'topgit dot',                                                       # 15
    'earth.',                                                           # 16
]
# medidos en la toma v2 (31,6 s; 28,5 s con las pausas acortadas), ya en tiempo de vídeo
RESERVA = [(0.25, 1.71), (1.94, 4.04), (4.20, 6.25), (6.42, 8.06), (8.18, 8.70), (8.85, 9.57), (9.71, 11.37),
           (11.53, 12.91), (13.06, 15.51), (15.66, 19.41), (19.57, 20.30), (20.47, 21.49), (21.65, 23.78),
           (23.92, 26.46), (26.66, 27.35), (27.49, 27.99), (28.11, 28.51)]


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
    # las pausas ya vienen acortadas por voz.preparar (mín. 0,12 s): se buscan las de ≥ 0,12 s a −38 dB
    sil = [(a, b) for a, b in _silencios(wav, -38, 0.12) if a > voz.INICIO + 0.05 and b < dur - 0.05]
    bordes = [voz.INICIO] + [x for a, b in sil for x in (a, b)] + [dur]
    tramos = [(bordes[i], bordes[i + 1]) for i in range(0, len(bordes) - 1, 2)]
    if len(tramos) != len(FRASES):
        print(f'[locucion] {len(tramos)} tramos detectados (se esperaban {len(FRASES)}): tiempos de reserva'); return RESERVA
    return [(round(a / tempo, 3), round(b / tempo, 3)) for a, b in tramos]


if __name__ == '__main__':
    for (a, b), txt in zip(frases(sys.argv[1] if len(sys.argv) > 1 else None), FRASES):
        print(f'{a:6.2f}–{b:6.2f}  {txt}')
