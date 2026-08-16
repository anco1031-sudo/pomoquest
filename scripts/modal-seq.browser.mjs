// ทดสอบ modal แบบคิวหลังจบ session (เบราว์เซอร์จริง) — เรื่อง LLM ก่อน → เลเวลอัพ → ถามพักเบรก
// รัน: node scripts/modal-seq.browser.mjs (ต้องรัน server ไว้ก่อนที่ :3001)
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';

const BASE = 'http://127.0.0.1:3001';
const DB_PATH = process.env.POMOQUEST_DB || '/tmp/pomoquest.db';
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

// ---- ตั้งข้อมูล: สร้างตัวละคร + work 1 นาที (จบเร็ว) ----
let r = await api('/character/create', { method: 'POST', body: { name: 'โมดาลเทสต์', class: 'warrior' } });
if (r.status !== 200) { console.log('❌ สร้างตัวละครไม่ได้:', r.json.error); process.exit(1); }
const charId = r.json.character.id;
await api('/settings', { method: 'PUT', body: { work_min: 1 } });

// ---- รัน chromium headless + CDP ----
const profile = `/tmp/pq-modal-profile-${Date.now()}`;
const chrome = spawn('chromium', [
  '--headless=new', '--no-sandbox', '--disable-gpu',
  `--remote-debugging-port=9333`, `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

const wsUrl = await (async () => {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9333/json');
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

// เปิดหน้าแล้ว — เริ่ม session
const startClicked = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find((x) => x.textContent.includes('เริ่มผจญภัย'));
  if (!b) return false;
  b.click();
  return true;
})()`);
expect('กดเริ่มผจญภัยได้', startClicked === true);
await sleep(1500);

// บังคับ timer หมดเวลา (localStorage expiresAt ในอดีต) แล้วรีโหลด → จะเด้ง modal "เวลาโฟกัสหมดแล้ว"
const forced = await evalJs(`(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('pomoquest-timer-'));
  if (!key) return false;
  const t = JSON.parse(localStorage.getItem(key));
  t.remain = 0;
  t.expiresAt = Date.now() - 1000;
  localStorage.setItem(key, JSON.stringify(t));
  location.reload();
  return true;
})()`);
expect('บังคับ timer หมดเวลาได้', forced === true);
await sleep(2500);

// กด "จบเซสชัน รับรางวัล" → completeWork ทำงาน → เริ่ม poll เรื่องราว
const endClicked = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find((x) => x.textContent.includes('จบเซสชัน รับรางวัล'));
  if (!b) return false;
  b.click();
  return true;
})()`);
expect('กดจบเซสชันได้ (รับรางวัล)', endClicked === true);
await sleep(2000); // รอ POST /adventure/complete เสร็จ (taleAfter)

// แทรก llm_tale ตรง ๆ (จำลอง LLM เขียนเรื่องเสร็จ) — poll ควรเจอภายใน ~1 วิ
const db = new Database(DB_PATH);
const cid = db.prepare("SELECT id FROM character WHERE name = 'โมดาลเทสต์'").get().id;
db.prepare("INSERT INTO log (character_id, type, title, detail, session_key, created_at) VALUES (?, 'llm_tale', '📖 เรื่องราวการผจญภัย', 'เรื่องทดสอบคิว modal — ฮีโร่ฝ่าดงหมาป่าแล้วพบเมืองใหม่ พร้อมลุยต่อ!', 'x', datetime('now','localtime'))").run(cid);
db.close();

// รอ story modal ขึ้น
let storyShown = false;
for (let i = 0; i < 20; i++) {
  await sleep(800);
  const hasStory = await evalJs(`!!document.querySelector('.story-modal')`);
  if (hasStory) { storyShown = true; break; }
}
expect('เรื่องราว LLM เด้งเป็น modal', storyShown === true);

// ตรวจ: ต้องมี modal-backdrop แค่ 1 อัน (ไม่มี modal อื่นมาทับเรื่อง)
const nModalDuringStory = await evalJs(`document.querySelectorAll('.modal-backdrop').length`);
expect('ระหว่างโชว์เรื่องราว — มี modal ทีละ 1 อันเท่านั้น (ไม่ทับกัน)', nModalDuringStory === 1, `มี ${nModalDuringStory} อัน`);
const storyText = await evalJs(`document.querySelector('.story-modal .story-text')?.textContent || ''`);
expect('เรื่องราว LLM อ่านได้ ไม่ถูกบัง', storyText.includes('เรื่องทดสอบคิว modal'), storyText.slice(0, 40));

// ปิดเรื่อง → ควรเจอ modal ถัดไป (เลเวลอัพ หลัง session ได้ XP) — ทีละ 1 อัน
await evalJs(`(() => { const b = [...document.querySelectorAll('.story-modal button')].find((x) => x.textContent.includes('รับทราบ')); if (b) b.click(); return true; })()`);
await sleep(1200);

let sawLevelUp = false, sawBreak = false;
for (let i = 0; i < 30; i++) {
  const state = await evalJs(`(() => {
    const backdrops = document.querySelectorAll('.modal-backdrop');
    return {
      n: backdrops.length,
      levelup: !!document.querySelector('.levelup-modal'),
      story: !!document.querySelector('.story-modal'),
      break: [...document.querySelectorAll('.modal h2')].some((h) => h.textContent.includes('จบเซสชัน')),
    };
  })()`);
  expect(`หลังปิดเรื่อง — modal ทีละ 1 อัน (รอบ ${i})`, state.n <= 1, JSON.stringify(state));
  if (state.levelup) { sawLevelUp = true; break; }
  if (state.break) { sawBreak = true; break; }
  await sleep(800);
}
expect('หลังเรื่อง → เด้ง modal เลเวลอัพ (หรือถามพักเบรก) ทีละอัน', sawLevelUp || sawBreak, '');

// ปิด modal ที่ค้างทีละอัน (เลเวลอัพ → จัดสรรแต้ม, ตรา → รับรางวัล) จนกว่าจะถึง modal ถามพักเบรก
// ตรวจทุกรอบว่า modal ทีละ 1 อันเท่านั้น ไม่ทับกัน
let finalBreak = false;
for (let i = 0; i < 15; i++) {
  const state = await evalJs(`(() => ({
    n: document.querySelectorAll('.modal-backdrop').length,
    levelup: !!document.querySelector('.levelup-modal'),
    achieve: !!document.querySelector('.achieve-modal'),
    story: !!document.querySelector('.story-modal'),
    break: [...document.querySelectorAll('.modal h2')].some((h) => h.textContent.includes('จบเซสชัน')),
  }))()`);
  expect(`คิว modal รอบ ${i} — ทีละ 1 อัน`, state.n <= 1, JSON.stringify(state));
  if (state.break) { finalBreak = true; break; }
  if (state.levelup) {
    await evalJs(`(() => {
      const b = [...document.querySelectorAll('.alloc-box button')].find((x) => x.textContent.includes('จัดอัตโนมัติ'));
      if (b) b.click();
      return true;
    })()`);
    await sleep(300);
    await evalJs(`(() => {
      const b = [...document.querySelectorAll('.alloc-box button')].find((x) => x.textContent.includes('ยืนยันการจัดสรร'));
      if (b) b.click();
      return true;
    })()`);
    await sleep(1200);
  } else if (state.achieve) {
    await evalJs(`(() => {
      const b = [...document.querySelectorAll('.achieve-modal button')].find((x) => x.textContent.includes('รับรางวัล'));
      if (b) b.click();
      return true;
    })()`);
    await sleep(1200);
  } else {
    break;
  }
}
expect('สุดท้าย — modal ถามพักเบรกโชว์ทีละ 1 อัน (หลังปิดทุก modal ก่อนหน้า)', finalBreak === true);

chrome.kill();
console.log(`\nผลลัพธ์: ${pass} ผ่าน, ${fail} ตก`);
process.exit(fail > 0 ? 1 : 0);
