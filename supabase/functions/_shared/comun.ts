import { createClient } from "jsr:@supabase/supabase-js@2";

// Orígenes desde los que se puede llamar a las funciones. Por defecto cualquiera;
// para limitarlo, crea el secreto ORIGENES_PERMITIDOS con la dirección de la app
// (por ejemplo «https://jmmoreno0786.github.io»), separando varias con comas.
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
