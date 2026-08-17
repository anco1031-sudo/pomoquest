// ตรวจสอบ: ไอเทมที่ซื้อแล้วในค่ายพัก กันซื้อซ้ำข้ามหน้าจอครบทุกกรณี (ร้านปกติ / ของแถมฟรี / ตลาดมืด / กล่องลึกลับ)
// - ซื้อแล้ว → "ขายแล้ว" + ไม่มีปุ่มซื้อ → กลับหน้าหลัก → กลับมาค่าย → ยัง "ขายแล้ว" (server จำจาก visit)
// - API: ซื้อซ้ำ visit เดียวกัน → 400 "ซื้อได้ครั้งเดียวต่อค่ายพัก"
// รัน: ต้องรัน server ก่อน (เช่น PORT=3210 POMOQUEST_DB=/tmp/pq-shop-test.db node server/index.js) แล้ว:
//   POMOQUEST_DB=/tmp/pq-shop-test.db node scripts/camp-shop.browser.mjs
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
  '--remote-debugging-port=9339', '--user-data-dir=/tmp/pq-chrome-shop', 'about:blank',
], { stdio: 'ignore' });

let ws = null;
for (let i = 0; i < 30 && !ws; i++) {
  await sleep(500);
  try {
    const res = await fetch('http://127.0.0.1:9339/json');
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
const campFor = async (visit) => (await api(`/camp?visit=${encodeURIComponent(visit)}`)).json;

// ---- สแกนหา visit ที่ต้องการ (deterministic ต่อ visit — เปิดซ้ำได้แบบเดิม) ----
const findVisit = async (prefix, pred, tries = 80) => {
  for (let i = 0; i < tries; i++) {
    const v = `${prefix}-${Date.now()}-${i}`;
    const d = await campFor(v);
    if (pred(d)) return { visit: v, data: d };
  }
  return null;
};

// ---- ตั้ง timer พักค้างด้วย visit ที่กำหนด แล้วโหลดหน้า ----
const epoch = db.prepare('SELECT epoch FROM settings WHERE id = 1').get()?.epoch || '';
const setBreak = async (charId, visit) => {
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
};
// สถานะของแถวสินค้าใน DOM: มี "ขายแล้ว" หรือยังมีปุ่มซื้อ?
// หมายเหตุ: แถวของเกียร์ (อาวุธ/เกราะ) จะมีปุ่ม "🔍 เทียบกับที่สวม" (ItemCompare) อยู่ด้วยเสมอ —
// ต้องเช็คเฉพาะปุ่มซื้อ (อยู่ใน .shop-buy หรือ class bm-buy/free-buy) ไม่ใช่ปุ่มแรกของแถว
const buyBtnSel = `.shop-buy button, button.bm-buy, button.free-buy`;
const rowState = async (name) => evalJs(`(() => {
  const row = [...document.querySelectorAll('.shop-row')].find(r => r.querySelector('.inv-name')?.textContent.includes(${JSON.stringify(name)}));
  if (!row) return null;
  return { sold: !!row.querySelector('.sold-tag'), buyBtn: !!row.querySelector(${JSON.stringify(buyBtnSel)}) };
})()`);
// กดปุ่มซื้อของแถวนั้น — ปุ่มซื้อคือปุ่มสุดท้ายของแถว (ปุ่มแรกอาจเป็นปุ่มเทียบ ItemCompare)
const clickBuy = async (name) => evalJs(`(() => {
  const row = [...document.querySelectorAll('.shop-row')].find(r => r.querySelector('.inv-name')?.textContent.includes(${JSON.stringify(name)}));
  if (!row) return 'ROW NOT FOUND';
  const btns = [...row.querySelectorAll('button')];
  const buy = btns.find(b => b.closest('.shop-buy') || b.classList.contains('bm-buy') || b.classList.contains('free-buy')) || btns[btns.length - 1];
  buy?.click();
  return 'clicked: ' + (buy?.textContent.trim() || '?');
})()`);

await send('Page.enable');
await send('Runtime.enable');

// สร้างตัวละคร + เติมทอง (ซื้อได้ทุกชิ้น) แล้วโหลดหน้า
const name = `campShop${Date.now()}`;
const created = await (await fetch(`${BASE}/api/character/create`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, class: 'warrior' }),
})).json();
const charId = created?.character?.id;
expect('สร้างตัวละคร test สำเร็จ', !!charId, `id=${charId}`);
db.prepare('UPDATE character SET gold = 999999 WHERE id = ?').run(charId);

await send('Page.navigate', { url: `${BASE}/` });
await sleep(2500);

// ===== กรณีที่ 1: ร้านปกติ + ของแถมฟรี (visit ที่มีของแถม — ราคา 0 และไม่มีตลาดมืด กันร้านปกติปิด) =====
const free = await findVisit('shopfree', (d) => !d.blackMarket && d.shop?.some((x) => x.free));
expect('เจอค่ายพักที่มีของแถม (deterministic)', !!free);
if (free) {
  const { visit, data } = free;
  const freeItem = data.shop.find((x) => x.free);
  const normalItem = data.shop.find((x) => !x.free && !x.bought);
  await setBreak(charId, visit);
  expect('เปิดค่ายพัก: ร้านปกติโชว์ (ไม่มีตลาดมืด)', !data.blackMarket && (await evalJs(`document.body.innerText.includes('ร้านค้าของพ่อค้าเร่ร่อน')`)));

  // ของแถม: ซื้อฟรี → ทองไม่ลด + "ขายแล้ว" + ปุ่มหาย
  const goldBefore = (await api('/state')).json.character.gold;
  await clickBuy(freeItem.name);
  await sleep(1200);
  const freeRow = await rowState(freeItem.name);
  const goldAfter = (await api('/state')).json.character.gold;
  expect('ของแถม: ซื้อฟรีได้ (ทองไม่ลด) + ขึ้น "ขายแล้ว" ไม่มีปุ่มซื้อ', freeRow?.sold === true && freeRow?.buyBtn === false && goldAfter === goldBefore, `gold ${goldBefore}→${goldAfter}`);
  let r = await api('/shop/buy', { method: 'POST', body: { itemId: freeItem.id, visit } });
  expect('ของแถม: ซื้อซ้ำ API → 400 (ครั้งเดียวต่อค่ายพัก)', r.status === 400, `${r.status} ${r.json.error || ''}`);

  // กลับหน้าหลัก → กลับมาค่าย → ของแถมยัง "ขายแล้ว"
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('กลับหน้าหลัก'))?.click()`);
  await sleep(1200);
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('กลับไปค่าย'))?.click()`);
  await sleep(1500);
  const freeRow2 = await rowState(freeItem.name);
  expect('ของแถม: กลับหน้าหลักแล้วกลับมา ยัง "ขายแล้ว" ไม่มีปุ่มซื้อ', freeRow2?.sold === true && freeRow2?.buyBtn === false, JSON.stringify(freeRow2));
  const afterBack = await campFor(visit);
  expect('ของแถม: /camp คืน bought=1 หลังกลับมา', afterBack.shop.find((x) => x.id === freeItem.id)?.bought === 1);

  // ของร้านปกติ: ซื้อ → "ขายแล้ว" → กลับหน้าหลัก/กลับมา → ยังขายแล้ว + API ซื้อซ้ำ 400
  if (normalItem) {
    await clickBuy(normalItem.name);
    await sleep(1200);
    const nRow = await rowState(normalItem.name);
    expect('ร้านปกติ: ซื้อแล้วขึ้น "ขายแล้ว" ไม่มีปุ่มซื้อ', nRow?.sold === true && nRow?.buyBtn === false, JSON.stringify(nRow));
    r = await api('/shop/buy', { method: 'POST', body: { itemId: normalItem.id, visit } });
    expect('ร้านปกติ: ซื้อซ้ำ API → 400 (ครั้งเดียวต่อค่ายพัก)', r.status === 400, `${r.status} ${r.json.error || ''}`);
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('กลับหน้าหลัก'))?.click()`);
    await sleep(1200);
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('กลับไปค่าย'))?.click()`);
    await sleep(1500);
    const nRow2 = await rowState(normalItem.name);
    expect('ร้านปกติ: กลับหน้าหลักแล้วกลับมา ยัง "ขายแล้ว" ไม่มีปุ่มซื้อ', nRow2?.sold === true && nRow2?.buyBtn === false, JSON.stringify(nRow2));
  }
}

// ===== กรณีที่ 2: ตลาดมืด (สินค้า 🖤 + กล่องลึกลับ 220) =====
const bm = await findVisit('shopbm', (d) => !!d.blackMarket);
expect('เจอค่ายพักที่มีตลาดมืด (deterministic)', !!bm);
if (bm) {
  const { visit, data } = bm;
  const bmItems = data.blackMarket.items;
  const normalBm = bmItems.find((x) => !x.bought && x.id !== 220);
  const box = bmItems.find((x) => x.id === 220);
  await setBreak(charId, visit);
  expect('เปิดค่ายพัก: โชว์ตลาดมืด (ร้านปกติปิด)', await evalJs(`document.body.innerText.includes('ตลาดมืด')`) && !(await evalJs(`document.body.innerText.includes('ร้านค้าของพ่อค้าเร่ร่อน')`)));

  // ของตลาดมืด: ซื้อ → "ขายแล้ว" + ปุ่มหาย
  if (normalBm) {
    await clickBuy(normalBm.name);
    await sleep(1200);
    const bRow = await rowState(normalBm.name);
    expect('ตลาดมืด: ซื้อแล้วขึ้น "ขายแล้ว" ไม่มีปุ่มซื้อ', bRow?.sold === true && bRow?.buyBtn === false, JSON.stringify(bRow));
    let r = await api('/shop/buy', { method: 'POST', body: { itemId: normalBm.id, visit } });
    expect('ตลาดมืด: ซื้อซ้ำ API → 400 (ครั้งเดียวต่อค่ายพัก)', r.status === 400, `${r.status} ${r.json.error || ''}`);
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('กลับหน้าหลัก'))?.click()`);
    await sleep(1200);
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('กลับไปค่าย'))?.click()`);
    await sleep(1500);
    const bRow2 = await rowState(normalBm.name);
    expect('ตลาดมืด: กลับหน้าหลักแล้วกลับมา ยัง "ขายแล้ว" ไม่มีปุ่มซื้อ', bRow2?.sold === true && bRow2?.buyBtn === false, JSON.stringify(bRow2));
  }

  // กล่องลึกลับ: ซื้อ (เปิดเลย) → ขึ้น "ขายแล้ว" + ซื้อซ้ำไม่ได้
  if (box && !box.bought) {
    await clickBuy(box.name);
    await sleep(1200);
    const boxRow = await rowState(box.name);
    expect('กล่องลึกลับ: ซื้อแล้วขึ้น "ขายแล้ว" ไม่มีปุ่มซื้อ', boxRow?.sold === true && boxRow?.buyBtn === false, JSON.stringify(boxRow));
    const r = await api('/shop/buy', { method: 'POST', body: { itemId: 220, visit } });
    expect('กล่องลึกลับ: ซื้อซ้ำ API → 400 (ครั้งเดียวต่อค่ายพัก)', r.status === 400, `${r.status} ${r.json.error || ''}`);
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('กลับหน้าหลัก'))?.click()`);
    await sleep(1200);
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('กลับไปค่าย'))?.click()`);
    await sleep(1500);
    const boxRow2 = await rowState(box.name);
    expect('กล่องลึกลับ: กลับหน้าหลักแล้วกลับมา ยัง "ขายแล้ว" ไม่มีปุ่มซื้อ', boxRow2?.sold === true && boxRow2?.buyBtn === false, JSON.stringify(boxRow2));
  }
}

chrome.kill();
console.log(`\nผลลัพธ์: ${pass} ผ่าน, ${fail} ตก`);
process.exit(fail > 0 ? 1 : 0);
