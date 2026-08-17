// ตรวจสอบ flow สู้บอส: 1) กดใช้สกิลไม่ error "สกิลไม่พบ" 2) ตัวเลือกสำรวจต่อไม่มีนับถอยบอสลับ 3) ชนะแล้วเลือกทางเลือก → กลับไป "พักหลังชัยชนะ" ที่ค่าย (ไม่โฟกัสทันที)
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';

const db = new Database(process.env.POMOQUEST_DB || './server/data/pomoquest.db');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const expect = (label, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
  cond ? pass++ : fail++;
};

const chrome = spawn('/usr/bin/chromium', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--remote-debugging-port=9335', '--user-data-dir=/tmp/pq-chrome-boss', 'about:blank',
], { stdio: 'ignore' });

let ws = null;
for (let i = 0; i < 30 && !ws; i++) {
  await sleep(500);
  try {
    const res = await fetch('http://127.0.0.1:9335/json');
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

await send('Page.enable');
await send('Runtime.enable');

// สร้างตัวละคร warrior + อัปเกรดให้ชนะบอสไว ๆ
const name = `bossFlow${Date.now()}`;
const created = await (await fetch('http://127.0.0.1:3001/api/character/create', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, class: 'warrior' }),
})).json();
const charId = created?.character?.id;
expect('สร้างตัวละคร test สำเร็จ', !!charId, `id=${charId}`);
db.prepare('UPDATE character SET level=50, max_hp=5000, hp=5000, mp=500, max_mp=500, atk=2000, def=500, spd=0, crit=0 WHERE id=?').run(charId);

// เขียน timer พักใหญ่ (สู้บอส) แล้วโหลดหน้า → ควรขึ้นหน้าจอบอส
const epoch = db.prepare('SELECT epoch FROM settings WHERE id = 1').get()?.epoch || '';
await send('Page.navigate', { url: 'http://127.0.0.1:3001/' });
await sleep(2500);
const timer = {
  phase: 'long_break', sessionIdx: 1, remain: 900, running: true, elapsed: 0, nextEventIn: 9999,
  sessionEvents: [], sessionKey: null, breakVisit: `boss-${Date.now()}`, awaitingBreak: false,
  breakOver: false, overrun: 0, breakStartedAt: Date.now(), breakAtHome: false, postBossNote: null,
  pausedAtHome: false, pauseStartedAt: null, pauseAccumSec: 0, focusTask: '', epoch,
  expiresAt: Date.now() + 900000,
};
await evalJs(`localStorage.setItem('pomoquest-timer-${charId}', ${JSON.stringify(JSON.stringify(timer))})`);
await send('Page.navigate', { url: 'http://127.0.0.1:3001/' });
await sleep(3000);

const onBossScreen = await evalJs(`document.body.innerText.includes('จอมบอสประจำเมือง')`);
expect('หน้า BossScreen ขึ้น (พักใหญ่)', onBossScreen, '');

// 1) กดใช้สกิล — ต้องไม่ error "สกิลไม่พบ"
await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('⚡ สกิล'))?.click()`);
await sleep(800);
const skillBtn = await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('ฟันแหลก'))?.click()`);
await sleep(1200);
const noSkillErr = await evalJs(`!document.body.innerText.includes('สกิลไม่พบ')`);
const skillUsed = await evalJs(`document.body.innerText.includes('ฟันแหลก')`);
expect('กดใช้สกิล: ไม่ error "สกิลไม่พบ" + ใช้จริง', noSkillErr && skillUsed, `skillBtn=${skillBtn}`);

// ถ้ายังไม่ชนะ (สกิลอาจยังไม่จบบอส) → กดโจมตีจนกว่าจะขึ้น panel ชนะ
let winPanel = await evalJs(`document.body.innerText.includes('🏆 ชัยชนะ!')`);
for (let i = 0; i < 40 && !winPanel; i++) {
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('⚔️ โจมตี'))?.click()`);
  await sleep(1000);
  winPanel = await evalJs(`document.body.innerText.includes('🏆 ชัยชนะ!')`);
}
expect('ชนะบอส → ขึ้น panel ชัยชนะ', winPanel, '');

// 2) ตัวเลือกสำรวจต่อ — ต้องไม่มีข้อความนับถอยบอสลับ ("บอสลับอีกรอบ X รอบ")
const stayDetail = (await evalJs(`[...document.querySelectorAll('.stay-detail')].map(e => e.textContent).join(' | ')`)) || '';
const noAltCountdown = !stayDetail.includes('บอสลับอีกรอบ') && !stayDetail.includes('บอสลับมาแล้ว');
expect('ตัวเลือกสำรวจต่อ: ไม่โชว์นับถอย/สปอยล์บอสลับ', noAltCountdown, `'${stayDetail}'`);

// 3) เลือก "เดินทางต่อ" → ต้องกลับไป "พักหลังชัยชนะ" ที่ค่าย (ไม่โฟกัสทันที)
await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('เดินทางต่อ'))?.click()`);
await sleep(2000);
const postBossTitle = await evalJs(`document.body.innerText.includes('🏆 พักหลังชัยชนะ!')`);
const stillCamp = await evalJs(`document.body.innerText.includes('ค่ายพัก') || document.body.innerText.includes('พักหลังชัยชนะ')`);
const notWorking = await evalJs(`!document.body.innerText.includes('จอมบอสประจำเมือง')`);
expect('เลือกทางเลือกแล้ว → กลับไปพักหลังชัยชนะที่ค่าย (ไม่โฟกัสทันที)', postBossTitle && stillCamp && notWorking,
  `title=${postBossTitle} camp=${stillCamp}`);

chrome.kill();
console.log(`\nผลลัพธ์: ${pass} ผ่าน, ${fail} ตก`);
process.exit(fail > 0 ? 1 : 0);
