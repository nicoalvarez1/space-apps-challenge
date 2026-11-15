"""Precalcula el motor de similitud (`python -m similitud buscar`) para los emplazamientos de js/data.js → SITES.

Salida: base-planetaria/web/data/tierra/motor/<cuerpo>_<id>.json (la salida del motor tal cual) y motor/indice.json.
Para la Luna con |lat| ≥ 78 usa el MDE polar de LOLA (ldem_75s_240m / ldem_75n_240m) si está en disco, igual que
renderMotor() en js/main.js.

Uso:  .venv/bin/python base-planetaria/tools/precalcular_motor_web.py [--procesos 3] [--sin-validar] [--solo moon:id ...]
                                                                       [--saltar-hechos]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
BASE = RAIZ / "base-planetaria"
SALIDA = BASE / "web" / "data" / "tierra" / "motor"
PY = RAIZ / ".venv" / "bin" / "python"
K = 5


def leer_sitios() -> list[dict]:
    txt = (RAIZ / "js" / "data.js").read_text(encoding="utf-8")
    ini, fin = txt.index("export const SITES"), txt.index("export const ANALOGS")
    bloque = txt[ini:fin]
    out, cuerpo = [], None
    for linea in bloque.splitlines():
        m = re.match(r"\s*(moon|mars):\s*\[", linea)
        if m:
            cuerpo = m.group(1)
        m = re.match(r"\s*S\('([^']+)',\s*'(?:[^'\\]|\\.)*',\s*'(?:[^'\\]|\\.)*',\s*(-?[\d.]+),\s*(-?[\d.]+)", linea)
        if m and cuerpo:
            out.append({"cuerpo": cuerpo, "id": m.group(1), "lat": float(m.group(2)), "lon": float(m.group(3))})
    return out


def producto(s) -> str | None:
    if s["cuerpo"] != "moon" or abs(s["lat"]) < 78:
        return None
    p = "ldem_75s_240m" if s["lat"] < 0 else "ldem_75n_240m"
    return p if (BASE / "datos_pds" / "lola_gdr_polar" / f"{p}.img").exists() else None


def correr(s, sin_validar: bool) -> dict:
    nombre = f"{s['cuerpo']}_{s['id']}.json"
    cmd = [str(PY), "-m", "similitud", "buscar", "--cuerpo", s["cuerpo"], "--lat", str(s["lat"]),
           "--lon", str(s["lon"]), "--k", str(K), "--salida", str(SALIDA / nombre)]
    prod = producto(s)
    if prod:
        cmd += ["--producto", prod]
    if sin_validar:
        cmd.append("--sin-validar")
    t0 = time.time()
    log = BASE / "similitud" / "cache" / "motor_logs"
    log.mkdir(exist_ok=True)
    with open(log / f"{s['cuerpo']}_{s['id']}.log", "w") as f:
        r = subprocess.run(cmd, cwd=BASE, stdout=f, stderr=subprocess.STDOUT)
    seg = round(time.time() - t0, 1)
    ok = r.returncode == 0 and (SALIDA / nombre).exists()
    ent = {"archivo": nombre if ok else None, "segundos": seg, "validado": (not sin_validar) if ok else None,
           "producto": prod or "por defecto del motor", "lat": s["lat"], "lon": s["lon"]}
    if not ok:
        ent["error"] = f"código {r.returncode}; ver similitud/cache/motor_logs/{s['cuerpo']}_{s['id']}.log"
    print(f"{s['cuerpo']}:{s['id']:16s} {'OK' if ok else 'FALLO'} {seg:7.1f} s {prod or ''}", flush=True)
    return ent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--procesos", type=int, default=3)
    ap.add_argument("--sin-validar", action="store_true")
    ap.add_argument("--solo", nargs="*")
    ap.add_argument("--saltar-hechos", action="store_true", help="no repetir los que ya están OK en indice.json")
    a = ap.parse_args()
    SALIDA.mkdir(parents=True, exist_ok=True)
    ruta_ind = SALIDA / "indice.json"
    indice = json.loads(ruta_ind.read_text()) if ruta_ind.exists() else {"sitios": {}}
    sitios = leer_sitios()
    if a.solo:
        sitios = [s for s in sitios if f"{s['cuerpo']}:{s['id']}" in a.solo]
    if a.saltar_hechos:
        sitios = [s for s in sitios if not indice["sitios"].get(f"{s['cuerpo']}:{s['id']}", {}).get("archivo")]
    with ThreadPoolExecutor(a.procesos) as ex:
        res = list(ex.map(lambda s: (s, correr(s, a.sin_validar)), sitios))
    for s, ent in res:
        indice["sitios"][f"{s['cuerpo']}:{s['id']}"] = ent
    indice["generado"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    indice["parametros"] = {"orden": "python -m similitud buscar", "k": K, "buscar_en": "earth",
                            "lado_km": "por defecto del motor (config.LADO_KM = 200)",
                            "producto_lunar_polar": "ldem_75s_240m / ldem_75n_240m si |lat| ≥ 78° y está en disco",
                            "validacion": "por sitio, ver «validado»"}
    indice = {"generado": indice["generado"], "parametros": indice["parametros"],
              "sitios": dict(sorted(indice["sitios"].items()))}
    ruta_ind.write_text(json.dumps(indice, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
