# Landfall · Guion v2 (estructura oficial de Space Apps, 30 s)

Locución en inglés para ElevenLabs, voz **Hale** (misma configuración que la v1). 73 palabras: al ritmo de la toma anterior (~2,4 palabras/s) dura unos 29 s. Pegar el bloque «Texto para ElevenLabs» tal cual; los saltos de línea dejan las pausas entre bloques.

La v1 está guardada en `video/copia_2026-11-15_30s_v1/`.

## Texto para ElevenLabs

```
We're Team Top Git.

Astronauts can't rehearse on Mars. So where on Earth should they train?

For NASA's analog challenge, we built Landfall: where to land, where to train.

Pick Mars or the Moon. NASA orbiter data ranks the landing sites. Then NASA elevation maps find the closest terrain on Earth. Jezero Crater? Tabernas, Spain.

Picture every crew rehearsing here, on the same kind of ground they'll walk on Mars. Landfall. topgit dot earth.
```

**Cambio:** «topgit dot earth.» se corta del audio en `tools/video/voz.py` (`ULTIMA_FRASE`) y la web no aparece en el título final: el vídeo termina con «Landfall.».

## Plano a plano

| Tiempo | Bloque de la estructura | Locución | Imagen (grabación actual) | Rótulo |
|---|---|---|---|---|
| 0:00–0:02 | Preséntate | We're Team Top Git. | Portada de Landfall | **Team Top Git** |
| 0:02–0:05 | Desafío e inspiración | Astronauts can't rehearse on Mars. So where on Earth should they train? | Despegue del Saturno V → Marte con los 10 sitios | NASA Space Apps 2026 · Earth analogs of Moon & Mars |
| 0:05–0:10 | Nombre y eslogan | For NASA's analog challenge, we built Landfall: where to land, where to train. | Mitad Marte / mitad Luna con las capas de datos | Título **LANDFALL** · *Where to land. Where to train.* |
| 0:10–0:20 | Cómo funciona + datos NASA | Pick Mars or the Moon. NASA orbiter data ranks the landing sites. Then NASA elevation maps find the closest terrain on Earth. Jezero Crater? Tabernas, Spain. | Lista de sitios → ficha de Jezero (MOLA) → el globo vuela a la Tierra → Marte y Tabernas a la misma escala | MOLA · LOLA · Diviner · Odyssey GRS → SRTM · 8,401 places compared · Tabernas Desert, Spain |
| 0:20–0:30 | Mirar al futuro | Picture every crew rehearsing here, on the same kind of ground they'll walk on Mars. Landfall. | «When to go» (NASA POWER) → lugares hallados por el motor → globo girando con los lugares | NASA POWER climate data · cierre: LANDFALL + *Where to land. Where to train.* |

## Comprobación de lo que dice la voz

- «NASA orbiter data ranks the landing sites»: la puntuación usa cuatro factores medidos (MOLA/LOLA, Odyssey GRS/Lunar Prospector, TES/Diviner); el resto son estimaciones marcadas en la web.
- «NASA elevation maps find the closest terrain»: el motor compara la forma del relieve (MOLA frente a SRTM), no la geología. «Closest terrain» y «same kind of ground» no prometen más que eso.
- «Jezero Crater? Tabernas, Spain.»: Tabernas es el lugar recomendado en la ficha de entrenamiento de Jezero.
