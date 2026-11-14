// ============================================================================
//  EMPLAZAMIENTOS, OBJETIVOS Y PUNTUACIÓN
//  Los valores 0-100 escritos aquí son ESTIMACIONES de demostración. Al puntuar, js/api.js
//  sustituye terreno, hielo, térmica y recursos por valores calculados con las capas reales
//  del PDS (js/capas.js). Solar, radiación, enlace y ciencia siguen siendo estimaciones.
// ============================================================================

export const METRICS = {
  solar:     { label: 'Iluminación solar',      short: 'Solar',     icon: '☀' },
  ice:       { label: 'Agua / hielo accesible', short: 'Hielo',     icon: '❄' },
  terrain:   { label: 'Seguridad del terreno',  short: 'Terreno',   icon: '⛰' },
  thermal:   { label: 'Estabilidad térmica',    short: 'Térmica',   icon: '🌡' },
  radiation: { label: 'Protección radiación',   short: 'Radiación', icon: '☢' },
  comms:     { label: 'Enlace con la Tierra',   short: 'Enlace',    icon: '📡' },
  science:   { label: 'Valor científico',       short: 'Ciencia',   icon: '🔬' },
  resources: { label: 'Recursos (ISRU)',        short: 'Recursos',  icon: '⛏' },
};

export const BODIES = {
  moon: {
    id: 'moon', name: 'La Luna', short: 'Luna',
    tagline: 'A 384.400 km · Viaje de ~3 días',
    distanceKm: 384400, travel: 'Tierra → Luna',
    radiusKm: 1737, gravity: '1,62 m/s²', day: '29,5 días terrestres',
    temp: '−173 °C / +127 °C',
    layers: ['LRO · LOLA (elevación, pendiente y rugosidad)', 'LRO · Diviner (temperatura de superficie)', 'Lunar Prospector (hidrógeno y FeO)'],
    blurb: 'Primer paso: base permanente cislunar.',
  },
  mars: {
    id: 'mars', name: 'Marte', short: 'Marte',
    tagline: 'A ~225 M km · Viaje de ~7 meses',
    distanceKm: 225000000, travel: 'Tierra → Marte',
    radiusKm: 3390, gravity: '3,71 m/s²', day: '24 h 37 min',
    temp: '−125 °C / +20 °C',
    layers: ['MGS · MOLA (elevación y pendiente)', 'MGS · TES (inercia térmica)', 'Odyssey · GRS (agua, Fe, Si, Cl, K, Th)'],
    blurb: 'El siguiente salto: asentamiento humano.',
  },
};

export const OBJECTIVES = {
  habitat: {
    id: 'habitat', name: 'Base habitable permanente', icon: '🏠',
    desc: 'Tripulación viviendo meses o años: agua, escudo contra radiación y temperaturas estables.',
    weights: { solar: .15, ice: .15, terrain: .18, thermal: .15, radiation: .17, comms: .10, science: .02, resources: .08 },
  },
  science: {
    id: 'science', name: 'Investigación científica', icon: '🔬',
    desc: 'Geología, astrobiología y astronomía: terrenos antiguos, diversidad de materiales y acceso a muestras.',
    weights: { solar: .07, ice: .12, terrain: .12, thermal: .08, radiation: .06, comms: .10, science: .35, resources: .10 },
  },
  isru: {
    id: 'isru', name: 'Minería y recursos (ISRU)', icon: '⛏',
    desc: 'Extraer agua, oxígeno y metales del terreno para producir combustible y materiales in situ.',
    weights: { solar: .10, ice: .27, terrain: .13, thermal: .06, radiation: .04, comms: .05, science: .05, resources: .30 },
  },
  energy: {
    id: 'energy', name: 'Energía solar continua', icon: '☀',
    desc: 'Granja solar con la máxima luz y noches mínimas, para alimentar toda la infraestructura.',
    weights: { solar: .45, ice: .05, terrain: .15, thermal: .15, radiation: .04, comms: .08, science: .04, resources: .04 },
  },
  outpost: {
    id: 'outpost', name: 'Puesto de logística y enlace', icon: '📡',
    desc: 'Nodo de comunicaciones y aterrizaje: contacto constante con la Tierra y terreno llano.',
    weights: { solar: .15, ice: .08, terrain: .22, thermal: .10, radiation: .05, comms: .30, science: .05, resources: .05 },
  },
};

export const DURATIONS = {
  short:     { id: 'short', name: '30 días',   mult: { radiation: .5, thermal: .7, ice: .7 } },
  long:      { id: 'long',  name: '6 meses',   mult: {} },
  permanent: { id: 'permanent', name: 'Permanente', mult: { radiation: 1.5, thermal: 1.2, ice: 1.3 } },
};

// ---------------------------------------------------------------------------
//  EMPLAZAMIENTOS CANDIDATOS
// ---------------------------------------------------------------------------
const S = (id, name, region, lat, lon, m, traits, desc, facts) => ({
  id, name, region, lat, lon, traits, desc, facts,
  metrics: { solar: m[0], ice: m[1], terrain: m[2], thermal: m[3], radiation: m[4], comms: m[5], science: m[6], resources: m[7] },
});

export const SITES = {
  moon: [
    S('shackleton', 'Borde del cráter Shackleton', 'Polo Sur', -89.9, 0,
      [78, 95, 55, 70, 55, 45, 80, 75], ['polar', 'ice', 'crater', 'rim', 'permashadow', 'cold'],
      'Picos de luz casi permanente en el borde, con suelos en sombra eterna a pocos kilómetros que atrapan hielo de agua.',
      [['Iluminación anual', '~86 %'], ['Suelo del cráter', '−170 °C'], ['Pendiente media', '~12°'], ['Hielo', 'Indicios fuertes']]),
    S('malapert', 'Macizo Malapert', 'Polo Sur', -85.9, 2.9,
      [80, 70, 62, 70, 50, 95, 60, 60], ['polar', 'highland', 'mountain', 'cold'],
      'Montaña con línea de visión casi continua a la Tierra y buena iluminación: ideal como nodo de comunicaciones.',
      [['Visibilidad de la Tierra', '~90 % del tiempo'], ['Iluminación', '~70 %'], ['Altura', '~5 km'], ['Hielo cercano', 'Moderado']]),
    S('connecting', 'Cresta Shackleton–de Gerlache', 'Polo Sur', -89.4, -111,
      [85, 85, 50, 72, 55, 40, 70, 65], ['polar', 'ice', 'ridge', 'permashadow', 'cold'],
      'Una cresta que une dos cráteres con luz solar casi ininterrumpida y sombras permanentes en ambos lados.',
      [['Iluminación', '~89 %'], ['Pendiente', '~15°'], ['Hielo', 'Probable'], ['Enlace Tierra', 'Rasante']]),
    S('cabeus', 'Cráter Cabeus', 'Polo Sur', -84.9, -35.5,
      [30, 98, 45, 50, 55, 50, 90, 78], ['polar', 'crater', 'ice', 'permashadow', 'cold'],
      'Lugar del impacto de LCROSS: la nube de eyección confirmó agua, amoníaco y otros volátiles.',
      [['Agua detectada', '~5 % masa'], ['Suelo', '−240 °C'], ['Iluminación', '< 30 %'], ['Pendiente', '~10°']]),
    S('peary', 'Cráter Peary', 'Polo Norte', 88.6, 33,
      [70, 80, 58, 65, 52, 55, 70, 60], ['polar', 'crater', 'ice', 'cold'],
      'Equivalente boreal de Shackleton, con zonas de sombra permanente y picos de luz en el borde.',
      [['Iluminación', '~72 %'], ['Hielo', 'Probable'], ['Diámetro', '~73 km'], ['Pendiente', '~11°']]),
    S('tranquillitatis', 'Pozo de Mare Tranquillitatis', 'Ecuador · Cara visible', 8.34, 33.2,
      [55, 20, 40, 90, 92, 85, 85, 70], ['lava_tube', 'basalt', 'plains', 'pit'],
      'Un pozo de ~100 m que da acceso a un posible tubo de lava: protección natural contra radiación y micrometeoritos.',
      [['Temp. interior', '~ −20 °C constante'], ['Profundidad', '~100 m'], ['Radiación', 'Muy reducida'], ['Noche lunar', '14 días']]),
    S('marius', 'Tragaluz de Marius Hills', 'Oceanus Procellarum', 14.1, -56.8,
      [55, 15, 45, 88, 90, 70, 88, 72], ['lava_tube', 'basalt', 'volcanic', 'pit'],
      'Complejo volcánico con tragaluces confirmados hacia tubos de lava de kilómetros de largo.',
      [['Tubo de lava', 'Probable > 1 km'], ['Temp. interior', '~ −20 °C'], ['Radiación', 'Muy reducida'], ['Valor científico', 'Alto']]),
    S('aristarchus', 'Meseta de Aristarco', 'Oceanus Procellarum', 23.7, -47.4,
      [52, 10, 35, 40, 40, 70, 95, 85], ['crater', 'volcanic', 'mineral', 'highland'],
      'Depósitos piroclásticos y rocas de múltiples edades: un libro abierto de la historia volcánica lunar.',
      [['Materiales', 'Piroclastos, KREEP'], ['Pendiente', '~20°'], ['Hielo', 'Ninguno'], ['Interés', 'Máximo']]),
    S('schrodinger', 'Cuenca Schrödinger', 'Cara oculta', -75, 132.4,
      [60, 55, 55, 55, 50, 10, 92, 70], ['crater', 'basin', 'highland', 'cold', 'isolation'],
      'Cuenca de impacto muy bien conservada, con material del manto expuesto. Requiere satélite de enlace.',
      [['Enlace Tierra', 'Solo vía relé'], ['Diámetro', '~320 km'], ['Antigüedad', '~3.800 M años'], ['Hielo', 'Posible']]),
    S('taurus', 'Taurus-Littrow', 'Mare Serenitatis', 20.2, 30.8,
      [52, 5, 85, 45, 40, 90, 85, 75], ['basalt', 'plains', 'mineral', 'mountain'],
      'Valle del Apolo 17: terreno llano y seguro con basaltos ricos en ilmenita (oxígeno y titanio).',
      [['Ilmenita', 'Alta'], ['Pendiente', '< 5°'], ['Enlace Tierra', 'Continuo'], ['Hielo', 'Ninguno']]),
    S('sinus', 'Planicie de Sinus Medii', 'Ecuador · Centro', 0.4, 1.4,
      [50, 5, 92, 40, 38, 98, 40, 50], ['plains', 'basalt', 'dust'],
      'La llanura más suave y centrada de la Luna: perfecta para aterrizar a menudo, poco más.',
      [['Pendiente', '< 3°'], ['Enlace Tierra', '100 %'], ['Hielo', 'Ninguno'], ['Interés científico', 'Bajo']]),
  ],

  mars: [
    S('jezero', 'Cráter Jezero', 'Isidis Planitia', 18.4, 77.7,
      [62, 20, 50, 55, 45, 70, 98, 70], ['crater', 'delta', 'mineral', 'plains'],
      'Antiguo lago con un delta fluvial perfectamente conservado: el mejor lugar para buscar vida pasada.',
      [['Delta', '~40 km'], ['Carbonatos', 'Detectados'], ['Pendiente', '~8°'], ['Rover', 'Perseverance']]),
    S('gale', 'Cráter Gale', 'Ecuador', -5.4, 137.8,
      [65, 25, 55, 55, 48, 70, 95, 72], ['crater', 'mountain', 'mineral', 'dust'],
      'Un monte de 5 km de capas sedimentarias en el centro del cráter registra miles de millones de años.',
      [['Monte Sharp', '~5 km'], ['Arcillas', 'Detectadas'], ['Pendiente', '~10°'], ['Rover', 'Curiosity']]),
    S('arcadia', 'Arcadia Planitia', 'Latitudes medias N', 47.2, -176,
      [45, 90, 88, 40, 40, 60, 55, 70], ['plains', 'ice', 'cold'],
      'Llanura lisa con hielo de agua a pocos centímetros bajo la superficie: agua para beber y producir combustible.',
      [['Hielo', 'A ~1 m'], ['Pendiente', '< 3°'], ['Temp. media', '−70 °C'], ['Luz solar', 'Estacional']]),
    S('utopia', 'Utopia Planitia', 'Latitudes medias N', 46, 118,
      [45, 88, 90, 42, 40, 65, 50, 65], ['plains', 'ice', 'cold'],
      'La mayor cuenca marciana: terreno muy llano sobre un enorme volumen de hielo subsuperficial.',
      [['Hielo', 'Enorme reserva'], ['Pendiente', '< 3°'], ['Aterrizaje', 'Muy seguro'], ['Luz solar', 'Estacional']]),
    S('deuteronilus', 'Deuteronilus Mensae', 'Frontera dicotomía', 44, 24,
      [45, 92, 55, 40, 40, 60, 78, 72], ['ice', 'cold', 'mountain', 'plains'],
      'Glaciares cubiertos de polvo con hielo casi puro, junto a mesetas rocosas para extraer materiales.',
      [['Hielo', 'Glaciares casi puros'], ['Pendiente', '~12°'], ['Temp. media', '−65 °C'], ['Luz solar', 'Estacional']]),
    S('hellas', 'Cuenca Hellas', 'Hemisferio Sur', -42.4, 70.5,
      [60, 40, 70, 62, 62, 60, 75, 60], ['crater', 'basin', 'dust', 'plains'],
      'La zona más baja de Marte: 7 km bajo la referencia, con más presión y mejor protección frente a la radiación.',
      [['Profundidad', '~7 km'], ['Presión', '~1,2 kPa'], ['Radiación', '−15 %'], ['Tormentas polvo', 'Frecuentes']]),
    S('arsia', 'Tubos de lava de Arsia Mons', 'Tharsis', -8.3, -120.1,
      [65, 35, 35, 88, 92, 55, 90, 62], ['lava_tube', 'volcanic', 'basalt', 'mountain', 'pit'],
      'Pozos oscuros en las faldas del volcán que podrían dar acceso a tubos de lava: refugio natural.',
      [['Tubo de lava', 'Candidato'], ['Temp. interior', 'Estable'], ['Radiación', 'Muy reducida'], ['Altura', '~ +9 km']]),
    S('melas', 'Melas Chasma', 'Valles Marineris', -9.8, -75,
      [60, 45, 40, 62, 70, 55, 92, 85], ['canyon', 'mineral', 'dust'],
      'Un cañón gigantesco con sulfatos hidratados y capas expuestas de la historia del agua marciana.',
      [['Sulfatos', 'Abundantes'], ['Profundidad', '~9 km'], ['Pendiente', '~15°'], ['Radiación', '−20 %']]),
    S('elysium', 'Elysium Planitia', 'Ecuador', 4.5, 135.9,
      [80, 35, 95, 65, 40, 78, 62, 55], ['plains', 'basalt', 'volcanic', 'dust'],
      'Llanura ecuatorial, plana y soleada: sitio del InSight. Ideal para energía solar y aterrizajes.',
      [['Pendiente', '< 2°'], ['Luz solar', 'Alta'], ['Hielo', 'Profundo'], ['Sismología', 'InSight']]),
    S('meridiani', 'Meridiani Planum', 'Ecuador', -1.9, -5,
      [80, 25, 95, 62, 42, 85, 85, 75], ['plains', 'mineral', 'dust'],
      'Terreno extraordinariamente llano y rico en hematita: recursos y seguridad de aterrizaje.',
      [['Pendiente', '< 2°'], ['Hematita', 'Abundante'], ['Luz solar', 'Alta'], ['Rover', 'Opportunity']]),
  ],
};

// ---------------------------------------------------------------------------
//  ANÁLOGOS TERRESTRES PARA ENTRENAMIENTO
// ---------------------------------------------------------------------------
export const ANALOGS = [
  {
    id: 'devon', name: 'Isla Devon · Haughton-Mars', country: 'Nunavut, Canadá', lat: 75.4, lon: -89.7,
    traits: ['polar', 'cold', 'crater', 'ice', 'plains', 'isolation', 'permashadow'],
    desc: 'Desierto polar frío dentro de un cráter de impacto de 23 km. Sede del Haughton-Mars Project, usado por NASA para simular misiones lunares y marcianas.',
    activities: ['Actividades extravehiculares (EVA) en frío extremo', 'Uso de rovers presurizados', 'Perforación de permafrost y hielo', 'Operaciones con retardo de comunicaciones'],
    season: 'Jul – Ago', access: 'Vuelo chárter desde Resolute Bay',
  },
  {
    id: 'concordia', name: 'Base Concordia', country: 'Antártida', lat: -75.1, lon: 123.3,
    traits: ['polar', 'cold', 'ice', 'isolation', 'permashadow', 'plains'],
    desc: 'Base científica a 3.200 m de altitud, aislada 9 meses al año. Referente de la ESA para estudiar el comportamiento de tripulaciones en aislamiento.',
    activities: ['Aislamiento prolongado y psicología de equipos', 'Operaciones durante noche polar', 'Gestión de agua y energía', 'Telemedicina con retardo'],
    season: 'Invernada (Feb – Nov)', access: 'Programa ESA / IPEV / PNRA',
  },
  {
    id: 'svalbard', name: 'Svalbard', country: 'Noruega', lat: 78.2, lon: 15.6,
    traits: ['polar', 'ice', 'cold', 'mountain', 'isolation', 'permashadow'],
    desc: 'Glaciares, noche polar y terreno rocoso a 78°N. Ideal para entrenar movilidad sobre hielo y geología en sombra.',
    activities: ['Movilidad sobre glaciares', 'Operaciones en oscuridad', 'Toma de muestras de hielo', 'Supervivencia polar'],
    season: 'Nov – Ene (noche polar)', access: 'Vuelo regular a Longyearbyen',
  },
  {
    id: 'hawaii', name: 'Mauna Loa · HI-SEAS', country: 'Hawái, EE. UU.', lat: 19.6, lon: -155.5,
    traits: ['volcanic', 'basalt', 'dust', 'lava_tube', 'mountain', 'isolation', 'pit'],
    desc: 'Campos de lava basáltica a 2.500 m que simulan suelo lunar y marciano. Incluye un hábitat de simulación con tripulaciones aisladas.',
    activities: ['Simulación de hábitat con tripulación', 'Exploración de tubos de lava', 'Manejo de regolito basáltico', 'Pruebas de ISRU'],
    season: 'Todo el año', access: 'Vuelo a Hilo + 1 h por carretera',
  },
  {
    id: 'lanzarote', name: 'Lanzarote · Tubos volcánicos', country: 'Canarias, España', lat: 29.0, lon: -13.6,
    traits: ['lava_tube', 'volcanic', 'basalt', 'arid', 'pit'],
    desc: 'Cuevas volcánicas como la Cueva de los Verdes, utilizadas en entrenamientos de astronautas de la ESA para explorar cavidades subterráneas.',
    activities: ['Exploración y cartografía de cuevas', 'Descenso por pozos y tragaluces', 'Navegación sin GPS', 'Búsqueda de vida en cuevas'],
    season: 'Todo el año', access: 'Vuelo directo desde Europa',
  },
  {
    id: 'teide', name: 'Teide · Las Cañadas', country: 'Tenerife, España', lat: 28.27, lon: -16.64,
    traits: ['volcanic', 'basalt', 'dust', 'highland', 'mountain', 'mineral'],
    desc: 'Volcán de 3.700 m con suelos áridos y rocas similares a las lunares; usado en pruebas de rovers y herramientas.',
    activities: ['Pruebas de rovers y vehículos', 'Geología de campo', 'Altitud y rendimiento físico', 'Manejo de polvo abrasivo'],
    season: 'Abr – Oct', access: 'Aeropuerto Tenerife Sur',
  },
  {
    id: 'iceland', name: 'Askja · Islandia', country: 'Islandia', lat: 65.0, lon: -16.7,
    traits: ['volcanic', 'basalt', 'ice', 'cold', 'highland', 'mountain', 'crater'],
    desc: 'Caldera volcánica donde entrenaron los astronautas del Apolo en los años 60. Paisaje lunar real de cenizas y lava.',
    activities: ['Geología de campo lunar', 'Caminata sobre terreno volcánico', 'Toma de muestras', 'Navegación en terreno abierto'],
    season: 'Jul – Sep', access: 'Reikiavik + 4×4 de altura',
  },
  {
    id: 'meteor', name: 'Meteor Crater', country: 'Arizona, EE. UU.', lat: 35.03, lon: -111.02,
    traits: ['crater', 'rim', 'arid', 'plains', 'basin'],
    desc: 'Cráter de impacto de 1,2 km, el mejor conservado de la Tierra. Lugar clásico de formación de astronautas del programa Apolo.',
    activities: ['Geología de impactos', 'Descenso y ascenso por paredes', 'Cartografía de eyecciones', 'Operación de instrumentos'],
    season: 'Oct – Abr', access: 'A 1 h de Flagstaff',
  },
  {
    id: 'mdrs', name: 'Mars Desert Research Station', country: 'Utah, EE. UU.', lat: 38.4, lon: -110.8,
    traits: ['arid', 'mineral', 'canyon', 'dust', 'plains', 'isolation', 'delta'],
    desc: 'Hábitat de simulación marciana en un desierto rojizo de arenisca y arcillas. Rotaciones de dos semanas con EVA reales.',
    activities: ['Misiones simuladas de 14 días', 'EVA con trajes de simulación', 'Geología sedimentaria', 'Vida en hábitat cerrado'],
    season: 'Oct – Abr', access: 'A 2 h de Green River / Moab',
  },
  {
    id: 'atacama', name: 'Desierto de Atacama', country: 'Chile', lat: -24.5, lon: -69.25,
    traits: ['arid', 'dust', 'mineral', 'plains', 'highland', 'delta'],
    desc: 'El lugar más árido de la Tierra, con suelos casi estériles. Aquí se prueban rovers y técnicas de detección de vida para Marte.',
    activities: ['Pruebas de rovers autónomos', 'Detección de biomarcadores', 'Supervivencia en aridez extrema', 'Protección contra UV'],
    season: 'Todo el año', access: 'Aeropuerto de Calama',
  },
  {
    id: 'riotinto', name: 'Río Tinto', country: 'Huelva, España', lat: 37.7, lon: -6.55,
    traits: ['mineral', 'canyon', 'delta', 'arid'],
    desc: 'Río ácido rico en hierro y sulfatos, con microorganismos extremófilos. Análogo mineralógico de Meridiani y Melas Chasma.',
    activities: ['Mineralogía y sulfatos', 'Búsqueda de extremófilos', 'Muestreo geoquímico', 'Pruebas de instrumentos'],
    season: 'Todo el año', access: 'A 1 h de Sevilla',
  },
  {
    id: 'tabernas', name: 'Desierto de Tabernas', country: 'Almería, España', lat: 37.0, lon: -2.4,
    traits: ['arid', 'canyon', 'delta', 'mineral', 'plains'],
    desc: 'Único desierto de Europa, con cañones y antiguos deltas fluviales sedimentarios, similares a los de Jezero.',
    activities: ['Geología de deltas', 'Pruebas de rovers', 'Cartografía de estratos', 'Operaciones remotas'],
    season: 'Oct – May', access: 'A 30 min de Almería',
  },
];

// ---------------------------------------------------------------------------
//  Lógica de puntuación (se usará también como respaldo si no hay API)
// ---------------------------------------------------------------------------
export function effectiveWeights(objectiveId, params) {
  const base = { ...OBJECTIVES[objectiveId].weights };
  const dur = DURATIONS[params.duration]?.mult ?? {};
  for (const [k, v] of Object.entries(dur)) base[k] *= v;
  if (params.crew >= 8) { base.terrain *= 1.3; base.ice *= 1.2; }
  const total = Object.values(base).reduce((a, b) => a + b, 0);
  for (const k of Object.keys(base)) base[k] /= total;
  return base;
}

// `medidas` (opcional) viene de capas.js → medirSitios: { [id]: { medidas, metricas: { terrain: { v, de }, … } } }
export function scoreSites(bodyId, objectiveId, params, medidas = {}) {
  const w = effectiveWeights(objectiveId, params);
  return SITES[bodyId]
    .map((s0) => {
      const med = medidas[s0.id], real = {};
      for (const [k, r] of Object.entries(med?.metricas ?? {})) {
        // La temperatura de superficie no describe el interior de un tubo de lava: ahí se mantiene la estimación
        if (k === 'thermal' && s0.traits.includes('lava_tube')) continue;
        real[k] = r;
      }
      const s = { ...s0, metrics: { ...s0.metrics, ...Object.fromEntries(Object.entries(real).map(([k, r]) => [k, r.v])) },
        real: Object.fromEntries(Object.entries(real).map(([k, r]) => [k, r.de])), medidas: med?.medidas ?? [] };
      const contrib = Object.fromEntries(Object.keys(w).map((k) => [k, s.metrics[k] * w[k]]));
      const score = Math.round(Object.values(contrib).reduce((a, b) => a + b, 0));
      return { ...s, score, weights: w, contrib, ...prosCons(s) };
    })
    .sort((a, b) => b.score - a.score)
    .map((s, i) => ({ ...s, rank: i + 1 }));
}

const PRO = {
  solar: 'Excelente iluminación solar', ice: 'Hielo de agua accesible', terrain: 'Terreno llano y seguro para aterrizar',
  thermal: 'Temperaturas estables', radiation: 'Gran protección contra la radiación', comms: 'Enlace directo con la Tierra',
  science: 'Altísimo valor científico', resources: 'Recursos minerales abundantes',
};
const CON = {
  solar: 'Largas noches: requiere almacenamiento de energía', ice: 'Sin agua cercana: dependencia de suministro',
  terrain: 'Terreno accidentado: aterrizaje arriesgado', thermal: 'Fuertes oscilaciones térmicas',
  radiation: 'Poca protección natural contra la radiación', comms: 'Enlace débil: necesita satélite de relé',
  science: 'Interés científico limitado', resources: 'Pocos recursos locales aprovechables',
};
function prosCons(s) {
  const e = Object.entries(s.metrics).sort((a, b) => b[1] - a[1]);
  return {
    pros: e.filter(([, v]) => v >= 70).slice(0, 3).map(([k]) => PRO[k]),
    cons: e.filter(([, v]) => v < 50).slice(-3).reverse().map(([k]) => CON[k]),
  };
}

export function rankAnalogs(site, limit = 4) {
  const st = new Set(site.traits);
  return ANALOGS.map((a) => {
    const at = new Set(a.traits);
    const shared = [...st].filter((t) => at.has(t));
    const union = new Set([...st, ...at]).size;
    const raw = 0.7 * (shared.length / st.size) + 0.3 * (shared.length / union);
    return { ...a, shared, match: Math.min(98, Math.round(raw * 100)) };
  }).sort((a, b) => b.match - a.match).slice(0, limit);
}

export const TRAIT_LABELS = {
  polar: 'Latitud polar', ice: 'Hielo', crater: 'Cráter de impacto', rim: 'Borde de cráter', permashadow: 'Sombra permanente / noche polar',
  cold: 'Frío extremo', lava_tube: 'Tubos de lava', basalt: 'Suelo basáltico', highland: 'Altiplano', dust: 'Polvo fino',
  volcanic: 'Terreno volcánico', mineral: 'Mineralogía', canyon: 'Cañones', plains: 'Llanuras', delta: 'Delta / sedimentos',
  mountain: 'Montaña', isolation: 'Aislamiento', arid: 'Aridez extrema', basin: 'Cuenca', pit: 'Pozos / tragaluces', ridge: 'Cresta',
};
