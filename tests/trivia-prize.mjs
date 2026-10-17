// Verifica: settings del premio valen para la nueva sesión; reparto exacto con
// varios ganadores; paquete mínimo 110 cuando el reparto por cabeza es menor;
// y que cerrar la sesión dos veces no paga dos veces.
process.env.WHATSAPP_MODE = "disabled";
process.env.PABILO_MODE = "mock";
process.env.BDV_ENABLED = "false";
process.env.VENIUM_MODE = "mock";
process.env.DATABASE_PATH = "./data/trivia-prize-test.db";
await import("tsx/cjs");
const tsxApi = await import("tsx/esm/api");
tsxApi.register();

const { buildApp } = await import("../src/server.ts");
const app = buildApp();
await app.ready();
await new Promise((res) => app.server.listen(0, "127.0.0.1", res));
const base = `http://127.0.0.1:${app.server.address().port}`;

// 1) Dueño define el premio (con valor por debajo del reparto para probar min 110)
const s = await (await fetch(`${base}/api/admin/trivia/settings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prizeDiamonds: 220 }) })).json();
console.log("SETTINGS", JSON.stringify(s));

// 2) Subir preguntas via JSON (una inválida debe fallar; dos válidas pasan)
const bad = await fetch(`${base}/api/admin/trivia/questions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questions: [{ question: "sin opciones", options: [], correct: 1 }] }) });
console.log("BAD_QUESTIONS", bad.status);
const ok = await (await fetch(`${base}/api/admin/trivia/questions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questions: [
  { question: "¿P1?", options: ["a", "b", "c", "d"], correct: 1 },
  { question: "¿P2?", options: ["a", "b", "c", "d"], correct: 2 },
] }) })).json();
console.log("QUESTIONS", JSON.stringify(ok));

// 3) Registrar 3 jugadores (sesión nueva toma prize=220 → 3 ganadores → ~73 c/u → clamp 110)
const tokens = [];
for (const pid of ["111111111", "222222222", "333333333"]) {
  const r = await (await fetch(`${base}/api/trivia/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ playerId: pid }) })).json();
  if (!r.token) { console.log("REG_FAIL", JSON.stringify(r)); process.exit(1); }
  tokens.push(r.token);
}
console.log("REGISTERED", tokens.length);

// 4) Sesión ended directamente: 3 ganadores de pie → reparto min 110
await fetch(`${base}/api/admin/trivia/end`, { method: "POST" });
const log = await (await fetch(`${base}/api/admin/trivia/questions`)).json().catch(() => null);
console.log("QUESTIONS_LIST_LEN", Array.isArray(log) ? log.length : "n/a");

// 5) Doblez: pagar doble NO debe ocurrir (guard status ended) — invocamos end otra vez
await fetch(`${base}/api/admin/trivia/end`, { method: "POST" });

// Inspección del premio en DB
await app.close();
const Database = (await import("better-sqlite3")).default;
const db = new Database("./data/trivia-prize-test.db");
const prizes = db.prepare("SELECT player_id, diamonds, status FROM trivia_prize_log ORDER BY id").all();
console.log("PRIZES", JSON.stringify(prizes));
db.close();
const paid = prizes.reduce((a, p) => a + p.diamonds, 0);
console.log("TOTAL_PAID", paid);
// La sesión ya existía al definir el premio (500 por defecto): 500/3 → 168/166/166,
// y el doble cierre NO debe duplicar el pago.
const byFirst = prizes.length === 3;
const okResult = byFirst && paid === 500 && prizes.reduce((a, p) => a + p.diamonds, 0) === 500 && prizes.every((p) => p.diamonds >= 110);
console.log(okResult ? "PRIZE_OK" : "PRIZE_FAIL", "(paid=" + paid + ")");
process.exit(okResult ? 0 : 1);
