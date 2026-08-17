// ตรวจสอบ: กดใช้ไข่ในค่าย → จำนวนไข่ในกระเป๋าลดลงจริง (UI อัปเดต) + ป้ายฟักขึ้น
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';

const db = new Database(process.env.POMOQUEST_DB || './server/data/pomoquest.db');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const expect = (label, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
  cond ? pass++ : fail++;
};

const chrome = spawn('/usr/bin/chromium', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required',
  '--remote-debugging-port=9338', '--user-data-dir=/tmp/pq-chrome-eggqty', 'about:blank',
], { stdio: 'ignore' });

let ws = null;
for (let i = 0; i < 30 && !ws; i++) {
  await sleep(500);
  try {
    const res = await fetch('http://127.0.0.1:9338/json');
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

// สร้างตัวละคร + ใส่ไข่ 2 ใบ
const created = await api('/character/create', { method: 'POST', body: { name: `eggq${Date.now()}`, class: 'warrior' } });
const charId = created?.json?.character?.id;
expect('สร้างตัวละคร test สำเร็จ', !!charId, `id=${charId}`);
db.prepare('INSERT INTO inventory (character_id, item_id, qty) VALUES (?, 170, 2) ON CONFLICT(character_id, item_id) DO UPDATE SET qty = qty + 2').run(charId);
const epoch = db.prepare('SELECT epoch FROM settings WHERE id = 1').get()?.epoch || '';

await send('Page.navigate', { url: 'http://127.0.0.1:3001/' });
await sleep(2500);

// ไปที่หน้า camp (เริ่มพักเบรก)
await evalJs(`localStorage.setItem('pomoquest-timer-${charId}', ${JSON.stringify(JSON.stringify({ phase: 'short_break', sessionIdx: 1, remain: 600, running: true, elapsed: 0, nextEventIn: 9999, sessionEvents: [], sessionKey: null, breakVisit: `b-${Date.now()}`, awaitingBreak: false, breakOver: false, overrun: 0, breakStartedAt: Date.now(), breakAtHome: false, postBossNote: null, pausedAtHome: false, pauseStartedAt: null, pauseAccumSec: 0, focusTask: '', expiresAt: null, epoch }))})`);
await send('Page.navigate', { url: 'http://127.0.0.1:3001/' });
await sleep(3000);

// หาปุ่มแท็บกระเป๋าแล้วกด
const tabClick = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button')];
  const tab = btns.find(b => b.textContent.includes('🎒') || b.textContent.includes('กระเป๋า'));
  if (!tab) return 'no-tab: ' + btns.map(b => b.textContent.trim().slice(0, 20)).join(' | ');
  tab.click();
  return 'clicked';
})()`);
console.log('แท็บ:', tabClick);
await sleep(1500);

const invText = await evalJs(`(() => {
  const rows = [...document.querySelectorAll('.inv-row')].map(r => r.textContent.replace(/\\s+/g, ' ').trim());
  return JSON.stringify(rows);
})()`);
console.log('inv rows:', invText);

// จำนวนไข่ก่อนใช้
const qtyBefore = await evalJs(`(() => {
  const rows = [...document.querySelectorAll('.inv-row')];
  const eggRow = rows.find(r => r.textContent.includes('ไข่ปริศนา'));
  if (!eggRow) return null;
  const m = eggRow.textContent.match(/x(\\d+)/);
  return m ? m[1] : 'no-qty:' + eggRow.textContent;
})()`);
console.log('จำนวนไข่ก่อนใช้:', qtyBefore);

// กดปุ่ม "ใช้" ของไข่
const clickedUse = await evalJs(`(() => {
  const rows = [...document.querySelectorAll('.inv-row')];
  const eggRow = rows.find(r => r.textContent.includes('ไข่ปริศนา'));
  if (!eggRow) return 'no-row';
  const btn = [...eggRow.querySelectorAll('button')].find(b => b.textContent.includes('ใช้'));
  if (!btn) return 'no-btn';
  btn.click();
  return 'clicked';
})()`);
console.log('กดใช้:', clickedUse);
await sleep(2500);

const qtyAfter = await evalJs(`(() => {
  const rows = [...document.querySelectorAll('.inv-row')];
  const eggRow = rows.find(r => r.textContent.includes('ไข่ปริศนา'));
  if (!eggRow) return null;
  const m = eggRow.textContent.match(/x(\\d+)/);
  return m ? m[1] : 'no-qty:' + eggRow.textContent;
})()`);
console.log('จำนวนไข่หลังใช้:', qtyAfter);
const hatchBadge = await evalJs(`document.body.innerText.includes('กำลังฟัก')`);
console.log('ป้ายฟัก:', hatchBadge);

expect('จำนวนไข่ลดลงหลังใช้ (2 → 1)', qtyBefore === '2' && qtyAfter === '1', `ก่อน=${qtyBefore} หลัง=${qtyAfter}`);
expect('ป้ายกำลังฟักขึ้น', hatchBadge, '');

chrome.kill();
console.log(`\nผลลัพธ์: ${pass} ผ่าน, ${fail} ตก`);
process.exit(fail > 0 ? 1 : 0);
