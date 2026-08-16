// ตรวจแถบ "โฟกัสต่อ" ด้านบนหน้า Home เมื่อมี session พักไว้ (กดกลับหน้าหลักกลาง session)
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

let r = await api('/character/create', { method: 'POST', body: { name: `เรซูม${Date.now()}`, class: 'warrior' } });
if (r.status !== 200) { console.log('❌ สร้างตัวละครไม่ได้:', r.json.error); process.exit(1); }
await api('/settings', { method: 'PUT', body: { work_min: 1 } });

const profile = `/tmp/pq-resume-profile-${Date.now()}`;
const chromeBin = ['chromium', 'google-chrome', 'google-chrome-stable', 'chrome'].find((b) => {
  try { spawn(b, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}) || 'chromium';
const chrome = spawn(chromeBin, [
  '--headless=new', '--no-sandbox', '--disable-gpu',
  '--remote-debugging-port=9336', `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

const wsUrl = await (async () => {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9336/json');
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
// viewport แคบ (มือถือ) — หน้า Home จะยาวพอให้เลื่อนพ้น hero card ได้จริง
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 350, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: BASE });
await sleep(2500);

// หน้าแรกปกติ — ไม่ควรมีแถบ resume
const barBefore = await evalJs(`!!document.querySelector('.resume-bar')`);
expect('หน้าแรกปกติ — ไม่มีแถบโฟกัสต่อ', barBefore === false);

// ตั้งชื่องาน (กรอกในช่อง focus task) → เริ่ม session → กลับหน้าหลัก
const taskSet = await evalJs(`(() => {
  const input = document.querySelector('.focus-task-input input');
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'งานเทสต์');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
expect('กรอกชื่องานได้', taskSet === true);
await sleep(300);
await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('เริ่มผจญภัย')); if(b)b.click(); return !!b; })()`);
await sleep(1200);
const homeClicked = await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('กลับหน้าหลัก')); if(b)b.click(); return !!b; })()`);
expect('กดกลับหน้าหลัก (พักไว้) ได้', homeClicked === true);
await sleep(1500);

// แถบ resume อยู่ใน sticky-top (ก่อน hero-card) + มีปุ่มโฟกัสต่อ + โชว์เวลาเหลือ
const bar = await evalJs(`(() => {
  const bar = document.querySelector('.resume-bar');
  if (!bar) return null;
  const stickyTop = document.querySelector('.sticky-top');
  const hero = document.querySelector('.hero-card');
  return {
    inSticky: !!stickyTop && stickyTop.contains(bar),
    beforeHero: hero ? (hero.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_PRECEDING) > 0 : false,
    text: bar.textContent.replace(/\\s+/g, ' ').trim(),
    btn: [...bar.querySelectorAll('button')].map((b) => b.textContent.trim()),
  };
})()`);
expect('มีแถบโฟกัสต่ออยู่ใน sticky-top (ก่อน hero card)', !!bar && bar.inSticky && bar.beforeHero, JSON.stringify(bar));
expect('แถบโชว์เวลาที่เหลือ + มีปุ่มโฟกัสต่อ', !!bar && bar.text.includes('เหลือ') && bar.btn.some((t) => t.includes('โฟกัสต่อ')), bar?.text || '');
expect('แถบโชว์ชื่องานที่พักไว้', !!bar && bar.text.includes('งานเทสต์'), bar?.text || '');
expect('แถบมีปุ่มทิ้ง session ด้วย', !!bar && bar.btn.some((t) => t.includes('ทิ้ง session')), JSON.stringify(bar?.btn));
const inPanel = await evalJs(`[...document.querySelectorAll('.panel button')].some((b) => b.textContent.includes('ต่อ session ต่อ'))`);
expect('ปุ่มเก่าใน panel ถูกลบ (ไม่ซ้ำซ้อน)', inPanel === false);

// เลื่อนหน้าลง — topbar + แถบติดคู่กันบนสุด (sticky) และแถบย่อเหลือแค่ปุ่มเมื่อผ่าน hero card
// (รอจังหวะหลัง scroll — scroll event + React re-render เป็น async)
await evalJs(`window.scrollTo(0, document.documentElement.scrollHeight); true`); // เลื่อนถึงล่างสุด — hero card พ้นจอแน่นอน
await sleep(700);
const sticky = await evalJs(`(() => {
  const tall = document.documentElement.scrollHeight > window.innerHeight + 100;
  const bar = document.querySelector('.resume-bar');
  const topbarTop = document.querySelector('.topbar')?.getBoundingClientRect().top;
  const barTop = bar?.getBoundingClientRect().top;
  const info = document.querySelector('.resume-bar .resume-info');
  return {
    tall, topbarTop, barTop,
    collapsed: bar?.classList.contains('collapsed') || false,
    infoHidden: info ? getComputedStyle(info).display === 'none' : false,
  };
})()`);
expect('หน้าเลื่อนได้ (มีเนื้อหาเพียงพอ)', sticky.tall === true);
expect('เลื่อนแล้ว topbar ติดบนสุด (sticky top=0)', typeof sticky.topbarTop === 'number' && sticky.topbarTop >= 0 && sticky.topbarTop < 2, JSON.stringify(sticky));
expect('เลื่อนแล้วแถบติดตาม topbar (อยู่บนสุด)', typeof sticky.barTop === 'number' && sticky.barTop >= 0 && sticky.barTop < 80, JSON.stringify(sticky));
expect('เลื่อนผ่าน hero → แถบย่อ (collapsed) + ซ่อนข้อความ', sticky.collapsed === true && sticky.infoHidden === true, JSON.stringify(sticky));
await evalJs(`window.scrollTo(0, 0); true`);

// กดทิ้ง session (ยอมรับ confirm) → แถบหาย + กลับเป็นหน้าเริ่มผจญภัยปกติ
await evalJs(`window.confirm = () => true; true`);
const discarded = await evalJs(`(() => { const b=[...document.querySelectorAll('.resume-bar button')].find(x=>x.textContent.includes('ทิ้ง session')); if(b)b.click(); return !!b; })()`);
expect('กดทิ้ง session ได้ (จากแถบ)', discarded === true);
await sleep(1500);
const barAfter = await evalJs(`!!document.querySelector('.resume-bar')`);
const startBtn = await evalJs(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('เริ่มผจญภัย'))`);
expect('ทิ้งแล้วแถบหาย + กลับหน้าเริ่มปกติ', barAfter === false && startBtn === true);

// เริ่ม session ใหม่ → กลับหน้าหลัก → กดโฟกัสต่อ → กลับไปหน้าจอโฟกัส (กำลังโฟกัส)
await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('เริ่มผจญภัย')); if(b)b.click(); return !!b; })()`);
await sleep(1200);
await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('กลับหน้าหลัก')); if(b)b.click(); return !!b; })()`);
await sleep(1500);
await evalJs(`(() => { const b=[...document.querySelectorAll('.resume-bar button')].find(x=>x.textContent.includes('โฟกัสต่อ')); if(b)b.click(); return !!b; })()`);
await sleep(1500);
const timerLabel = await evalJs(`document.querySelector('.timer-label')?.textContent || ''`);
expect('กดโฟกัสต่อแล้วกลับไปหน้าจอโฟกัส', timerLabel.includes('กำลังโฟกัส'), timerLabel.trim());

chrome.kill();
console.log(`\nผลลัพธ์: ${pass} ผ่าน, ${fail} ตก`);
process.exit(fail > 0 ? 1 : 0);
