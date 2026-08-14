import { useState } from 'react';
import { useGame } from '../context.jsx';
import { sfx } from '../sound.js';
import CharacterCreation from './CharacterCreation.jsx';

export default function CharacterSelect({ standalone = false, onClose, onDone }) {
  const { characters, activeCharacterId, post, refresh } = useGame();
  const [showCreate, setShowCreate] = useState(false);

  if (showCreate) return <CharacterCreation />;

  const select = async (c) => {
    sfx.click();
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

  const remove = async (c) => {
    if (!window.confirm(`ลบตัวละคร "${c.name}"? ข้อมูล เลเวล และไอเทมทั้งหมดจะหายไปถาวร`)) return;
    sfx.click();
    const d = await post('/character/delete', { id: c.id });
    if (d) await refresh();
  };

  const content = (
    <div className={standalone ? 'select-screen' : 'modal character-select-modal'}>
      <div className="select-title">👥 เลือกตัวละคร</div>
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
          </div>
          <div className="char-actions">
            {c.id !== activeCharacterId && (
              <button className="btn btn-sm btn-primary" onClick={() => select(c)}>เลือก</button>
            )}
            <button className="btn btn-sm" onClick={() => rename(c)} title="เปลี่ยนชื่อ">✏️</button>
            <button className="btn btn-sm btn-danger-soft" onClick={() => remove(c)} title="ลบตัวละคร">🗑️</button>
          </div>
        </div>
      ))}

      <button className="btn btn-primary btn-big" onClick={() => setShowCreate(true)}>
        ✨ สร้างตัวละครใหม่
      </button>
      {!standalone && (
        <button className="btn" onClick={onClose}>ปิด</button>
      )}
    </div>
  );

  return standalone ? content : <div className="modal-backdrop">{content}</div>;
}
