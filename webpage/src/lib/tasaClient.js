// Cliente de tasa VES/USD (Bs por dólar).
// Trae la tasa paralela desde DolarApi (ve.dolarapi.com) y permite
// que el admin la fije manualmente via Setting "conversion_rate".

import { base44 } from "@/api/base44Client";
import { getVeniumConfig } from "@/lib/veniumClient";

let _ratesCache = { paralelo: 0, bcv: 0, ts: 0 };

// Obtiene las tasas VES/USD desde DolarApi (ve.dolarapi.com).
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

// Tasa paralela (mercado paralelo).
export async function getVesRate() {
  const r = await fetchVesRates();
  return r.paralelo || 0;
}

// Tasa del BCV.
export async function getBcvRate() {
  const r = await fetchVesRates();
  return r.bcv || r.paralelo || 0;
}

// Cache de la tasa automática de Venium (Binance P2P + spread).
let _veniumAutoCache = { rate: 0, ts: 0 };
const VENIUM_AUTO_TTL = 30 * 60 * 1000; // 30 min

// Trae la tasa USDT P2P de Binance Venezuela vía el Worker y le suma el
// spread configurado en Venium (rate_spread). Así se aproxima a lo que
// Venium cobra al recargar la wallet, sin que el admin la actualice a mano.
async function getVeniumAutoRate() {
  if (_veniumAutoCache.rate > 0 && Date.now() - _veniumAutoCache.ts < VENIUM_AUTO_TTL) {
    return _veniumAutoCache.rate;
  }
  const cfg = await getVeniumConfig();
  if (!cfg.proxy_url) return 0;
  try {
    const base = cfg.proxy_url.replace(/\/+$/, "");
    const url = new URL(base + "/rate");
    url.searchParams.set("key", cfg.auth_key);
    const r = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return 0;
    const data = await r.json();
    const binanceRate = Number(data?.rate) || 0;
    if (binanceRate <= 0) return 0;
    const spread = Number(cfg.rate_spread) || 0;
    const rate = +(binanceRate * (1 + spread / 100)).toFixed(2);
    _veniumAutoCache = { rate, ts: Date.now() };
    return rate;
  } catch {
    return 0;
  }
}

// Tasa Bs/USD: prioridad
//   1) Tasa manual de Venium (venium_rate) — si el admin la fija.
//   2) Tasa automática: Binance P2P + spread (rate_spread) — sin tocar nada.
//   3) Setting "conversion_rate" (manual legacy).
//   4) Tasa automática del paralelo (DolarApi).
export async function getTasa() {
  try {
    const vcfg = await getVeniumConfig();
    if (vcfg?.venium_rate && Number(vcfg.venium_rate) > 0) {
      return Number(vcfg.venium_rate);
    }
    const auto = await getVeniumAutoRate();
    if (auto > 0) return auto;
  } catch {}
  try {
    const recs = await base44.entities.Setting.filter({ key: "conversion_rate" });
    const v = recs?.[0]?.value;
    if (v) return Number(v) || 0;
  } catch {}
  const vesRate = await getVesRate();
  return vesRate || 0;
}