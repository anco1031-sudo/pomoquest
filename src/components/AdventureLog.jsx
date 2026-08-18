import { useEffect } from 'react';
import { useGame } from '../context.jsx';
import { Panel } from './ui.jsx';

export const TYPE_ICON = {
  battle_win: '🗡️', battle_lose: '💨', treasure: '🎁', shrine: '⛩️', merchant: '🧙', trap: '⚠️',
  session_done: '✅', session_summary: '📋', abort: '💨', shop: '🛒', equip: '🔧', rest: '🔥',
  quest_win: '📜', quest_fail: '📜', boss_win: '🏆', boss_lose: '💨', system: '🎒',
  achievement: '🏅', llm_tale: '📖',
};

// เหตุการณ์สุ่มระหว่าง session (battle/treasure/shrine/merchant/trap/egg) — ไม่โชว์ในบันทึกการผจญภัย
// เพราะสรุปอยู่ใน session_summary แล้ว (ดูรายละเอียดรายอันได้ที่แท็บ Session) — กัน log รก
const HIDDEN_EVENT_TYPES = new Set(['battle_win', 'battle_lose', 'treasure', 'shrine', 'merchant', 'trap', 'egg']);

export function fmtLogTime(iso) {
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
  const { log, refresh } = useGame();
  // log ฝั่ง client อัปเดตจาก /state ตอนโหลดหน้าเท่านั้น — ดึงข้อมูลใหม่ทุกครั้งที่เปิด tab บันทึก
  // (ไม่งั้นจะเห็นแต่ข้อมูลเก่า เช่น เห็นแค่ "เริ่มผจญภัย" ทั้งที่เล่นไปหลาย session แล้ว)
  useEffect(() => {
    refresh();
  }, [refresh]);
  // กรองเหตุการณ์สุ่มออก (สรุปอยู่ใน session_summary แล้ว) — เหลือเฉพาะสรุป session/เรื่องราว/ธุรกรรมอื่น ๆ
  const visibleLog = (log || []).filter((l) => !HIDDEN_EVENT_TYPES.has(l.type));
  const items = [...visibleLog].sort((a, b) => b.id - a.id).slice(0, limit); // ล่าสุดก่อนเสมอ

  return (
    <Panel title={`📜 บันทึกการผจญภัย (${visibleLog.length})`}>
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
                {(l.xp > 0 || l.gold > 0 || l.hp_change < 0 || l.mp_change > 0) && (
                  <div className="log-rewards">
                    {l.xp > 0 && <span className="reward-xp">+{l.xp} XP</span>}
                    {l.gold > 0 && <span className="reward-gold">+{l.gold} ทอง</span>}
                    {l.hp_change < 0 && <span className="reward-hp-loss">-{Math.abs(l.hp_change)} HP</span>}
                    {l.mp_change > 0 && <span className="reward-mp">+{l.mp_change} MP</span>}
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
