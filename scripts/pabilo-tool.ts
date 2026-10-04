// Comprobacion de Pabilo SIN Gastar creditos: solo consulta las cuentas
// registradas (GET /me/usersbank). Sirve para dos momentos:
//
//   1. Al pegar una clave nueva, antes de que un cliente pague con ella. Una
//      verificacion fallida cuesta un credito de los 40 del mes; esta llamada
//      no.
//   2. Cuando el bot deja de confirmar pagos: casi siempre es la clave vencida
//      o sin creditos, y eso se ve en un segundo.
//
// Uso: npx tsx scripts/pabilo-tool.ts [bancos|config|probar]
import Database from "better-sqlite3";
import { createPabiloClient } from "../src/modules/pabilo/pabilo.client.js";
import { getSettings } from "../src/modules/admin/settings.service.js";
import { resolvePabiloConfig } from "../src/modules/payments/payment.service.js";
import { env } from "../src/config/env.js";

const comando = process.argv[2] ?? "config";

function mascara(valor: string): string {
  if (!valor) return "(vacia)";
  if (valor.length <= 4) return "*".repeat(valor.length);
  return "*".repeat(valor.length - 4) + valor.slice(-4);
}

const db = new Database(env.DATABASE_PATH, { readonly: true });
const cfg = resolvePabiloConfig(getSettings(db));
db.close();

console.log("--- Pabilo en este despliegue ---");
console.log("modo              :", cfg.mode);
console.log("activo            :", cfg.enabled ? "si" : "NO (los pagos no se verificarian)");
console.log("clave             :", mascara(env.PABILO_API_KEY), "(", cfg.apiKeyConfigured ? "puesta" : "FALTA", ")");
console.log("banco receptor    :", cfg.userBankId || "(FALTA)", "· viene de:", cfg.source);
console.log("interruptor panel :", cfg.panelEnabled ? "encendido" : "apagado");
console.log("tipo de movimiento :", cfg.movementType);
console.log("endpoint          :", `${cfg.baseUrl}/userbankpayment/${cfg.userBankId || "<banco>"}/betaserio`);
if (cfg.panelEnabled === false && cfg.configured) {
  console.log("aviso             : el panel dice 'apagado' pero el despliegue trae credenciales; manda el despliegue (PABILO_ENABLED=false lo apaga de verdad)");
}

if (comando === "probar") {
  // UNA consulta real de verificacion con una referencia que no existe, para
  // saber si el banco receptor esta bien dado. Es la unica forma de
  // confirmarlo, porque /me/usersbank devuelve la lista vacia en estos planes.
  // Con una referencia inexistente Pabilo responde PAYMENT_NOT_FOUND y no
  // consume crdito: el credito se gasta al ENCONTRAR un pago.
  console.log("\n--- Sondaje con referencia inexistente (no debería gastar crédito) ---");
  try {
    const r = await createPabiloClient().verifyPayment({
      userBankId: cfg.userBankId,
      amount: "1.00",
      bankReference: "9999999",
      movementType: cfg.movementType,
    });
    console.log("estado   :", r.status, r.reason ? `(${r.reason})` : "");
    console.log("respuesta:", JSON.stringify(r.raw).slice(0, 300));
    if (r.status === "bank_unavailable" && r.reason === "invalid_request") {
      console.log("\nPabilo rechazo la consulta. Casi siempre es el banco receptor equivocado o un 'movement_type' que no aplica.");
    }
    if (r.status === "not_found") console.log("\nBanco y clave aceptados: Pabilo busco y no encontro ese pago, que es lo que debia pasar.");
  } catch (error) {
    console.log("Pabilo no respondio:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (comando === "bancos") {
  console.log("\n--- Cuentas registradas (no gasta credito) ---");
  try {
    const bancos: any = await createPabiloClient().listUserBanks();
    const lista = Array.isArray(bancos?.user_banks) ? bancos.user_banks : Array.isArray(bancos) ? bancos : [];
    if (!lista.length) {
      console.log("Pabilo respondio sin cuentas:", JSON.stringify(bancos).slice(0, 300));
    }
    for (const banco of lista) {
      const id = banco?.id ?? banco?.user_bank_id ?? banco?._id ?? "?";
      console.log(`- ${id} · ${banco?.name ?? banco?.bank_name ?? "sin nombre"}${String(id) === cfg.userBankId ? "  <= en uso" : ""}`);
    }
    if (String(lista[0]?.id ?? "") !== cfg.userBankId && cfg.userBankId) {
      console.log("\nOjo: el banco en uso no aparece en la lista. Revisa PABILO_USER_BANK_ID.");
    }
  } catch (error) {
    console.log("Pabilo no respondio:", error instanceof Error ? error.message : String(error));
    console.log("Lo mas probable: la clave se vencio (o no esta puesta en este despliegue).");
    process.exitCode = 1;
  }
}
