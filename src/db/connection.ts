import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function createDatabase(filename: string): Database.Database {
  mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      usd_to_bs_rate TEXT NOT NULL DEFAULT '990',
      margin_percent TEXT NOT NULL DEFAULT '3',
      rounding_mode TEXT NOT NULL DEFAULT 'ceil',
      rounding_increment_bs TEXT NOT NULL DEFAULT '10',
      minimum_price_bs TEXT NOT NULL DEFAULT '0',
      pabilo_enabled INTEGER NOT NULL DEFAULT 1,
      pabilo_user_bank_id TEXT NOT NULL DEFAULT '',
      pabilo_movement_type TEXT NOT NULL DEFAULT 'GENERIC',
      payment_destination_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      settings_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venium_product_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      last_synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      venium_package_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      cost_usd TEXT NOT NULL,
      out_of_stock INTEGER NOT NULL DEFAULT 0,
      last_synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS player_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL,
      label TEXT NOT NULL,
      field_type TEXT NOT NULL DEFAULT 'text',
      required INTEGER NOT NULL DEFAULT 1,
      UNIQUE(product_id, field_key)
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      whatsapp_jid TEXT NOT NULL UNIQUE,
      phone_display TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(id),
      venium_order_id TEXT UNIQUE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      package_id INTEGER NOT NULL REFERENCES packages(id),
      quantity INTEGER NOT NULL DEFAULT 1,
      player_data_json TEXT NOT NULL,
      cost_usd_unit TEXT NOT NULL,
      cost_usd_total TEXT NOT NULL,
      exchange_rate TEXT NOT NULL,
      margin_percent TEXT NOT NULL,
      price_before_rounding_bs TEXT NOT NULL,
      rounding_mode TEXT NOT NULL,
      rounding_increment_bs TEXT NOT NULL,
      minimum_price_bs TEXT NOT NULL,
      sale_price_bs_unit TEXT NOT NULL,
      sale_price_bs_total TEXT NOT NULL,
      payment_reference TEXT,
      payment_receipt_hash TEXT,
      payment_date TEXT,
      payment_bank TEXT,
      payment_recipient_json TEXT,
      payment_antifraud_status TEXT,
      payment_antifraud_reason TEXT,
      payment_status TEXT NOT NULL DEFAULT 'not_submitted',
      status TEXT NOT NULL DEFAULT 'quote_created',
      delivered_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      from_status TEXT,
      to_status TEXT NOT NULL,
      source TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payment_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      reference TEXT NOT NULL,
      amount_bs TEXT NOT NULL,
      payment_date TEXT,
      bank TEXT,
      recipient_data_json TEXT NOT NULL DEFAULT '{}',
      customer_whatsapp_jid TEXT NOT NULL DEFAULT '',
      receipt_hash TEXT NOT NULL DEFAULT '',
      antifraud_status TEXT NOT NULL DEFAULT 'pending',
      antifraud_reason TEXT,
      gemini_status TEXT NOT NULL,
      pabilo_status TEXT NOT NULL,
      pabilo_is_new INTEGER,
      provider_response_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      venium_order_id TEXT,
      UNIQUE(reference)
    );

    CREATE TABLE IF NOT EXISTS payment_security_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
      reference TEXT,
      amount_bs TEXT,
      payment_date TEXT,
      bank TEXT,
      recipient_data_json TEXT NOT NULL DEFAULT '{}',
      customer_whatsapp_jid TEXT NOT NULL DEFAULT '',
      receipt_hash TEXT,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'review',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS moderation_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 1,
      window_seconds INTEGER NOT NULL DEFAULT 60,
      max_messages INTEGER NOT NULL DEFAULT 8,
      repeated_message_limit INTEGER NOT NULL DEFAULT 3,
      warning_threshold INTEGER NOT NULL DEFAULT 2,
      auto_block_threshold INTEGER NOT NULL DEFAULT 4,
      cooldown_seconds INTEGER NOT NULL DEFAULT 30,
      block_duration_seconds INTEGER NOT NULL DEFAULT 3600,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS moderation_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      whatsapp_jid TEXT NOT NULL UNIQUE,
      warning_count INTEGER NOT NULL DEFAULT 0,
      violation_count INTEGER NOT NULL DEFAULT 0,
      blocked_until TEXT,
      block_reason TEXT,
      last_message_hash TEXT,
      repeated_count INTEGER NOT NULL DEFAULT 0,
      cooldown_until TEXT,
      last_message_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS moderation_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      whatsapp_jid TEXT NOT NULL,
      message_hash TEXT NOT NULL,
      classification TEXT NOT NULL DEFAULT 'normal',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS moderation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      whatsapp_jid TEXT NOT NULL,
      message_hash TEXT,
      reason TEXT NOT NULL,
      action TEXT NOT NULL,
      classification TEXT NOT NULL DEFAULT 'normal',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS whatsapp_sessions (
      whatsapp_jid TEXT PRIMARY KEY,
      state TEXT NOT NULL DEFAULT 'idle',
      package_id TEXT,
      player_data_json TEXT NOT NULL DEFAULT '{}',
      order_id TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      whatsapp_jid TEXT NOT NULL,
      direction TEXT NOT NULL,
      body TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'text',
      source TEXT NOT NULL DEFAULT 'bot',
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_key TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      venium_order_id TEXT,
      payload_json TEXT NOT NULL,
      signature TEXT NOT NULL DEFAULT '',
      timestamp_header TEXT NOT NULL DEFAULT '',
      processing_status TEXT NOT NULL DEFAULT 'received',
      error_message TEXT,
      created_at TEXT NOT NULL,
      processed_at TEXT
    );
  `);

  const addColumnIfMissing = (table: string, column: string, definition: string): void => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((item) => item.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  };

  // Backward-compatible migration for databases created by the first MVP.
  addColumnIfMissing("settings", "payment_destination_json", "TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing("orders", "payment_receipt_hash", "TEXT");
  addColumnIfMissing("orders", "payment_date", "TEXT");
  addColumnIfMissing("orders", "payment_bank", "TEXT");
  addColumnIfMissing("orders", "payment_recipient_json", "TEXT");
  addColumnIfMissing("orders", "payment_antifraud_status", "TEXT");
  addColumnIfMissing("orders", "payment_antifraud_reason", "TEXT");
  addColumnIfMissing("payment_attempts", "payment_date", "TEXT");
  addColumnIfMissing("payment_attempts", "bank", "TEXT");
  addColumnIfMissing("payment_attempts", "recipient_data_json", "TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing("payment_attempts", "customer_whatsapp_jid", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing("payment_attempts", "receipt_hash", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing("payment_attempts", "antifraud_status", "TEXT NOT NULL DEFAULT 'pending'");
  addColumnIfMissing("payment_attempts", "antifraud_reason", "TEXT");
  addColumnIfMissing("payment_attempts", "updated_at", "TEXT");
  addColumnIfMissing("payment_attempts", "venium_order_id", "TEXT");
  addColumnIfMissing("whatsapp_sessions", "handoff", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("whatsapp_sessions", "handoff_at", "TEXT");
  addColumnIfMissing("whatsapp_sessions", "last_shown_json", "TEXT NOT NULL DEFAULT '[]'");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_chat_messages_jid
      ON chat_messages(whatsapp_jid, id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_reference_unique
      ON payment_attempts(reference);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_receipt_hash_unique
      ON payment_attempts(receipt_hash)
      WHERE receipt_hash <> '';
  `);

  db.prepare(`
    INSERT OR IGNORE INTO settings (
      id, usd_to_bs_rate, margin_percent, rounding_mode,
      rounding_increment_bs, minimum_price_bs, pabilo_movement_type,
      payment_destination_json, updated_at
    ) VALUES (1, '990', '3', 'ceil', '10', '0', 'GENERIC', '{}', ?)
  `).run(new Date().toISOString());

  db.prepare(`
    INSERT OR IGNORE INTO moderation_settings (id, updated_at)
    VALUES (1, ?)
  `).run(new Date().toISOString());
}