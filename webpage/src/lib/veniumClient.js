// Cliente de la API de Venium (reseller).
//
// Venium es el proveedor de recargas: catálogo, precios, saldo y despacho
// automático de pedidos. La API key se mantiene SECRETA en el Cloudflare
// Worker (env.VENIUM_API_KEY); este cliente solo llama al worker con una
// key pública de autorización (?key=).
//
// Endpoints (todos vía proxy worker):
//   GET  /api/reseller/balance    → saldo de V-Coins
//   GET  /api/reseller/catalog    → catálogo completo con paquetes y precios
//   POST /api/reseller/orders     → crea un pedido (despacho automático)
//   GET  /api/reseller/orders     → lista/consulta pedidos

import { base44 } from "@/api/base44Client";

const DEFAULTS = {
  proxy_url: "",
  auth_key: "legacy_venium_2025",
  markup: 8, // % de ganancia sobre el precio reseller de Venium
  venium_rate: 0, // Tasa manual (0 = automática: Binance P2P + spread)
  rate_spread: 2, // % extra sobre la tasa Binance P2P para igualar a Venium
};

let _config = null;
let _catalogCache = null;
let _catalogCacheTs = 0;
const CATALOG_TTL = 30 * 60 * 1000; // 30 min

export async function getVeniumConfig() {
  if (_config) return _config;
  try {
    const recs = await base44.entities.Setting.filter({ key: "venium" });
    const rec = recs?.[0];
    const parsed = rec?.value ? JSON.parse(rec.value) : {};
    _config = {
      ...DEFAULTS,
      ...parsed,
      markup: Number(parsed.markup ?? DEFAULTS.markup),
    };
  } catch {
    _config = { ...DEFAULTS };
  }
  return _config;
}

export async function setVeniumConfig(partial) {
  const current = await getVeniumConfig();
  const merged = { ...current, ...partial };
  const value = JSON.stringify(merged);
  try {
    const recs = await base44.entities.Setting.filter({ key: "venium" });
    if (recs?.[0]) await base44.entities.Setting.update(recs[0].id, { value });
    else await base44.entities.Setting.create({ key: "venium", value });
  } catch (e) {
    throw e;
  }
  _config = null;
  return merged;
}

export function isVeniumConfigured() {
  // Síncrono: usa cache si ya se cargó.
  if (_config) return !!_config.proxy_url;
  return false;
}

async function veniumFetch(path, options = {}) {
  const cfg = await getVeniumConfig();
  if (!cfg.proxy_url) throw new Error("Configura la URL del proxy de Venium en el admin");
  const base = cfg.proxy_url.replace(/\/+$/, "");
  const url = new URL(base + path);
  url.searchParams.set("key", cfg.auth_key);
  if (options.params) {
    for (const [k, v] of Object.entries(options.params)) {
      if (v != null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const init = {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json" },
  };
  if (options.body) init.body = JSON.stringify(options.body);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), options.timeout || 15000);
  try {
    const r = await fetch(url.toString(), { ...init, signal: ctrl.signal });
    clearTimeout(t);
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = null; }
    if (!r.ok) {
      const errMsg = data?.error || data?.message || `HTTP ${r.status}`;
      const err = new Error(errMsg);
      err.status = r.status;
      err.data = data;
      throw err;
    }
    return data;
  } catch (e) {
    clearTimeout(t);
    if (e.name === "AbortError") throw new Error("El servidor no respondió (timeout)");
    throw e;
  }
}

// Caché de saldo (USD) — evita consultar Venium en cada navegación.
let _balanceCache = { data: null, ts: 0 };
const BALANCE_TTL = 60 * 1000; // 1 min

export const Venium = {
  // Saldo de V-Coins (USD). Caché corto para no saturar la API.
  async getBalance({ force = false } = {}) {
    if (!force && _balanceCache.data && Date.now() - _balanceCache.ts < BALANCE_TTL) {
      return _balanceCache.data;
    }
    const res = await veniumFetch("/api/reseller/balance");
    _balanceCache = { data: res?.data || null, ts: Date.now() };
    return _balanceCache.data;
  },

  // Catálogo completo con paquetes, precios y stock.
  async getCatalog({ force = false } = {}) {
    if (!force && _catalogCache && Date.now() - _catalogCacheTs < CATALOG_TTL) {
      return _catalogCache;
    }
    const res = await veniumFetch("/api/reseller/catalog", { timeout: 20000 });
    _catalogCache = res?.data || [];
    _catalogCacheTs = Date.now();
    return _catalogCache;
  },

  // Un producto del catálogo por productId.
  async getProduct(productId, { force = false } = {}) {
    const catalog = await this.getCatalog({ force });
    return catalog.find((p) => p.productId === productId) || null;
  },

  // Crea un pedido (despacho automático). Descuenta saldo de V-Coins.
  async createOrder({ productId, packageId, playerData, quantity = 1 }) {
    const res = await veniumFetch("/api/reseller/orders", {
      method: "POST",
      body: { productId, packageId, playerData, quantity },
      timeout: 30000,
    });
    return res?.data || null;
  },

  // Consulta un pedido por orderId.
  async getOrder(orderId) {
    const res = await veniumFetch("/api/reseller/orders", {
      params: { id: orderId },
    });
    const data = res?.data;
    return Array.isArray(data) ? data[0] : data;
  },

  // Lista pedidos con filtros opcionales.
  async getOrders({ status, limit = 50, page = 1 } = {}) {
    const res = await veniumFetch("/api/reseller/orders", {
      params: { status, limit, page },
    });
    return res?.data || [];
  },
};

// ---------- Sincronización del catálogo → Game entities ----------
// Reemplaza el scrape de Mobentas. Trae el catálogo de Venium y lo guarda
// en los Game entities con los packageIds necesarios para crear pedidos.
export async function syncVeniumCatalog() {
  const cfg = await getVeniumConfig();
  const catalog = await Venium.getCatalog({ force: true });
  if (!catalog || !catalog.length) return { ok: false, error: "Catálogo vacío o proxy no configurado" };

  const existing = await base44.entities.Game.list("-updated_date", 200);
  const bySlug = new Map(existing.map((g) => [g.slug, g]));

  let created = 0, updated = 0, failed = 0;
  for (const prod of catalog) {
    const slug = prod.productId;
    const packages = prod.packages || [];
    const denominations = packages.map((p) => ({
      label: p.name,
      // Precio reseller + markup de la tienda.
      price: Number((p.price * (1 + cfg.markup / 100)).toFixed(2)),
      package_id: p.packageId,
      venium_price: p.price,
      out_of_stock: !!p.outOfStock,
    }));

    const playerFields = prod.playerFields || [];
    const requiresPlayerId = playerFields.some((f) =>
      /player.?id|uid|openid/i.test(f.id || f.label || "")
    );
    const requiresServer = playerFields.some((f) =>
      /server|zone|zona|region/i.test(f.id || f.label || "")
    );

    const config = {
      denominations,
      requiresPlayerId,
      requiresServer,
      idLabel: playerFields[0]?.label || "ID de jugador",
      idHint: "",
      venium_product_id: prod.productId,
      player_fields: playerFields,
      currency: "USD",
      synced: true,
      last_synced_at: new Date().toISOString(),
    };

    try {
      const cur = bySlug.get(slug);
      if (cur) {
        await base44.entities.Game.update(cur.id, { name: prod.name, config });
        updated++;
      } else {
        await base44.entities.Game.create({
          name: prod.name,
          slug,
          category: prod.category || "Juegos Móviles",
          badge: "",
          description: "",
          config,
        });
        created++;
      }
    } catch { failed++; }
  }

  return { ok: true, total: catalog.length, created, updated, failed };
}

// Helper: dado un slug de Game y el label del paquete, devuelve el packageId
// de Venium almacenado en el config del Game.
export function findPackageId(gameConfig, label) {
  if (!gameConfig?.denominations) return null;
  const denom = gameConfig.denominations.find((d) => d.label === label);
  return denom?.package_id || null;
}