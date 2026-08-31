import { useEffect, useState, useCallback } from 'react'
import { supabase, DOMINIO } from './supabaseClient.js'

/* ---------- constantes ---------- */
const GRACE = 10
const TARGET = 42
const SHIFTS = {
  t_74:  { label: '7 a 4 · 07:00-16:00',  in: '07:00', out: '16:00', lunch: '12:00', ht: 8 },
  t_85:  { label: '8 a 5 · 08:00-17:00',  in: '08:00', out: '17:00', lunch: '12:00', ht: 8 },
  t_sab: { label: 'Sábado · 08:00-17:00', in: '08:00', out: '17:00', lunch: '12:00', ht: 8 },
}
const DIAS = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado']
const MES = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const FESTIVOS_2026 = ['2026-01-01','2026-01-12','2026-03-23','2026-04-02','2026-04-03','2026-05-01','2026-05-18','2026-06-08','2026-06-15','2026-06-29','2026-07-13','2026-07-20','2026-08-07','2026-08-17','2026-10-12','2026-11-02','2026-11-11','2026-12-08','2026-12-25']

/* ---------- utilidades de tiempo (zona Bogotá) ---------- */
const bogotaDateISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const bogotaHM = () => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date())
  const h = p.find(x => x.type === 'hour').value, m = p.find(x => x.type === 'minute').value
  return `${h}:${m}`
}
const toMin = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0) }
const fmtHM = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const monthLabel = m => { const [y, mo] = m.split('-'); return `${MES[+mo]} ${y}` }
const nextMonthOf = m => { let [y, mo] = m.split('-').map(Number); mo++; if (mo > 12) { mo = 1; y++ } return `${y}-${String(mo).padStart(2, '0')}` }
const curMonth = () => bogotaDateISO().slice(0, 7)
function isoWeek(d) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = dt.getUTCDay() || 7; dt.setUTCDate(dt.getUTCDate() + 4 - day)
  const ys = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1))
  return Math.ceil((((dt - ys) / 86400000) + 1) / 7)
}

export default function App() {
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [tab, setTab] = useState('malla')
  const [loginEmail, setLoginEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [authErr, setAuthErr] = useState('')
  const [verComoAnalista, setVerComoAnalista] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const email = session?.user?.email?.toLowerCase() || ''
  const name = session?.user?.user_metadata?.full_name || email

  useEffect(() => {
    if (!session) { setIsAdmin(false); setBlocked(false); return }
    if (!email.endsWith('@' + DOMINIO)) { setBlocked(true); return }
    setBlocked(false)
    supabase.from('admins').select('email').eq('email', email).maybeSingle()
      .then(({ data }) => setIsAdmin(!!data))
  }, [session, email])

  const sendMagic = async () => {
    setAuthErr('')
    const em = loginEmail.trim().toLowerCase()
    if (!em.endsWith('@' + DOMINIO)) { setAuthErr(`Debes usar tu correo @${DOMINIO}.`); return }
    const { error } = await supabase.auth.signInWithOtp({ email: em, options: { emailRedirectTo: window.location.origin } })
    if (error) setAuthErr(error.message); else setSent(true)
  }
  const logout = () => supabase.auth.signOut()

  // rol con el que se PINTA el portal (permite al admin "ver como analista")
  const actingAdmin = isAdmin && !verComoAnalista

  if (!ready) return <div className="center muted">Cargando…</div>

  if (!session) return (
    <Shell><h1>Portal DOCUM</h1>
      {sent
        ? <p className="muted">Te enviamos un <b>enlace de acceso</b> a <b>{loginEmail}</b>. Abre tu correo y haz clic en el enlace para entrar. Puedes cerrar esta pestaña.</p>
        : <>
            <p className="muted">Ingresa con tu correo empresarial @{DOMINIO}. Te llegará un enlace de acceso a tu bandeja.</p>
            <label className="f" style={{ marginTop: 10 }}>Correo empresarial
              <input type="email" placeholder={`usuario@${DOMINIO}`} value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendMagic()} />
            </label>
            {authErr && <div className="notice err" style={{ marginTop: 10 }}>{authErr}</div>}
            <button className="btn primary block" onClick={sendMagic}>Enviar enlace de acceso</button>
          </>}
    </Shell>
  )

  if (blocked) return (
    <Shell><h1>Acceso restringido</h1>
      <p className="muted">Solo se permite el ingreso con correos <b>@{DOMINIO}</b>. Iniciaste con {email}.</p>
      <button className="btn ghost block" onClick={logout}>Cambiar de cuenta</button>
    </Shell>
  )

  // si estaba en una pestaña de admin y cambia a "ver como analista", lo devolvemos a malla
  if (!actingAdmin && (tab === 'analistas')) setTab('malla')

  return (
    <div className="app">
      <header className="topbar">
        <div><div className="eyebrow">EQUIPO DOCUM</div><b>Portal de operación</b></div>
        <div className="userbox">
          {isAdmin && (
            <button className="btn ghost sm" style={{ border: '1px solid #334155', color: '#cbd5e1' }}
              onClick={() => setVerComoAnalista(v => !v)}>
              {verComoAnalista ? '↩ Volver a admin' : '👁 Ver como analista'}
            </button>
          )}
          <div className="uname">{name}</div>
          <div className={'urole ' + (actingAdmin ? 'admin' : 'analista')}>{actingAdmin ? 'Administrador' : (verComoAnalista ? 'Analista (vista previa)' : 'Analista')}</div>
          <button className="btn ghost sm" onClick={logout}>Salir</button>
        </div>
      </header>
      <nav className="tabs">
        <button className={tab === 'malla' ? 'on' : ''} onClick={() => setTab('malla')}>Malla horaria</button>
        <button className={tab === 'llegada' ? 'on' : ''} onClick={() => setTab('llegada')}>Reporte de llegada</button>
        <button className={tab === 'problemas' ? 'on' : ''} onClick={() => setTab('problemas')}>Problemas DOCUM</button>
        {actingAdmin && <button className={tab === 'analistas' ? 'on' : ''} onClick={() => setTab('analistas')}>Analistas</button>}
      </nav>
      <main className="wrap">
        {tab === 'malla' && <Malla email={email} isAdmin={actingAdmin} />}
        {tab === 'llegada' && <Llegada email={email} name={name} isAdmin={actingAdmin} />}
        {tab === 'problemas' && <Problemas email={email} name={name} isAdmin={actingAdmin} />}
        {tab === 'analistas' && actingAdmin && <Analistas />}
      </main>
      <footer className="foot">Base de datos en Supabase · acceso por Google Workspace</footer>
    </div>
  )
}

function Shell({ children }) {
  return <div className="center"><div className="card auth">{children}</div></div>
}

/* ================= MALLA ================= */
function Malla({ email, isAdmin }) {
  const [month, setMonth] = useState(curMonth())
  const [months, setMonths] = useState([])
  const [rows, setRows] = useState([])
  const [analysts, setAnalysts] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const { data: ms } = await supabase.from('malla').select('month')
    const uniq = [...new Set((ms || []).map(r => r.month))].sort()
    setMonths(uniq)
    const { data } = await supabase.from('malla').select('*').eq('month', month).order('work_date')
    setRows(data || [])
    const { data: an } = await supabase.from('analysts').select('*').order('name')
    setAnalysts(an || [])
  }, [month])
  useEffect(() => { load() }, [load])

  const generar = async (targetMonth) => {
    if (!confirm(`¿Generar la malla de ${monthLabel(targetMonth)}? Reemplaza lo que haya en ese mes.`)) return
    setBusy(true); setMsg('')
    const fest = new Set(FESTIVOS_2026)
    const [y, mo] = targetMonth.split('-').map(Number)
    const days = new Date(y, mo, 0).getDate()
    const nuevos = []
    const push = (iso, dow, a, tid) => {
      const p = SHIFTS[tid]
      nuevos.push({ month: targetMonth, work_date: iso, analyst_email: a.email, analyst_name: a.name,
        turno_id: tid, ingreso: p.in, salida: p.out, almuerzo: p.lunch, ht: p.ht })
    }
    for (let d = 1; d <= days; d++) {
      const date = new Date(y, mo - 1, d)
      const dow = date.getDay()
      if (dow === 0) continue
      const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      if (fest.has(iso)) continue
      const n = analysts.length
      const wk = isoWeek(date)
      const i85 = ((wk % n) + n) % n        // quien va en 8 a 5 esa semana
      const iSat = (((wk + 1) % n) + n) % n // quien hace sábado (es de 7 a 4)
      if (dow >= 1 && dow <= 5) {
        analysts.forEach((a, idx) => {
          if (idx === iSat && dow === 5) return // el de sábado descansa el viernes
          push(iso, dow, a, idx === i85 ? 't_85' : 't_74')
        })
      } else if (dow === 6) {
        push(iso, dow, analysts[iSat], 't_sab')
      }
    }
    await supabase.from('malla').delete().eq('month', targetMonth)
    const { error } = await supabase.from('malla').insert(nuevos)
    setBusy(false)
    if (error) { setMsg('Error: ' + error.message); return }
    setMonth(targetMonth); setMsg(`Malla de ${monthLabel(targetMonth)} generada.`)
    load()
  }

  const borrarMes = async () => {
    if (!confirm(`¿Borrar por completo la malla de ${monthLabel(month)}? Esta acción no se puede deshacer.`)) return
    setBusy(true); setMsg('')
    const { error } = await supabase.from('malla').delete().eq('month', month)
    setBusy(false)
    if (error) { setMsg('Error: ' + error.message); return }
    setMsg(`Malla de ${monthLabel(month)} borrada.`); load()
  }

  // agrupar por semana
  const byWeek = {}
  const map = {}
  rows.forEach(r => { (map[r.analyst_email] = map[r.analyst_email] || {})[r.work_date] = r })
  if (rows.length) {
    const [y, mo] = month.split('-').map(Number)
    const days = new Date(y, mo, 0).getDate()
    for (let d = 1; d <= days; d++) {
      const date = new Date(y, mo - 1, d); const dow = date.getDay(); if (dow === 0) continue
      const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const wk = isoWeek(date);
      (byWeek[wk] = byWeek[wk] || []).push({ iso, dow, dd: String(d).padStart(2, '0') })
    }
  }
  const festSet = new Set(FESTIVOS_2026)
  const totals = {}; rows.forEach(r => { totals[r.analyst_email] = (totals[r.analyst_email] || 0) + Number(r.ht || 0) })

  return (
    <>
      <div className="card">
        <div className="cardh">
          <div><b>Malla horaria — {monthLabel(month)}</b>
            <div className="muted sm">{isAdmin ? 'Genera meses y consulta la malla del equipo.' : 'Consulta tu malla del mes.'}</div></div>
          <div className="row">
            {months.length > 0 &&
              <select value={month} onChange={e => setMonth(e.target.value)}>
                {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>}
            {isAdmin && <button className="btn primary" disabled={busy || !analysts.length}
              onClick={() => generar(months.length ? nextMonthOf(months[months.length - 1]) : curMonth())}>
              {busy ? 'Generando…' : `Generar ${monthLabel(months.length ? nextMonthOf(months[months.length - 1]) : curMonth())}`}
            </button>}
            {isAdmin && rows.length > 0 && <button className="btn ghost" style={{ color: 'var(--rose)' }} disabled={busy}
              onClick={borrarMes}>Borrar malla de {monthLabel(month)}</button>}
          </div>
        </div>
        {msg && <div className="notice">{msg}</div>}
        {rows.length === 0
          ? <div className="empty">{isAdmin ? 'No hay malla para este mes. Usa «Generar».' : 'Aún no hay malla publicada para este mes.'}</div>
          : Object.keys(byWeek).map(wk => {
            const dates = byWeek[wk]
            const satDate = dates.find(x => x.dow === 6)
            let satName = ''
            if (satDate) analysts.forEach(a => { if (map[a.email]?.[satDate.iso]) satName = a.name })
            return (
              <div className="week" key={wk}>
                <div className="weekh">SEMANA {wk}{satName && <> · <span className="sat">Sábado: {satName}</span></>}</div>
                <div className="scroll">
                  <table className="mtab">
                    <thead><tr><th className="left">Analista</th>
                      {dates.map(x => <th key={x.iso}>{DIAS[x.dow]} {x.dd}{festSet.has(x.iso) && <><br /><span className="fest">FESTIVO</span></>}</th>)}
                    </tr></thead>
                    <tbody>
                      {analysts.map(a => (
                        <tr key={a.email}>
                          <td className="left an">{a.name}</td>
                          {dates.map(x => {
                            const r = map[a.email]?.[x.iso]
                            if (r) return <td key={x.iso}><b>{r.ingreso}→{r.salida}</b><div className="muted xs">Alm {r.almuerzo} · {r.ht}h</div></td>
                            if (festSet.has(x.iso)) return <td key={x.iso}><span className="fest">Festivo</span></td>
                            return <td key={x.iso}><span className="off">—</span></td>
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
      </div>
      {rows.length > 0 &&
        <div className="card">
          <div className="cardh"><b>Resumen de horas</b></div>
          <div className="scroll"><table><thead><tr><th>Analista</th><th>Horas del mes</th><th>Meta</th></tr></thead>
            <tbody>{analysts.map(a => <tr key={a.email}><td>{a.name}</td><td>{(totals[a.email] || 0).toFixed(1)} h</td><td className="muted">{TARGET} h</td></tr>)}</tbody>
          </table></div>
        </div>}
    </>
  )
}

/* ================= LLEGADA ================= */
function Llegada({ email, name, isAdmin }) {
  const [arrivals, setArrivals] = useState([])
  const [targetEmail, setTargetEmail] = useState(isAdmin ? '' : email)
  const [pending, setPending] = useState(null)
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('arrivals').select('*').order('work_date', { ascending: false }).order('llego', { ascending: false })
    setArrivals(data || [])
  }, [])
  useEffect(() => { load() }, [load])

  const check = async () => {
    setMsg(null); setPending(null)
    const em = (isAdmin ? targetEmail : email).trim().toLowerCase()
    if (!em) return
    const today = bogotaDateISO()
    const { data: dup } = await supabase.from('arrivals').select('id,llego,estado').eq('email', em).eq('work_date', today).maybeSingle()
    if (dup) { setMsg({ t: 'info', m: `Ya hay llegada hoy a las ${dup.llego} (${dup.estado}).` }); return }
    const { data: mrow } = await supabase.from('malla').select('ingreso,analyst_name').eq('analyst_email', em).eq('work_date', today).maybeSingle()
    const nowHM = bogotaHM(); const nowMin = toMin(nowHM)
    const expected = mrow?.ingreso || null
    const late = expected ? nowMin > toMin(expected) + GRACE : false
    setPending({ em, name: mrow?.analyst_name || name, expected, nowHM, late })
  }

  const confirm = async () => {
    if (!pending) return
    if (pending.late && !reason.trim()) { setMsg({ t: 'err', m: 'Indica el motivo de la llegada tarde.' }); return }
    const rec = {
      work_date: bogotaDateISO(), email: pending.em, name: pending.name,
      llego: pending.nowHM, esperado: pending.expected || '—',
      estado: pending.late ? 'tarde' : 'a tiempo', motivo: pending.late ? reason.trim() : null,
    }
    const { error } = await supabase.from('arrivals').insert(rec)
    if (error) { setMsg({ t: 'err', m: 'Error: ' + error.message }); return }
    setMsg({ t: 'ok', m: `Llegada registrada — ${rec.estado}.` }); setPending(null); setReason(''); load()
  }

  const mine = isAdmin ? arrivals : arrivals.filter(a => a.email === email)
  const late = mine.filter(a => a.estado === 'tarde')

  // resumen admin
  const agg = {}
  if (isAdmin) arrivals.forEach(a => { const k = a.name || a.email; agg[k] = agg[k] || { a: 0, t: 0 }; a.estado === 'tarde' ? agg[k].t++ : agg[k].a++ })

  return (
    <>
      <div className="card">
        <div className="cardh"><b>Marcar llegada</b><div className="muted sm">Tolerancia de 10 minutos sobre la hora de ingreso de tu turno.</div></div>
        <div className="row end">
          <label className="f" style={{ flex: 1 }}>Correo del analista
            <input type="email" value={isAdmin ? targetEmail : email} disabled={!isAdmin}
              placeholder="nombre@empresa.com" onChange={e => setTargetEmail(e.target.value)} />
            {!isAdmin && <span className="xs muted">Solo puedes marcar tu propia llegada.</span>}
          </label>
          <button className="btn primary" onClick={check}>Verificar y marcar</button>
        </div>
        {msg && <div className={'notice ' + (msg.t === 'err' ? 'err' : msg.t === 'ok' ? 'ok' : '')}>{msg.m}</div>}
        {pending && (
          <div className="panel">
            <div><b>{pending.name}</b> · <span className="muted">Hora actual {pending.nowHM}</span></div>
            <div className="muted sm">{pending.expected
              ? <>Turno de hoy: ingreso <b>{pending.expected}</b> (tolerancia hasta {fmtHM(toMin(pending.expected) + GRACE)})</>
              : <>Hoy no tienes turno en la malla. Se registra sin evaluar tardanza.</>}</div>
            {pending.late
              ? <div style={{ marginTop: 10 }}><div className="warn">⚠ Llegada tarde — indica el motivo</div>
                <textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="¿Por qué llegaste tarde?" /></div>
              : <div className="okline" style={{ marginTop: 10 }}>✓ Dentro de la tolerancia — a tiempo</div>}
            <button className="btn primary" style={{ marginTop: 10 }} onClick={confirm}>Confirmar llegada</button>
          </div>
        )}
      </div>

      {isAdmin
        ? <div className="card"><div className="cardh"><b>Tardanzas por analista</b><div className="muted sm">Todo el equipo.</div></div>
          <div className="scroll"><table><thead><tr><th>Analista</th><th>A tiempo</th><th>Tarde</th></tr></thead>
            <tbody>{Object.keys(agg).map(k => <tr key={k}><td>{k}</td><td>{agg[k].a}</td><td><span className={'pill ' + (agg[k].t ? 'amber' : 'slate')}>{agg[k].t}</span></td></tr>)}
              {Object.keys(agg).length === 0 && <tr><td colSpan={3} className="muted">Sin registros.</td></tr>}</tbody></table></div></div>
        : <div className="card"><div className="cardh"><b>Mi resumen</b></div>
          <div className="row"><span className="pill green">A tiempo: {mine.length - late.length}</span><span className="pill amber">Tarde: {late.length}</span></div>
          {late.length > 0 && <p className="muted sm" style={{ marginTop: 8 }}>Días tarde: {late.map(l => l.work_date).join(', ')}</p>}</div>}

      <div className="card">
        <div className="cardh"><b>{isAdmin ? 'Historial (todos)' : 'Mi historial'}</b><div className="muted sm">{mine.length} registros</div></div>
        {mine.length === 0 ? <div className="empty">Aún no hay llegadas.</div>
          : <div className="scroll"><table><thead><tr><th>Fecha</th>{isAdmin && <th>Analista</th>}<th>Llegó</th><th>Esperado</th><th>Estado</th><th>Motivo</th></tr></thead>
            <tbody>{mine.map(r => <tr key={r.id}><td className="muted">{r.work_date}</td>{isAdmin && <td>{r.name}</td>}
              <td>{r.llego}</td><td className="muted">{r.esperado}</td>
              <td><span className={'pill ' + (r.estado === 'tarde' ? 'amber' : 'green')}>{r.estado === 'tarde' ? 'Tarde' : 'A tiempo'}</span></td>
              <td>{r.motivo || '—'}</td></tr>)}</tbody></table></div>}
      </div>
    </>
  )
}

/* ================= PROBLEMAS DOCUM ================= */
function Problemas({ email, name, isAdmin }) {
  const [problems, setProblems] = useState([])
  const [cases, setCases] = useState([])
  const [analysts, setAnalysts] = useState([])
  const [openId, setOpenId] = useState(null)
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [msg, setMsg] = useState(null)
  // formulario de caso por problema
  const [cf, setCf] = useState({ ticket: '', analystId: '', resolved: false, note: '' })

  const load = useCallback(async () => {
    const { data: p } = await supabase.from('problems').select('*').order('created_at', { ascending: false })
    const { data: c } = await supabase.from('problem_cases').select('*').order('created_at', { ascending: true })
    const { data: a } = await supabase.from('analysts').select('*').order('name')
    setProblems(p || []); setCases(c || []); setAnalysts(a || [])
  }, [])
  useEffect(() => { load() }, [load])

  const casesOf = (pid) => cases.filter(c => c.problem_id === pid)

  const addProblem = async () => {
    if (!title.trim()) return
    const { error } = await supabase.from('problems').insert({ title: title.trim(), description: desc.trim(), created_by: email })
    if (error) { setMsg({ t: 'err', m: 'Error: ' + error.message }); return }
    setTitle(''); setDesc(''); setMsg({ t: 'ok', m: 'Problema creado.' }); load()
  }
  const removeProblem = async (pid) => {
    if (!confirm('¿Eliminar el problema y todos sus casos?')) return
    await supabase.from('problems').delete().eq('id', pid); load()
  }
  const addCase = async (pid) => {
    if (!cf.ticket.trim()) return
    const an = analysts.find(a => a.id === cf.analystId)
    const { error } = await supabase.from('problem_cases').insert({
      problem_id: pid, ticket: cf.ticket.trim(),
      analyst_email: an?.email || null, analyst_name: an?.name || null,
      resolved: cf.resolved, note: cf.note.trim() || null, created_by: email,
    })
    if (error) { alert('Error: ' + error.message); return }
    setCf({ ticket: '', analystId: '', resolved: false, note: '' }); load()
  }
  const toggleCase = async (c) => { await supabase.from('problem_cases').update({ resolved: !c.resolved }).eq('id', c.id); load() }
  const removeCase = async (id) => { await supabase.from('problem_cases').delete().eq('id', id); load() }

  return (
    <>
      {/* Dash solo para admin */}
      {isAdmin && problems.length > 0 && (
        <div className="card">
          <div className="cardh"><b>Resumen de problemas</b><div className="muted sm">Solo administrador</div></div>
          <div className="scroll">
            <table><thead><tr><th>Problema</th><th>Casos</th><th>Resueltos</th><th>Pendientes</th></tr></thead>
              <tbody>{problems.map(p => {
                const cs = casesOf(p.id), sol = cs.filter(c => c.resolved).length
                return <tr key={p.id}><td style={{ fontWeight: 600, color: 'var(--ink)' }}>{p.title}</td>
                  <td><span className="pill" style={{ background: 'var(--ink)', color: '#fff' }}>{cs.length}</span></td>
                  <td className="tabular" style={{ color: 'var(--emerald)' }}>{sol}</td>
                  <td className="tabular" style={{ color: 'var(--amber)' }}>{cs.length - sol}</td></tr>
              })}</tbody></table>
          </div>
        </div>
      )}

      {/* Crear problema (solo admin) */}
      {isAdmin && (
        <div className="card">
          <div className="cardh"><b>Registrar un problema</b><div className="muted sm">Solo el administrador crea problemas.</div></div>
          <div className="grid" style={{ gridTemplateColumns: '1fr' }}>
            <input placeholder="Título (ej: Problema testigos)" value={title} onChange={e => setTitle(e.target.value)} />
            <textarea rows={2} placeholder="Descripción breve del problema" value={desc} onChange={e => setDesc(e.target.value)} />
          </div>
          {msg && <div className={'notice ' + (msg.t === 'err' ? 'err' : 'ok')} style={{ marginTop: 10 }}>{msg.m}</div>}
          <button className="btn primary" style={{ marginTop: 12 }} onClick={addProblem} disabled={!title.trim()}>Crear problema</button>
        </div>
      )}

      {/* Lista de problemas */}
      {problems.length === 0
        ? <div className="card"><div className="empty">Aún no hay problemas registrados.</div></div>
        : problems.map(p => {
          const cs = casesOf(p.id), sol = cs.filter(c => c.resolved).length, open = openId === p.id
          return (
            <div className="card" key={p.id}>
              <div className="cardh">
                <div><b>⚠ {p.title}</b>{p.description && <div className="muted sm">{p.description}</div>}</div>
                <div className="row" style={{ alignItems: 'center' }}>
                  <span className="pill" style={{ background: 'var(--ink)', color: '#fff' }}>{cs.length} {cs.length === 1 ? 'caso' : 'casos'}</span>
                  <span className="pill green">{sol} resueltos</span>
                  <button className="btn ghost sm" onClick={() => setOpenId(open ? null : p.id)}>{open ? 'Ocultar' : 'Ver casos'}</button>
                  {isAdmin && <button className="btn ghost sm" style={{ color: 'var(--rose)' }} onClick={() => removeProblem(p.id)}>Eliminar</button>}
                </div>
              </div>
              {open && (
                <>
                  {/* Agregar caso (analista o admin) */}
                  <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', background: '#f8fafc', padding: 12, borderRadius: 9, margin: '4px 0 14px' }}>
                    <label className="f"># Ticket<input placeholder="Ej: 483920" value={cf.ticket} onChange={e => setCf({ ...cf, ticket: e.target.value })} /></label>
                    <label className="f">Atendido por
                      <select value={cf.analystId} onChange={e => setCf({ ...cf, analystId: e.target.value })}>
                        <option value="">—</option>{analysts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </label>
                    <label className="f">Nota (opcional)<input placeholder="Detalle breve" value={cf.note} onChange={e => setCf({ ...cf, note: e.target.value })} /></label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                      <label className="f" style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                        <input type="checkbox" style={{ width: 'auto' }} checked={cf.resolved} onChange={e => setCf({ ...cf, resolved: e.target.checked })} /> ¿Solución?
                      </label>
                      <button className="btn primary sm" onClick={() => addCase(p.id)} disabled={!cf.ticket.trim()}>Agregar ticket</button>
                    </div>
                  </div>
                  {cs.length === 0 ? <div className="empty">Sin casos aún.</div> : (
                    <div className="scroll">
                      <table><thead><tr><th>#</th><th># Ticket</th><th>Analista</th><th>Nota</th><th>Solución</th><th></th></tr></thead>
                        <tbody>{cs.map((c, i) => (
                          <tr key={c.id}>
                            <td className="muted tabular">{i + 1}</td>
                            <td className="tabular" style={{ fontWeight: 600, color: 'var(--ink)' }}>{c.ticket}</td>
                            <td>{c.analyst_name || <span className="muted">Sin asignar</span>}</td>
                            <td className="muted">{c.note || '—'}</td>
                            <td><button className={'pill ' + (c.resolved ? 'green' : 'amber')} style={{ border: 'none', cursor: 'pointer' }} onClick={() => toggleCase(c)}>{c.resolved ? 'Sí' : 'No'}</button></td>
                            <td style={{ textAlign: 'right' }}><button className="btn ghost sm" style={{ color: 'var(--rose)' }} onClick={() => removeCase(c.id)}>✕</button></td>
                          </tr>
                        ))}</tbody></table>
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
    </>
  )
}

/* ================= ANALISTAS (solo admin) ================= */
function Analistas() {
  const [analysts, setAnalysts] = useState([])
  const [form, setForm] = useState({ name: '', email: '' })
  const [msg, setMsg] = useState(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('analysts').select('*').order('name')
    setAnalysts(data || [])
  }, [])
  useEffect(() => { load() }, [load])

  const add = async () => {
    setMsg(null)
    const nm = form.name.trim(), em = form.email.trim().toLowerCase()
    if (!nm || !em) return
    if (!em.includes('@')) { setMsg({ t: 'err', m: 'Correo inválido.' }); return }
    const { error } = await supabase.from('analysts').insert({ name: nm, email: em })
    if (error) { setMsg({ t: 'err', m: error.message.includes('duplicate') ? 'Ese correo ya está registrado.' : 'Error: ' + error.message }); return }
    setForm({ name: '', email: '' }); setMsg({ t: 'ok', m: 'Analista agregado.' }); load()
  }
  const remove = async (a) => {
    if (!confirm(`¿Quitar a ${a.name} de la lista de analistas?`)) return
    const { error } = await supabase.from('analysts').delete().eq('id', a.id)
    if (error) { setMsg({ t: 'err', m: 'Error: ' + error.message }); return }
    load()
  }

  return (
    <div className="card">
      <div className="cardh">
        <div><b>Analistas del equipo</b><div className="muted sm">Agregar o quitar. Tras un cambio, regenera la malla del mes para que se reparta con la lista nueva.</div></div>
      </div>
      <div className="row" style={{ marginBottom: 8 }}>
        <input placeholder="Nombre completo" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <input type="email" placeholder="correo@3tcapital.co" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
        <button className="btn primary" onClick={add} disabled={!form.name.trim() || !form.email.trim()}>Agregar</button>
      </div>
      {msg && <div className={'notice ' + (msg.t === 'err' ? 'err' : 'ok')}>{msg.m}</div>}
      {analysts.length === 0
        ? <div className="empty">Aún no hay analistas.</div>
        : <div className="scroll" style={{ marginTop: 8 }}>
            <table><thead><tr><th>Nombre</th><th>Correo</th><th></th></tr></thead>
              <tbody>{analysts.map(a => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600, color: 'var(--ink)' }}>{a.name}</td>
                  <td className="muted">{a.email}</td>
                  <td style={{ textAlign: 'right' }}><button className="btn ghost sm" style={{ color: 'var(--rose)' }} onClick={() => remove(a)}>Quitar</button></td>
                </tr>
              ))}</tbody></table>
          </div>}
      <p className="muted sm" style={{ marginTop: 10 }}>Total: {analysts.length} analistas. El correo debe ser el real de Google de cada persona.</p>
    </div>
  )
}
