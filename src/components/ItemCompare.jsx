// เทียบอุปกรณ์ในร้านกับของที่สวมอยู่ — โชว์ค่าสถานะต่างกันยังไง (ตัดสินใจซื้อง่ายขึ้น)
import { useState } from 'react';

// ช่องสวมใส่ที่ไอเทมนี้ไป (ตรงกับ server pickEquipSlot)
const SLOT_OF = {
  weapon: 'weapon',
  shield: 'offhand',
  armor: 'body',
  head: 'head',
  arms: 'arms',
  legs: 'legs',
  feet: 'feet',
  accessory: 'accessory',
};
const SLOT_LABELS = {
  weapon: 'อาวุธ (มือหลัก)', offhand: 'มือรอง', body: 'เกราะ (ตัว)', head: 'หมวก',
  arms: 'แขน', legs: 'ขา', feet: 'เท้า', accessory: 'เครื่องประดับ',
};
const STATS = [
  { key: 'atk_bonus', icon: '⚔️', label: 'ATK' },
  { key: 'def_bonus', icon: '🛡️', label: 'DEF' },
  { key: 'hp_bonus', icon: '❤️', label: 'HP' },
  { key: 'mp_bonus', icon: '💧', label: 'MP' },
  { key: 'spd_bonus', icon: '👟', label: 'SPD' },
  { key: 'crit_bonus', icon: '🎯', label: 'CRIT' },
];

// ไอเทมชิ้นนี้ไปช่องสวมใส่อะไร (null = ไม่ใช่เกียร์ ไม่ต้องเทียบ)
export function itemSlotKey(item) {
  if (!item || !item.type) return null;
  return SLOT_OF[item.type] || null;
}

export default function ItemCompare({ item, character }) {
  const [open, setOpen] = useState(false);
  const slot = itemSlotKey(item);
  if (!slot || !character?.equipment) return null;

  const eq = character.equipment || {};
  const current = slot === 'accessory'
    ? (eq.accessories || []).find(Boolean)
    : eq[slot] || null;

  const rows = STATS
    .map((s) => {
      const newV = item[s.key] || 0;
      const oldV = current?.[s.key] || 0;
      const diff = newV - oldV;
      if (newV === 0 && oldV === 0) return null;
      return { ...s, newV, oldV, diff };
    })
    .filter(Boolean);

  if (!rows.length) return null;

  return (
    <div className="item-compare">
      <button className="btn btn-sm btn-compare" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
        🔍 เทียบกับที่สวม {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="item-compare-panel">
          <div className="item-compare-title">
            ช่อง: {SLOT_LABELS[slot]}
            {current ? ` — สวมอยู่: ${current.icon} ${current.name}` : ' — ยังว่างอยู่'}
          </div>
          {rows.map((r) => (
            <div className={`item-compare-row ${r.diff > 0 ? 'up' : r.diff < 0 ? 'down' : 'same'}`} key={r.key}>
              <span className="item-compare-stat">{r.icon} {r.label}</span>
              <span className="item-compare-old">{current ? `${r.oldV > 0 ? '+' : ''}${r.oldV}` : '—'}</span>
              <span className="item-compare-arrow">→</span>
              <span className="item-compare-new">+{r.newV}</span>
              {r.diff !== 0 && <span className="item-compare-diff">{r.diff > 0 ? `▲ +${r.diff}` : `▼ ${r.diff}`}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
