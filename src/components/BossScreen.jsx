import { useEffect, useRef, useState } from 'react';
import { useGame } from '../context.jsx';
import { sfx } from '../sound.js';
import { fmtTime } from './ui.jsx';
import { petMoodOf, petPerkLabel } from '../meta.js';

export default function BossScreen({ bossState, remain, total, running, breakOver = false, overrun = 0, onAct, onRetreat, onWinChoice }) {
  const { character, progress, inventory, cities } = useGame();
  const [potionOpen, setPotionOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const logRef = useRef(null);

  const boss = bossState?.boss;
  const log = bossState?.log || [];
  const outcome = bossState?.outcome;
  const fight = bossState?.fight || {};
  const chargeNeed = boss && fight.charging ? Math.max(1, Math.round(boss.maxHp * 0.12)) : 0;

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  useEffect(() => {
    if (bossState && !outcome) sfx.boss();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bossState?.boss?.name]);

  if (!character || !boss) {
    return <div className="screen"><p className="hint">กำลังเรียกบอส…</p></div>;
  }
  // 🐾 สัตว์เลี้ยงที่ใช้งาน — ฟองเกาะอวตาร์นักสู้ (pet ออกรบด้วย) + ป้าย 🥚 กำลังฟัก
  const activePet = (character.pets || []).find((p) => p.active) || null;
  const petMood = activePet ? petMoodOf(activePet, progress?.last_focus_date) : null;

  const consumables = inventory.filter((i) => i.type === 'consumable');
  const skills = character.skills || [];
  // ---- ข้อมูลการสำรวจเมืองเดิมต่อ (รอบถัดไป) — โชว์บนปุ่มเลือกหลังชนะบอส ----
  const cityList = cities && cities.length ? cities : [];
  const nextCity = cityList.length ? cityList[(character.cityIndex + 1) % cityList.length] : null;
  const stayRound = (character.cityRound || 0) + 1;
  const stayEnemy = +(1 + 0.15 * stayRound).toFixed(2);
  const stayReward = +(1 + 0.2 * stayRound).toFixed(2);

  const act = async (action, arg) => {
    sfx.click();
    await onAct(action, arg);
    setPotionOpen(false);
    setSkillsOpen(false);
  };

  return (
    <div className="screen boss-screen">
      <header className="camp-header">
        <div>
          <div className="timer-title">👹 จอมบอสประจำเมือง!</div>
          <div className="camp-sub">
            {breakOver
              ? `⏰ เลยเวลาพัก ${fmtTime(overrun)} — เริ่มโฟกัสเมื่อพร้อม`
              : `⏳ พักยาวเหลือ ${fmtTime(remain)} — ชนะบอสเพื่อเดินทางต่อ`}
          </div>
        </div>
        <button className="btn btn-sm" onClick={() => window.confirm('หนีจากบอส? จะเสียพลัง 20%') && onRetreat()}>💨 หนี</button>
      </header>

      {/* boss card */}
      <div className="boss-card">
        <div className="boss-avatar">{boss.icon}</div>
        <div className="boss-name">
          {boss.name}
          {boss.isAlt && <span className="alt-boss-tag" title="บอสลับ — เจอเมื่อสำรวจเมืองเดิมครบรอบ ให้ของพิเศษ">👁️ บอสลับ</span>}
          {boss.isWander && <span className="alt-boss-tag wander-boss-tag" title="บอสเร่ร่อนประจำสัปดาห์ — ชนะได้ของรางวัลการันตี + แบบแปลนสูตรคราฟต์ 📋">🐉 บอสเร่ร่อน</span>}
          {fight.rage && <span className="boss-rage-tag" title="HP เหลือไม่ถึงครึ่ง — บอสโกรธจัด! ATK พุ่ง x1.4 และใช้ท่าเด็ดถี่ขึ้น">😡 โกรธจัด</span>}
          {fight.fury && <span className="boss-rage-tag boss-fury-tag" title="สู้ยืดเยื้อเกิน 30 เทิร์น — ATK บอสพุ่งถาวร x1.6">🔥 สุดทน</span>}
          {fight.armor && <span className="boss-status-chip boss-armor-chip" title="เกราะติดอยู่ — ดาเมจที่บอสได้รับลดลง">🛡️ กันดาเมจ ({fight.armorTurns} เทิร์น)</span>}
          {fight.dodge && <span className="boss-status-chip boss-dodge-chip" title="เงามายา — บอสหลบโจมตีของคุณ">💨 หลบโจมตี ({fight.dodgeTurns} เทิร์น)</span>}
        </div>
        {(character.cityRound || 0) > 0 && (
          <div className="boss-explore-note">
            🏠 สำรวจรอบที่ {character.cityRound} — ศัตรู x{character.exploreMult} · รางวัล x{character.exploreRewardMult}
          </div>
        )}
        <div className="hp-row"><span>💢 HP</span><span>{boss.hp}/{boss.maxHp}</span></div>
        <div className="hp-bar">
          <div
            className="hp-fill boss-color"
            style={{ width: `${Math.max(0, (boss.hp / boss.maxHp) * 100)}%` }}
          />
        </div>
        <div className="boss-stats">
          <span>⚔️ {boss.atk}</span><span>🛡️ {boss.def}</span>
        </div>
        {boss.ult && (
          <div className="boss-skills">
            <span className="boss-skills-title">ท่าไม้ตาย:</span>
            <span className="boss-skill-chip boss-ult-chip" title={boss.ult.desc}>{boss.ult.icon} {boss.ult.name}</span>
          </div>
        )}
        {fight.charging && !outcome && (
          <div className="boss-charge-note">
            ⚠️ กำลังชาร์จ <b>{boss.ult?.icon} {boss.ult?.name}</b>! โจมตีให้ถึง <b>{chargeNeed} ดาเมจ</b> ในเทิร์นนี้เพื่อสลาย — หรือตั้งรับ 🛡️ ไว้
          </div>
        )}
        {boss.skills?.length > 0 && (
          <div className="boss-skills">
            <span className="boss-skills-title">ท่าเด็ด:</span>
            {boss.skills.map((s) => (
              <span className="boss-skill-chip" key={s.name} title={s.desc}>{s.icon} {s.name}</span>
            ))}
          </div>
        )}
      </div>

      {/* player card */}
      <div className="player-card">
        <div className="player-avatar">
          {character.classIcon}
          {activePet ? (
            <div
              className={`companion-bubble pet-mood-${petMood.level}`}
              title={`🐾 ${activePet.name} (Lv.${activePet.level}) — ${activePet.desc}\n📈 ค่าพิเศษปัจจุบัน: ${petPerkLabel(activePet)}\n${petMood.msg}`}
            >
              {activePet.icon}
              <span className="pet-lv-tag">Lv.{activePet.level}</span>
              <span className="pet-mood-emoji">{petMood.msg.split(' ')[0]}</span>
            </div>
          ) : (
            <div className="companion-bubble" title="🐾 ยังไม่มีสัตว์เลี้ยง — หา 🥚 ไข่ปริศนาจากกล่องสมบัติ (หายาก ~2%) แล้วใช้ฟักดูสิ!">
              🥚
            </div>
          )}
          {/* ไข่กำลังฟัก (ใช้ไข่แล้ว — จะฟักหลังจบ 1 session) */}
          {character.hatchPending && (
            <div className="hatch-badge" title="🥚 ไข่ปริศนากำลังฟักอยู่ — จะฟักออกมาเป็นสัตว์เลี้ยงหลังจบ 1 session โฟกัส">
              🥚 กำลังฟัก…
            </div>
          )}
        </div>
        <div className="player-info">
          <div className="player-name">{character.name} Lv.{character.level}</div>
          <div className="hp-row"><span>❤️ HP</span><span>{character.hp}/{character.maxHp}</span></div>
          <div className="hp-bar"><div className="hp-fill hp-color" style={{ width: `${(character.hp / character.maxHp) * 100}%` }} /></div>
          <div className="hp-row"><span>💧 MP</span><span>{character.mp}/{character.maxMp}</span></div>
          <div className="hp-bar"><div className="hp-fill mp-color" style={{ width: `${(character.mp / character.maxMp) * 100}%` }} /></div>
          {character.hp <= Math.round(character.maxHp * 0.3) && <div className="danger-text">⚠️ พลังเหลือน้อย — ใช้ยาได้เลย!</div>}
        </div>
      </div>

      {/* actions */}
      {!outcome && (
        <div className="boss-actions">
          <button className="btn btn-primary" onClick={() => act('attack')}>⚔️ โจมตี</button>
          <button
            className="btn btn-guard"
            onClick={() => act('guard')}
            title="🛡️ ตั้งรับ — ลดดาเมจที่ได้รับ 60% ในเทิร์นนี้ + ฟื้น MP 10% (ไม่มีค่าใช้จ่าย) — ใช้รับมือท่าไม้ตายได้"
          >
            🛡️ ตั้งรับ
          </button>
          <button className="btn btn-skill" onClick={() => setSkillsOpen((o) => !o)} title="ดูสกิลของคลาส">
            ⚡ สกิล
          </button>
          <button className="btn" onClick={() => setPotionOpen((o) => !o)}>🧪 ใช้ยา</button>
        </div>
      )}

      {skillsOpen && !outcome && (
        <div className="skill-list">
          <div className="skill-list-title">
            ⚡ สกิลของ {character.className} — MP ที่เหลือ <b>{character.mp}</b>
          </div>
          {skills.map((s) => (
            <button
              key={s.id}
              className="btn skill-btn"
              disabled={character.mp < s.mp}
              onClick={() => act('skill', s.id)}
              title={s.desc}
            >
              <span className="skill-btn-top">{s.icon} {s.name} <span className="skill-lv-chip">Lv.{s.level}</span> <b className="skill-mp">({s.mp} MP)</b></span>
              <span className="skill-desc">{s.desc}</span>
            </button>
          ))}
          {skills.length === 0 && <div className="hint">คลาสนี้ยังไม่มีสกิล</div>}
        </div>
      )}

      {potionOpen && !outcome && (
        <div className="potion-list">
          {consumables.length === 0 && <div className="hint">ไม่มียาในกระเป๋า</div>}
          {consumables.map((i) => (
            <button key={i.item_id} className="btn btn-sm potion-btn" onClick={() => act('potion', i.item_id)}>
              {i.icon} {i.name} x{i.qty}
            </button>
          ))}
        </div>
      )}

      {/* battle log */}
      <div className="battle-log" ref={logRef}>
        {log.length === 0 && <div className="hint">บอสคำรามใส่คุณ — สู้! ⚔️</div>}
        {log.map((l, i) => (
          <div key={i} className="battle-line">{l}</div>
        ))}
      </div>

      {/* victory — เลือก: เดินทางต่อ (เมืองใหม่) หรือสำรวจเมืองเดิมต่อ (ความยาก/รางวัล/ตลาดมืดเพิ่ม) */}
      {outcome === 'win' && (
        <div className="victory-panel">
          <div className="victory-title">🏆 ชัยชนะ!</div>
          {(bossState.breaks > 0 || bossState.furyWin) && (
            <div className="master-win-note">
              ✨ รางวัลฝีมือ:{' '}
              {bossState.breaks > 0 && <>💥 สลายท่าไม้ตาย {bossState.breaks} ครั้ง (+{Math.min(3, bossState.breaks) * 8}% XP/ทอง)</>}
              {bossState.breaks > 0 && bossState.furyWin && ' · '}
              {bossState.furyWin && <>🔥 อดทนสู้จนบอสสุดทน (+15% ทอง)</>}
              {' '}— ของรางวัลบอสการันตี!
            </div>
          )}
          <p>
            กำราบ {boss.name} ได้!{boss.isAlt ? ' (👁️ บอสลับ — ของพิเศษการันตี!)' : ''} — จะเดินทางต่อ หรือสำรวจเมืองเดิมต่อ?
          </p>
          <div className="victory-choices">
            <button
              className="btn btn-primary btn-big"
              onClick={() => { sfx.levelup(); onWinChoice('travel'); }}
              disabled={!nextCity}
            >
              🚶 เดินทางต่อ{nextCity ? ` — ${nextCity.icon} ${nextCity.name}` : ''}
              <span className="stay-detail">เมืองใหม่ ความยากกลับสู่ปกติ</span>
            </button>
            <button className="btn btn-big btn-stay" onClick={() => { sfx.levelup(); onWinChoice('stay'); }}>
              🏠 สำรวจ {character.city.name} ต่อ (รอบที่ {stayRound})
              {/* ไม่โชว์ตารางรอบบอสลับ — ให้ผู้เล่นเจอเองตอนสู้ (เดาสุ่มเอา) */}
              <span className="stay-detail">ศัตรู x{stayEnemy} · รางวัล x{stayReward}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
