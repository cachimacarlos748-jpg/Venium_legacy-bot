// Smoke test del motor de trivia: arranca el server, registra, abre WS real
// y fuerza el countdown para comprobar que las preguntas llegan.
process.env.WHATSAPP_MODE = "disabled";
process.env.PABILO_MODE = "mock";
process.env.BDV_ENABLED = "false";
process.env.VENIUM_MODE = "mock";
// Registrar el loader de tsx para que los .js en imports de ESM resuelvan los .ts.
await import("tsx/cjs");
await import("tsx/esm/api").then((m) => m.register());

const { buildApp } = await import("../src/server.ts");
const app = buildApp();
await app.ready();
const http = app.server;
await new Promise((res) => http.listen(0, "127.0.0.1", res));
const port = http.address().port;
console.log("BOOTED", port);

const stateRes = await fetch(`http://127.0.0.1:${port}/api/trivia/state`);
console.log("STATE", JSON.stringify(await stateRes.json()));

const regRes = await fetch(`http://127.0.0.1:${port}/api/trivia/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ playerId: "7879946990" }),
});
const reg = await regRes.json();
console.log("REGISTER", JSON.stringify(reg));

const { WebSocket } = await import("ws");
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/trivia?token=${reg.token || ""}`);
const seen = new Set();
ws.on("open", () => {
  console.log("WS_OPEN");
  ws.send(JSON.stringify({ type: "chat", text: "hola desde el smoke test" }));
  // Forzar que empiece el juego ahora.
  fetch(`http://127.0.0.1:${port}/api/admin/trivia/start-test`, { method: "POST" }).catch(() => {});
});
ws.on("message", (m) => {
  const s = String(m).slice(0, 300);
  try {
    const msg = JSON.parse(s);
    if (!seen.has(msg.type)) { seen.add(msg.type); console.log("WS_MSG", s); }
  } catch { console.log("WS_RAW", s); }
});
ws.on("error", (e) => console.log("WS_ERROR", e.message));
setTimeout(async () => {
  console.log("SEEN_TYPES", [...seen].join(","));
  try { ws.close(); } catch {}
  await app.close();
  process.exit(seen.has("question") ? 0 : 1);
}, 25_000);
