// ตรวจ toast ตอนซื้อ/ขาย — ควรเด้งแค่อันเดียว (ไม่ซ้อนกัน) + ตัวเลขทองใส่เครื่องหมาย -/+
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

let r = await api('/character/create', { method: 'POST', body: { name: `ขาย${Date.now()}`, class: 'warrior' } });
if (r.status !== 200) { console.log('❌ สร้างตัวละครไม่ได้:', r.json.error); process.exit(1); }
const cid = r.json.character.id;
await api('/character/switch', { method: 'POST', body: { id: cid } });

// หา visit ที่มีของราคาถูกและไม่มีตลาดมืด (ไม่ซื้อผ่าน API — ให้ browser ซื้อเอง)
// (ถ้ามีตลาดมืด สินค้าราคาแพง + ปุ่ม disabled — เทสต์ต้องใช้ร้านปกติราคาถูก)
let visit = null, item = null;
for (let v = 0; v < 30 && !item; v++) {
  const vv = 'clean-' + v;
  const camp = await api(`/camp?visit=${vv}`);
  if (camp.json.blackMarket) continue;
  item = (camp.json.shop || []).find((i) => i.price <= 40 && !i.free);
  if (item) visit = vv;
}
if (!item) { console.log('❌ ไม่มีของราคาถูกพอ (ร้านปกติ)'); process.exit(1); }
console.log('จะซื้อใน browser:', item.name, '| visit:', visit);

const profile = `/tmp/pq-sell-profile-${Date.now()}`;
const chromeBin = ['chromium', 'google-chrome', 'google-chrome-stable', 'chrome'].find((b) => {
  try { spawn(b, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}) || 'chromium';
const chrome = spawn(chromeBin, [
  '--headless=new', '--no-sandbox', '--disable-gpu',
  '--remote-debugging-port=9344', `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

const wsUrl = await (async () => {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9344/json');
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
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: BASE });
await sleep(2500);

// บังคับ timer → short_break (ค่ายพัก) + รีโหลด
await evalJs(`(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('pomoquest-timer-'));
  if (!key) return false;
  const t = {
    phase: 'short_break', sessionIdx: 1, remain: 60, running: true, elapsed: 0,
    nextEventIn: 90, sessionEvents: [], sessionKey: null, breakVisit: '${visit}',
    awaitingBreak: false, breakOver: false, overrun: 0, breakExtends: 0,
    breakStartedAt: Date.now(), pausedAtHome: false, pauseStartedAt: null, pauseAccumSec: 0,
    expiresAt: Date.now() + 60000,
  };
  localStorage.setItem(key, JSON.stringify(t));
  location.reload();
  return true;
})()`);
await sleep(2500);

// ---- ซื้อของในร้าน (รองรับทั้งร้านปกติและตลาดมืด) ----
const buyBtn = await evalJs(`(() => {
  // เลือกของที่จ่ายทอง (ไม่ใช่ของแถมฟรี — ข้อความของแถมไม่มีตัวเลข -X)
  const b = [...document.querySelectorAll('.shop-row .btn')].find(x => !x.disabled && (x.textContent.includes('💰') || x.textContent.includes('🖤')));
  if (b) b.click();
  return !!b;
})()`);
expect('มีปุ่มซื้อในร้าน', buyBtn === true);
await sleep(1200);
const buyToastCount = await evalJs(`document.querySelectorAll('.toast').length`);
const buyToastTexts = await evalJs(`[...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ')`);
expect('หลังซื้อมี toast แค่อันเดียว', buyToastCount === 1, `พบ ${buyToastCount} อัน: ${buyToastTexts}`);
expect('ข้อความซื้อมี -ทอง', /-\d+ ทอง/.test(buyToastTexts), buyToastTexts);
// รอ toast หาย
await sleep(3500);

// ---- ไปแท็บ กระเป๋า แล้วขาย ----
await evalJs(`(() => { const b = [...document.querySelectorAll('.tab')].find(x => x.textContent.includes('กระเป๋า')); if (b) b.click(); return !!b; })()`);
await sleep(800);
const sellBtns = await evalJs(`[...document.querySelectorAll('.inv-actions button')].filter(b => b.textContent.includes('💰')).length`);
expect('มีปุ่มขายในกระเป๋า', sellBtns > 0, `พบ ${sellBtns}`);
await evalJs(`(() => {
  window.confirm = () => true;
  const b = [...document.querySelectorAll('.inv-actions button')].find(x => x.textContent.includes('💰'));
  if (b) b.click();
  return !!b;
})()`);
await sleep(1500);
const sellToastCount = await evalJs(`document.querySelectorAll('.toast').length`);
const sellToastTexts = await evalJs(`[...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ')`);
expect('หลังขายมี toast แค่อันเดียว', sellToastCount === 1, `พบ ${sellToastCount} อัน: ${sellToastTexts}`);
expect('ข้อความขายมี +ทอง', /\+\d+ ทอง/.test(sellToastTexts), sellToastTexts);

console.log(`\nผลลัพธ์: ✅ ${pass} / ❌ ${fail}`);
chrome.kill();
process.exit(fail > 0 ? 1 : 0);
