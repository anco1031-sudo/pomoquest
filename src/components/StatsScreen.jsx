import { useEffect, useState } from 'react';
import { useGame } from '../context.jsx';
import { Panel, fmtDuration } from './ui.jsx';

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

export default function StatsScreen() {
  const { get } = useGame();
  const [data, setData] = useState(null);
  const [monthMetric, setMonthMetric] = useState('sessions'); // 'sessions' | 'focus' — สลับมุมมองกราฟ 30 วัน

  useEffect(() => {
    (async () => {
      const d = await get('/stats');
      if (d) setData(d);
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

      <Panel title="☕ พักเบรกย้อนหลัง 7 วัน">
        <div className="chart">
          {data.breakDays.map((d, i) => {
            const minutes = Math.round(d.breakSec / 60);
            const h = Math.max(4, (d.breakSec / maxBreak) * 100);
            const dow = new Date(d.date + 'T12:00:00').getDay();
            return (
              <div className="chart-col" key={d.date}>
                <div className="chart-value">{minutes > 0 ? `${minutes}m` : ''}</div>
                <div className="chart-bar-wrap">
                  <div className="chart-bar chart-bar-break" style={{ height: `${h}%` }} />
                </div>
                <div className="chart-label">{DAY_NAMES[dow]}</div>
                <div className="chart-sessions">{d.overrunSec > 0 ? `เลย ${Math.round(d.overrunSec / 60)}m` : ''}</div>
              </div>
            );
          })}
        </div>
      </Panel>

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

      <Panel title="☕ สถิติการพักเบรก">
        <div className="stat-grid">
          <div className="stat-box"><b>{fmtDuration(p.break_sec)}</b><span>เวลาพักทั้งหมด</span></div>
          <div className="stat-box"><b>{p.break_extended}</b><span>ครั้งที่ต่อเวลาพัก</span></div>
          <div className="stat-box"><b>{fmtDuration(p.break_overrun_sec)}</b><span>เวลาที่เลยพักทั้งหมด</span></div>
        </div>
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
