// ============================================================
// HUD — todo lo que se ve encima del juego. Nada de React ni
// librerías: referencias al DOM y funciones cortas.
// ============================================================

const $ = (id) => document.getElementById(id);

export const hud = {
  el: {},

  init() {
    const ids = [
      "hud", "crosshair", "hitmarker", "damage-vignette", "lowhp",
      "waveNum", "score", "enemyCount", "feed", "banner", "bannerTitle", "bannerSub",
      "health", "healthFill", "healthNum", "ammo", "weaponName", "ammoMag", "ammoReserve",
      "touch", "menu", "btnPlay", "menuHint", "pause", "btnResume", "btnRestart",
      "gameover", "statWave", "statKills", "statAcc", "statHead", "statScore", "btnRetry", "deadHint",
      "loading", "gl", "stickBase", "stickKnob",
    ];
    for (const id of ids) this.el[id] = $(id);
    this.feedCount = 0;
    this.shakeUntil = 0;
    return this;
  },

  showHud(show) {
    this.el.hud.classList.toggle("hidden", !show);
  },

  setHealth(value) {
    const v = Math.max(0, Math.round(value));
    this.el.healthFill.style.width = `${v}%`;
    this.el.healthNum.textContent = String(v);
    this.el.health.classList.toggle("low", v <= 30);
    this.el.health.classList.toggle("med", v > 30 && v <= 60);
    this.el.lowhp.classList.toggle("on", v <= 30);
  },

  setAmmo(mag, reserve, name, reloading) {
    this.el.ammoMag.textContent = String(Math.max(0, mag));
    this.el.ammoReserve.textContent = reserve === Infinity ? "∞" : String(reserve);
    this.el.weaponName.textContent = name;
    this.el.ammo.classList.toggle("empty", mag <= 0);
    this.el.ammo.classList.toggle("reloading", !!reloading);
  },

  setWave(n) { this.el.waveNum.textContent = String(n); },
  setScore(n) { this.el.score.textContent = String(n); },
  setEnemies(n) { this.el.enemyCount.textContent = String(n); },

  setSpread(px) {
    const v = Math.max(6, Math.min(46, px));
    this.el.crosshair.style.setProperty("--gap", `${v.toFixed(1)}px`);
  },

  hitmarker(kind) {
    const el = this.el.hitmarker;
    el.className = "";
    if (kind === "head") el.classList.add("head");
    else if (kind === "kill") el.classList.add("kill");
    void el.offsetWidth;
    el.classList.add("on");
  },

  flashDamage(amount) {
    const el = this.el["damage-vignette"];
    const strength = Math.min(0.85, 0.25 + amount / 60);
    el.style.opacity = String(strength);
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => { el.style.opacity = "0"; }, 110);
  },

  feed(text, highlight) {
    const li = document.createElement("li");
    li.textContent = text;
    if (highlight) li.classList.add("hs");
    this.el.feed.appendChild(li);
    const items = this.el.feed.children;
    while (items.length > 4) this.el.feed.removeChild(items[0]);
    setTimeout(() => {
      li.style.transition = "opacity 400ms ease";
      li.style.opacity = "0";
      setTimeout(() => li.remove(), 420);
    }, 3400);
  },

  banner(title, sub) {
    const b = this.el.banner;
    this.el.bannerTitle.textContent = title;
    this.el.bannerSub.textContent = sub || "";
    b.classList.remove("hidden");
    b.style.animation = "none";
    void b.offsetWidth;
    b.style.animation = "";
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => b.classList.add("hidden"), 1900);
  },

  showMenu(show) { this.el.menu.classList.toggle("hidden", !show); },
  showPause(show) { this.el.pause.classList.toggle("hidden", !show); },
  showLoading(show) { this.el.loading.classList.toggle("hidden", !show); },

  showGameOver(stats) {
    this.el.statWave.textContent = String(stats.wave);
    this.el.statKills.textContent = String(stats.kills);
    this.el.statAcc.textContent = `${stats.shots > 0 ? Math.round((stats.hits / stats.shots) * 100) : 0}%`;
    this.el.statHead.textContent = String(stats.headshots);
    this.el.statScore.textContent = String(stats.score);
    this.el.deadHint.textContent = stats.score > 4000
      ? "El director pide más: sube dificultad, nuevos mapas o un modo por equipos."
      : "Consejo: usa las cajas para subir a los techos y dispara desde arriba.";
    this.el.gameover.classList.remove("hidden");
  },

  hideGameOver() { this.el.gameover.classList.add("hidden"); },

  enableTouch(on) {
    document.body.classList.toggle("touch", on);
    this.el.touch.classList.toggle("hidden", !on);
  },

  bindButtons({ onPlay, onResume, onRestart, onRetry }) {
    this.el.btnPlay.addEventListener("click", onPlay);
    this.el.btnResume.addEventListener("click", onResume);
    this.el.btnRestart.addEventListener("click", onRestart);
    this.el.btnRetry.addEventListener("click", onRetry);
  },
};
