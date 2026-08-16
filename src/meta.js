// สถานะระยะยาวของตัวละคร — คำนวณจาก progress (total_focus_sec / last_focus_date)
// ใช้ฝั่ง client โดยตรง (เหมือน logic ใน server/game.js — ไม่อ้างอิงกัน กัน dependency ฝั่ง server)
import { RANKS, COMPANIONS } from '../server/data.js';

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

// Companion — โตตามเวลาโฟกัสสะสม (นาที)
export function companionOf(totalFocusSec) {
  const min = Math.round((totalFocusSec || 0) / 60);
  let cur = COMPANIONS[0];
  let next = null;
  for (const c of COMPANIONS) {
    if (min >= c.minMin) cur = c;
    else { next = c; break; }
  }
  return {
    name: cur.name, icon: cur.icon, desc: cur.desc, min,
    nextName: next?.name || null, nextIcon: next?.icon || null,
    pct: next ? Math.min(100, Math.round(((min - cur.minMin) / (next.minMin - cur.minMin)) * 100)) : 100,
    nextIn: next ? next.minMin - min : 0,
  };
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
