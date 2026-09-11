import whatsappWeb from "whatsapp-web.js";
import type { Message } from "whatsapp-web.js";

const { Client, LocalAuth } = whatsappWeb;
import Database from "better-sqlite3";
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";
import QRCodeImage from "qrcode";
import { env } from "../../config/env.js";
import { listCatalog, findPackage, syncCatalog } from "../catalog/catalog.service.js";
import { getSettings } from "../admin/settings.service.js";
import { calculatePrice } from "../pricing/pricing.service.js";
import { createLocalOrder, toPublicOrder } from "../orders/order.service.js";
import { submitReceipt } from "../payments/payment.service.js";
import { moderateMessage } from "../moderation/moderation.service.js";
import { createVeniumClient } from "../venium/venium.client.js";
import { createSalesAssistant } from "../gemini/gemini.adapter.js";
import { createHealthProbe } from "./health-probe.js";
import {
  logCustomerMessage,
  logBotMessage,
  logHumanMessage,
  listRecentMessages,
  setHandoff,
} from "../chats/chat.service.js";

const logger = pino({ level: process.env.NODE_ENV === "production" ? "info" : "warn" });

type SessionState = "idle" | "awaiting_player" | "awaiting_receipt";

interface WhatsAppSession {
  whatsappJid: string;
  state: SessionState;
  packageId: string | null;
  playerData: Record<string, string>;
  orderId: string | null;
  handoff: boolean;
  lastShown: Array<{ n: number; packageId: string; label: string }>;
}

export interface WhatsAppAdapter {
  enabled: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  setPairingMode(mode: "phone" | "qr"): Promise<void>;
  refreshPairingCode(): Promise<void>;
  resetSession(): Promise<void>;
  sendMessage(jid: string, text: string): Promise<void>;
  sendHumanReply(jid: string, text: string): Promise<void>;
  isReady(): boolean;
  status(): {
    enabled: boolean;
    connection: "closed" | "connecting" | "open";
    pairingMode: "phone" | "qr";
    pairingCode: string | null;
    pairingCodeUpdatedAt: string | null;
    pairingPhone: string;
    qrDataUrl: string | null;
    qrExpiresAt: string | null;
  };
}

// Only these three games are sold through WhatsApp; every other product is
// redirected to the web store.
const WHATSAPP_GAMES = ["free fire", "blood strike", "roblox"];
const WEB_STORE_URL = "https://recargaslegacystore.base44.app";

// Level passes (Nivel 6/10/15/…) are web-store only; WhatsApp sells diamonds,
// memberships and Roblox Robux. Everything matching these patterns is hidden
// from the WhatsApp list even if Venium offers it.
const WHATSAPP_EXCLUDED_PACKAGE_PATTERNS = [
  /^nivel\s*\d+$/i,
  /^pase de nivel/i,
  /^mock-/i,
  /brl/i,
  /gift/i,
  /skin/i,
  /suerte/i,
  /lucky/i,
  /mejora/i,
  /upgrade/i,
];

function isSellableOnWhatsApp(item: CatalogPackageRow): boolean {
  // Only real Venium packages can be sold: demo/mock entries are for tests.
  if (/mock/i.test(item.packageId || "")) return false;
  const name = (item.packageName || "").trim();
  return !WHATSAPP_EXCLUDED_PACKAGE_PATTERNS.some((pattern) => pattern.test(name));
}

// Numeric-aware sort key: "100+10" < "310+31" < "1060+106", and Robux/BRL
// amounts sort by their leading number so lists always go low → high.
function packageSortValue(item: CatalogPackageRow): number {
  const name = (item.packageName || "").trim();
  const firstNumber = name.match(/\d+/);
  return firstNumber ? Number(firstNumber[0]) : Number.POSITIVE_INFINITY;
}

function sortPackagesAscending(items: CatalogPackageRow[]): CatalogPackageRow[] {
  return [...items].sort((a, b) => {
    const amountDiff = packageSortValue(a) - packageSortValue(b);
    if (amountDiff !== 0) return amountDiff;
    // Same leading number (e.g. "100 + 5" vs "100 + 16"): order by real price.
    return Number(a.costUsd) - Number(b.costUsd);
  });
}

// Removes duplicate packages (same name from repeated Venium syncs) keeping
// the cheapest one, and drops anything not sellable on WhatsApp.
function dedupeSellablePackages(items: CatalogPackageRow[]): CatalogPackageRow[] {
  const kept = new Map<string, CatalogPackageRow>();
  for (const item of items) {
    if (!isSellableOnWhatsApp(item)) continue;
    const nameKey = (item.packageName || "").trim().toLowerCase().replace(/\s+/g, " ");
    const existing = kept.get(nameKey);
    if (!existing || Number(item.costUsd) < Number(existing.costUsd)) kept.set(nameKey, item);
  }
  return sortPackagesAscending([...kept.values()]);
}

function sessionFromRow(row: any): WhatsAppSession {
  let lastShown: WhatsAppSession["lastShown"] = [];
  try { lastShown = JSON.parse(row.last_shown_json || "[]"); } catch { lastShown = []; }
  return {
    whatsappJid: row.whatsapp_jid,
    state: row.state,
    packageId: row.package_id,
    playerData: JSON.parse(row.player_data_json || "{}"),
    orderId: row.order_id,
    handoff: Boolean(row.handoff),
    lastShown: Array.isArray(lastShown) ? lastShown : [],
  };
}

function getFreshSession(db: Database.Database, jid: string): WhatsAppSession {
  const row = db.prepare("SELECT * FROM whatsapp_sessions WHERE whatsapp_jid = ?").get(jid);
  if (row) return sessionFromRow(row);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO whatsapp_sessions (whatsapp_jid, state, player_data_json, last_shown_json, updated_at)
    VALUES (?, 'idle', '{}', '[]', ?)
  `).run(jid, now);
  return { whatsappJid: jid, state: "idle", packageId: null, playerData: {}, orderId: null, handoff: false, lastShown: [] };
}

function getSession(db: Database.Database, jid: string): WhatsAppSession {
  return getFreshSession(db, jid);
}

function saveSession(db: Database.Database, session: WhatsAppSession): void {
  db.prepare(`
    INSERT INTO whatsapp_sessions
      (whatsapp_jid, state, package_id, player_data_json, order_id, handoff, last_shown_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(whatsapp_jid) DO UPDATE SET
      state = excluded.state,
      package_id = excluded.package_id,
      player_data_json = excluded.player_data_json,
      order_id = excluded.order_id,
      handoff = excluded.handoff,
      last_shown_json = excluded.last_shown_json,
      updated_at = excluded.updated_at
  `).run(
    session.whatsappJid,
    session.state,
    session.packageId,
    JSON.stringify(session.playerData),
    session.orderId,
    session.handoff ? 1 : 0,
    JSON.stringify(session.lastShown),
    new Date().toISOString(),
  );
}

function normalizeKey(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parsePlayerData(text: string, fields: Array<{ key: string; label: string }>): Record<string, string> {
  const value = text.trim();
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [key, String(item).trim()]));
    }
  } catch {
    // Human-friendly key:value input is handled below.
  }

  const result: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    const separator = colon >= 0 ? colon : line.indexOf("=");
    if (separator <= 0) continue;
    const keyText = normalizeKey(line.slice(0, separator));
    const field = fields.find((item) => normalizeKey(item.key) === keyText || normalizeKey(item.label) === keyText);
    if (field) result[field.key] = line.slice(separator + 1).trim();
  }
  if (!Object.keys(result).length && fields.length === 1) result[fields[0].key] = value;
  return result;
}

function gameMatches(normalizedProductName: string, game: string): boolean {
  const key = normalizeKey(game);
  if (!key) return true;
  return normalizedProductName.includes(key) || key.includes(normalizedProductName);
}

type CatalogPackageRow = {
  packageId: string;
  packageName: string;
  productName: string;
  productId: string;
  costUsd: string;
  outOfStock: boolean;
};

// Keeps only the three WhatsApp games; everything else is a web-store sale.
function filterWhatsAppGames(packages: CatalogPackageRow[]): CatalogPackageRow[] {
  return dedupeSellablePackages(
    packages.filter((item) =>
      WHATSAPP_GAMES.some((game) => gameMatches(normalizeKey(item.productName), game)),
    ),
  );
}

function catalogPackages(db: Database.Database): CatalogPackageRow[] {
  return listCatalog(db).flatMap((product: any) =>
    product.packages.map((item: any) => ({
      packageId: item.packageId,
      packageName: item.name,
      productName: product.name,
      productId: product.productId,
      costUsd: item.costUsd,
      outOfStock: item.outOfStock,
    })),
  );
}

function productExists(db: Database.Database, game: string): boolean {
  return catalogPackages(db).some((item) => !item.outOfStock && gameMatches(normalizeKey(item.productName), normalizeKey(game)));
}

function availableGamesLine(db: Database.Database): string {
  const games = [...new Set(filterWhatsAppGames(catalogPackages(db)).map((item) => item.productName.trim()))];
  return games.length ? games.map((name) => `🎮 ${name}`).join("\n") : WHATSAPP_GAMES.map((g) => `🎮 ${g}`).join("\n");
}

function fmtBs(value: string): string {
  const number = Number(value);
  return "Bs " + (Number.isFinite(number) ? number.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : value);
}

// WhatsApp key-cap number emojis for any 1–2 digit number (1–99).
const DIGIT_EMOJIS = ["0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];

function numberEmoji(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 99) return `${n}.`;
  if (n === 10) return "🔟";
  return String(n)
    .split("")
    .map((digit) => DIGIT_EMOJIS[Number(digit)])
    .join("");
}

// Price list for one game (or the three WhatsApp games when no filter).
// Items arrive already filtered (sellable packages only) and sorted from the
// catalog helpers, so the bot never invents packages and never reorders them.
function priceListMessage(db: Database.Database, game?: string, collect?: Array<{ n: number; packageId: string; label: string }>): string {
  const settings = getSettings(db);
  let packages = filterWhatsAppGames(catalogPackages(db)).filter((item) => !item.outOfStock);
  if (game) {
    const needle = normalizeKey(game);
    const matches = packages.filter((item) => gameMatches(normalizeKey(item.productName), needle));
    if (matches.length) packages = matches;
  }
  const collected = collect ?? [];

  if (!packages.length) {
    return [
      "🤔 Por WhatsApp manejo estos juegos:",
      availableGamesLine(db),
      "",
      `🌐 Si buscas otro juego, lo tienes en nuestra web: ${WEB_STORE_URL}`,
      "",
      "¿Te interesa alguno de los tres? 😊",
    ].join("\n");
  }

  const byProduct = new Map<string, typeof packages>();
  for (const item of packages) {
    const list = byProduct.get(item.productName) ?? [];
    list.push(item);
    byProduct.set(item.productName, list);
  }

  let n = collected.length;

  // Games appear in the store's flagship order: Free Fire, Blood Strike, Roblox.
  const gameOrder = (productName: string): number => {
    const key = normalizeKey(productName);
    const index = WHATSAPP_GAMES.findIndex((game) => gameMatches(key, game));
    return index === -1 ? WHATSAPP_GAMES.length : index;
  };
  const sections = [...byProduct.entries()]
    .sort((a, b) => gameOrder(a[0]) - gameOrder(b[0]))
    .map(([productName, items]) => {
      const lines = items.map((item) => {
        n += 1;
        const quote = calculatePrice(item.costUsd, 1, settings);
        collected.push({ n, packageId: item.packageId, label: `${productName.trim()} — ${item.packageName}` });
        return `  ${numberEmoji(n)} *${item.packageName}*\n      💵 ${fmtBs(quote.salePriceBsTotal)}`;
      });
      return `🎮 *${productName.trim()}*\n${lines.join("\n")}`;
    });

  return [
    "🛍️ *Legacy Store*",
    "",
    ...sections,
    "",
    "💰 El precio se fija al crear tu pedido: la tasa ya no te afecta.",
    "👉 Dime el *número* del que quieres y seguimos 😊",
  ].join("\n");
}

function welcomeMessage(): string {
  return [
    "¡Hola! 👋 Bienvenido a *Legacy Store* 🎮",
    "",
    "Vendemos recargas de *Free Fire, Blood Strike y Roblox* con entrega rapidísima ⚡",
    "",
    "¿Cómo te puedo ayudar hoy? 😊",
  ].join("\n");
}

function handoffMessageForCustomer(): string {
  return [
    "Perfecto, ya le aviso a mi compañero humano del equipo 🙋",
    "En un momento te escribe por aquí mismo. 🙌",
    "",
    "Mientras tanto, ¿quieres ver precios de *Free Fire, Blood Strike o Roblox*?",
  ].join("\n");
}

function paymentDestinationMessage(db: Database.Database): string {
  const raw = getSettings(db).paymentDestinationJson;
  try {
    const destination = JSON.parse(raw);
    if (destination && Object.keys(destination).length) {
      return `Transfiere únicamente al destino configurado:\n${Object.entries(destination)
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join("\n")}`;
    }
  } catch {
    // Invalid admin configuration is intentionally not shown to customers.
  }
  return "El destino de pago aún no está configurado. No envíes el pago hasta recibir confirmación.";
}

function messageText(message: Message): string {
  return message.body ?? "";
}

// When the WhatsApp profile persists on a volume, Chromium leaves Singleton*
// lock files referencing the previous container's hostname. The next boot
// refuses to launch ("profile appears to be in use by another Chromium
// process on another computer"). Removing the stale locks is safe: they only
// matter while Chromium is running, and a fresh boot has no browser yet.
function removeStaleSingletonLocks(rootDir: string): void {
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = join(current, entry);
      if (entry.startsWith("Singleton")) {
        try {
          rmSync(fullPath, { force: true });
          logger.info({ file: fullPath }, "Removed stale Chromium singleton lock");
        } catch {
          // Best effort: a lock we cannot delete will fail the launch visibly.
        }
        continue;
      }
      try {
        if (statSync(fullPath).isDirectory()) stack.push(fullPath);
      } catch {
        // File vanished between readdir and stat; nothing to do.
      }
    }
  }
}

// Deterministic fallback: mirrors the sales brain's core moves when Gemini is
// off, slow or unreachable, so the store never goes silent.
function fallbackReply(text: string): { reply: string; showPricesFor: string | null } {
  const normalized = text.trim().toLowerCase();
  if (["hola", "holi", "buenas", "buenos dias", "buenas tardes", "buenas noches", "hey", "saludos", "epa", "que tal"].includes(normalized)) {
    return { reply: welcomeMessage(), showPricesFor: null };
  }
  if (["gracias", "ok", "vale", "listo", "perfecto", "chao", "adios", "hasta luego"].includes(normalized)) {
    return { reply: "🙏 ¡A la orden! Aquí estaré cuando quieras recargar ⚡😊", showPricesFor: null };
  }
  if (["precios", "lista", "catálogo", "catalogo", "menu"].includes(normalized)) {
    return { reply: "", showPricesFor: "" };
  }
  for (const game of WHATSAPP_GAMES) {
    if (normalizeKey(text).includes(normalizeKey(game))) return { reply: "", showPricesFor: game };
  }
  if (/(precio|cuesta|vale|cuanto|como compro|ayuda)/.test(normalized)) {
    return { reply: "", showPricesFor: "" };
  }
  return { reply: "", showPricesFor: null };
}

export function createWhatsAppAdapter(db: Database.Database): WhatsAppAdapter {
  const venium = createVeniumClient();
  const salesAssistant = createSalesAssistant();
  const healthProbe = createHealthProbe();
  let socket: InstanceType<typeof Client> | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let stopping = false;
  let connection: "closed" | "connecting" | "open" = "closed";
  let pairingCode: string | null = null;
  let pairingCodeUpdatedAt: string | null = null;
  let pairingTimer: NodeJS.Timeout | null = null;
  let qrDataUrl: string | null = null;
  let qrExpiresAt: string | null = null;
  let qrTimer: NodeJS.Timeout | null = null;
  let readyTimer: NodeJS.Timeout | null = null;
  let everReady = false;
  // Runtime pairing mode: 8-digit phone code or QR. Switchable from the admin
  // panel without touching the session volume.
  let pairingMode: "phone" | "qr" = env.WHATSAPP_PAIRING_MODE === "qr" ? "qr" : "phone";

  // Messages already processed in this process. whatsapp-web.js can deliver
  // the same message event more than once (duplicated listeners after a
  // reconnect, message_create + message dedup, etc.); without this guard the
  // bot replies twice and double-charges flows.
  const processedMessages = new Set<string>();

  function markProcessed(id: string | undefined): boolean {
    if (!id) return true; // No ID to dedupe on: process normally.
    if (processedMessages.has(id)) return false;
    processedMessages.add(id);
    // Keep the set bounded: 2k recent IDs is plenty and avoids unbounded memory.
    if (processedMessages.size > 2000) {
      const oldest = processedMessages.values().next().value;
      if (oldest) processedMessages.delete(oldest);
    }
    return true;
  }

  async function ensureCatalog(): Promise<void> {
    if (!catalogPackages(db).length) syncCatalog(db, await venium.getCatalog());
  }

  async function sendMessage(jid: string, text: string): Promise<void> {
    if (!socket || connection !== "open") {
      // The browser wedged or dropped while a customer was mid-conversation:
      // force a recovery instead of failing silently forever.
      logger.warn({ jid }, "sendMessage on a non-open client; scheduling recovery");
      scheduleRecovery();
      throw new Error("WhatsApp is not connected");
    }
    logger.info({ jid, text: text.slice(0, 120) }, "WhatsApp sending response");
    try {
      await socket.sendMessage(jid, text);
    } catch (error) {
      // A send failure usually means the page is wedged: relaunch the browser
      // (session is preserved) so the next customer message gets answered.
      logger.error({ err: error, jid }, "sendMessage failed; scheduling recovery");
      scheduleRecovery();
      throw error;
    }
  }

  // Recovers the browser when a wedge is detected at runtime. Debounced so a
  // burst of failures triggers a single relaunch.
  let recoveryTimer: NodeJS.Timeout | null = null;
  function scheduleRecovery(): void {
    if (recoveryTimer || stopping) return;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      if (stopping) return;
      logger.warn("Recovering WhatsApp client after runtime failure");
      void shutdownClient().then(() => {
        stopping = false;
        everReady = false;
        void connectWithRetry();
      });
    }, 2_000);
  }

  // Admin-panel human reply: log + deliver; turns the bot off for this chat.
  async function sendHumanReply(jid: string, text: string): Promise<void> {
    logHumanMessage(db, jid, text);
    await sendMessage(jid, text);
  }

  async function processReceipt(jid: string, session: WhatsAppSession, message: Message, text: string): Promise<void> {
    try {
      await processReceiptInner(jid, session, message, text);
    } catch (error) {
      // Gemini down, media failure, provider hiccup: the customer ALWAYS gets
      // an answer and the order stays awaiting_receipt so they can retry.
      logger.error({ err: error, from: jid }, "Receipt processing failed; apologizing and keeping the order open");
      const msg = "Ups, tuve un problema técnico leyendo el comprobante 😅 No se preocupó nada de tu pedido.\n\n📸 Mándame la foto del comprobante otra vez y lo confirmo de una vez 🙏";
      await sendMessage(jid, msg);
      logBotMessage(db, jid, msg);
    }
  }

  async function processReceiptInner(jid: string, session: WhatsAppSession, message: Message, text: string): Promise<void> {
    let imageBase64: string | undefined;
    let imageMimeType: string | undefined;
    if (message.hasMedia) {
      const media = await message.downloadMedia();
      if (!media) {
        const msg = "No pude descargar el comprobante. Envía la imagen nuevamente.";
        await sendMessage(jid, msg);
        logBotMessage(db, jid, msg);
        return;
      }
      if (media.data.length > 11 * 1024 * 1024) {
        const msg = "El comprobante supera el tamaño permitido. Envía una imagen más pequeña.";
        await sendMessage(jid, msg);
        logBotMessage(db, jid, msg);
        return;
      }
      imageBase64 = media.data;
      imageMimeType = media.mimetype || "image/jpeg";
    }

    const result: any = await submitReceipt(db, session.orderId!, {
      text: text || undefined,
      imageBase64,
      imageMimeType,
    });
    if (result.gemini?.status === "incomplete") {
      const msg = "No pude leer la referencia y el monto. Envía una foto más clara del comprobante.";
      await sendMessage(jid, msg);
      logBotMessage(db, jid, msg);
      return;
    }
    if (result.duplicate) {
      const msg = "Ese comprobante o referencia ya fue utilizado. El pedido no se procesó nuevamente.";
      await sendMessage(jid, msg);
      logBotMessage(db, jid, msg);
      return;
    }
    if (result.antifraud?.status === "suspicious") {
      const msg = "El comprobante quedó en revisión de seguridad. No se enviará ninguna orden hasta validarlo.";
      await sendMessage(jid, msg);
      logBotMessage(db, jid, msg);
      return;
    }
    if (!result.pabilo?.verified || !result.pabilo?.isNew) {
      const msg = "No se pudo confirmar un pago nuevo en Pabilo. Revisa los datos y contacta soporte.";
      await sendMessage(jid, msg);
      logBotMessage(db, jid, msg);
      return;
    }
    const order = toPublicOrder(result.order);
    saveSession(db, {
      ...session,
      state: "idle",
      packageId: null,
      playerData: {},
      orderId: null,
      lastShown: session.lastShown,
    });
    const msg = [
      "🎉 *¡Listo, tu pago quedó confirmado!*",
      "",
      `🧾 Pedido: ${String(order.id).slice(0, 8)}`,
      "⚡ En minutos recibes tu recarga. ¡Gracias por comprar en *Legacy Store*! 🙌",
    ].join("\n");
    await sendMessage(jid, msg);
    logBotMessage(db, jid, msg);
  }

  async function processIncomingMessage(message: Message): Promise<void> {
    logger.info({ from: message.from, type: message.type, body: message.body?.slice(0, 120), fromMe: message.fromMe }, "WhatsApp incoming message received");
    const jid = message.from;
    if (!jid || message.fromMe || message.isStatus) return;
    if (!markProcessed(message.id?.id ?? message.id?._serialized)) return;
    if (!env.WHATSAPP_ALLOW_GROUPS && jid.endsWith("@g.us")) return;

    const text = messageText(message);
    const hasImage = Boolean(message.hasMedia && message.type === "image");
    if (!text.trim() && !hasImage) return;

    logCustomerMessage(db, jid, text || "[imagen]", message.type === "image" ? "image" : "text");

    const moderation = moderateMessage(db, {
      whatsappJid: jid,
      message: text || "[comprobante de imagen]",
    });
    if (!moderation.allowed) {
      const response = moderation.action === "blocked"
        ? "Este chat está bloqueado temporalmente por actividad repetitiva."
        : "Demasiados mensajes seguidos. Espera un momento antes de continuar.";
      await sendMessage(jid, response);
      logBotMessage(db, jid, response);
      return;
    }

    const session = getFreshSession(db, jid);

    // Human took over from the admin panel: the bot stays silent. The owner
    // returns control with the "resume bot" action; "bot on" also re-arms it.
    if (session.handoff) {
      if (text.trim().toLowerCase() === "bot on") {
        setHandoffLocal(db, session, false, "");
        const msg = "✅ El asistente volvió a la conversación 😊 ¿En qué te ayudo?";
        await sendMessage(jid, msg);
        logBotMessage(db, jid, msg);
      }
      return;
    }

    if (text.trim().toLowerCase() === "bot off") {
      setHandoffLocal(db, session, true, "Solicitado desde el chat (bot off)");
      const msg = "🙋 Entendido, ahora te atiende una persona del equipo.";
      await sendMessage(jid, msg);
      logBotMessage(db, jid, msg);
      return;
    }

    // Inside an active purchase flow the receipt wins over anything else.
    if (session.state === "awaiting_receipt" && session.orderId) {
      await processReceipt(jid, session, message, text.trim());
      return;
    }

    // Fresh quote → restart the flow on any product text (never "stuck").
    if (session.state === "awaiting_player" && session.packageId) {
      const flowSession = session;
      const item: any = findPackage(db, flowSession.packageId!);
      if (!item) {
        saveSession(db, { ...flowSession, state: "idle", packageId: null, playerData: {}, orderId: null });
        const msg = "Ese paquete ya no está disponible. Te muestro de nuevo lo que tenemos 😊";
        await sendMessage(jid, msg);
        logBotMessage(db, jid, msg);
        return;
      }
      const fields = db.prepare(`
        SELECT field_key AS key, label FROM player_fields WHERE product_id = ? AND required = 1
      `).all(item.productLocalId) as Array<{ key: string; label: string }>;
      const playerData = parsePlayerData(text, fields);
      const missing = fields.filter((field) => !String(playerData[field.key] ?? "").trim());
      if (missing.length) {
        const label = missing.map((field) => field.label).join(", ");
        const msg = `📝 Para continuar, mándame ${label} del jugador. Ejemplo: ${missing[0].label}: 123 😊`;
        await sendMessage(jid, msg);
        logBotMessage(db, jid, msg);
        return;
      }
      try {
        const order = createLocalOrder(db, {
          whatsappJid: jid,
          phoneDisplay: jid.split("@")[0],
          packageId: flowSession.packageId!,
          playerData,
        });
        saveSession(db, { ...flowSession, state: "awaiting_receipt", playerData, orderId: order.id });
        const msg = [
          "🧾 *¡Listo, tu pedido quedó registrado!*",
          "",
          `💰 *Total a pagar: ${fmtBs(order.sale_price_bs_total)}*`,
          "⏰ El precio quedó fijo para ti (no sube con la tasa).",
          "",
          paymentDestinationMessage(db),
          "",
          "📸 Cuando pagues, mándame la *foto del comprobante* y te entrego al instante ⚡",
        ].join("\n");
        await sendMessage(jid, msg);
        logBotMessage(db, jid, msg);
      } catch (error) {
        const msg = error instanceof Error ? error.message : "No se pudo crear el pedido.";
        await sendMessage(jid, msg);
        logBotMessage(db, jid, msg);
      }
      return;
    }

    // Collect a price list of the three WhatsApp games for the sales brain.
    // Already filtered + sorted: Gemini only sees real, sellable packages.
    let priceList = "";
    try {
      await ensureCatalog();
      priceList = priceListMessage(db, undefined).split("\n").slice(0, -3).join("\n");
    } catch {
      priceList = "";
    }

    // Try the generative sales brain first; fall back deterministically.
    let reply = "";
    let handoffRequested = false;
    let handoffReason = "";
    let showedPrices = false;
    let selectionPackageId: string | null = null;

    const history = listRecentMessages(db, jid, 14)
      .filter((row) => row.source !== "system")
      .slice(0, -1) // drop the message we just logged
      .map((row) => ({ direction: row.direction === "in" ? "customer" as const : row.source === "human" ? "human" as const : "bot" as const, body: row.body }));

    const brain = await salesAssistant.generate({
      message: text,
      history,
      priceList,
      lastShown: session.lastShown.map((item) => `${item.n} = ${item.label}`).join("\n"),
      pendingOrderId: session.orderId,
      awaiting: session.state,
    });

    if (brain && brain.reply) {
      reply = brain.reply;
      if (brain.handoff) {
        handoffRequested = true;
        handoffReason = brain.handoffReason || "Sugerido por el asistente";
      }
      if (brain.action === "select_package" && brain.selection) {
        const found = session.lastShown.find((item) => item.n === brain.selection) ?? null;
        selectionPackageId = found ? found.packageId : null;
      }
    } else {
      const fb = fallbackReply(text);
      if (fb.reply) {
        reply = fb.reply;
      } else if (fb.showPricesFor !== null) {
        const collected: Array<{ n: number; packageId: string; label: string }> = [];
        reply = priceListMessage(db, fb.showPricesFor || undefined, collected);
        session.lastShown = collected;
        showedPrices = true;
      } else {
        // Deterministic fallback: a bare number selects from the last list shown.
        const onlyNumber = text.trim().match(/^(\d{1,2})$/);
        const found = onlyNumber ? session.lastShown.find((item) => item.n === Number(onlyNumber[1])) : null;
        if (found) {
          selectionPackageId = found.packageId;
        } else {
          reply = "Hmm, no te entendí bien 🤔 ¿Me dices qué juego quieres recargar: *Free Fire*, *Blood Strike* o *Roblox*?";
        }
      }
    }

    // Brain wants prices for a game: render the exact price list.
    if (brain && brain.reply && brain.action === "show_prices") {
      const collected: Array<{ n: number; packageId: string; label: string }> = [];
      const listText = priceListMessage(db, brain.product || undefined, collected);
      if (collected.length) {
        session.lastShown = collected;
        showedPrices = true;
        reply = listText;
      }
    }

    // Brain says the customer picked a package number: run the checkout flow.
    if (selectionPackageId) {
      const packages = filterWhatsAppGames(catalogPackages(db)).filter((item) => !item.outOfStock);
      const selected = packages.find((item) => item.packageId === selectionPackageId);
      if (selected) {
        const fields = (listCatalog(db).find((product: any) => product.productId === selected.productId) as any)?.playerFields ?? [];
        saveSession(db, {
          whatsappJid: jid,
          state: "awaiting_player",
          packageId: selected.packageId,
          playerData: {},
          orderId: null,
          handoff: session.handoff,
          lastShown: session.lastShown,
        });
        const quote = calculatePrice(selected.costUsd, 1, getSettings(db));
        reply = [
          `🛒 *¡Excelente elección!*`,
          "",
          `🎮 ${selected.productName.trim()} — ${selected.packageName}`,
          `💰 Total: *${fmtBs(quote.salePriceBsTotal)}*`,
          "",
          `📝 Para continuar, mándame: ${fields.map((field: any) => field.label).join(" y ")}`,
          `Ejemplo: ${fields.map((field: any) => `${field.label}: ...`).join(", ")}`,
        ].join("\n");
      } else {
        // The number pointed to a package that is no longer sellable on
        // WhatsApp (excluded, out of stock or removed). Re-show the list so
        // the customer is never stuck with a dead number.
        const collected: Array<{ n: number; packageId: string; label: string }> = [];
        reply = priceListMessage(db, undefined, collected);
        session.lastShown = collected;
        showedPrices = true;
      }
    }

    // Never leave the customer without an answer.
    if (!reply && !selectionPackageId && !handoffRequested) {
      reply = "Hmm, no te entendí bien 🤔 ¿Me dices qué juego quieres recargar: *Free Fire*, *Blood Strike* o *Roblox*?";
    }

    if (reply) {
      await sendMessage(jid, reply);
      logBotMessage(db, jid, reply);
    }

    if (handoffRequested) {
      setHandoffLocal(db, session, true, handoffReason);
      const msg = handoffMessageForCustomer();
      await sendMessage(jid, msg);
      logBotMessage(db, jid, msg);
    }
  }

  // Local helper so handoff state changes always persist the same way.
  function setHandoffLocal(dbRef: Database.Database, session: WhatsAppSession, on: boolean, reason: string): void {
    session.handoff = on;
    saveSession(dbRef, session);
    setHandoff(dbRef, session.whatsappJid, on, reason);
  }

  async function connect(): Promise<void> {
    if (stopping || socket) return;
    connection = "connecting";
    removeStaleSingletonLocks(env.WHATSAPP_AUTH_DIR);
    // The client ALWAYS starts with the QR flow so a QR is rendered even while
    // the 8-digit code flow is armed. Passing pairWithPhoneNumber here would
    // disable QR generation entirely (only codes, never QR).
    const nextClient = new Client({
      authStrategy: new LocalAuth({ dataPath: env.WHATSAPP_AUTH_DIR }),
      puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        // Session restore on a fresh container can exceed puppeteer's default
        // 30s CDP budget and wedges the client in "connecting" forever.
        protocolTimeout: 180_000,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions", "--no-zygote", "--disable-software-rasterizer"],
      },
    });
    socket = nextClient;
    // Watchdog: if the WhatsApp Web page wedges during session restore (CDP
    // protocol timeouts), relaunch the browser instead of hanging forever.
    if (readyTimer) clearTimeout(readyTimer);
    readyTimer = setTimeout(() => {
      if (stopping || connection === "open" || socket !== nextClient) return;
      logger.warn("WhatsApp did not reach ready in time; relaunching browser");
      void shutdownClient().then(() => {
        stopping = false;
        everReady = false;
        void connectWithRetry();
      });
    }, 150_000);
    nextClient.on("qr", (qr) => {
      void QRCodeImage.toDataURL(qr, { margin: 2, width: 320 })
        .then((dataUrl) => {
          qrDataUrl = dataUrl;
          qrExpiresAt = new Date(Date.now() + 60_000).toISOString();
        })
        .catch((error) => logger.warn({ error }, "Could not render WhatsApp QR"));
    });
    nextClient.on("code", (code) => {
      pairingCode = code;
      pairingCodeUpdatedAt = new Date().toISOString();
      logger.info({ pairingCode: code, pairingPhone: env.WHATSAPP_PAIRING_PHONE }, "WhatsApp pairing code generated — enter this code on the phone");
    });
    nextClient.on("ready", () => {
      connection = "open";
      everReady = true;
      pairingCode = null;
      qrDataUrl = null;
      qrExpiresAt = null;
      if (qrTimer) clearTimeout(qrTimer);
      qrTimer = null;
      if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
      // Zombie-connection guard: from now on, verify every minute that the
      // WhatsApp Web page is really alive. If it freezes silently (the
      // "bot no responde" failure mode), force a browser relaunch.
      healthProbe.start(nextClient, () => {
        if (stopping || socket !== nextClient) return;
        void shutdownClient().then(() => {
          stopping = false;
          everReady = false;
          void connectWithRetry();
        });
      });
      logger.info("WhatsApp connection opened");
    });
    nextClient.on("auth_failure", (message) => {
      logger.error({ message }, "WhatsApp authentication failed; session must be re-linked");
    });
    nextClient.on("error", (error) => {
      logger.error({ err: error }, "WhatsApp client error (kept alive)");
    });
    nextClient.on("disconnected", (reason) => {
      connection = "closed";
      if (socket === nextClient) socket = null;
      logger.warn({ reason }, "WhatsApp disconnected");
      // Only schedule a reconnect when this client actually reached "ready".
      // Launch failures are owned by connectWithRetry; reacting to both
      // creates exponential retry loops that can crash the process.
      if (!stopping && everReady) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          void connectWithRetry();
        }, env.WHATSAPP_RECONNECT_DELAY_MS);
      }
    });
    // Primary listener. `message` only fires for new incoming messages.
    nextClient.on("message", (message) => {
      logger.info({ from: message.from, type: message.type, body: message.body?.slice(0, 120) }, "WhatsApp message event received");
      void processIncomingMessage(message).catch((error) => logger.error({ err: error, from: message.from }, "WhatsApp message processing failed"));
    });
    // Safety net: `message_create` fires for EVERY message (including ones
    // whatsapp-web.js sometimes misses on flaky reconnects). The dedupe set
    // in processIncomingMessage makes the double delivery harmless — an
    // incoming customer message is handled exactly once even if both events
    // carry it.
    nextClient.on("message_create", (message) => {
      if (message.fromMe) return;
      logger.info({ from: message.from, type: message.type, body: message.body?.slice(0, 120) }, "WhatsApp message_create event received");
      void processIncomingMessage(message).catch((error) => logger.error({ err: error, from: message.from }, "WhatsApp message_create processing failed"));
    });
    await nextClient.initialize();
    // With the browser up and the session still unpaired, also arm the
    // 8-digit code flow in phone mode so the code appears within seconds and
    // renews every minute (matching WhatsApp's own countdown on the phone).
    if (!everReady && pairingMode === "phone") void armPairingCode();
  }

  // Arms (or re-arms) WhatsApp's "link with phone number" flow. Codes renew
  // every minute — matching WhatsApp's own countdown — and each renewal fires
  // the "code" event, which refreshes what the admin panel shows.
  async function armPairingCode(): Promise<void> {
    if (!socket || stopping) return;
    try {
      const code = await socket.requestPairingCode(env.WHATSAPP_PAIRING_PHONE, true, 60_000);
      if (code) {
        pairingCode = code;
        pairingCodeUpdatedAt = new Date().toISOString();
      }
    } catch (error) {
      logger.warn({ err: error }, "Pairing code flow could not start (session may already be linked)");
    }
  }

  // Tears down the current client (timers included) without killing the server.
  async function shutdownClient(): Promise<void> {
    stopping = true;
    healthProbe.stop();
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (pairingTimer) { clearTimeout(pairingTimer); pairingTimer = null; }
    if (qrTimer) { clearTimeout(qrTimer); qrTimer = null; }
    if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
    if (recoveryTimer) { clearTimeout(recoveryTimer); recoveryTimer = null; }
    pairingCode = null;
    pairingCodeUpdatedAt = null;
    qrDataUrl = null;
    qrExpiresAt = null;
    const old = socket;
    socket = null;
    connection = "closed";
    try { await old?.destroy(); } catch {
      // Destroying is best-effort cleanup.
    }
  }

  // Switch between the 8-digit code and the QR live: reconnects the browser
  // with the requested pairing method. The WhatsApp session volume is kept.
  // Both methods stay available in the UI; this controls which one starts
  // armed automatically (phone => code, qr => QR only).
  async function setPairingMode(mode: "phone" | "qr"): Promise<void> {
    if (pairingMode === mode && socket) return;
    pairingMode = mode;
    await shutdownClient();
    stopping = false;
    void connectWithRetry();
  }

  // Ask the linked browser for a brand-new 8-digit code right now. Codes only
  // regenerate every ~3 minutes, but WhatsApp rejects a code once it starts
  // its own ~1-minute countdown, so the panel exposes a manual refresh.
  async function refreshPairingCode(): Promise<void> {
    pairingCode = null;
    pairingCodeUpdatedAt = null;
    if (socket && connection === "open") {
      // Already linked: nothing to pair, keep the session intact.
      return;
    }
    if (socket && pairingMode === "phone") {
      // The browser is mid-initialization; calling requestPairingCode again
      // re-arms the in-page flow and yields a fresh code in seconds.
      try {
        const code = await (socket as unknown as { requestPairingCode: (phone: string, show?: boolean, interval?: number) => Promise<string> }).requestPairingCode(
          env.WHATSAPP_PAIRING_PHONE,
          true,
          60_000,
        );
        if (code) {
          pairingCode = code;
          pairingCodeUpdatedAt = new Date().toISOString();
        }
        return;
      } catch (error) {
        logger.warn({ err: error }, "Manual pairing code refresh failed; restarting browser");
      }
    }
    // No usable browser yet: restart it with the phone-pairing mode.
    await shutdownClient();
    stopping = false;
    void connectWithRetry();
  }

  // Wipe the saved WhatsApp session and pair again from scratch. Used when
  // WhatsApp says "código incorrecto" or the session volume got corrupted.
  async function resetSession(): Promise<void> {
    await shutdownClient();
    try {
      rmSync(env.WHATSAPP_AUTH_DIR, { recursive: true, force: true });
      logger.warn({ dir: env.WHATSAPP_AUTH_DIR }, "WhatsApp session wiped; a fresh pairing is required");
    } catch (error) {
      logger.warn({ err: error }, "Could not wipe the WhatsApp session directory");
    }
    stopping = false;
    void connectWithRetry();
  }

  async function connectWithRetry(): Promise<void> {
    try {
      await connect();
    } catch (error) {
      connection = "closed";
      if (socket) {
        const failedClient = socket;
        socket = null;
        try {
          await failedClient.destroy();
        } catch {
          // The browser never launched; destroying is best-effort cleanup.
        }
      }
      logger.error({ err: error }, "WhatsApp connection failed; will retry");
      if (!stopping) {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          void connectWithRetry();
        }, env.WHATSAPP_RECONNECT_DELAY_MS);
      }
    }
  }

  return {
    enabled: env.WHATSAPP_MODE === "live",
    start: async () => {
      if (env.WHATSAPP_MODE !== "live" || socket) return;
      stopping = false;
      // A failed browser launch (or any WhatsApp error) must never take the
      // whole server down: payments and the admin panel keep running while
      // the connection retries in the background.
      await connectWithRetry();
    },
    stop: async () => {
      await shutdownClient();
    },
    setPairingMode,
    refreshPairingCode,
    resetSession,
    sendMessage,
    sendHumanReply,
    isReady: () => connection === "open",
    status: () => ({ enabled: env.WHATSAPP_MODE === "live", connection, pairingMode, pairingCode, pairingCodeUpdatedAt, pairingPhone: env.WHATSAPP_PAIRING_PHONE, qrDataUrl, qrExpiresAt }),
  };
}
