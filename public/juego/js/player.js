// ============================================================
// JUGADOR — movimiento, armas y disparo.
// El arma es un modelo de cajas pegado a la cámara (view model)
// con retroceso, recarga y transición a la mira.
// ============================================================

import * as THREE from "../vendor/three.module.js";
import { moveAndCollide } from "./physics.js";
import { input, consumeLook, readMoveAxes } from "./input.js";
import { sfx } from "./audio.js";

export const WEAPONS = [
  {
    id: "ak",
    name: "AK-47",
    kind: "rifle",
    damage: 25,
    headMul: 2.3,
    rpm: 640,
    mag: 30,
    reload: 2.2,
    spread: 0.017,
    adsSpread: 0.0055,
    bloom: 0.0055,
    recoil: 0.9,
    adsZoom: 46,
    auto: true,
  },
  {
    id: "pistol",
    name: "PISTOLA .50",
    kind: "pistol",
    damage: 44,
    headMul: 2.6,
    rpm: 300,
    mag: 12,
    reload: 1.5,
    spread: 0.019,
    adsSpread: 0.005,
    bloom: 0.012,
    recoil: 2.0,
    adsZoom: 50,
    auto: false,
  },
];

const EYE_STAND = 1.68;
const EYE_CROUCH = 1.14;
const HALF = { x: 0.34, y: 0.9, z: 0.34 };

function buildViewModel() {
  const g = new THREE.Group();
  const matBody = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.55, metalness: 0.6 });
  const matAccent = new THREE.MeshStandardMaterial({ color: 0x3d2716, roughness: 0.7 });
  const matMetal = new THREE.MeshStandardMaterial({ color: 0x8b929c, roughness: 0.35, metalness: 0.85 });

  const add = (w, h, d, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };

  add(0.075, 0.085, 0.62, 0, 0, -0.24, matBody);      // cuerpo
  add(0.05, 0.05, 0.34, 0, 0.055, -0.34, matAccent);  // guardamanos
  add(0.035, 0.035, 0.5, 0, 0.005, -0.6, matMetal);   // cañón
  add(0.06, 0.16, 0.1, 0, -0.1, 0.02, matBody);       // empuñadura
  add(0.055, 0.11, 0.16, 0, -0.08, -0.12, matAccent); // cargador
  add(0.03, 0.045, 0.03, 0, 0.075, -0.42, matMetal);  // punto de mira
  add(0.05, 0.05, 0.06, 0, 0.09, 0.06, matMetal);     // alza
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.005, -0.86);
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  return g;
}

export class Player {
  constructor(camera, colliders, fx, hud) {
    this.camera = camera;
    this.colliders = colliders;
    this.fx = fx;
    this.hud = hud;

    this.pos = new THREE.Vector3(0, 0, 17);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;
    this.pitch = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.grounded = true;
    this.crouching = false;
    this.crouchAmount = 0;
    this.sprinting = false;
    this.adsAmount = 0;
    this.bob = 0;
    this.stepTimer = 0;
    this.fireBloom = 0;
    this.sustainFire = 0;

    this.health = 100;
    this.alive = true;
    this.lastDamage = -999;
    this.hurtFlash = 0;
    this.shake = 0;

    this.weaponIndex = 0;
    this.mag = WEAPONS[0].mag;
    this.reloading = 0;
    this.nextShot = 0;
    this.switchTimer = 0;

    this.aimSens = 0.0021;

    this.viewModel = buildViewModel();
    this.viewModel.position.set(0.19, -0.17, -0.3);
    camera.add(this.viewModel);

    this.hipPos = new THREE.Vector3(0.19, -0.17, -0.3);
    this.adsPos = new THREE.Vector3(0, -0.115, -0.2);
    this.kick = new THREE.Vector3();
    this.kickRot = 0;
  }

  get weapon() { return WEAPONS[this.weaponIndex]; }
  get planarSpeed() { return Math.hypot(this.vel.x, this.vel.z); }
  get eyeHeight() { return THREE.MathUtils.lerp(EYE_STAND, EYE_CROUCH, this.crouchAmount); }

  spawn(pos) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.health = 100;
    this.alive = true;
    this.mag = this.weapon.mag;
    this.reloading = 0;
    this.weaponIndex = 0;
    this.yaw = Math.PI;
    this.pitch = -0.05;
    this.crouchAmount = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.shake = 0;
  }

  get muzzleWorld() {
    const m = this.viewModel.userData.muzzle;
    return m.getWorldPosition(this._mw || (this._mw = new THREE.Vector3()));
  }

  get eyePosition() {
    return this._eye || (this._eye = new THREE.Vector3());
  }

  applyDamage(amount, sourcePos = null) {
    if (!this.alive) return;
    this.health -= amount;
    this.lastDamage = performance.now() / 1000;
    this.hurtFlash = Math.min(1, this.hurtFlash + amount / 45);
    this.shake = Math.min(0.6, this.shake + amount / 120);
    sfx.hurt();
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
    }
  }

  startReload() {
    const w = this.weapon;
    if (this.reloading > 0 || this.mag >= w.mag) return;
    this.reloading = w.reload;
    sfx.reloadIn();
  }

  switchWeapon() {
    if (this.switchTimer > 0) return;
    this.weaponIndex = (this.weaponIndex + 1) % WEAPONS.length;
    this.mag = this.weapon.mag;
    this.reloading = 0;
    this.switchTimer = 0.45;
    sfx.reloadOut();
  }

  /** Dispara si toca. `hitTest(origin, dir, maxDist)` lo da main.js. */
  fire(hitTest, now) {
    const w = this.weapon;
    if (!this.alive || this.switchTimer > 0) return null;
    if (now < this.nextShot) return null;
    if (this.reloading > 0) return null;
    if (this.mag <= 0) {
      sfx.empty();
      this.nextShot = now + 0.25;
      this.startReload();
      return null;
    }

    this.mag -= 1;
    this.nextShot = now + 60 / w.rpm;
    this.sustainFire = Math.min(1, this.sustainFire + 0.16);
    this.fireBloom = Math.min(0.03, this.fireBloom + w.bloom);

    // ---- dirección con dispersión ----
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const spread = this.currentSpread();
    if (spread > 0) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * spread;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
      dir.addScaledVector(right, Math.cos(angle) * radius).addScaledVector(up, Math.sin(angle) * radius).normalize();
    }

    const origin = this.eyePosition.clone();
    const hit = hitTest(origin, dir, 220);

    // ---- retroceso ----
    const kickScale = (1 - this.adsAmount * 0.35) * w.recoil;
    this.recoilPitch += 0.0068 * kickScale + this.sustainFire * 0.0018 * kickScale;
    this.recoilYaw += (Math.random() - 0.5) * 0.0052 * kickScale;
    this.kick.z += 0.05 * kickScale;
    this.kickRot += 0.05 * kickScale;
    this.shake = Math.min(0.25, this.shake + 0.05 * kickScale);

    // ---- fogonazo y trazadora ----
    const muzzle = this.muzzleWorld.clone();
    this.fx.muzzle(muzzle);
    sfx.shot(w.kind);

    const end = hit ? hit.point : origin.clone().addScaledVector(dir, 220);
    this.fx.tracer(muzzle, end);

    const result = { hit, weapon: w, origin, dir };
    if (this.onShot) this.onShot(result);
    return result;
  }

  currentSpread() {
    const w = this.weapon;
    const base = THREE.MathUtils.lerp(w.spread, w.adsSpread, this.adsAmount);
    const moveFactor = Math.min(1, this.vel.length() / 7.5);
    const move = moveFactor * 0.014 * (1 - this.adsAmount * 0.5);
    const crouch = this.crouchAmount > 0.5 ? 0.78 : 1;
    return (base + move + this.fireBloom) * crouch;
  }

  update(dt, ctx) {
    const now = ctx.time;
    const { x: mx, z: mz } = readMoveAxes();
    const look = consumeLook();

    // ---------- Cámara: giro ----------
    const sens = this.aimSens * (1 - this.adsAmount * 0.45);
    this.yaw -= look.x * sens;
    this.pitch -= look.y * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.45, 1.45);

    // La cámara se orienta ANTES de disparar: así la bala sale hacia donde
    // el jugador está mirando en este mismo fotograma.
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw + this.recoilYaw);
    this.camera.rotateX(this.pitch + this.recoilPitch);

    // ---------- Cuclillas / correr / mira ----------
    this.crouchAmount = THREE.MathUtils.lerp(this.crouchAmount, input.crouch ? 1 : 0, 1 - Math.exp(-dt * 12));
    this.crouching = this.crouchAmount > 0.5;
    const wantsADS = input.ads && !this.crouching;
    this.adsAmount = THREE.MathUtils.lerp(this.adsAmount, wantsADS ? 1 : 0, 1 - Math.exp(-dt * 16));
    this.sprinting = input.sprint && !this.crouching && mz < -0.35 && this.adsAmount < 0.3;

    // ---------- Movimiento ----------
    let speed = 5.3;
    if (this.crouching) speed = 2.7;
    else if (this.adsAmount > 0.5) speed = 3.7;
    else if (this.sprinting) speed = 7.9;

    // Base de la cámara: derecha = (cos, -sin), adelante = (-sin, -cos).
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const dirX = mx * cos + mz * sin;
    const dirZ = -mx * sin + mz * cos;

    const accel = 1 - Math.exp(-dt * (this.grounded ? 16 : 4));
    this.vel.x += (dirX * speed - this.vel.x) * accel;
    this.vel.z += (dirZ * speed - this.vel.z) * accel;

    if (input.jumpQueued) {
      input.jumpQueued = false;
      if (this.grounded) {
        this.vel.y = 7.5;
        this.grounded = false;
      }
    }
    this.vel.y = Math.max(-38, this.vel.y - 23 * dt);

    const wasGrounded = this.grounded;
    const res = moveAndCollide(this.pos, HALF, this.vel, dt, this.colliders, { stepUp: 0.62 });
    this.grounded = res.grounded;
    if (!wasGrounded && this.grounded) {
      this.shake = Math.min(0.35, this.shake + 0.12);
      sfx.step();
    }

    // ---------- Pasos ----------
    const planar = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && planar > 1.4) {
      this.stepTimer -= dt * (planar / 5.3);
      if (this.stepTimer <= 0) {
        this.stepTimer = 0.42;
        sfx.step();
      }
      this.bob += dt * planar * 1.5;
    } else {
      this.bob += dt * 1.2;
    }

    // ---------- Armas ----------
    if (input.reloadQueued) {
      input.reloadQueued = false;
      this.startReload();
    }
    if (input.swapQueued > 0) {
      input.swapQueued = 0;
      this.switchWeapon();
    }
    if (this.switchTimer > 0) this.switchTimer = Math.max(0, this.switchTimer - dt);

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.mag = this.weapon.mag;
        sfx.reloadOut();
      }
    }

    if (input.firing) {
      const w = this.weapon;
      const nowSec = now;
      if (w.auto) {
        this.fire(ctx.hitTest, nowSec);
      } else if (nowSec >= this.nextShot) {
        this.fire(ctx.hitTest, nowSec);
      }
    } else {
      this.sustainFire = Math.max(0, this.sustainFire - dt * 2.2);
    }
    this.fireBloom = Math.max(0, this.fireBloom - dt * 0.055);

    // ---------- Regeneración ----------
    if (this.alive && now - this.lastDamage > 5 && this.health < 100) {
      this.health = Math.min(100, this.health + 8 * dt);
    }

    // ---------- Cámara final ----------
    this.eyePosition.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
    this.recoilPitch *= Math.exp(-dt * 8.5);
    this.recoilYaw *= Math.exp(-dt * 8.5);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.6);
    this.shake *= Math.exp(-dt * 6);

    const bobY = Math.sin(this.bob * 2) * (planar > 1.4 ? 0.032 : 0);
    const bobX = Math.cos(this.bob) * (planar > 1.4 ? 0.02 : 0);
    const shakeX = (Math.random() - 0.5) * this.shake * 0.5;
    const shakeY = (Math.random() - 0.5) * this.shake * 0.5;

    this.camera.position.set(
      this.pos.x + bobX + shakeX,
      this.pos.y + this.eyeHeight + bobY + shakeY,
      this.pos.z,
    );
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw + this.recoilYaw);
    this.camera.rotateX(this.pitch + this.recoilPitch);
    this.camera.rotateZ(bobX * 0.6);
    this.camera.fov = THREE.MathUtils.lerp(76, this.weapon.adsZoom, this.adsAmount);
    this.camera.updateProjectionMatrix();

    // ---------- View model ----------
    const vm = this.viewModel;
    const target = this.adsAmount > 0 ? this.adsPos : this.hipPos;
    vm.position.lerp(target, 1 - Math.exp(-dt * 18));
    this.kick.multiplyScalar(Math.exp(-dt * 12));
    this.kickRot *= Math.exp(-dt * 12);
    vm.position.z += this.kick.z;
    vm.position.y += Math.sin(this.bob * 2) * 0.006 * (1 - this.adsAmount);
    vm.position.x += Math.cos(this.bob) * 0.006 * (1 - this.adsAmount);
    vm.rotation.x = this.kickRot - this.reloading * 0.35;
    vm.rotation.z = -this.reloading * 0.5 + this.switchTimer * 0.6;
    vm.visible = this.alive;
    if (this.reloading > 0.5) vm.position.y -= 0.06;
  }
}
