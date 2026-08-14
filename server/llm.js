// server/llm.js — โมดูล LLM แบบ pluggable (OpenAI-compatible chat completions)
//
// ตั้งค่าผ่าน env (ดู README):
//   LLM_API_KEY    = key / credits token (สำหรับ g4f: key จาก g4f.dev/members.html)
//   LLM_ENABLED    = "1" เปิดใช้โดยไม่ต้องส่ง key — สำหรับกรณี credits ผูกกับ IP
//                    (bake cake credits ฟรีที่ g4f.dev/chat แล้วเครื่องนั้นใช้ได้) หรือ Ollama local ที่ไม่ต้อง auth
//   LLM_BASE_URL   = base URL ของ API (default: https://g4f.space/v1 — endpoint เดียวกับที่ g4f client.js ใช้)
//   LLM_MODEL      = ชื่อโมเดล (default: "default" — ตามที่ตั้งไว้ในเกม)
//   LLM_TIMEOUT_MS = timeout ของแต่ละ request (default: 15000)
//
// หลักการสำคัญ: ปิดใช้งาน / เรียกไม่สำเร็จ / ตอบไม่ครบ → คืน null เสมอ
// ฝั่งที่เรียกใช้ fallback กลับไปใช้ข้อความตายตัวเดิม — เกมไม่เคยพังเพราะ LLM

const BASE_URL = (process.env.LLM_BASE_URL || 'https://g4f.space/v1').replace(/\/+$/, '');
const API_KEY = process.env.LLM_API_KEY || '';
const FORCE_ENABLED = process.env.LLM_ENABLED === '1' || process.env.LLM_ENABLED === 'true';
const MODEL = process.env.LLM_MODEL || 'default';
const TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS || '15000', 10);
const ENABLED = FORCE_ENABLED || !!API_KEY;

export function llmEnabled() {
  return ENABLED;
}

// เรียก LLM แบบ chat completion — คืนข้อความที่ได้ หรือ null เมื่อปิด/error/รูปแบบผิด
export async function llmChat({ system, user, maxTokens = 250, temperature = 0.9 } = {}) {
  if (!ENABLED || !user) return null;
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: MODEL,
        temperature,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system || 'You are a helpful assistant.' },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[llm] HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) return null;
    return content.trim();
  } catch (err) {
    console.warn(`[llm] ${err.message}`);
    return null;
  }
}
