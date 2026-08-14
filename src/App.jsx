import { GameProvider } from './context.jsx';
import Game from './Game.jsx';

export default function App() {
  return (
    <GameProvider>
      <Game />
    </GameProvider>
  );
}
