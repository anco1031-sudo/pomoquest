import { useEffect, useState } from 'react';
import { useGame } from '../context.jsx';
import { Bar, Panel } from './ui.jsx';
import { sfx } from '../sound.js';

const storeKey = (charId) => `pomoquest-challenge-${charId}`;

// encode/decode รหัสชาเลนจ์ — base64url ของ JSON {t, v, n} (t: 'sessions'|'min')
const enc = (o) =>
  btoa(unescape(encodeURIComponent(JSON.stringify(o))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const dec = (s) => {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))));
  } catch {
    return null;
  }
};

const fmtDate = (d) => {
  const [y, m, day] = d.split('-').map(Number);
  return `${day}/${m}/${String(y).slice(2)}`;
};

export default function ChallengeTab() {
  const { character, get, showToast } = useGame();
  const [prog, setProg] = useState(null);
  const [type, setType] = useState('sessions'); // sessions | min
  const [target, setTarget] = useState(5);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState(null); // ชาเลนจ์ที่กำลังเล่น {t, v, n}
  const [invite, setInvite] = useState(null); // ชาเลนจ์ที่แปะจากลิงก์/รหัส — รอรับ
  const [codeInput, setCodeInput] = useState('');

  const load = async () => {
    const d = await get('/challenge/progress');
    if (d && !d.error) setProg(d);
  };
  useEffect(() => {
    load();
  }, [character?.id]);

  // โหลดชาเลนจ์ที่เล่นอยู่ + ตรวจ ?challenge= จากลิงก์ที่เปิดมา
  useEffect(() => {
    const saved = localStorage.getItem(storeKey(character?.id));
    if (saved) {
      try {
        setGoal(JSON.parse(saved));
      } catch {
        /* ignore */
      }
    }
    try {
      const q = new URLSearchParams(location.search).get('challenge');
      if (q) {
        const g = dec(q);
        if (g && g.t && g.v > 0) {
          setInvite(g);
          history.replaceState(null, '', location.pathname); // ล้าง param ไม่ให้เด้งซ้ำเมื่อรีเฟรช
        }
      }
    } catch {
      /* ignore */
    }
  }, [character?.id]);

  if (!prog) return <p className="hint">กำลังโหลดชาเลนจ์…</p>;

  const desc = (g) => (g.t === 'min' ? `โฟกัส ${g.v} นาที` : `โฟกัส ${g.v} sessions`);

  const share = async (text) => {
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        /* ยกเลิกการแชร์ */
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast('📋 คัดลอกข้อความแล้ว — ไปแปะแชร์ได้เลย');
    } catch {
      showToast('⚠️ คัดลอกไม่ได้ — ลองกดแชร์อีกครั้ง');
    }
  };

  // สร้างชาเลนจ์ใหม่ → ตั้งเป้า + แชร์ลิงก์เชิญ
  const create = async () => {
    sfx.click();
    const v = Math.max(1, Number(target) || 5);
    const g = { t: type, v, n: name.trim() || character.name };
    setGoal(g);
    localStorage.setItem(storeKey(character.id), JSON.stringify(g));
    const link = `${location.origin}${location.pathname}?challenge=${enc(g)}`;
    showToast(`🔥 ตั้งเป้าแล้ว: ${desc(g)} สัปดาห์นี้`);
    await share(
      `🔥 PomoQuest ชาเลนจ์จาก ${g.n}: ${desc(g)} ภายในสัปดาห์นี้ (${fmtDate(prog.weekStart)}–${fmtDate(prog.weekEnd)})!\nรับชาเลนจ์: ${link}`
    );
  };

  // วางรหัส/ลิงก์ → แสดงชาเลนจ์รอรับ
  const join = () => {
    sfx.click();
    const raw = codeInput.trim();
    const code = raw.includes('challenge=') ? raw.split('challenge=')[1].split('&')[0] : raw;
    const g = dec(code);
    if (!g || !g.t || !(g.v > 0)) {
      showToast('⚠️ รหัสชาเลนจ์ไม่ถูกต้อง — ลองวางลิงก์เชิญทั้งลิงก์');
      return;
    }
    setInvite(g);
    setCodeInput('');
  };

  // รับชาเลนจ์ → ตั้งเป้าในเครื่อง
  const accept = () => {
    sfx.click();
    setGoal(invite);
    localStorage.setItem(storeKey(character.id), JSON.stringify(invite));
    showToast(`🔥 รับชาเลนจ์จาก ${invite.n} แล้ว — ${desc(invite)}! สู้ๆ 💪`);
    setInvite(null);
  };

  // เปรียบเทียบ progress กับเป้า
  const done = goal?.t === 'min' ? Math.round((prog.focusSec || 0) / 60) : prog.sessions || 0;
  const doneLabel = goal?.t === 'min' ? `${done} นาที` : `${done} sessions`;
  const targetLabel = goal?.t === 'min' ? `${goal.v} นาที` : `${goal.v} sessions`;
  const pct = goal ? Math.min(100, Math.round((done / goal.v) * 100)) : 0;

  const shareResult = async () => {
    sfx.click();
    const ok = done >= goal.v;
    const base = goal.t === 'min'
      ? `โฟกัสรวม ${Math.round((prog.focusSec || 0) / 60)} นาที`
      : `จบ ${prog.sessions || 0} sessions`;
    await share(
      `🏆 ผลชาเลนจ์ ${goal.n} (${fmtDate(prog.weekStart)}–${fmtDate(prog.weekEnd)}):\nเป้า ${targetLabel} — ฉันทำได้ ${doneLabel} (${pct}%)\n${ok ? '🎉 ผ่านเป้าแล้ว!' : '💪 ยังไม่ถึงเป้า สู้ต่อ!'} · ${base}`
    );
  };

  return (
    <>
      <Panel title="🔥 ชาเลนจ์รายสัปดาห์" icon="🔥">
        <p className="panel-text">
          ตั้งเป้าโฟกัสของสัปดาห์นี้ (จันทร์–อาทิตย์) แล้วแชร์รหัสให้เพื่อนมาร่วมลุยแบบ async — แต่ละคนเล่นคนเดียว
          แล้วเอามาเทียบผลกันตอนจบสัปดาห์ ไม่ต้องโฟกัสพร้อมกัน ไม่ต้องมีเซิร์ฟเวอร์กลาง!
        </p>
        {goal ? (
          <div className="challenge-goal">
            <div className="challenge-goal-title">
              🎯 ชาเลนจ์จาก {goal.n}: {desc(goal)}
              <button className="btn btn-sm" onClick={() => { setGoal(null); localStorage.removeItem(storeKey(character.id)); sfx.click(); }}>ยกเลิก</button>
            </div>
            <Bar value={done} max={goal.v} color="linear-gradient(90deg,#f59e0b,#ef4444)" label={`${doneLabel} / ${targetLabel} (${pct}%)`} />
            <p className={`challenge-status ${done >= goal.v ? 'ok' : ''}`}>
              {done >= goal.v ? '🎉 ถึงเป้าแล้ว! รักษาไว้ถึงวันอาทิตย์' : `💪 อีก ${goal.v - done} ${goal.t === 'min' ? 'นาที' : 'session'} ถึงเป้า — สู้ต่อ!`}
            </p>
            <div className="challenge-actions">
              <button className="btn btn-primary" onClick={shareResult}>📤 แชร์ผลของฉัน</button>
              <button className="btn" onClick={() => {
                const link = `${location.origin}${location.pathname}?challenge=${enc(goal)}`;
                share(`🔥 PomoQuest ชาเลนจ์จาก ${goal.n}: ${desc(goal)} ภายในสัปดาห์นี้ (${fmtDate(prog.weekStart)}–${fmtDate(prog.weekEnd)})!\nรับชาเลนจ์: ${link}`);
              }}>📨 แชร์ชวนเพื่อน</button>
            </div>
          </div>
        ) : (
          <p className="hint" style={{ marginTop: 0 }}>ยังไม่มีชาเลนจ์ — สร้างชาเลนจ์ของตัวเอง หรือรับชาเลนจ์จากเพื่อนด้านล่าง</p>
        )}
      </Panel>

      {/* รับชาเลนจ์จากลิงก์/รหัส */}
      {invite ? (
        <div className="modal-backdrop" onClick={() => setInvite(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>🔥 ชาเลนจ์จาก {invite.n}</h2>
            <p className="hint" style={{ fontSize: 15 }}>🎯 {desc(invite)} ภายในสัปดาห์นี้ ({fmtDate(prog.weekStart)}–{fmtDate(prog.weekEnd)})</p>
            <p className="panel-text">รับชาเลนจ์นี้เลยไหม? — จะตั้งเป้าให้คุณทันที แล้วไปลุยด้วยกันแบบ async!</p>
            <div className="challenge-actions">
              <button className="btn btn-primary" onClick={accept}>🔥 รับชาเลนจ์!</button>
              <button className="btn" onClick={() => setInvite(null)}>ไม่เอาดีกว่า</button>
            </div>
          </div>
        </div>
      ) : (
        <Panel title="🔗 รับชาเลนจ์จากเพื่อน" icon="🔗">
          <p className="panel-text">วางรหัสหรือลิงก์เชิญของเพื่อน แล้วกด "ดูชาเลนจ์"</p>
          <div className="challenge-join">
            <input
              className="input"
              placeholder="https://…?challenge=xxxx หรือวางรหัส"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && join()}
            />
            <button className="btn" onClick={join}>ดูชาเลนจ์</button>
          </div>
        </Panel>
      )}

      {/* สร้างชาเลนจ์ใหม่ */}
      <Panel title="🆕 สร้างชาเลนจ์" icon="🆕">
        <div className="challenge-form">
          <div className="challenge-form-row">
            <label>เป้า:</label>
            <select className="input" value={type} onChange={(e) => setType(e.target.value)} style={{ maxWidth: 150 }}>
              <option value="sessions">จำนวน sessions</option>
              <option value="min">นาทีโฟกัส</option>
            </select>
            <input
              className="input"
              type="number"
              min={1}
              max={999}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              style={{ maxWidth: 90 }}
            />
          </div>
          <div className="challenge-form-row">
            <label>ชื่อผู้ท้า:</label>
            <input className="input" placeholder={character.name} value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
          </div>
          <button className="btn btn-primary btn-big" onClick={create}>
            🔥 สร้างชาเลนจ์ + แชร์เชิญ
          </button>
        </div>
      </Panel>

      {/* progress รายวันสัปดาห์นี้ */}
      <Panel title={`📅 สัปดาห์นี้ (${fmtDate(prog.weekStart)} – ${fmtDate(prog.weekEnd)})`} icon="📅">
        <div className="challenge-days">
          {prog.days.map((d) => (
            <div className={`challenge-day ${d.sessions > 0 ? 'done' : ''}`} key={d.date} title={`${d.date}: ${d.sessions} session · ${Math.round(d.focusSec / 60)} นาที`}>
              <span className="challenge-day-wd">{d.weekday}</span>
              <span className="challenge-day-val">
                {d.sessions > 0 ? `${d.sessions}${d.focusSec >= 3600 ? '🔥' : ''}` : '·'}
              </span>
            </div>
          ))}
        </div>
        <p className="hint">รวมสัปดาห์นี้: {prog.sessions} sessions · {Math.round(prog.focusSec / 60)} นาที</p>
      </Panel>

      {/* ประวัติสัปดาห์เก่า */}
      <Panel title="🗓️ ประวัติ 8 สัปดาห์" icon="🗓️">
        {prog.prevWeeks.map((w) => (
          <div className="challenge-prev" key={w.weekStart}>
            <span className="challenge-prev-week">{fmtDate(w.weekStart)}</span>
            <span className="challenge-prev-val">{w.sessions} sessions</span>
            <span className="challenge-prev-val">{Math.round(w.focusSec / 60)} นาที</span>
          </div>
        ))}
      </Panel>
    </>
  );
}
