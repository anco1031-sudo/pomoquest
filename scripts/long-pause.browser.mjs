// ทดสอบพักยาว 😴 (เบราว์เซอร์จริง): เลือกจาก ⏸️ หรือ 🏠 ได้ · ตั้งชื่อ/เหตุผล (prompt) · พักยาวแยกหมวดสถิติ
// "พักยาว" (long_pause_sec — ไม่ปนกับพักกลาง session/pause_sec) · กลับมาแล้ว modal ถามโฟกัสต่อ/ทิ้ง ·
// โหมดมาราธอน: พักยาวแล้วจบ session → ยังเสีย session เหมือนเดิม (streak 0 + log abort)
// รัน: ต้องรัน server ที่ :3001 ก่อน (POMOQUEST_DB=ชั่วคราว) แล้วรัน node scripts/long-pause.browser.mjs
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';

const db = new Database(process.env.POMOQUEST_DB || './server/data/pomoquest.db');
const BASE = 'http://127.0.0.1:3001';
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

// ---- ตั้งข้อมูล: สร้างตัวละคร test ----
let r = await api('/character/create', { method: 'POST', body: { name: 'พักยาวเทสต์', class: 'warrior' } });
if (r.status !== 200) { console.log('❌ สร้างตัวละครไม่ได้:', r.json.error); process.exit(1); }
const cid = r.json.character.id;
const epoch = db.prepare('SELECT epoch FROM settings WHERE id = 1').get()?.epoch || '';

// ---- รัน chromium headless + CDP ----
const chrome = spawn('/usr/bin/chromium', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--remote-debugging-port=9334', '--user-data-dir=/tmp/pq-chrome-long', 'about:blank',
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
      await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; setTimeout(resolve, 3000); });
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
  const rr = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return rr?.result?.value;
};


await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: BASE });
await sleep(2500);

// ---- 1) เริ่ม session → ⏸️ หยุดพัก → เลือก 😴 พักยาว (ไม่มีชื่อ) ----
const startClicked = await evalJs(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('เริ่มผจญภัย'));
  if (!b) return false;
  b.click();
  return true;
})()`);
expect('กดเริ่มผจญภัยได้', startClicked === true);
await sleep(1200);

await evalJs(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('หยุดพัก'));
  if (!b) return false;
  b.click();
  return true;
})()`);
await sleep(600);
await evalJs(`(() => {
  const b = [...document.querySelectorAll('.modal button')].find((x) => x.textContent.includes('พักยาว'));
  if (!b) return false;
  b.click();
  return true;
})()`); // ไม่ตั้งชื่อ — ปล่อยว่าง
await sleep(1000);
let label = await evalJs(`document.querySelector('.timer-label')?.textContent || ''`);
expect('⏸️ แล้วเลือกพักยาว → label "😴 พักยาว"', label.includes('พักยาว'), label.trim());
await sleep(2500);
label = await evalJs(`document.querySelector('.timer-label')?.textContent || ''`);
expect('พักยาวค้างอยู่ (label ไม่เปลี่ยน)', label.includes('พักยาว'), label.trim());

// ---- 2) กดโฟกัสต่อ → modal กลับมาจากพักยาว → เลือกโฟกัสต่อ (กลับมารัน) ----
await evalJs(`(() => {
  const b = [...document.querySelectorAll('.timer-controls button')].find((x) => x.textContent.includes('โฟกัสต่อ'));
  if (!b) return false;
  b.click();
  return true;
})()`);
await sleep(600);
let returnModal = await evalJs(`document.querySelector('.modal')?.innerText || ''`);
expect('กดโฟกัสต่อ → modal "กลับมาจากพักยาว" ขึ้น', returnModal.includes('กลับมาจากพักยาว'), returnModal.replace(/\n/g, ' ').slice(0, 110));
await evalJs(`(() => {
  const b = [...document.querySelectorAll('.modal button')].find((x) => x.textContent.includes('โฟกัสต่อ'));
  if (!b) return false;
  b.click();
  return true;
})()`);
await sleep(500);
label = await evalJs(`document.querySelector('.timer-label')?.textContent || ''`);
expect('เลือกโฟกัสต่อใน modal → กลับมารัน', label.includes('กำลังโฟกัส'), label.trim());

// ---- 3) พักยาวค้างอยู่ → กด 🏠 กลับหน้าหลัก → ไปตรง ๆ ไม่ถามพักแบบไหนซ้ำ ----
await evalJs(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('หยุดพัก'));
  if (!b) return false;
  b.click();
  return true;
})()`);
await sleep(600);
await evalJs(`(() => {
  const b = [...document.querySelectorAll('.modal button')].find((x) => x.textContent.includes('พักยาว'));
  if (!b) return false;
  b.click();
  return true;
})()`); // พักยาว (ไม่มีชื่อ)
await sleep(800);
await evalJs(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('กลับหน้าหลัก'));
  if (!b) return false;
  b.click();
  return true;
})()`);
await sleep(800);
const homeDirect = await evalJs(`(() => ({
  modal: document.querySelector('.modal')?.innerText || '',
  bar: document.querySelector('.resume-bar')?.innerText || '',
}))()`);
expect('พักยาวค้างอยู่ + กดกลับหน้าหลัก → ไปตรง ๆ (ไม่มี modal พักแบบไหน)', !homeDirect.modal.includes('พักแบบไหน'), homeDirect.modal.replace(/\n/g, ' ').slice(0, 60) || '(ไม่มี modal)');
expect('พักยาวค้างอยู่ + กลับหน้าหลัก → แถบ Home โชว์ 😴 พักยาว', homeDirect.bar.includes('พักยาว'), homeDirect.bar.replace(/\n/g, ' ').slice(0, 120));
// กลับมาที่หน้าโฟกัส (โฟกัสต่อจากแถบ) — เตรียมเทสต์ข้อ 4 ต่อ
await evalJs(`(() => {
  const b = [...document.querySelectorAll('.resume-bar button')].find((x) => x.textContent.includes('โฟกัสต่อ'));
  if (!b) return false;
  b.click();
  return true;
})()`);
await sleep(600);
returnModal = await evalJs(`document.querySelector('.modal')?.innerText || ''`);
expect('จากแถบกลับมา → modal "กลับมาจากพักยาว"', returnModal.includes('กลับมาจากพักยาว'), returnModal.replace(/\n/g, ' ').slice(0, 100));
await evalJs(`(() => {
  const b = [...document.querySelectorAll('.modal button')].find((x) => x.textContent.includes('โฟกัสต่อ'));
  if (!b) return false;
  b.click();
  return true;
})()`);
await sleep(500);

// ---- 3.5) ทางลัด "😴 พักยาว" ที่แถบ Home: พักสั้น → กลับหน้าหลัก → กด 😴 พักยาว ตรง ๆ (ไม่ผ่าน modal) ----
await evalJs(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('หยุดพัก'));
  if (!b) return false;
  b.click();
  return true;
})()`);
await sleep(600);
await evalJs(`(() => {
  const b = [...document.querySelectorAll('.modal button')].find((x) => x.textContent.includes('พักสั้น'));
  if (!b) return false;
  b.click();
  return true;
})()`); // เลือกพักสั้น
await sleep(600);
await evalJs(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('กลับหน้าหลัก'));
  if (!b) return false;
  b.click();
  return true;
})()`); // พักอยู่แล้ว → ไปหน้า Home ตรง ๆ
await sleep(800);
let barState = await evalJs(`(() => ({
  icon: document.querySelector('.resume-bar .resume-icon')?.textContent || '',
  hasShortcut: [...document.querySelectorAll('.resume-bar button')].some((x) => x.textContent.includes('พักยาว')),
}))()`);
expect('พักสั้นค้างอยู่ + กลับหน้าหลัก → แถบ Home ยังเป็นพักสั้น (⏸️) + มีปุ่มทางลัด "😴 พักยาว"', barState.icon === '⏸️' && barState.hasShortcut === true, JSON.stringify(barState));
await evalJs(`(() => {
  const b = [...document.querySelectorAll('.resume-bar button')].find((x) => x.textContent.includes('พักยาว'));
  if (!b) return false;
  b.click();
  return true;
})()`); // กดทางลัด 😴 พักยาว ตรง ๆ (ไม่ผ่าน modal)
await sleep(600);
barState = await evalJs(`(() => ({
  icon: document.querySelector('.resume-bar .resume-icon')?.textContent || '',
  hasShortcut: [...document.querySelectorAll('.resume-bar button')].some((x) => x.textContent.includes('พักยาว')),
  bar: document.querySelector('.resume-bar')?.innerText || '',
}))()`);
expect('กด 😴 พักยาว ที่แถบ Home → เปลี่ยนเป็นพักยาวทันที (😴) + ปุ่มทางลัดหาย', barState.icon === '😴' && barState.hasShortcut === false && barState.bar.includes('พักยาว'), barState.bar.replace(/\n/g, ' ').slice(0, 130));
await evalJs(`(() => {
  const b = [...document.querySelectorAll('.resume-bar button')].find((x) => x.textContent.includes('โฟกัสต่อ'));
  if (!b) return false;
  b.click();
  return true;
})()`);
await sleep(600);
returnModal = await evalJs(`document.querySelector('.modal')?.innerText || ''`);
expect('จากแถบโฟกัสต่อหลังเปลี่ยนเป็นพักยาว → modal "กลับมาจากพักยาว"', returnModal.includes('กลับมาจากพักยาว'), returnModal.replace(/\n/g, ' ').slice(0, 100));
await evalJs(`(() => {
  const b = [...document.querySelectorAll('.modal button')].find((x) => x.textContent.includes('โฟกัสต่อ'));
  if (!b) return false;
  b.click();
  return true;
})()`);
await sleep(500);

// ---- 4) กด 🏠 กลับหน้าหลัก (ตอนกำลังโฟกัส) → เปิดตัวเลือกพัก (ถามพักสั้น/พักยาว) → เลือกพักยาว + ตั้งชื่อ "ไปกินข้าว" → ไปพักที่หน้า Home ----
await evalJs(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('กลับหน้าหลัก'));
  if (!b) return false;
  b.click();
  return true;
})()`);
await sleep(600);
const homeChooser = await evalJs(`document.querySelector('.modal')?.innerText || ''`);
expect('🏠 กลับหน้าหลัก (กำลังโฟกัส) → เปิดตัวเลือกพัก (ถามพักสั้น/พักยาว)', homeChooser.includes('พักแบบไหน'), homeChooser.replace(/\n/g, ' ').slice(0, 80));
// เลือกชื่อพักยาวจากตัวเลือกสำเร็จรูป (chip "🍚 กินข้าว") แล้วกดพักยาว
const chipClicked = await evalJs(`(() => {
  const b = [...document.querySelectorAll('.pause-preset-chip')].find((x) => x.textContent.includes('กินข้าว'));
  if (!b) return false;
  b.click();
  return true;
})()`);
expect('เลือกชื่อพักยาวจากตัวเลือกสำเร็จรูป (🍚 กินข้าว)', chipClicked === true);
await sleep(300);
await evalJs(`(() => {
  const b = [...document.querySelectorAll('.modal button')].find((x) => x.textContent.includes('พักยาว'));
  if (!b) return false;
  b.click();
  return true;
})()`);
await sleep(1000);
const homeBar = await evalJs(`document.querySelector('.resume-bar')?.innerText || ''`);
expect('พักยาวจาก 🏠 → แถบ Home โชว์ "😴 พักยาว · 🍚 กินข้าว"', homeBar.includes('พักยาว') && homeBar.includes('กินข้าว'), homeBar.replace(/\n/g, ' ').slice(0, 130));

// ---- 5) กดโฟกัสต่อ (แถบ) → modal โชว์ชื่อพัก → ทิ้ง session (ไม่ถามซ้ำ) → Home ว่าง ----
await evalJs(`(() => {
  const b = [...document.querySelectorAll('.resume-bar button')].find((x) => x.textContent.includes('โฟกัสต่อ'));
  if (!b) return false;
  b.click();
  return true;
})()`);
await sleep(800);
returnModal = await evalJs(`document.querySelector('.modal')?.innerText || ''`);
expect('modal กลับมาจากพักยาวโชว์ชื่อ "🍚 กินข้าว"', returnModal.includes('กลับมาจากพักยาว') && returnModal.includes('กินข้าว'), returnModal.replace(/\n/g, ' ').slice(0, 130));
await evalJs(`(() => {
  const b = [...document.querySelectorAll('.modal button')].find((x) => x.textContent.includes('ทิ้ง session'));
  if (!b) return false;
  b.click();
  return true;
})()`);
await sleep(800);
// ทิ้ง session → เดิมทิ้งเลย ตอนนี้เปิด modal ถามเหตุผลก่อน (เลือกเหตุผล + ยืนยัน)
const reasonModal = await evalJs(`document.querySelector('.modal')?.innerText || ''`);
expect('ทิ้ง session → modal ถามเหตุผลขึ้น', reasonModal.includes('เหตุผล') && reasonModal.includes('ทิ้งเซสชัน'), reasonModal.replace(/\n/g, ' ').slice(0, 100));
await evalJs(`(() => {
  const b = [...document.querySelectorAll('.pause-preset-chip')].find((x) => x.textContent.includes('ธุระด่วน'));
  if (!b) return false;
  b.click();
  return true;
})()`);
await sleep(300);
await evalJs(`(() => {
  const b = [...document.querySelectorAll('.modal button')].find((x) => x.textContent.includes('ทิ้ง session'));
  if (!b) return false;
  b.click();
  return true;
})()`);
await sleep(1000);
const afterDiscard = await evalJs(`!document.querySelector('.resume-bar') && !document.querySelector('.modal')`);
expect('ทิ้ง session ใน modal → กลับ Home ว่าง', afterDiscard === true);

// ---- 6) seed session พักยาวค้าง (ชื่อ "นอนกลางวัน") → รีโหลด → โฟกัสต่อ → จบ session → สถิติแยกหมวด ----
await send('Page.navigate', { url: BASE });
await sleep(1500);
const timer = {
  phase: 'work', sessionIdx: 1, remain: 5, running: false, elapsed: 0, nextEventIn: 9999,
  sessionEvents: [], sessionKey: `lp-${Date.now()}`, breakVisit: null, awaitingBreak: false,
  breakOver: false, overrun: 0, breakStartedAt: null, breakAtHome: false, postBossNote: null,
  pausedAtHome: false, pauseStartedAt: Date.now(), pauseAccumSec: 0, pauseMode: 'long',
  pauseTitle: 'นอนกลางวัน', longPauseAccumSec: 0, longPauseTitles: [], focusTask: '',
  epoch, expiresAt: Date.now() + 5000,
};
await evalJs(`localStorage.setItem('pomoquest-timer-${cid}', ${JSON.stringify(JSON.stringify(timer))}); true`);
await send('Page.reload');
await sleep(2500);

label = await evalJs(`document.querySelector('.timer-label')?.textContent || ''`);
expect('รีโหลด: พักยาวค้างอยู่ + โชว์ชื่อ "นอนกลางวัน"', label.includes('พักยาว') && label.includes('นอนกลางวัน'), label.trim());

await evalJs(`(() => {
  const b = [...document.querySelectorAll('.timer-controls button')].find((x) => x.textContent.includes('โฟกัสต่อ'));
  if (!b) return false;
  b.click();
  return true;
})()`);
await sleep(600);
returnModal = await evalJs(`document.querySelector('.modal')?.innerText || ''`);
expect('รีโหลดแล้วกดโฟกัสต่อ → modal กลับมาจากพักยาว (โชว์ชื่อ)', returnModal.includes('กลับมาจากพักยาว') && returnModal.includes('นอนกลางวัน'), returnModal.replace(/\n/g, ' ').slice(0, 120));
await evalJs(`(() => {
  const b = [...document.querySelectorAll('.modal button')].find((x) => x.textContent.includes('โฟกัสต่อ'));
  if (!b) return false;
  b.click();
  return true;
})()`);
await sleep(500);

// รอ session จบ (remain ~5 วิ) → ตรวจสถิติ: long_pause_sec > 0, pause_sec = 0
let row = null;
for (let i = 0; i < 12; i++) {
  await sleep(1500);
  const done = db.prepare("SELECT COUNT(*) n FROM log WHERE character_id = ? AND type = 'session_done'").get(cid);
  if (done.n >= 1) break;
}
row = db.prepare('SELECT pause_sec, long_pause_sec FROM progress WHERE character_id = ?').get(cid);
expect('จบ session → long_pause_sec > 0 (พักยาวนับแยกหมวด)', (row?.long_pause_sec || 0) > 0, `long_pause_sec=${row?.long_pause_sec}`);
expect('จบ session → pause_sec = 0 (พักสั้นไม่ปน)', (row?.pause_sec || 0) === 0, `pause_sec=${row?.pause_sec}`);
const lpLog = db.prepare("SELECT long_pause_sec, detail FROM log WHERE character_id = ? AND type = 'session_done' ORDER BY id DESC LIMIT 1").get(cid);
expect('log session_done: long_pause_sec > 0 + detail มีชื่อ "นอนกลางวัน"', (lpLog?.long_pause_sec || 0) > 0 && (lpLog?.detail || '').includes('นอนกลางวัน'), JSON.stringify(lpLog));

// ---- 7) โหมดมาราธอน: พักยาวแล้วจบ session → ยังเสีย session (streak 0 + log abort + ไม่นับ long_pause_sec) ----
r = await api('/character/create', { method: 'POST', body: { name: 'มาราธอนยาว', class: 'cleric', challengeMode: 'marathon' } });
expect('สร้างตัวละครโหมดมาราธอนได้', r.status === 200, r.json.error || '');
const mcId = r.json.character?.id;
await send('Page.navigate', { url: BASE });
await sleep(1500);
const mtimer = {
  phase: 'work', sessionIdx: 1, remain: 5, running: false, elapsed: 0, nextEventIn: 9999,
  sessionEvents: [], sessionKey: `mlp-${Date.now()}`, breakVisit: null, awaitingBreak: false,
  breakOver: false, overrun: 0, breakStartedAt: null, breakAtHome: false, postBossNote: null,
  pausedAtHome: false, pauseStartedAt: Date.now(), pauseAccumSec: 0, pauseMode: 'long',
  pauseTitle: 'พักยาวมาราธอน', longPauseAccumSec: 0, longPauseTitles: [], focusTask: '',
  epoch, expiresAt: Date.now() + 5000,
};
await evalJs(`localStorage.setItem('pomoquest-timer-${mcId}', ${JSON.stringify(JSON.stringify(mtimer))}); true`);
await send('Page.reload');
await sleep(2500);
label = await evalJs(`document.querySelector('.timer-label')?.textContent || ''`);
expect('มาราธอน: รีโหลดแล้วพักยาวค้างอยู่', label.includes('พักยาว'), label.trim());
await evalJs(`(() => {
  const b = [...document.querySelectorAll('.timer-controls button')].find((x) => x.textContent.includes('โฟกัสต่อ'));
  if (!b) return false;
  b.click();
  return true;
})()`);
await sleep(600);
await evalJs(`(() => {
  const b = [...document.querySelectorAll('.modal button')].find((x) => x.textContent.includes('โฟกัสต่อ'));
  if (!b) return false;
  b.click();
  return true;
})()`);
await sleep(500);
for (let i = 0; i < 12; i++) {
  await sleep(1500);
  const abortN = db.prepare("SELECT COUNT(*) n FROM log WHERE character_id = ? AND type = 'abort'").get(mcId)?.n || 0;
  if (abortN >= 1) break;
}
const mRow = db.prepare('SELECT streak, pause_sec, long_pause_sec FROM progress WHERE character_id = ?').get(mcId);
const mAbort = db.prepare("SELECT COUNT(*) n FROM log WHERE character_id = ? AND type = 'abort'").get(mcId)?.n || 0;
expect('มาราธอน: พักยาวแล้วจบ session → เสีย session (streak = 0)', (mRow?.streak || 0) === 0, `streak=${mRow?.streak}`);
expect('มาราธอน: มี log เสีย session (abort)', mAbort >= 1, `abort=${mAbort}`);
expect('มาราธอน: เสีย session → ไม่นับ long_pause_sec/pause_sec', (mRow?.long_pause_sec || 0) === 0 && (mRow?.pause_sec || 0) === 0, JSON.stringify(mRow));

chrome.kill();
console.log(`\nผลลัพธ์: ${pass} ผ่าน, ${fail} ตก`);
process.exit(fail > 0 ? 1 : 0);
