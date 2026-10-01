import { base44 } from "@/api/base44Client";
import { sendWhatsAppMessage, getAdminNumber } from "@/lib/whatsappClient";

const Setting = base44.entities.Setting;
const Creator = base44.entities.Creator;

// Comisión: 2% del valor de la venta, con tope de 100 Bs.
export const COMMISSION_RATE = 0.02;
export const COMMISSION_CAP = 100;
export const DEFAULT_PAYOUT_THRESHOLD = 100;
export const DEFAULT_DISCOUNT_PERCENT = 2;

/**
 * Lee la configuración de comisiones desde Setting.
 * Keys: creator_commission_config (JSON con rate, cap, threshold, discount_percent)
 */
export async function getCommissionConfig() {
  try {
    const recs = await Setting.filter({ key: "creator_commission_config" });
    const raw = recs?.[0]?.value;
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    rate: COMMISSION_RATE,
    cap: COMMISSION_CAP,
    threshold: DEFAULT_PAYOUT_THRESHOLD,
    discount_percent: DEFAULT_DISCOUNT_PERCENT,
  };
}

/**
 * Guarda la configuración de comisiones en Setting.
 */
export async function saveCommissionConfig(cfg) {
  const existing = await Setting.filter({ key: "creator_commission_config" });
  const value = JSON.stringify({
    rate: cfg.rate ?? COMMISSION_RATE,
    cap: cfg.cap ?? COMMISSION_CAP,
    threshold: cfg.threshold ?? DEFAULT_PAYOUT_THRESHOLD,
    discount_percent: cfg.discount_percent ?? DEFAULT_DISCOUNT_PERCENT,
  });
  if (existing?.length) {
    await Setting.update(existing[0].id, { value });
  } else {
    await Setting.create({ key: "creator_commission_config", value });
  }
}

/**
 * Calcula la comisión para un monto de venta.
 * 2% del precio, con tope de COMMISSION_CAP.
 */
export function calculateCommission(saleAmount, rate = COMMISSION_RATE, cap = COMMISSION_CAP) {
  const amt = Number(saleAmount) || 0;
  const raw = amt * rate;
  return Math.min(raw, cap);
}

/**
 * Vincula el código de un creador con el sistema de descuentos.
 * Crea (o actualiza) un registro en Setting con key `discount_<CODE>`
 * que incluye creator_id en el JSON para identificar al creador dueño.
 *
 * El descuento al cliente es el porcentaje configurado (default 2%).
 */
export async function linkCreatorDiscountCode(creator, discountPercent) {
  if (!creator?.code) return;
  const code = creator.code.trim().toUpperCase();
  if (!code) return;

  const cfg = await getCommissionConfig();
  const pct = discountPercent ?? cfg.discount_percent ?? DEFAULT_DISCOUNT_PERCENT;

  const key = `discount_${code}`;
  const value = JSON.stringify({
    kind: "percent",
    value: pct,
    label: `${pct}% de descuento · Código de creador`,
    creator_id: creator.id,
    creator_email: creator.email,
  });

  const existing = await Setting.filter({ key });
  if (existing?.length) {
    await Setting.update(existing[0].id, { value });
  } else {
    await Setting.create({ key, value });
  }
}

/**
 * Busca el creador dueño de un código de descuento.
 * Primero busca en Setting (códigos creados por admin), luego en Creator (códigos creados por el creador).
 * Devuelve el registro Creator o null.
 */
export async function findCreatorByCode(code) {
  if (!code) return null;
  const normalized = String(code).trim().toUpperCase();
  try {
    // 1) Buscar en Setting (códigos vinculados por admin)
    const recs = await Setting.filter({ key: `discount_${normalized}` });
    const rec = recs?.[0];
    if (rec?.value) {
      const cfg = JSON.parse(rec.value);
      if (cfg.creator_id) {
        const creators = await Creator.filter({ id: cfg.creator_id });
        if (creators?.[0]) return creators[0];
      }
    }
    // 2) Buscar directamente en Creator (códigos creados por el propio creador)
    const creators = await Creator.filter({ code: normalized, status: "approved" });
    if (creators?.[0]) return creators[0];
  } catch {}
  return null;
}

/**
 * Verifica si un código ya está en uso por otro creador.
 */
export async function isCodeAvailable(code, excludeCreatorId) {
  const normalized = String(code).trim().toUpperCase();
  if (!normalized) return false;
  try {
    const creators = await Creator.filter({ code: normalized });
    if (creators?.some((c) => c.id !== excludeCreatorId)) return false;
    // También verificar en Setting por si hay un código de descuento admin con ese nombre
    const settings = await Setting.filter({ key: `discount_${normalized}` });
    if (settings?.length) {
      const cfg = settings[0].value ? JSON.parse(settings[0].value) : {};
      if (cfg.creator_id && cfg.creator_id !== excludeCreatorId) return false;
    }
  } catch {
    return false;
  }
  return true;
}

/**
 * Crea o actualiza el código de un creador.
 * Verifica disponibilidad, actualiza el Creator y vincula el descuento.
 */
export async function setCreatorCode(creatorId, newCode) {
  const creators = await Creator.filter({ id: creatorId });
  const creator = creators?.[0];
  if (!creator) throw new Error("Creador no encontrado");

  const code = String(newCode).trim().toUpperCase();
  if (code.length < 3) throw new Error("El código debe tener al menos 3 caracteres");
  if (!/^[A-Z0-9]+$/.test(code)) throw new Error("El código solo puede tener letras y números");

  const available = await isCodeAvailable(code, creatorId);
  if (!available) throw new Error("Ese código ya lo usa otro creador");

  // Si tenía un código anterior, desvincular el descuento viejo
  if (creator.code && creator.code !== code) {
    try {
      const oldSettings = await Setting.filter({ key: `discount_${creator.code}` });
      if (oldSettings?.length) {
        await Setting.delete(oldSettings[0].id);
      }
    } catch {}
  }

  await Creator.update(creatorId, { code });
  // Intentar vincular el descuento en Setting (solo funciona si el usuario es admin).
  // Si falla por permisos, no hay problema: validateDiscountCode también busca en Creator.
  try {
    const updated = { ...creator, code };
    await linkCreatorDiscountCode(updated);
  } catch {}
  return { code };
}

/**
 * Registra el uso de un código de creador inmediatamente cuando se crea una orden.
 * Incrementa total_code_uses y agrega una entrada "order_pending" al commission_log.
 * NO acredita el balance — eso ocurre cuando la orden se completa (creditCommission).
 *
 * Esto permite que el creador vea que su código fue usado incluso antes de que
 * la orden se procese.
 */
export async function logCodeUsage(order) {
  if (!order?.discount_code) return null;

  const creator = await findCreatorByCode(order.discount_code);
  if (!creator) return null;

  // Evitar duplicados: si ya existe una entrada con el mismo order_id, no registrar de nuevo
  const existingLog = (creator.commission_log || []).find(
    (c) => c.order_id === String(order.id || "")
  );
  if (existingLog) return null;

  const cfg = await getCommissionConfig();
  const commission = calculateCommission(order.price, cfg.rate, cfg.cap);

  const entry = {
    order_id: String(order.id || ""),
    customer: order.customer_email || order.customer_whatsapp || "",
    product: order.product_name || "",
    sale_amount: Number(order.price) || 0,
    commission: +commission.toFixed(2),
    date: new Date().toISOString(),
    status: "order_pending", // order_pending = orden creada, comisión no ganada aún
  };

  const newUses = (creator.total_code_uses || 0) + 1;
  const log = [...(creator.commission_log || []), entry];

  await Creator.update(creator.id, {
    total_code_uses: newUses,
    commission_log: log,
  });

  return { creator_id: creator.id };
}

/**
 * Acredita la comisión al creador cuando una orden se completa.
 * Busca la entrada existente "order_pending" en commission_log (creada por logCodeUsage)
 * y la promueve a "pending" (comisión ganada, pendiente de pago), agregando el monto al balance.
 * Si no existe entrada previa (orden anterior a logCodeUsage), la crea y acredita.
 */
export async function creditCommission(order) {
  if (!order?.discount_code) return null;
  if (order.status !== "completed") return null;

  const creator = await findCreatorByCode(order.discount_code);
  if (!creator) return null;

  const cfg = await getCommissionConfig();
  const commission = calculateCommission(order.price, cfg.rate, cfg.cap);
  if (commission <= 0) return null;

  const log = [...(creator.commission_log || [])];
  const existingIdx = log.findIndex(
    (c) => c.order_id === String(order.id || "")
  );

  if (existingIdx >= 0) {
    const existing = log[existingIdx];
    // Ya fue acreditada o pagada — no duplicar
    if (existing.status === "pending" || existing.status === "paid") return null;
    // Promover de "order_pending" a "pending" (comisión ganada)
    log[existingIdx] = { ...existing, status: "pending" };
    const newBalance = +((creator.balance || 0) + commission).toFixed(2);
    await Creator.update(creator.id, {
      balance: newBalance,
      commission_log: log,
    });
    return { creator_id: creator.id, commission, newBalance };
  }

  // No existe entrada previa — crear y acreditar (compat con órdenes antiguas)
  const entry = {
    order_id: String(order.id || ""),
    customer: order.customer_email || order.customer_whatsapp || "",
    product: order.product_name || "",
    sale_amount: Number(order.price) || 0,
    commission: +commission.toFixed(2),
    date: new Date().toISOString(),
    status: "pending",
  };

  const newBalance = +((creator.balance || 0) + commission).toFixed(2);
  const newUses = (creator.total_code_uses || 0) + 1;
  log.push(entry);

  await Creator.update(creator.id, {
    balance: newBalance,
    total_code_uses: newUses,
    commission_log: log,
  });

  return { creator_id: creator.id, commission, newBalance };
}

/**
 * Cancela una comisión cuando una orden se cancela.
 * Si la comisión estaba "order_pending" (no ganada), la marca como "cancelled".
 * Si ya estaba "pending" (ganada y en balance), la marca como "cancelled" y descuenta del balance.
 */
export async function cancelCommission(order) {
  if (!order?.discount_code) return null;

  const creator = await findCreatorByCode(order.discount_code);
  if (!creator) return null;

  const log = [...(creator.commission_log || [])];
  const idx = log.findIndex((c) => c.order_id === String(order.id || ""));
  if (idx < 0) return null;

  const entry = log[idx];
  if (entry.status === "cancelled" || entry.status === "paid") return null;

  const wasEarned = entry.status === "pending";
  log[idx] = { ...entry, status: "cancelled" };

  const updates = { commission_log: log };
  if (wasEarned) {
    updates.balance = +Math.max(0, (creator.balance || 0) - (entry.commission || 0)).toFixed(2);
  }

  await Creator.update(creator.id, updates);
  return { cancelled: true };
}

/**
 * Marca un pago (payout) como realizado al creador.
 * Registra la transferencia en payout_log y descuenta del balance.
 */
export async function registerPayout(creatorId, { amount, method, reference }) {
  const creators = await Creator.filter({ id: creatorId });
  const creator = creators?.[0];
  if (!creator) return null;

  const amt = +Number(amount).toFixed(2);
  const payout = {
    amount: amt,
    date: new Date().toISOString(),
    method: method || "Pago Móvil",
    reference: reference || "",
    status: "paid",
  };

  const newBalance = +Math.max(0, (creator.balance || 0) - amt).toFixed(2);
  const payoutLog = [...(creator.payout_log || []), payout];

  // Marcar comisiones como pagadas (las más antiguas hasta cubrir el monto)
  let remaining = amt;
  const updatedCommLog = (creator.commission_log || []).map((c) => {
    if (remaining <= 0) return c;
    if (c.status === "pending") {
      remaining = +(remaining - c.commission).toFixed(2);
      return { ...c, status: "paid" };
    }
    return c;
  });

  await Creator.update(creator.id, {
    balance: newBalance,
    commission_log: updatedCommLog,
    payout_log: payoutLog,
  });

  return { newBalance, payout };
}

/**
 * Creador solicita un retiro. Se agrega a withdrawal_requests con status "pending".
 * El admin debe aprobarlo y ejecutar la transferencia.
 */
export async function requestWithdrawal(creatorId, { amount, method, bank_info }) {
  const creators = await Creator.filter({ id: creatorId });
  const creator = creators?.[0];
  if (!creator) throw new Error("Creador no encontrado");

  const cfg = await getCommissionConfig();
  const amt = +Number(amount).toFixed(2);
  const threshold = cfg.threshold || DEFAULT_PAYOUT_THRESHOLD;

  if (amt < threshold) throw new Error(`El monto mínimo de retiro es ${threshold} Bs`);
  if (amt > (creator.balance || 0)) throw new Error("No tienes suficiente balance disponible");

  // Verificar que no haya solicitudes pendientes
  const pending = (creator.withdrawal_requests || []).filter((r) => r.status === "pending");
  if (pending.length > 0) throw new Error("Ya tienes una solicitud de retiro pendiente. Espera a que el admin la procese.");

  const req = {
    id: `WR-${Date.now()}`,
    amount: amt,
    method: method || "Pago Móvil",
    bank_info: bank_info || "",
    date: new Date().toISOString(),
    status: "pending",
  };

  const requests = [...(creator.withdrawal_requests || []), req];
  await Creator.update(creatorId, { withdrawal_requests: requests });

  // Notificar al admin por WhatsApp
  try {
    const adminNum = await getAdminNumber();
    if (adminNum) {
      const msg = [
        "💸 *Nueva solicitud de retiro — Creador*",
        "",
        `👤 Creador: ${creator.name || "—"}`,
        `📧 ${creator.email || "—"}`,
        `💰 Monto: ${amt.toFixed(2)} Bs`,
        `🏦 Método: ${method || "Pago Móvil"}`,
        `📋 Datos: ${bank_info || "—"}`,
        `🆔 Solicitud: ${req.id}`,
      ].join("\n");
      await sendWhatsAppMessage(adminNum, msg);
    }
  } catch {}

  return req;
}

/**
 * Admin procesa una solicitud de retiro.
 * Si se aprueba: registra el payout (descuenta balance) y marca la solicitud como approved.
 * Si se rechaza: marca la solicitud como rejected sin tocar el balance.
 */
export async function processWithdrawalRequest(creatorId, requestId, approved, adminNote = "") {
  const creators = await Creator.filter({ id: creatorId });
  const creator = creators?.[0];
  if (!creator) throw new Error("Creador no encontrado");

  const requests = (creator.withdrawal_requests || []).map((r) => {
    if (r.id === requestId) {
      return {
        ...r,
        status: approved ? "approved" : "rejected",
        admin_note: adminNote,
        processed_date: new Date().toISOString(),
      };
    }
    return r;
  });

  await Creator.update(creatorId, { withdrawal_requests: requests });

  if (approved) {
    const req = (creator.withdrawal_requests || []).find((r) => r.id === requestId);
    if (req) {
      await registerPayout(creatorId, {
        amount: req.amount,
        method: req.method,
        reference: req.id,
      });
      // Notificar al creador que su retiro fue aprobado
      try {
        const num = String(creator.whatsapp || "").replace(/\D/g, "");
        if (num) {
          const msg = [
            "✅ *¡Retiro aprobado!* — Legacy Store",
            "",
            `💰 Monto: ${req.amount.toFixed(2)} Bs`,
            `🏦 Método: ${req.method}`,
            "",
            "Tu pago fue procesado. ¡Gracias por ser parte de Legacy Store! 🎮",
          ].join("\n");
          await sendWhatsAppMessage(num, msg);
        }
      } catch {}
    }
  } else {
    // Notificar al creador que su retiro fue rechazado
    try {
      const num = String(creator.whatsapp || "").replace(/\D/g, "");
      if (num) {
        const msg = [
          "❌ *Solicitud de retiro rechazada* — Legacy Store",
          "",
          adminNote ? `Motivo: ${adminNote}` : "Revisa tus datos o contacta al admin.",
          "",
          "Puedes volver a solicitar cuando quieras.",
        ].join("\n");
        await sendWhatsAppMessage(num, msg);
      }
    } catch {}
  }

  return { processed: true };
}