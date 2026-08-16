import { useEffect, useState } from 'react';
import { useGame } from '../context.jsx';
import { Panel } from './ui.jsx';
import { sfx } from '../sound.js';

export default function StoryQuests() {
  const { get, post, showToast, character } = useGame();
  const [data, setData] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    get('/story').then((d) => d && setData(d));
  }, [get, character?.id]);

  if (!data) return <p className="hint">กำลังโหลดเนื้อเรื่อง…</p>;

  // แสดงเฉพาะเควสต์ของเมืองที่ปลดล็อกแล้ว (เดินทางไปถึง) + เมืองปัจจุบัน
  const maxCity = character?.cityIndex ?? 99;
  const visible = data.quests.filter((q) => q.cityIndex <= maxCity);

  const claim = async (q) => {
    sfx.click();
    setBusyId(q.id);
    const d = await post('/story/claim', { questId: q.id });
    setBusyId(null);
    if (d) {
      showToast(d.message || 'รับรางวัลแล้ว');
      const fresh = await get('/story');
      if (fresh) setData(fresh);
    }
  };

  return (
    <Panel title={`📖 เนื้อเรื่อง (${data.doneCount}/${data.total})`}>
      <p className="panel-text">
        เควสต์เนื้อเรื่องปลดล็อกตามความคืบหน้าของคุณ (ชนะบอส / จำนวน session / เลเวล) — รับรางวัลได้ครั้งเดียวต่อเควสต์
      </p>
      {visible.length === 0 && <p className="hint">ยังไม่มีเมืองที่ปลดล็อก — เดินทางผจญภัยต่อเพื่อเปิดเนื้อเรื่องของเมืองถัดไป</p>}
      {visible.map((q) => (
        <div className={`story-card ${q.status}`} key={q.id}>
          <div className="story-top">
            <span className="story-icon">{q.icon}</span>
            <div className="story-info">
              <div className="story-title">
                {q.title} <span className="story-city">{q.city.icon} {q.city.name}</span>
              </div>
              <div className="story-desc">{q.desc}</div>
              <div className="story-req">🔎 {q.reqLabel}</div>
            </div>
          </div>
          <div className="story-rewards">
            <span className="reward-gold">+{q.reward.gold} ทอง</span>
            <span className="reward-xp">+{q.reward.xp} XP</span>
            {q.status === 'done' ? (
              <span className="story-done-tag">✅ รับรางวัลแล้ว</span>
            ) : q.status === 'claimable' ? (
              <button className="btn btn-sm btn-primary" disabled={busyId === q.id} onClick={() => claim(q)}>🎁 รับรางวัล</button>
            ) : (
              <span className="story-lock-tag">🔒 ยังไม่ปลดล็อก</span>
            )}
          </div>
        </div>
      ))}
    </Panel>
  );
}
