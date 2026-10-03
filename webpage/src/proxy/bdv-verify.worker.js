// ============================================================================
// Proxy de Verificación de Pagos (BDVenlínea)  ·  Cloudflare Worker, plan FREE
// ----------------------------------------------------------------------------
// El bot (Fastify en Northflank) es quien entra al banco con Chromium. La
// tienda NO habla directo con el bot: la clave compartida viaja como secreto de
// este Worker y nunca llega al navegador.
//
// Cómo desplegarlo (3 minutos):
//   1. Cloudflare Dashboard → Workers & Pages → Create → Worker.
//   2. Nombre: legacy-bdv-verify → Deploy.
//   3. "Edit code" → borra todo → pega este archivo → Deploy.
//   4. Settings → Variables and Secrets → ADD (como Secret, marcar "Secret"):
//        BOT_URL        = https://tu-bot.onrender.com   (la URL base del bot)
//        BDV_VERIFY_KEY = (la MISMA clave que tiene el bot en BDV_VERIFY_KEY)
//   5. Copia la URL del worker (https://legacy-bdv-verify.xxx.workers.dev).
//   6. En Cloudflare Pages (la tienda) → Variables de entorno → añadir:
//        VITE_BDV_VERIFY_PROXY_URL = https://legacy-bdv-verify.xxx.workers.dev
//      y redeploy.
//
// La MISMA clave (BDV_VERIFY_KEY) debe existir también en el bot (Northflank),
// si no, el bot responde 503 y el verificador queda cerrado.
// ============================================================================

// Clave publica anti-abuso: cambia esta cadena por la que quieras. Evita que
// cualquiera que encuentre la URL del Worker la use a discreción.
var ALLOWED_KEY = "legacy_bdv_2025";

var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

addEventListener("options", function () {
  return new Response(null, { headers: CORS });
});

addEventListener("fetch", function (event) {
  if (event.request.method !== "POST") {
    return new Response(JSON.stringify({ error: "solo POST" }), {
      status: 405,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  var BOT_URL = (env.BOT_URL || "").replace(/\/+$/, "");
  var SECRET = env.BDV_VERIFY_KEY || "";
  if (!BOT_URL || !SECRET) {
    return new Response(JSON.stringify({ error: "proxy sin configurar (BOT_URL / BDV_VERIFY_KEY)" }), {
      status: 503,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  event.respondWith(handle(event.request, BOT_URL, SECRET));
});

async function handle(request, BOT_URL, SECRET) {
  var url = new URL(request.url);
  if (url.searchParams.get("key") !== ALLOWED_KEY) {
    return new Response(JSON.stringify({ error: "no autorizado" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  var incoming = await request.json().catch(function () { return {}; });
  if (!incoming.amount || !incoming.reference) {
    return new Response(JSON.stringify({ error: "amount y reference son obligatorios" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // El banco puede tardar 15-40 s: cortamos a los 90 s para no colgarnos.
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, 90000);
  try {
    var upstream = await fetch(BOT_URL + "/api/bdv/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-BDV-Key": SECRET },
      body: JSON.stringify({ amount: String(incoming.amount), reference: String(incoming.reference) }),
      signal: controller.signal,
    });
    var text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (error) {
    var message = error && error.name === "AbortError"
      ? "el banco tardo demasiado"
      : "no se pudo contactar el bot";
    return new Response(JSON.stringify({ error: message }), {
      status: 502,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } finally {
    clearTimeout(timer);
  }
}