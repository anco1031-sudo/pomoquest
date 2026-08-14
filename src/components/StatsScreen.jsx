import { useEffect, useState } from 'react';
import { useGame } from '../context.jsx';
import { Panel, fmtDuration } from './ui.jsx';

const DAY_NAMES = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

export default function StatsScreen() {
  const { get } = useGame();
  const [data, setData] = useState(null);

  useEffect(() => {
    (async () => {
      const d = await get('/stats');
      if (d) setData(d);
    })();
  }, [get]);

  if (!data) return <p className="hint">กำลังโหลดสถิติ…</p>;

  const p = data.progress;
  const maxFocus = Math.max(1, ...data.days.map((d) => d.focusSec));

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
