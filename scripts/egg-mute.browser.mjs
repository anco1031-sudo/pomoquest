// ตรวจสอบ: (1) ปุ่มใช้ไข่ถูก disable ตอนมีไข่กำลังฟัก (tooltip อธิบาย) + (2) ปุ่ม mute 🔊/🔇 ที่หน้า camp และหน้าโฟกัส (Timer) — กดแล้วสลับ + เก็บ localStorage
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import Database from 'better-sqlite3';

rmSync('/tmp/pq-chrome-eggmute', { recursive: true, force: true }); // เริ่มจาก profile สะอาดทุกครั้ง (กัน localStorage ค้างจากรอบก่อน)
const db = new Database(process.env.POMOQUEST_DB || './server/data/pomoquest.db');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const expect = (label, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
  cond ? pass++ : fail++;
};

const chrome = spawn('/usr/bin/chromium', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required',
  '--remote-debugging-port=9339', '--user-data-dir=/tmp/pq-chrome-eggmute', 'about:blank',
], { stdio: 'ignore' });

let ws = null;
for (let i = 0; i < 30 && !ws; i++) {
  await sleep(500);
  try {
    const res = await fetch('http://127.0.0.1:9339/json');
    const list = await res.json();
    const page = list.find((t) => t.type === 'page');
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
        setTimeout(resolve, 3000);
      });
    }
  } catch { /* retry */ }
}
if (!ws) { console.log('❌ chrome ไม่ขึ้น'); chrome.kill(); process.exit(1); }

let msgId = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++msgId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');

const api = async (p, opts = {}) => {
  const r = await fetch('http://127.0.0.1:3001/api' + p, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};

// สร้างตัวละคร + ใส่ไข่ 2 ใบ + ตั้ง hatch_pending=1 (สถานะกำลังฟัก)
const created = await api('/character/create', { method: 'POST', body: { name: `eggm${Date.now()}`, class: 'warrior' } });
const charId = created?.json?.character?.id;
expect('สร้างตัวละคร test สำเร็จ', !!charId, `id=${charId}`);
db.prepare('INSERT INTO inventory (character_id, item_id, qty) VALUES (?, 170, 2) ON CONFLICT(character_id, item_id) DO UPDATE SET qty = qty + 2').run(charId);
db.prepare('UPDATE character SET hatch_pending = 1 WHERE id = ?').run(charId);
const epoch = db.prepare('SELECT epoch FROM settings WHERE id = 1').get()?.epoch || '';

await send('Page.navigate', { url: 'http://127.0.0.1:3001/' });
await sleep(2500);

// ไปที่หน้า camp (พักเบรก)
await evalJs(`localStorage.setItem('pomoquest-timer-${charId}', ${JSON.stringify(JSON.stringify({ phase: 'short_break', sessionIdx: 1, remain: 600, running: true, elapsed: 0, nextEventIn: 9999, sessionEvents: [], sessionKey: null, breakVisit: `b-${Date.now()}`, awaitingBreak: false, breakOver: false, overrun: 0, breakStartedAt: Date.now(), breakAtHome: false, postBossNote: null, pausedAtHome: false, pauseStartedAt: null, pauseAccumSec: 0, focusTask: '', expiresAt: null, epoch }))})`);
await send('Page.navigate', { url: 'http://127.0.0.1:3001/' });
await sleep(3000);

// ---- ปุ่ม mute ที่หน้า camp ----
const campMute = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find(x => x.textContent === '🔊' || x.textContent === '🔇');
  return b ? { found: true, label: b.textContent, title: b.title } : { found: false };
})()`);
console.log('ปุ่ม mute หน้า camp:', JSON.stringify(campMute));
expect('หน้า camp มีปุ่ม mute', campMute.found, JSON.stringify(campMute));

// กด mute → กลายเป็น 🔇 + localStorage อัปเดต
await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find(x => x.textContent === '🔊' || x.textContent === '🔇');
  if (b) b.click();
})()`);
await sleep(800);
const campMuteAfter = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find(x => x.textContent === '🔊' || x.textContent === '🔇');
  return b ? b.textContent : 'none';
})()`);
const lsMuted = await evalJs(`localStorage.getItem('pomoquest-muted')`);
console.log('หลังกด mute:', campMuteAfter, 'localStorage:', lsMuted);
expect('กด mute → ไอคอนเปลี่ยนเป็น 🔇', campMuteAfter === '🔇', campMuteAfter);
expect('localStorage pomoquest-muted = 1', lsMuted === '1', lsMuted);

// ---- ปุ่มใช้ไข่ disable ตอนกำลังฟัก ----
const tabsFound = await evalJs(`[...document.querySelectorAll('button')].map(b => b.textContent.trim().slice(0, 18)).join(' | ')`);
console.log('ปุ่มทั้งหมดบนหน้า:', tabsFound);
await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button')];
  const tab = btns.find(b => b.textContent.includes('🎒'));
  if (tab) tab.click();
})()`);
await sleep(2000);
const invText2 = await evalJs(`[...document.querySelectorAll('.inv-row')].map(r => r.textContent.replace(/\\s+/g, ' ').trim()).join(' || ')`);
console.log('inv rows:', invText2.slice(0, 300));
const eggBtn = await evalJs(`(() => {
  const rows = [...document.querySelectorAll('.inv-row')];
  const eggRow = rows.find(r => r.textContent.includes('ไข่ปริศนา'));
  if (!eggRow) return null;
  const btn = [...eggRow.querySelectorAll('button')].find(b => b.textContent.includes('ใช้'));
  return btn ? { disabled: btn.disabled, title: btn.title || '' } : null;
})()`);
console.log('ปุ่มใช้ไข่:', JSON.stringify(eggBtn));
expect('ปุ่มใช้ไข่ถูก disable ตอนกำลังฟัก', eggBtn?.disabled === true, JSON.stringify(eggBtn));
expect('tooltip อธิบายว่ากำลังฟัก', (eggBtn?.title || '').includes('กำลังฟัก'), eggBtn?.title);

// ---- หน้าโฟกัส (Timer) มีปุ่ม mute ----
await evalJs(`localStorage.setItem('pomoquest-timer-${charId}', ${JSON.stringify(JSON.stringify({ phase: 'work', sessionIdx: 1, remain: 600, running: true, elapsed: 0, nextEventIn: 9999, sessionEvents: [], sessionKey: 'k1', breakVisit: null, awaitingBreak: false, breakOver: false, overrun: 0, breakStartedAt: null, breakAtHome: false, postBossNote: null, pausedAtHome: false, pauseStartedAt: null, pauseAccumSec: 0, focusTask: '', expiresAt: null, epoch }))})`);
await send('Page.navigate', { url: 'http://127.0.0.1:3001/' });
await sleep(3000);
const timerMute = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find(x => x.textContent === '🔊' || x.textContent === '🔇');
  return b ? { found: true, label: b.textContent } : { found: false };
})()`);
console.log('ปุ่ม mute หน้าโฟกัส:', JSON.stringify(timerMute));
expect('หน้าโฟกัส (Timer) มีปุ่ม mute', timerMute.found, JSON.stringify(timerMute));
expect('หน้าโฟกัสแสดงสถานะ mute ค้าง (🔇)', timerMute.label === '🔇', timerMute.label);

// กดที่หน้าโฟกัส → กลับเป็น 🔊 + localStorage กลับเป็น 0
await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find(x => x.textContent === '🔊' || x.textContent === '🔇');
  if (b) b.click();
})()`);
await sleep(800);
const lsMuted2 = await evalJs(`localStorage.getItem('pomoquest-muted')`);
console.log('localStorage หลังกดที่หน้าโฟกัส:', lsMuted2);
expect('กด mute ที่หน้าโฟกัส → localStorage = 0 (เปิดเสียงกลับ)', lsMuted2 === '0', lsMuted2);

// ล้าง state ที่ test สร้างไว้ (กันทิ้งขยะ)
db.prepare('DELETE FROM character WHERE id = ?').run(charId);
db.prepare('DELETE FROM inventory WHERE character_id = ?').run(charId);
db.prepare('DELETE FROM progress WHERE id = ?').run(charId);
db.prepare('DELETE FROM log WHERE character_id = ?').run(charId);
db.prepare('DELETE FROM achievement_unlock WHERE character_id = ?').run(charId);

chrome.kill();
console.log(`\nผลลัพธ์: ${pass} ผ่าน, ${fail} ตก`);
process.exit(fail > 0 ? 1 : 0);
