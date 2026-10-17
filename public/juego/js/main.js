// ============================================================
// VEX ARENA — arranque y bucle principal.
// Une mundo + jugador + bots + HUD y lleva la partida (oleadas,
// puntaje, pausa y fin). Todo el juego vive en /juego/ y no toca
// nada del bot ni de la tienda.
// ============================================================

import * as THREE from "../vendor/three.module.js";
import { createWorld } from "./world.js";
import { createFx } from "./fx.js";
import { Bots } from "./bots.js";
import { Player } from "./player.js";
import { initAudio, resumeAudio, sfx } from "./audio.js";
import { initInput, resetInput, input, isTouch, isTouch as detectTouch } from "./input.js";
import { hud } from "./hud.js";
import { raycastBoxes } from "./physics.js";

// ---------- Calidad según el dispositivo ----------
function detectQuality() {
  const cores = navigator.hardwareConcurrency || 4;
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  if (small || coarse || cores <= 4) return "low";
  return "high";
}

const quality = detectQuality();
const canvas = document.getElementById("gl");

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: quality !== "low",
  powerPreference: "high-performance",
  stencil: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === "low" ? 1.3 : 1.75));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = quality !== "low";
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(76, window.innerWidth / window.innerHeight, 0.06, 420);
scene.add(camera);

const fx = createFx(scene);
const world = createWorld(scene, quality);
const bots = new Bots(scene, world.colliders, fx);
const player = new Player(camera, world.colliders, fx, hud);

// ---------- Estado de la partida ----------
const game = {
  mode: "menu",          // menu | playing | paused | dead
  wave: 0,
  score: 0,
  kills: 0,
  shots: 0,
  hits: 0,
  headshots: 0,
  waveCount: 0,
  waveEnemies: 0,
  waveTimer: 0,
  waitingNext: false,
};

hud.init();

// ---------- Prueba de impacto (balas) ----------
const raycaster = new THREE.Raycaster();

function hitTest(origin, dir, maxDist = 220) {
  raycaster.set(origin, dir);
  raycaster.far = maxDist;
  const botHits = bots.hitMeshes.length > 0 ? raycaster.intersectObjects(bots.hitMeshes, false) : [];
  const worldDist = raycastBoxes(origin, dir, maxDist, world.colliders);
  const b0 = botHits[0];
  if (b0 && b0.distance < worldDist) {
    return {
      point: b0.point.clone(),
      distance: b0.distance,
      bot: b0.object.userData.bot,
      part: b0.object.userData.part || "body",
    };
  }
  if (!isFinite(worldDist)) return null;
  return { point: origin.clone().addScaledVector(dir, worldDist), distance: worldDist, bot: null, part: null };
}

// ---------- Daño del jugador ----------
player.onShot = (result) => {
  game.shots += 1;
  const hit = result.hit;
  if (!hit) return;

  if (!hit.bot) {
    fx.impact(hit.point, result.dir.clone().negate(), "world");
    return;
  }

  game.hits += 1;
  const w = result.weapon;
  const part = hit.part;
  const falloff = 1 - Math.min(0.2, (hit.distance / 220) * 0.6);
  const mul = part === "head" ? w.headMul : part === "limb" ? 0.85 : 1;
  const damage = w.damage * falloff * mul;

  fx.impact(hit.point, result.dir.clone().negate(), part === "head" ? "head" : "enemy");
  hit.bot.hurt(damage);

  if (part === "head") {
    game.headshots += 1;
    sfx.headshot();
    hud.hitmarker("head");
  } else {
    sfx.hit();
    hud.hitmarker("hit");
  }

  if (!hit.bot.alive) {
    game.kills += 1;
    const points = part === "head" ? 150 : 100;
    game.score += points;
    hud.setScore(game.score);
    hud.hitmarker("kill");
    sfx.kill();
    hud.feed(part === "head" ? "BOT ELIMINADO · CABEZA +150" : "BOT ELIMINADO +100", part === "head");
    bots.hitMeshes = bots.hitMeshes.filter((m) => m.userData.bot && m.userData.bot.alive);
    bots.prune();
  }
};

const onPlayerHit = (damage, fromPos) => {
  if (game.mode !== "playing") return;
  player.applyDamage(damage, fromPos);
  hud.flashDamage(damage);
  if (!player.alive) endGame();
};

// ---------- Oleadas ----------
function beginWave(n) {
  game.wave = n;
  game.waveEnemies = Math.min(16, 4 + n * 2);
  bots.spawnWave(game.waveEnemies, n, world.spawnPoints, player.pos);
  hud.setWave(n);
  hud.banner(`OLEADA ${n}`, `${game.waveEnemies} hostiles`);
  fx.dust(player.pos.clone().add(new THREE.Vector3(0, 1, 0)));
  sfx.waveStart();
  game.waitingNext = false;
}

function startGame() {
  initAudio();
  resumeAudio();
  game.mode = "playing";
  game.wave = 0;
  game.score = 0;
  game.kills = 0;
  game.shots = 0;
  game.hits = 0;
  game.headshots = 0;
  game.waitingNext = false;

  bots.clear();
  player.spawn(world.playerSpawn);
  player.mag = player.weapon.mag;
  resetInput();

  hud.showMenu(false);
  hud.hideGameOver();
  hud.showPause(false);
  hud.showHud(true);
  hud.setScore(0);
  hud.feed("PARTIDA INICIADA · BUENA SUERTE", false);

  lockPointer();
  beginWave(1);
}

function endGame() {
  game.mode = "dead";
  sfx.death();
  exitPointerLock();
  hud.showGameOver({ ...game });
}

function pauseGame() {
  if (game.mode !== "playing") return;
  game.mode = "paused";
  resetInput();
  hud.showPause(true);
  exitPointerLock();
}

function resumeGame() {
  if (game.mode !== "paused") return;
  game.mode = "playing";
  hud.showPause(false);
  lockPointer();
}

function lockPointer() {
  if (detectTouch()) return;
  if (document.pointerLockElement !== canvas && canvas.requestPointerLock) {
    const p = canvas.requestPointerLock();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }
}

function exitPointerLock() {
  if (document.pointerLockElement === canvas && document.exitPointerLock) document.exitPointerLock();
}

// ---------- Entrada y botones ----------
initInput(canvas, {
  isPlaying: () => game.mode === "playing",
  onPause: () => pauseGame(),
  onLockLost: () => {
    if (!detectTouch() && game.mode === "playing") pauseGame();
  },
});

hud.bindButtons({
  onPlay: () => startGame(),
  onResume: () => resumeGame(),
  onRestart: () => startGame(),
  onRetry: () => startGame(),
});

canvas.addEventListener("click", () => {
  if (game.mode === "paused") resumeGame();
});

hud.enableTouch(isTouch());

// ---------- Bucle ----------
const clock = new THREE.Clock();
let frames = 0;
let slowFrames = 0;
let tuned = 0;

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
window.addEventListener("orientationchange", () => setTimeout(resize, 300));

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, clock.getDelta());
  const time = performance.now() / 1000;
  frames += 1;

  if (game.mode === "playing") {
    const ctx = {
      time,
      hitTest,
      player,
      playerEye: player.eyePosition.set(player.pos.x, player.pos.y + player.eyeHeight, player.pos.z),
      colliders: world.colliders,
      fx,
      onPlayerHit,
    };
    player.update(dt, ctx);
    bots.update(dt, ctx);

    // Si el jugador muere por cualquier vía (bots, caída, prueba), la
    // partida se cierra siempre aquí: un único sitio decide el final.
    if (!player.alive) {
      endGame();
    }

    hud.setHealth(player.health);
    hud.setAmmo(player.mag, Infinity, player.weapon.name, player.reloading > 0);
    hud.setEnemies(bots.aliveCount);
    hud.setSpread(8 + player.currentSpread() * 720 + player.planarSpeed * 0.8);

    // ¿oleada limpia?
    if (!game.waitingNext && bots.aliveCount === 0 && game.wave > 0) {
      game.waitingNext = true;
      game.waveTimer = 2.4;
    }
    if (game.waitingNext) {
      game.waveTimer -= dt;
      if (game.waveTimer <= 0) beginWave(game.wave + 1);
    }
  } else if (game.mode === "dead") {
    // deja que los bots sigan moviéndose un poco (cinemática barata)
    bots.update(dt, {
      time,
      player,
      playerEye: player.eyePosition.set(player.pos.x, player.pos.y + player.eyeHeight, player.pos.z),
      colliders: world.colliders,
      fx,
      onPlayerHit: () => {},
    });
  }

  fx.update(dt);
  renderer.shadowMap.needsUpdate = quality !== "low" || frames % 2 === 0;
  renderer.render(scene, camera);

  // Autoajuste si el teléfono va lento
  if (frames > 30) {
    if (dt > 0.032) slowFrames += 1;
    else slowFrames = Math.max(0, slowFrames - 1);
    if (slowFrames > 60 && tuned === 0) {
      tuned = 1;
      renderer.setPixelRatio(1);
      renderer.shadowMap.enabled = false;
      world.sun.castShadow = false;
    } else if (slowFrames > 150 && tuned === 1) {
      tuned = 2;
      scene.fog.far = 95;
    }
  }
}

// ---------- Arranque ----------
resize();
hud.showLoading(true);
hud.showMenu(true);
hud.showHud(false);
tick();
requestAnimationFrame(() => {
  hud.showLoading(false);
});

// API para pruebas automáticas (Chrome sin cabeza) y para el director.
window.__VEX__ = {
  get running() { return true; },
  quality,
  game,
  player,
  bots,
  world,
  input,
  fx,
  hitTest,
  start: startGame,
  pause: pauseGame,
  resume: resumeGame,
  banner: (t, s) => hud.banner(t, s),
  get frameCount() { return frames; },
  get alive() { return bots.aliveCount; },
  get scenario() {
    return {
      mode: game.mode,
      wave: game.wave,
      hp: Math.round(player.health),
      bots: bots.aliveCount,
      pos: player.pos.toArray().map((v) => Math.round(v * 100) / 100),
      ammo: player.mag,
      grounded: player.grounded,
      shadowEnabled: renderer.shadowMap.enabled,
    };
  },
};
