import { useEffect, useRef, useState, useCallback } from 'react';
import { useGame } from './context.jsx';
import { sfx } from './sound.js';
import CharacterCreation from './components/CharacterCreation.jsx';
import HomeScreen from './components/HomeScreen.jsx';
import TimerScreen from './components/TimerScreen.jsx';
import CampScreen from './components/CampScreen.jsx';
import BossScreen from './components/BossScreen.jsx';
import EventModal from './components/EventModal.jsx';
import LevelUpModal from './components/LevelUpModal.jsx';
import Toast from './components/Toast.jsx';

const STORE_KEY = 'pomoquest-timer';

function loadTimer() {
  try {
    const t = JSON.parse(localStorage.getItem(STORE_KEY));
    if (!t || t.phase === 'idle') return null;
    if (t.expiresAt) t.remain = Math.max(0, Math.round((t.expiresAt - Date.now()) / 1000));
    return t;
  } catch {
    return null;
  }
}

export default function Game() {
  const { loading, hasCharacter, character, settings, post, get, eventQueue, closeEvent, levelUp, dismissLevelUp } = useGame();

  const [phase, setPhase] = useState('idle'); // idle | work | short_break | long_break
  const [sessionIdx, setSessionIdx] = useState(1);
  const [remain, setRemain] = useState(0);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [nextEventIn, setNextEventIn] = useState(90);
  const [expiredWork, setExpiredWork] = useState(false);
  const [bossState, setBossState] = useState(null);
  const [mounted, setMounted] = useState(false);

  const eventBusyRef = useRef(false);
  const endedRef = useRef(false);
  const phaseRef = useRef(phase);
  const sessionIdxRef = useRef(sessionIdx);
  const elapsedRef = useRef(elapsed);
  phaseRef.current = phase;
  sessionIdxRef.current = sessionIdx;
  elapsedRef.current = elapsed;

  const fetchBoss = useCallback(async () => {
    const d = await get('/boss');
    if (d && d.boss) setBossState({ boss: d.boss, log: [] });
  }, [get]);

  // ---- กู้คืน timer ตอนโหลดหน้า ----
  useEffect(() => {
    if (!hasCharacter || loading) return;
    const t = loadTimer();
    if (t) {
      setPhase(t.phase);
      setSessionIdx(t.sessionIdx || 1);
      setRemain(t.remain || 0);
      setElapsed(t.elapsed || 0);
      setNextEventIn(t.nextEventIn ?? 90);
      if (t.phase === 'work' && t.expiresAt && t.remain <= 0) {
        setExpiredWork(true); // ถามผู้ใช้ว่าจะจบหรือทิ้ง
        setRunning(false);
      } else if (t.phase === 'short_break' && t.expiresAt && t.remain <= 0) {
        // พักหมดแล้ว — เริ่มงานต่อเลย
        setSessionIdx((i) => i + 1);
        setRemain(settings.work_min * 60);
        setElapsed(0);
        setNextEventIn(settings.event_every_sec);
        setPhase('work');
        setRunning(true);
      } else if (t.phase === 'long_break' && t.expiresAt && t.remain <= 0) {
        setSessionIdx(1);
        setRemain(settings.work_min * 60);
        setElapsed(0);
        setNextEventIn(settings.event_every_sec);
        setPhase('work');
        setRunning(true);
      } else {
        setRunning(true);
      }
      if (t.phase === 'long_break') fetchBoss();
    }
    setMounted(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCharacter, loading]);

  // ---- บันทึกสถานะ timer ----
  useEffect(() => {
    if (!mounted || !hasCharacter) return;
    const t = { phase, sessionIdx, remain, running, elapsed, nextEventIn, expiresAt: running ? Date.now() + remain * 1000 : null };
    localStorage.setItem(STORE_KEY, JSON.stringify(t));
  }, [phase, sessionIdx, remain, running, elapsed, nextEventIn, mounted, hasCharacter]);

  // ---- ตัวนับถอยหลัง ----
  useEffect(() => {
    if (!running || !mounted) return;
    const id = setInterval(() => {
      setRemain((r) => Math.max(0, r - 1));
      if (phaseRef.current === 'work') {
        setElapsed((e) => e + 1);
        setNextEventIn((n) => Math.max(0, n - 1));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [running, mounted]);

  // ---- ตรวจจับจบเฟส ----
  useEffect(() => {
    if (!running || remain > 0) { endedRef.current = false; return; }
    if (endedRef.current) return;
    endedRef.current = true;
    setRunning(false);
    const p = phaseRef.current;
    if (p === 'work') completeWork();
    else if (p === 'short_break') beginWork(sessionIdxRef.current + 1);
    else if (p === 'long_break') beginWork(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remain, running]);

  const completeWork = async () => {
    sfx.complete();
    const res = await post('/adventure/complete', { focusSec: elapsedRef.current });
    if (!res) { setPhase('idle'); return; }
    if (sessionIdxRef.current >= settings.sessions_per_cycle) startLongBreak();
    else startShortBreak();
  };

  const beginWork = (idx = 1) => {
    setSessionIdx(idx);
    setRemain(settings.work_min * 60);
    setElapsed(0);
    setNextEventIn(settings.event_every_sec);
    setPhase('work');
    setRunning(true);
    sfx.start();
  };

  const startShortBreak = () => {
    setRemain(settings.short_break_min * 60);
    setPhase('short_break');
    setRunning(true);
    sfx.complete();
  };

  const startLongBreak = () => {
    setRemain(settings.long_break_min * 60);
    setPhase('long_break');
    setRunning(true);
    sfx.boss();
    fetchBoss();
  };

  // ---- เหตุการณ์สุ่มระหว่าง work session ----
  useEffect(() => {
    if (phase !== 'work' || !running || nextEventIn > 0 || eventBusyRef.current) return;
    eventBusyRef.current = true;
    (async () => {
      const res = await post('/adventure/event');
      eventBusyRef.current = false;
      setNextEventIn(settings.event_every_sec);
      if (res && res.event) sfx.event();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextEventIn, phase, running]);

  const handleAbort = async () => {
    if (!window.confirm('ทิ้งเซสชันนี้? คอมโบโฟกัสจะหายไป')) return;
    await post('/adventure/abort');
    setPhase('idle');
    setRunning(false);
    setSessionIdx(1);
    setElapsed(0);
  };

  const bossAct = async (action, itemId) => {
    const d = await post('/boss/act', { action, itemId });
    if (!d) return null;
    setBossState((s) => ({
      boss: d.boss,
      log: [...(s?.log || []), ...(d.log || [])],
      outcome: d.outcome || null,
      drop: d.item || null,
    }));
    return d;
  };

  const bossRetreat = async () => {
    await post('/boss/retreat');
    setBossState(null);
    beginWork(1);
  };

  if (loading) {
    return (
      <div className="splash">
        <div className="splash-icon">🍅⚔️</div>
        <p>กำลังโหลดโลกของ PomoQuest…</p>
      </div>
    );
  }

  if (!hasCharacter) {
    return <CharacterCreation />;
  }

  return (
    <div className="app">
      {phase === 'idle' && <HomeScreen onStart={() => beginWork(1)} />}

      {phase === 'work' && (
        <TimerScreen
          remain={remain}
          total={settings.work_min * 60}
          running={running}
          sessionIdx={sessionIdx}
          sessionsPerCycle={settings.sessions_per_cycle}
          nextEventIn={nextEventIn}
          onPause={() => { setRunning(false); sfx.pause(); }}
          onResume={() => setRunning(true)}
          onAbort={handleAbort}
        />
      )}

      {phase === 'short_break' && (
        <CampScreen
          remain={remain}
          total={settings.short_break_min * 60}
          running={running}
          onSkip={() => beginWork(sessionIdx + 1)}
        />
      )}

      {phase === 'long_break' && (
        <BossScreen
          bossState={bossState}
          remain={remain}
          total={settings.long_break_min * 60}
          running={running}
          onAct={bossAct}
          onRetreat={bossRetreat}
          onContinue={() => beginWork(1)}
        />
      )}

      {eventQueue.length > 0 && <EventModal event={eventQueue[0]} onClose={closeEvent} />}

      {levelUp && <LevelUpModal levelUp={levelUp} onClose={dismissLevelUp} />}

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
              <button
                className="btn"
                onClick={async () => {
                  setExpiredWork(false);
                  await post('/adventure/abort');
                  setPhase('idle');
                  setRunning(false);
                  setSessionIdx(1);
                  setElapsed(0);
                }}
              >
                💨 ทิ้งเซสชัน
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast />
    </div>
  );
}
