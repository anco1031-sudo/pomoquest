import { useEffect, useState } from 'react';
import { useGame } from '../context.jsx';
import { sfx } from '../sound.js';
import { Panel } from './ui.jsx';

export default function DailyQuests() {
  const { daily, get, post } = useGame();
  const [local, setLocal] = useState(null);
  const data = daily || local;

  useEffect(() => {
    if (!daily) {
      (async () => {
        const d = await get('/daily');
        if (d && d.daily) setLocal(d.daily);
      })();
    }
  }, [daily, get]);

  if (!data) return null;
  const { quests, allDone, allClaimed } = data;

  const claim = async (q) => {
    sfx.click();
    await post('/daily/claim', { questId: q.id });
  };

  const claimAll = async () => {
    sfx.click();
    await post('/daily/claim-all');
  };

  return (
    <Panel title={`📅 ภารกิจประจำวัน (${data.date})`}>
      <p className="panel-text">รีเซ็ตทุกวันเที่ยงคืน — ทำแล้วรับรางวัลพิเศษ!</p>

      <div className="daily-list">
        {quests.map((q) => {
          const pct = q.target > 0 ? Math.min(100, (q.current / q.target) * 100) : 0;
          return (
            <div className={`daily-card ${q.complete ? 'complete' : ''}`} key={q.id}>
              <div className="daily-icon">{q.icon}</div>
              <div className="daily-body">
                <div className="daily-name">{q.name}</div>
                <div className="daily-desc">{q.desc}</div>
                <div className="daily-progress">
                  <div className="bar">
                    <div
                      className="bar-fill"
                      style={{ width: `${pct}%`, background: q.complete ? 'linear-gradient(90deg,#22c55e,#4ade80)' : 'linear-gradient(90deg,#8b5cf6,#f5b942)' }}
                    />
                  </div>
                  <span className="daily-count">
                    {q.unit === 'min' ? `${q.displayCurrent}/${q.display} นาที` : `${q.current}/${q.target}`}
                  </span>
                </div>
              </div>
              {q.claimed ? (
                <span className="daily-claimed">✓ รับแล้ว</span>
              ) : (
                <button className="btn btn-sm" disabled={!q.complete} onClick={() => claim(q)}>
                  {q.complete ? 'รับรางวัล' : 'ยังไม่เสร็จ'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {allDone && !allClaimed && (
        <div className="daily-bonus">
          <div className="daily-bonus-text">
            🎁 ทำครบทุกภารกิจ! รับโบนัสพิเศษ: <b>ทอง + XP</b> และไอเทม
          </div>
          <button className="btn btn-primary btn-big" onClick={claimAll}>รับโบนัส ✨</button>
        </div>
      )}
      {allClaimed && <div className="daily-bonus done">🎉 รับครบทุกภารกิจแล้ว — เยี่ยมมาก!</div>}
    </Panel>
  );
}
