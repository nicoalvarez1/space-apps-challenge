"""Referencias bibliográficas de los métodos que aplica el motor.

Cada criterio y cada paso del resultado indica las claves de estas referencias, y el JSON de salida
incluye el texto completo. Las citas de los DATOS están en data_catalog.FUENTES[...]["citas"].
"""
from __future__ import annotations

METODOS: dict[str, dict] = {
    "snyder1987": {
        "cita": "Snyder, J. P. (1987). Map Projections — A Working Manual. U.S. Geological Survey Professional Paper 1395.",
        "url": "https://doi.org/10.3133/pp1395",
        "uso": "proyección azimutal equidistante de cada ventana y estereográfica polar de LOLA",
    },
    "evans1979": {
        "cita": "Evans, I. S. (1979). An integrated system of terrain analysis and slope mapping. Final report on "
                "grant DA-ERO-591-73-G0040, University of Durham.",
        "uso": "derivadas p, q, r, s, t por el polinomio cuadrático en la vecindad 3×3",
    },
    "florinsky2016": {
        "cita": "Florinsky, I. V. (2016). Digital Terrain Analysis in Soil Science and Geology, 2.ª ed. Academic Press.",
        "uso": "definiciones de pendiente y curvaturas de perfil, de planta y media",
    },
    "marcotte1996": {
        "cita": "Marcotte, D. (1996). Fast variogram computation with FFT. Computers & Geosciences, 22(10), 1175–1186.",
        "url": "https://doi.org/10.1016/S0098-3004(96)00026-X",
        "uso": "semivariograma experimental con máscara de datos ausentes",
    },
    "shepard2001": {
        "cita": "Shepard, M. K. et al. (2001). The roughness of natural terrain: A planetary and remote sensing "
                "perspective. Journal of Geophysical Research, 106(E12), 32777–32795.",
        "url": "https://doi.org/10.1029/2000JE001429",
        "uso": "exponente de Hurst a partir del variograma (rugosidad autoafín)",
    },
    "moran1950": {
        "cita": "Moran, P. A. P. (1950). Notes on continuous stochastic phenomena. Biometrika, 37(1/2), 17–23.",
        "url": "https://doi.org/10.2307/2332142",
        "uso": "I de Moran: agrupamiento espacial de las pendientes",
    },
    "bretherton1999": {
        "cita": "Bretherton, C. S. et al. (1999). The effective number of spatial degrees of freedom of a "
                "time-varying field. Journal of Climate, 12(7), 1990–2009.",
        "url": "https://doi.org/10.1175/1520-0442(1999)012<1990:TENOSD>2.0.CO;2",
        "uso": "tamaño muestral efectivo de campos autocorrelacionados",
    },
    "vallender1974": {
        "cita": "Vallender, S. S. (1974). Calculation of the Wasserstein distance between probability distributions "
                "on the line. Theory of Probability and Its Applications, 18(4), 784–786.",
        "url": "https://doi.org/10.1137/1118101",
        "uso": "W₁ unidimensional como integral de la diferencia entre funciones cuantil",
    },
    "stephens1970": {
        "cita": "Stephens, M. A. (1970). Use of the Kolmogorov–Smirnov, Cramér–von Mises and related statistics "
                "without extensive tables. Journal of the Royal Statistical Society B, 32(1), 115–122.",
        "url": "https://doi.org/10.1111/j.2517-6161.1970.tb00821.x",
        "uso": "p-valor asintótico de Kolmogorov–Smirnov",
    },
    "szekely2013": {
        "cita": "Székely, G. J. y Rizzo, M. L. (2013). Energy statistics: A class of statistics based on distances. "
                "Journal of Statistical Planning and Inference, 143(8), 1249–1272.",
        "url": "https://doi.org/10.1016/j.jspi.2013.03.018",
        "uso": "distancia de energía (curvaturas bivariantes y prueba de métrica)",
    },
    "ehrgott2005": {
        "cita": "Ehrgott, M. (2005). Multicriteria Optimization, 2.ª ed. Springer.",
        "url": "https://doi.org/10.1007/3-540-27659-9",
        "uso": "dominancia de Pareto y órdenes lexicográficos sin pesos",
    },
    "kunsch1989": {
        "cita": "Künsch, H. R. (1989). The jackknife and the bootstrap for general stationary observations. "
                "The Annals of Statistics, 17(3), 1217–1241.",
        "url": "https://doi.org/10.1214/aos/1176347265",
        "uso": "bootstrap de bloques para datos dependientes",
    },
    "holm1979": {
        "cita": "Holm, S. (1979). A simple sequentially rejective multiple test procedure. Scandinavian Journal of "
                "Statistics, 6(2), 65–70.",
        "uso": "corrección por comparaciones múltiples en la comparación detallada",
    },
    "kendall1938": {
        "cita": "Kendall, M. G. (1938). A new measure of rank correlation. Biometrika, 30(1/2), 81–93.",
        "url": "https://doi.org/10.2307/2332226",
        "uso": "estabilidad del orden entre pruebas de sensibilidad",
    },
}

POR_CRITERIO = {
    "elev_rel": ["vallender1974"],
    "pendiente": ["evans1979", "florinsky2016", "vallender1974"],
    "rugosidad": ["evans1979", "vallender1974"],
    "curv_perfil": ["evans1979", "florinsky2016", "vallender1974"],
    "curv_planta": ["evans1979", "florinsky2016", "vallender1974"],
    "variograma": ["marcotte1996"],
    "moran_pendiente": ["moran1950"],
}

POR_PASO = {
    "ventana": ["snyder1987"],
    "ordenacion": ["ehrgott2005"],
    "dependencia_espacial": ["bretherton1999", "stephens1970"],
    "validacion": ["kunsch1989", "kendall1938", "szekely2013"],
    "descriptores": ["shepard2001"],
}


def lista(claves) -> list[dict]:
    return [{"clave": k, **METODOS[k]} for k in dict.fromkeys(claves)]
