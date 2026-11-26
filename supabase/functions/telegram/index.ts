// Webhook del bot de Telegram.
//
// En el chat del administrador:
//   - Botones del aviso de nueva solicitud: ✅ Aprobar · ❌ Rechazar · 💳 Enviar mensaje de pago
//   - «Responder» a un mensaje de una solicitud → la respuesta se reenvía al solicitante
// Con los solicitantes:
//   - /start s_<código>  (enlace «Recibir respuesta por Telegram» de la app) → conecta su chat a la solicitud
//   - Cualquier otro mensaje suyo (texto, foto del justificante…) → se reenvía al administrador
//
// Seguridad:
//   - Telegram envía en cada llamada la cabecera X-Telegram-Bot-Api-Secret-Token con el secreto
//     registrado al configurar el webhook (derivado del token del bot).
//   - Botones y respuestas solo se atienden en el chat del administrador (TELEGRAM_CHAT_ID).
//
// Configuración (una vez, y de nuevo si cambia el token): GET <url de esta función>?accion=configurar
import {
  altaUsuario, APP_URL, enviarClaveAlSolicitante, mensajeAcceso, mensajePago, secretoWebhook, servicio,
  telegram, telInternacional, tgChat, tgToken, vincularMensaje,
} from "../_shared/comun.ts";

const ok = () => new Response("ok");
const nombreDe = (s: { nombre?: string | null; email: string }) => s.nombre || s.email;

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET" && url.searchParams.get("accion") === "configurar") {
    if (!tgToken()) return new Response("Falta TELEGRAM_BOT_TOKEN", { status: 500 });
    const propia = `${Deno.env.get("SUPABASE_URL")}/functions/v1/telegram`;
    await telegram("deleteWebhook", {});
    const r = await telegram("setWebhook", {
      url: propia, secret_token: await secretoWebhook(), allowed_updates: ["callback_query", "message"],
    });
    const info = await telegram("getWebhookInfo", {});
    const estado = {
      url: info?.result?.url, tipos: info?.result?.allowed_updates, pendientes: info?.result?.pending_update_count,
      ultimoError: info?.result?.last_error_message ?? null,
    };
    return new Response(JSON.stringify({ webhook: propia, telegram: r, estado }), { headers: { "Content-Type": "application/json" } });
  }

  if (req.method !== "POST") return new Response("metodo", { status: 405 });
  if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== await secretoWebhook()) {
    return new Response("no autorizado", { status: 401 });
  }

  let upd: any;
  try { upd = await req.json(); } catch { return ok(); }
  try {
    if (upd.callback_query) await boton(upd.callback_query);
    else if (upd.message) await mensaje(upd.message);
  } catch (e) {
    console.error("Error atendiendo a Telegram", e);
  }
  return ok(); // siempre 200, para que Telegram no repita la llamada
});

// ---------------- botones del aviso ----------------
async function boton(cb: any) {
  if (!cb.data || !cb.message) return;
  const chatAdmin = cb.message.chat.id;
  if (String(chatAdmin) !== tgChat()) {
    await telegram("answerCallbackQuery", { callback_query_id: cb.id, text: "No autorizado" });
    return;
  }
  const m = /^(ap|re|pg):(\d+)$/.exec(cb.data);
  if (!m) return;
  const [, accion, id] = m;
  const responder = (text: string) => telegram("answerCallbackQuery", { callback_query_id: cb.id, text });
  const marcarAviso = (estado: string) => telegram("editMessageText", {
    chat_id: chatAdmin, message_id: cb.message.message_id,
    text: `${cb.message.text}\n\n${estado}`, disable_web_page_preview: true,
  });

  const { data: s } = await servicio.from("solicitudes").select("*").eq("id", Number(id)).maybeSingle();
  if (!s) { await responder("Esa solicitud ya no existe"); await marcarAviso("⚠️ Solicitud no encontrada"); return; }
  if (s.estado !== "pendiente") {
    await responder(`Ya estaba ${s.estado}`);
    await marcarAviso(s.estado === "aprobada" ? "✅ Ya estaba aprobada" : "❌ Ya estaba rechazada");
    return;
  }

  if (accion === "pg") return enviarPago(s, chatAdmin, responder);

  if (accion === "re") {
    await servicio.from("solicitudes").update({ estado: "rechazada" }).eq("id", s.id).eq("estado", "pendiente");
    await responder("Solicitud rechazada");
    await marcarAviso("❌ Rechazada");
    return;
  }

  // Aprobar: marca la solicitud primero para que un doble toque no cree dos usuarios
  const { data: tomada } = await servicio.from("solicitudes").update({ estado: "aprobada" })
    .eq("id", s.id).eq("estado", "pendiente").select("id").maybeSingle();
  if (!tomada) { await responder("Ya se estaba procesando"); return; }

  const r = await altaUsuario(s.email, s.nombre || null, s.telefono, null);
  if ("error" in r) {
    await servicio.from("solicitudes").update({ estado: "pendiente" }).eq("id", s.id);
    const motivo = r.error === "ya_existe" ? "ya existe un usuario con ese email" : r.error;
    await responder("No se pudo aprobar");
    await telegram("sendMessage", { chat_id: chatAdmin, text: `⚠️ No se pudo aprobar a ${s.email}: ${motivo}.` });
    return;
  }
  await responder("Aprobada");
  await marcarAviso("✅ Aprobada");

  const enviada = await enviarClaveAlSolicitante(s, r.email, r.clave);
  const msg = mensajeAcceso(r.email, r.clave);
  const tel = telInternacional(s.telefono);
  const botones = [];
  if (tel) botones.push({ text: "Enviar por WhatsApp", url: `https://wa.me/${tel}?text=${encodeURIComponent(msg)}` });
  botones.push({ text: "Enviar por Telegram", url: `https://t.me/share/url?url=${encodeURIComponent(APP_URL)}&text=${encodeURIComponent(msg)}` });
  const aviso = await telegram("sendMessage", {
    chat_id: chatAdmin,
    text: `✅ Acceso creado para ${nombreDe(s)}\n\n${msg}\n\n` +
      (enviada ? "📲 Ya se lo he enviado por Telegram." : "Reenvíaselo con los botones de abajo o copia el texto."),
    disable_web_page_preview: true,
    reply_markup: enviada ? undefined : { inline_keyboard: [botones] },
  });
  await vincularMensaje(aviso, s.id);
}

async function enviarPago(s: any, chatAdmin: number, responder: (t: string) => unknown) {
  const texto = await mensajePago(s.nombre);
  if (!texto) {
    await responder("Falta el mensaje de pago");
    await telegram("sendMessage", {
      chat_id: chatAdmin,
      text: `⚠️ Todavía no has escrito el mensaje de pago. Escríbelo en el panel, sección «Mensaje de pago»: ${APP_URL}admin/`,
      disable_web_page_preview: true,
    });
    return;
  }

  if (s.tg_chat_id) {
    const r = await telegram("sendMessage", { chat_id: s.tg_chat_id, text: texto, disable_web_page_preview: true });
    if (r?.ok) {
      await responder("Mensaje de pago enviado");
      const conf = await telegram("sendMessage", {
        chat_id: chatAdmin,
        text: `💳 Mensaje de pago enviado a ${nombreDe(s)} por Telegram.\nSi te contesta, verás aquí su respuesta. Para escribirle, responde a este mensaje.`,
      });
      await vincularMensaje(conf, s.id);
      return;
    }
    // Si el usuario bloqueó el bot, se cae al envío manual
  }

  await responder("Envíalo tú");
  const tel = telInternacional(s.telefono);
  const botones = [];
  if (tel) {
    botones.push({ text: "Enviar por WhatsApp", url: `https://wa.me/${tel}?text=${encodeURIComponent(texto)}` });
    botones.push({ text: "Abrir su Telegram", url: `https://t.me/+${tel}` });
  }
  await telegram("sendMessage", {
    chat_id: chatAdmin,
    text: `${nombreDe(s)} no ha conectado su Telegram con el bot, así que el bot no puede escribirle. ` +
      `Envíale tú este mensaje (mantén pulsado para copiarlo):\n\n${texto}`,
    disable_web_page_preview: true,
    reply_markup: botones.length ? { inline_keyboard: [botones] } : undefined,
  });
}

// ---------------- mensajes ----------------
async function mensaje(msg: any) {
  const chat = msg.chat?.id;
  if (!chat || msg.chat.type !== "private") return;

  // Solicitante que abre el enlace de la app: /start s_<código>
  // (va primero para que también funcione desde el chat del administrador, útil para probar)
  const inicio = /^\/start\s+s_([A-Za-z0-9]{10,64})$/.exec(String(msg.text ?? "").trim());
  if (inicio) {
    const { data: s } = await servicio.from("solicitudes").update({ tg_chat_id: chat })
      .eq("tg_token", inicio[1]).select("id, nombre, email, estado").maybeSingle();
    if (!s) {
      await telegram("sendMessage", { chat_id: chat, text: `No encuentro tu solicitud. Puedes pedir acceso desde la app: ${APP_URL}` });
      return;
    }
    await telegram("sendMessage", { chat_id: chat,
      text: `Hola${s.nombre ? " " + s.nombre : ""}. Hemos recibido tu solicitud de acceso a CCTT Granada y te responderemos por aquí. ` +
        `Si quieres, puedes escribirnos en este chat.` });
    const aviso = await telegram("sendMessage", { chat_id: tgChat(),
      text: `📲 ${nombreDe(s)} ha conectado su Telegram. Ahora el bot puede escribirle: usa «💳 Enviar mensaje de pago» o responde a este mensaje.` });
    await vincularMensaje(aviso, s.id);
    return;
  }

  // Mensaje del administrador: si es una respuesta a un mensaje de una solicitud, se reenvía al solicitante
  if (String(chat) === tgChat()) {
    const responde = msg.reply_to_message?.message_id;
    if (!responde) return;
    const { data: rel } = await servicio.from("tg_relay").select("solicitud_id").eq("admin_msg_id", responde).maybeSingle();
    if (!rel) return;
    const { data: s } = await servicio.from("solicitudes").select("id, nombre, email, tg_chat_id").eq("id", rel.solicitud_id).maybeSingle();
    if (!s?.tg_chat_id) {
      await telegram("sendMessage", { chat_id: chat, reply_to_message_id: msg.message_id,
        text: "⚠️ Esta persona no ha conectado su Telegram con el bot: no le puedo hacer llegar tu respuesta." });
      return;
    }
    const r = await telegram("copyMessage", { chat_id: s.tg_chat_id, from_chat_id: chat, message_id: msg.message_id });
    await telegram("sendMessage", { chat_id: chat, reply_to_message_id: msg.message_id,
      text: r?.ok ? `✓ Enviado a ${nombreDe(s)}` : `⚠️ No se pudo enviar a ${nombreDe(s)} (puede que haya bloqueado el bot).` });
    return;
  }

  // Cualquier otro mensaje de un solicitante conectado: se reenvía al administrador
  const { data: s } = await servicio.from("solicitudes").select("id, nombre, email, estado")
    .eq("tg_chat_id", chat).order("creada_en", { ascending: false }).limit(1).maybeSingle();
  if (!s) {
    await telegram("sendMessage", { chat_id: chat, text: `Para solicitar acceso a CCTT Granada usa la app: ${APP_URL}` });
    return;
  }
  const cabecera = await telegram("sendMessage", { chat_id: tgChat(),
    text: `💬 ${nombreDe(s)} (${s.email}) escribe:\nResponde a este mensaje o al siguiente para contestarle.` });
  await vincularMensaje(cabecera, s.id);
  const copia = await telegram("copyMessage", { chat_id: tgChat(), from_chat_id: chat, message_id: msg.message_id });
  await vincularMensaje(copia, s.id);
}
