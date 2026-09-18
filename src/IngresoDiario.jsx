import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient.js'

/* ── Módulo Ingreso DOCUM (sin IA externa) ────────────────────
   • Vista diaria: día a día (KPIs, tendencia, desgloses, temas).
     "Por flujo" es desplegable: clic en un flujo → qué llega dentro de él
     (sub-flujos, punto de entrada, tipo, temas y ejemplos de casos).
     "Temas destacados" también se despliega: ejemplos + en qué flujo aparece.
   • Análisis: gerencial por Día/Semana/Mes (casuísticas, subcasuísticas,
     candidatas a IA — todo calculado desde los datos).
   El botón "Copiar datos para análisis" arma un paquete (cifras + ejemplos
   + detalle por flujo) para pegarlo en el chat y obtener el resumen narrativo. */

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
const IA_BUCKETS = [
  { key: 'despliegue', label: 'Despliegue / consulta de información', abs: 0.65, como: 'Autoservicio de consulta de estado + agente que responde citando el expediente.', match: k => k.includes('despliegue_de_informaci') },
  { key: 'triage', label: 'Triage / enrutamiento de bandeja', abs: 0.65, como: 'Clasificador que asigna flujo/nivel al ingresar y balancea la bandeja.', match: k => k.includes('bandeja_de_entrada') },
  { key: 'reasig', label: 'Reasignación / reclasificación de trámite', abs: 0.60, como: 'Tipificación correcta en origen + reglas de enrutamiento; el analista aprueba excepciones.', match: k => k.includes('reasignacion') || k.includes('reclasificacion') },
  { key: 'adjuntar', label: 'Adjuntar / validar documentos', abs: 0.55, como: 'Autoservicio guiado + validación automática de formato/completitud.', match: k => k.includes('adjuntar_documentos') },
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

/* Fusiona los detalle_flujo de varias filas (para "Todo el periodo") */
function mergeDetalle(rows) {
  const out = {}
  rows.forEach(r => {
    Object.entries(r.detalle_flujo || {}).forEach(([fl, dims]) => {
      const d = (out[fl] ||= { subflujo: {}, categoria: {}, tipo: {}, temas: {} })
      mergeInto(d.subflujo, dims.subflujo); mergeInto(d.categoria, dims.categoria)
      mergeInto(d.tipo, dims.tipo); mergeInto(d.temas, dims.temas)
    })
  })
  return out
}
function mergeMuestra(rows) {
  const flujo = {}, tema = {}
  rows.forEach(r => {
    Object.entries(r.muestra?.flujo || {}).forEach(([k, a]) => { (flujo[k] ||= []).push(...a) })
    Object.entries(r.muestra?.tema || {}).forEach(([k, a]) => { (tema[k] ||= []).push(...a) })
  })
  return { flujo, tema }
}

/* Arma el texto que se copia para pedir el análisis en el chat */
function buildPaquete(rows, titulo) {
  const acc = { total: 0, escalado: 0, sla_vencidos: 0, flujo: {}, tipo: {}, categoria: {}, temas: {}, subflujo: {} }
  const mFlujo = {}, mTema = {}
  rows.forEach(r => {
    acc.total += r.total; acc.escalado += r.escalado; acc.sla_vencidos += r.sla_vencidos || 0
    mergeInto(acc.flujo, r.flujo); mergeInto(acc.tipo, r.tipo); mergeInto(acc.categoria, r.categoria)
    mergeInto(acc.temas, r.temas); mergeInto(acc.subflujo, r.subflujo)
    const mf = r.muestra?.flujo || {}, mt = r.muestra?.tema || {}
    Object.entries(mf).forEach(([k, a]) => { (mFlujo[k] ||= []).push(...a) })
    Object.entries(mt).forEach(([k, a]) => { (mTema[k] ||= []).push(...a) })
  })
  const det = mergeDetalle(rows)
  const topOf = (o, n = 12) => Object.entries(o).filter(([k]) => !k.startsWith('sin_')).sort((a, b) => b[1] - a[1]).slice(0, n)
  const L = []
  L.push(`ANÁLISIS DOCUM — ${titulo}`)
  L.push(`Total ingresado: ${acc.total} | Escalado a N3: ${acc.escalado} | SLA vencidos: ${acc.sla_vencidos}`)
  L.push('')
  L.push('FLUJO: ' + topOf(acc.flujo).map(([k, v]) => `${k}=${v}`).join(', '))
  L.push('TIPO: ' + topOf(acc.tipo).map(([k, v]) => `${k}=${v}`).join(', '))
  L.push('TEMAS: ' + Object.entries(acc.temas).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(', '))
  L.push('SUB-FLUJOS (top): ' + topOf(acc.subflujo).map(([k, v]) => `${k}=${v}`).join(', '))
  L.push('')
  L.push('DETALLE POR FLUJO (qué más llega dentro de cada uno):')
  topOf(acc.flujo, 6).forEach(([fl]) => {
    const d = det[fl]; if (!d) return
    const subs = Object.entries(d.subflujo).filter(([k]) => !k.startsWith('sin_')).sort((a, b) => b[1] - a[1]).slice(0, 5)
    L.push(`- ${FLUJO_LABEL[fl] || fl}: ${subs.map(([k, v]) => `${k}=${v}`).join(', ') || '(sin sub-flujo tipificado)'}`)
  })
  L.push('')
  L.push('EJEMPLOS DE CASOS POR TEMA:')
  Object.entries(mTema).forEach(([k, a]) => { if (a.length) L.push(`- ${k}: ${a.slice(0, 5).join(' || ')}`) })
  L.push('')
  L.push('EJEMPLOS DE CASOS POR FLUJO:')
  Object.entries(mFlujo).forEach(([k, a]) => { if (a.length) L.push(`- ${k}: ${a.slice(0, 4).join(' || ')}`) })
  L.push('')
  L.push('PETICIÓN: con estos datos y ejemplos, dame (1) una frase por cada tema explicando por qué contactan los usuarios, y (2) un diagnóstico breve con recomendaciones accionables.')
  return L.join('\n')
}

function BotonCopiar({ texto }) {
  const [ok, setOk] = useState(false)
  async function copiar() {
    try { await navigator.clipboard.writeText(texto) }
    catch { const t = document.createElement('textarea'); t.value = texto; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove() }
    setOk(true); setTimeout(() => setOk(false), 2500)
  }
  return (
    <button onClick={copiar} style={{ borderRadius: 8, padding: '8px 16px', fontSize: 13.5, fontWeight: 500, border: '1px solid #14b8a6', background: ok ? '#14b8a6' : 'transparent', color: ok ? '#04241f' : '#5eead4', cursor: 'pointer', whiteSpace: 'nowrap' }}>
      {ok ? '✓ Copiado — pégalo en el chat' : 'Copiar datos para análisis'}
    </button>
  )
}

export default function IngresoDiario() {
  const [rows, setRows] = useState([])
  const [state, setState] = useState('loading')
  const [view, setView] = useState('diaria')
  const [sel, setSel] = useState('all')
  const [gran, setGran] = useState('mes')
  const [selKey, setSelKey] = useState(null)

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('docum_ingreso_diario').select('*').order('dia', { ascending: true })
      if (error) { setState('error'); return }
      if (!data || data.length === 0) { setState('empty'); return }
      setRows(data); setState('ready')
    })()
  }, [])

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
    const acc = { total: 0, escalado: 0, sla_vencidos: 0, flujo: {}, subflujo: {}, tipo: {}, rows: g.rows }
    g.rows.forEach(r => {
      acc.total += r.total; acc.escalado += r.escalado; acc.sla_vencidos += r.sla_vencidos || 0
      mergeInto(acc.flujo, r.flujo); mergeInto(acc.subflujo, r.subflujo); mergeInto(acc.tipo, r.tipo)
    })
    return acc
  }, [grupos, selKey])

  const scopeDiaria = useMemo(() => {
    if (state !== 'ready') return null
    if (sel === 'all') {
      const total = rows.reduce((a, r) => a + r.total, 0), escalado = rows.reduce((a, r) => a + r.escalado, 0)
      const sla_vencidos = rows.reduce((a, r) => a + (r.sla_vencidos || 0), 0)
      const f = {}, t = {}, c = {}, tm = {}
      rows.forEach(r => { mergeInto(f, r.flujo); mergeInto(t, r.tipo); mergeInto(c, r.categoria); mergeInto(tm, r.temas) })
      return {
        label: `Periodo · ${rows.length} días con registro`, total, escalado, sla_vencidos,
        flujo: f, tipo: t, categoria: c, temas: tm,
        detalle_flujo: mergeDetalle(rows), muestra: mergeMuestra(rows), rows,
      }
    }
    const r = rows.find(x => x.dia === sel)
    return { label: `${r.dow} ${prettyDia(r.dia)}`, ...r, rows: [r] }
  }, [rows, sel, state])

  if (state === 'loading') return <Msg>Cargando ingreso DOCUM…</Msg>
  if (state === 'error') return <Msg tone="#f87171">No se pudo leer la tabla. Revisa la conexión o los permisos.</Msg>
  if (state === 'empty') return <Msg>Aún no hay datos de ingreso. El sync diario los cargará automáticamente.</Msg>

  return (
    <div style={{ color: '#e6edf3' }}>
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
      {view === 'diaria'
        ? <VistaDiaria rows={rows} sel={sel} setSel={setSel} scope={scopeDiaria} />
        : <VistaAnalisis grupos={grupos} gran={gran} setGran={setGran} selKey={selKey} setSelKey={setSelKey} scope={scopeAnalisis} />}
    </div>
  )
}

/* ════════ VISTA DIARIA ════════ */
function VistaDiaria({ rows, sel, setSel, scope }) {
  const maxTotal = Math.max(...rows.map(r => r.total), 1)
  const flujoTop = Object.entries(scope.flujo).sort((a, b) => b[1] - a[1])[0]
  const paquete = buildPaquete(scope.rows, scope.label)
  const alcance = sel === 'all' ? 'periodo:all' : `dia:${sel}`
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
      <div style={{ marginTop: 12 }}>
        <PorFlujoInteractivo scope={scope} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12, marginTop: 12 }}>
        <Panel title="Por tipo de caso" subtitle="Incidente vs. requerimiento"><BarList data={scope.tipo} total={scope.total} labelMap={TIPO_LABEL} colorMap={TIPO_COLOR} /></Panel>
        <Panel title="Por categoría" subtitle="Top de puntos de entrada"><BarList data={scope.categoria} total={scope.total} limit={6} defaultColor="#38bdf8" /></Panel>
      </div>
      <div style={{ marginTop: 12 }}>
        <TemasDestacados scope={scope} />
      </div>
      <PanelAnalisis paquete={paquete} alcance={alcance} />
    </>
  )
}

/* ── Drill-down "Por flujo": clic → qué llega dentro del flujo ── */
function PorFlujoInteractivo({ scope }) {
  const [activo, setActivo] = useState(null)
  const entries = Object.entries(scope.flujo || {}).sort((a, b) => b[1] - a[1])
  const max = Math.max(...entries.map(([, v]) => v), 1)
  const det = scope.detalle_flujo || {}
  const muestras = scope.muestra?.flujo || {}
  return (
    <Panel title="Por flujo" subtitle="Distribución del ingreso · clic en un flujo para ver qué llega dentro de él">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {entries.map(([k, v]) => {
          const abierto = activo === k
          return (
            <div key={k}>
              <div onClick={() => setActivo(a => a === k ? null : k)} style={{ cursor: 'pointer', userSelect: 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
                  <span style={{ color: abierto ? '#5eead4' : '#cbd5e1' }}>
                    <span style={{ display: 'inline-block', width: 14, color: '#5eead4' }}>{abierto ? '▾' : '▸'}</span>
                    {FLUJO_LABEL[k] || k}
                  </span>
                  <span style={{ color: '#8aa0b6' }}>{v} · {pct(v, scope.total)}%</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: '#16223a' }}>
                  <div style={{ width: `${(v / max) * 100}%`, height: '100%', borderRadius: 3, background: FLUJO_COLOR[k] || '#38bdf8' }} />
                </div>
              </div>
              {abierto && <DetalleFlujo dims={det[k]} muestras={muestras[k]} total={v} />}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

function DetalleFlujo({ dims, muestras, total }) {
  const wrap = { marginTop: 10, marginBottom: 4, padding: 14, background: '#0b1420', border: '1px solid #1e2b3c', borderRadius: 10 }
  if (!dims) return <div style={{ ...wrap, fontSize: 12.5, color: '#64748b' }}>Este día aún no tiene el detalle por flujo. Vuelve a correr el sync (v4) para poblarlo.</div>
  const top = (o, n = 6) => Object.entries(o || {}).filter(([k]) => !k.startsWith('sin_')).sort((a, b) => b[1] - a[1]).slice(0, n)
  const temas = Object.entries(dims.temas || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  return (
    <div style={wrap}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 18 }}>
        <MiniDist titulo="Qué más llega" data={top(dims.subflujo)} total={total} color="#22d3ee" pretty={prettySub} />
        <MiniDist titulo="Punto de entrada" data={top(dims.categoria, 5)} total={total} color="#38bdf8" />
        <MiniDist titulo="Tipo de caso" data={top(dims.tipo)} total={total} color="#818cf8" labelMap={TIPO_LABEL} />
      </div>
      {temas.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <Rotulo>Temas detectados</Rotulo>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {temas.map(([k, v]) => (
              <span key={k} style={{ fontSize: 12.5, padding: '3px 10px', borderRadius: 999, background: '#12283a', border: '1px solid #1e3a4a', color: '#5eead4' }}>{TEMA_LABEL[k] || k} · {v}</span>
            ))}
          </div>
        </div>
      )}
      {muestras?.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <Rotulo>Ejemplos de casos</Rotulo>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {muestras.slice(0, 5).map((s, i) => (
              <div key={i} style={{ fontSize: 12.5, color: '#a8b3d9', paddingLeft: 10, borderLeft: '2px solid #1e3a4a', lineHeight: 1.4 }}>{s}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function MiniDist({ titulo, data, total, color = '#38bdf8', labelMap, pretty }) {
  const max = Math.max(...data.map(([, v]) => v), 1)
  const fmt = k => (labelMap && labelMap[k]) || (pretty ? pretty(k) : k.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()))
  return (
    <div>
      <Rotulo>{titulo}</Rotulo>
      {data.length === 0
        ? <div style={{ fontSize: 12.5, color: '#475569' }}>Sin datos tipificados</div>
        : <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {data.map(([k, v]) => (
            <div key={k}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 3, gap: 8 }}>
                <span style={{ color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fmt(k)}</span>
                <span style={{ color: '#8aa0b6', whiteSpace: 'nowrap' }}>{v} · {pct(v, total)}%</span>
              </div>
              <div style={{ height: 5, borderRadius: 3, background: '#16223a' }}><div style={{ width: `${(v / max) * 100}%`, height: '100%', borderRadius: 3, background: color }} /></div>
            </div>
          ))}
        </div>}
    </div>
  )
}

/* ── Temas destacados desplegables ── */
function TemasDestacados({ scope }) {
  const [activo, setActivo] = useState(null)
  const temas = Object.entries(scope.temas || {}).sort((a, b) => b[1] - a[1])
  const muestras = scope.muestra?.tema || {}
  const det = scope.detalle_flujo || {}
  const totalTemas = temas.reduce((a, [, v]) => a + v, 0)
  const flujosDe = tema => Object.entries(det)
    .map(([fl, d]) => [fl, d.temas?.[tema] || 0])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
  return (
    <Panel title="Temas destacados" subtitle="Detección por sub-flujo y texto · clic para ver ejemplos y en qué flujo aparecen">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 2 }}>
        {temas.map(([k, v]) => {
          const abierto = activo === k
          const clickable = v > 0
          const flujos = clickable ? flujosDe(k) : []
          return (
            <div key={k}>
              <div onClick={() => clickable && setActivo(a => a === k ? null : k)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, padding: '5px 0', cursor: clickable ? 'pointer' : 'default' }}>
                <span style={{ color: v ? '#cbd5e1' : '#64748b' }}>
                  <span style={{ display: 'inline-block', width: 14, color: '#5eead4' }}>{clickable ? (abierto ? '▾' : '▸') : ''}</span>
                  {TEMA_LABEL[k] || k}
                </span>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <span style={{ fontSize: 11.5, color: '#64748b' }}>{v ? `${pct(v, totalTemas)}%` : ''}</span>
                  <span style={{ fontWeight: 600, color: v ? '#5eead4' : '#475569' }}>{v}</span>
                </span>
              </div>
              {abierto && (
                <div style={{ margin: '2px 0 8px', padding: 12, background: '#0b1420', border: '1px solid #1e2b3c', borderRadius: 10 }}>
                  {flujos.length > 0 && (
                    <div style={{ marginBottom: muestras[k]?.length ? 12 : 0 }}>
                      <Rotulo>Aparece en</Rotulo>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {flujos.map(([fl, n]) => (
                          <span key={fl} style={{ fontSize: 12.5, padding: '3px 10px', borderRadius: 999, background: '#12283a', border: '1px solid #1e3a4a', color: '#a8b3d9' }}>{FLUJO_LABEL[fl] || fl} · {n}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {muestras[k]?.length > 0 && (
                    <div>
                      <Rotulo>Ejemplos</Rotulo>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {muestras[k].slice(0, 5).map((s, i) => (
                          <div key={i} style={{ fontSize: 12.5, color: '#a8b3d9', paddingLeft: 10, borderLeft: '2px solid #1e3a4a', lineHeight: 1.4 }}>{s}</div>
                        ))}
                      </div>
                    </div>
                  )}
                  {flujos.length === 0 && !muestras[k]?.length && (
                    <div style={{ fontSize: 12.5, color: '#64748b' }}>Sin ejemplos guardados para este tema en el periodo.</div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

/* ════════ VISTA ANÁLISIS ════════ */
function VistaAnalisis({ grupos, gran, setGran, selKey, setSelKey, scope }) {
  if (!scope) return <Msg>Sin datos para analizar.</Msg>
  const etiqueta = k => gran === 'dia' ? prettyDia(k) : gran === 'mes' ? mesesL[+k.split('-')[1] - 1] : k.replace('-W', ' · sem ')
  const flujoTipif = Object.entries(scope.flujo).filter(([k]) => !k.startsWith('sin_')).reduce((a, [, v]) => a + v, 0)
  const subTop = Object.entries(scope.subflujo).filter(([k]) => !k.startsWith('sin_')).sort((a, b) => b[1] - a[1]).slice(0, 12)
  const buckets = IA_BUCKETS.map(b => {
    const vol = Object.entries(scope.subflujo).filter(([k]) => b.match(k.toLowerCase())).reduce((a, [, v]) => a + v, 0)
    return { ...b, vol, absorbible: Math.round(vol * b.abs) }
  }).filter(b => b.vol > 0).sort((a, b) => b.vol - a.vol)
  const volCand = buckets.reduce((a, b) => a + b.vol, 0), absCand = buckets.reduce((a, b) => a + b.absorbible, 0)
  const titulo = `${gran === 'mes' ? 'Mes' : gran === 'semana' ? 'Semana' : 'Día'} ${etiqueta(selKey)}`
  const paquete = buildPaquete(scope.rows, titulo)
  const alcance = `${gran}:${selKey}`   // ej: 'mes:2026-09', 'semana:2026-W38', 'dia:2026-09-16'

  return (
    <>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid #334155' }}>
          <Seg active={gran === 'dia'} onClick={() => setGran('dia')}>Día</Seg>
          <Seg active={gran === 'semana'} onClick={() => setGran('semana')}>Semana</Seg>
          <Seg active={gran === 'mes'} onClick={() => setGran('mes')}>Mes</Seg>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {grupos.map(g => <Pill key={g.key} active={selKey === g.key} onClick={() => setSelKey(g.key)}>{etiqueta(g.key)}</Pill>)}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12, marginBottom: 16 }}>
        <Kpi label="Casos en el periodo" value={scope.total} accent="#5eead4" foot="Ingreso total" />
        <Kpi label="Escalados a N3" value={scope.escalado} accent="#f59e0b" foot={`${pct(scope.escalado, scope.total)}%`} />
        <Kpi label="Con SLA vencido" value={scope.sla_vencidos} accent="#ef4444" foot={`${pct(scope.sla_vencidos, scope.total)}%`} />
      </div>
      <Panel title="Casuísticas por flujo" subtitle={`${flujoTipif} casos con flujo asignado`}>
        <BarList data={Object.fromEntries(Object.entries(scope.flujo).filter(([k]) => !k.startsWith('sin_')))} total={flujoTipif} labelMap={FLUJO_LABEL} colorMap={FLUJO_COLOR} />
      </Panel>
      <div style={{ marginTop: 12 }}>
        <Panel title="Subcasuísticas (sub-flujos)" subtitle="Top 12 acciones más repetidas">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {subTop.map(([k, v]) => {
              const max = subTop[0] ? subTop[0][1] : 1
              return (
                <div key={k}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, marginBottom: 4 }}>
                    <span style={{ color: '#cbd5e1' }}>{prettySub(k)}</span><span style={{ color: '#8aa0b6' }}>{v}</span>
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
      <PanelAnalisis paquete={paquete} alcance={alcance} />
    </>
  )
}

/* ── Resumen narrativo: copiar datos ⇄ pegar el análisis y guardarlo ── */
const _btnPri = { borderRadius: 8, padding: '8px 16px', fontSize: 13.5, fontWeight: 500, border: 'none', background: '#14b8a6', color: '#04241f', cursor: 'pointer', whiteSpace: 'nowrap' }
const _btnSec = { borderRadius: 8, padding: '8px 16px', fontSize: 13.5, fontWeight: 500, border: '1px solid #334155', background: 'transparent', color: '#cbd5e1', cursor: 'pointer', whiteSpace: 'nowrap' }

function PanelAnalisis({ paquete, alcance }) {
  const [guardado, setGuardado] = useState(null)   // { texto, actualizado }
  const [draft, setDraft] = useState('')
  const [editando, setEditando] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let vivo = true
    setGuardado(null); setDraft(''); setEditando(false); setErr(null)
    ;(async () => {
      const { data, error } = await supabase.from('docum_analisis')
        .select('texto,actualizado').eq('alcance', alcance).maybeSingle()
      if (!vivo || error || !data) return
      setGuardado(data); setDraft(data.texto)
    })()
    return () => { vivo = false }
  }, [alcance])

  async function guardar() {
    setSaving(true); setErr(null)
    const fila = { alcance, texto: draft.trim(), actualizado: new Date().toISOString() }
    const { error } = await supabase.from('docum_analisis').upsert(fila, { onConflict: 'alcance' })
    setSaving(false)
    if (error) { setErr('No se pudo guardar: ' + error.message); return }
    setGuardado({ texto: fila.texto, actualizado: fila.actualizado }); setEditando(false)
  }

  const hayTexto = !!guardado?.texto
  return (
    <div style={{ marginTop: 12, borderRadius: 12, padding: 20, background: 'linear-gradient(180deg,#0f1a2b,#0d1524)', border: '1px solid #1e2b3c' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: (editando || hayTexto) ? 16 : 0 }}>
        <div>
          <div style={{ fontWeight: 600 }}>Resumen narrativo (IA)</div>
          <div style={{ fontSize: 12, color: '#8aa0b6' }}>
            {hayTexto
              ? `Guardado · ${new Date(guardado.actualizado).toLocaleString('es-CO')}`
              : 'Copia los datos, pégalos en el chat, y trae de vuelta el análisis aquí'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <BotonCopiar texto={paquete} />
          {!editando && (
            <button onClick={() => { setDraft(guardado?.texto || ''); setEditando(true) }} style={_btnSec}>
              {hayTexto ? 'Editar análisis' : 'Pegar análisis'}
            </button>
          )}
        </div>
      </div>

      {editando && (
        <div>
          <textarea value={draft} onChange={e => setDraft(e.target.value)}
            placeholder="Pega aquí el análisis que te devolvió el chat…"
            style={{ width: '100%', minHeight: 180, boxSizing: 'border-box', resize: 'vertical', background: '#0b1420', color: '#e6edf3', border: '1px solid #1e2b3c', borderRadius: 10, padding: 12, fontSize: 13.5, lineHeight: 1.5, fontFamily: 'inherit' }} />
          {err && <div style={{ color: '#f87171', fontSize: 12.5, marginTop: 8 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={guardar} disabled={saving || !draft.trim()} style={{ ..._btnPri, opacity: (saving || !draft.trim()) ? 0.5 : 1, cursor: (saving || !draft.trim()) ? 'default' : 'pointer' }}>
              {saving ? 'Guardando…' : 'Guardar en el módulo'}
            </button>
            <button onClick={() => { setEditando(false); setDraft(guardado?.texto || ''); setErr(null) }} style={_btnSec}>Cancelar</button>
          </div>
        </div>
      )}

      {!editando && hayTexto && (
        <div style={{ background: '#0b1420', border: '1px solid #1e2b3c', borderRadius: 10, padding: 16 }}>
          <Narrativa texto={guardado.texto} />
        </div>
      )}
    </div>
  )
}

/* Render ligero del texto: párrafos, viñetas y **negrita** */
function Narrativa({ texto }) {
  const inline = s => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i} style={{ color: '#e6edf3' }}>{p.slice(2, -2)}</strong>
      : <React.Fragment key={i}>{p}</React.Fragment>)
  const bloques = texto.trim().split(/\n{2,}/)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13.5, lineHeight: 1.55, color: '#c7d2e0' }}>
      {bloques.map((b, i) => {
        const lineas = b.split('\n')
        const esLista = lineas.length > 0 && lineas.every(l => /^\s*[-•*]\s+/.test(l))
        if (esLista) return (
          <ul key={i} style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {lineas.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-•*]\s+/, ''))}</li>)}
          </ul>
        )
        return (
          <p key={i} style={{ margin: 0 }}>
            {lineas.map((l, j) => <React.Fragment key={j}>{inline(l)}{j < lineas.length - 1 && <br />}</React.Fragment>)}
          </p>
        )
      })}
    </div>
  )
}

/* ── Subcomponentes ── */
function Msg({ children, tone = '#8aa0b6' }) { return <div style={{ padding: '40px 8px', color: tone, fontSize: 14 }}>{children}</div> }
function Rotulo({ children }) { return <div style={{ fontSize: 11.5, color: '#8aa0b6', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>{children}</div> }
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
