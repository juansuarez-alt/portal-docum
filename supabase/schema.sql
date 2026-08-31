-- ============================================================
--  PORTAL DOCUM — Esquema de base de datos (Supabase / Postgres)
--  Ejecuta TODO este archivo en Supabase → SQL Editor → New query.
-- ============================================================

-- ---------- Configuracion editable ----------
-- Dominio empresarial permitido para iniciar sesion:
--   (se usa dentro de las policies mas abajo)
-- Cambialo si algun dia cambia el dominio.
-- '%@3tcapital.co'

-- ---------- Tablas ----------
create table if not exists admins (
  email text primary key
);

create table if not exists analysts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null
);

create table if not exists malla (
  id uuid primary key default gen_random_uuid(),
  month text not null,               -- 'YYYY-MM'
  work_date date not null,           -- fecha real
  analyst_email text not null,
  analyst_name text not null,
  turno_id text not null,            -- t_a / t_b / t_c / t_sab
  ingreso text not null,             -- 'HH:MM'
  salida text,
  almuerzo text,
  ht numeric,
  unique (work_date, analyst_email)
);
create index if not exists malla_month_idx on malla(month);

create table if not exists arrivals (
  id uuid primary key default gen_random_uuid(),
  work_date date not null default (now() at time zone 'America/Bogota')::date,
  email text not null,
  name text,
  llego text not null,               -- 'HH:MM'
  esperado text,
  estado text not null,              -- 'a tiempo' | 'tarde'
  motivo text,
  created_at timestamptz default now(),
  unique (email, work_date)
);

-- ---------- Funciones de ayuda ----------
create or replace function auth_email() returns text
  language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email','')) $$;

create or replace function is_domain() returns boolean
  language sql stable as $$ select auth_email() like '%@3tcapital.co' $$;

create or replace function is_admin() returns boolean
  language sql stable as $$ select exists (select 1 from admins where lower(email) = auth_email()) $$;

-- ---------- Activar Row Level Security ----------
alter table admins   enable row level security;
alter table analysts enable row level security;
alter table malla    enable row level security;
alter table arrivals enable row level security;

-- ADMINS: cualquiera del dominio puede leer (para saber si es admin); solo admin escribe
drop policy if exists admins_read on admins;
create policy admins_read on admins for select using ( is_domain() );
drop policy if exists admins_write on admins;
create policy admins_write on admins for all using ( is_admin() ) with check ( is_admin() );

-- ANALISTAS: lee cualquiera del dominio; escribe solo admin
drop policy if exists analysts_read on analysts;
create policy analysts_read on analysts for select using ( is_domain() );
drop policy if exists analysts_write on analysts;
create policy analysts_write on analysts for all using ( is_admin() ) with check ( is_admin() );

-- MALLA: lee cualquiera del dominio; escribe solo admin
drop policy if exists malla_read on malla;
create policy malla_read on malla for select using ( is_domain() );
drop policy if exists malla_write on malla;
create policy malla_write on malla for all using ( is_admin() ) with check ( is_admin() );

-- LLEGADAS: el admin ve todas; el analista solo las suyas.
drop policy if exists arrivals_read on arrivals;
create policy arrivals_read on arrivals for select
  using ( is_admin() or email = auth_email() );
-- Insertar: solo puedes registrar TU propia llegada (o admin por cualquiera)
drop policy if exists arrivals_insert on arrivals;
create policy arrivals_insert on arrivals for insert
  with check ( is_domain() and (is_admin() or email = auth_email()) );

-- ---------- Datos iniciales ----------
insert into admins (email) values ('juan.suarez@3tcapital.co')
  on conflict (email) do nothing;

insert into analysts (name, email) values
  ('Angel Esteban Gomez Quinche', 'angel.gomez@3tcapital.co'),
  ('Daniel Santiago Munar Bohorquez', 'daniel.munar@3tcapital.co'),
  ('Sofia Estrella Beltran', 'sofia.estrella@3tcapital.co'),
  ('Leider Adrián Riaño Tovar', 'leider.riano@3tcapital.co'),
  ('Juan Rincon', 'juan.rincon@3tcapital.co'),
  ('Michael Barragan', 'Michael.barragan@3tcapital.co')
  on conflict (email) do nothing;

insert into malla (month, work_date, analyst_email, analyst_name, turno_id, ingreso, salida, almuerzo, ht) values
('2026-08','2026-08-03','angel.gomez@3tcapital.co','Angel Esteban Gomez Quinche','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-04','angel.gomez@3tcapital.co','Angel Esteban Gomez Quinche','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-05','angel.gomez@3tcapital.co','Angel Esteban Gomez Quinche','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-06','angel.gomez@3tcapital.co','Angel Esteban Gomez Quinche','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-10','angel.gomez@3tcapital.co','Angel Esteban Gomez Quinche','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-11','angel.gomez@3tcapital.co','Angel Esteban Gomez Quinche','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-12','angel.gomez@3tcapital.co','Angel Esteban Gomez Quinche','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-13','angel.gomez@3tcapital.co','Angel Esteban Gomez Quinche','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-14','angel.gomez@3tcapital.co','Angel Esteban Gomez Quinche','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-18','angel.gomez@3tcapital.co','Angel Esteban Gomez Quinche','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-19','angel.gomez@3tcapital.co','Angel Esteban Gomez Quinche','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-20','angel.gomez@3tcapital.co','Angel Esteban Gomez Quinche','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-21','angel.gomez@3tcapital.co','Angel Esteban Gomez Quinche','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-24','angel.gomez@3tcapital.co','Angel Esteban Gomez Quinche','t_c','07:00','15:00','12:00',7),
('2026-08','2026-08-25','angel.gomez@3tcapital.co','Angel Esteban Gomez Quinche','t_c','07:00','15:00','12:00',7),
('2026-08','2026-08-26','angel.gomez@3tcapital.co','Angel Esteban Gomez Quinche','t_c','07:00','15:00','12:00',7),
('2026-08','2026-08-27','angel.gomez@3tcapital.co','Angel Esteban Gomez Quinche','t_c','07:00','15:00','12:00',7),
('2026-08','2026-08-28','angel.gomez@3tcapital.co','Angel Esteban Gomez Quinche','t_c','07:00','15:00','12:00',7),
('2026-08','2026-08-29','angel.gomez@3tcapital.co','Angel Esteban Gomez Quinche','t_sab','07:00','14:00','—',7),
('2026-08','2026-08-31','angel.gomez@3tcapital.co','Angel Esteban Gomez Quinche','t_b','08:00','17:30','13:00',8.5),
('2026-08','2026-08-03','daniel.munar@3tcapital.co','Daniel Santiago Munar Bohorquez','t_c','07:00','15:00','12:00',7),
('2026-08','2026-08-04','daniel.munar@3tcapital.co','Daniel Santiago Munar Bohorquez','t_c','07:00','15:00','12:00',7),
('2026-08','2026-08-05','daniel.munar@3tcapital.co','Daniel Santiago Munar Bohorquez','t_c','07:00','15:00','12:00',7),
('2026-08','2026-08-06','daniel.munar@3tcapital.co','Daniel Santiago Munar Bohorquez','t_c','07:00','15:00','12:00',7),
('2026-08','2026-08-08','daniel.munar@3tcapital.co','Daniel Santiago Munar Bohorquez','t_sab','07:00','14:00','—',7),
('2026-08','2026-08-10','daniel.munar@3tcapital.co','Daniel Santiago Munar Bohorquez','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-11','daniel.munar@3tcapital.co','Daniel Santiago Munar Bohorquez','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-12','daniel.munar@3tcapital.co','Daniel Santiago Munar Bohorquez','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-13','daniel.munar@3tcapital.co','Daniel Santiago Munar Bohorquez','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-14','daniel.munar@3tcapital.co','Daniel Santiago Munar Bohorquez','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-18','daniel.munar@3tcapital.co','Daniel Santiago Munar Bohorquez','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-19','daniel.munar@3tcapital.co','Daniel Santiago Munar Bohorquez','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-20','daniel.munar@3tcapital.co','Daniel Santiago Munar Bohorquez','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-21','daniel.munar@3tcapital.co','Daniel Santiago Munar Bohorquez','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-24','daniel.munar@3tcapital.co','Daniel Santiago Munar Bohorquez','t_b','08:00','17:30','13:00',8.5),
('2026-08','2026-08-25','daniel.munar@3tcapital.co','Daniel Santiago Munar Bohorquez','t_b','08:00','17:30','13:00',8.5),
('2026-08','2026-08-26','daniel.munar@3tcapital.co','Daniel Santiago Munar Bohorquez','t_b','08:00','17:30','13:00',8.5),
('2026-08','2026-08-27','daniel.munar@3tcapital.co','Daniel Santiago Munar Bohorquez','t_b','08:00','17:30','13:00',8.5),
('2026-08','2026-08-28','daniel.munar@3tcapital.co','Daniel Santiago Munar Bohorquez','t_b','08:00','17:30','13:00',8.5),
('2026-08','2026-08-31','daniel.munar@3tcapital.co','Daniel Santiago Munar Bohorquez','t_c','07:00','15:00','12:00',7),
('2026-08','2026-08-03','sofia.estrella@3tcapital.co','Sofia Estrella Beltran','t_b','08:00','17:30','13:00',8.5),
('2026-08','2026-08-04','sofia.estrella@3tcapital.co','Sofia Estrella Beltran','t_b','08:00','17:30','13:00',8.5),
('2026-08','2026-08-05','sofia.estrella@3tcapital.co','Sofia Estrella Beltran','t_b','08:00','17:30','13:00',8.5),
('2026-08','2026-08-06','sofia.estrella@3tcapital.co','Sofia Estrella Beltran','t_b','08:00','17:30','13:00',8.5),
('2026-08','2026-08-10','sofia.estrella@3tcapital.co','Sofia Estrella Beltran','t_c','07:00','15:00','12:00',7),
('2026-08','2026-08-11','sofia.estrella@3tcapital.co','Sofia Estrella Beltran','t_c','07:00','15:00','12:00',7),
('2026-08','2026-08-12','sofia.estrella@3tcapital.co','Sofia Estrella Beltran','t_c','07:00','15:00','12:00',7),
('2026-08','2026-08-13','sofia.estrella@3tcapital.co','Sofia Estrella Beltran','t_c','07:00','15:00','12:00',7),
('2026-08','2026-08-14','sofia.estrella@3tcapital.co','Sofia Estrella Beltran','t_c','07:00','15:00','12:00',7),
('2026-08','2026-08-15','sofia.estrella@3tcapital.co','Sofia Estrella Beltran','t_sab','07:00','14:00','—',7),
('2026-08','2026-08-18','sofia.estrella@3tcapital.co','Sofia Estrella Beltran','t_b','08:00','17:30','13:00',8.5),
('2026-08','2026-08-19','sofia.estrella@3tcapital.co','Sofia Estrella Beltran','t_b','08:00','17:30','13:00',8.5),
('2026-08','2026-08-20','sofia.estrella@3tcapital.co','Sofia Estrella Beltran','t_b','08:00','17:30','13:00',8.5),
('2026-08','2026-08-21','sofia.estrella@3tcapital.co','Sofia Estrella Beltran','t_b','08:00','17:30','13:00',8.5),
('2026-08','2026-08-24','sofia.estrella@3tcapital.co','Sofia Estrella Beltran','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-25','sofia.estrella@3tcapital.co','Sofia Estrella Beltran','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-26','sofia.estrella@3tcapital.co','Sofia Estrella Beltran','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-27','sofia.estrella@3tcapital.co','Sofia Estrella Beltran','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-28','sofia.estrella@3tcapital.co','Sofia Estrella Beltran','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-31','sofia.estrella@3tcapital.co','Sofia Estrella Beltran','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-03','leider.riano@3tcapital.co','Leider Adrián Riaño Tovar','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-04','leider.riano@3tcapital.co','Leider Adrián Riaño Tovar','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-05','leider.riano@3tcapital.co','Leider Adrián Riaño Tovar','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-06','leider.riano@3tcapital.co','Leider Adrián Riaño Tovar','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-10','leider.riano@3tcapital.co','Leider Adrián Riaño Tovar','t_b','08:00','17:30','13:00',8.5),
('2026-08','2026-08-11','leider.riano@3tcapital.co','Leider Adrián Riaño Tovar','t_b','08:00','17:30','13:00',8.5),
('2026-08','2026-08-12','leider.riano@3tcapital.co','Leider Adrián Riaño Tovar','t_b','08:00','17:30','13:00',8.5),
('2026-08','2026-08-13','leider.riano@3tcapital.co','Leider Adrián Riaño Tovar','t_b','08:00','17:30','13:00',8.5),
('2026-08','2026-08-14','leider.riano@3tcapital.co','Leider Adrián Riaño Tovar','t_b','08:00','17:30','13:00',8.5),
('2026-08','2026-08-18','leider.riano@3tcapital.co','Leider Adrián Riaño Tovar','t_c','07:00','15:00','12:00',7),
('2026-08','2026-08-19','leider.riano@3tcapital.co','Leider Adrián Riaño Tovar','t_c','07:00','15:00','12:00',7),
('2026-08','2026-08-20','leider.riano@3tcapital.co','Leider Adrián Riaño Tovar','t_c','07:00','15:00','12:00',7),
('2026-08','2026-08-21','leider.riano@3tcapital.co','Leider Adrián Riaño Tovar','t_c','07:00','15:00','12:00',7),
('2026-08','2026-08-22','leider.riano@3tcapital.co','Leider Adrián Riaño Tovar','t_sab','07:00','14:00','—',7),
('2026-08','2026-08-24','leider.riano@3tcapital.co','Leider Adrián Riaño Tovar','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-25','leider.riano@3tcapital.co','Leider Adrián Riaño Tovar','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-26','leider.riano@3tcapital.co','Leider Adrián Riaño Tovar','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-27','leider.riano@3tcapital.co','Leider Adrián Riaño Tovar','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-28','leider.riano@3tcapital.co','Leider Adrián Riaño Tovar','t_a','07:00','16:30','12:00',8.5),
('2026-08','2026-08-31','leider.riano@3tcapital.co','Leider Adrián Riaño Tovar','t_a','07:00','16:30','12:00',8.5);
