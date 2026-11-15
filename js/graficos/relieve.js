// ============================================================================
//  RELIEVE LOCAL EN UN LIENZO  (miniaturas de la lista y mapa del entorno de la ficha)
//
//  Pinta una ventana local de una capa real (js/analitica.js → ventana: proyección azimutal equidistante centrada en
//  el emplazamiento, norte arriba) como tinte de color modulado por el relieve sombreado de la elevación.
//  El color es el dato; el sombreado es solo una ayuda visual para leer el relieve.
// ============================================================================
import { RAMPAS, RADIO_KM } from '../capas.js';
import { ventana, sombreado } from '../analitica.js';
import { rampa } from './base.js';

const SIN_DATO = [34, 38, 52];

// cv: lienzo (se redimensiona a n × n píxeles de la ventana; el tamaño en pantalla lo da el CSS).
// elev: ventana de elevación en metros (para el sombreado). tinte: ventana de la capa que da el color (por defecto, la
// propia elevación; misma geometría que `elev`). paradas: colores de la rampa. pos(v) → posición 0…1 en la rampa.
// suelo: brillo mínimo que se suma al color antes de sombrear, para que el relieve se lea también en el extremo oscuro
// de la rampa (cuencas muy bajas); no cambia el orden de los colores.
export function pintarRelieve(cv, { elev, tinte = elev, paradas = RAMPAS.relieve, pos, exageracion = 1, rayado = true, suelo = 0 }) {
  const n = tinte.n, luz = elev && elev.n === n ? sombreado(elev, exageracion) : null, color = rampa(paradas);
  cv.width = n; cv.height = n;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(n, n), px = img.data;
  for (let o = 0, k = 0; o < n * n; o++, k += 4) {
    const v = tinte.v[o];
    px[k + 3] = 255;
    if (v !== v) {                                              // sin dato: gris con rayas (no se confunde con un valor bajo)
      const raya = rayado && ((o % n) + Math.floor(o / n)) % 6 < 2 ? 22 : 0;
      px[k] = SIN_DATO[0] + raya; px[k + 1] = SIN_DATO[1] + raya; px[k + 2] = SIN_DATO[2] + raya;
      continue;
    }
    const c = color(pos(v)), f = luz ? 0.35 + 0.9 * luz[o] : 1; // terreno llano (0,707) ≈ 1: conserva el color de la rampa
    px[k] = Math.min(255, (c[0] + suelo) * f); px[k + 1] = Math.min(255, (c[1] + suelo) * f); px[k + 2] = Math.min(255, (c[2] + suelo) * f);
  }
  ctx.putImageData(img, 0, 0);
}

// Miniatura del relieve alrededor de un emplazamiento con la MISMA escala de color que la capa de elevación del globo
// (percentiles de toda la superficie): los colores se pueden comparar entre emplazamientos.
// capaElev: Capa de elevación del cuerpo. radioKm: medio lado de la ventana. n: píxeles de lado.
export function miniatura(cv, capaElev, sitio, body, { radioKm, n = 48, exageracion = 1 } = {}) {
  const v = ventana(capaElev, sitio.lat, sitio.lon, radioKm, n, RADIO_KM[body], { suave: true });
  pintarRelieve(cv, { elev: v, pos: (z) => capaElev.pos(z), exageracion, rayado: false, suelo: 26 });
  return v;
}

// Medio lado de la miniatura: unas 32 celdas de la rejilla de elevación de lado (0,125°)
export const RADIO_MINIATURA_KM = { moon: 60, mars: 120 };
