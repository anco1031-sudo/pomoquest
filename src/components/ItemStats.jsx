import { CLASSES } from '../../server/data.js';

// แปลงค่า stat ของไอเทมเป็นรายการสำหรับแสดง (chips / tooltip)
export function itemStatParts(i) {
  const p = [];
  if (!i) return p;
  if (i.atk_bonus) p.push({ icon: '⚔️', text: `ATK +${i.atk_bonus}` });
  if (i.def_bonus) p.push({ icon: '🛡️', text: `DEF +${i.def_bonus}` });
  if (i.hp_bonus) p.push({ icon: '❤️', text: `HP +${i.hp_bonus}` });
  if (i.mp_bonus) p.push({ icon: '💧', text: `MP +${i.mp_bonus}` });
  if (i.spd_bonus) p.push({ icon: '👟', text: `SPD +${i.spd_bonus}` });
  if (i.crit_bonus) p.push({ icon: '🎯', text: `CRIT +${i.crit_bonus}%` });
  if (i.heal_pct) p.push({ icon: '🧪', text: `HP ${Math.round(i.heal_pct * 100)}%` });
  if (i.mana_pct) p.push({ icon: '🔮', text: `MP ${Math.round(i.mana_pct * 100)}%` });
  if (i.use_gold) p.push({ icon: '💰', text: `ใช้แล้ว +${i.use_gold} ทอง` });
  if (i.use_xp) p.push({ icon: '✨', text: `ใช้แล้ว +${i.use_xp} XP` });
  return p;
}

// ข้อจำกัดการสวมใส่ (🔒 เลเวล/เฉพาะคลาส/ค่าสถานะ) — ใช้กับอุปกรณ์เท่านั้น
const REQ_ICON = { atk: '⚔️', def: '🛡️', spd: '👟', mp: '💧', crit: '🎯' };
export function itemReqParts(i) {
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
    p.push({ icon: REQ_ICON[k] || '🔒', text: `${k.toUpperCase()} ${v}+` });
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

export default function ItemStatChips({ item }) {
  const parts = [...itemStatParts(item), ...itemReqParts(item)];
  if (!parts.length) return null;
  return (
    <span className="item-stat-chips">
      {parts.map((p, idx) => (
        <span key={idx} className={`item-stat-chip ${p.icon === '🔒' || p.icon === '🎭' ? 'req' : ''} ${p.cls ? `cls-${p.cls}` : ''}`}>{p.icon} {p.text}</span>
      ))}
    </span>
  );
}
