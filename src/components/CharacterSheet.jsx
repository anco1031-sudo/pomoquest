import { useState } from 'react';
import { useGame } from '../context.jsx';
import { sfx } from '../sound.js';
import { Panel, StatRow } from './ui.jsx';

export function StatAllocator({ onDone }) {
  const { character, post } = useGame();
  const [alloc, setAlloc] = useState({ hp: 0, mp: 0, atk: 0, def: 0, spd: 0 });
  const [busy, setBusy] = useState(false);
  const remaining = character.statPoints - (alloc.hp + alloc.mp + alloc.atk + alloc.def + alloc.spd);

  const set = (k, v) => {
    const next = Math.max(0, Math.min(v, remaining + alloc[k]));
    setAlloc((a) => ({ ...a, [k]: next }));
  };

  const auto = () => {
    let left = character.statPoints;
    const a = { hp: 0, mp: 0, atk: 0, def: 0, spd: 0 };
    const order = ['hp', 'atk', 'spd', 'def', 'mp'];
    let i = 0;
    while (left > 0) {
      a[order[i % order.length]] += 1;
      left -= 1;
      i += 1;
    }
    setAlloc(a);
    sfx.click();
  };

  const confirm = async () => {
    if (remaining > 0 || busy) return;
    setBusy(true);
    sfx.levelup();
    await post('/character/allocate', alloc);
    setAlloc({ hp: 0, mp: 0, atk: 0, def: 0, spd: 0 });
    setBusy(false);
    onDone?.();
  };

  const rows = [
    { k: 'hp', label: '❤️ HP', per: '+8 ต่อแต้ม', val: character.maxHp },
    { k: 'mp', label: '💧 MP', per: '+5 ต่อแต้ม', val: character.maxMp },
    { k: 'atk', label: '⚔️ ATK', per: '+1 ต่อแต้ม', val: character.atk },
    { k: 'def', label: '🛡️ DEF', per: '+1 ต่อแต้ม', val: character.def },
    { k: 'spd', label: '👟 SPD', per: '+1 ต่อแต้ม', val: character.spd },
  ];

  return (
    <div className="alloc-box">
      <div className="alloc-header">
        <span>🪙 แต้มสถานะคงเหลือ: <b>{remaining}</b></span>
        <button className="btn btn-sm" onClick={auto}>✨ จัดอัตโนมัติ</button>
      </div>
      {rows.map((r) => (
        <div className="alloc-row" key={r.k}>
          <span className="alloc-label">{r.label}</span>
          <span className="alloc-per">{r.per}</span>
          <div className="alloc-btns">
            <button className="btn btn-sm" onClick={() => set(r.k, alloc[r.k] - 1)} disabled={alloc[r.k] === 0}>−</button>
            <span className="alloc-val">{alloc[r.k]}</span>
            <button className="btn btn-sm" onClick={() => set(r.k, alloc[r.k] + 1)} disabled={remaining === 0}>+</button>
          </div>
        </div>
      ))}
      <button className="btn btn-primary btn-big" onClick={confirm} disabled={remaining > 0 || busy}>
        ✅ ยืนยันการจัดสรร
      </button>
    </div>
  );
}

export default function CharacterSheet() {
  const { character, inventory, post, showToast } = useGame();
  if (!character) return null;

  const eq = character.equipment || {};
  const allEq = [eq.weapon, eq.offhand, eq.head, eq.body, eq.arms, eq.legs, eq.feet, ...(eq.accessories || [])].filter(Boolean);
  const sum = (k) => allEq.reduce((a, i) => a + (i[k] || 0), 0);
  const eqBonus = {
    maxHp: sum('hp_bonus'),
    maxMp: sum('mp_bonus'),
    atk: sum('atk_bonus'),
    def: sum('def_bonus'),
    spd: sum('spd_bonus'),
    crit: sum('crit_bonus'),
  };

  const twoHanded = eq.weapon?.handed === 2;
  const slots = [
    { label: 'อาวุธ (มือหลัก)', col: 'weapon_id', item: eq.weapon },
    { label: 'มือรอง (อาวุธ/โล่)', col: 'offhand_id', item: eq.offhand, locked: twoHanded },
    { label: 'หมวก (หัว)', col: 'head_id', item: eq.head },
    { label: 'เกราะ (ตัว)', col: 'armor_id', item: eq.body },
    { label: 'แขน', col: 'arms_id', item: eq.arms },
    { label: 'ขา', col: 'legs_id', item: eq.legs },
    { label: 'เท้า', col: 'feet_id', item: eq.feet },
    { label: 'เครื่องประดับ 1', col: 'accessory_id', item: eq.accessories?.[0] },
    { label: 'เครื่องประดับ 2', col: 'accessory_2_id', item: eq.accessories?.[1] },
    { label: 'เครื่องประดับ 3', col: 'accessory_3_id', item: eq.accessories?.[2] },
    { label: 'เครื่องประดับ 4', col: 'accessory_4_id', item: eq.accessories?.[3] },
  ];

  const unequip = async (s) => {
    sfx.click();
    const d = await post('/inventory/unequip', { slot: s.col });
    if (d) showToast(d.message || 'ถอดแล้ว');
  };

  return (
    <>
      <Panel title={`🛡️ ${character.name} · ${character.className} Lv.${character.level}`}>
        <StatRow label="HP สูงสุด" value={character.maxHp} bonus={eqBonus.maxHp} icon="❤️" />
        <StatRow label="MP สูงสุด" value={character.maxMp} bonus={eqBonus.maxMp} icon="💧" />
        <StatRow label="พลังโจมตี" value={character.atk} bonus={eqBonus.atk} icon="⚔️" />
        <StatRow label="พลังป้องกัน" value={character.def} bonus={eqBonus.def} icon="🛡️" />
        <StatRow label="ความเร็ว" value={character.spd} bonus={eqBonus.spd} icon="👟" />
        <StatRow label="คริติคอล" value={`${character.crit}%`} bonus={eqBonus.crit} icon="🎯" />
      </Panel>

      <Panel title="🔧 อุปกรณ์ที่สวม">
        {slots.map((s) => (
          <div className="slot-row" key={s.col}>
            <span className="slot-label">{s.label}</span>
            {s.locked ? (
              <span className="slot-empty">🔒 บล็อก (อาวุธสองมือ)</span>
            ) : s.item ? (
              <span className="slot-item">{s.item.icon} {s.item.name}{s.item.handed === 2 ? <span className="twohand-tag">สองมือ</span> : null}</span>
            ) : (
              <span className="slot-empty">— ว่าง —</span>
            )}
            {s.item && !s.locked && (
              <button className="btn btn-sm" onClick={() => unequip(s)}>ถอด</button>
            )}
          </div>
        ))}
        <p className="hint">💡 สวมไอเทมได้ที่กระเป๋า (ช่วงพักแคมป์) — อาวุธสองมือจะปิดช่องมือรอง</p>
      </Panel>

      {character.statPoints > 0 && (
        <Panel title="⬆️ จัดสรรแต้มสถานะ">
          <StatAllocator />
        </Panel>
      )}

      <Panel title="🎒 ไอเทมในกระเป๋า">
        {inventory.length === 0 ? (
          <p className="hint">ยังไม่มีไอเทม — ออกผจญภัยเพื่อหาของ!</p>
        ) : (
          inventory.map((i) => (
            <div className="inv-row" key={i.item_id}>
              <span className="inv-icon">{i.icon}</span>
              <div className="inv-info">
                <div className="inv-name">{i.name} <span className="inv-qty">x{i.qty}</span>{i.exclusive ? <span className="exclusive-tag">✦ พิเศษ</span> : null}</div>
                <div className="inv-desc">{i.desc}</div>
              </div>
            </div>
          ))
        )}
      </Panel>
    </>
  );
}
