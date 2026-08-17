// เสียงเอฟเฟกต์ — สังเคราะห์ด้วย Web Audio (ไม่ต้องโหลดไฟล์เสียง: เร็ว ไฟล์เล็ก ไม่มีเรื่องลิขสิทธิ์)
// tone() = โน้ต 1 ตัว มี ADSR สั้น ๆ + เลเยอร์ฮาร์โมนิก (ทำให้เสียงเป็น "กระดิ่ง" ไม่ใช่บี๊บแบน ๆ)
// seq() = ร้องโน้ตหลายตัวต่อเนื่อง (เมโลดี้/แฟนแฟร์)
let ctx = null;
let muted = false;

export const setMuted = (m) => {
  muted = m;
};

export const isMuted = () => muted;

function ensureCtx() {
  if (muted) return null;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq, { dur = 0.3, type = 'sine', vol = 0.15, attack = 0.008, delay = 0, harmonics = [], glide = null } = {}) {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const stopAt = t0 + dur + 0.02;
  const layers = [{ freq, type, vol }];
  for (const h of harmonics) layers.push({ freq: freq * h.mult, type: h.type || 'sine', vol: vol * (h.vol ?? 0.3) });
  for (const L of layers) {
    try {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = L.type;
      osc.frequency.setValueAtTime(L.freq, t0);
      if (glide) osc.frequency.exponentialRampToValueAtTime(glide, t0 + Math.min(dur, 0.3));
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(L.vol, t0 + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t0);
      osc.stop(stopAt);
    } catch {
      /* audio ไม่พร้อมใช้งาน — ข้ามไป */
    }
  }
}

// ร้องโน้ตหลายตัว: notes = [523, 659] หรือ [{ f: 523, dur: 0.2, type: 'triangle' }, ...]
function seq(notes, { gap = 0.09, ...rest } = {}) {
  notes.forEach((n, i) => {
    if (typeof n === 'number') tone(n, { ...rest, delay: (rest.delay || 0) + i * gap });
    else tone(n.f, { ...rest, ...n, delay: (n.delay || 0) + (rest.delay || 0) + i * gap });
  });
}

export const sfx = {
  // คลิกปุ่ม — จิ๊กสั้น ๆ เบา ๆ
  click: () => tone(740, { dur: 0.05, type: 'square', vol: 0.045 }),

  // เริ่มโฟกัส — คู่เสียงสดใสขึ้น
  start: () => seq([523, 784], { dur: 0.1, type: 'triangle', vol: 0.12, gap: 0.07 }),

  // หยุดพัก (⏸️) — นุ่ม ๆ ค่อยจาง
  pause: () => tone(330, { dur: 0.28, type: 'triangle', vol: 0.09, glide: 280 }),

  // เหตุการณ์สุ่มทั่วไป — ประกายสองจังหวะ
  event: () => seq([880, 1175], { dur: 0.09, type: 'triangle', vol: 0.11, gap: 0.06, harmonics: [{ mult: 2, vol: 0.3 }] }),

  // จบ work session — แฟนแฟร์ "สำเร็จ" กระดิ่งดัง ๆ (C5 E5 G5 C6)
  complete: () => seq([523, 659, 784, 1047], { dur: 0.32, type: 'sine', vol: 0.16, gap: 0.11, harmonics: [{ mult: 2, vol: 0.35 }, { mult: 3, vol: 0.14 }] }),

  // เริ่มพักเบรก/พักหลังชนะบอส — คู่เสียงนุ่มลงมา
  breakStart: () => seq([659, 523], { dur: 0.3, type: 'sine', vol: 0.13, gap: 0.13, harmonics: [{ mult: 2, vol: 0.25 }] }),

  // หมดเวลาพัก — "ติ๊งต่อง" เรียกให้รู้ว่าพักครบ
  breakOver: () => seq([660, 880], { dur: 0.4, type: 'sine', vol: 0.14, gap: 0.3, harmonics: [{ mult: 2.76, vol: 0.3 }] }),

  // ไข่ฟัก — ป๊อปขึ้น + สายฟ้าสูงน่ารัก ๆ
  hatch: () => {
    tone(392, { dur: 0.12, type: 'triangle', vol: 0.12, glide: 520 });
    seq([784, 1047, 1319], { dur: 0.24, type: 'sine', vol: 0.13, gap: 0.1, delay: 0.12, harmonics: [{ mult: 2, vol: 0.3 }] });
  },

  // กับดัก — วูบลง (เสียงตกหลุม)
  trap: () => tone(300, { dur: 0.38, type: 'sawtooth', vol: 0.09, glide: 130 }),

  // เหรียญทอง — ดิงสั้น ๆ (สมบัติ/พ่อค้า/ค่าปลอบใจ)
  coin: () => tone(1320, { dur: 0.2, type: 'sine', vol: 0.1, harmonics: [{ mult: 2.01, vol: 0.25 }] }),

  // เลเวลอัพ — แฟนแฟร์ใหญ่กว่า complete (C5 E5 G5 C6 E6)
  levelup: () => seq([523, 659, 784, 1047, 1319], { dur: 0.3, type: 'sine', vol: 0.16, gap: 0.1, harmonics: [{ mult: 2, vol: 0.3 }] }),

  // บอส — เสียงต่ำข่มขู่ (ซอว์ทูธ + เบสทับ)
  boss: () => tone(82, { dur: 0.8, type: 'sawtooth', vol: 0.12, harmonics: [{ mult: 0.5, vol: 0.6, type: 'sine' }] }),
};
