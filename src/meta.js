// สถานะระยะยาวของตัวละคร — คำนวณจาก progress (total_focus_sec / last_focus_date)
// ใช้ฝั่ง client โดยตรง (เหมือน logic ใน server/game.js — ไม่อ้างอิงกัน กัน dependency ฝั่ง server)
import { RANKS } from '../server/data.js';

// ยศ — ตามเวลาโฟกัสสะสม (นาที)
export function rankOf(totalFocusSec) {
  const min = Math.round((totalFocusSec || 0) / 60);
  let cur = RANKS[0];
  let next = null;
  for (const r of RANKS) {
    if (min >= r.minMin) cur = r;
    else { next = r; break; }
  }
  return {
    name: cur.name, icon: cur.icon, min,
    nextName: next?.name || null, nextIcon: next?.icon || null,
    pct: next ? Math.min(100, Math.round(((min - cur.minMin) / (next.minMin - cur.minMin)) * 100)) : 100,
    nextIn: next ? next.minMin - min : 0,
  };
}

// อารมณ์สัตว์เลี้ยง — ดูจากวันสุดท้ายที่โฟกัส (เหมือนขวัญกำลังใจตัวละคร แต่เป็นฟองอารมณ์ของ pet)
// 0 = สดใส (เพิ่งโฟกัส) → 3 = เบื่อมาก (5+ วันไม่ได้โฟกัส)
export function petMoodOf(pet, lastFocusDate) {
  let level = 0;
  if (!lastFocusDate) {
    level = 3;
  } else {
    const days = Math.max(0, Math.floor((Date.now() - new Date(`${lastFocusDate}T00:00:00`).getTime()) / 86400000));
    if (days <= 1) level = 0;
    else if (days <= 2) level = 1;
    else if (days <= 4) level = 2;
    else level = 3;
  }
  const moods = pet?.moods || ['😄 สดใส', '🙂 สดชื่น', '😐 เฉย ๆ', '🥺 เบื่อมาก'];
  return { level, msg: moods[level] || moods[3] };
}

// ป้ายค่าพิเศษของ pet (แสดงบนการ์ด) — ตัวเลขตามเลเวลปัจจุบัน (ค่าพิเศษ +10%/เลเวล)
export function petPerkLabel(pet) {
  if (!pet) return '';
  const mult = 1 + 0.1 * (pet.level - 1);
  const m = (v) => `${(v * mult * 100).toFixed(0)}%`;
  const parts = [];
  // gold/xp = % เพิ่มจากเหตุการณ์ · monster/treasure/shrine/trap = ตัวคูณน้ำหนัก event
  if (pet.gold) parts.push(`+${m(pet.gold)} ทอง`);
  if (pet.xp) parts.push(`+${m(pet.xp)} XP`);
  if (pet.monster) parts.push(`เจอมอนสเตอร์ x${(pet.monster * mult).toFixed(2)}`);
  if (pet.treasure) parts.push(`สมบัติ x${(pet.treasure * mult).toFixed(2)}`);
  if (pet.shrine) parts.push(`ศาลเจ้า x${(pet.shrine * mult).toFixed(2)}`);
  if (pet.trap) parts.push(`กับดัก x${(pet.trap * mult).toFixed(2)}`);
  if (pet.steal) parts.push(`ขโมยของ ${Math.round(pet.steal * 100)}%`);
  if (pet.trapShield) parts.push('กันกับดัก 1/รอบ');
  return parts.join(' · ');
}

// คอมโบโฟกัส — โบนัส XP ของ session ถัดไป (สูตรเดียวกับ server/game.js: bonus = 1 + min(streak-1, 4)*0.1)
// streak = จำนวน session ที่ทำครบต่อเนื่องแล้ว → จบ session นี้จะได้ bonus = 1 + min(streak, 4)*0.1 (สูงสุด x1.5)
export function comboBonusOf(streak) {
  const s = Math.max(0, Math.floor(streak || 0));
  return 1 + Math.min(s, 4) * 0.1;
}

// ขวัญกำลังใจ — ดูจากวันสุดท้ายที่โฟกัส (กี่วันแล้ว)
export function moraleOf(lastFocusDate) {
  if (!lastFocusDate) {
    return { level: 3, icon: '🥺', label: 'หม่นหมอง', msg: 'ยังไม่ได้โฟกัสเลย — ตัวละครเริ่มคิดถึงการผจญภัย' };
  }
  const days = Math.max(0, Math.floor((Date.now() - new Date(`${lastFocusDate}T00:00:00`).getTime()) / 86400000));
  if (days <= 1) return { level: 0, icon: '😄', label: 'สดใส', msg: 'เพิ่งโฟกัสเสร็จ — พร้อมลุยต่อ!' };
  if (days <= 2) return { level: 1, icon: '🙂', label: 'สดชื่น', msg: 'เมื่อวานได้ผจญภัย — ยังไหว!' };
  if (days <= 4) return { level: 2, icon: '😐', label: 'เฉย ๆ', msg: `${days} วันไม่ได้โฟกัส — ตัวละครเริ่มเบื่อ` };
  return { level: 3, icon: '🥺', label: 'หม่นหมอง', msg: `${days} วันแล้วที่ไม่ได้ผจญภัย — กลับมาโฟกัสเถอะ!` };
}
