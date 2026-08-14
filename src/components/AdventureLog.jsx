import { useGame } from '../context.jsx';
import { Panel } from './ui.jsx';

const TYPE_ICON = {
  battle_win: '🗡️', battle_lose: '💨', treasure: '🎁', shrine: '⛩️', merchant: '🧙', trap: '⚠️',
  session_done: '✅', abort: '💨', shop: '🛒', equip: '🔧', rest: '🔥',
  quest_win: '📜', quest_fail: '📜', boss_win: '🏆', boss_lose: '💨', system: '🎒',
  achievement: '🏅',
};

function fmtLogTime(iso) {
  // server เก็บเวลาแบบ localtime (ไม่มี Z) — ถ้ามี Z แปลว่า UTC
  const d = iso.endsWith('Z') ? new Date(iso) : new Date(iso.replace(' ', 'T'));
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return 'เมื่อกี้';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} นาทีที่แล้ว`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ชม.ที่แล้ว`;
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}

export default function AdventureLog({ limit = 20 }) {
  const { log } = useGame();
  const items = (log || []).slice(0, limit);

  return (
    <Panel title={`📜 บันทึกการผจญภัย (${(log || []).length})`}>
      {items.length === 0 ? (
        <p className="hint">ยังไม่มีบันทึก — เริ่มผจญภัยได้เลย!</p>
      ) : (
        <div className="log-list">
          {items.map((l) => (
            <div className="log-item" key={l.id}>
              <span className="log-icon">{TYPE_ICON[l.type] || '📜'}</span>
              <div className="log-body">
                <div className="log-title">{l.title} <span className="log-time">{fmtLogTime(l.created_at)}</span></div>
                <div className="log-detail">{l.detail}</div>
                {(l.xp > 0 || l.gold > 0) && (
                  <div className="log-rewards">
                    {l.xp > 0 && <span className="reward-xp">+{l.xp} XP</span>}
                    {l.gold > 0 && <span className="reward-gold">+{l.gold} ทอง</span>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
