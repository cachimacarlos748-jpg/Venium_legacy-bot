import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { env } from "../../config/env.js";

/**
 * Verificacion de pagos en BDVenlinea.
 *
 * Por que navegador y no llamadas HTTP: el banco cifra las respuestas
 * (`{"resp":"<blob cifrado>"}`) con una clave que solo existe en su JS, y
 * ademas permite UNA SOLA sesion activa por cliente. Reimplementar su
 * criptografia seria fragil y, sobre todo, no serviria de nada: cualquier
 * intento de login mientras el dueño esta mirando la pagina seria rechazado
 * con "Cliente tiene una sesion activa".
 *
 * La solucion es la inversa: una sesion de navegador persistente y propia,
 * guardada en disco, que se reutiliza entre consultas. Solo vuelve a iniciar
 * sesion cuando el banco la cierra.
 */

export interface BdvMovement {
  reference: string | null;
  amount: number | null;
  date: string | null;
  description: string | null;
}

export interface BdvPaymentResult {
  verified: boolean;
  isNew: boolean;
  status: "verified_new" | "duplicate" | "not_found" | "bank_unavailable" | "error";
  raw: unknown;
}

export interface BdvClient {
  verifyPayment(input: { amount: string; bankReference: string }): Promise<BdvPaymentResult>;
  listMovements(input?: { days?: number }): Promise<BdvMovement[]>;
  close(): Promise<void>;
}

const PROFILE_DIR = resolve(process.cwd(), "data", "bdv-profile");
const HOME = env.BDV_BASE_URL;

/** "18.500,00" | "18500.00" -> number */
export function parseBs(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  let value = raw.replace(/[^\d.,-]/g, "");
  if (!value || value === "-") return null;
  if (value.lastIndexOf(",") > value.lastIndexOf(".")) {
    value = value.replace(/\./g, "").replace(",", ".");
  } else {
    value = value.replace(/,/g, "");
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function detectColumns(header: string[]): { amount: number; reference: number; date: number } {
  const indexOf = (...words: string[]) => header.findIndex((h) => words.some((w) => h.includes(w)));
  return {
    amount: Math.max(0, indexOf("monto", "importe", "valor", "debe", "haber")),
    reference: Math.max(0, indexOf("referencia", "ref", "operaci", "comprobante", "código", "codigo")),
    date: Math.max(0, indexOf("fecha")),
  };
}

export function createBdvClient(): BdvClient {
  let browser: Browser | null = null;
  let page: Page | null = null;
  let loggedIn = false;
  let lastAttempt = 0;
  let lastError = "";

  async function launch(): Promise<Page> {
    if (page && !page.isClosed() && loggedIn) return page;
    if (browser && !browser.connected) { browser = null; page = null; loggedIn = false; }

    if (!browser) {
      mkdirSync(PROFILE_DIR, { recursive: true });
      browser = await puppeteer.launch({
        headless: true,
        userDataDir: PROFILE_DIR,
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1280,900"],
      });
    }
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(HOME, { waitUntil: "networkidle2", timeout: 90_000 });
    loggedIn = false;
    return page;
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function bodyText(p: Page): Promise<string> {
    return p.evaluate(() => document.body.innerText);
  }

  /** Devuelve true si el portal quedo dentro del area de cliente. */
  async function isLoggedIn(p: Page): Promise<boolean> {
    const text = await bodyText(p);
    return !/Introduce tu contraseña|¿Olvidaste tu usuario/i.test(text);
  }

  async function login(p: Page): Promise<void> {
    await p.waitForSelector("input[type=text]", { visible: true, timeout: 30_000 });
    await p.type("input[type=text]", env.BDV_USER, { delay: 70 });
    await p.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((x) => /^Entrar$/i.test(x.innerText.trim()));
      (btn as HTMLElement | undefined)?.click();
    });
    await p.waitForSelector("input[type=password]", { visible: true, timeout: 30_000 });
    await sleep(1200);
    // Angular Material ignora la escritura a teclado tras un overlay: se inyecta
    // el valor y se disparan los eventos que el formulario escucha.
    await p.evaluate((pw: string) => {
      const el = document.querySelector("input[type=password]") as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(el, pw);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, env.BDV_PASSWORD);
    await sleep(400);
    await p.evaluate(() => {
      const btns = [...document.querySelectorAll("button")].filter((x) => /continuar/i.test(x.innerText));
      const visible = btns.filter((x) => (x as HTMLElement).offsetParent !== null);
      (visible[visible.length - 1] ?? btns[btns.length - 1])?.click();
    });

    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      const text = await bodyText(p);
      if (/sesion activa|sesión activa/i.test(text)) {
        throw new Error("BDV_SECION_ACTIVA: hay una sesion abierta en el portal. Cierra la pestana del banco y reintenta.");
      }
      if (/Contraseña es requerida|Incorrecta|incorrecto/i.test(text) && i < 6) {
        throw new Error("BDV_LOGIN_RECHAZADO: el banco no acepto el usuario o la contrasena.");
      }
      if (await isLoggedIn(p)) { loggedIn = true; return; }
    }
    throw new Error("BDV_LOGIN_TIMEOUT: el portal no respondio tras iniciar sesion.");
  }

  /** Abre la seccion de movimientos y devuelve la tabla ya parseada. */
  async function readMovements(p: Page): Promise<BdvMovement[]> {
    // Ruta real: menu ☰ → Consultas → Movimientos en linea.
    // Ojo: el codigo que corre DENTRO del navegador se pasa como texto, no como
    // funcion. Al compilar con esbuild, una funcion con nombre definida aqui
    // produce references a __name que el navegador no conoce y revienta.
    await p.evaluate(`(() => {
      const nodes = [...document.querySelectorAll('a,button,li,span,div')];
      const visible = nodes.filter(function (n) {
        const t = (n.innerText || '').trim();
        return /^Movimientos en l/i.test(t) && t.length < 45 && n.offsetParent !== null;
      });
      if (visible[0]) { visible[0].click(); return; }
      const burger = [...document.querySelectorAll('button,mat-icon,span,i')].filter(function (n) {
        return /menu/i.test((n.className || '') + ' ' + (n.getAttribute('aria-label') || ''));
      })[0];
      if (burger) {
        burger.click();
        setTimeout(function () {
          const again = [...document.querySelectorAll('a,button,li,span,div')].filter(function (n) {
            const t = (n.innerText || '').trim();
            return /^Movimientos en l/i.test(t) && t.length < 45 && n.offsetParent !== null;
          });
          if (again[0]) again[0].click();
        }, 1200);
      }
    })()`);
    await sleep(6000);

    const table = (await p.evaluate(`(() => {
      const tables = [...document.querySelectorAll('table')];
      for (const t of tables) {
        const rows = [...t.querySelectorAll('tr')];
        if (rows.length < 2) continue;
        const header = [...rows[0].querySelectorAll('th')].map(function (th) { return th.innerText.trim(); });
        if (!header.some(function (h) { return /referencia/i.test(h); })) continue;
        return {
          header: header,
          rows: rows.slice(1).map(function (tr) {
            return [...tr.querySelectorAll('td')].map(function (td) { return td.innerText.trim(); });
          })
        };
      }
      return null;
    })()`)) as { header: string[]; rows: string[][] } | null;

    // Cerramos el modal para dejar la pagina lista para la siguiente consulta.
    await p.evaluate(`(() => {
      const back = [...document.querySelectorAll('button')].filter(function (b) {
        return /^Regresar$/i.test(b.innerText.trim());
      })[0];
      if (back) back.click();
    })()`);

    if (!table) return [];
    const index = (re: RegExp, fallback: number) => {
      const i = table.header.findIndex((h) => re.test(h.toLowerCase()));
      return i === -1 ? fallback : i;
    };
    const iDate = index(/fecha/, 0);
    const iRef = index(/referencia/, 1);
    const iDesc = index(/descrip/, 2);
    const iFlow = index(/d[eé]bito|cr[eé]dito/, 3);
    const iAmount = index(/monto/, 4);

    return table.rows
      .filter((cells) => cells.length > 1)
      .map((cells) => {
        const flow = (cells[iFlow] ?? "").toUpperCase();
        return {
          reference: (cells[iRef] ?? "").replace(/\D/g, "") || null,
          amount: parseBs(cells[iAmount]),
          date: cells[iDate] || null,
          description: cells[iDesc] || null,
          // Solo entran los abonos. Los DEBITO son compras hechas por el
          // titular: contarlos seria dar por pagado lo que el cliente NUNCA
          // ha enviado.
          incoming: !flow.includes("DEBITO") || flow.includes("CREDITO"),
        };
      })
      .filter((m) => m.amount !== null && m.amount > 0 && m.incoming) as BdvMovement[] & { incoming: boolean }[];
  }

  async function withSession<T>(fn: (p: Page) => Promise<T>): Promise<T> {
    if (env.BDV_MODE === "mock") throw new Error("mock");
    if (Date.now() - lastAttempt < 15_000) {
      return { status: "bank_unavailable", error: lastError } as unknown as T;
    }
    lastAttempt = Date.now();
    try {
      const p = await launch();
      if (!loggedIn) await login(p);
      return await fn(p);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.error("[bdv]", lastError);
      // Cualquier fallo deja la sesion en estado dudoso: se descarta para que
      // el proximo intento entre limpio.
      if (page && !page.isClosed()) await page.close().catch(() => {});
      page = null;
      loggedIn = false;
      if (browser?.connected) await browser.close().catch(() => {});
      browser = null;
      throw error;
    }
  }

  return {
    async close() {
      if (browser?.connected) await browser.close().catch(() => {});
      browser = null;
      page = null;
      loggedIn = false;
    },

    async listMovements() {
      if (env.BDV_MODE === "mock") {
        return [{ reference: "0000000000", amount: 100, date: new Date().toISOString(), description: "mock" }];
      }
      try {
        return await withSession((p) => readMovements(p));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return [{ reference: null, amount: null, date: null, description: `ERROR: ${message}` }];
      }
    },

    async verifyPayment({ amount, bankReference }) {
      if (env.BDV_MODE === "mock") {
        return { verified: true, isNew: true, status: "verified_new" as const, raw: { mock: true } };
      }
      const target = parseBs(amount);
      const reference = String(bankReference || "").replace(/\D/g, "");
      if (target === null || !reference) {
        return { verified: false, isNew: false, status: "error" as const, raw: { error: "monto o referencia invalidos" } };
      }

      let movements: BdvMovement[];
      try {
        movements = await withSession((p) => readMovements(p));
      } catch (error) {
        return {
          verified: false,
          isNew: false,
          status: "bank_unavailable" as const,
          raw: { error: error instanceof Error ? error.message : "BDV no responde" },
        };
      }

      const hit = movements.find((m) => m.reference === reference);
      if (!hit) return { verified: false, isNew: false, status: "not_found" as const, raw: { checked: movements.length } };
      // Referencia correcta con monto distinto = intento de reutilizar un
      // comprobante. Nunca se acepta.
      if (hit.amount === null || Math.abs(hit.amount - target) > 0.01) {
        return {
          verified: false,
          isNew: false,
          status: "error" as const,
          raw: { error: "MONTO_NO_COINCIDE", esperado: target, encontrado: hit.amount },
        };
      }
      return { verified: true, isNew: true, status: "verified_new" as const, raw: hit };
    },
  };
}