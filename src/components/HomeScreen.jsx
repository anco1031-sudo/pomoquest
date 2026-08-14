import { useState } from 'react';
import { useGame } from '../context.jsx';
import { sfx, setMuted, isMuted } from '../sound.js';
import { Bar, Panel, fmtDuration } from './ui.jsx';
import CharacterSheet from './CharacterSheet.jsx';
import AdventureLog from './AdventureLog.jsx';
import AchievementList from './AchievementList.jsx';
import StatsScreen from './StatsScreen.jsx';
import DailyQuests from './DailyQuests.jsx';

const TABS = [
  { key: 'home', label: 'สรุป', icon: '🏠' },
  { key: 'sheet', label: 'ตัวละคร', icon: '🛡️' },
  { key: 'log', label: 'บันทึก', icon: '📜' },
  { key: 'achieve', label: 'ตรา', icon: '🏅' },
  { key: 'stats', label: 'สถิติ', icon: '📊' },
  { key: 'settings', label: 'ตั้งค่า', icon: '⚙️' },
];

export default function HomeScreen({ onStart, onManageCharacters }) {
  const { character, progress, settings, achievements, put, refresh, showToast, post, cities } = useGame();
  const [tab, setTab] = useState('home');
  const [muted, setMutedState] = useState(isMuted());

  if (!character) return null;
  const city = character.city;
  const xpPct = Math.min(100, (character.xp / character.xpToNext) * 100);

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    setMutedState(m);
    localStorage.setItem('pomoquest-muted', m ? '1' : '0');
  };


  const saveSettings = async (patch) => {
    const d = await put('/settings', patch);
    if (d) showToast('บันทึกการตั้งค่าแล้ว');
  };

  return (
    <div className="screen">
      <header className="topbar">
        <div className="logo">🍅⚔️ PomoQuest</div>
        <div className="topbar-right">
          <span className="gold-chip">💰 {character.gold}</span>
          <button className="icon-btn" onClick={onManageCharacters} title="จัดการตัวละคร">👥</button>
          <button className="icon-btn" onClick={toggleMute} title={muted ? 'เปิดเสียง' : 'ปิดเสียง'}>
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
      </header>

      <main className="content">
        {/* ---- hero card ---- */}
        <div className="hero-card">
          <div className="hero-top">
            <div className="hero-avatar">{character.classIcon}</div>
            <div className="hero-info">
              <div className="hero-name">{character.name}</div>
              <div className="hero-class">
                {character.className} <span className="en">{character.classEn}</span> · Lv.{character.level}
              </div>
            </div>
            <div className="hero-city">
              📍 {city.icon} {city.name}
            </div>
          </div>
          <Bar value={character.xp} max={character.xpToNext} color="linear-gradient(90deg,#8b5cf6,#f5b942)" label={`XP ${character.xp} / ${character.xpToNext}`} />
          <div className="hero-stats">
            <span className="chip hp">❤️ {character.hp}/{character.maxHp}</span>
            <span className="chip mp">💧 {character.mp}/{character.maxMp}</span>
            <span className="chip">⚔️ {character.atk}</span>
            <span className="chip">🛡️ {character.def}</span>
            <span className="chip">👟 {character.spd}</span>
            <span className="chip">🎯 {character.crit}%</span>
          </div>
        </div>

        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => { setTab(t.key); sfx.click(); }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {tab === 'home' && (
          <>
            <DailyQuests />

            <Panel title={`🗺️ ${city.name} — ${city.terrain}`}>
              <p className="panel-text">
                เมืองนี้ยังมีเรื่องราวรอคุณอยู่… กดเริ่มผจญภัยเพื่อโฟกัสงาน แล้วตัวละครของคุณจะออกเดินทาง!
              </p>
              <button className="btn btn-primary btn-big" onClick={onStart}>
                ⚔️ เริ่มผจญภัย (โฟกัส {settings.work_min} นาที)
              </button>
            </Panel>

            <Panel title="🗺️ เดินทาง (ย้อนกลับ)">
              <p className="panel-text">
                ย้อนกลับไปเมืองที่เคยไปมาแล้ว — ค่าเดินทาง 20 ทอง/เมือง (บอสของเมืองนั้นจะ scale ตามเลเวลคุณ)
              </p>
              <div className="travel-list">
                {(cities || [])
                  .filter((c) => c.index <= character.cityIndex)
                  .map((c) => {
                    const dist = character.cityIndex - c.index;
                    const cost = dist * 20;
                    const here = dist === 0;
                    return (
                      <div className={`travel-city ${here ? 'current' : ''}`} key={c.index}>
                        <span className="city-ico">{c.icon}</span>
                        <div className="city-info">
                          <div className="city-name">
                            {c.name}
                            {here && <span className="chip">📍 อยู่ที่นี่</span>}
                          </div>
                          <div className="city-sub">
                            {c.terrain}
                            {!here && ` · ระยะ ${dist} เมือง`}
                          </div>
                        </div>
                        {!here && (
                          <button
                            className="btn"
                            disabled={character.gold < cost}
                            onClick={() => post('/travel', { cityIndex: c.index })}
                          >
                            {character.gold < cost ? `💰 ไม่พอ (${cost})` : `🚶 ${cost} ทอง`}
                          </button>
                        )}
                      </div>
                    );
                  })}
              </div>
            </Panel>

            <Panel title="📊 สถิติการผจญภัย">
              <div className="stat-grid">
                <div className="stat-box"><b>{progress?.sessions_completed || 0}</b><span>session ที่ผ่าน</span></div>
                <div className="stat-box"><b>{progress?.cycles_completed || 0}</b><span>รอบที่ครบ 4</span></div>
                <div className="stat-box"><b>{progress?.bosses_defeated || 0}</b><span>บอสที่ชนะ</span></div>
                <div className="stat-box"><b>{progress?.monsters_slain || 0}</b><span>มอนสเตอร์</span></div>
                <div className="stat-box"><b>{progress?.treasures_found || 0}</b><span>สมบัติ</span></div>
                <div className="stat-box"><b>{fmtDuration(progress?.total_focus_sec || 0)}</b><span>เวลาที่โฟกัส</span></div>
                <div className="stat-box"><b>{progress?.gold_earned || 0}</b><span>ทองที่หามาได้</span></div>
                <div className="stat-box"><b>{progress?.best_streak || 0}</b><span>คอมโบสูงสุด</span></div>
                <div className="stat-box"><b>{achievements?.unlocked || 0}/{achievements?.total || 25}</b><span>ตรา</span></div>
                <div className="stat-box"><b>{progress?.quests_completed || 0}</b><span>ภารกิจสำเร็จ</span></div>
              </div>
            </Panel>

            <AdventureLog limit={10} />
          </>
        )}

        {tab === 'sheet' && <CharacterSheet />}
        {tab === 'log' && <AdventureLog limit={50} />}
        {tab === 'achieve' && <AchievementList />}
        {tab === 'stats' && <StatsScreen />}

        {tab === 'settings' && (
          <div className="panel">
            <div className="panel-title">⚙️ ตั้งค่า Pomodoro</div>
            {[
              { key: 'work_min', label: '⏱️ ระยะเวลา work (นาที)', min: 1, max: 90, val: settings.work_min },
              { key: 'short_break_min', label: '☕ พักสั้น (นาที)', min: 1, max: 30, val: settings.short_break_min },
              { key: 'long_break_min', label: '🏕️ พักยาว (นาที)', min: 1, max: 60, val: settings.long_break_min },
              { key: 'sessions_per_cycle', label: '🔁 sessions ต่อรอบ (ก่อนสู้บอส)', min: 1, max: 8, val: settings.sessions_per_cycle },
              { key: 'event_every_sec', label: '🎲 เหตุการณ์ทุก (วินาที)', min: 30, max: 600, val: settings.event_every_sec },
            ].map((s) => (
              <div className="setting-row" key={s.key}>
                <label>{s.label}</label>
                <input
                  type="number"
                  min={s.min}
                  max={s.max}
                  value={s.val}
                  onChange={(e) => saveSettings({ [s.key]: Number(e.target.value) })}
                />
              </div>
            ))}
            <div className="setting-row">
              <label>🔊 เสียง</label>
              <button className="btn" onClick={toggleMute}>{muted ? 'ปิดอยู่' : 'เปิดอยู่'}</button>
            </div>
            <p className="hint">💡 บนมือถือ กด "Add to Home Screen" เพื่อติดตั้ง PomoQuest เป็นแอพ!</p>
            <button className="btn" onClick={onManageCharacters}>👥 จัดการตัวละคร (เลือก / สร้าง / เปลี่ยนชื่อ / ลบ)</button>
          </div>
        )}
      </main>
    </div>
  );
}
