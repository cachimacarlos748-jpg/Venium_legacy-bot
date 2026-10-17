// ============================================================
// FÍSICA — colisiones por caja contra la lista de la arena.
// Eje por eje (X, Z, luego Y) con subida de escalones, para que
// las cajas y las escaleras se puedan subir sin saltar.
// ============================================================

function overlap(cx, cy, cz, h, b) {
  return (
    cx - h.x < b.max.x && cx + h.x > b.min.x &&
    cy - h.y < b.max.y && cy + h.y > b.min.y &&
    cz - h.z < b.max.z && cz + h.z > b.min.z
  );
}

function freeAt(cx, cy, cz, h, colliders) {
  for (let i = 0; i < colliders.length; i += 1) {
    if (overlap(cx, cy, cz, h, colliders[i])) return false;
  }
  return true;
}

/**
 * Mueve `pos` (posición de los pies) con la velocidad `vel` durante `dt`.
 * Devuelve { grounded } y modifica pos y vel (poniendo a 0 lo que choca).
 */
export function moveAndCollide(pos, half, vel, dt, colliders, opts = {}) {
  const stepUp = opts.stepUp ?? 0.62;
  const h = half;
  let cx = pos.x;
  let cz = pos.z;
  let cy = pos.y + h.y;
  let grounded = false;

  // ---------- X ----------
  cx += vel.x * dt;
  for (let i = 0; i < colliders.length; i += 1) {
    const b = colliders[i];
    if (!overlap(cx, cy, cz, h, b)) continue;
    const top = b.max.y;
    const rise = top - pos.y;
    if (stepUp > 0 && rise > 0 && rise <= stepUp && freeAt(cx, top + h.y + 0.02, cz, h, colliders)) {
      cy = top + h.y + 0.02;
      continue;
    }
    if (vel.x > 0) cx = b.min.x - h.x - 0.002;
    else if (vel.x < 0) cx = b.max.x + h.x + 0.002;
    vel.x = 0;
  }

  // ---------- Z ----------
  cz += vel.z * dt;
  for (let i = 0; i < colliders.length; i += 1) {
    const b = colliders[i];
    if (!overlap(cx, cy, cz, h, b)) continue;
    const top = b.max.y;
    const rise = top - pos.y;
    if (stepUp > 0 && rise > 0 && rise <= stepUp && freeAt(cx, top + h.y + 0.02, cz, h, colliders)) {
      cy = top + h.y + 0.02;
      continue;
    }
    if (vel.z > 0) cz = b.min.z - h.z - 0.002;
    else if (vel.z < 0) cz = b.max.z + h.z + 0.002;
    vel.z = 0;
  }

  // ---------- Y ----------
  cy += vel.y * dt;
  for (let i = 0; i < colliders.length; i += 1) {
    const b = colliders[i];
    if (!overlap(cx, cy, cz, h, b)) continue;
    if (vel.y <= 0) {
      cy = b.max.y + h.y + 0.002;
      grounded = true;
    } else {
      cy = b.min.y - h.y - 0.002;
    }
    vel.y = 0;
  }

  // ¿sigue pisando algo justo debajo?
  if (!grounded && vel.y <= 0) {
    if (!freeAt(cx, cy - 0.06, cz, h, colliders)) {
      grounded = true;
      vel.y = 0;
    }
  }

  pos.x = cx;
  pos.z = cz;
  pos.y = cy - h.y;
  return { grounded };
}

/**
 * Rayo contra las cajas de la arena (test de planos). Devuelve la
 * distancia al impacto más cercano o Infinity. Es mucho más barato que
 * raycastear mallas y para un mapa de cajas es exacto.
 */
export function raycastBoxes(origin, dir, maxDist, boxes) {
  let best = Infinity;
  for (let i = 0; i < boxes.length; i += 1) {
    const b = boxes[i];
    let tmin = 0;
    let tmax = maxDist;
    let ok = true;
    for (const axis of ["x", "y", "z"]) {
      const o = origin[axis];
      const d = dir[axis];
      if (Math.abs(d) < 1e-8) {
        if (o < b.min[axis] || o > b.max[axis]) { ok = false; break; }
        continue;
      }
      const inv = 1 / d;
      let t1 = (b.min[axis] - o) * inv;
      let t2 = (b.max[axis] - o) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) { ok = false; break; }
    }
    if (ok && tmin < best) best = tmin;
  }
  return best;
}
