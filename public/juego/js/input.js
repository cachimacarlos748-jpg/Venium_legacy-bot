// ============================================================
// ENTRADA — teclado + ratón (pointer lock) + táctil.
// Todo se lee desde un único objeto `input` que el jugador
// consume cada fotograma.
// ============================================================

export const input = {
  keys: Object.create(null),
  moveX: 0,
  moveZ: 0,
  lookX: 0,
  lookY: 0,
  firing: false,
  ads: false,
  crouch: false,
  crouchToggle: false,
  sprint: false,
  jumpQueued: false,
  reloadQueued: false,
  swapQueued: 0,
};

export const isTouch = () =>
  (typeof window !== "undefined") &&
  (("ontouchstart" in window) || (navigator.maxTouchPoints > 0 && window.matchMedia("(pointer: coarse)").matches));

export function consumeLook() {
  const x = input.lookX;
  const y = input.lookY;
  input.lookX = 0;
  input.lookY = 0;
  return { x, y };
}

export function resetInput() {
  input.moveX = 0;
  input.moveZ = 0;
  input.firing = false;
  input.ads = false;
  input.jumpQueued = false;
  input.reloadQueued = false;
  input.swapQueued = 0;
  input.lookX = 0;
  input.lookY = 0;
}

function bindTouchControls() {
  const stick = document.getElementById("stick");
  const base = document.getElementById("stickBase");
  const knob = document.getElementById("stickKnob");
  if (!stick || !base || !knob) return;

  let stickId = null;
  let originX = 0;
  let originY = 0;
  const RADIUS = 58;

  // Algunos navegadores lanzan NotFoundError si el puntero ya no está activo;
  // capturar es una comodidad, no un requisito.
  const capture = (el, id) => {
    try {
      el.setPointerCapture(id);
    } catch {
      /* el gesto sigue funcionando sin captura */
    }
  };

  const clearStick = () => {
    stickId = null;
    input.moveX = 0;
    input.moveZ = 0;
    knob.style.transform = "translate(-50%, -50%)";
  };

  stick.addEventListener("pointerdown", (e) => {
    if (stickId !== null) return;
    stickId = e.pointerId;
    capture(stick, e.pointerId);
    originX = e.clientX;
    originY = e.clientY;
    base.style.left = `${e.clientX}px`;
    base.style.top = `${e.clientY}px`;
    base.style.bottom = "auto";
    e.preventDefault();
  });

  stick.addEventListener("pointermove", (e) => {
    if (e.pointerId !== stickId) return;
    let dx = e.clientX - originX;
    let dy = e.clientY - originY;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      dx = (dx / len) * RADIUS;
      dy = (dy / len) * RADIUS;
    }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    input.moveX = dx / RADIUS;
    input.moveZ = dy / RADIUS;
    e.preventDefault();
  });

  stick.addEventListener("pointerup", clearStick);
  stick.addEventListener("pointercancel", clearStick);

  // Botones de acción
  const hold = (id, on, off) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("pointerdown", (e) => {
      el.classList.add("held");
      on();
      capture(el, e.pointerId);
      e.preventDefault();
    });
    const release = () => { el.classList.remove("held"); if (off) off(); };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
  };

  hold("btnFire", () => { input.firing = true; }, () => { input.firing = false; });
  hold("btnJump", () => { input.jumpQueued = true; });
  hold("btnReload", () => { input.reloadQueued = true; });
  hold("btnSwap", () => { input.swapQueued += 1; });
  hold("btnAds", () => { input.ads = !input.ads; });
  hold("btnCrouch", () => { input.crouchToggle = !input.crouchToggle; });
}

export function initInput(canvas, handlers = {}) {
  // ---------- Teclado ----------
  const onKey = (e, down) => {
    input.keys[e.code] = down;
    if (!down) return;
    if (e.code === "Space") { input.jumpQueued = true; e.preventDefault(); }
    if (e.code === "KeyR") input.reloadQueued = true;
    if (e.code === "Digit1") input.swapQueued += 1;
    if (e.code === "Digit2") input.swapQueued += 2;
    if (e.code === "KeyQ") input.swapQueued += 1;
    if (e.code === "Escape" && handlers.onPause) handlers.onPause();
  };
  window.addEventListener("keydown", (e) => onKey(e, true));
  window.addEventListener("keyup", (e) => onKey(e, false));
  window.addEventListener("blur", () => {
    input.firing = false;
  });

  // ---------- Ratón ----------
  document.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement !== canvas) return;
    input.lookX += e.movementX;
    input.lookY += e.movementY;
  });

  canvas.addEventListener("mousedown", (e) => {
    if (handlers.isPlaying && !handlers.isPlaying()) return;
    if (document.pointerLockElement !== canvas) return;
    if (e.button === 0) input.firing = true;
    if (e.button === 2) input.ads = true;
  });
  window.addEventListener("mouseup", (e) => {
    if (e.button === 0) input.firing = false;
    if (e.button === 2) input.ads = false;
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // ---------- Táctil: arrastrar para apuntar ----------
  let lookId = null;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
    if (handlers.isPlaying && !handlers.isPlaying()) return;
    if (lookId !== null) return;
    lookId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* sin captura el arrastre sigue avanzando mientras el dedo baje */
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerId !== lookId) return;
    input.lookX += (e.clientX - lastX) * 1.7;
    input.lookY += (e.clientY - lastY) * 1.7;
    lastX = e.clientX;
    lastY = e.clientY;
    e.preventDefault();
  });

  const endLook = (e) => {
    if (e.pointerId === lookId) lookId = null;
  };
  canvas.addEventListener("pointerup", endLook);
  canvas.addEventListener("pointercancel", endLook);

  bindTouchControls();

  document.addEventListener("pointerlockchange", () => {
    const locked = document.pointerLockElement === canvas;
    if (!locked && handlers.onLockLost) handlers.onLockLost();
  });
}

/** Lee el teclado y lo combina con el joystick táctil. */
export function readMoveAxes() {
  let x = input.moveX;
  let z = input.moveZ;
  const k = input.keys;
  if (k["KeyW"] || k["ArrowUp"]) z -= 1;
  if (k["KeyS"] || k["ArrowDown"]) z += 1;
  if (k["KeyA"] || k["ArrowLeft"]) x -= 1;
  if (k["KeyD"] || k["ArrowRight"]) x += 1;
  const len = Math.hypot(x, z);
  if (len > 1) { x /= len; z /= len; }
  input.sprint = !!(k["ShiftLeft"] || k["ShiftRight"]);
  input.crouch = !!(k["ControlLeft"] || k["ControlRight"] || input.crouchToggle);
  return { x, z };
}
