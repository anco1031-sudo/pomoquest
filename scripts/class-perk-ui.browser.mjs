// ตรวจ UI จุดเด่น/จุดด้อยคลาส: การ์ดคลาสโชว์ ☀️/🌙 + แผ่นตัวละครโชว์สถานะปัจจุบัน
import { spawn } from 'node:child_process';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const expect = (label, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
  cond ? pass++ : fail++;
};

const chrome = spawn('/usr/bin/chromium', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--remote-debugging-port=9338', '--user-data-dir=/tmp/pq-chrome-perk', 'about:blank',
], { stdio: 'ignore' });

let ws = null;
for (let i = 0; i < 30 && !ws; i++) {
  await sleep(500);
  try {
    const res = await fetch('http://127.0.0.1:9338/json');
    const page = (await res.json()).find((t) => t.type === 'page');
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((r) => { ws.onopen = r; setTimeout(r, 3000); });
    }
  } catch { }
}
if (!ws) { console.log('❌ chrome ไม่ขึ้น'); chrome.kill(); process.exit(1); }
let msgId = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }))?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:3001/' });
await sleep(3500);

// ยังไม่มีตัวละคร → หน้าแรกสุดคือการ์ดเลือกคลาส (เปิดสร้างตัวละคร)
const hasClassCard = await evalJs(`!!document.querySelector('.class-card')`);
expect('UI: มีการ์ดคลาส (หน้าแรก)', hasClassCard, '');
if (hasClassCard) {
  const perks = await evalJs(`[...document.querySelectorAll('.class-perk-line')].map(e => e.textContent.trim())`);
  expect('UI: การ์ดคลาสโชว์จุดเด่น/จุดด้อย ☀️🌙', perks.some((t) => t.includes('☀️')) && perks.some((t) => t.includes('🌙')), `(${perks.length} บรรทัด) ${perks[0] || ''}...`);
  const hasNight = perks.some((t) => t.includes('🌙') && t.includes('โจร') === false);
}

// สร้างตัวละคร (โจร — มีค่า ☀️/🌙) แล้วเปิดแผ่นตัวละคร
await evalJs(`(() => {
  const input = document.querySelector('input');
  input && input.focus();
})()`);
await sleep(200);
await send('Input.insertText', { text: 'โจรเอก' });
await sleep(300);
await evalJs(`[...document.querySelectorAll('.class-card')].find(b => b.textContent.includes('โจร'))?.click()`);
await sleep(300);
await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('เริ่มการผจญภัย'))?.click()`);
await sleep(1500);
// โจรเอกกลายเป็น active → ไปหน้า Home → เปิดแผ่นตัวละคร (👥 → แท็บตัวละคร)
await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('👥'))?.click()`);
await sleep(1000);
let sheet = await evalJs(`document.body.innerText.includes('คอกสัตว์')`);
if (!sheet) {
  await evalJs(`[...document.querySelectorAll('button')].find(b => /ตัวละคร|จัดการ/.test(b.textContent))?.click()`);
  await sleep(1000);
  sheet = await evalJs(`document.body.innerText.includes('คอกสัตว์')`);
}
// แผ่นตัวละครมีกล่อง "คลาสตอนนี้"
const sheetPerk = await evalJs(`document.querySelector('.sheet-perk')?.textContent?.replace(/\\s+/g, ' ').trim() || ''`);
expect('UI: แผ่นตัวละครโชว์สถานะคลาสตอนนี้ (☀️/🌙)', sheetPerk.includes('คลาสตอนนี้') && (sheetPerk.includes('☀️') || sheetPerk.includes('🌙')), `'${sheetPerk.slice(0, 60)}'`);

chrome.kill();
console.log(`\nผลลัพธ์: ${pass} ผ่าน, ${fail} ตก`);
process.exit(fail > 0 ? 1 : 0);
