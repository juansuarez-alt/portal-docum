import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient.js'
import { calcularCapacidad } from './capacidadCalc.js'

/* ================= CAPACIDAD (por marca) =================
   ¿Cuántos analistas necesita cada frente según el volumen de tickets, la meta diaria y el OLA?
   Visible solo para administradores y líderes (columna analysts.lider); App.jsx les da
   permiso completo: ver el resultado, cargar volumen y configurar los frentes. */

const FRENTES_BASE = [
  { nombre: 'Atención', ola_minutos: 15, meta_diaria: 50, analistas_actuales: 1, ocupacion_max: 0.85 },
  { nombre: 'Gestión', ola_minutos: 60, meta_diaria: 50, analistas_actuales: 1, ocupacion_max: 0.85 },
  { nombre: 'Funcionarios', ola_minutos: 60, meta_diaria: 50, analistas_actuales: 2, ocupacion_max: 0.85 },
  { nombre: 'PDA', ola_minutos: 720, meta_diaria: 50, analistas_actuales: 3, ocupacion_max: 1 },
  { nombre: 'VIP', ola_minutos: 720, meta_diaria: 25, analistas_actuales: 3, ocupacion_max: 1 },
]
const FRENTE_VACIO = { nombre: '', ola_minutos: 60, meta_diaria: 50, horas_productivas: 6, analistas_actuales: 1, ausentismo: 0, ocupacion_max: 0.85, min_analistas: 1, activo: true }

const pad = n => String(n).padStart(2, '0')
const isoLocal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const rango = tipo => {
  const hoy = new Date(), y = hoy.getFullYear(), m = hoy.getMonth()
  if (tipo === 'mesant') return [isoLocal(new Date(y, m - 1, 1)), isoLocal(new Date(y, m, 0))]
  if (tipo === '30') return [isoLocal(new Date(y, m, hoy.getDate() - 29)), isoLocal(hoy)]
  return [isoLocal(new Date(y, m, 1)), isoLocal(hoy)]
}
const fmt = (n, d = 0) => Number.isFinite(n) ? n.toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—'
const pct = n => Number.isFinite(n) ? fmt(n * 100) + ' %' : '—'
const olaTxt = m => m >= 60 ? fmt(m / 60, m % 60 ? 1 : 0) + ' h' : m + ' min'
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
const signo = n => (n > 0 ? '+' : '') + fmt(n)
const PILL = { sobra: 'green', justo: 'amber', falta: 'rose' }
const ETQ = { sobra: 'Sobra', justo: 'Justo', falta: 'Falta' }

// Acepta 2026-10-01, 01/10/2026 o una fecha de Excel (número de serie o Date)
const aFecha = v => {
  if (v instanceof Date) return isoLocal(v)
  if (typeof v === 'number') return isoLocal(new Date(Math.round((v - 25569) * 864e5) + new Date().getTimezoneOffset() * 6e4))
  const s = String(v ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  return m ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : null
}

export default function Capacidad({ equipo, perm, name }) {
  const puedeCargar = perm.editar
  const puedeConfigurar = perm.aprobar
  const [vista, setVista] = useState('resultado')
  const [frentes, setFrentes] = useState([])
  const [cargas, setCargas] = useState([])
  const [festivos, setFestivos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [msg, setMsg] = useState(null)
  const [[desde, hasta], setRango] = useState(() => rango('mes'))
  const [sabados, setSabados] = useState(false)

  const load = useCallback(async () => {
    setCargando(true)
    const { data: f, error } = await supabase.from('cap_frentes').select('*').eq('marca', equipo).order('orden').order('nombre')
    if (error) { setMsg({ t: 'err', m: error.message.includes('cap_frentes') ? 'Falta crear las tablas: ejecuta supabase/capacidad.sql en Supabase.' : 'Error: ' + error.message }); setCargando(false); return }
    setFrentes(f || [])
    const ids = (f || []).map(x => x.id)
    const { data: c } = ids.length ? await supabase.from('cap_volumen').select('*').in('frente_id', ids).order('desde', { ascending: false }) : { data: [] }
    setCargas(c || [])
    const { data: fe } = await supabase.from('cap_festivos').select('fecha')
    setFestivos((fe || []).map(x => x.fecha))
    setCargando(false)
  }, [equipo])
  useEffect(() => { load() }, [load])

  const res = useMemo(() => calcularCapacidad(frentes, cargas, desde, hasta, festivos, sabados), [frentes, cargas, desde, hasta, festivos, sabados])

  const crearBase = async () => {
    const filas = FRENTES_BASE.map((f, i) => ({ ...FRENTE_VACIO, ...f, marca: equipo, orden: i + 1 }))
    const { error } = await supabase.from('cap_frentes').insert(filas)
    if (error) return setMsg({ t: 'err', m: 'Error: ' + error.message })
    setMsg({ t: 'ok', m: 'Frentes creados. Revisa la meta y los analistas de cada uno en Configuración.' }); load()
  }

  if (cargando) return <div className="card"><div className="empty">Cargando…</div></div>

  return (
    <>
      <div className="card">
        <div className="cardh">
          <div><b>Capacidad {equipo}</b>
            <div className="muted sm">Analistas requeridos por frente según el volumen de tickets, la meta diaria y el OLA.</div></div>
          <div className="row">
            {[['resultado', 'Resultado'], ...(puedeCargar ? [['carga', 'Cargar volumen']] : []), ...(puedeConfigurar ? [['config', 'Configuración']] : [])].map(([k, t]) =>
              <button key={k} className={'btn sm ' + (vista === k ? 'primary' : 'ghost')} style={vista === k ? {} : { border: '1px solid var(--line)' }} onClick={() => { setVista(k); setMsg(null) }}>{t}</button>)}
          </div>
        </div>
        {msg && <div className={'notice ' + (msg.t === 'err' ? 'err' : 'ok')}>{msg.m}</div>}
        {frentes.length === 0 && (
          <div className="empty">
            Aún no hay frentes configurados para {equipo}.
            {puedeConfigurar
              ? <div style={{ marginTop: 10 }}><button className="btn primary sm" onClick={crearBase}>Crear frentes base (Atención, Gestión, Funcionarios, PDA, VIP)</button>
                <span className="muted sm"> o agrégalos uno por uno en Configuración.</span></div>
              : <div className="sm" style={{ marginTop: 6 }}>Pídele a un verificador o administrador que los configure.</div>}
          </div>
        )}
      </div>

      {vista === 'resultado' && frentes.length > 0 &&
        <Resultado {...{ res, desde, hasta, setRango, sabados, setSabados, equipo }} />}
      {vista === 'carga' && puedeCargar &&
        <Carga {...{ frentes, cargas, equipo, name, load, setMsg }} desdeIni={desde} hastaIni={hasta} />}
      {vista === 'config' && puedeConfigurar &&
        <Config {...{ frentes, equipo, load, setMsg }} />}
    </>
  )
}

/* ---------------------------- Resultado ---------------------------- */
function Resultado({ res, desde, hasta, setRango, sabados, setSabados, equipo }) {
  const { dias, filas, total: T, movimientos: M } = res

  const exportar = () => {
    const head = ['Marca', 'Desde', 'Hasta', 'Días hábiles', 'Frente', 'OLA (min)', 'Tickets', 'Tickets/día', 'Meta', 'Req. exacto', 'Requeridos', 'Actuales', 'Holgura', 'Ocupación %']
    const rows = filas.map(x => [equipo, desde, hasta, dias, x.frente, x.ola_minutos, x.tickets.toFixed(0), x.demanda.toFixed(1), x.meta, x.reqExacto.toFixed(2), x.requeridos, x.actuales, x.holgura, Number.isFinite(x.ocupacion) ? (x.ocupacion * 100).toFixed(0) : ''])
    const csv = '﻿' + [head, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `capacidad_${equipo}_${desde}_${hasta}.csv`; a.click()
  }

  return (
    <>
      <div className="card">
        <div style={{ paddingTop: 16 }}>
          <div className="row end">
            <label className="f" style={{ width: 160 }}>Desde<input type="date" value={desde} onChange={e => setRango([e.target.value, hasta])} /></label>
            <label className="f" style={{ width: 160 }}>Hasta<input type="date" value={hasta} onChange={e => setRango([desde, e.target.value])} /></label>
            <label className="sm muted" style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 10 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={sabados} onChange={e => setSabados(e.target.checked)} /> Trabaja sábados</label>
            <button className="btn ghost sm" style={{ border: '1px solid var(--line)' }} onClick={() => setRango(rango('mes'))}>Mes actual</button>
            <button className="btn ghost sm" style={{ border: '1px solid var(--line)' }} onClick={() => setRango(rango('mesant'))}>Mes anterior</button>
            <button className="btn ghost sm" style={{ border: '1px solid var(--line)' }} onClick={() => setRango(rango('30'))}>Últimos 30 días</button>
            <button className="btn ghost sm" style={{ border: '1px solid var(--line)' }} onClick={exportar}>Exportar CSV</button>
          </div>
        </div>
      </div>

      <div className="capkpis">
        {[['Días hábiles', fmt(dias)], ['Tickets del rango', fmt(T.tickets)], ['Tickets / día', fmt(T.demanda, 1)],
          ['Analistas actuales', fmt(T.actuales)], ['Analistas requeridos', fmt(T.requeridos)]].map(([k, v]) =>
          <div key={k} className="card capkpi"><span className="muted sm">{k}</span><b>{v}</b></div>)}
        <div className="card capkpi"><span className="muted sm">Holgura de la mesa</span>
          <b><span className={'pill ' + (T.holgura > 0 ? 'green' : T.holgura === 0 ? 'amber' : 'rose')}>{signo(T.holgura)}</span></b></div>
      </div>

      <div className="card">
        <div className="cardh"><b>Por frente</b><span className="muted sm">Holgura = actuales − requeridos · + sobra · − falta</span></div>
        {dias === 0 ? <div className="empty">El rango no tiene días hábiles.</div> :
          <div className="scroll">
            <table className="captab">
              <thead><tr><th>Frente</th><th>OLA</th><th>Tickets</th><th>Tickets/día</th><th>Meta</th><th>Req. exacto</th><th>Requeridos</th><th>Actuales</th><th>Holgura</th><th>Ocupación</th></tr></thead>
              <tbody>{filas.map(x => (
                <tr key={x.id}>
                  <td><b>{x.frente}</b></td><td>{olaTxt(x.ola_minutos)}</td><td>{fmt(x.tickets)}</td><td>{fmt(x.demanda, 1)}</td>
                  <td>{fmt(x.meta)}</td><td>{fmt(x.reqExacto, 2)}</td><td>{fmt(x.requeridos)}</td><td>{fmt(x.actuales)}</td>
                  <td><span className={'pill ' + PILL[x.estado]}>{ETQ[x.estado]} {signo(x.holgura)}</span></td>
                  <td>{pct(x.ocupacion)}
                    <div className="capbar"><i style={{ width: Math.min(100, (Number.isFinite(x.ocupacion) ? x.ocupacion : 1) * 100) + '%', background: x.ocupacion > 1 ? 'var(--rose)' : 'var(--indigo)' }} /></div></td>
                </tr>))}</tbody>
              <tfoot><tr><td>Total mesa</td><td /><td>{fmt(T.tickets)}</td><td>{fmt(T.demanda, 1)}</td><td /><td />
                <td>{fmt(T.requeridos)}</td><td>{fmt(T.actuales)}</td><td>{signo(T.holgura)}</td><td>{pct(T.ocupacion)}</td></tr></tfoot>
            </table>
          </div>}
      </div>

      <div className="card">
        <div className="cardh"><b>Redistribución sugerida</b></div>
        <div>
          {M.movs.length === 0 && M.sinCubrir.length === 0 && M.libres.length === 0 && <div className="muted">La mesa está balanceada para este rango.</div>}
          {M.movs.length > 0 && <ul style={{ margin: 0, paddingLeft: 18 }}>{M.movs.map((m, i) =>
            <li key={i}>Mover <b>{m.n}</b> analista{m.n > 1 ? 's' : ''} de <b>{m.de}</b> a <b>{m.a}</b></li>)}</ul>}
          {M.sinCubrir.length > 0 && <p style={{ color: 'var(--rose)', fontWeight: 600 }}>Sin cubrir después de redistribuir: {M.sinCubrir.map(s => `${s.f} (faltan ${s.n})`).join(', ')}.</p>}
          {M.libres.length > 0 && <p className="muted">Quedan disponibles: {M.libres.map(s => `${s.f} (${s.n})`).join(', ')}. Pueden apoyar otra marca, backlog o capacitación.</p>}
        </div>
      </div>

      <div className="card">
        <details style={{ paddingTop: 14 }}>
          <summary className="muted" style={{ cursor: 'pointer' }}>¿Cómo se calcula?</summary>
          <div className="sm" style={{ lineHeight: 1.6, marginTop: 8 }}>
            <div><b>Días hábiles:</b> días del rango sin domingos ni festivos de Colombia (ni sábados, salvo que marques la casilla).</div>
            <div><b>Tickets/día</b> = tickets del rango ÷ días hábiles. Si una carga cubre más días que el rango consultado, se toma la parte proporcional.</div>
            <div><b>Capacidad por analista</b> = meta diaria × (1 − ausentismo).</div>
            <div><b>Requeridos</b> = tickets/día ÷ (capacidad por analista × ocupación máxima), redondeado hacia arriba y nunca menos que el mínimo del frente.</div>
            <div><b>Ocupación máxima y OLA:</b> con OLA corto (15 min o 1 h) los tickets no pueden esperar al día siguiente, así que se trabaja con margen (85 % por defecto) para absorber picos. Con OLA de 12 h la cola se reparte en la jornada y se puede trabajar al 100 %.</div>
            <div><b>Ocupación</b> = tickets/día ÷ (actuales × capacidad por analista).</div>
          </div>
        </details>
      </div>
    </>
  )
}

/* ---------------------------- Carga de volumen ---------------------------- */
function Carga({ frentes, cargas, equipo, name, load, setMsg, desdeIni, hastaIni }) {
  const [desde, setDesde] = useState(desdeIni)
  const [hasta, setHasta] = useState(hastaIni)
  const [valores, setValores] = useState({})
  const [texto, setTexto] = useState('')
  const [guardando, setGuardando] = useState(false)
  const nombre = id => frentes.find(f => f.id === id)?.nombre || '—'
  const activos = frentes.filter(f => f.activo !== false)

  // Inserta filas; si alguna se cruza con una carga existente del mismo frente, pregunta si reemplazarla
  const guardar = async filas => {
    const cruces = cargas.filter(c => filas.some(f => f.frente_id === c.frente_id && c.desde <= f.hasta && c.hasta >= f.desde))
    if (cruces.length) {
      const lista = cruces.map(c => `• ${nombre(c.frente_id)}: ${c.desde} a ${c.hasta} (${c.tickets})`).join('\n')
      if (!window.confirm(`Estas cargas se cruzan con las nuevas y se contarían doble:\n\n${lista}\n\n¿Reemplazarlas?`)) return false
      const { error } = await supabase.from('cap_volumen').delete().in('id', cruces.map(c => c.id))
      if (error) { setMsg({ t: 'err', m: 'Error: ' + error.message }); return false }
    }
    const { error } = await supabase.from('cap_volumen').insert(filas.map(f => ({ ...f, cargado_por: name })))
    if (error) { setMsg({ t: 'err', m: 'Error: ' + error.message }); return false }
    return true
  }

  const guardarFormulario = async () => {
    if (!desde || !hasta || hasta < desde) return setMsg({ t: 'err', m: 'Revisa las fechas de la carga.' })
    const filas = Object.entries(valores).filter(([, v]) => v !== '').map(([frente_id, v]) => ({ frente_id, desde, hasta, tickets: Math.round(Number(v)) }))
    if (!filas.length) return setMsg({ t: 'err', m: 'Escribe al menos una cantidad.' })
    if (filas.some(f => !(f.tickets >= 0))) return setMsg({ t: 'err', m: 'Las cantidades deben ser números positivos.' })
    setGuardando(true)
    if (await guardar(filas)) { setValores({}); setMsg({ t: 'ok', m: `${filas.length} carga(s) guardadas.` }); await load() }
    setGuardando(false)
  }

  // Filas [desde, hasta, frente, tickets] venidas de texto pegado o de Excel
  const procesarFilas = async (crudas) => {
    const errores = [], filas = []
    crudas.forEach((p, i) => {
      if (!p.some(x => String(x ?? '').trim())) return
      if (i === 0 && !aFecha(p[0])) return // encabezado
      if (p.length < 4) return errores.push(`Fila ${i + 1}: faltan columnas`)
      const [d, h, nom, t] = p
      const fd = aFecha(d), fh = aFecha(h), f = frentes.find(x => norm(x.nombre) === norm(nom))
      const tickets = typeof t === 'number' ? t : Number(String(t).replace(/\./g, '').replace(',', '.'))
      if (!fd || !fh || fh < fd) return errores.push(`Fila ${i + 1}: fechas no válidas`)
      if (!f) return errores.push(`Fila ${i + 1}: el frente "${nom}" no existe en ${equipo}`)
      if (!Number.isFinite(tickets) || tickets < 0) return errores.push(`Fila ${i + 1}: cantidad no válida`)
      filas.push({ frente_id: f.id, desde: fd, hasta: fh, tickets: Math.round(tickets) })
    })
    if (errores.length) return setMsg({ t: 'err', m: errores.slice(0, 8).join(' · ') + (errores.length > 8 ? ` · y ${errores.length - 8} más` : '') })
    if (!filas.length) return setMsg({ t: 'err', m: 'No encontré filas para cargar.' })
    setGuardando(true)
    if (await guardar(filas)) { setTexto(''); setMsg({ t: 'ok', m: `${filas.length} fila(s) cargadas.` }); await load() }
    setGuardando(false)
  }

  const importarExcel = async file => {
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      await procesarFilas(XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }))
    } catch (e) { setMsg({ t: 'err', m: 'No pude leer el Excel: ' + e.message }) }
  }

  const borrar = async id => {
    if (!window.confirm('¿Eliminar esta carga?')) return
    const { error } = await supabase.from('cap_volumen').delete().eq('id', id)
    if (error) return setMsg({ t: 'err', m: 'Error: ' + error.message })
    load()
  }

  return (
    <>
      <div className="card">
        <div className="cardh"><div><b>Cargar tickets por frente</b>
          <div className="muted sm">Un día (desde = hasta) o el total de un rango. Si ya hay una carga que se cruza en el mismo frente, se te pregunta si reemplazarla.</div></div></div>
        <div>
          <div className="row end" style={{ marginBottom: 12 }}>
            <label className="f" style={{ width: 160 }}>Desde<input type="date" value={desde} onChange={e => setDesde(e.target.value)} /></label>
            <label className="f" style={{ width: 160 }}>Hasta<input type="date" value={hasta} onChange={e => setHasta(e.target.value)} /></label>
          </div>
          <div className="row end">
            {activos.map(f => <label key={f.id} className="f" style={{ width: 130 }}>{f.nombre}
              <input type="number" min="0" placeholder="0" value={valores[f.id] ?? ''} onChange={e => setValores({ ...valores, [f.id]: e.target.value })} /></label>)}
            <button className="btn primary" disabled={guardando} onClick={guardarFormulario}>{guardando ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="cardh"><div><b>Carga masiva</b>
          <div className="muted sm">Pega desde Excel o sube un archivo con las columnas: <b>Desde · Hasta · Frente · Tickets</b> (fechas 2026-10-01 o 01/10/2026).</div></div>
          <div>
            <button className="btn ghost sm" style={{ border: '1px solid var(--line)' }} disabled={guardando} onClick={() => document.getElementById('cap-xlsx').click()}>Importar Excel</button>
            <input id="cap-xlsx" type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => { const f = e.target.files[0]; if (f) importarExcel(f); e.target.value = '' }} />
          </div>
        </div>
        <div>
          <textarea rows={5} style={{ fontFamily: 'ui-monospace,Consolas,monospace', fontSize: 13 }} value={texto} onChange={e => setTexto(e.target.value)}
            placeholder={'2026-10-01\t2026-10-20\tPDA\t1117\n2026-10-01\t2026-10-20\tFuncionarios\t1608\n2026-10-01\t2026-10-20\tVIP\t293'} />
          <button className="btn primary sm" style={{ marginTop: 10 }} disabled={guardando || !texto.trim()}
            onClick={() => procesarFilas(texto.split(/\r?\n/).map(l => l.split(/\t|;/).map(s => s.trim())))}>Procesar y guardar</button>
        </div>
      </div>

      <div className="card">
        <div className="cardh"><b>Historial de cargas</b><span className="muted sm">{cargas.length} registros</span></div>
        {cargas.length === 0 ? <div className="empty">Sin cargas todavía.</div> :
          <div className="scroll"><table>
            <thead><tr><th>Frente</th><th>Desde</th><th>Hasta</th><th>Tickets</th><th>Cargado por</th><th /></tr></thead>
            <tbody>{cargas.slice(0, 200).map(c => (
              <tr key={c.id}><td>{nombre(c.frente_id)}</td><td>{c.desde}</td><td>{c.hasta}</td><td>{fmt(c.tickets)}</td>
                <td className="muted sm">{c.cargado_por || ''}</td>
                <td><button className="btn ghost sm" onClick={() => borrar(c.id)}>Eliminar</button></td></tr>))}
            </tbody></table></div>}
      </div>
    </>
  )
}

/* ---------------------------- Configuración de frentes ---------------------------- */
function Config({ frentes, equipo, load, setMsg }) {
  const [filas, setFilas] = useState(() => frentes.map(f => ({ ...f })))
  useEffect(() => { setFilas(frentes.map(f => ({ ...f }))) }, [frentes])
  const set = (i, k, v) => setFilas(fs => fs.map((f, j) => j === i ? { ...f, [k]: v } : f))

  const guardar = async (f, i) => {
    const row = {
      marca: equipo, nombre: String(f.nombre || '').trim(), ola_minutos: Number(f.ola_minutos), meta_diaria: Number(f.meta_diaria),
      horas_productivas: Number(f.horas_productivas), analistas_actuales: Number(f.analistas_actuales), ausentismo: Number(f.ausentismo),
      ocupacion_max: Number(f.ocupacion_max), min_analistas: Number(f.min_analistas), activo: f.activo !== false, orden: f.orden ?? i + 1,
    }
    if (!row.nombre) return setMsg({ t: 'err', m: 'El frente necesita nombre.' })
    if (!(row.meta_diaria > 0)) return setMsg({ t: 'err', m: 'La meta diaria debe ser mayor que 0.' })
    if (!(row.ocupacion_max > 0 && row.ocupacion_max <= 1)) return setMsg({ t: 'err', m: 'La ocupación máxima va entre 1 % y 100 %.' })
    if (!(row.ausentismo >= 0 && row.ausentismo < 1)) return setMsg({ t: 'err', m: 'El ausentismo va entre 0 % y 99 %.' })
    const { error } = f.id ? await supabase.from('cap_frentes').update(row).eq('id', f.id) : await supabase.from('cap_frentes').insert(row)
    if (error) return setMsg({ t: 'err', m: error.code === '23505' ? 'Ya existe un frente con ese nombre.' : 'Error: ' + error.message })
    setMsg({ t: 'ok', m: `Frente "${row.nombre}" guardado.` }); load()
  }

  const borrar = async (f, i) => {
    if (!f.id) return setFilas(fs => fs.filter((_, j) => j !== i))
    if (!window.confirm(`¿Eliminar el frente "${f.nombre}" y todas sus cargas?`)) return
    const { error } = await supabase.from('cap_frentes').delete().eq('id', f.id)
    if (error) return setMsg({ t: 'err', m: 'Error: ' + error.message })
    load()
  }

  const num = (f, i, k, step = 1, w = 70) => <input type="number" min="0" step={step} style={{ width: w, padding: '6px 8px' }} value={f[k] ?? ''} onChange={e => set(i, k, e.target.value)} />
  const porc = (f, i, k) => <input type="number" min="0" max="100" style={{ width: 70, padding: '6px 8px' }} value={Math.round(Number(f[k] ?? 0) * 100)} onChange={e => set(i, k, Number(e.target.value) / 100)} />

  return (
    <div className="card">
      <div className="cardh"><div><b>Frentes de {equipo}</b>
        <div className="muted sm">OLA en minutos (12 h = 720). Ausentismo y ocupación máxima en %. AHT implícito = horas productivas × 60 ÷ meta (informativo).</div></div>
        <button className="btn ghost sm" style={{ border: '1px solid var(--line)' }} onClick={() => setFilas(fs => [...fs, { ...FRENTE_VACIO, orden: fs.length + 1 }])}>+ Agregar frente</button>
      </div>
      <div className="scroll">
        <table>
          <thead><tr><th>Frente</th><th>OLA (min)</th><th>Meta diaria</th><th>Horas prod.</th><th>AHT implícito</th><th>Analistas</th><th>Ausentismo %</th><th>Ocupación máx. %</th><th>Mínimo</th><th>Activo</th><th /></tr></thead>
          <tbody>{filas.map((f, i) => (
            <tr key={f.id || 'n' + i}>
              <td><input style={{ width: 140, padding: '6px 8px' }} value={f.nombre} onChange={e => set(i, 'nombre', e.target.value)} placeholder="Nombre" /></td>
              <td>{num(f, i, 'ola_minutos')}</td><td>{num(f, i, 'meta_diaria')}</td><td>{num(f, i, 'horas_productivas', 0.5)}</td>
              <td className="muted sm" style={{ whiteSpace: 'nowrap', paddingTop: 14 }}>{Number(f.meta_diaria) > 0 ? fmt(Number(f.horas_productivas) * 60 / Number(f.meta_diaria), 1) + ' min' : '—'}</td>
              <td>{num(f, i, 'analistas_actuales')}</td><td>{porc(f, i, 'ausentismo')}</td><td>{porc(f, i, 'ocupacion_max')}</td><td>{num(f, i, 'min_analistas')}</td>
              <td style={{ textAlign: 'center' }}><input type="checkbox" style={{ width: 'auto', marginTop: 10 }} checked={f.activo !== false} onChange={e => set(i, 'activo', e.target.checked)} /></td>
              <td style={{ whiteSpace: 'nowrap' }}><button className="btn primary sm" onClick={() => guardar(f, i)}>Guardar</button> <button className="btn ghost sm" onClick={() => borrar(f, i)}>Eliminar</button></td>
            </tr>))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
