import { useState } from 'react';
import { itemStatParts } from './ItemStats.jsx';

// tooltip แสดงรายละเอียดไอเทม — ชี้เมาส์ (hover) หรือแตะที่ชื่อไอเทม (มือถือ)
export default function ItemTip({ item, className, children }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  if (!item) return children;
  const parts = itemStatParts(item);

  const toggle = (e) => {
    if (e.target.closest('button')) return; // แตะปุ่ม → ไม่เปิด tooltip
    setPos({ x: e.clientX, y: e.clientY });
    setOpen((o) => !o);
  };

  return (
    <span
      className={`item-tip ${className || ''}`}
      onMouseEnter={(e) => { setPos({ x: e.clientX, y: e.clientY }); setOpen(true); }}
      onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setOpen(false)}
      onClick={toggle}
    >
      {children}
      {open && (
        <div className="item-tooltip" style={{ left: (pos?.x || 0) + 14, top: (pos?.y || 0) + 14 }}>
          <div className="tip-name">{item.icon} {item.name}{item.handed === 2 ? ' ⚔️สองมือ' : ''}</div>
          {item.lvl > 1 && <div className="tip-meta">ต้องเลเวล {item.lvl}</div>}
          {parts.length > 0 && (
            <div className="tip-stats">{parts.map((p, i) => <div key={i}>{p.icon} {p.text}</div>)}</div>
          )}
          {item.desc && <div className="tip-desc">{item.desc}</div>}
        </div>
      )}
    </span>
  );
}
