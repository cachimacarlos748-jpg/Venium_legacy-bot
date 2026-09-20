// Official WhatsApp Cloud API adapter (Meta). No browser, no QR, no session
// that can drop: Meta delivers incoming messages via webhook and replies go
// through the graph API. All sales logic lives in bot-core; this file is only
// transport + signature verification.
import { createHmac, timingSafeEqual } from "node:crypto";
import pino from "pino";
import { env } from "../../config/env.js";
import { createBotCore, type BotCore, type CoreIncoming } from "./bot-core.js";
import type Database from "better-sqlite3";

const logger = pino({ level: process.env.NODE_ENV === "production" ? "info" : "warn" });

export function verifyMetaSignature(rawBody: string, signatureHeader: string | undefined): boolean {
  if (!env.META_APP_SECRET) return false; // Without a secret we cannot verify.
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", env.META_APP_SECRET).update(rawBody).digest("hex");
  const received = signatureHeader.slice("sha256=".length);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

interface CloudAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  isReady(): boolean;
  status(): { enabled: boolean; connection: string; provider: "cloud"; phoneNumberIdConfigured: boolean };
  handleWebhookEvent(rawBody: string): { processed: number };
  sendHumanReply(jid: string, text: string): Promise<void>;
  // Present for interface parity with the whatsapp-web.js adapter. The Cloud
  // API has no pairing/session lifecycle, so these are intentional no-ops.
  setPairingMode(mode: "phone" | "qr"): Promise<void>;
  refreshPairingCode(): Promise<void>;
  resetSession(): Promise<void>;
}

export function createCloudAdapter(db: Database.Database): CloudAdapter & { core: BotCore } {
  async function sendMessage(jid: string, text: string): Promise<void> {
    if (env.WHATSAPP_MODE !== "live") {
      logger.info({ jid, text: text.slice(0, 120) }, "[cloud-mock] send skipped (WHATSAPP_MODE != live)");
      return;
    }
    const response = await fetch(
      `https://graph.facebook.com/${env.WHATSAPP_CLOUD_API_VERSION}/${env.WHATSAPP_CLOUD_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.WHATSAPP_CLOUD_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: jid,
          type: "text",
          text: { preview_url: false, body: text },
        }),
      },
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`WhatsApp Cloud API error ${response.status}: ${body.slice(0, 300)}`);
    }
  }

  const core = createBotCore(db, sendMessage);

  function extractMessages(payload: any): Array<CoreIncoming & { id?: string }> {
    const entries: any[] = payload?.entry ?? [];
    const out: Array<CoreIncoming & { id?: string }> = [];
    for (const entry of entries) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value;
        if (!value?.messages) continue;
        for (const message of value.messages) {
          const from: string = message.from ?? "";
          const type = message.type ?? "text";
          let text = "";
          let hasMedia = false;
          let isImage = false;
          let downloadMedia: (() => Promise<{ data: string; mimetype: string } | null>) | undefined;
          if (type === "text") {
            text = message.text?.body ?? "";
          } else if (type === "image") {
            hasMedia = true;
            isImage = true;
            const mediaId = message.image?.id;
            downloadMedia = async () => {
              if (!mediaId || env.WHATSAPP_MODE !== "live") return null;
              // Cloud API media flow: fetch a short-lived URL, then fetch bytes.
              const urlRes = await fetch(`https://graph.facebook.com/${env.WHATSAPP_CLOUD_API_VERSION}/${mediaId}`, {
                headers: { authorization: `Bearer ${env.WHATSAPP_CLOUD_ACCESS_TOKEN}` },
              });
              if (!urlRes.ok) return null;
              const urlData: any = await urlRes.json();
              const binRes = await fetch(urlData?.url, {
                headers: { authorization: `Bearer ${env.WHATSAPP_CLOUD_ACCESS_TOKEN}` },
              });
              if (!binRes.ok) return null;
              const buffer = Buffer.from(await binRes.arrayBuffer());
              return { data: buffer.toString("base64"), mimetype: message.image?.mime_type ?? "image/jpeg" };
            };
          }
          out.push({
            from,
            id: message.id,
            text,
            hasMedia,
            isImage,
            timestampSec: Number(message.timestamp ?? 0),
            downloadMedia,
          });
        }
      }
    }
    return out;
  }

  return {
    core,
    start: async () => {
      // The Cloud API is connectionless: Meta pushes events to the webhook.
      core.markLinked();
      logger.info(
        {
          provider: "cloud",
          live: env.WHATSAPP_MODE === "live",
          phoneConfigured: Boolean(env.WHATSAPP_CLOUD_PHONE_NUMBER_ID),
          verifyTokenConfigured: Boolean(env.WHATSAPP_CLOUD_VERIFY_TOKEN),
        },
        "WhatsApp Cloud API adapter ready",
      );
    },
    stop: async () => {},
    isReady: () => true,
    status: () => ({
      enabled: env.WHATSAPP_MODE !== "disabled",
      connection: env.WHATSAPP_MODE === "live" ? "open" : "mock",
      provider: "cloud" as const,
      phoneNumberIdConfigured: Boolean(env.WHATSAPP_CLOUD_PHONE_NUMBER_ID),
    }),
    handleWebhookEvent: (rawBody: string) => {
      let payload: any;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return { processed: 0 };
      }
      const messages = extractMessages(payload);
      for (const message of messages) {
        void core
          .processIncoming(message)
          .catch((error) => logger.error({ err: error, from: message.from }, "Cloud API message processing failed"));
      }
      return { processed: messages.length };
    },
    sendHumanReply: (jid: string, text: string) => core.sendHumanReply(jid, text),
    setPairingMode: async () => {},
    refreshPairingCode: async () => {},
    resetSession: async () => {},
  };
}

export type { CloudAdapter as WhatsAppCloudAdapter };
