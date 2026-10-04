/**
 * Espejo local de los movimientos de BDVenlinea.
 *
 * Leer la tabla del banco cuesta 15-40 s (login + formulario + tabla) y solo
 * hay UNA sesion activa por titular: cada verificacion en frio es un viaje al
 * banco. El espejo rompe esa dependencia del camino critico:
 *
 *   1. Un cron (bdv-sync) lee la tabla cada BDV_MIRROR_INTERVAL_MS y deja las
 *      ultimas operaciones en la tabla `bdv_mirror`.
 *   2. La verificacion consulta el espejo, que es local: respuesta en
 *      milisegundos y sin tocar el banco.
 *
 * El banco sigue siendo la unica fuente de verdad (el espejo es una COPIA de
 * una lectura real suya). La copia nunca "confirma" nada que el banco no haya
 * mostrado, y una respuesta negativa nunca se sirve de un espejo viejo: por eso
 * los negativos tienen su propia ventana, mas corta que los positivos.
 */

import type Database from "better-sqlite3";

export interface MirroredMovement {
  reference: string | null;
  amount: number | null;
  date: string | null;
  description: string | null;
  incoming: boolean;
}

/** Movimiento tal como lo da el navegador (misma forma que Movement). */
export interface MovementInput {
  reference: string | null;
  amount: number | null;
  date: string | null;
  description: string | null;
  incoming?: boolean;
}

export interface SyncState {
  syncedAt: string | null;
  ok: boolean;
  error: string;
  movements: number;
}

/**
 * Que hacemos con una consulta: fiarnos del espejo o preguntarle al banco.
 *
 * - Positivo (la referencia ESTA en el espejo): el pago existe, no hay riesgo
 *   de falso negativo, asi que el espejo es valido mientras no sea muy viejo.
 * - Negativo (la referencia NO esta): decir "no encontrado" con datos viejos
 *   es el error caro (el cliente ya pagó), asi que con un espejo pasado de
 *   `negativeTtlMs` se vuelve a preguntar al banco.
 */
export function mirrorVerdict(input: {
  syncedAgoMs: number | null;
  found: boolean;
  negativeTtlMs: number;
  positiveTtlMs: number;
}): "mirror" | "bank" {
  if (input.syncedAgoMs === null || input.syncedAgoMs < 0) return "bank";
  const ttl = input.found ? input.positiveTtlMs : input.negativeTtlMs;
  return input.syncedAgoMs <= ttl ? "mirror" : "bank";
}

function rowKey(reference: string, date: string | null): string {
  return `${reference}|${date ?? ""}`;
}

/**
 * Guarda una lectura real del banco. Las filas que llegan sin referencia o sin
 * monto no se guardan: un espejo con basura terminaria contradiciendo al banco
 * y, peor, contando como "no encontrado" con datos inventados.
 */
export function mirrorMovements(db: Database.Database, movements: MovementInput[]): number {
  const upsert = db.prepare(`
    INSERT INTO bdv_mirror (row_key, reference, amount, date, description, incoming, first_seen_at, last_seen_at)
    VALUES (@row_key, @reference, @amount, @date, @description, @incoming, @at, @at)
    ON CONFLICT(row_key) DO UPDATE SET
      amount = excluded.amount,
      description = excluded.description,
      incoming = excluded.incoming,
      last_seen_at = excluded.last_seen_at
  `);
  const nowIso = new Date().toISOString();
  let saved = 0;
  db.transaction(() => {
    for (const movement of movements) {
      const reference = String(movement.reference ?? "").replace(/\D/g, "");
      const amount = typeof movement.amount === "number" && Number.isFinite(movement.amount) ? movement.amount : null;
      if (!reference || amount === null) continue;
      const date = movement.date ? String(movement.date) : null;
      upsert.run({
        row_key: rowKey(reference, date),
        reference,
        amount,
        date,
        description: movement.description ?? null,
        incoming: movement.incoming === false ? 0 : 1,
        at: nowIso,
      });
      saved += 1;
    }
  })();
  return saved;
}

export function readMirror(db: Database.Database, limit = 200): MirroredMovement[] {
  const rows = db
    .prepare("SELECT reference, amount, date, description, incoming FROM bdv_mirror ORDER BY last_seen_at DESC, row_key DESC LIMIT ?")
    .all(limit) as Array<{ reference: string; amount: number; date: string | null; description: string | null; incoming: number }>;
  return rows.map((row) => ({
    reference: row.reference,
    amount: row.amount,
    date: row.date,
    description: row.description,
    incoming: row.incoming === 1,
  }));
}

export function readSyncState(db: Database.Database): SyncState {
  const row = db.prepare("SELECT synced_at, ok, error, movements FROM bdv_sync WHERE id = 1").get() as
    | { synced_at: string | null; ok: number; error: string | null; movements: number }
    | undefined;
  if (!row) return { syncedAt: null, ok: false, error: "", movements: 0 };
  return { syncedAt: row.synced_at, ok: row.ok === 1, error: row.error ?? "", movements: row.movements };
}

/** Antigüedad de la última sincronización, o null si nunca se ha hecho. */
export function syncedAgoMs(db: Database.Database, now = Date.now()): number | null {
  const { syncedAt, ok } = readSyncState(db);
  if (!syncedAt || !ok) return null;
  const at = Date.parse(syncedAt);
  if (!Number.isFinite(at)) return null;
  return now - at;
}

export function recordSync(db: Database.Database, input: { ok: boolean; error?: string; movements?: number }): void {
  db.prepare(`
    INSERT INTO bdv_sync (id, synced_at, ok, error, movements)
    VALUES (1, @at, @ok, @error, @movements)
    ON CONFLICT(id) DO UPDATE SET
      synced_at = excluded.synced_at,
      ok = excluded.ok,
      error = excluded.error,
      movements = excluded.movements
  `).run({
    at: new Date().toISOString(),
    ok: input.ok ? 1 : 0,
    error: input.error ?? "",
    movements: input.movements ?? 0,
  });
}

/**
 * Corte de electrones del espejo: se guarda lo leido, pero no para siempre.
 * Sin esto, una referencia seguiria "en el espejo" meses despues y podria
 * marcar como duplicado un pago antiguo.
 */
export function pruneMirror(db: Database.Database, maxAgeMs: number, now = Date.now()): number {
  const info = db
    .prepare("DELETE FROM bdv_mirror WHERE last_seen_at < ?")
    .run(new Date(now - maxAgeMs).toISOString());
  return info.changes;
}

export function clearMirror(db: Database.Database): void {
  db.prepare("DELETE FROM bdv_mirror").run();
  db.prepare("DELETE FROM bdv_sync").run();
}
