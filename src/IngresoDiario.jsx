import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient.js'

/* ── Módulo Ingreso Diario DOCUM ──────────────────────────────
   Lee la tabla docum_ingreso_diario (alimentada por el sync de
   GitHub Actions) y muestra el ingreso de casos día a día:
   total, escalado a N3, por flujo/tipo/categoría/temas y SLA.
   Sin librerías externas: los gráficos son CSS puro.            */

const FLUJO_COLOR = {
  pqrd: '#2dd4bf', correspondencia: '#60a5fa', medicina_laboral: '#f472b6',
  tutelas: '#fbbf24', entes_de_control: '#a78bfa', 'facturación': '#fb923c', sin_flujo: '#64748b',
}
const FLUJO_LABEL = {
  pqrd: 'PQRD', correspondencia: 'Correspondencia', medicina_laboral: 'Medicina laboral',
  tutelas: 'Tutelas', entes_de_control: 'Entes de control', 'facturación': 'Facturación', sin_flujo: 'Sin flujo',
}
const TIPO_LABEL = { incidente_docum: 'Incidente', requerimiento_docum: 'Requerimiento', sin_tipo: 'Sin clasificar' }
const TIPO_COLOR = { incidente_docum: '#f87171', requerimiento_docum: '#818cf8', sin_tipo: '#475569' }
const TEMA_LABEL = {
  testigos: 'Testigos digitales', reclasificacion: 'Reclasificación', reasignacion: 'Reasignación',
  contrasena: 'Contraseñas', radicado_asociado: 'Radicado asociado', clonado: 'Clonado',
}

const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0)
const merge = (rows, key) => {
  const acc = {}
  rows.forEach(r => Object.entries(r[key] || {}).forEach(([k, v]) => (acc[k] = (acc[k] || 0) + v)))
  return acc
}
const prettyDia = (d) => {
  const [, m, day] = d.split('-')
  const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  return `${day} ${meses[parseInt(m, 10) - 1]}`
}

export default function IngresoDiario() {
  const [rows, setRows] = useState([])
  const [sel, setSel] = useState('all')
  const [state, setState] = useState('loading') // loading | ready | empty | error

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('docum_ingreso_diario')
        .select('*')
        .order('dia', { ascending: true })
      if (error) { setState('error'); return }
      if (!data || data.length === 0) { setState('empty'); return }
      setRows(data)
      setState('ready')
    })()
  }, [])

  const scope = useMemo(() => {
    if (state !== 'ready') return null
    if (sel === 'all') {
      const total = rows.reduce((a, r) => a + r.total, 0)
      const escalado = rows.reduce((a, r) => a + r.escalado, 0)
      const sla_vencidos = rows.reduce((a, r) => a + (r.sla_vencidos || 0), 0)
      return {
        label: `Periodo · ${rows.length} días con registro`, total, escalado, sla_vencidos,
        flujo: merge(rows, 'flujo'), tipo: merge(rows, 'tipo'),
        categoria: merge(rows, 'categoria'), temas: merge(rows, 'temas'),
      }
    }
    const r = rows.find(x => x.dia === sel)
    return { label: `${r.dow} ${prettyDia(r.dia)}`, ...r }
  }, [rows, sel, state])

  if (state === 'loading') return <Msg>Cargando ingreso diario…</Msg>
  if (state === 'error') return <Msg tone="#f87171">No se pudo leer la tabla. Revisa la conexión o los permisos de lectura.</Msg>
  if (state === 'empty') return <Msg>Aún no hay datos de ingreso. El sync diario los cargará automáticamente.</Msg>

  const maxTotal = Math.max(...rows.map(r => r.total), 1)
  const flujoTop = Object.entries(scope.flujo).sort((a, b) => b[1] - a[1])[0]

  return (
    <div style={{ color: '#e6edf3' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, letterSpacing: '-0.02em' }}>Ingreso diario de casos</h2>
          <div style={{ color: '#8aa0b6', fontSize: 13 }}>{scope.label} · hora Colombia</div>
        </div>
        <div style={{ color: '#64748b', fontSize: 12, textAlign: 'right' }}>Marca DOCUM · Zendesk<br />Actualización diaria automática</div>
      </div>

      {/* Selector de día */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <Pill active={sel === 'all'} onClick={() => setSel('all')}>Todo el periodo</Pill>
        {rows.map(r => (
          <Pill key={r.dia} active={sel === r.dia} onClick={() => setSel(r.dia)}>
            {r.dow} {prettyDia(r.dia)} <span style={{ color: sel === r.dia ? '#04241f' : '#5eead4' }}>· {r.total}</span>
          </Pill>
        ))}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginBottom: 16 }}>
        <Kpi label="Casos ingresados" value={scope.total} accent="#5eead4" foot={sel === 'all' ? 'Total del periodo' : 'En el día'} />
        <Kpi label="Escalados a N3" value={scope.escalado} accent="#f59e0b" foot={`${pct(scope.escalado, scope.total)}% del ingreso`} />
        <Kpi label="Con SLA vencido" value={scope.sla_vencidos} accent="#ef4444" foot={`${pct(scope.sla_vencidos, scope.total)}% del ingreso`} />
        <Kpi label="Flujo dominante" small value={flujoTop ? (FLUJO_LABEL[flujoTop[0]] || flujoTop[0]) : '—'}
          accent={flujoTop ? (FLUJO_COLOR[flujoTop[0]] || '#8aa0b6') : '#8aa0b6'}
          foot={flujoTop ? `${flujoTop[1]} casos (${pct(flujoTop[1], scope.total)}%)` : ''} />
      </div>

      {/* Tendencia diaria (barras CSS) */}
      <Panel title="Ingreso por día" subtitle="Escalado a N3 vs. resuelto en nivel 1">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 180, paddingTop: 8 }}>
          {rows.map(r => {
            const dim = sel !== 'all' && sel !== r.dia
            const h = (r.total / maxTotal) * 150
            const escH = r.total ? (r.escalado / r.total) * h : 0
            return (
              <div key={r.dia} onClick={() => setSel(r.dia)}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', opacity: dim ? 0.35 : 1 }}>
                <div style={{ fontSize: 12, color: '#8aa0b6', marginBottom: 4 }}>{r.total}</div>
                <div style={{ width: '70%', height: h, background: '#16223a', borderRadius: 4, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', overflow: 'hidden' }}>
                  <div style={{ height: escH, background: '#f59e0b' }} />
                  <div style={{ height: h - escH, background: '#22d3ee' }} />
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>{r.dow}</div>
              </div>
            )
          })}
        </div>
        <Legend items={[['#22d3ee', 'No escalado'], ['#f59e0b', 'Escalado N3']]} />
      </Panel>

      {/* Desgloses */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12, marginTop: 12 }}>
        <Panel title="Por flujo" subtitle="Distribución del ingreso">
          <BarList data={scope.flujo} total={scope.total} labelMap={FLUJO_LABEL} colorMap={FLUJO_COLOR} />
        </Panel>
        <Panel title="Por tipo de caso" subtitle="Incidente vs. requerimiento">
          <BarList data={scope.tipo} total={scope.total} labelMap={TIPO_LABEL} colorMap={TIPO_COLOR} />
        </Panel>
        <Panel title="Por categoría" subtitle="Top de puntos de entrada">
          <BarList data={scope.categoria} total={scope.total} limit={6} defaultColor="#38bdf8" />
        </Panel>
        <Panel title="Temas destacados" subtitle="Detección por sub-flujo y texto">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 2 }}>
            {Object.entries(scope.temas || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <span style={{ color: v ? '#cbd5e1' : '#64748b' }}>{TEMA_LABEL[k] || k}</span>
                <span style={{ fontWeight: 600, color: v ? '#5eead4' : '#475569' }}>{v}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <p style={{ fontSize: 12, color: '#475569', marginTop: 14 }}>
        Escalamiento = último traspaso a grupo <b style={{ color: '#8aa0b6' }}>N3 - Desarrollo</b> o <b style={{ color: '#8aa0b6' }}>N3 - Data</b>. N1 = Atención + Gestión.
      </p>
    </div>
  )
}

/* ── Subcomponentes ── */
function Msg({ children, tone = '#8aa0b6' }) {
  return <div style={{ padding: '40px 8px', color: tone, fontSize: 14 }}>{children}</div>
}
function Pill({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      borderRadius: 8, padding: '6px 12px', fontSize: 14, fontWeight: 500, cursor: 'pointer',
      background: active ? '#5eead4' : '#111c2e', color: active ? '#04241f' : '#cbd5e1',
      border: `1px solid ${active ? '#5eead4' : '#1e2b3c'}`,
    }}>{children}</button>
  )
}
function Kpi({ label, value, foot, accent, small }) {
  return (
    <div style={{ borderRadius: 12, padding: 16, background: '#0f1a2b', border: '1px solid #1e2b3c' }}>
      <div style={{ fontSize: 12, color: '#8aa0b6' }}>{label}</div>
      <div style={{ marginTop: 8, fontWeight: 600, color: accent, fontSize: small ? 18 : 30, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{foot}</div>
    </div>
  )
}
function Panel({ title, subtitle, children }) {
  return (
    <div style={{ borderRadius: 12, padding: 16, background: '#0f1a2b', border: '1px solid #1e2b3c' }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: '#64748b' }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  )
}
function Legend({ items }) {
  return (
    <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
      {items.map(([c, l]) => (
        <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8aa0b6' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block' }} />{l}
        </div>
      ))}
    </div>
  )
}
function BarList({ data, total, labelMap, colorMap, limit, defaultColor = '#38bdf8' }) {
  let entries = Object.entries(data || {}).sort((a, b) => b[1] - a[1])
  if (limit) entries = entries.slice(0, limit)
  const max = Math.max(...entries.map(([, v]) => v), 1)
  const pretty = k => (labelMap && labelMap[k]) || k.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {entries.map(([k, v]) => (
        <div key={k}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
            <span style={{ color: '#cbd5e1' }}>{pretty(k)}</span>
            <span style={{ color: '#8aa0b6' }}>{v} · {pct(v, total)}%</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: '#16223a' }}>
            <div style={{ width: `${(v / max) * 100}%`, height: '100%', borderRadius: 3, background: (colorMap && colorMap[k]) || defaultColor }} />
          </div>
        </div>
      ))}
    </div>
  )
}
