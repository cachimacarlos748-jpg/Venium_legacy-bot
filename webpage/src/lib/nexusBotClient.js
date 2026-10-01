// Cliente del NEXUS Razer Bot.
//
// El bot se invoca a través de un proxy HTTPS con CORS abierto
// (Access-Control-Allow-Origin: *). El navegador puede llamarlo directamente
// con fetch(), sin proxies CORS de terceros y sin problema de mixed-content.
//
// Endpoints (todos con ?key=API_KEY):
//   GET  /health?format=json    → { status, saldo, cola, browser, processing, stats, ultimaCompra }
//   POST /compra                body: { id_juego, producto }
//                                → { ok, nickname, id_juego, producto_nombre,
//                                    orderDetails: { monto, saldo_restante, transactionId } }
//   GET  /historial?format=json  → [ { ok, nickname, id_juego, producto_nombre, timestamp, orderDetails } ]
//   GET  /cola                   → cola activa
//
// Productos válidos (definidos en nexusProducts.js): basica, semanal, mensual,
// booyah, nivel6..nivel30.

import { BOT_PRODUCT_KEYS } from "./nexusProducts";

const LS_PROXY = "nexus_bot_host";
const LS_REAL = "nexus_bot_realhost";
const LS_KEY = "nexus_bot_apikey";

const DEFAULT_PROXY = "https://solar-gannet-1320.cachimacarlos748-jpg.deno.net";
const DEFAULT_REAL = "";  // No se necesita: el proxy HTTPS ya resuelve todo.
const DEFAULT_KEY = "nxs_pases_2025";

// URLs obsoletas que ya no funcionan (ej: Replit dormido, Deno Deploy
// suspendido por uso). Si localStorage tiene una de estas, se reemplaza
// automáticamente con el DEFAULT_PROXY nuevo.
const STALE_PROXIES = ["replit.dev", "glossy-shrimp-5010.cachimacarlos748.deno.net"];

// Keys obsoletas: el bot migró el 2026-08-30 y cambió la key de
// nxs_razer_2025 a nxs_pases_2025. Si localStorage tiene la vieja,
// se rota automáticamente a la nueva sin que el admin deba reconfigurar.
const STALE_KEYS = ["nxs_razer_2025"];

export function getConfig() {
  if (typeof window === "undefined") return { proxyBase: DEFAULT_PROXY, realHost: DEFAULT_REAL, apiKey: DEFAULT_KEY };
  const raw = (k, def) => (localStorage.getItem(k) || "").trim() || def;
  let proxyBase = raw(LS_PROXY, DEFAULT_PROXY);
  if (STALE_PROXIES.some((s) => proxyBase.includes(s))) proxyBase = DEFAULT_PROXY;
  let apiKey = raw(LS_KEY, DEFAULT_KEY);
  if (STALE_KEYS.some((k) => apiKey === k)) apiKey = DEFAULT_KEY;
  return {
    proxyBase,
    realHost: raw(LS_REAL, DEFAULT_REAL),
    apiKey,
  };
}

export function setConfig(proxyBase, realHost, apiKey) {
  localStorage.setItem(LS_PROXY, proxyBase || "");
  localStorage.setItem(LS_REAL, realHost || "");
  localStorage.setItem(LS_KEY, apiKey || "");
}

export function hasConfig() {
  return !!getConfig().apiKey;
}

export function proxyBase() {
  const { proxyBase } = getConfig();
  return proxyBase ? proxyBase.replace(/\/+$/, "") : "";
}

export function realHost() {
  const { realHost } = getConfig();
  return (realHost || DEFAULT_REAL).replace(/\/+$/, "");
}

export const NexusBot = {
  // Estado en vivo (GET /health). Un solo fetch contra el proxy; aborta a 8 s.
  async getStatus() {
    const { apiKey } = getConfig();
    if (!hasConfig()) throw new Error("Configura la API key en 'Config Bot'.");
    const pb = proxyBase();
    if (!pb) throw new Error("Falta la URL del proxy del bot");
    const url = `${pb}/health?format=json&key=${encodeURIComponent(apiKey)}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      // No enviar el header X-API-Key: el proxy solo permite Content-Type en
      // Access-Control-Allow-Headers, así que cualquier header custom dispara
      // un preflight CORS que el navegador bloquea (y el panel marca "sin
      // conexión"). La auth va por ?key= en la URL — suficiente.
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      const text = await r.text();
      const sleepErr = r.status === 404 && /<!DOCTYPE html>/i.test(text) && /Run this app/i.test(text);
      if (sleepErr) throw new Error("Bot offline (Replit dormido)");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      let data;
      try { data = JSON.parse(text); }
      catch { throw new Error("Respuesta no parseable del bot"); }
      if (typeof data === "string") throw new Error(data.slice(0, 120));
      return data;
    } catch (e) { clearTimeout(t); throw e; }
  },

  // Realiza una recarga (POST /compra). Normaliza la respuesta para que el
  // flujo de Comprar.jsx pueda usar botResult.ok y botResult.tx_id sin manejar
  // el formato anidado original.
  async recargar({ producto, id_juego }) {
    const { apiKey } = getConfig();
    if (!hasConfig()) throw new Error("Configura la API key en 'Config Bot'.");
    const pb = proxyBase();
    if (!pb) throw new Error("Falta la URL del proxy del bot");
    const url = `${pb}/compra?key=${encodeURIComponent(apiKey)}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 60000);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_juego: String(id_juego || ""), producto: String(producto || "") }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const text = await r.text();
      const sleepErr = r.status === 404 && /<!DOCTYPE html>/i.test(text) && /Run this app/i.test(text);
      if (sleepErr) return { error: "Bot offline (Replit dormido)" };
      if (!r.ok) return { error: `HTTP ${r.status}` };
      let data;
      try { data = JSON.parse(text); }
      catch { throw new Error("Respuesta no parseable del bot"); }
      if (typeof data === "string") return { error: data.slice(0, 200) };
      if (data.error) return { error: data.error };
      if (!data.ok) return { error: data.message || "El bot rechazó la compra" };
      return {
        ok: true,
        tx_id: data.orderDetails?.transactionId || "",
        nickname: data.nickname || "",
        id_juego: data.id_juego || "",
        producto_nombre: data.producto_nombre || "",
        orderDetails: data.orderDetails || {},
      };
    } catch (e) { clearTimeout(t); throw e; }
  },

  // La API no expone "lista de productos soportados" (sólo /cola con pedidos en
  // curso). Usamos la lista estática definida en nexusProducts.js, que coincide
  // con los productos documentados del bot.
  async getProductosSoportados() {
    return BOT_PRODUCT_KEYS.slice();
  },

  // URL del historial (la consume un iframe en el panel Free Fire).
  historialUrl() {
    const { apiKey } = getConfig();
    if (!hasConfig()) return null;
    const pb = proxyBase();
    if (!pb) return null;
    return `${pb}/historial?key=${encodeURIComponent(apiKey)}&format=json`;
  },
};

export { DEFAULT_PROXY, DEFAULT_REAL, DEFAULT_KEY };