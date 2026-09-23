import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient.js'
import IngresoDiario from './IngresoDiario.jsx'

/* ── Ingreso diario MULTIMARCA ────────────────────────────────
   Lee la tabla ingreso_diario (la llena scripts/sync_ingreso_marcas.py)
   para la marca elegida en el selector del portal.
   1. Vista general (total + reparto por frente; clic = filtrar frente)
   2. Tickets por frente
   3. Periodicidad día / semana / mes
   4. Picos de tráfico por mes
   5. Absorción de la IA
   6. Escalamientos N2 / N3
   En DOCUM se conserva el detalle por flujo (IngresoDiario.jsx). */

const NIVEL_ORDEN = ['N1', 'N2', 'N3', 'IA']
const NIVEL_LABEL = { N1: 'N1', N2: 'N2 Soporte', N3: 'N3', IA: 'Solo IA / sin asignar' }
const NIVEL_COLOR = { N1: '#38bdf8', N2: '#f59e0b', N3: '#f472b6', IA: '#2dd4bf' }
const SUB_COLORS = ['#38bdf8', '#818cf8', '#a3e635', '#fb923c', '#e879f9', '#facc15', '#34d399', '#f87171', '#60a5fa', '#c084fc', '#94a3b8', '#fda4af']
const etqNivel = n => NIVEL_LABEL[n] || n
const sumObj = o => Object.values(o || {}).reduce((a, b) => a + b, 0)

/* Acepta el formato nuevo {N1:{Atención:..}, N2:{..}} y el anterior plano {Atención:.., 'Sin grupo':..} */
function normNiveles(fr) {
  const out = {}
  Object.entries(fr || {}).forEach(([k, v]) => {
    if (v && typeof v === 'object') {
      const d = (out[k] ||= {}); Object.entries(v).forEach(([s, n]) => (d[s] = (d[s] || 0) + n))
    } else {
      const nivel = k === 'Sin grupo' ? 'IA' : (k === 'N2' || k === 'N3') ? k : 'N1'
      const sub = k === 'Sin grupo' ? 'Solo IA / sin asignar' : k
      const d = (out[nivel] ||= {}); d[sub] = (d[sub] || 0) + v
    }
  })
  return out
}
const PICO = '#ef4444'
const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const DSEM = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const nf = new Intl.NumberFormat('es-CO')

const claveMarca = m => String(m || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase()
const pct = (n, d) => (d ? (n * 100) / d : 0)
const fpct = x => `${(Math.round(x * 10) / 10).toLocaleString('es-CO')}%`
const hoyBog = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const sumar = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d) }
const lunes = s => { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d) }
const dowIdx = s => (parse(s).getDay() + 6) % 7
const corto = s => { const d = parse(s); return `${DSEM[dowIdx(s)]} ${d.getDate()} ${meses[d.getMonth()]}` }
const rangoSem = (a, b) => {
  const x = parse(a), y = parse(b)
  return x.getMonth() === y.getMonth() ? `${x.getDate()}–${y.getDate()} ${meses[y.getMonth()]}` : `${x.getDate()} ${meses[x.getMonth()]}–${y.getDate()} ${meses[y.getMonth()]}`
}
const nomMes = k => { const [y, m] = k.split('-'); return `${meses[+m - 1]} ${y}` }

function presets() {
  const h = hoyBog(), d = parse(h)
  const iniMes = iso(new Date(d.getFullYear(), d.getMonth(), 1))
  return {
    mes: [iniMes, h],
    mesAnt: [iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), iso(new Date(d.getFullYear(), d.getMonth(), 0))],
    d7: [sumar(h, -6), h],
    d30: [sumar(h, -29), h],
    d90: [sumar(h, -89), h],
  }
}

export default function IngresoMarca({ marca }) {
  const clave = claveMarca(marca)
  const [vista, setVista] = useState('general')
  const [preset, setPreset] = useState('mes')
  const [[desde, hasta], setRango] = useState(presets().mes)
  const [gran, setGran] = useState('dia')
  const [frente, setFrente] = useState(null)
  const [rows, setRows] = useState([])
  const [estado, setEstado] = useState('loading')

  useEffect(() => { setFrente(null); setVista('general') }, [clave])

  useEffect(() => {
    let vivo = true
    setEstado('loading')
    ;(async () => {
      const { data, error } = await supabase.from('ingreso_diario').select('*')
        .eq('marca', clave).gte('dia', desde).lte('dia', hasta).order('dia', { ascending: true })
      if (!vivo) return
      if (error) { setEstado('error'); return }
      setRows(data || []); setEstado((data || []).length ? 'ready' : 'empty')
    })()
    return () => { vivo = false }
  }, [clave, desde, hasta])

  const elegirPreset = p => { setPreset(p); if (p !== 'custom') setRango(presets()[p]) }

  return (
    <div style={{ color: '#e6edf3' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, letterSpacing: '-0.02em', color: '#0f172a' }}>Ingreso {marca}</h2>
          <div style={{ color: '#64748b', fontSize: 13 }}>Marca {marca} · Zendesk · hora Colombia</div>
        </div>
        {clave === 'DOCUM' && (
          <div style={{ display: 'flex', borderRadius: 10, overflow: 'hidden', border: '1px solid #334155' }}>
            <Seg active={vista === 'general'} onClick={() => setVista('general')}>Panel general</Seg>
            <Seg active={vista === 'docum'} onClick={() => setVista('docum')}>Detalle por flujo</Seg>
          </div>
        )}
      </div>

      {vista === 'docum' ? <IngresoDiario /> : (
        <>
          <Filtros {...{ preset, elegirPreset, desde, hasta, setRango, setPreset, gran, setGran }} />
          {estado === 'loading' && <Msg>Cargando ingreso {marca}…</Msg>}
          {estado === 'error' && <Msg tone="#f87171">No se pudo leer la tabla ingreso_diario. Revisa que exista en Supabase y que tu sesión siga activa.</Msg>}
          {estado === 'empty' && <Msg>No hay datos de {marca} entre {corto(desde)} y {corto(hasta)}. Si la marca es nueva, córrele un backfill desde GitHub Actions → "Ingreso diario · Multimarca".</Msg>}
          {estado === 'ready' && <Tablero rows={rows} gran={gran} frente={frente} setFrente={setFrente} />}
        </>
      )}
    </div>
  )
}

/* ════════ Filtros ════════ */
function Filtros({ preset, elegirPreset, desde, hasta, setRango, setPreset, gran, setGran }) {
  const inp = { width: 150, background: '#0f1a2b', color: '#e6edf3', border: '1px solid #1e2b3c', borderRadius: 8, padding: '6px 10px' }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 16 }}>
      {[['mes', 'Este mes'], ['mesAnt', 'Mes anterior'], ['d7', '7 días'], ['d30', '30 días'], ['d90', '90 días']].map(([k, l]) =>
        <Pill key={k} active={preset === k} onClick={() => elegirPreset(k)}>{l}</Pill>)}
      <input type="date" value={desde} max={hasta} style={inp} onChange={e => { setPreset('custom'); setRango([e.target.value, hasta]) }} aria-label="Desde" />
      <input type="date" value={hasta} min={desde} style={inp} onChange={e => { setPreset('custom'); setRango([desde, e.target.value]) }} aria-label="Hasta" />
      <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid #334155', marginLeft: 'auto' }}>
        <Seg active={gran === 'dia'} onClick={() => setGran('dia')}>Día</Seg>
        <Seg active={gran === 'semana'} onClick={() => setGran('semana')}>Semana</Seg>
        <Seg active={gran === 'mes'} onClick={() => setGran('mes')}>Mes</Seg>
      </div>
    </div>
  )
}

/* ════════ Tablero ════════ */
function Tablero({ rows: rowsRaw, gran, frente: sel, setFrente: setSel }) {
  const rows = useMemo(() => rowsRaw.map(r => ({ ...r, nv: normNiveles(r.frentes) })), [rowsRaw])
  const valor = r => (!sel ? r.total : sel.sub ? (r.nv[sel.nivel]?.[sel.sub] || 0) : sumObj(r.nv[sel.nivel]))
  const foco = sel?.nivel || 'N1'

  /* Totales por nivel y subgrupo, colores estables */
  const est = useMemo(() => {
    const sub = {}
    rows.forEach(r => Object.entries(r.nv).forEach(([n, o]) => {
      const d = (sub[n] ||= {}); Object.entries(o).forEach(([s, v]) => (d[s] = (d[s] || 0) + v))
    }))
    const niveles = [...NIVEL_ORDEN.filter(n => sub[n]), ...Object.keys(sub).filter(n => !NIVEL_ORDEN.includes(n))]
    const tot = {}; niveles.forEach(n => (tot[n] = sumObj(sub[n])))
    const subsDe = n => Object.keys(sub[n] || {}).sort((a, b) => sub[n][b] - sub[n][a])
    const color = {}
    niveles.forEach(n => subsDe(n).forEach((s, i) => (color[`${n}|${s}`] = subsDe(n).length === 1 ? (NIVEL_COLOR[n] || SUB_COLORS[0]) : SUB_COLORS[i % SUB_COLORS.length])))
    return { sub, niveles, tot, subsDe, color }
  }, [rows])
  const colorNivel = n => NIVEL_COLOR[n] || '#94a3b8'
  const colorSub = (n, s) => est.color[`${n}|${s}`] || colorNivel(n)

  const periodos = useMemo(() => {
    const keyOf = f => gran === 'dia' ? f : gran === 'semana' ? lunes(f) : f.slice(0, 7)
    const map = new Map()
    rows.forEach(r => {
      const k = keyOf(r.dia)
      if (!map.has(k)) map.set(k, { key: k, ini: r.dia, fin: r.dia, total: 0, nv: {}, iaU: 0, iaR: 0, n2: 0, n3: 0 })
      const p = map.get(k)
      p.fin = r.dia; p.total += r.total; p.iaU += r.ia_universo; p.iaR += r.ia_resueltos; p.n2 += r.esc_n2; p.n3 += r.esc_n3
      Object.entries(r.nv).forEach(([n, o]) => { const d = (p.nv[n] ||= {}); Object.entries(o).forEach(([s, v]) => (d[s] = (d[s] || 0) + v)) })
    })
    return [...map.values()].map(p => ({
      ...p,
      label: gran === 'dia' ? corto(p.key) : gran === 'semana' ? rangoSem(p.ini, p.fin) : nomMes(p.key),
      corto: gran === 'dia' ? `${parse(p.key).getDate()}` : gran === 'semana' ? rangoSem(p.ini, p.fin) : nomMes(p.key),
    }))
  }, [rows, gran])

  const picos = useMemo(() => {
    const vals = rows.map(valor), n = vals.length || 1
    const media = vals.reduce((a, b) => a + b, 0) / n
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - media) ** 2, 0) / n)
    const esPico = new Set(rows.filter(r => valor(r) > media + sd && valor(r) > 0).map(r => r.dia))
    const porMes = {}
    rows.forEach(r => {
      const m = r.dia.slice(0, 7), w = lunes(r.dia)
      const M = (porMes[m] ||= { dia: null, sem: {} })
      if (!M.dia || valor(r) > valor(M.dia)) M.dia = r
      const S = (M.sem[w] ||= { ini: r.dia, fin: r.dia, t: 0 })
      S.t += valor(r); S.fin = r.dia
    })
    const resumen = Object.keys(porMes).sort().map(m => ({ mes: m, dia: porMes[m].dia, sem: Object.values(porMes[m].sem).sort((a, b) => b.t - a.t)[0] }))
    const top = [...rows].sort((a, b) => valor(b) - valor(a)).slice(0, 5)
    const sumD = Array(7).fill(0), cntD = Array(7).fill(0)
    rows.forEach(r => { sumD[dowIdx(r.dia)] += valor(r); cntD[dowIdx(r.dia)]++ })
    const promDow = sumD.map((s, i) => (cntD[i] ? Math.round(s / cntD[i]) : 0))
    const horas = Array(24).fill(0)
    rows.forEach(r => (r.horas || []).forEach((x, i) => (horas[i] += x)))
    let franja = 0
    for (let i = 1; i < 23; i++) if (horas[i] + horas[i + 1] > horas[franja] + horas[franja + 1]) franja = i
    return { media, esPico, resumen, top, promDow, horas, franja }
  }, [rows, sel]) // eslint-disable-line react-hooks/exhaustive-deps

  const total = rows.reduce((a, r) => a + r.total, 0)
  const selTotal = !sel ? total : sel.sub ? (est.sub[sel.nivel]?.[sel.sub] || 0) : (est.tot[sel.nivel] || 0)
  const selLabel = !sel ? 'todos los niveles' : sel.sub ? `${etqNivel(sel.nivel)} · ${sel.sub}` : etqNivel(sel.nivel)
  const selColor = !sel ? '#5eead4' : sel.sub ? colorSub(sel.nivel, sel.sub) : colorNivel(sel.nivel)
  const iaU = rows.reduce((a, r) => a + r.ia_universo, 0), iaR = rows.reduce((a, r) => a + r.ia_resueltos, 0)
  const n2 = rows.reduce((a, r) => a + r.esc_n2, 0), n3 = rows.reduce((a, r) => a + r.esc_n3, 0)
  const nomGran = { dia: 'día', semana: 'semana', mes: 'mes' }[gran]
  const actualizado = rows.reduce((a, r) => (r.actualizado > a ? r.actualizado : a), '')
  const subsFoco = est.subsDe(foco)

  const clicNivel = n => setSel(s => (s && s.nivel === n && !s.sub ? null : { nivel: n }))
  const clicSub = s => setSel(x => (x && x.nivel === foco && x.sub === s ? { nivel: foco } : { nivel: foco, sub: s }))

  /* Serie del gráfico de volumen según la selección */
  let series, colorSerie, valorDe
  if (!sel) { series = est.niveles; colorSerie = Object.fromEntries(series.map(n => [n, colorNivel(n)])); valorDe = (p, n) => sumObj(p.nv[n]) }
  else if (!sel.sub) { series = est.subsDe(sel.nivel); colorSerie = Object.fromEntries(series.map(s => [s, colorSub(sel.nivel, s)])); valorDe = (p, s) => p.nv[sel.nivel]?.[s] || 0 }
  else { series = [sel.sub]; colorSerie = { [sel.sub]: selColor }; valorDe = (p, s) => p.nv[sel.nivel]?.[s] || 0 }
  const leyenda = !sel ? est.niveles.map(n => [colorNivel(n), etqNivel(n)]) : !sel.sub ? series.map(s => [colorSerie[s], s]) : []

  return (
    <>
      {/* 1 · Vista general */}
      <div style={{ borderRadius: 12, padding: 20, background: '#0f1a2b', border: '1px solid #1e2b3c', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '4px 14px' }}>
          <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: '-0.03em', color: selColor, lineHeight: 1 }}>{nf.format(selTotal)}</span>
          <span style={{ color: '#8aa0b6', fontSize: 14 }}>
            {sel ? `tickets en ${selLabel} · ${fpct(pct(selTotal, total))} de ${nf.format(total)}` : `tickets de todos los niveles · ${rows.length} días`}
          </span>
          {sel && <button onClick={() => setSel(null)} style={{ ...btnSec, marginLeft: 'auto' }}>Ver todo el ingreso</button>}
        </div>

        {/* Barra por nivel */}
        <div style={{ display: 'flex', height: 26, borderRadius: 6, overflow: 'hidden', margin: '16px 0 12px', background: '#16223a' }}>
          {est.niveles.map(n => (
            <button key={n} title={`${etqNivel(n)}: ${nf.format(est.tot[n])}`} aria-label={`Filtrar ${etqNivel(n)}`} onClick={() => clicNivel(n)}
              style={{ flex: est.tot[n] || 0.0001, minWidth: 3, border: 'none', padding: 0, cursor: 'pointer', background: colorNivel(n), opacity: sel && sel.nivel !== n ? 0.25 : 1 }} />
          ))}
        </div>

        {/* Participación de la IA */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 22px', alignItems: 'baseline', padding: '10px 12px', margin: '0 0 12px', borderRadius: 10, background: '#0b1420', border: '1px solid #1e2b3c', fontSize: 13.5, color: '#a8b3d9' }}>
          <span style={{ color: '#2dd4bf', fontWeight: 600 }}>Agente IA</span>
          <span>Atendió <b style={{ color: '#e6edf3' }}>{nf.format(iaU)}</b> ({fpct(pct(iaU, total))} del ingreso)</span>
          <span>Resolvió <b style={{ color: '#e6edf3' }}>{nf.format(iaR)}</b> sin pasar a un asesor</span>
          <span>Pasaron a asesor o quedaron sin resolver <b style={{ color: '#e6edf3' }}>{nf.format(iaU - iaR)}</b></span>
          <span>Absorción <b style={{ color: '#4ade80' }}>{iaU ? fpct(pct(iaR, iaU)) : '—'}</b></span>
        </div>

        {/* 2 · Niveles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
          {est.niveles.map(n => {
            const activo = sel?.nivel === n
            return (
              <button key={n} onClick={() => clicNivel(n)} aria-pressed={activo}
                style={{ textAlign: 'left', cursor: 'pointer', borderRadius: 10, padding: '10px 12px', background: activo ? '#16223a' : 'transparent', border: `1px solid ${activo ? colorNivel(n) : '#1e2b3c'}`, color: '#e6edf3' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#8aa0b6' }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: colorNivel(n) }} />{etqNivel(n)}
                  {est.subsDe(n).length > 1 && <span style={{ marginLeft: 'auto', fontSize: 11.5, color: '#64748b' }}>{est.subsDe(n).length} grupos</span>}
                </div>
                <div style={{ fontSize: 24, fontWeight: 600, marginTop: 4 }}>{nf.format(est.tot[n])}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{fpct(pct(est.tot[n], total))} del ingreso</div>
              </button>
            )
          })}
        </div>

        {/* Grupos dentro del nivel en foco (N1 por defecto) */}
        {subsFoco.length > 1 && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #1e2b3c' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>Grupos dentro de {etqNivel(foco)}</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>Clic en un grupo para aislarlo · {nf.format(est.tot[foco])} tickets en {etqNivel(foco)}</div>
            </div>
            <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', marginBottom: 10, background: '#16223a' }}>
              {subsFoco.map(s => <div key={s} title={`${s}: ${nf.format(est.sub[foco][s])}`} style={{ flex: est.sub[foco][s], background: colorSub(foco, s), opacity: sel?.sub && sel.sub !== s ? 0.25 : 1 }} />)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6 }}>
              {subsFoco.map(s => {
                const activo = sel?.nivel === foco && sel?.sub === s
                return (
                  <button key={s} onClick={() => clicSub(s)} aria-pressed={activo}
                    style={{ textAlign: 'left', cursor: 'pointer', borderRadius: 8, padding: '7px 10px', background: activo ? '#16223a' : 'transparent', border: `1px solid ${activo ? colorSub(foco, s) : '#1e2b3c'}`, color: '#e6edf3' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#a8b3d9', overflow: 'hidden' }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: colorSub(foco, s), flex: 'none' }} />
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={s}>{s}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
                      <span style={{ fontSize: 17, fontWeight: 600 }}>{nf.format(est.sub[foco][s])}</span>
                      <span style={{ fontSize: 11.5, color: '#64748b' }}>{fpct(pct(est.sub[foco][s], est.tot[foco]))} de {foco}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* 3 · Periodicidad */}
      <Panel title={`Ingreso por ${nomGran}${sel ? ` · ${selLabel}` : ''}`}
        subtitle={sel?.sub ? (gran === 'dia' ? 'En rojo, los días que superan el promedio más una desviación estándar' : 'Solo el grupo seleccionado')
          : sel ? `Grupos de ${etqNivel(sel.nivel)} apilados · clic en un grupo arriba para aislarlo` : 'Niveles apilados · clic en un nivel arriba para ver sus grupos'}>
        <Barras periodos={periodos} series={series} color={colorSerie} valorDe={valorDe}
          pico={p => gran === 'dia' && sel && picos.esPico.has(p.key) && series.length === 1} />
        {leyenda.length > 0 && <Legend items={leyenda} />}
      </Panel>

      {/* 4 · Picos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginTop: 12 }}>
        <Panel title="Picos de tráfico" subtitle={`Promedio diario: ${nf.format(Math.round(picos.media))}${sel ? ` · ${selLabel}` : ''}`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {picos.resumen.map(m => m.dia && (
              <div key={m.mes} style={{ borderLeft: `3px solid ${PICO}`, paddingLeft: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5, textTransform: 'capitalize', marginBottom: 2 }}>{nomMes(m.mes)}</div>
                <Linea k={`Día pico · ${corto(m.dia.dia)}`} v={nf.format(valor(m.dia))} />
                <Linea k={`Semana pico · ${rangoSem(m.sem.ini, m.sem.fin)}`} v={nf.format(m.sem.t)} />
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: '#8aa0b6', margin: '16px 0 6px' }}>Los 5 días con más ingreso</div>
          {picos.top.map(r => (
            <Linea key={r.dia} k={<>{corto(r.dia)}{picos.esPico.has(r.dia) && <span style={{ marginLeft: 6, fontSize: 11, color: PICO, border: `1px solid ${PICO}`, borderRadius: 999, padding: '0 6px' }}>pico</span>}</>} v={nf.format(valor(r))} borde />
          ))}
        </Panel>
        <Panel title="Cuándo llega el tráfico" subtitle="Promedio por día de la semana y suma por hora (la hora es de todo el ingreso)">
          <MiniBarras datos={picos.promDow} etiquetas={DSEM} color={sel ? selColor : '#22d3ee'} alto={110} />
          <div style={{ height: 14 }} />
          <MiniBarras datos={picos.horas} etiquetas={picos.horas.map((_, i) => (i % 3 === 0 ? `${i}h` : ''))} color="#38bdf8"
            destacar={i => i === picos.franja || i === picos.franja + 1} alto={110} />
          <div style={{ fontSize: 13, color: '#a8b3d9', marginTop: 10 }}>
            Franja pico: <b style={{ color: '#e6edf3' }}>{picos.franja}:00 a {picos.franja + 2}:00</b> ·{' '}
            {fpct(pct(picos.horas[picos.franja] + picos.horas[picos.franja + 1], picos.horas.reduce((a, b) => a + b, 0)))} del ingreso
          </div>
        </Panel>
      </div>

      {/* 5 · IA  y  6 · Escalamientos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginTop: 12 }}>
        <Panel title="Absorción de la IA" subtitle="Conversaciones que atendió el agente IA en el rango">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8, marginBottom: 14 }}>
            <Cifra label="Resueltos por la IA" v={nf.format(iaR)} c="#2dd4bf" />
            <Cifra label="No resueltos por la IA" v={nf.format(iaU - iaR)} c="#94a3b8" />
            <Cifra label="Absorción" v={iaU ? fpct(pct(iaR, iaU)) : '—'} c="#4ade80" />
          </div>
          <div style={{ height: 10, borderRadius: 5, background: '#16223a', overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ width: `${pct(iaR, iaU)}%`, height: '100%', background: '#2dd4bf' }} />
          </div>
          <div style={{ fontSize: 12, color: '#8aa0b6', marginBottom: 6 }}>Absorción por {nomGran}</div>
          <Tendencia puntos={periodos.map(p => ({ l: p.corto, y: pct(p.iaR, p.iaU), t: `${p.label}: ${fpct(pct(p.iaR, p.iaU))} (${nf.format(p.iaR)} de ${nf.format(p.iaU)})` }))} />
        </Panel>
        <Panel title="Escalamientos" subtitle="Casos escalados a N2 (Soporte) y a N3">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8, marginBottom: 14 }}>
            <Cifra label="Escalados a N2" v={nf.format(n2)} c={NIVEL_COLOR.N2} />
            <Cifra label="Escalados a N3" v={nf.format(n3)} c={NIVEL_COLOR.N3} />
            <Cifra label="Del total" v={fpct(pct(n2 + n3, total))} c="#e6edf3" />
          </div>
          <Barras periodos={periodos} series={['n2', 'n3']} color={{ n2: NIVEL_COLOR.N2, n3: NIVEL_COLOR.N3 }} valorDe={(p, s) => p[s]} alto={130} />
          <Legend items={[[NIVEL_COLOR.N2, 'N2 Soporte'], [NIVEL_COLOR.N3, 'N3']]} />
        </Panel>
      </div>

      {/* Detalle */}
      <div style={{ marginTop: 12 }}>
        <Panel title={`Detalle por ${nomGran}`} subtitle={`Niveles y grupos de ${etqNivel(foco)} · descárgalo para cruzarlo con otros reportes`}>
          <Detalle periodos={periodos} niveles={est.niveles} foco={foco} subs={subsFoco} gran={gran} esPico={picos.esPico} />
        </Panel>
      </div>
      {actualizado && <div style={{ fontSize: 12, color: '#64748b', marginTop: 10 }}>Última sincronización: {new Date(actualizado).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}. El sync corre cada 2 horas y recalcula los últimos 7 días.</div>}
    </>
  )
}

/* ════════ Gráficos (sin librerías) ════════ */
function Barras({ periodos, series, color, valorDe, pico = () => false, alto = 180 }) {
  const tot = p => series.reduce((a, s) => a + valorDe(p, s), 0)
  const max = Math.max(...periodos.map(tot), 1)
  const muchos = periodos.length > 20
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: muchos ? 3 : 8, height: alto + 40, minWidth: periodos.length * (muchos ? 16 : 44) }}>
        {periodos.map(p => {
          const t = tot(p), h = (t / max) * alto
          return (
            <div key={p.key} title={`${p.label}: ${nf.format(t)}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0 }}>
              {!muchos && <div style={{ fontSize: 11.5, color: '#8aa0b6', marginBottom: 4 }}>{nf.format(t)}</div>}
              <div style={{ width: '80%', height: h, borderRadius: 3, overflow: 'hidden', display: 'flex', flexDirection: 'column-reverse', background: '#16223a' }}>
                {series.map(s => {
                  const v = valorDe(p, s)
                  return v ? <div key={s} style={{ height: t ? (v / t) * h : 0, background: pico(p) ? PICO : color[s] }} /> : null
                })}
              </div>
              <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 6, whiteSpace: 'nowrap' }}>{p.corto}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MiniBarras({ datos, etiquetas, color, destacar = () => false, alto = 100 }) {
  const max = Math.max(...datos, 1)
  const mayor = datos.indexOf(Math.max(...datos))
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: alto + 20 }}>
      {datos.map((v, i) => (
        <div key={i} title={`${etiquetas[i] || i}: ${nf.format(v)}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ width: '85%', height: (v / max) * alto, borderRadius: 2, background: destacar(i) || (datos.length === 7 && i === mayor && v > 0) ? PICO : color }} />
          <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 4, height: 12 }}>{etiquetas[i]}</div>
        </div>
      ))}
    </div>
  )
}

function Tendencia({ puntos }) {
  if (!puntos.length) return null
  const W = 600, H = 110, pad = 6
  const x = i => (puntos.length === 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (puntos.length - 1))
  const y = v => H - pad - (v / 100) * (H - 2 * pad)
  const d = puntos.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H }} role="img" aria-label="Tendencia de absorción de la IA">
      {[0, 50, 100].map(g => <line key={g} x1={0} x2={W} y1={y(g)} y2={y(g)} stroke="#1e2b3c" />)}
      <path d={d} fill="none" stroke="#2dd4bf" strokeWidth="2" />
      {puntos.length <= 40 && puntos.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.y)} r="3" fill="#2dd4bf"><title>{p.t}</title></circle>)}
      <text x={W - 2} y={y(100) + 10} textAnchor="end" fontSize="10" fill="#64748b">100%</text>
      <text x={W - 2} y={y(50) - 3} textAnchor="end" fontSize="10" fill="#64748b">50%</text>
    </svg>
  )
}

function Detalle({ periodos, niveles, foco, subs, gran, esPico }) {
  const cols = [
    { k: 'Periodo', f: p => p.label },
    { k: 'Total', f: p => p.total },
    ...niveles.map(n => ({ k: etqNivel(n), f: p => sumObj(p.nv[n]) })),
    ...(subs.length > 1 ? subs.map(s => ({ k: `${foco} · ${s}`, f: p => p.nv[foco]?.[s] || 0 })) : []),
    { k: 'Atendidos IA', f: p => p.iaU },
    { k: 'Resueltos IA', f: p => p.iaR },
    { k: 'No resueltos IA', f: p => p.iaU - p.iaR },
    { k: '% absorción', f: p => pct(p.iaR, p.iaU), pct: true },
    { k: 'Esc. N2', f: p => p.n2 },
    { k: 'Esc. N3', f: p => p.n3 },
  ]
  function csv() {
    const txt = [cols.map(c => c.k).join(';'), ...periodos.map(p => cols.map((c, i) => {
      const v = i === 0 ? p.key : c.f(p)
      return c.pct ? String(Math.round(v * 10) / 10).replace('.', ',') : v
    }).join(';'))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['\ufeff' + txt], { type: 'text/csv;charset=utf-8' }))
    a.download = `ingreso_${periodos[0]?.ini}_${periodos[periodos.length - 1]?.fin}_${gran}.csv`
    document.body.appendChild(a); a.click(); a.remove()
  }
  const th = { padding: '7px 10px', color: '#8aa0b6', fontWeight: 500, textAlign: 'right', whiteSpace: 'nowrap', borderBottom: '1px solid #1e2b3c', background: '#0f1a2b', position: 'sticky', top: 0 }
  const td = { padding: '6px 10px', textAlign: 'right', whiteSpace: 'nowrap', borderTop: '1px solid #16223a', color: '#cbd5e1' }
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}><button onClick={csv} style={btnSec}>Descargar CSV</button></div>
      <div style={{ overflowX: 'auto', maxHeight: 420 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
          <thead><tr>{cols.map((c, i) => <th key={c.k} style={{ ...th, textAlign: i ? 'right' : 'left' }}>{c.k}</th>)}</tr></thead>
          <tbody>
            {periodos.map(p => {
              const pico = gran === 'dia' && esPico.has(p.key)
              return (
                <tr key={p.key}>
                  {cols.map((c, i) => {
                    const v = c.f(p)
                    return <td key={c.k} style={{ ...td, textAlign: i ? 'right' : 'left', color: i === 0 && pico ? PICO : td.color, fontWeight: i === 0 && pico ? 600 : 400 }}>
                      {i === 0 ? v : c.pct ? fpct(v) : nf.format(v)}
                    </td>
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

/* ── Subcomponentes (mismo estilo que IngresoDiario) ── */
const btnSec = { borderRadius: 8, padding: '7px 14px', fontSize: 13, border: '1px solid #334155', background: 'transparent', color: '#cbd5e1', cursor: 'pointer', whiteSpace: 'nowrap' }
function Msg({ children, tone = '#8aa0b6' }) { return <div style={{ padding: '40px 8px', color: tone, fontSize: 14 }}>{children}</div> }
function Linea({ k, v, borde }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13.5, padding: borde ? '5px 0' : '1px 0', borderTop: borde ? '1px solid #16223a' : 'none', color: '#a8b3d9' }}><span>{k}</span><b style={{ color: '#e6edf3', fontWeight: 600 }}>{v}</b></div>
}
function Cifra({ label, v, c }) {
  return <div><div style={{ fontSize: 24, fontWeight: 600, color: c, letterSpacing: '-0.02em' }}>{v}</div><div style={{ fontSize: 12, color: '#8aa0b6' }}>{label}</div></div>
}
function Pill({ active, onClick, children }) {
  return <button onClick={onClick} style={{ borderRadius: 8, padding: '6px 12px', fontSize: 13.5, fontWeight: 500, cursor: 'pointer', background: active ? '#5eead4' : '#111c2e', color: active ? '#04241f' : '#cbd5e1', border: `1px solid ${active ? '#5eead4' : '#1e2b3c'}` }}>{children}</button>
}
function Seg({ active, onClick, children }) {
  return <button onClick={onClick} style={{ padding: '7px 14px', fontSize: 13, border: 'none', cursor: 'pointer', background: active ? '#5eead4' : 'transparent', color: active ? '#04241f' : '#cbd5e1' }}>{children}</button>
}
function Panel({ title, subtitle, children }) {
  return (
    <div style={{ borderRadius: 12, padding: 16, background: '#0f1a2b', border: '1px solid #1e2b3c' }}>
      <div style={{ marginBottom: 12 }}><div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>{subtitle && <div style={{ fontSize: 12, color: '#64748b' }}>{subtitle}</div>}</div>
      {children}
    </div>
  )
}
function Legend({ items }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 10 }}>
      {items.map(([c, l]) => <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8aa0b6' }}><span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block' }} />{l}</div>)}
    </div>
  )
}
