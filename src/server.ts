import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { env, providerStatus } from "./config/env.js";
import { createDatabase, migrate } from "./db/connection.js";
import { listCatalog, syncCatalog } from "./modules/catalog/catalog.service.js";
import { getSettings, updateSettings } from "./modules/admin/settings.service.js";
import { createLocalOrder, getOrder, listOrders, toPublicOrder } from "./modules/orders/order.service.js";
import { retryVeniumOrder, submitPayment, submitReceipt } from "./modules/payments/payment.service.js";
import { createVeniumClient } from "./modules/venium/venium.client.js";
import { createPabiloClient } from "./modules/pabilo/pabilo.client.js";
import { processVeniumWebhook, verifyVeniumSignature, isFreshWebhook } from "./modules/webhooks/webhook.service.js";
import { createWhatsAppAdapter, type WhatsAppAdapter } from "./modules/whatsapp/whatsapp.adapter.js";
import { createCloudAdapter, verifyMetaSignature } from "./modules/whatsapp/whatsapp.cloud.adapter.js";
import { createReceiptAnalyzer } from "./modules/gemini/gemini.adapter.js";
import {
  getModerationSettings,
  listBlockedUsers,
  moderateMessage,
  setAdminBlocked,
  unblockUser,
  updateModerationSettings,
} from "./modules/moderation/moderation.service.js";
import {
  publishEvent,
  recentEvents,
  subscribeEvents,
  type VexEvent,
} from "./modules/events/event-bus.js";
import {
  deleteSubscription,
  deliverEventToAll,
  pushConfigured,
  saveSubscription,
  vapidPublicKey,
} from "./modules/events/push.service.js";
import { getDashboardCore, listCustomers } from "./modules/analytics/analytics.service.js";
import {
  listThreads,
  listThreadMessages,
  markThreadRead,
  countUnread,
  countHandoffThreads,
  setHandoff,
} from "./modules/chats/chat.service.js";

const db = createDatabase(env.DATABASE_PATH);
migrate(db);
const venium = createVeniumClient();
const pabilo = createPabiloClient();
// Transport selection: "cloud" = official Meta Cloud API (no browser/QR);
// "web" (default) = classic whatsapp-web.js adapter.
const useCloud = env.WHATSAPP_PROVIDER === "cloud";
const cloudAdapter = useCloud ? createCloudAdapter(db) : null;
const whatsapp = cloudAdapter ?? createWhatsAppAdapter(db);
const receiptAnalyzer = createReceiptAnalyzer();

function parseBody(value: unknown): any {
  if (typeof value !== "string") return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("invalid JSON body");
  }
}

function basicAuth(request: FastifyRequest, reply: FastifyReply): void {
  const authorization = request.headers.authorization;
  const expectedCredentials = `${env.ADMIN_USERNAME}:${env.ADMIN_PASSWORD}`;
  const expected = `Basic ${Buffer.from(expectedCredentials).toString("base64")}`;
  if (!env.ADMIN_PASSWORD || authorization !== expected) {
    reply
      .code(401)
      .header("WWW-Authenticate", 'Basic realm="admin"')
      .send({ error: "admin authentication required" });
  }
}

const createOrderSchema = z.object({
  whatsappJid: z.string().min(1).max(200),
  phoneDisplay: z.string().max(50).optional(),
  customerName: z.string().max(120).optional(),
  packageId: z.string().min(1).max(200),
  playerData: z.record(z.string().max(200)),
  quantity: z.number().int().min(1).max(99).optional(),
});

const paymentSchema = z.object({
  reference: z.string().min(1).max(100),
  amountBs: z.string().regex(/^\d+(\.\d{1,2})?$/),
  receiptHash: z.string().min(1).max(256),
  paymentDate: z.string().optional(),
  bank: z.string().max(120).optional(),
  recipientData: z.record(z.string().max(200)).optional(),
});

const moderationSchema = z.object({
  whatsappJid: z.string().min(1).max(200),
  message: z.string().max(10000),
  classification: z.enum(["normal", "competitor", "abuse", "harassment", "insult"]).optional(),
});

export function buildApp() {
  // Behind Railway/Northflank/Cloudflare proxies the client IP arrives in
  // X-Forwarded-For; trusting it keeps rate limiting and logs accurate.
  const app = Fastify({ logger: true, bodyLimit: 2_000_000, trustProxy: true });

  // Keep the exact JSON bytes available for Venium HMAC verification.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    done(null, body);
  });

  app.register(cookie);
  app.register(helmet);
  app.register(fastifyStatic, { root: `${process.cwd()}/public`, prefix: "/" });
  app.addHook("onClose", async () => whatsapp.stop());

  // Every bus event also becomes a web-push notification to registered
  // devices (phones ring even with the panel closed).
  subscribeEvents((event: VexEvent) => {
    void deliverEventToAll(db, event).catch(() => {});
  });

  app.get("/", async (_request, reply) => reply.redirect("/admin"));
  app.get("/admin", async (_request, reply) => reply.sendFile("admin.html"));

  // PWA manifest for the installable admin app.
  app.get("/manifest.webmanifest", async (_request, reply) => {
    reply.header("content-type", "application/manifest+json");
    return {
      name: "Vex Store CRM",
      short_name: "Vex CRM",
      description: "Panel de control del bot de ventas Vex Store",
      start_url: "/admin",
      scope: "/",
      display: "standalone",
      orientation: "portrait",
      background_color: "#0b1020",
      theme_color: "#0b1020",
      lang: "es",
      icons: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    };
  });

  // Privacy policy page required by Meta app review / publish flow.
  app.get("/privacy", async (_request, reply) => {
    reply.header("content-type", "text/html; charset=utf-8");
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Política de Privacidad · Legacy Store</title><style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.6;color:#1f2937}h1{font-size:1.5rem}</style></head><body><h1>Política de Privacidad — Legacy Store</h1><p><b>Última actualización:</b> 24 de septiembre de 2026</p><p>Legacy Store opera un bot de ventas por WhatsApp para recargas de juegos. Al interactuar con nuestro número de WhatsApp, tratamos los siguientes datos:</p><ul><li><b>Número de teléfono</b> de WhatsApp, para identificar tu conversación y entregarte el pedido.</li><li><b>Mensajes que nos envías</b> (texto y comprobantes de pago), para procesar tu compra.</li><li><b>Datos de tu pedido</b> (juego, paquete, ID de jugador), para ejecutar la recarga a través de nuestro proveedor.</li></ul><p><b>Uso de los datos:</b> únicamente para atender tu solicitud, procesar pagos mediante nuestros proveedores (Venium, Pabilo) y darte soporte. No vendemos ni compartimos tu información con terceros fuera de los proveedores necesarios para completar tu pedido.</p><p><b>Conservación:</b> los registros de pedidos se conservan para fines contables y de soporte. Puedes solicitar la eliminación de tus datos escribiendo a este mismo número de WhatsApp.</p><p><b>Contacto:</b> Legacy Store, Venezuela. WhatsApp: +58 422 289 6623.</p></body></html>`;
  });

  // Realtime CRM feed (SSE). Every bot/customer event streams here; the panel
  // plays a sound and (if installed as PWA) wakes the phone with a push.
  app.get("/api/admin/stream", async (request, reply) => {
    basicAuth(request, reply);
    if (reply.sent) return reply;
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    reply.raw.write(`event: hello\ndata: {"ok":true}\n\n`);
    for (const event of recentEvents(20).reverse()) reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    const unsubscribe = subscribeEvents((event: VexEvent) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        // Connection gone: unsubscribe below.
      }
    });
    const keepAlive = setInterval(() => {
      try {
        reply.raw.write(`: ping\n\n`);
      } catch {
        // Connection gone.
      }
    }, 25_000);
    request.raw.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
    // Hijacked response: keep Fastify from writing anything else.
    return reply;
  });

  app.get("/health", async () => ({
    ok: true,
    modes: {
      venium: providerStatus(env.VENIUM_MODE, env.VENIUM_API_KEY),
      pabilo: providerStatus(env.PABILO_MODE, env.PABILO_API_KEY),
      gemini: providerStatus(env.GEMINI_MODE, env.GEMINI_API_KEY),
      whatsapp: env.WHATSAPP_MODE,
    },
  }));

  app.get("/api/catalog", async () => listCatalog(db));

  app.post("/api/orders", async (request, reply) => {
    try {
      const input = createOrderSchema.parse(parseBody(request.body));
      return reply.code(201).send(toPublicOrder(createLocalOrder(db, input)));
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "invalid order" });
    }
  });

  app.get<{ Params: { id: string } }>("/api/orders/:id", async (request, reply) => {
    const order = getOrder(db, request.params.id);
    if (!order) return reply.code(404).send({ error: "order not found" });
    return toPublicOrder(order);
  });

  // This endpoint receives already extracted fields. The production WhatsApp
  // adapter will call Gemini before this service, but the decision stays here.
  app.post<{ Params: { id: string } }>("/api/orders/:id/payment", async (request, reply) => {
    try {
      const input = paymentSchema.parse(parseBody(request.body));
      const result = await submitPayment(db, request.params.id, input);
      return reply.send({ ...result, order: toPublicOrder(result.order) });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "payment rejected" });
    }
  });

  // Receipt seam for the future WhatsApp/Gemini adapter. With Gemini disabled
  // it deliberately stops without calling Pabilo or Venium.
  app.post<{ Params: { id: string } }>("/api/orders/:id/payment-receipt", async (request, reply) => {
    try {
      const body = parseBody(request.body);
      if (typeof body.text !== "string" && typeof body.imageBase64 !== "string") {
        return reply.code(400).send({ error: "text or imageBase64 is required" });
      }
      const result = await submitReceipt(db, request.params.id, body);
      return reply.send({ ...result, order: toPublicOrder(result.order) });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "receipt rejected" });
    }
  });

  // Conversation adapters call this before generating a reply or accepting
  // more input. It is deterministic and does not block competitor mentions.
  app.post("/api/moderation/check", async (request, reply) => {
    try {
      const input = moderationSchema.parse(parseBody(request.body));
      return reply.send(moderateMessage(db, input));
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "moderation check failed" });
    }
  });

  // Meta webhook verification handshake (GET) + inbound events (POST).
  app.get("/webhooks/whatsapp", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const mode = String(query["hub.mode"] ?? "");
    const token = String(query["hub.verify_token"] ?? "");
    const challenge = String(query["hub.challenge"] ?? "");
    if (mode === "subscribe" && token && token === env.WHATSAPP_CLOUD_VERIFY_TOKEN) {
      return reply.code(200).header("content-type", "text/plain").send(challenge);
    }
    return reply.code(403).send("verification failed");
  });

  app.post("/webhooks/whatsapp", async (request, reply) => {
    if (!cloudAdapter) return reply.code(503).send({ error: "cloud provider disabled (WHATSAPP_PROVIDER=web)" });
    const rawBody = typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {});
    // Signature is verified in live mode; in mock/dev we accept events so the
    // flow can be exercised without Meta credentials.
    if (env.WHATSAPP_MODE === "live" && !verifyMetaSignature(rawBody, Array.isArray(request.headers["x-hub-signature-256"]) ? request.headers["x-hub-signature-256"][0] : request.headers["x-hub-signature-256"])) {
      return reply.code(401).send({ error: "invalid Meta signature" });
    }
    const result = cloudAdapter.handleWebhookEvent(rawBody);
    // Meta requires a fast 200; processing already continues in background.
    return reply.code(200).send({ ok: true, ...result });
  });

  app.post("/webhooks/venium", async (request, reply) => {
    const rawBody = typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {});
    const signature = String(request.headers["x-webhook-signature"] ?? "");
    const timestamp = String(request.headers["x-webhook-timestamp"] ?? "");
    const eventHeader = request.headers["x-webhook-event"]?.toString();

    if (!env.VENIUM_WEBHOOK_SECRET) {
      return reply.code(503).send({ error: "VENIUM_WEBHOOK_SECRET is not configured" });
    }
    if (!isFreshWebhook(timestamp)) {
      return reply.code(401).send({ error: "stale or invalid webhook timestamp" });
    }
    if (!verifyVeniumSignature(rawBody, signature)) {
      return reply.code(401).send({ error: "invalid webhook signature" });
    }
    try {
      return reply.code(200).send(processVeniumWebhook(db, rawBody, signature, timestamp, eventHeader));
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "invalid webhook" });
    }
  });

  app.register(async (admin) => {
    admin.addHook("preHandler", async (request, reply) => basicAuth(request, reply));

    admin.get("/api/admin/status", async () => ({
      providers: {
        venium: providerStatus(env.VENIUM_MODE, env.VENIUM_API_KEY),
        pabilo: providerStatus(env.PABILO_MODE, env.PABILO_API_KEY),
        gemini: providerStatus(env.GEMINI_MODE, env.GEMINI_API_KEY),
         whatsapp: whatsapp.status(),
      },
      pabilo: {
        baseUrl: env.PABILO_BASE_URL,
        apiKeyConfigured: Boolean(env.PABILO_API_KEY),
        userBankIdConfigured: Boolean(getSettings(db).pabiloUserBankId || env.PABILO_USER_BANK_ID),
        endpoint: "/userbankpayment/{userBankId}/betaserio",
      },
      safety: {
        liveVeniumOrderCreation: env.ALLOW_LIVE_ORDER_CREATION,
        geminiCanExecuteActions: false,
      },
    }));

    admin.get("/api/admin/settings", async () => getSettings(db));

    admin.put("/api/admin/settings", async (request, reply) => {
      try {
        const updated = updateSettings(db, parseBody(request.body), env.ADMIN_USERNAME);
        return reply.send(updated);
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : "invalid settings" });
      }
    });

    admin.get("/api/admin/moderation/settings", async () => getModerationSettings(db));

    admin.put("/api/admin/moderation/settings", async (request, reply) => {
      try {
        return reply.send(updateModerationSettings(db, parseBody(request.body)));
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : "invalid moderation settings" });
      }
    });

    admin.get("/api/admin/moderation/blocked", async () => listBlockedUsers(db));

    // CRM: manual block/unblock with note, from the panel.
    admin.post<{ Params: { jid: string } }>("/api/admin/customers/:jid/block", async (request) => {
      const body = parseBody(request.body) as { note?: unknown };
      const note = typeof body.note === "string" ? body.note.slice(0, 300) : "";
      setAdminBlocked(db, request.params.jid, true, note);
      publishEvent({ type: "user_blocked", jid: request.params.jid, phone: request.params.jid.split("@")[0], preview: note || "Bloqueado desde el panel" });
      return { blocked: true };
    });

    admin.post<{ Params: { jid: string } }>("/api/admin/customers/:jid/unblock", async (request) => {
      setAdminBlocked(db, request.params.jid, false, "");
      publishEvent({ type: "user_unblocked", jid: request.params.jid, phone: request.params.jid.split("@")[0], preview: "Desbloqueado desde el panel" });
      return { blocked: false };
    });

    // Web Push: key exchange + subscription persistence + test notification.
    admin.get("/api/admin/push/key", async () => ({ configured: pushConfigured(), publicKey: vapidPublicKey() }));

    admin.post("/api/admin/push/subscribe", async (request, reply) => {
      if (!pushConfigured()) return reply.code(503).send({ error: "Push no configurado (falta VAPID en el servidor)" });
      try {
        const body = parseBody(request.body) as any;
        const endpoint = String(body?.endpoint ?? "");
        const p256dh = String(body?.keys?.p256dh ?? "");
        const auth = String(body?.keys?.auth ?? "");
        if (!endpoint || !p256dh || !auth) return reply.code(400).send({ error: "suscripción inválida" });
        saveSubscription(db, { endpoint, keys: { p256dh, auth } });
        return reply.send({ saved: true });
      } catch {
        return reply.code(400).send({ error: "suscripción inválida" });
      }
    });

    admin.post("/api/admin/push/unsubscribe", async (request) => {
      const body = parseBody(request.body) as { endpoint?: unknown };
      if (typeof body.endpoint === "string") deleteSubscription(db, body.endpoint);
      return { removed: true };
    });

    admin.post("/api/admin/push/test", async (request, reply) => {
      if (!pushConfigured()) return reply.code(503).send({ error: "Push no configurado (falta VAPID en el servidor)" });
      // Direct event object (NOT publishEvent) so the bus→push forwarder
      // below does not double-send this in a loop.
      const delivered = await deliverEventToAll(db, { type: "message_in", jid: "test@vex.store", phone: "Prueba", preview: "🔔 Si ves esto, las notificaciones funcionan 🎉", at: new Date().toISOString() });
      return reply.send({ delivered });
    });

    admin.get("/api/admin/events", async () => ({ events: recentEvents(50) }));

    admin.post<{ Params: { whatsappJid: string } }>(
      "/api/admin/moderation/:whatsappJid/unblock",
      async (request, reply) => {
        unblockUser(db, request.params.whatsappJid);
        return reply.send({ unblocked: true, whatsappJid: request.params.whatsappJid });
      },
    );

    admin.get("/api/admin/moderation/events", async () =>
      db.prepare(`
        SELECT whatsapp_jid AS whatsappJid, reason, action,
               classification, created_at AS createdAt
        FROM moderation_events ORDER BY created_at DESC LIMIT 200
      `).all(),
    );

    // Live chat inbox: conversations, thread messages, human replies.
    admin.get("/api/admin/chats", async () => ({
      threads: listThreads(db),
      unread: countUnread(db),
      handoff: countHandoffThreads(db),
    }));

    admin.get<{ Params: { jid: string }; Querystring: { after?: string } }>(
      "/api/admin/chats/:jid/messages",
      async (request) => {
        const after = Number((request.query as any)?.after ?? 0);
        markThreadRead(db, request.params.jid);
        return {
          messages: listThreadMessages(db, request.params.jid, Number.isFinite(after) ? after : 0),
          handoff: Boolean((db.prepare("SELECT handoff FROM whatsapp_sessions WHERE whatsapp_jid = ?").get(request.params.jid) as any)?.handoff),
        };
      },
    );

    admin.post<{ Params: { jid: string } }>(
      "/api/admin/chats/:jid/reply",
      async (request, reply) => {
        const body = parseBody(request.body) as { text?: unknown };
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text) return reply.code(400).send({ error: "text is required" });
        if (!whatsapp.isReady()) return reply.code(503).send({ error: "WhatsApp is not connected" });
        try {
          await whatsapp.sendHumanReply(request.params.jid, text);
          return reply.send({ sent: true });
        } catch (error) {
          return reply.code(502).send({ error: error instanceof Error ? error.message : "could not send" });
        }
      },
    );

    admin.post<{ Params: { jid: string } }>(
      "/api/admin/chats/:jid/handoff",
      async (request) => {
        setHandoff(db, request.params.jid, true, "Tomado por soporte humano desde el panel");
        return { handoff: true };
      },
    );

    admin.post<{ Params: { jid: string } }>(
      "/api/admin/chats/:jid/resume",
      async (request) => {
        setHandoff(db, request.params.jid, false);
        return { handoff: false };
      },
    );

    // Switch WhatsApp pairing method (8-digit code <-> QR) from the panel.
    admin.post("/api/admin/whatsapp/pairing-mode", async (request, reply) => {
      const body = parseBody(request.body) as { mode?: unknown };
      if (body.mode !== "phone" && body.mode !== "qr") {
        return reply.code(400).send({ error: "mode must be phone or qr" });
      }
      await whatsapp.setPairingMode(body.mode);
      return reply.send({ pairingMode: body.mode });
    });

    // Generate a fresh 8-digit pairing code right now (codes expire ~1 min).
    admin.post("/api/admin/whatsapp/refresh-pairing", async (_request, reply) => {
      try {
        await whatsapp.refreshPairingCode();
        return reply.send({ refreshing: true });
      } catch (error) {
        return reply.code(502).send({ error: error instanceof Error ? error.message : "could not refresh pairing code" });
      }
    });

    // Wipe the saved WhatsApp session and start a completely fresh pairing
    // (use this when WhatsApp rejects the code/QR repeatedly).
    admin.post("/api/admin/whatsapp/reset-session", async (_request, reply) => {
      try {
        await whatsapp.resetSession();
        return reply.send({ reset: true });
      } catch (error) {
        return reply.code(502).send({ error: error instanceof Error ? error.message : "could not reset the session" });
      }
    });

    admin.get("/api/admin/payment-security-events", async () =>
      db.prepare(`
        SELECT id, order_id AS orderId, reference, amount_bs AS amountBs,
               payment_date AS paymentDate, bank, recipient_data_json AS recipientData,
               customer_whatsapp_jid AS whatsappJid, receipt_hash AS receiptHash,
               reason, status, created_at AS createdAt
        FROM payment_security_events ORDER BY created_at DESC LIMIT 200
      `).all(),
    );

    admin.get("/api/admin/catalog", async () => listCatalog(db));

    admin.post("/api/admin/catalog/sync", async (_request, reply) => {
      try {
        const catalog = await venium.getCatalog();
        syncCatalog(db, catalog);
        return reply.send({ synced: catalog.length, catalog: listCatalog(db) });
      } catch (error) {
        return reply.code(502).send({ error: error instanceof Error ? error.message : "catalog sync failed" });
      }
    });

    admin.get("/api/admin/balance", async (_request, reply) => {
      try {
        return reply.send(await venium.getBalance());
      } catch (error) {
        return reply.code(502).send({ error: error instanceof Error ? error.message : "balance request failed" });
      }
    });

    admin.get("/api/admin/orders", async () => listOrders(db));

    // Admin panel: a payment that was verified but parked because the Venium
    // wallet had no balance can be re-sent once the balance is topped up.
    admin.post<{ Params: { id: string } }>("/api/admin/orders/:id/retry-venium", async (request, reply) => {
      const result = await retryVeniumOrder(db, request.params.id);
      if (!result.ok) return reply.code(400).send({ error: result.error, stillQueued: true });
      const order: any = getOrder(db, request.params.id);
      publishEvent({
        type: "payment_verified",
        jid: order?.whatsappJid ?? "",
        phone: String(order?.whatsappJid ?? "").split("@")[0],
        preview: `Reintento Venium OK · pedido ${request.params.id.slice(0, 8)}`,
      });
      return { retried: true, veniumOrderId: result.veniumOrderId, status: "venium_processing" };
    });

    admin.get<{ Params: { id: string } }>("/api/admin/orders/:id", async (request, reply) => {
      const order = getOrder(db, request.params.id);
      if (!order) return reply.code(404).send({ error: "order not found" });
      const history = db.prepare(`
        SELECT from_status AS fromStatus, to_status AS toStatus, source,
               metadata_json AS metadataJson, created_at AS createdAt
        FROM order_status_history WHERE order_id = ? ORDER BY created_at ASC
      `).all(request.params.id);
      const attempts = db.prepare(`
        SELECT reference, amount_bs AS amountBs, payment_date AS paymentDate, bank,
               recipient_data_json AS recipientData, receipt_hash AS receiptHash,
               antifraud_status AS antifraudStatus, antifraud_reason AS antifraudReason,
               gemini_status AS geminiStatus, pabilo_status AS pabiloStatus,
               pabilo_is_new AS pabiloIsNew, venium_order_id AS veniumOrderId,
               created_at AS createdAt
        FROM payment_attempts WHERE order_id = ? ORDER BY created_at ASC
      `).all(request.params.id);
      return { order: toPublicOrder(order), history, attempts };
    });

    admin.get("/api/admin/dashboard", async () => ({
      ...getDashboardCore(db),
      whatsappStatus: whatsapp.status(),
      providers: {
        venium: providerStatus(env.VENIUM_MODE, env.VENIUM_API_KEY),
        pabilo: providerStatus(env.PABILO_MODE, env.PABILO_API_KEY),
        gemini: providerStatus(env.GEMINI_MODE, env.GEMINI_API_KEY),
        whatsapp: env.WHATSAPP_MODE,
      },
      safety: {
        liveVeniumOrderCreation: env.ALLOW_LIVE_ORDER_CREATION,
        geminiCanExecuteActions: false,
      },
    }));

    admin.get<{ Querystring: { search?: string } }>("/api/admin/customers", async (request) => {
      const query = (request.query ?? {}) as { search?: string };
      return listCustomers(db, query.search ?? "");
    });

    admin.get("/api/admin/export/orders.csv", async (_request, reply) => {
      const rows = db.prepare(`
        SELECT o.id, o.status, o.payment_status AS paymentStatus,
               o.sale_price_bs_total AS salePriceBsTotal, o.cost_usd_total AS costUsdTotal,
               o.payment_reference AS paymentReference, o.venium_order_id AS veniumOrderId,
               c.whatsapp_jid AS whatsappJid, p.name AS productName, pk.name AS packageName,
               o.created_at AS createdAt, o.updated_at AS updatedAt
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        JOIN products p ON p.id = o.product_id
        JOIN packages pk ON pk.id = o.package_id
        ORDER BY o.created_at DESC LIMIT 5000
      `).all() as any[];
      const headers = [
        "id", "status", "paymentStatus", "salePriceBsTotal", "costUsdTotal",
        "paymentReference", "veniumOrderId", "whatsappJid", "productName",
        "packageName", "createdAt", "updatedAt",
      ];
      const escape = (value: unknown): string => {
        const text = String(value ?? "");
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      };
      const csv = [
        headers.join(","),
        ...rows.map((row) => headers.map((header) => escape(row[header])).join(",")),
      ].join("\n");
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="venium-orders-${new Date().toISOString().slice(0, 10)}.csv"`)
        .send(csv);
    });

    admin.get("/api/admin/venium/orders", async (request, reply) => {
      try {
        const query = request.query as Record<string, unknown>;
        const allowed = ["id", "orderId", "status", "limit", "page"];
        const filters = Object.fromEntries(
          allowed
            .filter((key) => query[key] !== undefined)
            .map((key) => [key, String(query[key])]),
        );
        return reply.send(await venium.getOrders(filters));
      } catch (error) {
        return reply.code(502).send({ error: error instanceof Error ? error.message : "Venium orders request failed" });
      }
    });

    admin.get("/api/admin/pabilo/banks", async (_request, reply) => {
      try {
        return reply.send(await pabilo.listUserBanks());
      } catch (error) {
        return reply.code(502).send({ error: error instanceof Error ? error.message : "Pabilo banks request failed" });
      }
    });

    admin.get("/api/admin/webhook-events", async () =>
      db.prepare(`
        SELECT event_type AS eventType, venium_order_id AS veniumOrderId,
               processing_status AS processingStatus, error_message AS errorMessage,
               created_at AS createdAt, processed_at AS processedAt
        FROM webhook_events ORDER BY created_at DESC LIMIT 100
      `).all(),
    );
  });

  return app;
}

if (process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) {
  const app = buildApp();
  try {
    try {
      syncCatalog(db, await venium.getCatalog());
    } catch (error) {
      app.log.warn({ error }, "Initial Venium catalog sync failed; use the admin sync route when available");
    }
    await app.listen({ host: env.HOST, port: env.PORT });
    if (env.WHATSAPP_MODE === "live") await whatsapp.start();

    // Railway redeploys send SIGTERM. Closing gracefully lets in-flight
    // payments finish and disconnects WhatsApp cleanly before exit.
    const shutdown = async (signal: string): Promise<void> => {
      app.log.info({ signal }, "shutting down gracefully");
      try {
        await app.close();
        process.exit(0);
      } catch (error) {
        app.log.error(error);
        process.exit(1);
      }
    };
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
    process.once("SIGINT", () => void shutdown("SIGINT"));
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}