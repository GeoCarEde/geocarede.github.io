// Acciones del panel de administración. Solo las pueden usar los usuarios
// que estén en la tabla «admins».
//
// POST JSON { accion, ... }:
//   yo                                      → comprueba que eres administrador
//   listar                                  → licencias y solicitudes
//   aprobar   { solicitud_id, caduca? }     → crea usuario + licencia y devuelve la clave
//   rechazar  { solicitud_id }
//   crear     { email, nombre?, telefono?, caduca? } → alta manual, devuelve la clave
//   liberar   { user_id }                   → desvincula el dispositivo (cambio de móvil)
//   activar   { user_id, activa }
//   caducidad { user_id, caduca }           → fecha AAAA-MM-DD o null
//   nueva_clave { user_id }                 → genera y devuelve una clave nueva
//   eliminar  { user_id }
//   ajustes   { mensaje_pago }              → guarda el mensaje de pago que envía el bot
// POST binario (Content-Type: application/octet-stream) → sustituye el archivo de ubicaciones
import { altaUsuario, cors, enviarClaveAlSolicitante, json, nuevaClave, servicio, usuarioDe } from "../_shared/comun.ts";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const fecha = (v: unknown) => (typeof v === "string" && FECHA.test(v) ? v : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "metodo" }, 405);

  const user = await usuarioDe(req);
  if (!user) return json(req, { error: "sin_sesion" }, 401);
  const { data: esAdmin } = await servicio.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!esAdmin) return json(req, { error: "no_admin" }, 403);

  // Subida del archivo de ubicaciones (ya comprimido en el navegador)
  if ((req.headers.get("Content-Type") ?? "").startsWith("application/octet-stream")) {
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length < 100 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return json(req, { error: "formato" }, 400);
    const { error } = await servicio.storage.from("datos")
      .upload("datos.json.gz", bytes, { upsert: true, contentType: "application/octet-stream" });
    return error ? json(req, { error: error.message }, 500) : json(req, { ok: true, bytes: bytes.length });
  }

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json(req, { error: "formato" }, 400); }
  const uid = typeof b.user_id === "string" ? b.user_id : "";

  switch (b.accion) {
    case "yo":
      return json(req, { ok: true, email: user.email });

    case "listar": {
      const [lic, sol, aj] = await Promise.all([
        servicio.from("licencias").select("*").order("creada_en", { ascending: false }),
        servicio.from("solicitudes").select("id, nombre, email, telefono, mensaje, estado, creada_en, tg_chat_id")
          .order("creada_en", { ascending: false }).limit(200),
        servicio.from("ajustes").select("valor").eq("clave", "mensaje_pago").maybeSingle(),
      ]);
      const { data: archivo } = await servicio.storage.from("datos").list("", { search: "datos.json.gz" });
      return json(req, {
        licencias: lic.data ?? [],
        solicitudes: (sol.data ?? []).map(({ tg_chat_id, ...s }) => ({ ...s, telegram: !!tg_chat_id })),
        mensaje_pago: aj.data?.valor ?? "",
        datos: archivo?.find((f) => f.name === "datos.json.gz")?.updated_at ?? null,
      });
    }

    case "aprobar": {
      const { data: s } = await servicio.from("solicitudes").select("*").eq("id", b.solicitud_id).maybeSingle();
      if (!s) return json(req, { error: "no_encontrada" }, 404);
      if (s.estado !== "pendiente") return json(req, { error: "ya_resuelta" }, 409);
      const r = await altaUsuario(s.email, s.nombre || null, s.telefono, fecha(b.caduca));
      if ("error" in r) return json(req, r, 400);
      await servicio.from("solicitudes").update({ estado: "aprobada" }).eq("id", s.id);
      const enviadaTelegram = await enviarClaveAlSolicitante(s, r.email, r.clave);
      return json(req, { ...r, telefono: s.telefono, nombre: s.nombre, enviadaTelegram });
    }

    case "rechazar": {
      await servicio.from("solicitudes").update({ estado: "rechazada" }).eq("id", b.solicitud_id).eq("estado", "pendiente");
      return json(req, { ok: true });
    }

    case "crear": {
      const email = String(b.email ?? "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(req, { error: "email" }, 400);
      const r = await altaUsuario(email, String(b.nombre ?? "").trim() || null, String(b.telefono ?? "").trim() || null, fecha(b.caduca));
      return "error" in r ? json(req, r, 400) : json(req, r);
    }

    case "liberar": {
      await servicio.from("licencias").update({ device_id: null, device_info: null, vinculada_en: null }).eq("user_id", uid);
      return json(req, { ok: true });
    }

    case "activar": {
      await servicio.from("licencias").update({ activa: b.activa === true }).eq("user_id", uid);
      return json(req, { ok: true });
    }

    case "caducidad": {
      await servicio.from("licencias").update({ caduca: fecha(b.caduca) }).eq("user_id", uid);
      return json(req, { ok: true });
    }

    case "nueva_clave": {
      const clave = nuevaClave();
      // Conserva sus datos y marca la clave como temporal para que la app ofrezca cambiarla
      const { data: actual } = await servicio.auth.admin.getUserById(uid);
      const { error } = await servicio.auth.admin.updateUserById(uid, {
        password: clave, user_metadata: { ...(actual?.user?.user_metadata ?? {}), clave_temporal: true },
      });
      return error ? json(req, { error: error.message }, 400) : json(req, { clave });
    }

    case "ajustes": {
      const valor = String(b.mensaje_pago ?? "").slice(0, 3000);
      const { error } = await servicio.from("ajustes")
        .upsert({ clave: "mensaje_pago", valor, actualizado_en: new Date().toISOString() });
      return error ? json(req, { error: error.message }, 500) : json(req, { ok: true });
    }

    case "eliminar": {
      const { error } = await servicio.auth.admin.deleteUser(uid); // la licencia se borra en cascada
      return error ? json(req, { error: error.message }, 400) : json(req, { ok: true });
    }
  }
  return json(req, { error: "accion_desconocida" }, 400);
});
