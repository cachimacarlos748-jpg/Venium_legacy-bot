// ============================================================
// FX — chispas de impacto, trazadoras y fogonazo.
// Todo con grupos reutilizados para no crear basura en cada tiro.
// ============================================================

import * as THREE from "../vendor/three.module.js";

function dotTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export function createFx(scene) {
  // ---------- Partículas ----------
  const MAX = 320;
  const positions = new Float32Array(MAX * 3);
  const colors = new Float32Array(MAX * 3);
  const vel = new Float32Array(MAX * 3);
  const life = new Float32Array(MAX);
  const maxLife = new Float32Array(MAX);
  const gravityOf = new Float32Array(MAX);
  for (let i = 0; i < MAX; i += 1) positions[i * 3 + 1] = -9999;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.19,
    map: dotTexture(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  let cursor = 0;
  const tmpColor = new THREE.Color();

  function emit(point, color, count, speed, spread, gravity = -9) {
    for (let n = 0; n < count; n += 1) {
      const i = cursor;
      cursor = (cursor + 1) % MAX;
      positions[i * 3] = point.x;
      positions[i * 3 + 1] = point.y;
      positions[i * 3 + 2] = point.z;
      const dirX = (Math.random() - 0.5) * spread;
      const dirY = Math.random() * spread * 0.8 + 0.15;
      const dirZ = (Math.random() - 0.5) * spread;
      const s = speed * (0.5 + Math.random() * 0.8);
      vel[i * 3] = dirX * s;
      vel[i * 3 + 1] = dirY * s;
      vel[i * 3 + 2] = dirZ * s;
      tmpColor.set(color);
      tmpColor.offsetHSL(0, 0, (Math.random() - 0.5) * 0.12);
      colors[i * 3] = tmpColor.r;
      colors[i * 3 + 1] = tmpColor.g;
      colors[i * 3 + 2] = tmpColor.b;
      maxLife[i] = 0.28 + Math.random() * 0.34;
      life[i] = maxLife[i];
      gravityOf[i] = gravity;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  // ---------- Trazadoras ----------
  const TRACERS = 14;
  const tracerGeo = new THREE.BoxGeometry(0.03, 0.03, 1);
  const tracers = [];
  for (let i = 0; i < TRACERS; i += 1) {
    const m = new THREE.Mesh(
      tracerGeo,
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    m.visible = false;
    m.frustumCulled = false;
    scene.add(m);
    tracers.push({ mesh: m, life: 0 });
  }
  let tracerCursor = 0;

  // ---------- Fogonazo ----------
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  flash.visible = false;
  scene.add(flash);
  const flashLight = new THREE.PointLight(0xffb457, 0, 11, 2);
  scene.add(flashLight);
  let flashLife = 0;

  return {
    impact(point, normal, kind = "world") {
      const sparkColor = kind === "enemy" ? 0xff4d4d : kind === "head" ? 0xffcf3f : 0xffb24a;
      const p = point.clone().addScaledVector(normal, 0.04);
      emit(p, sparkColor, kind === "world" ? 7 : 11, 4.4, 0.9, -11);
      if (kind === "world") emit(p, 0x9a9a9a, 3, 1.4, 0.7, -2);
    },
    dust(point) {
      emit(point, 0xb9b2a4, 5, 1.5, 0.8, -1.5);
    },
    tracer(from, to, color = 0xffd27a) {
      const t = tracers[tracerCursor];
      tracerCursor = (tracerCursor + 1) % TRACERS;
      const dist = from.distanceTo(to);
      if (dist < 0.2) return;
      t.mesh.visible = true;
      t.mesh.material.color.setHex(color);
      t.mesh.material.opacity = 0.85;
      t.mesh.position.copy(from).add(to).multiplyScalar(0.5);
      t.mesh.lookAt(to);
      t.mesh.scale.set(1, 1, dist);
      t.life = 0.055;
    },
    muzzle(position) {
      flash.position.copy(position);
      flash.material.opacity = 0.95;
      flash.visible = true;
      flash.scale.setScalar(0.85 + Math.random() * 0.5);
      flashLight.position.copy(position);
      flashLight.intensity = 3.4;
      flashLife = 0.05;
    },
    update(dt) {
      // partículas
      let touched = false;
      for (let i = 0; i < MAX; i += 1) {
        if (life[i] <= 0) continue;
        touched = true;
        life[i] -= dt;
        if (life[i] <= 0) {
          positions[i * 3 + 1] = -9999;
          colors[i * 3] = 0; colors[i * 3 + 1] = 0; colors[i * 3 + 2] = 0;
          continue;
        }
        vel[i * 3 + 1] += gravityOf[i] * dt;
        positions[i * 3] += vel[i * 3] * dt;
        positions[i * 3 + 1] += vel[i * 3 + 1] * dt;
        positions[i * 3 + 2] += vel[i * 3 + 2] * dt;
        const fade = Math.max(0, life[i] / maxLife[i]);
        colors[i * 3] *= 0.995;
        if (fade < 0.4) {
          const k = fade / 0.4;
          colors[i * 3] *= k;
          colors[i * 3 + 1] *= k;
          colors[i * 3 + 2] *= k;
        }
      }
      if (touched) {
        geo.attributes.position.needsUpdate = true;
        geo.attributes.color.needsUpdate = true;
      }
      // trazadoras
      for (const t of tracers) {
        if (t.life <= 0) continue;
        t.life -= dt;
        t.mesh.material.opacity = Math.max(0, (t.life / 0.055) * 0.85);
        if (t.life <= 0) t.mesh.visible = false;
      }
      // fogonazo
      if (flashLife > 0) {
        flashLife -= dt;
        flashLight.intensity = Math.max(0, flashLight.intensity - dt * 90);
        if (flashLife <= 0) {
          flash.visible = false;
          flashLight.intensity = 0;
        }
      }
    },
  };
}
