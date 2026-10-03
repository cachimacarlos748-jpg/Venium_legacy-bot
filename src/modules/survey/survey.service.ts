import type Database from "better-sqlite3";
import pino from "pino";
import { publishEvent } from "../events/event-bus.js";
import type { BotCore } from "../whatsapp/bot-core.js";

const logger = pino({ level: process.env.NODE_ENV === "production" ? "info" : "warn" });

// CSAT (encuesta de satisfacción). The store only gets ONE chance to ask:
// right after a successful recharge, or right after a human support session
// ends (the bot takes over again). WhatsApp buttons cap at three options, so
// the scale is compressed into 5 / 3 / 1 stars and expanded for the report.
export type SurveyTrigger = "order" | "support";

export const SURVEY_BUTTONS = [
  { id: "encuesta:5", title: "😊 Muy bien" },
  { id: "encuesta:3", title: "🙂 Más o menos" },
  { id: "encuesta:1", title: "😞 Tuve problemas" },
];

export function surveyMessage(trigger: SurveyTrigger, reference?: string): string {
  const lines = trigger === "order"
    ? [
        "📊 *¿Cómo te fue con tu recarga?*",
        "",
        reference ? `Tu pedido: *${reference}*` : "",
        "Tu calificación nos ayuda a mejorar ⚡ Toca una opción 👇",
      ]
    : [
        "📊 *¿Cómo te fue con el soporte?*",
        "",
        "Tu calificación nos ayuda a mejorar 🙌 Toca una opción 👇",
      ];
  return lines.filter(Boolean).join("\n");
}

// True when this chat already answered a survey recently: the "soporte" path
// has no per-order flag, so the log itself is the guard (one survey per chat
// every 24 h, spam-proof).
function answeredRecently(db: Database.Database, jid: string, withinMs: number): boolean {
  const row = db.prepare("SELECT created_at FROM surveys WHERE whatsapp_jid = ? ORDER BY id DESC LIMIT 1").get(jid) as any;
  return Boolean(row && Date.now() - Date.parse(row.created_at) < withinMs);
}

// Sends the survey once. For completed orders the flag lives on the order
// (webhook + reconciliation can both fire); for support sessions the guard is
// the last survey answered in this chat. Returns true when the message went
// out.
export async function sendSurvey(
  db: Database.Database,
  core: Pick<BotCore, "sendCustomerNotice">,
  jid: string,
  options: { trigger: SurveyTrigger; orderId?: string },
): Promise<boolean> {
  try {
    if (options.trigger === "order" && options.orderId) {
      const claim = db.prepare("UPDATE orders SET survey_sent_at = ? WHERE id = ? AND survey_sent_at IS NULL")
        .run(new Date().toISOString(), options.orderId);
      if (claim.changes !== 1) return false;
      try {
        await core.sendCustomerNotice(jid, surveyMessage("order", options.orderId.slice(0, 8)), { buttons: SURVEY_BUTTONS });
      } catch (error) {
        // The notice failed (link down): release the flag so the next pass
        // retries instead of silently losing the survey.
        db.prepare("UPDATE orders SET survey_sent_at = NULL WHERE id = ?").run(options.orderId);
        throw error;
      }
      return true;
    }
    if (answeredRecently(db, jid, 24 * 60 * 60_000)) return false;
    await core.sendCustomerNotice(jid, surveyMessage("support"), { buttons: SURVEY_BUTTONS });
    return true;
  } catch (error) {
    logger.warn({ err: error, jid, trigger: options.trigger }, "Survey could not be sent");
    return false;
  }
}

// Records the customer's tap. The trigger is recovered from the DB: if a
// survey was sent for one of this customer's orders in the last 24 h the
// answer belongs to the recharge, otherwise to the support session.
export function saveSurveyResponse(db: Database.Database, jid: string, score: number): { low: boolean } {
  const order: any = db.prepare(`
    SELECT o.id FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE c.whatsapp_jid = ? AND o.survey_sent_at IS NOT NULL
      AND o.survey_sent_at > ?
    ORDER BY o.survey_sent_at DESC LIMIT 1
  `).get(jid, new Date(Date.now() - 24 * 60 * 60_000).toISOString());
  const trigger: SurveyTrigger = order ? "order" : "support";
  db.prepare(`
    INSERT INTO surveys (whatsapp_jid, trigger_reason, order_id, score, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(jid, trigger, order?.id ?? null, score, new Date().toISOString());
  publishEvent({
    type: "survey_response",
    jid,
    phone: jid.split("@")[0] || jid,
    preview: `${"⭐".repeat(score)} ${score}/5 · ${trigger === "order" ? "recarga" : "soporte"}`,
    meta: { score, trigger, orderId: order?.id ?? null },
  });
  return { low: score <= 2 };
}
