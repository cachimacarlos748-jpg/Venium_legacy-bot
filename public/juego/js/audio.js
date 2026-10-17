// ============================================================
// AUDIO — todos los sonidos se sintetizan con WebAudio.
// No se descarga ningún archivo: la CSP del bot solo permite
// recursos propios y el juego tiene que sonar igual en la calle
// con mala conexión.
// ============================================================

let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;

function makeNoiseBuffer() {
  const len = Math.floor(ctx.sampleRate * 0.6);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
  return buf;
}

export function initAudio() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.34;
  master.connect(ctx.destination);
  noiseBuf = makeNoiseBuffer();
  return ctx;
}

export function resumeAudio() {
  if (ctx && ctx.state === "suspended") ctx.resume();
}

export function setMuted(value) {
  muted = value;
  if (master) master.gain.value = value ? 0 : 0.34;
}

function now() { return ctx.currentTime; }

/** Ruido filtrado con envolvente: disparos, impactos, pasos. */
function noiseHit({ dur = 0.12, freq = 1800, q = 0.8, gain = 0.6, type = "lowpass", decay = 0.06, delay = 0 }) {
  if (!ctx || muted) return;
  const t = now() + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, t);
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur + decay);
  src.connect(filter);
  filter.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + dur + decay + 0.02);
}

/** Tono simple: avisos, golpes graves, campanas de headshot. */
function tone({ freq = 440, freq2 = null, dur = 0.1, type = "sine", gain = 0.25, delay = 0 }) {
  if (!ctx || muted) return;
  const t = now() + delay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (freq2) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq2), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

const WEAPON_VOICE = {
  rifle: { freq: 2600, dur: 0.09, gain: 0.55, thump: 120, thumpGain: 0.3 },
  pistol: { freq: 3200, dur: 0.06, gain: 0.45, thump: 160, thumpGain: 0.22 },
  shotgun: { freq: 1400, dur: 0.16, gain: 0.7, thump: 80, thumpGain: 0.4 },
};

export const sfx = {
  shot(kind = "rifle") {
    const v = WEAPON_VOICE[kind] || WEAPON_VOICE.rifle;
    noiseHit({ dur: v.dur, freq: v.freq, q: 0.7, gain: v.gain, decay: 0.05 });
    tone({ freq: v.thump, freq2: v.thump * 0.5, dur: 0.09, type: "triangle", gain: v.thumpGain });
  },
  dryFire() {
    noiseHit({ dur: 0.04, freq: 4200, gain: 0.35, decay: 0.02 });
  },
  hit() {
    tone({ freq: 1250, dur: 0.05, type: "square", gain: 0.16 });
    noiseHit({ dur: 0.05, freq: 3000, gain: 0.3, decay: 0.02 });
  },
  headshot() {
    tone({ freq: 1500, dur: 0.07, type: "square", gain: 0.2 });
    tone({ freq: 2100, dur: 0.09, type: "square", gain: 0.18, delay: 0.06 });
  },
  kill() {
    tone({ freq: 900, freq2: 260, dur: 0.22, type: "sawtooth", gain: 0.16 });
    tone({ freq: 1500, dur: 0.08, type: "square", gain: 0.12, delay: 0.02 });
  },
  hurt() {
    noiseHit({ dur: 0.2, freq: 420, q: 0.6, gain: 0.5, decay: 0.1 });
    tone({ freq: 180, freq2: 90, dur: 0.2, type: "triangle", gain: 0.28 });
  },
  enemyShot(distance = 20) {
    const g = Math.max(0.05, 0.42 - distance * 0.008);
    noiseHit({ dur: 0.07, freq: 1800, gain: g, decay: 0.05 });
  },
  reloadIn() {
    noiseHit({ dur: 0.05, freq: 900, q: 4, type: "bandpass", gain: 0.5, decay: 0.03 });
    noiseHit({ dur: 0.06, freq: 600, q: 3, type: "bandpass", gain: 0.4, decay: 0.04, delay: 0.09 });
  },
  reloadOut() {
    noiseHit({ dur: 0.05, freq: 1400, q: 5, type: "bandpass", gain: 0.5, decay: 0.03 });
  },
  empty() {
    tone({ freq: 2200, dur: 0.04, type: "square", gain: 0.12 });
  },
  step() {
    noiseHit({ dur: 0.05, freq: 700, q: 1.2, gain: 0.12, decay: 0.03 });
  },
  waveStart() {
    tone({ freq: 320, freq2: 700, dur: 0.3, type: "sawtooth", gain: 0.2 });
    tone({ freq: 640, freq2: 1400, dur: 0.32, type: "sawtooth", gain: 0.14, delay: 0.05 });
  },
  death() {
    tone({ freq: 420, freq2: 70, dur: 0.9, type: "sawtooth", gain: 0.3 });
    noiseHit({ dur: 0.7, freq: 500, gain: 0.4, decay: 0.4 });
  },
};
