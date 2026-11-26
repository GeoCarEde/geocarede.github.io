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
// POST binario (Content-Type: application/octet-stream) → sustituye el archivo de ubicaciones
import { cors, json, nuevaClave, servicio, usuarioDe } from "../_shared/comun.ts";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const fecha = (v: unknown) => (typeof v === "string" && FECHA.test(v) ? v : null);

async function altaUsuario(email: string, nombre: string | null, telefono: string | null, caduca: string | null) {
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
      const [lic, sol] = await Promise.all([
        servicio.from("licencias").select("*").order("creada_en", { ascending: false }),
        servicio.from("solicitudes").select("*").order("creada_en", { ascending: false }).limit(200),
      ]);
      const { data: archivo } = await servicio.storage.from("datos").list("", { search: "datos.json.gz" });
      return json(req, {
        licencias: lic.data ?? [],
        solicitudes: sol.data ?? [],
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
      return json(req, { ...r, telefono: s.telefono, nombre: s.nombre });
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
      const { error } = await servicio.auth.admin.updateUserById(uid, { password: clave });
      return error ? json(req, { error: error.message }, 400) : json(req, { clave });
    }

    case "eliminar": {
      const { error } = await servicio.auth.admin.deleteUser(uid); // la licencia se borra en cascada
      return error ? json(req, { error: error.message }, 400) : json(req, { ok: true });
    }
  }
  return json(req, { error: "accion_desconocida" }, 400);
});
