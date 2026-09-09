import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import Database from "better-sqlite3";
import { rm } from "node:fs/promises";
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

const logger = pino({ level: process.env.NODE_ENV === "production" ? "info" : "warn" });



type SessionState = "idle" | "awaiting_player" | "awaiting_receipt";

interface WhatsAppSession {
  whatsappJid: string;
  state: SessionState;
  packageId: string | null;
  playerData: Record<string, string>;
  orderId: string | null;
}

export interface WhatsAppAdapter {
  enabled: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(jid: string, text: string): Promise<void>;
  requestPairingCode(phoneNumber: string): Promise<string>;
  status(): {
    enabled: boolean;
    connection: "closed" | "connecting" | "open";
    pairingCode: string | null;
    pairingPhone: string;
    qrDataUrl: string | null;
    qrExpiresAt: string | null;
  };
}

function sessionFromRow(row: any): WhatsAppSession {
  return {
    whatsappJid: row.whatsapp_jid,
    state: row.state,
    packageId: row.package_id,
    playerData: JSON.parse(row.player_data_json || "{}"),
    orderId: row.order_id,
  };
}

function getSession(db: Database.Database, jid: string): WhatsAppSession {
  const row = db.prepare("SELECT * FROM whatsapp_sessions WHERE whatsapp_jid = ?").get(jid);
  if (row) return sessionFromRow(row);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO whatsapp_sessions (whatsapp_jid, state, player_data_json, updated_at)
    VALUES (?, 'idle', '{}', ?)
  `).run(jid, now);
  return { whatsappJid: jid, state: "idle", packageId: null, playerData: {}, orderId: null };
}

function saveSession(db: Database.Database, session: WhatsAppSession): void {
  db.prepare(`
    INSERT INTO whatsapp_sessions
      (whatsapp_jid, state, package_id, player_data_json, order_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(whatsapp_jid) DO UPDATE SET
      state = excluded.state,
      package_id = excluded.package_id,
      player_data_json = excluded.player_data_json,
      order_id = excluded.order_id,
      updated_at = excluded.updated_at
  `).run(
    session.whatsappJid,
    session.state,
    session.packageId,
    JSON.stringify(session.playerData),
    session.orderId,
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

function catalogPackages(db: Database.Database): Array<{ packageId: string; packageName: string; productName: string; productId: string; costUsd: string; outOfStock: boolean }> {
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

function catalogMessage(db: Database.Database): string {
  const settings = getSettings(db);
  const packages = catalogPackages(db).filter((item) => !item.outOfStock);
  if (!packages.length) return "El catálogo no está disponible en este momento. Intenta de nuevo más tarde.";
  const lines = packages.map((item, index) => {
    const quote = calculatePrice(item.costUsd, 1, settings);
    return `${index + 1}. ${item.productName} — ${item.packageName}: Bs ${quote.salePriceBsTotal}\n   Comprar: COMPRA ${index + 1}`;
  });
  return [
    "Catálogo disponible:",
    ...lines,
    "",
    "También puedes escribir AYUDA. Los precios están congelados al crear el pedido.",
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

function messageText(message: WAMessage): string {
  const content = message.message;
  return content?.conversation ??
    content?.extendedTextMessage?.text ??
    content?.imageMessage?.caption ??
    content?.documentMessage?.caption ??
    "";
}

export function createWhatsAppAdapter(db: Database.Database): WhatsAppAdapter {
  const venium = createVeniumClient();
  let socket: WASocket | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let stopping = false;
  let connection: "closed" | "connecting" | "open" = "closed";
  let pairingCode: string | null = null;
  let pairingTimer: NodeJS.Timeout | null = null;
  let qrDataUrl: string | null = null;
  let qrExpiresAt: string | null = null;
  let qrTimer: NodeJS.Timeout | null = null;

  async function ensureCatalog(): Promise<void> {
    if (!catalogPackages(db).length) syncCatalog(db, await venium.getCatalog());
  }

  async function sendMessage(jid: string, text: string): Promise<void> {
    if (!socket || connection !== "open") throw new Error("WhatsApp is not connected");
    await socket.sendMessage(jid, { text });
  }

  async function requestPairingCode(phoneNumber: string): Promise<string> {
    if (!socket || connection === "closed") throw new Error("WhatsApp is not connecting");
    const normalized = phoneNumber.replace(/\D/g, "");
    if (!/^\d{8,15}$/.test(normalized)) throw new Error("El número debe incluir el código de país y tener entre 8 y 15 dígitos");
    const code = await socket.requestPairingCode(normalized);
    pairingCode = code;
    return pairingCode;
  }

  async function processReceipt(jid: string, session: WhatsAppSession, message: WAMessage, text: string): Promise<void> {
    let imageBase64: string | undefined;
    let imageMimeType: string | undefined;
    if (message.message?.imageMessage) {
      const image = await downloadMediaMessage(
        message,
        "buffer",
        {},
        {
          logger,
          reuploadRequest: async (mediaMessage) => socket!.updateMediaMessage(mediaMessage),
        },
      );
      if (image.byteLength > 8 * 1024 * 1024) {
        await sendMessage(jid, "El comprobante supera el tamaño permitido. Envía una imagen más pequeña.");
        return;
      }
      imageBase64 = image.toString("base64");
      imageMimeType = message.message.imageMessage.mimetype ?? "image/jpeg";
    }

    const result: any = await submitReceipt(db, session.orderId!, {
      text: text || undefined,
      imageBase64,
      imageMimeType,
    });
    if (result.gemini?.status === "incomplete") {
      await sendMessage(jid, "No pude leer la referencia y el monto. Envía una foto más clara del comprobante.");
      return;
    }
    if (result.duplicate) {
      await sendMessage(jid, "Ese comprobante o referencia ya fue utilizado. El pedido no se procesó nuevamente.");
      return;
    }
    if (result.antifraud?.status === "suspicious") {
      await sendMessage(jid, "El comprobante quedó en revisión de seguridad. No se enviará ninguna orden hasta validarlo.");
      return;
    }
    if (!result.pabilo?.verified || !result.pabilo?.isNew) {
      await sendMessage(jid, "No se pudo confirmar un pago nuevo en Pabilo. Revisa los datos y contacta soporte.");
      return;
    }
    const order = toPublicOrder(result.order);
    saveSession(db, {
      ...session,
      state: "idle",
      packageId: null,
      playerData: {},
      orderId: null,
    });
    await sendMessage(
      jid,
      `Pago confirmado. Tu pedido quedó procesando.\nPedido: ${String(order.id).slice(0, 8)}\nEstado: ${order.status}`,
    );
  }

  async function processIncomingMessage(message: WAMessage): Promise<void> {
    const jid = message.key.remoteJid;
    if (!jid || message.key.fromMe || jid === "status@broadcast") return;
    if (!env.WHATSAPP_ALLOW_GROUPS && jid.endsWith("@g.us")) return;

    const text = messageText(message);
    const hasImage = Boolean(message.message?.imageMessage);
    if (!text.trim() && !hasImage) return;

    const moderation = moderateMessage(db, {
      whatsappJid: jid,
      message: text || "[comprobante de imagen]",
    });
    if (!moderation.allowed) {
      const response = moderation.action === "blocked"
        ? "Este chat está bloqueado temporalmente por actividad repetitiva."
        : "Demasiados mensajes seguidos. Espera un momento antes de continuar.";
      await sendMessage(jid, response);
      return;
    }
    if (moderation.action === "warning") {
      await sendMessage(jid, "Evita enviar mensajes repetidos o en ráfaga para continuar.");
    }

    const normalized = text.trim().toLowerCase();
    const session = getSession(db, jid);
    if (["hola", "menu", "menú", "ayuda", "inicio", "catalogo", "catálogo"].includes(normalized)) {
      try {
        await ensureCatalog();
      } catch {
        await sendMessage(jid, "No pude consultar el catálogo ahora. Intenta nuevamente en unos segundos.");
        return;
      }
      await sendMessage(jid, `${catalogMessage(db)}\n\nPara cancelar una operación escribe CANCELAR.`);
      return;
    }
    if (normalized === "cancelar") {
      saveSession(db, { whatsappJid: jid, state: "idle", packageId: null, playerData: {}, orderId: null });
      await sendMessage(jid, "Operación cancelada. Escribe CATÁLOGO para comenzar.");
      return;
    }

    if (session.state === "awaiting_receipt" && session.orderId) {
      await processReceipt(jid, session, message, text.trim());
      return;
    }

    const purchase = normalized.match(/^compra\s+(.+)$/);
    if (purchase) {
      try {
        await ensureCatalog();
      } catch {
        await sendMessage(jid, "No pude consultar el catálogo ahora. Intenta nuevamente en unos segundos.");
        return;
      }
      const packages = catalogPackages(db).filter((item) => !item.outOfStock);
      const selected = /^\d+$/.test(purchase[1])
        ? packages[Number(purchase[1]) - 1]
        : packages.find((item) => item.packageId.toLowerCase() === purchase[1].toLowerCase());
      if (!selected) {
        await sendMessage(jid, "No encontré ese paquete. Escribe CATÁLOGO para ver las opciones.");
        return;
      }
      const fields = (listCatalog(db).find((product: any) => product.productId === selected.productId) as any)?.playerFields ?? [];
      saveSession(db, {
        whatsappJid: jid,
        state: "awaiting_player",
        packageId: selected.packageId,
        playerData: {},
        orderId: null,
      });
      await sendMessage(jid, `Elegiste ${selected.productName} — ${selected.packageName}.\nEnvía ${fields.map((field: any) => field.label).join(" y ")}. Puedes usar "campo: valor".`);
      return;
    }

    if (session.state === "awaiting_player" && session.packageId) {
      const item: any = findPackage(db, session.packageId);
      if (!item) {
        saveSession(db, { whatsappJid: jid, state: "idle", packageId: null, playerData: {}, orderId: null });
        await sendMessage(jid, "Ese paquete ya no está disponible. Escribe CATÁLOGO para actualizar.");
        return;
      }
      const fields = db.prepare(`
        SELECT field_key AS key, label FROM player_fields WHERE product_id = ? AND required = 1
      `).all(item.productLocalId) as Array<{ key: string; label: string }>;
      const playerData = parsePlayerData(text, fields);
      const missing = fields.filter((field) => !String(playerData[field.key] ?? "").trim());
      if (missing.length) {
        await sendMessage(jid, `Falta: ${missing.map((field) => field.label).join(", ")}. Ejemplo: ${missing[0].key}: 123`);
        return;
      }
      try {
        const order = createLocalOrder(db, {
          whatsappJid: jid,
          phoneDisplay: jid.split("@")[0],
          packageId: session.packageId,
          playerData,
        });
        saveSession(db, { ...session, state: "awaiting_receipt", playerData, orderId: order.id });
        await sendMessage(
          jid,
          `Pedido creado. Total: Bs ${order.sale_price_bs_total}\n\n${paymentDestinationMessage(db)}\n\nEnvía el comprobante como imagen o texto. Gemini solo leerá sus datos; Pabilo confirmará el pago.`,
        );
      } catch (error) {
        await sendMessage(jid, error instanceof Error ? error.message : "No se pudo crear el pedido.");
      }
      return;
    }

    await sendMessage(jid, "Escribe CATÁLOGO para ver los paquetes disponibles o AYUDA para comenzar.");
  }

  async function connect(): Promise<void> {
    if (stopping || socket) return;
    connection = "connecting";
    const { state, saveCreds } = await useMultiFileAuthState(env.WHATSAPP_AUTH_DIR);
    const nextSocket = makeWASocket({
      auth: state,
      browser: Browsers.macOS("Chrome"),
      logger,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
    });
    socket = nextSocket;
    nextSocket.ev.on("creds.update", saveCreds);
    nextSocket.ev.on("connection.update", async ({ connection: nextConnection, lastDisconnect, qr }) => {
      if (qr) {
        void QRCodeImage.toDataURL(qr, { margin: 2, width: 320 })
          .then((dataUrl) => {
            qrDataUrl = dataUrl;
            qrExpiresAt = new Date(Date.now() + 60_000).toISOString();
            if (qrTimer) clearTimeout(qrTimer);
            qrTimer = setTimeout(() => {
              qrDataUrl = null;
              qrExpiresAt = null;
              qrTimer = null;
            }, 60_000);
          })
          .catch((error) => logger.warn({ error }, "Could not render WhatsApp QR"));
      }
      if (nextConnection === "open") {
        connection = "open";
        pairingCode = null;
        qrDataUrl = null;
        qrExpiresAt = null;
        if (qrTimer) clearTimeout(qrTimer);
        qrTimer = null;
        if (pairingTimer) clearTimeout(pairingTimer);
        pairingTimer = null;
        logger.info("WhatsApp connection opened");
      }
      if (nextConnection === "close") {
        connection = "closed";
        if (socket === nextSocket) socket = null;
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        if (!stopping && statusCode !== DisconnectReason.loggedOut) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            void connect().catch((error) => logger.error({ error }, "WhatsApp reconnect failed"));
          }, env.WHATSAPP_RECONNECT_DELAY_MS);
        } else if (statusCode === DisconnectReason.loggedOut) {
          if (pairingTimer) clearTimeout(pairingTimer);
          pairingTimer = null;
          pairingCode = null;
          qrDataUrl = null;
          qrExpiresAt = null;
          if (qrTimer) clearTimeout(qrTimer);
          qrTimer = null;
          try {
            await rm(env.WHATSAPP_AUTH_DIR, { recursive: true, force: true });
            logger.warn({ statusCode }, "WhatsApp session invalid; auth directory cleared, requesting a new pairing code");
          } catch (error) {
            logger.error({ error, statusCode }, "Could not clear invalid WhatsApp session");
          }
          if (!stopping) {
            reconnectTimer = setTimeout(() => {
              reconnectTimer = null;
              void connect().catch((error) => logger.error({ error }, "WhatsApp reconnect after logout failed"));
            }, 1000);
          }
        }
      }
    });
    if (!state.creds.registered) {
      pairingTimer = setTimeout(() => {
        pairingTimer = null;
        void requestPairingCode(env.WHATSAPP_PAIRING_PHONE).catch((error) => {
          logger.error({ error }, "WhatsApp pairing code request failed");
        });
      }, 5000);
    }
    nextSocket.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;
      for (const message of messages) {
        void processIncomingMessage(message).catch((error) => logger.error({ error }, "WhatsApp message processing failed"));
      }
    });
  }

  return {
    enabled: env.WHATSAPP_MODE === "live",
    start: async () => {
      if (env.WHATSAPP_MODE !== "live" || socket) return;
      stopping = false;
      await connect();
    },
    stop: async () => {
      stopping = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (pairingTimer) clearTimeout(pairingTimer);
      pairingTimer = null;
      if (qrTimer) clearTimeout(qrTimer);
      qrTimer = null;
      pairingCode = null;
      qrDataUrl = null;
      qrExpiresAt = null;
      socket?.end(undefined);
      socket = null;
      connection = "closed";
    },
    sendMessage,
    requestPairingCode,
    status: () => ({ enabled: env.WHATSAPP_MODE === "live", connection, pairingCode, pairingPhone: env.WHATSAPP_PAIRING_PHONE, qrDataUrl, qrExpiresAt }),
  };
}