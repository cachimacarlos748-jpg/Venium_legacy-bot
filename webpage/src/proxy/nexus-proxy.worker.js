// ============================================================================
// Proxy HTTPS + CORS  (Cloudflare Worker, plan FREE)
// ----------------------------------------------------------------------------
// Plan free: 100.000 requests/día, sin suspensión por inactividad.
// HTTPS automático y CORS abierto (el navegador lo llama directo).
//
// FIX error 1003: Cloudflare Workers NO puede hacer fetch a una IP directa.
// Por eso usamos nip.io, que es un hostname que resuelve a la IP real.
//   82.39.109.19.nip.io  ->  82.39.109.19
// Así Cloudflare ve un hostname válido y no da error 1003.
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
// Si la IP/puerto del sistema cambia, edita ORIGENES (mantén el formato .nip.io).
// Si la key real es distinta, cámbiala en ALLOWED_KEY.
// ============================================================================

// IPs reales del bot (migrado el 2026-08-30). Ambas responden healthy.
// Usamos nip.io para que Cloudflare acepte el hostname (fix error 1003).
// Se intentan en orden: si la primera falla, pasa a la segunda (failover).
const ORIGENES = [
  "http://82.39.109.19.nip.io:8080",
  "http://151.245.32.151.nip.io:8080",
];
const ALLOWED_KEY = "nxs_pases_2025";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

async function tryOrigin(originBase, url, request) {
  const target = new URL(url.pathname, originBase);
  for (const [k, v] of url.searchParams.entries()) target.searchParams.set(k, v);

  const init = {
    method: request.method,
    headers: { "Content-Type": request.headers.get("Content-Type") || "application/json" },
  };
  if (request.method === "POST") init.body = await request.text();

  const resp = await fetch(target.toString(), init);
  const text = await resp.text();
  const outHeaders = new Headers(CORS);
  outHeaders.set("Content-Type", resp.headers.get("Content-Type") || "application/json");
  return new Response(text, { status: resp.status, headers: outHeaders });
}

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

    // Clonamos el body solo si es POST (tryOrigin lo lee una vez por intento).
    let bodyText = null;
    if (request.method === "POST") bodyText = await request.text();

    let lastErr = null;
    for (const origen of ORIGENES) {
      try {
        // Reconstruimos un request-like con el body ya leído.
        const fakeReq = {
          method: request.method,
          headers: request.headers,
          text: async () => bodyText ?? "",
        };
        return await tryOrigin(origen, url, fakeReq);
      } catch (e) {
        lastErr = e;
        // prueba el siguiente origen
      }
    }

    return new Response(
      JSON.stringify({ error: "Sistema no alcanzable en ningún origen", detail: String(lastErr?.message || lastErr) }),
      { status: 502, headers: { "Content-Type": "application/json", ...CORS } }
    );
  },
};