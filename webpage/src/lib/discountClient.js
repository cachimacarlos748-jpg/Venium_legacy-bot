import { base44 } from "@/api/base44Client";
import { getCommissionConfig, DEFAULT_DISCOUNT_PERCENT } from "@/lib/creatorCommission";

const Setting = base44.entities.Setting;
const Creator = base44.entities.Creator;
const Order = base44.entities.Order;

// Estados que NO cuentan como "ya compró". Un pedido cancelado, rechazado o
// expirado no debe quitarle el derecho a un código de primera compra.
const UNPAID_STATUSES = ["cancelled", "canceled", "failed", "expired", "rejected", "partial_payment"];

/**
 * ¿Esta persona ya ha comprado antes?
 *
 * Se busca por Player ID (lo más fiable: identifica la cuenta del juego) y, si
 * no hay ID porque el producto no lo pide, por email. Cualquier pedido que no
 * esté cancelado cuenta como compra previa.
 *
 * Devuelve { isNew, matchedBy, previousOrders }.
 * Si la consulta falla devuelve isNew: true para no bloquear una venta por un
 * error de red: es preferible dejar pasar un código de más que perder una venta.
 */
export async function isNewCustomer({ playerId, email } = {}) {
  const pid = String(playerId || "").trim();
  const mail = String(email || "").trim().toLowerCase();

  if (!pid && !mail) {
    return {
      isNew: false,
      matchedBy: null,
      previousOrders: 0,
      error: "Verifica tu ID o correo para comprobar si eres un cliente nuevo",
    };
  }

  const matches = [];

  if (pid) {
    try {
      const list = await Order.filter({ player_id: pid });
      if (Array.isArray(list)) matches.push(...list);
    } catch { /* sin ID no hay nada que comparar */ }
  }

  if (mail) {
    try {
      const list = await Order.filter({ customer_email: mail });
      if (Array.isArray(list)) matches.push(...list);
    } catch { /* sin correo seguimos con lo que ya tenemos */ }
  }

  // Deduplica: el mismo pedido puede salir por ID y por email.
  const paid = matches.filter((o) => !UNPAID_STATUSES.includes(String(o?.status || "").toLowerCase()));

  return {
    isNew: paid.length === 0,
    matchedBy: paid.length ? (pid && matches.some((o) => o?.player_id === pid) ? "player_id" : "email") : null,
    previousOrders: paid.length,
  };
}

/**
 * Valida un código de descuento ingresado por el cliente.
 *
 * Busca en dos lugares:
 * 1. Setting con clave `discount_<CODE>` (códigos creados por admin)
 * 2. Entidad Creator con campo `code` (códigos creados por el propio creador)
 *
 * Los códigos marcados con `new_customer_only` (los que se reparten en
 * publicidad, como HOKAGE5) solo funcionan para quien nunca ha comprado: si el
 * cliente ya tiene pedidos, se devuelve { error, reason: "not_new" }.
 *
 * Devuelve { applied, kind, value, code, label, currency, creator_id } o { error }.
 */
export async function validateDiscountCode(rawCode, context = {}) {
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

    // Código exclusivo de primera compra (los que van en la publicidad).
    if (cfg.new_customer_only) {
      const check = await isNewCustomer(context);
      if (check.error) return { error: check.error, reason: "need_identity" };
      if (!check.isNew) {
        return {
          error: cfg.not_new_message ||
            "Este código es solo para tu primera compra. Como ya tienes pedidos con nosotros, no se puede aplicar.",
          reason: "not_new",
          previousOrders: check.previousOrders,
        };
      }
    }

    return {
      applied: true, kind, value, code,
      label: cfg.label || `${value}${kind === "percent" ? "%" : " Bs"} off`,
      currency: cfg.currency || null,
      creator_id: cfg.creator_id || null,
      new_customer_only: !!cfg.new_customer_only,
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