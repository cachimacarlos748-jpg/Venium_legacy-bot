// Cliente de integración con Mobentas a traves de un proxy CORS gratuito.
// Verificacion de ID en tiempo real + sincronizacion de catalogo/precios.
// Los precios se guardan en USD (Mobentas); al cliente se le muestra en Bs
// aplicando la "tasa" configurada (Setting mobentas.tasa o conversion_rate).

import { base44 } from "@/api/base44Client";

const DEFAULTS = {
  enabled: false,
  base: "https://mobentas.com",
  markup: 5,          // % de ganancia sobre el precio USD de Mobentas
  currency: "USD",
  tasa: 0,            // Bs por USD (0 = mostrar en USD)
  proxy: "",          // proxy CORS personalizado (opcional)
};

// Se lee siempre fresco (sin caché) para que cambios en el admin apliquen de inmediato.
export async function getMobentasConfig() {
  try {
    const recs = await base44.entities.Setting.filter({ key: "mobentas" });
    const rec = recs?.[0];
    const parsed = rec?.value ? JSON.parse(rec.value) : {};
    return {
      ...DEFAULTS,
      ...parsed,
      enabled: parsed.enabled === true || parsed.enabled === "true",
      markup: Number(parsed.markup ?? DEFAULTS.markup),
      tasa: Number(parsed.tasa ?? DEFAULTS.tasa) || 0,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

// Cache de las tasas VES/USD (se actualiza cada hora).
let _ratesCache = { paralelo: 0, bcv: 0, ts: 0 };

// Obtiene las tasas VES/USD desde DolarApi (ve.dolarapi.com).
// Mobentas muestra sus precios en Bs usando la tasa PARALELA (no la del BCV),
// así que usamos la paralela para que los precios de la tienda coincidan.
// El BCV se usa solo para convertir Bs→USD cuando el scrape llega en bolívares.
async function fetchVesRates() {
  if (_ratesCache.paralelo > 0 && Date.now() - _ratesCache.ts < 3600000) {
    return _ratesCache;
  }
  try {
    const r = await fetch("https://ve.dolarapi.com/v1/dolares");
    if (!r.ok) return _ratesCache;
    const data = await r.json();
    const paralelo = data.find((d) => /paralelo/i.test(d.fuente || d.casa || d.nombre || ""));
    const bcv = data.find((d) => /oficial|bcv/i.test(d.fuente || d.casa || d.nombre || ""));
    const pRate = paralelo?.promedio || paralelo?.venta || 0;
    const bRate = bcv?.promedio || bcv?.venta || 0;
    if (pRate > 0) _ratesCache = { paralelo: pRate, bcv: bRate, ts: Date.now() };
    return _ratesCache;
  } catch {
    return _ratesCache;
  }
}

// Tasa paralela (la que usa Mobentas para sus precios en Bs).
export async function getVesRate() {
  const r = await fetchVesRates();
  return r.paralelo || 0;
}

// Tasa del BCV (para convertir Bs→USD cuando el scrape llega en bolívares).
async function getBcvRate() {
  const r = await fetchVesRates();
  return r.bcv || r.paralelo || 0;
}

// Tasa Bs/USD: prioridad 1) Setting "conversion_rate" (manual del admin),
// 2) tasa automática del BCV (DolarApi), 3) mobentas.tasa del config.
export async function getTasa() {
  try {
    const recs = await base44.entities.Setting.filter({ key: "conversion_rate" });
    const v = recs?.[0]?.value;
    if (v) return Number(v) || 0;
  } catch {}
  const vesRate = await getVesRate();
  if (vesRate > 0) return vesRate;
  const cfg = await getMobentasConfig();
  return cfg.tasa || 0;
}

// ---------- Proxies CORS gratuitos ----------
// cors.sh atraviesa el WAF de Mobentas (Cloudflare) y devuelve ACAO: * incluso
// para el HTML del producto (400KB+ con data-product_variations). Es el proxy
// primario tanto para GET (scrape de variaciones) como para POST (verif. ID).
const PROXY_GET = [
  (u) => "https://proxy.cors.sh/" + u,
  (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
  (u) => "https://corsproxy.io/?url=" + encodeURIComponent(u),
];
const PROXY_POST = [
  (u) => "https://proxy.cors.sh/" + u,
  (u) => "https://corsproxy.io/?url=" + encodeURIComponent(u),
  (u) => "https://thingproxy.freeboard.io/fetch/" + u,
];

async function proxiedGet(url, timeoutMs = 15000, extraHeaders = {}) {
  let lastErr = "";
  for (const mk of PROXY_GET) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const r = await fetch(mk(url), { signal: ctrl.signal, headers: { ...extraHeaders } });
      clearTimeout(t);
      if (!r.ok) { lastErr = `HTTP ${r.status}`; continue; }
      const txt = await r.text();
      if (txt && txt.length > 200) return txt;
      lastErr = `respuesta vacía (${txt?.length || 0} bytes)`;
    } catch (e) { lastErr = String(e?.message || e); }
  }
  console.warn("[mobentas] proxiedGet falló para", url, "->", lastErr);
  return null;
}

async function proxiedPost(url, body) {
  for (const mk of PROXY_POST) {
    try {
      const r = await fetch(mk(url), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (r.ok) return r;
    } catch {}
  }
  return null;
}

// ---------- Mapa de verificacion por slug ----------
const VERIFY_MAP = {
  "free-fire": { action: "mobentas_user_verify_free", zid: false },
  "blood-strike": { action: "mobentas_user_verify_blood", zid: false },
  "mobile-legends": { action: "mobentas_user_verify", zid: true },
  "mobile-legends-brasil": { action: "mobentas_user_verify_br", zid: true },
  "mobile-legends-primera-compra-doble": { action: "mobentas_user_verify", zid: true },
  "genshin-impact": { action: "mobentas_user_verify_ganshin", zid: true },
  "genshin-impact-usa": { action: "mobentas_user_verify_ganshin", zid: true },
  "magic-chess-go-go": { action: "mobentas_user_verify_magic", zid: true },
  "farlight-84": { action: "mobentas_user_verify_farlight", zid: false },
  "marvel-rivals": { action: "mobentas_user_verify_marvelrivals", zid: false },
  "brawl-stars": { action: "mobentas_user_verify_brawl", zid: false },
  "clash-of-clans": { action: "mobentas_user_verify_clash", zid: false },
  "clash-royale": { action: "mobentas_user_verify_royale", zid: false },
  "love-and-deepspace": { action: "mobentas_user_verify_love", zid: true },
  "zenless-zone-zero": { action: "mobentas_user_verify_zenless", zid: true },
};

export function verifyCfgForSlug(slug) { return VERIFY_MAP[slug] || null; }
export function isMobentasGame(slug) { return !!VERIFY_MAP[slug]; }

// Verificacion de ID en tiempo real (via proxy CORS, gratis, sin plan).
export async function verificarId(slug, id, server) {
  const cfg = await getMobentasConfig();
  // La verificacion funciona independientemente del flag `enabled` (que solo
  // controla la sincronizacion del catalogo). Basta con que el juego sea
  // verificable.
  const v = VERIFY_MAP[slug];
  if (!v) return { ok: false, offline: true };
  const body = new URLSearchParams({ action: v.action, id: String(id).trim() });
  if (v.zid && server) body.set("zid", String(server).trim());
  const mobUrl = `${String(cfg.base).replace(/\/+$/, "")}/wp-admin/admin-ajax.php`;

  // 1) Proxy dedicado de Cloudflare (confiable, sin dependencias de terceros).
  //    Se configura en Admin → Mobentas → "Proxy URL".
  let r = null;
  if (cfg.proxy) {
    try {
      const proxyBase = String(cfg.proxy).replace(/\/+$/, "");
      const proxyUrl = `${proxyBase}/wp-admin/admin-ajax.php?key=legacy_mobentas_2025`;
      console.log("[mobentas] usando proxy dedicado:", proxyUrl, "body:", body.toString());
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const resp = await fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      console.log("[mobentas] proxy resp:", resp.status, resp.ok);
      if (resp.ok) r = resp;
      else {
        const errText = await resp.text().catch(() => "");
        console.warn("[mobentas] proxy NO ok:", resp.status, errText.substring(0, 300));
      }
    } catch (e) {
      console.warn("[mobentas] proxy dedicado falló:", e?.message || e);
    }
  } else {
    console.warn("[mobentas] NO hay proxy configurado — usando fallback CORS gratuito");
  }

  // 2) Respaldo: proxies CORS gratuitos (menos confiables).
  if (!r) {
    r = await proxiedPost(mobUrl, body.toString());
  }
  if (!r) return { ok: false, error: "Proxy CORS no disponible", offline: true };
  let data;
  try { data = await r.json(); } catch {
    return { ok: false, error: "Respuesta inválida de Mobentas", offline: true };
  }
  // El nickname puede venir en varios campos según el juego; lo buscamos en prioridad.
  const pickNick = (o) => {
    if (!o || typeof o !== "object") return "";
    // Mobentas devuelve el nickname en `response` para la mayoria de juegos.
    const cands = [o.nickname, o.name, o.response, o.usuario, o.player_name, o.user, o.player, o.message, o.result?.nickname, o.result?.name, o.data?.nickname, o.data?.name, o.data?.response];
    return cands.map((v) => (v == null ? "" : String(v).trim())).find((v) => !!v) || "";
  };
  const ERR_RE = /incorrect|not found|inv[aá]lid|menor de|no est|failed|iniciaci|no conect|error|fals/i;
  let nick = typeof data === "string" ? data.trim() : pickNick(data);
  // Si el candidato es en realidad un mensaje de error de Mobentas (ej:
  // "ID incorrect, verifique"), no lo devolvemos como nickname válido.
  if (nick && !ERR_RE.test(nick)) return { ok: true, nickname: nick };
  const resp = String(typeof data === "object" ? (data?.response ?? data?.message ?? "") : data).trim();
  const invalid = ERR_RE.test(resp);
  if (resp && !invalid) return { ok: true, nickname: resp };
  return { ok: false, error: invalid ? resp : (resp || "ID no encontrado") };
}

// ---------- Scraping de denominaciones (USD) desde la pagina del producto ----------
function decodeEntities(s) {
  const AMP = String.fromCharCode(38);
  return s.split(AMP + "quot;").join(String.fromCharCode(34))
          .split(AMP + "#039;").join("'")
          .split(AMP + "#8217;").join("'")
          .split(AMP + "amp;").join(AMP);
}
function humanize(v) {
  return decodeURIComponent(String(v)).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

export async function scrapeDenominations(slug, base = DEFAULTS.base) {
  try {
    // Scrape normal en USD. El scrape en VES (via X-Forwarded-For) devolvía
    // precios con una tasa interna más baja que la del BCV, lo que resultaba
    // en precios por debajo de Mobentas. Ahora scrapeamos en USD y
    // convertimos con la tasa del BCV (getVesRate) que es la misma que
    // usa Mobentas.
    let html = await proxiedGet(`${base}/product/${slug}/`);
    if (!html) return null;
    const m = html.match(/data-product_variations\s*=\s*("|')([\s\S]*?)\1/);
    if (!m) return [];
    let arr;
    try { arr = JSON.parse(decodeEntities(m[2])); } catch { return null; }
    if (!Array.isArray(arr)) return null;
    // Detectamos la moneda real que entregó Mobentas: cors.sh reenvía la IP
    // del navegador; si es VE, Mobentas responde en Bs y multiplicar después
    // por la tasa del admin inflaría los precios ~800×.
    const symSample = (arr[0]?.price_html || "") + (arr[arr.length - 1]?.price_html || "");
    const sym = symSample.match(/Price-currencySymbol[^>]*>([^<]+)/)?.[1] || "";
    const currencyIsBs = /bs/i.test(sym);
    let smallest = Infinity;
    const denoms = [];
    for (const v of arr) {
      const vals = Object.values(v.attributes || {}).map((x) => humanize(x)).filter(Boolean);
      const label = vals.join(" - ") || `Paquete ${v.variation_id || ""}`;
      const price = Number(v.display_price ?? v.display_regular_price ?? 0);
      if (price && price < smallest) smallest = price;
      if (label && price > 0) denoms.push({ label, price: Number(price.toFixed(2)) });
    }
    // Heurística: si el símbolo es "Bs" o el paquete más barato cuesta ≥ 100
    // (Mobentas rara vez pasa de $80 USD), el scrape llegó en Bs ya convertidos.
    let alreadyBs = currencyIsBs || (smallest !== Infinity && smallest >= 100);
    // Mantenemos los precios en Bs tal cual — NO convertir a USD y de vuelta a
    // Bs. La doble conversión (Bs→USD con BCV, luego USD→Bs con paralelo)
    // infla los precios por la brecha entre BCV y paralelo (~13%). El markup
    // se aplica directamente sobre el precio en Bs que cobra Mobentas.
    denoms.forEach((d) => { d.already_bs = alreadyBs; });
    return denoms;
  } catch {
    return null;
  }
}

// ---------- Sincronizacion del catalogo (admin) en tiempo real ----------
export async function syncCatalogAdmin() {
  const cfg = await getMobentasConfig();
  const raw = await proxiedGet(`${cfg.base}/wp-json/wc/store/products?per_page=100&_fields=id,name,slug,images,type`);
  if (!raw) return { ok: false, error: "No se pudo conectar a Mobentas (proxy CORS)" };
  let arr;
  try { arr = JSON.parse(raw); } catch { return { ok: false, error: "Respuesta inválida de Mobentas" }; }
  const mob = (arr || []).map((p) => ({ slug: p.slug, name: p.name, img: p.images?.[0]?.src || "" }));
  const mobSlugs = new Set(mob.map((m) => m.slug));
  const existing = await base44.entities.Game.list("-updated_date", 200);
  const bySlug = new Map(existing.map((g) => [g.slug, g]));
  let created = 0, updated = 0, failed = 0;
  for (const m of mob) {
    const denoms = await scrapeDenominations(m.slug, cfg.base);
    const v = VERIFY_MAP[m.slug];
    const cur = bySlug.get(m.slug);
    const prevConfig = cur?.config || {};
    // Si el scrape no trajo denoms, NO pisamos las que ya estaban en la DB.
    const realDenoms = denoms && denoms.length ? denoms : (prevConfig.denominations || []);
    const config = {
      denominations: realDenoms.map((d) => ({ label: d.label, price: Number((d.price * (1 + cfg.markup / 100)).toFixed(2)) })),
      requiresPlayerId: !!v, requiresServer: !!v?.zid,
      idLabel: v ? "ID de jugador" : "", idHint: v && v.zid ? "Incluye el ID de zona." : "",
      currency: cfg.currency, synced: (denoms || []).length > 0,
      last_synced_at: (denoms || []).length > 0 ? new Date().toISOString() : (prevConfig.last_synced_at || ""),
    };
    try {
      if (cur) { await base44.entities.Game.update(cur.id, { name: m.name, image_url: m.img, config }); updated++; }
      else { await base44.entities.Game.create({ name: m.name, slug: m.slug, image_url: m.img, category: "Juego", badge: "", description: "", config }); created++; }
    } catch { failed++; }
  }
  const gone = existing.filter((g) => !mobSlugs.has(g.slug));
  if (gone.length) {
    try { await base44.entities.Game.deleteMany({ id: { $in: gone.map((g) => g.id) } }); } catch {}
  }
  return { ok: true, total: mob.length, created, updated, deleted: gone.length, failed };
}

// Lista del catálogo de Mobentas (1 sola petición, sin scrapear denominaciones
// por producto). Rápido y apto para sincronización silenciosa del storefront.
export async function getMobentasProductList(base = DEFAULTS.base) {
  const raw = await proxiedGet(`${base}/wp-json/wc/store/products?per_page=100&_fields=id,name,slug,images,type`);
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    return (arr || []).map((p) => ({ slug: p.slug, name: p.name, img: p.images?.[0]?.src || "" }));
  } catch { return null; }
}

// Sincronización LIGERA del catálogo (sólo lista, sin scrapear denominaciones por
// producto): crea juegos nuevos en Mobentas, elimina los que ya no existen, y
// actualiza nombre/imagen. Las denominaciones se cargan EN VIVO en /comprar/:slug.
// Throttle por el Setting "mobentas_list_last_sync" (por defecto cada 30 min).
export async function syncListIfStale(maxAgeMs = 30 * 60 * 1000) {
  try {
    const recs = await base44.entities.Setting.filter({ key: "mobentas_list_last_sync" });
    const last = recs?.[0];
    const ts = last?.value ? Number(last.value) : 0;
    if (ts && Date.now() - ts < maxAgeMs) return { skipped: true };
    const cfg = await getMobentasConfig();
    const list = await getMobentasProductList(cfg.base);
    if (!list) return { ok: false, error: "No se pudo conectar a Mobentas" };
    const mobSlugs = new Set(list.map((m) => m.slug));
    const existing = await base44.entities.Game.list("-updated_date", 200);
    const bySlug = new Map(existing.map((g) => [g.slug, g]));
    let created = 0, updated = 0, failed = 0;
    for (const m of list) {
      const cur = bySlug.get(m.slug);
      try {
        if (cur) {
          const nameChanged = cur.name !== m.name;
          const imgChanged = m.img && cur.image_url !== m.img;
          if (nameChanged || imgChanged) {
            await base44.entities.Game.update(cur.id, { name: m.name, image_url: m.img || cur.image_url });
            updated++;
          }
        } else {
          await base44.entities.Game.create({
            name: m.name, slug: m.slug, image_url: m.img,
            category: "Juego", badge: "", description: "",
            config: { denominations: [], requiresPlayerId: true, synced: false },
          });
          created++;
        }
      } catch { failed++; }
    }
    const gone = existing.filter((g) => !mobSlugs.has(g.slug));
    if (gone.length) {
      try { await base44.entities.Game.deleteMany({ id: { $in: gone.map((g) => g.id) } }); } catch {}
    }
    const value = String(Date.now());
    if (last?.id) await base44.entities.Setting.update(last.id, { value });
    else await base44.entities.Setting.create({ key: "mobentas_list_last_sync", value });
    return { ok: true, total: list.length, created, updated, deleted: gone.length, failed };
  } catch {
    return { ok: false, error: "syncListIfStale falló" };
  }
}

// Sincronización automática y silenciosa cuando un admin abre el panel.
// Throttle por el Setting "mobentas_last_sync" (por defecto cada 6 h).
export async function autoSyncIfStale(maxAgeMs = 6 * 60 * 60 * 1000) {
  try {
    const recs = await base44.entities.Setting.filter({ key: "mobentas_last_sync" });
    const last = recs?.[0];
    const ts = last?.value ? Number(last.value) : 0;
    if (ts && Date.now() - ts < maxAgeMs) return { skipped: true };
    const res = await syncCatalogAdmin();
    if (res?.ok) {
      const value = String(Date.now());
      if (last?.id) await base44.entities.Setting.update(last.id, { value });
      else await base44.entities.Setting.create({ key: "mobentas_last_sync", value });
    }
    return res;
  } catch {
    return { ok: false, error: "auto-sync falló" };
  }
}