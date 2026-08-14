import { useEffect } from 'react';
import { sfx } from '../sound.js';

export default function AchievementModal({ achievement, onClose }) {
  useEffect(() => {
    sfx.levelup();
  }, []);

  if (!achievement) return null;
  const { name, desc, icon, reward } = achievement;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal achieve-modal" onClick={(e) => e.stopPropagation()}>
        <div className="achieve-icon">{icon}</div>
        <div className="achieve-label">🏅 ACHIEVEMENT UNLOCKED!</div>
        <div className="achieve-name">{name}</div>
        <p className="achieve-desc">{desc}</p>
        {(reward.gold > 0 || reward.xp > 0) && (
          <div className="achieve-rewards">
            {reward.gold > 0 && <span className="reward-gold">+{reward.gold} ทอง</span>}
            {reward.xp > 0 && <span className="reward-xp">+{reward.xp} XP</span>}
          </div>
        )}
        <button className="btn btn-primary btn-big" onClick={onClose}>รับรางวัล! ✨</button>
      </div>
    </div>
  );
}
