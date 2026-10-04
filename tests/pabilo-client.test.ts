// Pabilo es el proveedor de pagos de la tienda (mismo para el bot de WhatsApp
// y para la web). Su clave es de un mes: 10 dias y 40 creditos. Cuando se
// acaba o se vence, TODAS las verificaciones caen a la vez, asi que lo que mas
// importa es no convertir "no pudimos verificar" en un rechazo para el
// cliente. Estos tests fijan esa linea:
//   - is_new:false  -> la referencia ya se uso (respuesta definitiva)
//   - 402/401/429/5xx/200 sin veredicto -> "no pudimos verificar", reintentable
//   - 400 con monto -> el monto no coincide (definitivo y accionable)
// Y que la configuracion del ENTORNO gane sobre la del panel: si no, al rotar
// la clave el bot sigue verificando con la vieja hasta que alguien abra el
// admin, y los pagos "no entran" sin explicacion.
import "./helpers/pabilo-live-env.js";

import test from "node:test";
import assert from "node:assert/strict";
import { createPabiloClient } from "../src/modules/pabilo/pabilo.client.js";
import { resolvePabiloConfig } from "../src/modules/payments/payment.service.js";

type Reply = { status: number; body: unknown };

function clienteQueResponde(reply: Reply) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init: any }> = [];
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.body,
      text: async () => JSON.stringify(reply.body),
    };
  }) as typeof fetch;
  return { client: createPabiloClient(), calls, restore: () => { globalThis.fetch = original; } };
}

const CONSULTA = { userBankId: "banco-del-entorno", amount: "790.00", bankReference: "953712", movementType: "GENERIC" };

async function verificar(reply: Reply) {
  const ctx = clienteQueResponde(reply);
  try {
    return await ctx.client.verifyPayment(CONSULTA);
  } finally {
    ctx.restore();
  }
}

test("pago nuevo confirmado por Pabilo", async () => {
  const r = await verificar({ status: 200, body: { data: { is_new: true } } });
  assert.equal(r.status, "verified_new");
  assert.equal(r.verified, true);
  assert.equal(r.isNew, true);
});

test("referencia ya usada es 'duplicate', no un error generico", async () => {
  // Antes esto caia en status "error" y el cliente leia "no pude confirmar".
  const r = await verificar({ status: 200, body: { data: { is_new: false } } });
  assert.equal(r.status, "duplicate");
  assert.equal(r.verified, false);
});

test("sin creditos (402) es reintentable, con motivo, no un rechazo", async () => {
  const r = await verificar({ status: 402, body: { error: "NO_CREDITS" } });
  assert.equal(r.status, "bank_unavailable");
  assert.equal(r.reason, "no_credits");
  assert.equal(r.verified, false);
});

test("clave vencida o mal pegada (401/403) se puede distinguir", async () => {
  assert.equal((await verificar({ status: 401, body: { error: "UNAUTHORIZED" } })).reason, "invalid_key");
  assert.equal((await verificar({ status: 403, body: { error: "FORBIDDEN" } })).reason, "invalid_key");
});

test("limite de consultas y caida del servicio tambien se reintentan", async () => {
  assert.equal((await verificar({ status: 429, body: {} })).reason, "rate_limited");
  assert.equal((await verificar({ status: 503, body: {} })).reason, "server_error");
});

test("200 sin is_new es incertidumbre: nunca un 'no' para el cliente", async () => {
  const r = await verificar({ status: 200, body: { data: {} } });
  assert.equal(r.status, "bank_unavailable");
  assert.equal(r.verified, false);
});

test("los errores con nombre de Pabilo se respetan", async () => {
  assert.equal((await verificar({ status: 404, body: { error: "PAYMENT_NOT_FOUND" } })).status, "not_found");
  assert.equal((await verificar({ status: 200, body: { error: "BANK_NOT_AVAILABLE" } })).status, "bank_unavailable");
});

test("banco receptor no registrado tiene su propio motivo", async () => {
  // Lo queThrow al bot: el plan de Pabilo venció y el banco se desregistró de
  // las dos claves. Todas las verificaciones caían como "error" y el cliente
  // leia "no pude confirmar" sin que el dueño se enterara de la causa.
  const r = await verificar({ status: 404, body: { error: "NOT_FOUND", message: "not found: user_bank not found" } });
  assert.equal(r.status, "bank_unavailable");
  assert.equal(r.reason, "bank_missing");
  assert.equal(r.verified, false);
});

test("monto que no coincide sigue siendo definitive y accionable", async () => {
  const r = await verificar({ status: 400, body: { error: "PAYMENT_AMOUNT_MISMATCH" } });
  assert.equal(r.status, "amount_mismatch");
});

test("la consulta va al banco del entorno con la clave y los 15 s de corte", async () => {
  const ctx = clienteQueResponde({ status: 200, body: { data: { is_new: true } } });
  try {
    await ctx.client.verifyPayment(CONSULTA);
  } finally {
    ctx.restore();
  }
  assert.equal(ctx.calls.length, 1);
  assert.match(ctx.calls[0].url, /\/userbankpayment\/banco-del-entorno\/betaserio$/);
  assert.equal(ctx.calls[0].init.headers.appKey, "clave-de-prueba");
  assert.equal(JSON.parse(ctx.calls[0].init.body).bank_reference, "953712");
  assert.ok(ctx.calls[0].init.signal, "debe tener timeout propio: sin el, un Pabilo colgado trava la verificacion");
});

test("sin banco configurado no se llama a la API (y no se gasta credito)", async () => {
  const ctx = clienteQueResponde({ status: 200, body: { data: { is_new: true } } });
  try {
    const r = await ctx.client.verifyPayment({ ...CONSULTA, userBankId: "" });
    assert.equal(r.status, "error");
  } finally {
    ctx.restore();
  }
  assert.equal(ctx.calls.length, 0);
});

// --- Configuracion efectiva --------------------------------------------------

const PANEL = { pabiloEnabled: true, pabiloUserBankId: "banco-viejo-del-panel", pabiloMovementType: "TRANSFER" };

test("el entorno manda sobre el panel: rotar la clave no exige abrir el admin", () => {
  const cfg = resolvePabiloConfig(PANEL);
  assert.equal(cfg.userBankId, "banco-del-entorno");
  assert.equal(cfg.source, "env");
  assert.equal(cfg.apiKeyConfigured, true);
  assert.equal(cfg.enabled, true);
});

test("si el despliegue tiene credencias, el interruptor apagado del panel no mata el servicio", () => {
  // Asi se quedo la tienda: pedidos en 'pabilo_disabled' y el cliente sin
  // respuesta. Con credenciales declaradas en el despliegue, esta activo.
  const cfg = resolvePabiloConfig({ ...PANEL, pabiloEnabled: false });
  assert.equal(cfg.configured, true);
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.panelEnabled, false);
});

