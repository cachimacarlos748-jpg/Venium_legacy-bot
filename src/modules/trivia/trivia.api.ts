// Rutas REST de la Trivia Online, montadas en /api/trivia/*.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import type { VeniumClient } from "../venium/venium.client.js";
import { env } from "../../config/env.js";
import { TriviaEngine, TRIVIA_START_HOUR_VE } from "./trivia.engine.js";
import { registerPlayer, chatHistory, grantHeartForOrder } from "./trivia.service.js";
import { initTriviaTables } from "./trivia.db.js";

export { TriviaEngine, TRIVIA_START_HOUR_VE };

function triviaAdminAuth(request: FastifyRequest, reply: FastifyReply): boolean {
  const suppliedKey = request.headers["x-trivia-admin-key"];
  if (env.TRIVIA_ADMIN_KEY && suppliedKey === env.TRIVIA_ADMIN_KEY) return true;
  const expected = `Basic ${Buffer.from(`${env.ADMIN_USERNAME}:${env.ADMIN_PASSWORD}`).toString("base64")}`;
  if (env.ADMIN_PASSWORD && request.headers.authorization === expected) return true;
  reply.code(401).header("WWW-Authenticate", 'Basic realm="trivia-admin"').send({ error: "trivia admin authentication required" });
  return false;
}

export function registerTriviaRoutes(
  app: FastifyInstance,
  trivia: TriviaEngine,
  db: Database.Database,
  venium: VeniumClient,
): void {
  initTriviaTables(db);

  app.get("/api/trivia/state", async () => {
    const snapshot = trivia.snapshot();
    const session = trivia.session;
    return {
      sessionId: session?.id ?? null,
      status: session?.status ?? "scheduled",
      prize: session?.prize_diamonds ?? 0,
      hour: TRIVIA_START_HOUR_VE,
      ...snapshot,
    };
  });

  app.post("/api/trivia/register", async (request, reply) => {
    // El parser global devuelve el JSON como string cruda (por la firma HMAC
    // de Venium); aquí se parsea manualmente.
    const raw = (request.body ?? "") as unknown;
    const body = (typeof raw === "string" ? JSON.parse(raw || "{}") : raw) as { playerId?: string; nickname?: string; sessionId?: string };
    const sessionId = body.sessionId ?? trivia.session?.id;
    if (!sessionId) return reply.code(400).send({ error: "No hay sesión abierta" });
    if (trivia.isLateToJoin()) {
      const existing = db.prepare("SELECT 1 FROM trivia_players WHERE session_id = ? AND player_id = ?").get(sessionId, String(body.playerId ?? ""));
      if (!existing) return reply.code(409).send({ error: "La trivia ya comenzó. Llegaste tarde; podrás participar en la próxima sala." });
    }
    const result = registerPlayer(db, sessionId, {
      playerId: String(body.playerId ?? ""),
      nickname: body.nickname,
      sessionKey: String(body.sessionId ?? ""),
    });
    if ("error" in result) return reply.code(400).send(result);
    return result;
  });

  app.get("/api/trivia/chat", async (request) => {
    const limit = Number((request.query as Record<string, string>).limit ?? 50) || 50;
    const sessionId = trivia.session?.id;
    if (!sessionId) return { messages: [] };
    return { messages: chatHistory(db, sessionId, limit) };
  });

  // Health de la trivia para diagnostics.
  app.get("/api/trivia/health", async () => ({
    wsClients: trivia.wss?.clients.size ?? 0,
    session: trivia.session?.status ?? "none",
  }));

  // ===== Admin =====
  app.post("/api/admin/trivia/start-test", async (req, reply) => {
    if (!triviaAdminAuth(req, reply)) return;
    trivia.testMode = true;
    trivia.startCountdown();
    return { ok: true };
  });

  app.post("/api/admin/trivia/end", async (req, reply) => {
    if (!triviaAdminAuth(req, reply)) return;
    trivia.endSession();
    return { ok: true };
  });

  app.post("/api/admin/trivia/grant-heart", async (req, reply) => {
    if (!triviaAdminAuth(req, reply)) return;
    const raw = (req.body ?? "") as unknown;
    const body = (typeof raw === "string" ? JSON.parse(raw || "{}") : raw) as { playerId?: string; orderId?: string };
    if (!body.playerId) return reply.code(400).send({ error: "playerId requerido" });
    const added = grantHeartForOrder(db, String(body.playerId), body.orderId ?? "");
    return { added };
  });

  // Recarga manual (por Venium) para pruebas con ID de jugador.
  app.post("/api/admin/trivia/recharge", async (req, reply) => {
    if (!triviaAdminAuth(req, reply)) return;
    const raw = (req.body ?? "") as unknown;
    const body = (typeof raw === "string" ? JSON.parse(raw || "{}") : raw) as { playerId?: string; diamonds?: number };
    if (!body.playerId) return reply.code(400).send({ error: "playerId requerido" });
    try {
      const order = await venium.createOrder({
        productId: "mock-free-fire",
        packageId: "mock-100-diamantes",
        playerData: { playerid: String(body.playerId) },
        quantity: 1,
      });
      return { ok: true, orderId: order.orderId };
    } catch (error) {
      return reply.code(502).send({ error: String(error) });
    }
  });

  // ===== Gestión de preguntas y premio (desde el panel admin) =====
  app.get("/api/admin/trivia/questions", async (req, reply) => {
    if (!triviaAdminAuth(req, reply)) return;
    const rows = db.prepare("SELECT id, question, options, correct, active FROM trivia_questions ORDER BY id DESC").all() as Array<{
      id: number; question: string; options: string; correct: number; active: number;
    }>;
    return rows.map((r) => ({ ...r, options: JSON.parse(r.options) }));
  });

  // Carga masiva de preguntas: pega un JSON con [{question, options:[4], correct:1..4}].
  // Con replace=true borra el banco actual antes de insertar.
  interface TriviaQIn { question?: string; options?: unknown; correct?: unknown }
  app.post("/api/admin/trivia/questions", async (req, reply) => {
    if (!triviaAdminAuth(req, reply)) return;
    const raw = (req.body ?? "") as unknown;
    const body = (typeof raw === "string" ? JSON.parse(raw || "{}") : raw) as { replace?: boolean; questions?: TriviaQIn[] };
    const list = body.questions;
    if (!Array.isArray(list) || !list.length) return reply.code(400).send({ error: "questions: array vacío" });
    const clean: Array<{ question: string; options: string; correct: number }> = [];
    for (const q of list) {
      const question = String(q.question ?? "").trim();
      const options = q.options;
      const correct = Number(q.correct);
      if (!question || !Array.isArray(options) || options.length !== 4 || !(correct >= 1 && correct <= 4)) {
        return reply.code(400).send({ error: `Pregunta inválida (espera question, 4 options y correct 1-4): ${question.slice(0, 40)}` });
      }
      clean.push({ question, options: JSON.stringify(options.map((o) => String(o))), correct: Math.round(correct) });
    }
    const insert = db.prepare("INSERT INTO trivia_questions (question, options, correct) VALUES (?, ?, ?)");
    const tx = db.transaction((items: typeof clean) => {
      if (body.replace) db.prepare("DELETE FROM trivia_questions").run();
      for (const q of items) insert.run(q.question, q.options, q.correct);
    });
    tx(clean);
    return { ok: true, inserted: clean.length, replace: !!body.replace };
  });

  app.get("/api/admin/trivia/settings", async (req, reply) => {
    if (!triviaAdminAuth(req, reply)) return;
    const cfg = db.prepare("SELECT value FROM trivia_settings WHERE key = 'prize_diamonds'").get() as { value: string } | undefined;
    const start = db.prepare("SELECT value FROM trivia_settings WHERE key = 'start_time'").get() as { value: string } | undefined;
    return { prizeDiamonds: Number(cfg?.value ?? 500) || 500, startTime: start?.value || "20:00" };
  });

  app.post("/api/admin/trivia/settings", async (req, reply) => {
    if (!triviaAdminAuth(req, reply)) return;
    const raw = (req.body ?? "") as unknown;
    const body = (typeof raw === "string" ? JSON.parse(raw || "{}") : raw) as { prizeDiamonds?: unknown; startTime?: unknown };
    const prize = Math.round(Number(body.prizeDiamonds));
    if (!(prize >= 110)) return reply.code(400).send({ error: "prizeDiamonds debe ser ≥ 110 (paquete mínimo de Free Fire)" });
    const startTime = String(body.startTime ?? "20:00");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) return reply.code(400).send({ error: "startTime debe tener formato HH:MM" });
    db.prepare("INSERT INTO trivia_settings (key, value) VALUES ('prize_diamonds', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(prize));
    trivia.scheduleStart(startTime);
    return { ok: true, prizeDiamonds: prize, startTime };
  });
}
