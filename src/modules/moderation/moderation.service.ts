import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { z } from "zod";

export const moderationSettingsSchema = z.object({
  enabled: z.boolean(),
  windowSeconds: z.number().int().min(1).max(86400),
  maxMessages: z.number().int().min(1).max(1000),
  repeatedMessageLimit: z.number().int().min(2).max(100),
  warningThreshold: z.number().int().min(1).max(100),
  autoBlockThreshold: z.number().int().min(1).max(100),
  cooldownSeconds: z.number().int().min(0).max(86400),
  blockDurationSeconds: z.number().int().min(60).max(31536000),
});

export type ModerationClassification = "normal" | "competitor" | "abuse" | "harassment" | "insult";

export interface ModerationSettings {
  enabled: boolean;
  windowSeconds: number;
  maxMessages: number;
  repeatedMessageLimit: number;
  warningThreshold: number;
  autoBlockThreshold: number;
  cooldownSeconds: number;
  blockDurationSeconds: number;
}

export interface ModerationResult {
  allowed: boolean;
  action: "allow" | "warning" | "cooldown" | "block" | "blocked";
  reason: string | null;
  warnings: number;
  blockedUntil: string | null;
  messageHash: string;
}

function iso(date: Date): string {
  return date.toISOString();
}

function addSeconds(date: Date, seconds: number): string {
  return iso(new Date(date.getTime() + seconds * 1000));
}

export function normalizeMessage(message: string): string {
  return message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function messageHash(message: string): string {
  return createHash("sha256").update(normalizeMessage(message)).digest("hex");
}

export function getModerationSettings(db: Database.Database): ModerationSettings {
  const row: any = db.prepare("SELECT * FROM moderation_settings WHERE id = 1").get();
  return {
    enabled: Boolean(row.enabled),
    windowSeconds: row.window_seconds,
    maxMessages: row.max_messages,
    repeatedMessageLimit: row.repeated_message_limit,
    warningThreshold: row.warning_threshold,
    autoBlockThreshold: row.auto_block_threshold,
    cooldownSeconds: row.cooldown_seconds,
    blockDurationSeconds: row.block_duration_seconds,
  };
}

export function updateModerationSettings(db: Database.Database, input: unknown): ModerationSettings {
  const settings = moderationSettingsSchema.parse(input);
  if (settings.autoBlockThreshold < settings.warningThreshold) {
    throw new Error("autoBlockThreshold must be greater than or equal to warningThreshold");
  }
  db.prepare(`
    UPDATE moderation_settings SET
      enabled = ?, window_seconds = ?, max_messages = ?,
      repeated_message_limit = ?, warning_threshold = ?,
      auto_block_threshold = ?, cooldown_seconds = ?,
      block_duration_seconds = ?, updated_at = ?
    WHERE id = 1
  `).run(
    settings.enabled ? 1 : 0,
    settings.windowSeconds,
    settings.maxMessages,
    settings.repeatedMessageLimit,
    settings.warningThreshold,
    settings.autoBlockThreshold,
    settings.cooldownSeconds,
    settings.blockDurationSeconds,
    new Date().toISOString(),
  );
  return getModerationSettings(db);
}

function logEvent(
  db: Database.Database,
  jid: string,
  hash: string | null,
  reason: string,
  action: string,
  classification: ModerationClassification,
  timestamp: string,
): void {
  db.prepare(`
    INSERT INTO moderation_events
      (whatsapp_jid, message_hash, reason, action, classification, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(jid, hash, reason, action, classification, timestamp);
}

export function moderateMessage(
  db: Database.Database,
  input: {
    whatsappJid: string;
    message: string;
    classification?: ModerationClassification;
    now?: Date;
  },
): ModerationResult {
  const now = input.now ?? new Date();
  const timestamp = iso(now);
  const classification = input.classification ?? "normal";
  const hash = messageHash(input.message);
  const settings = getModerationSettings(db);

  let user: any = db.prepare("SELECT * FROM moderation_users WHERE whatsapp_jid = ?").get(input.whatsappJid);
  if (!user) {
    db.prepare(`
      INSERT INTO moderation_users (whatsapp_jid, created_at, updated_at)
      VALUES (?, ?, ?)
    `).run(input.whatsappJid, timestamp, timestamp);
    user = db.prepare("SELECT * FROM moderation_users WHERE whatsapp_jid = ?").get(input.whatsappJid);
  }

  if (!settings.enabled) {
    return { allowed: true, action: "allow", reason: null, warnings: user.warning_count, blockedUntil: null, messageHash: hash };
  }

  if (user.blocked_until && user.blocked_until > timestamp) {
    logEvent(db, input.whatsappJid, hash, user.block_reason ?? "automatic_block", "blocked", classification, timestamp);
    return {
      allowed: false,
      action: "blocked",
      reason: user.block_reason ?? "automatic_block",
      warnings: user.warning_count,
      blockedUntil: user.blocked_until,
      messageHash: hash,
    };
  }

  if (user.cooldown_until && user.cooldown_until > timestamp) {
    logEvent(db, input.whatsappJid, hash, "cooldown_active", "cooldown", classification, timestamp);
    return {
      allowed: false,
      action: "cooldown",
      reason: "cooldown_active",
      warnings: user.warning_count,
      blockedUntil: null,
      messageHash: hash,
    };
  }

  const windowStart = new Date(now.getTime() - settings.windowSeconds * 1000).toISOString();
  db.prepare(`
    INSERT INTO moderation_messages (whatsapp_jid, message_hash, classification, created_at)
    VALUES (?, ?, ?, ?)
  `).run(input.whatsappJid, hash, classification, timestamp);

  const rateCount = Number(db.prepare(`
    SELECT COUNT(*) FROM moderation_messages
    WHERE whatsapp_jid = ? AND created_at >= ?
  `).pluck().get(input.whatsappJid, windowStart));
  const repeatedCount = Number(db.prepare(`
    SELECT COUNT(*) FROM moderation_messages
    WHERE whatsapp_jid = ? AND message_hash = ? AND created_at >= ?
  `).pluck().get(input.whatsappJid, hash, windowStart));

  const reasons: string[] = [];
  if (rateCount >= settings.maxMessages) reasons.push("rate_limit");
  if (repeatedCount >= settings.repeatedMessageLimit) reasons.push("repeated_message");
  if (["abuse", "harassment", "insult"].includes(classification)) reasons.push(`${classification}_content`);
  // "competitor" is deliberately not a violation by itself.

  db.prepare(`
    UPDATE moderation_users SET
      last_message_hash = ?, repeated_count = ?, last_message_at = ?, updated_at = ?
    WHERE whatsapp_jid = ?
  `).run(hash, repeatedCount, timestamp, timestamp, input.whatsappJid);

  if (reasons.length === 0) {
    return { allowed: true, action: "allow", reason: null, warnings: user.warning_count, blockedUntil: null, messageHash: hash };
  }

  const warnings = user.warning_count + 1;
  const reason = reasons.join(",");
  const shouldBlock = warnings >= settings.autoBlockThreshold;
  const shouldCooldown = warnings >= settings.warningThreshold;
  const blockedUntil = shouldBlock ? addSeconds(now, settings.blockDurationSeconds) : null;
  const cooldownUntil = !shouldBlock && shouldCooldown ? addSeconds(now, settings.cooldownSeconds) : null;
  const action = shouldBlock ? "block" : shouldCooldown ? "cooldown" : "warning";

  db.prepare(`
    UPDATE moderation_users SET
      warning_count = ?, violation_count = violation_count + 1,
      blocked_until = ?, block_reason = ?, cooldown_until = ?, updated_at = ?
    WHERE whatsapp_jid = ?
  `).run(
    warnings,
    blockedUntil,
    shouldBlock ? reason : user.block_reason,
    cooldownUntil,
    timestamp,
    input.whatsappJid,
  );
  logEvent(db, input.whatsappJid, hash, reason, action, classification, timestamp);

  return {
    allowed: action === "warning",
    action,
    reason,
    warnings,
    blockedUntil,
    messageHash: hash,
  };
}

export function listBlockedUsers(db: Database.Database): unknown[] {
  return db.prepare(`
    SELECT whatsapp_jid AS whatsappJid, warning_count AS warningCount,
           violation_count AS violationCount, blocked_until AS blockedUntil,
           block_reason AS blockReason, updated_at AS updatedAt
    FROM moderation_users
    WHERE blocked_until IS NOT NULL
    ORDER BY blocked_until DESC
  `).all();
}

export function unblockUser(db: Database.Database, whatsappJid: string): void {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE moderation_users SET
      warning_count = 0, violation_count = 0,
      blocked_until = NULL, block_reason = NULL,
      cooldown_until = NULL, updated_at = ?
    WHERE whatsapp_jid = ?
  `).run(now, whatsappJid);
  logEvent(db, whatsappJid, null, "admin_unblock", "unblock", "normal", now);
}