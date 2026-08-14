import { useEffect, useState } from 'react';
import { useGame } from '../context.jsx';
import { sfx } from '../sound.js';
import { Panel } from './ui.jsx';

const REWARD_SHORT = { gold: 'ทอง', xp: 'XP', item: 'ไอเทม' };

export default function DailyQuests() {
  const { daily, get, post, character } = useGame();
  const [local, setLocal] = useState(null);
  const [chooseFor, setChooseFor] = useState(null);
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

  const claim = async (q, reward) => {
    sfx.click();
    await post('/daily/claim', { questId: q.id, reward });
    setChooseFor(null);
  };

  const goldAmt = 40 + (character?.level || 1) * 6;
  const xpAmt = 30 + (character?.level || 1) * 4;

  const RewardChoices = ({ q }) => (
    <div className="daily-choices">
      <div className="daily-choices-label">เลือกรางวัล:</div>
      <div className="daily-choices-btns">
        <button className="btn btn-sm" onClick={() => claim(q, 'gold')}>💰 {goldAmt} ทอง</button>
        <button className="btn btn-sm" onClick={() => claim(q, 'xp')}>✨ {xpAmt} XP</button>
        <button className="btn btn-sm" onClick={() => claim(q, 'item')}>🎁 ไอเทมสุ่ม</button>
      </div>
    </div>
  );

  const claimAll = async () => {
    sfx.click();
    await post('/daily/claim-all');
  };

  return (
    <Panel title={`📅 ภารกิจประจำวัน (${data.date})`}>
      <p className="panel-text">รีเซ็ตทุกวันเที่ยงคืน — ทำแล้วรับรางวัลพิเศษ!</p>
      {data.streak > 0 && (
        <div className="daily-streak-chip">
          🔥 ภารกิจติดต่อ {data.streak} วัน{data.nextStreak > data.streak ? ` — ทำวันนี้ครบ = ${data.nextStreak} วัน` : ''}
        </div>
      )}

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
                <span className="daily-claimed">✓ รับแล้ว{q.claimedReward ? ` (${REWARD_SHORT[q.claimedReward]})` : ''}</span>
              ) : q.complete ? (
                chooseFor === q.id ? (
                  <RewardChoices q={q} />
                ) : (
                  <button className="btn btn-sm btn-primary" onClick={() => setChooseFor(q.id)}>รับรางวัล</button>
                )
              ) : (
                <span className="daily-locked">ยังไม่เสร็จ</span>
              )}
            </div>
          );
        })}
      </div>

      {allDone && !allClaimed && (
        <div className="daily-bonus">
          <div className="daily-bonus-text">
            🎁 ทำครบทุกภารกิจ! รับโบนัส: <b>ทอง + XP</b> และไอเทม
            <span className="daily-bonus-mult">x{data.bonusMult.toFixed(1)}</span>
            {data.nextStreak > 1 && <span className="daily-streak-note">🔥 {data.nextStreak} วันติด!</span>}
          </div>
          <button className="btn btn-primary btn-big" onClick={claimAll}>รับโบนัส ✨</button>
        </div>
      )}
      {allClaimed && <div className="daily-bonus done">🎉 รับครบทุกภารกิจแล้ว — เยี่ยมมาก!</div>}
    </Panel>
  );
}
