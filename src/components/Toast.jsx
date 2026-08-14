import { useGame } from '../context.jsx';

export default function Toast() {
  const { toast } = useGame();
  if (!toast) return null;
  return <div className="toast">{toast}</div>;
}
