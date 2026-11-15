"""Pruebas del motor. Ejecutar desde base-planetaria/:  python -m unittest discover -s similitud/tests -v

Casos con solución analítica, invariancias exigidas por la metodología y, si los datos están en
disco, pruebas con LOLA y MOLA reales.
"""
from __future__ import annotations

import io
import json
import math
import tempfile
import unittest
import zipfile
from pathlib import Path

import numpy as np

from similitud import config
from similitud import data_loader as dl
from similitud import geomorphometry as gm
from similitud import preprocessing as pp
from similitud import similarity_engine as se
from similitud import spatial_analysis as sa
from similitud import statistical_distances as sd
from similitud.servidor import _parametros, limpiar

H = 1000.0
N = 64


def malla(n=N, h=H):
    t = (np.arange(n) - (n - 1) / 2) * h
    x, y = np.meshgrid(t, -t)          # filas de norte a sur: y decrece hacia abajo
    return x, y


def fbm(n: int, hurst: float, semilla: int) -> np.ndarray:
    """Superficie fractal por síntesis espectral: P(k) ∝ k^−(2H+2) ⇒ γ(r) ∝ r^{2H}."""
    rng = np.random.default_rng(semilla)
    kx = np.fft.fftfreq(n)[None, :]
    ky = np.fft.fftfreq(n)[:, None]
    k = np.hypot(kx, ky)
    k[0, 0] = 1.0
    amp = k ** (-(hurst + 1.0))
    amp[0, 0] = 0.0
    fase = np.exp(2j * np.pi * rng.random((n, n)))
    z = np.real(np.fft.ifft2(amp * fase))
    return z / z.std() * 100.0


class Geomorfometria(unittest.TestCase):
    def test_plano_pendiente_exacta_curvatura_y_rugosidad_nulas(self):
        x, y = malla()
        z = 0.1 * x + 0.05 * y + 300.0
        c, _ = gm.campos(z, H)
        esperado = math.degrees(math.atan(math.hypot(0.1, 0.05)))
        self.assertTrue(np.allclose(gm.valores(c["pendiente"]), esperado))
        for v in ("curv_perfil", "curv_planta", "curv_media"):
            self.assertLess(np.nanmax(np.abs(c[v])), 1e-9)
        self.assertLess(np.nanmax(c["rugosidad"]), 1e-6)
        self.assertLess(np.nanmax(np.abs(c["elev_rel"])), 1e-6)

    def test_cupula_convexa_positiva(self):
        x, y = malla()
        z = -(x ** 2 + y ** 2) / 2e5            # cúpula: r = t = −1e-5 1/m
        c, _ = gm.campos(z, H)
        centro = N // 2
        self.assertGreater(c["curv_media"][centro, centro], 0)
        self.assertGreater(np.nanmin(c["curv_perfil"]), 0)     # convexa en perfil en toda la cúpula
        self.assertGreater(np.nanmin(c["curv_planta"]), 0)     # divergente
        # en la cima, H = −(r + t)/2 = 1e-5 1/m = 0,01 1/km
        self.assertAlmostEqual(c["curv_media"][centro, centro], 0.01, places=4)

    def test_rotacion_90_no_cambia_distribuciones(self):
        z = fbm(N, 0.7, 1)
        a, _ = gm.campos(z, H)
        b, _ = gm.campos(np.rot90(z), H)
        for v in ("pendiente", "rugosidad", "curv_media"):
            self.assertLess(sd.wasserstein(gm.valores(a[v]), gm.valores(b[v])), 1e-9)


class Distancias(unittest.TestCase):
    def test_wasserstein_de_un_desplazamiento(self):
        a = np.random.default_rng(0).normal(size=5000)
        self.assertAlmostEqual(sd.wasserstein(a, a + 3.0), 3.0, places=9)

    def test_cuantiles_dentro_de_la_cota(self):
        rng = np.random.default_rng(1)
        a, b = rng.gamma(2, size=4000), rng.gamma(3, size=3000)
        m = config.N_CUANTILES
        aprox = float(sd.wasserstein_cuantiles(sd.cuantiles(a, m), sd.cuantiles(b, m)))
        self.assertLessEqual(abs(aprox - sd.wasserstein(a, b)), sd.cota_error_cuantiles(a, b, m))

    def test_ks_energia_identidad_y_pvalor(self):
        a = np.random.default_rng(2).normal(size=2000)
        self.assertEqual(sd.ks(a, a), 0.0)
        self.assertAlmostEqual(sd.energia(a, a), 0.0, places=9)
        xy = np.column_stack([a, a[::-1]])
        self.assertAlmostEqual(sd.energia(xy, xy), 0.0, places=9)
        # con la misma D, menos observaciones efectivas ⇒ p-valor mayor
        self.assertGreater(sd.ks_pvalor(0.1, 30, 30), sd.ks_pvalor(0.1, 3000, 3000))

    def test_energia_1d_coincide_con_formula_general(self):
        rng = np.random.default_rng(3)
        a, b = rng.normal(size=400), rng.normal(0.5, 1.2, size=300)
        self.assertAlmostEqual(sd.energia(a, b), sd.energia(a[:, None], b[:, None]), places=6)


class Espacial(unittest.TestCase):
    def test_ruido_blanco(self):
        z = np.random.default_rng(4).normal(0, 10, (N, N))
        g = sa.variograma(z, H)["gamma_m2"]
        self.assertTrue(np.all(np.abs(g / 100.0 - 1) < 0.15))       # γ ≈ σ² en todos los desfases
        self.assertLess(abs(sa.moran_i(z)), 0.05)
        self.assertGreater(sa.n_efectivo(z)["n_efectivo"], 0.5 * N * N)

    def test_hurst_ordena_y_sesgo_acotado(self):
        """En desfases de 1–4 celdas una superficie limitada en banda parece más suave: H se sobreestima
        (medido: 0,3→0,48; 0,5→0,61; 0,8→0,81, independiente del tamaño). Se exige orden correcto y sesgo
        ≤ 0,2; H es solo descriptivo (METODOLOGIA.md §3)."""
        est = [np.mean([sa.exponente_hurst(fbm(128, hh, s), H)["H"] for s in range(5)]) for hh in (0.3, 0.5, 0.8)]
        self.assertTrue(est[0] < est[1] < est[2])
        for e, hh in zip(est, (0.3, 0.5, 0.8)):
            self.assertLessEqual(abs(e - hh), 0.2)

    def test_campo_suave_autocorrelado(self):
        z = fbm(N, 0.9, 5)
        self.assertGreater(sa.moran_i(z), 0.8)
        self.assertLess(sa.n_efectivo(z)["n_efectivo"], 0.2 * N * N)

    def test_variograma_con_mascara(self):
        z = np.random.default_rng(6).normal(0, 10, (N, N))
        z[10:30, 10:30] = np.nan
        g = sa.variograma(z, H)["gamma_m2"]
        self.assertTrue(np.all(np.abs(g / 100.0 - 1) < 0.2))


class ComparacionDetallada(unittest.TestCase):
    def test_holm(self):
        from similitud.comparacion import holm
        self.assertEqual(holm([0.01, 0.04, 0.03, 0.005]), [0.03, 0.06, 0.06, 0.02])

    def test_permutacion_por_bloques_discrimina(self):
        """Campo estacionario (ruido blanco suavizado): dos mitades del mismo proceso no se rechazan; el mismo
        proceso con amplitud ×1,5 sí. (Un fBm crudo NO sirve: no es estacionario y sus mitades difieren de verdad.)"""
        from scipy.ndimage import gaussian_filter
        from similitud.comparacion import prueba_bloques
        rechazos_h0, potencia = 0, 0
        for semilla in range(6):
            g = np.random.default_rng(semilla)
            a = gaussian_filter(g.normal(size=(128, 128)), 2.0)
            b = gaussian_filter(g.normal(size=(128, 64)), 2.0)
            rng = np.random.default_rng(config.SEMILLA)
            rechazos_h0 += prueba_bloques(a[:, :64], a[:, 64:], rng, reps=199, reps_boot=19)["p_valor"] <= 0.05
            potencia += prueba_bloques(a[:, :64], 1.5 * b, rng, reps=199, reps_boot=19)["p_valor"] <= 0.05
        self.assertLessEqual(rechazos_h0, 1)          # tasa de error tipo I ≈ α
        self.assertGreaterEqual(potencia, 5)          # detecta la diferencia casi siempre

    def test_escalas_respetan_limites(self):
        from similitud.comparacion import MAX_CELDAS, escalas
        hs, omit = escalas(200.0, 100.0)
        self.assertTrue(all(config.MIN_CELDAS_LADO <= round(200_000 / h) <= MAX_CELDAS for h in hs))
        self.assertTrue(all(round(200_000 / h) > MAX_CELDAS for h in omit))

    def test_teselas_hgt_y_mosaico(self):
        self.assertEqual(dl.nombre_tesela(-1, -47), "s01w047")
        self.assertEqual(dl.teselas_necesarias(38.5, -110.5, 50), [(38, -111)])


class Invariancias(unittest.TestCase):
    def _firma(self, z):
        return se.firma_de_campos(gm.campos(z, H)[0], H)

    def _d(self, a, b):
        return se.distancias(a, b.q[None], b.lg[None], np.array([b.moran]))[0]

    def test_cambio_de_referencia_vertical_constante(self):
        z = fbm(N, 0.7, 7)
        d = self._d(self._firma(z), self._firma(z + 1234.5))
        self.assertLess(np.max(d), 1e-6)

    def test_inclinacion_de_la_referencia(self):
        x, y = malla()
        z = fbm(N, 0.7, 8)
        d = dict(zip(se.CRITERIOS, self._d(self._firma(z), self._firma(z + 1e-3 * x))))
        self.assertLess(d["elev_rel"], 1e-6)          # el plano de la ventana absorbe la inclinación
        self.assertLess(d["variograma"], 1e-6)


class Ordenacion(unittest.TestCase):
    def test_leximax_compatible_con_pareto(self):
        d = np.random.default_rng(9).random((300, 5))
        p = se.percentiles(d)
        pos = np.empty(300, int)
        pos[se.orden_leximax(p)] = np.arange(300)
        for i in range(300):
            domina = np.all(d[i] <= d, axis=1) & np.any(d[i] < d, axis=1)
            self.assertTrue(np.all(pos[i] < pos[domina]))

    def test_dominancia(self):
        d = np.array([[1, 1], [2, 2], [0, 3]], float)
        self.assertEqual(se.n_dominadoras(d, d[0]), 0)
        self.assertEqual(se.n_dominadoras(d, d[1]), 1)
        self.assertEqual(se.n_dominadoras(d, d[2]), 0)


class Proyecciones(unittest.TestCase):
    def test_azimutal_equidistante_conserva_distancias(self):
        r = 1_737_400.0
        x = np.array([0.0, 50_000.0, 0.0, -70_000.0])
        y = np.array([0.0, 0.0, 80_000.0, -70_000.0])
        lat, lon = pp.azimutal_equidistante_inversa(x, y, -85.0, 30.0, r)
        d = se.distancia_gc_km(-85.0, 30.0, lat, lon, r) * 1000
        self.assertTrue(np.allclose(d, np.hypot(x, y), rtol=1e-9, atol=1e-6))
        self.assertGreater(lat[2], -85.0)              # +y = norte

    def test_polar_lola_invierte_la_formula_oficial(self):
        n, s = 200, 240.0
        r = dl.RejillaPolar(cuerpo="moon", producto="sintetico", fuente="lola_gdr_polar",
                            crudo=np.zeros((n, n), "<i2"), escala=0.5, desplazamiento=0.0, radio_m=1_737_400.0,
                            elipsoide=None, referencia_vertical="esfera", polo=-1, escala_m=s,
                            lpo=n / 2 - 0.5, spo=n / 2 - 0.5, lat_borde=85)
        for i_lin, j_mue in ((1, 1), (37, 150), (200, 7)):          # base 1, como en DSMAP_POLAR.CAT
            X = (j_mue - n / 2 - 0.5) * s
            Y = (i_lin - n / 2 - 0.5) * s * -1
            lon = math.degrees(math.atan2(X, Y))
            lat = -90 + math.degrees(2 * math.atan(0.5 * math.hypot(X, Y) / 1_737_400))
            f, c, dentro = r.indices(np.array([lat]), np.array([lon]))
            self.assertAlmostEqual(float(f[0]), i_lin - 1, places=6)
            self.assertAlmostEqual(float(c[0]), j_mue - 1, places=6)
            self.assertTrue(bool(dentro[0]))


class TeselaBil(unittest.TestCase):
    def test_cabecera_y_mosaico(self):
        paso = dl.PASO_30S
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            for nombre, lon0, val in (("a", -180 + paso / 2, 10), ("b", -180 + paso / 2 + 24 * paso, 20)):
                hdr = (f"BYTEORDER M\nLAYOUT BIL\nNROWS 12\nNCOLS 24\nNBANDS 1\nNBITS 16\n"
                       f"ULXMAP {lon0}\nULYMAP {90 - paso / 2}\nXDIM {paso}\nYDIM {paso}\nNODATA -9999\n")
                datos = np.full((12, 24), val, ">i2")
                datos[0, 0] = -9999
                with zipfile.ZipFile(d / f"{nombre}.SRTMGL30.dem.zip", "w") as z:
                    z.writestr(f"{nombre}.SRTMGL30.hdr", hdr)
                    z.writestr(f"{nombre}.SRTMGL30.dem", datos.tobytes())
            ruta = dl.construir_mosaico_srtmgl30(d, d / "mosaico.bin")
            m = np.memmap(ruta, dtype="<i2", mode="r", shape=(12, 43200))
            self.assertEqual(int(m[0, 0]), -9999)
            self.assertEqual(int(m[5, 5]), 10)
            self.assertEqual(int(m[5, 30]), 20)
            self.assertEqual(int(m[5, 60]), -9999)       # sin tesela: sin dato, no relleno

    def test_sin_cabecera_geometria_del_nombre_comprobada(self):
        """Zips de LP DAAC: solo `W020N40.DEM`. Geometría del nombre + formato documentado, comprobada con el
        tamaño, la caja de CMR y los valores (con el orden de bytes contrario saldrían fuera de rango)."""
        datos = np.zeros((dl.FILAS_30S, dl.COLUMNAS_30S), ">i2")          # mar = 0, como en el producto
        datos[0, 0], datos[2000:2100, 3000:3100], datos[-1, -1] = 1234, 800, -12

        def tesela(d: Path, crudo: bytes, caja: str | None):
            with zipfile.ZipFile(d / "W020N40.SRTMGL30.dem.zip", "w", zipfile.ZIP_DEFLATED) as z:
                z.writestr("W020N40.DEM", crudo)
            if caja:
                g = {"producer_granule_id": "W020N40.SRTMGL30.dem", "collection_concept_id": dl.SRTMGL30_CMR,
                     "boxes": [caja]}
                (d / dl.CMR_GRANULOS).write_text(json.dumps({"feed": {"entry": [g]}}))
            return d / "W020N40.SRTMGL30.dem.zip"

        with tempfile.TemporaryDirectory() as tmp:
            a, geo = dl._leer_tesela_zip(tesela(Path(tmp), datos.tobytes(), "-10 -20 40 20"))
            self.assertEqual(a.shape, (6000, 4800))
            self.assertEqual((int(a[0, 0]), int(a[2050, 3050]), int(a[-1, -1])), (1234, 800, -12))
            self.assertAlmostEqual(geo["lon0"], -20 + dl.PASO_30S / 2)      # centro de la celda NO
            self.assertAlmostEqual(geo["lat0"], 40 - dl.PASO_30S / 2)
            p = geo["procedencia"]
            self.assertIn("nombre + formato documentado", p["geometria"])
            self.assertTrue(p["caja_cmr"].startswith("coincide"))
            self.assertTrue(p["orden_discriminado_por_datos"])
            self.assertEqual((p["celdas_vacio"], p["min_m"], p["max_m"]), (0, -12, 1234))
        with tempfile.TemporaryDirectory() as tmp:                       # sin JSON de CMR: se dice, no se inventa
            _, geo = dl._leer_tesela_zip(tesela(Path(tmp), datos.tobytes(), None))
            self.assertTrue(geo["procedencia"]["caja_cmr"].startswith("no comprobada"))
        for crudo, caja in ((datos.tobytes(), "-9 -20 41 20"),            # CMR dice otra caja
                            (datos.astype("<i2").tobytes(), "-10 -20 40 20"),   # orden de bytes contrario
                            (datos.tobytes()[:-2], "-10 -20 40 20")):     # tamaño que no cuadra
            with tempfile.TemporaryDirectory() as tmp, self.assertRaises(dl.MetadatosInconsistentes):
                dl._leer_tesela_zip(tesela(Path(tmp), crudo, caja))
        with self.assertRaises(dl.MetadatosInconsistentes):
            dl.geometria_srtm30_por_nombre("W020X40", 57_600_000)
        self.assertAlmostEqual(dl.geometria_srtm30_por_nombre("e140s10", 57_600_000)["lon0"], 140 + dl.PASO_30S / 2)
        self.assertAlmostEqual(dl.geometria_srtm30_por_nombre("e140s10", 57_600_000)["lat0"], -10 - dl.PASO_30S / 2)


class MascaraAguaSWBD(unittest.TestCase):
    """Agregado de SRTMSWBD (1″, registro por nodo) a 30″ y regla de validez, con teselas sintéticas y sin red."""
    M = dl.M_SWBD
    PASO = dl.PASO_30S

    @staticmethod
    def _granulo(nombre: str) -> dict:
        la, lo = dl._tesela_de_nombre(nombre)
        m = 1 / 3600                                                     # CMR publica ±1″ (recortado en ±180°)
        caja = f"{la - m} {max(-180.0, lo - m)} {la + 1 + m} {min(180.0, lo + 1 + m)}"
        return {"producer_granule_id": f"{nombre}.SRTMSWBD.raw", "collection_concept_id": dl.SRTMSWBD_CMR,
                "boxes": [caja]}

    def _directorio(self, d: Path, teselas: dict, solo_cmr=()):
        """teselas: {nombre: array uint8 3601×3601}; solo_cmr: gránulos que CMR lista pero no están en disco."""
        for nombre, a in teselas.items():
            with zipfile.ZipFile(d / f"{nombre}.SRTMSWBD.raw.zip", "w", zipfile.ZIP_DEFLATED) as z:
                z.writestr(f"{nombre}.raw", a.tobytes())
        entradas = [self._granulo(n) for n in (*teselas, *solo_cmr)]
        (d / dl.CMR_GRANULOS).write_text(json.dumps({"feed": {"entry": entradas}}))

    def _vacia(self):
        return np.full((self.M, self.M), dl.VALOR_TIERRA_SWBD, np.uint8)

    def test_registro_por_nodo_sin_doble_conteo(self):
        a = self._vacia()
        a[-1, :] = a[:, -1] = dl.VALOR_AGUA_SWBD                         # fila/columna 3601: son de la vecina
        c, _, v = dl.cuentas_tesela_swbd(a.tobytes(), "x")
        self.assertEqual(c.shape, (120, 120))
        self.assertEqual(int(c.sum()), 0)
        self.assertEqual(v["agua"], 2 * self.M - 1)
        a = self._vacia()
        a[0, :] = dl.VALOR_AGUA_SWBD                                      # fila norte: cuenta una vez por celda
        a[90:130, 30:60] = dl.VALOR_AGUA_SWBD                             # celda (3, 1) entera y 10 filas de la (4, 1)
        c, _, _ = dl.cuentas_tesela_swbd(a.tobytes(), "x")
        self.assertTrue(np.all(c[0] == 30))
        self.assertEqual(int(c[3, 1]), 900)
        self.assertEqual(int(c[4, 1]), 30 * 10)
        self.assertEqual(int(c[3, 2]), 0)
        self.assertEqual(int(c.sum()), 3600 + 900 + 300)
        for malo in (np.full((self.M, self.M), 1, np.uint8).tobytes(), self._vacia().tobytes()[:-1]):
            with self.assertRaises(dl.MetadatosInconsistentes):
                dl.cuentas_tesela_swbd(malo, "x")

    def test_agregado_bordes_compartidos_y_codigos(self):
        # Rejilla de 61°N a 58°N y de 180°O a 178°O: la franja 61–60°N queda fuera de la cobertura de SWBD.
        geo = {"filas": 3 * 120, "columnas": 2 * 120, "lat0": 61 - self.PASO / 2, "lon0": -180 + self.PASO / 2,
               "paso": self.PASO}
        norte, sur, este = self._vacia(), self._vacia(), self._vacia()
        norte[-1, :] = sur[0, :] = dl.VALOR_AGUA_SWBD                     # el paralelo 59°N, compartido
        norte[:, -1] = este[:, 0] = dl.VALOR_AGUA_SWBD                    # el meridiano 179°O, compartido
        sur[1800:, :] = dl.VALOR_AGUA_SWBD                                # mitad sur de N58W180: agua
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            self._directorio(d, {"N59W180": norte, "N58W180": sur, "N59W179": este})
            with self.assertRaises(dl.DatosNoDisponibles):                # CMR lista una que no está: no se agrega
                self._directorio(d, {}, solo_cmr=("N59W180", "N58W180", "N59W179", "N58W179"))
                dl.construir_fraccion_agua(d, geo, d / "agua.bin", comprobar=False)
            self._directorio(d, {"N59W180": norte, "N58W180": sur, "N59W179": este})
            ruta = dl.construir_fraccion_agua(d, geo, d / "agua.bin", simultaneas=2, comprobar=False)
            m = np.memmap(ruta, dtype="<u2", mode="r", shape=(geo["filas"], geo["columnas"]))
            meta = json.loads(ruta.with_suffix(".json").read_text())
            self.assertTrue(np.all(m[:120] == dl.FUERA_COBERTURA_SWBD))          # 61–60°N
            self.assertTrue(np.all(m[240:, 120:] == dl.SIN_TESELA_SWBD))        # N58W179: no está en CMR
            self.assertTrue(np.all(m[120:240, :120] == 0))                      # N59W180: sus líneas S y E no cuentan
            # el meridiano 179°O se cuenta una sola vez, como columna 0 de N59W179: 30 px por celda de su 1.ª columna
            self.assertTrue(np.all(m[120:240, 120] == 30))
            self.assertTrue(np.all(m[120:240, 121:] == 0))
            self.assertTrue(np.all(m[240, :120] == 30))                         # 59°N: fila 0 de N58W180
            self.assertTrue(np.all(m[241:300, :120] == 0))
            self.assertTrue(np.all(m[300:360, :120] == 900))                    # mitad sur de N58W180
            # píxeles de agua en los .raw: 7201 (N59W180) + 3601 (N59W179) + 3601 + 1801 × 3601 (N58W180)
            self.assertEqual(meta["valores_pixeles"]["agua"], 1805 * self.M - 1)
            self.assertEqual(int(np.asarray(m[120:], np.int64)[np.asarray(m[120:]) <= 900].sum()),
                             120 * 30 + 120 * 30 + 60 * 120 * 900)              # lo agregado: sin líneas repetidas
            bc = meta["bordes_compartidos"]
            self.assertEqual((bc["sur"]["pares_de_teselas"], bc["sur"]["distintos_en_la_linea_compartida"]), (1, 0))
            self.assertEqual((bc["este"]["pares_de_teselas"], bc["este"]["distintos_en_la_linea_compartida"]), (1, 0))
            self.assertGreater(bc["sur"]["control_linea_adyacente_distintos"], 0)

    def test_regla_de_validez(self):
        cuentas = np.array([[0, 1, 450, 451, 900, dl.FUERA_COBERTURA_SWBD, dl.SIN_TESELA_SWBD]] * 2, np.uint16)
        dn = np.array([[5, 5, 5, 5, 5, 0, 0], [0, 0, 0, 0, 0, 7, -3]], np.int16)
        f, c = np.indices(cuentas.shape)
        mayoria = dl.MascaraAgua(cuentas, 0.5, 900, "h")
        cualquiera = dl.MascaraAgua(cuentas, 0.0, 900, "h")
        esperado = [True, True, True, False, False]                       # > 0,5 ⇒ sin dato
        self.assertEqual(mayoria.valida(f, c, dn).tolist(), [esperado + [False, False], esperado + [True, True]])
        esperado = [True, False, False, False, False]                     # > 0 ⇒ sin dato
        self.assertEqual(cualquiera.valida(f, c, dn).tolist(), [esperado + [False, False], esperado + [True, True]])
        # integrada en el muestreo: una muestra es válida solo si sus 4 celdas vecinas lo son
        r = dl.RejillaGeografica(cuerpo="earth", producto="sintetico", fuente="srtmgl30", crudo=np.full((2, 7), 9, "<i2"),
                                 escala=1.0, desplazamiento=0.0, radio_m=6_371_000.0, elipsoide=None,
                                 referencia_vertical="-", sin_dato=-32768, mascara=mayoria,
                                 lat0=1.0, dlat=1.0, lon0=0.0, dlon=1.0)
        _, ok, _ = r.muestrear(np.array([0.5, 0.5, 0.5]), np.array([0.5, 1.5, 2.5]))
        self.assertEqual(ok.tolist(), [True, True, False])
        # la clave del catálogo cambia con la máscara y con el umbral
        claves = set()
        for masc in (None, mayoria, cualquiera, dl.MascaraAgua(cuentas, 0.5, 900, "otra")):
            r.mascara = masc
            claves.add(se._clave_catalogo(r, 200.0, 3704.0, 100.0, 0.95, 200))
        self.assertEqual(len(claves), 4)

    def test_sin_mascara_sigue_como_antes(self):
        geo = {"filas": 120, "columnas": 120, "lat0": 1 - self.PASO / 2, "lon0": -180 + self.PASO / 2, "paso": self.PASO}
        cache = config.CACHE
        try:
            with tempfile.TemporaryDirectory() as tmp:
                d = Path(tmp)
                config.CACHE = d / "cache"
                masc, p = dl._mascara_para(geo, 0.5, d / "no_existe")
                self.assertIsNone(masc)
                self.assertEqual((p["aplicada"], p["motivo"]), (False, "SRTMSWBD no descargada"))
                (d / "swbd").mkdir()
                self._directorio(d / "swbd", {"N00W180": self._vacia()}, solo_cmr=("N00W179",))
                masc, p = dl._mascara_para(geo, 0.5, d / "swbd")
                self.assertIsNone(masc)
                self.assertIn("incompleta: 1/2", p["motivo"])
                self._directorio(d / "swbd", {"N00W180": self._vacia()})
                config.CACHE.mkdir()
                dl.construir_fraccion_agua(d / "swbd", geo, config.CACHE / dl.MASCARA_AGUA, comprobar=False)
                masc, p = dl._mascara_para(geo, 0.5, d / "swbd")
                self.assertTrue(p["aplicada"])
                self.assertEqual(masc.umbral, 0.5)
                with self.assertRaises(dl.MetadatosInconsistentes):           # otra geometría: no se aplica a ciegas
                    dl._mascara_para({**geo, "filas": 240}, 0.5, d / "swbd")
        finally:
            config.CACHE = cache


class Servidor(unittest.TestCase):
    def test_json_estricto_y_validacion(self):
        self.assertEqual(limpiar({"a": float("nan"), "b": np.float32(2)}), {"a": None, "b": 2.0})
        with self.assertRaises(ValueError):
            _parametros({"cuerpo": "earth", "lat": 0, "lon": 0})
        with self.assertRaises(ValueError):
            _parametros({"cuerpo": "moon", "lat": 95, "lon": 0})


@unittest.skipUnless((config.DATOS / "lola_gdr" / "ldem_16.img").exists(), "sin LOLA en disco")
class DatosRealesLuna(unittest.TestCase):
    def test_identidad_la_ventana_se_encuentra_a_si_misma(self):
        r = dl.cargar_lola_16()
        h = pp.resolucion_comun_m(r)
        cat = se.obtener_catalogo(r, 200.0, h)
        i = 1234
        res = se.buscar_analogos("moon", float(cat.lat[i]), float(cat.lon[i]), 200.0, k=3, buscar_en="moon", validar=False)
        primero = res["analogos"][0]
        self.assertAlmostEqual(primero["lat"], float(cat.lat[i]), places=6)
        self.assertEqual(primero["peor_percentil"], 1 / cat.n)
        self.assertLess(max(c["distancia"] for c in primero["criterios"].values()), 1e-6)
        self.assertEqual(primero["ventanas_que_la_dominan"], 0)

    def test_no_se_afina_por_debajo_del_espaciado_nativo(self):
        with self.assertRaises(pp.VentanaInvalida):
            pp.resolucion_comun_m(dl.cargar_lola_16(), h_solicitada_m=500.0)


@unittest.skipUnless((config.DATOS / "lola_gdr_polar" / "ldem_75s_240m.img").exists()
                     and (config.DATOS / "lola_gdr" / "ldem_16.img").exists(), "sin LOLA polar en disco")
class DatosRealesLunaPolar(unittest.TestCase):
    def test_proyeccion_polar_coincide_con_el_producto_cilindrico(self):
        """Mismo instrumento, dos proyecciones: con la convención oficial las alturas deben coincidir
        (medido: r = 0,9997, mediana |Δ| ≈ 25 m); con la longitud invertida, no (r ≈ 0,26)."""
        c = dl.cargar_lola_16()
        rng = np.random.default_rng(0)
        for nombre in ("ldem_75s_240m", "ldem_75n_240m"):
            p = dl.cargar_lola_polar(nombre)
            lat, lon = p.polo * rng.uniform(76, 88, 2000), rng.uniform(0, 360, 2000)
            vc, _, _ = c.muestrear(lat, lon)
            vp, ok, _ = p.muestrear(lat, lon)
            self.assertTrue(ok.all())
            self.assertGreater(np.corrcoef(vp, vc)[0, 1], 0.99)
            self.assertLess(np.median(np.abs(vp - vc)), 60.0)
            vmal, _, _ = p.muestrear(lat, -lon)
            self.assertLess(np.corrcoef(vmal, vc)[0, 1], 0.5)


@unittest.skipUnless((config.DATOS / "mola_meg016" / "megr90n000eb.img").exists(), "sin MOLA en disco")
class DatosRealesMarte(unittest.TestCase):
    def test_extremos_conocidos_y_referencia(self):
        m = dl.cargar_mola()
        h = m.espaciado_nativo_m()
        olimpo = pp.extraer_ventana(m, 18.65, 226.2, 100, h)
        self.assertGreater(np.nanmax(olimpo.z), 20_000)         # cima del Olympus Mons > 20 km (etiqueta: 21 171 m)
        hellas = pp.extraer_ventana(m, -42.4, 70.5, 100, h)
        self.assertLess(np.nanmin(hellas.z), -6_000)
        # areoide frente a esfera: tras quitar el plano, las distribuciones casi no cambian
        e = dl.cargar_mola("esfera")
        a = se.firma_de_campos(gm.campos(pp.extraer_ventana(m, 18.4, 77.7, 200, h).z, h)[0], h)
        b = se.firma_de_campos(gm.campos(pp.extraer_ventana(e, 18.4, 77.7, 200, h).z, h)[0], h)
        d = dict(zip(se.CRITERIOS, se.distancias(a, b.q[None], b.lg[None], np.array([b.moran]))[0]))
        self.assertLess(d["pendiente"], 0.05)                    # grados


if __name__ == "__main__":
    unittest.main()
