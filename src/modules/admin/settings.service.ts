import Database from "better-sqlite3";
import { z } from "zod";
import type { PricingSettings } from "../pricing/pricing.service.js";

export const settingsInputSchema = z.object({
  usdToBsRate: z.string().regex(/^\d+(\.\d{1,6})?$/),
  marginPercent: z.string().regex(/^\d+(\.\d{1,6})?$/),
  roundingMode: z.enum(["nearest", "ceil", "floor", "none"]),
  roundingIncrementBs: z.string().regex(/^\d+(\.\d{1,6})?$/),
  minimumPriceBs: z.string().regex(/^\d+(\.\d{1,6})?$/),
  pabiloEnabled: z.boolean(),
  pabiloUserBankId: z.string().max(200),
  pabiloMovementType: z.string().min(1).max(50),
  paymentDestinationJson: z.string().default("{}"),
});

export interface AppSettings extends PricingSettings {
  pabiloEnabled: boolean;
  pabiloUserBankId: string;
  pabiloMovementType: string;
  paymentDestinationJson: string;
}

export function getSettings(db: Database.Database): AppSettings {
  const row: any = db.prepare("SELECT * FROM settings WHERE id = 1").get();
  return {
    usdToBsRate: row.usd_to_bs_rate,
    marginPercent: row.margin_percent,
    roundingMode: row.rounding_mode,
    roundingIncrementBs: row.rounding_increment_bs,
    minimumPriceBs: row.minimum_price_bs,
    pabiloEnabled: Boolean(row.pabilo_enabled),
    pabiloUserBankId: row.pabilo_user_bank_id,
    pabiloMovementType: row.pabilo_movement_type,
    paymentDestinationJson: row.payment_destination_json ?? "{}",
  };
}

export function updateSettings(
  db: Database.Database,
  input: unknown,
  createdBy: string,
): AppSettings {
  const values = settingsInputSchema.parse(input);
  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE settings SET
        usd_to_bs_rate = ?,
        margin_percent = ?,
        rounding_mode = ?,
        rounding_increment_bs = ?,
        minimum_price_bs = ?,
        pabilo_enabled = ?,
        pabilo_user_bank_id = ?,
        pabilo_movement_type = ?,
        payment_destination_json = ?,
        updated_at = ?
      WHERE id = 1
    `).run(
      values.usdToBsRate,
      values.marginPercent,
      values.roundingMode,
      values.roundingIncrementBs,
      values.minimumPriceBs,
      values.pabiloEnabled ? 1 : 0,
      values.pabiloUserBankId,
      values.pabiloMovementType,
      values.paymentDestinationJson,
      now,
    );
    db.prepare("INSERT INTO settings_history (settings_json, created_at, created_by) VALUES (?, ?, ?)")
      .run(JSON.stringify(values), now, createdBy);
  });
  transaction();
  return getSettings(db);
}