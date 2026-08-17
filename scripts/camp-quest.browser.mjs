// ตรวจสอบ: ภารกิจในค่ายพักทำซ้ำไม่ได้ด้วยการสลับหน้าหลัก ↔ ค่าย (server จำว่าเคยทำแล้ว per visit + ภารกิจ deterministic ต่อค่ายพัก)
// รัน: ต้องรัน server ก่อน (เช่น PORT=3210 POMOQUEST_DB=/tmp/pq-quest-test.db node server/index.js) แล้ว:
//   POMOQUEST_DB=/tmp/pq-quest-test.db node scripts/camp-quest.browser.mjs
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';

const BASE = process.env.PQ_BASE || 'http://127.0.0.1:3001';
const db = new Database(process.env.POMOQUEST_DB || './server/data/pomoquest.db');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const expect = (label, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
  cond ? pass++ : fail++;
};

const chrome = spawn('/usr/bin/chromium', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--remote-debugging-port=9338', '--user-data-dir=/tmp/pq-chrome-quest', 'about:blank',
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
const api = async (p, opts = {}) => {
  const res = await fetch(`${BASE}/api${p}`, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};

await send('Page.enable');
await send('Runtime.enable');

// สร้างตัวละครใหม่ผ่าน API (คลาส warrior) — ตัวที่ active
const name = `campQuest${Date.now()}`;
const created = await (await fetch(`${BASE}/api/character/create`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, class: 'warrior' }),
})).json();
const charId = created?.character?.id;
expect('สร้างตัวละคร test สำเร็จ', !!charId, `id=${charId}`);

// เขียน timer พักเบรกค้างลง localStorage (เหมือนกดพักเบรกแล้ว) แล้วโหลดหน้า
const epoch = db.prepare('SELECT epoch FROM settings WHERE id = 1').get()?.epoch || '';
await send('Page.navigate', { url: `${BASE}/` });
await sleep(2500);
const visit = `test-${Date.now()}`;
const timer = {
  phase: 'short_break', sessionIdx: 1, remain: 900, running: true, elapsed: 0, nextEventIn: 9999,
  sessionEvents: [], sessionKey: null, breakVisit: visit, awaitingBreak: false,
  breakOver: false, overrun: 0, breakStartedAt: Date.now(), breakAtHome: false,
  pausedAtHome: false, pauseStartedAt: null, pauseAccumSec: 0, focusTask: '', epoch,
  expiresAt: Date.now() + 900000,
};
await evalJs(`localStorage.setItem('pomoquest-timer-${charId}', ${JSON.stringify(JSON.stringify(timer))})`);
await send('Page.navigate', { url: `${BASE}/` });
await sleep(2500);

// 1) อยู่หน้า camp พัก + เปิดแท็บภารกิจ — มี 3 การ์ด
const onCamp = await evalJs(`document.body.innerText.includes('🔥 ค่ายพัก')`);
await evalJs(`[...document.querySelectorAll('.tab')].find(b => b.textContent.includes('ภารกิจ'))?.click()`);
await sleep(600);
const titlesBefore = await evalJs(`[...document.querySelectorAll('.quest-card .quest-title')].map(e => e.textContent.trim())`);
expect('หน้า camp พักโชว์ + เปิดแท็บภารกิจเห็น 3 ภารกิจ', onCamp && titlesBefore.length === 3, JSON.stringify(titlesBefore));

// ภารกิจชุดแรกจาก API (id + สถานะทำแล้ว) — เทียบหลังกลับมาจากหน้าหลัก
const camp1 = await api(`/camp?visit=${encodeURIComponent(visit)}`);
const questIdsBefore = camp1.json.quests?.map((q) => q.id) || [];
const doneBefore = camp1.json.doneQuests || {};
expect('API /camp: ภารกิจ 3 อัน + ยังไม่มีอันไหนทำแล้ว', camp1.status === 200 && questIdsBefore.length === 3 && Object.keys(doneBefore).length === 0, JSON.stringify(questIdsBefore));

// 2) ทำภารกิจแรก → ปุ่มหาย + ขึ้นผลสำเร็จ/ไม่สำเร็จ
const firstId = questIdsBefore[0];
await evalJs(`[...document.querySelectorAll('.quest-card')][0]?.querySelector('button')?.click()`);
await sleep(1500);
const card0AfterDo = await evalJs(`(() => {
  const c = [...document.querySelectorAll('.quest-card')][0];
  if (!c) return null;
  return { btn: !!c.querySelector('button'), text: c.textContent.replace(/\\s+/g, ' ').trim() };
})()`);
expect('ทำภารกิจแรกแล้ว: ปุ่มหาย + ขึ้นผล (สำเร็จ/ไม่สำเร็จ/ทำแล้ว)', card0AfterDo && !card0AfterDo.btn && /✅|⚠️|ทำแล้ว/.test(card0AfterDo.text), card0AfterDo?.text?.slice(0, 80));

// 3) กลับหน้าหลัก แล้วกลับมาค่าย (สลับหน้าจอ — จุดที่เคยรีเซ็ตสถานะทำแล้ว)
await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('กลับหน้าหลัก'))?.click()`);
await sleep(1200);
const onHome = await evalJs(`document.body.innerText.includes('เริ่มผจญภัย')`);
expect('กดกลับหน้าหลัก → ขึ้น Home', onHome, '');
await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('กลับไปค่าย'))?.click()`);
await sleep(1500);
const backOnCamp = await evalJs(`document.body.innerText.includes('🔥 ค่ายพัก')`);
await evalJs(`[...document.querySelectorAll('.tab')].find(b => b.textContent.includes('ภารกิจ'))?.click()`);
await sleep(600);

// 4) กลับมาค่าย: ภารกิจชุดเดิม (deterministic ต่อค่ายพัก) + ภารกิจแรกยังโชว์ "ทำแล้ว" ไม่มีปุ่มทำซ้ำ
const titlesAfter = await evalJs(`[...document.querySelectorAll('.quest-card .quest-title')].map(e => e.textContent.trim())`);
const sameSet = JSON.stringify(titlesAfter) === JSON.stringify(titlesBefore);
expect('กลับมาค่าย: ภารกิจชุดเดิม (ไม่ reroll)', sameSet, `ก่อน=${JSON.stringify(titlesBefore)} หลัง=${JSON.stringify(titlesAfter)}`);
const card0AfterBack = await evalJs(`(() => {
  const c = [...document.querySelectorAll('.quest-card')][0];
  if (!c) return null;
  return { btn: !!c.querySelector('button'), text: c.textContent.replace(/\\s+/g, ' ').trim() };
})()`);
expect('กลับมาค่าย: ภารกิจแรกโชว์ "ทำแล้ว" + ไม่มีปุ่มลงมือทำภารกิจ', card0AfterBack && !card0AfterBack.btn && card0AfterBack.text.includes('ทำแล้ว'), card0AfterBack?.text?.slice(0, 80));

// 5) ระดับ API: /camp คืน doneQuests ตัวแรก + /quest/do ทำซ้ำโดนบล็อก (400)
const camp2 = await api(`/camp?visit=${encodeURIComponent(visit)}`);
const doneAfter = camp2.json.doneQuests || {};
expect('API /camp: doneQuests มีภารกิจแรกที่ทำไปแล้ว', doneAfter[firstId] === true, JSON.stringify(Object.keys(doneAfter)));
const dup = await api('/quest/do', { method: 'POST', body: { questId: firstId, visit } });
expect('API /quest/do ทำซ้ำ → ถูกบล็อก (400 ทำภารกิจนี้ไปแล้ว)', dup.status === 400 && /ทำภารกิจนี้ไปแล้ว/.test(dup.json.error || ''), `status=${dup.status} error=${dup.json.error}`);

chrome.kill();
console.log(`\nผลลัพธ์: ${pass} ผ่าน, ${fail} ตก`);
process.exit(fail > 0 ? 1 : 0);
