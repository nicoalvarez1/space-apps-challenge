"""Música y efectos del vídeo de 30 s, sintetizados con numpy (sin derechos de terceros).

Uso:  .venv/bin/python tools/video/audio.py [video/tmp/sfx.json]  →  video/tmp/audio.wav (48 kHz, estéreo, 16 bit)

Pista a ~116 BPM, con el tempo ajustado para que un compás empiece justo con el título final: pad y arpegio en la
portada, luego bombo a negras, bajo a contratiempo y palmas suaves; subida de un compás y cierre a medio tiempo.
Efectos pocos y discretos. sfx.json (lo escribe montar.py): [{"t": s, "tipo": "clic|whoosh|golpe|logo|capas"}]
(«capas» lleva además "pulsos": desfases en s de cada capa de datos que se apila sobre el planeta).
"""
import json, sys, wave
from pathlib import Path
import numpy as np

SR = 48000
RAIZ = Path(__file__).resolve().parents[2]
rng = np.random.default_rng(7)


def t_(d): return np.arange(int(d * SR)) / SR
def env_exp(d, tau): return np.exp(-t_(d) / tau)
def midi(n): return 440.0 * 2 ** ((n - 69) / 12)

def lp(x, fc):
    """Paso bajo de un polo (fc puede ser un array por muestra)."""
    fc = np.broadcast_to(np.asarray(fc, float), x.shape)
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x); s = 0.0
    for i in range(len(x)):          # bucle sencillo: las pistas son cortas
        s = (1 - a[i]) * x[i] + a[i] * s; y[i] = s
    return y

def lp_fast(x, fc):
    """Paso bajo de un polo con fc constante (filtro IIR vía lfilter casero con cumsum por bloques)."""
    a = np.exp(-2 * np.pi * fc / SR)
    # y[n] = (1-a) x[n] + a y[n-1]  →  resolución por FFT de la respuesta al impulso truncada
    n = int(min(len(x), max(64, 8 * SR / (2 * np.pi * fc))))
    h = (1 - a) * a ** np.arange(n)
    return conv(x, h)[:len(x)]

def hp_fast(x, fc): return x - lp_fast(x, fc)

def conv(x, h):
    n = len(x) + len(h) - 1; N = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, N) * np.fft.rfft(h, N), N)[:n]

def saw(f, d, detune=0.0):
    t = t_(d); ph = (f * (1 + detune)) * t
    return 2 * (ph - np.floor(ph + 0.5))

def add(buf, x, t0, gain=1.0, pan=0.0):
    i = int(t0 * SR)
    if i >= len(buf): return
    x = x[: len(buf) - i]
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    buf[i:i + len(x), 0] += x * gain * l * 1.414
    buf[i:i + len(x), 1] += x * gain * r * 1.414

def reverb(st, dur=1.6, mix=0.25):
    out = np.zeros_like(st)
    for c in range(2):
        ir = rng.standard_normal(int(dur * SR)) * np.exp(-t_(dur) / (dur / 6))
        ir = lp_fast(ir, 5000); ir /= np.sqrt((ir ** 2).sum())
        out[:, c] = conv(st[:, c], ir)[:len(st)]
    return st * (1 - mix) + out * mix * 1.2

# ---------------------------------------------------------------- instrumentos
def kick(gain=1.0):
    d = 0.45; t = t_(d)
    f = 45 + 110 * np.exp(-t / 0.045)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.16)
    x[:200] += rng.standard_normal(200) * np.linspace(0.5, 0, 200)   # chasquido
    return np.tanh(x * 1.6) * gain

def hat(d=0.05, gain=1.0):
    return hp_fast(rng.standard_normal(int(d * SR)), 7000) * env_exp(d, d / 4) * gain

def clap():
    d = 0.25; x = np.zeros(int(d * SR))
    for k in range(3):
        i = int(k * 0.011 * SR); n = rng.standard_normal(len(x) - i) * env_exp((len(x) - i) / SR, 0.06 if k == 2 else 0.008)
        x[i:] += n
    x = hp_fast(lp_fast(x, 3000), 900)
    return x / np.abs(x).max()

def bass_note(n, d):
    f = midi(n); x = saw(f, d) * 0.6 + saw(f, d, 0.005) * 0.4 + np.sin(2 * np.pi * f / 2 * t_(d)) * 0.6
    e = np.minimum(1, t_(d) / 0.005) * np.exp(-t_(d) / (d * 0.7))
    return lp_fast(x * e, 420)

def pluck(n, d=0.22):
    f = midi(n); t = t_(d)
    x = (np.sign(np.sin(2 * np.pi * f * t)) * 0.5 + saw(f, d, 0.003) * 0.5)
    return lp_fast(x * np.exp(-t / 0.07), 2600) * np.minimum(1, t / 0.002)

def pad_chord(notes, d):
    x = np.zeros(int(d * SR))
    for n in notes:
        for dt in (-0.004, 0.0, 0.0045):
            x += saw(midi(n), d, dt)
    x /= len(notes) * 3
    e = np.minimum(1, t_(d) / 0.35) * np.minimum(1, (d - t_(d)) / 0.3)
    return lp_fast(x * e, 1500)

# ---------------------------------------------------------------- efectos
def sfx_clic():
    d = 0.06; t = t_(d)
    x = np.sin(2 * np.pi * 2400 * t) * np.exp(-t / 0.006) + hp_fast(rng.standard_normal(len(t)), 3000) * np.exp(-t / 0.003) * 0.6
    return x * 0.9

def sfx_whoosh(d=0.55, fuerte=1.0):
    t = t_(d); n = rng.standard_normal(len(t))
    fc = 300 + 5000 * np.sin(np.pi * t / d) ** 2
    x = lp(n, fc) - lp(n, fc * 0.25)
    e = np.sin(np.pi * np.minimum(1, t / d)) ** 2
    return x * e * 1.4 * fuerte

def sfx_rumble(d=1.8):
    t = t_(d); n = rng.standard_normal(len(t))
    x = lp_fast(n, 140) * 6 + lp_fast(n, 900) * 0.5
    e = np.minimum(1, t / 0.08) * np.exp(-t / 0.9)
    return np.tanh(x * e * 1.5)

def sfx_blip(base=1320):
    out = np.zeros(int(0.28 * SR))
    for k, m in enumerate((1.0, 1.25, 1.5)):
        d = 0.07; t = t_(d)
        x = np.sin(2 * np.pi * base * m * t) * np.exp(-t / 0.025)
        i = int(k * 0.055 * SR); out[i:i + len(x)] += x
    return out * 0.55

def sfx_riser(d=2.0):
    t = t_(d); n = rng.standard_normal(len(t))
    fc = 400 + 7000 * (t / d) ** 2
    x = lp(n, fc) - lp(n, fc * 0.3)
    tone = np.sin(2 * np.pi * np.cumsum(220 + 660 * (t / d) ** 2) / SR) * 0.25
    return (x + tone) * (t / d) ** 1.6

def sfx_impacto(d=2.6):
    t = t_(d)
    f = 38 + 70 * np.exp(-t / 0.12)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.8)
    n = rng.standard_normal(len(t)); crash = hp_fast(n, 2500) * np.exp(-t / 0.5) * 0.35 + lp_fast(n, 600) * np.exp(-t / 0.12) * 0.8
    return np.tanh((boom * 1.4 + crash) * 1.2)


# ---------------------------------------------------------------- composición
def musica(dur, t_titulo=24.0):
    """Am – F – C – G, un acorde por compás. El tempo se ajusta para que el compás 11 empiece justo con el título
    final (t_titulo): compás 0 sin bombo (portada), 1-9 con ritmo, 10 de subida y desde el título, cierre a medio tiempo."""
    bar = t_titulo / 11; beat = bar / 4
    buf = np.zeros((int(dur * SR) + SR, 2))
    prog = [(57, [69, 72, 76]), (53, [65, 69, 72]), (48, [64, 67, 72]), (55, [67, 71, 74])]
    bars = int(np.ceil(dur / bar))
    for b in range(bars):
        t0 = b * bar
        root, chord = prog[b % 4]
        cierre = b >= 11
        subida = b == 10
        intro = b == 0
        add(buf, pad_chord([c - 12 for c in chord] + [chord[0]], bar + 0.3), t0, 0.15 if not cierre else 0.22)
        for q in range(4):
            tb = t0 + q * beat
            if not intro and not subida and not (cierre and q % 2):          # en el cierre, medio tiempo
                add(buf, kick(), tb, 0.7)
            if not cierre and not intro:
                add(buf, bass_note(root - 12, beat / 2 * 0.95), tb + beat / 2, 0.38)
                add(buf, hat(0.04), tb + beat / 2, 0.12, 0.3)
                if b >= 5 and not subida and q in (1, 3): add(buf, clap(), tb, 0.18, 0.05)
        if not subida:                                                        # arpegio en semicorcheas
            notas = chord + [chord[1] + 12, chord[2], chord[1] + 12, chord[0] + 12, chord[1]]
            for s_ in range(16):
                ts = t0 + s_ * beat / 4
                if ts > dur: break
                g = 0.10 if (intro or cierre) else 0.12
                add(buf, pluck(notas[s_ % len(notas)]), ts, g, 0.45 if s_ % 2 else -0.45)
    add(buf, sfx_riser(bar) * 0.6, 10 * bar, 0.25)                           # subida suave hacia el título
    add(buf, bass_note(45 - 12, 2 * bar), t_titulo, 0.45)                     # nota larga del cierre
    return buf


def sfx_capas(pulsos):
    """Barrido suave de aire filtrado que sube mientras se apilan las capas de datos, con una pequeña ola en cada capa
    y un destello agudo muy tenue (sin recargar: va por debajo de la música)."""
    d = pulsos[-1] + 0.75; t = t_(d); n = rng.standard_normal(len(t))
    fc = 600 + 3800 * (t / d) ** 1.4
    aire = lp(n, fc) - lp(n, fc * 0.35)
    ola = np.zeros(len(t))
    for p in pulsos: ola += np.exp(-((t - p - 0.12) / 0.13) ** 2)
    e = (0.25 + ola) * np.minimum(1, t / 0.08) * np.clip((d - t) / 0.35, 0, 1)
    x = aire * e * 0.9
    for k, p in enumerate(pulsos):
        f = midi(76 + (0, 3, 7, 12)[k % 4]); dd = 0.5; tt = t_(dd)
        add_m = np.sin(2 * np.pi * f * tt) * np.exp(-tt / 0.12) * np.minimum(1, tt / 0.004) * 0.22
        i = int((p + 0.05) * SR); x[i:i + len(add_m)] += add_m[: len(x) - i]
    return x


def sfx_golpe(d=2.4):
    """Golpe grave y limpio (sin platillo) para el título."""
    t = t_(d); f = 40 + 60 * np.exp(-t / 0.1)
    return np.tanh(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.7) * 1.3)


def generar(eventos, dur=30.0, salida=None, t_titulo=24.0):
    salida = Path(salida or RAIZ / 'video' / 'tmp' / 'audio.wav')
    m = musica(dur, t_titulo)
    m = reverb(m, 1.4, 0.18)
    fx = np.zeros_like(m)
    for e in eventos:
        t, tipo = e['t'], e['tipo']
        if tipo == 'clic': add(fx, sfx_clic(), t, 0.30, 0.15)
        elif tipo == 'whoosh': add(fx, lp_fast(sfx_whoosh(0.6, 0.8), 3500), max(0, t - 0.3), 0.30)
        elif tipo == 'golpe': add(fx, sfx_golpe(), t, 0.40)
        elif tipo == 'logo': add(fx, sfx_blip(880), t, 0.16)
        elif tipo == 'capas': add(fx, sfx_capas(e['pulsos']), t - 0.05, 0.22)
    fx = reverb(fx, 1.0, 0.15)
    mezcla = m * 0.55 + fx
    mezcla = mezcla[: int(dur * SR)]
    n = len(mezcla); tf = np.arange(n) / SR
    mezcla *= np.clip((dur - tf) / 2.0, 0, 1)[:, None]      # fundido final de 2 s
    mezcla *= np.clip(tf / 0.03, 0, 1)[:, None]
    mezcla = np.tanh(mezcla * 1.1) / np.tanh(1.1)          # sin saturar
    mezcla *= 0.83 / max(1e-9, np.abs(mezcla).max())       # pico a -1,6 dBFS (margen para el AAC)
    pcm = (mezcla * 32767).astype('<i2')
    salida.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(salida), 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    return salida


if __name__ == '__main__':
    f = Path(sys.argv[1]) if len(sys.argv) > 1 else RAIZ / 'video' / 'tmp' / 'sfx.json'
    ev = json.loads(f.read_text()) if f.exists() else []
    print(generar(ev))
