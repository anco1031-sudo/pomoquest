import { useState } from 'react';
import { useGame } from '../context.jsx';
import { sfx } from '../sound.js';
import { SKILLS } from '../../server/data.js';

const CLASSES = [
  { key: 'warrior', name: 'นักรบ', en: 'Warrior', icon: '⚔️', desc: 'เลือดหนา พลังโจมตีสูง เหมาะกับสายบุก', base: 'HP 120 · ATK 14 · DEF 10' },
  { key: 'mage', name: 'นักเวทย์', en: 'Mage', icon: '🔮', desc: 'เวทมนตร์รุนแรงที่สุด แต่ร่างกายบอบบาง', base: 'MP 60 · ATK 16 · SPD 10' },
  { key: 'rogue', name: 'โจร', en: 'Rogue', icon: '🗡️', desc: 'ว่องไว โจมตีคริติคอลถี่ หลบเก่ง', base: 'SPD 14 · CRIT 15% · HP 95' },
  { key: 'cleric', name: 'นักบวช', en: 'Cleric', icon: '✨', desc: 'สายสมดุล มนามาก ฟื้นพลังได้เรื่อย ๆ', base: 'MP 50 · ATK 10 · DEF 9' },
];

// โหมดท้าทาย — เลือกได้ตอนสร้างตัวละคร (เพิ่มความยากแลกรางวัล x1.5 + ตราเฉพาะโหมด)
const CHALLENGES = [
  {
    key: '', name: '🎮 ปกติ', desc: 'สมดุล เหมาะกับเริ่มเล่น',
    detail: 'มอนสเตอร์/บอส/ราคาปกติ · ค่ายพักฟื้นพลังฟรี · พักระหว่างโฟกัสได้',
  },
  {
    key: 'hard', name: '⚔️ โหมดโหด', desc: 'ศัตรูแรงขึ้น ของยากขึ้น ของแพงขึ้น',
    detail: 'มอนสเตอร์/บอส +30% · ดรอป -40% · ราคาร้าน +30% · แต่ XP/ทอง x1.5 + ตราเฉพาะ',
  },
  {
    key: 'marathon', name: '⏱️ โหมดมาราธอน', desc: 'ห้ามพักระหว่างโฟกัส',
    detail: 'พักกลาง session = เสีย session (ไม่ได้รางวัล) · โฟกัสครบได้ XP/ทอง x1.5 + ตราเฉพาะ',
  },
  {
    key: 'survival', name: '🩸 โหมดเอาชีวิตรอด', desc: 'พักแคมป์ไม่ฟื้นพลัง ใกล้ตายเสียของ',
    detail: 'พักแคมป์ไม่ฟื้น HP/MP ฟรี · HP เหลือ 1 ตอนจบ session = เสียของสุ่ม + คอมโบหาย · XP/ทอง x1.5 + ตราเฉพาะ',
  },
];

// modal = แสดงเป็น modal (กดจากปุ่ม "สร้างตัวละครใหม่" ในหน้าเลือกตัวละคร)
// onClose = กลับไปหน้าเลือกตัวละคร (เฉพาะโหมด modal)
export default function CharacterCreation({ modal = false, onClose }) {
  const { post } = useGame();
  const [name, setName] = useState('');
  const [cls, setCls] = useState(null);
  const [challenge, setChallenge] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim() || !cls || busy) return;
    setBusy(true);
    sfx.start();
    const d = await post('/character/create', { name, class: cls, challengeMode: challenge });
    // เพิ่งสร้างตัวละครแรก (จากลิสต์ว่าง — เริ่มเกมใหม่จริง ๆ) → ให้หน้าแรกโชว์ modal วิธีเล่น
    if (d && d.characters?.length === 1) localStorage.setItem('pomoquest-onboarded-pending', '1');
    setBusy(false);
  };

  const content = (
    <>
      {modal && <div className="modal-title">✨ สร้างตัวละครใหม่</div>}

      <div className="panel">
        <div className="panel-title">📛 ตั้งชื่อนักผจญภัย</div>
        <input
          className="input"
          placeholder="ชื่อตัวละครของคุณ…"
          value={name}
          maxLength={20}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="panel">
        <div className="panel-title">🔥 เลือกโหมดท้าทาย <span className="hint" style={{ fontSize: 11 }}>(เลือกครั้งเดียวตอนสร้าง — เริ่มต้นแบบปกติแล้วค่อยลองก็ได้)</span></div>
        <div className="challenge-grid">
          {CHALLENGES.map((ch) => (
            <button
              key={ch.key || 'normal'}
              className={`challenge-card ${challenge === ch.key ? 'selected' : ''}`}
              onClick={() => { setChallenge(ch.key); sfx.click(); }}
            >
              <div className="challenge-name">{ch.name}</div>
              <div className="challenge-desc">{ch.desc}</div>
              {challenge === ch.key && <div className="challenge-detail">{ch.detail}</div>}
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">⚔️ เลือกคลาส</div>
        <div className="class-grid">
          {CLASSES.map((c) => (
            <button
              key={c.key}
              className={`class-card ${cls === c.key ? 'selected' : ''}`}
              onClick={() => { setCls(c.key); sfx.click(); }}
            >
              <div className="class-icon">{c.icon}</div>
              <div className="class-name">{c.name} <span className="class-en">{c.en}</span></div>
              <div className="class-desc">{c.desc}</div>
              <div className="class-base">{c.base}</div>
              <div className="class-skills">
                {(SKILLS[c.key] || []).map((s) => (
                  <span key={s.id} className="class-skill-chip" title={`${s.name}: ${s.desc} (${s.mp} MP)`}>
                    {s.icon}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>

        {cls && (
          <div className="class-skill-panel">
            <div className="class-skill-panel-title">
              🎯 สกิลของ{CLASSES.find((c) => c.key === cls)?.name}
            </div>
            {(SKILLS[cls] || []).map((s) => (
              <div className="class-skill-row" key={s.id}>
                <span className="class-skill-icon">{s.icon}</span>
                <div className="class-skill-info">
                  <div className="class-skill-name">
                    {s.name} <span className="mp-chip">-{s.mp} MP</span>
                  </div>
                  <div className="class-skill-desc">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        className="btn btn-primary btn-big"
        disabled={!name.trim() || !cls || busy}
        onClick={create}
      >
        🚀 เริ่มการผจญภัย{challenge ? ` (${CHALLENGES.find((c) => c.key === challenge)?.name})` : ''}
      </button>
      <p className="hint">ทุก 25 นาทีที่คุณโฟกัส = 1 session ผจญภัย · ครบ 4 session = สู้บอส!</p>
      {modal && (
        <button className="btn" onClick={onClose}>← กลับไปเลือกตัวละคร</button>
      )}
    </>
  );

  // โหมดหน้าเต็ม (ตอนยังไม่มีตัวละครเลย — หน้าแรกสุด)
  if (!modal) {
    return (
      <div className="creation">
        <div className="creation-hero">
          <div className="creation-logo">🍅⚔️</div>
          <h1>PomoQuest</h1>
          <p className="subtitle">โฟกัสงาน… แล้วตัวละครของคุณจะผจญภัยไปกับคุณ</p>
        </div>
        {content}
      </div>
    );
  }

  // โหมด modal — เด้งทับหน้าเลือกตัวละคร
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal character-create-modal" onClick={(e) => e.stopPropagation()}>
        {content}
      </div>
    </div>
  );
}
