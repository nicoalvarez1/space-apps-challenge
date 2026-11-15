#!/usr/bin/env python3
"""
Genera las texturas de la Tierra, la Luna y Marte a partir de DATOS PÚBLICOS reales.

    py -m pip install numpy pillow OpenEXR
    py tools/build_textures.py fetch            # descarga (≈ 600 MB, caché fuera del proyecto: --cache o LANDFALL_CACHE)
    py tools/build_textures.py build            # genera assets/textures/*
    py tools/build_textures.py all --only moon  # todo, solo para un cuerpo (earth, moon, mars, stars)
    py tools/build_textures.py all --only clouds,polar   # solo nubes / solo relieve y casquetes polares

Fuentes (todas de acceso público):
  Luna   color : NASA SVS 4720 · LRO/LROC WAC color mosaic
         relieve: NASA/GSFC · LRO/LOLA  LDEM 64 ppd (normales) y 16 ppd (desplazamiento) (PDS Geosciences Node)
  Marte  color : USGS/NASA · Viking MDIM 2.1 color mosaic (NASA Mars Trek)
         relieve: NASA/GSFC · MGS/MOLA MEGDR 64 ppd (normales) y 16 ppd (desplazamiento) (PDS Geosciences Node)
  Polos (Luna y Marte): casquetes en proyección azimutal equidistante desde 60° de latitud, con el mismo
         color reproyectado y normales calculadas del DEM de 64 ppd (sin el estiramiento equirrectangular)
  Tierra color : NASA Earth Observatory · Blue Marble Next Generation (GIBS)
         noche : NASA/NOAA · VIIRS Black Marble (GIBS)
         relieve: NOAA NGDC · ETOPO2v2
         nubes : NASA/NOAA · VIIRS NOAA-20 + NOAA-21 True Color y M11-I2-I1 (GIBS): 2026-09-22, Ártico 2026-06-21,
                 Antártida 2025-12-21
  Cielo        : NASA SVS 4851 · Deep Star Maps 2020 (Hipparcos + Tycho-2)
"""
import argparse, json, os, shutil, subprocess, sys, tempfile, time, urllib.request, zipfile
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
            if "CERTIFICATE_VERIFY_FAILED" in str(e) and shutil.which("curl"):
                r = subprocess.run(["curl", "-sS", "-L", "--fail", "-m", "1800", "-o", str(tmp), url])
                if r.returncode == 0:
                    tmp.replace(dest)
                    return dest
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
LOLA_IMG = f"{PDS}/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img"
MOLA64 = f"{PDS}/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg064"
# MD5 publicados por el PDS (listas lrolol_1xxx_261020.md5 y urn-nasa-pds-mgs_mola_topography_derived.md5)
MD5 = {"moon/ldem_64.img": "178A603A317307F8AA14AD8F03DA45A9",
       "mars/megt90n000gb.img": "0D8387099EC6CAA7DB1F528325D5A045", "mars/megt90n180gb.img": "CA62953C1AEB479A51C1264DBAD64C38",
       "mars/megt00n000gb.img": "AFFBBADDB1EB717EF6AF99B128874ACD", "mars/megt00n180gb.img": "88E8FB42F54AB642034058E92BC7F610",
       "mars/megt_n_128_1.img": "1605E1446A6AB2A0DB258878B043278D", "mars/megt_s_128_1.img": "BD542CBB67AA0789C2185ABD8F44FA02"}


def check_md5(rel):
    import hashlib  # noqa: PLC0415
    h = hashlib.md5()
    with open(CACHE / rel, "rb") as f:
        for b in iter(lambda: f.read(1 << 22), b""):
            h.update(b)
    if h.hexdigest().upper() != MD5[rel]:
        (CACHE / rel).unlink()
        raise RuntimeError(f"MD5 incorrecto en {rel}: se ha borrado, vuelve a ejecutar fetch")
    print(f"  MD5 verificado: {rel}")


def fetch_moon():
    print("[Luna] descargando LROC color + LOLA …")
    download(f"{SVS}/a004700/a004720/lroc_color_poles_8k.tif", CACHE / "moon/lroc_color_poles_8k.tif")
    download(f"{LOLA_IMG}/ldem_16.img", CACHE / "moon/ldem_16.img")
    fetch_relief_moon()


def fetch_relief_moon():
    print("[Luna] descargando LOLA LDEM 64 ppd (530 MB) …")
    download(f"{LOLA_IMG}/ldem_64.img", CACHE / "moon/ldem_64.img")
    check_md5("moon/ldem_64.img")


MOLA64_TILES = {"90n000": (0, 0), "90n180": (0, 1), "00n000": (1, 0), "00n180": (1, 1)}   # (fila, columna) de cada cuarto


def fetch_relief_mars():
    print("[Marte] descargando MOLA MEGDR 64 ppd (4 × 133 MB) …")
    pmap(lambda k: download(f"{MOLA64}/megt{k}gb.img", CACHE / f"mars/megt{k}gb.img"), list(MOLA64_TILES), 4)
    for k in MOLA64_TILES:
        check_md5(f"mars/megt{k}gb.img")
    # MOLA polar estereográfico 128 px/grado: incluye observaciones fuera del nadir hasta el polo (la rejilla global,
    # más allá de ~87°, está interpolada y deja rayas radiales en el relieve)
    print("[Marte] descargando MOLA polar 128 px/grado (2 × 210 MB) …")
    for s in ("n", "s"):
        download(f"{PDS}/mgs/urn-nasa-pds-mgs_mola_topography_derived/polar/megt_{s}_128_1.img", CACHE / f"mars/megt_{s}_128_1.img")
        check_md5(f"mars/megt_{s}_128_1.img")


def fetch_mars():
    print("[Marte] descargando Viking MDIM2.1 (512 teselas) + MOLA …")
    jobs = [(r, c) for r in range(16) for c in range(32)]
    pmap(lambda rc: download(f"{TREK_MARS}/4/{rc[0]}/{rc[1]}.jpg", CACHE / f"mars/tiles/4_{rc[0]}_{rc[1]}.jpg"), jobs, 12)
    download(f"{PDS}/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img", CACHE / "mars/megt90n000eb.img")
    fetch_relief_mars()


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
    fetch_clouds()


# Nubes: imágenes reales VIIRS de dos satélites en la misma órbita separados ~50 min (NOAA-20 y NOAA-21).
#  - VIIRS barre 3000 km: sin huecos entre pasadas en el ecuador (MODIS sí los deja).
#  - El reflejo del Sol en el mar cae en sitios distintos para cada satélite: el MÍNIMO de ambos lo elimina.
#  - Banda M11 (2,25 µm, combinación M11-I2-I1): la nieve y el hielo marino son oscuros y las nubes de agua brillantes;
#    así no se confunde hielo con nube.
#  - Latitudes bajas y medias: equinoccio 2026-09-22. Los polos no tienen imagen visible ese día más allá de ~82°N y
#    ~74°S, así que se usa el verano de cada hemisferio (sol las 24 h): Ártico 2026-06-21 y Antártida 2025-12-21.
#    Las fechas se funden con una transición suave en latitud.
CLOUD_SATS = ("NOAA20", "NOAA21")
CLOUD_DATES = {"eq": ("2026-09-22", ("nw", "ne", "sw", "se")), "n": ("2026-06-21", ("nw", "ne")), "s": ("2025-12-21", ("sw", "se"))}
CLOUD_DATE = CLOUD_DATES["eq"][0]


def fetch_clouds():
    print("[Nubes] descargando VIIRS True Color + M11-I2-I1 (NOAA-20 y NOAA-21) y Blue Marble (suelo despejado) …")
    jobs = [(gibs_url("BlueMarble_NextGeneration", bb, 4096, 2048), CACHE / f"earth/bm_{q}.jpg") for q, bb in QUADS.items()]
    for day, quads in CLOUD_DATES.values():
        for sat in CLOUD_SATS:
            for kind, layer in (("tc", "TrueColor"), ("m11", "BandsM11-I2-I1")):
                for q in quads:
                    jobs.append((gibs_url(f"VIIRS_{sat}_CorrectedReflectance_{layer}", QUADS[q], 4096, 2048, day),
                                 CACHE / f"earth/viirs_{day}_{sat}_{kind}_{q}.jpg"))
    pmap(lambda j: download(*j), jobs, 4)


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
    hd = pole_smooth(f_resize(h, 2048, 1024))
    d8 = ((hd - hmin) / (hmax - hmin) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(d8, "L").save(OUT / "moon_height.png", optimize=True)
    print(f"  ✔ assets/textures/moon_height.png  {(OUT / 'moon_height.png').stat().st_size / 1e6:.1f} MB")
    manifest["moon"] = {"radius_m": MOON_R, "hmin": hmin, "hmax": hmax, "height": "moon_height.png",
                        "hi": {"color": "moon_color_hi.jpg", "normal": "moon_normal_hi.jpg"},
                        "lo": {"color": "moon_color_lo.jpg", "normal": "moon_normal_lo.jpg"}}
    build_relief_and_poles("moon", manifest)


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
    hd = pole_smooth(f_resize(h, 2048, 1024))
    Image.fromarray(((hd - hmin) / (hmax - hmin) * 255 + 0.5).astype(np.uint8), "L").save(OUT / "mars_height.png", optimize=True)
    manifest["mars"] = {"radius_m": MARS_R, "hmin": hmin, "hmax": hmax, "height": "mars_height.png",
                        "hi": {"color": "mars_color_hi.jpg", "normal": "mars_normal_hi.jpg"},
                        "lo": {"color": "mars_color_lo.jpg", "normal": "mars_normal_lo.jpg"}}
    build_relief_and_poles("mars", manifest)


# ------------------------------------------------------------------ RELIEVE 64 ppd Y CASQUETES POLARES
def load_relief(body):
    """DEM de 64 px/grado en metros, lon −180…180 (columna 0 = −180°), fila 0 = 90°N."""
    if body == "moon":
        raw = np.fromfile(CACHE / "moon/ldem_64.img", dtype="<i2").reshape(11520, 23040)
        return roll_half(raw.astype(np.float32) * 0.5)                  # SCALING_FACTOR 0,5 m (etiqueta)
    h = np.empty((11520, 23040), np.float32)
    for k, (r, c) in MOLA64_TILES.items():
        h[r * 5760:(r + 1) * 5760, c * 11520:(c + 1) * 11520] = np.fromfile(CACHE / f"mars/megt{k}gb.img", dtype=">i2").reshape(5760, 11520)
    return roll_half(h)


def sample_equirect(a, lat, lon):
    """Muestreo bilineal de un mapa equirrectangular (fila 0 = 90°N, columna 0 = −180°) en lat/lon (grados)."""
    H, W = a.shape[:2]
    x = (lon + 180.0) / 360.0 * W - 0.5
    y = np.clip((90.0 - lat) / 180.0 * H - 0.5, 0, H - 1.001)
    x0, y0 = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64)
    fx, fy = (x - x0), (y - y0)
    if a.ndim == 3:
        fx, fy = fx[..., None], fy[..., None]
    X0, X1 = x0 % W, (x0 + 1) % W
    return ((a[y0, X0] * (1 - fx) + a[y0, X1] * fx) * (1 - fy) + (a[y0 + 1, X0] * (1 - fx) + a[y0 + 1, X1] * fx) * fy)


NQ = 88               # calidad JPEG de los mapas de normales (94 duplicaba el peso sin diferencia visible)
POLAR_LAT0 = 60.0      # el casquete va del polo a 60° (la web lo funde con el mapa global entre 64° y 68°)


def polar_grid(n, north):
    """Rejilla azimutal equidistante: radio 1 = 60° de latitud. Devuelve lat, lon (grados) de cada píxel.
    Convención (la misma que usa el shader): u = 0,5 + 0,5·ρ·sen λ ; v = 0,5 ∓ 0,5·ρ·cos λ (− norte, + sur),
    con v hacia arriba; la fila 0 de la imagen es v = 1."""
    X = ((np.arange(n) + 0.5) / n * 2 - 1)[None, :]
    V = (1 - (np.arange(n) + 0.5) / n * 2)[:, None]
    rho = np.hypot(X, V)
    colat = rho * (90.0 - POLAR_LAT0)
    lat = 90.0 - colat if north else colat - 90.0
    lon = np.degrees(np.arctan2(X, -V if north else V))
    return lat, lon


class MolaPolar:
    """MOLA MEGDR polar (estereográfico, 128 px/grado). Fórmulas de DSMAP_POLAR.CAT:
       X = (I − N/2 − 0,5)/RES, Y = (J − N/2 − 0,5)/RES (I muestra y J línea, base 1), R = √(X²+Y²),
       LAT = ±(90 − 2·atan(R·π/360)·180/π).  TOPOGRAFÍA = valor × 0,25 − 8000 m (etiqueta).
    La orientación de la longitud se comprueba contra la rejilla global de 64 ppd (el texto del catálogo y la
    fórmula no coinciden para el polo sur), eligiendo la que da menor diferencia."""
    RES, N = 128.0, 10240

    def __init__(self, pole, h_eq):
        self.north = pole == "n"
        self.z = (np.fromfile(CACHE / f"mars/megt_{pole}_128_1.img", dtype=">u2").reshape(self.N, self.N).astype(np.float32) * 0.25 - 8000)
        lat = np.linspace(66, 80, 120) * (1 if self.north else -1)
        lon = np.linspace(-179, 179, 240)
        LA, LO = np.meshgrid(lat, lon, indexing="ij")
        ref = sample_equirect(h_eq, LA, LO)
        best = None
        for sx in (1, -1):
            for sy in (1, -1):
                self.sx, self.sy = sx, sy
                d = float(np.sqrt(np.mean((self(LA, LO) - ref) ** 2)))
                if best is None or d < best[0]:
                    best = (d, sx, sy)
        _, self.sx, self.sy = best
        print(f"  MOLA polar {pole}: orientación (sx={self.sx}, sy={self.sy}), RMS frente a la rejilla global {best[0]:.1f} m")
        if best[0] > 150:
            raise RuntimeError("La rejilla polar de MOLA no casa con la global: revisa la proyección")

    def __call__(self, lat, lon):
        colat = np.radians(90.0 - np.abs(lat))
        r = 360.0 / np.pi * np.tan(colat / 2)
        lo = np.radians(lon)
        x, y = self.sx * r * np.sin(lo), self.sy * r * np.cos(lo)
        col = x * self.RES + self.N / 2 - 0.5
        row = y * self.RES + self.N / 2 - 0.5
        c0 = np.clip(np.floor(col).astype(np.int64), 0, self.N - 2); r0 = np.clip(np.floor(row).astype(np.int64), 0, self.N - 2)
        fc, fr = np.clip(col - c0, 0, 1), np.clip(row - r0, 0, 1)
        z = self.z
        return (z[r0, c0] * (1 - fc) + z[r0, c0 + 1] * fc) * (1 - fr) + (z[r0 + 1, c0] * (1 - fc) + z[r0 + 1, c0 + 1] * fc) * fr


def polar_normals(h_eq, lat, lon, radius_m, strength, sampler=None):
    """Normales en el sistema del objeto (el de SphereGeometry de three.js) a partir de la superficie 3D real:
    P = (R + s·h)·U(lat, lon); n = ∂P/∂x × ∂P/∂y. Sin marcos tangentes ni singularidad en el polo."""
    h = (sampler(lat, lon) if sampler else sample_equirect(h_eq, lat, lon)).astype(np.float64) * strength
    la, lo = np.radians(lat), np.radians(lon)
    U = np.stack([np.cos(lo) * np.cos(la), np.sin(la), -np.sin(lo) * np.cos(la)], -1)      # x, y, z de three.js
    P = (radius_m + h)[..., None] * U
    dx = np.zeros_like(P); dy = np.zeros_like(P)
    dx[:, 1:-1] = P[:, 2:] - P[:, :-2]; dx[:, 0] = P[:, 1] - P[:, 0]; dx[:, -1] = P[:, -1] - P[:, -2]
    dy[1:-1] = P[:-2] - P[2:]; dy[0] = P[0] - P[1]; dy[-1] = P[-2] - P[-1]                    # y hacia arriba
    n = np.cross(dx, dy)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    n *= np.sign((n * U).sum(-1, keepdims=True))                                             # hacia fuera
    return Image.fromarray((n * 127.5 + 127.5 + 0.5).clip(0, 255).astype(np.uint8), "RGB")


def build_relief_and_poles(body, manifest, strength=4.0):
    """Normales globales desde el DEM de 64 ppd + casquetes polares (color reproyectado y normales)."""
    radius = MOON_R if body == "moon" else MARS_R
    name = "Luna" if body == "moon" else "Marte"
    print(f"[{name}] relieve 64 ppd y casquetes polares …")
    h = load_relief(body)
    print(f"  DEM 64 ppd: {h.shape[1]}×{h.shape[0]}  {float(h.min()):.0f} … {float(h.max()):.0f} m")
    h8 = np.asarray(Image.fromarray(h, "F").resize((8192, 4096), Image.BOX))
    save_jpg(height_to_normal(h8, radius, strength), OUT / f"{body}_normal_hi.jpg", NQ, 0)
    save_jpg(height_to_normal(np.asarray(Image.fromarray(h, "F").resize((4096, 2048), Image.BOX)), radius, strength),
             OUT / f"{body}_normal_lo.jpg", NQ, 0)
    del h8
    color = np.asarray(Image.open(OUT / f"{body}_color_hi.jpg").convert("RGB"), np.float32)   # mismo color que el globo
    polar = {"lat0": POLAR_LAT0, "fade": [64.0, 68.0]}
    samplers = {}
    if body == "mars":
        samplers = {s: MolaPolar(s, h) for s in ("n", "s")}
        polar["relieve"] = "MOLA MEGDR polar 128 px/grado (megt_n_128_1, megt_s_128_1)"
    else:
        polar["relieve"] = "LOLA LDEM_64"
    for q, size in (("hi", 4096), ("lo", 2048)):
        polar[q] = {}
        for pole in ("n", "s"):
            lat, lon = polar_grid(size, pole == "n")
            col = Image.fromarray(sample_equirect(color, lat, lon).clip(0, 255).astype(np.uint8), "RGB")
            save_jpg(col, OUT / f"{body}_polar_{pole}_color_{q}.jpg", 90)
            save_jpg(polar_normals(h, lat, lon, radius, strength, samplers.get(pole)), OUT / f"{body}_polar_{pole}_normal_{q}.jpg", NQ, 0)
            polar[q][pole] = {"color": f"{body}_polar_{pole}_color_{q}.jpg", "normal": f"{body}_polar_{pole}_normal_{q}.jpg"}
    manifest.setdefault(body, {})["polar"] = polar
    manifest[body].setdefault("hi", {})["normal"] = f"{body}_normal_hi.jpg"
    manifest[body].setdefault("lo", {})["normal"] = f"{body}_normal_lo.jpg"


def build_polar(manifest):
    for body in ("moon", "mars"):
        build_relief_and_poles(body, manifest)


def fetch_polar():
    fetch_relief_moon(); fetch_relief_mars()


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


CLOUD = dict(offset=30, span=175, gamma=1.0, gain=1.0, ice_c0=110, ice_span=40)   # umbral, contraste y prueba de hielo (M11)


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
    """Nubosidad (0..1) a partir de VIIRS, comparada con el suelo despejado (Blue Marble).
    Nube = (exceso de blancura en color verdadero) × (neutra: poco color) × (brillante en M11: no es nieve/hielo).
    Los píxeles sin imagen de ninguna fecha (muy pocos) se rellenan con la media de las nubes vecinas."""
    clear = np.asarray(bm, np.float32).min(-1)
    H, W = 4096, 8192
    lat = (90 - (np.arange(H) + 0.5) / H * 180)[:, None]

    def load(day, sat, kind, quads):
        img = np.zeros((H, W, 3), np.uint8)
        for q in quads:
            x, y = {"nw": (0, 0), "ne": (4096, 0), "sw": (0, 2048), "se": (4096, 2048)}[q]
            img[y:y + 2048, x:x + 4096] = np.asarray(Image.open(CACHE / f"earth/viirs_{day}_{sat}_{kind}_{q}.jpg").convert("RGB"))
        return img

    def sat_cloud(day, sat, quads):
        tc, m11 = load(day, sat, "tc", quads), load(day, sat, "m11", quads)
        lo, hi = tc.min(-1).astype(np.float32), tc.max(-1).astype(np.float32)
        valid = soft_valid(hi > 10, 3)            # en M11 el océano despejado es casi negro: no sirve para validar
        white = np.clip((lo - 0.9 * clear - CLOUD["offset"]) / CLOUD["span"], 0, 1)
        neutral = np.clip(1.2 - (hi - lo) / 90, 0, 1)
        # croma cian en M11-I2-I1: nieve y hielo marino ≫ nubes (medido: nubes tropicales p99 ≈ 100; hielo 120–170)
        m = m11.astype(np.float32)
        cyan = (m[..., 1] + m[..., 2]) / 2 - m[..., 0]
        not_ice = 1 - np.clip((cyan - CLOUD["ice_c0"]) / CLOUD["ice_span"], 0, 1)
        return white * neutral * not_ice, valid

    def day_cloud(day, quads):
        (c1, w1), (c2, w2) = (sat_cloud(day, s, quads) for s in CLOUD_SATS)
        both = w1 * w2
        cover = w1 + w2 - both
        c = (both * np.minimum(c1, c2) + w1 * (1 - w2) * c1 + w2 * (1 - w1) * c2) / np.maximum(cover, 1e-4)
        return c, cover

    ramp = lambda x, a, b: np.clip((x - a) / (b - a), 0, 1)                     # noqa: E731
    # en septiembre el hielo marino antártico está en su máximo: al sur de ~57° se usa el verano austral
    band = {"eq": 1 - np.maximum(ramp(lat, 70, 78), ramp(-lat, 54, 60)), "n": ramp(lat, 70, 78), "s": ramp(-lat, 54, 60)}
    num = np.zeros((H, W), np.float32); den = np.zeros((H, W), np.float32)
    for key, (day, quads) in CLOUD_DATES.items():
        c, cover = day_cloud(day, quads)
        w = band[key] * cover
        num += w * c; den += w
        print(f"  {day}: imagen válida en {float((cover > 0.5).mean()) * 100:.1f} % del globo")
    res = num / np.maximum(den, 1e-4)
    cover = np.clip(den, 0, 1)
    remaining = 1 - cover
    print(f"  sin imagen de ninguna fecha: {remaining.mean() * 100:.2f} % de los píxeles (relleno con las nubes vecinas)")
    sm = lambda a: a.reshape(512, 8, 1024, 8).mean((1, 3))                      # noqa: E731
    fn, fd = gauss_blur(sm(res * cover), 6), gauss_blur(sm(cover), 6)
    fill = np.where(fd > 0.02, fn / np.maximum(fd, 1e-3), 0)
    fill = np.asarray(Image.fromarray(fill.astype(np.float32), "F").resize((W, H), Image.BICUBIC))
    out = res * cover + remaining * np.clip(fill, 0, 1)
    acc = np.clip(out * CLOUD["gain"], 0, 1) ** CLOUD["gamma"]
    return (acc, remaining) if return_parts else acc


def build_clouds_only(manifest):
    print("[Nubes] construyendo …")
    acc = build_clouds(stitch("bm"))
    cimg = Image.fromarray((acc * 255 + 0.5).astype(np.uint8), "L")
    save_jpg(cimg, OUT / "earth_clouds_hi.jpg", 88)
    save_jpg(resize(cimg, 4096, 2048), OUT / "earth_clouds_lo.jpg", 88)
    print(f"  cobertura media de nubes: {acc.mean() * 100:.1f} %")


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

    build_clouds_only(manifest)
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
          "clouds": (fetch_clouds, build_clouds_only), "polar": (fetch_polar, build_polar),
          "earth": (fetch_earth, build_earth), "stars": (fetch_stars, build_stars)}

CREDITS = {
    "moon": "NASA/GSFC/ASU · LRO LROC WAC color mosaic (SVS 4720) · LRO LOLA topography 64 ppd",
    "mars": "NASA/JPL/USGS · Viking MDIM 2.1 · MGS MOLA topography 64 ppd",
    "earth": "NASA Earth Observatory · Blue Marble NG · NASA/NOAA VIIRS Black Marble · NOAA ETOPO2 · NASA/NOAA VIIRS NOAA-20/21 (GIBS; clouds 2026-09-22, 2026-06-21, 2025-12-21)",
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
