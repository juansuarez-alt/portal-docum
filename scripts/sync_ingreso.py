#!/usr/bin/env python3
"""
Portal DOCUM · Sincronización de Ingreso Diario  (v2)
──────────────────────────────────────────────────────
Igual que la v1, pero además guarda una MUESTRA de asuntos/descripciones
representativos por flujo y por tema, para que el análisis por IA pueda
explicar causas y proponer soluciones (no solo repetir conteos).

Uso:
  python sync_ingreso.py
  python sync_ingreso.py --date 2026-09-08
  python sync_ingreso.py --backfill 2026-09-01 2026-09-08

Variables de entorno: ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN,
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
"""
import os, sys, argparse, datetime as dt
from collections import defaultdict
from zoneinfo import ZoneInfo
import requests

BOGOTA = ZoneInfo("America/Bogota")
BRAND_ID = "47948014325787"

F_CATEGORIA    = 48014210120091
F_FLUJO        = 48024959818139
F_FLUJO_WIDGET = 50331399018395
F_SUBFLUJO     = 48028168084635
F_TIPO         = 51332842321179
F_TRASPASO     = 50592625412763
F_SLA_GRUPO    = 50882879330203

GRUPOS_N3 = {"N3 - Desarrollo", "N3 - Data"}
SLA_VENCIDO = {"Se Vencio", "Vencido"}
DOW_ES = {0: "Lun", 1: "Mar", 2: "Mié", 3: "Jue", 4: "Vie", 5: "Sáb", 6: "Dom"}

TEMAS = {
    "testigos": ["testigo"],
    "reclasificacion": ["reclasific"],
    "reasignacion": ["reasign"],
    "contrasena": ["contrase", "clave", "password"],
    "radicado_asociado": ["radicado asociado"],
    "clonado": ["clonad"],
}

# ── Parámetros de la muestra de textos ──
MUESTRA_CAP = 8      # máx. de ejemplos por flujo / por tema
MUESTRA_LEN = 200    # máx. de caracteres por ejemplo


def env(name):
    v = os.environ.get(name)
    if not v:
        sys.exit(f"Falta la variable de entorno {name}")
    return v


def zendesk_pull(created_from_utc):
    sub = env("ZENDESK_SUBDOMAIN")
    auth = (f'{env("ZENDESK_EMAIL")}/token', env("ZENDESK_API_TOKEN"))
    query = f"type:ticket brand:{BRAND_ID} created>={created_from_utc:%Y-%m-%d}"
    url = f"https://{sub}.zendesk.com/api/v2/search/export"
    params = {"query": query, "filter[type]": "ticket", "page[size]": 1000}
    out = []
    while True:
        r = requests.get(url, auth=auth, params=params, timeout=60)
        r.raise_for_status()
        data = r.json()
        out.extend(data.get("results", []))
        if data.get("meta", {}).get("has_more") and data.get("links", {}).get("next"):
            url, params = data["links"]["next"], None
        else:
            break
    return out


def cf(ticket):
    return {c["id"]: (c.get("value") or "") for c in ticket.get("custom_fields", [])}


def flujo_de(fields, tags):
    f = (fields.get(F_FLUJO) or "").strip()
    if f:
        return f
    w = (fields.get(F_FLUJO_WIDGET) or "").strip()
    if w.endswith("_clone"):
        return w[:-6]
    for t in tags:
        if t.endswith("_clone"):
            return t[:-6]
    return "sin_flujo"


def snippet(t):
    s = (t.get("subject") or "").strip()
    d = (t.get("description") or "").strip().replace("\n", " ")
    txt = f"{s} — {d}" if s and d else (s or d)
    return " ".join(txt.split())[:MUESTRA_LEN]


def aggregate(tickets, dia):
    flujo = defaultdict(int); tipo = defaultdict(int); categoria = defaultdict(int)
    grupo = defaultdict(int); sla = defaultdict(int); temas = {k: 0 for k in TEMAS}
    m_flujo = defaultdict(list); m_tema = defaultdict(list)
    total = escalado = sla_venc = 0

    for t in tickets:
        created = dt.datetime.fromisoformat(t["created_at"].replace("Z", "+00:00")).astimezone(BOGOTA)
        if created.strftime("%Y-%m-%d") != dia:
            continue
        total += 1
        fields = cf(t); tags = t.get("tags", []) or []

        fl = flujo_de(fields, tags)
        flujo[fl] += 1
        tipo[(fields.get(F_TIPO) or "sin_tipo")] += 1
        categoria[(fields.get(F_CATEGORIA) or "sin_categoria")] += 1

        g_raw = (fields.get(F_TRASPASO) or "").strip()
        g = g_raw.split(" | ")[0].strip() if g_raw else "(sin dato)"
        grupo[g] += 1
        if g in GRUPOS_N3:
            escalado += 1

        s = (fields.get(F_SLA_GRUPO) or "(sin dato)").strip() or "(sin dato)"
        sla[s] += 1
        if s in SLA_VENCIDO:
            sla_venc += 1

        snip = snippet(t)
        if snip and len(m_flujo[fl]) < MUESTRA_CAP:
            m_flujo[fl].append(snip)

        blob = " ".join([
            t.get("subject") or "", t.get("description") or "",
            fields.get(F_SUBFLUJO) or "", " ".join(tags),
        ]).lower()
        for tema, pats in TEMAS.items():
            if any(p in blob for p in pats):
                temas[tema] += 1
                if snip and len(m_tema[tema]) < MUESTRA_CAP:
                    m_tema[tema].append(snip)

    return {
        "dia": dia,
        "dow": DOW_ES[dt.date.fromisoformat(dia).weekday()],
        "total": total, "escalado": escalado, "no_escalado": total - escalado,
        "sla_vencidos": sla_venc,
        "flujo": dict(flujo), "tipo": dict(tipo), "categoria": dict(categoria),
        "grupo": dict(grupo), "sla": dict(sla), "temas": temas,
        "muestra": {"flujo": dict(m_flujo), "tema": dict(m_tema)},
    }


def upsert(rows):
    url = f'{env("SUPABASE_URL")}/rest/v1/docum_ingreso_diario'
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    headers = {
        "apikey": key, "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    r = requests.post(url, headers=headers, json=rows, timeout=60)
    if r.status_code in (401, 403):
        headers.pop("Authorization", None)   # llaves nuevas sb_secret_ van solo en apikey
        r = requests.post(url, headers=headers, json=rows, timeout=60)
    r.raise_for_status()


def dias_objetivo(args):
    if args.backfill:
        d0, d1 = (dt.date.fromisoformat(x) for x in args.backfill)
        return [(d0 + dt.timedelta(days=i)).isoformat() for i in range((d1 - d0).days + 1)]
    if args.date:
        return [args.date]
    ayer = (dt.datetime.now(BOGOTA) - dt.timedelta(days=1)).date()
    return [ayer.isoformat()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date")
    ap.add_argument("--backfill", nargs=2, metavar=("DESDE", "HASTA"))
    args = ap.parse_args()

    dias = dias_objetivo(args)
    desde = dt.date.fromisoformat(min(dias)) - dt.timedelta(days=1)
    print(f"Consultando Zendesk desde {desde} para días: {', '.join(dias)}")
    tickets = zendesk_pull(dt.datetime(desde.year, desde.month, desde.day, tzinfo=BOGOTA))
    print(f"Tickets traídos: {len(tickets)}")

    rows = [aggregate(tickets, d) for d in dias]
    for r in rows:
        print(f"  {r['dia']} ({r['dow']}): total={r['total']} escalado={r['escalado']} "
              f"sla_vencidos={r['sla_vencidos']} muestras_flujo={len(r['muestra']['flujo'])}")
    upsert(rows)
    print(f"UPSERT OK: {len(rows)} fila(s) en docum_ingreso_diario")


if __name__ == "__main__":
    main()
