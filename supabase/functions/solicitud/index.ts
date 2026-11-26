// Recibe el formulario «Solicitar acceso» (sin necesidad de sesión),
// lo guarda y avisa al administrador por Telegram.
//
// Secretos que hay que crear en Supabase (Edge Functions → Secrets):
//   TELEGRAM_BOT_TOKEN  token del bot que da @BotFather
//   TELEGRAM_CHAT_ID    tu identificador de chat de Telegram
//   ADMIN_URL           (opcional) dirección del panel, para incluir el enlace en el aviso
import { cors, json, servicio } from "../_shared/comun.ts";

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const limpiar = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "metodo" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(req, { error: "formato" }, 400); }

  // Campo trampa: los formularios rellenados por robots lo completan; las personas no lo ven.
  if (limpiar(body.web, 200)) return json(req, { ok: true });

  const nombre = limpiar(body.nombre, 120);
  const email = limpiar(body.email, 254).toLowerCase();
  const telefono = limpiar(body.telefono, 30);
  const mensaje = limpiar(body.mensaje, 500);
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 64);

  if (!EMAIL.test(email)) return json(req, { error: "email" }, 400);
  if (telefono.replace(/\D/g, "").length < 9) return json(req, { error: "telefono" }, 400);

  // Límite sencillo contra abusos: 3 solicitudes por email al día y 10 por IP a la hora.
  const haceUnDia = new Date(Date.now() - 864e5).toISOString();
  const haceUnaHora = new Date(Date.now() - 36e5).toISOString();
  const [{ count: porEmail }, { count: porIp }] = await Promise.all([
    servicio.from("solicitudes").select("id", { count: "exact", head: true }).eq("email", email).gte("creada_en", haceUnDia),
    ip ? servicio.from("solicitudes").select("id", { count: "exact", head: true }).eq("ip", ip).gte("creada_en", haceUnaHora)
       : Promise.resolve({ count: 0 }),
  ]);
  if ((porEmail ?? 0) >= 3 || (porIp ?? 0) >= 10) return json(req, { error: "demasiadas" }, 429);

  const { error } = await servicio.from("solicitudes").insert({ nombre, email, telefono, mensaje, ip });
  if (error) return json(req, { error: "error_servidor" }, 500);

  // Aviso por Telegram. Si falla, la solicitud queda guardada igualmente y se ve en el panel.
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chat = Deno.env.get("TELEGRAM_CHAT_ID");
  if (token && chat) {
    const panel = Deno.env.get("ADMIN_URL");
    const texto = [
      "🔑 Nueva solicitud de acceso",
      `Nombre: ${nombre || "—"}`,
      `Email: ${email}`,
      `Teléfono: ${telefono}`,
      mensaje ? `Mensaje: ${mensaje}` : "",
      panel ? `\nAprobar en el panel: ${panel}` : "",
    ].filter(Boolean).join("\n");
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text: texto, disable_web_page_preview: true }),
      });
      if (!r.ok) console.error("Telegram respondió", r.status, await r.text());
    } catch (e) {
      console.error("No se pudo avisar por Telegram", e);
    }
  } else {
    console.warn("Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID: no se envía aviso");
  }

  return json(req, { ok: true });
});
