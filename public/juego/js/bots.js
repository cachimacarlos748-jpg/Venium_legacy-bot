// ============================================================
// BOTS — enemigos con IA sencilla pero incómoda: te buscan,
// mantienen distancia, se cubren cuando pierden la línea de
// visión y disparan en ráfagas. Animación de caminar hecha a
// mano (piernas y brazos girando) y caída al morir.
// ============================================================

import * as THREE from "../vendor/three.module.js";
import { moveAndCollide, raycastBoxes } from "./physics.js";
import { sfx } from "./audio.js";

const HALF = { x: 0.32, y: 0.9, z: 0.32 };
const GRAVITY = -23;

function sharedMaterials() {
  return {
    vest: new THREE.MeshStandardMaterial({ color: 0x33383f, roughness: 0.75 }),
    skin: new THREE.MeshStandardMaterial({ color: 0x9d7a5c, roughness: 0.8 }),
    cloth: new THREE.MeshStandardMaterial({ color: 0x25282e, roughness: 0.85 }),
    gear: new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.5, metalness: 0.5 }),
    stripe: new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.6 }),
    visor: new THREE.MeshStandardMaterial({ color: 0xff2b2b, emissive: 0xff2020, emissiveIntensity: 1.4, roughness: 0.4 }),
    gun: new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.5, metalness: 0.6 }),
  };
}

function buildModel(mats) {
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.86;
  root.add(hips);

  const mk = (w, h, d, x, y, z, mat, parent, part) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.part = part;
    parent.add(m);
    return m;
  };

  const torso = mk(0.46, 0.6, 0.26, 0, 0.3, 0, mats.vest, hips, "body");
  mk(0.47, 0.13, 0.27, 0, 0.42, 0, mats.stripe, hips, "body");      // banda roja
  mk(0.3, 0.24, 0.2, 0, 0.06, 0, mats.gear, hips, "body");          // cinturón
  const head = mk(0.25, 0.25, 0.25, 0, 0.73, 0, mats.gear, hips, "head");
  mk(0.22, 0.07, 0.05, 0, 0.73, -0.14, mats.visor, hips, "head");    // visor rojo
  mk(0.3, 0.12, 0.12, 0, 0.73, 0.12, mats.cloth, hips, "head");     // nuca

  const armL = new THREE.Group();
  armL.position.set(-0.31, 0.5, 0);
  hips.add(armL);
  mk(0.14, 0.54, 0.16, 0, -0.27, 0, mats.vest, armL, "limb");
  const armR = new THREE.Group();
  armR.position.set(0.31, 0.5, 0);
  hips.add(armR);
  mk(0.14, 0.54, 0.16, 0, -0.27, 0, mats.vest, armR, "limb");

  const legL = new THREE.Group();
  legL.position.set(-0.13, 0, 0);
  hips.add(legL);
  mk(0.17, 0.72, 0.19, 0, -0.38, 0, mats.cloth, legL, "limb");
  const legR = new THREE.Group();
  legR.position.set(0.13, 0, 0);
  hips.add(legR);
  mk(0.17, 0.72, 0.19, 0, -0.38, 0, mats.cloth, legR, "limb");

  // arma en las manos
  const gun = new THREE.Group();
  gun.position.set(0.16, 0.28, -0.18);
  hips.add(gun);
  mk(0.08, 0.1, 0.5, 0, 0, -0.2, mats.gun, gun, "gun");
  mk(0.06, 0.16, 0.12, 0, -0.1, 0, mats.gun, gun, "gun");
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -0.46);
  gun.add(muzzle);

  return { root, hips, head, armL, armR, legL, legR, gun, muzzle };
}

export class Bot {
  constructor(scene, mats, spawn, stats) {
    this.model = buildModel(mats);
    this.group = this.model.root;
    this.group.position.copy(spawn);
    scene.add(this.group);
    this.scene = scene;

    this.pos = this.group.position;
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.grounded = true;

    this.maxHealth = stats.health;
    this.health = stats.health;
    this.speed = stats.speed;
    this.accuracy = stats.accuracy;
    this.damage = stats.damage;
    this.rpm = stats.rpm;
    this.prefer = stats.prefer;

    this.state = "alive";
    this.walkPhase = Math.random() * 6;
    this.reaction = 0.75 + Math.random() * 0.6;
    this.fireTimer = 0;
    this.burst = 3 + Math.floor(Math.random() * 3);
    this.burstPause = 0;
    this.losTimer = Math.random() * 0.25;
    this.hasLOS = false;
    this.strafe = Math.random() < 0.5 ? -1 : 1;
    this.strafeTimer = 1 + Math.random() * 2;
    this.armKick = 0;
    this.shots = 0;
    this.deathTimer = 0;
    this.deadFor = 0;
    this.flank = (Math.random() - 0.5) * 8;
    this.stepTimer = 0;

    // mallas que puede golpear el jugador
    this.hitMeshes = [];
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.userData.bot = this;
        this.hitMeshes.push(o);
      }
    });
  }

  get alive() { return this.state === "alive"; }

  get chest() {
    return this._chest || (this._chest = new THREE.Vector3());
  }

  get muzzleWorld() {
    return this.model.muzzle.getWorldPosition(this._mw || (this._mw = new THREE.Vector3()));
  }

  hurt(amount) {
    this.health -= amount;
    if (this.health <= 0) this.die();
  }

  die() {
    if (this.state === "dead") return;
    this.state = "dead";
    this.deathTimer = 0;
    this.hitMeshes.length = 0;
    this.group.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  }

  update(dt, ctx) {
    const { player, time, colliders, fx, onPlayerHit } = ctx;
    const model = this.model;

    // ---------------- Muerte ----------------
    if (this.state === "dead") {
      this.deathTimer += dt;
      this.deadFor += dt;
      const k = Math.min(1, this.deathTimer / 0.55);
      const ease = 1 - (1 - k) * (1 - k);
      this.group.rotation.x = -ease * Math.PI * 0.5;
      this.group.position.y = THREE.MathUtils.lerp(this.group.position.y, this.pos.y + 0.28, 0.12);
      if (this.deadFor > 7) this.group.visible = false;
      return;
    }

    const playerEye = ctx.playerEye;
    const dx = playerEye.x - this.pos.x;
    const dz = playerEye.z - this.pos.z;
    const flatDist = Math.hypot(dx, dz) || 0.001;

    this.chest.set(this.pos.x, this.pos.y + 1.15, this.pos.z);
    const eyeDist = Math.hypot(playerEye.x - this.chest.x, playerEye.y - this.chest.y, playerEye.z - this.chest.z);
    const losDir = this._losDir || (this._losDir = new THREE.Vector3());
    losDir.set((playerEye.x - this.chest.x) / eyeDist, (playerEye.y - this.chest.y) / eyeDist, (playerEye.z - this.chest.z) / eyeDist);

    // línea de visión (barata: rayo contra cajas, cada ~0.2 s)
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.18 + Math.random() * 0.12;
      const hit = raycastBoxes(this.chest, losDir, eyeDist, colliders);
      this.hasLOS = hit >= eyeDist - 0.25;
      if (!this.hasLOS) {
        // busca cobertura lateral y avanza: así no se queda quieto de tonto
        this.strafeTimer -= 0.2;
        if (this.strafeTimer <= 0) {
          this.strafeTimer = 1 + Math.random() * 1.6;
          this.strafe *= -1;
        }
      }
    }

    this.reaction -= dt;

    // ---------------- Movimiento ----------------
    // n = hacia el jugador; p = perpendicular (para rodear y flanquear)
    const nx = dx / flatDist;
    const nz = dz / flatDist;
    const px = -nz;
    const pz = nx;
    let moveX = 0;
    let moveZ = 0;
    const tooClose = flatDist < this.prefer[0];
    const tooFar = flatDist > this.prefer[1];

    if (!this.hasLOS || tooFar) {
      // acércate rodeando: avanza y se desvía para no venir en línea recta
      moveX += nx + px * this.flank * 0.085;
      moveZ += nz + pz * this.flank * 0.085;
    } else if (tooClose) {
      moveX -= nx * 0.85;
      moveZ -= nz * 0.85;
    } else {
      // a distancia de tiro: lateral, el clásico "no te quedes quieto"
      moveX += px * this.strafe * 0.8;
      moveZ += pz * this.strafe * 0.8;
    }
    this.flank -= dt * 0.2;
    if (Math.abs(this.flank) > 9) this.flank = -this.flank;

    const moveLen = Math.hypot(moveX, moveZ);
    if (moveLen > 0.001) {
      moveX /= moveLen;
      moveZ /= moveLen;
    }

    const speed = this.hasLOS ? this.speed * 0.72 : this.speed;
    const accel = 1 - Math.exp(-dt * (this.grounded ? 12 : 3));
    this.vel.x += (moveX * speed - this.vel.x) * accel;
    this.vel.z += (moveZ * speed - this.vel.z) * accel;
    this.vel.y = Math.max(-38, this.vel.y + GRAVITY * dt);

    const res = moveAndCollide(this.pos, HALF, this.vel, dt, colliders, { stepUp: 0.55 });
    this.grounded = res.grounded;

    // mirar siempre al jugador (con retardo elegante). El frente del modelo
    // es -Z, así que el yaw que encara al jugador es atan2(-nx, -nz).
    const targetYaw = Math.atan2(-nx, -nz);
    let diff = targetYaw - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(1, dt * 7);
    this.group.rotation.y = this.yaw;

    // ---------------- Animación ----------------
    const planar = Math.hypot(this.vel.x, this.vel.z);
    if (planar > 0.3) {
      this.walkPhase += dt * planar * 2.4;
      const swing = Math.sin(this.walkPhase) * Math.min(0.72, planar * 0.13);
      model.legL.rotation.x = swing;
      model.legR.rotation.x = -swing;
      this.stepTimer -= dt * planar;
      if (this.stepTimer <= 0) { this.stepTimer = 6; sfx.step(); }
    } else {
      model.legL.rotation.x *= Math.exp(-dt * 6);
      model.legR.rotation.x *= Math.exp(-dt * 6);
    }

    // brazos: sostienen el arma apuntando al jugador, con el culatazo
    this.armKick *= Math.exp(-dt * 9);
    const aimPitch = Math.atan2(playerEye.y - this.chest.y, Math.max(0.6, flatDist));
    model.armL.rotation.x = -1.15 - aimPitch * 0.6 - this.armKick;
    model.armR.rotation.x = -1.05 - aimPitch * 0.6 - this.armKick;
    model.gun.rotation.x = -aimPitch * 0.7 - this.armKick * 0.6;
    model.hips.position.y = 0.86 + Math.sin(this.walkPhase * 2) * (planar > 0.3 ? 0.03 : 0) + Math.sin(time * 1.6 + this.walkPhase) * 0.006;

    // ---------------- Disparo ----------------
    if (this.hasLOS && this.reaction <= 0 && player.alive) {
      if (this.burstPause > 0) {
        this.burstPause -= dt;
      } else {
        this.fireTimer -= dt;
        if (this.fireTimer <= 0) {
          this.fireTimer = 60 / this.rpm;
          this.shots += 1;
          this.burst -= 1;
          this.armKick = 0.16;
          sfx.enemyShot(flatDist);
          const mz = this.muzzleWorld.clone();
          fx.muzzle(mz);
          fx.tracer(mz, playerEye.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5)), 0xff9b5a);

          // Acierto: probabilidad por distancia, movimiento del jugador y puntería del bot
          const distFactor = THREE.MathUtils.clamp(1 - flatDist / 52, 0.12, 1);
          const movingFactor = player.planarSpeed > 6 ? 0.72 : player.planarSpeed > 2.5 ? 0.86 : 1;
          const p = this.accuracy * distFactor * movingFactor * (player.crouching ? 1.08 : 1);
          if (Math.random() < p) {
            onPlayerHit(this.damage, this.chest.clone());
          }

          if (this.burst <= 0) {
            this.burst = 3 + Math.floor(Math.random() * 3);
            this.burstPause = 0.5 + Math.random() * 0.9;
          }
        }
      }
    } else if (this.burstPause > 0) {
      this.burstPause -= dt;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
  }
}

export class Bots {
  constructor(scene, colliders, fx) {
    this.scene = scene;
    this.colliders = colliders;
    this.fx = fx;
    this.mats = sharedMaterials();
    this.list = [];
    this.hitMeshes = [];
  }

  get aliveCount() {
    let n = 0;
    for (const b of this.list) if (b.alive) n += 1;
    return n;
  }

  get remainingCount() {
    return this.aliveCount;
  }

  get shotsFired() {
    let n = 0;
    for (const b of this.list) n += b.shots || 0;
    return n;
  }

  /** El bot vivo más cercano al jugador (para pruebas y para el radar futuro). */
  nearest(from) {
    let best = null;
    let bestD = Infinity;
    for (const b of this.list) {
      if (!b.alive) continue;
      const d = b.pos.distanceTo(from);
      if (d < bestD) { bestD = d; best = b; }
    }
    return { bot: best, distance: bestD };
  }

  statsForWave(wave) {
    return {
      health: 100 + (wave - 1) * 14,
      speed: Math.min(5.3, 3.5 + (wave - 1) * 0.14),
      accuracy: Math.min(0.58, 0.2 + (wave - 1) * 0.022),
      damage: 6.5 + (wave - 1) * 0.7,
      rpm: Math.min(420, 250 + (wave - 1) * 22),
      prefer: [7 + Math.random() * 3, wave > 2 ? 20 : 15],
    };
  }

  spawnWave(count, wave, spawnPoints, playerPos) {
    const stats = this.statsForWave(wave);
    // los sitios más lejanos al jugador, para no aparecer en la cara
    const scored = spawnPoints
      .map((p) => ({ p, d: p.distanceTo(playerPos) }))
      .sort((a, b) => b.d - a.d);
    const pool = scored.slice(0, Math.max(5, Math.floor(scored.length * 0.7)));

    for (let i = 0; i < count; i += 1) {
      const pick = pool[Math.floor(Math.random() * pool.length)].p;
      const pos = new THREE.Vector3(
        pick.x + (Math.random() - 0.5) * 3.5,
        pick.y,
        pick.z + (Math.random() - 0.5) * 3.5,
      );
      const bot = new Bot(this.scene, this.mats, pos, stats);
      this.list.push(bot);
      this.hitMeshes.push(...bot.hitMeshes);
      this.fx.dust(pos.clone().add(new THREE.Vector3(0, 0.2, 0)));
    }
  }

  update(dt, ctx) {
    const alive = [];
    for (const bot of this.list) {
      bot.update(dt, ctx);
      if (bot.alive) alive.push(bot);
    }

    // separación entre bots (que no se apilen)
    for (let i = 0; i < alive.length; i += 1) {
      for (let j = i + 1; j < alive.length; j += 1) {
        const a = alive[i];
        const b = alive[j];
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 1.44 || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (1.2 - d) * 0.5;
        const nx = dx / d;
        const nz = dz / d;
        a.pos.x -= nx * push;
        a.pos.z -= nz * push;
        b.pos.x += nx * push;
        b.pos.z += nz * push;
      }
    }

    // limpia mallas de muertos (sin tocar los vivos)
    if (this.hitMeshes.length > 0) {
      this.hitMeshes = this.hitMeshes.filter((m) => m.userData.bot && m.userData.bot.alive);
    }
  }

  /** Limpia cadáveres viejos y bots muertos que ya no se ven. */
  prune() {
    const keep = [];
    for (const bot of this.list) {
      if (!bot.alive && bot.deadFor > 9) {
        bot.dispose();
      } else {
        keep.push(bot);
      }
    }
    this.list = keep;
  }

  clear() {
    for (const bot of this.list) bot.dispose();
    this.list = [];
    this.hitMeshes = [];
  }
}
