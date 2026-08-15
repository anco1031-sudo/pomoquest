import { itemReqParts } from '../itemreq.js';
export { itemReqMissing } from '../itemreq.js';

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

export default function ItemStatChips({ item, character }) {
  const parts = [...itemStatParts(item), ...itemReqParts(item, character)];
  if (!parts.length) return null;
  return (
    <span className="item-stat-chips">
      {parts.map((p, idx) => (
        <span key={idx} className={`item-stat-chip ${p.icon === '🔒' || p.icon === '🎭' ? 'req' : ''} ${p.cls ? `cls-${p.cls}` : ''}`}>{p.icon} {p.text}</span>
      ))}
    </span>
  );
}
