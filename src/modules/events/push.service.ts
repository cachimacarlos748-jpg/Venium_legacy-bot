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
  payment_review: "⚠️ Pago en revisión de seguridad",
  handoff_on: "🙋 Cliente pidió soporte humano",
  user_blocked: "🚫 Usuario bloqueado",
};

export async function deliverEventToAll(db: Database.Database, event: VexEvent): Promise<number> {
  if (!pushConfigured() || !NOTIFY_EVENTS.has(event.type)) return 0;
  webpush.setVapidDetails("mailto:admin@vexstore.app", env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  const payload = JSON.stringify({
    title: TITLES[event.type] ?? "⚡ Vex Store",
    body: `${event.phone}: ${(event.preview ?? "").slice(0, 120)}`,
    tag: event.jid,
    sound: "default",
    url: "/admin?view=chats&jid=" + encodeURIComponent(event.jid),
  });
  const rows = listSubscriptions(db);
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
      const status = error?.statusCode;
      if (status === 404 || status === 410) deleteSubscription(db, row.endpoint);
    }
  }));
  return delivered;
}
