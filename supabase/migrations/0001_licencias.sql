-- Licencias por dispositivo, solicitudes de acceso y administradores.
-- Todas las tablas tienen RLS activado y SIN políticas: desde el navegador no se
-- pueden leer ni escribir. Solo las funciones del servidor (con la clave de servicio)
-- acceden a ellas.

create table public.licencias (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  email         text not null,
  nombre        text,
  telefono      text,
  activa        boolean not null default true,
  caduca        date,                         -- null = sin caducidad
  device_id     text,                         -- null = todavía no vinculada a ningún dispositivo
  device_info   text,
  vinculada_en  timestamptz,
  ultimo_acceso timestamptz,
  creada_en     timestamptz not null default now()
);

create table public.solicitudes (
  id         bigint generated always as identity primary key,
  nombre     text,
  email      text not null,
  telefono   text not null,
  mensaje    text,
  estado     text not null default 'pendiente'
             check (estado in ('pendiente', 'aprobada', 'rechazada')),
  ip         text,
  creada_en  timestamptz not null default now()
);
create index solicitudes_estado_idx on public.solicitudes (estado, creada_en desc);
create index solicitudes_email_idx  on public.solicitudes (lower(email), creada_en desc);

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

alter table public.licencias   enable row level security;
alter table public.solicitudes enable row level security;
alter table public.admins      enable row level security;

revoke all on public.licencias, public.solicitudes, public.admins from anon, authenticated;

-- Almacén privado para el archivo de ubicaciones (solo lo sirve la función «datos»)
insert into storage.buckets (id, name, public)
values ('datos', 'datos', false)
on conflict (id) do nothing;
