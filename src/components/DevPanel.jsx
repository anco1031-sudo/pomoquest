import { useState } from 'react';
import { useGame } from '../context.jsx';
import { apiGet, apiDevPost } from '../api.js';
import { sfx } from '../sound.js';

// ราคา/โบนัสของไอเทมสำหรับแสดงในตัวอย่างตลาดมืด
function bmItemParts(i) {
  const p = [];
  if (i.atk_bonus) p.push(`⚔️ ATK +${i.atk_bonus}`);
  if (i.def_bonus) p.push(`🛡️ DEF +${i.def_bonus}`);
  if (i.hp_bonus) p.push(`❤️ HP +${i.hp_bonus}`);
  if (i.mp_bonus) p.push(`💧 MP +${i.mp_bonus}`);
  if (i.spd_bonus) p.push(`👟 SPD +${i.spd_bonus}`);
  if (i.crit_bonus) p.push(`🎯 CRIT +${i.crit_bonus}%`);
  if (i.heal_pct) p.push(`🧪 HP ${Math.round(i.heal_pct * 100)}%`);
  if (i.mana_pct) p.push(`🔮 MP ${Math.round(i.mana_pct * 100)}%`);
  if (i.use_gold) p.push(`💰 +${i.use_gold} ทอง`);
  if (i.use_xp) p.push(`✨ +${i.use_xp} XP`);
  return p;
}

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
  const { showToast } = useGame();
  const [token, setToken] = useState(() => localStorage.getItem(DEV_KEY) || '');
  const [itemId, setItemId] = useState(1);
  const [achieveId, setAchieveId] = useState('first_step');
  const [busy, setBusy] = useState(false);
  const [bmPreview, setBmPreview] = useState(null);

  const toast = (msg) => showToast(msg);

  const login = async (u = 'admin', p = 'admin') => {
    try {
      const d = await apiDevPost('/dev/login', { user: u, pass: p });
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
      return d;
    } catch (e) {
      toast(e.message);
      if (/เข้าสู่ระบบ/.test(e.message)) {
        setToken('');
        localStorage.removeItem(DEV_KEY);
      }
      return null;
    } finally {
      setBusy(false);
    }
  };

  // ดูตัวอย่างตลาดมืด — preview ล้วน (ไม่มีผลกับเกมจริง)
  const showBmPreview = async () => {
    sfx.click();
    const d = await dev('/dev/black-market', {});
    if (d?.items) setBmPreview(d);
  };

  // สรุปผลจาก response ของ endpoint จริง — โชว์เหมือนของจริง (XP/ทอง/ไอเทม/เลเวลอัพ) แต่ server ROLLBACK แล้ว (ไม่บันทึก)
  const summarize = (d, fallback) => {
    if (!d) return `${fallback || 'เรียบร้อย'} (ไม่บันทึก)`;
    const parts = [];
    if (d.event) {
      const ev = d.event;
      const rw = [];
      if (ev.xp > 0) rw.push(`+${ev.xp} XP`);
      if (ev.gold > 0) rw.push(`+${ev.gold} ทอง`);
      if (ev.hpChange < 0) rw.push(`-${Math.abs(ev.hpChange)} HP`);
      if (ev.mpChange > 0) rw.push(`+${ev.mpChange} MP`);
      if (ev.item) rw.push(`${ev.item.icon} ${ev.item.name}`);
      parts.push([ev.title || 'เหตุการณ์', ...(rw.length ? [rw.join(' · ')] : [])].join(' — '));
    }
    if (d.reward) {
      parts.push(`+${d.reward.xp} XP · +${d.reward.gold} ทอง${d.reward.bonus > 1 ? ` (คอมโบ x${d.reward.bonus.toFixed(1)})` : ''}`);
    }
    if (d.result) {
      const rw = [];
      if (d.result.xp > 0) rw.push(`+${d.result.xp} XP`);
      if (d.result.gold > 0) rw.push(`+${d.result.gold} ทอง`);
      if (d.result.item) rw.push(`${d.result.item.icon} ${d.result.item.name}`);
      parts.push([d.result.detail || d.result.title || (d.result.success ? 'ภารกิจสำเร็จ!' : 'ภารกิจล้มเหลว'), ...(rw.length ? [rw.join(' · ')] : [])].join(' — '));
    }
    if (d.message) parts.push(d.message);
    if (d.levelUps && d.levelUps.levels > 0) parts.push(`✨ อัพ ${d.levelUps.levels} เลเวล! (+${d.levelUps.statPoints} แต้ม)`);
    return `${parts.length ? parts.join(' — ') : fallback || 'เรียบร้อย'} (ไม่บันทึก)`;
  };

  // เรียก endpoint จริงของเกมแบบลองเล่น — ส่ง dev token → server รันใน transaction แล้ว ROLLBACK (ไม่บันทึก)
  const act = async (fn, msg) => {
    setBusy(true);
    try {
      const d = await fn();
      toast(summarize(d, msg));
    } catch (e) {
      toast(e.message);
      // token หมดอายุ (server รีสตาร์ท — token ในหน่วยความจำหาย) → ถ้าไม่ clear จะกดปุ่มต่อแล้วบันทึกจริงเงียบ ๆ
      if (/เข้าสู่ระบบ/.test(e.message)) {
        setToken('');
        localStorage.removeItem(DEV_KEY);
      }
    } finally {
      setBusy(false);
    }
  };

  // ซื้อของ — ต้องมี stock ร้านค่ายพักก่อน (เปิด /camp ก่อนแบบบันทึกจริง ให้ stock อยู่จริง, แล้วซื้อแบบลองเล่น)
  const shopBuy = async () => {
    const visit = `dev-${Date.now()}`;
    await apiGet(`/camp?visit=${encodeURIComponent(visit)}`);
    return apiDevPost('/shop/buy', { itemId: 1, visit });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal dev-panel" onClick={(e) => e.stopPropagation()}>
        <h2>🧪 Dev Test Panel</h2>
        <p className="dev-sub">ทดสอบระบบต่าง ๆ ของเกม — ต้องเข้าสู่ระบบก่อน (admin/admin)</p>
        <p className="dev-sub" style={{ color: '#fcd34d' }}>⚠️ ทุกปุ่มใน panel นี้เป็นโหมดลองเล่น (รวม จบ session / event / ภารกิจ / ซื้อ / พักเบรก) — แสดงผลเหมือนจริงแต่ <b>ไม่บันทึกลง DB</b> (กันปั๊มเลเวล/ทอง) · ถ้าอยากทดสอบแบบบันทึกจริง ให้เล่นผ่านหน้าจอเกมปกติ</p>

        {!token ? (
          <div className="dev-login">
            <button className="btn btn-primary btn-big" onClick={() => login()} disabled={busy}>⚡ เข้าสู่ระบบเร็ว (admin/admin)</button>
            <p className="hint">💡 ระบบ dev รีสตาร์ท server แล้วต้อง login ใหม่</p>
          </div>
        ) : (
          <>
            <div className="dev-login-info">
              <span>🔓 เข้าสู่ระบบแล้ว</span>
              <button className="btn btn-sm" onClick={logout}>ออกจากระบบ</button>
            </div>

            <div className="dev-section">🎲 เหตุการณ์ระหว่าง session</div>
            <div className="dev-grid">
              <button className="btn" onClick={() => act(() => apiDevPost('/adventure/event'), '🎲 สุ่ม event')} disabled={busy}>🎲 สุ่ม event</button>
              {EVENT_KEYS.map((e) => (
                <button key={e.key} className="btn" onClick={() => act(() => apiDevPost('/adventure/event', { key: e.key }))} disabled={busy}>
                  {e.label}
                </button>
              ))}
            </div>

            <div className="dev-section">⏱️ สถานะ session / พัก</div>
            <div className="dev-grid">
              <button className="btn" onClick={() => act(() => apiDevPost('/adventure/complete', { focusSec: 1500 }), '✅ จบ session 25 นาที')} disabled={busy}>✅ จบ session (25 นาที)</button>
              <button className="btn" onClick={() => act(() => apiDevPost('/break/done', { breakSec: 300, overrunSec: 30, extended: 1 }), '☕ จบพักเบรก')} disabled={busy}>☕ จบพักเบรก (5 นาที)</button>
              <button className="btn" onClick={() => act(() => apiDevPost('/adventure/abort'), '💨 ล้างคอมโบ')} disabled={busy}>💨 ล้างคอมโบ</button>
            </div>

            <div className="dev-section">⚔️ ระบบอื่น</div>
            <div className="dev-grid">
              <button className="btn" onClick={() => act(() => apiDevPost('/quest/do', { questId: QUEST_IDS[Math.floor(Math.random() * QUEST_IDS.length)] }), '📜 ทำภารกิจ')} disabled={busy}>📜 ภารกิจสุ่ม</button>
              <button className="btn" onClick={() => act(shopBuy, '🛒 ซื้อยา')} disabled={busy}>🛒 ซื้อของ (ยาบำบัดน้อย)</button>
              <button className="btn" onClick={() => dev('/dev/boss-win', {})} disabled={busy}>👹 ชนะบอสทันที</button>
              <button className="btn" onClick={() => dev('/dev/tale', {})} disabled={busy}>📖 เรื่องราวทดสอบ</button>
              <button className="btn" onClick={() => dev('/dev/heal', {})} disabled={busy}>💖 เติม HP/MP เต็ม</button>
              <button className="btn" onClick={() => dev('/dev/next-city', {})} disabled={busy}>🗺️ เมืองถัดไป</button>
              <button className="btn" onClick={showBmPreview} disabled={busy}>🖤 ดูตัวอย่างตลาดมืด</button>
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

        {bmPreview && (
          <div className="modal-backdrop" onClick={() => setBmPreview(null)}>
            <div className="modal dev-panel" onClick={(e) => e.stopPropagation()}>
              <h2>🖤 ตัวอย่างตลาดมืด</h2>
              <p className="dev-sub" style={{ color: '#fcd34d' }}>preview เท่านั้น — ไม่มีผลกับเกมจริง · รับซื้อขยะ (junk) +{Math.round((bmPreview.junkMult - 1) * 100)}%</p>
              <div className="bm-preview-list">
                {bmPreview.items.map((i, idx) => (
                  <div className="bm-preview-item" key={idx}>
                    <span className="bm-preview-icon">{i.icon}</span>
                    <div className="bm-preview-info">
                      <div className="bm-preview-name">{i.name} <span className="bm-preview-tag">{i.bmTag}</span></div>
                      <div className="bm-preview-parts">{bmItemParts(i).join(' · ')}</div>
                      <div className="bm-preview-price">
                        <b>{i.bmPrice} ทอง</b>
                        {i.bmNormal !== i.bmPrice && <s className="bm-preview-normal">{i.bmNormal} ทอง</s>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <button className="btn btn-big" onClick={() => setBmPreview(null)}>ปิด</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
