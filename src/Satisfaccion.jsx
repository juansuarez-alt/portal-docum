import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient.js'

/* ── Satisfacción (CSAT) MULTIMARCA ──────────────────────────
   Lee satisfaccion_diaria (la llena scripts/sync_satisfaccion.py).
   · CSAT global de la mesa y por marca
   · Ranking de analistas por CSAT (con mínimo de encuestas)
   · CSAT por grupo, tendencia y detalle de calificaciones malas
   CSAT % = buenas / (buenas + malas), igual que Zendesk Explore. */

const ZD = 'https://soportemesadeayuda.zendesk.com/agent/tickets/'
const SIN_ASIGNAR = '0'
const COLORES = { GLOBAL: '#5eead4', BALU: '#38bdf8', DOCUM: '#a78bfa' }
const EXTRA = ['#f59e0b', '#f472b6', '#a3e635', '#fb923c']
const META = 90   // línea de referencia en la tendencia; ajústala a la meta del contrato

const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const nf = new Intl.NumberFormat('es-CO')
const pct = (n, d) => (d ? (n * 100) / d : null)
const fpct = x => (x == null ? '—' : `${(Math.round(x * 10) / 10).toLocaleString('es-CO')}%`)
const claveMarca = m => String(m || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase()
const hoyBog = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const sumar = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d) }
const lunes = s => { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d) }
const corto = s => { const d = parse(s); return `${d.getDate()} ${meses[d.getMonth()]}` }
const nomMes = k => { const [y, m] = k.split('-'); return `${meses[+m - 1]} ${y}` }
const colorCsat = x => (x == null ? '#64748b' : x >= 90 ? '#4ade80' : x >= 80 ? '#facc15' : '#f87171')
const nomMarca = m => (m === 'GLOBAL' ? 'Toda la mesa' : m === 'BALU' ? 'Balú' : m.charAt(0) + m.slice(1).toLowerCase())

function presets() {
  const h = hoyBog(), d = parse(h)
  return {
    mes: [iso(new Date(d.getFullYear(), d.getMonth(), 1)), h],
    mesAnt: [iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), iso(new Date(d.getFullYear(), d.getMonth(), 0))],
    d7: [sumar(h, -6), h],
    d30: [sumar(h, -29), h],
    d90: [sumar(h, -89), h],
  }
}
const vacio = () => ({ b: 0, m: 0, o: 0, res: 0 })

export default function Satisfaccion({ marca, email }) {
  const [preset, setPreset] = useState('mes')
  const [[desde, hasta], setRango] = useState(presets().mes)
  const [alcance, setAlcance] = useState('GLOBAL')
  const [gran, setGran] = useState('dia')
  const [minEnc, setMinEnc] = useState(10)
  const [rows, setRows] = useState([])
  const [estado, setEstado] = useState('loading')

  useEffect(() => {
    let vivo = true
    setEstado('loading')
    ;(async () => {
      const { data, error } = await supabase.from('satisfaccion_diaria').select('*')
        .gte('dia', desde).lte('dia', hasta).order('dia', { ascending: true })
      if (!vivo) return
      if (error) { setEstado('error'); return }
      setRows(data || []); setEstado((data || []).length ? 'ready' : 'empty')
    })()
    return () => { vivo = false }
  }, [desde, hasta])

  const elegirPreset = p => { setPreset(p); setRango(presets()[p]) }
  const inp = { width: 150, background: '#0f1a2b', color: '#e6edf3', border: '1px solid #1e2b3c', borderRadius: 8, padding: '6px 10px' }

  return (
    <div style={{ color: '#e6edf3' }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20, letterSpacing: '-0.02em', color: '#0f172a' }}>Satisfacción de usuario</h2>
        <div style={{ color: '#64748b', fontSize: 13 }}>Encuestas CSAT de Zendesk · por día de resolución del ticket · hora Colombia</div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 16 }}>
        {[['mes', 'Este mes'], ['mesAnt', 'Mes anterior'], ['d7', '7 días'], ['d30', '30 días'], ['d90', '90 días']].map(([k, l]) =>
          <Pill key={k} active={preset === k} onClick={() => elegirPreset(k)}>{l}</Pill>)}
        <input type="date" value={desde} max={hasta} style={inp} onChange={e => { setPreset('custom'); setRango([e.target.value, hasta]) }} aria-label="Desde" />
        <input type="date" value={hasta} min={desde} style={inp} onChange={e => { setPreset('custom'); setRango([desde, e.target.value]) }} aria-label="Hasta" />
      </div>
      {estado === 'loading' && <Msg>Cargando satisfacción…</Msg>}
      {estado === 'error' && <Msg tone="#f87171">No se pudo leer la tabla satisfaccion_diaria. Revisa que exista en Supabase y que tu sesión siga activa.</Msg>}
      {estado === 'empty' && <Msg>No hay encuestas entre {corto(desde)} y {corto(hasta)}. Corre un backfill en GitHub Actions → "Satisfacción · Multimarca".</Msg>}
      {estado === 'ready' && <Tablero {...{ rows, alcance, setAlcance, gran, setGran, minEnc, setMinEnc, email, marcaSel: claveMarca(marca) }} />}
    </div>
  )
}

function Tablero({ rows, alcance, setAlcance, gran, setGran, minEnc, setMinEnc, email }) {
  const marcas = useMemo(() => [...new Set(rows.map(r => r.marca))].sort(), [rows])
  const colorDe = m => COLORES[m] || EXTRA[marcas.indexOf(m) % EXTRA.length]

  /* Totales por marca y global */
  const tot = useMemo(() => {
    const t = { GLOBAL: vacio() }
    rows.forEach(r => {
      const x = (t[r.marca] ||= vacio())
      ;[x, t.GLOBAL].forEach(o => { o.b += r.buenas; o.m += r.malas; o.o += r.ofrecidas; o.res += r.resueltos })
    })
    return t
  }, [rows])

  const filas = alcance === 'GLOBAL' ? rows : rows.filter(r => r.marca === alcance)

  /* Ranking de analistas (suma entre marcas si el alcance es global) */
  const ranking = useMemo(() => {
    const map = {}
    filas.forEach(r => Object.entries(r.analistas || {}).forEach(([id, a]) => {
      const x = (map[id] ||= { id, n: a.n, e: a.e, b: 0, m: 0, o: 0, marcas: new Set() })
      x.b += a.b || 0; x.m += a.m || 0; x.o += a.o || 0; x.marcas.add(r.marca)
      if (a.n) x.n = a.n; if (a.e) x.e = a.e
    }))
    const todos = Object.values(map).map(a => ({ ...a, resp: a.b + a.m, csat: pct(a.b, a.b + a.m), tasa: pct(a.b + a.m, a.b + a.m + a.o), marcas: [...a.marcas].sort() }))
    const ia = todos.find(a => a.id === SIN_ASIGNAR)
    const personas = todos.filter(a => a.id !== SIN_ASIGNAR)
    const califican = personas.filter(a => a.resp >= minEnc).sort((x, y) => y.csat - x.csat || y.resp - x.resp)
    const pocos = personas.filter(a => a.resp < minEnc && a.resp > 0).sort((x, y) => y.resp - x.resp)
    return { califican, pocos, ia }
  }, [filas, minEnc])

  /* CSAT por grupo */
  const porGrupo = useMemo(() => {
    const g = {}
    filas.forEach(r => Object.entries(r.grupos || {}).forEach(([k, v]) => {
      const x = (g[k] ||= { b: 0, m: 0, o: 0 }); x.b += v.b || 0; x.m += v.m || 0; x.o += v.o || 0
    }))
    return Object.entries(g).map(([k, v]) => ({ k, ...v, resp: v.b + v.m, csat: pct(v.b, v.b + v.m) }))
      .filter(x => x.resp > 0).sort((a, b) => b.resp - a.resp)
  }, [filas])

  /* Tendencia por periodo y marca */
  const periodos = useMemo(() => {
    const keyOf = f => gran === 'dia' ? f : gran === 'semana' ? lunes(f) : f.slice(0, 7)
    const map = new Map()
    rows.forEach(r => {
      const k = keyOf(r.dia)
      if (!map.has(k)) map.set(k, { key: k, v: { GLOBAL: vacio() } })
      const p = map.get(k)
      ;[(p.v[r.marca] ||= vacio()), p.v.GLOBAL].forEach(o => { o.b += r.buenas; o.m += r.malas })
    })
    return [...map.values()].map(p => ({ ...p, l: gran === 'dia' ? corto(p.key) : gran === 'semana' ? `Sem ${corto(p.key)}` : nomMes(p.key) }))
  }, [rows, gran])

  const malas = useMemo(() => filas.flatMap(r => (r.malas_detalle || []).map(x => ({
    ...x, dia: r.dia, marca: r.marca, nombre: r.analistas?.[x.a]?.n || (x.a === SIN_ASIGNAR ? 'Agente IA / sin asignar' : `Usuario ${x.a}`),
  }))).sort((a, b) => (a.dia < b.dia ? 1 : -1)), [filas])

  const actualizado = rows.reduce((a, r) => (r.actualizado > a ? r.actualizado : a), '')
  const podio = ranking.califican.slice(0, 3)
  const yo = String(email || '').toLowerCase()

  function csvRanking() {
    const cab = ['Posición', 'Analista', 'Correo', 'Marcas', 'CSAT %', 'Buenas', 'Malas', 'Respondidas', 'Sin respuesta', 'Tasa de respuesta %']
    const lin = ranking.califican.map((a, i) => [i + 1, a.n, a.e, a.marcas.join(' + '), (Math.round(a.csat * 10) / 10).toString().replace('.', ','), a.b, a.m, a.resp, a.o, a.tasa == null ? '' : (Math.round(a.tasa * 10) / 10).toString().replace('.', ',')].join(';'))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['\ufeff' + [cab.join(';'), ...lin].join('\n')], { type: 'text/csv;charset=utf-8' }))
    a.download = `satisfaccion_analistas_${alcance}_${rows[0]?.dia}_${rows[rows.length - 1]?.dia}.csv`
    document.body.appendChild(a); a.click(); a.remove()
  }

  return (
    <>
      {/* 1 · Tarjetas global y por marca (clic = cambiar alcance) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 12 }}>
        {['GLOBAL', ...marcas].map(m => {
          const t = tot[m] || vacio(), c = pct(t.b, t.b + t.m), activo = alcance === m
          return (
            <button key={m} onClick={() => setAlcance(m)} aria-pressed={activo}
              style={{ textAlign: 'left', cursor: 'pointer', borderRadius: 12, padding: 16, background: '#0f1a2b', border: `1px solid ${activo ? colorDe(m) : '#1e2b3c'}`, color: '#e6edf3', boxShadow: activo ? `inset 0 3px 0 ${colorDe(m)}` : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#8aa0b6' }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: colorDe(m) }} />{nomMarca(m)}
              </div>
              <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: '-0.03em', color: colorCsat(c), lineHeight: 1.1, marginTop: 6 }}>{fpct(c)}</div>
              <div style={{ fontSize: 12.5, color: '#a8b3d9', marginTop: 4 }}>
                <b style={{ color: '#4ade80' }}>{nf.format(t.b)}</b> buenas · <b style={{ color: '#f87171' }}>{nf.format(t.m)}</b> malas
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                Respondieron {fpct(pct(t.b + t.m, t.b + t.m + t.o))} de {nf.format(t.b + t.m + t.o)} encuestas
              </div>
            </button>
          )
        })}
      </div>

      {/* 2 · Mejores analistas */}
      <Panel title={`Mejores analistas · ${nomMarca(alcance)}`}
        subtitle={`Ordenados por CSAT; en empate, por más encuestas respondidas. Solo entran quienes tienen al menos ${minEnc} encuestas respondidas.`}
        extra={<label style={{ fontSize: 12, color: '#8aa0b6', display: 'flex', alignItems: 'center', gap: 6 }}>Mínimo
          <input type="number" min={1} value={minEnc} onChange={e => setMinEnc(Math.max(1, +e.target.value || 1))}
            style={{ width: 64, background: '#0b1420', color: '#e6edf3', border: '1px solid #1e2b3c', borderRadius: 6, padding: '4px 6px' }} /></label>}>
        {podio.length === 0 ? <Msg>Ningún analista llega al mínimo de {minEnc} encuestas en este rango. Baja el mínimo o amplía las fechas.</Msg> : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, marginBottom: 14 }}>
              {podio.map((a, i) => (
                <div key={a.id} style={{ borderRadius: 10, padding: '12px 14px', background: '#0b1420', border: `1px solid ${i === 0 ? '#facc15' : '#1e2b3c'}` }}>
                  <div style={{ fontSize: 12, color: i === 0 ? '#facc15' : '#8aa0b6', fontWeight: 600 }}>{['1.º lugar', '2.º lugar', '3.º lugar'][i]}</div>
                  <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{a.n}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
                    <span style={{ fontSize: 26, fontWeight: 700, color: colorCsat(a.csat) }}>{fpct(a.csat)}</span>
                    <span style={{ fontSize: 12, color: '#64748b' }}>{nf.format(a.resp)} encuestas</span>
                  </div>
                  {alcance === 'GLOBAL' && <div style={{ fontSize: 11.5, color: '#64748b' }}>{a.marcas.map(nomMarca).join(' + ')}</div>}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}><button onClick={csvRanking} style={btnSec}>Descargar CSV</button></div>
            <Tabla cols={['#', 'Analista', ...(alcance === 'GLOBAL' ? ['Marcas'] : []), 'CSAT', 'Buenas', 'Malas', 'Respondidas', 'Tasa de respuesta']}>
              {ranking.califican.map((a, i) => {
                const mio = yo && a.e === yo
                return (
                  <tr key={a.id} style={{ background: mio ? '#16223a' : 'transparent' }}>
                    <Td l>{i + 1}</Td>
                    <Td l>{a.n}{mio && <span style={{ marginLeft: 6, fontSize: 11, color: '#5eead4' }}>tú</span>}</Td>
                    {alcance === 'GLOBAL' && <Td l>{a.marcas.map(nomMarca).join(' + ')}</Td>}
                    <Td><b style={{ color: colorCsat(a.csat) }}>{fpct(a.csat)}</b></Td>
                    <Td>{nf.format(a.b)}</Td><Td>{nf.format(a.m)}</Td><Td>{nf.format(a.resp)}</Td><Td>{fpct(a.tasa)}</Td>
                  </tr>
                )
              })}
            </Tabla>
          </>
        )}
        {(ranking.pocos.length > 0 || ranking.ia) && (
          <div style={{ fontSize: 12.5, color: '#8aa0b6', marginTop: 12, lineHeight: 1.6 }}>
            {ranking.pocos.length > 0 && <div>Por debajo del mínimo ({ranking.pocos.length}): {ranking.pocos.slice(0, 12).map(a => `${a.n} ${fpct(a.csat)} (${a.resp})`).join(' · ')}{ranking.pocos.length > 12 ? ' …' : ''}</div>}
            {ranking.ia && ranking.ia.resp > 0 && <div>Agente IA / sin asignar: <b style={{ color: colorCsat(ranking.ia.csat) }}>{fpct(ranking.ia.csat)}</b> en {nf.format(ranking.ia.resp)} encuestas (no entra al ranking).</div>}
          </div>
        )}
      </Panel>

      {/* 3 · Tendencia y grupos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12, marginTop: 12 }}>
        <Panel title="Tendencia del CSAT" subtitle={`Línea punteada: meta de referencia ${META}%`}
          extra={<div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid #334155' }}>
            {[['dia', 'Día'], ['semana', 'Semana'], ['mes', 'Mes']].map(([k, l]) => <Seg key={k} active={gran === k} onClick={() => setGran(k)}>{l}</Seg>)}
          </div>}>
          <Lineas periodos={periodos} series={['GLOBAL', ...marcas]} color={colorDe} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 8 }}>
            {['GLOBAL', ...marcas].map(m => <span key={m} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8aa0b6' }}><span style={{ width: 10, height: 3, background: colorDe(m) }} />{nomMarca(m)}</span>)}
          </div>
        </Panel>
        <Panel title={`CSAT por grupo · ${nomMarca(alcance)}`} subtitle="Grupo actual del ticket al resolverse">
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            <Tabla cols={['Grupo', 'CSAT', 'Buenas', 'Malas']}>
              {porGrupo.map(g => (
                <tr key={g.k}><Td l>{g.k}</Td><Td><b style={{ color: colorCsat(g.csat) }}>{fpct(g.csat)}</b></Td><Td>{nf.format(g.b)}</Td><Td>{nf.format(g.m)}</Td></tr>
              ))}
            </Tabla>
          </div>
        </Panel>
      </div>

      {/* 4 · Calificaciones malas */}
      <div style={{ marginTop: 12 }}>
        <Panel title={`Calificaciones malas · ${nomMarca(alcance)}`} subtitle={`${nf.format(malas.length)} en el rango · clic en el ticket para abrirlo en Zendesk`}>
          {malas.length === 0 ? <Msg>Sin calificaciones malas en este rango.</Msg> : (
            <div style={{ maxHeight: 360, overflowY: 'auto' }}>
              <Tabla cols={['Día', 'Ticket', ...(alcance === 'GLOBAL' ? ['Marca'] : []), 'Analista', 'Grupo', 'Motivo / comentario']}>
                {malas.slice(0, 200).map(x => (
                  <tr key={`${x.marca}-${x.t}`}>
                    <Td l>{corto(x.dia)}</Td>
                    <Td l><a href={ZD + x.t} target="_blank" rel="noreferrer" style={{ color: '#38bdf8' }}>#{x.t}</a></Td>
                    {alcance === 'GLOBAL' && <Td l>{nomMarca(x.marca)}</Td>}
                    <Td l>{x.nombre}</Td><Td l>{x.g}</Td>
                    <Td l wrap>{[x.r, x.c].filter(Boolean).join(' · ') || <span style={{ color: '#64748b' }}>Sin comentario</span>}</Td>
                  </tr>
                ))}
              </Tabla>
            </div>
          )}
        </Panel>
      </div>
      {actualizado && <div style={{ fontSize: 12, color: '#64748b', marginTop: 10 }}>Última sincronización: {new Date(actualizado).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}. El sync corre cada 4 horas y recalcula los últimos 10 días, porque las encuestas llegan después de resolver el ticket.</div>}
    </>
  )
}

/* ════════ Gráfico de líneas (sin librerías) ════════ */
function Lineas({ periodos, series, color }) {
  if (!periodos.length) return null
  const W = 600, H = 170, pl = 30, pr = 8, pt = 8, pb = 22
  const vals = periodos.flatMap(p => series.map(s => { const v = p.v[s]; return v ? pct(v.b, v.b + v.m) : null })).filter(v => v != null)
  const min = Math.max(0, Math.floor((Math.min(...vals, META) - 5) / 10) * 10)
  const x = i => (periodos.length === 1 ? (pl + W - pr) / 2 : pl + (i * (W - pl - pr)) / (periodos.length - 1))
  const y = v => pt + ((100 - v) / (100 - min || 1)) * (H - pt - pb)
  const paso = Math.ceil(periodos.length / 10)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H }} role="img" aria-label="Tendencia del CSAT por marca">
      {[min, (min + 100) / 2, 100].map(g => <g key={g}><line x1={pl} x2={W - pr} y1={y(g)} y2={y(g)} stroke="#1e2b3c" /><text x={pl - 4} y={y(g) + 3} textAnchor="end" fontSize="10" fill="#64748b">{Math.round(g)}%</text></g>)}
      <line x1={pl} x2={W - pr} y1={y(META)} y2={y(META)} stroke="#4ade80" strokeDasharray="4 4" opacity="0.6" />
      {series.map(s => {
        const pts = periodos.map((p, i) => { const v = p.v[s]; const c = v ? pct(v.b, v.b + v.m) : null; return c == null ? null : { i, c, p, n: v.b + v.m } }).filter(Boolean)
        const d = pts.map((q, k) => `${k ? 'L' : 'M'}${x(q.i).toFixed(1)},${y(q.c).toFixed(1)}`).join(' ')
        return (
          <g key={s}>
            <path d={d} fill="none" stroke={color(s)} strokeWidth={s === 'GLOBAL' ? 2.5 : 1.8} />
            {periodos.length <= 40 && pts.map(q => <circle key={q.i} cx={x(q.i)} cy={y(q.c)} r="2.8" fill={color(s)}><title>{`${nomMarca(s)} · ${q.p.l}: ${fpct(q.c)} (${nf.format(q.n)} encuestas)`}</title></circle>)}
          </g>
        )
      })}
      {periodos.map((p, i) => i % paso === 0 && <text key={p.key} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="#64748b">{p.l}</text>)}
    </svg>
  )
}

/* ── Subcomponentes (mismo estilo que IngresoMarca) ── */
const btnSec = { borderRadius: 8, padding: '7px 14px', fontSize: 13, border: '1px solid #334155', background: 'transparent', color: '#cbd5e1', cursor: 'pointer', whiteSpace: 'nowrap' }
function Msg({ children, tone = '#8aa0b6' }) { return <div style={{ padding: '28px 8px', color: tone, fontSize: 14 }}>{children}</div> }
function Pill({ active, onClick, children }) {
  return <button onClick={onClick} style={{ borderRadius: 8, padding: '6px 12px', fontSize: 13.5, fontWeight: 500, cursor: 'pointer', background: active ? '#5eead4' : '#111c2e', color: active ? '#04241f' : '#cbd5e1', border: `1px solid ${active ? '#5eead4' : '#1e2b3c'}` }}>{children}</button>
}
function Seg({ active, onClick, children }) {
  return <button onClick={onClick} style={{ padding: '6px 12px', fontSize: 12.5, border: 'none', cursor: 'pointer', background: active ? '#5eead4' : 'transparent', color: active ? '#04241f' : '#cbd5e1' }}>{children}</button>
}
function Panel({ title, subtitle, extra, children }) {
  return (
    <div style={{ borderRadius: 12, padding: 16, background: '#0f1a2b', border: '1px solid #1e2b3c' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div><div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>{subtitle && <div style={{ fontSize: 12, color: '#64748b' }}>{subtitle}</div>}</div>
        {extra}
      </div>
      {children}
    </div>
  )
}
function Tabla({ cols, children }) {
  const th = { padding: '7px 10px', color: '#8aa0b6', fontWeight: 500, whiteSpace: 'nowrap', borderBottom: '1px solid #1e2b3c', background: '#0f1a2b', position: 'sticky', top: 0 }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
        <thead><tr>{cols.map((c, i) => <th key={c} style={{ ...th, textAlign: i < 2 || c === 'Grupo' || c === 'Analista' || c === 'Marcas' || c === 'Marca' || c.startsWith('Motivo') ? 'left' : 'right' }}>{c}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}
function Td({ children, l, wrap }) {
  return <td style={{ padding: '6px 10px', textAlign: l ? 'left' : 'right', whiteSpace: wrap ? 'normal' : 'nowrap', borderTop: '1px solid #16223a', color: '#cbd5e1', maxWidth: wrap ? 420 : undefined }}>{children}</td>
}
