import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer, { type Browser, type Page, type ElementHandle } from "puppeteer";
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

/** El banco cierra la sesion sola por inactividad, pero cerrarla aqui evita
 *  que el dueno del portal se encuentre con "sesion activa" sin explica. */
async function logout(page: Page | null): Promise<void> {
  if (!page || page.isClosed()) return;
  try {
    await page.evaluate(`(() => {
      const burger = [...document.querySelectorAll('button,mat-icon,span,i')].filter(function (n) {
        return /menu/i.test((n.className || '') + ' ' + (n.getAttribute('aria-label') || ''));
      })[0];
      if (burger) burger.click();
    })()`);
    await new Promise((r) => setTimeout(r, 1500));
    await page.evaluate(`(() => {
      const salir = [...document.querySelectorAll('a,button,li,span')].filter(function (n) {
        return /^Salir$/i.test((n.innerText || '').trim());
      })[0];
      if (salir) salir.click();
    })()`);
    await new Promise((r) => setTimeout(r, 2500));
  } catch {
    // Cerrar sesion es una cortesia, no una operacion critica: si falla,
    // el banco la caduca por inactividad igualmente.
  }
}

const PROFILE_DIR = resolve(process.cwd(), "data", "bdv-profile");
const HOME = env.BDV_BASE_URL;

/**
 * Compara dos referencias de pago sin asumir una longitud fija.
 *
 * Los bancos varian mucho: BDV devuelve 13 digitos (0677228032099), otros
 * 8, otros 6. Ademas el BDV Sometimes antepone ceros, asi que la misma
 * operacion puede aparecer como 0677228032099 o 677228032099.
 *
 * La regla es deliberadamente estricta para no dar por pagado un comprobante
 * equivocado: primero se comparan las referencias completas; si no coinciden,
 * se acepta solo cuando una es exactamente la cola de la otra (ceros a la
 * izquierda) y la corta tiene al menos 6 digitos.
 */
export function referencesMatch(a: string, b: string): boolean {
  const x = String(a ?? "").replace(/\D/g, "");
  const y = String(b ?? "").replace(/\D/g, "");
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length < 6) return false;
  return long.endsWith(short);
}

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
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=412,900"],
      });
    }
    page = await browser.newPage();
    // El portal cambia de comportamiento segun el tamano: en movil el icono
    // "Movimientos" abre directamente la tabla; en escritorio abre un formulario
    // con "seleccionar cuenta" y "Procesar". Como el negocio se revisa desde
    // el celular, se emula ese tamano para leer la misma vista que el usuario.
    await page.setViewport({ width: 412, height: 900, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
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

  /**
   * Cierra la sesion en el portal antes de soltar el navegador.
   *
   * El BDV solo permite una sesion activa: si el proceso muere sin cerrar
   * sesion, la siguiente consulta (o el propio dueño entrando desde su
   * celular) se encuentra con "Cliente tiene una sesion activa" y espera a que
   * caduque. Cerrar aqui es lo que evita que el servicio se bloquee a si mismo.
   */
  async function logout(p: Page): Promise<void> {
    try {
      const clicked = await p.evaluate(`(() => {
        const find = function () {
          return [...document.querySelectorAll('a,button,li,span,div')].filter(function (n) {
            return n.offsetParent !== null && /^Salir$/i.test((n.innerText || '').trim());
          })[0];
        };
        if (find()) { find().click(); return 'ya visible'; }
        // El menu lateral arranca cerrado: lo abrimos con el icono ☰.
        const burger = [...document.querySelectorAll('button,mat-icon,span,i')].filter(function (n) {
          return /menu/i.test((n.className || '') + ' ' + (n.getAttribute('aria-label') || ''));
        })[0];
        if (!burger) return 'sin menu';
        burger.click();
        return 'menu abierto';
      })()`);
      if (clicked === "menu abierto") {
        await sleep(2000);
        await p.evaluate(`(() => {
          const n = [...document.querySelectorAll('a,button,li,span,div')].filter(function (x) {
            return x.offsetParent !== null && /^Salir$/i.test((x.innerText || '').trim());
          })[0];
          if (n) n.click();
        })()`);
      }
      await sleep(2500);
    } catch {
      // Un cierre fallido no debe impedir cerrar el navegador.
    }
  }

  /** Abre la seccion de movimientos y devuelve la tabla ya parseada. */
  async function readMovements(p: Page): Promise<BdvMovement[]> {
    // Camino corto: en la home, la columna "Movimientos" de la fila de la cuenta
    // tiene un icono (las "rayitas") que abre el tablero directamente.
    // Ojo: el codigo que corre DENTRO del navegador se pasa como texto, no como
    // funcion. Al compilar con esbuild, una funcion con nombre definida aqui
    // produce referencias a __name que el navegador no conoce y revienta.
    const dialogOpen = () => p.evaluate(
      `[...document.querySelectorAll('th')].some(function (th) { return /referencia/i.test(th.innerText); })`,
    );

    // El icono de "rayitas" es un <mat-icon> con la fuente ligature de Google
    // (su texto es literalmente "subject"). Llamar .click() por JS no dispara
    // el manejador: hay que hacer un clic real en sus coordenadas.
    const handle = await p.evaluateHandle(`(() => {
      for (const r of document.querySelectorAll('tr')) {
        const cells = [...r.querySelectorAll('td,th')];
        const idx = cells.findIndex(function (c) { return /^Movimientos$/i.test((c.innerText || '').trim()); });
        if (idx === -1) continue;
        const cell = cells[idx];
        const icon = cell.querySelector('mat-icon');
        return (icon && (icon.closest('button, a') || icon)) || cell;
      }
      return null;
    })()`);
    // El manejador vive en el <mat-icon> (fuente ligature, texto "subject") y no
    // reacciona a click() sintetico: hay que mover el raton a sus coordenadas.
    const clickMovimientos = async (): Promise<boolean> => {
      const box = await p.evaluate(`(() => {
        for (const r of document.querySelectorAll('tr')) {
          const cells = [...r.querySelectorAll('td,th')];
          const i = cells.findIndex(function (c) { return /^Movimientos$/i.test((c.innerText || '').trim()); });
          if (i === -1) continue;
          const icon = cells[i].querySelector('mat-icon') || cells[i];
          const b = icon.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) continue;
          return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2 });
        }
        return null;
      })()`);
      if (!box) return false;
      const { x, y } = JSON.parse(String(box)) as { x: number; y: number };
      await p.mouse.click(x, y);
      return true;
    };

    await clickMovimientos();
    await sleep(5000);

    // Se reintenta mientras el dialogo no aparezca: si se dispara antes de que
    // la home termine de pintar, el clic se pierde.
    for (let attempt = 0; attempt < 4 && !(await dialogOpen()); attempt++) {
      await sleep(2500);
      if (!(await clickMovimientos())) break;
      await sleep(3500);
    }

    // El dialogo es un formulario: hay que elegir cuenta y pulsar "Procesar"
    // antes de que aparezca la tabla.
    if (!(await dialogOpen())) {
      const abrirSelect = await p.evaluateHandle(`(() => {
        return [...document.querySelectorAll('mat-select, [role=combobox], .mat-mdc-select')].filter(function (n) {
          return n.offsetParent !== null;
        })[0] || null;
      })()`);
      const selectEl = abrirSelect.asElement() as ElementHandle<Element> | null;
      if (selectEl) {
        try { await selectEl.click(); } catch {}
        await abrirSelect.dispose();
        await sleep(2000);
        const opcion = await p.evaluateHandle(`(() => {
          return [...document.querySelectorAll('mat-option,[role=option]')].filter(function (n) {
            return n.offsetParent !== null && (n.innerText || '').trim().length > 0;
          })[0] || null;
        })()`);
        const opcionEl = opcion.asElement() as ElementHandle<Element> | null;
        if (opcionEl) {
          try { await opcionEl.click(); } catch {}
          await opcion.dispose();
        }
        await sleep(1500);
      }

      const procesar = await p.evaluateHandle(`(() => {
        return [...document.querySelectorAll('button')].filter(function (b) {
          return b.offsetParent !== null && /^Procesar$/i.test((b.innerText || '').trim());
        })[0] || null;
      })()`);
      const procesarEl = procesar.asElement() as ElementHandle<Element> | null;
      if (procesarEl) {
        try { await procesarEl.click(); } catch {}
        await procesar.dispose();
      }
      await sleep(6000);
    }

    // Si el icono no estaba (o no abrio el tablero), ruta del menu lateral:
    // ☰ → Consultas → Movimientos en linea.
    if (!(await dialogOpen())) {
      const menuHandle = await p.evaluateHandle(`(() => {
        const clickIf = function (re) {
          const n = [...document.querySelectorAll('a,button,li,span,div')].filter(function (x) {
            return x.offsetParent !== null && re.test((x.innerText || '').trim()) && (x.innerText || '').trim().length < 45;
          });
          return n[0] || null;
        };
        const directo = clickIf(/^Movimientos en l/i);
        if (directo) return directo;
        return clickIf(/^Consultas/i);
      })()`);
      const menuEl = menuHandle.asElement() as ElementHandle<Element> | null;
      if (menuEl) { try { await menuEl.click(); } catch {} await menuHandle.dispose(); }
      await sleep(2500);

      const subHandle = await p.evaluateHandle(`(() => {
        const n = [...document.querySelectorAll('a,button,li,span,div')].filter(function (x) {
          return x.offsetParent !== null && /^Movimientos en l/i.test((x.innerText || '').trim()) && (x.innerText || '').trim().length < 45;
        });
        return n[0] || null;
      })()`);
      const subEl = subHandle.asElement() as ElementHandle<Element> | null;
      if (subEl) { try { await subEl.click(); } catch {} await subHandle.dispose(); }
      await sleep(6000);
    }

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

    if (!table) {
      // Diagnostico: el portal cambio de estructura. Volcar que hay en pantalla
      // es la unica forma de adaptar el selector a ciegas.
      if (env.BDV_DEBUG) {
        const dump = await p.evaluate(`JSON.stringify({
          headers: [...document.querySelectorAll('th')].map(function(t){return t.innerText.trim();}),
          tablas: document.querySelectorAll('table').length,
          filas: document.querySelectorAll('tr').length
        })`);
        const screen = (await bodyText(p)).replace(/\n{2,}/g, " | ").slice(0, 600);
        console.log("[bdv] no se encontro la tabla. headers:", dump);
        console.log("[bdv] pantalla:", screen);
      }
      return [];
    }
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

  async function shutdown(): Promise<void> {
    if (page && !page.isClosed()) await logout(page).catch(() => {});
    if (browser?.connected) await browser.close().catch(() => {});
    browser = null;
    page = null;
    loggedIn = false;
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
      // Cualquier fallo deja la sesion en estado dudoso: se cierra con "Salir"
      // para que el proximo intento (o el dueño) puedan entrar sin esperar.
      await shutdown();
      throw error;
    }
  }

  return {
    async close() {
      if (page && !page.isClosed()) await logout(page).catch(() => {});
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

      const hit = movements.find((m) => m.reference && referencesMatch(m.reference, reference));
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