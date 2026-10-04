// El espejo local de BDVenlinea: una copia en SQLite de la tabla de
// movimientos que el cron relee del banco.
//
// Lo que se verifica aqui es la regla que evita el peor error posible del
// negocio: decir "no se encontró el pago" cuando el cliente SI pagó. Por eso
// un positivo se acepta de una copia vieja y un negativo, no.
import "./helpers/mock-env.js";

import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase, migrate } from "../src/db/connection.js";
import {
  mirrorMovements,
  readMirror,
  readSyncState,
  syncedAgoMs,
  recordSync,
  pruneMirror,
  clearMirror,
  mirrorVerdict,
} from "../src/modules/bdv/bdv-mirror.js";

const db = createDatabase(":memory:");
migrate(db);

const sample = [
  { reference: "0677228032099", amount: 790, date: "2026-10-01 10:42", description: "Pago movil", incoming: true },
  { reference: "677228032100", amount: 100, date: "2026-10-02 08:00", description: "Pago movil", incoming: true },
];

test("una lectura del banco queda disponible sin volver al banco", () => {
  clearMirror(db);
  assert.equal(mirrorMovements(db, sample), 2);
  recordSync(db, { ok: true, movements: 2 });

  const rows = readMirror(db);
  assert.equal(rows.length, 2);
  assert.ok(rows.some((r) => r.reference === "0677228032099" && r.amount === 790));
  assert.equal(readSyncState(db).ok, true);
  assert.ok((syncedAgoMs(db) ?? 1) >= 0);
});

test("reler la misma operacion no la duplica", () => {
  clearMirror(db);
  mirrorMovements(db, sample);
  mirrorMovements(db, sample);
  mirrorMovements(db, sample);
  assert.equal(readMirror(db).length, 2, "tres lecturas del mismo banco = 2 movimientos");
});

test("una fila sin referencia o sin monto nunca entra al espejo", () => {
  clearMirror(db);
  const saved = mirrorMovements(db, [
    { reference: null, amount: 50, date: "2026-10-03", description: "sin ref" },
    { reference: "123456", amount: null, date: "2026-10-03", description: "sin monto" },
    { reference: "12a34", amount: 60, date: "2026-10-03", description: "con ceros" },
  ]);
  assert.equal(saved, 1, "solo la referencia limpia se guarda");
  assert.equal(readMirror(db)[0].reference, "1234");
});

test("un espejo viejo se poda para que una referencia no vuelva valida meses despues", () => {
  clearMirror(db);
  mirrorMovements(db, sample);
  // Corte explicito en el futuro (el corte real es now - maxAge): escribir y
  // podar en el mismo milisegundo haria el resultado depender del reloj.
  assert.equal(pruneMirror(db, 60_000, Date.now() + 120_000), 2, "pasada la ventana, se podan todas");
  assert.equal(readMirror(db).length, 0);
});

test("una sincronizacion fallida no invalida la copia buena", () => {
  clearMirror(db);
  mirrorMovements(db, sample);
  recordSync(db, { ok: true, movements: 2 });
  recordSync(db, { ok: false, error: "el banco no responde" });

  assert.equal(readSyncState(db).ok, false);
  assert.equal(syncedAgoMs(db), null, "un estado fallido no cuenta como espejo vigente");
  assert.equal(readMirror(db).length, 2, "los datos buenos siguen ahi");
});

test("un positivo se acepta del espejo viejo; un negativo obliga a preguntar al banco", () => {
  const positivo = mirrorVerdict({ syncedAgoMs: 120_000, found: true, negativeTtlMs: 45_000, positiveTtlMs: 150_000 });
  assert.equal(positivo, "mirror", "el pago existe: la copia da fe");

  const negativo = mirrorVerdict({ syncedAgoMs: 120_000, found: false, negativeTtlMs: 45_000, positiveTtlMs: 150_000 });
  assert.equal(negativo, "bank", "no se puede decir 'no encontrado' con datos de hace 2 minutos");

  const negativoReciente = mirrorVerdict({ syncedAgoMs: 10_000, found: false, negativeTtlMs: 45_000, positiveTtlMs: 150_000 });
  assert.equal(negativoReciente, "mirror", "una copia de hace 10 s es fiable para decir que no esta");

  assert.equal(
    mirrorVerdict({ syncedAgoMs: null, found: true, negativeTtlMs: 45_000, positiveTtlMs: 150_000 }),
    "bank",
    "sin espejo, siempre al banco",
  );
});
