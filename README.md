# Portal DOCUM — App web (React + Supabase + Google Workspace)

Portal con inicio de sesión por correo empresarial de Google, control de administrador,
registro de llegadas contra la malla, y malla horaria mensual.

Necesitas cuentas gratuitas en 3 servicios: **Supabase** (base de datos + login),
**Google Cloud** (credenciales para "login con Google") y **Vercel** (donde vive la app).

---

## PASO 1 — Base de datos (Supabase)

1. Entra a https://supabase.com → crea un proyecto (región cercana, ej. East US).
2. Guarda la contraseña de la base que te pida.
3. Menú lateral → **SQL Editor** → **New query** → pega TODO el contenido de
   `supabase/schema.sql` → **Run**. Crea las tablas, la seguridad por rol y carga Agosto 2026.
4. Menú lateral → **Project Settings → API**. Copia:
   - **Project URL**  → será `VITE_SUPABASE_URL`
   - **anon public key** → será `VITE_SUPABASE_ANON_KEY`

> Los datos los puedes ver y editar en **Table Editor** (tablas: admins, analysts, malla, arrivals).

---

## PASO 2 — Activar el login por correo (SIN Google Cloud)

El acceso es por "enlace mágico": el usuario escribe su correo @3tcapital.co, Supabase le
envía un enlace a su bandeja, hace clic y entra. No necesitas Google Cloud ni permisos de admin.

1. En Supabase → **Authentication → Providers → Email**: asegúrate de que **Email** esté
   habilitado (viene activado por defecto). No necesitas nada más ahí.
2. En Supabase → **Authentication → URL Configuration → Site URL**: al principio pon
   `http://localhost:5173` (para probar); luego lo cambias por la URL de Vercel.
3. (Opcional pero recomendado) En **Authentication → URL Configuration → Redirect URLs**
   agrega también `http://localhost:5173` y, más adelante, tu URL de Vercel.

> Nota: el correo de acceso lo envía Supabase. En el plan gratuito hay un límite de unos
> pocos envíos por hora, suficiente para el equipo. Si algún día lo necesitas masivo, se
> puede conectar un SMTP propio, pero para 7 personas no hace falta.

---

## PASO 3 — Probar en tu computador

1. Instala Node.js 18+ (https://nodejs.org).
2. Copia `.env.example` como `.env` y pega tus valores:
   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   VITE_DOMINIO=3tcapital.co
   ```
3. En la terminal, dentro de la carpeta:
   ```
   npm install
   npm run dev
   ```
4. Abre http://localhost:5173, escribe tu correo @3tcapital.co, dale "Enviar enlace de
   acceso", abre el correo que te llega y haz clic en el enlace.
   Tu correo (juan.suarez@3tcapital.co) ya es administrador (viene en el schema).

---

## PASO 4 — Publicar (Vercel)

1. Sube esta carpeta a un repositorio de GitHub.
2. En https://vercel.com → **Add New → Project** → importa el repo.
3. Framework: **Vite** (lo detecta solo). En **Environment Variables** agrega las 3
   (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_DOMINIO`).
4. **Deploy**. Copia la URL final (ej. `https://portal-docum.vercel.app`).
5. Pega esa URL en Supabase → **Authentication → URL Configuration → Site URL**, y
   agrégala también en **Redirect URLs**. Listo.

---

## IMPORTANTE — correos de los analistas

En el schema dejé correos de EJEMPLO para los 4 analistas
(`angel.gomez@3tcapital.co`, etc.). **Cámbialos por los correos reales** de Google de cada
analista, porque el login y la malla se cruzan por ese correo. Edítalos en Supabase →
**Table Editor → analysts** (y en **malla** si ya cargaste agosto), o dime los correos reales
y te dejo el SQL corregido.

## Qué hace hoy (tus 4 principios)
1. Login solo con correo @3tcapital.co (enlace mágico al buzón; bloquea cualquier otro correo).
2. Admin (solo tú): ve todo, genera la malla de meses, ve las llegadas de todos.
3. Analista: ve la malla (solo lectura) y marca **su** llegada en la base.
4. Malla horaria mensual visible; la llegada se compara contra el ingreso del turno de ese día
   (gabela de 10 min) y queda guardada en Supabase.

## Siguiente (si lo quieres)
Sobre esta misma base se pueden re-agregar las pestañas de Problemas DOCUM y Productividad.
