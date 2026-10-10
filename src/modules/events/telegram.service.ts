import { env } from "../../config/env.js";
import { subscribeEvents, type VexEvent } from "./event-bus.js";

// Avisos al owner por Telegram. Es un canal independiente al Web Push: el push
// llega al navegador instalado del dueño; Telegram llega al chat donde el bot
// es adicionado, incluso si el panel no esta abierto.
//
// No bloquea el flujo de ventas si Telegram falla: se reintenta en segundo
// plano y se registra el error para que el dueño pueda revisar /api/admin/telegram.

const TELEGRAM_API_BASE = "https://api.telegram.org/bot";

function telegramConfigured(): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
}

function chatIdRaw(): string {
  const raw = env.TELEGRAM_CHAT_ID.trim();
  // Acepta el @username del chat directamente, pero conjugarlo con el numero
  // de ID numérico es lo más resistente (los grupos privados no se resuelven
  // con @ si el bot nunca entro en ellos).
  const normalized = raw.trim();
  if (!normalized) return "";
  return normalized.startsWith("-") || /^\d+$/.test(normalized)
    ? normalized
    : `@${normalized.replace(/^@/, "")}`;
}

interface TelegramMessagePayload {
  chat_id: string;
  text: string;
  parse_mode?: "MarkdownV2" | "HTML";
  disable_web_page_preview?: boolean;
  disable_notification?: boolean;
}

// Telegram es rico en caracteres especiales. Si el texto llega aqui con
// MarkdownV2, el caller debe escapar ya. Para los mensajes del bus usamos
// HTML: es menos propenso a dejar el mensaje cortado por un carácter sin
// escapar en un preview de admin.
async function telegramFetch(path: string, payload: TelegramMessagePayload): Promise<{
  ok: boolean;
  error_code?: number;
  description?: string;
  result?: unknown;
}> {
  const url = `${TELEGRAM_API_BASE}${env.TELEGRAM_BOT_TOKEN}${path}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const rawText = await response.text().catch(() => "");
  if (!response.ok) {
    return {
      ok: false,
      error_code: response.status,
      description: `HTTP ${response.status}: ${rawText.slice(0, 500)}`,
    };
  }
  try {
    return JSON.parse(rawText) as {
      ok: boolean;
      error_code?: number;
      description?: string;
      result?: unknown;
    };
  } catch {
    return { ok: false, error_code: 0, description: `Invalid JSON response: ${rawText.slice(0, 500)}` };
  }
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

function escapeHtml(thing: unknown): string {
  return String(thing ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function eventToHtml(event: VexEvent): string {
  const title = TITLES[event.type] ?? "⚡ Vex Store";
  const meta = event.meta
    ? Object.entries(event.meta)
        .filter(([, value]) => value != null && value !== "")
        .slice(0, 8)
        .map(([key, value]) => `<b>${escapeHtml(key)}</b>: ${escapeHtml(value)}`)
        .join(" · ")
    : "";
  return [
    `<b>${title}</b>`,
    `<pre wrap>${escapeHtml(event.preview ?? "")}</pre>`,
    meta ? `<i>${meta}</i>` : "",
    `<a href="/admin?view=chats&jid=${escapeHtml(event.jid)}">${escapeHtml(event.phone ?? event.jid)}</a>`,
  ]
    .filter(Boolean)
    .join("\n");
}

// Mensajes del bus configurados para avisar al dueño. No todo lo que pasa por
// el bus necesita llegar a Telegram, pero los eventos de venta y los alertas
// de operación sí.
const TELEGRAM_NOTIFY_EVENTS = new Set<string>([
  "order_created",
  "payment_verified",
  "payment_review",
  "order_completed",
  "order_stuck",
  "provider_alert",
  "multi_number",
  "user_blocked",
  "bot_error",
  "handoff_on",
]);

export { telegramConfigured, chatIdRaw };

export async function sendTelegramMessage(
  text: string,
  options: Partial<TelegramMessagePayload> = {},
): Promise<{ ok: boolean; error?: string; messageId?: number }> {
  if (!telegramConfigured()) {
    return { ok: false, error: "Telegram no configurado (falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID)" };
  }
  const payload: TelegramMessagePayload = {
    chat_id: chatIdRaw(),
    text,
    disable_web_page_preview: true,
    ...options,
  };
  const result = await telegramFetch("/sendMessage", payload);
  if (!result.ok) {
    return { ok: false, error: result.description ?? `telegram error ${result.error_code}` };
  }
  return {
    ok: true,
    messageId: Number((result.result as any)?.message_id ?? 0) || undefined,
  };
}

// Registra un listener en el bus existente y reenvía los eventos elegidos a
// Telegram. Se puede llamar varias veces: el bus es pub/sub, no se duplican
// los envíos por cada subscribe.
export function attachTelegramNotifier(): () => void {
  if (!telegramConfigured()) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID vacío: no se envían avisos");
    return () => {};
  }

  const unsubscribe = subscribeEvents((event: VexEvent) => {
    if (!TELEGRAM_NOTIFY_EVENTS.has(event.type)) return;
    void sendTelegramMessage(eventToHtml(event), { parse_mode: "HTML" }).catch((error) => {
      console.error("[telegram] fallo al enviar aviso", { type: event.type, error });
    });
  });

  console.log("[telegram] avisos conectados al bus de eventos");
  return unsubscribe;
}

// Envia una prueba controlada para confirmar que el dueño recibe algo en
// su chat sin tener que esperar un pedido real.
export async function sendTelegramTest(): Promise<{ ok: boolean; error?: string }> {
  if (!telegramConfigured()) {
    return { ok: false, error: "Telegram no configurado (falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID)" };
  }
  const now = new Date().toISOString();
  const payload = eventToHtml({
    type: "message_in",
    jid: "test@vex.store",
    phone: "Prueba de conexión",
    preview: "🔔 Si ves esto, las notificaciones de Telegram están conectadas y funcionando.",
    meta: {
      servidor: env.NODE_ENV === "production" ? "producción" : env.NODE_ENV ?? "desconocido",
      hora: now.slice(0, 19).replace("T", " "),
    },
    at: now,
  });
  const result = await sendTelegramMessage(payload, { parse_mode: "HTML" });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true };
}
