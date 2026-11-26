import { createClient } from "jsr:@supabase/supabase-js@2";

// Orígenes desde los que se puede llamar a las funciones. Por defecto cualquiera;
// para limitarlo, crea el secreto ORIGENES_PERMITIDOS con la dirección de la app
// (por ejemplo «https://geocarede.github.io»), separando varias con comas.
const ORIGENES = (Deno.env.get("ORIGENES_PERMITIDOS") ?? "*").split(",").map((s) => s.trim());

export function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allow = ORIGENES.includes("*") ? "*" : (ORIGENES.includes(origin) ? origin : ORIGENES[0]);
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-id",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Cliente con la clave de servicio: salta RLS. Solo se usa dentro de las funciones.
export const servicio = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

// Devuelve el usuario que hace la llamada (a partir de su token) o null.
export async function usuarioDe(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await servicio.auth.getUser(token);
  return error ? null : data.user;
}

// Clave aleatoria sin caracteres que se confundan (0/O, 1/l/I).
export function nuevaClave(longitud = 10): string {
  const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const limite = 256 - (256 % abc.length); // descarta bytes que sesgarían el reparto
  let clave = "";
  while (clave.length < longitud) {
    for (const b of crypto.getRandomValues(new Uint8Array(longitud * 2))) {
      if (b < limite && clave.length < longitud) clave += abc[b % abc.length];
    }
  }
  return clave;
}

export const hoy = () => new Date().toISOString().slice(0, 10);

// Crea el usuario (email + clave nueva) y su licencia. Lo usan el panel y el bot de Telegram.
export async function altaUsuario(email: string, nombre: string | null, telefono: string | null, caduca: string | null) {
  const clave = nuevaClave();
  const { data, error } = await servicio.auth.admin.createUser({
    email, password: clave, email_confirm: true, user_metadata: { nombre, telefono },
  });
  if (error) {
    const yaExiste = /already|registered|exists/i.test(error.message);
    return { error: yaExiste ? "ya_existe" : error.message };
  }
  const { error: e2 } = await servicio.from("licencias").insert({
    user_id: data.user.id, email, nombre, telefono, caduca,
  });
  if (e2) {
    await servicio.auth.admin.deleteUser(data.user.id);
    return { error: e2.message };
  }
  return { user_id: data.user.id, email, clave };
}

// ---------- Telegram ----------
// Limpia errores típicos al copiar el token: espacios, saltos de línea o la palabra «bot» delante
export const tgToken = () => (Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "").replace(/\s+/g, "").replace(/^bot(?=\d)/i, "");
export const tgChat = () => (Deno.env.get("TELEGRAM_CHAT_ID") ?? "").replace(/\s+/g, "");
export const APP_URL = Deno.env.get("APP_URL") ?? "https://geocarede.github.io/";

export async function telegram(metodo: string, datos: Record<string, unknown>) {
  const token = tgToken();
  if (!token) return null;
  const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(datos),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    // Solo la forma del token, nunca su valor, para poder diagnosticar
    const forma = { longitud: token.length, dosPuntos: token.includes(":"), empiezaPorNumero: /^\d+:/.test(token) };
    console.error("Telegram", metodo, r.status, JSON.stringify(j), JSON.stringify(forma));
  }
  return j;
}

// Secreto que Telegram envía en cada llamada al webhook. Se deriva del token del bot,
// así no hace falta guardar otro secreto y nadie que no conozca el token puede imitarlo.
export async function secretoWebhook(): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("geo-car-ede:" + tgToken()));
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 48);
}

// Texto listo para reenviar al usuario con su acceso
export function mensajeAcceso(email: string, clave: string): string {
  return `Tu acceso a CCTT Granada:\nEmail: ${email}\nClave: ${clave}\n\nAbre ${APP_URL} e inicia sesión. La clave queda vinculada al primer dispositivo en el que entres.`;
}

// Nombre de usuario del bot (para el enlace «Recibir respuesta por Telegram»).
// Se pide una vez a Telegram y se guarda mientras la función esté activa.
let _botUser: string | null = null;
export async function botUsuario(): Promise<string | null> {
  if (_botUser) return _botUser;
  const j = await telegram("getMe", {}).catch(() => null);
  _botUser = j?.result?.username ?? null;
  return _botUser;
}

// Código aleatorio para enlazar una solicitud con el Telegram de quien la hace
export function tokenCorto(longitud = 24): string {
  const abc = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(longitud)), (b) => abc[b % abc.length]).join("");
}

// Mensaje de pago escrito por el administrador en el panel. {nombre} se sustituye.
export async function mensajePago(nombre: string | null): Promise<string> {
  const { data } = await servicio.from("ajustes").select("valor").eq("clave", "mensaje_pago").maybeSingle();
  const plantilla = (data?.valor ?? "").trim();
  return plantilla ? plantilla.replaceAll("{nombre}", nombre || "") : "";
}

// Teléfono en formato internacional (añade 34 a los números españoles de 9 cifras)
export function telInternacional(telefono: string | null): string {
  const t = String(telefono ?? "").replace(/\D/g, "");
  return t.length === 9 ? "34" + t : t;
}

// Guarda que un mensaje del chat del administrador pertenece a una solicitud,
// para que al «Responder» a él la respuesta llegue al solicitante.
export async function vincularMensaje(adminMsg: { result?: { message_id?: number } } | null, solicitudId: number) {
  const id = adminMsg?.result?.message_id;
  if (id) await servicio.from("tg_relay").upsert({ admin_msg_id: id, solicitud_id: solicitudId });
}

// Envía la clave directamente al solicitante si conectó su Telegram. Devuelve true si se envió.
export async function enviarClaveAlSolicitante(s: { tg_chat_id: number | null; nombre: string | null }, email: string, clave: string) {
  if (!s.tg_chat_id) return false;
  const r = await telegram("sendMessage", {
    chat_id: s.tg_chat_id,
    text: `✅ ${s.nombre ? s.nombre + ", tu" : "Tu"} acceso está listo.\n\n${mensajeAcceso(email, clave)}`,
    disable_web_page_preview: true,
  });
  return !!r?.ok;
}
