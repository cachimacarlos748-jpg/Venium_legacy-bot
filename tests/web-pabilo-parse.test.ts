// La web verifica pagos contra Pabilo igual que el bot, pero su clasificador
// estaba duplicado dentro de pabiloClient.js y nunca se ejecutó en los tests.
// Estos tests fijan esa clasificación desde el navegador, sobre el módulo real
// (webpage/src/lib/pabiloParse.js), que es el que decide si un pago se
// CONFIRMA o si el cliente recibe un rechazo.
//
// El bug que esto fija: Pabilo responde
//   {"error":"NOT_FOUND","message":"not found: user_bank not found"}
// El detalle venia SOLO en `message`. El clasificador miraba unicamente
// `error`, daba kind:"not_found" y el cliente leia "no encontramos tu pago" de
// un pago que si estaba pagado, porque el banco receptor no estava
// configurado en Pabilo. Clasificarlo como bank_missing hace que el mensaje
// diga la verdad y que el admin de turno lo vea.
import "./helpers/mock-env.js";

import test from "node:test";
import assert from "node:assert/strict";

// pabiloParse.js es codigo de la web (sin tipos). Se carga con import dinamico
// tipado como any, igual que los otros modulos de webpage/ que ya testea el
// repo (el Worker y buildBdvProxyUrl), para no duplicar declaraciones.
type Resultado = { ok: boolean; is_new?: boolean; kind?: string; error?: string };
type Clasificador = (status: number, data: Record<string, unknown> | null, raw: string) => Resultado;

async function cargarParser(): Promise<Clasificador> {
  // Ruta absoluta en URL: es el patron que ya usan bdv-proxy-worker.test.ts y
  // bdv-store-proxy-contract.test.ts para el codigo JS de webpage/, y evita
  // que tsc exija declaraciones para un modulo JavaScript.
  const ruta = new URL("../webpage/src/lib/pabiloParse.js", import.meta.url).href;
  const mod: any = await import(ruta);
  return mod.parsePabiloResponse;
}

test("200 con is_new true es el unico camino que confirma un pago", async () => {
  const parse = await cargarParser();
  const ok = parse(200, { is_new: true }, "");
  assert.equal(ok.ok, true);
  assert.equal(ok.is_new, true);

  const usada = parse(200, { is_new: false }, "");
  assert.equal(usada.ok, true);
  assert.equal(usada.is_new, false, "is_new:false es referencia ya usada, no un fallo");
});

test("200 sin veredicto NO confirma el pago", async () => {
  const parse = await cargarParser();
  const r = parse(200, { status: "ok" }, '{"status":"ok"}');
  assert.equal(r.ok, false);
  assert.equal(r.kind, "unknown");
});

test("banco receptor ausente se detecta aunque el detalle venga solo en message", async () => {
  const parse = await cargarParser();
  // Respuesta real de Pabilo cuando el user_bank_id no existe.
  const r = parse(404, { error: "NOT_FOUND", message: "not found: user_bank not found" }, "");
  assert.equal(r.kind, "bank_missing");
  assert.notEqual(r.kind, "not_found", "un banco mal configurado NUNCA se disfraza de pago rechazado");
});

test("no documents in result tambien es configuracion del banco, no pago rechazado", async () => {
  const parse = await cargarParser();
  const r = parse(400, { error: "BAD_REQUEST", message: "no documents in result" }, "");
  assert.equal(r.kind, "bank_missing");
});

test("una referencia que el banco aun no muestra es not_found, no un rechazo", async () => {
  const parse = await cargarParser();
  const r = parse(404, { error: "PAYMENT_NOT_FOUND", message: "payment not found" }, "");
  assert.equal(r.kind, "not_found");
});

test("sin creditos de verificacion se distingue del rechazo", async () => {
  const parse = await cargarParser();
  const r = parse(402, { error: "NO_CREDITS" }, "");
  assert.equal(r.kind, "no_credits");
});

test("BANK_NOT_AVAILABLE gana al 404: es el banco caido, no un pago inexistente", async () => {
  const parse = await cargarParser();
  const r = parse(404, { error: "BANK_NOT_AVAILABLE" }, "");
  assert.equal(r.kind, "bank_unavailable");
});

test("el monto que no coincide si es accionable para el cliente", async () => {
  const parse = await cargarParser();
  const r = parse(400, { error: "PAYMENT_AMOUNT_MISMATCH" }, "");
  assert.equal(r.kind, "amount");
});

test("credenciales y caidas de la plataforma se clasifican aparte", async () => {
  const parse = await cargarParser();
  assert.equal(parse(401, { error: "UNAUTHORIZED" }, "").kind, "config");
  assert.equal(parse(403, { error: "FORBIDDEN" }, "").kind, "config");
  assert.equal(parse(503, { error: "INTERNAL_SERVER_ERROR" }, "").kind, "server_error");
});