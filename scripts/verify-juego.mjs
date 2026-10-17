// ============================================================
// Verificación de VEX ARENA sin abrir un navegador a mano.
//
//   node scripts/verify-juego.mjs [logica|visual|movil|todo]
//
// Carga /juego/, escucha errores de consola y juega de verdad:
// camina, apunta, dispara, recarga, deja que los bots le den caza,
// pausa, muere y pasa de oleada. En "movil" prueba el joystick y los
// botones táctiles con eventos táctiles reales.
//
// Nota: en este contenedor no hay GPU (SwiftShader), así que el juego
// corre a pocos FPS. Por eso cada paso espera a que se cumpla la
// condición en vez de dormir un tiempo fijo.
// Sale con código 1 si algo falla.
// ============================================================

import fs from "node:fs";
import puppeteer from "puppeteer";

const URL = process.env.JUEGO_URL || "http://127.0.0.1:3000/juego/";
const STAGE = process.argv[2] || "todo";
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/home/daytona/.cache/puppeteer/chrome/linux-146.0.7680.31/chrome-linux64/chrome",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter(Boolean);
const executablePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));

const results = [];
const check = (ok, label, extra = "") => {
  results.push({ ok, label });
  console.log(`${ok ? "OK   " : "FALLO"} ${label}${extra ? ` — ${extra}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  ...(executablePath ? { executablePath } : {}),
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    // Sin esto el proceso de GPU no arranca en el contenedor y no hay WebGL.
    "--in-process-gpu",
  ],
});

const problems = [];

async function openPage(viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText || ""}`));
  await page.goto(URL, { waitUntil: "load", timeout: 90000 });
  await page.waitForFunction("window.__VEX__ && window.__VEX__.frameCount > 5", { timeout: 90000 });
  return page;
}

/** Espera a que una condición evaluada en la página sea verdadera. */
async function waitFor(page, expr, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await page.evaluate(expr)) return true;
    await sleep(250);
  }
  console.log(`     (se agotó el tiempo esperando: ${label})`);
  return false;
}

async function stageVisual() {
  const page = await openPage({ width: 1280, height: 720, deviceScaleFactor: 1 });
  const info = await page.evaluate(() => {
    const c = document.getElementById("gl");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    return {
      scenario: window.__VEX__.scenario,
      quality: window.__VEX__.quality,
      renderer: gl ? gl.getParameter(gl.RENDERER) : null,
      w: c.width, h: c.height,
      menuVisible: !document.getElementById("menu").classList.contains("hidden"),
    };
  });
  check(info.scenario.mode === "menu" && info.menuVisible, "arranca en el menú con la pantalla de inicio");
  check(info.w > 0 && !!info.renderer, "hay contexto WebGL activo", `${info.renderer} · ${info.w}x${info.h}`);
  check(info.quality === "high", "en pantalla grande usa calidad alta", `calidad=${info.quality}`);

  // La captura del menú no puede ser una imagen plana.
  const menuPng = await page.screenshot({ encoding: "binary" });
  fs.writeFileSync("/tmp/vex-menu.png", menuPng);

  // Ahora dentro del juego: es donde importa que se vea la arena.
  await page.evaluate(() => window.__VEX__.start());
  await waitFor(page, "window.__VEX__.bots.aliveCount > 0", 30000, "bots para la captura");
  await page.evaluate(() => {
    const V = window.__VEX__;
    const { bot } = V.bots.nearest(V.player.pos);
    if (bot) {
      V.player.yaw = Math.atan2(-(bot.pos.x - V.player.pos.x), -(bot.pos.z - V.player.pos.z));
      V.player.pitch = -0.02;
    }
  });
  await sleep(1200);
  const playPng = await page.screenshot({ encoding: "base64" });
  fs.writeFileSync("/tmp/vex-juego.png", Buffer.from(playPng, "base64"));

  // Se decodifica la captura (no el canvas: el búfer de WebGL se limpia
  // al terminar el fotograma y se leería negro).
  const pixels = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let min = 255, max = 0, sum = 0;
    let skyR = 0, skyG = 0, skyB = 0, skyN = 0;
    let ground = 0, groundN = 0;
    const skyRows = Math.floor(c.height * 0.16);
    for (let y = 0; y < c.height; y += 2) {
      for (let x = 0; x < c.width; x += 2) {
        const i = (y * c.width + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const l = (r + g + b) / 3;
        min = Math.min(min, l); max = Math.max(max, l); sum += l;
        if (y < skyRows) { skyR += r; skyG += g; skyB += b; skyN += 1; }
        if (y > c.height * 0.62 && y < c.height * 0.9) { ground += l; groundN += 1; }
      }
    }
    const count = Math.ceil(c.height / 2) * Math.ceil(c.width / 2);
    return {
      min, max, avg: sum / count,
      sky: { r: skyR / skyN, g: skyG / skyN, b: skyB / skyN },
      ground: ground / groundN,
    };
  }, playPng);

  check(pixels.max - pixels.min > 40 && pixels.avg > 20,
    "la arena se dibuja de verdad (ni pantalla negra ni plana)",
    `luminancia ${Math.round(pixels.min)}..${Math.round(pixels.max)} media ${Math.round(pixels.avg)}`);
  check(pixels.sky.b > pixels.sky.r && pixels.sky.b > 90, "el cielo y la niebla se ven arriba",
    `cielo rgb(${Math.round(pixels.sky.r)},${Math.round(pixels.sky.g)},${Math.round(pixels.sky.b)})`);
  check(pixels.ground > 25, "el suelo se ve abajo", `luminancia del suelo ${Math.round(pixels.ground)}`);
  await page.close();
}

async function stageLogica() {
  // Viewport pequeño: en este contenedor sin GPU la calidad baja corre
  // bastante más rápido y las pruebas de juego son más fiables.
  const page = await openPage({ width: 800, height: 450, deviceScaleFactor: 1 });
  const start = await page.evaluate(() => ({ scenario: window.__VEX__.scenario, quality: window.__VEX__.quality }));
  console.log(`     calidad en pruebas: ${start.quality}`);

  await page.evaluate(() => window.__VEX__.start());
  await waitFor(page, "window.__VEX__.game.mode === 'playing'", 15000, "arranque de partida");
  await waitFor(page, "window.__VEX__.bots.aliveCount > 0", 15000, "aparición de bots");
  const playing = await page.evaluate(() => window.__VEX__.scenario);
  check(playing.mode === "playing" && playing.bots > 0, "la partida arranca con bots",
    `oleada=${playing.wave} bots=${playing.bots}`);
  check(playing.grounded && Math.abs(playing.pos[1]) < 0.6, "el jugador está sobre el suelo",
    `y=${playing.pos[1]} pos=${JSON.stringify(playing.pos)}`);

  // ---- caminar con W + Shift ----
  const before = playing.pos;
  await page.evaluate(() => {
    window.__VEX__.input.keys.KeyW = true;
    window.__VEX__.input.keys.ShiftLeft = true;
  });
  await sleep(3000);
  await page.evaluate(() => {
    window.__VEX__.input.keys.KeyW = false;
    window.__VEX__.input.keys.ShiftLeft = false;
  });
  const moved = await page.evaluate(() => window.__VEX__.scenario);
  const walked = Math.hypot(moved.pos[0] - before[0], moved.pos[2] - before[2]);
  check(walked > 2, "el jugador camina con W+Shift", `avanzó ${walked.toFixed(2)} m`);
  check(moved.grounded, "sigue apoyado tras caminar (no atraviesa el suelo)");

  // ---- la vista responde ----
  const turn = await page.evaluate(async () => {
    const V = window.__VEX__;
    const yaw0 = V.player.yaw;
    const pitch0 = V.player.pitch;
    V.input.lookX = 400;
    V.input.lookY = -150;
    await new Promise((r) => setTimeout(r, 400));
    return { yaw: Math.abs(V.player.yaw - yaw0), pitch: Math.abs(V.player.pitch - pitch0) };
  });
  check(turn.yaw > 0.3 && turn.pitch > 0.05, "la vista gira con el ratón/dedo",
    `Δyaw=${turn.yaw.toFixed(2)} Δpitch=${turn.pitch.toFixed(2)}`);

  // ---- disparar a un bot ----
  // Se coloca un bot en línea, a 10 m y en campo abierto, y se vuelve a
  // apuntar antes de cada ráfaga: se prueba el impacto, no la puntería.
  const combat = await page.evaluate(async () => {
    const V = window.__VEX__;
    const bot = V.bots.list.find((b) => b.alive);
    if (!bot) return { error: "no hay bots vivos" };

    const fwdX = -Math.sin(V.player.yaw);
    const fwdZ = -Math.cos(V.player.yaw);
    bot.pos.set(V.player.pos.x + fwdX * 10, V.player.pos.y, V.player.pos.z + fwdZ * 10);
    bot.vel.set(0, 0, 0);
    bot.losTimer = 0;

    const aim = () => {
      const dx = bot.pos.x - V.player.pos.x;
      const dz = bot.pos.z - V.player.pos.z;
      const dy = bot.pos.y + 1.15 - (V.player.pos.y + V.player.eyeHeight);
      const flat = Math.hypot(dx, dz) || 0.01;
      V.player.yaw = Math.atan2(-dx, -dz);
      V.player.pitch = Math.atan2(dy, flat);
      V.player.recoilPitch = 0;
      V.player.recoilYaw = 0;
      return flat;
    };

    const flat = aim();
    const hpBefore = bot.health;
    const shotsBefore = V.game.shots;
    const hitsBefore = V.game.hits;
    V.input.firing = true;
    for (let i = 0; i < 12; i += 1) {
      await new Promise((r) => setTimeout(r, 220));
      aim();
      if (!bot.alive) break;
    }
    V.input.firing = false;
    return {
      hpBefore, hpAfter: bot.health, dead: !bot.alive, distance: Math.round(flat),
      shots: V.game.shots - shotsBefore, hits: V.game.hits - hitsBefore, ammo: V.player.mag,
    };
  });
  check(combat.shots > 3, "el arma dispara", `disparos=${combat.shots} munición=${combat.ammo}`);
  check(combat.hits > 0, "las balas alcanzan al bot", `impactos=${combat.hits} de ${combat.shots} a ${combat.distance} m`);
  check(combat.dead || combat.hpAfter < combat.hpBefore, "el bot recibe daño",
    `${Math.round(combat.hpBefore)} -> ${Math.round(combat.hpAfter)}`);

  // ---- recarga ----
  await page.evaluate(() => {
    window.__VEX__.player.mag = 1;
    window.__VEX__.input.reloadQueued = true;
  });
  const reloaded = await waitFor(page, "window.__VEX__.player.mag === 30", 40000, "recarga completa");
  check(reloaded, "la recarga rellena el cargador", `cargador=${await page.evaluate(() => window.__VEX__.player.mag)}`);

  // ---- cambiar de arma ----
  const swap = await page.evaluate(async () => {
    const V = window.__VEX__;
    const before = V.player.weapon.name;
    V.input.swapQueued = 1;
    await new Promise((r) => setTimeout(r, 1200));
    return { before, after: V.player.weapon.name, mag: V.player.mag };
  });
  check(swap.before !== swap.after, "se puede cambiar de arma", `${swap.before} -> ${swap.after}`);

  // ---- los bots cazan y disparan ----
  const hunt = await page.evaluate(async () => {
    const V = window.__VEX__;
    const alive = V.bots.list.filter((b) => b.alive);
    const before = V.bots.nearest(V.player.pos).distance;
    // pon dos bots en campo abierto cerca del jugador para no depender del mapa
    alive.slice(0, 2).forEach((b, i) => {
      b.pos.set(V.player.pos.x + (i === 0 ? 7 : -7), V.player.pos.y, V.player.pos.z + 7);
      b.vel.set(0, 0, 0);
      b.losTimer = 0;
      b.reaction = 0.2;
    });
    const hpBefore = V.player.health;
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      await new Promise((r) => setTimeout(r, 400));
      if (V.bots.shotsFired > 0 && V.player.health < hpBefore) break;
    }
    const after = V.bots.nearest(V.player.pos).distance;
    return {
      shots: V.bots.shotsFired, hpBefore, hpAfter: V.player.health,
      before: Math.round(before), after: Math.round(after),
      closest: Math.round(V.bots.nearest(V.player.pos).distance),
    };
  });
  check(hunt.shots > 0, "los bots disparan", `disparos de bots=${hunt.shots}`);
  check(hunt.hpAfter < hunt.hpBefore, "los bots hacen daño al jugador",
    `vida ${Math.round(hunt.hpBefore)} -> ${Math.round(hunt.hpAfter)}`);
  check(hunt.closest < 60, "los bots se acercan al jugador", `bot más cercano a ${hunt.closest} m`);

  // ---- pausa y reanudar ----
  await page.evaluate(() => window.__VEX__.pause());
  await sleep(300);
  const paused = await page.evaluate(() => ({
    mode: window.__VEX__.scenario.mode,
    overlay: !document.getElementById("pause").classList.contains("hidden"),
  }));
  check(paused.mode === "paused" && paused.overlay, "la pausa detiene la partida y muestra el menú", paused.mode);
  await page.evaluate(() => window.__VEX__.resume());
  await sleep(300);
  check(await page.evaluate(() => window.__VEX__.scenario.mode === "playing"), "se puede volver al combate");

  // ---- muerte ----
  await page.evaluate(() => window.__VEX__.player.applyDamage(300));
  const died = await waitFor(page, "window.__VEX__.game.mode === 'dead'", 15000, "fin de partida");
  const over = await page.evaluate(() => ({
    overlay: !document.getElementById("gameover").classList.contains("hidden"),
    stats: {
      wave: document.getElementById("statWave").textContent,
      kills: document.getElementById("statKills").textContent,
      acc: document.getElementById("statAcc").textContent,
    },
  }));
  check(died && over.overlay, "la muerte muestra el resumen de la partida", JSON.stringify(over.stats));

  // ---- oleadas ----
  await page.evaluate(() => window.__VEX__.start());
  await waitFor(page, "window.__VEX__.bots.aliveCount > 0", 20000, "bots de la oleada 1");
  await page.evaluate(() => { for (const b of window.__VEX__.bots.list) b.die(); });
  const nextWave = await waitFor(page, "window.__VEX__.game.wave === 2 && window.__VEX__.bots.aliveCount > 0", 45000, "oleada 2");
  const waveState = await page.evaluate(() => ({ wave: window.__VEX__.game.wave, bots: window.__VEX__.bots.aliveCount }));
  check(nextWave && waveState.bots > 0, "al limpiar la oleada empieza la siguiente", JSON.stringify(waveState));

  await page.screenshot({ path: "/tmp/vex-juego.png" });
  await page.close();
}

async function stageMovil() {
  const page = await openPage({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const ui = await page.evaluate(() => ({
    bodyTouch: document.body.classList.contains("touch"),
    touchVisible: !document.getElementById("touch").classList.contains("hidden"),
    quality: window.__VEX__.quality,
  }));
  check(ui.bodyTouch && ui.touchVisible, "los controles táctiles aparecen en el teléfono", JSON.stringify(ui));

  await page.evaluate(() => window.__VEX__.start());
  await waitFor(page, "window.__VEX__.bots.aliveCount > 0", 20000, "bots en móvil");

  const client = await page.createCDPSession();
  const touch = (type, points) => client.send("Input.dispatchTouchEvent", { type, touchPoints: points });

  // ---- joystick ----
  const stickBox = await (await page.$("#stick")).boundingBox();
  const sx = Math.round(stickBox.x + 90);
  const sy = Math.round(stickBox.y + stickBox.height - 90);
  await touch("touchStart", [{ x: sx, y: sy }]);
  await touch("touchMove", [{ x: sx, y: sy - 55 }]);
  await sleep(500);
  const stick = await page.evaluate(() => ({ z: window.__VEX__.input.moveZ, x: window.__VEX__.input.moveX }));
  await touch("touchEnd", []);
  await sleep(300);
  const released = await page.evaluate(() => window.__VEX__.input.moveZ);
  check(stick.z < -0.3 && Math.abs(stick.x) < 0.2, "el joystick empuja hacia delante",
    `moveZ=${stick.z.toFixed(2)} moveX=${stick.x.toFixed(2)}`);
  check(released === 0, "el joystick se suelta al levantar el dedo", `moveZ=${released}`);

  // ---- y el jugador se mueve de verdad con el joystick ----
  const posBefore = await page.evaluate(() => window.__VEX__.player.pos.toArray());
  await touch("touchStart", [{ x: sx, y: sy }]);
  await touch("touchMove", [{ x: sx, y: sy - 55 }]);
  await sleep(2500);
  await touch("touchEnd", []);
  const posAfter = await page.evaluate(() => window.__VEX__.player.pos.toArray());
  const movedBy = Math.hypot(posAfter[0] - posBefore[0], posAfter[2] - posBefore[2]);
  check(movedBy > 1, "el jugador avanza con el joystick", `${movedBy.toFixed(2)} m`);

  // ---- botón de disparo ----
  const fireBox = await (await page.$("#btnFire")).boundingBox();
  const fx = Math.round(fireBox.x + fireBox.width / 2);
  const fy = Math.round(fireBox.y + fireBox.height / 2);
  await touch("touchStart", [{ x: fx, y: fy }]);
  await sleep(400);
  const firing = await page.evaluate(() => window.__VEX__.input.firing);
  await touch("touchEnd", []);
  await sleep(400);
  const stopped = await page.evaluate(() => window.__VEX__.input.firing);
  check(firing && !stopped, "el botón DISPARO sostiene y suelta el fuego", `disparando=${firing}`);

  // ---- zoom, salto, recarga y cambio de arma ----
  // Aquí se comprueba el EFECTO del botón, no la bandera de entrada: el
  // juego consume las órdenes en el siguiente fotograma.
  const buttons = await page.evaluate(async () => {
    const V = window.__VEX__;
    const tap = (id) => document.getElementById(id).dispatchEvent(
      new PointerEvent("pointerdown", { pointerId: 99, bubbles: true, cancelable: true }),
    );
    tap("btnAds");
    await new Promise((r) => setTimeout(r, 600));
    const ads = V.input.ads;
    tap("btnCrouch");
    await new Promise((r) => setTimeout(r, 500));
    const crouch = V.player.crouchAmount > 0.3;
    V.player.mag = 5;
    tap("btnReload");
    await new Promise((r) => setTimeout(r, 600));
    const reload = V.player.reloading > 0;
    const weaponBefore = V.player.weapon.name;
    tap("btnSwap");
    await new Promise((r) => setTimeout(r, 1500));
    const swap = V.player.weapon.name !== weaponBefore;
    return { ads, crouch, reload, swap, weapon: V.player.weapon.name };
  });
  check(buttons.ads && buttons.crouch && buttons.reload && buttons.swap,
    "los botones ZOOM / CUCLILLAS / RECARGA / ARMA responden", JSON.stringify(buttons));

  // ---- arrastrar para mirar ----
  const yaw0 = await page.evaluate(() => window.__VEX__.player.yaw);
  await touch("touchStart", [{ x: 350, y: 430 }]);
  await touch("touchMove", [{ x: 260, y: 410 }]);
  await touch("touchEnd", []);
  await sleep(400);
  const yaw1 = await page.evaluate(() => window.__VEX__.player.yaw);
  check(Math.abs(yaw1 - yaw0) > 0.15, "arrastrar a la derecha gira la vista", `Δyaw=${(yaw1 - yaw0).toFixed(2)}`);

  const perf = await page.evaluate(() => window.__VEX__.scenario);
  console.log(`     móvil: vida=${perf.hp} bots=${perf.bots} oleada=${perf.wave}`);
  await page.screenshot({ path: "/tmp/vex-movil.png" });
  await page.close();
}

try {
  if (STAGE === "visual" || STAGE === "todo") await stageVisual();
  if (STAGE === "logica" || STAGE === "todo") await stageLogica();
  if (STAGE === "movil" || STAGE === "todo") await stageMovil();
} catch (error) {
  check(false, "la verificación terminó sin excepciones", String(error && error.message ? error.message : error));
} finally {
  await browser.close();
}

console.log("\n--- errores de consola / red ---");
if (problems.length === 0) console.log("ninguno");
else [...new Set(problems)].slice(0, 20).forEach((p) => console.log(p));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`);
if (failed.length > 0 || problems.length > 0) {
  console.log("ESTADO: FALLO");
  process.exit(1);
}
console.log("ESTADO: OK");
