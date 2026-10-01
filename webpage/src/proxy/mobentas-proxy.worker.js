// ============================================================================
// Proxy Mobentas — Verificación de ID  (Cloudflare Worker, plan FREE)
// ----------------------------------------------------------------------------
// Reenvía el POST de verificación de ID a Mobentas SIN depender de proxies
// CORS gratuitos (cors.sh, allorigins, etc.) que se caen constantemente.
//
// CORS abierto: el navegador lo llama directo con fetch().
//
// Cómo desplegarlo (5 minutos):
//   1. Cloudflare Dashboard → Workers & Pages → Create → Worker.
//   2. Nombre: mobentas-proxy → Deploy.
//   3. "Edit code" → borra todo → pega este archivo → Deploy.
//   4. Copia la URL del worker (https://mobentas-proxy.xxx.workers.dev).
//   5. En tu tienda → Admin → pega la URL en "Mobentas Proxy URL"
//      (Setting key="mobentas" → campo proxy).
// ============================================================================

const MOBENTAS_BASE = "https://mobentas.com";
const ALLOWED_KEY = "legacy_mobentas_2025";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    // Auth simple: evita que cualquiera use el proxy sin permiso.
    const key = url.searchParams.get("key");
    if (key !== ALLOWED_KEY) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    // Solo reenviamos POST (verificación de ID) y GET (scrape de catálogo).
    if (request.method !== "POST" && request.method !== "GET") {
      return new Response(JSON.stringify({ error: "Método no permitido" }), {
        status: 405,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    // Quita el ?key= antes de forwardar.
    url.searchParams.delete("key");

    const target = new URL(url.pathname, MOBENTAS_BASE);
    for (const [k, v] of url.searchParams.entries()) target.searchParams.set(k, v);

    const init = {
      method: request.method,
      headers: {},
    };

    if (request.method === "POST") {
      // El body ya viene como form-urlencoded desde el cliente.
      const bodyText = await request.text();
      init.body = bodyText;
      init.headers["Content-Type"] = "application/x-www-form-urlencoded";
    } else {
      init.headers["Accept"] = "text/html,application/json";
    }

    try {
      const resp = await fetch(target.toString(), init);
      const text = await resp.text();
      const outHeaders = new Headers(CORS);
      outHeaders.set("Content-Type", resp.headers.get("Content-Type") || "application/json");
      return new Response(text, { status: resp.status, headers: outHeaders });
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "Mobentas no alcanzable", detail: String(e?.message || e) }),
        { status: 502, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }
  },
};