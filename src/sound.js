let ctx = null;
let muted = false;

export const setMuted = (m) => {
  muted = m;
};

export const isMuted = () => muted;

function beep(freq, dur = 0.15, type = 'sine', vol = 0.15) {
  if (muted) return;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = vol;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.stop(ctx.currentTime + dur);
  } catch {
    /* audio ไม่พร้อมใช้งาน — ข้ามไป */
  }
}

export const sfx = {
  start: () => beep(523, 0.12),
  pause: () => beep(392, 0.1, 'triangle', 0.08),
  event: () => beep(440, 0.08, 'triangle', 0.1),
  complete: () => {
    beep(659, 0.12);
    setTimeout(() => beep(880, 0.2), 120);
  },
  levelup: () => {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.16), i * 120));
  },
  boss: () => beep(110, 0.4, 'sawtooth', 0.1),
  click: () => beep(700, 0.05, 'square', 0.05),
};
