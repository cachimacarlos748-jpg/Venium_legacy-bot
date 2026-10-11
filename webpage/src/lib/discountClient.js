import { base44 } from "@/api/base44Client";
import { getCommissionConfig, DEFAULT_DISCOUNT_PERCENT } from "@/lib/creatorCommission";
import { normalizeLabel } from "@/utils/normalizeLabel";

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
  const mail = String(email || "").toLowerCase().trim();

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
 * Códigos de MONTO FIJO (`kind: "fixed"`) — dos modos:
 *  - `mode: "discount"` (por defecto): el monto se RESTA del total del pedido.
 *  - `mode: "price"`: el monto es el PRECIO FINAL del paquete al que se aplica
 *    (ej: el paquete de 110 diamantes queda en 760 Bs con ese código).
 *
 * El alcance `applies_to_packages` (array de labels de paquete) limita el
 * código a esos paquetes concretos; así un monto fijo no toca los demás
 * productos. La comparación es normalizada (sin acentos ni mayúsculas).
 * En modo `price` el alcance es obligatorio: un precio fijo sin paquete no
 * tiene sentido porque aplicaría a cualquier producto.
 *
 * Los códigos marcados con `new_customer_only` (los que se reparten en
 * publicidad, como HOKAGE5) solo funcionan para quien nunca ha comprado: si el
 * cliente ya tiene pedidos, se devuelve { error, reason: "not_new" }.
 *
 * Devuelve { applied, kind, mode, value, code, label, currency, creator_id } o { error }.
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
    const mode = kind === "fixed" && cfg.mode === "price" ? "price" : "discount";
    const value = Number(cfg.value) || 0;
    if (value <= 0) return { error: "Código inválido" };

    const scopeLabel = typeof context?.denominationLabel === "string" ? context.denominationLabel.trim() : "";
    const appliesToPackages = Array.isArray(cfg.applies_to_packages)
      ? cfg.applies_to_packages.map((x) => String(x || "").trim()).filter(Boolean)
      : [];

    // Un precio fijo SIEMPRE va atado a paquetes concretos. Sin alcance no se
    // aplica: mejor rechazarlo que dejar que pise el precio de todo el catálogo.
    if (mode === "price" && !appliesToPackages.length) {
      return { error: "Este código no está configurado correctamente" };
    }

    // Alcance por paquete (montos fijos): el código solo sirve en su paquete.
    // El contexto trae el label del paquete y el nombre del juego para que una
    // entrada "Juego · Paquete" no se cruce con otro juego de igual paquete.
    if (kind === "fixed" && appliesToPackages.length) {
      if (!scopeLabel) {
        return { error: "Este código no se puede validar para el paquete seleccionado" };
      }
      const matchesScope = matchesDiscountScope(appliesToPackages, {
        denominationLabel: scopeLabel,
        productLabel: context?.productLabel,
      });
      if (!matchesScope) {
        return { error: "Este código solo aplica al paquete: " + appliesToPackages.join(", ") };
      }
    }

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
      applied: true, kind, mode, value, code,
      label: cfg.label || defaultLabel(kind, mode, value, cfg.currency),
      currency: cfg.currency || null,
      creator_id: cfg.creator_id || null,
      new_customer_only: !!cfg.new_customer_only,
      applies_to_packages: appliesToPackages,
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
        applied: true, kind: "percent", mode: "discount", value: pct, code,
        label: `${pct}% de descuento · Código de creador`,
        currency: null,
        creator_id: creator.id,
        applies_to_packages: [],
      };
    }
  } catch {}

  return { error: "Código inválido o expirado" };
}

/**
 * ¿El alcance del código cubre el paquete actual?
 *
 * Las entradas del alcance pueden venir de dos formas:
 *  - "110 Diamantes"                → aplica a ese label en cualquier juego.
 *  - "Free Fire · 110 Diamantes"    → aplica SOLO a ese paquete de ese juego
 *    (así un precio fijo de Free Fire no toca un paquete con el mismo nombre
 *    en otro juego).
 *
 * Sin alcance devuelve true (el código aplica a todo). Sin label de paquete
 * devuelve false: no hay nada que comparar.
 */
export function matchesDiscountScope(scopeList, { denominationLabel, productLabel } = {}) {
  const list = Array.isArray(scopeList) ? scopeList.filter(Boolean) : [];
  if (!list.length) return true;
  const label = String(denominationLabel || "").trim();
  if (!label) return false;
  const product = String(productLabel || "").trim();
  const nl = normalizeLabel(label);
  const np = normalizeLabel(product);
  return list.some((entry) => {
    const e = String(entry || "").trim();
    if (!e) return false;
    if (e.includes("·")) {
      const [g, l] = e.split("·");
      return !!product && normalizeLabel(g) === np && normalizeLabel(l) === nl;
    }
    return normalizeLabel(e) === nl;
  });
}

function defaultLabel(kind, mode, value, currency) {
  if (kind === "percent") return `${value}% de descuento`;
  if (mode === "price") return `Precio especial: ${value} ${currency || "Bs"}`;
  return `${value} ${currency || "Bs"} de descuento`;
}

/**
 * Aplica el código sobre el total del pedido. Devuelve
 * { discountAmount, total, isPriceOverride }.
 *
 * - `mode: "price"` → el total del paquete queda EXACTAMENTE en el monto del
 *   código (ej: 760 Bs). El "descuento" mostrado es la diferencia contra el
 *   precio de catálogo, para que el cliente vea cuánto ahorra.
 * - `mode: "discount"` → resta el monto del total (comportamiento de siempre).
 */
export function computeDiscount(fullTotal, discount) {
  const base = +Number(fullTotal || 0).toFixed(2);
  if (!discount || !discount.applied) return { discountAmount: 0, total: base, isPriceOverride: false };

  // Precio fijo: el paquete se paga al monto del código.
  if (discount.mode === "price") {
    const price = +Number(discount.value).toFixed(2);
    if (price <= 0) return { discountAmount: 0, total: base, isPriceOverride: false };
    const diff = +(base - price).toFixed(2);
    return {
      discountAmount: diff > 0 ? diff : 0,
      total: price,
      isPriceOverride: true,
    };
  }

  let amt = 0;
  if (discount.kind === "percent") amt = +(base * discount.value / 100).toFixed(2);
  else amt = +Number(discount.value).toFixed(2);
  if (amt > base) amt = base;
  if (amt < 0) amt = 0;
  return { discountAmount: amt, total: +(base - amt).toFixed(2), isPriceOverride: false };
}
