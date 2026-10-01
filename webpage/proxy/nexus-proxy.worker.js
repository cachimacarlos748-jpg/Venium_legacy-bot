// ============================================================================
// Proxy HTTPS + CORS  (Cloudflare Worker, plan FREE)
// ----------------------------------------------------------------------------
// Plan free: 100.000 requests/día, sin suspensión por inactividad.
// HTTPS automático y CORS abierto (el navegador lo llama directo).
// Se despliega desde el navegador (dashboard), sin instalar nada.
//
// Cómo desplegarlo (5 minutos, sin PC/CLI):
//   1. Crea cuenta gratis en https://dash.cloudflare.com (si no tienes).
//   2. Menú izquierdo → "Workers & Pages" → "Create" → "Worker".
//   3. Dale un nombre (ej: nexus-proxy) y dale a "Deploy".
//   4. Click en "Edit code" → borra lo que haya → pega TODO este archivo.
//   5. Click "Deploy". Te da una URL tipo:
//        https://nexus-proxy.<tu-subdominio>.workers.dev
//   6. Ve a tu tienda → Admin → Free Fire → pestaña "Config"
//      y pega esa URL en el campo "Proxy HTTPS". ¡Listo!
//
// Si la key real es distinta, cámbiala en ALLOWED_KEY.
// Si el operador cambia la IP/puerto, actualiza ORIGEN.
// ============================================================================

const ORIGEN = "http://151.245.32.185:8080";
const ALLOWED_KEY = "nxs_razer_2025";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const key = url.searchParams.get("key");
    if (key !== ALLOWED_KEY) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    const target = new URL(url.pathname, ORIGEN);
    for (const [k, v] of url.searchParams.entries()) target.searchParams.set(k, v);

    const init = {
      method: request.method,
      headers: { "Content-Type": request.headers.get("Content-Type") || "application/json" },
    };
    if (request.method === "POST") init.body = await request.text();

    try {
      const resp = await fetch(target.toString(), init);
      const text = await resp.text();
      const outHeaders = new Headers(CORS);
      outHeaders.set("Content-Type", resp.headers.get("Content-Type") || "application/json");
      return new Response(text, { status: resp.status, headers: outHeaders });
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "Sistema no alcanzable", detail: String(e?.message || e) }),
        { status: 502, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }
  },
};