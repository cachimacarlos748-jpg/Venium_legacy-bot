// El proxy de Cloudflare es la única puerta de la tienda hacia BDVenlínea:
// guarda la clave compartida como secreto y se la pasa al bot en la cabecera.
// Estos tests fijan ese contrato: la clave nunca llega al cuerpo ni al
// navegador, y el proxy no sirve de atajo cuando falta configuracion.
import "./helpers/mock-env.js";

import test from "node:test";
import assert from "node:assert/strict";

const SECRET = "llave-secreta-del-proxy";
const workerPath = new URL("../webpage/src/proxy/bdv-verify.worker.js", import.meta.url).href;

type FetchHandler = (request: Request, env: Record<string, string>) => Promise<Response>;

async function loadWorker(): Promise<FetchHandler> {
  const mod: any = await import(workerPath);
  return mod.default.fetch;
}

// Ejecuta el handler con el fetch global simulado y devuelve lo que se habría
// enviado al bot.
async function callWorker(
  handler: FetchHandler,
  options: { url?: string; method?: string; body?: unknown; env: Record<string, string> },
): Promise<{ response: Response; calls: Array<{ url: string; headers?: Record<string, string>; body?: string }> }> {
  const calls: Array<{ url: string; headers?: Record<string, string>; body?: string }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), headers: init?.headers, body: init?.body });
    return new Response(JSON.stringify({ verified: true, isNew: true }), { status: 200 });
  }) as any;
  try {
    const method = options.method ?? "POST";
    // Un GET/HEAD no admite cuerpo: se omite para no construirlos inválidos.
    const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
    if (method !== "GET" && method !== "HEAD") {
      init.body = JSON.stringify(options.body ?? { amount: "790", reference: "953712" });
    }
    const request = new Request(options.url ?? "https://worker.example.com/?key=legacy_bdv_2025", init);
    return { response: await handler(request, options.env), calls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("el proxy rechaza a quien no trae la llave publica", async () => {
  const handler = await loadWorker();
  const { response, calls } = await callWorker(handler, {
    url: "https://worker.example.com/?key=equivocada",
    env: { BOT_URL: "https://bot.example.com", BDV_VERIFY_KEY: SECRET },
  });
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0, "no debe tocar el bot");
});

test("sin secretos configurados el proxy se cierra (503)", async () => {
  const handler = await loadWorker();
  const sinUrl = await callWorker(handler, { env: { BDV_VERIFY_KEY: SECRET } });
  assert.equal(sinUrl.response.status, 503);
  assert.equal(sinUrl.calls.length, 0);
  const sinClave = await callWorker(handler, { env: { BOT_URL: "https://bot.example.com" } });
  assert.equal(sinClave.response.status, 503);
});

test("el proxy manda la clave SOLO en la cabecera y reenvía monto y referencia", async () => {
  const handler = await loadWorker();
  const { response, calls } = await callWorker(handler, {
    env: { BOT_URL: "https://bot.example.com/", BDV_VERIFY_KEY: SECRET },
    body: { amount: "790", reference: "953712" },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json() as any).verified, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://bot.example.com/api/bdv/verify");
  assert.equal(calls[0].headers?.["X-BDV-Key"], SECRET);
  assert.ok(!String(calls[0].body).includes(SECRET), "la clave nunca viaja en el cuerpo");
  assert.equal(calls[0].body, JSON.stringify({ amount: "790", reference: "953712" }));
});

test("faltan datos o método incorrecto: responde sin llamar al bot", async () => {
  const handler = await loadWorker();
  const sinReferencia = await callWorker(handler, {
    env: { BOT_URL: "https://bot.example.com", BDV_VERIFY_KEY: SECRET },
    body: { amount: "790" },
  });
  assert.equal(sinReferencia.response.status, 400);
  assert.equal(sinReferencia.calls.length, 0);

  const metodo = await callWorker(handler, {
    method: "GET",
    env: { BOT_URL: "https://bot.example.com", BDV_VERIFY_KEY: SECRET },
  });
  assert.equal(metodo.response.status, 405);
  assert.equal(metodo.calls.length, 0);
});