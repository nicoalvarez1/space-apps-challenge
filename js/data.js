// ============================================================================
//  EMPLAZAMIENTOS, OBJETIVOS Y PUNTUACIÓN
//  Los valores 0-100 escritos aquí son ESTIMACIONES de demostración. Al puntuar, js/api.js
//  sustituye terreno, hielo, térmica y recursos por valores calculados con las capas reales
//  del PDS (js/capas.js). Solar, radiación, enlace y ciencia siguen siendo estimaciones.
// ============================================================================

export const METRICS = {
  solar:     { label: 'Solar illumination',     short: 'Solar',     icon: '☀' },
  ice:       { label: 'Accessible water / ice', short: 'Ice',     icon: '❄' },
  terrain:   { label: 'Terrain safety',         short: 'Terrain',   icon: '⛰' },
  thermal:   { label: 'Thermal stability',      short: 'Thermal',   icon: '🌡' },
  radiation: { label: 'Radiation protection',   short: 'Radiation', icon: '☢' },
  comms:     { label: 'Link with Earth',        short: 'Link',    icon: '📡' },
  science:   { label: 'Science value',          short: 'Science',   icon: '🔬' },
  resources: { label: 'Resources (ISRU)',       short: 'Resources',  icon: '⛏' },
};

export const BODIES = {
  moon: {
    id: 'moon', name: 'The Moon', short: 'Moon',
    tagline: '384,400 km away · ~3-day trip',
    distanceKm: 384400, travel: 'Earth → Moon',
    radiusKm: 1737, gravity: '1.62 m/s²', day: '29.5 Earth days',
    temp: '−173 °C / +127 °C',
    layers: ['LRO · LOLA (elevation, slope and roughness)', 'LRO · Diviner (surface temperature)', 'Lunar Prospector (hydrogen and FeO)'],
    blurb: 'First step: a permanent cislunar base.',
  },
  mars: {
    id: 'mars', name: 'Mars', short: 'Mars',
    tagline: '~225 M km away · ~7-month trip',
    distanceKm: 225000000, travel: 'Earth → Mars',
    radiusKm: 3390, gravity: '3.71 m/s²', day: '24 h 37 min',
    temp: '−125 °C / +20 °C',
    layers: ['MGS · MOLA (elevation and slope)', 'MGS · TES (thermal inertia)', 'Odyssey · GRS (water, Fe, Si, Cl, K, Th)'],
    blurb: 'The next leap: human settlement.',
  },
};

export const OBJECTIVES = {
  habitat: {
    id: 'habitat', name: 'Permanent habitable base', icon: '🏠',
    desc: 'A crew living there for months or years: water, radiation shielding and stable temperatures.',
    weights: { solar: .15, ice: .15, terrain: .18, thermal: .15, radiation: .17, comms: .10, science: .02, resources: .08 },
  },
  science: {
    id: 'science', name: 'Scientific research', icon: '🔬',
    desc: 'Geology, astrobiology and astronomy: ancient terrain, diverse materials and access to samples.',
    weights: { solar: .07, ice: .12, terrain: .12, thermal: .08, radiation: .06, comms: .10, science: .35, resources: .10 },
  },
  isru: {
    id: 'isru', name: 'Mining and resources (ISRU)', icon: '⛏',
    desc: 'Extract water, oxygen and metals from the ground to produce propellant and materials in situ.',
    weights: { solar: .10, ice: .27, terrain: .13, thermal: .06, radiation: .04, comms: .05, science: .05, resources: .30 },
  },
  energy: {
    id: 'energy', name: 'Continuous solar power', icon: '☀',
    desc: 'A solar farm with maximum light and minimal nights, to power all the infrastructure.',
    weights: { solar: .45, ice: .05, terrain: .15, thermal: .15, radiation: .04, comms: .08, science: .04, resources: .04 },
  },
  outpost: {
    id: 'outpost', name: 'Logistics and relay outpost', icon: '📡',
    desc: 'Communications and landing hub: constant contact with Earth and flat terrain.',
    weights: { solar: .15, ice: .08, terrain: .22, thermal: .10, radiation: .05, comms: .30, science: .05, resources: .05 },
  },
};

export const DURATIONS = {
  short:     { id: 'short', name: '30 days',   mult: { radiation: .5, thermal: .7, ice: .7 } },
  long:      { id: 'long',  name: '6 months',   mult: {} },
  permanent: { id: 'permanent', name: 'Permanent', mult: { radiation: 1.5, thermal: 1.2, ice: 1.3 } },
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
    S('shackleton', 'Shackleton crater rim', 'South Pole', -89.9, 0,
      [78, 95, 55, 70, 55, 45, 80, 75], ['polar', 'ice', 'crater', 'rim', 'permashadow', 'cold'],
      'Peaks of near-permanent light on the rim, with permanently shadowed floors a few kilometers away that trap water ice.',
      [['Annual illumination', '~86 %'], ['Crater floor', '−170 °C'], ['Mean slope', '~12°'], ['Ice', 'Strong evidence']]),
    S('malapert', 'Malapert massif', 'South Pole', -85.9, 2.9,
      [80, 70, 62, 70, 50, 95, 60, 60], ['polar', 'highland', 'mountain', 'cold'],
      'A mountain with a nearly continuous line of sight to Earth and good illumination: ideal as a communications hub.',
      [['Earth visibility', '~90 % of the time'], ['Illumination', '~70 %'], ['Height', '~5 km'], ['Nearby ice', 'Moderate']]),
    S('connecting', 'Shackleton–de Gerlache ridge', 'South Pole', -89.4, -111,
      [85, 85, 50, 72, 55, 40, 70, 65], ['polar', 'ice', 'ridge', 'permashadow', 'cold'],
      'A ridge linking two craters, with almost uninterrupted sunlight and permanent shadows on both sides.',
      [['Illumination', '~89 %'], ['Slope', '~15°'], ['Ice', 'Probable'], ['Earth link', 'Grazing']]),
    S('cabeus', 'Cabeus crater', 'South Pole', -84.9, -35.5,
      [30, 98, 45, 50, 55, 50, 90, 78], ['polar', 'crater', 'ice', 'permashadow', 'cold'],
      'LCROSS impact site: the ejecta plume confirmed water, ammonia and other volatiles.',
      [['Water detected', '~5 % by mass'], ['Floor', '−240 °C'], ['Illumination', '< 30 %'], ['Slope', '~10°']]),
    S('peary', 'Peary crater', 'North Pole', 88.6, 33,
      [70, 80, 58, 65, 52, 55, 70, 60], ['polar', 'crater', 'ice', 'cold'],
      'The northern counterpart of Shackleton, with permanently shadowed areas and peaks of light on the rim.',
      [['Illumination', '~72 %'], ['Ice', 'Probable'], ['Diameter', '~73 km'], ['Slope', '~11°']]),
    S('tranquillitatis', 'Mare Tranquillitatis pit', 'Equator · Near side', 8.34, 33.2,
      [55, 20, 40, 90, 92, 85, 85, 70], ['lava_tube', 'basalt', 'plains', 'pit'],
      'A ~100 m pit that gives access to a possible lava tube: natural protection against radiation and micrometeorites.',
      [['Interior temp.', '~ −20 °C, constant'], ['Depth', '~100 m'], ['Radiation', 'Greatly reduced'], ['Lunar night', '14 days']]),
    S('marius', 'Marius Hills skylight', 'Oceanus Procellarum', 14.1, -56.8,
      [55, 15, 45, 88, 90, 70, 88, 72], ['lava_tube', 'basalt', 'volcanic', 'pit'],
      'A volcanic complex with confirmed skylights into lava tubes kilometers long.',
      [['Lava tube', 'Probably > 1 km'], ['Interior temp.', '~ −20 °C'], ['Radiation', 'Greatly reduced'], ['Science value', 'High']]),
    S('aristarchus', 'Aristarchus plateau', 'Oceanus Procellarum', 23.7, -47.4,
      [52, 10, 35, 40, 40, 70, 95, 85], ['crater', 'volcanic', 'mineral', 'highland'],
      'Pyroclastic deposits and rocks of many ages: an open book of lunar volcanic history.',
      [['Materials', 'Pyroclastics, KREEP'], ['Slope', '~20°'], ['Ice', 'None'], ['Interest', 'Highest']]),
    S('schrodinger', 'Schrödinger basin', 'Far side', -75, 132.4,
      [60, 55, 55, 55, 50, 10, 92, 70], ['crater', 'basin', 'highland', 'cold', 'isolation'],
      'A very well-preserved impact basin with exposed mantle material. Requires a relay satellite.',
      [['Earth link', 'Relay only'], ['Diameter', '~320 km'], ['Age', '~3,800 Myr'], ['Ice', 'Possible']]),
    S('taurus', 'Taurus-Littrow', 'Mare Serenitatis', 20.2, 30.8,
      [52, 5, 85, 45, 40, 90, 85, 75], ['basalt', 'plains', 'mineral', 'mountain'],
      'Apollo 17 valley: flat, safe terrain with ilmenite-rich basalts (oxygen and titanium).',
      [['Ilmenite', 'High'], ['Slope', '< 5°'], ['Earth link', 'Continuous'], ['Ice', 'None']]),
    S('sinus', 'Sinus Medii plain', 'Equator · Center', 0.4, 1.4,
      [50, 5, 92, 40, 38, 98, 40, 50], ['plains', 'basalt', 'dust'],
      'The smoothest and most central plain on the Moon: perfect for frequent landings, little else.',
      [['Slope', '< 3°'], ['Earth link', '100 %'], ['Ice', 'None'], ['Scientific interest', 'Low']]),
  ],

  mars: [
    S('jezero', 'Jezero crater', 'Isidis Planitia', 18.4, 77.7,
      [62, 20, 50, 55, 45, 70, 98, 70], ['crater', 'delta', 'mineral', 'plains'],
      'An ancient lake with a perfectly preserved river delta: the best place to search for past life.',
      [['Delta', '~40 km'], ['Carbonates', 'Detected'], ['Slope', '~8°'], ['Rover', 'Perseverance']]),
    S('gale', 'Gale crater', 'Equator', -5.4, 137.8,
      [65, 25, 55, 55, 48, 70, 95, 72], ['crater', 'mountain', 'mineral', 'dust'],
      'A 5 km mountain of sedimentary layers in the center of the crater records billions of years.',
      [['Mount Sharp', '~5 km'], ['Clays', 'Detected'], ['Slope', '~10°'], ['Rover', 'Curiosity']]),
    S('arcadia', 'Arcadia Planitia', 'Northern mid-latitudes', 47.2, -176,
      [45, 90, 88, 40, 40, 60, 55, 70], ['plains', 'ice', 'cold'],
      'A smooth plain with water ice a few centimeters below the surface: water for drinking and for producing propellant.',
      [['Ice', 'At ~1 m'], ['Slope', '< 3°'], ['Mean temp.', '−70 °C'], ['Sunlight', 'Seasonal']]),
    S('utopia', 'Utopia Planitia', 'Northern mid-latitudes', 46, 118,
      [45, 88, 90, 42, 40, 65, 50, 65], ['plains', 'ice', 'cold'],
      'The largest Martian basin: very flat terrain over a huge volume of subsurface ice.',
      [['Ice', 'Huge reserve'], ['Slope', '< 3°'], ['Landing', 'Very safe'], ['Sunlight', 'Seasonal']]),
    S('deuteronilus', 'Deuteronilus Mensae', 'Dichotomy boundary', 44, 24,
      [45, 92, 55, 40, 40, 60, 78, 72], ['ice', 'cold', 'mountain', 'plains'],
      'Dust-covered glaciers of nearly pure ice, next to rocky mesas for extracting materials.',
      [['Ice', 'Nearly pure glaciers'], ['Slope', '~12°'], ['Mean temp.', '−65 °C'], ['Sunlight', 'Seasonal']]),
    S('hellas', 'Hellas basin', 'Southern Hemisphere', -42.4, 70.5,
      [60, 40, 70, 62, 62, 60, 75, 60], ['crater', 'basin', 'dust', 'plains'],
      'The lowest region on Mars: 7 km below the datum, with higher pressure and better protection from radiation.',
      [['Depth', '~7 km'], ['Pressure', '~1.2 kPa'], ['Radiation', '−15 %'], ['Dust storms', 'Frequent']]),
    S('arsia', 'Arsia Mons lava tubes', 'Tharsis', -8.3, -120.1,
      [65, 35, 35, 88, 92, 55, 90, 62], ['lava_tube', 'volcanic', 'basalt', 'mountain', 'pit'],
      'Dark pits on the flanks of the volcano that could give access to lava tubes: a natural shelter.',
      [['Lava tube', 'Candidate'], ['Interior temp.', 'Stable'], ['Radiation', 'Greatly reduced'], ['Height', '~ +9 km']]),
    S('melas', 'Melas Chasma', 'Valles Marineris', -9.8, -75,
      [60, 45, 40, 62, 70, 55, 92, 85], ['canyon', 'mineral', 'dust'],
      'A gigantic canyon with hydrated sulfates and exposed layers recording the history of water on Mars.',
      [['Sulfates', 'Abundant'], ['Depth', '~9 km'], ['Slope', '~15°'], ['Radiation', '−20 %']]),
    S('elysium', 'Elysium Planitia', 'Equator', 4.5, 135.9,
      [80, 35, 95, 65, 40, 78, 62, 55], ['plains', 'basalt', 'volcanic', 'dust'],
      'A flat, sunny equatorial plain: the InSight landing site. Ideal for solar power and landings.',
      [['Slope', '< 2°'], ['Sunlight', 'High'], ['Ice', 'Deep'], ['Seismology', 'InSight']]),
    S('meridiani', 'Meridiani Planum', 'Equator', -1.9, -5,
      [80, 25, 95, 62, 42, 85, 85, 75], ['plains', 'mineral', 'dust'],
      'Exceptionally flat, hematite-rich terrain: resources and landing safety.',
      [['Slope', '< 2°'], ['Hematite', 'Abundant'], ['Sunlight', 'High'], ['Rover', 'Opportunity']]),
  ],
};

// ---------------------------------------------------------------------------
//  ANÁLOGOS TERRESTRES PARA ENTRENAMIENTO
// ---------------------------------------------------------------------------
export const ANALOGS = [
  {
    id: 'devon', name: 'Devon Island · Haughton-Mars', country: 'Nunavut, Canada', lat: 75.4, lon: -89.7,
    traits: ['polar', 'cold', 'crater', 'ice', 'plains', 'isolation', 'permashadow'],
    desc: 'A cold polar desert inside a 23 km impact crater. Home of the Haughton-Mars Project, used by NASA to simulate lunar and Martian missions.',
    activities: ['Extravehicular activities (EVA) in extreme cold', 'Pressurized rover operations', 'Drilling into permafrost and ice', 'Operations with communication delay'],
    season: 'Jul – Aug', access: 'Charter flight from Resolute Bay',
  },
  {
    id: 'concordia', name: 'Concordia Station', country: 'Antarctica', lat: -75.1, lon: 123.3,
    traits: ['polar', 'cold', 'ice', 'isolation', 'permashadow', 'plains'],
    desc: 'A research station at 3,200 m altitude, isolated 9 months a year. ESA’s reference site for studying crew behavior in isolation.',
    activities: ['Long-duration isolation and team psychology', 'Operations during the polar night', 'Water and power management', 'Telemedicine with delay'],
    season: 'Overwintering (Feb – Nov)', access: 'ESA / IPEV / PNRA program',
  },
  {
    id: 'svalbard', name: 'Svalbard', country: 'Norway', lat: 78.2, lon: 15.6,
    traits: ['polar', 'ice', 'cold', 'mountain', 'isolation', 'permashadow'],
    desc: 'Glaciers, polar night and rocky terrain at 78°N. Ideal for training mobility on ice and geology in shadow.',
    activities: ['Mobility on glaciers', 'Operations in darkness', 'Ice sampling', 'Polar survival'],
    season: 'Nov – Jan (polar night)', access: 'Scheduled flight to Longyearbyen',
  },
  {
    id: 'hawaii', name: 'Mauna Loa · HI-SEAS', country: 'Hawaii, USA', lat: 19.6, lon: -155.5,
    traits: ['volcanic', 'basalt', 'dust', 'lava_tube', 'mountain', 'isolation', 'pit'],
    desc: 'Basaltic lava fields at 2,500 m that simulate lunar and Martian ground. Includes a simulation habitat with isolated crews.',
    activities: ['Crewed habitat simulation', 'Lava tube exploration', 'Handling basaltic regolith', 'ISRU tests'],
    season: 'Year-round', access: 'Flight to Hilo + 1 h by road',
  },
  {
    id: 'lanzarote', name: 'Lanzarote · Volcanic tubes', country: 'Canary Islands, Spain', lat: 29.0, lon: -13.6,
    traits: ['lava_tube', 'volcanic', 'basalt', 'arid', 'pit'],
    desc: 'Volcanic caves such as Cueva de los Verdes, used in ESA astronaut training to explore underground cavities.',
    activities: ['Cave exploration and mapping', 'Descent through pits and skylights', 'Navigation without GPS', 'Searching for life in caves'],
    season: 'Year-round', access: 'Direct flight from Europe',
  },
  {
    id: 'teide', name: 'Teide · Las Cañadas', country: 'Tenerife, Spain', lat: 28.27, lon: -16.64,
    traits: ['volcanic', 'basalt', 'dust', 'highland', 'mountain', 'mineral'],
    desc: 'A 3,700 m volcano with arid soils and rocks similar to lunar ones; used for rover and tool tests.',
    activities: ['Rover and vehicle tests', 'Field geology', 'Altitude and physical performance', 'Handling abrasive dust'],
    season: 'Apr – Oct', access: 'Tenerife South Airport',
  },
  {
    id: 'iceland', name: 'Askja · Iceland', country: 'Iceland', lat: 65.0, lon: -16.7,
    traits: ['volcanic', 'basalt', 'ice', 'cold', 'highland', 'mountain', 'crater'],
    desc: 'A volcanic caldera where the Apollo astronauts trained in the 1960s. A truly lunar landscape of ash and lava.',
    activities: ['Lunar field geology', 'Hiking on volcanic terrain', 'Sampling', 'Navigation in open terrain'],
    season: 'Jul – Sep', access: 'Reykjavík + highland 4×4',
  },
  {
    id: 'meteor', name: 'Meteor Crater', country: 'Arizona, USA', lat: 35.03, lon: -111.02,
    traits: ['crater', 'rim', 'arid', 'plains', 'basin'],
    desc: 'A 1.2 km impact crater, the best preserved on Earth. A classic training site for Apollo program astronauts.',
    activities: ['Impact geology', 'Descending and climbing crater walls', 'Ejecta mapping', 'Instrument operations'],
    season: 'Oct – Apr', access: '1 h from Flagstaff',
  },
  {
    id: 'mdrs', name: 'Mars Desert Research Station', country: 'Utah, USA', lat: 38.4, lon: -110.8,
    traits: ['arid', 'mineral', 'canyon', 'dust', 'plains', 'isolation', 'delta'],
    desc: 'A Mars simulation habitat in a reddish desert of sandstone and clays. Two-week rotations with real EVAs.',
    activities: ['14-day simulated missions', 'EVAs in simulation suits', 'Sedimentary geology', 'Life in a closed habitat'],
    season: 'Oct – Apr', access: '2 h from Green River / Moab',
  },
  {
    id: 'atacama', name: 'Atacama Desert', country: 'Chile', lat: -24.5, lon: -69.25,
    traits: ['arid', 'dust', 'mineral', 'plains', 'highland', 'delta'],
    desc: 'The driest place on Earth, with nearly sterile soils. Rovers and life-detection techniques for Mars are tested here.',
    activities: ['Autonomous rover tests', 'Biomarker detection', 'Survival in extreme aridity', 'UV protection'],
    season: 'Year-round', access: 'Calama Airport',
  },
  {
    id: 'riotinto', name: 'Río Tinto', country: 'Huelva, Spain', lat: 37.7, lon: -6.55,
    traits: ['mineral', 'canyon', 'delta', 'arid'],
    desc: 'An acidic river rich in iron and sulfates, with extremophile microorganisms. A mineralogical analog of Meridiani and Melas Chasma.',
    activities: ['Mineralogy and sulfates', 'Searching for extremophiles', 'Geochemical sampling', 'Instrument tests'],
    season: 'Year-round', access: '1 h from Seville',
  },
  {
    id: 'tabernas', name: 'Tabernas Desert', country: 'Almería, Spain', lat: 37.0, lon: -2.4,
    traits: ['arid', 'canyon', 'delta', 'mineral', 'plains'],
    desc: 'The only desert in Europe, with canyons and ancient sedimentary river deltas similar to those of Jezero.',
    activities: ['Delta geology', 'Rover tests', 'Stratigraphic mapping', 'Remote operations'],
    season: 'Oct – May', access: '30 min from Almería',
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
  solar: 'Excellent solar illumination', ice: 'Accessible water ice', terrain: 'Flat terrain, safe for landing',
  thermal: 'Stable temperatures', radiation: 'Strong protection against radiation', comms: 'Direct link with Earth',
  science: 'Very high science value', resources: 'Abundant mineral resources',
};
const CON = {
  solar: 'Long nights: requires energy storage', ice: 'No nearby water: depends on resupply',
  terrain: 'Rugged terrain: risky landing', thermal: 'Large temperature swings',
  radiation: 'Little natural protection against radiation', comms: 'Weak link: needs a relay satellite',
  science: 'Limited scientific interest', resources: 'Few usable local resources',
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
  polar: 'Polar latitude', ice: 'Ice', crater: 'Impact crater', rim: 'Crater rim', permashadow: 'Permanent shadow / polar night',
  cold: 'Extreme cold', lava_tube: 'Lava tubes', basalt: 'Basaltic ground', highland: 'Highland', dust: 'Fine dust',
  volcanic: 'Volcanic terrain', mineral: 'Mineralogy', canyon: 'Canyons', plains: 'Plains', delta: 'Delta / sediments',
  mountain: 'Mountain', isolation: 'Isolation', arid: 'Extreme aridity', basin: 'Basin', pit: 'Pits / skylights', ridge: 'Ridge',
};
