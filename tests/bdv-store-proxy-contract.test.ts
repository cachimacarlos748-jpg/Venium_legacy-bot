// Contrato tienda <-> Worker de BDV. El Worker exige la llave publica en la
// query (?key=) y responde 401 sin ella, lo que rompe el boton "Verificar
// pago" de la web. Aqui se pasa la URL que REALMENTE construye la tienda (el
// mismo modulo que usa pabiloClient.js) al handler REAL del Worker: si las dos
// piezas se desincronizan, esto falla.
import "./helpers/mock-env.js";

import test from "node:test";
import assert from "node:assert/strict";

const SECRET = "llave-secreta-del-proxy";
const BOT_URL = "https://bot.example.com";
const workerPath = new URL("../webpage/src/proxy/bdv-verify.worker.js", import.meta.url).href;
const storePath = new URL("../webpage/src/lib/bdvProxyUrl.js", import.meta.url).href;

type FetchHandler = (request: Request, env: Record<string, string>) => Promise<Response>;

test("la URL que arma la tienda es aceptada por el Worker y reenvia al bot", async () => {
  const workerMod: any = await import(workerPath);
  const storeMod: any = await import(storePath);
  const handler: FetchHandler = workerMod.default.fetch;
  assert.equal(typeof storeMod.buildBdvProxyUrl, "function", "buildBdvProxyUrl debe estar exportado");

  const botCalls: Array<{ url: string; headers?: Record<string, string>; body?: string }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    botCalls.push({ url: String(url), headers: init?.headers, body: init?.body });
    return new Response(JSON.stringify({ verified: true, isNew: true, raw: { reference: "953712", amount: 790 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as any;

  try {
    const urlTienda = storeMod.buildBdvProxyUrl("https://worker.example.com/");
    const req = new Request(urlTienda, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: "790", reference: "953712" }),
    });
    const res = await handler(req, { BOT_URL, BDV_VERIFY_KEY: SECRET });

    assert.equal(res.status, 200, `el Worker debe aceptar la URL de la tienda (llego: ${urlTienda})`);
    assert.equal(botCalls.length, 1);
    assert.equal(botCalls[0].url, "https://bot.example.com/api/bdv/verify");
    assert.equal(botCalls[0].headers?.["X-BDV-Key"], SECRET);
    assert.ok(!String(botCalls[0].body).includes(SECRET), "la clave nunca viaja en el cuerpo");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("el Worker rechaza la misma peticion sin la llave publica", async () => {
  const workerMod: any = await import(workerPath);
  const storeMod: any = await import(storePath);
  const handler: FetchHandler = workerMod.default.fetch;

  const llave = new URL(storeMod.buildBdvProxyUrl("https://worker.example.com")).searchParams.get("key");
  assert.ok(llave && llave.length > 0, "buildBdvProxyUrl debe agregar ?key=");

  const res = await handler(
    new Request("https://worker.example.com/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: "790", reference: "953712" }),
    }),
    { BOT_URL, BDV_VERIFY_KEY: SECRET },
  );
  assert.equal(res.status, 401, "sin ?key= el Worker no debe dar paso");
});
