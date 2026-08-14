import { useEffect, useState } from 'react';
import { useGame } from '../context.jsx';
import { Panel } from './ui.jsx';

function fmtAchieveDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso + 'Z');
    return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

export default function AchievementList() {
  const { get, showToast } = useGame();
  const [data, setData] = useState(null);

  useEffect(() => {
    (async () => {
      const d = await get('/achievements');
      if (d && d.achievements) setData(d.achievements);
      else showToast('ยังไม่มีตัวละคร');
    })();
  }, [get, showToast]);

  if (!data) return <p className="hint">กำลังโหลดตรา…</p>;

  const unlockedList = data.list.filter((a) => a.unlocked);
  const lockedList = data.list.filter((a) => !a.unlocked);

  return (
    <>
      <div className="achieve-summary">
        🏅 ปลดล็อกแล้ว <b>{data.unlocked}</b> / {data.total}
      </div>

      {unlockedList.length > 0 && (
        <Panel title="✨ ตราที่ปลดล็อกแล้ว">
          <div className="achieve-grid">
            {unlockedList.map((a) => (
              <div className="achieve-card unlocked" key={a.id}>
                <div className="achieve-icon">{a.icon}</div>
                <div className="achieve-body">
                  <div className="achieve-name">{a.name}</div>
                  <div className="achieve-desc">{a.desc}</div>
                  <div className="achieve-date">ปลดล็อก {fmtAchieveDate(a.unlockedAt)}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="🔒 ตราที่ยังไม่ได้ปลดล็อก">
        {lockedList.length === 0 ? (
          <p className="hint">ปลดล็อกครบทุกตราแล้ว — สุดยอด!</p>
        ) : (
          <div className="achieve-grid">
            {lockedList.map((a) => {
              const pct = Math.min(100, (a.progress / a.target) * 100);
              return (
                <div className="achieve-card" key={a.id}>
                  <div className="achieve-icon dim">{a.icon}</div>
                  <div className="achieve-body">
                    <div className="achieve-name">{a.name}</div>
                    <div className="achieve-desc">{a.desc}</div>
                    <div className="achieve-progress">
                      <div className="bar"><div className="bar-fill" style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#8b5cf6,#f5b942)' }} /></div>
                      <span className="achieve-count">{a.progress} / {a.target}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </>
  );
}
