// Gestiona la lista de pedidos con pago parcial pendiente en localStorage,
// para que el cliente pueda retomar el pago aunque cierre/refresque el
// navegador. La fuente de verdad es la BD (Order.status = partial_payment);
// este caché sólo alimenta el badge del menú y el acceso rápido.
const KEY = "legacy_pending_orders";

function emit() {
  try { window.dispatchEvent(new Event("legacy-pending-updated")); } catch {}
}

export function getPendingOrders() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}

export function addPendingOrder(order) {
  if (!order?.id) return;
  const list = getPendingOrders().filter((o) => o.id !== order.id);
  list.unshift({
    id: order.id,
    player_id: order.player_id || "",
    product_name: order.product_name || "",
    denomination: order.denomination || "",
    balance: order.balance || 0,
    date: new Date().toISOString(),
  });
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 10))); } catch {}
  emit();
}

export function removePendingOrder(orderId) {
  if (!orderId) return;
  const list = getPendingOrders().filter((o) => o.id !== orderId);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
  emit();
}