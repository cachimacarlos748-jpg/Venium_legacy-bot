// El endpoint de verificación de la web contra BDVenlínea solo debe responderle
// al proxy con la clave correcta. Lo que se prueba aquí es la cerradura:
// sin clave configurada NO se abre nunca, y con la clave solo entra la clave.
import "./helpers/mock-env.js";

import test from "node:test";
import assert from "node:assert/strict";
import { checkBdvVerifyAccess } from "../src/modules/bdv/verify-access.js";

test("sin BDV_VERIFY_KEY configurado el verificador queda cerrado", () => {
  assert.equal(checkBdvVerifyAccess("cualquiera", ""), "not_configured");
  assert.equal(checkBdvVerifyAccess("", undefined), "not_configured");
  // Aunque alguien acierte el valor vacío, sigue cerrado.
  assert.equal(checkBdvVerifyAccess("", ""), "not_configured");
});

test("con clave configurada solo entra la clave exacta", () => {
  const secret = "clave-del-proxy";
  assert.equal(checkBdvVerifyAccess(secret, secret), "ok");
  assert.equal(checkBdvVerifyAccess("otra-cosa", secret), "unauthorized");
  assert.equal(checkBdvVerifyAccess("", secret), "unauthorized");
  assert.equal(checkBdvVerifyAccess(undefined, secret), "unauthorized");
  assert.equal(checkBdvVerifyAccess(secret.toUpperCase(), secret), "unauthorized", "la clave distingue mayúsculas");
});