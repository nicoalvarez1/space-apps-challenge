# Metodología matemática — Fase 3

Solo se definen métricas **calculables con los datos auditados** (ver `INVENTARIO_RECURSOS.md`). Todas son
deterministas; donde hay remuestreo aleatorio (bootstrap, ruido de prueba) la semilla es fija
(`config.SEMILLA`) y forma parte del resultado.

## 1. Ventanas comparables

**Resolución común.** h = max_i Δ_i, siendo Δ_i la mayor separación entre centros de celda del producto i
(esfera: R·max(Δφ, Δλ); elipsoide: M(90°)·Δφ). Pedir un h menor se rechaza: crearía precisión artificial.

**Ventana.** Cuadrado de lado L = N·h (N ≥ 20) en la proyección azimutal equidistante centrada en
(φ₀, λ₀) sobre la esfera local de radio R (Luna 1737,4 km y Marte 3396 km según sus etiquetas; Tierra:
radio de Gauss R_G = a√(1−e²)/(1−e² sin²φ₀) del WGS84). Inversa (Snyder 1987, ec. 20-14 y 20-15), con
ρ = √(x²+y²) y c = ρ/R:

    φ = asin(cos c · sin φ₀ + y · sin c · cos φ₀ / ρ)
    λ = λ₀ + atan2(x · sin c, ρ · cos φ₀ · cos c − y · sin φ₀ · sin c)

**Remuestreo sin precisión artificial.** El valor de cada celda es la media de k×k muestras bilineales,
con k = max(2, ⌈h/Δ⌉+1); es decir, la media de área (filtro de caja de lado h). Una celda es válida solo si
todas sus muestras lo son: los huecos no se rellenan.

**Validez de las celdas terrestres (SRTMGL30 + máscara de agua SRTMSWBD).** En SRTMGL30 el mar no es «sin dato»:
vale 0 m (71 % de las celdas del mosaico) y no se distingue de la tierra a 0 m. Por eso, si la máscara de agua
SRTMSWBD V003 (NGA/LP DAAC, 1″) está en disco (`python -m similitud descargar-agua`; se guarda fuera del
repositorio, en `$SRTMSWBD_DIR`, por defecto `~/.cache/landfall/srtmswbd`), se agrega a la rejilla exacta
de 30″ del mosaico como **fracción de agua** f de cada celda (30×30 píxeles de 1″; registro por nodo: la última
fila y columna de cada tesela son la primera de la vecina y no se cuentan dos veces). Una celda de 30″ es válida si
vale ≠ −32768 y además:

- con tesela SWBD: f ≤ `UMBRAL_AGUA` = 0,5 (mayoría; decisión metodológica, no constante física);
- sin tesela SWBD (al norte de 60°N, entre 56°S y 60°S, y en las teselas de 1° que CMR no lista): ≠ 0 m. Una
  tesela ausente no significa «todo tierra» ni «todo océano» (ver `INVENTARIO_RECURSOS.md` §2.3), y ahí el mar
  solo se reconoce por valer 0 m; se pierde también la tierra que esté exactamente a 0 m.

Sin la máscara en disco, el cargador funciona como antes (el mar cuenta como superficie a 0 m) y lo dice en
`criterio_validez`. La clave del catálogo incluye la huella de la máscara, el umbral y la regla, así que cambiar
cualquiera de ellos obliga a rehacer el catálogo. Las mediciones (efecto del umbral, alineación) están en §9.

**Referencia vertical.** Esfera (Luna), areoide (Marte) y geoide EGM96 (Tierra) no son comparables en valor
absoluto. Dentro de cada ventana se ajusta y se resta el plano de mínimos cuadrados z = a + bx + cy:
desaparecen el desplazamiento y la inclinación de la referencia. Lo que queda de la diferencia entre
referencias (la parte no plana) se mide en Marte comparando MEGT (areoide) con MEGR − 3396 km (esfera).

## 2. Variables locales (escala h, vecindad 3×3)

Polinomio de Evans–Young (Florinsky 2016), x hacia el este e y hacia el norte:

    p = (z3+z6+z9−z1−z4−z7)/6h          q = (z1+z2+z3−z7−z8−z9)/6h
    r = (z1+z3+z4+z6+z7+z9−2(z2+z5+z8))/3h²
    t = (z1+z2+z3+z7+z8+z9−2(z4+z5+z6))/3h²
    s = (z3+z7−z1−z9)/4h²

| Variable | Definición | Unidad |
|---|---|---|
| elevación relativa | z − plano de la ventana | m |
| pendiente | atan √(p²+q²) | ° |
| rugosidad | √{[Σ(zᵢ−z̄)² − 6h²(p²+q²)] / 9}: RMS del residuo del plano local, independiente de la pendiente | m |
| curvatura de perfil k_v | −(p²r + 2pqs + q²t) / [(p²+q²)(1+p²+q²)^{3/2}] | 1/km |
| curvatura de planta k_h | −(q²r − 2pqs + p²t) / [(p²+q²)(1+p²+q²)^{1/2}] | 1/km |
| curvatura media H | −[(1+q²)r − 2pqs + (1+p²)t] / [2(1+p²+q²)^{3/2}] | 1/km |
| relieve local | max − min en la vecindad 3×3 | m |

Convención: positivo = convexo / divergente. k_v y k_h no están definidas con gradiente nulo (NaN, contado).
Descriptivos de cada variable: media, desviación típica, percentiles 2-5-25-50-75-95-98, RIC y rango.

## 3. Estructura espacial

- **Semivariograma** γ(τ) = Σ m·m′(z′−z)² / 2N(τ), calculado por FFT con máscara (Marcotte 1996) sobre z sin
  plano, agrupado en distancias de media octava r_j = h·2^{j/2} ≤ L/2.
- **Exponente de Hurst**: ajuste ln γ = 2H ln r + c en r ≤ 4h (Shepard et al. 2001). **Sesgo medido**: en desfases de 1–4
  celdas, una superficie limitada en banda (todo MDE lo está) parece más suave y H se sobreestima. Con
  superficies fractales sintéticas: 0,3 → 0,48; 0,5 → 0,61; 0,8 → 0,81, sin depender del tamaño de la rejilla
  (`tests/test_motor.py`). H solo se usa como descriptor, nunca como criterio de ordenación.
- **Escala característica**: primera r con ρ(r) = 1 − γ(r)/σ² < 1/e. Si no se alcanza, el valor queda
  **censurado** (> L/2): en relieve autoafín esta escala crece con la ventana.
- **Anisotropía**: razón max/min de γ en las direcciones 0°, 45°, 90° y 135°. La orientación absoluta no se compara.
- **Distribución espacial de pendientes**: I de Moran con vecindad de reina sobre el campo de pendiente.
- **Tamaño muestral efectivo**: n_ef = n² / Σ_{|τ|<τ₀} N(τ)ρ(τ), truncado en el primer cero del correlograma
  (Bretherton et al. 1999). Los píxeles **no** se tratan como observaciones independientes.

## 4. Distancias entre una ventana objetivo A y una candidata B

| Criterio | Fórmula | Qué mide | Limitaciones |
|---|---|---|---|
| **Wasserstein-1** (elev. relativa, pendiente, rugosidad, k_v, k_h) | W₁ = ∫₀¹ \|F_A⁻¹(u) − F_B⁻¹(u)\| du | coste medio de transportar una distribución sobre la otra, **en las unidades de la variable** | depende de la escala de la variable; ignora la disposición espacial |
| **Kolmogorov–Smirnov** (univariante) | D = sup_x \|F_A(x) − F_B(x)\| | mayor diferencia entre funciones de distribución; adimensional | poco sensible a las colas; su p-valor supone independencia: se calcula con n_ef, no con n |
| **Energía** (bivariante k_v, k_h) | D² = 2E‖X−Y‖ − E‖X−X′‖ − E‖Y−Y′‖ | diferencia entre distribuciones conjuntas | solo se usa con variables de **la misma unidad** (1/km), para que la norma euclídea tenga sentido físico sin pesos. Se evalúa sobre una submalla regular (determinista) |
| **Variograma** | D_γ = √{mean_j [ln γ_A(r_j) − ln γ_B(r_j)]²} | factor típico e^{D_γ} entre las amplitudes de relieve en cada escala | por construcción, sensible también a la amplitud |
| **Moran de pendientes** | \|I_A − I_B\| | diferencia en el agrupamiento espacial de pendientes | un solo desfase (h) |

El cribado del catálogo calcula W₁ con M = 200 cuantiles de punto medio. Cota del error de discretización:
(rango_A + rango_B)/M; para los candidatos finales se informa además el W₁ exacto (SciPy).

## 5. Comparación multidimensional sin pesos

1. Vector de distancias d_B = (d₁, …, d_c) por criterio, cada una en sus unidades.
2. **Percentil** de cada distancia dentro del catálogo terrestre: p_ij = #{l : d_lj ≤ d_ij}/n. Es invariante a
   cualquier transformación monótona de cada distancia y **no requiere normalizar unidades**.
3. **Dominancia de Pareto**: B domina a C si d_B ≤ d_C en todos los criterios y < en alguno. Se informa cuántas
   ventanas dominan a cada candidato (0 = óptimo de Pareto).
4. **Orden leximax**: se ordena por el peor percentil, luego por el segundo peor, etc. Es compatible con
   Pareto (si B domina a C, B va antes). Única hipótesis: los criterios se tratan por igual **en espacio de
   rangos**. Se declara en cada resultado.
5. **No se calcula ningún porcentaje de similitud.** El resumen es «peor percentil = p»: en todos los
   criterios, la ventana está entre el p % de ventanas terrestres más próximas.
6. Supresión de solapes: no se devuelven dos candidatos con centros a menos de L.

## 6. Incertidumbre

- **Variabilidad intrínseca del objetivo**: distancias entre el objetivo y él mismo desplazado ±L/4 en cuatro
  direcciones. Si un candidato está más cerca que eso en un criterio, es indistinguible a esta escala.
- **p-valores KS** con n_ef (y el p-valor ingenuo con n, para mostrar la diferencia).
- **Bootstrap de bloques** (bloque ≥ escala de correlación) sobre los campos del objetivo: frecuencia con
  la que cada candidato sigue en el top-k.
- **Cobertura**: fracción de celdas válidas y, en la Luna y Marte, fracción con observación directa (LDEC/MEGC).
  SRTMGL30 no publica un mapa de observaciones: se informa como no disponible.

## 7. Validación (sobre la lista corta de candidatos, con orden leximax dentro de ella)

Resolución (h×2), ventana (L×0,75 y L×1,25), ruido vertical (σ = 1, 5 y 20 m), huecos (10 y 25 % en bloques),
normalización (distribuciones tipificadas: solo la forma), métrica (KS y energía en lugar de W₁) y referencia
vertical (Marte: areoide frente a esfera). Medidas: τ de Kendall y conservación del top-k.

## 8. Lo que este motor no afirma

- Que la región terrestre reproduzca las condiciones de la Luna o de Marte: gravedad, vacío, atmósfera,
  radiación, regolito y temperatura quedan fuera de la semejanza geomorfológica.
- Origen geológico común: un relieve parecido a escala h no implica el mismo proceso (impacto, volcanismo, erosión).
- Aptitud para una misión.
- Semejanza a escalas menores que h: con los productos globales, la escala más fina es ~1–4 km.

## 9. Resultados de validación observados (datos reales, 14-11-2026)

Pruebas sin datos terrestres (Luna↔Luna, Marte→Luna), con L = 200 km:

- **Identidad**: una ventana del catálogo se encuentra a sí misma en el primer puesto, con distancia 0 en todos
  los criterios y sin ninguna ventana que la domine.
- **Coherencia física**: un objetivo en Mare Tranquillitatis devuelve otros mares (Imbrium, Procellarum, Nubium).
- **Dependencia espacial**: en Jezero (MOLA), la elevación relativa tiene n_ef ≈ 20 sobre ~2700 celdas. El
  p-valor KS de pendientes es 0,98 usando n_ef, frente a 10⁻²³ con el número de píxeles.
- **Referencia vertical (Marte)**: pasar del areoide a la esfera mueve el objetivo 0,05° en W₁ de pendiente y
  1,8 m en elevación relativa. Es poco, pero alcanza para reordenar candidatos casi equivalentes.
- **Estabilidad**: el ruido vertical de hasta 5 m apenas cambia el orden (τ ≥ 0,9). En cambio, el **orden
  exacto del top-k es sensible** a h×2, L×0,75–1,25, huecos y normalización (τ de Kendall entre 0,3 y 0,7). Hay
  que leerlo como un conjunto de candidatos casi equivalentes, no como un podio exacto.

## 10. Comparación detallada de un par (`comparacion.py`, `POST /api/similitud/comparar`)

Se usa al pulsar un lugar terrestre en la web. Su objetivo es la máxima precisión **que permiten los datos**,
no una cifra única.

1. **Mejor MDE de cada lado** (`data_loader.mejor_raster`):
   - Luna: el producto polar de LOLA más fino que cubre toda la ventana; si no hay, LDEM_16.
   - Marte: MOLA MEGDR.
   - Tierra: NASADEM (1″) o SRTMGL3 (3″) si sus teselas están descargadas
     (`python -m similitud descargar-detalle`); si no, SRTMGL30.
2. **Escalas**: h₀ = espaciado del MDE más grueso de los dos; después 2h₀, 4h₀ y 8h₀, con el mismo lado L y
   entre 20 y 768 celdas por lado. Por debajo de h₀ no hay información común.
3. **Por escala y variable**:
   - W₁, KS y energía exactos sobre todas las celdas.
   - **Prueba de permutación por bloques**. Hipótesis nula: las dos regiones son trozos del mismo paisaje.
     Los bloques miden lo que el radio de autocorrelación positiva, y se hacen 499 permutaciones.
   - **Holm** dentro de cada escala (5 pruebas); se rechaza si p ≤ 0,05.
   - Veredicto **«no concluyente»** si alguna región tiene menos de 9 bloques independientes: no rechazar no
     equivale a demostrar la igualdad.
   - Se informa el W₁ «esperable por azar» (percentil 95 del nulo de permutación) y el error típico por bootstrap
     de bloques. **No** se da un IC percentil de W₁: con distribuciones parecidas está sesgado al alza (medido:
     W₁ = 108 m con IC «95 %» [123, 764] m).
4. **Estructura**: el variograma y la I de Moran se comparan con la diferencia entre el objetivo y él mismo
   desplazado ±L/4. **No es una prueba estadística**, y la web lo rotula «dentro/fuera de ref.».
5. **Comprobaciones con datos reales** (LOLA polar, 240 m, L = 100 km):
   - Shackleton frente a otras tierras altas polares: las 5 distribuciones son compatibles en las 4 escalas
     (p entre 0,17 y 0,97).
   - Shackleton frente a Mare Tranquillitatis: las 5 son distintas en todas las escalas (p de Holm = 0,01).
   - Pruebas sintéticas con un campo estacionario: el error de tipo I se mantiene cerca de α (≤ 1 rechazo de 6)
     y la potencia es alta ante un cambio de amplitud ×1,5 (≥ 5 de 6).
6. **Hurst > 1** a 240 m en LOLA polar indica una superficie más suave que cualquier fBm. Lo probable es que se
   deba a la interpolación del producto, aunque el mapa de conteos muestre celdas con disparos. Se informa tal cual.
