#!/usr/bin/env python3
"""
Portal Mesa de Ayuda · Ingreso diario MULTIMARCA
────────────────────────────────────────────────
Lee scripts/marcas.json y, por cada marca y cada día, guarda en Supabase
(tabla ingreso_diario) el total, el reparto por frente, la absorción de la IA,
los escalamientos a N2/N3 y la distribución por hora.

No reemplaza a sync_ingreso.py (detalle DOCUM por flujo): conviven.

Uso:
  python sync_ingreso_marcas.py                       # últimos 3 días, todas las marcas
  python sync_ingreso_marcas.py --marca BALU          # solo Balú
  python sync_ingreso_marcas.py --date 2026-09-08
  python sync_ingreso_marcas.py --backfill 2026-09-01 2026-09-22
  python sync_ingreso_marcas.py --grupos              # muestra cómo quedó cada grupo en cada frente

Variables de entorno: ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN,
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
"""
import os, sys, json, re, time, argparse, unicodedata, datetime as dt
from collections import defaultdict
from zoneinfo import ZoneInfo
import requests

BOGOTA = ZoneInfo("America/Bogota")
DOW_ES = {0: "Lun", 1: "Mar", 2: "Mié", 3: "Jue", 4: "Vie", 5: "Sáb", 6: "Dom"}
NIVEL_IA, SUB_IA = "IA", "Solo IA / sin asignar"
CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "marcas.json")


# ─────────────────────────── utilidades ───────────────────────────
def env(name):
    v = os.environ.get(name)
    if not v:
        sys.exit(f"Falta la variable de entorno {name}")
    return v


def limpio(s):
    s = unicodedata.normalize("NFD", str(s or ""))
    return "".join(c for c in s if unicodedata.category(c) != "Mn").lower()


def cargar_config():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        cfg = json.load(f)
    ia = cfg.pop("_ia")
    marcas = {k: v for k, v in cfg.items() if not k.startswith("_")}
    return ia, marcas


# ─────────────────────────── Zendesk ───────────────────────────
def zd_get(url, params=None):
    sub_auth = (f'{env("ZENDESK_EMAIL")}/token', env("ZENDESK_API_TOKEN"))
    for intento in range(6):
        r = requests.get(url, auth=sub_auth, params=params, timeout=90)
        if r.status_code == 200:
            return r.json()
        if r.status_code == 429 or r.status_code >= 500:
            espera = int(r.headers.get("Retry-After", 5 * (intento + 1)))
            print(f"  Zendesk {r.status_code}, reintento en {espera}s")
            time.sleep(min(espera, 60))
            continue
        print("ZENDESK ERROR:", r.status_code, r.text[:300])
        r.raise_for_status()
    sys.exit("Zendesk no respondió después de 6 intentos")


def base():
    return f'https://{env("ZENDESK_SUBDOMAIN")}.zendesk.com'


def grupos_zendesk():
    out, url, params = {}, f"{base()}/api/v2/groups.json", {"page[size]": 100}
    while url:
        data = zd_get(url, params)
        for g in data.get("groups", []):
            out[g["id"]] = g["name"]
        url = data["links"]["next"] if data.get("meta", {}).get("has_more") else None
        params = None
    return out


def tickets_del_dia(brand_id, dia):
    """Tickets de la marca creados ese día (hora Colombia)."""
    sig = (dt.date.fromisoformat(dia) + dt.timedelta(days=1)).isoformat()
    query = (f"type:ticket brand:{brand_id} "
             f"created>={dia}T00:00:00-05:00 created<{sig}T00:00:00-05:00")
    url = f"{base()}/api/v2/search/export"
    params = {"query": query, "filter[type]": "ticket", "page[size]": 1000}
    out = []
    while url:
        data = zd_get(url, params)
        out.extend(data.get("results", []))
        url = data["links"]["next"] if data.get("meta", {}).get("has_more") and data.get("links", {}).get("next") else None
        params = None
    return out


# ─────────────────────────── clasificación ───────────────────────────
def mapa_grupos(marca_cfg, grupos):
    """group_id -> (nivel, subgrupo). Nivel por patrón/ID; subgrupo = nombre del grupo sin prefijo."""
    reglas = [(n["nivel"], re.compile(n.get("patron") or "(?!x)x", re.I), set(map(int, n.get("grupos", []))))
              for n in marca_cfg["niveles"]]
    defecto = marca_cfg.get("nivel_por_defecto", "N1")
    prefijo = re.compile(marca_cfg.get("quitar_prefijo") or "(?!x)x", re.I)
    unir = marca_cfg.get("unir", {})
    out = {}
    for gid, nombre in grupos.items():
        nivel = next((n for n, _, ids in reglas if gid in ids), None) \
            or next((n for n, rx, _ in reglas if rx.search(limpio(nombre))), defecto)
        sub = prefijo.sub("", nombre).strip() or nombre
        out[gid] = (nivel, unir.get(sub, unir.get(nombre, sub)))
    return out


def agregar(tickets, dia, marca, marca_cfg, grupo_de, ia):
    niveles = defaultdict(lambda: defaultdict(int))
    horas = [0] * 24
    total = ia_u = ia_r = n2 = n3 = 0
    esc = marca_cfg.get("escalamiento", {})
    e2, e3 = esc.get("n2", {}), esc.get("n3", {})

    for t in tickets:
        creado = dt.datetime.fromisoformat(t["created_at"].replace("Z", "+00:00")).astimezone(BOGOTA)
        if creado.strftime("%Y-%m-%d") != dia:
            continue
        total += 1
        horas[creado.hour] += 1

        gid = t.get("group_id")
        if gid:
            nivel, sub = grupo_de.get(gid, (marca_cfg.get("nivel_por_defecto", "N1"), f"Grupo {gid}"))
        else:
            nivel, sub = NIVEL_IA, SUB_IA
        niveles[nivel][sub] += 1

        tags = t.get("tags") or []
        canal = (t.get("via") or {}).get("channel")
        tipo_res = next((c.get("value") for c in t.get("custom_fields", [])
                         if c.get("id") == ia["campo_tipo_resolucion"]), None)
        resuelto_ia = tipo_res == ia["valor_automatizado"] or ia["valor_automatizado"] in tags
        if resuelto_ia or canal in ia["canales"]:
            ia_u += 1
            ia_r += 1 if resuelto_ia else 0

        if nivel == e2.get("nivel") or any(x in tags for x in e2.get("etiquetas", [])):
            n2 += 1
        if nivel == e3.get("nivel") or any(x in tags for x in e3.get("etiquetas", [])):
            n3 += 1

    return {
        "marca": marca, "dia": dia, "dow": DOW_ES[dt.date.fromisoformat(dia).weekday()],
        "total": total, "frentes": {n: dict(s) for n, s in niveles.items()},
        "ia_universo": ia_u, "ia_resueltos": ia_r,
        "esc_n2": n2, "esc_n3": n3, "horas": horas,
        "actualizado": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


# ─────────────────────────── Supabase ───────────────────────────
def upsert(rows):
    if not rows:
        return
    url = f'{env("SUPABASE_URL")}/rest/v1/ingreso_diario?on_conflict=marca,dia'
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
               "Prefer": "resolution=merge-duplicates,return=minimal"}
    r = requests.post(url, headers=headers, json=rows, timeout=60)
    if r.status_code in (401, 403):
        headers.pop("Authorization", None)   # llaves sb_secret_ van solo en apikey
        r = requests.post(url, headers=headers, json=rows, timeout=60)
    if not r.ok:
        print("SUPABASE ERROR:", r.status_code, r.text)
    r.raise_for_status()


# ─────────────────────────── main ───────────────────────────
def dias_objetivo(args):
    if args.backfill:
        d0, d1 = (dt.date.fromisoformat(x) for x in args.backfill)
        return [(d0 + dt.timedelta(days=i)).isoformat() for i in range((d1 - d0).days + 1)]
    if args.date:
        return [args.date]
    hoy = dt.datetime.now(BOGOTA).date()
    return [(hoy - dt.timedelta(days=i)).isoformat() for i in range(args.ultimos - 1, -1, -1)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--marca", help="Clave de marcas.json (vacío = todas)")
    ap.add_argument("--date")
    ap.add_argument("--backfill", nargs=2, metavar=("DESDE", "HASTA"))
    ap.add_argument("--ultimos", type=int, default=3, help="Días hacia atrás incluyendo hoy (por defecto 3)")
    ap.add_argument("--grupos", action="store_true", help="Solo mostrar la clasificación de grupos")
    args = ap.parse_args()

    ia, marcas = cargar_config()
    if args.marca:
        clave = args.marca.strip().upper()
        if clave not in marcas:
            sys.exit(f"La marca {clave} no está en marcas.json. Disponibles: {', '.join(marcas)}")
        marcas = {clave: marcas[clave]}

    grupos = grupos_zendesk()
    print(f"Grupos en Zendesk: {len(grupos)}")

    if args.grupos:
        for m, mc in marcas.items():
            gm = mapa_grupos(mc, grupos)
            print(f"\n== {m} ==  (NIVEL | SUBGRUPO | ID | NOMBRE EN ZENDESK)")
            for gid, nombre in sorted(grupos.items(), key=lambda x: (gm[x[0]], x[1])):
                print(f"  {gm[gid][0]:<4} | {gm[gid][1]:<28} | {gid} | {nombre}")
        return

    dias = dias_objetivo(args)
    print(f"Días: {dias[0]} → {dias[-1]} ({len(dias)})  Marcas: {', '.join(marcas)}")

    for m, mc in marcas.items():
        grupo_de = mapa_grupos(mc, grupos)
        filas = []
        for d in dias:
            tk = tickets_del_dia(mc["brand_id"], d)
            f = agregar(tk, d, m, mc, grupo_de, ia)
            filas.append(f)
            print(f"  {m} {d} ({f['dow']}): total={f['total']} ia={f['ia_resueltos']}/{f['ia_universo']} "
                  f"n2={f['esc_n2']} n3={f['esc_n3']}")
            for nv, subs in sorted(f["frentes"].items()):
                print(f"      {nv}: " + ", ".join(f"{k}={v}" for k, v in sorted(subs.items(), key=lambda x: -x[1])))
            if len(filas) >= 15:          # sube por lotes en backfills largos
                upsert(filas); filas = []
        upsert(filas)
    print("UPSERT OK en ingreso_diario")


if __name__ == "__main__":
    main()
