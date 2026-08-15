import { useGame } from '../context.jsx';

export default function Toast() {
  const { toasts } = useGame();
  if (!toasts?.length) return null;
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className="toast">{t.msg}</div>
      ))}
    </div>
  );
}
