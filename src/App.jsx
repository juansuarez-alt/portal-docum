import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase, DOMINIOS } from './supabaseClient.js'
import Capacidad from './Capacidad.jsx'
const dominioOk = (e) => DOMINIOS.some(d => String(e || '').toLowerCase().endsWith('@' + d))
const splitEq = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean)
const fmtFecha = iso => iso ? new Date(iso).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', year: 'numeric' }) : ''
const LS = { get: k => { try { return localStorage.getItem(k) } catch { return null } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch { /* sin almacenamiento */ } } }

// Perfiles: el admin puede verse como analista; quien es digitador alterna entre ver (analista) y agregar (digitador)
const PERFILES = { admin: 'Administrador', digitador: 'Digitador', verificador: 'Verificador', analista: 'Analista' }
const ICONO = { analista: '👁 ', digitador: '✎ ', verificador: '✓ ', admin: '' }
const perfilesDe = u => u.esAdmin ? ['admin', 'analista'] : ['analista', ...(u.esDigitador ? ['digitador'] : []), ...(u.esVerificador ? ['verificador'] : [])]
// Qué puede hacer cada perfil en Problemas y Base de conocimiento
//  - analista: solo ve lo aprobado
//  - digitador: crea y edita; lo suyo queda PENDIENTE hasta que un verificador lo apruebe
//  - verificador / admin: ve todo, edita, aprueba y elimina; lo que guardan queda aprobado
const permisosDe = perfil => ({
  verTodo: perfil !== 'analista',
  editar: perfil !== 'analista',
  aprobar: perfil === 'verificador' || perfil === 'admin',
  borrarAprobado: perfil === 'verificador' || perfil === 'admin',
})

export default function App() {
  // Acceso sin verificación por correo: basta con que el correo esté registrado en "Personas y roles"
  const [email, setEmail] = useState(() => LS.get('mesa_email') || '')
  const [yo, setYo] = useState(null)            // { name, equipos, esAdmin, esDigitador, esVerificador }
  const [ready, setReady] = useState(false)
  const [tab, setTab] = useState('problemas')
  const [loginEmail, setLoginEmail] = useState('')
  const [authErr, setAuthErr] = useState('')
  const [entrando, setEntrando] = useState(false)
  const [perfil, setPerfil] = useState('analista')
  const [misEquipos, setMisEquipos] = useState([])
  const [equipo, setEquipo] = useState(() => LS.get('mesa_equipo') || '')

  const cargarUsuario = useCallback(async (em) => {
    const { data: adm } = await supabase.from('admins').select('email').ilike('email', em.replace(/[\\%_]/g, '\\$&')).maybeSingle()
    const { data: me } = await supabase.from('analysts').select('name,equipos,rol,digitador,verificador').ilike('email', em.replace(/[\\%_]/g, '\\$&')).maybeSingle()
    if (!adm && !me) return null
    const esAdmin = !!adm || me?.rol === 'admin'
    const esDigitador = !!me?.digitador || me?.rol === 'digitador'
    const esVerificador = !!me?.verificador
    const { data: all } = await supabase.from('analysts').select('equipos')
    const set = new Set(); (all || []).forEach(a => splitEq(a.equipos).forEach(t => set.add(t)))
    if (set.size === 0) set.add('DOCUM')
    const teams = [...set].sort()
    const mine = esAdmin ? teams : splitEq(me?.equipos)
    return { name: me?.name || em, esAdmin, esDigitador, esVerificador, equipos: mine.length ? mine : (esAdmin ? teams : ['DOCUM']) }
  }, [])

  // al abrir: si ya había entrado en este navegador, recuperamos su perfil
  useEffect(() => {
    if (!email) { setReady(true); return }
    cargarUsuario(email).then(u => {
      if (!u) { LS.set('mesa_email', null); setEmail(''); setReady(true); return }
      aplicarUsuario(u); setReady(true)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const aplicarUsuario = (u) => {
    setYo(u); setMisEquipos(u.equipos)
    setEquipo(prev => (prev && u.equipos.includes(prev)) ? prev : u.equipos[0])
    const disponibles = perfilesDe(u)
    const guardado = LS.get('mesa_perfil')
    setPerfil(disponibles.includes(guardado) ? guardado : disponibles[0])
  }

  const entrar = async () => {
    setAuthErr('')
    const em = loginEmail.trim().toLowerCase()
    if (!dominioOk(em)) { setAuthErr('Usa tu correo corporativo autorizado.'); return }
    setEntrando(true)
    const u = await cargarUsuario(em)
    setEntrando(false)
    if (!u) { setAuthErr('Ese correo no está registrado en el portal. Pídele al administrador que te agregue.'); return }
    LS.set('mesa_email', em); setEmail(em); aplicarUsuario(u)
  }
  const salir = () => { LS.set('mesa_email', null); LS.set('mesa_perfil', null); setEmail(''); setYo(null); setLoginEmail('') }
  const cambiarPerfil = p => { setPerfil(p); LS.set('mesa_perfil', p) }
  const cambiarEquipo = t => { setEquipo(t); LS.set('mesa_equipo', t) }

  const actingAdmin = perfil === 'admin'
  const perm = permisosDe(perfil)

  if (!ready) return <div className="center muted">Cargando…</div>

  if (!email || !yo) return (
    <Shell><h1>Bienvenido a la Mesa de Ayuda</h1>
      <p className="muted">Ingresa tu correo corporativo para entrar.</p>
      <label className="f" style={{ marginTop: 10 }}>Correo corporativo
        <input type="email" placeholder="nombre@empresa.com" value={loginEmail} autoFocus
          onChange={e => setLoginEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && entrar()} />
      </label>
      {authErr && <div className="notice err" style={{ marginTop: 10 }}>{authErr}</div>}
      <button className="btn primary block" onClick={entrar} disabled={entrando || !loginEmail.trim()}>{entrando ? 'Entrando…' : 'Entrar'}</button>
    </Shell>
  )

  // si estaba en una pestaña de admin y cambia de perfil, lo devolvemos a problemas
  if (!actingAdmin && (tab === 'analistas')) setTab('problemas')

  const disponibles = perfilesDe(yo)

  return (
    <div className="app">
      <header className="topbar">
        <div><div className="eyebrow">MESA DE AYUDA</div><b style={{ color: '#fff' }}>Centro de operación</b></div>
        <div className="userbox">
          {misEquipos.length > 0 && (misEquipos.length === 1
            ? <span className="pill slate">{misEquipos[0]}</span>
            : <select value={equipo} onChange={e => cambiarEquipo(e.target.value)} style={{ padding: '6px 8px', borderRadius: 8, width: 'auto' }}>{misEquipos.map(t => <option key={t} value={t}>{t}</option>)}</select>)}
          {disponibles.length > 1 && (
            <div style={{ display: 'flex', border: '1px solid #334155', borderRadius: 8, overflow: 'hidden' }} title="Cambia de perfil según lo que quieras hacer">
              {disponibles.map(p => (
                <button key={p} onClick={() => cambiarPerfil(p)}
                  style={{ background: perfil === p ? '#4f46e5' : 'transparent', color: perfil === p ? '#fff' : '#cbd5e1', border: 'none', padding: '6px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  {ICONO[p]}{PERFILES[p]}
                </button>
              ))}
            </div>
          )}
          <div className="uname">{yo.name}</div>
          {disponibles.length === 1 && <div className="urole analista">{PERFILES[perfil]}</div>}
          <button className="btn ghost sm" style={{ color: '#cbd5e1' }} onClick={salir}>Salir</button>
        </div>
      </header>
      <nav className="tabs">
        <button className={tab === 'problemas' ? 'on' : ''} onClick={() => setTab('problemas')}>Problemas {equipo}</button>
        <button className={tab === 'kb' ? 'on' : ''} onClick={() => setTab('kb')}>Base de conocimiento {equipo}</button>
        <button className={tab === 'capacidad' ? 'on' : ''} onClick={() => setTab('capacidad')}>Capacidad {equipo}</button>
        {actingAdmin && <button className={tab === 'analistas' ? 'on' : ''} onClick={() => setTab('analistas')}>Personas y roles</button>}
      </nav>
      <main className="wrap">
        {tab === 'problemas' && equipo && <Problemas key={'p-' + equipo} email={email} name={yo.name} isAdmin={actingAdmin} perm={perm} equipo={equipo} />}
        {tab === 'kb' && equipo && <BaseConocimiento key={'kb-' + equipo} email={email} name={yo.name} perm={perm} equipo={equipo} />}
        {tab === 'capacidad' && equipo && <Capacidad key={'cap-' + equipo + perfil} name={yo.name} perm={perm} equipo={equipo} />}
        {tab === 'analistas' && actingAdmin && <Analistas />}
      </main>
      <footer className="foot">Mesa de Ayuda</footer>
    </div>
  )
}

function Shell({ children }) {
  return <div className="center"><div className="card auth">{children}</div></div>
}

/* ================= BASE DE CONOCIMIENTO (por marca) =================
   Cada registro es un protocolo: Título del protocolo · Proceso o situación · Respuesta (para chat o escalamiento).
   Los analistas solo ven los aprobados; digitadores proponen, verificadores aprueban. */
const KB_VACIO = { id: null, titulo: '', alcance: '', categoria: '', situacion: '', tipo_respuesta: 'chat', respuesta: '', adjuntos: [], nuevos: [] }
// Adjuntos (manuales, documentos): se guardan en Supabase Storage, bucket "kb-adjuntos"
const BUCKET = 'kb-adjuntos'
const MAX_MB = 25
const fmtTam = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'
const iconoArchivo = n => /\.pdf$/i.test(n) ? '📕' : /\.(docx?|odt|rtf)$/i.test(n) ? '📘' : /\.(xlsx?|csv|ods)$/i.test(n) ? '📗' : /\.(pptx?|odp)$/i.test(n) ? '📙' : /\.(png|jpe?g|gif|webp)$/i.test(n) ? '🖼' : /\.(mp4|mov|webm)$/i.test(n) ? '🎬' : '📎'
const urlAdjunto = path => supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
const nombreSeguro = n => String(n).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.\-]+/g, '_').slice(-80)
// Alcance: a qué frente/nivel le corresponde atender el caso
const ALCANCES = [
  { k: 'gestion', lbl: 'Gestión', color: '#0891b2' },
  { k: 'n1', lbl: 'Nivel 1', color: '#059669' },
  { k: 'n2', lbl: 'Nivel 2', color: '#d97706' },
  { k: 'n3_data', lbl: 'Nivel 3 · Data', color: '#7c3aed' },
  { k: 'n3_desarrollo', lbl: 'Nivel 3 · Desarrollo', color: '#e11d48' },
]
// el alcance se guarda como lista separada por comas: 'gestion,n1'
const alcKeys = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean)
const alcancesDe = i => ALCANCES.filter(a => alcKeys(i.alcance).includes(a.k))
const TIPOS_RESP = {
  chat: { lbl: 'Respuesta para chat', corto: '💬 Chat', color: 'var(--emerald)' },
  escalamiento: { lbl: 'Escalamiento', corto: '⤴ Escalamiento', color: 'var(--indigo)' },
}
const tipoDe = i => TIPOS_RESP[i.tipo_respuesta] || TIPOS_RESP.chat

function BaseConocimiento({ email, name, perm, equipo }) {
  const puedeEditar = perm.editar
  const [items, setItems] = useState([])
  const [cargando, setCargando] = useState(true)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [fAlc, setFAlc] = useState('')
  const [abierto, setAbierto] = useState(null)
  const [form, setForm] = useState(null)      // null = cerrado; objeto = creando/editando
  const [msg, setMsg] = useState(null)
  const [copiado, setCopiado] = useState(null)
  const [subiendo, setSubiendo] = useState('')

  const load = useCallback(async () => {
    setCargando(true)
    let qy = supabase.from('kb_protocolos').select('*').eq('equipo', equipo).order('titulo')
    if (!perm.verTodo) qy = qy.eq('aprobado', true)
    const { data, error } = await qy
    if (error) setMsg({ t: 'err', m: 'No pude cargar la base de conocimiento: ' + error.message })
    setItems(data || []); setCargando(false)
  }, [equipo, perm.verTodo])
  useEffect(() => { load() }, [load])

  const categorias = useMemo(() => [...new Set(items.map(i => (i.categoria || '').trim()).filter(Boolean))].sort(), [items])

  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const filtrados = useMemo(() => {
    const palabras = norm(q).split(/\s+/).filter(Boolean)
    return items.filter(i => {
      if (fAlc && !alcKeys(i.alcance).includes(fAlc)) return false
      if (cat === '__pend') { if (i.aprobado) return false } else if (cat && (i.categoria || '').trim() !== cat) return false
      if (!palabras.length) return true
      const txt = norm([i.titulo, alcancesDe(i).map(a => a.lbl).join(' '), (i.adjuntos || []).map(a => a.nombre).join(' '), i.categoria, i.situacion, i.respuesta, tipoDe(i).lbl].join(' '))
      return palabras.every(p => txt.includes(p))
    })
  }, [items, q, cat, fAlc])

  const guardar = async () => {
    setMsg(null)
    if (!alcKeys(form.alcance).length) { setMsg({ t: 'err', m: 'Elige al menos un alcance: Gestión, Nivel 1, Nivel 2, Nivel 3 · Data o Nivel 3 · Desarrollo.' }); return }
    const f = { titulo: form.titulo.trim(), alcance: ALCANCES.map(a => a.k).filter(k => alcKeys(form.alcance).includes(k)).join(','), categoria: form.categoria.trim() || null, situacion: form.situacion.trim(), tipo_respuesta: form.tipo_respuesta || 'chat', respuesta: form.respuesta.trim() }
    if (!f.titulo || !f.situacion || !f.respuesta) { setMsg({ t: 'err', m: 'Título, proceso o situación y respuesta son obligatorios.' }); return }
    const quien = name || email, ahora = new Date().toISOString()
    const ap = perm.aprobar ? { aprobado: true, aprobado_por: quien, aprobado_at: ahora } : { aprobado: false, aprobado_por: null, aprobado_at: null }
    // subir los archivos nuevos antes de guardar el protocolo
    const subidos = []
    for (const file of form.nuevos || []) {
      setSubiendo(`Subiendo ${file.name}…`)
      const path = `${nombreSeguro(equipo)}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${nombreSeguro(file.name)}`
      const { error: eUp } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false })
      if (eUp) {
        setSubiendo('')
        if (subidos.length) await supabase.storage.from(BUCKET).remove(subidos.map(a => a.path))
        setMsg({ t: 'err', m: `No se pudo subir "${file.name}": ${eUp.message}` }); return
      }
      subidos.push({ nombre: file.name, path, tam: file.size, tipo: file.type || '', subido_por: quien, subido_at: ahora })
    }
    setSubiendo('')
    f.adjuntos = [...(form.adjuntos || []), ...subidos]
    const quitados = (form.quitados || [])
    const { error } = form.id
      ? await supabase.from('kb_protocolos').update({ ...f, ...ap, updated_by: quien, updated_at: ahora }).eq('id', form.id)
      : await supabase.from('kb_protocolos').insert({ ...f, ...ap, equipo, created_by: quien, updated_by: quien })
    if (error) {
      if (subidos.length) await supabase.storage.from(BUCKET).remove(subidos.map(a => a.path))
      const sinPermiso = /row-level security|permission/i.test(error.message)
      setMsg({ t: 'err', m: sinPermiso ? 'No tienes permiso para guardar en la base de conocimiento. Pide al administrador el rol Digitador.' : 'Error: ' + error.message })
      return
    }
    if (quitados.length) await supabase.storage.from(BUCKET).remove(quitados)
    setMsg({ t: 'ok', m: perm.aprobar ? (form.id ? 'Protocolo actualizado y aprobado.' : 'Protocolo agregado y aprobado.') : 'Enviado a aprobación: los analistas lo verán cuando un verificador lo apruebe.' })
    setForm(null); load()
  }

  const agregarArchivos = (lista) => {
    const files = [...(lista || [])]
    const grandes = files.filter(f2 => f2.size > MAX_MB * 1048576)
    if (grandes.length) setMsg({ t: 'err', m: `Supera ${MAX_MB} MB y no se agregó: ${grandes.map(f2 => f2.name).join(', ')}` })
    const ok = files.filter(f2 => f2.size <= MAX_MB * 1048576)
    if (ok.length) setForm(fm => ({ ...fm, nuevos: [...(fm.nuevos || []), ...ok] }))
  }

  const borrar = async (i) => {
    if (!confirm(`¿Eliminar el protocolo "${i.titulo}"? No se puede deshacer.`)) return
    const { error } = await supabase.from('kb_protocolos').delete().eq('id', i.id)
    if (error) { setMsg({ t: 'err', m: 'Error: ' + error.message }); return }
    const paths = (i.adjuntos || []).map(a => a.path)
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths)
    setMsg({ t: 'ok', m: 'Protocolo eliminado.' }); load()
  }

  const aprobar = async (i) => {
    const { error } = await supabase.from('kb_protocolos').update({ aprobado: true, aprobado_por: name || email, aprobado_at: new Date().toISOString() }).eq('id', i.id)
    if (error) { setMsg({ t: 'err', m: 'Error: ' + error.message }); return }
    setMsg({ t: 'ok', m: `"${i.titulo}" aprobado: ya lo ven los analistas.` }); load()
  }
  const nPend = items.filter(i => !i.aprobado).length

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
            <div className="muted sm">Protocolos de la mesa: qué hacer ante cada situación. {perm.aprobar ? 'Puedes editar y aprobar.' : puedeEditar ? 'Lo que agregues o edites queda pendiente hasta que un verificador lo apruebe.' : 'Solo lectura.'}</div></div>
          {puedeEditar && !form && <button className="btn primary" onClick={() => { setMsg(null); setForm({ ...KB_VACIO }) }}>+ Nuevo protocolo</button>}
        </div>

        {form && (
          <div className="panel" style={{ marginTop: 0, marginBottom: 12 }}>
            <b>{form.id ? 'Editar protocolo' : 'Nuevo protocolo'}</b>
            <div className="grid" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginTop: 10 }}>
              <label className="f">Título del protocolo *<input placeholder="Ej: Usuario no recibe el correo de restablecimiento" value={form.titulo} onChange={e => setForm({ ...form, titulo: e.target.value })} /></label>
              <label className="f">Categoría (opcional)
                <input list="kb-cats" placeholder="Ej: Accesos" value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })} />
                <datalist id="kb-cats">{categorias.map(c => <option key={c} value={c} />)}</datalist>
              </label>
            </div>
            <div className="f" style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>Alcance * <span className="xs">— a quién le corresponde atenderlo (puedes marcar varios)</span></div>
            <div className="row" style={{ gap: 6, marginTop: 4 }}>
              {ALCANCES.map(a => {
                const sel = alcKeys(form.alcance), on = sel.includes(a.k)
                const nuevo = on ? sel.filter(k => k !== a.k) : [...sel, a.k]
                return (
                  <button key={a.k} type="button" className="btn sm" aria-pressed={on} onClick={() => setForm({ ...form, alcance: nuevo.join(',') })}
                    style={{ border: '1px solid ' + (on ? a.color : 'var(--line)'), background: on ? a.color : '#fff', color: on ? '#fff' : 'var(--slate)' }}>{on ? '✓ ' : ''}{a.lbl}</button>
                )
              })}
            </div>
            <label className="f" style={{ marginTop: 10 }}>Proceso o situación * <span className="xs">— qué pasa, en qué proceso, cómo lo reporta el usuario</span>
              <textarea rows={4} value={form.situacion} onChange={e => setForm({ ...form, situacion: e.target.value })} />
            </label>
            <div className="f" style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>Tipo de respuesta *</div>
            <div className="row" style={{ gap: 6, marginTop: 4 }}>
              {Object.entries(TIPOS_RESP).map(([k, t]) => (
                <button key={k} type="button" className="btn sm" onClick={() => setForm({ ...form, tipo_respuesta: k })}
                  style={{ border: '1px solid ' + (form.tipo_respuesta === k ? t.color : 'var(--line)'), background: form.tipo_respuesta === k ? t.color : '#fff', color: form.tipo_respuesta === k ? '#fff' : 'var(--slate)' }}>{t.corto}</button>
              ))}
            </div>
            <label className="f" style={{ marginTop: 10 }}>{TIPOS_RESP[form.tipo_respuesta || 'chat'].lbl} * <span className="xs">{form.tipo_respuesta === 'escalamiento' ? '— a quién se escala, por qué medio y con qué datos' : '— el texto que se le responde al usuario por chat'}</span>
              <textarea rows={7} value={form.respuesta} onChange={e => setForm({ ...form, respuesta: e.target.value })} />
            </label>
            <div className="f" style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>Manuales o documentos (opcional) <span className="xs">— PDF, Word, Excel, imágenes… hasta {MAX_MB} MB cada uno</span></div>
            <div style={{ border: '1px dashed #cbd5e1', borderRadius: 9, padding: 10, marginTop: 4 }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); agregarArchivos(e.dataTransfer.files) }}>
              {[...(form.adjuntos || []).map((a, idx) => ({ ...a, _ya: true, _idx: idx })), ...(form.nuevos || []).map((f2, idx) => ({ nombre: f2.name, tam: f2.size, _idx: idx }))].map(a => (
                <div key={(a._ya ? 'y' : 'n') + a._idx} className="row" style={{ alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{iconoArchivo(a.nombre)} {a.nombre} <span className="muted xs">{fmtTam(a.tam || 0)}{a._ya ? '' : ' · nuevo'}</span></span>
                  <button type="button" className="btn ghost sm" style={{ color: 'var(--rose)' }} onClick={() => a._ya
                    ? setForm({ ...form, adjuntos: form.adjuntos.filter((_, j) => j !== a._idx), quitados: [...(form.quitados || []), a.path] })
                    : setForm({ ...form, nuevos: form.nuevos.filter((_, j) => j !== a._idx) })}>Quitar</button>
                </div>
              ))}
              <label className="btn ghost sm" style={{ border: '1px solid var(--line)', marginTop: 4, cursor: 'pointer' }}>
                📎 Adjuntar archivos (o arrástralos aquí)
                <input type="file" multiple style={{ display: 'none' }} onChange={e => { agregarArchivos(e.target.files); e.target.value = '' }} />
              </label>
            </div>
            {subiendo && <div className="notice" style={{ marginTop: 10 }}>{subiendo}</div>}
            {msg && <div className={'notice ' + (msg.t === 'err' ? 'err' : 'ok')} style={{ marginTop: 10 }}>{msg.m}</div>}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn primary" onClick={guardar} disabled={!!subiendo || !form.titulo.trim() || !alcKeys(form.alcance).length || !form.situacion.trim() || !form.respuesta.trim()}>{perm.aprobar ? 'Guardar y aprobar' : 'Enviar a aprobación'}</button>
              <button className="btn ghost" onClick={() => { setForm(null); setMsg(null) }}>Cancelar</button>
            </div>
          </div>
        )}

        <div className="row" style={{ alignItems: 'center' }}>
          <input style={{ flex: 1, minWidth: 220 }} placeholder={`Buscar en ${items.length} protocolos (título, proceso o respuesta)…`} value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="row" style={{ marginTop: 10, gap: 6, alignItems: 'center' }}>
          <span className="muted xs" style={{ textTransform: 'uppercase', letterSpacing: '.08em' }}>Alcance</span>
          <button className={'pill ' + (fAlc === '' ? 'green' : 'slate')} style={{ border: 'none', cursor: 'pointer' }} onClick={() => setFAlc('')}>Todos</button>
          {ALCANCES.map(a => {
            const n = items.filter(i => alcKeys(i.alcance).includes(a.k)).length, on = fAlc === a.k
            return <button key={a.k} className="pill" style={{ cursor: 'pointer', border: '1px solid ' + a.color, background: on ? a.color : 'transparent', color: on ? '#fff' : a.color }} onClick={() => setFAlc(on ? '' : a.k)}>{a.lbl}: {n}</button>
          })}
        </div>
        {(categorias.length > 0 || (perm.verTodo && nPend > 0)) && (
          <div className="row" style={{ marginTop: 10, gap: 6 }}>
            <button className={'pill ' + (cat === '' ? 'green' : 'slate')} style={{ border: 'none', cursor: 'pointer' }} onClick={() => setCat('')}>Todas</button>
            {perm.verTodo && nPend > 0 && <button className="pill amber" style={{ border: cat === '__pend' ? '2px solid var(--amber)' : 'none', cursor: 'pointer' }} onClick={() => setCat(cat === '__pend' ? '' : '__pend')}>⏳ Pendientes de aprobación: {nPend}</button>}
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
                    <b>📘 {i.titulo}</b>{alcancesDe(i).map(a => <span key={a.k} className="pill" style={{ marginLeft: 6, background: a.color, color: '#fff' }}>{a.lbl}</span>)}{i.categoria && <span className="pill slate" style={{ marginLeft: 8 }}>{i.categoria}</span>}<span className="pill" style={{ marginLeft: 8, background: 'transparent', border: '1px solid ' + tipoDe(i).color, color: tipoDe(i).color }}>{tipoDe(i).corto}</span>{(i.adjuntos || []).length > 0 && <span className="pill slate" style={{ marginLeft: 8 }}>📎 {i.adjuntos.length}</span>}{!i.aprobado && <span className="pill amber" style={{ marginLeft: 8 }}>⏳ Pendiente de aprobación</span>}
                    {!open && <div className="muted sm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.situacion}</div>}
                  </div>
                  <span className="muted">{open ? '▲' : '▼'}</span>
                </div>
                {open && (
                  <div>
                    {bloque('Proceso o situación', i.situacion, 'var(--amber)')}
                    {bloque(tipoDe(i).lbl, i.respuesta, tipoDe(i).color)}
                    {(i.adjuntos || []).length > 0 && (
                      <div style={{ borderLeft: '3px solid var(--slate)', padding: '8px 12px', background: '#f8fafc', borderRadius: '0 8px 8px 0', marginBottom: 10 }}>
                        <div className="xs" style={{ fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 4 }}>Manuales y documentos</div>
                        {i.adjuntos.map(a => (
                          <div key={a.path} style={{ padding: '3px 0' }}>
                            <a href={urlAdjunto(a.path)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--indigo)', fontWeight: 600, textDecoration: 'none' }}>{iconoArchivo(a.nombre)} {a.nombre}</a>
                            <span className="muted xs"> · {fmtTam(a.tam || 0)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                      <span className="muted xs">Actualizado {fmtFecha(i.updated_at || i.created_at)}{i.updated_by ? ` por ${i.updated_by}` : ''}{i.aprobado && i.aprobado_por ? ` · aprobado por ${i.aprobado_por}` : ''}</span>
                      <div className="row">
                        <button className="btn ghost sm" onClick={() => copiar(i)}>{copiado === i.id ? '✓ Copiado' : (i.tipo_respuesta === 'escalamiento' ? 'Copiar escalamiento' : 'Copiar respuesta')}</button>
                        {puedeEditar && <button className="btn ghost sm" onClick={() => { setMsg(null); setForm({ id: i.id, titulo: i.titulo, alcance: i.alcance || '', categoria: i.categoria || '', situacion: i.situacion, tipo_respuesta: i.tipo_respuesta || 'chat', respuesta: i.respuesta, adjuntos: i.adjuntos || [], nuevos: [], quitados: [] }); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Editar</button>}
                        {perm.aprobar && !i.aprobado && <button className="btn primary sm" onClick={() => aprobar(i)}>✓ Aprobar</button>}
                        {(perm.borrarAprobado || (puedeEditar && !i.aprobado)) && <button className="btn ghost sm" style={{ color: 'var(--rose)' }} onClick={() => borrar(i)}>Eliminar</button>}
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
   Un problema = un tema. Se registra la CANTIDAD de casos por mes (la cargan admin y digitadores)
   y el portal calcula el total y la variación mensual. */
const MESES_C = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const mesLbl = ym => { const [y, m] = ym.split('-'); return MESES_C[+m - 1] + ' ' + y.slice(2) }
const hoyISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const sumarMes = (ym, n) => { let [y, m] = ym.split('-').map(Number); m += n; while (m > 12) { m -= 12; y++ } while (m < 1) { m += 12; y-- } return `${y}-${String(m).padStart(2, '0')}` }
const mesesEntre = (a, b) => { const out = []; for (let m = a; m <= b; m = sumarMes(m, 1)) out.push(m); return out }
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

function Problemas({ email, name, isAdmin, perm, equipo }) {
  const puedeCargar = perm.editar
  const [edit, setEdit] = useState(null)            // { id, title, description } mientras se edita
  const [problems, setProblems] = useState([])
  const [conteos, setConteos] = useState([])        // { problem_id, mes, cantidad }
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [msg, setMsg] = useState(null)
  const [importando, setImportando] = useState(false)
  const [guardando, setGuardando] = useState(null)  // 'pid|mes' mientras guarda
  const [desdeEditor, setDesdeEditor] = useState(null) // primer mes visible en el editor

  const load = useCallback(async () => {
    let qy = supabase.from('problems').select('*').eq('equipo', equipo).order('created_at', { ascending: true })
    if (!perm.verTodo) qy = qy.eq('aprobado', true)
    const { data: p } = await qy
    setProblems(p || [])
    const ids = (p || []).map(x => x.id)
    if (!ids.length) { setConteos([]); return }
    const { data: c } = await supabase.from('problem_conteos').select('problem_id,mes,cantidad').in('problem_id', ids)
    setConteos(c || [])
  }, [equipo, perm.verTodo])
  useEffect(() => { load() }, [load])

  // ---- estadística mensual ----
  const mesActual = hoyISO().slice(0, 7)
  const diaHoy = +hoyISO().slice(8, 10)
  const conDatos = conteos.filter(c => c.cantidad > 0).map(c => c.mes).sort()
  const primero = conDatos.length && conDatos[0] < sumarMes(mesActual, -5) ? conDatos[0] : sumarMes(mesActual, -5)
  const meses = mesesEntre(primero, mesActual).slice(-12)
  const completos = meses.filter(m => m !== mesActual)
  const [mPrev, mUlt] = [completos[completos.length - 2], completos[completos.length - 1]]

  const porMesDe = pid => { const o = {}; conteos.filter(c => c.problem_id === pid).forEach(c => { o[c.mes] = c.cantidad }); return o }
  const stats = Object.fromEntries(problems.map(p => {
    const porMes = porMesDe(p.id)
    const total = Object.values(porMes).reduce((s, v) => s + (v || 0), 0)
    const prev = porMes[mPrev] || 0, ult = porMes[mUlt] || 0
    return [p.id, { porMes, total, prev, ult, act: porMes[mesActual] || 0, tend: tendencia(prev, ult) }]
  }))
  const totalCasos = problems.reduce((s, p) => s + stats[p.id].total, 0)
  const nMejora = problems.filter(p => stats[p.id].tend.flecha === '▼').length
  const nEmpeora = problems.filter(p => stats[p.id].tend.flecha === '▲').length

  // ---- acciones ----
  const aprobacion = () => perm.aprobar
    ? { aprobado: true, aprobado_por: name || email, aprobado_at: new Date().toISOString() }
    : { aprobado: false, aprobado_por: null, aprobado_at: null }
  const addProblem = async () => {
    if (!title.trim()) return
    const { error } = await supabase.from('problems').insert({ equipo, title: title.trim(), description: desc.trim(), created_by: email, ...aprobacion() })
    if (error) { setMsg({ t: 'err', m: 'Error: ' + error.message }); return }
    setTitle(''); setDesc(''); setMsg({ t: 'ok', m: perm.aprobar ? 'Problema creado y aprobado.' : 'Problema enviado a aprobación: los analistas lo verán cuando un verificador lo apruebe.' }); load()
  }
  const guardarEdicion = async () => {
    if (!edit.title.trim()) return
    const { error } = await supabase.from('problems').update({ title: edit.title.trim(), description: edit.description.trim(), ...aprobacion() }).eq('id', edit.id)
    if (error) { alert('Error: ' + error.message); return }
    setEdit(null); setMsg({ t: 'ok', m: perm.aprobar ? 'Problema actualizado y aprobado.' : 'Cambios enviados a aprobación.' }); load()
  }
  const aprobarProblema = async (p) => {
    const { error } = await supabase.from('problems').update({ aprobado: true, aprobado_por: name || email, aprobado_at: new Date().toISOString() }).eq('id', p.id)
    if (error) { alert('Error: ' + error.message); return }
    setMsg({ t: 'ok', m: `"${p.title}" aprobado: ya lo ven los analistas.` }); load()
  }
  const nPend = problems.filter(p => !p.aprobado).length
  const removeProblem = async (pid) => {
    if (!confirm('¿Eliminar el problema y todo su histórico?')) return
    await supabase.from('problem_conteos').delete().eq('problem_id', pid)
    await supabase.from('problems').delete().eq('id', pid); load()
  }
  const guardarEstado = async (p, txt) => {
    if ((p.estado || '') === txt.trim()) return
    const { error } = await supabase.from('problems').update({ estado: txt.trim() || null }).eq('id', p.id)
    if (error) alert('Error: ' + error.message); else load()
  }
  // guarda la cantidad de un mes (vacío = borra ese mes)
  const guardarCantidad = async (pid, mes, valor) => {
    const txt = String(valor).trim()
    const n = txt === '' ? null : Math.max(0, parseInt(txt, 10))
    const actual = porMesDe(pid)[mes]
    if ((n ?? null) === (actual ?? null) || (txt !== '' && isNaN(n))) return
    setGuardando(pid + '|' + mes)
    const { error } = n == null
      ? await supabase.from('problem_conteos').delete().eq('problem_id', pid).eq('mes', mes)
      : await supabase.from('problem_conteos').upsert({ problem_id: pid, mes, cantidad: n, updated_by: name || email, updated_at: new Date().toISOString() }, { onConflict: 'problem_id,mes' })
    setGuardando(null)
    if (error) { alert('No se pudo guardar: ' + error.message); return }
    setConteos(cs => {
      const resto = cs.filter(c => !(c.problem_id === pid && c.mes === mes))
      return n == null ? resto : [...resto, { problem_id: pid, mes, cantidad: n }]
    })
  }

  // importar un Excel como "DOCUM_Casos_Zendesk_por_tema": cada hoja con "ID ticket" + "Fecha" es un problema;
  // se cuentan los tickets por mes y se guardan como cantidades
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
        const ci = rows[h].findIndex(c => /id\s*ticket/i.test(String(c))), cf = rows[h].findIndex(c => /^fecha$/i.test(String(c).trim()))
        const vistos = new Set(), porMes = {}
        rows.slice(h + 1).forEach(r => {
          const t = String(r[ci] || '').replace(/[^\d]/g, ''), f = toISODate(r[cf])
          if (!t || !f || vistos.has(t)) return
          vistos.add(t); porMes[f.slice(0, 7)] = (porMes[f.slice(0, 7)] || 0) + 1
        })
        if (!vistos.size) continue
        const cab = String(rows[0]?.[0] || sn)
        const titulo = h > 0 ? cab.replace(/\s+—\s+[\d.,]+\s+casos.*$/i, '').trim() : sn
        const clave = (cab.match(/·\s*'([^']+)'\s*$/) || [])[1]
        temas.push({ titulo, descripcion: clave ? `Palabra clave en Zendesk: "${clave}"` : '', porMes, n: vistos.size })
      }
      if (!temas.length) { setMsg({ t: 'err', m: 'No encontré hojas con columnas "ID ticket" y "Fecha".' }); setImportando(false); return }
      if (!confirm(`Se encontraron ${temas.length} temas:\n\n${temas.map(t => `• ${t.titulo} (${t.n} casos)`).join('\n')}\n\n¿Cargarlos en ${equipo}? Si un problema ya existe con el mismo nombre se actualizan sus cantidades de esos meses.`)) { setImportando(false); return }
      let creados = 0, filas = 0
      for (const t of temas) {
        let p = problems.find(x => normTxt(x.title) === normTxt(t.titulo))
        if (!p) {
          const { data, error } = await supabase.from('problems').insert({ equipo, title: t.titulo, description: t.descripcion, created_by: email, ...aprobacion() }).select().single()
          if (error) throw error
          p = data; creados++
        }
        const up = Object.entries(t.porMes).map(([mes, cantidad]) => ({ problem_id: p.id, mes, cantidad, updated_by: name || email, updated_at: new Date().toISOString() }))
        const { error } = await supabase.from('problem_conteos').upsert(up, { onConflict: 'problem_id,mes' })
        if (error) throw error
        filas += up.length
      }
      setMsg({ t: 'ok', m: `Carga lista: ${creados} problemas nuevos, ${filas} meses actualizados.` })
      load()
    } catch (e) { setMsg({ t: 'err', m: 'No pude importar: ' + e.message }) }
    setImportando(false)
  }

  // ---- piezas visuales ----
  const Barras = ({ porMes }) => {
    const ult7 = meses.slice(-7), max = Math.max(1, ...ult7.map(m => porMes[m] || 0))
    return (
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 90, padding: '6px 0' }}>
        {ult7.map(m => {
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
  // meses que se pueden editar: los 6 más recientes, o desde el que elija el digitador
  const inicioEditor = desdeEditor || sumarMes(mesActual, -5)
  const mesesEditor = mesesEntre(inicioEditor, mesActual)

  return (
    <>
      {/* Resumen: variación mensual de cada problema */}
      <div className="card">
        <div className="cardh">
          <div><b>Problemas {equipo} — variación mensual</b>
            <div className="muted sm">{problems.length} problemas · {totalCasos} casos · compara los dos últimos meses completos{mPrev ? ` (${mesLbl(mPrev)} → ${mesLbl(mUlt)})` : ''}. ▼ baja ≥20 % · ▲ sube ≥20 % · = estable.</div></div>
          <div className="row">
            <span className="pill green">▼ Mejoran: {nMejora}</span>
            <span className="pill" style={{ background: '#ffe4e6', color: '#be123c' }}>▲ Empeoran: {nEmpeora}</span>
            {perm.verTodo && nPend > 0 && <span className="pill amber">⏳ Pendientes de aprobación: {nPend}</span>}
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
                <th>Total</th><th>Variación</th><th className="left">Tendencia</th>
              </tr></thead>
              <tbody>{problems.map(p => {
                const s = stats[p.id]
                return (
                  <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => document.getElementById('prob-' + p.id)?.scrollIntoView({ behavior: 'smooth' })}>
                    <td className="left an" style={{ whiteSpace: 'normal', minWidth: 180 }}>{p.title}{!p.aprobado && <span className="pill amber" style={{ marginLeft: 6, fontSize: 10 }}>⏳ pendiente</span>}</td>
                    {meses.map(m => <td key={m} className="tabular" style={{ color: m === mesActual ? 'var(--muted)' : undefined, fontWeight: (m === mPrev || m === mUlt) ? 600 : 400 }}>{s.porMes[m] ?? '·'}</td>)}
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

      {/* Crear problema: digitadores (queda pendiente), verificadores y admin (queda aprobado) */}
      {perm.editar && (
        <div className="card">
          <div className="cardh"><b>Registrar un problema en {equipo}</b><div className="muted sm">{perm.aprobar ? 'Queda aprobado y visible para los analistas.' : 'Queda pendiente hasta que un verificador lo apruebe.'}</div></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
            <input placeholder="Título (ej: PQRD – Reasignación de bandejas)" value={title} onChange={e => setTitle(e.target.value)} />
            <textarea rows={2} placeholder="Descripción del problema" value={desc} onChange={e => setDesc(e.target.value)} />
          </div>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={addProblem} disabled={!title.trim()}>{perm.aprobar ? 'Crear problema' : 'Enviar a aprobación'}</button>
        </div>
      )}

      {/* Tarjeta por problema */}
      {problems.map(p => {
        const s = stats[p.id]
        return (
          <div className="card" key={p.id} id={'prob-' + p.id}>
            <div className="cardh">
              {edit?.id === p.id
                ? <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 6 }}>
                    <input value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} />
                    <textarea rows={3} value={edit.description} onChange={e => setEdit({ ...edit, description: e.target.value })} />
                    <div className="row">
                      <button className="btn primary sm" onClick={guardarEdicion} disabled={!edit.title.trim()}>{perm.aprobar ? 'Guardar y aprobar' : 'Enviar a aprobación'}</button>
                      <button className="btn ghost sm" onClick={() => setEdit(null)}>Cancelar</button>
                    </div>
                  </div>
                : <div style={{ flex: 1, minWidth: 0 }}><b>⚠ {p.title}</b>{!p.aprobado && <span className="pill amber" style={{ marginLeft: 8 }}>⏳ Pendiente de aprobación</span>}
                    {p.description && <div className="muted sm">{p.description}</div>}
                    {p.aprobado && p.aprobado_por && <div className="muted xs">Aprobado por {p.aprobado_por}</div>}</div>}
              {edit?.id !== p.id && <div className="row" style={{ alignItems: 'center' }}>
                {perm.aprobar && !p.aprobado && <button className="btn primary sm" onClick={() => aprobarProblema(p)}>✓ Aprobar</button>}
                {perm.editar && <button className="btn ghost sm" onClick={() => setEdit({ id: p.id, title: p.title, description: p.description || '' })}>Editar</button>}
                {(perm.borrarAprobado || (perm.editar && !p.aprobado)) && <button className="btn ghost sm" style={{ color: 'var(--rose)' }} onClick={() => removeProblem(p.id)}>Eliminar</button>}
              </div>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16, alignItems: 'center' }}>
              <div>
                <div className="muted xs" style={{ textTransform: 'uppercase', letterSpacing: '.08em' }}>Casos totales</div>
                <div style={{ fontSize: 34, fontWeight: 800, color: 'var(--ink)', lineHeight: 1.1 }}>{s.total}</div>
                <div style={{ marginTop: 6, color: s.tend.color, fontWeight: 700 }}>{s.tend.flecha} {s.tend.txt} {fmtPct(s.tend.pct) && `(${fmtPct(s.tend.pct)})`}</div>
                {mPrev && <div className="muted sm">{mesLbl(mPrev)}: <b>{s.prev}</b> → {mesLbl(mUlt)}: <b>{s.ult}</b> · {mesLbl(mesActual)}*: {s.act}</div>}
              </div>
              <Barras porMes={s.porMes} />
            </div>

            {/* Carga de cantidades por mes: admin y digitadores */}
            {puedeCargar && (
              <div style={{ background: '#f8fafc', borderRadius: 9, padding: 12, marginTop: 10 }}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <b className="sm">Cantidad de casos por mes</b>
                  <button className="btn ghost sm" onClick={() => setDesdeEditor(sumarMes(inicioEditor, -6))}>← Meses anteriores</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${mesesEditor.length}, minmax(64px,1fr))`, gap: 6, overflowX: 'auto' }}>
                  {mesesEditor.map(m => (
                    <label key={m} className="f" style={{ textAlign: 'center' }}>{mesLbl(m)}{m === mesActual ? '*' : ''}
                      <input type="number" min="0" inputMode="numeric" key={p.id + m + (s.porMes[m] ?? '')} defaultValue={s.porMes[m] ?? ''} placeholder="—"
                        style={{ textAlign: 'center', padding: '6px 4px', borderColor: guardando === p.id + '|' + m ? 'var(--indigo)' : undefined }}
                        onBlur={e => guardarCantidad(p.id, m, e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && e.target.blur()} />
                    </label>
                  ))}
                </div>
                <div className="muted xs" style={{ marginTop: 6 }}>Escribe la cantidad y sal del campo (o Enter) para guardar. Déjalo vacío para quitar el dato de ese mes.</div>
              </div>
            )}

            <label className="f" style={{ marginTop: 10 }}>Lectura / estado {!puedeCargar && <span className="xs">(la actualizan digitadores y verificadores)</span>}
              {puedeCargar
                ? <input key={p.estado || ''} defaultValue={p.estado || ''} placeholder="Ej: Caída sostenida, posible corrección; validar con desarrollo." onBlur={e => guardarEstado(p, e.target.value)} />
                : <div style={{ color: 'var(--ink)', padding: '4px 0' }}>{p.estado || '—'}</div>}
            </label>
          </div>
        )
      })}
    </>
  )
}

/* ================= ANALISTAS / PERSONAS Y PROYECTOS (solo admin) ================= */
function Analistas() {
  const [analysts, setAnalysts] = useState([])
  const [form, setForm] = useState({ name: '', email: '', equipos: 'DOCUM', rol: 'analista', digitador: false, verificador: false, skill: '' })
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
    const { error } = await supabase.from('analysts').insert({ name: nm, email: em, equipos: eq, rol: form.rol, digitador: form.digitador, verificador: form.verificador, skill: form.skill.trim() })
    if (error) { setMsg({ t: 'err', m: error.message.includes('duplicate') ? 'Ese correo ya está registrado.' : 'Error: ' + error.message }); return }
    setForm({ name: '', email: '', equipos: 'DOCUM', rol: 'analista', digitador: false, verificador: false, skill: '' }); setMsg({ t: 'ok', m: 'Persona agregada.' }); load()
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

  // ---- filtros de búsqueda ----
  const [fq, setFq] = useState('')
  const [fEquipo, setFEquipo] = useState('')
  const [fRol, setFRol] = useState('')
  const sinTilde = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const esDig = a => !!a.digitador || a.rol === 'digitador'
  const tieneRol = (a, r) => r === 'admin' ? a.rol === 'admin'
    : r === 'analista' ? a.rol !== 'admin' && !esDig(a) && !a.verificador
    : r === 'digitador' ? esDig(a) : r === 'verificador' ? !!a.verificador : true
  const filtrados = analysts.filter(a =>
    (!fq || sinTilde(a.name + ' ' + a.email + ' ' + (a.skill || '')).includes(sinTilde(fq.trim()))) &&
    (!fEquipo || splitEq(a.equipos || 'DOCUM').includes(fEquipo)) &&
    (!fRol || tieneRol(a, fRol)))
  const cuenta = r => analysts.filter(a => tieneRol(a, r)).length
  const hayFiltro = fq || fEquipo || fRol

  return (
    <div className="card">
      <div className="cardh">
        <div><b>Personas y proyectos</b>
          <div className="muted sm"><b>Digitador</b>: registra problemas, cantidades y protocolos (quedan pendientes). <b>Verificador</b>: los revisa, edita y aprueba. Una persona puede tener ambos. Para entrar basta con que su correo esté aquí. Varios equipos se separan con coma (ej: DOCUM,Balu).</div></div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', marginBottom: 8 }}>
        <input placeholder="Nombre completo" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <input type="email" placeholder="correo@empresa.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
        <input placeholder="Equipos (ej: DOCUM,Balu)" value={form.equipos} onChange={e => setForm({ ...form, equipos: e.target.value })} />
        <input placeholder="Skill (ej: Atencion, Gestion)" value={form.skill} onChange={e => setForm({ ...form, skill: e.target.value })} />
        <select value={form.rol} onChange={e => setForm({ ...form, rol: e.target.value })}>
          <option value="analista">Analista</option><option value="admin">Administrador</option>
        </select>
        <label className="f" style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={form.digitador} onChange={e => setForm({ ...form, digitador: e.target.checked })} /> Digitador
        </label>
        <label className="f" style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={form.verificador} onChange={e => setForm({ ...form, verificador: e.target.checked })} /> Verificador
        </label>
        <button className="btn primary" onClick={add} disabled={!form.name.trim() || !form.email.trim()}>Agregar</button>
      </div>
      {msg && <div className={'notice ' + (msg.t === 'err' ? 'err' : 'ok')}>{msg.m}</div>}
      {equiposExistentes.length > 0 && <p className="muted sm" style={{ marginTop: 6 }}>Equipos actuales: {equiposExistentes.join(' · ')}</p>}
      {analysts.length > 0 && (
        <div style={{ borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 12 }}>
          <div className="row" style={{ alignItems: 'center' }}>
            <input style={{ flex: 2, minWidth: 200 }} placeholder="🔎 Buscar por nombre, correo o skill…" value={fq} onChange={e => setFq(e.target.value)} />
            <select style={{ flex: 1, minWidth: 140 }} value={fEquipo} onChange={e => setFEquipo(e.target.value)}>
              <option value="">Todos los equipos</option>{equiposExistentes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            {hayFiltro && <button className="btn ghost sm" onClick={() => { setFq(''); setFEquipo(''); setFRol('') }}>Limpiar filtros</button>}
          </div>
          <div className="row" style={{ marginTop: 8, gap: 6 }}>
            {[['', 'Todos', analysts.length], ['admin', 'Administradores', cuenta('admin')], ['analista', 'Solo analistas', cuenta('analista')], ['digitador', '✎ Digitadores', cuenta('digitador')], ['verificador', '✓ Verificadores', cuenta('verificador')]].map(([k, l, n]) => (
              <button key={k || 'todos'} className={'pill ' + (fRol === k ? 'green' : 'slate')} style={{ border: 'none', cursor: 'pointer' }} onClick={() => setFRol(k)}>{l}: {n}</button>
            ))}
          </div>
        </div>
      )}
      {analysts.length === 0
        ? <div className="empty">Aún no hay personas.</div>
        : filtrados.length === 0
        ? <div className="empty">Nadie coincide con los filtros.</div>
        : <div className="scroll" style={{ marginTop: 8 }}>
            <table><thead><tr><th>Nombre</th><th>Correo</th><th>Equipos</th><th>Skill</th><th>Rol</th><th>Digitador</th><th>Verificador</th><th></th></tr></thead>
              <tbody>{filtrados.map(a => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600, color: 'var(--ink)' }}>{a.name}</td>
                  <td className="muted">{a.email}</td>
                  <td><input defaultValue={a.equipos || 'DOCUM'} style={{ padding: '4px 8px', width: 150 }}
                    onBlur={e => { const v = e.target.value.split(',').map(x => x.trim()).filter(Boolean).join(','); if (v !== (a.equipos || '')) save(a, { equipos: v || 'DOCUM' }) }} /></td>
                  <td><input defaultValue={a.skill || ''} placeholder="—" style={{ padding: '4px 8px', width: 130 }}
                    onBlur={e => { if (e.target.value.trim() !== (a.skill || '')) save(a, { skill: e.target.value.trim() }) }} /></td>
                  <td><select defaultValue={a.rol === 'admin' ? 'admin' : 'analista'} style={{ padding: '4px 8px' }} onChange={e => save(a, { rol: e.target.value })}>
                    <option value="analista">Analista</option><option value="admin">Administrador</option></select></td>
                  <td style={{ textAlign: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={!!a.digitador || a.rol === 'digitador'}
                    onChange={e => save(a, { digitador: e.target.checked, ...(a.rol === 'digitador' ? { rol: 'analista' } : {}) })} /></td>
                  <td style={{ textAlign: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={!!a.verificador}
                    onChange={e => save(a, { verificador: e.target.checked })} /></td>
                  <td style={{ textAlign: 'right' }}><button className="btn ghost sm" style={{ color: 'var(--rose)' }} onClick={() => remove(a)}>Quitar</button></td>
                </tr>
              ))}</tbody></table>
          </div>}
      <p className="muted sm" style={{ marginTop: 10 }}>{hayFiltro ? `Mostrando ${filtrados.length} de ${analysts.length}.` : `Total: ${analysts.length}.`} Edita "Equipos" (sale del campo para guardar), "Rol", "Digitador" o "Verificador" directamente en la tabla.</p>
    </div>
  )
}
