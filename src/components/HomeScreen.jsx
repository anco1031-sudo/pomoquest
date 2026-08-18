import { useEffect, useRef, useState } from 'react';
import { useGame } from '../context.jsx';
import { sfx, setMuted, isMuted } from '../sound.js';
import { isNotifyEnabled, setNotifyEnabled, requestNotifyPermission } from '../notify.js';
import { Bar, Panel, fmtTime } from './ui.jsx';
import CharacterSheet from './CharacterSheet.jsx';
import AdventureLog from './AdventureLog.jsx';
import AchievementList from './AchievementList.jsx';
import StatsScreen from './StatsScreen.jsx';
import SessionHistory from './SessionHistory.jsx';
import DailyQuests from './DailyQuests.jsx';
import StoryQuests from './StoryQuests.jsx';
import ChallengeTab from './ChallengeTab.jsx';
import HomeQuickCards from './HomeQuickCards.jsx';
import DevPanel from './DevPanel.jsx';
import { rankOf, moraleOf, petMoodOf, petPerkLabel } from '../meta.js';

const TABS = [
  { key: 'home', label: 'สรุป', icon: '🏠' },
  { key: 'story', label: 'เนื้อเรื่อง', icon: '📖' },
  { key: 'challenge', label: 'ชาเลนจ์', icon: '🔥' },
  { key: 'sheet', label: 'ตัวละคร', icon: '🛡️' },
  { key: 'log', label: 'บันทึก', icon: '📜' },
  { key: 'sessions', label: 'Session', icon: '📅' },
  { key: 'achieve', label: 'ตรา', icon: '🏅' },
  { key: 'stats', label: 'สถิติ', icon: '📊' },
  { key: 'settings', label: 'ตั้งค่า', icon: '⚙️' },
];

export default function HomeScreen({ onStart, onContinue = null, pausedRemain = 0, hasPausedSession = false, pausedSec = 0, pauseMode = null, pauseTitle = '', pausedTask = '', onDiscard = null, onLongPause = null, onManageCharacters, breakAtHome = false, breakRemain = 0, breakOver = false, onBreakBack = null }) {
  const { character, progress, settings, put, refresh, showToast, post } = useGame();
  const [tab, setTab] = useState('home');
  const [muted, setMutedState] = useState(isMuted());
  const [showDev, setShowDev] = useState(false);
  const [showImportNote, setShowImportNote] = useState(false); // modal แจ้งรีสตาร์ทหลัง import
  const [showChallenge, setShowChallenge] = useState(false); // modal เปลี่ยนโหมดท้าทาย
  // วิธีเล่น — โชว์เฉพาะตอนเริ่มเกมใหม่จริง ๆ (สร้างตัวละครแรกจากลิสต์ว่าง / หลัง reset) — กดปิดแล้วไม่โผล่อีกจนกว่าจะเริ่มใหม่
  const [showOnboard, setShowOnboard] = useState(() => {
    const pending = localStorage.getItem('pomoquest-onboarded-pending') === '1';
    if (pending) localStorage.removeItem('pomoquest-onboarded-pending');
    return pending;
  });
  const [notifyOn, setNotifyOn] = useState(isNotifyEnabled());
  const [notifyPerm, setNotifyPerm] = useState(() => {
    try {
      return typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
    } catch {
      return 'unsupported';
    }
  });
  const fileRef = useRef(null);
  const [focusTask, setFocusTask] = useState(''); // ชื่องานที่จะโฟกัส session ถัดไป
  const heroRef = useRef(null);
  const [barCollapsed, setBarCollapsed] = useState(false); // เลื่อนผ่าน hero card → แถบโฟกัสต่อย่อเหลือแค่ปุ่ม (ประหยัดพื้นที่)

  // เลื่อนหน้าผ่าน hero card → ย่อแถบโฟกัสต่อ
  useEffect(() => {
    const onScroll = () => {
      const hero = heroRef.current;
      if (!hero) return;
      setBarCollapsed(hero.getBoundingClientRect().bottom < 0);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!character) return null;
  const city = character.city;
  const xpPct = Math.min(100, (character.xp / character.xpToNext) * 100);
  const rank = rankOf(progress?.total_focus_sec || 0);
  const morale = moraleOf(progress?.last_focus_date);
  // สัตว์เลี้ยง — ตัวที่ active เท่านั้นที่มีค่าพิเศษ · ฟองอารมณ์ตามวันไม่ได้โฟกัส (เหมือนขวัญกำลังใจ)
  const activePet = (character.pets || []).find((p) => p.active) || null;
  const petMood = activePet ? petMoodOf(activePet, progress?.last_focus_date) : null;

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
      // ล้าง session ที่พักค้างไว้ (timer ใน localStorage) + ชาเลนจ์รายสัปดาห์ — เริ่มใหม่แบบสะอาด ไม่มีของค้าง
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('pomoquest-timer-') || k.startsWith('pomoquest-challenge-')) localStorage.removeItem(k);
      }
      localStorage.removeItem('pomoquest-onboarded-pending'); // ล้าง flag วิธีเล่น — เริ่มเกมใหม่ (สร้างตัวแรก) จะได้เห็น modal อีกครั้ง
      // server โชว์ toast ยืนยันเองผ่าน d.message (post → apply) — ไม่ต้องโชว์ซ้ำ
      refresh();
    }
  };

  return (
    <div className="screen">
      {/* topbar + แถบโฟกัสต่อ — ติดคู่กันบนสุดตลอดเวลา (sticky) */}
      <div className="sticky-top">
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

        {/* ---- แถบกลับไปโฟกัสต่อ — โชว์บนสุดทุกแท็บเมื่อมี session พักไว้ (กดกลับหน้าหลักกลาง session) ---- */}
        {hasPausedSession && onContinue && (
          <div className={`resume-bar${barCollapsed ? ' collapsed' : ''}`}>
            <div className="resume-info">
              <span className="resume-icon">{pauseMode === 'long' ? '😴' : '⏸️'}</span>
              <span>
                มี session พักไว้อยู่{pausedTask && <> · 📋 <b className="resume-task">{pausedTask}</b></>} — เหลือ <b>{fmtTime(pausedRemain)}</b>
                {pauseMode === 'long'
                  ? <> · 😴 พักยาว{pauseTitle ? <> · <b>{pauseTitle}</b></> : ''}</>
                  : pausedSec > 0 && <> · พักไปแล้ว <b>{fmtTime(pausedSec)}</b></>}
              </span>
            </div>
            <div className="resume-actions">
              {/* ทางลัด: พักสั้นที่ค้างอยู่ → กด 😴 พักยาว ได้ตรง ๆ ที่หน้า Home (ไม่ต้องกลับไปเปิด modal เลือก) */}
              {onLongPause && pauseMode !== 'long' && (
                <button
                  className="btn btn-sm"
                  onClick={onLongPause}
                  title={'เปลี่ยนเป็นพักยาว 😴 — แยกหมวดสถิติ "พักยาว" (ต้องเลือกเหตุผลจากตัวเลือกก่อน)'}
                >
                  😴 พักยาว
                </button>
              )}
              {onDiscard && (
                <button
                  className="btn btn-sm btn-danger-soft"
                  onClick={onDiscard}
                  title="ทิ้ง session ที่พักไว้ (คอมโบโฟกัสจะหายไป)"
                >
                  💨 ทิ้ง session
                </button>
              )}
              <button className="btn btn-primary btn-resume" onClick={onContinue} title="กลับไปโฟกัส session ที่พักไว้">
                ▶️ โฟกัสต่อ
              </button>
            </div>
          </div>
        )}

        {/* ---- แถบพักเบรกค้างที่หน้าหลัก — กดกลับหน้าหลักจากหน้า camp: timer ยังนับต่อ จบเวลายังถามเหมือนเดิม ---- */}
        {breakAtHome && onBreakBack && (
          <div className={`resume-bar${barCollapsed ? ' collapsed' : ''}`}>
            <div className="resume-info">
              <span className="resume-icon">⛺</span>
              <span>
                {breakOver ? (
                  <>⏰ พักหมดเวลาแล้ว — กดกลับไปค่ายเพื่อเริ่มโฟกัสเมื่อพร้อม (เวลายังนับต่อ)</>
                ) : (
                  <>กำลังพักเบรกอยู่ — เหลือ <b>{fmtTime(breakRemain)}</b> (เวลายังนับต่อ)</>
                )}
              </span>
            </div>
            <div className="resume-actions">
              <button className="btn btn-primary btn-resume" onClick={onBreakBack} title="กลับไปค่ายพัก — เวลาพักยังนับต่อ">
                ⛺ กลับไปค่าย
              </button>
            </div>
          </div>
        )}
      </div>

      <main className="content">
        {/* ---- hero card ---- */}
        <div className="hero-card" ref={heroRef}>
          <div className="hero-top">
            <div className="hero-avatar">
              {character.classIcon}
              {activePet && (
                <div
                  className={`companion-bubble pet-mood-${petMood.level}`}
                  title={`🐾 ${activePet.name} (Lv.${activePet.level}) — ${activePet.desc}\n📈 ค่าพิเศษปัจจุบัน: ${petPerkLabel(activePet)}\n${petMood.msg}`}
                >
                  {activePet.icon}
                  <span className="pet-lv-tag">Lv.{activePet.level}</span>
                  <span className="pet-mood-emoji">{petMood.msg.split(' ')[0]}</span>
                </div>
              )}
              {/* ไข่กำลังฟัก (ใช้ไข่แล้ว — จะฟักหลังจบ 1 session) */}
              {character.hatchPending && (
                <div className="hatch-badge" title="🥚 ไข่ปริศนากำลังฟักอยู่ — จะฟักออกมาเป็นสัตว์เลี้ยงหลังจบ 1 session โฟกัส">
                  🥚 กำลังฟัก…
                </div>
              )}
            </div>
            <div className="hero-info">
              <div className="hero-name">{character.name}</div>
              <div className="hero-class">
                {character.className} <span className="en">{character.classEn}</span> · Lv.{character.level}
                {character.challengeMode === 'hard' && <span className="challenge-badge">⚔️ โหมดโหด</span>}
                {character.challengeMode === 'marathon' && <span className="challenge-badge">⏱️ มาราธอน</span>}
                {character.challengeMode === 'survival' && <span className="challenge-badge">🩸 เอาชีวิตรอด</span>}
                <button className="btn btn-sm challenge-switch" onClick={() => { setShowChallenge(true); sfx.click(); }} title="เปลี่ยนโหมดท้าทาย (เสียค่าปรับ)">
                  🔄 เปลี่ยนโหมด
                </button>
              </div>
              <div className="hero-meta">
                <span className="rank-badge" title={`ยศตามเวลาโฟกัสสะสม (${rank.min} นาที)${rank.nextIn > 0 ? ` — อีก ${rank.nextIn} นาทีถึง ${rank.nextIcon} ${rank.nextName}` : ' — ยศสูงสุดแล้ว!'}`}>
                  {rank.icon} {rank.name}
                </span>
                <span className={`morale-badge ml${morale.level}`} title={morale.msg}>
                  {morale.icon} {morale.label}
                </span>
                {progress?.combo_shield > 0 && (
                  <span className="shield-badge" title="🛡️ โล่โฟกัสติดตั้งอยู่ — พัก/ทิ้ง session ครั้งถัดไป คอมโบจะไม่หาย (โล่จะแตก)">🛡️ โล่โฟกัส</span>
                )}
              </div>
            </div>
            <div className="hero-city">
              <span>📍 {city.icon} {city.name}</span>
              {(character.cityRound || 0) > 0 && (
                <span
                  className="explore-round-badge"
                  title={`🏠 สำรวจเมืองเดิมต่อรอบที่ ${character.cityRound} — ศัตรู/บอสแข็งขึ้น x${character.exploreMult} แต่รางวัล XP/ทอง x${character.exploreRewardMult} (เจอบอสลับที่รอบ ${character.altBossAtRound})`}
                >
                  🏠 รอบ {character.cityRound}
                </span>
              )}
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
            <div className="home-grid">
              <div className="home-col">
                <DailyQuests />

                <Panel title={`🗺️ ${city.name} — ${city.terrain}`}>
                  <p className="panel-text">
                    เมืองนี้ยังมีเรื่องราวรอคุณอยู่… กดเริ่มผจญภัยเพื่อโฟกัสงาน แล้วตัวละครของคุณจะออกเดินทาง!
                  </p>
                  <div className="focus-task-input">
                    <input
                      className="input"
                      placeholder="📋 งานนี้จะโฟกัสอะไร? (optional — เช่น เขียนรายงาน / เรียน / ออกกำลังกาย)"
                      value={focusTask}
                      maxLength={40}
                      onChange={(e) => setFocusTask(e.target.value)}
                    />
                  </div>
                  <button
                    className="btn btn-primary btn-big"
                    onClick={() => (breakAtHome ? onBreakBack?.() : onStart(focusTask))}
                    title={breakAtHome ? '⏳ พักเบรกยังไม่จบ — กลับไปค่ายเพื่อพักต่อ (หรือรอให้หมดเวลา)' : undefined}
                  >
                    {breakAtHome
                      ? '⛺ กำลังพักอยู่ — กลับไปค่ายเพื่อพักต่อ'
                      : hasPausedSession
                        ? '🔄 เริ่ม session ใหม่ (ทิ้ง session ที่พักไว้)'
                        : '⚔️ เริ่มผจญภัย (โฟกัส ' + settings.work_min + ' นาที)'}
                  </button>
                </Panel>
              </div>

              <div className="home-col">
                <HomeQuickCards onGo={setTab} />
              </div>
            </div>
          </>
        )}

        {tab === 'story' && <StoryQuests />}
        {tab === 'challenge' && <ChallengeTab />}
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
              { key: 'abort_week_limit', label: '⚠️ เกณฑ์เตือนทิ้ง session (ครั้ง/สัปดาห์)', min: 0, max: 20, val: settings.abort_week_limit },
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
            <p className="hint">⚠️ ทิ้ง session เกินเกณฑ์ใน 1 สัปดาห์ (เริ่มวันจันทร์) → เด้งคำเตือนใน modal + แบนเนอร์ในหน้า Stats · ตั้ง 0 = ปิดการเตือน</p>
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

      {/* วิธีเล่น — โชว์ครั้งแรกครั้งเดียว (กดปิดแล้วไม่โผล่อีก) */}
      {showOnboard && (
        <div className="modal-backdrop" onClick={() => setShowOnboard(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>🗺️ วิธีเล่น PomoQuest</h2>
            <div className="guide-row"><span className="guide-num">1</span><span><b>⏱️ โฟกัสงานตามเวลา</b> — จบ work 1 รอบ = ตัวละครผจญภัย 1 session (ได้ XP / ทอง / ไอเทม และเจอเหตุการณ์สุ่ม)</span></div>
            <div className="guide-row"><span className="guide-num">2</span><span><b>☕ พักสั้น</b> — ทำภารกิจย่อย ไปซื้อของที่ร้านค่าย หรือพักฟื้นพลัง</span></div>
            <div className="guide-row"><span className="guide-num">3</span><span><b>🔁 ครบ 4 session</b> — ได้สู้บอส! ใช้สกิล (⚔️ 🛡️ 💥) เลือกท่าให้ถูก — สกิลอัพเลเวลได้ทุกครั้งที่ใช้</span></div>
            <div className="guide-row"><span className="guide-num">4</span><span><b>🎒 สวมอุปกรณ์</b> — บางชิ้นจำกัดคลาส/เลเวล/ค่าสถานะ (ดู 🔒 ที่ไอเทม) — สลับตัวละคร/ดูตรา/สถิติได้จากแท็บด้านบน</span></div>
            <div className="guide-row"><span className="guide-num">5</span><span><b>⚙️ ตั้งค่า</b> — ปรับเวลางาน/พัก เสียง แจ้งเตือนเบราว์เซอร์ และ backup ข้อมูลได้ที่แท็บตั้งค่า</span></div>
            <p className="hint">ทุก 25 นาทีที่คุณโฟกัส = ตัวละครของคุณผจญภัย 1 ครั้ง — ยิ่งโฟกัส ยิ่งแข็งแกร่ง!</p>
            <button
              className="btn btn-primary btn-big"
              onClick={() => { setShowOnboard(false); sfx.click(); }}
            >
              🚀 เข้าใจแล้ว เริ่มผจญภัย!
            </button>
          </div>
        </div>
      )}

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

      {/* เปลี่ยนโหมดท้าทาย — เสียค่าปรับทอง + คอมโบรีเซ็ต */}
      {showChallenge && (
        <div className="modal-backdrop" onClick={() => setShowChallenge(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>🔥 เปลี่ยนโหมดท้าทาย</h2>
            <p className="hint">เปลี่ยนได้ทุกเมื่อ — แต่เสียค่าปรับ <b>{50 + 30 * character.level} ทอง</b> + คอมโบโฟกัสรีเซ็ต (กันสลับโหมดไปมาเก็บโบนัส x1.5 โดยไม่เสี่ยง)</p>
            <div className="challenge-grid">
              {[
                { key: '', name: '🎮 ปกติ', desc: 'สมดุล เหมาะกับเริ่มเล่น', detail: 'มอนสเตอร์/บอส/ราคาปกติ · พักแคมป์ฟรี · พักระหว่างโฟกัสได้' },
                { key: 'hard', name: '⚔️ โหมดโหด', desc: 'ศัตรูแรงขึ้น ของยากขึ้น ของแพงขึ้น', detail: 'ศัตรู +30% · ดรอป -40% · ราคา +30% · รางวัล x1.5' },
                { key: 'marathon', name: '⏱️ โหมดมาราธอน', desc: 'ห้ามพักระหว่างโฟกัส', detail: 'พัก = เสีย session · โฟกัสครบได้ x1.5' },
                { key: 'survival', name: '🩸 โหมดเอาชีวิตรอด', desc: 'พักแคมป์ไม่ฟื้นพลัง ใกล้ตายเสียของ', detail: 'ใช้ยาเท่านั้น · HP=1 ตอนจบ session เสียของสุ่ม · x1.5' },
              ].map((ch) => (
                <button
                  key={ch.key || 'normal'}
                  className={`challenge-card ${character.challengeMode === ch.key ? 'selected' : ''}`}
                  disabled={character.challengeMode === ch.key}
                  onClick={async () => {
                    sfx.click();
                    const d = await post('/character/challenge', { mode: ch.key });
                    if (d) { setShowChallenge(false); }
                  }}
                >
                  <div className="challenge-name">{ch.name}{character.challengeMode === ch.key ? ' ✓' : ''}</div>
                  <div className="challenge-desc">{ch.desc}</div>
                  {ch.detail && <div className="challenge-detail">{ch.detail}</div>}
                </button>
              ))}
            </div>
            <button className="btn btn-big" onClick={() => setShowChallenge(false)}>ปิด</button>
          </div>
        </div>
      )}
    </div>
  );
}
