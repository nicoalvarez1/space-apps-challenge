// Datos reales de los lugares de entrenamiento en la Tierra a partir de NASA CMR
// (Common Metadata Repository): https://cmr.earthdata.nasa.gov/search/granules.json
//
// CMR es el catálogo de datos de ciencias de la Tierra de NASA (EOSDIS). No contiene datos de la Luna ni
// de Marte (esos están en el PDS), así que aquí solo se usa para los análogos terrestres.
//
// Para cada lugar se consulta:
//   · HLSL30 / HLSS30 (Landsat 8-9 y Sentinel-2 armonizados, 30 m): nubosidad de cada pasada en 24 meses
//       → % de pasadas despejadas por mes (cuándo conviene entrenar) y la última escena despejada (vista previa).
//   · ASTGTM (ASTER GDEM v3): relieve del lugar (vista previa).
//   · MOD11A1 (MODIS, temperatura de superficie diaria): fecha del último dato disponible.
// Todas las vistas previas están en buckets públicos: no hace falta cuenta de Earthdata.

const CMR = 'https://cmr.earthdata.nasa.gov/search/granules.json';
const CLEAR = 15;                                   // % de nubes máximo para considerar una pasada despejada
const cache = new Map();

async function search(params) {
  const u = new URL(CMR);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u);
  if (!r.ok) throw new Error(`CMR ${r.status}`);
  const j = await r.json();
  return { entries: j.feed?.entry ?? [], hits: Number(r.headers.get('CMR-Hits') ?? 0) };
}

// Última escena despejada y COMPLETA: los metadatos UMM de HLS incluyen SPATIAL_COVERAGE (% de la tesela con datos).
// Una tesela que no está entera trae en la vista previa una cuña negra sin dato (el borde de la pasada del satélite).
// Por eso, entre las escenas despejadas que devuelve CMR (de la más reciente a la más antigua), gana la de MAYOR
// cobertura y, a igual cobertura, la más reciente; el mínimo de 85 % sigue valiendo como suelo.
async function bestImage(point) {
  const pick = async (sn) => {
    const u = new URL(CMR.replace('granules.json', 'granules.umm_json'));
    Object.entries({ short_name: sn, point, cloud_cover: `0,${CLEAR}`, page_size: 40, sort_key: '-start_date' })
      .forEach(([k, v]) => u.searchParams.set(k, v));
    const r = await fetch(u); if (!r.ok) return null;
    let mejor = null;
    for (const it of (await r.json()).items ?? []) {
      const g = it.umm, attr = (n) => Number(g.AdditionalAttributes?.find((a) => a.Name === n)?.Values?.[0]);
      const src = g.RelatedUrls?.find((l) => l.Type === 'GET RELATED VISUALIZATION' && /^https:/.test(l.URL))?.URL;
      const cob = attr('SPATIAL_COVERAGE');
      if (src && cob >= 85 && !(mejor && mejor.cobertura >= cob)) {             // en orden de fecha: solo gana si cubre más
        mejor = { src, date: new Date(g.TemporalExtent.RangeDateTime.BeginningDateTime), cloud: attr('CLOUD_COVERAGE'),
          sensor: sn === 'HLSS30' ? 'Sentinel-2' : 'Landsat 8/9', id: g.GranuleUR, cobertura: cob };
      }
    }
    return mejor;
  };
  const [l, s] = await Promise.all([pick('HLSL30').catch(() => null), pick('HLSS30').catch(() => null)]);
  return [l, s].filter(Boolean).sort((a, b) => b.cobertura - a.cobertura || b.date - a.date)[0] ?? null;
}

const browse = (e) => e?.links?.find((l) => l.rel?.includes('browse#'))?.href ?? null;
const sensor = (e) => (e.title?.startsWith('HLS.S30') ? 'Sentinel-2' : 'Landsat 8/9');

function gibsSnapshot(lat, lon) {                    // respaldo donde no hay HLS (p. ej. Antártida)
  const d = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
  const bbox = [lat - 1.2, lon - 2, lat + 1.2, lon + 2].map((v) => v.toFixed(3)).join(',');
  return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&STYLES=&CRS=EPSG:4326&FORMAT=image/jpeg&WIDTH=640&HEIGHT=384&LAYERS=MODIS_Terra_CorrectedReflectance_TrueColor&TIME=${d}&BBOX=${bbox}`;
}

export async function earthSiteData(site) {
  if (cache.has(site.id)) return cache.get(site.id);
  const p = (async () => {
    const point = `${site.lon},${site.lat}`;
    const since = new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10) + 'T00:00:00Z';
    const hls = (sn) => search({ short_name: sn, point, temporal: `${since},`, page_size: 2000, sort_key: '-start_date' })
      .catch(() => ({ entries: [], hits: 0 }));
    const [l30, s30, dem, lst, best] = await Promise.all([
      hls('HLSL30'), hls('HLSS30'),
      search({ short_name: 'ASTGTM', point, page_size: 1 }).catch(() => ({ entries: [] })),
      search({ short_name: 'MOD11A1', point, page_size: 1, sort_key: '-start_date' }).catch(() => ({ entries: [], hits: 0 })),
      bestImage(point).catch(() => null),
    ]);

    const scenes = [...l30.entries, ...s30.entries]
      .map((e) => ({ e, cc: Number(e.cloud_cover), t: new Date(e.time_start) }))
      .filter((s) => Number.isFinite(s.cc));
    const months = Array.from({ length: 12 }, () => ({ total: 0, clear: 0 }));
    for (const s of scenes) { const m = months[s.t.getUTCMonth()]; m.total++; if (s.cc <= CLEAR) m.clear++; }
    const clearScenes = scenes.filter((s) => s.cc <= CLEAR).sort((a, b) => b.t - a.t);
    const latest = clearScenes.find((s) => browse(s.e));
    const ranked = months.map((m, i) => ({ i, r: m.total >= 3 ? m.clear / m.total : -1 })).sort((a, b) => b.r - a.r);

    return {
      scenes: scenes.length,
      clearPct: scenes.length ? Math.round((clearScenes.length / scenes.length) * 100) : null,
      months,
      bestMonths: ranked.filter((m) => m.r >= 0).slice(0, 3).map((m) => m.i),
      image: best ?? (latest
        ? { src: browse(latest.e), date: latest.t, cloud: latest.cc, sensor: sensor(latest.e), id: latest.e.producer_granule_id }
        : { src: gibsSnapshot(site.lat, site.lon), date: null, cloud: null, sensor: 'MODIS Terra (GIBS)', id: null }),
      dem: browse(dem.entries[0]),
      demId: dem.entries[0]?.producer_granule_id ?? null,
      lstLast: lst.entries[0] ? new Date(lst.entries[0].time_start) : null,
      lstDays: lst.hits,
    };
  })();
  cache.set(site.id, p);
  p.catch(() => cache.delete(site.id));
  return p;
}
