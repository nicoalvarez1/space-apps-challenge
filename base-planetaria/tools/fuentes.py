"""Registro de los archivos originales que usa el proyecto.

Cada entrada: URL exacta, ruta local bajo `datos_pds/` y, cuando el PDS la publica, la suma MD5
oficial (tomada de las listas `.md5` del propio nodo; su URL figura en `LISTAS_MD5`).
`python3 tools/descargar.py <grupo>` baja y verifica el grupo.
"""
from __future__ import annotations

GEO = "https://pds-geosciences.wustl.edu"
MOLA = f"{GEO}/mgs/urn-nasa-pds-mgs_mola_topography_derived"
LOLA = f"{GEO}/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx"
DIVINER = f"{GEO}/lro/urn-nasa-pds-lro_diviner_derived1"
GRS = f"{GEO}/ody/ody-m-grs-5-elements-v1/odgm_xxxx"
TES = f"{GEO}/mgs/mgs-m-tes-5-timap-v1/mgst_9001"
LP = f"{GEO}/missions/lunarp/reduced"
GRS_ESP = f"{GEO}/ody/urn-nasa-pds-odyssey_grs_special"

# Listas de sumas publicadas por el PDS Geosciences Node (de aquí salen los MD5 de abajo).
LISTAS_MD5 = {
    "mola": f"{MOLA}/urn-nasa-pds-mgs_mola_topography_derived.md5",
    "lola": f"{GEO}/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx_261020.md5",
    "diviner": f"{DIVINER}/urn-nasa-pds-lro_diviner_derived1.md5",
    "grs": f"{GRS}/ody-m-grs-5-elements-v1.md5",
    "tes": f"{GEO}/mgs/mgs-m-tes-5-timap-v1/mgst_9001_210122.md5",
}

BANDAS_DIVINER = ["90s80s", "80s70s", "70s60s", "60s50s", "50s40s", "40s30s", "30s20s", "20s10s", "10s00s",
                  "00n10n", "10n20n", "20n30n", "30n40n", "40n50n", "50n60n", "60n70n", "70n80n", "80n90n"]

MD5_DIVINER = {
    "00n10n": "0044E6DF5344775442241AFB8E1A6E66", "10n20n": "66DCD592B7BB614FFA72EB110D0C506A",
    "10s00s": "C1FC628BA4FBEDF0DE620573D215686C", "20n30n": "DEDFE3F2CCC0EE71E993D9B5BCFC69F3",
    "20s10s": "0B13CB5D7F244E3BB5DC8545A7D08EAC", "30n40n": "5DFE356183B56E4E1DF3DE54ECC10278",
    "30s20s": "24916E51C8FB8BEFC14AD83F761D7DE8", "40n50n": "837DC75075C1B342DD30427FB4D468EB",
    "40s30s": "3D7F97803C6A9082E9A6274892A4BCBD", "50n60n": "93C039247E7F7AD5E54D0358243C5488",
    "50s40s": "26727CFA54C758DFD8E0274C52D24E0E", "60n70n": "71E6784DD51CC2833D907DA337546663",
    "60s50s": "62C5B3F9764E0626697398776A019005", "70n80n": "C132354928AD9B09A3DA974B6AF9F215",
    "70s60s": "B3C131B9C243168FE7B0060D4DC418F8", "80n90n": "396E9215AB3925B3B1FACF6D487050C4",
    "80s70s": "D26AA3C85B82105DCB15825DE076A4CE", "90s80s": "3200DD1267B676CAD89300D344A88010",
}


MD5_GRS = {
    "cl.lbl": "BF8AC844621CED0797009E160A73270C", "cl.tab": "7131A9C41B33816F7EA645ECFB7DC454",
    "fe.lbl": "FE01AE5427D94F8AFC962990BA00D96B", "fe.tab": "64D15CABD88C6FA3D2ED6463129253DE",
    "h2o.lbl": "01C286A92897B40C113AEA43B70D747D", "h2o.tab": "238AC1207D8F085FB4EA3B2F4B3B018D",
    "k.lbl": "E83BA70A530D4BBF0360FF8E0D268240", "k.tab": "28CB993610B22B7737E6617CB977E024",
    "si.lbl": "093F1FA1698A8A2776FD0D1595BDA6A8", "si.tab": "27B771512B484BC800A182CDA23E00A6",
    "th.lbl": "A9D1542A752F36034A9BF5394AE28B3B", "th.tab": "AFD5AC10830A27559451480663790E80",
}


def _f(url: str, destino: str, md5: str | None = None) -> dict:
    return {"url": url, "destino": destino, "md5": md5}


GRUPOS: dict[str, dict] = {
    # ---------------------------------------------------------------- Marte
    "mola": {
        "descripcion": "MGS MOLA MEGDR 16 px/grado: radio medio, areoide, topografía mediana y nº de disparos (4 × 33 MB)",
        "archivos": [
            _f(f"{MOLA}/meg016/megr90n000eb.img", "mola_meg016/megr90n000eb.img", "938818829D62F6ADE15B844B62C2D0EC"),
            _f(f"{MOLA}/meg016/megr90n000eb.lbl", "mola_meg016/megr90n000eb.lbl", "CDD3B174070756432BA156454F67D7D4"),
            _f(f"{MOLA}/meg016/mega90n000eb.img", "mola_meg016/mega90n000eb.img", "8A5F8DBD431E4EB1CA6017822971ADFC"),
            _f(f"{MOLA}/meg016/mega90n000eb.lbl", "mola_meg016/mega90n000eb.lbl", "2F0A94D39D43E3984A1A0AAE286A5D79"),
            _f(f"{MOLA}/meg016/megt90n000eb.img", "mola_meg016/megt90n000eb.img", "357C759AB342140D2D008443E0A68015"),
            _f(f"{MOLA}/meg016/megt90n000eb.lbl", "mola_meg016/megt90n000eb.lbl", "A2F671A1BE26EC160EACD13C225C373B"),
            _f(f"{MOLA}/meg016/megc90n000eb.img", "mola_meg016/megc90n000eb.img", "198EA0B1E0B7D14B911A85C5FFAB0648"),
            _f(f"{MOLA}/meg016/megc90n000eb.lbl", "mola_meg016/megc90n000eb.lbl", "E5B39FBD0DB1372D304F3D092227C2FB"),
        ],
    },
    "grs": {
        "descripcion": "Mars Odyssey GRS: concentraciones elementales suavizadas 5°×5° (6 tablas ASCII, ~1 MB)",
        "archivos": [
            _f(f"{GRS}/data/smoothed/{e}_sr_5x5.{x}", f"odyssey_grs/{e}_sr_5x5.{x}", MD5_GRS[f"{e}.{x}"])
            for e in ("h2o", "fe", "si", "cl", "k", "th") for x in ("lbl", "tab")
        ],
    },
    "neutrones": {
        "descripcion": "Mars Odyssey Neutron Spectrometer: flujo de neutrones epitermales 0,5° (tabla ASCII, 6,6 MB)",
        "archivos": [
            _f(f"{GRS_ESP}/data/ns_epithermal_020917.tab", "odyssey_ns/ns_epithermal_020917.tab", "FA09F309841C45834ECE663106AC37BA"),
            _f(f"{GRS_ESP}/data/ns_epithermal_020917.lbl", "odyssey_ns/ns_epithermal_020917.lbl", "4CC33CCDC6F210FCCBA39245266DCBB3"),
        ],
    },
    "tes": {
        "descripcion": "MGS TES: inercia térmica nocturna 20 px/grado y máscara de interpolación (52 + 26 MB)",
        "archivos": [
            _f(f"{TES}/data/global_ti_night_2007.img", "tes_timap/global_ti_night_2007.img", "0CB2BA2BC40DE8749E798853E66063C3"),
            _f(f"{TES}/data/global_ti_night_2007.lbl", "tes_timap/global_ti_night_2007.lbl", "E4F19B7B8D69BEC62980002C1E597C22"),
            _f(f"{TES}/data/global_ti_msk_night_2007.img", "tes_timap/global_ti_msk_night_2007.img", "E6C1DE6B7E8A87A20345F720154240A8"),
            _f(f"{TES}/data/global_ti_msk_night_2007.lbl", "tes_timap/global_ti_msk_night_2007.lbl", "86407F48D8EEC8964AF6D02A45792D44"),
            _f(f"{TES}/data/datainfo.txt", "tes_timap/datainfo.txt", "6C5CEECA78090D2DF029FEA2B87957B8"),
            _f(f"{TES}/catalog/dataset.cat", "tes_timap/dataset.cat", "14C3F2437EDCAA524F8EEF216EC83F33"),
        ],
    },
    # ---------------------------------------------------------------- Luna
    "lola": {
        "descripcion": "LRO LOLA GDR 16 px/grado: altura, nº de disparos, pendiente y rugosidad (4 × 33 MB)",
        "archivos": [
            _f(f"{LOLA}/data/lola_gdr/cylindrical/img/ldem_16.img", "lola_gdr/ldem_16.img", "87D937CF968462A61043E1E5B3166D65"),
            _f(f"{LOLA}/data/lola_gdr/cylindrical/img/ldem_16.lbl", "lola_gdr/ldem_16.lbl", "550F6CD73EC11543709FAF1226E0A7D2"),
            _f(f"{LOLA}/data/lola_gdr/cylindrical/img/ldec_16.img", "lola_gdr/ldec_16.img", "5D9572B75662D1242AA91F5F6AC917B6"),
            _f(f"{LOLA}/data/lola_gdr/cylindrical/img/ldec_16.lbl", "lola_gdr/ldec_16.lbl", "E419CCDF192276096F7C4D7BA98FA0EA"),
            _f(f"{LOLA}/data/lola_gdr/cylindrical/img/ldsm_16.img", "lola_gdr/ldsm_16.img", "A8A4DD2CA68AB1AB0FFBFA3F4579E6C1"),
            _f(f"{LOLA}/data/lola_gdr/cylindrical/img/ldsm_16.lbl", "lola_gdr/ldsm_16.lbl", "C9EC088C3FBF155E2C271CEDDCF86158"),
            _f(f"{LOLA}/data/lola_gdr/cylindrical/img/ldrm_16.img", "lola_gdr/ldrm_16.img", "B58888900578FC1F152101530D6881E5"),
            _f(f"{LOLA}/data/lola_gdr/cylindrical/img/ldrm_16.lbl", "lola_gdr/ldrm_16.lbl", "F421F15960640154F4F9E332C644687A"),
        ],
    },
    "lola_polar": {
        "descripcion": "LRO LOLA GDR polar 240 m/px, estereográfica polar 75°–90° S y N: altura y nº de disparos (4 × 29 MB)",
        "archivos": [
            _f(f"{LOLA}/data/lola_gdr/polar/img/{n}.{x}", f"lola_gdr_polar/{n}.{x}", m)
            for n, x, m in (
                ("ldem_75s_240m", "img", "A25251D480F26619BC7796E148644B7E"),
                ("ldem_75s_240m", "lbl", "87488026FB326DDCF01C2D461DF10963"),
                ("ldec_75s_240m", "img", "EE9988DB906D4A308D23FC06E78863F3"),
                ("ldec_75s_240m", "lbl", "7790C32A4AE65F84C9CAA8282C3A1450"),
                ("ldem_75n_240m", "img", "5A309B62C8168DE7B810C20DC630E97D"),
                ("ldem_75n_240m", "lbl", "B5AEF3F8F2D5C383C802454858C55EB4"),
                ("ldec_75n_240m", "img", "76995703FEBD822F59BB4ECA57EDAA1C"),
                ("ldec_75n_240m", "lbl", "CF6F8E389EF000272C53214F549A5B77"),
            )
        ],
    },
    "diviner": {
        "descripcion": "LRO Diviner GCP: temperatura de brillo por hora local, 0,5° (18 tablas ASCII de 156 MB = 2,8 GB)",
        "archivos": [_f(f"{DIVINER}/label/dlre_gcp.fmt", "diviner_gcp/dlre_gcp.fmt")] + [
            f for b in BANDAS_DIVINER for f in (
                _f(f"{DIVINER}/data_derived_gcp/global_cumul_avg_cyl_{b}_002.lbl", f"diviner_gcp/global_cumul_avg_cyl_{b}_002.lbl"),
                _f(f"{DIVINER}/data_derived_gcp/global_cumul_avg_cyl_{b}_002.tab", f"diviner_gcp/global_cumul_avg_cyl_{b}_002.tab", MD5_DIVINER[b]),
            )
        ],
    },
    "lp": {
        "descripcion": "Lunar Prospector, productos especiales 0,5°: hidrógeno (ppm) y FeO (% en peso). Sin MD5 publicado",
        "archivos": [
            _f(f"{LP}/hydrogenhd.txt", "lp_special/hydrogenhd.txt"),
            _f(f"{LP}/hydrogenhd.dat", "lp_special/hydrogenhd.dat"),
            _f(f"{LP}/ironhd.txt", "lp_special/ironhd.txt"),
            _f(f"{LP}/ironhd.dat", "lp_special/ironhd.dat"),
        ],
    },
}

# Tierra (Earthdata, requiere Earthdata Login en ~/.netrc): SRTMGL30, 27 teselas. No va en GRUPOS porque
# las URL se piden a CMR y la descarga necesita cookies de sesión:
#   cd base-planetaria && python -m similitud descargar-tierra
#
# Los grupos que no son archivos sueltos se bajan con su propio script:
#   Tierra (NASA POWER, almacén Zarr público + API):  tools/construir_tierra.py
#   Marte, temperatura (MRO MCS DDR, lectura parcial): tools/construir_mcs.py
