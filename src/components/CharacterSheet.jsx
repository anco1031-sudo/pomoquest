import { useState } from 'react';
import { useGame } from '../context.jsx';
import { sfx } from '../sound.js';
import { Panel, StatRow } from './ui.jsx';
import ItemStatChips, { itemReqMissing } from './ItemStats.jsx';
import { CLASS_WEIGHTS, AUTO_KEYS, gearAdjustedWeights, allocatePoints, equipGoals, allocateWithGoals } from '../alloc.js';

export function StatAllocator({ onDone }) {
  const { character, inventory, post } = useGame();
  const [alloc, setAlloc] = useState({ hp: 0, mp: 0, atk: 0, def: 0, spd: 0 });
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState(false);
  const remaining = character.statPoints - (alloc.hp + alloc.mp + alloc.atk + alloc.def + alloc.spd);

  const set = (k, v) => {
    const next = Math.max(0, Math.min(v, remaining + alloc[k]));
    setAlloc((a) => ({ ...a, [k]: next }));
  };

  const w = CLASS_WEIGHTS[character.class] || CLASS_WEIGHTS.warrior;
  const priorityHint = [...AUTO_KEYS].sort((a, b) => w[b] - w[a]).map((k) => ({ hp: 'HP', mp: 'MP', atk: 'ATK', def: 'DEF', spd: 'SPD' }[k])).join(' > ');

  // คำนวณน้ำหนักตามคลาส + ปรับด้วยอุปกรณ์ที่สวม (stat ที่เกียร์ให้เยอะ → ลดน้ำหนัก ไปเติม stat ที่ขาด)
  const eq = character.equipment || {};
  const gearBonus = { hp: 0, mp: 0, atk: 0, def: 0, spd: 0 };
  for (const i of [eq.weapon, eq.offhand, eq.head, eq.body, eq.arms, eq.legs, eq.feet, ...(eq.accessories || [])].filter(Boolean)) {
    gearBonus.hp += i.hp_bonus || 0;
    gearBonus.mp += i.mp_bonus || 0;
    gearBonus.atk += i.atk_bonus || 0;
    gearBonus.def += i.def_bonus || 0;
    gearBonus.spd += i.spd_bonus || 0;
  }
  const base = {
    hp: character.maxHp - gearBonus.hp,
    mp: character.maxMp - gearBonus.mp,
    atk: character.atk - gearBonus.atk,
    def: character.def - gearBonus.def,
    spd: character.spd - gearBonus.spd,
  };
  const weights = gearAdjustedWeights(character.class, gearBonus, base);
  const hasGearAdjust = AUTO_KEYS.some((k) => Math.abs(weights[k] - w[k]) > 0.001);

  // เป้าหมายจากของในกระเป๋า: ไอเทมที่สวมได้ (คลาส/เลเวลผ่าน) แต่ขาด statReq → เติม stat ให้ถึงเกณฑ์ก่อน
  const curStats = {
    hp: character.maxHp, mp: character.maxMp, atk: character.atk, def: character.def, spd: character.spd,
  };
  const { goals, items: goalItems } = equipGoals(character.class, character.level, curStats, inventory || []);
  const goalHint = goalItems.length
    ? `🎯 เป้าหมาย: ${goalItems.map((g) => `${g.icon} ${g.name} (${Object.entries(g.missing).map(([k, v]) => `${k.toUpperCase()} +${v}`).join(', ')})`).join(' · ')}`
    : null;

  const auto = () => {
    setAlloc(allocateWithGoals(character.statPoints, weights, goals, curStats));
    sfx.click();
  };
  // แผนที่แนะนำ (ตามคลาส + เกียร์ + เป้าหมายของในกระเป๋า) — ใช้ในโหมดวางแผน
  const suggestedPlan = allocateWithGoals(character.statPoints, weights, goals, curStats);
  const planLabel = (a) => AUTO_KEYS.map((k) => `${k.toUpperCase()} ${a[k]}`).join(' · ');

  const confirm = async () => {
    if (remaining > 0 || busy) return;
    setBusy(true);
    sfx.levelup();
    await post('/character/allocate', alloc);
    setAlloc({ hp: 0, mp: 0, atk: 0, def: 0, spd: 0 });
    setBusy(false);
    onDone?.();
  };

  // โหมดวางแผน (dry-run): คำนวณสถานะหลัง alloc ฝั่ง client — ไม่แตะ server ไม่บันทึก
  const after = {
    maxHp: character.maxHp + alloc.hp * 8,
    maxMp: character.maxMp + alloc.mp * 5,
    atk: character.atk + alloc.atk,
    def: character.def + alloc.def,
    spd: character.spd + alloc.spd,
  };
  const mockChar = {
    ...character,
    level: character.level,
    class: character.class,
    maxHp: after.maxHp, maxMp: after.maxMp,
    atk: after.atk, def: after.def, spd: after.spd,
  };
  // ของในกระเป๋าที่ตอนนี้สวมไม่ได้ (ขาด stat/เลเวล/คลาส) → หลัง alloc จะสวมได้ไหม
  const planGear = (inventory || []).filter((i) => i.type !== 'consumable' && i.type !== 'junk' && i.type !== 'scroll');
  const newlyEquippable = planGear.filter((i) => itemReqMissing(i, character).length > 0 && itemReqMissing(i, mockChar).length === 0);
  const stillBlocked = planGear.filter((i) => itemReqMissing(i, mockChar).length > 0);
  const planRows = [
    { k: 'HP', before: character.maxHp, after: after.maxHp, unit: '' },
    { k: 'MP', before: character.maxMp, after: after.maxMp, unit: '' },
    { k: 'ATK', before: character.atk, after: after.atk, unit: '' },
    { k: 'DEF', before: character.def, after: after.def, unit: '' },
    { k: 'SPD', before: character.spd, after: after.spd, unit: '' },
  ];

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
        <div className="alloc-header-btns">
          <button className={`btn btn-sm ${plan ? 'btn-plan' : ''}`} onClick={() => { setPlan(!plan); sfx.click(); }}>🔍 {plan ? 'ปิดโหมดวางแผน' : 'โหมดวางแผน'}</button>
          <button className="btn btn-sm" onClick={auto} title={`เน้นตามคลาส: ${priorityHint}`}>✨ จัดอัตโนมัติ (ตามคลาส)</button>
        </div>
      </div>
      <div className="alloc-hint">🎯 {character.className} ควรเน้น: <b>{priorityHint}</b> — จัดอัตโนมัติกระจายตามสัดส่วนนี้{hasGearAdjust ? ' · 🔧 ปรับตามอุปกรณ์ที่สวม' : ''}{goalHint ? ` · ${goalHint}` : ''}</div>
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
      {plan && (
        <div className="alloc-plan">
          <div className="alloc-plan-title">🔍 ผลลัพธ์ถ้าจัดสรรแบบนี้ (dry-run — ยังไม่บันทึก)</div>
          <div className="alloc-plan-suggest">
            <span>💡 แผนแนะนำ: <b>{planLabel(suggestedPlan)}</b></span>
            <button className="btn btn-sm btn-plan-apply" onClick={auto}>✨ จัดตามแผนนี้</button>
          </div>
          <div className="alloc-plan-stats">
            {planRows.map((r) => (
              <span className="alloc-plan-stat" key={r.k}>
                <b>{r.k}</b> {r.before} → <b className={r.after > r.before ? 'plan-up' : ''}>{r.after}{r.unit}</b>
              </span>
            ))}
          </div>
          {newlyEquippable.length > 0 && (
            <div className="alloc-plan-equip">✨ จะสวมได้ใหม่: {newlyEquippable.map((i) => `${i.icon} ${i.name}`).join(' · ')}</div>
          )}
          {stillBlocked.length > 0 && (
            <div className="alloc-plan-still">
              ⏳ ยังสวมไม่ได้:
              {stillBlocked.map((i) => (
                <span key={i.item_id} className="alloc-plan-still-item">{i.icon} {i.name} <em>({itemReqMissing(i, mockChar).join(' · ')})</em></span>
              ))}
            </div>
          )}
        </div>
      )}
      <button className="btn btn-primary btn-big" onClick={confirm} disabled={remaining > 0 || busy}>
        ✅ ยืนยันการจัดสรร
      </button>
    </div>
  );
}

// รายการสกิลของตัวละคร (คลาส + คัมภีร์) — โชว์เลเวล/XP เพื่อวางแผน
function SkillList({ skills }) {
  if (!skills || !skills.length) return <p className="hint">ยังไม่มีสกิล</p>;
  return (
    <div className="skill-list">
      {skills.map((s) => (
        <div className="skill-card" key={s.id}>
          <div className="skill-card-top">
            <span className="skill-card-name">{s.icon} {s.name}</span>
            <span className="skill-card-level">Lv.{s.level}{s.source === 'scroll' ? ' 📜' : ''}</span>
          </div>
          <div className="skill-card-desc">{s.desc} · <b className="skill-mp">{s.mp} MP</b></div>
          <div className="skill-xp-row">
            {s.level >= s.maxLevel ? (
              <span className="skill-maxed">⭐ เลเวลสูงสุดแล้ว</span>
            ) : (
              <>
                <div className="skill-xp-bar"><div className="skill-xp-fill" style={{ width: `${Math.min(100, (s.xp / s.xpNext) * 100)}%` }} /></div>
                <span className="skill-xp-text">XP {s.xp}/{s.xpNext}</span>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CharacterSheet() {
  const { character, inventory, post, showToast, cities } = useGame();
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

  const useItem = async (i) => {
    const d = await post('/inventory/use', { itemId: i.item_id });
    if (d) showToast(d.message || 'ใช้แล้ว');
  };

  const equipItem = async (i) => {
    sfx.click();
    const d = await post('/inventory/equip', { itemId: i.item_id });
    if (d) showToast(d.message || 'สวมแล้ว');
  };

  return (
    <>
      <Panel title="🗺️ ตำแหน่ง & เดินทาง">
        <p className="panel-text">
          ย้อนกลับไปเมืองที่เคยไปมาแล้ว — ค่าเดินทาง 20 ทอง/เมือง (บอสของเมืองนั้นจะ scale ตามเลเวลคุณ)
        </p>
        <div className="travel-list">
          {(cities || [])
            .filter((c) => c.index <= character.cityIndex)
            .map((c) => {
              const dist = character.cityIndex - c.index;
              const cost = dist * 20;
              const here = dist === 0;
              return (
                <div className={`travel-city ${here ? 'current' : ''}`} key={c.index}>
                  <span className="city-ico">{c.icon}</span>
                  <div className="city-info">
                    <div className="city-name">
                      {c.name}
                      {here && <span className="chip">📍 อยู่ที่นี่</span>}
                    </div>
                    <div className="city-sub">
                      {c.terrain}
                      {!here && ` · ระยะ ${dist} เมือง`}
                    </div>
                  </div>
                  {!here && (
                    <button
                      className="btn"
                      disabled={character.gold < cost}
                      onClick={() => post('/travel', { cityIndex: c.index })}
                    >
                      {character.gold < cost ? `💰 ไม่พอ (${cost})` : `🚶 ${cost} ทอง`}
                    </button>
                  )}
                </div>
              );
            })}
        </div>
      </Panel>

      <Panel title={`🛡️ ${character.name} · ${character.className} Lv.${character.level}`}>
        <StatRow label="HP สูงสุด" value={character.maxHp} bonus={eqBonus.maxHp} icon="❤️" />
        <StatRow label="MP สูงสุด" value={character.maxMp} bonus={eqBonus.maxMp} icon="💧" />
        <StatRow label="พลังโจมตี" value={character.atk} bonus={eqBonus.atk} icon="⚔️" />
        <StatRow label="พลังป้องกัน" value={character.def} bonus={eqBonus.def} icon="🛡️" />
        <StatRow label="ความเร็ว" value={character.spd} bonus={eqBonus.spd} icon="👟" />
        <StatRow label="คริติคอล" value={`${character.crit}%`} bonus={eqBonus.crit} icon="🎯" />
        {/* สูตรเดียวกับ server/game.js dodgeChance — SPD สูง หลบโจมตีบอสได้บ่อย (สูงสุด 20%) */}
        <StatRow label="หลบหลีก" value={`${Math.min(20, Math.round(character.spd * 0.8))}%`} icon="💨" />
      </Panel>

      <Panel title={`⚡ สกิล (${(character.skills || []).length})`}>
        <SkillList skills={character.skills} />
        <p className="hint">💡 สกิลสะสม XP ทุกครั้งที่ใช้สู้บอส — เลเวลยิ่งสูง ยิ่งแรง (+10%/เลเวล) · คัมภีร์หายาก 📜 เรียนสกิลเพิ่มได้จากกล่องสมบัติ</p>
      </Panel>

      <Panel title="🔧 อุปกรณ์ที่สวม">
        {slots.map((s) => (
          <div className="slot-row" key={s.col}>
            <span className="slot-label">{s.label}</span>
            {s.locked ? (
              <span className="slot-empty">🔒 บล็อก (อาวุธสองมือ)</span>
            ) : s.item ? (
              <span className="slot-item">
                <span>{s.item.icon} {s.item.name}{s.item.handed === 2 ? <span className="twohand-tag">สองมือ</span> : null}</span>
                <ItemStatChips item={s.item} character={character} />
              </span>
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
          inventory.map((i) => {
            const blocked = itemReqMissing(i, character);
            const isGear = i.type !== 'consumable' && i.type !== 'junk' && i.type !== 'scroll';
            return (
              <div className="inv-row" key={i.item_id}>
                <span className="inv-icon">{i.icon}</span>
                <div className="inv-info">
                  <div className="inv-name">{i.name} {i.type === 'weapon' && i.handed === 2 ? <span className="twohand-tag">สองมือ</span> : null} <span className="inv-qty">x{i.qty}</span>{i.exclusive ? <span className="exclusive-tag">✦ พิเศษ</span> : null}</div>
                  <ItemStatChips item={i} character={character} />
                  <div className="inv-desc">{i.desc}</div>
                  {isGear && blocked.length > 0 && (
                    <div className="inv-req-block">🔒 สวมไม่ได้: {blocked.join(' · ')}</div>
                  )}
                </div>
                <div className="inv-actions">
                  {i.type === 'consumable' ? (
                    <button className="btn btn-sm" onClick={() => useItem(i)}>ใช้</button>
                  ) : i.type === 'scroll' ? (
                    <button className="btn btn-sm btn-skill" onClick={() => useItem(i)}>📖 เรียนรู้</button>
                  ) : i.type === 'junk' ? (
                    <span className="junk-note">ขายได้ที่แคมป์</span>
                  ) : (
                    <button className="btn btn-sm" onClick={() => equipItem(i)} disabled={blocked.length > 0} title={blocked.length ? blocked.join(' · ') : ''}>
                      สวม
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </Panel>
    </>
  );
}
