// Utilidad de mantenimiento del portal BDVenlínea.
//
//   npx tsx scripts/bdv-tool.ts logout              → pulsa "Salir" en la sesion abierta
//   npx tsx scripts/bdv-tool.ts movements           → lista los movimientos leidos del banco
//   npx tsx scripts/bdv-tool.ts verify 1.00 910795687 → verifica referencia + monto
//
// "logout" no vuelve a iniciar sesion: entra con el perfil persistente y, si
// el banco todavia tiene la sesion abierta, pulsa Salir. Es la forma de
// liberar un "Cliente tiene una sesion activa" sin esperar los ~3 minutos.
import { createBdvClient } from "../src/modules/bdv/bdv.browser.js";

const action = process.argv[2] ?? "logout";
const bdv = createBdvClient();

try {
  if (action === "logout") {
    console.log(JSON.stringify(await bdv.forceLogout(), null, 2));
  } else if (action === "movements") {
    console.log(JSON.stringify(await bdv.listMovements(), null, 2));
  } else if (action === "verify") {
    const amount = process.argv[3] ?? "1.00";
    const reference = process.argv[4] ?? "";
    console.log(JSON.stringify(await bdv.verifyPayment({ amount, bankReference: reference }), null, 2));
  } else {
    console.error(`accion desconocida: ${action}`);
    process.exitCode = 2;
  }
} finally {
  await bdv.close();
}
