import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useGame } from './context.jsx';
import { sfx } from './sound.js';
import { notify, requestNotifyPermission } from './notify.js';
import { fmtTime, fmtDuration } from './components/ui.jsx';
import CharacterCreation from './components/CharacterCreation.jsx';
import CharacterSelect from './components/CharacterSelect.jsx';
import HomeScreen from './components/HomeScreen.jsx';
import TimerScreen, { PAUSE_PRESETS } from './components/TimerScreen.jsx';
import CampScreen from './components/CampScreen.jsx';
import BossScreen from './components/BossScreen.jsx';
import EventModal from './components/EventModal.jsx';
import LevelUpModal from './components/LevelUpModal.jsx';
import AchievementModal from './components/AchievementModal.jsx';
import StoryModal from './components/StoryModal.jsx';
import Toast from './components/Toast.jsx';

const storeKey = (charId) => `pomoquest-timer-${charId}`;

// กู้คืน timer ที่พักไว้จาก localStorage — epoch ต้องตรงกับ server ("โลกเวอร์ชัน")
// ถ้าไม่ตรง แปลว่า session นี้มาจากโลกเก่า (เช่น reset/ลบ DB ผ่าน run.sh ที่ไม่ล้าง browser) → ทิ้ง
// (timer เก่าที่ยังไม่มี epoch = เก็บไว้ก่อนอัปเดต — ยังกู้คืนได้ตามเดิม)
function loadTimer(charId, epoch) {
  try {
    const t = JSON.parse(localStorage.getItem(storeKey(charId)));
    if (!t || t.phase === 'idle') return null;
    if (t.epoch && epoch && t.epoch !== epoch) return null;
    if (t.expiresAt) t.remain = Math.max(0, Math.round((t.expiresAt - Date.now()) / 1000));
    return t;
  } catch {
    return null;
  }
}

// เหตุผลทิ้ง session สำเร็จรูป (ตัวเลือกเดียวเท่านั้น — บังคับเลือกก่อนทิ้ง ชื่อสม่ำเสมอ เอาไปรวมสถิติแยกตามเหตุผลได้)
const ABORT_PRESETS = [
  { id: 'call', icon: '📞', label: 'รับสาย/ธุระด่วน', full: '📞 รับสาย/ธุระด่วน' },
  { id: 'tired', icon: '😴', label: 'ง่วง/โฟกัสไม่ไหว', full: '😴 ง่วง/โฟกัสไม่ไหว' },
  { id: 'hard', icon: '😫', label: 'งานยากเกินไป', full: '😫 งานยากเกินไป' },
  { id: 'eat', icon: '🍚', label: 'ต้องไปกินข้าว', full: '🍚 ต้องไปกินข้าว' },
  { id: 'outside', icon: '🚶', label: 'ต้องออกไปข้างนอก', full: '🚶 ต้องออกไปข้างนอก' },
  { id: 'done', icon: '🏁', label: 'งานจบ/เลิกงาน', full: '🏁 งานจบ/เลิกงาน' },
  { id: 'distracted', icon: '📱', label: 'เผลอไปอย่างอื่น', full: '📱 เผลอไปอย่างอื่น' },
  { id: 'other', icon: '🎲', label: 'อื่น ๆ', full: '🎲 อื่น ๆ' },
];

// เกาะชื่อพักยาวมาเป็นเหตุผลเริ่มต้นตอนทิ้งจากพักยาว — หา abort preset ที่ไอคอนตรงกัน (เช่น 🍚 กินข้าว → 🍚 ต้องไปกินข้าว)
// ไม่ตรงกัน = ปล่อยว่างให้เลือกเอง (พักยาวกับทิ้ง session เป็นคนละระบบ แต่เชื่อมต่อกันตรงนี้)
const abortPresetFromPause = (pauseTitle) => {
  const icon = (pauseTitle || '').trim().split(' ')[0];
  if (!icon) return '';
  const m = ABORT_PRESETS.find((p) => p.full.startsWith(icon));
  return m ? m.full : '';
};

// สุ่มเวลาจนกว่า event ถัดไป: 30–90 วินาที (สุ่ม — ไม่มีการตั้งค่าแล้ว)
// แต่ห้ามเลยเวลาที่เหลือของ session (เผื่อ 5 วิ) — เหลือ 30 วิ event ต้องเกิดภายใน 25 วิ
const EVENT_DELAY_MAX = 90;
const randomEventDelay = (remainSec) => {
  const hi = remainSec == null ? EVENT_DELAY_MAX : Math.max(0, Math.min(EVENT_DELAY_MAX, remainSec - 5));
  const lo = Math.min(30, hi);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
};

export default function Game() {
  const { loading, hasCharacter, character, characters, settings, progress, abortsThisWeek, refresh, post, get, showToast, eventQueue, closeEvent, achieveQueue, closeAchieve, levelUpQueue, dismissLevelUp, epoch } = useGame();

  const [phase, setPhase] = useState('idle'); // idle | work | short_break | long_break
  const [sessionIdx, setSessionIdx] = useState(1);
  const [remain, setRemain] = useState(0);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [nextEventIn, setNextEventIn] = useState(() => randomEventDelay());
  const [expiredWork, setExpiredWork] = useState(false);
  const [pausedAtHome, setPausedAtHome] = useState(false); // กดกลับหน้าหลักกลาง session — พัก timer ไว้ แล้วกลับมากดต่อได้
  const [pauseStartedAt, setPauseStartedAt] = useState(null); // เริ่มพักกลาง session เมื่อไหร่ (ms) — null = ไม่ได้พักอยู่
  const [pauseAccumSec, setPauseAccumSec] = useState(0); // รวมวินาทีที่พักกลาง session นี้ (ยังไม่รวมช่วงที่กำลังพัก)
  const [pauseMode, setPauseMode] = useState(null); // 'short' = ⏸️ พักสั้น (นับใน "พักกลาง session") · 'long' = 😴 พักยาว (แยกหมวดสถิติ "พักยาว") · null = ไม่ได้พัก
  const [pauseTitle, setPauseTitle] = useState(''); // ชื่อ/เหตุผลของพักยาวครั้งปัจจุบัน (เช่น "ไปกินข้าว")
  const [longPauseAccumSec, setLongPauseAccumSec] = useState(0); // รวมวินาทีพักยาวใน session นี้ (แยกจาก pauseAccumSec = พักสั้น)
  const [longPauseTitles, setLongPauseTitles] = useState([]); // ชื่อพักยาวที่ผ่านมาใน session นี้ (ส่งไป log ตอนจบ session)
  const [pausedTick, setPausedTick] = useState(0); // นาฬิกาจำลองตอนพัก — ให้ UI นับเวลาพักสด ๆ
  const [bossState, setBossState] = useState(null);
  const [mounted, setMounted] = useState(false);
  const [showCharSelect, setShowCharSelect] = useState(false);
  const [showLongPauseReturn, setShowLongPauseReturn] = useState(false); // กลับมาจากพักยาว 😴 — ถามโฟกัสต่อ/ทิ้ง session
  const [sessionEvents, setSessionEvents] = useState([]); // เหตุการณ์ที่เจอใน session นี้ (ดูย้อนหลังตอนพัก)
  const [sessionKey, setSessionKey] = useState(null); // id ของ session ปัจจุบัน — ใช้จับกลุ่มเหตุการณ์ในหน้าประวัติ session
  const [focusTask, setFocusTask] = useState(''); // ชื่องานที่โฟกัส session นี้ (ตั้งก่อนเริ่ม — สถิติแยกตามงาน)
  const [breakVisit, setBreakVisit] = useState(null); // id ค่ายพักปัจจุบัน — ใช้ล็อก stock ร้านค้า (ซื้อครั้งเดียวต่อค่ายพัก)
  const [story, setStory] = useState(null); // เรื่องราว LLM หลังจบ session (modal)
  const [storyDone, setStoryDone] = useState(false); // เรื่องราวจบแล้ว (โชว์+ปิดแล้ว หรือไม่มีเรื่อง) — ถึงจะถามพัก/ข้าม

  // ---- สถานะรอบพักเบรก: รอเลือกพัก/ข้ามหลังจบ session + นับเวลาที่เลยพัก ----
  const [awaitingBreak, setAwaitingBreak] = useState(false); // จบ session แล้ว — รอ user เลือกพักเบรกหรือข้าม
  const [breakOver, setBreakOver] = useState(false); // พักครบเวลาแล้ว — ไม่เริ่มโฟกัสเอง ให้ user กดเอง (เวลายังนับต่อ)
  const [overrun, setOverrun] = useState(0); // วินาทีที่เลยเวลาพัก (นับต่อจาก 0)
  const [breakOverDismissed, setBreakOverDismissed] = useState(false); // กด "ยังพักต่อ" ปิด modal หมดเวลาพัก — เวลายังนับต่อ (overrun)
  const [breakStartedAt, setBreakStartedAt] = useState(null); // เริ่มพักเมื่อไหร่ (ms) — ใช้คำนวณเวลาพักจริง
  const [breakAtHome, setBreakAtHome] = useState(false); // กลับหน้าหลักระหว่างพักเบรก — timer ยังนับต่อ (หมดเวลายังถามเริ่มโฟกัส/ต่อพักเหมือนเดิม)
  const [postBossNote, setPostBossNote] = useState(null); // ชนะ/หนีบอสแล้ว — อยู่ใน "พักหลังชัยชนะ" (ข้อความสรุปผล) · null = ยังสู้บอสอยู่
  const [hatchResult, setHatchResult] = useState(null); // 🥚 ผลฟักไข่หลังจบ session — เปิด modal ฉลอง (null = ไม่มี)
  const [showAbortReason, setShowAbortReason] = useState(false); // modal ถามเหตุผลก่อนทิ้ง session
  const [abortReasonInput, setAbortReasonInput] = useState(''); // เหตุผลที่เลือก (ส่งไป server + เก็บสถิติ)
  const [showLongPauseTitle, setShowLongPauseTitle] = useState(false); // ทางลัด 😴 พักยาว ที่แถบ Home — เลือกชื่อ/เหตุผลก่อนเปลี่ยนเป็นพักยาว
  const [longPauseTitleInput, setLongPauseTitleInput] = useState(''); // ชื่อพักยาวที่เลือก (บังคับเลือกจากตัวเลือก)
  const abortWasRunningRef = useRef(false); // ก่อนเปิด modal ทิ้ง session — timer รันอยู่ไหม (ปิดแล้วคืนค่าเดิม)

  // สรุปรวมของรางวัลจากเหตุการณ์ใน session นี้ (โชว์ตอนจบ session)
  const sessionSummary = useMemo(() => {
    const s = { xp: 0, gold: 0, hpLoss: 0, mp: 0, items: [], count: sessionEvents.length };
    for (const ev of sessionEvents) {
      s.xp += ev.xp || 0;
      s.gold += ev.gold || 0;
      if (ev.hpChange < 0) s.hpLoss += Math.abs(ev.hpChange);
      if (ev.mpChange > 0) s.mp += ev.mpChange;
      if (ev.item) s.items.push(ev.item);
    }
    return s;
  }, [sessionEvents]);

  const eventBusyRef = useRef(false);
  const sessionKeyRef = useRef(null);
  sessionKeyRef.current = sessionKey;
  const focusTaskRef = useRef('');
  focusTaskRef.current = focusTask;
  const lastResRef = useRef(null); // response ของ session ล่าสุด (ใช้แชร์สรุป)
  const endedRef = useRef(false);
  const runningRef = useRef(running);
  const phaseRef = useRef(phase);
  const sessionIdxRef = useRef(sessionIdx);
  const elapsedRef = useRef(elapsed);
  const remainRef = useRef(remain);
  const breakOverRef = useRef(breakOver);
  const overrunRef = useRef(overrun);
  const breakStartedAtRef = useRef(breakStartedAt);
  const pauseStartedAtRef = useRef(null);
  const pauseAccumSecRef = useRef(0);
  const pauseModeRef = useRef(null);
  const pauseTitleRef = useRef('');
  const longPauseAccumSecRef = useRef(0);
  const longPauseTitlesRef = useRef([]);
  pauseStartedAtRef.current = pauseStartedAt;
  pauseAccumSecRef.current = pauseAccumSec;
  pauseModeRef.current = pauseMode;
  pauseTitleRef.current = pauseTitle;
  longPauseAccumSecRef.current = longPauseAccumSec;
  longPauseTitlesRef.current = longPauseTitles;
  runningRef.current = running;
  phaseRef.current = phase;
  sessionIdxRef.current = sessionIdx;
  elapsedRef.current = elapsed;
  remainRef.current = remain;
  breakOverRef.current = breakOver;
  overrunRef.current = overrun;
  breakStartedAtRef.current = breakStartedAt;

  const fetchBoss = useCallback(async () => {
    const d = await get('/boss');
    if (d && d.boss) setBossState({ boss: d.boss, log: [] });
  }, [get]);

  // ---- กู้คืน timer ตอนโหลดหน้า / สลับตัวละคร (timer แยกตามตัวละคร) ----
  useEffect(() => {
    if (!hasCharacter || loading || !character) return;
    // รีเซ็ตทุกครั้งที่สลับตัวละคร
    setPhase('idle');
    setSessionIdx(1);
    setRemain(0);
    setRunning(false);
    setElapsed(0);
    setNextEventIn(randomEventDelay());
    setExpiredWork(false);
    setPausedAtHome(false);
    setPauseStartedAt(null);
    setPauseAccumSec(0);
    setPauseMode(null);
    setPauseTitle('');
    setLongPauseAccumSec(0);
    setLongPauseTitles([]);
    setShowLongPauseReturn(false);
    setPausedTick(0);
    setBossState(null);
    eventBusyRef.current = false;
    endedRef.current = false;
    setMounted(true);
    setSessionEvents([]);
    setSessionKey(null);
    setBreakVisit(null);
    setFocusTask('');
    setStory(null);
    setStoryDone(false);
    setAwaitingBreak(false);
    setBreakOver(false);
    setOverrun(0);
    setBreakOverDismissed(false);
    setBreakStartedAt(null);
    setBreakAtHome(false);
    setPostBossNote(null);
    setHatchResult(null);
    setShowAbortReason(false);
    setAbortReasonInput('');

    const t = loadTimer(character.id, epoch);
    if (t) {
      setPhase(t.phase);
      setSessionIdx(t.sessionIdx || 1);
      setRemain(t.remain || 0);
      setElapsed(t.elapsed || 0);
      setNextEventIn(t.nextEventIn ?? randomEventDelay());
      setSessionEvents(t.sessionEvents || []);
      setSessionKey(t.sessionKey || null);
      setBreakVisit(t.breakVisit || null);
      if (t.focusTask) setFocusTask(t.focusTask); // ชื่องาน session นี้ (ตั้งตอนเริ่ม) — กู้คืนหลังรีโหลด
      setAwaitingBreak(t.awaitingBreak || false);
      setBreakOver(t.breakOver || false);
      setOverrun(t.overrun || 0);
      setBreakStartedAt(t.breakStartedAt || null);
      setBreakAtHome(t.breakAtHome || false);
      setPostBossNote(t.postBossNote || null);
      setHatchResult(t.hatchResult || null);
      setPausedAtHome(t.pausedAtHome || false);
      setPauseStartedAt(t.pauseStartedAt || null);
      setPauseAccumSec(t.pauseAccumSec || 0);
      setPauseMode(t.pauseMode || null); // timer เก่าที่ยังไม่มี pauseMode = พักสั้น (นับเวลาตามเดิม)
      setPauseTitle(t.pauseTitle || '');
      setLongPauseAccumSec(t.longPauseAccumSec || 0);
      setLongPauseTitles(t.longPauseTitles || []);
      // story ไมไดเก็บไว้ใน localStorage — ถ้ากลับมาค้างที่รอเลือกพัก/ข้าม ให้ข้ามเรื่องไปถามพัก/ข้ามเลย
      if (t.awaitingBreak) setStoryDone(true);

      if (t.phase === 'work') {
        if (t.awaitingBreak) {
          setRunning(false); // จบ session แล้ว — modal ถามพัก/ข้ามจะขึ้นเอง
        } else if (t.expiresAt && t.remain <= 0) {
          setExpiredWork(true); // กลับมาหลัง session หมดเวลา — ถามว่าจบหรือทิ้ง
          setRunning(false);
        } else if (t.running === false) {
          // ผู้ใช้กดหยุดพักไว้ — คงสถานะพักไว้ ไม่รันต่อ (กัน XP/เลเวลอัพตอนที่ไม่ได้โฟกัส)
          setRunning(false);
        } else {
          setRunning(true);
        }
      } else if (t.phase === 'short_break' || t.phase === 'long_break') {
        const breakLenMin = t.phase === 'long_break' ? settings.long_break_min : settings.short_break_min;
        if (t.breakOver) {
          // หมดเวลาพักอยู่แล้ว — เวลายังนับต่อ (overrun)
          setRunning(true);
          if (t.breakStartedAt) {
            const plannedEnd = t.breakStartedAt + breakLenMin * 60000;
            setOverrun(Math.max(t.overrun || 0, Math.round((Date.now() - plannedEnd) / 1000)));
          }
        } else if (t.expiresAt && t.remain <= 0) {
          // พักหมดระหว่างปิดแท็บ — ไม่เริ่มโฟกัสเอง ให้ user กดเอง
          setBreakOver(true);
          setRunning(true);
          if (t.breakStartedAt) {
            const plannedEnd = t.breakStartedAt + breakLenMin * 60000;
            setOverrun(Math.max(0, Math.round((Date.now() - plannedEnd) / 1000)));
          }
        } else {
          setRunning(true);
        }
        // อยู่ใน "พักหลังชัยชนะ" แล้ว → ไม่ต้องโหลดบอส (บอสจบแล้ว — ไปค่ายพักเลย)
        if (t.phase === 'long_break' && !t.postBossNote) fetchBoss();
      } else {
        setRunning(true);
      }
      // กลับมาค้างที่ "พัก session ไว้ที่หน้าหลัก" → ไม่ต้องรัน timer ให้ไปต่อจากปุ่ม
      if (t.pausedAtHome) setRunning(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCharacter, loading, character?.id, epoch]);

  // ---- บันทึกสถานะ timer ----
  useEffect(() => {
    if (!mounted || !character) return;
    const t = {
      phase, sessionIdx, remain, running, elapsed, nextEventIn, sessionEvents, sessionKey, breakVisit,
      awaitingBreak, breakOver, overrun, breakStartedAt, breakAtHome, postBossNote, hatchResult, pausedAtHome, pauseStartedAt, pauseAccumSec, pauseMode, pauseTitle, longPauseAccumSec, longPauseTitles,
      focusTask, // ชื่องานที่ตั้งไว้ — เก็บไว้กู้คืนหลังรีโหลด (session ต่อ ๆ ไปในรอบใช้ชื่อเดิม)
      epoch, // "โลกเวอร์ชัน" — reset/ลบ DB แล้ว epoch เปลี่ยน → session ที่พักค้างถูกทิ้ง (ไม่กู้คืน)
      expiresAt: running ? Date.now() + remain * 1000 : null,
    };
    localStorage.setItem(storeKey(character.id), JSON.stringify(t));
  }, [phase, sessionIdx, remain, running, elapsed, nextEventIn, sessionEvents, sessionKey, breakVisit, awaitingBreak, breakOver, overrun, breakStartedAt, breakAtHome, postBossNote, hatchResult, pausedAtHome, pauseStartedAt, pauseAccumSec, pauseMode, pauseTitle, longPauseAccumSec, longPauseTitles, focusTask, epoch, mounted, character?.id]);

  // ---- ตัวนับถอยหลัง ----
  useEffect(() => {
    if (!running || !mounted) return;
    const id = setInterval(() => {
      setRemain((r) => Math.max(0, r - 1));
      if (breakOverRef.current) setOverrun((o) => o + 1); // เลยเวลาพัก — เวลายังนับต่อ
      if (phaseRef.current === 'work') {
        setElapsed((e) => e + 1);
        setNextEventIn((n) => Math.max(0, n - 1));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [running, mounted]);

  // ---- นาฬิกาจำลองตอนพักกลาง session — ให้ UI นับเวลาพักสด ๆ (ตอนพัก timer หลักหยุด) ----
  useEffect(() => {
    if (running || phase !== 'work' || !pauseStartedAtRef.current) return;
    const id = setInterval(() => setPausedTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [running, phase, pauseStartedAt]);

  // ---- ตรวจจับจบเฟส ----
  useEffect(() => {
    if (!running || remain > 0) { endedRef.current = false; return; }
    if (endedRef.current) return;
    endedRef.current = true;
    const p = phaseRef.current;
    if (p === 'work') {
      setRunning(false);
      completeWork();
    } else if (p === 'short_break' || p === 'long_break') {
      // พักครบเวลา — ไม่เริ่มโฟกัสเอง ให้ user กดเอง (เวลายังนับต่อเป็น overrun)
      setBreakOver(true);
      sfx.breakOver(); // "ติ๊งต่อง" บอกว่าพักครบเวลา
      notify(
        p === 'long_break' ? '👹 ถึงเวลาสู้บอส!' : '☕ พักครบแล้ว',
        p === 'long_break' ? 'พักใหญ่จบ — สู้บอสต่อ หรือเริ่มโฟกัส' : 'พักครบแล้ว — เริ่มโฟกัสต่อได้ (ไม่กด = เวลาพักยังนับต่อไป)'
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remain, running]);

  const completeWork = async () => {
    sfx.complete();
    // ส่งเหตุการณ์ใน session นี้ไปด้วย — LLM แต่งเรื่องจาก log จริง, ถ้า LLM ไม่ทำงาน server จะสรุป log นี้แทน
    const res = await post('/adventure/complete', {
      focusSec: elapsedRef.current,
      pauseSec: pauseAccumSecRef.current, // พักกลาง session (กดหยุดพัก/กลับหน้าหลัก) — นับแยกจากพักเบรก
      longPauseSec: longPauseAccumSecRef.current, // พักยาว 😴 — แยกหมวดสถิติ "พักยาว" (จากพักสั้น)
      longPauseTitle: longPauseTitlesRef.current.join(' · '), // ชื่อ/เหตุผลของพักยาวใน session นี้ (ลง log จบ session)
      events: sessionEvents,
      sessionIdx: sessionIdxRef.current,
      sessionsPerCycle: settings.sessions_per_cycle,
      sessionKey: sessionKeyRef.current,
      focusTask: focusTaskRef.current,
    });
    lastResRef.current = res;
    if (!res) { setPhase('idle'); return; }
    if (res.reward) {
      const hatchNote = res.hatch && !res.hatch.waiting && !res.hatch.dup
        ? ` · 🥚 ไข่ฟักเป็น ${res.hatch.pet.icon} ${res.hatch.pet.name}!`
        : '';
      notify('⏰ โฟกัสครบแล้ว!', `ได้ +${res.reward.xp} XP, +${res.reward.gold} ทอง${hatchNote} — พักเบรกหรือลุยต่อ?`);
    }
    // 🥚 ไข่ที่กำลังฟัก — จบ session แล้วไข่ฟัก → เปิด modal ฉลอง (server สุ่มตอนฟักจริง ไม่สปอยล์ก่อนหน้านี้)
    if (res.hatch) {
      if (res.hatch.waiting) showToast(`🥚 ${res.hatch.message || 'ต้องเก็บสัตว์เลี้ยงก่อน — ใช้ 👜 กระเป๋าเก็บสัตว์'}`);
      else {
        if (res.hatch.dup) sfx.coin(); // ฟักเป็นตัวเดิม → ได้ค่าปลอบใจทอง
        else sfx.hatch(); // ป๊อป + สายฟ้า — ฉลอง pet ใหม่
        setHatchResult(res.hatch);
      }
    }
    setStoryDone(false); // เริ่มรอเรื่องราว — เรื่องต้องโชว์ก่อนถึงจะถามพัก/ข้าม
    setAwaitingBreak(true);
    // poll เสมอถ้ามี taleAfter — LLM ทำงานก็ได้เรื่องแต่ง, ไม่ทำงาน server ก็เขียนสรุปเหตุการณ์ให้ (pollStory หยุดเองเมื่อไม่มีเรื่อง)
    if (res && res.taleAfter) pollStory(res.taleAfter);
  };

  // ---- พักกลาง session (กดหยุดพัก / กลับหน้าหลัก) — นับเวลาพักแยกจากพักเบรกระหว่าง session ----
  // 'short' = ⏸️ พักสั้น (นับเวลาในสถิติ "พักกลาง session") · 'long' = 😴 พักยาว (ไปนอน/ธุระ — ไม่นับเวลาในสถิติ)
  const startPause = (mode = 'short', title = '') => {
    if (pauseStartedAtRef.current) return; // พักอยู่แล้ว — ไม่เริ่มซ้ำ
    setPauseStartedAt(Date.now());
    setPauseMode(mode);
    setPauseTitle(mode === 'long' ? (title || '').trim() : '');
  };

  const endPause = () => {
    const started = pauseStartedAtRef.current;
    if (!started) return; // ไม่ได้พักอยู่
    const sec = Math.max(0, Math.round((Date.now() - started) / 1000));
    if (pauseModeRef.current === 'long') {
      // พักยาว 😴 — นับแยกหมวด (long_pause_sec) + เก็บชื่อเหตุผลไว้ลง log ตอนจบ session
      setLongPauseAccumSec((a) => a + sec);
      if (pauseTitleRef.current) setLongPauseTitles((t) => [...t, pauseTitleRef.current]);
    } else {
      // พักสั้น — นับเวลาพักเข้าสถิติ "พักกลาง session"
      setPauseAccumSec((a) => a + sec);
    }
    setPauseStartedAt(null);
    setPauseMode(null);
    setPauseTitle('');
  };

  const resetPause = () => {
    setPauseStartedAt(null);
    setPauseAccumSec(0);
    setPauseMode(null);
    setPauseTitle('');
    setLongPauseAccumSec(0);
    setLongPauseTitles([]);
  };

  // ---- กลับหน้าหลักกลาง session: พัก timer ไว้ แล้วกลับมากด "ต่อ session" ได้ ----
  // (ปุ่ม 🏠 ที่หน้าโฟกัสเปิดตัวเลือกพักสั้น/ยาวให้เลือกก่อนแล้ว — ตรงนี้แค่พักไว้ที่หน้า Home
  //  ไม่เรียก startPause ซ้ำ เพราะ ref ยังไม่ทัน sync หลัง onPause → จะทับ pauseMode/pauseTitle เป็นพักสั้น)
  const handleHome = () => {
    setRunning(false);
    setPausedAtHome(true);
    sfx.pause();
  };

  // กด "โฟกัสต่อ" (ที่หน้าหลัก หรือหน้าจอโฟกัส) — ถ้าพักยาว 😴 ให้ถามก่อนกลับมา (โชว์เวลาที่ไม่อยู่ + เลือกต่อ/ทิ้ง)
  const handleContinue = () => {
    if (pauseModeRef.current === 'long') { setShowLongPauseReturn(true); return; }
    endPause();
    setPausedAtHome(false);
    setRunning(true);
    sfx.start();
  };

  const handleResume = () => {
    if (pauseModeRef.current === 'long') { setShowLongPauseReturn(true); return; }
    endPause();
    setRunning(true);
    sfx.start();
  };

  // เลือก "โฟกัสต่อ" ใน modal กลับมาจากพักยาว — จบพัก (ไม่นับเวลา) แล้วกลับมารัน session
  const resumeFromLongPause = () => {
    setShowLongPauseReturn(false);
    endPause();
    setPausedAtHome(false);
    setRunning(true);
    sfx.start();
  };

  // เลือก "ทิ้ง session" ใน modal กลับมาจากพักยาว — ปิด modal นี้ แล้วเปิด modal ถามเหตุผล (ทิ้งจริงต้องเลือกเหตุผล)
  // เกาะชื่อพักยาวมาเป็นเหตุผลเริ่มต้น (เฉพาะตัวเลือกที่ตรงกัน) — พักยาวกับทิ้ง session เป็นคนละระบบ แต่เชื่อมต่อกันตรงนี้
  const discardFromLongPause = () => {
    setShowLongPauseReturn(false);
    openAbortModal(abortPresetFromPause(pauseTitle));
  };

  // ทางลัด "😴 พักยาว" จากแถบ Home — ต้องเลือกชื่อ/เหตุผลจากตัวเลือกก่อน (บังคับ — กันพักยาวแบบไม่ระบุ)
  const openLongPauseTitleModal = () => {
    setLongPauseTitleInput('');
    setShowLongPauseTitle(true);
    sfx.click();
  };

  const confirmLongPauseTitle = () => {
    setShowLongPauseTitle(false);
    convertToLongPause(longPauseTitleInput.trim());
  };

  // เปลี่ยนพักสั้นที่ค้างอยู่เป็นพักยาวจริง (เลือกชื่อแล้ว) — ปิดพักสั้น (นับเวลาส่วนที่พักสั้นไปแล้ว)
  // แล้วเริ่มนับพักยาวใหม่จากตอนนี้ — สถิติแยกหมวดไม่ปนกัน
  const convertToLongPause = (title = '') => {
    if (!pauseStartedAtRef.current || pauseModeRef.current === 'long') return;
    const sec = Math.max(0, Math.round((Date.now() - pauseStartedAtRef.current) / 1000));
    setPauseAccumSec((a) => a + sec);
    setPauseStartedAt(Date.now());
    setPauseMode('long');
    setPauseTitle(title);
    showToast('😴 เปลี่ยนเป็นพักยาวแล้ว (แยกหมวดสถิติ "พักยาว")');
    sfx.click();
  };

  // แก้ไขชื่องานของ session นี้ (จากหน้าจอโฟกัส) — session ต่อ ๆ ไปในรอบใช้ชื่อใหม่
  const editFocusTask = () => {
    const v = window.prompt('📋 ตั้งชื่องานนี้ (เว้นว่างเพื่อลบ)', focusTaskRef.current || '');
    if (v === null) return;
    setFocusTask(v.trim());
    if (v.trim()) showToast('📋 เปลี่ยนชื่องานเป็น "' + v.trim() + '" แล้ว');
  };

  const beginWork = (idx = 1, task) => {
    requestNotifyPermission(); // ขออนุญาตแจ้งเตือนครั้งแรก (browser โชว์ prompt เอง — ถ้า grant/deny แล้วจะข้าม)
    if (task !== undefined) setFocusTask(task); // ตั้งชื่องานตอนเริ่มจากหน้าแรก (session ต่อ ๆ ไปในรอบใช้ชื่อเดิม)
    setSessionIdx(idx);
    setRemain(settings.work_min * 60);
    setElapsed(0);
    setNextEventIn(randomEventDelay());
    setSessionEvents([]); // session ใหม่ → ล้าง log เหตุการณ์เดิม
    setSessionKey(String(Date.now())); // session ใหม่ → id ใหม่ (จับกลุ่มเหตุการณ์ในหน้าประวัติ)
    setPausedAtHome(false); // เริ่ม session ใหม่ = เลิกสถานะพักไว้ที่หน้าหลัก
    resetPause(); // session ใหม่ → เริ่มนับเวลาพักกลาง session ใหม่
    setPhase('work');
    setRunning(true);
    sfx.start();
  };

  const startShortBreak = () => {
    resetPause(); // ออกจากโหมด work — เลิกนับพักกลาง session
    setBreakAtHome(false); // พักใหม่ — เริ่มที่หน้า camp เสมอ
    setPostBossNote(null);
    setRemain(settings.short_break_min * 60);
    setBreakVisit(`${Date.now()}-${Math.floor(Math.random() * 1e6)}`); // ค่ายพักใหม่ = stock ร้านใหม่
    setPhase('short_break');
    setBreakStartedAt(Date.now());
    setBreakOver(false);
    setOverrun(0);
    setBreakOverDismissed(false);
    setRunning(true);
    sfx.breakStart(); // เสียงเริ่มพักเบรก — นุ่มลงมา
  };

  const startLongBreak = () => {
    resetPause(); // ออกจากโหมด work — เลิกนับพักกลาง session
    setBreakAtHome(false);
    setPostBossNote(null); // พักใหญ่ใหม่ → กลับไปสู้บอสอีกครั้ง
    setRemain(settings.long_break_min * 60);
    setBreakVisit(`${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    setPhase('long_break');
    setBreakStartedAt(Date.now());
    setBreakOver(false);
    setOverrun(0);
    setBreakOverDismissed(false);
    setRunning(true);
    sfx.boss();
    fetchBoss();
    notify('👹 ถึงเวลาสู้บอส!', 'โฟกัสครบ 4 session — บอสของเมืองนี้รออยู่ (พักใหญ่ 15 นาที)');
  };

  // ---- หลังจบ session: เลือกพักเบรก หรือข้ามไปโฟกัสต่อ ----
  const chooseBreak = () => {
    setAwaitingBreak(false);
    if (sessionIdxRef.current >= settings.sessions_per_cycle) startLongBreak();
    else startShortBreak();
  };

  const skipBreak = () => {
    setAwaitingBreak(false);
    beginWork(sessionIdxRef.current >= settings.sessions_per_cycle ? 1 : sessionIdxRef.current + 1);
  };

  // กลับหน้าหลักหลังจบรอบ (ไม่สู้บอส ไม่เริ่มโฟกัสต่อ)
  const goHomeAfterCycle = () => {
    setAwaitingBreak(false);
    setPhase('idle');
  };

  // ---- บันทึกสถิติพักเบรก (เวลาพักจริง + เลยเวลา) แล้วรีเซ็ตสถานะพัก — ยังไม่เริ่มโฟกัส ----
  const recordBreak = async () => {
    const startedAt = breakStartedAtRef.current;
    const now = Date.now();
    const breakSec = startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
    if (breakSec > 0) {
      await post('/break/done', { breakSec, overrunSec: overrunRef.current });
    }
    setBreakOver(false);
    setBreakOverDismissed(false);
  };

  // ---- จบพักเบรก (เริ่มโฟกัส / จบพักเร็ว) — บันทึกสถิติแล้วเริ่มงาน ----
  const finishBreak = async () => {
    setBreakAtHome(false); // จบพัก (เริ่มโฟกัส/จบพักเร็ว) — กลับมาอยู่หน้าโฟกัส ไม่ค้างที่หน้าหลัก
    await recordBreak();
    setPostBossNote(null); // เลิกสถานะพักหลังชัยชนะ (เริ่มโฟกัสแล้ว)
    const p = phaseRef.current;
    beginWork(p === 'long_break' ? 1 : sessionIdxRef.current + 1);
  };

  // ---- กลับหน้าหลักระหว่างพักเบรก: timer ยังนับต่อ — หมดเวลาพัก modal ถามเริ่มโฟกัส/ต่อพักยังโผล่เหมือนเดิม ----
  const handleBreakHome = () => {
    setBreakAtHome(true);
    sfx.click();
  };

  const handleBreakBack = () => {
    setBreakAtHome(false);
    sfx.click();
  };

  // ---- ปิด modal หมดเวลาพัก (ยังไม่เริ่มโฟกัส) — ไม่มีปุ่มต่อเวลาเพราะเวลานับต่ออยู่แล้ว (overrun) ----
  const dismissBreakOver = () => {
    setBreakOverDismissed(true);
    sfx.click();
  };

  // ---- เหตุการณ์สุ่มระหว่าง work session ----
  useEffect(() => {
    if (phase !== 'work' || !running || nextEventIn > 0 || eventBusyRef.current) return;
    eventBusyRef.current = true;
    (async () => {
      const res = await post('/adventure/event', sessionKeyRef.current ? { sessionKey: sessionKeyRef.current } : {});
      eventBusyRef.current = false;
      const remainNow = remainRef.current;
      // เหลือน้อยกว่า 30 วิ → ไม่สุ่ม event ใหม่ (session ใกล้จบ) กัน event ซ้อนที่ท้าย session
      setNextEventIn(remainNow < 30 ? remainNow + 3600 : randomEventDelay(remainNow));
      // ไม่มีเสียง event — กันรบกวนการโฟกัส (เสียงมีเฉพาะช่วงพัก/จบ session/ฟักไข่)
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextEventIn, phase, running]);

  // ---- เก็บเหตุการณ์ที่เจอใน session นี้ (ไว้ดูย้อนหลังตอนพักเบรก) ----
  // ระหว่างโฟกัส (running): กิน event เงียบ ๆ ไม่เด้ง modal รบกวน — ดูจาก toast + session log
  useEffect(() => {
    if (phase !== 'work' || !running || eventQueue.length === 0) return;
    const first = eventQueue[0];
    setSessionEvents((prev) => (prev[prev.length - 1] === first ? prev : [...prev, { ...first, at: Date.now() }]));
    closeEvent();
  }, [eventQueue, phase, running]);

  // ---- เรื่องราวการผจญภัย (LLM) หลังจบ session — poll จนเจอเรื่องใหม่แล้วเด้ง modal ----
  // เมื่อเรื่องจบ (โชว์แล้วถูกปิด หรือไม่มีเรื่องเลย) → storyDone=true ถึงจะถามพัก/ข้าม
  const pollStory = useCallback(async (after) => {
    for (let i = 0; i < 40; i++) { // ~32 วิ — เผื่อ LLM local คิดช้า (timeout 30 วิ)
      const d = await get(`/adventure/story?after=${after}`);
      if (!d) { setStoryDone(true); return; }
      if (d.story) {
        setStory(d.story);
        return; // รอ user ปิด modal — onClose จะ setStoryDone(true)
      }
      if (!d.pending) { setStoryDone(true); return; } // ไม่มีเรื่อง (LLM ปิด / ไม่มีเหตุการณ์)
      await new Promise((r) => setTimeout(r, 800));
    }
    setStoryDone(true); // รอครบแล้วก็ไม่เจอ — เลิกคอย
  }, [get]);

  // ทิ้งเซสชันจริง (เรียกจาก modal ถามเหตุผลที่ตัดสินใจแล้วเท่านั้น)
  const abortSession = async (reason = '') => {
    // ส่งเหตุผล + โฟกัสไปแล้วกี่วินาที — เก็บสถิติ/ดูย้อนหลัง (ถ้าใช้โล่ กันคอมโบ — server โชว์ toast ยืนยันเองผ่าน d.message กัน toast ซ้อน)
    await post('/adventure/abort', { reason, focusSec: elapsedRef.current });
    setPhase('idle');
    setRunning(false);
    setPausedAtHome(false);
    setBreakAtHome(false);
    setSessionIdx(1);
    setElapsed(0);
    setExpiredWork(false); // ปิด modal หมดเวลา (ถ้าเปิดจากตรงนั้น)
    setAwaitingBreak(false);
    resetPause(); // ทิ้งเซสชัน = เลิกนับพักกลาง session
  };

  // เปิด modal ถามเหตุผลก่อนทิ้ง session (แทน window.confirm เดิม) — หยุดนาฬิกาชั่วคราวเหมือนเดิม
  // (กัน session หมดเวลาค้าง modal เปิดอยู่ → ถ้าปิด modal โดยไม่ทิ้ง จะกลับไปรันต่อ)
  // initialReason (optional) = เติมเหตุผลเริ่มต้นให้ เช่น เกาะชื่อพักยาวตอนทิ้งจาก modal กลับมาจากพักยาว
  const openAbortModal = (initialReason = '') => {
    abortWasRunningRef.current = runningRef.current;
    setRunning(false);
    setAbortReasonInput(initialReason);
    setShowAbortReason(true);
    sfx.click();
  };

  const cancelAbort = () => {
    setShowAbortReason(false);
    if (abortWasRunningRef.current) setRunning(true); // กลับไปรันต่อเหมือนเดิม
    sfx.click();
  };

  const confirmAbort = async () => {
    setShowAbortReason(false);
    await abortSession(abortReasonInput.trim());
  };

  const handleAbort = () => openAbortModal();
  const handleDiscardPaused = () => openAbortModal();

  // แชร์สรุป session — navigator.share (มือถือ) หรือคัดลอกข้อความ
  const shareSummary = async () => {
    const res = lastResRef.current || {};
    const lines = [`🍅⚔️ PomoQuest — จบ session ${sessionIdxRef.current}/${settings.sessions_per_cycle}!`];
    if (res?.reward) lines.push(`⏱️ โฟกัสครบ ${Math.round(elapsedRef.current / 60)} นาที → +${res.reward.xp} XP, +${res.reward.gold} ทอง`);
    if (focusTaskRef.current) lines.push(`📋 งาน: ${focusTaskRef.current}`);
    lines.push(`🧑‍🎤 ${character.name} (${character.className}) Lv.${character.level}`);
    if (sessionEvents.length) lines.push(`📜 เจอเหตุการณ์ ${sessionEvents.length} อย่าง: ${sessionEvents.map((e) => e.title?.split(' ').pop() || '?' ).join(', ')}`);
    lines.push('ยิ่งโฟกัส ยิ่งแข็งแกร่ง!');
    const text = lines.join('\n');
    try {
      if (navigator.share) {
        await navigator.share({ title: 'PomoQuest', text });
        return;
      }
    } catch { /* ผู้ใช้กดยกเลิก — ไม่เป็นไร */ }
    try {
      await navigator.clipboard.writeText(text);
      showToast('📤 คัดลอกสรุปแล้ว — วางแชร์ได้เลย');
    } catch {
      showToast('ไม่สามารถแชร์ได้ในเบราว์เซอร์นี้');
    }
  };

  const bossAct = async (action, arg) => {
    // สกิลต้องส่งเป็น skillId (server อ่าน req.body.skillId) — ส่งเป็น itemId จะหาไม่เจอ → "สกิลไม่พบ"
    const d = await post('/boss/act', action === 'skill' ? { action, skillId: arg } : { action, itemId: arg });
    if (!d) return null;
    setBossState((s) => ({
      boss: d.boss,
      fight: d.fight || null,
      log: [...(s?.log || []), ...(d.log || [])],
      outcome: d.outcome || null,
      drop: d.item || null,
      breaks: d.breaks || 0,      // สลายท่าไม้ตายในไฟต์นี้ — โชว์รางวัลฝีมือตอนชนะ
      furyWin: !!d.furyWin,       // ชนะตอนบอสสุดทน
      defeatMsg: d.message || null, // 💀 ถูกโค่นล้ม (HP ถึง 0) — server ลงโทษแล้ว → โชว์ข้อความตอนกลับค่าย
    }));
    return d;
  };

  // ---- หลังสู้บอสเสร็จ (ชนะ/หนี) — เข้าสู่ "พักหลังชัยชนะ" ที่ค่าย (ไม่กลับไปโฟกัสทันที — ให้ได้พักจริง) ----
  // ต่อเวลาพักยาวที่เหลืออยู่ (สู้บอสไปเท่าไหร่ เหลือเท่านั้น) · สู้กินเวลาจนหมด → ให้พักขั้นต่ำ 3 นาที
  const startPostBossBreak = (note) => {
    setPostBossNote(note);
    setBossState(null); // ปิดหน้าจอบอส — เข้าค่ายพัก
    setBreakAtHome(false);
    setBreakVisit(`${Date.now()}-${Math.floor(Math.random() * 1e6)}`); // ค่ายใหม่ (ย้ายเมือง/รอบใหม่) — stock ร้านใหม่
    if (remainRef.current <= 0) setRemain(3 * 60); // สู้กินเวลาพักจนหมด → ให้พักขั้นต่ำ 3 นาที
    setBreakOver(false);
    setBreakOverDismissed(false);
    setOverrun(0);
    setRunning(true);
    sfx.breakStart(); // เสียงเริ่มพักหลังชัยชนะ
  };

  const bossRetreat = async () => {
    const d = await post('/boss/retreat');
    if (!d) return;
    startPostBossBreak(d.message);
  };

  // 💀 ถูกโค่นล้ม (HP ถึง 0 ในสู้บอส) — server ลงโทษไปแล้วตอน /boss/act → แค่พากลับค่ายพร้อมข้อความ
  const bossDefeated = () => {
    startPostBossBreak(bossState?.defeatMsg || '💀 ถูกโค่นล้ม — กลับไปพักที่ค่าย');
  };

  // หลังชนะบอส — เลือก "เดินทางต่อ" (เมืองใหม่) หรือ "สำรวจเมืองเดิมต่อ" → กลับไปพักที่ค่ายก่อนเริ่มโฟกัส
  const bossWinChoice = async (choice) => {
    const d = await post('/boss/after', { choice }); // server โชว์ toast ยืนยันเองผ่าน d.message
    if (!d) return;
    startPostBossBreak(d.message);
  };

  // กำลังโฟกัสงานอยู่ → ซ่อน notification (เลเวลอัพ/รางวัล) ไว้แจ้งหลังจบ session แทน
  const inActiveWork = phase === 'work' && running;
  // กำลังพักกลาง session (กดหยุดพัก/กลับหน้าหลัก) → ซ่อน modal รางวัล/เลเวลอัพไว้ก่อน — พัก = หยุดทุกอย่างจริง ๆ
  // (ไม่ซ่อนตอน awaitingBreak/expiredWork — หน้าจอนั้นต้องโชว์ modal ถามจบ session)
  const inPausedWork = phase === 'work' && !running && !awaitingBreak && !expiredWork;
  // เวลาพักจริงตั้งแต่วินาทีที่เริ่มพัก (รวมเวลาที่ต่อ + เลยเวลา) — คำนวณจากนาฬิกาจริงกันเพี้ยน
  const breakSecSoFar = breakStartedAt ? Math.max(0, Math.round((Date.now() - breakStartedAt) / 1000)) : 0;
  // เวลาพักกลาง session ทั้งหมด (รวมช่วงที่กำลังพักอยู่) — สำหรับโชว์บนหน้าจอ
  const pausedSec = pauseAccumSec + (pauseStartedAt ? Math.max(0, Math.round((Date.now() - pauseStartedAt) / 1000)) : 0);

  if (loading) {
    return (
      <div className="splash">
        <div className="splash-icon">🍅⚔️</div>
        <p>กำลังโหลดโลกของ PomoQuest…</p>
      </div>
    );
  }

  if (!hasCharacter) {
    // มีตัวละครอื่นอยู่ → หน้าเลือกตัวละคร, ไม่มีเลย → สร้างใหม่
    return characters.length > 0 ? <CharacterSelect standalone onDone={refresh} /> : <CharacterCreation />;
  }

  return (
    <div className="app">
      {(phase === 'idle' || pausedAtHome || breakAtHome) && (
        <HomeScreen
          onStart={(task) => beginWork(1, task)}
          onContinue={pausedAtHome ? handleContinue : null}
          pausedRemain={remain}
          hasPausedSession={pausedAtHome}
          pausedSec={pausedSec}
          pauseMode={pauseMode}
          pauseTitle={pauseTitle}
          pausedTask={focusTask}
          onDiscard={handleDiscardPaused}
          onLongPause={openLongPauseTitleModal}
          onManageCharacters={() => setShowCharSelect(true)}
          breakAtHome={breakAtHome}
          breakRemain={remain}
          breakOver={breakOver}
          onBreakBack={handleBreakBack}
        />
      )}

      {phase === 'work' && !pausedAtHome && (
        <TimerScreen
          remain={remain}
          total={settings.work_min * 60}
          running={running}
          sessionIdx={sessionIdx}
          sessionsPerCycle={settings.sessions_per_cycle}
          nextEventIn={nextEventIn}
          onPause={(mode, title) => { startPause(mode, title); setRunning(false); sfx.pause(); }}
          onResume={handleResume}
          onAbort={handleAbort}
          onHome={handleHome}
          sessionEvents={sessionEvents}
          focusTask={focusTask}
          pausedSec={pausedSec}
          pauseMode={pauseMode}
          pauseTitle={pauseTitle}
          onEditTask={editFocusTask}
        />
      )}

      {phase === 'short_break' && !breakAtHome && (
        <CampScreen
          remain={remain}
          total={settings.short_break_min * 60}
          running={running}
          breakOver={breakOver}
          overrun={overrun}
          onSkip={finishBreak}
          onHome={handleBreakHome}
          visit={breakVisit}
        />
      )}

      {phase === 'long_break' && !postBossNote && (
        <BossScreen
          bossState={bossState}
          remain={remain}
          total={settings.long_break_min * 60}
          running={running}
          breakOver={breakOver}
          overrun={overrun}
          onAct={bossAct}
          onRetreat={bossRetreat}
          onWinChoice={bossWinChoice}
          onDefeat={bossDefeated}
        />
      )}

      {/* ชนะ/หนีบอสแล้ว — พักหลังชัยชนะที่ค่าย (ต่างจากค่ายพักสั้น: header + ข้อความสรุปผลต่างกัน) */}
      {phase === 'long_break' && postBossNote && (
        <CampScreen
          remain={remain}
          total={settings.long_break_min * 60}
          running={running}
          breakOver={breakOver}
          overrun={overrun}
          onSkip={finishBreak}
          onHome={handleBreakHome}
          visit={breakVisit}
          postBoss={postBossNote}
        />
      )}

      {/* modal แบบคิว — โชว์ทีละอัน ไม่ทับกัน: เรื่องราว LLM ก่อนเสมอ → เลเวลอัพ → ตรา → เหตุการณ์ → แล้วค่อยถามพัก/ข้าม */}
      {/* ระหว่างรอเรื่องราว (awaitingBreak && !storyDone) ให้ modal อื่นรอด้วย — กัน modal มาทับเรื่อง LLM */}
      {/* ระหว่างพักกลาง session (inPausedWork) ซ่อน modal ทั้งหมด — พัก = หยุดทุกอย่าง ไม่มีอะไรเด้งขึ้นมา */}
      {story && !inActiveWork && !inPausedWork && <StoryModal story={story} onClose={() => { setStory(null); setStoryDone(true); }} />}

      {!story && !inActiveWork && !inPausedWork && (!awaitingBreak || storyDone) && levelUpQueue.length > 0 && (
        <LevelUpModal levelUp={levelUpQueue[0]} onClose={dismissLevelUp} />
      )}

      {!story && !inActiveWork && !inPausedWork && (!awaitingBreak || storyDone) && levelUpQueue.length === 0 && achieveQueue.length > 0 && (
        <AchievementModal achievement={achieveQueue[0]} onClose={closeAchieve} />
      )}

      {!story && !inActiveWork && !inPausedWork && (!awaitingBreak || storyDone) && levelUpQueue.length === 0 && achieveQueue.length === 0 && eventQueue.length > 0 && (
        <EventModal event={eventQueue[0]} onClose={closeEvent} />
      )}

      {/* 🥚 ไข่ฟักแล้ว! — modal ฉลอง (หลัง story/เลเวลอัพ/ตรา/เหตุการณ์ — ก่อนถามพัก/ข้าม) */}
      {!story && !inActiveWork && !inPausedWork && (!awaitingBreak || storyDone) && levelUpQueue.length === 0 && achieveQueue.length === 0 && eventQueue.length === 0 && hatchResult && (
        <div className="modal-backdrop">
          <div className="modal hatch-modal">
            <h2>🥚 ไข่ฟักแล้ว!</h2>
            <div className="hatch-pet-icon">{hatchResult.pet.icon}</div>
            <div className="hatch-pet-name">
              {hatchResult.pet.name}
              <span className={`hatch-rarity rarity-${hatchResult.pet.rarity}`}>{hatchResult.rarityLabel}</span>
            </div>
            {hatchResult.dup ? (
              <p className="hint">🐾 มี {hatchResult.pet.icon} {hatchResult.pet.name} อยู่ในคอกแล้ว — ไข่ฟักเป็นตัวเดิม ได้ค่าปลอบใจ <b>+{hatchResult.gold} ทอง</b></p>
            ) : (
              <p className="hint">ยินดีต้อนรับ! {hatchResult.pet.icon} {hatchResult.pet.name} ตั้งเป็นตัวที่ใช้งานแล้ว — ดูค่าพิเศษได้ที่แท็บสัตว์เลี้ยง 🐾</p>
            )}
            <div className="modal-actions">
              <button className="btn btn-primary btn-big" onClick={() => { sfx.levelup(); setHatchResult(null); }}>
                {hatchResult.dup ? 'รับทราบ' : `🐾 รับ ${hatchResult.pet.name} ไว้ดูแล!`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* กำลังรอเรื่องราว (LLM เขียนเรื่อง) — โชว์สถานะแทนหน้าจอว่าง */}
      {awaitingBreak && !storyDone && !story && (
        <div className="story-wait">
          <span className="story-wait-icon">📖</span>
          <span>กำลังเขียนเรื่องราวการผจญภัย…</span>
        </div>
      )}

      {/* จบ session — ถามว่าจะพักเบรกหรือข้ามไปโฟกัสต่อ (หลังเรื่องราว + modal รางวัลทั้งหมดจบแล้วเท่านั้น) */}
      {awaitingBreak && storyDone && !story && !hatchResult && levelUpQueue.length === 0 && achieveQueue.length === 0 && eventQueue.length === 0 && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>🎉 จบเซสชันที่ {sessionIdx}!</h2>
            <p>
              โฟกัสครบแล้ว — จะพักเบรกสักหน่อย หรือลุยต่อเลย?
              {sessionIdx >= settings.sessions_per_cycle ? ' (ครบรอบแล้ว — พักใหญ่จะได้สู้บอส! 👹)' : ''}
            </p>
            {sessionEvents.length > 0 && (
              <div className="session-summary">
                <div className="session-summary-title">📜 สรุป session นี้ ({sessionSummary.count} เหตุการณ์)</div>
                <div className="session-summary-rewards">
                  {sessionSummary.xp > 0 && <span className="reward-xp">+{sessionSummary.xp} XP</span>}
                  {sessionSummary.gold > 0 && <span className="reward-gold">+{sessionSummary.gold} ทอง</span>}
                  {sessionSummary.hpLoss > 0 && <span className="reward-hp-loss">-{sessionSummary.hpLoss} HP</span>}
                  {sessionSummary.mp > 0 && <span className="reward-mp">+{sessionSummary.mp} MP</span>}
                </div>
                {sessionSummary.items.length > 0 && (
                  <div className="session-summary-items">
                    {sessionSummary.items.map((it, i) => (
                      <span key={i} className="reward-item">🎁 {it.icon} {it.name}</span>
                    ))}
                  </div>
                )}
                {/* รายการเหตุการณ์ที่เจอใน session นี้ — โชว์ทีละอัน (สรุปย่อ) ดูรายละเอียดเต็มในแท็บ Session */}
                <div className="session-summary-list">
                  {[...sessionEvents].reverse().map((ev, i) => {
                    const parts = [];
                    if (ev.xp > 0) parts.push(`+${ev.xp} XP`);
                    if (ev.gold > 0) parts.push(`+${ev.gold} ทอง`);
                    if (ev.hpChange < 0) parts.push(`-${Math.abs(ev.hpChange)} HP`);
                    if (ev.mpChange > 0) parts.push(`+${ev.mpChange} MP`);
                    if (ev.item) parts.push(`${ev.item.icon} ${ev.item.name}`);
                    return (
                      <div className="session-summary-item" key={i}>
                        <span className="session-summary-item-title">{ev.title}</span>
                        {parts.length > 0 && <span className="session-summary-item-reward">{parts.join(' · ')}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="modal-actions">
              {sessionIdx >= settings.sessions_per_cycle ? (
                <>
                  <button className="btn btn-primary" onClick={chooseBreak}>
                    ⚔️ พักใหญ่ ({settings.long_break_min} นาที) — สู้บอส
                  </button>
                  <button className="btn" onClick={skipBreak}>⏭️ ข้ามพัก — เริ่มโฟกัสต่อ</button>
                  <button className="btn" onClick={goHomeAfterCycle}>🏠 กลับหน้าหลัก</button>
                </>
              ) : (
                <>
                  <button className="btn btn-primary" onClick={chooseBreak}>
                    ☕ พักเบรก ({settings.short_break_min} นาที)
                  </button>
                  <button className="btn" onClick={skipBreak}>⏭️ ข้ามพัก — เริ่มโฟกัสต่อ</button>
                </>
              )}
              <button className="btn btn-sm" onClick={shareSummary}>📤 แชร์สรุป session</button>
            </div>
          </div>
        </div>
      )}

      {/* พักครบเวลา — ไม่เริ่มโฟกัสเอง ให้ user กดเอง (เวลายังนับต่อเป็น overrun — ไม่มีปุ่มต่อเวลา เพราะเวลานับต่ออยู่แล้ว) */}
      {/* ระหว่างสู้บอส (หน้าจอบอสยังเปิด) ไม่เด้ง modal นี้ — กันขัดการสู้/การเลือกผลชนะ (หลังสู้เสร็จจะเข้าพักหลังชัยชนะเอง) */}
      {breakOver && !breakOverDismissed && !(phase === 'long_break' && bossState) && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>⏰ หมดเวลาพักแล้ว!</h2>
            <p>
              พักไปแล้ว <b>{fmtDuration(breakSecSoFar)}</b>
              {overrun > 0 && <> — เลยเวลามาแล้ว <b>{fmtTime(overrun)}</b></>}
              <br />
              เริ่มโฟกัสต่อได้เลย — หรือพักต่อไปอีกสักหน่อย (เวลาจะนับต่อเรื่อย ๆ)
            </p>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={finishBreak}>▶️ เริ่มโฟกัส</button>
              <button className="btn" onClick={dismissBreakOver}>⏳ ยังพักต่อ (เวลานับต่อไป)</button>
            </div>
          </div>
        </div>
      )}

      {/* กลับมาจากพักยาว 😴 — ถามว่าจะโฟกัสต่อหรือทิ้ง session (เวลาพักยาวไม่นับในสถิติ "พักกลาง session") */}
      {showLongPauseReturn && phase === 'work' && !running && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>😴 กลับมาจากพักยาว</h2>
            <p>
              ไม่อยู่นาน <b>{pauseStartedAt ? fmtDuration(Math.max(0, Math.round((Date.now() - pauseStartedAt) / 1000))) : '—'}</b>
              {pauseTitle && <> · 😴 <b>{pauseTitle}</b></>}
              <br />
              พักยาวนับแยกหมวดในสถิติ "พักยาว" (ไม่ปนกับพักกลาง session) — session ยังค้างอยู่เหมือนเดิม
            </p>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={resumeFromLongPause}>▶️ โฟกัสต่อ</button>
              <button className="btn" onClick={discardFromLongPause}>💨 ทิ้ง session</button>
            </div>
          </div>
        </div>
      )}

      {showCharSelect && (
        <CharacterSelect
          onClose={() => setShowCharSelect(false)}
          onDone={() => { setShowCharSelect(false); refresh(); }}
        />
      )}

      {expiredWork && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>⏰ เวลาโฟกัสหมดแล้ว</h2>
            <p>คุณกลับมาหลังจาก session หมดเวลา — ต้องการจะนับเซสชันนี้ไหม?</p>
            <div className="modal-actions">
              <button
                className="btn btn-primary"
                onClick={async () => {
                  setExpiredWork(false);
                  await completeWork();
                }}
              >
                ✅ จบเซสชัน รับรางวัล
              </button>
              <button className="btn" onClick={openAbortModal}>💨 ทิ้งเซสชัน</button>
            </div>
          </div>
        </div>
      )}

      {/* ทิ้ง session — ถามเหตุผล (เลือกสำเร็จรูปหรือพิมพ์เอง) → บันทึกสถิติ + ดูย้อนหลังใน log/Stats */}
      {showAbortReason && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>💨 ทิ้งเซสชันนี้?</h2>
            <p>
              {progress?.combo_shield > 0
                ? '🛡️ มีโล่โฟกัสติดตั้งอยู่ — คอมโบโฟกัสจะไม่หาย (โล่จะแตก)'
                : 'คอมโบโฟกัสจะหายไป (เริ่มใหม่จาก 1)'}
              <br />
              เลือกเหตุผลจากตัวเลือกด้านล่าง (บังคับเลือก — กดทิ้ง session ยังไม่ได้จนกว่าจะเลือก) เพื่อบันทึกเป็นสถิติ
            </p>
            {settings?.abort_week_limit > 0 && abortsThisWeek >= settings.abort_week_limit && (
              <p className="abort-warning">⚠️ สัปดาห์นี้ทิ้งไปแล้ว {abortsThisWeek} ครั้ง (เกินเกณฑ์ {settings.abort_week_limit}) — ลองพักยาว 😴 แทนการทิ้งดูไหม? คอมโบจะหายทุกครั้งที่ทิ้ง</p>
            )}
            <div className="pause-presets">
              {ABORT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`pause-preset-chip${abortReasonInput === p.full ? ' active' : ''}`}
                  onClick={() => setAbortReasonInput(p.full)}
                >
                  {p.icon} {p.label}
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" disabled={!abortReasonInput} onClick={confirmAbort}>💨 ทิ้ง session</button>
              <button className="btn" onClick={cancelAbort}>ยกเลิก</button>
            </div>
          </div>
        </div>
      )}

      {/* ทางลัด 😴 พักยาว จากแถบ Home — เลือกชื่อ/เหตุผลจากตัวเลือกก่อน (บังคับ — กันพักยาวแบบไม่ระบุ) */}
      {showLongPauseTitle && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>😴 พักยาว — เลือกเหตุผล</h2>
            <p>
              พักสั้นที่ค้างอยู่จะเปลี่ยนเป็นพักยาว (แยกหมวดสถิติ "พักยาว" ไม่นับใน "พักกลาง session")
              <br />
              ต้องเลือกเหตุผลจากตัวเลือกด้านล่างก่อน (กดเปลี่ยนเป็นพักยาว ยังไม่ได้จนกว่าจะเลือก)
            </p>
            <div className="pause-presets">
              {PAUSE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`pause-preset-chip${longPauseTitleInput === p.full ? ' active' : ''}`}
                  onClick={() => setLongPauseTitleInput(p.full)}
                >
                  {p.icon} {p.label}
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" disabled={!longPauseTitleInput} onClick={confirmLongPauseTitle}>
                😴 เปลี่ยนเป็นพักยาว
              </button>
              <button className="btn" onClick={() => setShowLongPauseTitle(false)}>ยกเลิก</button>
            </div>
          </div>
        </div>
      )}

      <Toast />
    </div>
  );
}
