import webpush from "web-push";
import type Database from "better-sqlite3";
import { env } from "../../config/env.js";
import { NOTIFY_EVENTS, type VexEvent } from "./event-bus.js";

// Web Push (VAPID) so the owner's phone rings when the bot gets a customer.
// Subscriptions live in SQLite; stale ones (410/404) are pruned on delivery.

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: string;
}

export function pushConfigured(): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

export function vapidPublicKey(): string {
  return env.VAPID_PUBLIC_KEY || "";
}

export function saveSubscription(db: Database.Database, subscription: { endpoint: string; keys: { p256dh: string; auth: string } }): void {
  db.prepare(`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth
  `).run(subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, new Date().toISOString());
}

export function deleteSubscription(db: Database.Database, endpoint: string): void {
  db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
}

export function listSubscriptions(db: Database.Database): PushSubscriptionRow[] {
  return db.prepare(`
    SELECT endpoint, p256dh, auth, created_at AS createdAt FROM push_subscriptions
  `).all() as PushSubscriptionRow[];
}

const TITLES: Record<string, string> = {
  message_in: "💬 Nuevo mensaje de cliente",
  order_created: "🧾 Nuevo pedido en marcha",
  payment_verified: "✅ ¡Pago verificado!",
  order_completed: "🎉 ¡Tu recarga está lista!",
  survey_response: "📊 Nueva encuesta de satisfacción",
  payment_review: "⚠️ Pago en revisión de seguridad",
  handoff_on: "🙋 Cliente pidió soporte humano",
  user_blocked: "🚫 Usuario bloqueado",
  order_stuck: "⏰ Pedido pendiente de atención",
  provider_alert: "🏦 No se están verificando los pagos",
  multi_number: "📱 El mismo cliente escribió desde dos números",
  bot_error: "🔥 El bot tuvo un error",
};

// Same phone + a fresh event = the browser notification of the same order would
// be swallowed by Android's de-duplication, which is exactly how a pending
// order stayed unnoticed. A timestamp tag forces it to ring again.
export function pushDeliveryError(error: any): string | null {
  if (error?.statusCode === 404 || error?.statusCode === 410) return "subscription_gone";
  if (error?.statusCode) return `http_${error.statusCode}`;
  return error?.message ? String(error.message).slice(0, 120) : "unknown";
}

export async function deliverEventToAll(db: Database.Database, event: VexEvent): Promise<number> {
  if (!NOTIFY_EVENTS.has(event.type)) return 0;
  const rows = listSubscriptions(db);
  // "Nobody would be told" is exactly the failure we are fixing: log it loudly
  // instead of silently returning 0 forever.
  if (!pushConfigured()) {
    if (rows.length) console.warn("[push] VAPID no configurado: no se pueden enviar notificaciones");
    return 0;
  }
  if (!rows.length) {
    console.warn("[push] No hay teléfonos registrados: la notificación se pierde", { type: event.type });
    return 0;
  }
  webpush.setVapidDetails(env.VAPID_SUBJECT || "mailto:admin@vexstore.app", env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  const payload = JSON.stringify({
    title: TITLES[event.type] ?? "⚡ Vex Store",
    body: `${event.phone}: ${(event.preview ?? "").slice(0, 120)}`,
    // Unique per event so the OS never collapses two different alerts (e.g. a
    // new order right after yesterday's pending one) into a single one.
    tag: `${event.jid}:${event.type}:${event.at}`,
    sound: "default",
    url: "/admin?view=chats&jid=" + encodeURIComponent(event.jid),
  });
  let delivered = 0;
  await Promise.all(rows.map(async (row) => {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        payload,
        { TTL: 300, urgency: "high" },
      );
      delivered += 1;
    } catch (error: any) {
      if (pushDeliveryError(error) === "subscription_gone") deleteSubscription(db, row.endpoint);
      console.error("[push] no se pudo entregar la notificación", { type: event.type, error: pushDeliveryError(error) });
    }
  }));
  return delivered;
}
