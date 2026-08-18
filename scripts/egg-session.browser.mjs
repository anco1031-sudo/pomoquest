// ตรวจสอบ UI หน้า Session (โฟกัส): ฟอง pet (🐾 ตัวที่ active) + ป้าย 🥚 กำลังฟัก… ข้างไอคอนเมือง
// รัน: ต้องรัน server ที่ :3001 ก่อน (POMOQUEST_DB=ชั่วคราว + dist build แล้ว) แล้วรัน node scripts/egg-session.browser.mjs
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';

const BASE = 'http://127.0.0.1:3001';
const db = new Database(process.env.POMOQUEST_DB || './server/data/pomoquest.db');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const expect = (label, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
  cond ? pass++ : fail++;
};

const api = async (path, { method = 'GET', body } = {}) => {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};

// ---- ตั้งข้อมูล: สร้างตัวละครใหม่ + ใส่ไข่ 1 ใบ + work 1 นาที (จบเร็ว) ----
let r = await api('/character/create', { method: 'POST', body: { name: `eggS${Date.now()}`, class: 'warrior' } });
if (r.status !== 200) { console.log('❌ สร้างตัวละครไม่ได้:', r.json.error); process.exit(1); }
const cid = r.json.character.id;
await api('/settings', { method: 'PUT', body: { work_min: 1 } });
db.prepare('INSERT OR IGNORE INTO inventory (character_id, item_id, qty) VALUES (?, 170, 1)').run(cid);
r = await api('/inventory/use', { method: 'POST', body: { itemId: 170 } });
expect('session-pet: ใช้ไข่ → เริ่มฟัก (hatchPending)', r.status === 200 && r.json.character.hatchPending === true, r.json.error || '');

// ---- รัน chromium headless + CDP ----
const profile = `/tmp/pq-egg-session-${Date.now()}`;
const chromeBin = ['chromium', 'google-chrome', 'google-chrome-stable', 'chrome'].find((b) => {
  try { spawn(b, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}) || 'chromium';
const chrome = spawn(chromeBin, [
  '--headless=new', '--no-sandbox', '--disable-gpu',
  '--remote-debugging-port=9341', `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

const wsUrl = await (async () => {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9341/json');
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* ยังไม่พร้อม */ }
    await sleep(200);
  }
  throw new Error('เปิด CDP ไม่ได้');
})();

const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const id = ++msgId;
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});
const evalJs = async (expr) => {
  const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (m.result?.exceptionDetails) throw new Error('eval error: ' + JSON.stringify(m.result.exceptionDetails));
  return m.result?.result?.value;
};

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: BASE });
await sleep(2500);

// ---- 1) ยังไม่มี pet: เข้า session → ฟอง 🥚 + ป้าย 🥚 กำลังฟัก… บนหน้าโฟกัส ----
const startClicked = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find((x) => x.textContent.includes('เริ่มผจญภัย'));
  if (!b) return false;
  b.click();
  return true;
})()`);
expect('session-pet: กดเริ่มผจญภัยได้', startClicked === true);
await sleep(1200);

let onSession = await evalJs(`!!document.querySelector('.timer-screen')`);
expect('session-pet: อยู่ในหน้าโฟกัส', onSession, '');
const petBox = await evalJs(`(() => {
  const el = document.querySelector('.timer-pet');
  if (!el) return null;
  return {
    bubble: el.querySelector('.companion-bubble')?.textContent?.trim() || '',
    badge: el.querySelector('.hatch-badge')?.textContent?.trim() || '',
    hasLv: !!el.querySelector('.pet-lv-tag'),
  };
})()`);
expect('session-pet: ฟอง pet ขึ้น (🥚 ยังไม่มีตัว) + ป้าย "กำลังฟัก"', !!petBox && petBox.bubble.includes('🥚') && petBox.badge.includes('กำลังฟัก') && !petBox.hasLv, JSON.stringify(petBox));

// ---- 1.5) บังคับเข้าค่ายพัก (short_break) → ฟอง 🥚 + ป้ายฟักขึ้นบน Camp ด้วย ----
const forcedCamp1 = await evalJs(`(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('pomoquest-timer-'));
  if (!key) return false;
  const t = {
    phase: 'short_break', sessionIdx: 1, remain: 60, running: true, elapsed: 0,
    nextEventIn: 90, sessionEvents: [], sessionKey: null, breakVisit: 'camp-pet-test',
    awaitingBreak: false, breakOver: false, overrun: 0, breakExtends: 0,
    breakStartedAt: Date.now(), pausedAtHome: false, pauseStartedAt: null, pauseAccumSec: 0,
    expiresAt: Date.now() + 60000,
  };
  localStorage.setItem(key, JSON.stringify(t));
  location.reload();
  return true;
})()`);
expect('session-pet: บังคับเข้าค่ายพักได้ (ก่อนฟัก)', forcedCamp1 === true);
await sleep(2500);
const campPet1 = await evalJs(`(() => {
  const bubble = document.querySelector('.camp-pet .companion-bubble')?.textContent?.trim() || '';
  const chip = document.querySelector('.camp-header-right .hatch-chip')?.textContent?.trim() || '';
  return { bubble, chip, hasLv: !!document.querySelector('.camp-pet .pet-lv-tag') };
})()`);
expect('session-pet: Camp — ฟอง 🥚 + ป้าย "กำลังฟัก" (ยังไม่มี pet)', !!campPet1 && campPet1.bubble.includes('🥚') && campPet1.chip.includes('กำลังฟัก') && !campPet1.hasLv, JSON.stringify(campPet1));

// ---- 2) จบ session → ไข่ฟักได้ pet + active ----
r = await api('/adventure/complete', { method: 'POST', body: { focusSec: 60, events: [] } });
expect('session-pet: จบ session → ไข่ฟัก (มี pet + active)', r.status === 200 && r.json.hatch && !r.json.hatch.waiting && r.json.character.pets.some((p) => p.active), r.json.error || JSON.stringify(r.json.hatch));

// ---- 3) รีโหลด + เข้า session ใหม่ → ฟอง pet แสดง pet + Lv + อารมณ์ (ไม่มีป้ายฟักแล้ว) ----
// เคลียร์ localStorage ก่อน (กันกู้คืน session เก่าที่ค้างจากรอบ 1 → ตรงหน้าโฟกัสเลย) แล้วโหลด Home ใหม่
await evalJs(`localStorage.clear(); true`);
await send('Page.navigate', { url: BASE });
await sleep(2200);
const startClicked2 = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find((x) => x.textContent.includes('เริ่มผจญภัย'));
  if (!b) return false;
  b.click();
  return true;
})()`);
expect('session-pet: กดเริ่มผจญภัยได้ (รอบ 2)', startClicked2 === true);
await sleep(1200);
const petBox2 = await evalJs(`(() => {
  const el = document.querySelector('.timer-pet');
  if (!el) return null;
  return {
    bubble: el.querySelector('.companion-bubble')?.textContent?.trim() || '',
    badge: el.querySelector('.hatch-badge')?.textContent?.trim() || '',
    hasLv: !!el.querySelector('.pet-lv-tag'),
    hasMood: !!el.querySelector('.pet-mood-emoji'),
    moodClass: el.querySelector('.companion-bubble')?.className || '',
  };
})()`);
expect('session-pet: ฟอง pet แสดง pet + Lv + อารมณ์ (ป้ายฟักหาย)', !!petBox2 && !petBox2.bubble.includes('🥚') && petBox2.hasLv && petBox2.hasMood && !petBox2.badge, JSON.stringify(petBox2));

// ---- 5) บังคับเข้าค่ายพักอีกครั้ง → ฟอง pet ขึ้นบน Camp (pet + Lv + อารมณ์, ป้ายฟักหาย) ----
const forcedCamp2 = await evalJs(`(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('pomoquest-timer-'));
  if (!key) return false;
  const t = {
    phase: 'short_break', sessionIdx: 1, remain: 60, running: true, elapsed: 0,
    nextEventIn: 90, sessionEvents: [], sessionKey: null, breakVisit: 'camp-pet-test2',
    awaitingBreak: false, breakOver: false, overrun: 0, breakExtends: 0,
    breakStartedAt: Date.now(), pausedAtHome: false, pauseStartedAt: null, pauseAccumSec: 0,
    expiresAt: Date.now() + 60000,
  };
  localStorage.setItem(key, JSON.stringify(t));
  location.reload();
  return true;
})()`);
expect('session-pet: บังคับเข้าค่ายพักได้ (หลังฟัก)', forcedCamp2 === true);
await sleep(2500);
const campPet2 = await evalJs(`(() => {
  const el = document.querySelector('.camp-pet .companion-bubble');
  if (!el) return null;
  return {
    bubble: el.textContent?.trim() || '',
    hasLv: !!document.querySelector('.camp-pet .pet-lv-tag'),
    hasMood: !!document.querySelector('.camp-pet .pet-mood-emoji'),
    chip: document.querySelector('.camp-header-right .hatch-chip')?.textContent?.trim() || '',
    moodClass: el.className || '',
  };
})()`);
expect('session-pet: Camp — ฟอง pet แสดง pet + Lv + อารมณ์ (ป้ายฟักหาย)', !!campPet2 && !campPet2.bubble.includes('🥚') && campPet2.hasLv && campPet2.hasMood && !campPet2.chip, JSON.stringify(campPet2));

chrome.kill();
console.log(`\nผลลัพธ์: ${pass} ผ่าน, ${fail} ตก`);
process.exit(fail > 0 ? 1 : 0);
