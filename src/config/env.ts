import "dotenv/config";
import { z } from "zod";

const inputEnv = {
  ...process.env,
  PABILO_MODE: process.env.PABILO_MODE ?? process.env.PABLO_MODE,
};

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_PATH: z.string().default("./data/app.db"),
  ADMIN_USERNAME: z.string().default("admin"),
  ADMIN_PASSWORD: z.string().default(""),
  VENIUM_MODE: z.enum(["mock", "live", "dev"]).default("mock").transform((mode) => mode === "dev" ? "mock" : mode),
  VENIUM_BASE_URL: z.string().url().default("https://veniumstore.com"),
  VENIUM_API_KEY: z.string().default(""),
  ALLOW_LIVE_ORDER_CREATION: z.string().default("false").transform((value) => value === "true"),
  PABILO_MODE: z.enum(["mock", "live", "dev"]).default("mock").transform((mode) => mode === "dev" ? "mock" : mode),
  PABILO_BASE_URL: z.string().url().default("https://api.pabilo.app"),
  PABILO_API_KEY: z.string().default(""),
  PABILO_USER_BANK_ID: z.string().default(""),
  PABILO_MOVEMENT_TYPE: z.string().default("GENERIC"),
  GEMINI_MODE: z.enum(["disabled", "mock", "live"]).default("disabled"),
  // Comma-separated list of Gemini API keys. Keys are rotated automatically:
  // if one fails (quota, 503 "high demand", invalid key), the next one is
  // tried transparently.
  GEMINI_API_KEY: z.string().default(""),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  WHATSAPP_MODE: z.enum(["disabled", "mock", "live"]).default("disabled"),
  // Transport: "web" = whatsapp-web.js (unofficial, QR), "cloud" = Meta
  // WhatsApp Cloud API (official, webhook-based, no browser).
  WHATSAPP_PROVIDER: z.enum(["web", "cloud"]).default("web"),
  WHATSAPP_CLOUD_ACCESS_TOKEN: z.string().default(""),
  WHATSAPP_CLOUD_PHONE_NUMBER_ID: z.string().default(""),
  WHATSAPP_CLOUD_VERIFY_TOKEN: z.string().default(""),
  WHATSAPP_CLOUD_API_VERSION: z.string().default("v21.0"),
  META_APP_SECRET: z.string().default(""),
  WHATSAPP_PAIRING_MODE: z.enum(["phone", "qr"]).default("phone"),
  WHATSAPP_AUTH_DIR: z.string().default("./data/whatsapp-auth"),
  WHATSAPP_PAIRING_PHONE: z.string().regex(/^\d{8,15}$/).default("584222896623"),
  WHATSAPP_ALLOW_GROUPS: z.string().default("false").transform((value) => value === "true"),
  WHATSAPP_RECONNECT_DELAY_MS: z.coerce.number().int().min(1000).max(60000).default(5000),
  VENIUM_WEBHOOK_SECRET: z.string().default(""),
  WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),
  // Web Push (VAPID) for admin phone notifications. Without these the panel
  // still works; it just cannot wake the phone with a push message.
  VAPID_PUBLIC_KEY: z.string().default(""),
  VAPID_PRIVATE_KEY: z.string().default(""),
  VAPID_SUBJECT: z.string().default("mailto:admin@vexstore.app"),
});

export const env = envSchema.parse(inputEnv);

export function providerStatus(mode: string, key: string): "mock" | "live" | "disabled" | "missing-secret" {
  if (mode === "disabled") return "disabled";
  if (mode === "live" && !key) return "missing-secret";
  return mode as "mock" | "live";
}