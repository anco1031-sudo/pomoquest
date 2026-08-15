import { useState } from 'react';
import { useGame } from '../context.jsx';
import { apiDevPost } from '../api.js';
import { sfx } from '../sound.js';

const EVENT_KEYS = [
  { key: 'monster', label: '🐺 มอนสเตอร์' },
  { key: 'treasure', label: '🎁 สมบัติ' },
  { key: 'shrine', label: '⛩️ ศาลเจ้า' },
  { key: 'merchant', label: '🧙 พ่อค้า' },
  { key: 'trap', label: '⚠️ กับดัก' },
];
const QUEST_IDS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'];

const DEV_KEY = 'pomoquest-dev-token';

export default function DevPanel({ onClose }) {
  const { post, showToast } = useGame();
  const [token, setToken] = useState(() => localStorage.getItem(DEV_KEY) || '');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [itemId, setItemId] = useState(1);
  const [achieveId, setAchieveId] = useState('first_step');
  const [busy, setBusy] = useState(false);

  const toast = (msg) => showToast(msg);

  const login = async () => {
    try {
      const d = await apiDevPost('/dev/login', { user, pass });
      if (d?.token) {
        setToken(d.token);
        localStorage.setItem(DEV_KEY, d.token);
        toast('🔓 เข้าสู่ระบบ dev แล้ว');
      }
    } catch (e) {
      toast(e.message);
    }
  };

  const logout = () => {
    setToken('');
    localStorage.removeItem(DEV_KEY);
  };

  // เรียก dev endpoint (ต้องมี token) — ถ้า token หมดอายุให้ออกจากระบบ
  const dev = async (path, body, fallbackMsg) => {
    setBusy(true);
    try {
      const d = await apiDevPost(path, body);
      toast(d?.message || fallbackMsg || 'เรียบร้อย');
    } catch (e) {
      toast(e.message);
      if (/เข้าสู่ระบบ/.test(e.message)) {
        setToken('');
        localStorage.removeItem(DEV_KEY);
      }
    } finally {
      setBusy(false);
    }
  };

  // เรียก endpoint ปกติของเกม (ทดสอบระบบจริง)
  const act = async (fn, msg) => {
    setBusy(true);
    try {
      const d = await fn();
      toast(d?.message || msg || 'เรียบร้อย');
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal dev-panel" onClick={(e) => e.stopPropagation()}>
        <h2>🧪 Dev Test Panel</h2>
        <p className="dev-sub">ทดสอบระบบต่าง ๆ ของเกม — ต้องเข้าสู่ระบบก่อน (admin/adminlouis)</p>

        {!token ? (
          <div className="dev-login">
            <input
              className="input"
              placeholder="user (admin)"
              value={user}
              onChange={(e) => setUser(e.target.value)}
            />
            <input
              className="input"
              type="password"
              placeholder="pass"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && login()}
            />
            <button className="btn btn-primary btn-big" onClick={login} disabled={busy}>🔓 เข้าสู่ระบบ dev</button>
          </div>
        ) : (
          <>
            <div className="dev-login-info">
              <span>🔓 เข้าสู่ระบบแล้ว</span>
              <button className="btn btn-sm" onClick={logout}>ออกจากระบบ</button>
            </div>

            <div className="dev-section">🎲 เหตุการณ์ระหว่าง session</div>
            <div className="dev-grid">
              <button className="btn" onClick={() => act(() => post('/adventure/event'), '🎲 สุ่ม event')} disabled={busy}>🎲 สุ่ม event</button>
              {EVENT_KEYS.map((e) => (
                <button key={e.key} className="btn" onClick={() => act(() => post('/adventure/event', { key: e.key }))} disabled={busy}>
                  {e.label}
                </button>
              ))}
            </div>

            <div className="dev-section">⏱️ สถานะ session / พัก</div>
            <div className="dev-grid">
              <button className="btn" onClick={() => act(() => post('/adventure/complete', { focusSec: 1500 }), '✅ จบ session 25 นาที')} disabled={busy}>✅ จบ session (25 นาที)</button>
              <button className="btn" onClick={() => act(() => post('/break/done', { breakSec: 300, overrunSec: 30, extended: 1 }), '☕ จบพักเบรก')} disabled={busy}>☕ จบพักเบรก (5 นาที)</button>
              <button className="btn" onClick={() => act(() => post('/adventure/abort'), '💨 ล้างคอมโบ')} disabled={busy}>💨 ล้างคอมโบ</button>
            </div>

            <div className="dev-section">⚔️ ระบบอื่น</div>
            <div className="dev-grid">
              <button className="btn" onClick={() => act(() => post('/quest/do', { questId: QUEST_IDS[Math.floor(Math.random() * QUEST_IDS.length)] }), '📜 ทำภารกิจ')} disabled={busy}>📜 ภารกิจสุ่ม</button>
              <button className="btn" onClick={() => act(() => post('/shop/buy', { itemId: 1, visit: `dev-${Date.now()}` }), '🛒 ซื้อยา')} disabled={busy}>🛒 ซื้อของ (ยาบำบัดน้อย)</button>
              <button className="btn" onClick={() => dev('/dev/boss-win', {})} disabled={busy}>👹 ชนะบอสทันที</button>
              <button className="btn" onClick={() => dev('/dev/tale', {})} disabled={busy}>📖 เรื่องราวทดสอบ</button>
            </div>

            <div className="dev-section">⚡ สกิล (เลเวล/คัมภีร์)</div>
            <div className="dev-grid">
              <button className="btn" onClick={() => dev('/dev/learn-skill', {})} disabled={busy}>📖 เรียนรู้สกิล (สุ่ม)</button>
              <button className="btn" onClick={() => dev('/dev/skill-xp', { amount: 120 })} disabled={busy}>⭐ +120 XP สกิลทั้งหมด</button>
            </div>

            <div className="dev-section">🎁 ของขวัญ / ทรัพยากร</div>
            <div className="dev-row">
              <input
                className="input dev-input"
                type="number"
                value={itemId}
                onChange={(e) => setItemId(Number(e.target.value))}
                placeholder="item id"
              />
              <button className="btn" onClick={() => dev('/dev/grant-item', { itemId })} disabled={busy}>🎁 ให้ไอเทม</button>
              <button className="btn" onClick={() => dev('/dev/gold', { amount: 1000 })} disabled={busy}>💰 +1000 ทอง</button>
              <button className="btn" onClick={() => dev('/dev/xp', { amount: 500 })} disabled={busy}>✨ +500 XP</button>
            </div>

            <div className="dev-section">🏅 ตรา (achievement)</div>
            <div className="dev-row">
              <input
                className="input dev-input"
                value={achieveId}
                onChange={(e) => setAchieveId(e.target.value)}
                placeholder="achievement id"
              />
              <button className="btn" onClick={() => dev('/dev/achieve', { id: achieveId })} disabled={busy}>🏅 ปลดล็อกตรา</button>
            </div>

            <p className="hint">💡 ดู id ไอเทม/ตราได้ใน server/data.js — ระบบ dev รีสตาร์ท server แล้วต้อง login ใหม่</p>
            <button className="btn btn-big" onClick={onClose}>ปิด</button>
          </>
        )}
      </div>
    </div>
  );
}
