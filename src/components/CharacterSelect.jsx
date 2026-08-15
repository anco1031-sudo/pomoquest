import { useState } from 'react';
import { useGame } from '../context.jsx';
import { sfx } from '../sound.js';
import { SKILLS } from '../../server/data.js';
import CharacterCreation from './CharacterCreation.jsx';

export default function CharacterSelect({ standalone = false, onClose, onDone }) {
  const { characters, activeCharacterId, post, refresh } = useGame();
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [showSkillsId, setShowSkillsId] = useState(null);

  if (showCreate) return <CharacterCreation modal onClose={() => setShowCreate(false)} />;

  const select = async (c) => {
    sfx.click();
    setConfirmDeleteId(null);
    await post('/character/select', { id: c.id });
    await refresh();
    onDone?.();
  };

  const rename = async (c) => {
    const name = window.prompt('ชื่อใหม่:', c.name);
    if (name && name.trim() && name.trim() !== c.name) {
      sfx.click();
      const d = await post('/character/rename', { name });
      if (d) await refresh();
    }
  };

  // กันลบโดยไม่ตั้งใจ: กดครั้งแรก = เริ่มยืนยัน, กดครั้งที่สอง = ลบจริง
  const remove = async (c) => {
    sfx.click();
    if (confirmDeleteId !== c.id) {
      setConfirmDeleteId(c.id);
      return;
    }
    setConfirmDeleteId(null);
    const d = await post('/character/delete', { id: c.id, confirm: true });
    if (d) await refresh();
  };

  const content = (
    <div className={standalone ? 'select-screen' : 'modal character-select-modal'}>
      <div className="select-title">👥 เลือกตัวละคร</div>
      <p className="hint" style={{ textAlign: 'left', marginTop: 0, marginBottom: 10 }}>
        🛡️ ลบตัวละครต้องกด 🗑️ ยืนยัน 2 ครั้ง เพื่อกันลบโดยไม่ตั้งใจ
      </p>
      {characters.length === 0 && <p className="hint">ยังไม่มีตัวละคร — สร้างกันเลย!</p>}

      {characters.map((c) => (
        <div className={`char-card ${c.id === activeCharacterId ? 'active' : ''}`} key={c.id}>
          <div className="char-avatar">{c.classIcon}</div>
          <div className="char-info">
            <div className="char-name">
              {c.name}
              {c.id === activeCharacterId && <span className="char-current">กำลังเล่น</span>}
            </div>
            <div className="char-sub">{c.className} · Lv.{c.level} · {c.city.icon} {c.city.name}</div>
            <div className="char-sub">💰 {c.gold} ทอง</div>
            <div className="class-skills">
              {(SKILLS[c.class] || []).map((s) => (
                <span key={s.id} className="class-skill-chip" title={`${s.name}: ${s.desc} (${s.mp} MP)`}>
                  {s.icon}
                </span>
              ))}
            </div>
            {showSkillsId === c.id && (
              <div className="class-skill-panel">
                <div className="class-skill-panel-title">🎯 สกิลของ{c.className}</div>
                {(SKILLS[c.class] || []).map((s) => (
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
          <div className="char-actions">
            {c.id !== activeCharacterId && (
              <button className="btn btn-sm btn-primary" onClick={() => select(c)}>เลือก</button>
            )}
            <button
              className="btn btn-sm"
              onClick={() => { sfx.click(); setShowSkillsId(showSkillsId === c.id ? null : c.id); }}
              title="ดูสกิล"
            >
              {showSkillsId === c.id ? 'สกิล ▲' : 'สกิล ▼'}
            </button>
            <button className="btn btn-sm" onClick={() => rename(c)} title="เปลี่ยนชื่อ">✏️</button>
            <button
              className={`btn btn-sm ${confirmDeleteId === c.id ? 'btn-danger' : 'btn-danger-soft'}`}
              onClick={() => remove(c)}
              title={confirmDeleteId === c.id ? 'กดอีกครั้งเพื่อยืนยันการลบ' : 'ลบตัวละคร'}
            >
              {confirmDeleteId === c.id ? 'ยืนยันลบ?' : '🗑️'}
            </button>
          </div>
        </div>
      ))}

      <button
        className="btn btn-primary btn-big"
        onClick={() => { setConfirmDeleteId(null); setShowCreate(true); }}
      >
        ✨ สร้างตัวละครใหม่
      </button>
      {!standalone && (
        <button className="btn" onClick={() => { setConfirmDeleteId(null); onClose(); }}>ปิด</button>
      )}
    </div>
  );

  return standalone ? content : <div className="modal-backdrop">{content}</div>;
}
