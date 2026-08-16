import { useEffect, useRef } from 'react';
import { useGame } from '../context.jsx';
import { fmtTime } from './ui.jsx';

// เวลาสัมพัทธ์ (ms) — ใช้กับ `at` ที่เก็บตอน event เกิด
function fmtAgo(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'เมื่อกี้';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} นาทีที่แล้ว`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ชม.ที่แล้ว`;
  return new Date(ms).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}

export default function TimerScreen({ remain, total, running, sessionIdx, sessionsPerCycle, nextEventIn, onPause, onResume, onAbort, onHome, sessionEvents = [], focusTask = '', pausedSec = 0, onEditTask = null }) {
  const { character, progress } = useGame();
  const logRef = useRef(null);

  // เหตุการณ์ใหม่ → เลื่อนไปโชว์เหตุการณ์ล่าสุด (เรียงล่าสุดบนสุด)
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = 0;
  }, [sessionEvents.length]);

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
        <div className="timer-label">
          {running ? 'กำลังโฟกัส…' : `⏸️ พักชั่วคราว · พักไปแล้ว ${fmtTime(pausedSec)}`}
        </div>
      </div>

      <div className="session-dots">
        {Array.from({ length: sessionsPerCycle }).map((_, i) => (
          <div key={i} className={`dot ${i + 1 < sessionIdx ? 'done' : i + 1 === sessionIdx ? 'current' : ''}`}>
            {i + 1}
          </div>
        ))}
        <span className="session-text">session {sessionIdx}/{sessionsPerCycle}</span>
      </div>

      <div className="timer-chip-row">
        <div className="event-chip">🎲 เหตุการณ์ถัดไปใน {fmtTime(nextEventIn)}</div>
        {progress?.combo_shield > 0 && (
          <span
            className="shield-badge shield-chip"
            title="🛡️ โล่โฟกัสติดตั้งอยู่ — พัก/ทิ้ง session ครั้งถัดไป คอมโบจะไม่หาย (โล่จะแตก)"
          >
            🛡️ โล่โฟกัส
          </span>
        )}
      </div>
      {focusTask && (
        <div className="focus-task-chip">
          📋 โฟกัส: {focusTask}
          {onEditTask && (
            <button className="task-edit-btn" onClick={onEditTask} title="แก้ไขชื่องานนี้">✏️</button>
          )}
        </div>
      )}

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
        {/* ตอนพัก — ปุ่มทิ้ง session อยู่ข้างๆ โฟกัสต่อ เห็นชัด (เหมือนแถบโฟกัสต่อที่หน้าหลัก) */}
        {!running && (
          <button className="btn btn-danger" onClick={onAbort} title="ทิ้งเซสชันนี้ (คอมโบโฟกัสจะหายไป)">💨 ทิ้ง session</button>
        )}
        <button className="btn" onClick={onHome}>🏠 กลับหน้าหลัก (พักไว้)</button>
        {running && (
          <button className="btn btn-danger" onClick={onAbort}>💨 ทิ้งเซสชัน</button>
        )}
      </div>

      {!running && <p className="hint">⏸️ เวลาพักกลาง session ถูกนับแยกต่างหาก — กดโฟกัสต่อเมื่อพร้อม (ไม่สะสม XP ระหว่างพัก)</p>}
      <p className="hint">โฟกัสงานของคุณไปเรื่อย ๆ — ตัวละครจะจัดการมอนสเตอร์เอง!</p>

      {sessionEvents.length > 0 && (
        <div className="session-log" ref={logRef}>
          <div className="session-log-title">📜 เหตุการณ์ที่เจอใน session นี้ ({sessionEvents.length})</div>
          {[...sessionEvents].reverse().map((ev, i) => {
            const parts = [];
            if (ev.xp > 0) parts.push(`+${ev.xp} XP`);
            if (ev.gold > 0) parts.push(`+${ev.gold} ทอง`);
            if (ev.hpChange < 0) parts.push(`-${Math.abs(ev.hpChange)} HP`);
            if (ev.mpChange > 0) parts.push(`+${ev.mpChange} MP`);
            if (ev.item) parts.push(`${ev.item.icon} ${ev.item.name}`);
            return (
              <div key={i} className="session-log-item">
                <div className="session-log-head">
                  <span className="session-log-event">{ev.title} <span className="session-log-time">{fmtAgo(ev.at)}</span></span>
                  {parts.length > 0 && <span className="session-log-reward">{parts.join(' · ')}</span>}
                </div>
                {ev.detail && <div className="session-log-detail">{ev.detail}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
