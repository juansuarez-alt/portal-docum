#!/usr/bin/env python3
"""
Portal Mesa de Ayuda · Satisfacción (CSAT) MULTIMARCA
─────────────────────────────────────────────────────
Por cada marca ACTIVA en Zendesk y cada día, toma los tickets RESUELTOS
ese día (hora Colombia) y lee la calificación que dejó el usuario en el ticket
(satisfaction_rating.score = good / bad / offered / unoffered).

Guarda en Supabase (tabla satisfaccion_diaria):
  · buenas, malas y ofrecidas (encuesta enviada sin respuesta)
  · por analista (asignado del ticket): tickets resueltos, buenas, malas y sin respuesta
  · el mismo conteo por grupo
  · el detalle de las calificaciones malas (ticket, analista, motivo, comentario)

CSAT % = buenas / (buenas + malas)  → misma fórmula que Zendesk Explore.

Uso:
  python sync_satisfaccion.py                        # últimos 10 días, todas las marcas
  python sync_satisfaccion.py --marca BALU
  python sync_satisfaccion.py --date 2026-09-08
  python sync_satisfaccion.py --backfill 2026-09-01 2026-09-23

Variables de entorno: ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN,
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
"""
import os, sys, json, time, argparse, unicodedata, datetime as dt
from collections import defaultdict
from zoneinfo import ZoneInfo
import requests

BOGOTA = ZoneInfo("America/Bogota")
SIN_ASIGNAR = "0"          # clave para tickets sin asignado (IA / bot)
MAX_DETALLE = 300          # máx. calificaciones malas guardadas por marca y día


def env(name):
    v = os.environ.get(name)
    if not v:
        sys.exit(f"Falta la variable de entorno {name}")
    return v


def base():
    return f'https://{env("ZENDESK_SUBDOMAIN")}.zendesk.com'


def zd_get(url, params=None):
    auth = (f'{env("ZENDESK_EMAIL")}/token', env("ZENDESK_API_TOKEN"))
    for intento in range(6):
        r = requests.get(url, auth=auth, params=params, timeout=90)
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


def clave_marca(nombre):
    s = unicodedata.normalize("NFD", str(nombre or ""))
    return "".join(c for c in s if unicodedata.category(c) != "Mn").strip().upper()


def cargar_marcas():
    """Todas las marcas activas de Zendesk. La clave es el nombre sin tildes en mayúscula
    (Balú → BALU, DOCUM → DOCUM), igual que en el selector del portal."""
    data = zd_get(f"{base()}/api/v2/brands.json")
    return {clave_marca(b["name"]): {"brand_id": b["id"], "nombre": b["name"]}
            for b in data.get("brands", []) if b.get("active")}


def grupos_zendesk():
    out, url, params = {}, f"{base()}/api/v2/groups.json", {"page[size]": 100}
    while url:
        data = zd_get(url, params)
        for g in data.get("groups", []):
            out[g["id"]] = g["name"]
        url = data["links"]["next"] if data.get("meta", {}).get("has_more") else None
        params = None
    return out


def usuarios(ids, cache):
    """Nombre y correo de los asignados (show_many, 100 por llamada)."""
    faltan = [i for i in ids if i not in cache]
    for k in range(0, len(faltan), 100):
        lote = ",".join(str(x) for x in faltan[k:k + 100])
        data = zd_get(f"{base()}/api/v2/users/show_many.json", {"ids": lote})
        for u in data.get("users", []):
            cache[u["id"]] = (u.get("name") or f"Usuario {u['id']}", (u.get("email") or "").lower())
    return cache


def resueltos_del_dia(brand_id, dia):
    sig = (dt.date.fromisoformat(dia) + dt.timedelta(days=1)).isoformat()
    query = (f"type:ticket brand:{brand_id} "
             f"solved>={dia}T00:00:00-05:00 solved<{sig}T00:00:00-05:00")
    url = f"{base()}/api/v2/search/export"
    params = {"query": query, "filter[type]": "ticket", "page[size]": 1000}
    out = []
    while url:
        data = zd_get(url, params)
        out.extend(data.get("results", []))
        url = data["links"]["next"] if data.get("meta", {}).get("has_more") and data.get("links", {}).get("next") else None
        params = None
    return out


def agregar(tickets, dia, marca, grupos):
    ana = defaultdict(lambda: {"t": 0, "b": 0, "m": 0, "o": 0})
    grp = defaultdict(lambda: {"b": 0, "m": 0, "o": 0})
    malas, b, m, o = [], 0, 0, 0
    vistos = set()
    for t in tickets:
        if t["id"] in vistos:
            continue
        vistos.add(t["id"])
        aid = str(t.get("assignee_id") or SIN_ASIGNAR)
        gname = grupos.get(t.get("group_id"), "Sin grupo")
        ana[aid]["t"] += 1                      # todo ticket resuelto cuenta, tenga o no encuesta
        sr = t.get("satisfaction_rating") or {}
        score = (sr.get("score") or "unoffered").lower()
        clave = {"good": "b", "goodwithcomment": "b", "bad": "m", "badwithcomment": "m", "offered": "o"}.get(score)
        if not clave:
            continue
        ana[aid][clave] += 1
        grp[gname][clave] += 1
        if clave == "b": b += 1
        elif clave == "m":
            m += 1
            if len(malas) < MAX_DETALLE:
                malas.append({"t": t["id"], "a": aid, "g": gname,
                              "r": sr.get("reason") if sr.get("reason") not in (None, "No se proporcionó una razón") else None,
                              "c": (sr.get("comment") or "")[:300] or None})
        else: o += 1
    return {
        "marca": marca, "dia": dia, "resueltos": len(vistos),
        "buenas": b, "malas": m, "ofrecidas": o,
        "analistas": dict(ana), "grupos": dict(grp), "malas_detalle": malas,
        "actualizado": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def upsert(rows):
    if not rows:
        return
    url = f'{env("SUPABASE_URL")}/rest/v1/satisfaccion_diaria?on_conflict=marca,dia'
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
               "Prefer": "resolution=merge-duplicates,return=minimal"}
    r = requests.post(url, headers=headers, json=rows, timeout=60)
    if r.status_code in (401, 403):
        headers.pop("Authorization", None)
        r = requests.post(url, headers=headers, json=rows, timeout=60)
    if not r.ok:
        print("SUPABASE ERROR:", r.status_code, r.text)
    r.raise_for_status()


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
    ap.add_argument("--marca")
    ap.add_argument("--date")
    ap.add_argument("--backfill", nargs=2, metavar=("DESDE", "HASTA"))
    ap.add_argument("--ultimos", type=int, default=10)
    args = ap.parse_args()

    marcas = cargar_marcas()
    if args.marca:
        clave = args.marca.strip().upper()
        if clave not in marcas:
            sys.exit(f"La marca {clave} no está activa en Zendesk. Disponibles: {', '.join(marcas)}")
        marcas = {clave: marcas[clave]}

    grupos = grupos_zendesk()
    dias = dias_objetivo(args)
    print(f"Días: {dias[0]} → {dias[-1]} ({len(dias)})  Marcas: {', '.join(marcas)}")
    cache = {}

    for marca, mc in marcas.items():
        filas = []
        for d in dias:
            f = agregar(resueltos_del_dia(mc["brand_id"], d), d, marca, grupos)
            if not f["resueltos"]:
                continue                         # marca sin tickets resueltos ese día
            ids = [int(a) for a in f["analistas"] if a != SIN_ASIGNAR]
            usuarios(ids, cache)
            for aid, v in f["analistas"].items():
                if aid == SIN_ASIGNAR:
                    v["n"], v["e"] = "Agente IA / sin asignar", ""
                else:
                    v["n"], v["e"] = cache.get(int(aid), (f"Usuario {aid}", ""))
            resp = f["buenas"] + f["malas"]
            csat = f"{f['buenas'] * 100 / resp:.1f}%" if resp else "—"
            print(f"  {marca} {d}: resueltos={f['resueltos']} buenas={f['buenas']} malas={f['malas']} "
                  f"sin_respuesta={f['ofrecidas']} CSAT={csat}")
            filas.append(f)
            if len(filas) >= 10:
                upsert(filas); filas = []
        upsert(filas)
    print("UPSERT OK en satisfaccion_diaria")


if __name__ == "__main__":
    main()
