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
  const { character, inventory, post } = useGame();
  if (!character) return null;

  const eqBonus = {
    maxHp: (character.weapon?.hp_bonus || 0) + (character.armor?.hp_bonus || 0) + (character.accessory?.hp_bonus || 0),
    maxMp: (character.weapon?.mp_bonus || 0) + (character.armor?.mp_bonus || 0) + (character.accessory?.mp_bonus || 0),
    atk: (character.weapon?.atk_bonus || 0) + (character.armor?.atk_bonus || 0) + (character.accessory?.atk_bonus || 0),
    def: (character.weapon?.def_bonus || 0) + (character.armor?.def_bonus || 0) + (character.accessory?.def_bonus || 0),
    spd: (character.weapon?.spd_bonus || 0) + (character.armor?.spd_bonus || 0) + (character.accessory?.spd_bonus || 0),
    crit: (character.weapon?.crit_bonus || 0) + (character.armor?.crit_bonus || 0) + (character.accessory?.crit_bonus || 0),
  };

  const slots = [
    { label: 'อาวุธ', item: character.weapon, type: 'weapon' },
    { label: 'เกราะ', item: character.armor, type: 'armor' },
    { label: 'เครื่องประดับ', item: character.accessory, type: 'accessory' },
  ];

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
          <div className="slot-row" key={s.type}>
            <span className="slot-label">{s.label}</span>
            {s.item ? (
              <span className="slot-item">{s.item.icon} {s.item.name}</span>
            ) : (
              <span className="slot-empty">— ว่าง —</span>
            )}
            {s.item && (
              <button
                className="btn btn-sm"
                onClick={async () => {
                  // ถอดออก: หาไอเทมชนิดเดียวกันในกระเป๋าแล้วสวมแทนไม่ได้ ง่ายสุดคือเก็บไว้
                  const d = await post('/inventory/equip', { itemId: s.item.id });
                  if (d) s.item = null;
                }}
              >
                เก็บ
              </button>
            )}
          </div>
        ))}
        <p className="hint">💡 สวมไอเทมได้ที่กระเป๋า (ช่วงพักแคมป์)</p>
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
