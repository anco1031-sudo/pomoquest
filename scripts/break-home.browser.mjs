// ตรวจสอบ: กด "🏠 กลับหน้าหลัก" ที่หน้า camp ระหว่างพัก — timer ยังนับต่อ + หมดเวลามี modal ถามเริ่มโฟกัส/ต่อพักเหมือนเดิม
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
  '--remote-debugging-port=9334', '--user-data-dir=/tmp/pq-chrome-break', 'about:blank',
], { stdio: 'ignore' });

let ws = null;
for (let i = 0; i < 30 && !ws; i++) {
  await sleep(500);
  try {
    const res = await fetch('http://127.0.0.1:9334/json');
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

// สร้างตัวละครใหม่ผ่าน API (คลาส warrior) — ตัวที่ active
const name = `breakHome${Date.now()}`;
const created = await (await fetch('http://127.0.0.1:3001/api/character/create', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, class: 'warrior' }),
})).json();
const charId = created?.character?.id;
expect('สร้างตัวละคร test สำเร็จ', !!charId, `id=${charId}`);

// เขียน timer พักเบรกค้างลง localStorage (เหมือนกดพักเบรกแล้ว) แล้วโหลดหน้า
const epoch = db.prepare('SELECT epoch FROM settings WHERE id = 1').get()?.epoch || '';
await send('Page.navigate', { url: 'http://127.0.0.1:3001/' });
await sleep(2500);
const timer = {
  phase: 'short_break', sessionIdx: 1, remain: 12, running: true, elapsed: 0, nextEventIn: 9999,
  sessionEvents: [], sessionKey: null, breakVisit: `test-${Date.now()}`, awaitingBreak: false,
  breakOver: false, overrun: 0, breakExtends: 0, breakStartedAt: Date.now(), breakAtHome: false,
  pausedAtHome: false, pauseStartedAt: null, pauseAccumSec: 0, focusTask: '', epoch,
  expiresAt: Date.now() + 12000,
};
await evalJs(`localStorage.setItem('pomoquest-timer-${charId}', ${JSON.stringify(JSON.stringify(timer))})`);
await send('Page.navigate', { url: 'http://127.0.0.1:3001/' });
await sleep(2500);

// 1) อยู่หน้า camp พัก (มีปุ่มกลับหน้าหลัก)
let onCamp = await evalJs(`document.body.innerText.includes('🔥 ค่ายพัก')`);
const hasHomeBtn = await evalJs(`!![...document.querySelectorAll('button')].find(b => b.textContent.includes('กลับหน้าหลัก'))`);
expect('หน้า camp พักโชว์ + มีปุ่ม 🏠 กลับหน้าหลัก', onCamp && hasHomeBtn, '');

// 2) กดกลับหน้าหลัก → ขึ้น Home + แถบพักเบรก (timer ยังนับ)
await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('กลับหน้าหลัก'))?.click()`);
await sleep(1200);
const bar1 = await evalJs(`document.querySelector('.resume-bar')?.textContent?.replace(/\\s+/g, ' ').trim() || ''`);
const onHomeNow = await evalJs(`document.body.innerText.includes('เริ่มผจญภัย')`);
expect('กดกลับหน้าหลัก → ขึ้น Home + แถบพัก ⛺', onHomeNow && bar1.includes('กำลังพักเบรกอยู่') && bar1.includes('เหลือ'), `'${bar1}'`);

// 3) timer ยังนับต่อบน Home (เวลาลดลง)
await sleep(3000);
const bar2 = await evalJs(`document.querySelector('.resume-bar')?.textContent?.replace(/\\s+/g, ' ').trim() || ''`);
const t1 = parseInt(bar1.match(/เหลือ\s+(\d+):(\d+)/)?.[1] ?? '0', 10) * 60 + parseInt(bar1.match(/เหลือ\s+\d+:(\d+)/)?.[1] ?? '0', 10);
const t2 = parseInt(bar2.match(/เหลือ\s+(\d+):(\d+)/)?.[1] ?? '0', 10) * 60 + parseInt(bar2.match(/เหลือ\s+\d+:(\d+)/)?.[1] ?? '0', 10);
expect('บน Home: เวลาพักยังนับถอยหลัง', t2 < t1, `เหลือ ${t1}s → ${t2}s`);

// 4) รอจนหมดเวลา → modal ถามเริ่มโฟกัส/ยังพักต่อเด้งบน Home (ไม่มีปุ่มต่อเวลาพักแล้ว)
await sleep(12000);
const modalText = await evalJs(`[...document.querySelectorAll('.modal')].map(m => m.textContent.replace(/\\s+/g, ' ').trim()).join(' | ') || ''`);
const hasModal = await evalJs(`document.body.innerText.includes('หมดเวลาพักแล้ว!')`);
const hasStart = await evalJs(`!![...document.querySelectorAll('button')].find(b => b.textContent.includes('เริ่มโฟกัส'))`);
const hasKeepRest = await evalJs(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('ยังพักต่อ'))`);
const noExtend = await evalJs(`![...document.querySelectorAll('button')].some(b => b.textContent.includes('ต่อเวลาพักเพิ่ม') || /^\\+\d+ นาที$/.test(b.textContent.trim()))`);
expect('หมดเวลา → modal ถามเริ่มโฟกัส/ยังพักต่อโผล่บน Home (ไม่มีปุ่มต่อเวลา)', hasModal && hasStart && hasKeepRest && noExtend, `'${modalText.slice(0, 120)}'`);

// 5) กด "ยังพักต่อ" → modal ปิด + ยังอยู่ Home + แถบโชว์ "พักหมดเวลาแล้ว" (เวลายังนับต่อ)
await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('ยังพักต่อ'))?.click()`);
await sleep(1200);
const modalGone = await evalJs(`!document.body.innerText.includes('หมดเวลาพักแล้ว!')`);
const bar3 = await evalJs(`document.querySelector('.resume-bar')?.textContent?.replace(/\\s+/g, ' ').trim() || ''`);
expect('กดยังพักต่อ → modal ปิด + แถบโชว์พักหมดเวลาแล้ว', modalGone && bar3.includes('พักหมดเวลาแล้ว'), `'${bar3}'`);

// 6) กลับไปค่าย → หน้า camp โชว์ "เลยเวลาพัก X" และ X ยังนับเพิ่มเรื่อย ๆ (เวลาพักยังนับต่อ)
await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('กลับไปค่าย'))?.click()`);
await sleep(1200);
const backOnCamp = await evalJs(`document.body.innerText.includes('🔥 ค่ายพัก')`);
const campT1 = (await evalJs(`document.querySelector('.camp-sub')?.textContent?.replace(/\\s+/g, ' ').trim() || ''`)) || '';
await sleep(3000);
const campT2 = (await evalJs(`document.querySelector('.camp-sub')?.textContent?.replace(/\\s+/g, ' ').trim() || ''`)) || '';
const ov1 = parseInt(campT1.match(/เลยเวลาพัก\s+(\d+):(\d+)/)?.[1] ?? '0', 10) * 60 + parseInt(campT1.match(/เลยเวลาพัก\s+\d+:(\d+)/)?.[1] ?? '0', 10);
const ov2 = parseInt(campT2.match(/เลยเวลาพัก\s+(\d+):(\d+)/)?.[1] ?? '0', 10) * 60 + parseInt(campT2.match(/เลยเวลาพัก\s+\d+:(\d+)/)?.[1] ?? '0', 10);
expect('กลับไปค่าย: เลยเวลาพักยังนับเพิ่มเรื่อย ๆ', backOnCamp && campT1.includes('เลยเวลาพัก') && ov2 > ov1, `'${campT1}' → '${campT2}'`);

chrome.kill();
console.log(`\nผลลัพธ์: ${pass} ผ่าน, ${fail} ตก`);
process.exit(fail > 0 ? 1 : 0);
