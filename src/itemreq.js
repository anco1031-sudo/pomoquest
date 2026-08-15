// ข้อจำกัดการสวมไอเทม (เลเวล/เฉพาะคลาส/ค่าสถานะ) — pure functions ใช้ร่วมกัน UI + เทสต์ (import .jsx ตรงจาก node ไม่ได้)
import { CLASSES } from '../server/data.js';

// ข้อจำกัดการสวมใส่ (🔒 เลเวล/เฉพาะคลาส/ค่าสถานะ) — ใช้กับอุปกรณ์เท่านั้น
// character (optional): ถ้ามี จะต่อท้ายว่า "ขาด X" สำหรับ stat ที่ยังไม่ถึงเกณฑ์ (เทียบกับค่าปัจจุบันรวมเกียร์)
const REQ_ICON = { atk: '⚔️', def: '🛡️', spd: '👟', mp: '💧', crit: '🎯' };
export function itemReqParts(i, character) {
  const p = [];
  if (!i) return p;
  const gear = i.type !== 'consumable' && i.type !== 'junk' && i.type !== 'scroll';
  if (!gear) return p;
  if ((i.lvl || 1) > 1) p.push({ icon: '🔒', text: `เลเวล ${i.lvl}+` });
  if (i.classReq?.length) {
    const names = i.classReq.map((k) => CLASSES[k]?.name || k).join('/');
    p.push({ icon: '🎭', text: `เฉพาะ ${names}`, cls: i.classReq[0] });
  }
  for (const [k, v] of Object.entries(i.statReq || {})) {
    const cur = character?.[k] ?? 0;
    const short = character ? Math.max(0, v - cur) : 0;
    p.push({ icon: REQ_ICON[k] || '🔒', text: short > 0 ? `${k.toUpperCase()} ${v}+ (ขาด ${short})` : `${k.toUpperCase()} ${v}+` });
  }
  return p;
}

// ข้อจำกัดของไอเทมนี้ที่ตัวละครยังไม่ผ่าน (ใช้ disable ปุ่มสวม) — คืน array ของเหตุผล
export function itemReqMissing(i, character) {
  if (!i || !character) return [];
  const gear = i.type !== 'consumable' && i.type !== 'junk' && i.type !== 'scroll';
  if (!gear) return [];
  const out = [];
  if ((i.lvl || 1) > character.level) out.push(`ต้องเลเวล ${i.lvl} ขึ้นไป`);
  if (i.classReq && !i.classReq.includes(character.class)) out.push(`เฉพาะคลาส ${i.classReq.map((k) => CLASSES[k]?.name || k).join('/')}`);
  for (const [k, v] of Object.entries(i.statReq || {})) {
    if ((character[k] ?? 0) < v) out.push(`${k.toUpperCase()} ${v}+`);
  }
  return out;
}
