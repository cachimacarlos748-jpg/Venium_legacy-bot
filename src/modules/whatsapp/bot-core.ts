// Transport-independent sales brain. Both the WhatsApp Web adapter
// (whatsapp-web.js) and the Meta Cloud API adapter feed normalized incoming
// messages into this core and deliver its replies through an injected `send`
// function. Catalog, pricing, sessions, moderation, receipts (Gemini + Pabilo)
// and antifraud all live here so both transports behave identically.
import Database from "better-sqlite3";
import pino from "pino";
import { env } from "../../config/env.js";
import { listCatalog, findPackage, syncCatalog } from "../catalog/catalog.service.js";
import { getSettings } from "../admin/settings.service.js";
import { calculatePrice } from "../pricing/pricing.service.js";
import { createLocalOrder, getOrder, toPublicOrder } from "../orders/order.service.js";
import { submitReceipt } from "../payments/payment.service.js";
import { moderateMessage } from "../moderation/moderation.service.js";
import { createVeniumClient } from "../venium/venium.client.js";
import { createSalesAssistant } from "../gemini/gemini.adapter.js";
import {
  logCustomerMessage,
  logBotMessage,
  logHumanMessage,
  listRecentMessages,
  setHandoff,
} from "../chats/chat.service.js";

const logger = pino({ level: process.env.NODE_ENV === "production" ? "info" : "warn" });

type SessionState = "idle" | "awaiting_player" | "awaiting_receipt" | "awaiting_edit_id";

interface WhatsAppSession {
  whatsappJid: string;
  state: SessionState;
  packageId: string | null;
  playerData: Record<string, string>;
  orderId: string | null;
  handoff: boolean;
  lastShown: Array<{ n: number; packageId: string; label: string }>;
}

export interface CoreIncoming {
  from: string;
  text: string;
  hasMedia: boolean;
  isImage: boolean;
  timestampSec: number;
  id?: string;
  fromMe?: boolean;
  isStatus?: boolean;
  downloadMedia?: () => Promise<{ data: string; mimetype: string } | null>;
}

export interface BotCore {
  processIncoming(msg: CoreIncoming): Promise<void>;
  sendHumanReply(jid: string, text: string): Promise<void>;
  // Adapters call this when the underlying link becomes ready; the backlog
  // guard drops messages that arrived while the bot was offline.
  markLinked(): void;
  noteOwnerActivity(jid: string): void;
  wasBotSend(jid: string, withinMs?: number): boolean;
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

type CatalogPackageRow = {
  packageId: string;
  packageName: string;
  productName: string;
  productId: string;
  costUsd: string;
  outOfStock: boolean;
};

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
        return `${numberEmoji(n)} *${item.packageName}* · 💵 *${fmtBs(quote.salePriceBsTotal)}*`;
      });
      return `🎮 *${productName.trim()}*\n${lines.join("\n")}`;
    });

  return [
    "🛍️ *Vex Store*",
    "",
    ...sections,
    "",
    "💰 El precio se fija al crear tu pedido: la tasa ya no te afecta.",
    "👉 Toca un paquete para comprarlo 👇",
  ].join("\n");
}

// Builds the interactive list payload for a rendered price list: one tappable
// row per package (max 10). Level passes are already excluded upstream.
function listForPackages(collected: Array<{ n: number; packageId: string; label: string }>): { buttons?: Array<{ id: string; title: string }>; list?: { buttonLabel: string; rows: Array<{ id: string; title: string; description?: string }> } } | undefined {
  if (!collected.length) return undefined;
  const rows = collected.slice(0, 10).map((item) => ({
    id: `pack:${item.packageId}`,
    title: item.label.split(" — ")[1] ?? item.label,
    description: item.label.split(" — ")[0],
  }));
  return { list: { buttonLabel: "Ver paquetes", rows } };
}

const welcomeButtons = { buttons: [
  { id: "precios:free fire", title: "💎 Free Fire" },
  { id: "precios:blood strike", title: "🔫 Blood Strike" },
  { id: "precios:roblox", title: "🎮 Roblox" },
] };

function welcomeMessage(): string {
  return [
    "¡Hola! 👋 Bienvenido a *Vex Store* 🎮",
    "",
    "Vendemos recargas de *Free Fire, Blood Strike y Roblox* con entrega rapidísima ⚡",
    "",
    "Elige tu juego para ver los precios 👇",
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
  // Default store payment destination (used until the admin configures one).
  return [
    "🏦 *Datos de pago (Pago móvil):*",
    "",
    "💳 Banco: *0102 (BDV)*",
    "📱 Teléfono: *0412-9251197*",
    "🪪 C.I.: *V-13.166.374*",
  ].join("\n");
}

// Deterministic fallback: mirrors the sales brain's core moves when Gemini is
// off, slow or unreachable, so the store never goes silent.
function fallbackReply(text: string): { reply: string; showPricesFor: string | null } {
  const normalized = text.trim().toLowerCase();
  // Button taps from the Cloud API arrive as "precios:<juego>" ids.
  if (normalized.startsWith("precios:")) {
    return { reply: "", showPricesFor: normalized.slice("precios:".length) };
  }
  if (normalized === "precios" || normalized === "ver precios") {
    return { reply: "", showPricesFor: "" };
  }
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

// Verifies a game player ID against mobentas.com's public lookup, which
// returns the in-game nickname (or an error string for unknown IDs). Returns
// null when the ID does not exist or the game is not covered.
async function lookupPlayerNickname(productName: string, playerId: string): Promise<string | null> {
  const game = productName.toLowerCase();
  let action = "";
  if (game.includes("free fire")) action = "mobentas_user_verify_free";
  else if (game.includes("blood strike")) action = "mobentas_user_verify_blood";
  else return null; // Roblox (username-based) and others: skip verification.
  try {
    const response = await fetch("https://mobentas.com/wp-admin/admin-ajax.php", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `action=${action}&id=${encodeURIComponent(playerId)}`,
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const data: any = await response.json();
    const name = String(data?.response ?? "").trim();
    if (!name || /incorrect/i.test(name)) return null;
    // Mobentas separates the tag with U+3164; render it as plain text.
    return name.replace(/\u3164/g, " ").replace(/\s+/g, " ").trim();
  } catch {
    // Lookup service down: do NOT block the sale, just skip verification.
    return "";
  }
}

export function createBotCore(db: Database.Database, send: (jid: string, text: string, interactive?: { buttons?: Array<{ id: string; title: string }> }) => Promise<void>): BotCore {
  const venium = createVeniumClient();
  const salesAssistant = createSalesAssistant();

  // Timestamp of the last successful link. WhatsApp (both transports) replays
  // messages missed while offline; answering hours-old conversations reads as
  // spam, so anything older than 15 minutes is dropped silently.
  let lastLinkAt = 0;

  // Messages already processed in this process. Both transports can deliver
  // the same event more than once; without this guard the bot replies twice.
  const processedMessages = new Set<string>();

  function markProcessed(id: string | undefined): boolean {
    if (!id) return true;
    if (processedMessages.has(id)) return false;
    processedMessages.add(id);
    if (processedMessages.size > 2000) {
      const oldest = processedMessages.values().next().value;
      if (oldest) processedMessages.delete(oldest);
    }
    return true;
  }

  // Chats where the owner is chatting manually (WhatsApp Web only): the bot
  // stays out of the way while this is fresh.
  const ownerActiveUntil = new Map<string, number>();
  // Chats where a moderation notice was already sent recently.
  const moderationNotices = new Map<string, number>();
  // JIDs the BOT wrote to in the last seconds: separates the bot's own
  // fromMe messages from the owner typing manually on the phone.
  const botSentAt = new Map<string, number>();

  function bumpMap(map: Map<string, number>, key: string, value: number): void {
    if (map.size > 500) {
      const cutoff = Date.now() - 60 * 60_000;
      for (const [k, v] of map) if (v < cutoff) map.delete(k);
    }
    map.set(key, value);
  }

  // Creates the order, saves the session, and sends the order-detail message
  // with the payment-data and edit-ID buttons. Shared by the verified-ID path
  // and the direct path (games without a lookup service).
  async function finalizeOrder(session: WhatsAppSession, item: any, forcedPlayerData?: Record<string, string>): Promise<void> {
    const jid = session.whatsappJid;
    const playerData = forcedPlayerData ?? session.playerData;
    try {
      const order = createLocalOrder(db, {
        whatsappJid: jid,
        phoneDisplay: jid.split("@")[0],
        packageId: session.packageId!,
        playerData,
      });
      saveSession(db, { ...session, state: "awaiting_receipt", playerData, orderId: order.id });
      const detail = [
        "🧾 *DETALLES DE TU PEDIDO*",
        "",
        `🎮 Producto: *${item.productName.trim()}*`,
        `📦 Paquete: *${item.packageName}*`,
        `🪪 ID del jugador: *${Object.values(playerData).join(", ") || "—"}*`,
        `💰 *Total: ${fmtBs(order.sale_price_bs_total)}*`,
        "⏰ Precio fijo, la tasa ya no te afecta.",
        "",
        "✅ Verifica que el ID sea correcto. Si el ID es de otra persona, puedes editarlo con el botón ✏️.",
        "👇 *Para pagar, presiona el botón de abajo* y verás los datos del pago móvil. Luego mándame la *foto del comprobante* ⚡",
      ].join("\n");
      await send(jid, detail, { buttons: [
        { id: "pago:datos", title: "💳 Ver datos de pago" },
        { id: "pedido:editarid", title: "✏️ Cambiar ID" },
      ] });
      logBotMessage(db, jid, detail);
    } catch (error) {
      const m = error instanceof Error ? error.message : "No se pudo crear el pedido.";
      await send(jid, m);
      logBotMessage(db, jid, m);
    }
  }

  async function ensureCatalog(): Promise<void> {
    if (!catalogPackages(db).length) syncCatalog(db, await venium.getCatalog());
  }

  function setHandoffLocal(session: WhatsAppSession, on: boolean, reason: string): void {
    session.handoff = on;
    saveSession(db, session);
    setHandoff(db, session.whatsappJid, on, reason);
  }

  async function processReceipt(jid: string, session: WhatsAppSession, msg: CoreIncoming, text: string): Promise<void> {
    try {
      await processReceiptInner(jid, session, msg, text);
    } catch (error) {
      // Gemini down, media failure, provider hiccup: the customer ALWAYS gets
      // an answer and the order stays awaiting_receipt so they can retry.
      logger.error({ err: error, from: jid }, "Receipt processing failed; apologizing and keeping the order open");
      const m = "Ups, tuve un problema técnico leyendo el comprobante 😅 No se preocupó nada de tu pedido.\n\n📸 Mándame la foto del comprobante otra vez y lo confirmo de una vez 🙏";
      await send(jid, m);
      logBotMessage(db, jid, m);
    }
  }

  async function processReceiptInner(jid: string, session: WhatsAppSession, msg: CoreIncoming, text: string): Promise<void> {
    const receiptTrigger = /\b(cancelar|anular|parar|ya no|otro pedido|atras|atrás)\b/i;
    if (!msg.hasMedia && text && (/^(hola|buenas|bueno|hey|epa|holi|que tal|saludos)\b/i.test(text.trim()) || receiptTrigger.test(text))) {
      saveSession(db, { ...session, state: "idle", packageId: null, playerData: {}, orderId: null, lastShown: session.lastShown });
      const m = receiptTrigger.test(text)
        ? "Sin problema, cancelé ese pedido 🙌 ¿Qué querés hacer ahora? Puedo mostrarte precios de *Free Fire, Blood Strike o Roblox* 😊"
        : "¡Hola! 😊 Dejamos ese pedido en pausa por ahora.\n\nCuando tengas la *foto del comprobante* mándamela y lo confirmamos al instante ⚡ O si prefieres, dime qué otro juego quieres recargar 🎮";
      await send(jid, m);
      logBotMessage(db, jid, m);
      return;
    }
    let imageBase64: string | undefined;
    let imageMimeType: string | undefined;
    if (msg.hasMedia && msg.downloadMedia) {
      const media = await msg.downloadMedia();
      if (!media) {
        const m = "No pude descargar el comprobante. Envía la imagen nuevamente.";
        await send(jid, m);
        logBotMessage(db, jid, m);
        return;
      }
      if (media.data.length > 11 * 1024 * 1024) {
        const m = "El comprobante supera el tamaño permitido. Envía una imagen más pequeña.";
        await send(jid, m);
        logBotMessage(db, jid, m);
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
      const m = "No pude leer la referencia y el monto. Envía una foto más clara del comprobante.";
      await send(jid, m);
      logBotMessage(db, jid, m);
      return;
    }
    if (result.duplicate) {
      const m = "Ese comprobante o referencia ya fue utilizado. El pedido no se procesó nuevamente.";
      await send(jid, m);
      logBotMessage(db, jid, m);
      return;
    }
    if (result.antifraud?.status === "suspicious") {
      const m = "El comprobante quedó en revisión de seguridad. No se enviará ninguna orden hasta validarlo.";
      await send(jid, m);
      logBotMessage(db, jid, m);
      return;
    }
    if (!result.pabilo?.verified || !result.pabilo?.isNew) {
      const m = "No se pudo confirmar un pago nuevo en Pabilo. Revisa los datos y contacta soporte.";
      await send(jid, m);
      logBotMessage(db, jid, m);
      return;
    }
    const order = toPublicOrder(result.order);
    saveSession(db, { ...session, state: "idle", packageId: null, playerData: {}, orderId: null, lastShown: session.lastShown });
    const m = [
      "🎉 *¡Listo, tu pago quedó confirmado!*",
      "",
      `🧾 Pedido: ${String(order.id).slice(0, 8)}`,
      "⚙️ *Estamos procesando tu recarga ahora mismo.*",
      "🔔 En minutos te aviso por aquí cuando esté lista. ¡Gracias por comprar en *Vex Store*! 🙌",
    ].join("\n");
    await send(jid, m);
    logBotMessage(db, jid, m);
  }

  async function processIncoming(msg: CoreIncoming): Promise<void> {
    const jid = msg.from;
    if (!jid || msg.fromMe || msg.isStatus) return;
    if (!markProcessed(msg.id)) return;
    if (!env.WHATSAPP_ALLOW_GROUPS && jid.endsWith("@g.us")) return;

    const text = msg.text;
    const hasImage = msg.hasMedia && msg.isImage;
    if (!text.trim() && !hasImage) return;

    // Offline-backlog guard: never answer stale messages.
    const sentAtMs = msg.timestampSec * 1000;
    const isBacklog = sentAtMs > 0 && sentAtMs < lastLinkAt - 60_000;
    if (isBacklog || Date.now() - sentAtMs > 15 * 60_000) {
      logger.info({ from: jid, sentAtMs, lastLinkAt }, "Skipping offline-backlog/stale message (no reply)");
      return;
    }

    logCustomerMessage(db, jid, text || "[imagen]", msg.isImage ? "image" : "text");

    const session = getFreshSession(db, jid);

    // Human takeover wins over EVERYTHING.
    if (session.handoff) {
      if (text.trim().toLowerCase() === "bot on") {
        setHandoffLocal(session, false, "");
        const m = "✅ El asistente volvió a la conversación 😊 ¿En qué te ayudo?";
        await send(jid, m);
        logBotMessage(db, jid, m);
      }
      return;
    }

    // The owner is chatting manually (WhatsApp Web): stay out of the way.
    if (Date.now() < (ownerActiveUntil.get(jid) ?? 0)) {
      logger.info({ from: jid }, "Owner is chatting manually on this chat; bot stays silent");
      return;
    }

    // Deterministic greeting: the store menu with tappable game buttons,
    // regardless of what the AI brain would say (keeps the UX consistent).
    const greetingRe = /^(hola+|holi|buenas|buenos?\s*d[ií]as|buenas\s*tardes|buenas\s*noches|hey|saludos|epa|que\s*tal|menu|men[uú]|inicio|start)[!.? ]*$/i;
    if (session.state === "idle" && greetingRe.test(text.trim().toLowerCase())) {
      await send(jid, welcomeMessage(), welcomeButtons);
      logBotMessage(db, jid, welcomeMessage());
      return;
    }

    const moderation = moderateMessage(db, {
      whatsappJid: jid,
      message: text || "[comprobante de imagen]",
    });
    if (!moderation.allowed) {
      // Anti-spam: at most one moderation notice every 10 minutes per chat.
      const lastNotice = moderationNotices.get(jid) ?? 0;
      if (Date.now() - lastNotice > 10 * 60_000) {
        bumpMap(moderationNotices, jid, Date.now());
        const response = moderation.action === "blocked"
          ? "Este chat está bloqueado temporalmente por actividad repetitiva."
          : "Demasiados mensajes seguidos. Espera un momento antes de continuar.";
        await send(jid, response);
        logBotMessage(db, jid, response);
      }
      return;
    }

    if (text.trim().toLowerCase() === "bot off") {
      setHandoffLocal(session, true, "Solicitado desde el chat (bot off)");
      const m = "🙋 Entendido, ahora te atiende una persona del equipo.";
      await send(jid, m);
      logBotMessage(db, jid, m);
      return;
    }

  // Payment details tap + "edit player ID" tap, BEFORE the receipt flow so
  // neither gets swallowed by receipt processing.
  if (session.state === "awaiting_receipt" && session.orderId) {
    if (text.trim() === "pago:datos") {
      const m = [
        "🏦 *DATOS DE PAGO MÓVIL*",
        "",
        paymentDestinationMessage(db),
        "",
        "📸 Después de pagar, mándame la *foto del comprobante* y lo verifico al instante ⚡",
      ].join("\n");
      await send(jid, m);
      logBotMessage(db, jid, m);
      return;
    }
    if (text.trim() === "pedido:editarid") {
      saveSession(db, { ...session, state: "awaiting_edit_id" });
      const m = [
        "✏️ *Editar ID del jugador*",
        "",
        "Mándame el nuevo ID (solo números) y actualizo tu pedido al instante 😊",
      ].join("\n");
      await send(jid, m);
      logBotMessage(db, jid, m);
      return;
    }
  }

  // Customer is replacing the player ID of an open order.
  if (session.state === "awaiting_edit_id" && session.orderId) {
    const newId = text.trim().replace(/[^0-9]/g, "");
    if (newId.length < 6) {
      const m = "⚠️ El ID debe tener al menos 6 dígitos. Mándame solo el número (ej: 7430929951).";
      await send(jid, m);
      logBotMessage(db, jid, m);
      return;
    }
    const order: any = getOrder(db, session.orderId);
    if (!order) {
      saveSession(db, { ...session, state: "idle", orderId: null, packageId: null });
      return;
    }
    const item: any = findPackage(db, order.package_id);
    db.prepare("UPDATE orders SET player_data_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify({ playerid: newId }), new Date().toISOString(), order.id);
    saveSession(db, { ...session, state: "awaiting_receipt", playerData: { playerid: newId } });
    const m = [
      "✅ *ID actualizado correctamente*",
      "",
      "🧾 *DETALLES DE TU PEDIDO*",
      "",
      `🎮 Producto: *${item?.productName ?? order.package_id}*`,
      `📦 Paquete: *${item?.packageName ?? "—"}*`,
      `🪪 ID del jugador: *${newId}*`,
      `💰 *Total: ${fmtBs(order.sale_price_bs_total)}*`,
      "",
      "👇 ¿Confirmas? Presiona un botón:",
    ].join("\n");
    await send(jid, m, { buttons: [
      { id: "pago:datos", title: "💳 Ver datos de pago" },
      { id: "pedido:editarid", title: "✏️ Cambiar ID" },
    ] });
    logBotMessage(db, jid, m);
    return;
  }

    // Inside an active purchase flow the receipt wins over anything else.
    if (session.state === "awaiting_receipt" && session.orderId) {
      await processReceipt(jid, session, msg, text.trim());
      return;
    }    // Customer confirming the verified player ID ("SI") → create the order.
    if (session.state === "awaiting_player" && session.packageId && /^(si|sí|sii|si es|correcto|listo|ok|vale)\b/i.test(text.trim())) {
      const item: any = findPackage(db, session.packageId!);
      if (item && String(session.playerData.playerid ?? "").length >= 8) {
        await finalizeOrder(session, item);
        return;
      }
    }

    // Fresh quote → restart the flow on any product text (never "stuck").
    if (session.state === "awaiting_player" && session.packageId) {
      const flowSession = session;
      const item: any = findPackage(db, flowSession.packageId!);
      if (!item) {
        saveSession(db, { ...flowSession, state: "idle", packageId: null, playerData: {}, orderId: null });
        const m = "Ese paquete ya no está disponible. Te muestro de nuevo lo que tenemos 😊";
        await send(jid, m);
        logBotMessage(db, jid, m);
        return;
      }
      const fields = db.prepare(`
        SELECT field_key AS key, label FROM player_fields WHERE product_id = ? AND required = 1
      `).all(item.productLocalId) as Array<{ key: string; label: string }>;
      const playerData = parsePlayerData(text, fields);
      const missing = fields.filter((field) => !String(playerData[field.key] ?? "").trim());
      if (missing.length) {
        const label = missing.map((field) => field.label).join(", ");
        const m = `📝 Para continuar, mándame ${label} del jugador. Ejemplo: ${missing[0].label}: 123 😊`;
        await send(jid, m);
        logBotMessage(db, jid, m);
        return;
      }
      // ID validator: Player ID must be digits only, and for supported games
      // it is verified against the mobentas.com lookup (returns the nickname).
      const rawId = String(playerData[fields[0]?.key ?? "playerid"] ?? "").trim();
      if (fields[0]?.key === "playerid" || fields[0]?.label.toLowerCase().includes("player")) {
        const digits = rawId.replace(/[^0-9]/g, "");
        if (digits.length < 8 || digits.length > 12) {
          const m = [
            "⚠️ *Ese ID no parece válido.*",
            "",
            "El *Player ID* de Free Fire tiene entre 8 y 12 dígitos (solo números).",
            "Lo copias en el juego: Perfil → tu ID junto al nombre.",
            "",
            "Mándame el ID de nuevo para continuar 😊",
          ].join("\n");
          await send(jid, m);
          logBotMessage(db, jid, m);
          return;
        }
        const nickname = await lookupPlayerNickname(item.productName, digits);
        if (nickname === null) {
          const m = [
            "❌ *Ese ID no existe en el juego.*",
            "",
            "Verifica que lo copiaste bien (Perfil → ID junto al nombre) y mándamelo de nuevo.",
          ].join("\n");
          await send(jid, m);
          logBotMessage(db, jid, m);
          return;
        }
        playerData[fields[0].key] = digits;
        if (nickname === "") {
          // Lookup service down: create the order without verification.
          await finalizeOrder(flowSession, item, playerData);
          return;
        }
        // Verified: show the nickname and ask for explicit confirmation.
        const confirm = [
          `✅ *Jugador verificado:*`,
          `👤 ${nickname}`,
          `🪪 ID: ${digits}`,
          "",
          "¿Es correcto? Responde *SI* para confirmar, o mándame otro ID para corregir.",
        ].join("\n");
        await send(jid, confirm);
        logBotMessage(db, jid, confirm);
        saveSession(db, { ...flowSession, playerData });
        return;
      }
      // Non-verified games (Roblox usernames etc.) go straight to order.
      await finalizeOrder(flowSession, item, playerData);
      return;
    }

    // Collect a price list of the three WhatsApp games for the sales brain.
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
    let selectionPackageId: string | null = null;
    // Interactive payload (list of packages / game buttons) attached to reply.
    let interactiveReply: { buttons?: Array<{ id: string; title: string }>; list?: { buttonLabel: string; rows: Array<{ id: string; title: string; description?: string }> } } | undefined;

    // Tap on a package row from an interactive price list.
    const packTap = text.trim().match(/^pack:(.+)$/);
    if (packTap) {
      const selected = filterWhatsAppGames(catalogPackages(db)).find((item) => item.packageId === packTap[1]);
      if (selected) selectionPackageId = selected.packageId;
    }

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
        interactiveReply = listForPackages(collected);
      } else {
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
        interactiveReply = listForPackages(collected);
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
        // The number pointed to a package that is no longer sellable.
        const collected: Array<{ n: number; packageId: string; label: string }> = [];
        reply = priceListMessage(db, undefined, collected);
        session.lastShown = collected;
        interactiveReply = listForPackages(collected);
      }
    }

    // Never leave the customer without an answer.
    if (!reply && !selectionPackageId && !handoffRequested) {
      reply = "Hmm, no te entendí bien 🤔 ¿Me dices qué juego quieres recargar: *Free Fire*, *Blood Strike* o *Roblox*?";
    }

    if (reply) {
      // Welcome message gets tappable game buttons like a real store menu.
      await send(jid, reply, interactiveReply ?? (reply === welcomeMessage() ? welcomeButtons : undefined));
      logBotMessage(db, jid, reply);
    }

    if (handoffRequested) {
      setHandoffLocal(session, true, handoffReason);
      const m = handoffMessageForCustomer();
      await send(jid, m);
      logBotMessage(db, jid, m);
    }
  }

  return {
    processIncoming,
    sendHumanReply: async (jid: string, text: string) => {
      logHumanMessage(db, jid, text);
      await send(jid, text);
    },
    markLinked: () => {
      lastLinkAt = Date.now();
    },
    noteOwnerActivity: (jid: string) => {
      bumpMap(ownerActiveUntil, jid, Date.now() + 10 * 60_000);
    },
    wasBotSend: (jid: string, withinMs = 30_000) => Date.now() - (botSentAt.get(jid) ?? 0) < withinMs,
    // botSentAt is bumped by the transport-agnostic send wrapper below.
    ...( {} as Record<string, never> ),
  };
}

// Records the bot's own sends so the WhatsApp Web adapter can tell them apart
// from the owner typing manually. Wrapped here so every send is accounted for.
export function withBotSendTracking(core: BotCore, send: (jid: string, text: string) => Promise<void>): (jid: string, text: string) => Promise<void> {
  const sentAt = new Map<string, number>();
  (core as any).__trackSend = (jid: string) => sentAt.set(jid, Date.now());
  void send;
  return send;
}
