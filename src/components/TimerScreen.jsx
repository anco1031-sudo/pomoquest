import { useGame } from '../context.jsx';
import { fmtTime } from './ui.jsx';

export default function TimerScreen({ remain, total, running, sessionIdx, sessionsPerCycle, nextEventIn, onPause, onResume, onAbort, sessionEvents = [] }) {
  const { character } = useGame();
  if (!character) return null;
  const city = character.city;
  const pct = total > 0 ? (remain / total) * 100 : 0;

  return (
    <div className="timer-screen">
      <div className="timer-city">
        <span className="city-icon">{city.icon}</span>
        <div>
          <div className="timer-title">⚔️ ผจญภัยใน {city.name}</div>
          <div className="timer-sub">{city.terrain} · Lv.{character.level} {character.classIcon}</div>
        </div>
      </div>

      <div className="timer-ring" style={{ '--pct': pct }}>
        <div className="timer-time">{fmtTime(remain)}</div>
        <div className="timer-label">{running ? 'กำลังโฟกัส…' : '⏸️ พักชั่วคราว'}</div>
      </div>

      <div className="session-dots">
        {Array.from({ length: sessionsPerCycle }).map((_, i) => (
          <div key={i} className={`dot ${i + 1 < sessionIdx ? 'done' : i + 1 === sessionIdx ? 'current' : ''}`}>
            {i + 1}
          </div>
        ))}
        <span className="session-text">session {sessionIdx}/{sessionsPerCycle}</span>
      </div>

      <div className="event-chip">🎲 เหตุการณ์ถัดไปใน {fmtTime(nextEventIn)}</div>

      <div className="timer-hp">
        <div className="hp-row"><span>❤️ HP</span><span>{character.hp}/{character.maxHp}</span></div>
        <div className="hp-bar"><div className="hp-fill hp-color" style={{ width: `${(character.hp / character.maxHp) * 100}%` }} /></div>
        <div className="hp-row"><span>💧 MP</span><span>{character.mp}/{character.maxMp}</span></div>
        <div className="hp-bar"><div className="hp-fill mp-color" style={{ width: `${(character.mp / character.maxMp) * 100}%` }} /></div>
      </div>

      <div className="timer-controls">
        <button className="btn btn-primary btn-big" onClick={running ? onPause : onResume}>
          {running ? '⏸️ หยุดพัก' : '▶️ โฟกัสต่อ'}
        </button>
        <button className="btn btn-danger" onClick={onAbort}>💨 ทิ้งเซสชัน</button>
      </div>

      <p className="hint">โฟกัสงานของคุณไปเรื่อย ๆ — ตัวละครจะจัดการมอนสเตอร์เอง!</p>

      {sessionEvents.length > 0 && (
        <div className="session-log">
          <div className="session-log-title">📜 เหตุการณ์ที่เจอใน session นี้ ({sessionEvents.length})</div>
          {sessionEvents.map((ev, i) => {
            const parts = [];
            if (ev.xp > 0) parts.push(`+${ev.xp} XP`);
            if (ev.gold > 0) parts.push(`+${ev.gold} ทอง`);
            if (ev.hpChange < 0) parts.push(`-${Math.abs(ev.hpChange)} HP`);
            if (ev.mpChange > 0) parts.push(`+${ev.mpChange} MP`);
            if (ev.item) parts.push(`${ev.item.icon} ${ev.item.name}`);
            return (
              <div key={i} className="session-log-item">
                <span className="session-log-event">{ev.title}</span>
                {parts.length > 0 && <span className="session-log-reward">{parts.join(' · ')}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
