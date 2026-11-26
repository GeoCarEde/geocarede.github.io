// Webhook del bot de Telegram: recibe los botones «Aprobar» / «Rechazar» del aviso
// de nueva solicitud y crea la licencia sin pasar por el panel.
//
// Seguridad:
//   - Telegram envía en cada llamada la cabecera X-Telegram-Bot-Api-Secret-Token con el
//     secreto que se registró al configurar el webhook (derivado del token del bot).
//   - Solo se atienden botones pulsados en el chat del administrador (TELEGRAM_CHAT_ID).
//
// Configuración (una vez): GET <url de esta función>?accion=configurar
//   Registra esta misma dirección como webhook del bot. No acepta otra dirección,
//   así que llamarla de nuevo no tiene efecto dañino.
import { altaUsuario, mensajeAcceso, secretoWebhook, servicio, telegram, tgChat, tgToken } from "../_shared/comun.ts";

const ok = () => new Response("ok");

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET" && url.searchParams.get("accion") === "configurar") {
    if (!tgToken()) return new Response("Falta TELEGRAM_BOT_TOKEN", { status: 500 });
    const propia = `${Deno.env.get("SUPABASE_URL")}/functions/v1/telegram`;
    const r = await telegram("setWebhook", {
      url: propia, secret_token: await secretoWebhook(), allowed_updates: ["callback_query"], drop_pending_updates: true,
    });
    return new Response(JSON.stringify({ webhook: propia, telegram: r }), { headers: { "Content-Type": "application/json" } });
  }

  if (req.method !== "POST") return new Response("metodo", { status: 405 });
  if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== await secretoWebhook()) {
    return new Response("no autorizado", { status: 401 });
  }

  let upd: any;
  try { upd = await req.json(); } catch { return ok(); }
  const cb = upd?.callback_query;
  if (!cb?.data || !cb.message) return ok();

  // Solo el chat del administrador puede aprobar o rechazar
  if (String(cb.message.chat?.id) !== tgChat()) {
    await telegram("answerCallbackQuery", { callback_query_id: cb.id, text: "No autorizado" });
    return ok();
  }

  const m = /^(ap|re):(\d+)$/.exec(cb.data);
  if (!m) return ok();
  const [, accion, id] = m;
  const responder = (text: string) => telegram("answerCallbackQuery", { callback_query_id: cb.id, text });
  const marcarMensaje = (estado: string) => telegram("editMessageText", {
    chat_id: cb.message.chat.id, message_id: cb.message.message_id,
    text: `${cb.message.text}\n\n${estado}`, disable_web_page_preview: true,
  });

  const { data: s } = await servicio.from("solicitudes").select("*").eq("id", Number(id)).maybeSingle();
  if (!s) { await responder("Esa solicitud ya no existe"); await marcarMensaje("⚠️ Solicitud no encontrada"); return ok(); }
  if (s.estado !== "pendiente") {
    await responder(`Ya estaba ${s.estado}`);
    await marcarMensaje(s.estado === "aprobada" ? "✅ Ya estaba aprobada" : "❌ Ya estaba rechazada");
    return ok();
  }

  if (accion === "re") {
    await servicio.from("solicitudes").update({ estado: "rechazada" }).eq("id", s.id).eq("estado", "pendiente");
    await responder("Solicitud rechazada");
    await marcarMensaje("❌ Rechazada");
    return ok();
  }

  // Aprobar: marca la solicitud primero para que un doble toque no cree dos usuarios
  const { data: tomada } = await servicio.from("solicitudes").update({ estado: "aprobada" })
    .eq("id", s.id).eq("estado", "pendiente").select("id").maybeSingle();
  if (!tomada) { await responder("Ya se estaba procesando"); return ok(); }

  const r = await altaUsuario(s.email, s.nombre || null, s.telefono, null);
  if ("error" in r) {
    await servicio.from("solicitudes").update({ estado: "pendiente" }).eq("id", s.id);
    const motivo = r.error === "ya_existe" ? "ya existe un usuario con ese email" : r.error;
    await responder("No se pudo aprobar");
    await telegram("sendMessage", { chat_id: cb.message.chat.id, text: `⚠️ No se pudo aprobar a ${s.email}: ${motivo}.` });
    return ok();
  }

  await responder("Aprobada");
  await marcarMensaje("✅ Aprobada");

  const msg = mensajeAcceso(r.email, r.clave);
  const tel = String(s.telefono ?? "").replace(/\D/g, "");
  const telInt = tel.length === 9 ? "34" + tel : tel;
  const botones = [];
  if (telInt) botones.push({ text: "Enviar por WhatsApp", url: `https://wa.me/${telInt}?text=${encodeURIComponent(msg)}` });
  botones.push({ text: "Enviar por Telegram", url: `https://t.me/share/url?url=${encodeURIComponent(Deno.env.get("APP_URL") ?? "https://jmmoreno0786.github.io/GEO-CAR-EDE/")}&text=${encodeURIComponent(msg)}` });

  await telegram("sendMessage", {
    chat_id: cb.message.chat.id,
    text: `✅ Acceso creado para ${s.nombre || s.email}\n\n${msg}\n\nReenvíaselo con los botones de abajo o copia el texto.`,
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [botones] },
  });
  return ok();
});
