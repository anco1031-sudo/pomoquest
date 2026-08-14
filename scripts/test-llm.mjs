// ทดสอบโมดูล LLM ด้วย mock server ในเครื่อง — ไม่พึ่งเครือข่าย/credits จริง
// รัน: npm run test:llm
import http from 'node:http';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
const ok = (name, cond, extra = '') => {
  assert.ok(cond, `${name}${extra ? ` — ${extra}` : ''}`);
  passed += 1;
  console.log(`  ✅ ${name}`);
};

// ---- mock server (OpenAI-compatible) ----
let received = null;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    received = { url: req.url, auth: req.headers.authorization || null, body: JSON.parse(body || '{}') };
    res.setHeader('Content-Type', 'application/json');
    if (received.body.messages?.[1]?.content === 'FAIL') {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: { message: 'mock boom' } }));
      return;
    }
    res.end(JSON.stringify({ choices: [{ message: { content: 'เรื่องราวจาก LLM (mock) OK' } }] }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// ตั้ง env ก่อน import (llm.js อ่าน env ตอนโหลดโมดูล)
process.env.LLM_BASE_URL = `http://127.0.0.1:${port}/v1`;
process.env.LLM_API_KEY = 'test-key';
process.env.LLM_MODEL = 'default';
process.env.LLM_TIMEOUT_MS = '5000';

const { llmChat, llmEnabled } = await import('../server/llm.js');

console.log('llm.js — เปิดใช้งาน (มี key)');
ok('llmEnabled() = true เมื่อมี key', llmEnabled() === true);

const out = await llmChat({ system: 'sys prompt', user: 'hello' });
ok('llmChat คืนข้อความจาก LLM', out === 'เรื่องราวจาก LLM (mock) OK', String(out));
ok('เรียก URL /v1/chat/completions', received.url === '/v1/chat/completions', received.url);
ok('ส่ง Authorization Bearer', received.auth === 'Bearer test-key', received.auth);
ok('ส่ง model = "default" ตามที่ตั้งไว้', received.body.model === 'default', received.body.model);
ok('ส่ง system message ครบ', received.body.messages?.[0]?.role === 'system' && received.body.messages[0].content === 'sys prompt');

console.log('llm.js — fallback เมื่อ API error');
const fail = await llmChat({ user: 'FAIL' });
ok('HTTP 500 → คืน null (fallback เงียบ)', fail === null);

console.log('llm.js — ปิดใช้งาน (ไม่มี key)');
// รันใน process แยก (llm.js อ่าน env ตอน import) — ไม่มี key → ต้อง disabled
const child = execFileSync(process.execPath, ['--input-type=module', '-e', `
  const m = await import('./server/llm.js');
  process.stdout.write(JSON.stringify({ enabled: m.llmEnabled(), out: await m.llmChat({ user: 'x' }) }));
`], { cwd: root, env: { ...process.env, LLM_API_KEY: '', LLM_BASE_URL: '' } });
const childResult = JSON.parse(child.toString());
ok('llmEnabled() = false เมื่อไม่มี key', childResult.enabled === false, JSON.stringify(childResult));
ok('llmChat คืน null เมื่อปิดใช้งาน', childResult.out === null);

server.close();
console.log(`\n✅ test-llm: ${passed}/${passed} ผ่าน`);
