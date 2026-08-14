import { useEffect } from 'react';
import { sfx } from '../sound.js';
import { StatAllocator } from './CharacterSheet.jsx';

export default function LevelUpModal({ levelUp, onClose }) {
  const { levels, statPoints } = levelUp;

  useEffect(() => {
    sfx.levelup();
  }, []);

  return (
    <div className="modal-backdrop">
      <div className="modal levelup-modal">
        <div className="levelup-icon">⬆️</div>
        <h2 className="levelup-title">LEVEL UP!</h2>
        <p className="levelup-sub">
          {levels > 1 ? `เลเวลเพิ่มขึ้น ${levels} ระดับ!` : 'เลเวลเพิ่มขึ้น!'} — ได้รับ <b>{statPoints} แต้มสถานะ</b> พร้อม HP+10, MP+3, ATK+2, DEF+1, SPD+1 ต่อเลเวล
        </p>
        <StatAllocator onDone={onClose} />
      </div>
    </div>
  );
}
