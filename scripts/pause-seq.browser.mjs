// ทดสอบพักกลาง session (เบราว์เซอร์จริง): กดหยุดพัก → พัก timer จริง ๆ (ไม่สะสม XP) → รีโหลดแล้วยังพักอยู่
// (bug เก่า: รีโหลดแล้ว session รันต่อเอง → XP/เลเวลอัพตอนที่คิดว่าพักอยู่) → กดโฟกัสต่อแล้วค่อยรันต่อ
// รัน: ต้องรัน server ที่ :3001 ก่อน (POMOQUEST_DB=ชั่วคราว) แล้วรัน node scripts/pause-seq.browser.mjs
import { spawn } from 'node:child_process';

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

// ---- ตั้งข้อมูล: สร้างตัวละคร + work 1 นาที (จบเร็ว) ----
let r = await api('/character/create', { method: 'POST', body: { name: 'พักเทสต์', class: 'warrior' } });
if (r.status !== 200) { console.log('❌ สร้างตัวละครไม่ได้:', r.json.error); process.exit(1); }
const cid = r.json.character.id;
await api('/settings', { method: 'PUT', body: { work_min: 1 } });

// ---- รัน chromium headless + CDP ----
const profile = `/tmp/pq-pause-profile-${Date.now()}`;
const chromeBin = ['chromium', 'google-chrome', 'google-chrome-stable', 'chrome'].find((b) => {
  try { spawn(b, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}) || 'chromium';
const chrome = spawn(chromeBin, [
  '--headless=new', '--no-sandbox', '--disable-gpu',
  '--remote-debugging-port=9334', `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

const wsUrl = await (async () => {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9334/json');
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

// เริ่ม session
const startClicked = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find((x) => x.textContent.includes('เริ่มผจญภัย'));
  if (!b) return false;
  b.click();
  return true;
})()`);
expect('กดเริ่มผจญภัยได้', startClicked === true);
await sleep(1200);

// บันทึก XP/เลเวลก่อนพัก
const before = (await api('/state')).json.character;
const xpBeforePause = before.xp;
const levelBeforePause = before.level;

// กดหยุดพัก → เลือก "⏸️ พักสั้น" → ควรพักทันที (label พักชั่วคราว) และเวลาพักควรนับขึ้น
const paused = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find((x) => x.textContent.includes('หยุดพัก'));
  if (!b) return false;
  b.click();
  return true;
})()`);
expect('กดหยุดพักได้ (เปิดตัวเลือก)', paused === true);
await sleep(600);
const choseShort = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find((x) => x.textContent.includes('พักสั้น'));
  if (!b) return false;
  b.click();
  return true;
})()`);
expect('เลือกพักสั้นได้', choseShort === true);
await sleep(1200);

const pausedLabel1 = await evalJs(`document.querySelector('.timer-label')?.textContent || ''`);
expect('หน้าจอแสดง "พักชั่วคราว"', pausedLabel1.includes('พักชั่วคราว'), pausedLabel1.trim());

// รอ 2.5 วิ → เวลาพักควรเพิ่มขึ้น (นาฬิกานับต่อ)
await sleep(2500);
const pausedLabel2 = await evalJs(`document.querySelector('.timer-label')?.textContent || ''`);
const parsePausedSec = (label) => {
  const m = label.match(/พักไปแล้ว (\d+):(\d+)/);
  if (!m) return -1;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
};
const s1 = parsePausedSec(pausedLabel1), s2 = parsePausedSec(pausedLabel2);
expect('เวลาพักกลาง session นับขึ้น (นับแยก)', s1 >= 0 && s2 > s1, `พัก ${s1} วิ → ${s2} วิ`);

// บังคับรีโหลด (จำลองปิดแท็บ/มือถือคืนหน้า) — session ต้องยังพักอยู่ ไม่รันต่อเอง (bug เก่า: รันต่อ → XP ขึ้น)
await evalJs(`location.reload(); true`);
await sleep(3000);

const afterReload = await evalJs(`(() => ({
  label: document.querySelector('.timer-label')?.textContent || '',
  btn: [...document.querySelectorAll('.timer-controls button')].map((b) => b.textContent.trim()),
}))()`);
expect('รีโหลดแล้วยังพักอยู่ (label พักชั่วคราว)', afterReload.label.includes('พักชั่วคราว'), afterReload.label.trim());
expect('รีโหลดแล้วปุ่มเป็น "โฟกัสต่อ" (ไม่รันต่อเอง)', afterReload.btn.some((t) => t.includes('โฟกัสต่อ')), afterReload.btn.join(' | '));

// ระหว่างที่พักไว้ — รอสักครู่ ตรวจว่า XP/เลเวลไม่ขึ้น (ไม่มีเหตุการณ์/รางวัลระหว่างพัก)
await sleep(3000);
const during = (await api('/state')).json.character;
expect('ระหว่างพัก — XP ไม่เพิ่ม', during.xp === xpBeforePause, `xp ${xpBeforePause} → ${during.xp}`);
expect('ระหว่างพัก — เลเวลไม่เพิ่ม', during.level === levelBeforePause, `lv ${levelBeforePause} → ${during.level}`);

// กดโฟกัสต่อ → กลับมารันอีกครั้ง (ปุ่มเปลี่ยนเป็นหยุดพัก)
const resumed = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find((x) => x.textContent.includes('โฟกัสต่อ'));
  if (!b) return false;
  b.click();
  return true;
})()`);
expect('กดโฟกัสต่อได้ (กลับมารัน)', resumed === true);
await sleep(1500);
const runningLabel = await evalJs(`document.querySelector('.timer-label')?.textContent || ''`);
expect('กดโฟกัสต่อแล้วรันอีกครั้ง (label กำลังโฟกัส)', runningLabel.includes('กำลังโฟกัส'), runningLabel.trim());

chrome.kill();
console.log(`\nผลลัพธ์: ${pass} ผ่าน, ${fail} ตก`);
process.exit(fail > 0 ? 1 : 0);
