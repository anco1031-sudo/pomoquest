// ทดสอบโมดูล LLM ด้วย mock server ในเครื่อง — ไม่พึ่งเครือข่าย/credits จริง
// รัน: npm run test:llm
import http from 'node:http';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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

// รันใน process แยก (llm.js อ่าน env ตอน import) — ใช้ execFile แบบ async เพื่อไม่บล็อก mock server ใน parent
const runChild = async (extraEnv) => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
    const m = await import('./server/llm.js');
    process.stdout.write(JSON.stringify({ enabled: m.llmEnabled(), out: await m.llmChat({ user: 'hello' }) }));
  `], { cwd: root, env: { ...process.env, ...extraEnv } });
  return JSON.parse(stdout);
};

console.log('llm.js — เปิดใช้แบบไม่ต้อง key (LLM_ENABLED=1 — credits ผูก IP / Ollama)');
const child2Result = await runChild({ LLM_API_KEY: '', LLM_ENABLED: '1', LLM_BASE_URL: `http://127.0.0.1:${port}/v1` });
ok('llmEnabled() = true เมื่อ LLM_ENABLED=1', child2Result.enabled === true, JSON.stringify(child2Result));
ok('llmChat ทำงานได้แบบไม่มี key', child2Result.out === 'เรื่องราวจาก LLM (mock) OK', String(child2Result.out));
ok('ไม่ส่ง Authorization header (ไม่ต้อง auth)', received.auth === null, String(received.auth));

console.log('llm.js — ค่า default: ชี้ localhost:8080/v1 และเปิดใช้อัตโนมัติ');
// ไม่ตั้ง env อะไรเลย → base = http://localhost:8080/v1 (local → auto-enable)
const childDefault = await runChild({ LLM_API_KEY: '', LLM_ENABLED: '', LLM_BASE_URL: '' });
ok('llmEnabled() = true เมื่อ base เป็น localhost (auto-enable)', childDefault.enabled === true, JSON.stringify(childDefault));

console.log('llm.js — fallback เมื่อไม่มี server (connection refused)');
// ชี้ไป port ที่ไม่มีใครฟัง (127.0.0.1:1) — ต้องคืน null เงียบ ๆ
const childRefused = await runChild({ LLM_API_KEY: '', LLM_ENABLED: '1', LLM_BASE_URL: 'http://127.0.0.1:1/v1' });
ok('llmChat คืน null เมื่อ connection refused (fallback เงียบ)', childRefused.out === null, String(childRefused.out));

console.log('llm.js — ปิดใช้งาน (remote URL + ไม่มี key ไม่มี LLM_ENABLED)');
const childResult = await runChild({ LLM_API_KEY: '', LLM_ENABLED: '', LLM_BASE_URL: 'https://g4f.space/v1' });
ok('llmEnabled() = false เมื่อ remote และไม่มี key', childResult.enabled === false, JSON.stringify(childResult));
ok('llmChat คืน null เมื่อปิดใช้งาน', childResult.out === null);

server.close();
console.log(`\n✅ test-llm: ${passed}/${passed} ผ่าน`);
