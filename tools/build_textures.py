#!/usr/bin/env python3
"""
Genera las texturas de la Tierra, la Luna y Marte a partir de DATOS PÚBLICOS reales.

    py -m pip install numpy pillow OpenEXR
    py tools/build_textures.py fetch            # descarga (≈ 600 MB, caché fuera del proyecto: --cache o LANDFALL_CACHE)
    py tools/build_textures.py build            # genera assets/textures/*
    py tools/build_textures.py all --only moon  # todo, solo para un cuerpo (earth, moon, mars, stars)

Fuentes (todas de acceso público):
  Luna   color : NASA SVS 4720 · LRO/LROC WAC color mosaic
         relieve: NASA/GSFC · LRO/LOLA  LDEM 16 ppd (PDS Geosciences Node)
  Marte  color : USGS/NASA · Viking MDIM 2.1 color mosaic (NASA Mars Trek)
         relieve: NASA/GSFC · MGS/MOLA MEGDR 16 ppd (PDS Geosciences Node)
  Tierra color : NASA Earth Observatory · Blue Marble Next Generation (GIBS)
         noche : NASA/NOAA · VIIRS Black Marble (GIBS)
         relieve: NOAA NGDC · ETOPO2v2
         nubes : NASA · MODIS Terra + Aqua True Color, composición de varios días (GIBS)
  Cielo        : NASA SVS 4851 · Deep Star Maps 2020 (Hipparcos + Tycho-2)
"""
import argparse, json, os, shutil, sys, tempfile, time, urllib.request, zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent
# La caché va FUERA del proyecto (son cientos de MB y la carpeta está en OneDrive).
CACHE = Path(os.environ.get("LANDFALL_CACHE", Path(tempfile.gettempdir()) / "landfall_cache"))
OUT = ROOT / "assets" / "textures"
UA = {"User-Agent": "landfall-texture-builder/1.0 (NASA Space Apps hackathon project)"}

SVS = "https://svs.gsfc.nasa.gov/vis/a000000"
PDS = "https://pds-geosciences.wustl.edu"
GIBS = ("https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0"
        "&STYLES=&CRS=EPSG:4326&FORMAT=image/jpeg")
TREK_MARS = ("https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm")

MOON_R, MARS_R, EARTH_R = 1737400.0, 3396000.0, 6371000.0   # m


# ------------------------------------------------------------------ utilidades
def download(url, dest, retries=4):
    dest = Path(dest)
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    for i in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r, open(tmp, "wb") as f:
                shutil.copyfileobj(r, f, 1 << 20)
            tmp.replace(dest)
            return dest
        except Exception as e:  # noqa: BLE001
            print(f"  reintento {i + 1}/{retries}: {url.split('?')[0][-60:]} -> {e}")
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"No se pudo descargar {url}")


def pmap(fn, items, workers=8):
    with ThreadPoolExecutor(workers) as ex:
        return list(ex.map(fn, items))


def save_jpg(img, path, q=90, sub=2):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "JPEG", quality=q, optimize=True, progressive=True, subsampling=sub)
    print(f"  ✔ {Path(path).relative_to(ROOT)}  {img.size[0]}x{img.size[1]}  {Path(path).stat().st_size / 1e6:.1f} MB")


def resize(img, w, h):
    return img.resize((w, h), Image.LANCZOS)


def roll_half(a):
    """lon 0..360 (borde izq = 0°)  ->  lon -180..180 (centro = 0°)."""
    return np.roll(a, a.shape[1] // 2, axis=1)


def polar_filter(h, start_cos=0.7):
    """En un mapa equirrectangular los píxeles se estrechan hacia los polos y el ruido se amplifica al derivar.
    Suavizamos cada fila para mantener una resolución física constante (evita las franjas en los polos)."""
    H, W = h.shape
    c = np.cos((0.5 - (np.arange(H) + 0.5) / H) * np.pi)
    out = h.copy()
    for i in range(H):
        if c[i] >= start_cos:
            continue
        n = max(16, int(W * c[i] / start_cos))
        row = Image.fromarray(h[i][None, :].astype(np.float32), "F")
        out[i] = np.asarray(row.resize((n, 1), Image.BOX).resize((W, 1), Image.BICUBIC))[0]
    return out


def height_to_normal(h, radius_m, strength):
    """Mapa de normales (espacio tangente, convención OpenGL/three.js) a partir de alturas en metros."""
    h = polar_filter(h)
    H, W = h.shape
    lat = (0.5 - (np.arange(H) + 0.5) / H) * np.pi
    dx = radius_m * np.maximum(np.cos(lat), 0.04)[:, None] * (2 * np.pi / W)
    dy = radius_m * (np.pi / H)
    dhdx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * dx)
    hp = np.vstack([h[1:], h[-1:]])
    hm = np.vstack([h[:1], h[:-1]])
    dhdrow = (hp - hm) / (2 * dy)          # las filas crecen hacia el sur
    nx, ny, nz = -dhdx * strength, dhdrow * strength, np.ones_like(h)
    n = np.sqrt(nx * nx + ny * ny + nz * nz)
    rgb = np.stack([nx / n, ny / n, nz / n], -1) * 0.5 + 0.5
    return Image.fromarray((rgb * 255 + 0.5).astype(np.uint8), "RGB")


def pole_smooth(h, rows=3):
    h = h.copy()
    h[:rows] = h[:rows].mean(); h[-rows:] = h[-rows:].mean()
    return h


def f_resize(a, w, h):
    return np.asarray(Image.fromarray(a.astype(np.float32), "F").resize((w, h), Image.BICUBIC))


# ------------------------------------------------------------------ DESCARGAS
def fetch_moon():
    print("[Luna] descargando LROC color + LOLA …")
    download(f"{SVS}/a004700/a004720/lroc_color_poles_8k.tif", CACHE / "moon/lroc_color_poles_8k.tif")
    download(f"{PDS}/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_16.img", CACHE / "moon/ldem_16.img")


def fetch_mars():
    print("[Marte] descargando Viking MDIM2.1 (512 teselas) + MOLA …")
    jobs = [(r, c) for r in range(16) for c in range(32)]
    pmap(lambda rc: download(f"{TREK_MARS}/4/{rc[0]}/{rc[1]}.jpg", CACHE / f"mars/tiles/4_{rc[0]}_{rc[1]}.jpg"), jobs, 12)
    download(f"{PDS}/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img", CACHE / "mars/megt90n000eb.img")


def gibs_url(layer, bbox, w, h, time_=None):
    s, west, n, e = bbox
    u = f"{GIBS}&LAYERS={layer}&BBOX={s},{west},{n},{e}&WIDTH={w}&HEIGHT={h}"
    return u + (f"&TIME={time_}" if time_ else "")


QUADS = {"nw": (0, -180, 90, 0), "ne": (0, 0, 90, 180), "sw": (-90, -180, 0, 0), "se": (-90, 0, 0, 180)}


def fetch_earth():
    print("[Tierra] descargando Blue Marble, Black Marble, ETOPO2 y MODIS …")
    jobs = []
    for layer, tag in (("BlueMarble_NextGeneration", "bm"), ("BlueMarble_ShadedRelief_Bathymetry", "bathy"), ("VIIRS_Black_Marble", "night")):
        for q, bb in QUADS.items():
            jobs.append((gibs_url(layer, bb, 4096, 2048), CACHE / f"earth/{tag}_{q}.jpg"))
    jobs.append((gibs_url("OSM_Land_Water_Map", (-90, -180, 90, 180), 4096, 2048), CACHE / "earth/water.jpg"))
    pmap(lambda j: download(*j), jobs, 4)
    download("https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2/ETOPO2v2-2006/ETOPO2v2c/raw_binary/ETOPO2v2c_i2_LSB.zip",
             CACHE / "earth/etopo2.zip")
    # Nubes: composición de varios días de MODIS Terra + Aqua (los huecos entre pasadas se rellenan con el día anterior)
    base = date.today() - timedelta(days=4)
    cjobs = []
    for d in range(4):
        day = (base - timedelta(days=d)).isoformat()
        for sat in ("Terra", "Aqua"):
            for q, bb in QUADS.items():
                cjobs.append((gibs_url(f"MODIS_{sat}_CorrectedReflectance_TrueColor", bb, 4096, 2048, day),
                              CACHE / f"earth/cloud_{day}_{sat}_{q}.jpg"))
    pmap(lambda j: download(*j), cjobs, 4)


def fetch_stars():
    print("[Cielo] descargando Deep Star Maps 2020 (8k) …")
    download(f"{SVS}/a004800/a004851/starmap_2020_8k.exr", CACHE / "stars/starmap_2020_8k.exr")


# ------------------------------------------------------------------ CONSTRUCCIÓN
def build_moon(manifest):
    print("[Luna] construyendo …")
    img = Image.open(CACHE / "moon/lroc_color_poles_8k.tif")
    print("  LROC:", img.size, img.mode)
    img = img.convert("RGB")
    img = resize(img, 8192, 4096) if img.size != (8192, 4096) else img
    save_jpg(img, OUT / "moon_color_hi.jpg", 88)
    save_jpg(resize(img, 4096, 2048), OUT / "moon_color_lo.jpg", 88)
    save_jpg(resize(img, 512, 256), OUT / "moon_thumb.jpg", 80)   # miniatura para la portada

    raw = np.fromfile(CACHE / "moon/ldem_16.img", dtype="<i2").reshape(2880, 5760)
    h = roll_half(raw.astype(np.float32) * 0.5)           # metros respecto a la esfera de 1737,4 km
    hmin, hmax = float(h.min()), float(h.max())
    print(f"  LOLA altura: {hmin:.0f} … {hmax:.0f} m")
    save_jpg(height_to_normal(h, MOON_R, 4.0), OUT / "moon_normal_hi.jpg", 94, 0)
    save_jpg(height_to_normal(f_resize(h, 4096, 2048), MOON_R, 4.0), OUT / "moon_normal_lo.jpg", 94, 0)
    hd = pole_smooth(f_resize(h, 2048, 1024))
    d8 = ((hd - hmin) / (hmax - hmin) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(d8, "L").save(OUT / "moon_height.png", optimize=True)
    print(f"  ✔ assets/textures/moon_height.png  {(OUT / 'moon_height.png').stat().st_size / 1e6:.1f} MB")
    manifest["moon"] = {"radius_m": MOON_R, "hmin": hmin, "hmax": hmax, "height": "moon_height.png",
                        "hi": {"color": "moon_color_hi.jpg", "normal": "moon_normal_hi.jpg"},
                        "lo": {"color": "moon_color_lo.jpg", "normal": "moon_normal_lo.jpg"}}


def build_mars(manifest):
    print("[Marte] construyendo …")
    mosaic = Image.new("RGB", (8192, 4096))
    for r in range(16):
        for c in range(32):
            mosaic.paste(Image.open(CACHE / f"mars/tiles/4_{r}_{c}.jpg").convert("RGB"), (c * 256, r * 256))
    save_jpg(mosaic, OUT / "mars_color_hi.jpg", 88)
    save_jpg(resize(mosaic, 4096, 2048), OUT / "mars_color_lo.jpg", 88)
    save_jpg(resize(mosaic, 512, 256), OUT / "mars_thumb.jpg", 80)   # miniatura para la portada

    raw = np.fromfile(CACHE / "mars/megt90n000eb.img", dtype=">i2").reshape(2880, 5760)
    h = roll_half(raw.astype(np.float32))
    hmin, hmax = float(h.min()), float(h.max())
    print(f"  MOLA altura: {hmin:.0f} … {hmax:.0f} m")
    save_jpg(height_to_normal(h, MARS_R, 4.0), OUT / "mars_normal_hi.jpg", 94, 0)
    save_jpg(height_to_normal(f_resize(h, 4096, 2048), MARS_R, 4.0), OUT / "mars_normal_lo.jpg", 94, 0)
    hd = pole_smooth(f_resize(h, 2048, 1024))
    Image.fromarray(((hd - hmin) / (hmax - hmin) * 255 + 0.5).astype(np.uint8), "L").save(OUT / "mars_height.png", optimize=True)
    manifest["mars"] = {"radius_m": MARS_R, "hmin": hmin, "hmax": hmax, "height": "mars_height.png",
                        "hi": {"color": "mars_color_hi.jpg", "normal": "mars_normal_hi.jpg"},
                        "lo": {"color": "mars_color_lo.jpg", "normal": "mars_normal_lo.jpg"}}


def stitch(tag, size=(8192, 4096), mode="RGB"):
    w, h = size
    out = Image.new(mode, size)
    for q, (x, y) in {"nw": (0, 0), "ne": (w // 2, 0), "sw": (0, h // 2), "se": (w // 2, h // 2)}.items():
        out.paste(Image.open(CACHE / f"earth/{tag}_{q}.jpg").convert(mode), (x, y))
    return out


def clean_night(img):
    """Quita el velo azulado de fondo (resplandor/hielo) y deja solo las luces de las ciudades."""
    a = np.asarray(img, dtype=np.float32)
    bg = img.resize((1024, 512), Image.BOX).filter(ImageFilter.GaussianBlur(10)).resize(img.size, Image.BICUBIC)
    out = np.clip(a - 0.92 * np.asarray(bg, dtype=np.float32), 0, 255) * 1.3
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


def soft_valid(valid, radius=5):
    m = Image.fromarray((valid * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius))
    return np.clip((np.asarray(m, dtype=np.float32) / 255 - 0.5) * 2, 0, 1)


CLOUD = dict(offset=48, span=105, gamma=1.35, gain=1.0)     # ajuste de la nubosidad


def gauss_blur(a, sigma):
    """Desenfoque gaussiano con FFT (solo numpy). Periódico: válido para el eje de longitud."""
    H, W = a.shape
    fy, fx = np.fft.fftfreq(H)[:, None], np.fft.rfftfreq(W)[None, :]
    k = np.exp(-2 * (np.pi * sigma) ** 2 * (fx * fx + fy * fy))
    return np.fft.irfft2(np.fft.rfft2(a) * k, s=a.shape)


def box_mean(a, r):
    """Media en ventana (2r+1)² con imagen integral."""
    p = np.pad(a, r + 1, mode="edge").cumsum(0).cumsum(1)
    k = 2 * r + 1
    return (p[k:, k:] - p[:-k, k:] - p[k:, :-k] + p[:-k, :-k])[: a.shape[0], : a.shape[1]] / (k * k)


def build_clouds(bm, return_parts=False):
    """MODIS Terra + Aqua de varios días. Nubosidad = exceso de blancura respecto al suelo despejado (Blue Marble).
    - Terra (10:30) y Aqua (13:30) ven el destello del Sol sobre el mar (sunglint) en sitios distintos, pero las
      nubes casi no se mueven en 3 h: el MÍNIMO de ambos elimina el destello.
    - Los días se combinan del más reciente al más antiguo con pesos suaves (sin bordes de franja)."""
    clear = np.asarray(bm, np.float32).min(-1)
    days = sorted({p.name.split("_")[1] for p in (CACHE / "earth").glob("cloud_*_nw.jpg")}, reverse=True)
    result = np.zeros((4096, 8192), np.float32)
    remaining = np.ones((4096, 8192), np.float32)

    def sat_cloud(day, sat):
        tile = np.zeros((4096, 8192, 3), np.uint8)
        for q, (x, y) in {"nw": (0, 0), "ne": (4096, 0), "sw": (0, 2048), "se": (4096, 2048)}.items():
            f = CACHE / f"earth/cloud_{day}_{sat}_{q}.jpg"
            if not f.exists():
                return None
            tile[y:y + 2048, x:x + 4096] = np.asarray(Image.open(f).convert("RGB"))
        lo, hi = tile.min(-1).astype(np.float32), tile.max(-1).astype(np.float32)
        w = soft_valid(hi > 12)
        c = np.clip((lo - 0.9 * clear - CLOUD["offset"]) / CLOUD["span"], 0, 1) * np.clip(1.15 - (hi - lo) / 110, 0, 1)
        # el destello es liso y las nubes tienen textura: se penalizan las zonas lisas que no son muy brillantes
        m1 = box_mean(lo, 4)
        std = np.sqrt(np.maximum(box_mean(lo * lo, 4) - m1 * m1, 0))
        lat = np.abs(90 - (np.arange(4096) + 0.5) / 4096 * 180)[:, None]
        thr = np.where(lat < 35, 7.0, 3.5)
        c *= np.maximum(np.clip((std - thr) / 6, 0, 1), np.clip((lo - 185) / 40, 0, 1))
        return c, w

    for day in days:
        t, a_ = sat_cloud(day, "Terra"), sat_cloud(day, "Aqua")
        if t and a_:
            (ct, wt), (ca, wa) = t, a_
            both = wt * wa
            w = wt + wa - both
            c = (both * np.minimum(ct, ca) + wt * (1 - wa) * ct + wa * (1 - wt) * ca) / np.maximum(w, 1e-4)
            w = both                              # solo lo que ven AMBOS satélites (lo demás puede ser destello)
        elif t or a_:
            c, w = t or a_
            w = 0.0 * w                           # un único satélite: no fiable
        else:
            continue
        result += remaining * w * c
        remaining *= 1 - w
        print(f"  nubes: {day}  sin cubrir {remaining.mean() * 100:.1f} %")
    # huecos pequeños: convolución normalizada (las nubes vecinas se prolongan suavemente)
    cover = 1 - remaining
    sm = lambda a: a.reshape(512, 8, 1024, 8).mean((1, 3))                       # noqa: E731
    num, den = gauss_blur(sm(result), 6), gauss_blur(sm(cover), 6)
    fill = np.where(den > 0.05, num / np.maximum(den, 1e-3), 0)
    fill = np.asarray(Image.fromarray(fill.astype(np.float32), "F").resize((8192, 4096), Image.BICUBIC))
    out = result + remaining * np.clip(fill, 0, 1)
    # noche polar (sin imagen visible): campo suave y muy difuminado en longitud (evita el "estallido" en el polo)
    H, W = out.shape
    covered = cover > 0.5
    top = covered.argmax(0)
    bot = H - 1 - covered[::-1].argmax(0)
    for edge, rows in ((top, range(0, int(top.max()))), (bot, range(int(bot.min()) + 1, H))):
        if len(rows) == 0:
            continue
        ref = np.array([out[min(max(e + (8 if edge is top else -8), 0), H - 1), x] for x, e in enumerate(edge)], np.float32)
        ref = gauss_blur(np.tile(ref, (8, 1)), 120)[0]
        for r in rows:
            sel = (r < edge) if edge is top else (r > edge)
            dist = np.abs(r - edge) / 400.0
            val = ref * (1 - np.clip(dist, 0, 1)) + 0.35 * np.clip(dist, 0, 1)
            out[r] = np.where(sel, val, out[r])
    acc = np.clip(out * CLOUD["gain"], 0, 1) ** CLOUD["gamma"]
    return (acc, remaining) if return_parts else acc


def build_earth(manifest):
    print("[Tierra] construyendo …")
    # relieve ETOPO2 (celdas de 2′, de 90°N a 90°S, lon -180…180)
    with zipfile.ZipFile(CACHE / "earth/etopo2.zip") as z:
        name = next(n for n in z.namelist() if n.lower().endswith(".bin"))
        topo = np.frombuffer(z.read(name), dtype="<i2")
    topo = topo.reshape(5400, 10800).astype(np.float32)

    # color: tierra de Blue Marble NG + océano con batimetría real
    bm, bathy = stitch("bm"), stitch("bathy")
    water8k = np.clip(f_resize((topo < 0).astype(np.float32), 8192, 4096), 0, 1)[..., None]
    mix = np.asarray(bm, np.float32) * (1 - water8k) + np.asarray(bathy, np.float32) * water8k
    color = Image.fromarray(np.clip(mix, 0, 255).astype(np.uint8), "RGB")
    save_jpg(color, OUT / "earth_color_hi.jpg", 88)
    save_jpg(resize(color, 4096, 2048), OUT / "earth_color_lo.jpg", 88)

    night = clean_night(stitch("night"))
    save_jpg(night, OUT / "earth_night_hi.jpg", 88, 0)
    save_jpg(resize(night, 4096, 2048), OUT / "earth_night_lo.jpg", 88, 0)

    land = np.maximum(topo, 0)
    save_jpg(height_to_normal(f_resize(land, 4096, 2048), EARTH_R, 9.0), OUT / "earth_normal.jpg", 94, 0)

    # agua -> rugosidad (el océano brilla con el reflejo del Sol)
    water = f_resize((topo < 0).astype(np.float32), 4096, 2048)
    rough = 0.9 - 0.62 * np.clip(water, 0, 1)
    Image.fromarray((rough * 255).astype(np.uint8), "L").save(OUT / "earth_rough.jpg", quality=92)
    print("  ✔ assets/textures/earth_rough.jpg")

    acc = build_clouds(bm)
    cimg = Image.fromarray((acc * 255).astype(np.uint8), "L")
    save_jpg(cimg, OUT / "earth_clouds_hi.jpg", 85)                 # escala de grises: 1/3 del tamaño
    save_jpg(resize(cimg, 4096, 2048), OUT / "earth_clouds_lo.jpg", 85)
    manifest["earth"] = {
        "hi": {"color": "earth_color_hi.jpg", "night": "earth_night_hi.jpg", "normal": "earth_normal.jpg",
               "rough": "earth_rough.jpg", "clouds": "earth_clouds_hi.jpg"},
        "lo": {"color": "earth_color_lo.jpg", "night": "earth_night_lo.jpg", "normal": "earth_normal.jpg",
               "rough": "earth_rough.jpg", "clouds": "earth_clouds_lo.jpg"}}


def build_stars(manifest):
    print("[Cielo] construyendo …")
    import OpenEXR  # noqa: PLC0415
    f = OpenEXR.File(str(CACHE / "stars/starmap_2020_8k.exr"))
    ch = f.channels()
    px = ch["RGB"].pixels if "RGB" in ch else np.stack([ch[c].pixels for c in "RGB"], -1)
    a = np.asarray(px, dtype=np.float32)
    print("  EXR", a.shape, "p50/p99/p99.9/max:", [float(np.percentile(a, p)) for p in (50, 99, 99.9)], float(a.max()))
    ref = float(np.percentile(a, 99.7))
    a = a / ref
    a = a / (1 + 0.55 * a)                              # compresión suave de las estrellas brillantes
    a = np.clip(a, 0, 1) ** (1 / 2.2)
    a = np.clip((a - 0.06) / 0.94, 0, 1) * 0.95         # punto negro: el espacio debe ser negro
    img = Image.fromarray((a * 255 + 0.5).astype(np.uint8), "RGB")
    save_jpg(img, OUT / "stars_hi.jpg", 88)
    save_jpg(resize(img, 4096, 2048), OUT / "stars_lo.jpg", 88)
    manifest["stars"] = {"hi": "stars_hi.jpg", "lo": "stars_lo.jpg"}


STAGES = {"moon": (fetch_moon, build_moon), "mars": (fetch_mars, build_mars),
          "earth": (fetch_earth, build_earth), "stars": (fetch_stars, build_stars)}

CREDITS = {
    "moon": "NASA/GSFC/ASU · LRO LROC WAC color mosaic (SVS 4720) · LRO LOLA topography",
    "mars": "NASA/JPL/USGS · Viking MDIM 2.1 · MGS MOLA topography",
    "earth": "NASA Earth Observatory · Blue Marble NG · NASA/NOAA VIIRS Black Marble · NOAA ETOPO2 · NASA MODIS (GIBS)",
    "stars": "NASA/Goddard Space Flight Center Scientific Visualization Studio · Deep Star Maps 2020 (Hipparcos & Tycho-2)",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["fetch", "build", "all"])
    ap.add_argument("--only", default="earth,moon,mars,stars")
    ap.add_argument("--cache", help="carpeta de caché de descargas")
    args = ap.parse_args()
    global CACHE
    if args.cache:
        CACHE = Path(args.cache)
    print("caché:", CACHE)
    names = [n.strip() for n in args.only.split(",") if n.strip()]
    mf_path = OUT / "manifest.json"
    manifest = json.loads(mf_path.read_text(encoding="utf-8")) if mf_path.exists() else {}
    if args.cmd in ("fetch", "all"):
        for n in names:
            STAGES[n][0]()
    if args.cmd in ("build", "all"):
        OUT.mkdir(parents=True, exist_ok=True)
        for n in names:
            STAGES[n][1](manifest)
        manifest["credits"] = CREDITS
        mf_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
        print("manifest →", mf_path.relative_to(ROOT))


if __name__ == "__main__":
    sys.exit(main())
