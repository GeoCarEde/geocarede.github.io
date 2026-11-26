// Entrega el archivo de ubicaciones solo a usuarios con licencia activa,
// y solo en el dispositivo al que quedó vinculada la licencia.
//
// Cabeceras que envía la app:
//   Authorization: Bearer <token de sesión>
//   x-device-id:   identificador que la app crea la primera vez en cada dispositivo
//
// Respuestas de error (JSON { error }):
//   401 sin_sesion        · la sesión no es válida o ha caducado
//   400 sin_dispositivo   · falta el identificador de dispositivo
//   403 sin_licencia      · el usuario no tiene licencia
//   403 desactivada       · la licencia está desactivada
//   403 caducada          · la licencia ha pasado su fecha de caducidad
//   403 otro_dispositivo  · la licencia está vinculada a otro dispositivo
//   503 sin_datos         · todavía no se han subido las ubicaciones
import { cors, hoy, json, servicio, usuarioDe } from "../_shared/comun.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });

  const user = await usuarioDe(req);
  if (!user) return json(req, { error: "sin_sesion" }, 401);

  const device = (req.headers.get("x-device-id") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(device)) return json(req, { error: "sin_dispositivo" }, 400);

  const { data: lic, error } = await servicio.from("licencias")
    .select("activa, caduca, device_id").eq("user_id", user.id).maybeSingle();
  if (error) return json(req, { error: "error_servidor" }, 500);
  if (!lic) return json(req, { error: "sin_licencia" }, 403);
  if (!lic.activa) return json(req, { error: "desactivada" }, 403);
  if (lic.caduca && lic.caduca < hoy()) return json(req, { error: "caducada" }, 403);

  const ahora = new Date().toISOString();
  if (!lic.device_id) {
    // Primera entrada: vincula este dispositivo. La condición «device_id is null»
    // evita que dos dispositivos se vinculen a la vez.
    const { data: vinculada } = await servicio.from("licencias")
      .update({
        device_id: device,
        device_info: (req.headers.get("User-Agent") ?? "").slice(0, 300),
        vinculada_en: ahora,
      })
      .eq("user_id", user.id).is("device_id", null)
      .select("device_id").maybeSingle();
    if (!vinculada) {
      const { data: otra } = await servicio.from("licencias")
        .select("device_id").eq("user_id", user.id).maybeSingle();
      if (otra?.device_id !== device) return json(req, { error: "otro_dispositivo" }, 403);
    }
  } else if (lic.device_id !== device) {
    return json(req, { error: "otro_dispositivo" }, 403);
  }

  await servicio.from("licencias").update({ ultimo_acceso: ahora }).eq("user_id", user.id);

  const { data: archivo } = await servicio.storage.from("datos").download("datos.json.gz");
  if (!archivo) return json(req, { error: "sin_datos" }, 503);

  return new Response(archivo, {
    headers: { ...cors(req), "Content-Type": "application/octet-stream", "Cache-Control": "no-store" },
  });
});
