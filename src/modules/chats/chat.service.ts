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

export function logCustomerMessage(db: Database.Database, jid: string, body: string, messageType = "text"): void {
  db.prepare(`
    INSERT INTO chat_messages (whatsapp_jid, direction, body, message_type, source, created_at)
    VALUES (?, 'in', ?, ?, 'customer', ?)
  `).run(jid, body.slice(0, 8000), messageType, new Date().toISOString());
}

export function logBotMessage(db: Database.Database, jid: string, body: string): void {
  db.prepare(`
    INSERT INTO chat_messages (whatsapp_jid, direction, body, message_type, source, created_at)
    VALUES (?, 'out', ?, 'text', 'bot', ?)
  `).run(jid, body.slice(0, 8000), new Date().toISOString());
}

export function logHumanMessage(db: Database.Database, jid: string, body: string): void {
  db.prepare(`
    INSERT INTO chat_messages (whatsapp_jid, direction, body, message_type, source, created_at)
    VALUES (?, 'out', ?, 'text', 'human', ?)
  `).run(jid, body.slice(0, 8000), new Date().toISOString());
}

export function listRecentMessages(db: Database.Database, jid: string, limit = 14): ChatMessageRow[] {
  const rows = db.prepare(`
    SELECT id, direction, source, body, message_type AS messageType, created_at AS createdAt
    FROM chat_messages WHERE whatsapp_jid = ? ORDER BY id DESC LIMIT ?
  `).all(jid, limit) as any[];
  return rows.reverse();
}

export function listThreadMessages(db: Database.Database, jid: string, afterId = 0): ChatMessageRow[] {
  return db.prepare(`
    SELECT id, direction, source, body, message_type AS messageType, created_at AS createdAt
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
