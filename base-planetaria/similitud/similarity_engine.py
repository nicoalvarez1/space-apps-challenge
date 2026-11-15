"""Motor de búsqueda de análogos: firma de ventana, catálogo, distancias, Pareto, orden leximax.

Flujo (METODOLOGIA.md §1–6):
 1. Ventana objetivo (Luna o Marte) de lado L con celda h común.
 2. Catálogo de ventanas del cuerpo de búsqueda (Tierra por defecto), del mismo L y h, en caché.
 3. Distancia por criterio (W₁, variograma, Moran) entre el objetivo y cada ventana.
 4. Percentil de cada distancia en el catálogo → dominancia de Pareto → orden leximax.
 5. Supresión de solapes y análisis detallado de la lista corta (W₁ exacto, KS con n_ef, energía).
"""
from __future__ import annotations

import hashlib
import json
import math
import shutil
import tempfile
import time
from pathlib import Path
from dataclasses import dataclass

import numpy as np

from . import config, data_catalog, referencias
from . import geomorphometry as gm
from . import preprocessing as pp
from . import spatial_analysis as sa
from . import statistical_distances as sd
from .data_loader import Raster, cargar

VERSION_FIRMA = "1"
VARS = config.VARIABLES_DISTRIBUCION
CRITERIOS = config.CRITERIOS

NOMBRE = {
    "elev_rel": "distribución de elevación relativa", "pendiente": "distribución de pendientes",
    "rugosidad": "distribución de rugosidad", "curv_perfil": "distribución de curvatura de perfil",
    "curv_planta": "distribución de curvatura de planta", "variograma": "variograma (estructura por escalas)",
    "moran_pendiente": "agrupamiento espacial de pendientes (I de Moran)",
}
METRICA = {**{v: "Wasserstein-1" for v in VARS}, "variograma": "RMS de ln γ(r) en desfases de media octava",
           "moran_pendiente": "|I_A − I_B|"}
UNIDAD = {**{v: gm.UNIDADES[v] for v in VARS}, "variograma": "adimensional (ln)", "moran_pendiente": "adimensional"}


# =========================================================================== firma
@dataclass
class Firma:
    q: np.ndarray            # (len(VARS), M) cuantiles
    lg: np.ndarray           # ln γ en desfases de media octava
    moran: float


def firma_de_campos(campos: dict, h: float, m: int = config.N_CUANTILES) -> Firma | None:
    q = []
    for v in VARS:
        x = gm.valores(campos[v])
        if x.size < 10 * config.MIN_CELDAS_LADO:
            return None
        q.append(sd.cuantiles(x, m))
    return Firma(np.array(q), sa.log_variograma(campos["elev_rel"], h), sa.moran_i(campos["pendiente"]))


def como_catalogo(f: Firma) -> Firma:
    """Misma precisión que el catálogo (float32), para que una ventana idéntica dé distancia 0 exacta."""
    return Firma(f.q.astype(np.float32).astype(np.float64), f.lg.astype(np.float32).astype(np.float64),
                 float(np.float32(f.moran)))


def distancias(f_obj: Firma, q: np.ndarray, lg: np.ndarray, moran: np.ndarray) -> np.ndarray:
    """Matriz n×c de distancias de cribado (W₁ por cuantiles, variograma, Moran)."""
    w = sd.wasserstein_cuantiles(q, f_obj.q[None, :, :])                     # (n, len(VARS))
    dv = sd.distancia_variograma(lg, f_obj.lg[None, :])
    dm = np.abs(moran - f_obj.moran)
    return np.column_stack([w, dv, dm])


# =========================================================================== catálogo
def centros(radio_m: float, paso_km: float) -> np.ndarray:
    """Centros casi equiespaciados sobre la esfera: filas de latitud cada `paso`, y en cada fila
    ⌊2πR cos φ / paso⌋ longitudes uniformes. Diseño de muestreo determinista."""
    dphi = paso_km * 1000.0 / radio_m
    out = []
    for phi in np.arange(-math.pi / 2 + dphi / 2, math.pi / 2, dphi):
        n = max(1, int(2 * math.pi * radio_m * math.cos(phi) / (paso_km * 1000.0)))
        lon = (np.arange(n) + 0.5) * 360.0 / n
        out.append(np.column_stack([np.full(n, math.degrees(phi)), lon]))
    return np.vstack(out)


@dataclass
class Catalogo:
    lat: np.ndarray
    lon: np.ndarray
    cobertura: np.ndarray
    observada: np.ndarray       # NaN si el producto no tiene conteos
    q: np.ndarray               # (n, len(VARS), M) float32
    lg: np.ndarray              # (n, nlags) float32
    moran: np.ndarray
    meta: dict

    @property
    def n(self) -> int:
        return int(self.lat.size)


def _clave_catalogo(r: Raster, lado_km, h, paso_km, min_cob, m) -> str:
    base = f"{r.fuente}|{r.producto}|{lado_km}|{h:.3f}|{paso_km}|{min_cob}|{m}|{VERSION_FIRMA}"
    if r.sin_dato is not None:          # si cambia qué celdas son válidas, el catálogo guardado ya no sirve
        base += f"|sin_dato={r.sin_dato}"
    if getattr(r, "mascara", None) is not None:    # ídem con la máscara de agua: otra máscara o umbral ⇒ otra clave
        base += "|" + r.mascara.clave()
    return f"catalogo_{r.cuerpo}_{r.producto.replace(' ', '')}_{hashlib.sha1(base.encode()).hexdigest()[:12]}"


def obtener_catalogo(r: Raster, lado_km: float, h: float, paso_km: float | None = None,
                     min_cob: float = config.MIN_COBERTURA, m: int = config.N_CUANTILES,
                     progreso=None) -> Catalogo:
    paso_km = paso_km or lado_km * config.PASO_FRACCION
    clave = _clave_catalogo(r, lado_km, h, paso_km, min_cob, m)
    ruta = config.CACHE / f"{clave}.npz"
    if ruta.exists():
        z = np.load(ruta, allow_pickle=False)
        return Catalogo(z["lat"], z["lon"], z["cobertura"], z["observada"], z["q"], z["lg"], z["moran"],
                        json.loads(str(z["meta"])))
    t0 = time.time()
    cs = centros(r.radio_local_m(0.0), paso_km)
    k = pp.factor_submuestreo(r, h)
    filas = {x: [] for x in ("lat", "lon", "cobertura", "observada", "q", "lg", "moran")}
    descartes = {"cobertura_aproximada": 0, "cobertura": 0, "muestra_insuficiente": 0}
    for i, (la, lo) in enumerate(cs):
        if progreso and i % 500 == 0:
            progreso(i, len(cs))
        if pp.cobertura_aproximada(r, la, lo, lado_km) < min_cob - 0.15:
            descartes["cobertura_aproximada"] += 1
            continue
        v = pp.extraer_ventana(r, la, lo, lado_km, h, k)
        if v.cobertura < min_cob:
            descartes["cobertura"] += 1
            continue
        campos, _ = gm.campos(v.z, h)
        f = firma_de_campos(campos, h, m)
        if f is None:
            descartes["muestra_insuficiente"] += 1
            continue
        for x, val in (("lat", la), ("lon", lo), ("cobertura", v.cobertura),
                       ("observada", np.nan if v.fraccion_observada is None else v.fraccion_observada),
                       ("q", f.q.astype(np.float32)), ("lg", f.lg.astype(np.float32)), ("moran", f.moran)):
            filas[x].append(val)
    meta = {"fuente": r.fuente, "producto": r.producto, "cuerpo": r.cuerpo, "lado_km": lado_km, "h_m": h,
            "paso_km": paso_km, "min_cobertura": min_cob, "cuantiles": m, "centros_evaluados": int(len(cs)),
            "ventanas_validas": len(filas["lat"]), "descartes": descartes, "k_submuestreo": k,
            "segundos": round(time.time() - t0, 1), "version_firma": VERSION_FIRMA}
    if not filas["lat"]:
        raise RuntimeError(f"Catálogo vacío para {r.producto}: {descartes}")
    cat = Catalogo(*(np.array(filas[x]) for x in ("lat", "lon", "cobertura", "observada", "q", "lg", "moran")), meta)
    config.CACHE.mkdir(parents=True, exist_ok=True)
    config.TEMPORAL.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=config.TEMPORAL) as tmp:      # fuera del repo; un solo archivo nuevo en CACHE
        t = Path(tmp) / ruta.name
        np.savez_compressed(t, lat=cat.lat, lon=cat.lon, cobertura=cat.cobertura, observada=cat.observada,
                            q=cat.q, lg=cat.lg, moran=cat.moran, meta=json.dumps(meta))
        shutil.move(t, ruta)
    return cat


# =========================================================================== ordenación sin pesos
def percentiles(d: np.ndarray) -> np.ndarray:
    """p_ij = #{l : d_lj ≤ d_ij} / n, por columna (invariante a transformaciones monótonas)."""
    n = d.shape[0]
    p = np.empty_like(d, dtype=float)
    for j in range(d.shape[1]):
        col = np.sort(d[:, j])
        p[:, j] = np.searchsorted(col, d[:, j], side="right") / n
    return p


def orden_leximax(p: np.ndarray) -> np.ndarray:
    """Orden por peor percentil, luego el segundo peor… Compatible con Pareto; empates por índice."""
    s = -np.sort(-p, axis=1)                                   # descendente por fila
    return np.lexsort([np.arange(p.shape[0])] + [s[:, j] for j in range(s.shape[1] - 1, -1, -1)])


def n_dominadoras(d: np.ndarray, fila: np.ndarray) -> int:
    """Nº de ventanas que dominan a `fila` (≤ en todo, < en algo). 0 = óptimo de Pareto."""
    return int((np.all(d <= fila, axis=1) & np.any(d < fila, axis=1)).sum())


def distancia_gc_km(lat1, lon1, lat2, lon2, radio_m) -> np.ndarray:
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dl = np.radians(np.asarray(lon2) - np.asarray(lon1))
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * radio_m * np.arcsin(np.sqrt(np.clip(a, 0, 1))) / 1000.0


def suprimir_solapes(orden: np.ndarray, lat, lon, separacion_km: float, radio_m: float, cuantos: int) -> list[int]:
    elegidos: list[int] = []
    for i in orden:
        if elegidos and np.any(distancia_gc_km(lat[i], lon[i], lat[elegidos], lon[elegidos], radio_m) < separacion_km):
            continue
        elegidos.append(int(i))
        if len(elegidos) >= cuantos:
            break
    return elegidos


# =========================================================================== análisis detallado
def describir(campos: dict, diag: dict, h: float) -> dict:
    out = {"estadisticos": {v: gm.estadisticos(gm.valores(campos[v])) for v in (*VARS, "curv_media", "relieve_local")},
           "unidades": gm.UNIDADES,
           "hurst": sa.exponente_hurst(campos["elev_rel"], h),
           "longitud_correlacion": sa.longitud_correlacion(campos["elev_rel"], h),
           "anisotropia": sa.anisotropia(campos["elev_rel"], h),
           "moran_pendiente": sa.moran_i(campos["pendiente"]),
           "n_efectivo": {v: sa.n_efectivo(campos[v]) for v in VARS},
           "diagnostico": diag}
    v = sa.variograma(campos["elev_rel"], h)
    out["variograma"] = {"r_m": v["r_m"].tolist(), "gamma_m2": v["gamma_m2"].tolist()}
    return out


def _curvaturas(campos: dict, max_puntos: int = 2000) -> np.ndarray:
    ambos = np.where(np.isfinite(campos["curv_perfil"]) & np.isfinite(campos["curv_planta"]), 1.0, np.nan)
    sel, _ = sd.submalla(ambos, max_puntos)
    return np.column_stack([campos["curv_perfil"][sel], campos["curv_planta"][sel]])


def distancias_exactas(ca: dict, cb: dict, h: float, desc_a: dict | None = None, desc_b: dict | None = None) -> dict:
    """Todas las métricas entre dos ventanas a partir de sus campos completos."""
    out = {}
    for v in VARS:
        a, b = gm.valores(ca[v]), gm.valores(cb[v])
        d_ks = sd.ks(a, b)
        na = (desc_a or {}).get("n_efectivo", {}).get(v, {}).get("n_efectivo") or sa.n_efectivo(ca[v])["n_efectivo"]
        nb = (desc_b or {}).get("n_efectivo", {}).get(v, {}).get("n_efectivo") or sa.n_efectivo(cb[v])["n_efectivo"]
        out[v] = {"wasserstein_1": sd.wasserstein(a, b), "ks": d_ks, "energia_1d": sd.energia(a, b),
                  "ks_p_valor_n_efectivo": sd.ks_pvalor(d_ks, na, nb),
                  "ks_p_valor_ingenuo_pixeles": sd.ks_pvalor(d_ks, a.size, b.size),
                  "n_efectivo": [na, nb], "n_pixeles": [int(a.size), int(b.size)],
                  "wasserstein_1_tipificado": sd.wasserstein(sd.tipificar(a), sd.tipificar(b)),
                  "cota_error_cribado": sd.cota_error_cuantiles(a, b, config.N_CUANTILES)}
    out["variograma"] = {"distancia": float(sd.distancia_variograma(sa.log_variograma(ca["elev_rel"], h),
                                                                     sa.log_variograma(cb["elev_rel"], h)))}
    out["moran_pendiente"] = {"distancia": abs(sa.moran_i(ca["pendiente"]) - sa.moran_i(cb["pendiente"]))}
    out["curvaturas_bivariante"] = {"energia_1_km": sd.energia(_curvaturas(ca), _curvaturas(cb)),
                                    "nota": "energía sobre (k_v, k_h), ambas en 1/km; submalla regular ≤ 2000 celdas"}
    return out


def ventana_desplazada(r: Raster, lat: float, lon: float, dx_km: float, dy_km: float):
    la, lo = pp.azimutal_equidistante_inversa(np.array(dx_km * 1000.0), np.array(dy_km * 1000.0),
                                              lat, lon, r.radio_local_m(lat))
    return float(la), float(lo)


def huella(lat: float, lon: float, lado_km: float, radio_m: float, puntos: int = 8) -> list[list[float]]:
    """Polígono GeoJSON (lon, lat) del cuadrado de la ventana, longitudes continuas respecto al centro."""
    t = np.linspace(-0.5, 0.5, puntos + 1) * lado_km * 1000.0
    lado = np.full_like(t, 0.5 * lado_km * 1000.0)
    xs = np.concatenate([t, lado[:-1], -t[::-1], -lado[:-1]])
    ys = np.concatenate([lado, -t[1:], -lado[1:], t])
    la, lo = pp.azimutal_equidistante_inversa(xs, ys, lat, lon % 360.0, radio_m)
    c = ((lon + 180) % 360) - 180
    lo = c + ((lo - c + 180) % 360) - 180
    anillo = [[round(float(a), 5), round(float(b), 5)] for a, b in zip(lo, la)]
    return anillo + [anillo[0]]


# =========================================================================== explicación
def _clase(d: float, p: float, ref: float) -> tuple[str, str]:
    if d <= ref:
        return "indistinguible", "dentro de la variabilidad propia del objetivo"
    if p <= 0.05:
        return "muy_proxima", f"entre el 5 % más próximo del catálogo (percentil {100 * p:.1f})"
    if p <= 0.25:
        return "proxima", f"entre el 25 % más próximo (percentil {100 * p:.1f})"
    return "distinta", f"percentil {100 * p:.1f}"


def explicar(crit: dict, desc_obj: dict, desc_cand: dict, h: float, lado_km: float) -> str:
    coincide = [NOMBRE[c] for c, x in crit.items() if x["clase"] in ("indistinguible", "muy_proxima")]
    difiere = [NOMBRE[c] for c, x in crit.items() if x["clase"] == "distinta"]
    eo, ec = desc_obj["estadisticos"], desc_cand["estadisticos"]
    partes = [
        f"A escala h = {h / 1000:.2f} km y ventana L = {lado_km:.0f} km:",
        f"pendiente mediana {ec['pendiente']['mediana']:.2f}° frente a {eo['pendiente']['mediana']:.2f}° del objetivo "
        f"(W₁ = {crit['pendiente']['distancia']:.3f}°);",
        f"desviación típica del relieve {ec['elev_rel']['desv_tipica']:.0f} m frente a {eo['elev_rel']['desv_tipica']:.0f} m;",
        f"rugosidad mediana {ec['rugosidad']['mediana']:.1f} m frente a {eo['rugosidad']['mediana']:.1f} m;",
        f"variogramas que difieren en un factor típico ×{math.exp(crit['variograma']['distancia']):.2f}.",
    ]
    if coincide:
        partes.append("Muy próxima o indistinguible en: " + ", ".join(coincide) + ".")
    if difiere:
        partes.append("Difiere en: " + ", ".join(difiere) + ".")
    partes.append("Es una semejanza geomorfológica a esta escala: no implica el mismo origen geológico, "
                  "condiciones ambientales equivalentes ni aptitud para una misión.")
    return " ".join(partes)


VARIABLES_NO_COMPARADAS = [
    {"variable": "densidad y tamaños de cráteres", "motivo": "no hay catálogo de cráteres entre los recursos oficiales verificados"},
    {"variable": "composición (Lunar Prospector, Odyssey GRS)", "motivo": "no existe un mapa terrestre equivalente en los recursos oficiales"},
    {"variable": "temperatura de superficie (Diviner, TES)", "motivo": "semejanza ambiental, no geomorfológica; sin MDE de temperatura terrestre cargado; rangos casi sin solape"},
    {"variable": "profundidad de estabilidad del hielo (Diviner PRP)", "motivo": "sin equivalente terrestre"},
    {"variable": "pendiente y rugosidad de LOLA (LDSM, LDRM)", "motivo": "base de 30–240 m, otra escala: se recalculan con el mismo algoritmo en todos los cuerpos"},
    {"variable": "retrodispersión radar (RADARSAT, Mini-RF)", "motivo": "requiere calibración por longitud de onda e incidencia; fuera de esta versión"},
]

LIMITACIONES = [
    "La escala más fina comparable es h: no se describe nada menor (rocas, bloques, regolito, cuevas).",
    "Una semejanza de relieve no implica el mismo proceso (impacto, volcanismo, erosión) ni el mismo material.",
    "La Tierra no reproduce gravedad, vacío o atmósfera, radiación ni temperaturas lunares o marcianas.",
    "SRTMGL30 no cubre al sur de 60°S (Antártida) y no indica qué celdas son medición o relleno; el hielo cuenta como superficie. "
    "El agua solo se excluye con la máscara SRTMSWBD (si está en disco) o, donde no la hay, por valer 0 m: ver criterio_validez.",
    "El percentil es relativo al catálogo terrestre evaluado: cambia si cambian L, h o la cobertura mínima.",
    "El orden leximax trata todos los criterios por igual en espacio de rangos (única hipótesis de agregación).",
    "Los criterios están correlacionados (p. ej., pendiente y variograma); no son evidencias independientes.",
]


# =========================================================================== búsqueda
def buscar_analogos(cuerpo: str, lat: float, lon: float, lado_km: float = config.LADO_KM, k: int = 10,
                    buscar_en: str = "earth", producto: str | None = None, h_m: float | None = None,
                    paso_km: float | None = None, validar: bool = True, progreso=None) -> dict:
    t0 = time.time()
    r_obj, r_bus = cargar(cuerpo, producto), cargar(buscar_en)
    h = pp.resolucion_comun_m(r_obj, r_bus, h_solicitada_m=h_m)
    v_obj = pp.extraer_ventana(r_obj, lat, lon, lado_km, h)
    if v_obj.cobertura < config.MIN_COBERTURA:
        raise pp.VentanaInvalida(f"cobertura del objetivo {v_obj.cobertura:.2%} < {config.MIN_COBERTURA:.0%}")
    c_obj, diag_obj = gm.campos(v_obj.z, h)
    f_obj = firma_de_campos(c_obj, h)
    if f_obj is None:
        raise pp.VentanaInvalida("el objetivo no tiene celdas válidas suficientes")
    f_obj = como_catalogo(f_obj)
    desc_obj = describir(c_obj, diag_obj, h)

    cat = obtener_catalogo(r_bus, lado_km, h, paso_km, progreso=progreso)
    d = distancias(f_obj, cat.q, cat.lg, cat.moran)
    p = percentiles(d)
    orden = orden_leximax(p)
    lista_n = max(3 * k, 30)
    lista = suprimir_solapes(orden, cat.lat, cat.lon, lado_km, r_bus.radio_local_m(0.0), lista_n)

    # variabilidad intrínseca: el objetivo frente a sí mismo desplazado ±L/4
    s = lado_km * config.DESPLAZAMIENTO_REF
    ref = []
    for dx, dy in ((s, 0), (-s, 0), (0, s), (0, -s)):
        la, lo = ventana_desplazada(r_obj, lat, lon, dx, dy)
        vd = pp.extraer_ventana(r_obj, la, lo, lado_km, h)
        fd = firma_de_campos(gm.campos(vd.z, h)[0], h)
        if fd is not None:
            fd = como_catalogo(fd)
            ref.append(distancias(f_obj, fd.q[None], fd.lg[None], np.array([fd.moran]))[0])
    ref = np.max(ref, axis=0) if ref else np.full(len(CRITERIOS), np.nan)

    radio_bus = r_bus.radio_local_m(0.0)
    analogos, campos_lista = [], []
    for rango, i in enumerate(lista, 1):
        vc = pp.extraer_ventana(r_bus, cat.lat[i], cat.lon[i], lado_km, h)
        cc, dg = gm.campos(vc.z, h)
        campos_lista.append(cc)
        if rango > k:
            continue
        desc_c = describir(cc, dg, h)
        exactas = distancias_exactas(c_obj, cc, h, desc_obj, desc_c)
        crit = {}
        for j, c in enumerate(CRITERIOS):
            clase, texto = _clase(d[i, j], p[i, j], ref[j])
            crit[c] = {"nombre": NOMBRE[c], "metrica": METRICA[c], "unidades": UNIDAD[c],
                       "distancia": float(d[i, j]), "percentil_catalogo": float(p[i, j]),
                       "referencia_intrinseca": float(ref[j]), "clase": clase, "lectura": texto,
                       "referencias": referencias.POR_CRITERIO[c]}
        analogos.append({
            "rango": rango, "ventana": vc.resumen(),
            "lat": float(cat.lat[i]), "lon": float(((cat.lon[i] + 180) % 360) - 180),
            "peor_percentil": float(p[i].max()), "criterio_peor": CRITERIOS[int(np.argmax(p[i]))],
            "ventanas_que_la_dominan": n_dominadoras(d, d[i]),
            "criterios": crit, "metricas_exactas": exactas, "descriptores": desc_c,
            "explicacion": explicar(crit, desc_obj, desc_c, h, lado_km),
            "huella": huella(cat.lat[i], cat.lon[i], lado_km, radio_bus),
        })

    resultado = {
        "objetivo": {"ventana": v_obj.resumen(), "descriptores": desc_obj,
                     "huella": huella(lat, lon, lado_km, r_obj.radio_local_m(lat))},
        "parametros": {"lado_km": lado_km, "h_m": h, "celdas_por_lado": v_obj.n, "k": k,
                       "lista_corta": len(lista), "separacion_minima_km": lado_km,
                       "desplazamiento_referencia_km": s, "cuantiles": config.N_CUANTILES,
                       "cobertura_minima": config.MIN_COBERTURA, "semilla": config.SEMILLA},
        "datos": {"objetivo": r_obj.resumen(), "busqueda": r_bus.resumen(), "catalogo": cat.meta},
        "criterios": [{"id": c, "nombre": NOMBRE[c], "metrica": METRICA[c], "unidades": UNIDAD[c]} for c in CRITERIOS],
        "metodo_ordenacion": ("percentil de cada distancia en el catálogo → orden leximax (peor percentil, después "
                              "el siguiente…), compatible con la dominancia de Pareto; sin pesos ni porcentaje de "
                              "similitud. Se suprimen candidatos con centros a menos de L."),
        "analogos": analogos,
        "variables_no_comparadas": VARIABLES_NO_COMPARADAS,
        "limitaciones": LIMITACIONES,
        "tipo_de_semejanza": "geomorfológica (no ambiental, no aptitud para misión)",
        "recurso_oficial": data_catalog.RECURSO_OFICIAL,
        "referencias": {
            "datos": list(dict.fromkeys(data_catalog.FUENTES[r_obj.fuente]["citas"]
                                        + data_catalog.FUENTES[r_bus.fuente]["citas"]
                                        + (data_catalog.FUENTES["srtmswbd"]["citas"]
                                           if getattr(r_bus, "mascara", None) is not None else []))),
            "metodos": referencias.lista([k for ks in (*referencias.POR_PASO.values(), *referencias.POR_CRITERIO.values())
                                          for k in ks]),
            "por_paso": referencias.POR_PASO,
        },
    }
    if validar:
        from . import validation
        resultado["validacion"] = validation.validar(r_obj, r_bus, lat, lon, lado_km, h,
                                                     [(cat.lat[i], cat.lon[i]) for i in lista], k, c_obj, campos_lista)
    resultado["geojson"] = geojson(resultado)
    resultado["segundos"] = round(time.time() - t0, 1)
    return resultado


def geojson(res: dict) -> dict:
    feats = [{"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [a["huella"]]},
              "properties": {"rango": a["rango"], "peor_percentil": a["peor_percentil"],
                             "ventanas_que_la_dominan": a["ventanas_que_la_dominan"],
                             "lat": a["lat"], "lon": a["lon"], "cuerpo": res["datos"]["busqueda"]["cuerpo"]}}
             for a in res["analogos"]]
    return {"type": "FeatureCollection", "features": feats}
