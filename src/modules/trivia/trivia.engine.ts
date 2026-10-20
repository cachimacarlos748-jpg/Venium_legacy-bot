import type Database from "better-sqlite3";
import { randomUUID, createHash } from "node:crypto";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { env } from "../../config/env.js";
import { createVeniumClient, type VeniumClient, type VeniumPackage, type VeniumProduct } from "../venium/venium.client.js";
import { publishEvent } from "../events/event-bus.js";

import {
  initTriviaTables,
  seedTriviaQuestions,
  type TriviaSessionRow,
  type TriviaPlayerRow,
} from "./trivia.db.js";

// ===== Config =====
export const TRIVIA_START_HOUR_VE = 20; // 8 pm hora de Venezuela (VE = UTC-4)
export const TRIVIA_QUESTION_COUNT = 10;
export const TRIVIA_ANSWER_MS = 10_000;
export const TRIVIA_COUNTDOWN_MS = 5_000;
export const TRIVIA_BETWEEN_MS = 5_000; // 5s entre respuesta y sig. pregunta
export const TRIVIA_MAX_HEARTS = 3;
export const TRIVIA_LATE_HEART_CUTOFF_IDX = 8; // en la 8va ya no se usan corazones
export const TRIVIA_PRIZE_DIAMONDS = 500; // premio por defecto, repartido entre ganadores
// El paquete mínimo real de diamantes de Free Fire: si el reparto por cabeza
// quedara por debajo de esto, se compensa con paquetes mínimos y el panel lo anota.
export const TRIVIA_MIN_PACKAGE_DIAMONDS = 110;

// offset desde UTC a Venezuela: UTC-4 (sin DST)
const VE_OFFSET_MIN = -240;

function veDateKey(now = new Date()): string {
  // Fecha YYYY-MM-DD de la sesión según el día en Venezuela.
  const ve = new Date(now.getTime() + VE_OFFSET_MIN * 60_000);
  return ve.toISOString().slice(0, 10);
}

// Milisegundos hasta la hora configurada en Venezuela (o del día siguiente).
function msUntilStart(dateKey: string, hour = 20, minute = 0): number {
  const targetUtcMs = Date.parse(`${dateKey}T${hour - VE_OFFSET_MIN / 60}:${String(minute).padStart(2, "0")}:00Z`);
  // Si 20:00 VE de hoy ya pasó, situarla mañana.
  const now = Date.now();
  return targetUtcMs > now ? targetUtcMs - now : targetUtcMs + 24 * 3600_000 - now;
}

interface EngineOptions {
  getBotSend: () => null | ((jid: string, text: string) => Promise<void>);
}

// Manager global del motor. Solo una instancia por proceso.
export class TriviaEngine {
  public wss: WebSocketServer | null = null;
  private socketTokens = new Map<WebSocket, string>();
  public session: TriviaSessionRow | null = null;
  private timer: NodeJS.Timeout | null = null;
  private countdownTimer: NodeJS.Timeout | null = null;
  private questionIdx = 0;
  private questionTimer: NodeJS.Timeout | null = null;
  private questionStartedAt = 0;
  private lobbyStartsAt = 0;
  private answersThisQuestion = new Map<string, number>(); // token → índice elegido
  private correctReleased = false;
  private venium: VeniumClient;
  private getBotSend: () => null | ((jid: string, text: string) => Promise<void>);

  // Modo test (arranque manual por admin): incluye la respuesta correcta en el
  // broadcast de la pregunta para pruebas automatizadas del flujo ganador.
  public testMode = false;

  constructor(private db: Database.Database, opts: EngineOptions) {
    this.getBotSend = opts.getBotSend;
    this.venium = createVeniumClient();
    initTriviaTables(db);
    seedTriviaQuestions(db);
  }

  // ==== Ciclo de vida ====
  start(): void {
    this.nextSession();
    this.scheduleFromSettings();
  }

  private scheduleFromSettings(): void {
    const setting = this.db.prepare("SELECT value FROM trivia_settings WHERE key = 'start_time'").get() as { value: string } | undefined;
    const match = /^(\d{1,2}):(\d{2})$/.exec(setting?.value || "20:00");
    const hour = Math.min(23, Math.max(0, Number(match?.[1] ?? 20)));
    const minute = Math.min(59, Math.max(0, Number(match?.[2] ?? 0)));
    const msToStart = msUntilStart(veDateKey(), hour, minute);
    // Abre el lobby 2 h antes de empezar (18:00 VE) para registrar participantes.
    const msToLobby = Math.max(msToStart - 2 * 3600_000, 0);
    this.lobbyStartsAt = Date.now() + msToStart;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.openLobby();
      // El lobby abre a las 18:00; la partida empieza a las 20:00.
      setTimeout(() => this.startCountdown(), Math.max(msToStart - msToLobby, 0));
    }, msToLobby);
    this.timer.unref?.();
  }

  scheduleStart(time: string): void {
    this.db.prepare("INSERT INTO trivia_settings (key, value) VALUES ('start_time', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(time);
    this.scheduleFromSettings();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    if (this.questionTimer) clearInterval(this.questionTimer);
    this.wss?.close();
  }

  nextSession(): string {
    const dateKey = veDateKey();
    const existing = this.db.prepare("SELECT * FROM trivia_sessions WHERE date = ?").get(dateKey) as TriviaSessionRow | undefined;
    if (existing) {
      if (existing.status === "ended") {
        this.db.prepare("UPDATE trivia_sessions SET date = ? WHERE id = ?").run(`${dateKey}-archived-${existing.id.slice(0, 8)}`, existing.id);
      } else {
        this.session = existing;
        return existing.id;
      }
    }
    // Premio definido por el dueño en el panel (tabla trivia_settings); si no
    // hay configuración, usa el por defecto.
    const cfg = this.db.prepare("SELECT value FROM trivia_settings WHERE key = 'prize_diamonds'").get() as { value: string } | undefined;
    const prize = Math.max(110, Number(cfg?.value ?? TRIVIA_PRIZE_DIAMONDS) || TRIVIA_PRIZE_DIAMONDS);
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO trivia_sessions (id, date, status, prize_diamonds) VALUES (?, ?, 'scheduled', ?)`
    ).run(id, dateKey, prize);
    this.session = this.db.prepare("SELECT * FROM trivia_sessions WHERE id = ?").get(id) as TriviaSessionRow;
    return id;
  }

  // ==== Sesiones ====
  openLobby(): void {
    if (!this.session) this.nextSession();
    if (this.session?.status === "ended") this.nextSession();
    if (this.session && this.session.status !== "ended") {
      this.db.prepare("UPDATE trivia_sessions SET status='lobby' WHERE id = ?").run(this.session.id);
      this.session = this.db.prepare("SELECT * FROM trivia_sessions WHERE id = ?").get(this.session.id) as TriviaSessionRow;
      this.testMode = false;
      this.broadcast({ type: "lobby", startsAt: this.lobbyStartsAt });
    }
  }

  startCountdown(): void {
    if (!this.session || this.session.status === "playing" || this.session.status === "ended") return;
    if (this.questionTimer) clearTimeout(this.questionTimer);
    if (this.testMode) {
      this.db.prepare("UPDATE trivia_players SET status='waiting', question_idx=0, connected=0 WHERE session_id=?").run(this.session.id);
      this.db.prepare("DELETE FROM trivia_answers WHERE session_id=?").run(this.session.id);
    }
    this.db.prepare("UPDATE trivia_sessions SET status='countdown' WHERE id = ?").run(this.session.id);
    this.session = this.db.prepare("SELECT * FROM trivia_sessions WHERE id = ?").get(this.session.id) as TriviaSessionRow;
    this.questionIdx = 0;
    this.broadcast({ type: "countdown", ms: TRIVIA_COUNTDOWN_MS, seconds: TRIVIA_COUNTDOWN_MS / 1000 });
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    this.countdownTimer = setTimeout(() => this.startQuestion(), TRIVIA_COUNTDOWN_MS);
  }

  // ==== Flujo de preguntas ====
  private activeQuestionIds(): number[] {
    if (!this.session) return [];
    const ids = (this.session.question_ids ? JSON.parse(this.session.question_ids) : null) as number[] | null;
    if (ids && ids.length) return ids;
    // Genera el orden al empezar y lo persiste para no recalcular a mitad.
    const pool = this.db.prepare("SELECT id FROM trivia_questions WHERE active=1 ORDER BY RANDOM() LIMIT ?")
      .all(TRIVIA_QUESTION_COUNT) as Array<{ id: number }>;
    const list = pool.map((p) => p.id);
    if (this.session) {
      this.db.prepare("UPDATE trivia_sessions SET question_ids = ? WHERE id = ?").run(JSON.stringify(list), this.session.id);
      this.session = this.db.prepare("SELECT * FROM trivia_sessions WHERE id = ?").get(this.session.id) as TriviaSessionRow;
    }
    return list;
  }

  startQuestion(): void {
    if (!this.session) return;
    if (this.session.status === "ended") return;
    if (this.session.status !== "playing") {
      this.db.prepare("UPDATE trivia_sessions SET status='playing', started_at=? WHERE id = ?")
        .run(new Date().toISOString(), this.session.id);
      this.session = this.db.prepare("SELECT * FROM trivia_sessions WHERE id = ?").get(this.session.id) as TriviaSessionRow;
    }
    const ids = this.activeQuestionIds();
    if (this.questionIdx >= ids.length) {
      this.endSession();
      return;
    }
    const q = this.db.prepare("SELECT * FROM trivia_questions WHERE id = ?").get(ids[this.questionIdx]) as
      | { id: number; question: string; options: string; correct: number }
      | undefined;
    if (!q) {
      this.questionIdx += 1;
      return this.startQuestion();
    }
    this.answersThisQuestion.clear();
    this.correctReleased = false;
    this.questionStartedAt = Date.now();
    this.broadcast({
      type: "question",
      idx: this.questionIdx,
      question: q.question,
      options: JSON.parse(q.options),
      ms: TRIVIA_ANSWER_MS,
      ...(this.testMode ? { correct: q.correct } : {}),
    });
    if (this.questionTimer) clearTimeout(this.questionTimer);
    this.questionTimer = setTimeout(() => this.revealAnswer(), TRIVIA_ANSWER_MS);
  }

  submitAnswer(token: string, chosen: number, msTaken: number): { ok: boolean; correct?: boolean; correctIndex?: number; chosen?: number } {
    if (!this.session || this.session.status !== "playing" || this.correctReleased) return { ok: false };
    const player = this.db.prepare("SELECT status FROM trivia_players WHERE session_id=? AND token=?").get(this.session.id, token) as { status: string } | undefined;
    if (!player || player.status === "spectator" || player.status === "eliminated" || player.status === "winner") return { ok: false };
    const q = this.activeQuestionIds()[this.questionIdx];
    const row = this.db.prepare("SELECT correct FROM trivia_questions WHERE id = ?").get(q) as { correct: number } | undefined;
    if (!row) return { ok: false };
    const already = this.db.prepare(
      "SELECT 1 FROM trivia_answers WHERE session_id=? AND token=? AND question_idx=?"
    ).get(this.session.id, token, this.questionIdx);
    if (already) return { ok: false };
    const correct = chosen === row.correct;
    this.db.prepare(
      `INSERT INTO trivia_answers (session_id, token, question_idx, chosen, correct, ms_taken, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(this.session.id, token, this.questionIdx, chosen, correct ? 1 : 0, msTaken, new Date().toISOString());
    this.answersThisQuestion.set(token, chosen);
    // Eliminado por fallo, con sitema de corazon.
    if (!correct) this.eliminateOrSpectate(token);
    return { ok: true, correct, correctIndex: row.correct, chosen };
  }

  // Elimina al jugador o lo deja en modo espectador si ya no tiene corazones.
  private eliminateOrSpectate(token: string, forceSpectator = false): void {
    if (!this.session) return;
    const p = this.db.prepare("SELECT * FROM trivia_players WHERE session_id = ? AND token = ?").get(this.session.id, token) as TriviaPlayerRow | undefined;
    if (!p) return;
    // En la 8va pregunta ya no se puede revivir (regla del dueño).
    if (forceSpectator || this.questionIdx >= TRIVIA_LATE_HEART_CUTOFF_IDX || p.hearts <= 0) {
      this.db.prepare("UPDATE trivia_players SET status='spectator', question_idx=? WHERE session_id=? AND token=?")
        .run(this.questionIdx, this.session.id, token);
      this.sendTo(token, { type: "you", status: "spectator", reason: forceSpectator ? "timeout" : p.hearts <= 0 ? "no_hearts" : "late_stage", hearts: 0 });
      this.broadcastState();
      return;
    }
    // Gasta un corazón y revive para la próxima.
    this.db.prepare("UPDATE trivia_players SET hearts = hearts - 1, status='waiting', question_idx=? WHERE session_id=? AND token=?")
      .run(this.questionIdx, this.session.id, token);
    this.sendTo(token, { type: "you", status: "revived", hearts: p.hearts - 1, nickname: p.nickname });
    this.addChat(token, p.nickname, `❤️ ${p.nickname} usó un corazón y está de vuelta en la trivia.`);
  }

  revealAnswer(): void {
    if (!this.session || this.correctReleased) return;
    this.correctReleased = true;
    const ids = this.activeQuestionIds();
    const q = this.db.prepare("SELECT correct FROM trivia_questions WHERE id = ?").get(ids[this.questionIdx]) as { correct: number } | undefined;
    if (!q) return;
    const players = this.db.prepare(
      "SELECT token, status FROM trivia_players WHERE session_id = ? AND status NOT IN ('spectator', 'winner')"
    ).all(this.session.id) as Array<{ token: string; status: string }>;
    for (const player of players) {
      const chosen = this.answersThisQuestion.get(player.token);
      const timedOut = chosen == null;
      if (timedOut) {
        this.db.prepare(
          `INSERT INTO trivia_answers (session_id, token, question_idx, chosen, correct, ms_taken, created_at)
           VALUES (?, ?, ?, 0, 0, ?, ?)`
        ).run(this.session.id, player.token, this.questionIdx, TRIVIA_ANSWER_MS, new Date().toISOString());
        this.eliminateOrSpectate(player.token, true);
      }
      this.sendTo(player.token, {
        type: "round_result",
        outcome: timedOut ? "timeout" : (chosen === q.correct ? "correct" : "wrong"),
        chosen: chosen ?? null,
        correct: q.correct,
      });
    }
    this.broadcast({ type: "reveal", correct: q.correct });
    setTimeout(() => {
      this.questionIdx += 1;
      this.startQuestion();
    }, TRIVIA_BETWEEN_MS);
  }

  endSession(): void {
    if (!this.session) return;
    // Cierre único: recargar de la BD (el objeto en memoria no se refresca
    // tras el UPDATE) para que un segundo endSession no pague dos veces.
    const fresh = this.db.prepare("SELECT status FROM trivia_sessions WHERE id = ?").get(this.session.id) as { status: string } | undefined;
    if (!fresh || fresh.status === "ended") return;
    if (this.questionTimer) clearTimeout(this.questionTimer);
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    this.correctReleased = true;
    this.db.prepare("UPDATE trivia_sessions SET status='ended', ended_at=? WHERE id = ?").run(new Date().toISOString(), this.session.id);
    this.session = this.db.prepare("SELECT * FROM trivia_sessions WHERE id = ?").get(this.session.id) as TriviaSessionRow;
    const winners = this.db.prepare(
      `SELECT * FROM trivia_players WHERE session_id = ? AND status != 'spectator' AND status != 'eliminated'`
    ).all(this.session.id) as TriviaPlayerRow[];
    // Ganadores = los que quedaron de pie (no eliminados ni espectadores).
    // Quien acierta todo permanece 'waiting' (solo cambia al fallar).
    const alive = winners;
    if (alive.length) {
      const total = this.session.prize_diamonds || TRIVIA_PRIZE_DIAMONDS;
      const maxSetting = this.db.prepare("SELECT value FROM trivia_settings WHERE key = 'max_winners'").get() as { value: string } | undefined;
      const maxWinners = Math.min(alive.length, Math.max(1, Number(maxSetting?.value ?? 3) || 3));
      void this.preparePayouts(alive, total, maxWinners);
      this.broadcast({ type: "ended", winners: alive.slice(0, maxWinners).map((w) => ({ nickname: w.nickname, playerId: w.player_id })), prize: total });
    } else {
      this.broadcast({ type: "ended", winners: [], prize: 0 });
    }
  }

  private async preparePayouts(alive: TriviaPlayerRow[], total: number, maxWinners: number): Promise<void> {
    let packages: Array<{ productId: string; pkg: VeniumPackage; diamonds: number }> = [];
    try {
      const catalog = await this.venium.getCatalog();
      const product = this.findFreeFireProduct(catalog);
      if (product) {
        packages = product.packages
          .filter((pkg) => !pkg.outOfStock)
          .map((pkg) => ({ productId: product.productId, pkg, diamonds: this.diamondsFromPackage(pkg.name) }))
          .filter((entry) => entry.diamonds > 0)
          .sort((a, b) => b.diamonds - a.diamonds);
      }
    } catch (error) {
      this.publishPayoutWarning(`No se pudo consultar el catálogo Venium: ${String(error)}`);
    }
    if (!packages.length) {
      this.publishPayoutWarning("No hay paquetes válidos de Free Fire en el catálogo; no se generaron premios.");
      return;
    }
    // El monto del panel es una referencia total. Venium trabaja con
    // denominaciones reales, así que cada ganador recibe el paquete más
    // cercano a su parte, aunque el total final difiera un poco. Ejemplo:
    // 300 / 3 = 100 y el catálogo 100+10 se entrega como 110 por persona.
    const count = maxWinners;
    const targetPerWinner = total / count;
    const chosen = packages.reduce((best, entry) =>
      !best || Math.abs(entry.diamonds - targetPerWinner) < Math.abs(best.diamonds - targetPerWinner) ? entry : best,
    undefined as (typeof packages)[number] | undefined);
    if (!chosen) {
      this.publishPayoutWarning("No hay paquetes de diamantes válidos disponibles en Venium.");
      return;
    }
    const selected = Array.from({ length: count }, () => chosen);
    for (let i = 0; i < selected.length; i++) {
      const w = alive[i];
      const entry = selected[i];
      this.db.prepare("UPDATE trivia_players SET status='winner' WHERE session_id=? AND token=?").run(this.session!.id, w.token);
      void this.payPrize(w.player_id, entry.productId, entry.pkg.packageId, entry.diamonds);
    }
    const actualTotal = chosen.diamonds * count;
    if (actualTotal !== total) this.publishPayoutWarning(`Premio configurado ${total}; se entregarán ${actualTotal} diamantes reales usando ${chosen.pkg.name}.`);
  }

  private findFreeFireProduct(catalog: VeniumProduct[]): VeniumProduct | undefined {
    return catalog.find((product) => /free\s*fire/i.test(`${product.name} ${product.productId}`));
  }

  private diamondsFromPackage(name: string): number {
    const label = String(name);
    if (!/[+]|diam(?:ante|ond)/i.test(label)) return 0;
    const values = label.match(/\d[\d.,]*/g) || [];
    return values.reduce((sum, value) => sum + Number(value.replace(/[.,](?=\d{3}\b)/g, "")), 0);
  }

  private publishPayoutWarning(message: string): void {
    publishEvent({ type: "trivia_prize_warning", jid: "trivia@vex.store", phone: "Trivia", preview: `⚠️ ${message}`, meta: { message } });
  }

  // Recarga automática por Venium, similar a un pedido normal: usa el mismo
  // catálogo y paquete del pedido. Marca el intento para seguimiento manual si falla.
  private async payPrize(playerId: string, productId: string, packageId: string, diamonds: number): Promise<void> {
    const sessionId = this.session?.id ?? "";
    try {
      const order = await this.venium.createOrder({
        productId,
        packageId,
        playerData: { playerid: playerId, quantity_note: String(diamonds) },
        quantity: 1,
      });
      this.db.prepare(`INSERT INTO trivia_prize_log (session_id, player_id, diamonds, venium_order_id, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(sessionId, playerId, diamonds, order.orderId, "created", new Date().toISOString());
      publishEvent({
        type: "trivia_prize",
        jid: "trivia@vex.store",
        phone: "Trivia",
        preview: `💎 Premio Trivia: ${diamonds} diamantes → ${playerId} (${order.orderId})`,
        meta: { sessionId, playerId, diamonds, veniumOrderId: order.orderId },
      });
      const botSend = this.getBotSend();
      if (botSend) void botSend("status@broadcast", `🏆 Premio Trivia entregado: ${diamonds} diamantes al jugador ${playerId}`);
    } catch (error) {
      this.db.prepare(`INSERT INTO trivia_prize_log (session_id, player_id, diamonds, venium_order_id, status, created_at)
        VALUES (?, ?, ?, NULL, 'failed', ?)`).run(sessionId, playerId, diamonds, new Date().toISOString());
      publishEvent({
        type: "trivia_prize_failed",
        jid: "trivia@vex.store",
        phone: "Trivia",
        preview: `❌ Falló el premio Trivia para ${playerId}: ${String(error)}`,
        meta: { sessionId, playerId, diamonds, error: String(error) },
      });
    }
  }

  // ==== WebSocket ====
  attach(server: import("node:http").Server): void {
    this.wss = new WebSocketServer({ server, path: "/ws/trivia" });
    this.wss.on("connection", (socket: WebSocket, req) => {
      const url = new URL(req.url ?? "", "http://localhost");
      const token = url.searchParams.get("token") ?? "";
      const registeredPlayer = this.playerByToken(token);
      const joinedAfterStart = Boolean(registeredPlayer && this.session?.status === "playing" && this.session.started_at && new Date(registeredPlayer.joined_at).getTime() > new Date(this.session.started_at).getTime());
      const player = joinedAfterStart ? undefined : registeredPlayer;
      if (token) this.socketTokens.set(socket, token);
      if (player) {
        this.db.prepare("UPDATE trivia_players SET connected=1 WHERE session_id=? AND token=?").run(this.session?.id, token);
        this.sendTo(token, { type: "you", status: player.status, hearts: player.hearts, nickname: player.nickname });
        this.sendCurrentQuestion(token);
        this.broadcastState();
      }
      if (this.session?.status === "lobby") socket.send(JSON.stringify({ type: "lobby", startsAt: this.lobbyStartsAt }));
      if (joinedAfterStart || (!player && this.session?.status === "playing")) socket.send(JSON.stringify({ type: "late_join", message: "Llegaste tarde: la trivia ya comenzó. Puedes mirar y usar el chat, pero participarás en la próxima sala." }));
      socket.on("message", (raw: RawData) => {
        let msg: any;
        try { msg = JSON.parse(String(raw)); } catch { return; }
        if (msg.type === "answer" && player) {
          const res = this.submitAnswer(player.token, msg.chosen, msg.msTaken ?? 0);
          this.sendTo(player.token, { type: "answer_ack", ok: res.ok, correct: res.correct, correctIndex: res.correctIndex, chosen: res.chosen });
        } else if (msg.type === "chat") {
          this.addChat(player?.token || "guest", player?.nickname || String(msg.nickname || "Invitado"), String(msg.text ?? "").slice(0, 200));
        } else if (msg.type === "ping") {
          socket.send(JSON.stringify({ type: "pong" }));
        }
      });
      socket.on("close", () => {
        this.socketTokens.delete(socket);
        if (player) this.db.prepare("UPDATE trivia_players SET connected=0 WHERE session_id=? AND token=?").run(this.session?.id, player.token);
        this.broadcastState();
      });
    });
  }

  private sendCurrentQuestion(token: string): void {
    if (!this.session || this.session.status !== "playing" || !this.questionStartedAt) return;
    const questionId = this.activeQuestionIds()[this.questionIdx];
    if (!questionId) return;
    const q = this.db.prepare("SELECT question, options FROM trivia_questions WHERE id = ?").get(questionId) as
      | { question: string; options: string }
      | undefined;
    if (!q) return;
    const ms = Math.max(0, TRIVIA_ANSWER_MS - (Date.now() - this.questionStartedAt));
    if (!ms) return;
    this.sendTo(token, {
      type: "question",
      idx: this.questionIdx,
      question: q.question,
      options: JSON.parse(q.options),
      ms,
    });
  }

  isLateToJoin(): boolean {
    return this.session?.status === "playing";
  }

  getLobbyStartsAt(): number {
    return this.lobbyStartsAt;
  }

  playerByToken(token: string): TriviaPlayerRow | undefined {
    if (!this.session || !token) return undefined;
    return this.db.prepare("SELECT * FROM trivia_players WHERE session_id = ? AND token = ?").get(this.session.id, token) as TriviaPlayerRow | undefined;
  }

  broadcast(payload: Record<string, unknown>): void {
    const data = JSON.stringify(payload);
    for (const socket of this.wss?.clients ?? []) {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    }
  }

  sendTo(token: string, payload: Record<string, unknown>): void {
    const data = JSON.stringify(payload);
    for (const socket of this.wss?.clients ?? []) {
      if (this.socketTokens.get(socket) === token && socket.readyState === WebSocket.OPEN) socket.send(data);
    }
  }

  private addChat(token: string, nickname: string, message: string): void {
    if (!this.session || !message.trim()) return;
    this.db.prepare(`INSERT INTO trivia_chat (session_id, token, nickname, message, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(this.session.id, token, nickname, message, new Date().toISOString());
    this.broadcast({ type: "chat", nickname, text: message, ts: Date.now() });
  }

  // Estado que recibe el frontend por SSE / ws en cada golpe: cuenta de
  // participantes, los de pie y si ya empezó.
  snapshot(): { participants: number; online: number; alive: number; heartsPool: number } {
    if (!this.session) return { participants: 0, online: 0, alive: 0, heartsPool: 0 };
    const agg = this.db.prepare(`
      SELECT COUNT(*) participants,
             SUM(connected) online,
             SUM(CASE status WHEN 'alive' THEN 1 ELSE 0 END) alive
      FROM trivia_players WHERE session_id = ?`).get(this.session.id) as { participants: number; online: number; alive: number };
    const waiting = (this.db.prepare("SELECT COUNT(*) n FROM trivia_players WHERE session_id=? AND status NOT IN ('spectator','eliminated')").get(this.session.id) as { n: number }).n;
    return { participants: agg.participants, online: agg.online ?? 0, alive: waiting ?? 0, heartsPool: agg.participants };
  }

  broadcastState(): void {
    const s = this.snapshot();
    this.broadcast({ type: "state", sessionId: this.session?.id ?? null, participants: s.participants, online: s.online, alive: s.alive, status: this.session?.status ?? "scheduled" });
  }

  resetSession(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.questionTimer) clearTimeout(this.questionTimer);
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    if (this.session && this.session.status !== "ended") {
      this.db.prepare("UPDATE trivia_sessions SET date=? WHERE id=?").run(`${veDateKey()}-archived-${this.session.id.slice(0, 8)}`, this.session.id);
    }
    this.session = null;
    this.questionIdx = 0;
    this.questionStartedAt = 0;
    this.answersThisQuestion.clear();
    this.correctReleased = false;
    this.nextSession();
    this.scheduleFromSettings();
    this.broadcast({ type: "reset", message: "Se abrió una nueva sala. Puedes registrarte de nuevo." });
    this.broadcastState();
  }
}

// Hash de token para identificación del jugador (no guarda plain token en todas las resp).
export function tokenFor(sessionId: string, playerId: string): string {
  return createHash("sha256").update(`${sessionId}:${playerId}`).digest("hex").slice(0, 32);
}
