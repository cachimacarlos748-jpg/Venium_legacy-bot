// ============================================================================
// Proxy de Verificación de Pagos (BDVenlínea)  ·  Cloudflare Worker, plan FREE
// ----------------------------------------------------------------------------
// El bot (Fastify en Northflank) es quien entra al banco con Chromium. La
// tienda NO habla directo con el bot: la clave compartida viaja como secreto de
// este Worker y nunca llega al navegador.
//
// Sintaxis MODULE (export default + env): es la que permite leer secretos.
// Cómo desplegarlo (3 minutos):
//   1. Cloudflare Dashboard → Workers & Pages → Create → Worker.
//   2. Nombre: legacy-bdv-verify → Deploy.
//   3. "Edit code" → borra todo → pega este archivo → Deploy.
//   4. Settings → Variables and Secrets → ADD (marcar "Secret"):
//        BOT_URL        = https://tu-bot.example.com  (URL base del bot)
//        BDV_VERIFY_KEY = (la MISMA clave que tiene el bot en BDV_VERIFY_KEY)
//   5. Copia la URL del worker (https://legacy-bdv-verify.xxx.workers.dev).
//   6. En Cloudflare Pages (la tienda) → Variables de entorno → añadir:
//        VITE_BDV_VERIFY_PROXY_URL = https://legacy-bdv-verify.xxx.workers.dev
//      y redeploy.
//
// La MISMA clave (BDV_VERIFY_KEY) debe existir también en el bot (Northflank);
// si no, el bot responde 503 y el verificador queda cerrado.
// ============================================================================

// Clave publica anti-abuso: cambia esta cadena por la que quieras. Evita que
// cualquiera que encuentre la URL del Worker la use a discreción.
const ALLOWED_KEY = "legacy_bdv_2025";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "POST") return json({ error: "solo POST" }, 405);

    const BOT_URL = String(env?.BOT_URL ?? "").replace(/\/+$/, "");
    const SECRET = String(env?.BDV_VERIFY_KEY ?? "");
    if (!BOT_URL || !SECRET) return json({ error: "proxy sin configurar (BOT_URL / BDV_VERIFY_KEY)" }, 503);

    const url = new URL(request.url);
    if (url.searchParams.get("key") !== ALLOWED_KEY) return json({ error: "no autorizado" }, 401);

    const incoming = await request.json().catch(() => ({}));
    if (!incoming.amount || !incoming.reference) {
      return json({ error: "amount y reference son obligatorios" }, 400);
    }

    // Cloudflare corta las peticiones de Workers a ~100 s: si no cortamos
    // nosotros, el cliente recibe un 524 sin cuerpo y no puede caerse al
    // proveedor anterior. Cortamos a 95 s para devolver un error legible.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 95000);
    try {
      const upstream = await fetch(`${BOT_URL}/api/bdv/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-BDV-Key": SECRET },
        body: JSON.stringify({ amount: String(incoming.amount), reference: String(incoming.reference) }),
        signal: controller.signal,
      });
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    } catch (error) {
      return json(
        { error: error?.name === "AbortError" ? "el banco tardo demasiado" : "no se pudo contactar el bot" },
        502,
      );
    } finally {
      clearTimeout(timer);
    }
  },
};