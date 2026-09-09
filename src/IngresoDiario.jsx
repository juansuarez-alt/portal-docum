import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient.js'

/* ── Módulo Ingreso DOCUM ─────────────────────────────────────
   Dos vistas sobre docum_ingreso_diario:
   • Vista diaria: día a día (KPIs, tendencia, desgloses, análisis IA).
   • Análisis: gerencial por Día/Semana/Mes (casuísticas, subcasuísticas,
     candidatas a absorción por IA).                              */

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
// Buckets de candidatas a IA (mapa sub-flujo → grupo automatizable)
const IA_BUCKETS = [
  { key: 'despliegue', label: 'Despliegue / consulta de información', abs: 0.65, como: 'Autoservicio de consulta de estado + agente IA (RAG) que responde citando el expediente.', match: k => k.includes('despliegue_de_informaci') },
  { key: 'triage', label: 'Triage / enrutamiento de bandeja', abs: 0.65, como: 'Clasificador que asigna flujo/nivel al ingresar y balancea la bandeja por carga.', match: k => k.includes('bandeja_de_entrada') },
  { key: 'reasig', label: 'Reasignación / reclasificación de trámite', abs: 0.60, como: 'Tipificación correcta en origen + motor de reglas de enrutamiento; el analista aprueba excepciones.', match: k => k.includes('reasignacion') || k.includes('reclasificacion') },
  { key: 'adjuntar', label: 'Adjuntar / validar documentos', abs: 0.55, como: 'Autoservicio guiado + validación automática de formato/completitud antes de radicar.', match: k => k.includes('adjuntar_documentos') },
  { key: 'testigos', label: 'Búsqueda de testigos digitales', abs: 0.50, como: 'Búsqueda automatizada en el repositorio y armado del paquete de evidencia.', match: k => k.includes('busqueda_de_testigos') },
]

const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0)
const mergeInto = (acc, o) => { Object.entries(o || {}).forEach(([k, v]) => (acc[k] = (acc[k] || 0) + v)); return acc }
const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const mesesL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const prettyDia = d => { const [, m, day] = d.split('-'); return `${day} ${meses[+m - 1]}` }
const prettySub = k => k.replace(/_-_/g, ' — ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\w/, c => c.toUpperCase())
function isoWeek(dstr) {
  const d = new Date(dstr + 'T12:00:00Z'); const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 3); const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const w = 1 + Math.round(((d - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7)
  return `${d.getUTCFullYear()}-W${String(w).padStart(2, '0')}`
}

export default function IngresoDiario() {
  const [rows, setRows] = useState([])
  const [state, setState] = useState('loading')
  const [view, setView] = useState('diaria')          // 'diaria' | 'analisis'
  // vista diaria
  const [sel, setSel] = useState('all')
  const [periodoIA, setPeriodoIA] = useState('dia')
  const [ia, setIa] = useState({ loading: false, text: '', error: '', cacheado: false })
  // vista análisis
  const [gran, setGran] = useState('mes')             // 'dia' | 'semana' | 'mes'
  const [selKey, setSelKey] = useState(null)

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('docum_ingreso_diario').select('*').order('dia', { ascending: true })
      if (error) { setState('error'); return }
      if (!data || data.length === 0) { setState('empty'); return }
      setRows(data); setState('ready')
    })()
  }, [])

  // ── agrupación para la vista Análisis ──
  const grupos = useMemo(() => {
    if (state !== 'ready') return []
    const keyOf = r => gran === 'dia' ? r.dia : gran === 'semana' ? isoWeek(r.dia) : r.dia.slice(0, 7)
    const map = new Map()
    rows.forEach(r => { const k = keyOf(r); if (!map.has(k)) map.set(k, []); map.get(k).push(r) })
    return [...map.entries()].map(([k, rs]) => ({ key: k, rows: rs }))
  }, [rows, gran, state])

  useEffect(() => { if (grupos.length) setSelKey(grupos[grupos.length - 1].key) }, [grupos])

  const scopeAnalisis = useMemo(() => {
    const g = grupos.find(x => x.key === selKey) || grupos[grupos.length - 1]
    if (!g) return null
    const acc = { total: 0, escalado: 0, sla_vencidos: 0, flujo: {}, subflujo: {}, tipo: {} }
    g.rows.forEach(r => {
      acc.total += r.total; acc.escalado += r.escalado; acc.sla_vencidos += r.sla_vencidos || 0
      mergeInto(acc.flujo, r.flujo); mergeInto(acc.subflujo, r.subflujo); mergeInto(acc.tipo, r.tipo)
    })
    return acc
  }, [grupos, selKey])

  const scopeDiaria = useMemo(() => {
    if (state !== 'ready') return null
    if (sel === 'all') {
      const total = rows.reduce((a, r) => a + r.total, 0)
      const escalado = rows.reduce((a, r) => a + r.escalado, 0)
      const sla_vencidos = rows.reduce((a, r) => a + (r.sla_vencidos || 0), 0)
      const f = {}, t = {}, c = {}, tm = {}
      rows.forEach(r => { mergeInto(f, r.flujo); mergeInto(t, r.tipo); mergeInto(c, r.categoria); mergeInto(tm, r.temas) })
      return { label: `Periodo · ${rows.length} días con registro`, total, escalado, sla_vencidos, flujo: f, tipo: t, categoria: c, temas: tm }
    }
    const r = rows.find(x => x.dia === sel)
    return { label: `${r.dow} ${prettyDia(r.dia)}`, ...r }
  }, [rows, sel, state])

  async function analizar() {
    const dia = sel === 'all' ? rows[rows.length - 1].dia : sel
    setIa({ loading: true, text: '', error: '', cacheado: false })
    const { data, error } = await supabase.functions.invoke('analisis-ia', { body: { periodo: periodoIA, dia } })
    if (error) { setIa({ loading: false, text: '', error: 'No se pudo generar el análisis. Revisa la función o la llave.', cacheado: false }); return }
    if (data?.error) { setIa({ loading: false, text: '', error: data.error, cacheado: false }); return }
    setIa({ loading: false, text: data.analisis || 'Sin respuesta.', error: '', cacheado: !!data.cacheado })
  }

  if (state === 'loading') return <Msg>Cargando ingreso DOCUM…</Msg>
  if (state === 'error') return <Msg tone="#f87171">No se pudo leer la tabla. Revisa la conexión o los permisos.</Msg>
  if (state === 'empty') return <Msg>Aún no hay datos de ingreso. El sync diario los cargará automáticamente.</Msg>

  return (
    <div style={{ color: '#e6edf3' }}>
      {/* Cabecera + toggle de vista */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, letterSpacing: '-0.02em' }}>Ingreso DOCUM</h2>
          <div style={{ color: '#8aa0b6', fontSize: 13 }}>Marca DOCUM · Zendesk · hora Colombia</div>
        </div>
        <div style={{ display: 'flex', borderRadius: 10, overflow: 'hidden', border: '1px solid #334155' }}>
          <Seg active={view === 'diaria'} onClick={() => setView('diaria')}>Vista diaria</Seg>
          <Seg active={view === 'analisis'} onClick={() => setView('analisis')}>Análisis</Seg>
        </div>
      </div>

      {view === 'diaria' ? (
        <VistaDiaria rows={rows} sel={sel} setSel={setSel} scope={scopeDiaria}
          periodoIA={periodoIA} setPeriodoIA={setPeriodoIA} ia={ia} analizar={analizar} />
      ) : (
        <VistaAnalisis grupos={grupos} gran={gran} setGran={setGran} selKey={selKey} setSelKey={setSelKey} scope={scopeAnalisis} />
      )}
    </div>
  )
}

/* ════════ VISTA DIARIA ════════ */
function VistaDiaria({ rows, sel, setSel, scope, periodoIA, setPeriodoIA, ia, analizar }) {
  const maxTotal = Math.max(...rows.map(r => r.total), 1)
  const flujoTop = Object.entries(scope.flujo).sort((a, b) => b[1] - a[1])[0]
  return (
    <>
      <div style={{ color: '#8aa0b6', fontSize: 13, marginBottom: 12 }}>{scope.label}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <Pill active={sel === 'all'} onClick={() => setSel('all')}>Todo el periodo</Pill>
        {rows.map(r => (
          <Pill key={r.dia} active={sel === r.dia} onClick={() => setSel(r.dia)}>
            {r.dow} {prettyDia(r.dia)} <span style={{ color: sel === r.dia ? '#04241f' : '#5eead4' }}>· {r.total}</span>
          </Pill>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginBottom: 16 }}>
        <Kpi label="Casos ingresados" value={scope.total} accent="#5eead4" foot={sel === 'all' ? 'Total del periodo' : 'En el día'} />
        <Kpi label="Escalados a N3" value={scope.escalado} accent="#f59e0b" foot={`${pct(scope.escalado, scope.total)}% del ingreso`} />
        <Kpi label="Con SLA vencido" value={scope.sla_vencidos} accent="#ef4444" foot={`${pct(scope.sla_vencidos, scope.total)}% del ingreso`} />
        <Kpi label="Flujo dominante" small value={flujoTop ? (FLUJO_LABEL[flujoTop[0]] || flujoTop[0]) : '—'}
          accent={flujoTop ? (FLUJO_COLOR[flujoTop[0]] || '#8aa0b6') : '#8aa0b6'} foot={flujoTop ? `${flujoTop[1]} casos (${pct(flujoTop[1], scope.total)}%)` : ''} />
      </div>
      <Panel title="Ingreso por día" subtitle="Escalado a N3 vs. resuelto en nivel 1">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 180, paddingTop: 8 }}>
          {rows.map(r => {
            const dim = sel !== 'all' && sel !== r.dia
            const h = (r.total / maxTotal) * 150, escH = r.total ? (r.escalado / r.total) * h : 0
            return (
              <div key={r.dia} onClick={() => setSel(r.dia)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', opacity: dim ? 0.35 : 1 }}>
                <div style={{ fontSize: 12, color: '#8aa0b6', marginBottom: 4 }}>{r.total}</div>
                <div style={{ width: '70%', height: h, background: '#16223a', borderRadius: 4, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', overflow: 'hidden' }}>
                  <div style={{ height: escH, background: '#f59e0b' }} /><div style={{ height: h - escH, background: '#22d3ee' }} />
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>{r.dow}</div>
              </div>
            )
          })}
        </div>
        <Legend items={[['#22d3ee', 'No escalado'], ['#f59e0b', 'Escalado N3']]} />
      </Panel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12, marginTop: 12 }}>
        <Panel title="Por flujo" subtitle="Distribución del ingreso"><BarList data={scope.flujo} total={scope.total} labelMap={FLUJO_LABEL} colorMap={FLUJO_COLOR} /></Panel>
        <Panel title="Por tipo de caso" subtitle="Incidente vs. requerimiento"><BarList data={scope.tipo} total={scope.total} labelMap={TIPO_LABEL} colorMap={TIPO_COLOR} /></Panel>
        <Panel title="Por categoría" subtitle="Top de puntos de entrada"><BarList data={scope.categoria} total={scope.total} limit={6} defaultColor="#38bdf8" /></Panel>
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
      <div style={{ marginTop: 12, borderRadius: 12, padding: 20, background: 'linear-gradient(180deg,#0f1a2b,#0d1524)', border: '1px solid #1e2b3c' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div><div style={{ fontWeight: 600 }}>Análisis con IA</div><div style={{ fontSize: 12, color: '#8aa0b6' }}>Diagnóstico de causa raíz y acciones recomendadas</div></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid #334155' }}>
              <Seg active={periodoIA === 'dia'} onClick={() => setPeriodoIA('dia')}>Día</Seg>
              <Seg active={periodoIA === 'semana'} onClick={() => setPeriodoIA('semana')}>Semana</Seg>
            </div>
            <button onClick={analizar} disabled={ia.loading} style={{ borderRadius: 8, padding: '8px 16px', fontSize: 14, fontWeight: 500, border: 'none', background: ia.loading ? '#334155' : '#7c3aed', color: '#fff', cursor: ia.loading ? 'default' : 'pointer' }}>
              {ia.loading ? 'Analizando…' : 'Analizar con IA'}
            </button>
          </div>
        </div>
        {ia.error && <p style={{ fontSize: 13, color: '#f87171', marginTop: 14 }}>{ia.error}</p>}
        {ia.text && <div style={{ marginTop: 14 }}><div style={{ fontSize: 14, lineHeight: 1.6, color: '#dbe4ee', whiteSpace: 'pre-line' }}>{ia.text}</div>{ia.cacheado && <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>· resultado guardado (no consumió IA)</div>}</div>}
        {!ia.text && !ia.error && !ia.loading && <p style={{ fontSize: 13, color: '#64748b', marginTop: 14 }}>Elige Día o Semana y pulsa “Analizar con IA”.</p>}
      </div>
    </>
  )
}

/* ════════ VISTA ANÁLISIS ════════ */
function VistaAnalisis({ grupos, gran, setGran, selKey, setSelKey, scope }) {
  if (!scope) return <Msg>Sin datos para analizar.</Msg>
  const etiqueta = k => {
    if (gran === 'dia') return prettyDia(k)
    if (gran === 'mes') { const [, m] = k.split('-'); return mesesL[+m - 1] }
    return k.replace('-W', ' · sem ')
  }
  const flujoTipif = Object.entries(scope.flujo).filter(([k]) => k !== 'sin_flujo' && k !== 'sin_dato').reduce((a, [, v]) => a + v, 0)
  const subTop = Object.entries(scope.subflujo).filter(([k]) => k !== 'sin_subflujo' && k !== 'sin_dato').sort((a, b) => b[1] - a[1]).slice(0, 12)
  const buckets = IA_BUCKETS.map(b => {
    const vol = Object.entries(scope.subflujo).filter(([k]) => b.match(k.toLowerCase())).reduce((a, [, v]) => a + v, 0)
    return { ...b, vol, absorbible: Math.round(vol * b.abs) }
  }).filter(b => b.vol > 0).sort((a, b) => b.vol - a.vol)
  const volCand = buckets.reduce((a, b) => a + b.vol, 0)
  const absCand = buckets.reduce((a, b) => a + b.absorbible, 0)

  return (
    <>
      {/* selector granularidad */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid #334155' }}>
          <Seg active={gran === 'dia'} onClick={() => setGran('dia')}>Día</Seg>
          <Seg active={gran === 'semana'} onClick={() => setGran('semana')}>Semana</Seg>
          <Seg active={gran === 'mes'} onClick={() => setGran('mes')}>Mes</Seg>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {grupos.map(g => (
            <Pill key={g.key} active={selKey === g.key} onClick={() => setSelKey(g.key)}>{etiqueta(g.key)}</Pill>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12, marginBottom: 16 }}>
        <Kpi label="Casos en el periodo" value={scope.total} accent="#5eead4" foot="Ingreso total" />
        <Kpi label="Escalados a N3" value={scope.escalado} accent="#f59e0b" foot={`${pct(scope.escalado, scope.total)}%`} />
        <Kpi label="Con SLA vencido" value={scope.sla_vencidos} accent="#ef4444" foot={`${pct(scope.sla_vencidos, scope.total)}%`} />
      </div>

      <Panel title="Casuísticas por flujo" subtitle={`${flujoTipif} casos con flujo asignado`}>
        <BarList data={Object.fromEntries(Object.entries(scope.flujo).filter(([k]) => k !== 'sin_flujo' && k !== 'sin_dato'))} total={flujoTipif} labelMap={FLUJO_LABEL} colorMap={FLUJO_COLOR} />
      </Panel>

      <div style={{ marginTop: 12 }}>
        <Panel title="Subcasuísticas (sub-flujos)" subtitle="Top 12 acciones más repetidas — detalle accionable">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {subTop.map(([k, v]) => {
              const max = subTop[0][1] || 1
              return (
                <div key={k}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, marginBottom: 4 }}>
                    <span style={{ color: '#cbd5e1' }}>{prettySub(k)}</span>
                    <span style={{ color: '#8aa0b6' }}>{v}</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: '#16223a' }}><div style={{ width: `${(v / max) * 100}%`, height: '100%', borderRadius: 3, background: '#22d3ee' }} /></div>
                </div>
              )
            })}
          </div>
        </Panel>
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Candidatas a absorción por IA</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>Priorizadas por volumen × facilidad de automatización (estimación de primera fase)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12 }}>
          {buckets.map(b => (
            <div key={b.key} style={{ borderRadius: 12, padding: 16, background: '#0f1a2b', borderLeft: '4px solid #14b8a6', border: '1px solid #1e2b3c' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{b.label}</div>
                <div style={{ fontSize: 12, color: '#8aa0b6', whiteSpace: 'nowrap' }}>{b.vol} casos</div>
              </div>
              <div style={{ fontSize: 12.5, color: '#a8b3d9', margin: '8px 0 10px' }}>{b.como}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748b' }}>
                <span>Absorción estimada</span><span style={{ color: '#22c55e', fontWeight: 600 }}>{Math.round(b.abs * 100)}% · {b.absorbible} casos</span>
              </div>
              <div style={{ height: 7, borderRadius: 4, background: '#16223a', marginTop: 6 }}><div style={{ width: `${b.abs * 100}%`, height: '100%', borderRadius: 4, background: 'linear-gradient(90deg,#14b8a6,#22d3ee)' }} /></div>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12, marginTop: 12 }}>
          <Kpi label="Volumen candidato" value={volCand} accent="#5eead4" foot="En las subcasuísticas priorizadas" />
          <Kpi label="Absorción potencial" value={absCand} accent="#4ade80" foot="Casos que no requerirían analista" />
          <Kpi label="Alivio sobre el periodo" small value={`${pct(absCand, scope.total)}%`} accent="#4ade80" foot="De la carga del periodo" />
        </div>
      </div>
    </>
  )
}

/* ── Subcomponentes ── */
function Msg({ children, tone = '#8aa0b6' }) { return <div style={{ padding: '40px 8px', color: tone, fontSize: 14 }}>{children}</div> }
function Pill({ active, onClick, children }) {
  return <button onClick={onClick} style={{ borderRadius: 8, padding: '6px 12px', fontSize: 13.5, fontWeight: 500, cursor: 'pointer', background: active ? '#5eead4' : '#111c2e', color: active ? '#04241f' : '#cbd5e1', border: `1px solid ${active ? '#5eead4' : '#1e2b3c'}` }}>{children}</button>
}
function Seg({ active, onClick, children }) {
  return <button onClick={onClick} style={{ padding: '7px 14px', fontSize: 13, border: 'none', cursor: 'pointer', background: active ? '#5eead4' : 'transparent', color: active ? '#04241f' : '#cbd5e1' }}>{children}</button>
}
function Kpi({ label, value, foot, accent, small }) {
  return (
    <div style={{ borderRadius: 12, padding: 16, background: '#0f1a2b', border: '1px solid #1e2b3c' }}>
      <div style={{ fontSize: 12, color: '#8aa0b6' }}>{label}</div>
      <div style={{ marginTop: 8, fontWeight: 600, color: accent, fontSize: small ? 20 : 30, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{foot}</div>
    </div>
  )
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
    <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
      {items.map(([c, l]) => (<div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8aa0b6' }}><span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block' }} />{l}</div>))}
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
            <span style={{ color: '#cbd5e1' }}>{pretty(k)}</span><span style={{ color: '#8aa0b6' }}>{v} · {pct(v, total)}%</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: '#16223a' }}><div style={{ width: `${(v / max) * 100}%`, height: '100%', borderRadius: 3, background: (colorMap && colorMap[k]) || defaultColor }} /></div>
        </div>
      ))}
    </div>
  )
}
