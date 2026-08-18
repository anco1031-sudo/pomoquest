import { useEffect, useRef, useState } from 'react';
import { useGame } from '../context.jsx';
import { sfx, isMuted, setMuted } from '../sound.js';
import { fmtTime } from './ui.jsx';
import { petMoodOf, petPerkLabel } from '../meta.js';

// ชื่อพักยาวสำเร็จรูป (ตัวเลือกเร็ว — ชื่อสม่ำเสมอ เอาไปรวมสถิติแยกตามชื่อได้) · พิมพ์เองก็ได้ที่ช่องอื่น ๆ
const PAUSE_PRESETS = [
  { id: 'eat', icon: '🍚', label: 'กินข้าว', full: '🍚 กินข้าว' },
  { id: 'nap', icon: '😴', label: 'นอนกลางวัน', full: '😴 นอนกลางวัน' },
  { id: 'sleep', icon: '🌙', label: 'นอนกลางคืน', full: '🌙 นอนกลางคืน' },
  { id: 'errand', icon: '🛒', label: 'ธุระ/ซื้อของ', full: '🛒 ธุระ/ซื้อของ' },
  { id: 'exercise', icon: '🏃', label: 'ออกกำลังกาย', full: '🏃 ออกกำลังกาย' },
  { id: 'call', icon: '📞', label: 'รับสาย/ประชุม', full: '📞 รับสาย/ประชุม' },
  { id: 'outside', icon: '🚶', label: 'ออกไปข้างนอก', full: '🚶 ออกไปข้างนอก' },
  { id: 'housework', icon: '🧹', label: 'งานบ้าน', full: '🧹 งานบ้าน' },
  { id: 'rest', icon: '🛌', label: 'พักผ่อน/ไม่สบาย', full: '🛌 พักผ่อน/ไม่สบาย' },
  { id: 'other', icon: '🎲', label: 'ทำอย่างอื่น', full: '🎲 ทำอย่างอื่น' },
];

// เวลาสัมพัทธ์ (ms) — ใช้กับ `at` ที่เก็บตอน event เกิด
function fmtAgo(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'เมื่อกี้';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} นาทีที่แล้ว`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ชม.ที่แล้ว`;
  return new Date(ms).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}

export default function TimerScreen({ remain, total, running, sessionIdx, sessionsPerCycle, nextEventIn, onPause, onResume, onAbort, onHome, sessionEvents = [], focusTask = '', pausedSec = 0, pauseMode = null, pauseTitle = '', onEditTask = null }) {
  const { character, progress } = useGame();
  const logRef = useRef(null);
  const [muted, setMutedState] = useState(isMuted());
  const [showPauseChoice, setShowPauseChoice] = useState(false); // เลือก ⏸️ พักสั้น / 😴 พักยาว
  const [pauseGoHome, setPauseGoHome] = useState(false); // เลือกพักจากปุ่ม 🏠 กลับหน้าหลัก — หลังเลือกแล้วไปพักที่หน้า Home
  const [pauseTitleInput, setPauseTitleInput] = useState(''); // ชื่อ/เหตุผลพักยาว (input ใน modal — กัน window.prompt ค้างใน headless)
  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    setMutedState(m);
    localStorage.setItem('pomoquest-muted', m ? '1' : '0');
    sfx.click();
  };

  // เหตุการณ์ใหม่ → เลื่อนไปโชว์เหตุการณ์ล่าสุด (เรียงล่าสุดบนสุด)
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = 0;
  }, [sessionEvents.length]);

  if (!character) return null;
  const city = character.city;
  const pct = total > 0 ? (remain / total) * 100 : 0;
  // 🐾 สัตว์เลี้ยงที่ใช้งาน — ฟองข้างไอคอนเมือง (เหมือนฟองบน Home) + ป้าย 🥚 กำลังฟัก
  const activePet = (character.pets || []).find((p) => p.active) || null;
  const petMood = activePet ? petMoodOf(activePet, progress?.last_focus_date) : null;

  return (
    <div className="timer-screen">
      <div className="timer-city">
        <div className="timer-pet">
          <span className="city-icon">{city.icon}</span>
          {activePet ? (
            <div
              className={`companion-bubble pet-mood-${petMood.level}`}
              title={`🐾 ${activePet.name} (Lv.${activePet.level}) — ${activePet.desc}\n📈 ค่าพิเศษปัจจุบัน: ${petPerkLabel(activePet)}\n${petMood.msg}`}
            >
              {activePet.icon}
              <span className="pet-lv-tag">Lv.{activePet.level}</span>
              <span className="pet-mood-emoji">{petMood.msg.split(' ')[0]}</span>
            </div>
          ) : (
            <div className="companion-bubble" title="🐾 ยังไม่มีสัตว์เลี้ยง — หา 🥚 ไข่ปริศนาจากกล่องสมบัติ (หายาก ~2%) แล้วใช้ฟักดูสิ!">
              🥚
            </div>
          )}
          {/* ไข่กำลังฟัก (ใช้ไข่แล้ว — จะฟักหลังจบ 1 session) */}
          {character.hatchPending && (
            <div className="hatch-badge" title="🥚 ไข่ปริศนากำลังฟักอยู่ — จะฟักออกมาเป็นสัตว์เลี้ยงหลังจบ 1 session โฟกัส">
              🥚 กำลังฟัก…
            </div>
          )}
        </div>
        <div>
          <div className="timer-title">⚔️ ผจญภัยใน {city.name}</div>
          <div className="timer-sub">
            {city.terrain} · Lv.{character.level} {character.classIcon}
            {(character.cityRound || 0) > 0 && (
              <span className="explore-round-note" title={`ศัตรู/บอสแข็งขึ้น x${character.exploreMult} · รางวัล XP/ทอง x${character.exploreRewardMult}`}>
                🏠 รอบ {character.cityRound}
              </span>
            )}
          </div>
        </div>
        <button className="icon-btn" onClick={toggleMute} title={muted ? 'เปิดเสียง' : 'ปิดเสียง'}>
          {muted ? '🔇' : '🔊'}
        </button>
      </div>

      <div className="timer-ring" style={{ '--pct': pct }}>
        <div className="timer-time">{fmtTime(remain)}</div>
        <div className="timer-label">
          {running
            ? 'กำลังโฟกัส…'
            : pauseMode === 'long'
              ? `😴 พักยาว${pauseTitle ? ` (${pauseTitle})` : ''} · ไม่อยู่ ${fmtTime(pausedSec)}`
              : `⏸️ พักชั่วคราว · พักไปแล้ว ${fmtTime(pausedSec)}`}
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
        <button className="btn btn-primary btn-big" onClick={running ? () => { setPauseGoHome(false); setPauseTitleInput(''); setShowPauseChoice(true); } : onResume}>
          {running ? '⏸️ หยุดพัก' : '▶️ โฟกัสต่อ'}
        </button>
        {/* ตอนพัก — ปุ่มทิ้ง session อยู่ข้างๆ โฟกัสต่อ เห็นชัด (เหมือนแถบโฟกัสต่อที่หน้าหลัก) */}
        {!running && (
          <button className="btn btn-danger" onClick={onAbort} title="ทิ้งเซสชันนี้ (คอมโบโฟกัสจะหายไป)">💨 ทิ้ง session</button>
        )}
        <button className="btn" onClick={() => { setPauseGoHome(true); setPauseTitleInput(''); setShowPauseChoice(true); }}>🏠 กลับหน้าหลัก (พักไว้)</button>
        {running && (
          <button className="btn btn-danger" onClick={onAbort}>💨 ทิ้งเซสชัน</button>
        )}
      </div>

      {!running && (
        <p className="hint">
          {pauseMode === 'long'
            ? '😴 พักยาว — เวลาพักนี้แยกหมวดในสถิติ "พักยาว" (ไม่ปนกับพักกลาง session) · กดโฟกัสต่อเมื่อพร้อม (ไม่สะสม XP ระหว่างพัก)'
            : '⏸️ เวลาพักกลาง session ถูกนับแยกต่างหาก — กดโฟกัสต่อเมื่อพร้อม (ไม่สะสม XP ระหว่างพัก)'}
        </p>
      )}
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

      {/* เลือก ⏸️ พักสั้น / 😴 พักยาว — เวลางานหยุดทั้งคู่ (🏠 กลับหน้าหลักก็เปิดตัวเลือกนี้เหมือนกัน) */}
      {showPauseChoice && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>⏸️ พักแบบไหน?</h2>
            <p>เวลางานจะหยุดทั้งคู่ — ต่างกันที่หมวดสถิติ: พักสั้น = "พักกลาง session" · พักยาว = แยกหมวด "พักยาว"</p>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => { setShowPauseChoice(false); onPause('short'); if (pauseGoHome) onHome(); }}>
                ⏸️ พักสั้น (นับเวลา)
              </button>
              <button className="btn" onClick={() => { setShowPauseChoice(false); onPause('long', pauseTitleInput.trim()); if (pauseGoHome) onHome(); }}>
                😴 พักยาว (แยกหมวดสถิติ)
              </button>
            </div>
            <div className="pause-presets">
              {PAUSE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`pause-preset-chip${pauseTitleInput === p.full ? ' active' : ''}`}
                  onClick={() => setPauseTitleInput(p.full)}
                >
                  {p.icon} {p.label}
                </button>
              ))}
            </div>
            <label className="pause-title-label">
              😴 ชื่อพักยาว (เลือกด้านบน หรือพิมพ์เอง — ดูย้อนหลังใน log + รวมสถิติตามชื่อ):
              <input
                className="input pause-title-input"
                value={pauseTitleInput}
                onChange={(e) => setPauseTitleInput(e.target.value)}
                placeholder="พิมพ์ชื่อพักเอง…"
                maxLength={40}
              />
            </label>
            <p className="hint">พักสั้น = เข้าห้องน้ำ/รับสาย · พักยาว = นอน/ทานข้าว/ธุระยาว (ตั้งชื่อได้)</p>
            <div className="modal-actions">
              <button className="btn btn-sm" onClick={() => setShowPauseChoice(false)}>ยกเลิก</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
