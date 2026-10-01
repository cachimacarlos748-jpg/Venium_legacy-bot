// ============================================================================
// Proxy Venium API  (Cloudflare Worker, plan FREE)
// ----------------------------------------------------------------------------
// Mantiene la API key de Venium SECRETA en el servidor (env.VENIUM_API_KEY).
// El navegador nunca ve la key real: solo llama a este worker con una key
// pública de autorización (?key=) y el worker inyecta el header X-API-Key
// antes de forwardear a veniumstore.com.
//
// CORS abierto: el navegador lo llama directo con fetch().
//
// Cómo desplegarlo (5 minutos):
//   1. Cloudflare Dashboard → Workers & Pages → Create → Worker.
//   2. Nombre: venium-proxy → Deploy.
//   3. "Edit code" → borra todo → pega este archivo → Deploy.
//   4. Ve a Settings → Variables → Add:
//        VENIUM_API_KEY = venium_tu_api_key_real
//      (Marcar como "Secret" para que no sea visible).
//   5. Copia la URL del worker (https://venium-proxy.xxx.workers.dev).
//   6. En tu tienda → Admin → pestaña Venium → pega la URL en "Proxy URL".
// ============================================================================

const VENIUM_BASE = "https://veniumstore.com";
const ALLOWED_KEY = "legacy_venium_2025";

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

    // La key de Venium debe estar en las variables del Worker.
    const veniumKey = env?.VENIUM_API_KEY;
    if (!veniumKey) {
      return new Response(JSON.stringify({ error: "VENIUM_API_KEY no configurado en el Worker" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    // Endpoint /rate: trae la tasa USDT P2P de Binance Venezuela en vivo.
    // No necesita VENIUM_API_KEY — solo la key pública de autorización.
    if (url.pathname === "/rate") {
      try {
        const binanceResp = await fetch(
          "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "application/json",
              "Accept-Language": "es-VE,es;q=0.9,en;q=0.8",
              "Origin": "https://p2p.binance.com",
              "Referer": "https://p2p.binance.com/",
            },
            body: JSON.stringify({
              fiat: "VES", page: 1, rows: 8,
              tradeType: "BUY", asset: "USDT",
              countries: ["VE"], payTypes: [],
            }),
          }
        );
        const data = await binanceResp.json();
        const offers = data?.data || [];
        if (!offers.length) throw new Error("sin ofertas P2P");
        const prices = offers
          .map((o) => Number(o?.adv?.price))
          .filter((p) => p > 0)
          .sort((a, b) => a - b);
        const median = prices[Math.floor(prices.length / 2)];
        return new Response(
          JSON.stringify({ rate: median, source: "binance_p2p_buy", ts: Date.now() }),
          { headers: { "Content-Type": "application/json", ...CORS } }
        );
      } catch (e) {
        return new Response(
          JSON.stringify({ error: "No se pudo obtener la tasa", detail: String(e?.message || e) }),
          { status: 502, headers: { "Content-Type": "application/json", ...CORS } }
        );
      }
    }

    // Quita el ?key= antes de forwardar a Venium.
    url.searchParams.delete("key");

    const target = new URL(url.pathname, VENIUM_BASE);
    for (const [k, v] of url.searchParams.entries()) target.searchParams.set(k, v);

    const init = {
      method: request.method,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": veniumKey,
      },
    };
    if (request.method === "POST") {
      init.body = await request.text();
    }

    try {
      const resp = await fetch(target.toString(), init);
      const text = await resp.text();
      const outHeaders = new Headers(CORS);
      outHeaders.set("Content-Type", resp.headers.get("Content-Type") || "application/json");
      return new Response(text, { status: resp.status, headers: outHeaders });
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "Venium no alcanzable", detail: String(e?.message || e) }),
        { status: 502, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }
  },
};