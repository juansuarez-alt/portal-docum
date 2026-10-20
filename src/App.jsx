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

/* ================= PROBLEMAS (por marca) ================= */
function Problemas({ email, name, isAdmin, equipo }) {
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
    const { data: p } = await supabase.from('problems').select('*').eq('equipo', equipo).order('created_at', { ascending: false })
    const { data: c } = await supabase.from('problem_cases').select('*').order('created_at', { ascending: true })
    const { data: a } = await supabase.from('analysts').select('*').order('name')
    const ids = new Set((p || []).map(x => x.id))
    setProblems(p || []); setCases((c || []).filter(x => ids.has(x.problem_id)))
    setAnalysts((a || []).filter(x => splitEq(x.equipos || 'DOCUM').includes(equipo)))
  }, [equipo])
  useEffect(() => { load() }, [load])

  const casesOf = (pid) => cases.filter(c => c.problem_id === pid)

  const addProblem = async () => {
    if (!title.trim()) return
    const { error } = await supabase.from('problems').insert({ equipo, title: title.trim(), description: desc.trim(), created_by: email })
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
          <div className="cardh"><b>Resumen de problemas — {equipo}</b><div className="muted sm">Solo administrador</div></div>
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
          <div className="cardh"><b>Registrar un problema en {equipo}</b><div className="muted sm">Solo el administrador crea problemas.</div></div>
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
        ? <div className="card"><div className="empty">Aún no hay problemas registrados en {equipo}.</div></div>
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
