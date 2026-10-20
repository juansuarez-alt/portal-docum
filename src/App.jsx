import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase, DOMINIOS } from './supabaseClient.js'
const dominioOk = (e) => DOMINIOS.some(d => String(e || '').toLowerCase().endsWith('@' + d))
const splitEq = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean)
const fmtFecha = iso => iso ? new Date(iso).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', year: 'numeric' }) : ''

export default function App() {
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [rol, setRol] = useState('analista')
  const [blocked, setBlocked] = useState(false)
  const [tab, setTab] = useState('problemas')
  const [loginEmail, setLoginEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [authErr, setAuthErr] = useState('')
  const [verComoAnalista, setVerComoAnalista] = useState(false)
  const [misEquipos, setMisEquipos] = useState([])
  const [equipo, setEquipo] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const email = session?.user?.email?.toLowerCase() || ''
  const name = session?.user?.user_metadata?.full_name || email

  useEffect(() => {
    if (!session) { setIsAdmin(false); setBlocked(false); return }
    if (!dominioOk(email)) { setBlocked(true); return }
    setBlocked(false)
    ;(async () => {
      const { data: adm } = await supabase.from('admins').select('email').eq('email', email).maybeSingle()
      const { data: me } = await supabase.from('analysts').select('equipos,rol').eq('email', email).maybeSingle()
      const esAdmin = !!adm || (me?.rol === 'admin')
      setIsAdmin(esAdmin)
      setRol(esAdmin ? 'admin' : (me?.rol || 'analista'))
      const { data: all } = await supabase.from('analysts').select('equipos')
      const set = new Set()
      ;(all || []).forEach(a => splitEq(a.equipos).forEach(t => set.add(t)))
      if (set.size === 0) set.add('DOCUM')
      const teams = [...set].sort()
      const mine = esAdmin ? teams : splitEq(me?.equipos)
      const visibles = mine.length ? mine : (esAdmin ? teams : ['DOCUM'])
      setMisEquipos(visibles)
      setEquipo(prev => (prev && visibles.includes(prev)) ? prev : (visibles[0] || 'DOCUM'))
    })()
  }, [session, email])

  const sendMagic = async () => {
    setAuthErr('')
    const em = loginEmail.trim().toLowerCase()
    if (!dominioOk(em)) { setAuthErr("Usa tu correo corporativo autorizado."); return }
    const { error } = await supabase.auth.signInWithOtp({ email: em, options: { emailRedirectTo: window.location.origin } })
    if (error) setAuthErr(error.message); else setSent(true)
  }
  const logout = () => supabase.auth.signOut()

  // rol con el que se PINTA el portal (permite al admin "ver como analista")
  const actingAdmin = isAdmin && !verComoAnalista
  // quién puede escribir en la base de conocimiento: admin o digitador
  const puedeEditarKB = actingAdmin || (!isAdmin && rol === 'digitador')

  if (!ready) return <div className="center muted">Cargando…</div>

  if (!session) return (
    <Shell><h1>Bienvenido a la Mesa de Ayuda</h1>
      {sent
        ? <p className="muted">Te enviamos un <b>enlace de acceso</b> a <b>{loginEmail}</b>. Abre tu correo y haz clic en el enlace para entrar. Puedes cerrar esta pestaña.</p>
        : <>
            <p className="muted">Ingresa tu correo corporativo. Te llegará un enlace de acceso a tu bandeja.</p>
            <label className="f" style={{ marginTop: 10 }}>Correo corporativo
              <input type="email" placeholder="Ingresa tu correo corporativo" value={loginEmail}
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
      <p className="muted">Tu correo no está habilitado para ingresar. Usa tu correo corporativo autorizado. Iniciaste con {email}.</p>
      <button className="btn ghost block" onClick={logout}>Cambiar de cuenta</button>
    </Shell>
  )

  // si estaba en una pestaña de admin y cambia a "ver como analista", lo devolvemos a problemas
  if (!actingAdmin && (tab === 'analistas')) setTab('problemas')

  const rolLabel = actingAdmin ? 'Administrador' : verComoAnalista ? 'Analista (vista previa)' : rol === 'digitador' ? 'Digitador' : 'Analista'

  return (
    <div className="app">
      <header className="topbar">
        <div><div className="eyebrow">MESA DE AYUDA</div><b>Centro de operación</b></div>
        <div className="userbox">
          {misEquipos.length > 0 && (misEquipos.length === 1
            ? <span className="pill slate">{misEquipos[0]}</span>
            : <select value={equipo} onChange={e => setEquipo(e.target.value)} style={{ padding: '6px 8px', borderRadius: 8 }}>{misEquipos.map(t => <option key={t} value={t}>{t}</option>)}</select>)}
          {isAdmin && (
            <button className="btn ghost sm" style={{ border: '1px solid #334155', color: '#cbd5e1' }}
              onClick={() => setVerComoAnalista(v => !v)}>
              {verComoAnalista ? '↩ Volver a admin' : '👁 Ver como analista'}
            </button>
          )}
          <div className="uname">{name}</div>
          <div className={'urole ' + (actingAdmin ? 'admin' : 'analista')}>{rolLabel}</div>
          <button className="btn ghost sm" onClick={logout}>Salir</button>
        </div>
      </header>
      <nav className="tabs">
        <button className={tab === 'problemas' ? 'on' : ''} onClick={() => setTab('problemas')}>Problemas {equipo}</button>
        <button className={tab === 'kb' ? 'on' : ''} onClick={() => setTab('kb')}>Base de conocimiento {equipo}</button>
        {actingAdmin && <button className={tab === 'analistas' ? 'on' : ''} onClick={() => setTab('analistas')}>Personas y roles</button>}
      </nav>
      <main className="wrap">
        {tab === 'problemas' && equipo && <Problemas key={'p-' + equipo} email={email} name={name} isAdmin={actingAdmin} equipo={equipo} />}
        {tab === 'kb' && equipo && <BaseConocimiento key={'kb-' + equipo} email={email} name={name} puedeEditar={puedeEditarKB} equipo={equipo} />}
        {tab === 'analistas' && actingAdmin && <Analistas />}
      </main>
      <footer className="foot">Mesa de Ayuda · acceso por correo corporativo</footer>
    </div>
  )
}

function Shell({ children }) {
  return <div className="center"><div className="card auth">{children}</div></div>
}

/* ================= BASE DE CONOCIMIENTO (por marca) =================
   Cada registro es un protocolo: Título · Situación · Respuesta.
   Todos los de la marca lo leen; solo admin y digitadores crean/editan/borran
   (la base de datos lo hace cumplir con RLS, ver supabase/base_conocimiento.sql). */
const KB_VACIO = { id: null, titulo: '', categoria: '', situacion: '', respuesta: '' }

function BaseConocimiento({ email, name, puedeEditar, equipo }) {
  const [items, setItems] = useState([])
  const [cargando, setCargando] = useState(true)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [abierto, setAbierto] = useState(null)
  const [form, setForm] = useState(null)      // null = cerrado; objeto = creando/editando
  const [msg, setMsg] = useState(null)
  const [copiado, setCopiado] = useState(null)

  const load = useCallback(async () => {
    setCargando(true)
    const { data, error } = await supabase.from('kb_protocolos').select('*').eq('equipo', equipo).order('titulo')
    if (error) setMsg({ t: 'err', m: 'No pude cargar la base de conocimiento: ' + error.message })
    setItems(data || []); setCargando(false)
  }, [equipo])
  useEffect(() => { load() }, [load])

  const categorias = useMemo(() => [...new Set(items.map(i => (i.categoria || '').trim()).filter(Boolean))].sort(), [items])

  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const filtrados = useMemo(() => {
    const palabras = norm(q).split(/\s+/).filter(Boolean)
    return items.filter(i => {
      if (cat && (i.categoria || '').trim() !== cat) return false
      if (!palabras.length) return true
      const txt = norm([i.titulo, i.categoria, i.situacion, i.respuesta].join(' '))
      return palabras.every(p => txt.includes(p))
    })
  }, [items, q, cat])

  const guardar = async () => {
    setMsg(null)
    const f = { titulo: form.titulo.trim(), categoria: form.categoria.trim() || null, situacion: form.situacion.trim(), respuesta: form.respuesta.trim() }
    if (!f.titulo || !f.situacion || !f.respuesta) { setMsg({ t: 'err', m: 'Título, situación y respuesta son obligatorios.' }); return }
    const quien = name || email
    const { error } = form.id
      ? await supabase.from('kb_protocolos').update({ ...f, updated_by: quien, updated_at: new Date().toISOString() }).eq('id', form.id)
      : await supabase.from('kb_protocolos').insert({ ...f, equipo, created_by: quien, updated_by: quien })
    if (error) {
      const sinPermiso = /row-level security|permission/i.test(error.message)
      setMsg({ t: 'err', m: sinPermiso ? 'No tienes permiso para guardar en la base de conocimiento. Pide al administrador el rol Digitador.' : 'Error: ' + error.message })
      return
    }
    setMsg({ t: 'ok', m: form.id ? 'Protocolo actualizado.' : 'Protocolo agregado.' })
    setForm(null); load()
  }

  const borrar = async (i) => {
    if (!confirm(`¿Eliminar el protocolo "${i.titulo}"? No se puede deshacer.`)) return
    const { error } = await supabase.from('kb_protocolos').delete().eq('id', i.id)
    if (error) { setMsg({ t: 'err', m: 'Error: ' + error.message }); return }
    setMsg({ t: 'ok', m: 'Protocolo eliminado.' }); load()
  }

  const copiar = async (i) => {
    try { await navigator.clipboard.writeText(i.respuesta); setCopiado(i.id); setTimeout(() => setCopiado(null), 1500) } catch { /* sin portapapeles */ }
  }

  const bloque = (etq, txt, color) => (
    <div style={{ borderLeft: '3px solid ' + color, padding: '8px 12px', background: '#f8fafc', borderRadius: '0 8px 8px 0', marginBottom: 10 }}>
      <div className="xs" style={{ fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color, marginBottom: 4 }}>{etq}</div>
      <div style={{ whiteSpace: 'pre-wrap', color: 'var(--ink)', lineHeight: 1.5 }}>{txt}</div>
    </div>
  )

  return (
    <>
      <div className="card">
        <div className="cardh">
          <div><b>Base de conocimiento — {equipo}</b>
            <div className="muted sm">Protocolos de la mesa: qué hacer ante cada situación. {puedeEditar ? 'Tienes permiso para agregar y editar.' : 'Solo lectura; los digitadores mantienen el contenido.'}</div></div>
          {puedeEditar && !form && <button className="btn primary" onClick={() => { setMsg(null); setForm({ ...KB_VACIO }) }}>+ Nuevo protocolo</button>}
        </div>

        {form && (
          <div className="panel" style={{ marginTop: 0, marginBottom: 12 }}>
            <b>{form.id ? 'Editar protocolo' : 'Nuevo protocolo'}</b>
            <div className="grid" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginTop: 10 }}>
              <label className="f">Título *<input placeholder="Ej: Usuario no recibe el correo de restablecimiento" value={form.titulo} onChange={e => setForm({ ...form, titulo: e.target.value })} /></label>
              <label className="f">Categoría (opcional)
                <input list="kb-cats" placeholder="Ej: Accesos" value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })} />
                <datalist id="kb-cats">{categorias.map(c => <option key={c} value={c} />)}</datalist>
              </label>
            </div>
            <label className="f" style={{ marginTop: 10 }}>Situación * <span className="xs">— qué pasa, cómo lo reporta el usuario, cómo identificarlo</span>
              <textarea rows={4} value={form.situacion} onChange={e => setForm({ ...form, situacion: e.target.value })} />
            </label>
            <label className="f" style={{ marginTop: 10 }}>Respuesta * <span className="xs">— pasos a seguir, a quién escalar, texto para el usuario</span>
              <textarea rows={7} value={form.respuesta} onChange={e => setForm({ ...form, respuesta: e.target.value })} />
            </label>
            {msg && <div className={'notice ' + (msg.t === 'err' ? 'err' : 'ok')} style={{ marginTop: 10 }}>{msg.m}</div>}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn primary" onClick={guardar} disabled={!form.titulo.trim() || !form.situacion.trim() || !form.respuesta.trim()}>Guardar</button>
              <button className="btn ghost" onClick={() => { setForm(null); setMsg(null) }}>Cancelar</button>
            </div>
          </div>
        )}

        <div className="row" style={{ alignItems: 'center' }}>
          <input style={{ flex: 1, minWidth: 220 }} placeholder={`Buscar en ${items.length} protocolos (título, situación o respuesta)…`} value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {categorias.length > 0 && (
          <div className="row" style={{ marginTop: 10, gap: 6 }}>
            <button className={'pill ' + (cat === '' ? 'green' : 'slate')} style={{ border: 'none', cursor: 'pointer' }} onClick={() => setCat('')}>Todas</button>
            {categorias.map(c => <button key={c} className={'pill ' + (cat === c ? 'green' : 'slate')} style={{ border: 'none', cursor: 'pointer' }} onClick={() => setCat(cat === c ? '' : c)}>{c}</button>)}
          </div>
        )}
        {!form && msg && <div className={'notice ' + (msg.t === 'err' ? 'err' : 'ok')} style={{ marginTop: 10, marginBottom: 0 }}>{msg.m}</div>}
      </div>

      {cargando
        ? <div className="card"><div className="empty">Cargando…</div></div>
        : filtrados.length === 0
          ? <div className="card"><div className="empty">{items.length === 0
              ? `Aún no hay protocolos para ${equipo}.${puedeEditar ? ' Usa «Nuevo protocolo» para crear el primero.' : ''}`
              : 'Ningún protocolo coincide con la búsqueda.'}</div></div>
          : filtrados.map(i => {
            const open = abierto === i.id
            return (
              <div className="card" key={i.id} style={{ marginBottom: 10 }}>
                <div className="cardh" style={{ cursor: 'pointer', borderBottom: open ? undefined : 'none' }} onClick={() => setAbierto(open ? null : i.id)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>📘 {i.titulo}</b>{i.categoria && <span className="pill slate" style={{ marginLeft: 8 }}>{i.categoria}</span>}
                    {!open && <div className="muted sm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.situacion}</div>}
                  </div>
                  <span className="muted">{open ? '▲' : '▼'}</span>
                </div>
                {open && (
                  <div>
                    {bloque('Situación', i.situacion, 'var(--amber)')}
                    {bloque('Respuesta', i.respuesta, 'var(--emerald)')}
                    <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                      <span className="muted xs">Actualizado {fmtFecha(i.updated_at || i.created_at)}{i.updated_by ? ` por ${i.updated_by}` : ''}</span>
                      <div className="row">
                        <button className="btn ghost sm" onClick={() => copiar(i)}>{copiado === i.id ? '✓ Copiado' : 'Copiar respuesta'}</button>
                        {puedeEditar && <button className="btn ghost sm" onClick={() => { setMsg(null); setForm({ id: i.id, titulo: i.titulo, categoria: i.categoria || '', situacion: i.situacion, respuesta: i.respuesta }); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Editar</button>}
                        {puedeEditar && <button className="btn ghost sm" style={{ color: 'var(--rose)' }} onClick={() => borrar(i)}>Eliminar</button>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
    </>
  )
}

/* ================= PROBLEMAS (por marca) =================
   Un problema = un tema. Lo que importa: cuántos casos tiene y si mejora o no mes a mes.
   Cada caso es un ticket con su fecha (la del ticket en Zendesk, no la de registro). */
const MESES_C = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const mesLbl = ym => { const [y, m] = ym.split('-'); return MESES_C[+m - 1] + ' ' + y.slice(2) }
const hoyISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const mesesEntre = (a, b) => { const out = []; let [y, m] = a.split('-').map(Number); const [yb, mb] = b.split('-').map(Number)
  while (y < yb || (y === yb && m <= mb)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++ } } return out }
const UMBRAL = 0.2   // ±20 % entre los dos últimos meses completos = cambio real
function tendencia(prev, ult) {
  if (prev == null || ult == null) return { flecha: '—', txt: 'Sin datos suficientes', color: 'var(--muted)', pct: null }
  if (prev === 0 && ult === 0) return { flecha: '=', txt: 'Sin casos', color: 'var(--muted)', pct: 0 }
  if (prev === 0) return { flecha: '▲', txt: 'Nuevo / emergente', color: 'var(--rose)', pct: null }
  const pct = (ult - prev) / prev
  if (pct <= -UMBRAL) return { flecha: '▼', txt: 'Mejora (baja)', color: 'var(--emerald)', pct }
  if (pct >= UMBRAL) return { flecha: '▲', txt: 'Empeora (sube)', color: 'var(--rose)', pct }
  return { flecha: '=', txt: 'Estable', color: 'var(--amber)', pct }
}
const fmtPct = p => p == null ? '' : (p > 0 ? '+' : '') + Math.round(p * 100) + '%'
const toISODate = v => {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10)
  const s = String(v || '').trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}
const normTxt = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

// Supabase devuelve máx. 1000 filas por consulta: traemos por páginas
async function traerCasos(ids) {
  if (!ids.length) return []
  const out = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabase.from('problem_cases').select('id,problem_id,ticket,fecha,created_at')
      .in('problem_id', ids).order('fecha', { ascending: false }).range(desde, desde + 999)
    if (error || !data) break
    out.push(...data); if (data.length < 1000) break
  }
  return out
}

function Problemas({ email, isAdmin, equipo }) {
  const [problems, setProblems] = useState([])
  const [cases, setCases] = useState([])
  const [openId, setOpenId] = useState(null)
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [msg, setMsg] = useState(null)
  const [cf, setCf] = useState({ ticket: '', fecha: hoyISO() })
  const [lote, setLote] = useState('')
  const [importando, setImportando] = useState(false)

  const load = useCallback(async () => {
    const { data: p } = await supabase.from('problems').select('*').eq('equipo', equipo).order('created_at', { ascending: true })
    setProblems(p || [])
    setCases(await traerCasos((p || []).map(x => x.id)))
  }, [equipo])
  useEffect(() => { load() }, [load])

  // ---- estadística mensual ----
  const mesActual = hoyISO().slice(0, 7)
  const fechaCaso = c => c.fecha || String(c.created_at || '').slice(0, 10)
  const primerMes = cases.length ? cases.map(c => fechaCaso(c).slice(0, 7)).filter(Boolean).sort()[0] : mesActual
  const meses = mesesEntre(primerMes < mesActual ? primerMes : mesActual, mesActual).slice(-12)
  const completos = meses.filter(m => m !== mesActual)
  const [mPrev, mUlt] = [completos[completos.length - 2], completos[completos.length - 1]]

  const statsDe = (pid) => {
    const cs = cases.filter(c => c.problem_id === pid)
    const porMes = {}; cs.forEach(c => { const k = fechaCaso(c).slice(0, 7); porMes[k] = (porMes[k] || 0) + 1 })
    const prev = mPrev ? (porMes[mPrev] || 0) : null, ult = mUlt ? (porMes[mUlt] || 0) : null
    return { cs, porMes, total: cs.length, prev, ult, act: porMes[mesActual] || 0, tend: tendencia(prev, ult) }
  }
  const stats = Object.fromEntries(problems.map(p => [p.id, statsDe(p.id)]))
  const totalCasos = cases.length
  const nMejora = problems.filter(p => stats[p.id].tend.flecha === '▼').length
  const nEmpeora = problems.filter(p => stats[p.id].tend.flecha === '▲').length
  const diaHoy = +hoyISO().slice(8, 10)

  // ---- acciones ----
  const addProblem = async () => {
    if (!title.trim()) return
    const { error } = await supabase.from('problems').insert({ equipo, title: title.trim(), description: desc.trim(), created_by: email })
    if (error) { setMsg({ t: 'err', m: 'Error: ' + error.message }); return }
    setTitle(''); setDesc(''); setMsg({ t: 'ok', m: 'Problema creado.' }); load()
  }
  const removeProblem = async (pid) => {
    if (!confirm('¿Eliminar el problema y todos sus casos?')) return
    await supabase.from('problem_cases').delete().eq('problem_id', pid)
    await supabase.from('problems').delete().eq('id', pid); load()
  }
  const guardarEstado = async (p, txt) => {
    if ((p.estado || '') === txt.trim()) return
    const { error } = await supabase.from('problems').update({ estado: txt.trim() || null }).eq('id', p.id)
    if (error) alert('Error: ' + error.message); else load()
  }
  // inserta tickets sin repetir los que ya tiene el problema
  const insertarCasos = async (pid, filas) => {
    const ya = new Set(cases.filter(c => c.problem_id === pid).map(c => String(c.ticket)))
    const vistos = new Set()
    const nuevos = filas.filter(f => { const k = String(f.ticket); if (ya.has(k) || vistos.has(k)) return false; vistos.add(k); return true })
      .map(f => ({ problem_id: pid, ticket: String(f.ticket), fecha: f.fecha, created_by: email }))
    for (let i = 0; i < nuevos.length; i += 500) {
      const { error } = await supabase.from('problem_cases').insert(nuevos.slice(i, i + 500))
      if (error) throw error
    }
    return { nuevos: nuevos.length, repetidos: filas.length - nuevos.length }
  }
  const addCase = async (pid) => {
    const t = cf.ticket.replace(/[^\d]/g, '')
    if (!t) return
    try {
      const r = await insertarCasos(pid, [{ ticket: t, fecha: cf.fecha || hoyISO() }])
      if (!r.nuevos) alert(`El ticket ${t} ya está registrado en este problema.`)
      setCf({ ...cf, ticket: '' }); load()
    } catch (e) { alert('Error: ' + e.message) }
  }
  // pegar varias líneas: "ticket  fecha" (fecha opcional → hoy)
  const addLote = async (pid) => {
    const filas = lote.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const partes = l.split(/[\t;, ]+/)
      const ticket = (partes[0] || '').replace(/[^\d]/g, '')
      const fecha = partes.slice(1).map(toISODate).find(Boolean) || hoyISO()
      return { ticket, fecha }
    }).filter(f => f.ticket)
    if (!filas.length) return
    try {
      const r = await insertarCasos(pid, filas)
      alert(`${r.nuevos} tickets agregados${r.repetidos ? ` · ${r.repetidos} ya existían` : ''}.`)
      setLote(''); load()
    } catch (e) { alert('Error: ' + e.message) }
  }
  const removeCase = async (id) => { await supabase.from('problem_cases').delete().eq('id', id); load() }

  // importar un Excel como "DOCUM_Casos_Zendesk_por_tema": cada hoja con columnas ID ticket + Fecha es un problema
  const importarExcel = async (file) => {
    setImportando(true); setMsg(null)
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true })
      const temas = []
      for (const sn of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' })
        const h = rows.findIndex(r => r.some(c => /id\s*ticket/i.test(String(c))) && r.some(c => /^fecha$/i.test(String(c).trim())))
        if (h < 0) continue
        const ci = rows[h].findIndex(c => /id\s*ticket/i.test(String(c))), cf2 = rows[h].findIndex(c => /^fecha$/i.test(String(c).trim()))
        const filas = rows.slice(h + 1).map(r => ({ ticket: String(r[ci] || '').replace(/[^\d]/g, ''), fecha: toISODate(r[cf2]) })).filter(f => f.ticket && f.fecha)
        if (!filas.length) continue
        const cab = String(rows[0]?.[0] || sn)
        const titulo = h > 0 ? cab.replace(/\s+—\s+[\d.,]+\s+casos.*$/i, '').trim() : sn
        const clave = (cab.match(/·\s*'([^']+)'\s*$/) || [])[1]
        temas.push({ titulo, descripcion: clave ? `Palabra clave en Zendesk: "${clave}"` : '', filas })
      }
      if (!temas.length) { setMsg({ t: 'err', m: 'No encontré hojas con columnas "ID ticket" y "Fecha".' }); setImportando(false); return }
      const n = temas.reduce((s, t) => s + t.filas.length, 0)
      if (!confirm(`Se encontraron ${temas.length} temas con ${n} tickets.\n\n${temas.map(t => `• ${t.titulo} (${t.filas.length})`).join('\n')}\n\n¿Importarlos a ${equipo}? Los temas que ya existan con el mismo nombre se completan sin duplicar tickets.`)) { setImportando(false); return }
      let creados = 0, agregados = 0
      for (const t of temas) {
        let p = problems.find(x => normTxt(x.title) === normTxt(t.titulo))
        if (!p) {
          const { data, error } = await supabase.from('problems').insert({ equipo, title: t.titulo, description: t.descripcion, created_by: email }).select().single()
          if (error) throw error
          p = data; creados++
        }
        agregados += (await insertarCasos(p.id, t.filas)).nuevos
      }
      setMsg({ t: 'ok', m: `Importación lista: ${creados} problemas nuevos y ${agregados} tickets agregados.` })
      load()
    } catch (e) { setMsg({ t: 'err', m: 'No pude importar: ' + e.message }) }
    setImportando(false)
  }

  // ---- piezas visuales ----
  const Barras = ({ porMes }) => {
    const max = Math.max(1, ...meses.map(m => porMes[m] || 0))
    return (
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 90, padding: '6px 0' }}>
        {meses.slice(-7).map(m => {
          const v = porMes[m] || 0, parcial = m === mesActual
          return (
            <div key={m} style={{ flex: 1, textAlign: 'center', minWidth: 28 }} title={`${mesLbl(m)}: ${v} casos${parcial ? ' (mes en curso)' : ''}`}>
              <div className="xs" style={{ color: 'var(--ink)', fontWeight: 600 }}>{v}</div>
              <div style={{ height: Math.max(2, (v / max) * 56), background: parcial ? 'repeating-linear-gradient(45deg,#c7d2fe,#c7d2fe 4px,#e0e7ff 4px,#e0e7ff 8px)' : 'var(--indigo)', borderRadius: '4px 4px 0 0', opacity: (m === mPrev || m === mUlt || parcial) ? 1 : 0.55 }} />
              <div className="xs muted" style={{ marginTop: 2 }}>{MESES_C[+m.slice(5) - 1]}{parcial ? '*' : ''}</div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <>
      {/* Resumen tipo "Tendencia y estado" */}
      <div className="card">
        <div className="cardh">
          <div><b>Problemas {equipo} — tendencia mensual</b>
            <div className="muted sm">{problems.length} problemas · {totalCasos} casos · se comparan los dos últimos meses completos{mPrev ? ` (${mesLbl(mPrev)} → ${mesLbl(mUlt)})` : ''}. ▼ baja ≥20 % · ▲ sube ≥20 % · = estable.</div></div>
          <div className="row">
            <span className="pill green">▼ Mejoran: {nMejora}</span>
            <span className="pill" style={{ background: '#ffe4e6', color: '#be123c' }}>▲ Empeoran: {nEmpeora}</span>
            {isAdmin && <>
              <button className="btn ghost sm" style={{ border: '1px solid var(--line)' }} disabled={importando} onClick={() => document.getElementById('prob-xlsx').click()}>{importando ? 'Importando…' : 'Importar Excel'}</button>
              <input id="prob-xlsx" type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => { const f = e.target.files[0]; if (f) importarExcel(f); e.target.value = '' }} />
            </>}
          </div>
        </div>
        {msg && <div className={'notice ' + (msg.t === 'err' ? 'err' : 'ok')}>{msg.m}</div>}
        {problems.length === 0
          ? <div className="empty">Aún no hay problemas registrados en {equipo}.</div>
          : <div className="scroll">
            <table className="mtab" style={{ fontSize: 13 }}>
              <thead><tr>
                <th className="left">Problema</th>
                {meses.map(m => <th key={m}>{mesLbl(m)}{m === mesActual ? '*' : ''}</th>)}
                <th>Total</th><th>Variación</th><th className="left">Estado</th>
              </tr></thead>
              <tbody>{problems.map(p => {
                const s = stats[p.id]
                return (
                  <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => { setOpenId(p.id); setTimeout(() => document.getElementById('prob-' + p.id)?.scrollIntoView({ behavior: 'smooth' }), 50) }}>
                    <td className="left an" style={{ whiteSpace: 'normal', minWidth: 180 }}>{p.title}</td>
                    {meses.map(m => <td key={m} className="tabular" style={{ color: m === mesActual ? 'var(--muted)' : undefined, fontWeight: (m === mPrev || m === mUlt) ? 600 : 400 }}>{s.porMes[m] || 0}</td>)}
                    <td className="tabular" style={{ fontWeight: 700 }}>{s.total}</td>
                    <td style={{ color: s.tend.color, fontWeight: 700, whiteSpace: 'nowrap' }}>{s.tend.flecha} {fmtPct(s.tend.pct)}</td>
                    <td className="left" style={{ color: s.tend.color, whiteSpace: 'nowrap' }}>{s.tend.txt}</td>
                  </tr>
                )
              })}</tbody>
            </table>
            <p className="muted xs" style={{ marginTop: 8 }}>(*) {mesLbl(mesActual)} va al día {diaHoy}: es parcial y solo se muestra como referencia. Una baja en casos es indicio de solución, no prueba.</p>
          </div>}
      </div>

      {/* Crear problema (solo admin) */}
      {isAdmin && (
        <div className="card">
          <div className="cardh"><b>Registrar un problema en {equipo}</b><div className="muted sm">Solo el administrador crea problemas.</div></div>
          <div className="grid" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
            <input placeholder="Título (ej: PQRD – Reasignación de bandejas)" value={title} onChange={e => setTitle(e.target.value)} />
            <textarea rows={2} placeholder="Descripción breve / palabra clave en Zendesk" value={desc} onChange={e => setDesc(e.target.value)} />
          </div>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={addProblem} disabled={!title.trim()}>Crear problema</button>
        </div>
      )}

      {/* Tarjeta por problema */}
      {problems.map(p => {
        const s = stats[p.id], open = openId === p.id
        return (
          <div className="card" key={p.id} id={'prob-' + p.id}>
            <div className="cardh">
              <div style={{ flex: 1, minWidth: 0 }}><b>⚠ {p.title}</b>{p.description && <div className="muted sm">{p.description}</div>}</div>
              <div className="row" style={{ alignItems: 'center' }}>
                <button className="btn ghost sm" onClick={() => setOpenId(open ? null : p.id)}>{open ? 'Ocultar tickets' : 'Ver / agregar tickets'}</button>
                {isAdmin && <button className="btn ghost sm" style={{ color: 'var(--rose)' }} onClick={() => removeProblem(p.id)}>Eliminar</button>}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16, alignItems: 'center' }}>
              <div>
                <div className="muted xs" style={{ textTransform: 'uppercase', letterSpacing: '.08em' }}>Casos totales</div>
                <div style={{ fontSize: 34, fontWeight: 800, color: 'var(--ink)', lineHeight: 1.1 }}>{s.total}</div>
                <div style={{ marginTop: 6, color: s.tend.color, fontWeight: 700 }}>{s.tend.flecha} {s.tend.txt} {fmtPct(s.tend.pct) && `(${fmtPct(s.tend.pct)})`}</div>
                {mPrev && <div className="muted sm">{mesLbl(mPrev)}: <b>{s.prev}</b> → {mesLbl(mUlt)}: <b>{s.ult}</b> · {mesLbl(mesActual)}* (al día {diaHoy}): {s.act}</div>}
              </div>
              <Barras porMes={s.porMes} />
            </div>
            <label className="f" style={{ marginTop: 6 }}>Lectura / estado {!isAdmin && <span className="xs">(lo actualiza el administrador)</span>}
              {isAdmin
                ? <input key={p.estado || ''} defaultValue={p.estado || ''} placeholder="Ej: Caída sostenida, posible corrección; validar con desarrollo." onBlur={e => guardarEstado(p, e.target.value)} />
                : <div style={{ color: 'var(--ink)', padding: '4px 0' }}>{p.estado || '—'}</div>}
            </label>

            {open && (
              <div style={{ marginTop: 14 }}>
                <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10, background: '#f8fafc', padding: 12, borderRadius: 9 }}>
                  <label className="f"># Ticket<input placeholder="Ej: 10120119" value={cf.ticket} onChange={e => setCf({ ...cf, ticket: e.target.value })} onKeyDown={e => e.key === 'Enter' && addCase(p.id)} /></label>
                  <label className="f">Fecha del ticket<input type="date" value={cf.fecha} onChange={e => setCf({ ...cf, fecha: e.target.value })} /></label>
                  <div style={{ display: 'flex', alignItems: 'flex-end' }}><button className="btn primary sm" onClick={() => addCase(p.id)} disabled={!cf.ticket.trim()}>Agregar ticket</button></div>
                </div>
                <details style={{ margin: '8px 0 12px' }}>
                  <summary className="muted sm" style={{ cursor: 'pointer' }}>Pegar varios tickets a la vez</summary>
                  <textarea rows={4} style={{ marginTop: 6, fontFamily: 'monospace' }} placeholder={'Un ticket por línea, con su fecha opcional:\n10120119\t2026-10-14\n10119998\t14/10/2026'} value={lote} onChange={e => setLote(e.target.value)} />
                  <button className="btn primary sm" style={{ marginTop: 6 }} onClick={() => addLote(p.id)} disabled={!lote.trim()}>Agregar tickets</button>
                </details>
                {s.cs.length === 0 ? <div className="empty">Sin tickets aún.</div> : (
                  <div className="scroll" style={{ maxHeight: 320, overflowY: 'auto' }}>
                    <table><thead><tr><th># Ticket</th><th>Fecha</th><th></th></tr></thead>
                      <tbody>{s.cs.map(c => (
                        <tr key={c.id}>
                          <td className="tabular" style={{ fontWeight: 600, color: 'var(--ink)' }}>{c.ticket}</td>
                          <td className="muted">{fechaCaso(c)}</td>
                          <td style={{ textAlign: 'right' }}><button className="btn ghost sm" style={{ color: 'var(--rose)' }} onClick={() => removeCase(c.id)}>✕</button></td>
                        </tr>
                      ))}</tbody></table>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

/* ================= ANALISTAS / PERSONAS Y PROYECTOS (solo admin) ================= */
function Analistas() {
  const [analysts, setAnalysts] = useState([])
  const [form, setForm] = useState({ name: '', email: '', equipos: 'DOCUM', rol: 'analista', skill: '' })
  const [msg, setMsg] = useState(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('analysts').select('*').order('name')
    setAnalysts(data || [])
  }, [])
  useEffect(() => { load() }, [load])

  const add = async () => {
    setMsg(null)
    const nm = form.name.trim(), em = form.email.trim().toLowerCase()
    const eq = (form.equipos.trim() || 'DOCUM').split(',').map(x => x.trim()).filter(Boolean).join(',')
    if (!nm || !em) return
    if (!em.includes('@')) { setMsg({ t: 'err', m: 'Correo inválido.' }); return }
    const { error } = await supabase.from('analysts').insert({ name: nm, email: em, equipos: eq, rol: form.rol, skill: form.skill.trim() })
    if (error) { setMsg({ t: 'err', m: error.message.includes('duplicate') ? 'Ese correo ya está registrado.' : 'Error: ' + error.message }); return }
    setForm({ name: '', email: '', equipos: 'DOCUM', rol: 'analista', skill: '' }); setMsg({ t: 'ok', m: 'Persona agregada.' }); load()
  }
  const save = async (a, patch) => {
    const { error } = await supabase.from('analysts').update(patch).eq('id', a.id)
    if (error) setMsg({ t: 'err', m: 'Error: ' + error.message }); else { setMsg({ t: 'ok', m: 'Cambio guardado.' }); load() }
  }
  const remove = async (a) => {
    if (!confirm(`¿Quitar a ${a.name}?`)) return
    await supabase.from('analysts').delete().eq('id', a.id); load()
  }

  const equiposExistentes = [...new Set(analysts.flatMap(a => String(a.equipos || '').split(',').map(x => x.trim()).filter(Boolean)))].sort()

  return (
    <div className="card">
      <div className="cardh">
        <div><b>Personas y proyectos</b>
          <div className="muted sm">Agrega personas, asígnales equipo(s) y rol. El rol <b>Digitador</b> puede agregar y editar la base de conocimiento de sus equipos. Escribe varios equipos separados por coma (ej: DOCUM,Balu). Un proyecto nuevo aparece solo cuando se lo asignas a alguien.</div></div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', marginBottom: 8 }}>
        <input placeholder="Nombre completo" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <input type="email" placeholder="correo@empresa.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
        <input placeholder="Equipos (ej: DOCUM,Balu)" value={form.equipos} onChange={e => setForm({ ...form, equipos: e.target.value })} />
        <input placeholder="Skill (ej: Atencion, Gestion)" value={form.skill} onChange={e => setForm({ ...form, skill: e.target.value })} />
        <select value={form.rol} onChange={e => setForm({ ...form, rol: e.target.value })}>
          <option value="analista">Analista</option><option value="digitador">Digitador</option><option value="admin">Administrador</option>
        </select>
        <button className="btn primary" onClick={add} disabled={!form.name.trim() || !form.email.trim()}>Agregar</button>
      </div>
      {msg && <div className={'notice ' + (msg.t === 'err' ? 'err' : 'ok')}>{msg.m}</div>}
      {equiposExistentes.length > 0 && <p className="muted sm" style={{ marginTop: 6 }}>Equipos actuales: {equiposExistentes.join(' · ')}</p>}
      {analysts.length === 0
        ? <div className="empty">Aún no hay personas.</div>
        : <div className="scroll" style={{ marginTop: 8 }}>
            <table><thead><tr><th>Nombre</th><th>Correo</th><th>Equipos</th><th>Skill</th><th>Rol</th><th></th></tr></thead>
              <tbody>{analysts.map(a => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600, color: 'var(--ink)' }}>{a.name}</td>
                  <td className="muted">{a.email}</td>
                  <td><input defaultValue={a.equipos || 'DOCUM'} style={{ padding: '4px 8px', width: 150 }}
                    onBlur={e => { const v = e.target.value.split(',').map(x => x.trim()).filter(Boolean).join(','); if (v !== (a.equipos || '')) save(a, { equipos: v || 'DOCUM' }) }} /></td>
                  <td><input defaultValue={a.skill || ''} placeholder="—" style={{ padding: '4px 8px', width: 130 }}
                    onBlur={e => { if (e.target.value.trim() !== (a.skill || '')) save(a, { skill: e.target.value.trim() }) }} /></td>
                  <td><select defaultValue={a.rol || 'analista'} style={{ padding: '4px 8px' }} onChange={e => save(a, { rol: e.target.value })}>
                    <option value="analista">Analista</option><option value="digitador">Digitador</option><option value="admin">Administrador</option></select></td>
                  <td style={{ textAlign: 'right' }}><button className="btn ghost sm" style={{ color: 'var(--rose)' }} onClick={() => remove(a)}>Quitar</button></td>
                </tr>
              ))}</tbody></table>
          </div>}
      <p className="muted sm" style={{ marginTop: 10 }}>Total: {analysts.length}. El correo debe ser el real de Google. Edita "Equipos" (sale del campo para guardar) o "Rol" directamente en la tabla.</p>
    </div>
  )
}
