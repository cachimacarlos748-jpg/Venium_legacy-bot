import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import type Database from "better-sqlite3";

// Live chat inbox: every WhatsApp conversation is persisted so the owner can
// read it and answer as human support from the admin panel. The bot logs all
// of its replies here too, so the thread is a complete transcript.

export interface ChatMessageRow {
  id: number;
  direction: "in" | "out";
  source: "customer" | "bot" | "human" | "system";
  body: string;
  messageType: string;
  createdAt: string;
  mediaPath?: string | null;
}

export interface ChatThread {
  whatsappJid: string;
  phoneDisplay: string;
  name: string;
  lastMessage: string;
  lastDirection: "in" | "out";
  lastSource: string;
  lastAt: string;
  unread: number;
  handoff: boolean;
  handoffReason: string;
}

const MEDIA_DIR = process.env.CHAT_MEDIA_DIR || join(process.cwd(), "data", "chat-media");

// Saves an incoming image to disk and returns the stored path (or null).
export function saveChatMedia(dbIgnored: Database.Database, jid: string, base64Data: string, mimetype: string): string | null {
  try {
    mkdirSync(MEDIA_DIR, { recursive: true });
    const ext = mimetype.includes("png") ? "png" : mimetype.includes("webp") ? "webp" : "jpg";
    const name = `${Date.now()}-${jid.split("@")[0].replace(/\D/g, "") || "chat"}.${ext}`;
    const path = join(MEDIA_DIR, name);
    writeFileSync(path, Buffer.from(base64Data, "base64"));
    return name;
  } catch {
    return null;
  }
}

// Resolves a stored media file name to its absolute path (path-traversal safe).
export function resolveChatMedia(name: string): string | null {
  if (!/^[\w.-]+$/.test(name)) return null;
  const path = join(MEDIA_DIR, name);
  return existsSync(path) ? path : null;
}

export function readChatMedia(name: string): { buffer: Buffer; mimetype: string } | null {
  const path = resolveChatMedia(name);
  if (!path) return null;
  const ext = name.split(".").pop() ?? "jpg";
  const mimetype = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return { buffer: readFileSync(path), mimetype };
}

export function logCustomerMessage(db: Database.Database, jid: string, body: string, messageType = "text", mediaPath?: string | null): void {
  db.prepare(`
    INSERT INTO chat_messages (whatsapp_jid, direction, body, message_type, source, media_path, created_at)
    VALUES (?, 'in', ?, ?, 'customer', ?, ?)
  `).run(jid, body.slice(0, 8000), messageType, mediaPath ?? null, new Date().toISOString());
}

export function logBotMessage(db: Database.Database, jid: string, body: string): void {
  db.prepare(`
    INSERT INTO chat_messages (whatsapp_jid, direction, body, message_type, source, media_path, created_at)
    VALUES (?, 'out', ?, 'text', 'bot', NULL, ?)
  `).run(jid, body.slice(0, 8000), new Date().toISOString());
}

export function logHumanMessage(db: Database.Database, jid: string, body: string): void {
  db.prepare(`
    INSERT INTO chat_messages (whatsapp_jid, direction, body, message_type, source, media_path, created_at)
    VALUES (?, 'out', ?, 'text', 'human', NULL, ?)
  `).run(jid, body.slice(0, 8000), new Date().toISOString());
}

export function listRecentMessages(db: Database.Database, jid: string, limit = 14): ChatMessageRow[] {
  const rows = db.prepare(`
    SELECT id, direction, source, body, message_type AS messageType, media_path AS mediaPath, created_at AS createdAt
    FROM chat_messages WHERE whatsapp_jid = ? ORDER BY id DESC LIMIT ?
  `).all(jid, limit) as any[];
  return rows.reverse();
}

export function listThreadMessages(db: Database.Database, jid: string, afterId = 0): ChatMessageRow[] {
  return db.prepare(`
    SELECT id, direction, source, body, message_type AS messageType, media_path AS mediaPath, created_at AS createdAt
    FROM chat_messages
    WHERE whatsapp_jid = ? AND id > ?
    ORDER BY id ASC LIMIT 300
  `).all(jid, afterId) as any[];
}

export function markThreadRead(db: Database.Database, jid: string): void {
  db.prepare(`
    UPDATE chat_messages SET read = 1
    WHERE whatsapp_jid = ? AND direction = 'in' AND read = 0
  `).run(jid);
}

export function countUnread(db: Database.Database): number {
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM chat_messages WHERE direction = 'in' AND read = 0
  `).get() as { n: number };
  return row.n;
}

export function listThreads(db: Database.Database): ChatThread[] {
  const rows = db.prepare(`
    SELECT m.whatsapp_jid AS jid,
           m.body AS lastMessage,
           m.direction AS lastDirection,
           m.source AS lastSource,
           m.created_at AS lastAt,
           c.phone_display AS phoneDisplay,
           c.name AS name,
           (SELECT COUNT(*) FROM chat_messages x
             WHERE x.whatsapp_jid = m.whatsapp_jid AND x.direction = 'in' AND x.read = 0) AS unread,
           s.handoff AS handoff,
           s.handoff_at AS handoffAt
    FROM chat_messages m
    JOIN (
      SELECT whatsapp_jid, MAX(id) AS max_id
      FROM chat_messages GROUP BY whatsapp_jid
    ) last ON last.whatsapp_jid = m.whatsapp_jid AND last.max_id = m.id
    LEFT JOIN customers c ON c.whatsapp_jid = m.whatsapp_jid
    LEFT JOIN whatsapp_sessions s ON s.whatsapp_jid = m.whatsapp_jid
    ORDER BY m.created_at DESC
    LIMIT 100
  `).all() as any[];

  return rows.map((row) => ({
    whatsappJid: row.jid,
    phoneDisplay: row.phoneDisplay || String(row.jid).split("@")[0] || "",
    name: row.name || "",
    lastMessage: row.lastMessage || "",
    lastDirection: row.lastDirection,
    lastSource: row.lastSource || "",
    lastAt: row.lastAt,
    unread: row.unread || 0,
    handoff: Boolean(row.handoff),
    handoffReason: "",
  }));
}

// Pass the conversation to a human (or give it back to the bot) without
// touching the purchase state: the quote/checkout keeps its place.
export function setHandoff(db: Database.Database, jid: string, on: boolean, reason = ""): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO whatsapp_sessions (whatsapp_jid, state, player_data_json, handoff, handoff_at, updated_at)
    VALUES (?, 'idle', '{}', ?, ?, ?)
    ON CONFLICT(whatsapp_jid) DO UPDATE SET
      handoff = excluded.handoff,
      handoff_at = excluded.handoff_at,
      updated_at = excluded.updated_at
  `).run(jid, on ? 1 : 0, on ? now : null, now);
  if (on && reason) {
    db.prepare(`
      INSERT INTO chat_messages (whatsapp_jid, direction, body, message_type, source, read, created_at)
      VALUES (?, 'out', ?, 'system', 'system', 0, ?)
    `).run(jid, `[Sistema] Conversación pasada a soporte humano: ${reason}`, now);
  }
}

export function countHandoffThreads(db: Database.Database): number {
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM whatsapp_sessions WHERE handoff = 1
  `).get() as { n: number };
  return row.n;
}

/* ---------- Customer memory (the bot remembers every client) ---------- */

// Creates the customer row on the FIRST message so the bot has long-term
// memory (name + order history) even for people who never finish a purchase.
export function ensureCustomer(db: Database.Database, jid: string): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO customers (whatsapp_jid, phone_display, name, created_at, updated_at)
    VALUES (?, ?, '', ?, ?)
  `).run(jid, jid.split("@")[0] || "", now, now);
}

export function getCustomerName(db: Database.Database, jid: string): string | null {
  const row = db.prepare("SELECT name FROM customers WHERE whatsapp_jid = ?").get(jid) as { name?: string } | undefined;
  const name = (row?.name ?? "").trim();
  return name || null;
}

export function setCustomerName(db: Database.Database, jid: string, name: string): void {
  ensureCustomer(db, jid);
  db.prepare("UPDATE customers SET name = ?, updated_at = ? WHERE whatsapp_jid = ?")
    .run(name.trim().slice(0, 60), new Date().toISOString(), jid);
}

export interface RelatedChat {
  jid: string;
  phone: string;
  reason: string;
}

// Detects the customer writing to us from more than one place: the same phone
// number on a second WhatsApp JID, or the same Player ID already used in an
// order from another number. The bot used to treat those as brand new people,
// losing the conversation and hiding a possible duplicate/multi-account.
export function findRelatedChats(db: Database.Database, jid: string, values: string[] = []): RelatedChat[] {
  const out: RelatedChat[] = [];
  const seen = new Set<string>([jid]);
  const phone = String(jid).split("@")[0] ?? "";
  if (phone) {
    const samePhone = db.prepare(
      "SELECT whatsapp_jid AS jid, phone_display AS phone FROM customers WHERE phone_display = ? AND whatsapp_jid <> ?",
    ).all(phone, jid) as Array<{ jid: string; phone: string }>;
    for (const row of samePhone) {
      if (seen.has(row.jid)) continue;
      seen.add(row.jid);
      out.push({ jid: row.jid, phone: row.phone, reason: "mismo número en otra conversación" });
    }
  }
  const wanted = values.map((value) => String(value ?? "").trim()).filter((value) => value.length >= 6);
  if (wanted.length) {
    const rows = db.prepare(`
      SELECT c.whatsapp_jid AS jid, c.phone_display AS phone, o.player_data_json AS playerData
      FROM orders o JOIN customers c ON c.id = o.customer_id
      WHERE c.whatsapp_jid <> ?
    `).all(jid) as Array<{ jid: string; phone: string; playerData: string }>;
    for (const row of rows) {
      if (seen.has(row.jid)) continue;
      let parsed: Record<string, string> = {};
      try { parsed = JSON.parse(row.playerData || "{}"); } catch { parsed = {}; }
      const playerValues = Object.values(parsed).map((value) => String(value ?? "").trim());
      const shared = wanted.find((value) => playerValues.includes(value));
      if (!shared) continue;
      seen.add(row.jid);
      out.push({ jid: row.jid, phone: row.phone, reason: `mismo Player ID (${shared}) desde otro número` });
    }
  }
  return out.slice(0, 5);
}

export interface CustomerOrderMemory {
  date: string;
  product: string;
  bs: string;
  statusLabel: string;
}

// Recent orders of a customer, newest first — injected into the sales brain
// so it can greet known buyers and follow up on past deliveries.
export function listRecentOrders(db: Database.Database, jid: string, limit = 6): CustomerOrderMemory[] {
  const rows = db.prepare(`
    SELECT o.sale_price_bs_total AS bs, o.status, o.created_at AS date,
           p.name AS product_name, pk.name AS package_name
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    JOIN packages pk ON pk.id = o.package_id
    WHERE c.whatsapp_jid = ?
    ORDER BY o.created_at DESC
    LIMIT ?
  `).all(jid, limit) as any[];
  const labels: Record<string, string> = {
    quote_created: "esperando pago",
    approved_for_venium: "pagado",
    venium_pending: "en cola",
    venium_processing: "en proceso",
    completed: "entregado",
    cancelled: "cancelado",
    refunded: "reembolsado",
  };
  return rows.map((r) => ({
    date: String(r.date ?? "").slice(0, 10),
    product: `${String(r.product_name ?? "").trim()} — ${String(r.package_name ?? "").trim()}`,
    bs: String(r.bs ?? ""),
    statusLabel: labels[String(r.status)] ?? String(r.status),
  }));
}
