-- Conversación por Telegram con quien solicita acceso y mensaje de pago configurable.

-- Enlace entre la solicitud y el Telegram del solicitante
alter table public.solicitudes
  add column tg_token   text unique,   -- código del enlace «Recibir respuesta por Telegram»
  add column tg_chat_id bigint;        -- chat del solicitante, cuando pulsa el enlace

-- Ajustes editables desde el panel (por ejemplo, el mensaje de pago)
create table public.ajustes (
  clave text primary key,
  valor text not null default '',
  actualizado_en timestamptz not null default now()
);

-- Qué mensaje del chat del administrador corresponde a qué solicitud,
-- para que al «Responder» en Telegram la respuesta llegue al solicitante.
create table public.tg_relay (
  admin_msg_id bigint primary key,
  solicitud_id bigint not null references public.solicitudes (id) on delete cascade,
  creada_en    timestamptz not null default now()
);
create index tg_relay_solicitud_idx on public.tg_relay (solicitud_id);

alter table public.ajustes  enable row level security;
alter table public.tg_relay enable row level security;
revoke all on public.ajustes, public.tg_relay from anon, authenticated;

insert into public.ajustes (clave, valor) values ('mensaje_pago', '') on conflict do nothing;
