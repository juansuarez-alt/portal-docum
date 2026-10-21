// Cálculo de capacidad por frente (sin dependencias, se puede probar aparte).
//
//  Días hábiles   = días del rango sin domingos, festivos (ni sábados, salvo que se indique)
//  Tickets/día    = tickets del rango ÷ días hábiles
//  Cap. analista  = meta diaria × (1 − ausentismo)
//  Requeridos     = ⌈ tickets/día ÷ (cap. analista × ocupación máxima) ⌉, nunca menos que el mínimo
//  Holgura        = actuales − requeridos   (+ sobra · − falta)
//  Ocupación      = tickets/día ÷ (actuales × cap. analista)
//
// La ocupación máxima depende del OLA: con OLA corto (15 min, 1 h) no se puede dejar cola
// para el día siguiente, así que se trabaja con margen (p. ej. 85 %); con OLA de 12 h, al 100 %.

const DIA = 864e5
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
export const isoUTC = d => d.toISOString().slice(0, 10)

export function diasHabiles(desde, hasta, festivos, sabados) {
  if (!desde || !hasta || hasta < desde) return 0
  let n = 0
  for (let t = parse(desde).getTime(), fin = parse(hasta).getTime(); t <= fin; t += DIA) {
    const d = new Date(t), w = d.getUTCDay()
    if (w === 0 || (w === 6 && !sabados) || festivos.has(isoUTC(d))) continue
    n++
  }
  return n
}

// Tickets de un frente dentro del rango. Si una carga cubre más días que el rango,
// se toma la parte proporcional según días hábiles.
export function ticketsEnRango(cargas, desde, hasta, festivos, sabados) {
  let total = 0
  for (const c of cargas) {
    const ini = c.desde > desde ? c.desde : desde
    const fin = c.hasta < hasta ? c.hasta : hasta
    if (fin < ini) continue
    const hc = diasHabiles(c.desde, c.hasta, festivos, sabados)
    if (hc === 0) { if (c.desde >= desde && c.hasta <= hasta) total += Number(c.tickets); continue }
    total += Number(c.tickets) * diasHabiles(ini, fin, festivos, sabados) / hc
  }
  return total
}

export function calcularCapacidad(frentes, cargas, desde, hasta, festivosArr, sabados) {
  const festivos = new Set(festivosArr)
  const dias = diasHabiles(desde, hasta, festivos, sabados)
  const filas = frentes.filter(f => f.activo !== false).map(f => {
    const tickets = ticketsEnRango(cargas.filter(c => c.frente_id === f.id), desde, hasta, festivos, sabados)
    const demanda = dias ? tickets / dias : 0
    const capAnalista = Number(f.meta_diaria) * (1 - Number(f.ausentismo || 0))
    const capEfectiva = capAnalista * Number(f.ocupacion_max || 1)
    const reqExacto = capEfectiva > 0 ? demanda / capEfectiva : 0
    const requeridos = Math.max(Number(f.min_analistas || 0), Math.ceil(reqExacto - 1e-9))
    const actuales = Number(f.analistas_actuales || 0)
    const holgura = actuales - requeridos
    const ocupacion = actuales > 0 && capAnalista > 0 ? demanda / (actuales * capAnalista) : (demanda > 0 ? Infinity : 0)
    return {
      id: f.id, frente: f.nombre, ola_minutos: Number(f.ola_minutos), meta: Number(f.meta_diaria),
      tickets, demanda, capAnalista, reqExacto, requeridos, actuales, holgura, ocupacion,
      estado: holgura > 0 ? 'sobra' : holgura === 0 ? 'justo' : 'falta',
    }
  })
  const total = filas.reduce((a, r) => ({
    tickets: a.tickets + r.tickets, demanda: a.demanda + r.demanda,
    requeridos: a.requeridos + r.requeridos, actuales: a.actuales + r.actuales,
    capacidad: a.capacidad + r.actuales * r.capAnalista,
  }), { tickets: 0, demanda: 0, requeridos: 0, actuales: 0, capacidad: 0 })
  total.holgura = total.actuales - total.requeridos
  total.ocupacion = total.capacidad ? total.demanda / total.capacidad : 0
  return { dias, filas, total, movimientos: redistribuir(filas) }
}

// Sugiere mover personas de frentes con sobrante a los que les falta (mayor necesidad primero).
export function redistribuir(filas) {
  const dan = filas.filter(r => r.holgura > 0).map(r => ({ f: r.frente, n: r.holgura })).sort((a, b) => b.n - a.n)
  const reciben = filas.filter(r => r.holgura < 0).map(r => ({ f: r.frente, n: -r.holgura })).sort((a, b) => b.n - a.n)
  const movs = []
  for (const r of reciben) {
    for (const d of dan) {
      if (!r.n) break
      if (!d.n) continue
      const n = Math.min(d.n, r.n)
      movs.push({ de: d.f, a: r.f, n })
      d.n -= n; r.n -= n
    }
  }
  return { movs, sinCubrir: reciben.filter(r => r.n > 0), libres: dan.filter(d => d.n > 0) }
}
