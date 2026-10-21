import type Database from "better-sqlite3";
import { randomUUID, createHash } from "node:crypto";
import { publishEvent } from "../events/event-bus.js";

// ===== Servicios REST de la Trivia (usados por la página /trivia) =====

// Corazones ganados por compras: 1 corazón por cada pedido completado, hasta un
// tope diario. El dueño ajusta el ratio más adelante sin tocar código.
export function grantHeartForOrder(db: Database.Database, playerId: string, orderId: string): number {
  const today = new Date().toISOString().slice(0, 10);
  const earned = (db.prepare(
    `SELECT COUNT(*) n FROM trivia_heart_ledger WHERE player_id = ? AND source='purchase' AND created_at LIKE ?`
  ).get(playerId, `${today}%`) as { n: number }).n;
  if (earned >= 3) return 0; // tope diario de corazones por compras
  const add = db.prepare(
    `INSERT INTO trivia_heart_ledger (player_id, hearts, source, order_id, created_at) VALUES (?, 1, 'purchase', ?, ?)`
  ).run(playerId, orderId, new Date().toISOString());
  return add.changes;
}

// Todo jugador recibe un corazón de bienvenida una sola vez. Se guarda en el
// mismo libro mayor que las compras para que el saldo sobreviva al cambio de sala.
function ensureWelcomeHeart(db: Database.Database, playerId: string): void {
  const welcome = db.prepare("SELECT 1 FROM trivia_heart_ledger WHERE player_id = ? AND source = 'welcome' LIMIT 1").get(playerId);
  if (welcome) return;
  db.prepare(
    `INSERT INTO trivia_heart_ledger (player_id, hearts, source, order_id, created_at) VALUES (?, 1, 'welcome', NULL, ?)`
  ).run(playerId, new Date().toISOString());
}

// Registra el gasto de un corazón para que no reaparezca en la próxima sala.
export function consumeHeart(db: Database.Database, playerId: string): void {
  db.prepare(
    `INSERT INTO trivia_heart_ledger (player_id, hearts, source, order_id, created_at) VALUES (?, -1, 'spent', NULL, ?)`
  ).run(playerId, new Date().toISOString());
}

// merge session/player para registro antes del juego
export interface RegisterInput {
  playerId: string;   // ID Free Fire
  nickname?: string;
  sessionKey: string; // fecha YYYY-MM-DD en VE
}

export function registerPlayer(db: Database.Database, sessionId: string, input: RegisterInput): { token: string; nickname: string; hearts: number } | { error: string } {
  if (!input.playerId || !/^\d{6,12}$/.test(input.playerId)) return { error: "playerId inválido" };
  const session = db.prepare("SELECT * FROM trivia_sessions WHERE id = ?").get(sessionId);
  if (!session || (session as any).status === "ended") return { error: "sesión no disponible" };
  // Un mismo ID se registra una vez.
  const existing = db.prepare("SELECT * FROM trivia_players WHERE session_id = ? AND player_id = ?").get(sessionId, input.playerId);
  if (existing) {
    const p = existing as any;
    if (input.nickname && input.nickname.trim() && input.nickname.trim() !== p.nickname) {
      db.prepare("UPDATE trivia_players SET nickname = ? WHERE session_id = ? AND player_id = ?")
        .run(input.nickname.trim().slice(0, 24), sessionId, input.playerId);
      p.nickname = input.nickname.trim().slice(0, 24);
    }
    return { token: p.token, nickname: p.nickname, hearts: p.hearts };
  }
  const token = createHash("sha256").update(`${sessionId}:${input.playerId}:${randomUUID()}`).digest("hex").slice(0, 32);
  const nickname = (input.nickname || `Jugador ${input.playerId.slice(-4)}`).slice(0, 24);
  ensureWelcomeHeart(db, input.playerId);
  // Corazones: los pedidos completados de ese ID dan vidas (recuento del ledger).
  const hearts = (db.prepare("SELECT COALESCE(SUM(hearts),0) n FROM trivia_heart_ledger WHERE player_id = ?").get(input.playerId) as any).n ?? 0;
  db.prepare(
    `INSERT INTO trivia_players (session_id, token, player_id, nickname, hearts, status, question_idx, connected, joined_at)
     VALUES (?, ?, ?, ?, ?, 'waiting', 0, 0, ?)`
  ).run(sessionId, token, input.playerId, nickname, Math.min(hearts, 3), new Date().toISOString());
  publishEvent({
    type: "trivia_register",
    jid: "trivia@vex.store",
    phone: "Trivia",
    preview: `${nickname} (${input.playerId}) se registró en la Trivia`,
    meta: { sessionId, playerId: input.playerId, nickname },
  });
  return { token, nickname, hearts: Math.min(hearts, 3) };
}

// Verificación básica del nombre de Free Fire:
// con la API del shop (proxy) se puede resolver el nickname del ID; si no hay
// proxy configurado usamos el propio nickname que escribe el jugador.
export function buildToken(sessionId: string, playerId: string, nonce: string): string {
  return createHash("sha256").update(`${sessionId}:${playerId}:${nonce}`).digest("hex").slice(0, 32);
}

export function chatHistory(db: Database.Database, sessionId: string, limit = 50): Array<{ nickname: string; text: string; ts: number }> {
  const rows = db.prepare(
    "SELECT nickname, message, created_at FROM trivia_chat WHERE session_id = ? ORDER BY id DESC LIMIT ?"
  ).all(sessionId, limit) as Array<{ nickname: string; message: string; created_at: string }>;
  return rows.reverse().map((r) => ({ nickname: r.nickname, text: r.message, ts: Date.parse(r.created_at) }));
}
