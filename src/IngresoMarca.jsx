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

const FRENTE_ORDEN = ['Atención', 'Gestión', 'N2', 'N3', 'Otros grupos', 'Sin grupo']
const FRENTE_COLOR = {
  'Atención': '#22d3ee', 'Gestión': '#818cf8', 'N2': '#f59e0b', 'N3': '#f472b6',
  'Otros grupos': '#64748b', 'Sin grupo': '#334155',
}
const EXTRA_COLORS = ['#a3e635', '#fb923c', '#38bdf8', '#e879f9']
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
function Tablero({ rows, gran, frente, setFrente }) {
  const valor = r => (frente ? (r.frentes?.[frente] || 0) : r.total)

  const frentes = useMemo(() => {
    const tot = {}
    rows.forEach(r => Object.entries(r.frentes || {}).forEach(([k, v]) => (tot[k] = (tot[k] || 0) + v)))
    const nombres = Object.keys(tot).sort((a, b) => {
      const ia = FRENTE_ORDEN.indexOf(a), ib = FRENTE_ORDEN.indexOf(b)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || tot[b] - tot[a]
    })
    let extra = 0
    const color = {}
    nombres.forEach(n => (color[n] = FRENTE_COLOR[n] || EXTRA_COLORS[extra++ % EXTRA_COLORS.length]))
    return { tot, nombres, color }
  }, [rows])

  const periodos = useMemo(() => {
    const keyOf = f => gran === 'dia' ? f : gran === 'semana' ? lunes(f) : f.slice(0, 7)
    const map = new Map()
    rows.forEach(r => {
      const k = keyOf(r.dia)
      if (!map.has(k)) map.set(k, { key: k, ini: r.dia, fin: r.dia, total: 0, fr: {}, iaU: 0, iaR: 0, n2: 0, n3: 0 })
      const p = map.get(k)
      p.fin = r.dia; p.total += r.total; p.iaU += r.ia_universo; p.iaR += r.ia_resueltos; p.n2 += r.esc_n2; p.n3 += r.esc_n3
      Object.entries(r.frentes || {}).forEach(([f, v]) => (p.fr[f] = (p.fr[f] || 0) + v))
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
    const resumen = Object.keys(porMes).sort().map(m => ({
      mes: m, dia: porMes[m].dia,
      sem: Object.values(porMes[m].sem).sort((a, b) => b.t - a.t)[0],
    }))
    const top = [...rows].sort((a, b) => valor(b) - valor(a)).slice(0, 5)
    const sumD = Array(7).fill(0), cntD = Array(7).fill(0)
    rows.forEach(r => { sumD[dowIdx(r.dia)] += valor(r); cntD[dowIdx(r.dia)]++ })
    const promDow = sumD.map((s, i) => (cntD[i] ? Math.round(s / cntD[i]) : 0))
    const horas = Array(24).fill(0)
    rows.forEach(r => (r.horas || []).forEach((x, i) => (horas[i] += x)))
    let franja = 0
    for (let i = 1; i < 23; i++) if (horas[i] + horas[i + 1] > horas[franja] + horas[franja + 1]) franja = i
    return { media, esPico, resumen, top, promDow, horas, franja }
  }, [rows, frente]) // eslint-disable-line react-hooks/exhaustive-deps

  const total = rows.reduce((a, r) => a + r.total, 0)
  const sel = frente ? (frentes.tot[frente] || 0) : total
  const iaU = rows.reduce((a, r) => a + r.ia_universo, 0), iaR = rows.reduce((a, r) => a + r.ia_resueltos, 0)
  const n2 = rows.reduce((a, r) => a + r.esc_n2, 0), n3 = rows.reduce((a, r) => a + r.esc_n3, 0)
  const nomGran = { dia: 'día', semana: 'semana', mes: 'mes' }[gran]
  const actualizado = rows.reduce((a, r) => (r.actualizado > a ? r.actualizado : a), '')

  return (
    <>
      {/* 1 · Vista general */}
      <div style={{ borderRadius: 12, padding: 20, background: '#0f1a2b', border: '1px solid #1e2b3c', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '4px 14px' }}>
          <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: '-0.03em', color: frente ? frentes.color[frente] : '#5eead4', lineHeight: 1 }}>{nf.format(sel)}</span>
          <span style={{ color: '#8aa0b6', fontSize: 14 }}>
            {frente ? `tickets en ${frente} · ${fpct(pct(sel, total))} de ${nf.format(total)}` : `tickets de todos los frentes · ${rows.length} días`}
          </span>
          {frente && <button onClick={() => setFrente(null)} style={{ ...btnSec, marginLeft: 'auto' }}>Ver todos los frentes</button>}
        </div>
        <div style={{ display: 'flex', height: 26, borderRadius: 6, overflow: 'hidden', margin: '16px 0 12px', background: '#16223a' }}>
          {frentes.nombres.map(n => (
            <button key={n} title={`${n}: ${nf.format(frentes.tot[n])}`} aria-label={`Filtrar ${n}`} onClick={() => setFrente(f => (f === n ? null : n))}
              style={{ flex: frentes.tot[n] || 0.0001, minWidth: 3, border: 'none', padding: 0, cursor: 'pointer', background: frentes.color[n], opacity: frente && frente !== n ? 0.25 : 1 }} />
          ))}
        </div>
        {/* 2 · Por frente */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          {frentes.nombres.map(n => (
            <button key={n} onClick={() => setFrente(f => (f === n ? null : n))}
              style={{ textAlign: 'left', cursor: 'pointer', borderRadius: 10, padding: '10px 12px', background: frente === n ? '#16223a' : 'transparent', border: `1px solid ${frente === n ? frentes.color[n] : '#1e2b3c'}`, color: '#e6edf3' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#8aa0b6' }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: frentes.color[n] }} />{n}
              </div>
              <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>{nf.format(frentes.tot[n])}</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{fpct(pct(frentes.tot[n], total))} del ingreso</div>
            </button>
          ))}
        </div>
      </div>

      {/* 3 · Periodicidad */}
      <Panel title={`Ingreso por ${nomGran}${frente ? ` · ${frente}` : ''}`}
        subtitle={frente ? (gran === 'dia' ? 'En rojo, los días que superan el promedio más una desviación estándar' : 'Solo el frente seleccionado') : 'Frentes apilados · clic en un frente arriba para aislarlo'}>
        <Barras periodos={periodos}
          series={frente ? [frente] : frentes.nombres} color={frentes.color}
          pico={p => gran === 'dia' && frente && picos.esPico.has(p.key)}
          valorDe={(p, s) => p.fr[s] || 0} />
        {!frente && <Legend items={frentes.nombres.map(n => [frentes.color[n], n])} />}
      </Panel>

      {/* 4 · Picos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginTop: 12 }}>
        <Panel title="Picos de tráfico" subtitle={`Promedio diario: ${nf.format(Math.round(picos.media))}${frente ? ` · ${frente}` : ''}`}>
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
        <Panel title="Cuándo llega el tráfico" subtitle="Promedio por día de la semana y suma por hora (todos los frentes en la hora)">
          <MiniBarras datos={picos.promDow} etiquetas={DSEM} color={frente ? frentes.color[frente] : '#22d3ee'} alto={110} />
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
            <Cifra label="Escalados a N2" v={nf.format(n2)} c={FRENTE_COLOR.N2} />
            <Cifra label="Escalados a N3" v={nf.format(n3)} c={FRENTE_COLOR.N3} />
            <Cifra label="Del total" v={fpct(pct(n2 + n3, total))} c="#e6edf3" />
          </div>
          <Barras periodos={periodos} series={['n2', 'n3']} color={{ n2: FRENTE_COLOR.N2, n3: FRENTE_COLOR.N3 }}
            valorDe={(p, s) => p[s]} alto={130} />
          <Legend items={[[FRENTE_COLOR.N2, 'N2 Soporte'], [FRENTE_COLOR.N3, 'N3']]} />
        </Panel>
      </div>

      {/* Detalle */}
      <div style={{ marginTop: 12 }}>
        <Panel title={`Detalle por ${nomGran}`} subtitle="Descárgalo para cruzarlo con otros reportes">
          <Detalle periodos={periodos} frentes={frentes.nombres} gran={gran} esPico={picos.esPico} frente={frente} />
        </Panel>
      </div>
      {actualizado && <div style={{ fontSize: 12, color: '#64748b', marginTop: 10 }}>Última sincronización: {new Date(actualizado).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}. El sync corre cada 2 horas y recalcula los últimos 3 días.</div>}
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

function Detalle({ periodos, frentes, gran, esPico, frente }) {
  const cols = ['Periodo', 'Total', ...frentes, 'Atendidos IA', 'Resueltos IA', 'No resueltos IA', '% absorción', 'Esc. N2', 'Esc. N3']
  const fila = p => [p.label, p.total, ...frentes.map(f => p.fr[f] || 0), p.iaU, p.iaR, p.iaU - p.iaR, pct(p.iaR, p.iaU), p.n2, p.n3]
  function csv() {
    const txt = [cols.join(';'), ...periodos.map(p => fila(p).map((v, i) => (i === 0 ? p.key : i === cols.indexOf('% absorción') ? String(Math.round(v * 10) / 10).replace('.', ',') : v)).join(';'))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['\ufeff' + txt], { type: 'text/csv;charset=utf-8' }))
    a.download = `ingreso_${periodos[0]?.ini}_${periodos[periodos.length - 1]?.fin}_${gran}.csv`
    document.body.appendChild(a); a.click(); a.remove()
  }
  const th = { padding: '7px 10px', color: '#8aa0b6', fontWeight: 500, textAlign: 'right', whiteSpace: 'nowrap', borderBottom: '1px solid #1e2b3c', background: '#0f1a2b' }
  const td = { padding: '6px 10px', textAlign: 'right', whiteSpace: 'nowrap', borderTop: '1px solid #16223a', color: '#cbd5e1' }
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}><button onClick={csv} style={btnSec}>Descargar CSV</button></div>
      <div style={{ overflowX: 'auto', maxHeight: 420 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
          <thead><tr>{cols.map((c, i) => <th key={c} style={{ ...th, textAlign: i ? 'right' : 'left', position: 'sticky', top: 0, color: c === frente ? '#e6edf3' : th.color }}>{c}</th>)}</tr></thead>
          <tbody>
            {periodos.map(p => (
              <tr key={p.key}>
                {fila(p).map((v, i) => (
                  <td key={i} style={{ ...td, textAlign: i ? 'right' : 'left', color: i === 0 && gran === 'dia' && esPico.has(p.key) ? PICO : td.color, fontWeight: i === 0 && gran === 'dia' && esPico.has(p.key) ? 600 : 400 }}>
                    {i === 0 ? v : i === cols.indexOf('% absorción') ? fpct(v) : nf.format(v)}
                  </td>
                ))}
              </tr>
            ))}
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
