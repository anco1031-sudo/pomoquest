import { useEffect, useState } from 'react';
import { sfx } from '../sound.js';

const AUTO_CLOSE_SEC = 7; // นับถอยหลังแล้วปิดเอง (ไม่รบกวนการโฟกัส) — กดรับทราบก่อนได้เสมอ

const ACCENT = {
  monster: 'red',
  treasure: 'gold',
  shrine: 'purple',
  merchant: 'blue',
  trap: 'orange',
};

export default function EventModal({ event, onClose }) {
  const [countdown, setCountdown] = useState(AUTO_CLOSE_SEC);

  // event ใหม่ → เริ่มนับถอยหลังใหม่
  useEffect(() => {
    setCountdown(AUTO_CLOSE_SEC);
  }, [event]);

  // นับถอยหลัง แล้วกด "รับทราบ" ให้อัตโนมัติ
  useEffect(() => {
    if (countdown <= 0) {
      onClose();
      return;
    }
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown, onClose]);

  if (!event) return null;
  const accent = ACCENT[event.key] || 'gold';

  const close = () => {
    sfx.click();
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className={`modal event-modal accent-${accent}`} onClick={(e) => e.stopPropagation()}>
        <div className="event-title">{event.title}</div>
        <p className="event-flavor">{event.flavor}</p>
        {event.detail && <div className="event-detail">{event.detail}</div>}

        <div className="event-rewards">
          {event.xp > 0 && <span className="reward-xp">+{event.xp} XP</span>}
          {event.gold > 0 && <span className="reward-gold">+{event.gold} ทอง</span>}
          {event.hpChange < 0 && <span className="reward-hp-loss">-{Math.abs(event.hpChange)} HP</span>}
          {event.hpChange > 0 && <span className="reward-hp">+{event.hpChange} HP</span>}
          {event.mpChange > 0 && <span className="reward-mp">+{event.mpChange} MP</span>}
          {event.item && <span className="reward-item">🎁 {event.item.icon} {event.item.name}</span>}
        </div>

        <button className="btn btn-primary btn-big" onClick={close}>
          รับทราบ{countdown > 0 ? ` (${countdown})` : ''}
        </button>
        {countdown > 0 && (
          <div className="event-auto-close">⏳ ปิดอัตโนมัติใน {countdown} วินาที — กดรับทราบเพื่อปิดทันที</div>
        )}
      </div>
    </div>
  );
}
