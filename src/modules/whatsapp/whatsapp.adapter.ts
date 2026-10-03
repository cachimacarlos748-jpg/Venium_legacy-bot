import whatsappWeb from "whatsapp-web.js";
import type { Message } from "whatsapp-web.js";

const { Client, LocalAuth, MessageMedia } = whatsappWeb;
import Database from "better-sqlite3";
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";
import QRCodeImage from "qrcode";
import { env } from "../../config/env.js";
import { createHealthProbe } from "./health-probe.js";
import { createBotCore, type BotCore, type CoreIncoming } from "./bot-core.js";

const logger = pino({ level: process.env.NODE_ENV === "production" ? "info" : "warn" });

export interface WhatsAppAdapter {
  enabled: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  setPairingMode(mode: "phone" | "qr"): Promise<void>;
  refreshPairingCode(): Promise<void>;
  resetSession(): Promise<void>;
  sendMessage(jid: string, text: string): Promise<void>;
  sendHumanReply(jid: string, text: string): Promise<void>;
  sendImage?(jid: string, base64: string, mimetype: string, caption?: string): Promise<void>;
  isReady(): boolean;
  status(): {
    enabled: boolean;
    connection: "closed" | "connecting" | "pairing" | "open";
    pairingMode: "phone" | "qr";
    pairingCode: string | null;
    pairingCodeUpdatedAt: string | null;
    pairingPhone: string;
    qrDataUrl: string | null;
    qrExpiresAt: string | null;
  };
  // The sales brain. Exposed so the server can send customer notices
  // (\"tu recarga está lista\") through the exact same transport.
  core: BotCore;
}

// When the WhatsApp profile persists on a volume, Chromium leaves Singleton*
// lock files referencing the previous container's hostname. The next boot
// refuses to launch (\"profile appears to be in use by another Chromium
// process on another computer\"). Removing the stale locks is safe: they only
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

// WhatsApp now hides phone numbers behind \"@lid\" addresses for some chats.
// The bot keys sessions on the real phone-number jid when it can resolve it:
// sending TO a @lid fails, and the CRM reads much better with real numbers.
async function resolveSendJid(message: Message): Promise<string | undefined> {
  const from = message.from ?? "";
  if (!from.endsWith("@lid")) return undefined;
  try {
    const contact = await message.getContact();
    const number = String(contact?.number ?? "").replace(/\D/g, "");
    if (number.length >= 10) return `${number}@c.us`;
  } catch {
    // The number is hidden by WhatsApp; the bot keeps the @lid session but
    // still answers (bot-core rewrites the outgoing address).
  }
  return undefined;
}

export function createWhatsAppAdapter(db: Database.Database): WhatsAppAdapter {
  const healthProbe = createHealthProbe();
  let socket: InstanceType<typeof Client> | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let stopping = false;
  let connection: "closed" | "connecting" | "pairing" | "open" = "closed";
  let pairingCode: string | null = null;
  let pairingCodeUpdatedAt: string | null = null;
  let qrDataUrl: string | null = null;
  let qrExpiresAt: string | null = null;
  let authSettleTimer: NodeJS.Timeout | null = null;
  let everReady = false;
  // One-shot guard: a session that USED to work but suddenly gets a QR was
  // rejected by WhatsApp (stale/corrupt credentials). Auto-wiping once per
  // boot avoids the endless \"scan QR -> sesión cerrada -> scan again\" loop.
  let autoResetDone = false;
  // Timestamp of the last successful link/auth. WhatsApp needs several quiet
  // minutes after a fresh QR scan to finish the initial chat sync; ANY browser
  // restart in that window gets the device logged out (\"Se cerró la sesión\").
  let lastLinkAt = 0;
  // Runtime pairing mode: 8-digit phone code or QR. Switchable from the admin
  // panel without touching the session volume.
  let pairingMode: "phone" | "qr" = env.WHATSAPP_PAIRING_MODE === "qr" ? "qr" : "phone";

  // JIDs the BOT wrote to in the last seconds: separates the bot's own
  // fromMe messages from the owner typing manually on the phone.
  const botSentAt = new Map<string, number>();

  // Keeps the runtime maps bounded: entries older than an hour are dropped.
  function bumpMap(map: Map<string, number>, key: string, value: number): void {
    if (map.size > 500) {
      const cutoff = Date.now() - 60 * 60_000;
      for (const [k, v] of map) if (v < cutoff) map.delete(k);
    }
    map.set(key, value);
  }

  // Single transport for every bot reply: text, or native WhatsApp buttons /
  // list when the flow offers choices. This is what makes the bot \"always use
  // buttons\" instead of expecting the customer to type commands.
  async function sendWithButtons(
    jid: string,
    text: string,
    interactive?: { buttons?: Array<{ id: string; title: string }>; list?: { buttonLabel: string; rows: Array<{ id: string; title: string; description?: string }> } },
  ): Promise<void> {
    if (!socket || connection !== "open") {
      logger.warn({ jid }, "sendWithButtons on a non-open client; scheduling recovery");
      scheduleRecovery();
      throw new Error("WhatsApp is not connected");
    }
    bumpMap(botSentAt, jid, Date.now());
    try {
      if (interactive?.buttons?.length) {
        const buttons = new whatsappWeb.Buttons(
          text,
          interactive.buttons.slice(0, 3).map((button) => ({ id: button.id, body: button.title.slice(0, 20) })),
        );
        await socket.sendMessage(jid, buttons);
        return;
      }
      if (interactive?.list?.rows?.length) {
        const list = new whatsappWeb.List(text, interactive.list.buttonLabel.slice(0, 20), [
          {
            title: "Opciones",
            rows: interactive.list.rows.slice(0, 10).map((row) => ({
              id: row.id,
              title: row.title.slice(0, 24),
              description: row.description?.slice(0, 72) ?? "",
            })),
          },
        ]);
        await socket.sendMessage(jid, list);
        return;
      }
      await socket.sendMessage(jid, text);
    } catch (error) {
      // A send failure usually means the page is wedged: relaunch the browser
      // (session is preserved) so the next customer message gets answered.
      logger.error({ err: error, jid }, "sendWithButtons failed; scheduling recovery");
      scheduleRecovery();
      throw error;
    }
  }

  const core = createBotCore(db, sendWithButtons);

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

  async function sendMessage(jid: string, text: string): Promise<void> {
    await sendWithButtons(jid, text);
  }

  async function sendHumanReply(jid: string, text: string): Promise<void> {
    await core.sendHumanReply(jid, text);
  }

  // Sends an image (proof screenshots, promos) from the admin panel.
  async function sendImage(jid: string, base64: string, mimetype: string, caption?: string): Promise<void> {
    if (!socket || connection !== "open") throw new Error("WhatsApp is not connected");
    bumpMap(botSentAt, jid, Date.now());
    const media = new MessageMedia(mimetype, base64, "imagen.jpg");
    await socket.sendMessage(jid, media, caption ? { caption } : {});
  }

  // Normalizes one inbound WhatsApp Web message into the transport-independent
  // shape bot-core understands, then hands the WHOLE conversation to it. All
  // sales logic (catalog, pricing, ID validation, receipts, antifraud,
  // Venium, handoff, moderation) lives in bot-core so both transports behave
  // identically.
  async function processIncomingMessage(message: Message): Promise<void> {
    const jid = message.from;
    if (!jid || message.fromMe || message.isStatus) return;
    if (!env.WHATSAPP_ALLOW_GROUPS && jid.endsWith("@g.us")) return;

    // A tapped quick-reply button or list row arrives as an id, not as text.
    const selected = (message as unknown as { selectedButtonId?: string; selectedRowId?: string }).selectedButtonId
      ?? (message as unknown as { selectedRowId?: string }).selectedRowId
      ?? "";
    const text = selected || message.body || "";
    const isImage = message.type === "image";
    const hasMedia = Boolean(message.hasMedia);
    if (!text.trim() && !isImage) return;

    const sendJid = await resolveSendJid(message);
    const incoming: CoreIncoming = {
      from: sendJid ?? jid,
      text,
      hasMedia,
      isImage,
      timestampSec: Number(message.timestamp) || Math.floor(Date.now() / 1000),
      id: message.id?._serialized ?? message.id?.id,
      sendJid,
      downloadMedia: async () => {
        const media = await message.downloadMedia();
        if (!media?.data) return null;
        return { data: media.data, mimetype: media.mimetype || "image/jpeg" };
      },
    };
    await core.processIncoming(incoming);
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
        // 30s CDP budget and wedges the client in \"connecting\" forever.
        protocolTimeout: 180_000,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions", "--no-zygote", "--disable-software-rasterizer"],
      },
    });
    socket = nextClient;
    nextClient.on("qr", (qr) => {
      if (socket === nextClient) connection = "pairing";
      healthProbe.markAlive();
      // A previously working session that gets a QR again is dead: WhatsApp
      // rejected the saved credentials. Wipe once per boot and re-arm pairing
      // automatically instead of looping \"scan -> sesión cerrada\" forever.
      if (everReady && !stopping && !autoResetDone) {
        autoResetDone = true;
        logger.warn("WhatsApp shows a QR after a previously working session; auto-resetting the rejected session");
        void resetSession();
        return;
      }
      void QRCodeImage.toDataURL(qr, { margin: 2, width: 320 })
        .then((dataUrl) => {
          qrDataUrl = dataUrl;
          qrExpiresAt = new Date(Date.now() + 60_000).toISOString();
        })
        .catch((error) => logger.warn({ error }, "Could not render WhatsApp QR"));
    });
    nextClient.on("code", (code) => {
      if (socket === nextClient) connection = "pairing";
      pairingCode = code;
      pairingCodeUpdatedAt = new Date().toISOString();
      logger.info({ pairingCode: code, pairingPhone: env.WHATSAPP_PAIRING_PHONE }, "WhatsApp pairing code generated — enter this code on the phone");
    });
    nextClient.on("ready", () => {
      connection = "open";
      everReady = true;
      lastLinkAt = Date.now();
      // bot-core drops the backlog WhatsApp replays after a downtime.
      core.markLinked();
      pairingCode = null;
      qrDataUrl = null;
      qrExpiresAt = null;
      if (authSettleTimer) { clearTimeout(authSettleTimer); authSettleTimer = null; }
      // Zombie-connection guard: from now on, verify every minute that the
      // WhatsApp Web page is really alive. If it freezes silently (the
      // \"bot no responde\" failure mode), force a browser relaunch.
      const recoverNow = () => {
        if (stopping || socket !== nextClient) return;
        // Fresh link: WhatsApp is silently syncing the initial chat state.
        // Restarting now logs the device out, so wait the full grace period.
        if (lastLinkAt && Date.now() - lastLinkAt < 20 * 60_000) {
          logger.info("Skipping recovery: session linked recently; letting the initial sync finish");
          return;
        }
        logger.warn("Recovering WhatsApp session from health watchdog");
        void shutdownClient().then(() => {
          stopping = false;
          everReady = false;
          void connectWithRetry();
        });
      };
      healthProbe.start(nextClient, recoverNow);
      // The page can CLAIM it is alive while the real WhatsApp socket is
      // dead: a sales bot that receives no events at all is dead for business
      // purposes. After 8 minutes of total silence (no messages, no heartbeats
      // from the page), relaunch unconditionally. A busy store never stays
      // silent this long; a wedged restore always is.
      healthProbe.enableInactivityWatchdog(8 * 60_000, recoverNow);
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
      // WhatsApp itself unlinked the device (rate-limit, manual removal,
      // \"Se cerró la sesión\", too many reconnects): the stored session is
      // dead. whatsapp-web.js emits LOGGED_OUT / UNPAIRED — note the
      // underscore: a plain \"logged out\" check never matched, so the bot
      // reconnected forever with dead credentials instead of re-arming.
      const text = String(reason).toLowerCase();
      if ((text.includes("logged out") || text.includes("logged_out") || text.includes("unpaired")) && !stopping) {
        everReady = false;
        logger.warn("WhatsApp unlinked the device; wiping session and re-arming pairing");
        void resetSession();
        return;
      }
      // Only schedule a reconnect when this client actually reached \"ready\".
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
      healthProbe.markAlive();
      logger.info({ from: message.from, type: message.type, body: message.body?.slice(0, 120) }, "WhatsApp message event received");
      void processIncomingMessage(message).catch((error) => logger.error({ err: error, from: message.from }, "WhatsApp message processing failed"));
    });
    // Safety net: `message_create` fires for EVERY message (including ones
    // whatsapp-web.js sometimes misses on flaky reconnects). bot-core's
    // processed-id set makes the double delivery harmless — an incoming
    // customer message is handled exactly once even if both events carry it.
    nextClient.on("message_create", (message) => {
      healthProbe.markAlive();
      if (message.fromMe) {
        // A fromMe message the bot did NOT just send means the owner is
        // typing manually from the phone: keep the bot quiet in this chat.
        // For outgoing messages the chat partner is `to` (from is the owner).
        const data = (message as unknown as { _data?: { id?: { remote?: string } } })._data;
        const chatJid = message.to || data?.id?.remote || "";
        if (chatJid && !chatJid.endsWith("@g.us") && Date.now() - (botSentAt.get(chatJid) ?? 0) > 30_000) {
          core.noteOwnerActivity(chatJid);
          logger.info({ chatJid }, "Owner sent a message manually from the phone; bot silenced for 10 minutes");
        }
        return;
      }
      logger.info({ from: message.from, type: message.type, body: message.body?.slice(0, 120) }, "WhatsApp message_create event received");
      void processIncomingMessage(message).catch((error) => logger.error({ err: error, from: message.from }, "WhatsApp message_create processing failed"));
    });
    // Any WhatsApp event counts as a pulse: QR codes, auth changes, message
    // acks... A truly healthy session produces SOME event traffic.
    nextClient.on("qr", () => healthProbe.markAlive());
    nextClient.on("code", () => healthProbe.markAlive());
    nextClient.on("authenticated", () => {
      lastLinkAt = Date.now();
      healthProbe.markAlive();
      logger.info("WhatsApp authenticated: starting initial sync (no restarts allowed during it)");
      // The phone linked but the page can hang on \"iniciando sesión\" forever.
      // One patient restart right after linking resumes the now-valid session
      // (no QR needed) instead of leaving the user stuck mid-login.
      if (authSettleTimer) clearTimeout(authSettleTimer);
      authSettleTimer = setTimeout(() => {
        authSettleTimer = null;
        if (stopping || socket !== nextClient || connection === "open") return;
        logger.warn("Authenticated but not ready after 15s; restarting browser to finish linking");
        void shutdownClient().then(() => {
          stopping = false;
          void connectWithRetry();
        });
      }, 15_000);
    });
    nextClient.on("change_state", () => healthProbe.markAlive());
    await nextClient.initialize();
    // With the browser up and the session still unpaired, also arm the
    // 8-digit code flow in phone mode so the code appears within seconds and
    // renews every minute (matching WhatsApp's own countdown on the phone).
    if (!everReady && pairingMode === "phone") void armPairingCode();
  }

  // Arms (or re-arms) WhatsApp's \"link with phone number\" flow. Codes renew
  // every minute — matching WhatsApp's own countdown — and each renewal fires
  // the \"code\" event, which refreshes what the admin panel shows.
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
    if (authSettleTimer) { clearTimeout(authSettleTimer); authSettleTimer = null; }
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
  // WhatsApp says \"código incorrecto\" or the session volume got corrupted.
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
    sendImage,
    isReady: () => connection === "open",
    status: () => ({ enabled: env.WHATSAPP_MODE === "live", connection, pairingMode, pairingCode, pairingCodeUpdatedAt, pairingPhone: env.WHATSAPP_PAIRING_PHONE, qrDataUrl, qrExpiresAt }),
    core,
  };
}
