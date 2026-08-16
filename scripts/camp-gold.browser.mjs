// ตรวจ: ระหว่างพักแคมป์ (short break) มีทองแสดงอยู่ด้านบน (gold-chip) — อัปเดตตามทองจริง
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

let r = await api('/character/create', { method: 'POST', body: { name: `แคมป์${Date.now()}`, class: 'warrior' } });
if (r.status !== 200) { console.log('❌ สร้างตัวละครไม่ได้:', r.json.error); process.exit(1); }
const charId = r.json.character.id;
const goldReal = r.json.character.gold;

const profile = `/tmp/pq-camp-profile-${Date.now()}`;
const chromeBin = ['chromium', 'google-chrome', 'google-chrome-stable', 'chrome'].find((b) => {
  try { spawn(b, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}) || 'chromium';
const chrome = spawn(chromeBin, [
  '--headless=new', '--no-sandbox', '--disable-gpu',
  '--remote-debugging-port=9335', `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

const wsUrl = await (async () => {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9335/json');
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

// บังคับ timer ให้เป็น short_break (ค่ายพัก) แล้วรีโหลด → ควรเห็น CampScreen
const forced = await evalJs(`(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('pomoquest-timer-'));
  if (!key) return false;
  const t = {
    phase: 'short_break', sessionIdx: 1, remain: 60, running: true, elapsed: 0,
    nextEventIn: 90, sessionEvents: [], sessionKey: null, breakVisit: 'camp-test-visit',
    awaitingBreak: false, breakOver: false, overrun: 0, breakExtends: 0,
    breakStartedAt: Date.now(), pausedAtHome: false, pauseStartedAt: null, pauseAccumSec: 0,
    expiresAt: Date.now() + 60000,
  };
  localStorage.setItem(key, JSON.stringify(t));
  location.reload();
  return true;
})()`);
expect('บังคับให้เข้าค่ายพัก (short_break) ได้', forced === true);
await sleep(2500);

const chip = await evalJs(`(() => {
  const el = document.querySelector('.camp-header .gold-chip');
  return el ? el.textContent.trim() : '';
})()`);
expect('พักแคมป์ — มีทองโชว์อยู่ด้านบน (gold-chip)', chip.includes('💰') && chip.includes(String(goldReal)), `chip="${chip}" ทองจริง=${goldReal}`);
const campTitle = await evalJs(`document.querySelector('.camp-header .timer-title')?.textContent || ''`);
expect('ยังเป็นหน้าค่ายพักปกติ', campTitle.includes('ค่ายพัก'), campTitle.trim());

chrome.kill();
console.log(`\nผลลัพธ์: ${pass} ผ่าน, ${fail} ตก`);
process.exit(fail > 0 ? 1 : 0);
