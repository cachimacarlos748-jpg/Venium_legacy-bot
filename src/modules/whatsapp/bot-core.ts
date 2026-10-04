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
import { createLocalOrder, getOrder, setPaymentState, toPublicOrder } from "../orders/order.service.js";
import { submitReceipt, describePaymentFailure, VENIUM_UNAVAILABLE_CUSTOMER_MESSAGE } from "../payments/payment.service.js";
import { moderateMessage, isAdminBlocked, unblockUser } from "../moderation/moderation.service.js";
import { publishEvent } from "../events/event-bus.js";
import { createVeniumClient } from "../venium/venium.client.js";
import { createSalesAssistant, createPlayerIdAnalyzer } from "../gemini/gemini.adapter.js";
import { saveSurveyResponse, sendSurvey } from "../survey/survey.service.js";
import {
  logCustomerMessage,
  saveChatMedia,
  logBotMessage,
  logHumanMessage,
  listRecentMessages,
  setHandoff,
  ensureCustomer,
  findRelatedChats,
  getCustomerName,
  setCustomerName,
  listRecentOrders,
} from "../chats/chat.service.js";

const logger = pino({ level: process.env.NODE_ENV === "production" ? "info" : "warn" });

// Publishes a customer/bot event to the realtime bus (SSE + push).
function notify(type: Parameters<typeof publishEvent>[0]["type"], jid: string, preview: string, meta?: Record<string, unknown>): void {
  publishEvent({ type, jid, phone: jid.split("@")[0] || jid, preview, meta });
}

type SessionState = "idle" | "awaiting_player" | "awaiting_receipt" | "awaiting_reference" | "awaiting_edit_id";

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
  // Address used to DELIVER replies. WhatsApp can deliver an inbound message
  // from a @lid address, but sending to @lid fails ("No LID for user"): the
  // transport passes the real phone-number jid here.
  sendJid?: string;
  downloadMedia?: () => Promise<{ data: string; mimetype: string } | null>;
}

export interface BotCore {
  processIncoming(msg: CoreIncoming): Promise<void>;
  sendHumanReply(jid: string, text: string): Promise<void>;
  // Bot notice initiated by the backend (not by an incoming message): the
  // "tu recarga está lista" message that fires when Venium finishes an order,
  // or the CSAT survey. Interactive buttons supported so the survey is tappable.
  sendCustomerNotice(jid: string, text: string, interactive?: { buttons?: Array<{ id: string; title: string }> }): Promise<void>;
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

// Customer intents that MUST reach a human, wherever they appear in the flow
// (idle, checkout, waiting for the receipt). "Quiero ablar con el dueño" after
// failed receipt reads must never bounce off as small talk.
const HANDOFF_RE = /(due[nñ]o|dueno|humano|persona\s*(?:real|de\s*verdad)|habla(?:r|\s+con)\s+(?:alguien|algui?n|una\s+persona)|soporte|reclam|estaf|fraude|doble\s+cobro|devoluci|reembols)/i;

// The customer insisting that the BOT takes over again. ONLY phrases that name
// the bot explicitly, because "atiende tú" / "habla tú" are ambiguous: the
// customer almost always means "que me atienda una persona" there, and reading
// them as "vuelve el bot" is what kept the bot talking over the human.
const RESUME_BOT_RE = /^(?:bot\s*on|enciende\s+(?:al\s+)?bot|activa\s+(?:al\s+)?bot|pon\s+(?:al\s+)?bot|on\s*(?:el\s+)?bot|habla\s+(?:el\s+)?bot|hablar\s+con\s+(?:el\s+)?bot|vuelve\s+(?:el\s+)?bot|devu[ée]lvame\s+al\s+bot|pasame\s+con\s+(?:el\s+)?bot|quiero\s+(?:hablar\s+con\s+)?(?:el\s+)?bot)(?:\s*por\s*favor)?[\s!.?]*$/i;

// How customers really ask for a person: "atender", "atiende tú", "atiéndeme",
// "que me atienda alguien". These never reached HANDOFF_RE, so the bot kept
// answering them with its normal replies. The matcher runs on the normalized
// (accent-free, space-free) message and is anchored at both ends, so a long
// sentence that merely CONTAINS one of these verbs ("el comprobante no
// responde") is not mistaken for a takeover request.
const TAKEOVER_FILLER =
  "(?:porfavor|porfa|favor|pls|plis|oye|hola|buenas|hey|ahora|ya|mas|urgente|rapido|necesito|necesitamos|quiero|quisiera|podrian|pueden|puede|me|alguien|una|persona|los|el|dueno|loschinos|ellos|equipo|admin|que)";
const TAKEOVER_VERB =
  "(?:atend|atiend|contest|respond|escrib|chate|habl|resolv)(?:er|es|e|a|as|en|o|io|elo|eme|ame|an|anme|amevos|enos|anos)?(?:me|nos|le|lo|la|nos)?(?:a|lo|la)?";
const TAKEOVER_OBJECT =
  "(?:tu|usted|ustedes|uds|alguien|unhumano|unapersona|personas|humanos|eldueno|dueno|loschinos|ellos|equipo|nosotros)";
const TAKEOVER_RE = new RegExp(
  `^(?:${TAKEOVER_FILLER})*(?:${TAKEOVER_VERB})(?:${TAKEOVER_OBJECT})*$`,
);
const TAKEOVER_EXACT = new Set([
  "atencion",
  "atencionhumana",
  "ayudahumana",
  "personareal",
  "humano",
  "persona",
]);

// "¿me pueden atender mañana?" is a question about the schedule, not a
// takeover. Interrogative openers and long sentences stay with the bot.
const TAKEOVER_QUESTION_RE = /^(?:quien|como|cuando|donde|cuanto|cuantos|cuantas|cual|pueden|puede|podria|podrian|tienen|hay|pero)\b/i;

function wantsTakeover(text: string): boolean {
  const raw = text.trim();
  if (!raw) return false;
  if (TAKEOVER_QUESTION_RE.test(raw)) return false;
  if (raw.split(/\s+/).length > 6) return false;
  const value = normalizeKey(raw);
  if (!value || value.length > 80) return false;
  return TAKEOVER_EXACT.has(value) || TAKEOVER_RE.test(value);
}

function wantsHumanHandoff(text: string): boolean {
  return HANDOFF_RE.test(text.trim()) || wantsTakeover(text);
}

// "me llamo Carlos", "soy Maria Fernanda", "mi nombre es: José Gregorio".
// Only listens in idle state so a receipt message is never mistaken for a name.
const NAME_PATTERNS = [
  /^(?:hola[,:]? )?me llamo\s+(.{2,60})$/i,
  /^soy\s+(.{2,60})$/i,
  /^(?:mi )?nombre\s+es\s*[:]??\s*(.{2,60})$/i,
  /^aqui (?:es|est[aá])\s+(.{2,60})$/i,
];
function extractCustomerName(text: string): string | null {
  const value = text.trim().replace(/\s+/g, " ");
  if (value.length > 80) return null;
  for (const pattern of NAME_PATTERNS) {
    const match = value.match(pattern);
    if (match) {
      const name = match[1].replace(/[,.;:!]+$/, "").trim();
      // Sanity: names contain letters, 1-5 words, no digits-heavy junk.
      if (name.length >= 2 && name.length <= 60 && /[a-záéíóúñ]/i.test(name) && (name.match(/[0-9]/g) ?? []).length <= 2) return name;
    }
  }
  return null;
}

// Builds the long-term memory block injected into the sales brain: name and
// order history, so the bot greets known buyers and knows their past orders.
function customerMemoryBlock(db: Database.Database, jid: string): string {
  const name = getCustomerName(db, jid);
  const orders = listRecentOrders(db, jid, 6);
  const lines: string[] = [];
  if (name) lines.push(`El cliente se llama ${name}. Salúdalo por su nombre cuando sea natural.`);
  if (orders.length) {
    lines.push("Historial de pedidos de ESTE cliente (más reciente primero):", ...orders.map((order) => `- ${order.date}: ${order.product} · ${order.bs} Bs · ${order.statusLabel}`));
  }
  return lines.join("\n");
}

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

// Slug used by the interactive buttons ("precios:free fire") for a product.
function gameSlug(productName: string): string {
  const key = normalizeKey(productName);
  const found = WHATSAPP_GAMES.find((game) => normalizeKey(game) === key)
    ?? WHATSAPP_GAMES.find((game) => key.includes(normalizeKey(game)) || normalizeKey(game).includes(key));
  return found ?? "free fire";
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
    "Desde ya atiendo yo, no vuelvo a escribirte hasta que él/contesta.",
    "Si prefieres volver con el bot, escribe *bot on*.",
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
function fallbackReply(text: string): { reply: string; showPricesFor: string | null; paymentData?: boolean; handoff?: boolean } {
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
  // Delivery-time FAQ: "por qué mi recarga no llega", "cuánto tarda", etc.
  if (/(tiempo|tarda|tarde|demora|llega|entrega|demorado)/.test(normalized)) {
    return { reply: "⏱️ Nuestras recargas llegan en *1 a 2 horas* como máximo (casi siempre en minutos ⚡).\n\nSi tu recarga ya pasó ese tiempo, escríbeme *hablar con soporte* y una persona del equipo la revisa de una 😊", showPricesFor: null };
  }
  // Problems: offer immediate empathy and an easy escalation path.
  if (/(error|fallo|falla|problema|no funciona|da[ñn]ado)/.test(normalized)) {
    return { reply: "Encantado de ayudarte 🙌 Cuéntame exactamente qué pasó con tu recarga o tu pago, y si hace falta paso tu caso a una persona del equipo de una vez.", showPricesFor: null };
  }
  // Payment data: the classic "por dónde pago" question.
  if (/(pago m[oó]vil|pagom[oó]vil|transferencia|datos de pago|por d[oó]nde pago|como pago|c[oó]mo pago|cuenta|banco)/.test(normalized)) {
    return { reply: "", showPricesFor: null, paymentData: true };
  }
  // Human support: never leave this to chance when Gemini is down.
  if (wantsHumanHandoff(text)) {
    return { reply: "", showPricesFor: null, handoff: true };
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

// A text message that LOOKS like a typed receipt (a reference number or
// receipt keywords). Anything else sent while we wait for the receipt photo
// is small talk and must never reach Gemini as a "receipt".
//
// The digit threshold is deliberately 4: the customer may be typing ONLY the
// reference (the store verifies it against the exact order amount), and the
// bank's references can be short in some apps.
function isReceiptLikeText(text: string): boolean {
  if (!text) return false;
  if (text.replace(/\D/g, "").length >= 4) return true;
  return /(?:ref(?:erencia)?|operaci[oó]n|monto|pago\s*m[oó]vil|pagom[oó]vil|transferencia|comprobante|\bbs\.?\b|\bbsf\b)/i.test(text);
}

// Message that asks for the payment reference: it is the single most useful
// piece of a receipt, and the one that lets the store verify even when the
// screenshot cannot be read.
function askForReferenceMessage(total: string | undefined, reason: string): string {
  return [
    reason,
    "",
    "✍️ Escríbeme solo la *referencia* del pago (los números, sin letras) y la verifico contra el banco.",
    total ? `💰 El monto de tu pedido es *${total}*: el pago debe coincidir con ese monto.` : "",
    "",
    "📸 O si prefieres, mándame de nuevo la foto del comprobante.",
  ].filter(Boolean).join("\n");
}

const RETRY_BUTTONS = [
  { id: "pago:reintentar", title: "🔁 Reintentar" },
  { id: "soporte", title: "🙋 Soporte" },
];

// Outcome of the Player ID lookup against mobentas.com. The distinction
// matters: "not_found" is a real answer from the game database, while
// "unavailable" only means the service did not answer us. Conflating them
// is what made the bot reject EVERY id and block the whole store.
type PlayerLookup = { status: "ok"; nickname: string } | { status: "not_found" } | { status: "unavailable" };

// Circuit breaker: after repeated failures the lookup is skipped for a few
// minutes so customers are not kept waiting on a dead third party.
let lookupFailures = 0;
let lookupPausedUntil = 0;

async function lookupPlayerNickname(productName: string, playerId: string): Promise<PlayerLookup> {
  const game = productName.toLowerCase();
  let action = "";
  if (game.includes("free fire")) action = "mobentas_user_verify_free";
  else if (game.includes("blood strike")) action = "mobentas_user_verify_blood";
  else return { status: "unavailable" }; // Roblox (username-based): nothing to check.
  if (Date.now() < lookupPausedUntil) return { status: "unavailable" };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch("https://mobentas.com/wp-admin/admin-ajax.php", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `action=${action}&id=${encodeURIComponent(playerId)}`,
        signal: AbortSignal.timeout(6_000),
      });
      if (!response.ok) throw new Error(`http ${response.status}`);
      const data: any = JSON.parse(await response.text());
      // Current answer shape: { success:false, data:{ message:"...incorrecto" } }
      // means the id does not exist in the game. That is the ONLY case that
      // may stop the sale.
      if (data?.success === false) {
        lookupFailures = 0;
        return { status: "not_found" };
      }
      // Nickname lives at data.nickname now; data.response is the legacy shape.
      const name = String(data?.data?.nickname ?? data?.nickname ?? data?.response ?? "")
        .replace(/\u3164/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (name && !/incorrect|inválid|invalid/i.test(name)) {
        lookupFailures = 0;
        return { status: "ok", nickname: name };
      }
      // Answered, but nothing we can confirm: treat as unavailable.
      throw new Error("respuesta sin apodo");
    } catch (error) {
      lookupFailures += 1;
      logger.warn({ err: error, playerId }, "Player ID lookup failed");
      if (lookupFailures >= 3) lookupPausedUntil = Date.now() + 10 * 60_000;
    }
  }
  return { status: "unavailable" };
}

// True when the message can plausibly BE a player ID: digits only, a long
// digit run inside a sentence, or a "Player ID: 123..." line. Anything else
// while we wait for the ID is a question, not a bad ID: answering "ese ID no
// es válido" to "no sé cuál es" is what looped and burned customers.
function looksLikePlayerId(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if (/^\+?\d[\d\s.\-]{0,30}$/.test(value)) return true;
  if (/\d{6,}/.test(value)) return true;
  if (/^[^\n:={}]{0,40}[:=]/.test(value)) return true;
  return false;
}

export function createBotCore(db: Database.Database, rawSend: (jid: string, text: string, interactive?: { buttons?: Array<{ id: string; title: string }> }) => Promise<void>): BotCore {
  const venium = createVeniumClient();
  const salesAssistant = createSalesAssistant();
  const playerIdAnalyzer = createPlayerIdAnalyzer();

  // Wrapped transport: every bot reply is published to the realtime bus so
  // the admin panel (SSE) and push notifications mirror the full conversation.
  // WhatsApp sometimes delivers incoming messages from a @lid address, but
  // sending TO a @lid fails ("No LID for user"). Replies always go to the
  // real phone number instead; the adapter passes it as sendJid.
  const send: typeof rawSend = async (jid, text, interactive) => {
    const target = jid.endsWith("@lid") ? `${jid.split("@")[0]}@s.whatsapp.net` : jid;
    await rawSend(target, text, interactive);
    // Track our own sends (both address shapes): the WhatsApp Web adapter
    // uses this to tell the bot's messages apart from the owner typing
    // manually on the phone.
    bumpMap(botSentAt, target, Date.now());
    bumpMap(botSentAt, jid, Date.now());
    notify("message_out", jid, text.slice(0, 160));
  };

  // Bot notice initiated by the backend (order completed, survey): delivered
  // and logged like any other bot reply.
  const sendNotice = async (jid: string, text: string, interactive?: { buttons?: Array<{ id: string; title: string }> }): Promise<void> => {
    await send(jid, text, interactive);
    logBotMessage(db, jid, text);
  };

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
  // Consecutive rejected player IDs per chat: after two we offer to continue.
  const invalidIdAttempts = new Map<string, number>();
  // Chats already flagged to the owner for writing from two numbers.
  const multiNumberNotified = new Set<string>();

  // Same player, different number: the customer is (probably) the same person
  // on a second line. Warn the owner instead of treating it as a stranger.
  function flagRelatedChats(jid: string, values: string[]): void {
    for (const related of findRelatedChats(db, jid, values)) {
      const key = [jid, related.jid].sort().join("|");
      if (multiNumberNotified.has(key)) continue;
      multiNumberNotified.add(key);
      logger.warn({ from: jid, related: related.jid, reason: related.reason }, "Same customer writing from two chats");
      notify("multi_number", jid, `${related.phone} · ${related.reason}`, { otherJid: related.jid, phone: related.phone, reason: related.reason });
    }
  }
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
      notify("order_created", jid, `${item.productName.trim()} · ${item.packageName} · ${fmtBs(order.sale_price_bs_total)}`, { orderId: order.id });
      // Same customer writing from another number / another chat: tell the
      // owner instead of silently treating it as a stranger.
      flagRelatedChats(jid, Object.values(playerData).map((value) => String(value ?? "").trim()));
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

  // Central ID handler: validates the digits, verifies them against the game
  // (or reads them from a screenshot) and either confirms or advances. Every
  // path moves the customer FORWARD — a dead end is not an option.
  async function handlePlayerId(
    flowSession: WhatsAppSession,
    item: any,
    fieldKey: string,
    rawId: string,
    options?: { nickname?: string | null; fromScreenshot?: boolean },
  ): Promise<void> {
    const jid = flowSession.whatsappJid;
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
    const playerData = { ...flowSession.playerData, [fieldKey]: digits };
    // The ID read from a screenshot comes with its own nickname: no second
    // lookup needed, the customer already sees the result of the read.
    const lookup = options?.nickname
      ? ({ status: "ok", nickname: options.nickname } as const)
      : await lookupPlayerNickname(item.productName, digits);

    if (lookup.status === "not_found") {
      const attempts = (invalidIdAttempts.get(jid) ?? 0) + 1;
      invalidIdAttempts.set(jid, attempts);
      // Keep the rejected id: the "usar este ID igual" button needs it.
      saveSession(db, { ...flowSession, playerData });
      const m = [
        "❌ *Ese ID no existe en el juego.*",
        "",
        "Verifica que lo copiaste bien (Perfil → ID junto al nombre) y mándamelo de nuevo.",
      ].join("\n");
      // After two rejections we always leave the door open: the game database
      // can be out of date and a wrong "no" here costs us the sale.
      const buttons = attempts >= 2
        ? [
            { id: "pedido:idigual", title: "➡️ Usar este ID igual" },
            { id: "precios:" + gameSlug(item.productName), title: "🔄 Volver a la lista" },
          ]
        : [{ id: "precios:" + gameSlug(item.productName), title: "🔄 Volver a la lista" }];
      await send(jid, m, { buttons });
      logBotMessage(db, jid, m);
      return;
    }
    invalidIdAttempts.delete(jid);
    // Already used from another number? The owner hears about it now, not
    // only when the order is created.
    flagRelatedChats(jid, [digits]);
    // Lookup unavailable (service down / timeout): NEVER block the sale.
    if (lookup.status === "unavailable") {
      const m = [
        `🧾 Listo, tomo el ID *${digits}* para tu pedido.`,
        "",
        "⚠️ Ahora mismo no puedo confirmar el apodo en el juego, así que te pido un favor: revisa que el ID sea el tuyo antes de pagar 🙌",
      ].join("\n");
      await send(jid, m);
      logBotMessage(db, jid, m);
      await finalizeOrder(flowSession, item, playerData);
      return;
    }
    // Verified (by the game or by the customer's own screenshot).
    const game = gameSlug(item.productName);
    const confirm = [
      `✅ *Jugador verificado:*`,
      `👤 ${lookup.nickname}`,
      `🪪 ID: ${digits}`,
      options?.fromScreenshot ? "_(leído de tu captura)_" : "",
      "",
      "¿Es tu jugador? Confirma abajo 👇 (o mándame otro ID para corregir)",
    ].filter(Boolean).join("\n");
    await send(jid, confirm, { buttons: [
      { id: "pedido:confirmar", title: "✅ Sí, es correcto" },
      { id: "precios:" + game, title: "🔄 Elegir otro" },
    ] });
    logBotMessage(db, jid, confirm);
    saveSession(db, { ...flowSession, playerData });
  }

  function setHandoffLocal(session: WhatsAppSession, on: boolean, reason: string): void {
    session.handoff = on;
    saveSession(db, session);
    setHandoff(db, session.whatsappJid, on, reason);
  }

  // Handoff helper shared by every state: flags the chat for the CRM, notifies
  // the owner and answers the customer with the human-takeover message.
  async function requestHandoff(jid: string, session: WhatsAppSession, reason: string): Promise<void> {
    setHandoffLocal(session, true, reason);
    notify("handoff_on", jid, `Cliente pidió humano: ${reason}`);
    const m = handoffMessageForCustomer();
    await send(jid, m);
    logBotMessage(db, jid, m);
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
    // Handoff intent FIRST: "quiero hablar con el dueño" while waiting for the
    // receipt must reach a human, not a "pedido en pausa" bounce.
    if (!msg.hasMedia && text && wantsHumanHandoff(text)) {
      await requestHandoff(jid, session, "Cliente pidió una persona mientras esperábamos el comprobante");
      return;
    }
    const receiptTrigger = /\b(cancelar|anular|parar|ya no|otro pedido|atras|atrás)\b/i;
    // Clear NON-receipt intents must exit the receipt flow instead of being
    // fed to Gemini (this is what made the bot "derail" mid-order before).
    const exitIntent = !msg.hasMedia && text && (
      /^(hola|buenas|bueno|hey|epa|holi|que tal|saludos|menu|menú|precios|inicio|start|gracias)\b/i.test(text.trim())
      || receiptTrigger.test(text)
      || /^(precios:|pack:|pago:datos|pedido:)/i.test(text.trim())
      || WHATSAPP_GAMES.some((game) => normalizeKey(text).includes(normalizeKey(game)))
    );
    if (exitIntent) {
      saveSession(db, { ...session, state: "idle", packageId: null, playerData: {}, orderId: null, lastShown: session.lastShown });
      const m = receiptTrigger.test(text)
        ? "Sin problema, cancelé ese pedido 🙌 ¿Qué querés hacer ahora? Puedo mostrarte precios de *Free Fire, Blood Strike o Roblox* 😊"
        : "¡Hola! 😊 Dejamos ese pedido en pausa por ahora.\n\nCuando tengas la *foto del comprobante* mándamela y lo confirmamos al instante ⚡ O si prefieres, dime qué otro juego quieres recargar 🎮";
      await send(jid, m, receiptTrigger.test(text) ? welcomeButtons : undefined);
      logBotMessage(db, jid, m);
      return;
    }
    let imageBase64: string | undefined;
    let imageMimeType: string | undefined;
    // The BDV verifier drives a real browser session against the bank and
    // takes ~30 seconds: tell the customer we are checking so the chat does
    // not look frozen (this was reported as "el bot se queda con error").
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
    } else if (msg.hasMedia && !text.trim()) {
      // A non-image attachment (video, audio, document, sticker) sent while we
      // wait for the receipt: NEVER feed it to Gemini. Keep the order open.
      const m = "📸 Ese archivo no lo puedo usar como comprobante. Mándame la *foto del comprobante* (la que manda tu banco con la referencia y el monto) y lo confirmo al instante ⚡";
      await send(jid, m);
      logBotMessage(db, jid, m);
      return;
    }

    if (env.PAYMENT_PROVIDER === "bdv") {
      const waiting = [
        "🏦 *Verificando tu pago en el banco* ahora mismo ⏳",
        "",
        "Esto toma unos 30 segundos. No cierres el chat: te confirmo en el momento ⚡",
      ].join("\n");
      await send(jid, waiting);
      logBotMessage(db, jid, waiting);
    }

    const orderTotal = fmtBs(String((getOrder(db, session.orderId!) as any)?.sale_price_bs_total ?? ""));
    const result: any = await submitReceipt(db, session.orderId!, {
      text: text || undefined,
      imageBase64,
      imageMimeType,
    });
    if (result.gemini?.status === "incomplete") {
      // Neither the photo nor the text gave us a reference. Ask for it
      // explicitly: the reference alone is enough to verify the payment.
      const m = askForReferenceMessage(orderTotal, "No pude leer la referencia en tu comprobante 😅");
      await send(jid, m, { buttons: RETRY_BUTTONS });
      logBotMessage(db, jid, m);
      saveSession(db, { ...session, state: "awaiting_reference" });
      return;
    }
    if (result.duplicate) {
      const m = "⚠️ Esa referencia ya fue usada antes en la tienda.\n\nSi es el MISMO comprobante de ESTE pedido, escribe *ya pagué* y lo libero para verificarlo de una. Si el pago fue para otro pedido, mándame el comprobante nuevo con su referencia 🙏";
      await send(jid, m);
      logBotMessage(db, jid, m);
      return;
    }
    // The customer re-sent the receipt of an order whose payment is already
    // confirmed (parked for wallet balance or already at Venium): reassure,
    // never error.
    if (result.alreadyVerified) {
      const status = String(result.order?.status ?? "");
      const m = status === "venium_pending"
        ? VENIUM_UNAVAILABLE_CUSTOMER_MESSAGE
        : "🎉 *¡Tu pago ya está confirmado!* Tu recarga está en proceso y se completará en unos minutos ⚡ Te aviso por aquí en cuanto quede lista 🙌";
      await send(jid, m);
      logBotMessage(db, jid, m);
      return;
    }
    if (result.antifraud?.status === "suspicious") {
      const m = "El comprobante quedó en revisión de seguridad. No se enviará ninguna orden hasta validarlo.";
      await send(jid, m);
      logBotMessage(db, jid, m);
      notify("payment_review", jid, `Ref ${result.order?.payment_reference ?? "?"} · ${result.antifraud?.reason ?? "revisión"}`);
      return;
    }
    if (!result.pabilo?.verified || !result.pabilo?.isNew) {
      const failure = describePaymentFailure(String(result.pabilo?.status ?? ""), result.order ?? getOrder(db, session.orderId!));
      const m = [
        failure.title,
        "",
        failure.detail,
        "",
        "🔁 Puedes reintentar ahora o pedir soporte; una persona del equipo revisa tu caso con calma 🙌",
      ].join("\n");
      await send(jid, m, { buttons: RETRY_BUTTONS });
      logBotMessage(db, jid, m);
      return;
    }
    // Verified payment but the Venium wallet could not take the order right
    // now (out of balance, provider hiccup): the order stays queued and the
    // customer gets the standard "in process" promise — NEVER the error.
    if (result.veniumUnavailable) {
      saveSession(db, { ...session, state: "idle", packageId: null, playerData: {}, orderId: null, lastShown: session.lastShown });
      const queued = result.order;
      notify("payment_verified", jid, `${fmtBs(String(queued?.sale_price_bs_total ?? ""))} · pedido ${String(queued?.id ?? "").slice(0, 8)} · EN COLA (sin saldo Venium)`);
      await send(jid, VENIUM_UNAVAILABLE_CUSTOMER_MESSAGE);
      logBotMessage(db, jid, VENIUM_UNAVAILABLE_CUSTOMER_MESSAGE);
      return;
    }
    const order = toPublicOrder(result.order);
    saveSession(db, { ...session, state: "idle", packageId: null, playerData: {}, orderId: null, lastShown: session.lastShown });
    notify("payment_verified", jid, `${fmtBs(String(order.sale_price_bs_total))} · pedido ${String(order.id).slice(0, 8)}`);
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

  async function processIncomingInner(msg: CoreIncoming): Promise<void> {
    const jid = msg.from;
    if (!jid || msg.fromMe || msg.isStatus) return;
    if (!markProcessed(msg.id)) return;
    if (!env.WHATSAPP_ALLOW_GROUPS && jid.endsWith("@g.us")) return;

    // Vex Store sells only to Venezuela: any number that does not start with
    // +58 is ignored completely — no replies, no sessions, no CRM entries.
    // Group JIDs are not personal numbers; they are handled by the group flag.
    if (!jid.endsWith("@g.us")) {
      const phoneDigits = jid.split("@")[0].replace(/\D/g, "");
      if (!phoneDigits.startsWith("58")) {
        logger.info({ from: jid }, "Ignoring non-Venezuelan number (only +58 is served)");
        return;
      }
    }

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

    // Save any image attachment to disk so the CRM shows the real photo.
    let mediaPath: string | null = null;
    if (msg.hasMedia && msg.downloadMedia) {
      const media = await msg.downloadMedia();
      if (media) mediaPath = saveChatMedia(db, jid, media.data, media.mimetype || "image/jpeg");
    }
    // Long-term customer memory: the row exists from the very first message
    // (not only after a completed order), so the bot can greet people by name
    // and track their order history.
    ensureCustomer(db, jid);
    logCustomerMessage(db, jid, text || (mediaPath ? "📸 Foto" : "[imagen]"), msg.isImage ? "image" : "text", mediaPath);
    notify("message_in", jid, msg.isImage ? "📸 Comprobante/foto" : text);

    const session = getFreshSession(db, jid);

    // Panel-level block: the CRM wins over everything except 'bot on'.
    if (isAdminBlocked(db, jid) && text.trim().toLowerCase() !== "bot on") {
      logger.info({ from: jid }, "JID blocked from admin panel; ignoring");
      return;
    }

    // CSAT tap: the customer is answering a question WE asked, from any state
    // (even while a human has the chat). Never small talk, never moderation.
    const surveyTap = text.trim().match(/^encuesta:([1-5])$/i);
    if (surveyTap) {
      const score = Number(surveyTap[1]);
      const { low } = saveSurveyResponse(db, jid, score);
      const m = low
        ? [
            "Lamento que no haya salido bien 🙏",
            "",
            "Tu calificación ya le llegó al equipo. Si quieres contarme qué pasó, toca *Soporte* y una persona lo revisa de una vez 👇",
          ].join("\n")
        : score === 3
          ? "🙌 ¡Gracias por calificar! Con eso me esfuerzo para que la próxima sean 5 estrellas ⚡"
          : "🎉 *¡Mil gracias!* Me alegra que haya salido bien ⚡\n\nCuando quieras otra recarga, aquí estaré 😊";
      await send(jid, m, low
        ? { buttons: [
            { id: "soporte", title: "🙋 Soporte" },
            { id: "precios:free fire", title: "💎 Recargar" },
          ] }
        : { buttons: [{ id: "precios:free fire", title: "💎 Recargar" }] });
      logBotMessage(db, jid, m);
      return;
    }

    // Human takeover wins over EVERYTHING. While a person has the chat the bot
    // is completely silent: any automatic reply ("te leo", "ya le avisé") is the
    // bot talking over the human the customer asked for.
    if (session.handoff) {
      if (RESUME_BOT_RE.test(text.trim().toLowerCase())) {
        setHandoffLocal(session, false, "");
        const m = "✅ El asistente volvió a la conversación 😊 ¿En qué te ayudo?";
        await send(jid, m);
        logBotMessage(db, jid, m);
        notify("handoff_off", jid, "Bot retomó la conversación");
        // The human session just ended: this is the one moment the store gets
        // to ask how the support went (guarded to once per chat per 24 h).
        await sendSurvey(db, { sendCustomerNotice: sendNotice }, jid, { trigger: "support" });
        return;
      }
      // Repeating the request ("atender", "atiende tú") keeps the mute: the
      // owner already sees every message through the message_in event.
      if (wantsHumanHandoff(text)) {
        logger.info({ from: jid }, "Customer repeats the human request; bot stays silent until 'bot on'");
        notify("handoff_on", jid, `Cliente insiste en atención humana: "${text.trim().slice(0, 80)}"`);
      }
      return;
    }

    // The owner is chatting manually (WhatsApp Web): stay out of the way.
    if (Date.now() < (ownerActiveUntil.get(jid) ?? 0)) {
      logger.info({ from: jid }, "Owner is chatting manually on this chat; bot stays silent");
      return;
    }

    // Deterministic greeting: the store menu with tappable game buttons,
    // in ANY state (idle, mid-checkout, receipt wait). A customer saying
    // "hola" or "menu" always gets the clean menu — never a stuck flow.
    const greetingRe = /^(hola+|holi|buenas|buenos?\s*d[ií]as|buenas\s*tardes|buenas\s*noches|hey|saludos|epa|que\s*tal|menu|men[uú]|inicio|start)[!.? ]*$/i;
    if (greetingRe.test(text.trim().toLowerCase())) {
      // A customer who greets while their order waits for the receipt does NOT
      // lose that order anymore: remind them the checkout is still open.
      if (session.state === "awaiting_receipt" && session.orderId) {
        const pendingOrder: any = getOrder(db, session.orderId);
        const finalStates = ["approved_for_venium", "venium_pending", "venium_processing", "completed", "cancelled", "refunded"];
        if (pendingOrder && !finalStates.includes(pendingOrder.status)) {
          const m = [
            "¡Hola! 😊 Tu pedido sigue abierto y esperando la *foto del comprobante* ⚡",
            "",
            "Mándamela aquí y lo confirmo al instante. Si prefieres cancelarlo y empezar otro, escribe *cancelar* 🙌",
          ].join("\n");
          await send(jid, m);
          logBotMessage(db, jid, m);
          return;
        }
        saveSession(db, { ...session, state: "idle", packageId: null, playerData: {}, orderId: null, lastShown: session.lastShown });
      } else {
        saveSession(db, { ...session, state: "idle", packageId: null, playerData: {}, orderId: null, lastShown: session.lastShown });
      }
      await send(jid, welcomeMessage(), welcomeButtons);
      logBotMessage(db, jid, welcomeMessage());
      return;
    }

    const moderation = moderateMessage(db, {
      whatsappJid: jid,
      message: text || "[comprobante de imagen]",
    });
    if (!moderation.allowed) {
      // A customer sending receipt photos in a burst is FIGHTING the
      // verification, not trolling. Images never count as spam — and if an
      // auto-block was already applied, undo it immediately (this trapped a
      // real customer mid-payment before).
      if (hasImage) {
        if (moderation.action === "block" || moderation.action === "blocked") {
          unblockUser(db, jid);
          logger.warn({ from: jid }, "Receipt image burst triggered the auto-block; unblocked");
          notify("user_unblocked", jid, "Auto-bloqueo revertido: eran fotos de comprobante");
        }
        return;
      }
      // Anti-spam: at most one moderation notice every 10 minutes per chat.
      const lastNotice = moderationNotices.get(jid) ?? 0;
      if (Date.now() - lastNotice > 10 * 60_000) {
        bumpMap(moderationNotices, jid, Date.now());
        const response = moderation.action === "blocked" || moderation.action === "block"
          ? "Este chat quedó pausado por muchos mensajes seguidos 🙏 Escribe *bot off* y una persona del equipo te atenderá de inmediato."
          : "Demasiados mensajes seguidos. Espera un momento antes de continuar.";
        await send(jid, response);
        logBotMessage(db, jid, response);
      }
      if (moderation.action === "block") notify("user_blocked", jid, `Anti-spam: ${moderation.reason ?? ""}`);
      return;
    }

    // FIXED SUPPORT FLOW: "soporte" never leaves the customer to guess what to
    // type. It opens a menu of buttons; the human option is one tap away.
    if (text.trim().toLowerCase() === "soporte") {
      const m = [
        "🙋 *SOPORTE VEX STORE*",
        "",
        "¿Con qué te ayudo? Toca una opción:",
      ].join("\n");
      await send(jid, m, { buttons: [
        { id: "soporte:humano", title: "🙋 Hablar con persona" },
        { id: "soporte:pedido", title: "⏱️ Mi pedido" },
        { id: "soporte:comprar", title: "🎮 Comprar" },
      ] });
      logBotMessage(db, jid, m);
      return;
    }
    if (text.trim().toLowerCase() === "soporte:humano") {
      await requestHandoff(jid, session, "Cliente tocó 'Hablar con persona'");
      return;
    }
    if (text.trim().toLowerCase() === "soporte:comprar") {
      saveSession(db, { ...session, state: "idle", packageId: null, playerData: {}, orderId: null, lastShown: session.lastShown });
      await send(jid, welcomeMessage(), welcomeButtons);
      logBotMessage(db, jid, welcomeMessage());
      return;
    }
    if (text.trim().toLowerCase() === "soporte:pedido") {
      const orders = listRecentOrders(db, jid, 3);
      const lines = orders.length
        ? orders.map((order) => `• ${order.date} · ${order.product} · ${order.bs} Bs · ${order.statusLabel}`)
        : ["• No veo pedidos tuyos con este número."];
      const m = [
        "⏱️ *TUS PEDIDOS RECIENTES*",
        "",
        ...lines,
        "",
        "⏰ Recuerda: la recarga se entrega en *1 a 2 horas* máximo después de confirmar el pago (casi siempre en minutos ⚡).",
        "",
        "¿Quieres que una persona revise algo en específico?",
      ].join("\n");
      await send(jid, m, { buttons: [
        { id: "soporte:humano", title: "🙋 Hablar con persona" },
        { id: "soporte:comprar", title: "🎮 Comprar" },
      ] });
      logBotMessage(db, jid, m);
      return;
    }

    // Anyone asking for a person reaches support from ANY state (checkout,
    // ID step, after a failed receipt) and in ANY wording ("soporte" aside):
    // "bot off", "atender", "atiende tú", "atiéndeme", "que me atienda". This
    // runs before the bot can answer with anything of its own, and the owner
    // gets a push with the reason.
    if (!msg.hasMedia && (text.trim().toLowerCase() === "bot off" || wantsHumanHandoff(text))) {
      await requestHandoff(jid, session, `Cliente pidió soporte: "${text.trim().slice(0, 80)}"`);
      return;
    }

  // Payment details tap + "edit player ID" tap, BEFORE the receipt flow so
  // neither gets swallowed by receipt processing.
  if (session.state === "awaiting_receipt" && session.orderId) {
    if (text.trim() === "pago:reintentar") {
      const orderTotal = fmtBs(String((getOrder(db, session.orderId) as any)?.sale_price_bs_total ?? ""));
      const m = askForReferenceMessage(orderTotal, "¡Claro! Verificamos de nuevo 🔁");
      await send(jid, m);
      logBotMessage(db, jid, m);
      return;
    }
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

  // Customer is answering the "send me the reference" question. A reference
  // alone is verified against the EXACT order amount (the rule that keeps the
  // store selling when the receipt photo cannot be read).
  if (session.state === "awaiting_reference" && session.orderId) {
    if (msg.hasMedia || msg.isImage) {
      // The customer chose to re-send the photo after all.
      saveSession(db, { ...session, state: "awaiting_receipt" });
      await processReceipt(jid, { ...session, state: "awaiting_receipt" }, msg, text.trim());
      return;
    }
    if (text.trim() === "pago:reintentar") {
      saveSession(db, { ...session, state: "awaiting_receipt" });
      const m = "📸 Perfecto, mándame la *foto del comprobante* (o escríbeme la referencia otra vez) y lo verifico al instante ⚡";
      await send(jid, m);
      logBotMessage(db, jid, m);
      return;
    }
    if (text.trim() === "pago:datos") {
      const m = [
        "🏦 *DATOS DE PAGO MÓVIL*",
        "",
        paymentDestinationMessage(db),
        "",
        "✍️ Luego mándame la *referencia* del pago y lo verifico al instante ⚡",
      ].join("\n");
      await send(jid, m);
      logBotMessage(db, jid, m);
      return;
    }
    const digits = text.replace(/\D/g, "");
    if (digits.length >= 4) {
      // Reference typed: back to the normal receipt pipeline (it verifies the
      // reference against the order amount without needing the photo).
      saveSession(db, { ...session, state: "awaiting_receipt" });
      await processReceipt(jid, { ...session, state: "awaiting_receipt" }, msg, text.trim());
      return;
    }
    if (wantsHumanHandoff(text)) {
      await requestHandoff(jid, session, "Cliente pidió una persona al pedirle la referencia");
      return;
    }
    const orderTotal = fmtBs(String((getOrder(db, session.orderId) as any)?.sale_price_bs_total ?? ""));
    const m = askForReferenceMessage(orderTotal, "Sigo esperando la *referencia* de tu pago 🙂");
    await send(jid, m, { buttons: RETRY_BUTTONS });
    logBotMessage(db, jid, m);
    return;
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
      // "ya pagué" right after a duplicate: the customer is re-sending the
      // SAME receipt for THIS order (a retry, not fraud). Release the attempt
      // so it can be verified again without waiting for the admin panel.
      if (!msg.hasMedia && /^(?:ya\s+(?:lo\s+)?pagu[eé]|reenv[ií]ar)/i.test(text.trim())) {
        const order: any = getOrder(db, session.orderId);
        const claimed: any = order?.payment_reference
          ? db.prepare("SELECT order_id FROM payment_attempts WHERE reference = ?").get(order.payment_reference)
          : null;
        if (claimed && claimed.order_id === session.orderId) {
          db.prepare("DELETE FROM payment_attempts WHERE reference = ? AND order_id = ?").run(order.payment_reference, session.orderId);
          setPaymentState(db, session.orderId, "not_submitted");
          const m = "👌 Listo, liberé el comprobante. Mándame la *foto del comprobante* otra vez y lo verifico de una ⚡";
          await send(jid, m);
          logBotMessage(db, jid, m);
          return;
        }
      }
      // Small-talk guard: short natural messages while we wait for the
      // receipt photo ("ya", "listo", "cambio de opinión") are NOT receipts.
      // Answer kindly, keep the order open, never feed them to Gemini as text
      // (that burned real customers with "no pude leer"). Button taps and
      // receipt-like texts still go through to the normal flow.
      const isButtonTap = /^(precios:|pack:|pago:|pedido:)/i.test(text.trim());
      if (!msg.isImage && !isButtonTap && !isReceiptLikeText(text.trim())) {
        if (wantsHumanHandoff(text)) {
          await requestHandoff(jid, session, "Cliente pidió una persona mientras esperábamos el comprobante");
          return;
        }
        // A receipt-like small-talk message may carry the customer's name:
        // capture it even mid-checkout.
        const nameMidCheckout = extractCustomerName(text);
        if (nameMidCheckout) setCustomerName(db, jid, nameMidCheckout);
        const m = "😊 Recibido. Tu pedido sigue abierto y esperando la *foto del comprobante* (la que manda tu banco con la referencia y el monto). Mándamela aquí y lo confirmo al instante ⚡\n\n⏱️ Tip: luego de confirmar, la recarga llega en máximo 1-2 horas.";
        await send(jid, m);
        logBotMessage(db, jid, m);
        return;
      }
      await processReceipt(jid, session, msg, text.trim());
      return;
    }    // Customer confirming the verified player ID (SI text or ✅ button tap).
    if (session.state === "awaiting_player" && session.packageId && (/^(si|sí|sii|si es|correcto|listo|ok|vale|pedido:confirmar)\b/i.test(text.trim()) || text.trim() === "pedido:confirmar")) {
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
      const fieldKey = fields[0]?.key ?? "playerid";
      const isPlayerId = fields[0]?.key === "playerid" || String(fields[0]?.label ?? "").toLowerCase().includes("player");

      // "Usar este ID igual": the customer insists, so we honor it and move on.
      if (/^pedido:idigual$/i.test(text.trim()) && isPlayerId) {
        const keep = String(flowSession.playerData[fieldKey] ?? "").replace(/[^0-9]/g, "");
        if (keep.length >= 8) {
          invalidIdAttempts.delete(flowSession.whatsappJid);
          await finalizeOrder(flowSession, item, { ...flowSession.playerData, [fieldKey]: keep });
        } else {
          await send(jid, "Mándame el ID otra vez y lo tomo tal cual 😊");
        }
        return;
      }

      // SCREENSHOT: the customer sent a photo of their game profile instead of
      // typing the ID. Gemini reads it and the flow continues from there.
      if (isPlayerId && msg.isImage && msg.downloadMedia) {
        const media = await msg.downloadMedia();
        if (media?.data) {
          await send(jid, "🔍 Recibí tu captura, dame un momento mientras leo tu Player ID…");
          logBotMessage(db, jid, "🔍 Recibí tu captura, dame un momento mientras leo tu Player ID…");
          const read = await playerIdAnalyzer.analyze({ imageBase64: media.data, imageMimeType: media.mimetype });
          if (read.playerId) {
            await handlePlayerId(flowSession, item, fieldKey, read.playerId, { nickname: read.nickname, fromScreenshot: true });
            return;
          }
          const m = [
            "📸 No logré leer un ID de jugador en esa foto 😅",
            "",
            "Mándame una foto donde se vea tu *perfil* con el ID junto al nombre, o escríbeme el ID aquí (son 8 a 12 dígitos).",
            "",
            "Si prefieres que lo haga una persona, escríbeme *soporte* y te atendemos al instante 🙏",
          ].join("\n");
          await send(jid, m);
          logBotMessage(db, jid, m);
          return;
        }
      }

      // NOT an ID: the customer asks something, changes their mind or insists.
      // Answering "ese ID no es válido" here is what looped them forever.
      if (isPlayerId && !looksLikePlayerId(text)) {
        if (wantsHumanHandoff(text)) {
          await requestHandoff(jid, flowSession, "Cliente pidió una persona mientras enviaba su ID");
          return;
        }
        const fb = fallbackReply(text);
        if (fb.handoff) {
          await requestHandoff(jid, flowSession, "Cliente pidió soporte humano");
          return;
        }
        if (fb.showPricesFor !== null) {
          const collected: Array<{ n: number; packageId: string; label: string }> = [];
          const listText = priceListMessage(db, fb.showPricesFor || undefined, collected);
          saveSession(db, { ...flowSession, lastShown: collected });
          await send(jid, listText, listForPackages(collected));
          logBotMessage(db, jid, listText);
          return;
        }
        const m = fb.paymentData
          ? [
              "🏦 *DATOS DE PAGO MÓVIL*",
              "",
              paymentDestinationMessage(db),
              "",
              "📸 Después de pagar, mándame la *foto del comprobante* y lo verifico al instante ⚡",
            ].join("\n")
          : fb.reply || [
              `📝 Sigo esperando tu *Player ID* para el pedido de *${item.productName.trim()}* — ${item.packageName}.`,
              "",
              "Son los números que salen junto a tu nombre en el juego (Perfil → ID).",
              "",
              "Puedes:",
              "• escribirlo aquí (8 a 12 dígitos), o",
              "• mandarme una *captura de tu perfil* y lo leo yo 📸",
              "",
              "Si quieres otro paquete o que te ayude una persona, dime y lo resolvemos 😊",
            ].join("\n");
        await send(jid, m, { buttons: [
          { id: "pedido:idfoto", title: "📸 Mandar captura" },
          { id: "soporte", title: "🙋 Hablar con soporte" },
        ] });
        logBotMessage(db, jid, m);
        return;
      }

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
      // it is verified against the game's own database (returns the nickname).
      const rawId = String(playerData[fieldKey] ?? "").trim();
      if (isPlayerId) {
        await handlePlayerId(flowSession, item, fieldKey, rawId);
        return;
      }
      // Non-verified games (Roblox usernames etc.) go straight to order.
      await finalizeOrder(flowSession, item, playerData);
      return;
    }

    // A photo with NO active purchase flow and NO caption: almost certainly a
    // receipt sent early, or any random picture. Never feed an empty message
    // to the sales brain (it used to reply "no entendí").
    if (hasImage && !text.trim() && session.state === "idle") {
      const m = "📸 Recibí tu foto 😊 ¿De qué juego quieres una recarga: *Free Fire*, *Blood Strike* o *Roblox*? Si es el comprobante de pago, dime primero qué paquete quieres para darte los datos ⚡";
      await send(jid, m, welcomeButtons);
      logBotMessage(db, jid, m);
      return;
    }

    // Long-term memory: "me llamo Carlos" / "soy María" stores the name so
    // every future conversation greets them personally.
    const introducedName = extractCustomerName(text);
    if (introducedName) setCustomerName(db, jid, introducedName);

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

    // Tap on a package row from an interactive price list (or the
    // "elegir otro" button which jumps straight to the game's price list).
    const packTap = text.trim().match(/^pack:(.+)$/);
    if (packTap) {
      const selected = filterWhatsAppGames(catalogPackages(db)).find((item) => item.packageId === packTap[1]);
      if (selected) selectionPackageId = selected.packageId;
    }
    if (!packTap && session.state === "awaiting_player" && /^precios:/i.test(text.trim())) {
      // From the confirm screen the customer wants another package.
      saveSession(db, { ...session, state: "idle", packageId: null, playerData: {}, orderId: null, lastShown: session.lastShown });
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
      memory: customerMemoryBlock(db, jid),
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
      if (fb.handoff) {
        handoffRequested = true;
        handoffReason = "Cliente pidió soporte humano";
      } else if (fb.paymentData) {
        reply = [
          "🏦 *DATOS DE PAGO MÓVIL*",
          "",
          paymentDestinationMessage(db),
          "",
          "📸 Después de pagar, mándame la *foto del comprobante* y lo verifico al instante ⚡",
        ].join("\n");
      } else if (fb.reply) {
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

  // Safety net around the whole state machine: whatever breaks inside, the
  // customer always gets an answer and the owner always gets a push. A bot
  // that goes silent is what made customers angry and orders get lost.
  async function processIncoming(msg: CoreIncoming): Promise<void> {
    try {
      await processIncomingInner(msg);
    } catch (error) {
      logger.error({ err: error, from: msg.from }, "processIncoming crashed");
      try {
        notify("bot_error", msg.from, `Error interno: ${error instanceof Error ? error.message : String(error)}`);
        const m = "Ups, se me trabó algo un momento 😅 Vuelvo a intentarlo: escríbeme otra vez tu *Player ID* o la *referencia de pago* y lo retomo de una 🙌";
        await send(msg.from, m);
        logBotMessage(db, msg.from, m);
      } catch (fallbackError) {
        logger.error({ err: fallbackError }, "could not answer after a crash");
      }
    }
  }

  return {
    processIncoming,
    sendHumanReply: async (jid: string, text: string) => {
      logHumanMessage(db, jid, text);
      await send(jid, text);
    },
    // Bot message started by the backend (order completed at Venium, wallet
    // retry succeeded): logged and delivered like any other bot reply.
    sendCustomerNotice: sendNotice,
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
