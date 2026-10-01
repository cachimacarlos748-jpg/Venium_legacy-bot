// Eventos Nocturnos — flash sales por stock limitado.
// El admin crea un evento para un paquete específico con un precio especial
// (en Bs) y un stock fijo. Cuando se agota el stock, el evento se cierra solo.

import { base44 } from "@/api/base44Client";

const E = base44.entities.NightEvent;

// Eventos activos con stock disponible (status=active y stock_sold < stock_total).
export async function getActiveEvents() {
  try {
    const all = await E.filter({ status: "active" });
    return (all || []).filter((e) => (e.stock_sold || 0) < (e.stock_total || 0));
  } catch {
    return [];
  }
}

// Busca el evento activo que aplica a un paquete (por slug + package_id o label).
export async function getActiveEventForPackage(slug, packageId, packageLabel) {
  const events = await getActiveEventsForSlug(slug);
  return events.find((e) => {
    if (packageId && e.package_id && String(e.package_id) === String(packageId)) return true;
    if (packageLabel && e.package_label && e.package_label === packageLabel) return true;
    return false;
  }) || null;
}

// Todos los eventos activos para un slug (puede haber uno por paquete).
export async function getActiveEventsForSlug(slug) {
  const events = await getActiveEvents();
  return events.filter((e) => e.product_slug === slug);
}

// Consume 1 unidad de stock al completar una compra. Si llega a 0, marca sold_out.
export async function consumeEventStock(eventId, orderId) {
  if (!eventId) return null;
  try {
    const ev = await E.get(eventId);
    if (!ev) return null;
    const sold = (ev.stock_sold || 0) + 1;
    const log = [...(ev.orders_log || []), orderId].filter(Boolean);
    const status = sold >= (ev.stock_total || 0) ? "sold_out" : "active";
    const data = { stock_sold: sold, orders_log: log, status };
    if (status === "sold_out") data.closed_date = new Date().toISOString();
    return await E.update(eventId, data);
  } catch {
    return null;
  }
}

// Cambia el status manualmente (pausar / cerrar / reactivar).
export async function setEventStatus(eventId, status) {
  if (!eventId) return null;
  try {
    const data = { status };
    if (status === "sold_out" || status === "closed") data.closed_date = new Date().toISOString();
    return await E.update(eventId, data);
  } catch {
    return null;
  }
}

// Crea un nuevo evento nocturno.
export async function createEvent(payload) {
  return await E.create({
    product_slug: payload.product_slug,
    product_name: payload.product_name || "",
    package_id: payload.package_id || "",
    package_label: payload.package_label || "",
    event_price: Number(payload.event_price) || 0,
    stock_total: Number(payload.stock_total) || 1,
    stock_sold: 0,
    status: "active",
    orders_log: [],
  });
}