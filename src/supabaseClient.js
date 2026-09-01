import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
// Dominios empresariales permitidos (separados por coma en la variable VITE_DOMINIOS)
export const DOMINIOS = (import.meta.env.VITE_DOMINIOS || import.meta.env.VITE_DOMINIO || '3tcapital.co')
  .split(',').map(d => d.trim().toLowerCase()).filter(Boolean)
// compat: primer dominio como principal (para textos)
export const DOMINIO = DOMINIOS[0]
