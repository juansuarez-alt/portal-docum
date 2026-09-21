import React, { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from './supabaseClient.js'

/* ── Módulo Productividad ──────────────────────────────────────
   • Nuevo corte: cargas el Excel exportado de Zendesk (hoja "Tickets
     únicos por asesor"), cruza contra productividad_analistas (marca+meta)
     y calcula semáforo, curva y detalle. Puedes guardar el corte.
   • Histórico: cada corte guardado queda en productividad_cortes y se
     puede volver a ver tal cual (lectura pura del JSONB).
   La meta y la marca viven en la tabla productividad_analistas: editar la
   meta aquí la guarda para todos los cortes futuros.                      */

const BOTS = ['ai agent', 'development zendesk', 'zendesk', 'automation', 'sistema']
const DEFAULT_META = 20
const THRESH_OK = 100, THRESH_WARN = 90
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

const norm = s => (s || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
const pct = (n, d) => (d ? (n / d) * 100 : 0)
const estadoDe = c => c >= THRESH_OK ? 'ok' : (c >= THRESH_WARN ? 'warn' : 'bad')

export default function Productividad() {
  const [analistas, setAnalistas] = useState([])     // [{analista, marca, meta}]
  const [cortes, setCortes] = useState([])           // histórico (metadatos)
  const [mode, setMode] = useState('nuevo')          // 'nuevo' | 'hist'
  const [parsed, setParsed] = useState(null)         // {rows:[{name,days,total,dias}], dayLabels, mes}
  const [hist, setHist] = useState(null)             // corte cargado del histórico
  const [filterBrand, setFilterBrand] = useState('Todas')
  const [filterEstado, setFilterEstado] = useState(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [drag, setDrag] = useState(false)

  useEffect(() => { cargarBase() }, [])
  async function cargarBase() {
    const [{ data: an }, { data: co }] = await Promise.all([
      supabase.from('productividad_analistas').select('analista,marca,meta').eq('activo', true),
      supabase.from('productividad_cortes').select('id,etiqueta,mes,total_casos,generado').order('generado', { ascending: false }),
    ])
    setAnalistas(an || [])
    setCortes(co || [])
  }

  // índice normalizado para cruzar nombres del Excel
  const idx = useMemo(() => {
    const m = {}
    ;(analistas || []).forEach(a => {
      const k = norm(a.analista)
      m[k] = { marca: a.marca, meta: a.meta, sig: new Set(k.split(' ').filter(w => w.length > 2)) }
    })
    return m
  }, [analistas])

  function lookup(name) {
    const k = norm(name)
    if (idx[k]) return { marca: idx[k].marca, meta: idx[k].meta }
    const wn = new Set(k.split(' ').filter(w => w.length > 2))
    for (const key in idx) {
      let c = 0; idx[key].sig.forEach(w => { if (wn.has(w)) c++ })
      if (c >= 2) return { marca: idx[key].marca, meta: idx[key].meta }
    }
    return { marca: 'Sin marca', meta: DEFAULT_META }
  }

  function computeRows(parsedRows) {
    return parsedRows.map(r => {
      const { marca, meta } = lookup(r.name)
      const prom = r.dias ? r.total / r.dias : 0
      const cumpl = meta ? prom / meta * 100 : 0
      return { analista: r.name, marca, meta, casos: r.total, dias: r.dias, prom, cumpl, estado: meta ? estadoDe(cumpl) : 'none', days: r.days }
    })
  }

  function readFile(f) {
    const r = new FileReader()
    r.onload = e => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' })
        const sName = wb.SheetNames.find(n => /asesor/i.test(n)) || wb.SheetNames.find(n => {
          const rr = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' })[0] || []
          return rr.some(h => /^\d{2}\b/.test(String(h)))
        })
        if (!sName) { setMsg('No encontré la hoja "Tickets únicos por asesor" en el archivo.'); return }
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sName], { header: 1, defval: '' })
        const header = rows[0] || []
        const dayCols = []; header.forEach((h, j) => { if (/^\d{2}\b/.test(String(h))) dayCols.push([j, String(h).split('\n')[0]]) })
        let sumCol = header.findIndex(h => /^SUM/i.test(String(h))); if (sumCol < 0) sumCol = header.length - 1
        let mes = ''
        const dName = wb.SheetNames.find(n => /detalle/i.test(n))
        if (dName) { const c = wb.Sheets[dName]['C2']; if (c && /^\d{4}-\d{2}/.test(String(c.v))) { const [y, mm] = String(c.v).split('-'); mes = MESES[+mm - 1][0].toUpperCase() + MESES[+mm - 1].slice(1) + ' ' + y } }
        const out = []
        for (let i = 1; i < rows.length; i++) {
          const name = rows[i][0]; if (!name || BOTS.includes(norm(name))) continue
          const days = dayCols.map(([j]) => typeof rows[i][j] === 'number' ? rows[i][j] : 0)
          const total = typeof rows[i][sumCol] === 'number' ? rows[i][sumCol] : days.reduce((a, b) => a + b, 0)
          if (total <= 0) continue
          out.push({ name: String(name), days, total, dias: days.filter(v => v > 0).length })
        }
        setParsed({ rows: out, dayLabels: dayCols.map(d => d[1]), mes })
        setMode('nuevo'); setHist(null); setFilterBrand('Todas'); setFilterEstado(null); setMsg(null)
      } catch (err) { setMsg('No pude leer el archivo: ' + err.message) }
    }
    r.readAsArrayBuffer(f)
  }

  async function saveMeta(analista, val) {
    const meta = isNaN(val) ? 0 : val
    const a = analistas.find(x => norm(x.analista) === norm(analista))
    const marca = a ? a.marca : lookup(analista).marca
    const { error } = await supabase.from('productividad_analistas').upsert({ analista, marca, meta, activo: true }, { onConflict: 'analista' })
    if (error) { setMsg('No se pudo guardar la meta: ' + error.message); return }
    setAnalistas(prev => {
      const i = prev.findIndex(x => norm(x.analista) === norm(analista))
      if (i >= 0) { const cp = [...prev]; cp[i] = { ...cp[i], meta }; return cp }
      return [...prev, { analista, marca, meta }]
    })
  }

  const dayLabels = mode === 'hist' && hist ? hist.dias_label : (parsed ? parsed.dayLabels : [])
  const filas = useMemo(() => {
    if (mode === 'hist' && hist) return hist.filas || []
    if (parsed) return computeRows(parsed.rows)
    return []
  }, [mode, hist, parsed, idx])
  const mes = mode === 'hist' && hist ? hist.mes : (parsed ? parsed.mes : '')

  async function guardarCorte() {
    if (!parsed) return
    const rows = computeRows(parsed.rows)
    const a = parsed.dayLabels[0], b = parsed.dayLabels[parsed.dayLabels.length - 1]
    const etiqueta = `${mes || 'Corte'} · ${a}-${b}`
    const total = rows.reduce((s, r) => s + r.casos, 0)
    setSaving(true); setMsg(null)
    const { error } = await supabase.from('productividad_cortes')
      .upsert({ etiqueta, mes, dias_label: parsed.dayLabels, filas: rows, total_casos: total }, { onConflict: 'etiqueta' })
    setSaving(false)
    if (error) { setMsg('No se pudo guardar el corte: ' + error.message); return }
    setMsg(`Corte guardado: ${etiqueta}`)
    cargarBase()
  }

  async function verCorte(id) {
    if (!id) { setMode('nuevo'); setHist(null); return }
    const { data, error } = await supabase.from('productividad_cortes').select('*').eq('id', id).single()
    if (error || !data) { setMsg('No pude cargar el corte.'); return }
    setHist(data); setMode('hist'); setFilterBrand('Todas'); setFilterEstado(null); setMsg(null)
  }

  const editable = mode === 'nuevo'
  const hayDatos = filas.length > 0

  return (
    <div style={{ color: '#e6edf3' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, letterSpacing: '-0.02em' }}>Productividad</h2>
          <div style={{ color: '#8aa0b6', fontSize: 13 }}>Tickets recibidos por analista · Zendesk</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={mode === 'hist' && hist ? hist.id : ''} onChange={e => verCorte(e.target.value)}
            style={{ background: '#111c2e', color: '#cbd5e1', border: '1px solid #1e2b3c', borderRadius: 8, padding: '7px 10px', fontSize: 13 }}>
            <option value="">Nuevo corte (cargar Excel)</option>
            {cortes.map(c => <option key={c.id} value={c.id}>{c.etiqueta} · {c.total_casos} casos</option>)}
          </select>
          {mode === 'nuevo' && parsed && <button onClick={guardarCorte} disabled={saving} style={btnPri(saving)}>{saving ? 'Guardando…' : 'Guardar corte'}</button>}
        </div>
      </div>

      {msg && <div style={{ marginBottom: 12, fontSize: 12.5, color: /guardad/i.test(msg) ? '#4ade80' : '#f87171' }}>{msg}</div>}

      {mode === 'nuevo' && !parsed && (
        <div onClick={() => document.getElementById('prod-file').click()}
          onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) readFile(f) }}
          style={{ border: `1.5px dashed ${drag ? '#5eead4' : '#334155'}`, borderRadius: 12, background: drag ? '#0d2420' : '#0f1a2b', padding: 30, textAlign: 'center', color: '#8aa0b6', cursor: 'pointer' }}>
          <div style={{ fontSize: 26, marginBottom: 6 }}>📄</div>
          <div><b style={{ color: '#e6edf3' }}>Arrastra el Excel de Zendesk</b> o haz clic para elegirlo</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Detalle diario exportado (.xlsx) · hoja "Tickets únicos por asesor"</div>
          <input id="prod-file" type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => { const f = e.target.files[0]; if (f) readFile(f) }} />
        </div>
      )}

      {hayDatos && (
        <Dashboard
          filas={filas} dayLabels={dayLabels} mes={mes}
          filterBrand={filterBrand} setFilterBrand={setFilterBrand}
          filterEstado={filterEstado} setFilterEstado={setFilterEstado}
          editable={editable} onMeta={saveMeta}
          onReset={() => { setParsed(null); setMsg(null) }}
        />
      )}
    </div>
  )
}

/* ── Dashboard (compartido: nuevo corte editable / histórico solo lectura) ── */
function Dashboard({ filas, dayLabels, mes, filterBrand, setFilterBrand, filterEstado, setFilterEstado, editable, onMeta, onReset }) {
  const brands = ['Todas', ...Array.from(new Set(filas.map(f => f.marca))).sort((x, y) => x === 'Sin marca' ? 1 : y === 'Sin marca' ? -1 : x.localeCompare(y))]
  const scope = filas.filter(f => filterBrand === 'Todas' || f.marca === filterBrand)
  const vis = scope.filter(f => !filterEstado || f.estado === filterEstado)
  const conMeta = scope.filter(f => f.estado !== 'none')
  const nOk = conMeta.filter(f => f.estado === 'ok').length
  const nW = conMeta.filter(f => f.estado === 'warn').length
  const nB = conMeta.filter(f => f.estado === 'bad').length
  const totals = dayLabels.map((_, i) => vis.reduce((s, f) => s + (f.days ? (f.days[i] || 0) : 0), 0))
  const totalCasos = vis.reduce((s, f) => s + f.casos, 0)

  const byBrand = {}; vis.forEach(f => { (byBrand[f.marca] ||= []).push(f) })
  const orderB = Object.keys(byBrand).sort((x, y) => x === 'Sin marca' ? 1 : y === 'Sin marca' ? -1 : x.localeCompare(y))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Panel>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {brands.map(b => (
            <span key={b} onClick={() => setFilterBrand(b)} style={chip(b === filterBrand)}>{b}</span>
          ))}
          {editable && <span onClick={onReset} style={{ marginLeft: 'auto', fontSize: 12.5, color: '#8aa0b6', cursor: 'pointer' }}>Cargar otro archivo</span>}
        </div>
      </Panel>

      <Panel>
        <Head titulo="Semáforo de cumplimiento" sub="Cumple ≥100% · Próximo 90–99% · No cumple <90%. Clic para filtrar." />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
          <Tile tono="ok" n={nOk} l="Cumplen" sel={filterEstado === 'ok'} onClick={() => setFilterEstado(filterEstado === 'ok' ? null : 'ok')} />
          <Tile tono="warn" n={nW} l="Próximos" sel={filterEstado === 'warn'} onClick={() => setFilterEstado(filterEstado === 'warn' ? null : 'warn')} />
          <Tile tono="bad" n={nB} l="No cumplen" sel={filterEstado === 'bad'} onClick={() => setFilterEstado(filterEstado === 'bad' ? null : 'bad')} />
        </div>
      </Panel>

      <Panel>
        <Head titulo="Curva de evolución diaria" sub={'Casos por día trabajado' + (mes ? ` — ${mes}` : '')} />
        <Curva vals={totals} labels={dayLabels} />
      </Panel>

      <Panel>
        <Head titulo="Detalle por analista" sub={editable ? 'Meta editable — se guarda en la tabla de analistas.' : 'Corte guardado (solo lectura).'} />
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr>
              {['Analista', 'Marca', 'Meta', '% Cumpl.', 'Casos', 'Prom/día', 'Días', 'Estado'].map((h, i) => (
                <th key={h} style={{ textAlign: i >= 2 && i <= 6 ? 'right' : 'left', color: '#8aa0b6', fontWeight: 500, fontSize: 11.5, padding: '6px 8px', borderBottom: '1px solid #1e2b3c', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {orderB.map(b => {
                const arr = byBrand[b].sort((p, q) => q.cumpl - p.cumpl || q.casos - p.casos)
                return (
                  <React.Fragment key={b}>
                    {(orderB.length > 1 || filterBrand === 'Todas') && (
                      <tr><td colSpan={8} style={{ background: '#0b1420', color: '#8aa0b6', fontWeight: 600, fontSize: 11.5, letterSpacing: '.02em', textTransform: 'uppercase', padding: '6px 8px' }}>{b} · {arr.length}</td></tr>
                    )}
                    {arr.map(f => (
                      <tr key={f.analista}>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #16223a', fontWeight: 600 }}>{f.analista}</td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #16223a', color: '#8aa0b6' }}>{f.marca}</td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #16223a', textAlign: 'right' }}>
                          {editable
                            ? <input type="number" min="0" step="1" defaultValue={f.meta} onBlur={e => onMeta(f.analista, parseInt(e.target.value, 10))}
                                style={{ width: 52, background: '#0b1420', color: '#e6edf3', border: '1px solid #1e2b3c', borderRadius: 6, padding: '3px 6px', textAlign: 'right', font: 'inherit' }} />
                            : f.meta}
                        </td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #16223a', textAlign: 'right', fontWeight: 700, color: colorEstado(f.estado) }}>{f.meta ? f.cumpl.toFixed(1) + '%' : '—'}</td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #16223a', textAlign: 'right' }}>{f.casos}</td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #16223a', textAlign: 'right' }}>{f.prom.toFixed(1)}</td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #16223a', textAlign: 'right' }}>{f.dias}</td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #16223a' }}><Pill estado={f.estado} /></td>
                      </tr>
                    ))}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        <div style={{ color: '#64748b', fontSize: 11.5, marginTop: 10 }}>Mostrando {vis.length} analistas · {totalCasos.toLocaleString('es-CO')} casos</div>
      </Panel>
    </div>
  )
}

function Curva({ vals, labels }) {
  const W = 1000, H = 150, pad = { l: 34, r: 12, t: 12, b: 22 }
  const max = Math.max(...vals, 1), iw = W - pad.l - pad.r, ih = H - pad.t - pad.b
  const x = i => pad.l + (vals.length <= 1 ? 0 : i * (iw / (vals.length - 1)))
  const y = v => pad.t + ih - (v / max) * ih
  const pts = vals.map((v, i) => [x(i), y(v)])
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  const area = `M${pad.l} ${pad.t + ih} ` + pts.map(p => 'L' + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') + ` L${pad.l + iw} ${pad.t + ih} Z`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} preserveAspectRatio="xMidYMid meet">
      {[0, .5, 1].map((f, i) => { const yy = pad.t + ih - f * ih; return <g key={i}><line x1={pad.l} y1={yy} x2={W - pad.r} y2={yy} stroke="#16223a" /><text x={4} y={yy + 3} fill="#64748b" fontSize="10">{Math.round(f * max)}</text></g> })}
      <path d={area} fill="rgba(94,234,212,.08)" />
      <path d={line} fill="none" stroke="#5eead4" strokeWidth="2" />
      {pts.map((p, i) => <circle key={i} cx={p[0].toFixed(1)} cy={p[1].toFixed(1)} r="2.5" fill="#5eead4" />)}
      {labels.map((l, i) => (i % 2 === 0 || labels.length <= 10) ? <text key={i} x={x(i).toFixed(1)} y={H - 6} textAnchor="middle" fill="#64748b" fontSize="10">{l}</text> : null)}
    </svg>
  )
}

/* ── UI helpers ── */
const btnPri = disabled => ({ borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 500, border: 'none', background: '#14b8a6', color: '#04241f', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? .5 : 1 })
const chip = on => ({ borderRadius: 999, padding: '4px 12px', fontSize: 12.5, cursor: 'pointer', background: on ? '#5eead4' : '#111c2e', color: on ? '#04241f' : '#cbd5e1', border: `1px solid ${on ? '#5eead4' : '#1e2b3c'}` })
const colorEstado = e => e === 'ok' ? '#4ade80' : e === 'warn' ? '#fbbf24' : e === 'bad' ? '#f87171' : '#64748b'
function Panel({ children }) { return <div style={{ borderRadius: 12, padding: 16, background: '#0f1a2b', border: '1px solid #1e2b3c' }}>{children}</div> }
function Head({ titulo, sub }) { return <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}><div style={{ fontWeight: 600, fontSize: 14 }}>{titulo}</div><div style={{ fontSize: 12, color: '#64748b' }}>{sub}</div></div> }
function Tile({ tono, n, l, sel, onClick }) {
  const bg = tono === 'ok' ? '#0d2a1e' : tono === 'warn' ? '#2a230d' : '#2a1414'
  const col = tono === 'ok' ? '#4ade80' : tono === 'warn' ? '#fbbf24' : '#f87171'
  return <div onClick={onClick} style={{ borderRadius: 10, padding: '12px 14px', textAlign: 'center', cursor: 'pointer', background: bg, border: `1px solid ${sel ? col : 'transparent'}` }}>
    <div style={{ fontSize: 24, fontWeight: 700, color: col, lineHeight: 1 }}>{n}</div><div style={{ fontSize: 12, marginTop: 3, color: '#8aa0b6' }}>{l}</div>
  </div>
}
function Pill({ estado }) {
  const map = { ok: ['Cumple', '#0d2a1e', '#4ade80'], warn: ['Próximo', '#2a230d', '#fbbf24'], bad: ['No cumple', '#2a1414', '#f87171'], none: ['Sin meta', '#16223a', '#64748b'] }
  const [t, bg, c] = map[estado] || map.none
  return <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, background: bg, color: c }}>{t}</span>
}
