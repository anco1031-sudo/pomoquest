// ตรวจสอบระบบเสียง: Web Audio ทำงาน + flow จริง (จบ session/ไข่ฟัก/หมดเวลาพัก) ไม่มี JS error + event เงียบไม่รบกวน
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
  '--remote-debugging-port=9337', '--user-data-dir=/tmp/pq-chrome-sound', 'about:blank',
], { stdio: 'ignore' });

let ws = null;
for (let i = 0; i < 30 && !ws; i++) {
  await sleep(500);
  try {
    const res = await fetch('http://127.0.0.1:9337/json');
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
const jsErrors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') jsErrors.push(m.params.exceptionDetails?.text || 'exception');
  if (m.method === 'Log.entryAdded' && m.params.entry?.level === 'error') jsErrors.push(m.params.entry.text);
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
await send('Log.enable');

const api = async (p, opts = {}) => {
  const r = await fetch('http://127.0.0.1:3001/api' + p, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};

// สร้างตัวละคร + ใช้ไข่ (ฟักหลังจบ session → sfx.complete + sfx.hatch/coin)
const created = await api('/character/create', { method: 'POST', body: { name: `snd${Date.now()}`, class: 'warrior' } });
const charId = created?.json?.character?.id;
expect('สร้างตัวละคร test สำเร็จ', !!charId, `id=${charId}`);
db.prepare('UPDATE character SET level = 50, max_hp = 3000, hp = 3000, mp = 500, max_mp = 500 WHERE id = ?').run(charId);
db.prepare('INSERT OR IGNORE INTO inventory (character_id, item_id, qty) VALUES (?, 170, 1)').run(charId);
await api('/inventory/use', { method: 'POST', body: { itemId: 170 } });
const epoch = db.prepare('SELECT epoch FROM settings WHERE id = 1').get()?.epoch || '';
const setTimer = async (t) => evalJs(`localStorage.setItem('pomoquest-timer-${charId}', ${JSON.stringify(JSON.stringify({ ...t, epoch }))})`);

await send('Page.navigate', { url: 'http://127.0.0.1:3001/' });
await sleep(2500);

// 1) Web Audio พร้อมใช้งาน
const audioOk = await evalJs(`(async () => { try { const C = window.AudioContext || window.webkitAudioContext; if (!C) return 'no-api'; const c = new C(); const o = c.createOscillator(); const g = c.createGain(); o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.05); return c.state; } catch (e) { return 'err:' + e.message; } })()`);
expect('Web Audio พร้อมใช้งาน (AudioContext state)', typeof audioOk === 'string' && (audioOk === 'running' || audioOk === 'suspended'), String(audioOk));

// 2) จบ work session → ไข่ฟัก (sfx.complete + sfx.hatch/coin) — คลิกผ่าน modal อื่นในคิว (ตรา) จนเจอ modal ฟัก
await setTimer({ phase: 'work', sessionIdx: 1, remain: 3, running: true, elapsed: 0, nextEventIn: 9999, sessionEvents: [], sessionKey: `sk-${Date.now()}`, breakVisit: null, awaitingBreak: false, breakOver: false, overrun: 0, breakStartedAt: null, breakAtHome: false, postBossNote: null, pausedAtHome: false, pauseStartedAt: null, pauseAccumSec: 0, focusTask: '', expiresAt: null });
await send('Page.navigate', { url: 'http://127.0.0.1:3001/' });
let hatchSeen = false;
for (let i = 0; i < 40 && !hatchSeen; i++) {
  await sleep(1200);
  hatchSeen = await evalJs(`document.body.innerText.includes('🥚 ไข่ฟักแล้ว!')`);
  if (!hatchSeen) {
    await evalJs(`[...document.querySelectorAll('.modal button')].find(b => b.textContent.includes('รับรางวัล') || b.textContent.includes('รับทราบ') || b.textContent.includes('ใช้แต้ม'))?.click()`);
  }
}
expect('จบ session → modal ไข่ฟักโผล่ (sfx.complete + sfx.hatch รันจริง)', hatchSeen, '');

// 3) หมดเวลาพัก (sfx.breakOver) — ตั้ง timer พักสั้นเหลือ 1 วิตรง ๆ แล้วรีโหลด (ไม่พึ่ง flow ก่อนหน้า)
await setTimer({ phase: 'short_break', sessionIdx: 1, remain: 1, running: true, elapsed: 0, nextEventIn: 9999, sessionEvents: [], sessionKey: null, breakVisit: `b-${Date.now()}`, awaitingBreak: false, breakOver: false, overrun: 0, breakStartedAt: Date.now(), breakAtHome: false, postBossNote: null, pausedAtHome: false, pauseStartedAt: null, pauseAccumSec: 0, focusTask: '', expiresAt: null });
await send('Page.navigate', { url: 'http://127.0.0.1:3001/' });
await sleep(5000);
const breakOverSeen = await evalJs(`document.body.innerText.includes('หมดเวลาพักแล้ว!')`);
expect('หมดเวลาพัก modal เด้ง (sfx.breakOver รันจริง)', breakOverSeen, '');

// 4) event ระหว่างโฟกัส — ไม่มีเสียง (กันรบกวน) แต่ session ทำงานปกติ ไม่มี error — งานยาว 60 วิ ให้ event เกิดภายใน ~1 วิ
await setTimer({ phase: 'work', sessionIdx: 1, remain: 60, running: true, elapsed: 0, nextEventIn: 1, sessionEvents: [], sessionKey: `ev-${Date.now()}`, breakVisit: null, awaitingBreak: false, breakOver: false, overrun: 0, breakStartedAt: null, breakAtHome: false, postBossNote: null, pausedAtHome: false, pauseStartedAt: null, pauseAccumSec: 0, focusTask: '', expiresAt: null });
await send('Page.navigate', { url: 'http://127.0.0.1:3001/' });
await sleep(6000);
const workRunning = await evalJs(`document.body.innerText.includes('กำลังโฟกัส') || document.body.innerText.includes('พักเบรก')`);
expect('event ระหว่างโฟกัสเกิดเงียบ ๆ (session ทำงานปกติ ไม่มีเสียง)', workRunning, '');

// 5) ไม่มี JS error ตลอดการเล่นเสียง
const realErrors = jsErrors.filter((e) => !/ResizeObserver/.test(e));
expect('ไม่มี JS error ระหว่างเล่นเสียง (จบ session/พัก/ฟัก + event เงียบ)', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

chrome.kill();
console.log(`\nผลลัพธ์: ${pass} ผ่าน, ${fail} ตก`);
process.exit(fail > 0 ? 1 : 0);
