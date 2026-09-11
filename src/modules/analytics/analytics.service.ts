import Database from "better-sqlite3";
import { Decimal } from "decimal.js";

export interface DashboardKpis {
  totalOrders: number;
  ordersToday: number;
  orders7d: number;
  ordersPendingPayment: number;
  ordersSuspicious: number;
  ordersCompleted: number;
  revenueBsToday: string;
  revenueBs7d: string;
  revenueUsdToday: string;
  revenueUsd7d: string;
  costUsdToday: string;
  costUsd7d: string;
  marginUsd7d: string;
  conversionRate7d: number;
  averageTicketBs7d: string;
  activeCustomers: number;
  blockedUsers: number;
  failedWebhooks: number;
}

export interface DashboardAlert {
  level: "critical" | "warning" | "info";
  title: string;
  detail: string;
}

export interface DashboardCore {
  kpis: DashboardKpis;
  sales7d: Array<{ day: string; orders: number; revenueBs: string }>;
  topPackages: Array<{ name: string; orders: number; revenueBs: string }>;
  recentOrders: unknown[];
  recentEvents: unknown[];
  alerts: DashboardAlert[];
  generatedAt: string;
}

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown): string {
  return new Decimal(num(value)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

function usdFromBs(valueBs: Decimal, rate: Decimal): string {
  return rate.gt(0) ? valueBs.div(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2) : "0.00";
}

function todayStart(): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function daysAgoIso(days: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

const SOLD_STATUSES = "('venium_processing','completed','delivered')";

function exchangeRate(db: Database.Database): Decimal {
  const row: any = db.prepare("SELECT usd_to_bs_rate FROM settings WHERE id = 1").get();
  const rate = new Decimal(String(row?.usd_to_bs_rate ?? "990"));
  return rate.gt(0) ? rate : new Decimal(990);
}

export function getDashboardCore(db: Database.Database): DashboardCore {
  const today = todayStart();
  const weekAgo = daysAgoIso(6);
  const rate = exchangeRate(db);

  const scalar = (sql: string, ...params: unknown[]): any => db.prepare(sql).get(...params);
  const count = (sql: string, ...params: unknown[]): number => num(db.prepare(sql).pluck().get(...params));

  const totalOrders = count(`SELECT COUNT(*) FROM orders`);
  const ordersToday = count(`SELECT COUNT(*) FROM orders WHERE created_at >= ?`, today);
  const orders7d = count(`SELECT COUNT(*) FROM orders WHERE created_at >= ?`, weekAgo);
  const ordersPendingPayment = count(
    `SELECT COUNT(*) FROM orders WHERE status = 'quote_created' AND payment_status NOT IN ('verified_new','duplicate')`,
  );
  const ordersSuspicious = count(
    `SELECT COUNT(*) FROM orders WHERE payment_antifraud_status = 'suspicious' AND status = 'quote_created'`,
  );
  const ordersCompleted = count(`SELECT COUNT(*) FROM orders WHERE status IN ('completed','delivered')`);

  const revenueTodayRow: any = scalar(`
    SELECT COALESCE(SUM(CAST(sale_price_bs_total AS REAL)), 0) AS revenue, COUNT(*) AS orders
    FROM orders WHERE created_at >= ? AND status IN ${SOLD_STATUSES}
  `, today);
  const revenue7dRow: any = scalar(`
    SELECT COALESCE(SUM(CAST(sale_price_bs_total AS REAL)), 0) AS revenue, COUNT(*) AS orders
    FROM orders WHERE created_at >= ? AND status IN ${SOLD_STATUSES}
  `, weekAgo);
  const costTodayRow: any = scalar(`
    SELECT COALESCE(SUM(CAST(cost_usd_total AS REAL)), 0) AS cost
    FROM orders WHERE created_at >= ? AND status IN ${SOLD_STATUSES}
  `, today);
  const cost7dRow: any = scalar(`
    SELECT COALESCE(SUM(CAST(cost_usd_total AS REAL)), 0) AS cost
    FROM orders WHERE created_at >= ? AND status IN ${SOLD_STATUSES}
  `, weekAgo);

  const revenueBsToday = money(revenueTodayRow?.revenue);
  const revenueBs7d = money(revenue7dRow?.revenue);
  const soldOrders7d = num(revenue7dRow?.orders);
  const conversionRate7d = orders7d > 0 ? Math.round((soldOrders7d / orders7d) * 100) : 0;
  const averageTicketBs7d = soldOrders7d > 0 ? money(new Decimal(revenueBs7d).div(soldOrders7d)) : "0.00";
  const costUsd7d = money(cost7dRow?.cost);
  const revenueUsd7d = usdFromBs(new Decimal(revenueBs7d), rate);
  const marginUsd7d = money(Math.max(0, (num(revenueUsd7d) - num(costUsd7d)) * 100) / 100);

  const activeCustomers = count(`SELECT COUNT(*) FROM customers`);
  const blockedUsers = count(`SELECT COUNT(*) FROM moderation_users WHERE blocked_until IS NOT NULL`);
  const failedWebhooks = count(`SELECT COUNT(*) FROM webhook_events WHERE processing_status = 'failed'`);

  const sales7d: Array<{ day: string; orders: number; revenueBs: string }> = [];
  for (let offset = 6; offset >= 0; offset--) {
    const dayStart = daysAgoIso(offset);
    const dayEnd = daysAgoIso(offset - 1);
    const row: any = scalar(`
      SELECT COUNT(*) AS orders, COALESCE(SUM(CAST(sale_price_bs_total AS REAL)), 0) AS revenue
      FROM orders WHERE created_at >= ? AND created_at < ? AND status IN ${SOLD_STATUSES}
    `, dayStart, dayEnd);
    sales7d.push({
      day: new Date(dayStart).toISOString().slice(0, 10),
      orders: num(row?.orders),
      revenueBs: money(row?.revenue),
    });
  }

  const topPackages = (db.prepare(`
    SELECT pk.name AS name, COUNT(*) AS orders, COALESCE(SUM(CAST(o.sale_price_bs_total AS REAL)), 0) AS revenue
    FROM orders o
    JOIN packages pk ON pk.id = o.package_id
    WHERE o.created_at >= ?
    GROUP BY pk.id ORDER BY orders DESC LIMIT 5
  `).all(weekAgo) as any[]).map((row) => ({
    name: row.name,
    orders: num(row.orders),
    revenueBs: money(row.revenue),
  }));

  const recentOrders = db.prepare(`
    SELECT o.id, o.status, o.payment_status AS paymentStatus,
           o.sale_price_bs_total AS salePriceBsTotal, o.payment_reference AS paymentReference,
           c.whatsapp_jid AS whatsappJid, p.name AS productName, pk.name AS packageName,
           o.created_at AS createdAt
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    JOIN packages pk ON pk.id = o.package_id
    ORDER BY o.created_at DESC LIMIT 12
  `).all();

  const recentEvents = db.prepare(`
    SELECT id, order_id AS orderId, reference, amount_bs AS amountBs, reason, status, created_at AS createdAt
    FROM payment_security_events ORDER BY created_at DESC LIMIT 10
  `).all();

  const alerts: DashboardAlert[] = [];
  if (failedWebhooks > 0) {
    alerts.push({
      level: "critical",
      title: "Webhooks de Venium fallidos",
      detail: `${failedWebhooks} evento(s) no pudieron procesarse. Revisa VENIUM_WEBHOOK_SECRET y la pestaña Seguridad.`,
    });
  }
  if (ordersSuspicious > 0) {
    alerts.push({
      level: "warning",
      title: "Pagos en revisión",
      detail: `${ordersSuspicious} pago(s) marcados como sospechosos esperan tu decisión en la pestaña Seguridad.`,
    });
  }
  if (blockedUsers > 0) {
    alerts.push({
      level: "warning",
      title: "Usuarios bloqueados",
      detail: `${blockedUsers} usuario(s) bloqueados por moderación. Revísalos en la pestaña Clientes.`,
    });
  }
  if (ordersPendingPayment > 0) {
    alerts.push({
      level: "info",
      title: "Pedidos esperando pago",
      detail: `${ordersPendingPayment} cotización(ones) siguen sin comprobante. Puedes recordárselo al cliente por WhatsApp.`,
    });
  }

  return {
    kpis: {
      totalOrders,
      ordersToday,
      orders7d,
      ordersPendingPayment,
      ordersSuspicious,
      ordersCompleted,
      revenueBsToday,
      revenueBs7d,
      revenueUsdToday: usdFromBs(new Decimal(revenueBsToday), rate),
      revenueUsd7d,
      costUsdToday: money(costTodayRow?.cost),
      costUsd7d,
      marginUsd7d,
      conversionRate7d,
      averageTicketBs7d,
      activeCustomers,
      blockedUsers,
      failedWebhooks,
    },
    sales7d,
    topPackages,
    recentOrders,
    recentEvents,
    alerts,
    generatedAt: new Date().toISOString(),
  };
}

export function listCustomers(db: Database.Database, search = ""): unknown[] {
  const term = search.trim().toLowerCase();
  const like = `%${term}%`;
  const now = new Date().toISOString();
  const rows = db.prepare(`
    SELECT
      c.whatsapp_jid AS whatsappJid,
      c.phone_display AS phoneDisplay,
      c.name AS name,
      c.created_at AS firstSeenAt,
      COUNT(o.id) AS ordersCount,
      COALESCE(SUM(CASE WHEN o.status IN ${SOLD_STATUSES} THEN CAST(o.sale_price_bs_total AS REAL) ELSE 0 END), 0) AS revenueBs,
      MAX(o.created_at) AS lastOrderAt,
      SUM(CASE WHEN o.payment_antifraud_status = 'suspicious' THEN 1 ELSE 0 END) AS suspiciousCount,
      mu.blocked_until AS blockedUntil,
      mu.block_reason AS blockReason,
      (SELECT COUNT(*) FROM moderation_events me WHERE me.whatsapp_jid = c.whatsapp_jid) AS moderationEvents
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id
    LEFT JOIN moderation_users mu ON mu.whatsapp_jid = c.whatsapp_jid
    WHERE (? = '' OR LOWER(c.whatsapp_jid) LIKE ? OR LOWER(c.phone_display) LIKE ? OR LOWER(c.name) LIKE ?)
    GROUP BY c.id
    ORDER BY revenueBs DESC, ordersCount DESC
    LIMIT 200
  `).all(term, like, like, like) as any[];

  return rows.map((row) => ({
    ...row,
    revenueBs: money(row.revenueBs),
    isBlocked: Boolean(row.blockedUntil && row.blockedUntil > now),
  }));
}
