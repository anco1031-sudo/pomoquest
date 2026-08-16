// ตรวจกราฟ 7 วันในหน้าสถิติ — แท่งพักกลาง session (ชมพู) โชว์คู่กับแท่งพักเบรก (น้ำเงิน) + legend
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

// ตั้งข้อมูล: สร้างตัวละคร + จบ session ที่มีพักกลาง session 180 วิ (ผ่าน API จริง)
let r = await api('/character/create', { method: 'POST', body: { name: `กราฟ${Date.now()}`, class: 'warrior' } });
if (r.status !== 200) { console.log('❌ สร้างตัวละครไม่ได้:', r.json.error); process.exit(1); }
r = await api('/adventure/complete', { method: 'POST', body: { focusSec: 1500, pauseSec: 180 } });
if (r.status !== 200) { console.log('❌ จบ session ไม่ได้:', r.json.error); process.exit(1); }

const profile = `/tmp/pq-stats-profile-${Date.now()}`;
const chrome = spawn('chromium', [
  '--headless=new', '--no-sandbox', '--disable-gpu',
  '--remote-debugging-port=9337', `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

const wsUrl = await (async () => {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9337/json');
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

// ไปแท็บสถิติ
const statsClicked = await evalJs(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('สถิติ'));
  if (!b) return false;
  b.click();
  return true;
})()`);
expect('เปิดแท็บสถิติได้', statsClicked === true);
await sleep(2500);

const chart = await evalJs(`(() => {
  const panel = [...document.querySelectorAll('.panel')].find((p) => p.textContent.includes('เวลาพักย้อนหลัง 7 วัน'));
  if (!panel) return null;
  return {
    legend: panel.querySelector('.chart-legend')?.textContent.replace(/\\s+/g, ' ').trim() || '',
    breakBars: panel.querySelectorAll('.chart-bar-break').length,
    pauseBars: panel.querySelectorAll('.chart-bar-pause').length,
    values: [...panel.querySelectorAll('.chart-value')].map((v) => v.textContent),
  };
})()`);
expect('กราฟ 7 วันโชว์ legend (พักเบรก + พักกลาง session)', !!chart && chart.legend.includes('พักเบรก') && chart.legend.includes('พักกลาง session'), chart?.legend || '');
expect('กราฟมีแท่งพักเบรก 7 วัน', !!chart && chart.breakBars === 7, `break=${chart?.breakBars}`);
expect('กราฟมีแท่งพักกลาง session 7 วัน (คู่กับแท่งพักเบรก)', !!chart && chart.pauseBars === 7, `pause=${chart?.pauseBars}`);
expect('กราฟโชว์เวลารวมวันนี้ (คอลัมน์สุดท้าย = 3m จากพักกลาง session 180 วิ)', !!chart && chart.values[6]?.includes('3m'), JSON.stringify(chart?.values));

chrome.kill();
console.log(`\nผลลัพธ์: ${pass} ผ่าน, ${fail} ตก`);
process.exit(fail > 0 ? 1 : 0);
