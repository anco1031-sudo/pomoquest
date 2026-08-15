import { useEffect, useRef, useState } from 'react';
import { useGame } from '../context.jsx';
import { sfx } from '../sound.js';
import { fmtTime } from './ui.jsx';

export default function BossScreen({ bossState, remain, total, running, breakOver = false, overrun = 0, onAct, onRetreat, onContinue }) {
  const { character, inventory } = useGame();
  const [potionOpen, setPotionOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const logRef = useRef(null);

  const boss = bossState?.boss;
  const log = bossState?.log || [];
  const outcome = bossState?.outcome;

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

  const consumables = inventory.filter((i) => i.type === 'consumable');
  const skills = character.skills || [];

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
        <div className="boss-name">{boss.name}</div>
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
        <div className="player-avatar">{character.classIcon}</div>
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

      {/* victory */}
      {outcome === 'win' && (
        <div className="victory-panel">
          <div className="victory-title">🏆 ชัยชนะ!</div>
          <p>กำราบ {boss.name} ได้! เมืองถัดไปรอคุณอยู่ — {character.city.icon} {character.city.name}</p>
          <button className="btn btn-primary btn-big" onClick={() => { sfx.levelup(); onContinue(); }}>
            🚶 เดินทางต่อ (เริ่ม session ใหม่)
          </button>
        </div>
      )}
    </div>
  );
}
