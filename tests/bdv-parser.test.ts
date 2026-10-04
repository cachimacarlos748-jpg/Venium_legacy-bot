// El parser de la tabla de BDVenlinea.
//
// Esto se separo del navegador a proposito: es la parte que rompe cada vez que
// el banco cambia una palabra en una cabecera, y la unica que se puede probar
// sin una sesion real del banco. El caso que importa es el ultimo: cuando el
// parser ya no entiende la tabla, el bot debe decir "no pude leer", NUNCA
// "no se encontro tu pago".
import "./helpers/mock-env.js";

import test from "node:test";
import assert from "node:assert/strict";
import { parseMovementTable, BdvReadError, LoginGuard } from "../src/modules/bdv/bdv.browser.js";

const tablaBuena = {
  header: ["Fecha", "Referencia", "Descripción", "Débito/Crédito", "Monto"],
  rows: [
    ["01/10/2026", "0677228032099", "PAGO MOVIL RECIBIDO", "CREDITO", "790,00"],
    ["02/10/2026", "677228032100", "TRANSFERENCIA RECIBIDA", "CREDITO", "1.250,50"],
  ],
};

test("lee una tabla normal del portal", () => {
  const movements = parseMovementTable(tablaBuena);
  assert.equal(movements.length, 2);
  assert.equal(movements[0].reference, "0677228032099");
  assert.equal(movements[0].amount, 790);
  assert.equal(movements[1].amount, 1250.5);
});

test("ignora los debitos: una compra del titular nunca cuenta como pago", () => {
  const movements = parseMovementTable({
    header: tablaBuena.header,
    rows: [
      ["01/10/2026", "0677228032099", "PAGO RECIBIDO", "CREDITO", "790,00"],
      ["01/10/2026", "111122223333", "COMPRA EN LINEA", "DEBITO", "45,00"],
    ],
  });
  assert.equal(movements.length, 1);
  assert.equal(movements[0].reference, "0677228032099");
});

test("una tabla sin filas NO es un fallo del parser", () => {
  // El banco puede responder vacio; eso es una respuesta legitima.
  assert.deepEqual(parseMovementTable({ header: tablaBuena.header, rows: [] }), []);
});

test("una tabla que cambio y ya no se entiende lanza en vez de decir 'no encontrado'", () => {
  // Cabeceras nuevas, columnas movidas: el fallback por indice ya no acierta.
  const tablaCambiada = {
    header: ["Operación", "Descripción", "Importe", "Signo"],
    rows: [["0677228032099", "PAGO MOVIL RECIBIDO", "790,00", "+"]],
  };
  assert.throws(
    () => parseMovementTable(tablaCambiada),
    (error: unknown) => {
      assert.ok(error instanceof BdvReadError);
      assert.match(error.message, /ninguna se pudo leer/);
      // El error lleva las cabeceras reales: sin esto no hay forma de adaptar
      // el parser a ciegas.
      assert.match(error.detail, /Operaci/);
      return true;
    },
  );
});

// El banco bloquea la cuenta tras pocos logins fallidos y desbloquearla es un
// tramite manual del titular. El freno evita que cada pago lo reintente.
test("tras un login fallido el portal queda en pausa, y un login bueno la borra", () => {
  const guard = new LoginGuard(600_000);
  const t0 = 1_000_000;
  assert.equal(guard.blocked(t0), false, "al principio se puede intentar");
  guard.noteFailure(t0);
  assert.equal(guard.blocked(t0 + 599_999), true, "el fallo pausa los reintentos");
  assert.equal(guard.blocked(t0 + 600_000), false, "la pausa se acaba sola");
  // Un login bueno demuestra que el portal y las credenciales sirven.
  guard.noteSuccess();
  assert.equal(guard.blocked(t0 + 1), false);
});

test("sin enfriamiento configurado el freno no bloquea nada", () => {
  const guard = new LoginGuard(0);
  guard.noteFailure(5_000);
  assert.equal(guard.blocked(5_000), false);
});

test("si todas las filas son debitos, tambien es un fallo de lectura y no un 'no encontrado'", () => {
  assert.throws(
    () =>
      parseMovementTable({
        header: tablaBuena.header,
        rows: [
          ["01/10/2026", "111122223333", "COMPRA", "DEBITO", "45,00"],
          ["01/10/2026", "444455556666", "COMPRA", "DEBITO", "90,00"],
        ],
      }),
    BdvReadError,
  );
});
