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
import { submitPayment, submitReceipt } from "./modules/payments/payment.service.js";
import { createVeniumClient } from "./modules/venium/venium.client.js";
import { createPabiloClient } from "./modules/pabilo/pabilo.client.js";
import { processVeniumWebhook, verifyVeniumSignature, isFreshWebhook } from "./modules/webhooks/webhook.service.js";
import { createWhatsAppAdapter } from "./modules/whatsapp/whatsapp.adapter.js";
import { createReceiptAnalyzer } from "./modules/gemini/gemini.adapter.js";
import {
  getModerationSettings,
  listBlockedUsers,
  moderateMessage,
  unblockUser,
  updateModerationSettings,
} from "./modules/moderation/moderation.service.js";

const db = createDatabase(env.DATABASE_PATH);
migrate(db);
const venium = createVeniumClient();
const pabilo = createPabiloClient();
const whatsapp = createWhatsAppAdapter(db);
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

const pairingCodeSchema = z.object({
  phoneNumber: z.string().trim().regex(/^\+?[0-9\s().-]{8,20}$/),
});

export function buildApp() {
  const app = Fastify({ logger: true, bodyLimit: 2_000_000 });

  // Keep the exact JSON bytes available for Venium HMAC verification.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    done(null, body);
  });

  app.register(cookie);
  app.register(helmet);
  app.register(fastifyStatic, { root: `${process.cwd()}/public`, prefix: "/" });
  app.addHook("onClose", async () => whatsapp.stop());

  app.get("/", async (_request, reply) => reply.redirect("/admin"));
  app.get("/admin", async (_request, reply) => reply.sendFile("admin.html"));

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

    admin.post("/api/admin/whatsapp/pairing-code", async (request, reply) => {
      try {
        const { phoneNumber } = pairingCodeSchema.parse(parseBody(request.body));
        if (env.WHATSAPP_MODE !== "live") return reply.code(409).send({ error: "WHATSAPP_MODE debe estar en live" });
        await whatsapp.start();
        const code = await whatsapp.requestPairingCode(phoneNumber);
        return reply.send({ code, message: "En WhatsApp abre Dispositivos vinculados > Vincular con número de teléfono e introduce este código." });
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : "pairing code request failed" });
      }
    });

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
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}