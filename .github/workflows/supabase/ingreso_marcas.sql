-- ============================================================
--  INGRESO DIARIO MULTIMARCA
--  Ejecutar en Supabase → SQL Editor → New query → Run.
--  No toca docum_ingreso_diario: el detalle DOCUM sigue igual.
-- ============================================================
create table if not exists ingreso_diario (
  marca        text    not null,            -- 'DOCUM', 'BALU', ... (clave de scripts/marcas.json)
  dia          date    not null,            -- día de creación, hora Colombia
  dow          text,
  total        integer not null default 0,
  frentes      jsonb   not null default '{}'::jsonb,  -- {"Atención": 120, "N2": 30, "Sin grupo": 400, ...}
  ia_universo  integer not null default 0,  -- conversaciones atendidas por el agente IA
  ia_resueltos integer not null default 0,  -- resueltas por la IA (Tipo de resolución = Automatizado)
  esc_n2       integer not null default 0,
  esc_n3       integer not null default 0,
  horas        jsonb   not null default '[]'::jsonb,  -- 24 posiciones, tickets por hora
  actualizado  timestamptz not null default now(),
  primary key (marca, dia)
);
create index if not exists ingreso_diario_dia_idx on ingreso_diario (dia);

alter table ingreso_diario enable row level security;

-- Lectura: cualquiera del dominio (igual que la malla). Escritura: solo el sync (service role).
drop policy if exists ingreso_diario_read on ingreso_diario;
create policy ingreso_diario_read on ingreso_diario for select using ( is_domain() );
