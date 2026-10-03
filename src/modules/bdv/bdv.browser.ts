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
  // "amount_mismatch": la referencia existe en el banco pero el monto no
  // coincide con el del pedido. Es el caso que el cliente DEBE conocer con
  // nombre propio ("pagaste otro monto"), no un error genérico.
  status: "verified_new" | "duplicate" | "not_found" | "amount_mismatch" | "bank_unavailable" | "error";
  raw: unknown;
}

export interface BdvClient {
  verifyPayment(input: { amount: string; bankReference: string }): Promise<BdvPaymentResult>;
  listMovements(input?: { days?: number }): Promise<BdvMovement[]>;
  /** Pulsa "Salir" en la sesion abierta SIN volver a entrar: libera el
   *  bloqueo "Cliente tiene una sesion activa" que deja el banco. */
  forceLogout(): Promise<{ ok: boolean; note: string }>;
  close(): Promise<void>;
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
  // Singleton: dos instancias lanzarian dos Chrome sobre el mismo perfil y
  // el banco solo admite una sesion. server.ts y payment.service comparten
  // el mismo cliente.
  if (!singleton) singleton = createBdvClientOnce();
  return singleton;
}

let singleton: BdvClient | null = null;

function createBdvClientOnce(): BdvClient {
  let browser: Browser | null = null;
  let page: Page | null = null;
  let loggedIn = false;
  let lastAttempt = 0;
  let lastError = "";
  // Cola de verificaciones: el portal solo admite una consulta por sesion.
  let cadena: Promise<unknown> = Promise.resolve();

  async function launch(): Promise<Page> {
    if (page && !page.isClosed() && loggedIn) return page;
    if (browser && !browser.connected) { browser = null; page = null; loggedIn = false; }

    if (!browser) {
      mkdirSync(PROFILE_DIR, { recursive: true });
      browser = await puppeteer.launch({
        headless: true,
        userDataDir: PROFILE_DIR,
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=480,900"],
      });
    }
    // Se reutiliza la pestana en vez de abrir una nueva por consulta: asi el
    // estado del portal sobrevive entre llamadas.
    if (!page || page.isClosed()) {
      page = await browser.newPage();
      // El portal cambia de comportamiento segun el tamano: en movil el icono
      // "Movimientos" abre directamente la tabla; en escritorio abre un formulario
      // con "seleccionar cuenta" y "Procesar". Como el negocio se revisa desde
      // el celular, se emula ese tamano para leer la misma vista que el usuario.
      // 480px a proposito: a 412 el panel de la home queda POR ENCIMA del
      // icono de la columna Movimientos (document.elementFromPoint devuelve
      // APP-POSICIONCONSOLIDADA) y el toque se lo come el overlay. A 480 el
      // icono queda accesible y abre la tabla de movimientos al instante.
      await page.setViewport({ width: 480, height: 900, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    }
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
    if (/Introduce tu|Olvidaste tu usuario/i.test(text)) return false;
    // Marcadores del area privada. Sin ellos no se da por abierta la sesion:
    // asi "Salir" puede confirmar que el portal volvio a la pantalla de acceso.
    return /Transferencias|Consultas|Divisas|CUENTA CLAVE/i.test(text);
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

  // ---------------------------------------------------------------------------
  // Pulsar botones de Angular Material con el raton de verdad.
  //
  // El portal ignora los .click() sinteticos (comprobado con el icono de
  // Movimientos): sus manejadores solo reaccionan a eventos de raton reales.
  // Por eso se busca el elemento y se pulsa con page.mouse en sus coordenadas,
  // descartando lo que este fuera de pantalla (menus cerrados, elementos con
  // tamano cero...).
  // ---------------------------------------------------------------------------

  const CAND_SALIR = `[...document.querySelectorAll('a,button,li,span')].filter(function (n) {
    return /^(salir|cerrar sesi[oó]n)$/i.test((n.innerText || '').trim());
  })`;

  const CAND_CONFIRMAR = `[...document.querySelectorAll('button,a,span')].filter(function (n) {
    return /^(s[ií]|aceptar|confirmar)$/i.test((n.innerText || '').trim());
  })`;

  const CAND_CONSULTAS = `[...document.querySelectorAll('a,button,li,span')].filter(function (n) {
    const t = (n.innerText || '').trim();
    return /^Consultas/i.test(t) && t.length < 25;
  })`;

  const CAND_MOVS = `[...document.querySelectorAll('a,button,li,span')].filter(function (n) {
    const t = (n.innerText || '').trim();
    return /^Movimientos en l/i.test(t) && t.length < 45;
  })`;

  const CAND_REGRESAR = `[...document.querySelectorAll('button,a,span')].filter(function (n) {
    return /^Regresar$/i.test((n.innerText || '').trim());
  })`;

  const CAND_CUENTA = `[...document.querySelectorAll('mat-select,[role=combobox],.mat-mdc-select')].filter(function (n) { return n.offsetParent !== null; })`;

  // El icono de la columna "Movimientos" de la home. Su texto es la ligadura de
  // fuente "subject", y SOLO se puede pulsar si el elemento que hay en su punto
  // es el propio icono: a 412px lo tapa el overlay de la pagina.
  const CAND_MOVS_ICON = `[...document.querySelectorAll('mat-icon,i,span')].filter(function (n) {
    if ((n.innerText || '').trim() !== 'subject') return false;
    const r = n.getBoundingClientRect();
    if (!r.width || !r.height || r.width > 60 || r.height > 60) return false;
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
    var top = document.elementFromPoint(x, y);
    return !!top && (top === n || n.contains(top) || top.contains(n));
  })`;

  const CAND_OPCION = `[...document.querySelectorAll('mat-option,[role=option]')].filter(function (n) { return n.offsetParent !== null && (n.innerText || '').trim().length > 3; })`;

  const CAND_7DIAS = `[...document.querySelectorAll('mat-radio-button,[type=radio],[role=radio]')].filter(function (n) { return /7 dias|7 días/i.test((n.innerText || '') + (n.getAttribute('aria-label') || '')) && n.getClientRects().length; })`;

  const CAND_PROCESAR = `[...document.querySelectorAll('button,a')].filter(function (n) { return /^(Procesar|Consultar|Buscar)$/i.test((n.innerText || '').trim()); })`;

  // El ☰ es un <mat-icon> cuya ligadura de fuente es "menu"; algunos temas
  // solo lo identifican por aria-label.
  const CAND_MENU = `[...document.querySelectorAll('button,mat-icon,span,i,a')].filter(function (n) {
    return (n.innerText || '').trim().toLowerCase() === 'menu'
      || /menu|hamburg/i.test(n.getAttribute('aria-label') || '');
  })`;

  /** Pulsa con el raton el primer candidato que este visible en pantalla. */
  async function clickFirst(p: Page, candidates: string): Promise<boolean> {
    const box = (await p.evaluate(`(() => {
      const list = ${candidates};
      for (const node of list) {
        if (node.offsetParent === null) continue;
        if (!node.getClientRects().length) continue;
        try { node.scrollIntoView({ block: 'center' }); } catch (e) {}
        const rect = node.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
        return JSON.stringify({ x: x, y: y });
      }
      return null;
    })()`)) as string | null;
    if (!box) return false;
    const { x, y } = JSON.parse(box) as { x: number; y: number };
    await p.mouse.click(x, y);
    return true;
  }

  /**
   * Toca con el dedo (touchscreen) el primer candidato visible. El icono de
   * "Movimientos" de la home solo responde a un toque real, no a un clic de
   * raton simulado.
   */
  async function tapFirst(p: Page, candidates: string): Promise<boolean> {
    const box = (await p.evaluate(`(() => {
      const list = ${candidates};
      for (const node of list) {
        if (!node.getClientRects().length) continue;
        const rect = node.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
        return JSON.stringify({ x: x, y: y });
      }
      return null;
    })()`)) as string | null;
    if (!box) return false;
    const { x, y } = JSON.parse(box) as { x: number; y: number };
    await p.touchscreen.tap(x, y);
    return true;
  }

  /**
   * Cierra la sesion pulsando "Salir" (clic de raton real) y confirma que el
   * portal volvio a la pantalla de acceso. Devuelve true solo en ese caso.
   *
   * El BDV permite UNA sola sesion por cliente. Si el proceso termina sin
   * despedirse, el banco la mantiene ~3 minutos y tanto el servicio como el
   * propio dueño del portal se topan con "Cliente tiene una sesion activa".
   * Por eso este paso se ejecuta tambien cuando algo falla a mitad de camino.
   */
  async function logout(p: Page): Promise<boolean> {
    try {
      // Un modal abierto (p. ej. la tabla de movimientos) se cierra con Esc.
      await p.keyboard.press("Escape").catch(() => {});
      await sleep(500);
      await p.keyboard.press("Escape").catch(() => {});
      await sleep(500);

      for (let round = 0; round < 4; round++) {
        if (round === 1) {
          // Si "Salir" no aparecio a la primera (p. ej. estamos en una pantalla
          // interna como Consulta de Movimientos), se vuelve a la home UNA vez:
          // la sesion vive en el navegador y ahi el menu lateral esta siempre.
          // No se repite en cada vuelta: recargar cerraria el menu recien
          // abierto y "Salir" no se alcanzaria nunca.
          await p.goto(HOME, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
          await sleep(2500);
        }
        if (!(await isLoggedIn(p))) {
          loggedIn = false;
          return true;
        }
        // 1) "Salir" ya visible (barra lateral fija o menu desplegado).
        if (await clickFirst(p, CAND_SALIR)) {
          await sleep(1800);
          // Algunos perfiles piden confirmacion antes de salir.
          await clickFirst(p, CAND_CONFIRMAR);
          await sleep(3000);
          if (!(await isLoggedIn(p))) {
            // Margen extra: el portal cambia de pantalla al instante, pero la
            // peticion de cierre viaja al banco despues. Cerrar Chrome aqui
            // mismo la cancelaria y el banco seguiria viendo la sesion activa.
            await sleep(3500);
            loggedIn = false;
            if (env.BDV_DEBUG) console.log("[bdv] sesion cerrada con Salir");
            return true;
          }
        }
        // 2) En movil el menu arranca cerrado: se abre con ☰ y en la vuelta
        //    siguiente "Salir" ya estara dentro de la pantalla.
        await clickFirst(p, CAND_MENU);
        await sleep(2200);
      }

      const done = !(await isLoggedIn(p));
      if (done) loggedIn = false;
      else if (env.BDV_DEBUG) {
        const screen = (await bodyText(p)).replace(/\s+/g, " ").slice(0, 240);
        console.log("[bdv] no se pudo pulsar Salir. pantalla:", screen);
      }
      return done;
    } catch {
      return false;
    }
  }

  /**
   * Abre "Movimientos en linea" por el menu lateral: ☰ → Consultas → opcion.
   * El icono de la fila de la cuenta no responde a ningun clic (su <mat-icon>
   * es pointer-events:none), asi que esta es la via real en vista movil.
   */
  async function abrirMovimientosPorMenu(p: Page): Promise<void> {
    const t = Date.now();
    await clickFirst(p, CAND_MENU);
    await sleep(1400);
    // Si el submenu ya estuviera desplegado, la opcion aparece directamente.
    if (!(await clickFirst(p, CAND_MOVS))) {
      await clickFirst(p, CAND_CONSULTAS);
      await sleep(1600);
      await clickFirst(p, CAND_MOVS);
    }
    await sleep(2000);
    if (env.BDV_DEBUG) console.log("[bdv] navegacion al formulario:", Date.now() - t, "ms");
  }/**
   * Lee los movimientos de la cuenta.
   *
   * Via rapida: en la home, un TOQUE en el icono de la columna "Movimientos"
   * (las rayitas) abre la tabla directamente, sin menus ni formulario (~2-5 s).
   * Es la via que funciona tocandolo con el dedo en el movil del dueno.
   *
   * Via de respaldo: menu lateral (☰ → Consultas → Movimientos en linea) +
   * formulario (cuenta + Ultimos 7 dias + Procesar), ~27 s.
   */
  async function readMovements(p: Page, forzarMenu = false): Promise<BdvMovement[]> {
    // La tabla aparece cuando un <th> dice "Referencia". Ojo: el codigo que
    // corre DENTRO del navegador se pasa como texto, no como funcion (esbuild
    // inyectaria __name que el navegador no conoce).
    const dialogOpen = () => p.evaluate(
      `[...document.querySelectorAll('th')].some(function (th) { return /referencia/i.test(th.innerText); })`,
    );

    // 1) Via rapida (experimental, desactivada por defecto): tocar el icono de
    //    la columna Movimientos en la home. Abre la tabla en ~2 s cuando
    //    funciona, pero en pruebas resulto inestable (a veces el toque no abre
    //    nada y deja la pagina en un estado que rompe la consulta siguiente).
    //    Se activa con BDV_FAST_ICON=true una vez se haya medido en produccion.
    if (env.BDV_FAST_ICON && !forzarMenu && !(await dialogOpen())) {
      const t = Date.now();
      if (await tapFirst(p, CAND_MOVS_ICON)) {
        for (let i = 0; i < 8 && !(await dialogOpen()); i++) await sleep(1000);
        if (env.BDV_DEBUG) console.log("[bdv] icono movimientos:", Date.now() - t, "ms");
        // Si no se abre, cerrar el panel para no ensuciar la via del menu.
        if (!(await dialogOpen())) {
          await p.keyboard.press("Escape").catch(() => {});
          await sleep(1500);
        }
      }
    }

    // 2) Respaldo: menu lateral + formulario.
    if (!(await dialogOpen())) await abrirMovimientosPorMenu(p);

    // 2) El dialogo es un formulario: Procesar sigue deshabilitado hasta
    //    elegir la cuenta (activar el radio no basta). Flujo verificado:
    //    select cuenta -> opcion -> radio "Ultimos 7 dias" -> Procesar.
    //    Todo con clic real de raton: el portal ignora los .click() sinteticos.
    //
    //    NO se espera a la tabla antes del formulario: en este portal la tabla
    //    solo existe DESPUES de pulsar "Procesar" (esperarla antes gastaba 30 s
    //    inutiles en cada verificacion).
    if (!(await dialogOpen())) {
      const tF = Date.now();
      await clickFirst(p, CAND_CUENTA);
      await sleep(1200);
      await clickFirst(p, CAND_OPCION);
      await sleep(1000);
      await clickFirst(p, CAND_7DIAS);
      await sleep(800);
      await clickFirst(p, CAND_PROCESAR);
      // La consulta al banco tarda unos segundos: se sondea cada 1 s sin
      // recargar (recargar mataria el formulario y la sesion).
      for (let i = 0; i < 20 && !(await dialogOpen()); i++) await sleep(1000);
      if (env.BDV_DEBUG) console.log("[bdv] formulario+consulta:", Date.now() - tF, "ms");
    }

    const table = (await p.evaluate(`(() => {
      // La tabla real es un mat-table (usa th/td con roles ARIA), no un
      // <table> puro: hay que buscar en ambos.
      const tables = [...document.querySelectorAll('table,[role=grid],mat-table')];
      for (const t of tables) {
        const headers = [...t.querySelectorAll('th,[role=columnheader]')].map(function (h) { return h.innerText.trim(); });
        if (!headers.some(function (h) { return /referencia/i.test(h); })) continue;
        const rows = [...t.querySelectorAll('tr,[role=row]')];
        return {
          header: headers,
          rows: rows
            .filter(function (tr) { return tr.querySelectorAll('td,[role=gridcell]').length > 1; })
            .map(function (tr) {
              return [...tr.querySelectorAll('td,[role=gridcell]')].map(function (td) { return td.innerText.trim(); });
            })
        };
      }
      return null;
    })()`)) as { header: string[]; rows: string[][] } | null;

    // "Regresar" deja la home lista para la siguiente consulta (si existe).
    await clickFirst(p, CAND_REGRESAR);
    await sleep(1500);

    if (!table) {
      // Diagnostico: el portal cambio de estructura. Volcar que hay en pantalla
      // es la unica forma de adaptar el selector a ciegas.
      if (env.BDV_DEBUG) {
        const dump = await p.evaluate(`JSON.stringify({
          headers: [...document.querySelectorAll('th')].map(function(t){return t.innerText.trim();}),
          tablas: document.querySelectorAll('table').length,
          filas: document.querySelectorAll('tr').length,
          dialogos: document.querySelectorAll('mat-dialog-container,.cdk-overlay-pane').length
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
    // Deja respirar la peticion de cierre antes de matar el navegador.
    if (page && !page.isClosed()) await sleep(1500);
    if (browser?.connected) await browser.close().catch(() => {});
    browser = null;
    page = null;
    loggedIn = false;
  }

  async function withSession<T>(fn: (p: Page) => Promise<T>): Promise<T> {
    if (env.BDV_MODE === "mock") throw new Error("mock");
    // El banco admite UNA consulta a la vez y la sesion es unica: las
    // verificaciones se encadenan en vez de rechazarse (dos clientes a la vez
    // no produce un error, produce "el segundo espera 15 s").
    const anterior = cadena;
    let liberar!: () => void;
    cadena = new Promise<void>((r) => { liberar = r; });
    await anterior;
    lastAttempt = Date.now();
    try {
      return await runSession<T>(fn);
    } finally {
      liberar();
    }
  }

  async function runSession<T>(fn: (p: Page) => Promise<T>): Promise<T> {
    try {
      const p = await launch();
      if (!loggedIn) {
        // El perfil persistente puede haber dejado la sesion anterior viva:
        // si el portal ya nos deja dentro se usa tal cual (evita el login y,
        // con el, el bloqueo "sesion activa" si todavia estuviera abierta).
        await sleep(1500);
        if (await isLoggedIn(p)) loggedIn = true;
        else await login(p);
      }
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
      await shutdown();
      singleton = null;
    },

    // Pulsa "Salir" sobre la sesion abierta SIN volver a iniciar sesion: es
    // la herramienta para liberar un "Cliente tiene una sesion activa" cuando
    // un proceso anterior no pudo despedirse del banco.
    async forceLogout() {
      if (env.BDV_MODE === "mock") return { ok: true, note: "BDV_MODE=mock" };
      try {
        const p = await launch();
        await sleep(3000);
        if (!(await isLoggedIn(p))) {
          return { ok: true, note: "el banco ya no tenia sesion abierta" };
        }
        const closed = await logout(p);
        return closed
          ? { ok: true, note: "sesion cerrada con Salir" }
          : { ok: false, note: "no se encontro Salir en pantalla; la sesion caduca sola en ~3 minutos" };
      } catch (error) {
        return { ok: false, note: error instanceof Error ? error.message : String(error) };
      } finally {
        // Sin sesion que conservar, Chrome se apaga; el proximo uso reabre el
        // perfil persistente y el banco lo recuerda.
        if (browser?.connected) await browser.close().catch(() => {});
        browser = null;
        page = null;
        loggedIn = false;
      }
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
      // comprobante. Nunca se acepta, y el motivo viaja con nombre propio
      // para que el cliente sepa exactamente qué pasó.
      if (hit.amount === null || Math.abs(hit.amount - target) > 0.01) {
        return {
          verified: false,
          isNew: false,
          status: "amount_mismatch" as const,
          raw: { error: "MONTO_NO_COINCIDE", esperado: target, encontrado: hit.amount },
        };
      }
      return { verified: true, isNew: true, status: "verified_new" as const, raw: hit };
    },
  };
}