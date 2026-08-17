// ตรวจ toast ตอนสร้างตัวละครชื่อซ้ำ — ควรเด้งแจ้งเตือน
import { spawn } from 'node:child_process';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn('/usr/bin/chromium', ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=9337','--user-data-dir=/tmp/pq-chrome-dupe','about:blank'], { stdio: 'ignore' });
let ws = null;
for (let i = 0; i < 30 && !ws; i++) {
  await sleep(500);
  try {
    const res = await fetch('http://127.0.0.1:9337/json');
    const page = (await res.json()).find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; setTimeout(r, 3000); }); }
  } catch {}
}
if (!ws) { console.log('❌ chrome ไม่ขึ้น'); chrome.kill(); process.exit(1); }
let msgId = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }))?.result?.value;
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
let createReqCount = 0;
ws.onmessage2 = null;
const origOnMsg = ws.onmessage;
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Network.requestWillBeSent' && m.params.request.url.includes('/api/character/create')) createReqCount++;
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
await send('Page.navigate', { url: 'http://127.0.0.1:3001/' });
await sleep(3500);

// สร้างตัวละครแรกผ่าน API (ชื่อซ้ำเป้า)
await fetch('http://127.0.0.1:3001/api/character/create', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'ชื่อซ้ำเทสต์', class: 'warrior' }),
});
await send('Page.navigate', { url: 'http://127.0.0.1:3001/' });
await sleep(2500);

// เปิดหน้าจัดการตัวละคร (👥) → กดสร้างตัวละครใหม่
await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('👥'))?.click()`);
await sleep(1000);
const hasCreateBtn = await evalJs(`!![...document.querySelectorAll('button')].find(b => b.textContent.includes('สร้างตัวละคร'))`);
console.log('มีปุ่มสร้างตัวละคร:', hasCreateBtn);
if (hasCreateBtn) {
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('สร้างตัวละคร'))?.click()`);
  await sleep(800);
  // ใส่ชื่อซ้ำ (พิมพ์จริงผ่าน CDP) + เลือกคลาส + กดสร้าง
  // ⚠️ ต้องเจาะ input ใน modal (.character-create-modal input) — input อื่นบนหน้า (เช่นชื่องานที่ Home) ไม่ใช่
  const hasInput = await evalJs(`!!document.querySelector('.character-create-modal input')`);
  console.log('มี input ใน modal:', hasInput);
  await evalJs(`document.querySelector('.character-create-modal input')?.focus()`);
  await sleep(200);
  await send('Input.insertText', { text: 'ชื่อซ้ำเทสต์' });
  await sleep(400);
  const afterType = await evalJs(`document.querySelector('.character-create-modal input')?.value || ''`);
  console.log('ค่าหลังพิมพ์:', JSON.stringify(afterType));
  await evalJs(`[...document.querySelectorAll('.character-create-modal .class-card')].find(b => b.textContent.includes('นักรบ'))?.click()`);
  await sleep(300);
  // ปุ่ม submit ใน modal คือ "เริ่มการผจญภัย" (button text ไม่มีคำว่า "สร้าง")
  // debug: สถานะก่อนกด submit
  const dbg = await evalJs(`(() => {
    const modal = !!document.querySelector('.character-create-modal');
    const inputVal = document.querySelector('.character-create-modal input')?.value || '';
    const submitBtn = [...document.querySelectorAll('.character-create-modal button')].find(b => b.textContent.includes('เริ่มการผจญภัย'));
    const selectedCls = document.querySelector('.character-create-modal .class-card.selected')?.textContent.trim().slice(0, 20) || '(ไม่มี)'; 
    return JSON.stringify({ modal, inputVal, selectedCls, submitDisabled: submitBtn ? submitBtn.disabled : 'n/a' });
  })()`);
  console.log('debug:', dbg);
  await evalJs(`[...document.querySelectorAll('.character-create-modal button')].find(b => b.textContent.includes('เริ่มการผจญภัย'))?.click()`);
  await sleep(1500);
  const toasts = await evalJs(`[...document.querySelectorAll('.toast-stack > .toast')].map(t => t.textContent.trim()).filter(t => t).join(' | ')`);
  const bodyHas = await evalJs(`document.body.innerText.includes('มีตัวละครชื่อ')`);
  const inlineErr = await evalJs(`document.querySelector('.form-error')?.textContent.trim() || ''`);
  console.log('toast:', JSON.stringify(toasts));
  console.log('body มีข้อความชื่อซ้ำ:', bodyHas);
  console.log('inline error:', JSON.stringify(inlineErr));
  console.log('จำนวน request create:', createReqCount);
  const passInline = inlineErr.includes('มีตัวละครชื่อ') && createReqCount === 0; // client กันก่อน submit → ไม่ต้องเรียก server
  const passToast = toasts.includes('มีตัวละครชื่อ');
  console.log(`${passInline && passToast ? '✅' : '❌'} แจ้งเตือนชื่อซ้ำ (inline + toast)`);

  // เคสควบคุม: เปลี่ยนเป็นชื่อใหม่ → error หาย + สร้างสำเร็จ (ไม่ false positive)
  await evalJs(`(() => {
    const input = document.querySelector('.character-create-modal input');
    input.focus();
    input.select();
  })()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace' });
  await send('Input.insertText', { text: 'ชื่อใหม่เทสต์' });
  await sleep(400);
  const errAfterChange = await evalJs(`document.querySelector('.form-error')?.textContent.trim() || ''`);
  console.log('error หลังเปลี่ยนชื่อ:', JSON.stringify(errAfterChange));
  await evalJs(`[...document.querySelectorAll('.character-create-modal button')].find(b => b.textContent.includes('เริ่มการผจญภัย'))?.click()`);
  await sleep(1500);
  const createdModal = await evalJs(`document.body.innerText.includes('สร้างตัวละครสำเร็จ')`);
  const successToast = await evalJs(`[...document.querySelectorAll('.toast-stack > .toast')].map(t => t.textContent.trim()).filter(t => t).join(' | ')`);
  console.log('modal สำเร็จ:', createdModal, '| toast:', JSON.stringify(successToast));
  console.log(`${!errAfterChange && createdModal ? '✅' : '❌'} ชื่อใหม่สร้างสำเร็จ (error หาย + modal สำเร็จ)`);
}
chrome.kill();
