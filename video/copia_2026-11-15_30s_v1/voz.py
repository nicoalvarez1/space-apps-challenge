"""Añade la locución al vídeo de 30 s.

Uso:  .venv/bin/python tools/video/voz.py [locucion.mp3]   (por defecto, la locución aprobada: locucion.MP3)
Entrada: video/landfall_30s.mp4 (vídeo con música y efectos) y la locución.
Salida:  video/landfall_30s_voz.mp4

La locución dura algo más de 30 s: se acortan las pausas entre frases (no la voz) y, si aún hace falta, se acelera un
poco sin cambiar el tono (atempo). La música y los efectos bajan automáticamente mientras habla la voz (sidechain).
"""
import subprocess, sys, wave
from pathlib import Path
import numpy as np
import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
RAIZ = Path(__file__).resolve().parents[2]
VIDEO = RAIZ / 'video' / 'landfall_30s.mp4'
SALIDA = RAIZ / 'video' / 'landfall_30s_voz.mp4'
TMP = RAIZ / 'video' / 'tmp'
SR = 48000
OBJETIVO = 29.0          # s: la voz termina un poco antes del final del vídeo
INICIO = 0.25            # s: pequeño margen antes de la primera palabra


def leer(mp3):
    crudo = subprocess.run([FF, '-v', 'error', '-i', str(mp3), '-ac', '1', '-ar', str(SR), '-f', 's16le', '-'],
                           check=True, capture_output=True).stdout
    return np.frombuffer(crudo, np.int16).astype(np.float32) / 32768


def acortar_pausas(x, factor):
    """Detecta pausas (energía baja en ventanas de 20 ms) y las reduce a `factor` de su duración (mín. 0,12 s)."""
    v = int(0.02 * SR)
    e = np.sqrt(np.convolve(x ** 2, np.ones(v) / v, 'same'))
    silencio = e < 10 ** (-38 / 20)
    trozos, i, n = [], 0, len(x)
    while i < n:
        j = i
        while j < n and silencio[j] == silencio[i]:
            j += 1
        seg = x[i:j]
        if silencio[i] and (j - i) > 0.18 * SR:
            nuevo = max(int(0.12 * SR), int((j - i) * factor))
            mitad = nuevo // 2
            seg = np.concatenate([seg[:mitad], seg[-(nuevo - mitad):]])
        trozos.append(seg)
        i = j
    y = np.concatenate(trozos)
    # quita el silencio inicial y final
    nz = np.where(np.abs(y) > 10 ** (-45 / 20))[0]
    return y[nz[0]:nz[-1] + 1] if len(nz) else y


def escribir(ruta, x):
    with wave.open(str(ruta), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())


def preparar(mp3):
    """Voz lista para el vídeo: sin silencios en los extremos, pausas acortadas si no cabe y INICIO s de margen.
    Escribe video/tmp/voz_ajustada.wav y devuelve (ruta, tempo). locucion.py usa lo mismo para sincronizar los planos."""
    TMP.mkdir(parents=True, exist_ok=True)
    x = leer(mp3)
    y = acortar_pausas(x, 1.0)                                  # solo quita el silencio del principio y del final
    if len(y) / SR > OBJETIVO: y = acortar_pausas(x, 0.45)      # no cabe: se acortan las pausas entre frases
    dur = len(y) / SR
    tempo = max(1.0, dur / OBJETIVO)
    print(f'voz original {len(x)/SR:.2f} s · tras acortar pausas {dur:.2f} s · atempo {tempo:.3f}')
    y = np.concatenate([np.zeros(int(INICIO * SR), np.float32), y])
    voz = TMP / 'voz_ajustada.wav'
    escribir(voz, y)
    return voz, tempo


def main(mp3):
    voz, tempo = preparar(mp3)
    # música+efectos (pista del vídeo) atenuados por la voz; voz normalizada; todo a 30 s
    filtro = (f'[1:a]atempo={tempo:.4f},loudnorm=I=-16:TP=-1.5:LRA=7,aresample={SR},aformat=channel_layouts=stereo,asplit=2[v][vsc];'
              f'[0:a]aresample={SR},aformat=channel_layouts=stereo,volume=0.8[m];'
              f'[m][vsc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=350[mduck];'
              f'[mduck][v]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]')
    subprocess.run([FF, '-y', '-v', 'error', '-i', str(VIDEO), '-i', str(voz), '-filter_complex', filtro,
                    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-t', '30',
                    '-movflags', '+faststart', str(SALIDA)], check=True)
    print('listo:', SALIDA)


if __name__ == '__main__':
    sys.path.insert(0, str(Path(__file__).parent))
    import locucion
    main(sys.argv[1] if len(sys.argv) > 1 else locucion.ruta())
