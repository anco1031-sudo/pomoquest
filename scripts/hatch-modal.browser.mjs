// ตรวจสอบ: 1) ป้าย "🥚 กำลังฟัก…" บนหัวค่ายตอนไข่กำลังฟัก 2) จบ session → modal ฉลองไข่ฟัก (แทน toast)
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
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--remote-debugging-port=9336', '--user-data-dir=/tmp/pq-chrome-hatch', 'about:blank',
], { stdio: 'ignore' });

let ws = null;
for (let i = 0; i < 30 && !ws; i++) {
  await sleep(500);
  try {
    const res = await fetch('http://127.0.0.1:9336/json');
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

// สร้างตัวละคร + เลเวลสูง (กัน level-up เด้งในคิว modal) + ใช้ไข่ (เริ่มฟัก)
const name = `hatchM${Date.now()}`;
const created = await api('/character/create', { method: 'POST', body: { name, class: 'warrior' } });
const charId = created?.json?.character?.id;
expect('สร้างตัวละคร test สำเร็จ', !!charId, `id=${charId}`);
db.prepare('UPDATE character SET level = 50, max_hp = 3000, hp = 3000, mp = 500, max_mp = 500 WHERE id = ?').run(charId);
db.prepare('INSERT OR IGNORE INTO inventory (character_id, item_id, qty) VALUES (?, 170, 1)').run(charId);
await api('/inventory/use', { method: 'POST', body: { itemId: 170 } });
const epoch = db.prepare('SELECT epoch FROM settings WHERE id = 1').get()?.epoch || '';

// 1) ป้ายไข่กำลังฟักบนหัวค่าย — ตั้ง timer พักสั้นแล้วโหลดหน้า
await send('Page.navigate', { url: 'http://127.0.0.1:3001/' });
await sleep(2500);
const campTimer = {
  phase: 'short_break', sessionIdx: 1, remain: 120, running: true, elapsed: 0, nextEventIn: 9999,
  sessionEvents: [], sessionKey: null, breakVisit: `h-${Date.now()}`, awaitingBreak: false,
  breakOver: false, overrun: 0, breakStartedAt: Date.now(), breakAtHome: false, postBossNote: null,
  pausedAtHome: false, pauseStartedAt: null, pauseAccumSec: 0, focusTask: '', epoch,
  expiresAt: Date.now() + 120000,
};
await evalJs(`localStorage.setItem('pomoquest-timer-${charId}', ${JSON.stringify(JSON.stringify(campTimer))})`);
await send('Page.navigate', { url: 'http://127.0.0.1:3001/' });
await sleep(3000);
const campChip = (await evalJs(`document.querySelector('.hatch-chip')?.textContent?.replace(/\\s+/g, ' ').trim() || ''`)) || '';
expect('หัวค่าย: มีป้าย "🥚 กำลังฟัก…"', campChip.includes('กำลังฟัก'), `'${campChip}'`);

// 2) จบ work session → modal ฉลองไข่ฟัก — ตั้ง timer งานเหลือ 2 วิแล้วโหลดหน้า
const workTimer = {
  phase: 'work', sessionIdx: 1, remain: 3, running: true, elapsed: 0, nextEventIn: 9999,
  sessionEvents: [], sessionKey: `wk-${Date.now()}`, breakVisit: null, awaitingBreak: false,
  breakOver: false, overrun: 0, breakStartedAt: null, breakAtHome: false, postBossNote: null,
  pausedAtHome: false, pauseStartedAt: null, pauseAccumSec: 0, focusTask: '', epoch,
  expiresAt: null, // ให้ remain คงเดิม (กัน recompute จนเหลือ 0 ถ้าโหลดช้า)
};
await evalJs(`localStorage.setItem('pomoquest-timer-${charId}', ${JSON.stringify(JSON.stringify(workTimer))})`);
await send('Page.navigate', { url: 'http://127.0.0.1:3001/' });
// รอ session จบ + คลิกผ่าน modal อื่นในคิว (ตรา "ก้าวแรก" ถ้ามี) จนเจอ modal ไข่ฟัก
let hatchSeen = false;
for (let i = 0; i < 40 && !hatchSeen; i++) {
  await sleep(1200);
  hatchSeen = await evalJs(`document.body.innerText.includes('🥚 ไข่ฟักแล้ว!')`);
  if (!hatchSeen) {
    await evalJs(`[...document.querySelectorAll('.modal button')].find(b => b.textContent.includes('รับรางวัล') || b.textContent.includes('รับทราบ') || b.textContent.includes('ใช้แต้ม'))?.click()`);
  }
}
const modalText = (await evalJs(`[...document.querySelectorAll('.modal')].map(m => m.textContent.replace(/\\s+/g, ' ').trim()).join(' | ') || ''`)) || '';
const hasPetName = /🐹|🐥|🦊|🦉|🐍|🐈|🐉|🦄/.test(modalText);
const hasRarity = /ทั่วไป|หายาก|หายากมาก|ตำนาน/.test(modalText);
const hasBtn = await evalJs(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('รับ') && b.textContent.includes('ไว้ดูแล'))`);
expect('จบ session → modal "🥚 ไข่ฟักแล้ว!" โชว์ pet + rarity + ปุ่มรับ', hatchSeen && hasPetName && hasRarity && hasBtn, `'${modalText.slice(0, 110)}'`);

// 3) กดปุ่มรับ → modal ปิด → ขึ้น modal จบเซสชัน (ถามพัก/ข้าม)
await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('ไว้ดูแล'))?.click()`);
await sleep(1000);
const hatchGone = await evalJs(`!document.body.innerText.includes('🥚 ไข่ฟักแล้ว!')`);
const breakAsk = await evalJs(`document.body.innerText.includes('จบเซสชันที่')`);
expect('ปิด modal ฟัก → ถามพักเบรก/ข้ามตามปกติ', hatchGone && breakAsk, `hatchGone=${hatchGone} breakAsk=${breakAsk}`);

chrome.kill();
console.log(`\nผลลัพธ์: ${pass} ผ่าน, ${fail} ตก`);
process.exit(fail > 0 ? 1 : 0);
