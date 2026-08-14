export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h > 0) return `${h} ชม. ${m} นาที`;
  return `${m} นาที`;
}

export function Bar({ value, max, color, label }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="bar-wrap">
      {label && <span className="bar-label">{label}</span>}
      <div className="bar">
        <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export function Panel({ title, icon, children, className = '' }) {
  return (
    <div className={`panel ${className}`}>
      {title && (
        <div className="panel-title">
          <span>{icon}</span> {title}
        </div>
      )}
      {children}
    </div>
  );
}

export function StatRow({ label, value, bonus, icon }) {
  return (
    <div className="stat-row">
      <span className="stat-label">{icon} {label}</span>
      <span className="stat-value">
        {value}
        {bonus > 0 && <span className="stat-bonus"> +{bonus}</span>}
      </span>
    </div>
  );
}
