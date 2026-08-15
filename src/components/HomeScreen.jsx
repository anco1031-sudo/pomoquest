import { useRef, useState } from 'react';
import { useGame } from '../context.jsx';
import { sfx, setMuted, isMuted } from '../sound.js';
import { isNotifyEnabled, setNotifyEnabled, requestNotifyPermission } from '../notify.js';
import { Bar, Panel, fmtDuration, fmtTime } from './ui.jsx';
import CharacterSheet from './CharacterSheet.jsx';
import AdventureLog from './AdventureLog.jsx';
import AchievementList from './AchievementList.jsx';
import StatsScreen from './StatsScreen.jsx';
import SessionHistory from './SessionHistory.jsx';
import DailyQuests from './DailyQuests.jsx';
import DevPanel from './DevPanel.jsx';

const TABS = [
  { key: 'home', label: 'สรุป', icon: '🏠' },
  { key: 'sheet', label: 'ตัวละคร', icon: '🛡️' },
  { key: 'log', label: 'บันทึก', icon: '📜' },
  { key: 'sessions', label: 'Session', icon: '📅' },
  { key: 'achieve', label: 'ตรา', icon: '🏅' },
  { key: 'stats', label: 'สถิติ', icon: '📊' },
  { key: 'settings', label: 'ตั้งค่า', icon: '⚙️' },
];

export default function HomeScreen({ onStart, onContinue = null, pausedRemain = 0, hasPausedSession = false, onManageCharacters }) {
  const { character, progress, settings, achievements, put, refresh, showToast, post, cities } = useGame();
  const [tab, setTab] = useState('home');
  const [muted, setMutedState] = useState(isMuted());
  const [showDev, setShowDev] = useState(false);
  const [showImportNote, setShowImportNote] = useState(false); // modal แจ้งรีสตาร์ทหลัง import
  const [notifyOn, setNotifyOn] = useState(isNotifyEnabled());
  const [notifyPerm, setNotifyPerm] = useState(() => {
    try {
      return typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
    } catch {
      return 'unsupported';
    }
  });
  const fileRef = useRef(null);

  if (!character) return null;
  const city = character.city;
  const xpPct = Math.min(100, (character.xp / character.xpToNext) * 100);

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    setMutedState(m);
    localStorage.setItem('pomoquest-muted', m ? '1' : '0');
  };

  const toggleNotify = async () => {
    const next = !notifyOn;
    setNotifyOn(next);
    setNotifyEnabled(next);
    if (next) {
      const granted = await requestNotifyPermission();
      setNotifyPerm(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
      showToast(granted ? '🔔 เปิดแจ้งเตือนแล้ว' : '⚠️ ไม่ได้รับอนุญาต — เปิดในตั้งค่าเบราว์เซอร์');
    } else {
      showToast('🔕 ปิดแจ้งเตือนแล้ว');
    }
  };


  const saveSettings = async (patch) => {
    const d = await put('/settings', patch);
    if (d) showToast('บันทึกการตั้งค่าแล้ว');
  };

  // ---- ข้อมูล: export / import / reset ----
  const downloadFile = async (path, filename) => {
    const res = await fetch(path);
    if (!res.ok) throw new Error('export ไม่สำเร็จ');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExport = async () => {
    try {
      const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      await downloadFile('/api/backup', `pomoquest-backup-${ts}.db`);
      showToast('📤 ดาวน์โหลด backup (.db) แล้ว');
    } catch (e) {
      showToast(e.message);
    }
  };

  const handleExportJson = async () => {
    try {
      const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      await downloadFile('/api/export', `pomoquest-backup-${ts}.json.gz`);
      showToast('📤 ดาวน์โหลด backup (JSON) แล้ว');
    } catch (e) {
      showToast(e.message);
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // เลือกไฟล์เดิมซ้ำได้
    if (!file) return;
    if (!window.confirm('แทนที่ข้อมูลปัจจุบันด้วยไฟล์ backup นี้? ข้อมูลที่ไม่ได้ backup จะหาย (แนะนำให้ Export ก่อน)')) return;
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch('/api/restore', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buf });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(d.error || 'import ไม่สำเร็จ'); return; }
      if (d.restart) {
        setShowImportNote(true); // ไฟล์ .db → ต้องรีสตาร์ท server
      } else {
        showToast(d.message || 'กู้คืนข้อมูลแล้ว');
        refresh(); // JSON → มีผลทันที
      }
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('⚠️ ล้างข้อมูลเกมทั้งหมด (ตัวละคร/ไอเทม/ประวัติ session)? กู้คืนไม่ได้!')) return;
    const d = await post('/reset');
    if (d) {
      showToast(d.message || 'ล้างข้อมูลแล้ว');
      refresh();
    }
  };

  return (
    <div className="screen">
      <header className="topbar">
        <div className="logo">🍅⚔️ PomoQuest</div>
        <div className="topbar-right">
          <span className="gold-chip">💰 {character.gold}</span>
          <button className="icon-btn" onClick={() => setShowDev(true)} title="Dev Test Panel">🧪</button>
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
              {hasPausedSession && onContinue && (
                <>
                  <p className="paused-note">⏸️ มี session ที่พักไว้อยู่ — กดต่อเพื่อกลับไปโฟกัสต่อ</p>
                  <button className="btn btn-continue btn-big" onClick={onContinue}>
                    ▶️ ต่อ session ต่อ (เหลือ {fmtTime(pausedRemain)})
                  </button>
                </>
              )}
              <button className="btn btn-primary btn-big" onClick={onStart} style={hasPausedSession ? { marginTop: 10 } : undefined}>
                {hasPausedSession ? '🔄 เริ่ม session ใหม่ (ทิ้ง session ที่พักไว้)' : '⚔️ เริ่มผจญภัย (โฟกัส ' + settings.work_min + ' นาที)'}
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
        {tab === 'sessions' && <SessionHistory />}
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
            <div className="setting-row">
              <label>🔔 แจ้งเตือนเบราว์เซอร์</label>
              <button className="btn" onClick={toggleNotify}>{notifyOn ? 'เปิดอยู่' : 'ปิดอยู่'}</button>
            </div>
            {notifyOn && notifyPerm === 'denied' && (
              <p className="hint">⚠️ ถูกบล็อกในเบราว์เซอร์ — เปิด Notifications ที่ตั้งค่าเว็บไซต์ แล้วกลับมาลองใหม่</p>
            )}
            {notifyOn && notifyPerm === 'default' && (
              <p className="hint">🔔 จะขออนุญาตตอนเริ่มโฟกัสครั้งแรก (หรือกดเปิดเพื่อขอเลย)</p>
            )}
            {notifyOn && notifyPerm === 'unsupported' && (
              <p className="hint">ℹ️ เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน (ต้อง https หรือ localhost)</p>
            )}
            <p className="hint">💡 บนมือถือ กด "Add to Home Screen" เพื่อติดตั้ง PomoQuest เป็นแอพ!</p>
            <button className="btn" onClick={onManageCharacters}>👥 จัดการตัวละคร (เลือก / สร้าง / เปลี่ยนชื่อ / ลบ)</button>
          </div>
        )}

        {tab === 'settings' && (
          <div className="panel">
            <div className="panel-title">💾 ข้อมูล (Export / Import / Reset)</div>
            <div className="setting-row">
              <label>📤 Export (.db)</label>
              <button className="btn" onClick={handleExport}>ดาวน์โหลด backup</button>
            </div>
            <div className="setting-row">
              <label>📤 Export (JSON)</label>
              <button className="btn" onClick={handleExportJson}>ดาวน์โหลด .json.gz</button>
            </div>
            <div className="setting-row">
              <label>📥 Import</label>
              <button className="btn" onClick={() => fileRef.current?.click()}>อัปโหลดไฟล์ (.db / .json.gz)</button>
              <input ref={fileRef} type="file" accept=".db,.json.gz,.gz,application/octet-stream,application/gzip" hidden onChange={handleImport} />
            </div>
            <div className="setting-row">
              <label>🗑️ Reset</label>
              <button className="btn btn-danger" onClick={handleReset}>ล้างข้อมูลทั้งหมด</button>
            </div>
            <p className="hint">💡 <b>.db</b> = ไฟล์เดียวกับ <code>./run.sh backup</code> (import แล้วต้องรีสตาร์ท server) · <b>.json.gz</b> = อ่าน/แก้ด้วยมือได้ ไฟล์เล็ก (บีบอัด gzip) import แล้วมีผลทันที — รองรับทั้ง 2 แบบ</p>
          </div>
        )}
      </main>

      {showDev && <DevPanel onClose={() => setShowDev(false)} />}

      {/* หลัง import สำเร็จ — ต้องรีสตาร์ท server ถึงจะเห็นข้อมูลใหม่ */}
      {showImportNote && (
        <div className="modal-backdrop" onClick={() => setShowImportNote(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>📥 กู้คืนข้อมูลแล้ว</h2>
            <p>
              ไฟล์ backup ถูกแทนที่ลงในฐานข้อมูลแล้ว — แต่ server ยังถือข้อมูลเก่าอยู่ในหน่วยความจำ
              <br />
              <b>กรุณารีสตาร์ท server</b> เพื่อให้ข้อมูลใหม่มีผล:
            </p>
            <pre className="code-block">./run.sh stop && ./run.sh start</pre>
            <p className="hint">(หรือ Ctrl+C แล้วรันใหม่ — หลังรีสตาร์ทแล้วเปิดหน้านี้อีกครั้ง)</p>
            <button className="btn btn-primary btn-big" onClick={() => setShowImportNote(false)}>รับทราบ</button>
          </div>
        </div>
      )}
    </div>
  );
}
