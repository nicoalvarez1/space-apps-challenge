# Landfall · 30 s voice-over script (v2, natural)

Synced to `video/landfall_30s.mp4` / `video/landfall_30s_voz.mp4`. 68 words: at a relaxed, natural pace (about 2.3 words per second, the pace of the first ElevenLabs take) it lands at ~30 s including short breaths. Every claim matches what is on screen.

| Time | Shot (on-screen label) | Voice-over (detected in the take) |
|---|---|---|
| 0:00.00–0:02.77 | Home screen → "Start mission" → pick Mars | 0:00.25 Where should the first crew land on Mars? |
| 0:02.77–0:03.97 | Saturn V liftoff | 0:02.92 Landfall ranks ten candidate sites, |
| 0:03.97–0:05.10 | Mars + the 10 ranked sites → click "Compare with measured data" | …sites, |
| 0:05.10–0:07.73 | Half-Mars / half-Moon globe (real textures, slow turn); the real data layers unfold from the seam and peel outward one by one: Potassium · Hydrogen · Thermal inertia · Elevation (Odyssey GRS, TES, MOLA) and Iron oxide · Hydrogen · Max. temperature · Elevation (Lunar Prospector, Diviner, LOLA). Small layer list per half (`tools/video/planeta.html`) | 0:05.24 scored with real NASA orbiter data. |
| 0:07.73–0:11.40 | Jezero site sheet, MOLA relief map → click "Where to train on Earth?" (*Jezero Crater · 18.4°N 77.7°E*) | 0:07.89 Here's Jezero Crater, mapped by Mars Global Surveyor. |
| 0:11.40–0:14.13 | Globe arrives at Earth; Tabernas panel (*Tabernas Desert, Spain*) | 0:11.56 Before launch, the crew trains on Earth. |
| 0:14.13–0:16.87 | Smooth scroll to Mars and Earth maps side by side (no cut) | 0:14.29 Tabernas, in Spain, has similar ground… |
| 0:16.87–0:19.43 | "When to go" climate chart (*NASA POWER climate data*) | 0:17.02 and NASA climate data picks the season. |
| 0:19.43–0:21.30 | Places found by NASA terrain data (*Found in NASA elevation data*) | 0:19.58 And it maps more terrain twins… |
| 0:21.30–0:30.00 | Panel slides away; Earth globe with the matches turns; title ◐ LANDFALL (22.78), *Where to land. / Where to train.* (24.73 / 25.88), topgit.earth (27.48) | …across the globe. 0:22.78 Landfall. 0:23.83 Real NASA data on where to land — and where to train. 0:27.48 topgit dot earth. |

Shot cuts are computed by `tools/video/montar.py` from the take itself (`tools/video/locucion.py`, ffmpeg silencedetect): each cut lands 0.15 s before its sentence. The planet shot is rendered frame by frame by `tools/video/planeta.py` (scene time 0.20–2.83 s, layers arrive at 0.75 / 1.11 / 1.47 / 1.83 s → 5.65 / 6.01 / 6.37 / 6.73 s in the video, with a soft air sweep in `audio.py`).

## Full text (paste into ElevenLabs)

Where should the first crew land on Mars? Landfall ranks ten candidate sites, scored with real NASA orbiter data. Here's Jezero Crater, mapped by Mars Global Surveyor. Before launch, the crew trains on Earth. Tabernas, in Spain, has similar ground… and NASA climate data picks the season. And it maps more terrain twins across the globe. Landfall. Real NASA data on where to land — and where to train. topgit dot earth.

## Delivery
- Conversational, like explaining it to a friend; not a trailer voice. Slight smile on "Here's Jezero Crater".
- Short pause after "Mars?", after "trains on Earth." and before "Landfall." (the closing title).
- "topgit dot earth" slow and clear.
- If the take runs past 30 s, `tools/video/voz.py` shortens the pauses automatically; past ~33 s, drop "more" and "real".
