import { base44 } from "@/api/base44Client";
import { getCommissionConfig, DEFAULT_DISCOUNT_PERCENT } from "@/lib/creatorCommission";

const Setting = base44.entities.Setting;
const Creator = base44.entities.Creator;

/**
 * Valida un código de descuento ingresado por el cliente.
 *
 * Busca en dos lugares:
 * 1. Setting con clave `discount_<CODE>` (códigos creados por admin)
 * 2. Entidad Creator con campo `code` (códigos creados por el propio creador)
 *
 * Devuelve { applied, kind, value, code, label, currency, creator_id } o { error }.
 */
export async function validateDiscountCode(rawCode) {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!code) return { error: "Ingresa un código" };

  // 1) Buscar en Setting (códigos administrados)
  let rec = null;
  try {
    const recs = await Setting.filter({ key: `discount_${code}` });
    rec = recs?.[0];
  } catch {
    return { error: "No se pudo validar el código ahora" };
  }

  if (rec?.value) {
    let cfg;
    try { cfg = JSON.parse(rec.value); }
    catch { return { error: "Código inválido (formato)" }; }

    const kind = cfg.kind === "fixed" ? "fixed" : "percent";
    const value = Number(cfg.value) || 0;
    if (value <= 0) return { error: "Código inválido" };

    return {
      applied: true, kind, value, code,
      label: cfg.label || `${value}${kind === "percent" ? "%" : " Bs"} off`,
      currency: cfg.currency || null,
      creator_id: cfg.creator_id || null,
    };
  }

  // 2) Buscar en Creator (códigos creados por creadores aprobados)
  try {
    const creators = await Creator.filter({ code, status: "approved" });
    const creator = creators?.[0];
    if (creator) {
      const cfg = await getCommissionConfig();
      const pct = cfg.discount_percent || DEFAULT_DISCOUNT_PERCENT;
      return {
        applied: true, kind: "percent", value: pct, code,
        label: `${pct}% de descuento · Código de creador`,
        currency: null,
        creator_id: creator.id,
      };
    }
  } catch {}

  return { error: "Código inválido o expirado" };
}

/** Aplica el descuento sobre el total. Devuelve { discountAmount, total }. */
export function computeDiscount(fullTotal, discount) {
  if (!discount || !discount.applied) return { discountAmount: 0, total: fullTotal };
  let amt = 0;
  if (discount.kind === "percent") amt = +(fullTotal * discount.value / 100).toFixed(2);
  else amt = +Number(discount.value).toFixed(2);
  if (amt > fullTotal) amt = fullTotal;
  if (amt < 0) amt = 0;
  return { discountAmount: amt, total: +(fullTotal - amt).toFixed(2) };
}