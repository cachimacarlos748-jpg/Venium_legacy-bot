// Prueba end-to-end de la trivia: registro, chat, respuestas (una correcta,
// otra fallida que gasta corazón y revive), y final con reparto de premio.
process.env.WHATSAPP_MODE = "disabled";
process.env.PABILO_MODE = "mock";
process.env.BDV_ENABLED = "false";
process.env.VENIUM_MODE = "mock";
// BD propia del test: una corrida fallida anterior dejaba una fila de jugador
// con hearts=0 y el tope diario bloqueaba nuevos corazones en la BD compartida.
process.env.DATABASE_PATH = "./data/trivia-full-test.db";
await import("tsx/cjs");
const tsxApi = await import("tsx/esm/api");
tsxApi.register();

const { buildApp } = await import("../src/server.ts");
const app = buildApp();
await app.ready();
const http = app.server;
await new Promise((res) => http.listen(0, "127.0.0.1", res));
const port = http.address().port;
const base = `http://127.0.0.1:${port}`;
console.log("BOOTED", port);

// Dar corazones al jugador de prueba (como si hubiera comprado).
await fetch(`${base}/api/admin/trivia/grant-heart`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ playerId: "7879946990", orderId: `e2e-${Date.now()}` }),
});

const reg = await (await fetch(`${base}/api/trivia/register`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ playerId: "7879946990" }),
})).json();
console.log("REGISTER", reg.token ? `ok token=${reg.token.slice(0, 8)}… hearts=${reg.hearts}` : JSON.stringify(reg));

const { WebSocket } = await import("ws");
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/trivia?token=${reg.token}`);
const events = [];
let currentIdx = -1;
let answered = 0;

ws.on("message", async (raw) => {
  let msg;
  try { msg = JSON.parse(String(raw)); } catch { return; }
  if (msg.type === "question") {
    currentIdx = msg.idx;
    events.push(`Q${msg.idx}`);
    // Si el backend revela la correcta (modo test), acierta siempre para el
    // camino ganador; si no, responde A (puede fallar y gastar corazón).
    const chosen = typeof msg.correct === "number" ? msg.correct : 1;
    setTimeout(() => {
      ws.send(JSON.stringify({ type: "answer", chosen, msTaken: 4200 }));
      answered++;
    }, 1500);
  } else if (msg.type === "reveal") {
    events.push(`R(${msg.correct})`);
  } else if (msg.type === "ended") {
    events.push(`END prize=${msg.prize} winners=${(msg.winners || []).length}`);
    console.log("WINNERS", JSON.stringify(msg.winners));
  } else if (msg.type === "you") {
    events.push(`YOU(${msg.status},${msg.hearts})`);
    console.log("YOU", msg.status, "hearts:", msg.hearts);
  }
});
ws.on("open", () => {
  ws.send(JSON.stringify({ type: "chat", text: "probando chat e2e" }));
});
ws.on("error", (e) => console.log("WS_ERROR", e.message));

// Arranca el juego de una vez (admin endpoint de prueba).
setTimeout(async () => {
  await fetch(`${base}/api/admin/trivia/start-test`, { method: "POST" }).catch(() => {});
}, 800);

// Las 10 preguntas × ~15 s es largo; a los 100 s cerramos la sesión (endpoint
// admin end) para probar el reparto de premio, y evaluamos a 115 s.
setTimeout(async () => {
  await fetch(`${base}/api/admin/trivia/end`, { method: "POST" }).catch(() => {});
  console.log("END_REQUESTED");
}, 100_000);

setTimeout(async () => {
  console.log("TIMELINE", events.join(" "));
  console.log("ANSWERED", answered);
  try { ws.close(); } catch {}
  await app.close();
  const ok = events.some((e) => e.startsWith("END")) && answered >= 8;
  console.log(ok ? "E2E_OK" : "E2E_INCOMPLETE");
  process.exit(ok ? 0 : 1);
}, 115_000);
