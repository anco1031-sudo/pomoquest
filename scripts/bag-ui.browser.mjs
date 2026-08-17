// ตรวจสอบแถบกระเป๋า (bag meter) ในหน้าแผ่นตัวละคร — โชว์ X/20 + เตือนใกล้เต็ม
import { spawn } from 'node:child_process';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn('/usr/bin/chromium', ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=9336','--user-data-dir=/tmp/pq-chrome-bag3','about:blank'], { stdio: 'ignore' });
let ws = null;
for (let i = 0; i < 30 && !ws; i++) {
  await sleep(500);
  try {
    const res = await fetch('http://127.0.0.1:9336/json');
    const page = (await res.json()).find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; setTimeout(r, 3000); }); }
  } catch {}
}
if (!ws) { console.log('❌ chrome ไม่ขึ้น'); chrome.kill(); process.exit(1); }
let msgId = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }))?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:3001/' });
await sleep(3500);
// ไปที่แท็บ CharacterSheet (🛡️ ตัวละคร ใน tab bar)
await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('ตัวละคร'))?.click()`);
await sleep(1200);
const bagText = await evalJs(`(document.querySelector('.bag-meter')?.textContent || '').replace(/\\s+/g, ' ').trim()`);
const hasBar = await evalJs(`!!document.querySelector('.bag-bar')`);
console.log(`${bagText.includes('/20') ? '✅' : '❌'} bag: โชว์ X/20 — '${bagText}'`);
console.log(`${hasBar ? '✅' : '❌'} bag: มีแถบความจุ`);
chrome.kill();
process.exit(bagText.includes('/20') && hasBar ? 0 : 1);
