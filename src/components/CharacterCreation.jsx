import { useState } from 'react';
import { useGame } from '../context.jsx';
import { sfx } from '../sound.js';

const CLASSES = [
  { key: 'warrior', name: 'นักรบ', en: 'Warrior', icon: '⚔️', desc: 'เลือดหนา พลังโจมตีสูง เหมาะกับสายบุก', base: 'HP 120 · ATK 14 · DEF 10' },
  { key: 'mage', name: 'นักเวทย์', en: 'Mage', icon: '🔮', desc: 'เวทมนตร์รุนแรงที่สุด แต่ร่างกายบอบบาง', base: 'MP 60 · ATK 16 · SPD 10' },
  { key: 'rogue', name: 'โจร', en: 'Rogue', icon: '🗡️', desc: 'ว่องไว โจมตีคริติคอลถี่ หลบเก่ง', base: 'SPD 14 · CRIT 15% · HP 95' },
  { key: 'cleric', name: 'นักบวช', en: 'Cleric', icon: '✨', desc: 'สายสมดุล มนามาก ฟื้นพลังได้เรื่อย ๆ', base: 'MP 50 · ATK 10 · DEF 9' },
];

// modal = แสดงเป็น modal (กดจากปุ่ม "สร้างตัวละครใหม่" ในหน้าเลือกตัวละคร)
// onClose = กลับไปหน้าเลือกตัวละคร (เฉพาะโหมด modal)
export default function CharacterCreation({ modal = false, onClose }) {
  const { post } = useGame();
  const [name, setName] = useState('');
  const [cls, setCls] = useState(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim() || !cls || busy) return;
    setBusy(true);
    sfx.start();
    await post('/character/create', { name, class: cls });
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
            </button>
          ))}
        </div>
      </div>

      <button
        className="btn btn-primary btn-big"
        disabled={!name.trim() || !cls || busy}
        onClick={create}
      >
        🚀 เริ่มการผจญภัย
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
