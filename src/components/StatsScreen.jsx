import { useEffect, useState } from 'react';
import { useGame } from '../context.jsx';
import { Panel, fmtDuration } from './ui.jsx';
import { MONSTERS, BOSSES, ITEM_BY_ID } from '../../server/data.js';

const DAY_NAMES = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

// ระดับความเข้มใน heatmap — แบ่งตามนาทีที่โฟกัสต่อวัน
const heatLevel = (focusSec) => {
  const m = Math.round((focusSec || 0) / 60);
  if (m <= 0) return 0;
  if (m < 30) return 1;
  if (m < 60) return 2;
  if (m < 120) return 3;
  return 4;
};

// เปอร์เซ็นต์เทียบสัปดาห์ก่อน: 'new' (ไม่มีสัปดาห์ก่อน) / 'same' / 'upX' / 'downX'
const weekDelta = (now, prev) => {
  if (prev <= 0) return now > 0 ? 'new' : 'same';
  if (now <= 0) return 'down100';
  const d = ((now - prev) / prev) * 100;
  if (Math.abs(d) < 1) return 'same';
  return d > 0 ? `up${Math.round(d)}` : `down${Math.round(Math.abs(d))}`;
};
const DeltaBadge = ({ delta }) => {
  if (delta === 'new') return <span className="week-delta new">ใหม่</span>;
  if (delta === 'same') return <span className="week-delta same">=</span>;
  if (delta.startsWith('up')) return <span className="week-delta up">↑ {delta.slice(2)}%</span>;
  if (delta.startsWith('down')) return <span className="week-delta down">↓ {delta.slice(4)}%</span>;
  return null;
};

export default function StatsScreen() {
  const { get } = useGame();
  const [data, setData] = useState(null);
  const [week, setWeek] = useState(null);
  const [monthMetric, setMonthMetric] = useState('sessions'); // 'sessions' | 'focus' — สลับมุมมองกราฟ 30 วัน

  useEffect(() => {
    (async () => {
      const [d, w] = await Promise.all([get('/stats'), get('/weekly-summary')]);
      if (d) setData(d);
      if (w) setWeek(w);
    })();
  }, [get]);

  if (!data) return <p className="hint">กำลังโหลดสถิติ…</p>;

  const p = data.progress;
  const maxFocus = Math.max(1, ...data.days.map((d) => d.focusSec));
  const maxSessions = Math.max(1, ...data.days.map((d) => d.sessions));
  const monthDays = data.monthDays || [];
  const maxMonthSessions = Math.max(1, ...monthDays.map((d) => d.sessions));
  const maxMonthFocus = Math.max(1, ...monthDays.map((d) => d.focusSec));
  const totalMonthSessions = monthDays.reduce((a, d) => a + d.sessions, 0);
  const totalMonthMinutes = Math.round(monthDays.reduce((a, d) => a + d.focusSec, 0) / 60);
  const maxBreak = Math.max(1, ...data.breakDays.map((d) => d.breakSec));
  const maxPause = Math.max(1, ...data.breakDays.map((d) => d.pauseSec || 0));
  const maxLongPause = Math.max(1, ...data.breakDays.map((d) => d.longPauseSec || 0));

  // heatmap 91 วัน → จัดเป็นคอลัมน์รายสัปดาห์ (ขึ้นต้นวันจันทร์ เติมช่องว่างก่อนหน้าให้เต็มสัปดาห์)
  const heatCells = (() => {
    if (!data.heatmap || !data.heatmap.length) return [];
    const first = new Date(data.heatmap[0].date + 'T00:00:00');
    const leading = (first.getDay() + 6) % 7; // จันทร์ = 0 … อาทิตย์ = 6
    const cells = [...Array(leading).fill(null), ...data.heatmap];
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  })();

  return (
    <>
      <div className="stats-summary">
        <div className="stats-big">
          <b>{fmtDuration(p.total_focus_sec)}</b>
          <span>เวลาที่โฟกัสทั้งหมด</span>
        </div>
        <div className="stats-mini-grid">
          <div className="stat-box"><b>{p.sessions_completed}</b><span>session ทั้งหมด</span></div>
          <div className="stat-box"><b>{p.daily_streak}</b><span>โฟกัสติดต่อ (วัน)</span></div>
          <div className="stat-box"><b>{p.best_streak}</b><span>คอมโบสูงสุด</span></div>
          <div className="stat-box"><b>{data.achievements.unlocked}/{data.achievements.total}</b><span>ตราที่ปลดล็อก</span></div>
        </div>
      </div>

      {week && (() => {
        const t = week.thisWeek;
        const p = week.lastWeek;
        const newCities = t.cities.filter((c) => !p.cities.includes(c));
        const newAch = t.achievements.filter((a) => !p.achievements.some((x) => x.id === a.id));
        const rows = [
          { label: '⚔️ session', now: t.sessions, prev: p.sessions, fmt: (v) => `${v}` },
          { label: '⏱️ เวลาโฟกัส', now: t.focusSec, prev: p.focusSec, fmt: (v) => fmtDuration(v) },
          { label: '✨ XP ที่ได้', now: t.xp, prev: p.xp, fmt: (v) => `${v}` },
          { label: '💰 ทองที่ได้', now: t.gold, prev: p.gold, fmt: (v) => `${v}` },
          { label: '👹 บอสที่ชนะ', now: t.bossWins, prev: p.bossWins, fmt: (v) => `${v}` },
          { label: '🗡️ มอนสเตอร์', now: t.monsterWins, prev: p.monsterWins, fmt: (v) => `${v}` },
          { label: '🗺️ เมืองที่ไป', now: t.cities.length, prev: p.cities.length, fmt: (v) => `${v}` },
          { label: '🏅 ตราที่ปลดล็อก', now: t.achievements.length, prev: p.achievements.length, fmt: (v) => `${v}` },
        ];
        return (
          <Panel title="📋 สรุปรายสัปดาห์ (เทียบสัปดาห์ก่อน)">
            <div className="week-grid">
              {rows.map((r) => (
                <div className="week-item" key={r.label}>
                  <div className="week-label">{r.label}</div>
                  <div className="week-now">{r.fmt(r.now)}</div>
                  <DeltaBadge delta={weekDelta(r.now, r.prev)} />
                </div>
              ))}
            </div>
            {newCities.length > 0 && <div className="week-extra">🆕 เมืองใหม่: {newCities.join(' · ')}</div>}
            {newAch.length > 0 && <div className="week-extra">🆕 ตราใหม่: {newAch.map((a) => `${a.icon} ${a.name}`).join(' · ')}</div>}
            {t.sessions === 0 && p.sessions === 0 && (
              <p className="hint">ยังไม่มี session ใน 2 สัปดาห์นี้ — เริ่มโฟกัสเพื่อสร้างสถิติ!</p>
            )}
          </Panel>
        );
      })()}

      <Panel title="📅 โฟกัสย้อนหลัง 7 วัน">
        <div className="chart">
          {data.days.map((d, i) => {
            const minutes = Math.round(d.focusSec / 60);
            const h = Math.max(4, (d.focusSec / maxFocus) * 100);
            const dow = new Date(d.date + 'T12:00:00').getDay();
            return (
              <div className="chart-col" key={d.date}>
                <div className="chart-value">{minutes > 0 ? `${minutes}m` : ''}</div>
                <div className="chart-bar-wrap">
                  <div className="chart-bar" style={{ height: `${h}%` }} />
                </div>
                <div className="chart-label">{DAY_NAMES[dow]}</div>
                <div className="chart-sessions">{d.sessions > 0 ? `x${d.sessions}` : ''}</div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="🎯 จำนวน Session ย้อนหลัง 7 วัน">
        <div className="chart">
          {data.days.map((d) => {
            const h = Math.max(4, (d.sessions / maxSessions) * 100);
            const dow = new Date(d.date + 'T12:00:00').getDay();
            return (
              <div className="chart-col" key={d.date}>
                <div className="chart-value">{d.sessions > 0 ? `x${d.sessions}` : ''}</div>
                <div className="chart-bar-wrap">
                  <div className="chart-bar chart-bar-session" style={{ height: `${h}%` }} />
                </div>
                <div className="chart-label">{DAY_NAMES[dow]}</div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel
        title={`📅 30 วัน — ${
          monthMetric === 'sessions'
            ? `จำนวน Session (${totalMonthSessions})`
            : `เวลาโฟกัส (${totalMonthMinutes} นาที)`
        }`}
      >
        <div className="chart-toggle">
          <button
            className={`chart-toggle-btn ${monthMetric === 'sessions' ? 'active' : ''}`}
            onClick={() => setMonthMetric('sessions')}
          >
            🎯 จำนวน Session
          </button>
          <button
            className={`chart-toggle-btn ${monthMetric === 'focus' ? 'active' : ''}`}
            onClick={() => setMonthMetric('focus')}
          >
            ⏱️ เวลาโฟกัส
          </button>
        </div>
        <div className="chart chart-dense">
          {monthDays.map((d) => {
            const isSession = monthMetric === 'sessions';
            const val = isSession ? d.sessions : Math.round(d.focusSec / 60);
            const max = isSession ? maxMonthSessions : maxMonthFocus;
            const h = Math.max(2, (val / max) * 100);
            return (
              <div
                className="chart-col"
                key={d.date}
                title={`${d.date} · ${isSession ? `${d.sessions} session` : `${Math.round(d.focusSec / 60)} นาที`}`}
              >
                <div className="chart-bar-wrap">
                  <div
                    className={`chart-bar ${isSession ? 'chart-bar-session' : ''}`}
                    style={{ height: `${h}%` }}
                  />
                </div>
                <div className="chart-label">{d.date.slice(8)}</div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="☕ เวลาพักย้อนหลัง 7 วัน">
        <div className="chart-legend">
          <span className="legend-item"><i className="legend-dot legend-break" /> พักเบรกระหว่าง session</span>
          <span className="legend-item"><i className="legend-dot legend-pause" /> พักกลาง session (⏸️ พักสั้น)</span>
          <span className="legend-item"><i className="legend-dot legend-long" /> พักยาว 😴 (นอน/ธุระ)</span>
        </div>
        <div className="chart">
          {data.breakDays.map((d, i) => {
            const breakM = Math.round(d.breakSec / 60);
            const pauseM = Math.round((d.pauseSec || 0) / 60);
            const longM = Math.round((d.longPauseSec || 0) / 60);
            const totalM = breakM + pauseM + longM;
            const hBreak = Math.max(4, (d.breakSec / maxBreak) * 100);
            const hPause = Math.max(4, ((d.pauseSec || 0) / maxPause) * 100);
            const hLong = Math.max(4, ((d.longPauseSec || 0) / maxLongPause) * 100);
            const dow = new Date(d.date + 'T12:00:00').getDay();
            return (
              <div className="chart-col" key={d.date}>
                <div className="chart-value">{totalM > 0 ? `${totalM}m` : ''}</div>
                <div className="chart-bar-group">
                  <div className="chart-bar-wrap">
                    <div className="chart-bar chart-bar-break" style={{ height: `${hBreak}%` }} />
                  </div>
                  <div className="chart-bar-wrap">
                    <div className="chart-bar chart-bar-pause" style={{ height: `${hPause}%` }} />
                  </div>
                  <div className="chart-bar-wrap">
                    <div className="chart-bar chart-bar-long" style={{ height: `${hLong}%` }} />
                  </div>
                </div>
                <div className="chart-label">{DAY_NAMES[dow]}</div>
                <div className="chart-sessions">{d.overrunSec > 0 ? `เลย ${Math.round(d.overrunSec / 60)}m` : ''}</div>
              </div>
            );
          })}
        </div>
      </Panel>

      {data.tasks && data.tasks.length > 0 && (
        <Panel title="📋 สถิติแยกตามงาน (30 วัน)">
          <div className="task-list">
            {data.tasks.map((t) => (
              <div className="task-row" key={t.task}>
                <span className="task-name">📌 {t.task}</span>
                <span className="task-val">{fmtDuration(t.focus_sec)}</span>
                <span className="task-sessions">x{t.sessions} session</span>
              </div>
            ))}
          </div>
          <p className="hint">💡 ตั้งชื่องานก่อนเริ่มโฟกัส (หน้าแรก) — ดูได้ว่าเวลาไปกับอะไรบ้าง</p>
        </Panel>
      )}

      <Panel title="🔥 Heatmap โฟกัส (12 สัปดาห์)">
        <div className="heat-wrap">
          <div className="heat-labels">
            <span>จ</span><span /><span>พ</span><span /><span>ศ</span><span /><span>อา</span>
          </div>
          <div className="heat-grid">
            {heatCells.map((c, i) => (
              <div
                key={i}
                className={`heat-cell ${c ? `l${heatLevel(c.focusSec)}` : 'pad'}`}
                title={c ? `${c.date} · ${Math.round(c.focusSec / 60)} นาที` : ''}
              />
            ))}
          </div>
        </div>
        <div className="heat-legend">
          <span>น้อย</span>
          <div className="heat-cell l0" />
          <div className="heat-cell l1" />
          <div className="heat-cell l2" />
          <div className="heat-cell l3" />
          <div className="heat-cell l4" />
          <span>มาก</span>
        </div>
      </Panel>

      <Panel title="⚔️ สถิติการต่อสู้">
        <div className="stat-grid">
          <div className="stat-box"><b>{p.gold_earned}</b><span>ทองที่หาได้</span></div>
          <div className="stat-box"><b>{p.monsters_slain}</b><span>มอนสเตอร์ที่กำจัด</span></div>
          <div className="stat-box"><b>{p.treasures_found}</b><span>สมบัติที่เจอ</span></div>
          <div className="stat-box"><b>{p.quests_completed}</b><span>ภารกิจสำเร็จ</span></div>
          <div className="stat-box"><b>{p.bosses_defeated}</b><span>บอสที่ชนะ</span></div>
          <div className="stat-box"><b>{p.cycles_completed}</b><span>รอบที่เดินทาง</span></div>
          <div className="stat-box"><b>{p.boss_potions}</b><span>ยาที่ใช้สู้บอส</span></div>
          <div className="stat-box"><b>{p.traps}</b><span>กับดักที่โดน</span></div>
        </div>
      </Panel>

      <Panel title="☕ สถิติการพัก">
        <div className="stat-grid">
          <div className="stat-box"><b>{fmtDuration(p.break_sec)}</b><span>เวลาพักเบรกระหว่าง session</span></div>
          <div className="stat-box"><b>{fmtDuration(p.break_overrun_sec)}</b><span>เวลาที่เลยพักทั้งหมด</span></div>
          <div className="stat-box"><b>{fmtDuration(p.pause_sec || 0)}</b><span>พักกลาง session (⏸️ พักสั้น)</span></div>
          <div className="stat-box"><b>{fmtDuration(p.long_pause_sec || 0)}</b><span>พักยาว 😴 (นอน/ทานข้าว/ธุระ)</span></div>
        </div>
        <p className="hint">⏸️ พักสั้น = กดหยุดพัก/กลับหน้าหลักระหว่างโฟกัส (นับใน "พักกลาง session") · 😴 พักยาว = เลือกตอนกดพัก ตั้งชื่อเหตุผลได้ (แยกหมวดสถิติ "พักยาว") — ทั้งคู่ไม่สะสม XP ระหว่างพัก</p>
      </Panel>

      {data.longPauseTitles && data.longPauseTitles.length > 0 && (
        <Panel title="😴 พักยาวแยกตามชื่อ (30 วัน)">
          <div className="task-list">
            {data.longPauseTitles.map((t) => (
              <div className="task-row" key={t.title}>
                <span className="task-name">{t.title}</span>
                <span className="task-val">{fmtDuration(t.sec)}</span>
                <span className="task-sessions">x{t.times} ครั้ง</span>
              </div>
            ))}
          </div>
          <p className="hint">💡 ตั้งชื่อพักยาวจากตัวเลือกสำเร็จรูป (หรือพิมพ์เอง) — ดูได้ว่าเวลาไปกับอะไรบ้าง</p>
        </Panel>
      )}

      {(data.bmStats?.buys > 0 || data.bmStats?.sells > 0) && (
        <Panel title="🖤 สถิติตลาดมืด">
          <div className="stat-grid">
            <div className="stat-box"><b>{data.bmStats.buys}</b><span>ซื้อของจากตลาดมืด</span></div>
            <div className="stat-box"><b>{data.bmStats.sells}</b><span>ขายของให้ตลาดมืด</span></div>
            <div className="stat-box"><b>{data.bmStats.buyGold.toLocaleString()}</b><span>ทองที่ใช้ซื้อ</span></div>
            <div className="stat-box"><b>{data.bmStats.sellGold.toLocaleString()}</b><span>ทองที่ได้จากการขาย</span></div>
            <div className={`stat-box ${data.bmStats.profit >= 0 ? '' : 'stat-box-neg'}`}>
              <b>{data.bmStats.profit >= 0 ? '+' : ''}{data.bmStats.profit.toLocaleString()}</b>
              <span>กำไรสุทธิจากการค้า</span>
            </div>
          </div>
          <p className="hint">🖤 เจอตลาดมืดที่ค่ายพัก (สุ่ม ~25%) — ขายของขวัญแพงกว่า +25% และซื้อของหายากลดราคา</p>
        </Panel>
      )}

      <Panel title="🐾 คู่มือล่า (ของที่ดรอป)">
        <div className="guide-table">
          <div className="guide-table-title">🐺 มอนสเตอร์ — ชนะมีโอกาส ~40% ได้ของประจำตัว</div>
          {MONSTERS.map((m) => {
            const loot = ITEM_BY_ID[m.loot];
            return (
              <div className="guide-row-lite" key={m.name}>
                <span className="guide-mob">{m.icon} {m.name}</span>
                <span className="guide-mob-power">พลัง {m.power}</span>
                <span className="guide-mob-loot">{loot ? `${loot.icon} ${loot.name} (${loot.price} ทอง)` : '—'}</span>
              </div>
            );
          })}
          <div className="guide-table-title">👹 บอส — ชนะมีโอกาส ~50% ได้ของรางวัลประจำตัว (ขายแพง)</div>
          {BOSSES.map((b) => {
            const loot = ITEM_BY_ID[b.loot];
            return (
              <div className="guide-row-lite" key={b.name}>
                <span className="guide-mob">{b.icon} {b.name}</span>
                <span className="guide-mob-power" />
                <span className="guide-mob-loot">{loot ? `${loot.icon} ${loot.name} (${loot.price} ทอง)` : '—'}</span>
              </div>
            );
          })}
        </div>
        <p className="hint">💡 ของที่ดรอปเป็นของขวัญ (junk) — ขายได้ที่แคมป์ และนับรวมในเควสประจำวัน "คนเก็บขยะ"</p>
      </Panel>

      {data.cityLogs.length > 0 && (
        <Panel title="🗺️ เส้นทางการเดินทาง">
          <div className="city-log">
            {data.cityLogs.map((l, i) => (
              <div className="city-log-item" key={i}>📍 {l.detail}</div>
            ))}
          </div>
        </Panel>
      )}

      <p className="hint">
        ตัวละคร: {data.character.name} ({data.character.className}) · อยู่ที่ {data.character.city.icon} {data.character.city.name}
      </p>
    </>
  );
}
