import { useEffect, useState } from 'react';
import { useGame } from '../context.jsx';
import { Panel } from './ui.jsx';
import { TYPE_ICON, fmtLogTime } from './AdventureLog.jsx';

// วันที่ + เวลาของ session (created_at เป็น localtime จาก server)
function fmtSessionDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T'));
  return `${d.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' })} ${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`;
}

export default function SessionHistory() {
  const { get, character } = useGame();
  const [data, setData] = useState(null);
  const [openId, setOpenId] = useState(null); // session ที่กดขยายดูเหตุการณ์
  const [dateFilter, setDateFilter] = useState(''); // YYYY-MM-DD
  const [cityFilter, setCityFilter] = useState(''); // '' = ทุกเมือง
  const [kw, setKw] = useState(''); // ค้นหาเหตุการณ์ / เนื้อหา

  useEffect(() => {
    get('/session-history').then((d) => setData(d || null));
  }, [get]);

  const sessions = data?.sessions || [];

  // เมืองที่เคยผ่าน (จากประวัติ) + เมืองปัจจุบัน — ใช้เป็นตัวเลือก dropdown
  const currentCity = character?.city?.name || '';
  const cityOptions = [...(data?.cities || [])];
  if (currentCity && !cityOptions.includes(currentCity)) cityOptions.push(currentCity);

  // กรอง session ตามวันที่ + เมือง + keyword (เหตุการณ์อยู่ใน events)
  const kwLower = kw.trim().toLowerCase();
  const eventMatch = (e) =>
    !kwLower || (e.title || '').toLowerCase().includes(kwLower) || (e.detail || '').toLowerCase().includes(kwLower);
  const filtered = sessions.filter((s) => {
    if (dateFilter && !(s.created_at || '').startsWith(dateFilter)) return false;
    if (cityFilter && s.city !== cityFilter) return false;
    if (!kwLower) return true;
    return (
      (s.title || '').toLowerCase().includes(kwLower) ||
      (s.detail || '').toLowerCase().includes(kwLower) ||
      s.events.some(eventMatch)
    );
  });

  return (
    <Panel title={`📅 ประวัติ Session (${filtered.length}/${sessions.length})`}>
      <div className="session-search">
        <input
          className="input"
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          title="กรองตามวันที่"
        />
        <select className="input" value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} title="กรองตามเมือง">
          <option value="">🗺️ ทุกเมือง</option>
          {cityOptions.map((city) => (
            <option key={city} value={city}>
              {city}{city === currentCity ? ' (ปัจจุบัน)' : ''}
            </option>
          ))}
        </select>
        <input
          className="input"
          type="search"
          placeholder="ค้นหาเหตุการณ์ / เนื้อหา…"
          value={kw}
          onChange={(e) => setKw(e.target.value)}
        />
      </div>
      {sessions.length === 0 ? (
        <p className="hint">ยังไม่มีประวัติ session — จบ session แรกแล้วกลับมาดูได้ที่นี่!</p>
      ) : filtered.length === 0 ? (
        <p className="hint">ไม่พบ session ที่ตรงกับเงื่อนไข</p>
      ) : (
        <div className="session-history">
          {filtered.map((s) => {
            const open = openId === s.id;
            const events = kwLower ? s.events.filter(eventMatch) : s.events;
            return (
              <div className={`session-card ${open ? 'open' : ''}`} key={s.id}>
                <button className="session-card-head" onClick={() => setOpenId(open ? null : s.id)}>
                  <span className="session-card-title">
                    📋 {s.title}
                    {s.challenge_mode === 'hard' && <span className="challenge-badge">⚔️ โหมดโหด</span>}
                    {s.challenge_mode === 'marathon' && <span className="challenge-badge">⏱️ มาราธอน</span>}
                    {s.challenge_mode === 'survival' && <span className="challenge-badge">🩸 เอาชีวิตรอด</span>}
                  </span>
                  <span className="session-card-date">{fmtSessionDate(s.created_at)}</span>
                  <span className="session-card-toggle">{open ? '▾' : '▸'}</span>
                </button>
                {open && (
                  <div className="session-card-body">
                    <div className="session-card-detail">{s.detail}</div>
                    {events.length > 0 && (
                      <div className="session-card-events">
                        <div className="session-card-events-title">เหตุการณ์ ({events.length})</div>
                        {events.map((e) => (
                          <div className="session-card-event" key={e.id}>
                            <span className="log-icon">{TYPE_ICON[e.type] || '📜'}</span>
                            <div className="log-body">
                              <div className="log-title">
                                {e.title} <span className="log-time">{fmtLogTime(e.created_at)}</span>
                              </div>
                              <div className="log-detail">{e.detail}</div>
                              <div className="log-rewards">
                                {e.xp > 0 && <span className="reward-xp">+{e.xp} XP</span>}
                                {e.gold > 0 && <span className="reward-gold">+{e.gold} ทอง</span>}
                                {e.hp_change < 0 && <span className="reward-hp-loss">-{Math.abs(e.hp_change)} HP</span>}
                                {e.mp_change > 0 && <span className="reward-mp">+{e.mp_change} MP</span>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
