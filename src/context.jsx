import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { apiGet, apiPost, apiPut } from './api.js';

const Ctx = createContext(null);
export const useGame = () => useContext(Ctx);

export function GameProvider({ children }) {
  const [data, setData] = useState({
    loading: true,
    hasCharacter: false,
    character: null,
    characters: [],
    activeCharacterId: null,
    progress: null,
    settings: null,
    inventory: [],
    log: [],
    daily: null,
  });
  const [toast, setToast] = useState(null);
  const [eventQueue, setEventQueue] = useState([]);
  const [achieveQueue, setAchieveQueue] = useState([]);
  const [levelUp, setLevelUp] = useState(null);
  const toastTimer = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  // นำข้อมูลจาก response ไป merge เข้า state รวม
  const apply = useCallback(
    (d) => {
      setData((s) => ({
        ...s,
        character: d.character ?? s.character,
        progress: d.progress ?? s.progress,
        settings: d.settings ?? s.settings,
        inventory: d.inventory ?? s.inventory,
        log: d.log ?? s.log,
        achievements: d.achievements ?? s.achievements,
        daily: d.daily ?? s.daily,
        characters: d.characters ?? s.characters,
        activeCharacterId: d.activeCharacterId ?? s.activeCharacterId,
        hasCharacter: d.character ? true : d.hasCharacter ?? s.hasCharacter,
      }));
      if (d.levelUps && d.levelUps.levels > 0) {
        setLevelUp({ levels: d.levelUps.levels, statPoints: d.levelUps.statPoints });
      }
      if (d.event) setEventQueue((q) => [...q, d.event]);
      if (d.achievements && d.achievements.length) setAchieveQueue((q) => [...q, ...d.achievements]);
      if (d.message) showToast(d.message);
    },
    [showToast]
  );

  const refresh = useCallback(async () => {
    try {
      const d = await apiGet('/state');
      setData((s) => ({ ...s, ...d, loading: false }));
    } catch (e) {
      setData((s) => ({ ...s, loading: false }));
      showToast(e.message);
    }
  }, [showToast]);

  const get = useCallback(async (path) => {
    try {
      const d = await apiGet(path);
      if (d && !d.error) apply(d);
      return d;
    } catch (e) {
      showToast(e.message);
      return null;
    }
  }, [apply, showToast]);

  const post = useCallback(async (path, body) => {
    try {
      const d = await apiPost(path, body);
      if (d && !d.error) apply(d);
      return d;
    } catch (e) {
      showToast(e.message);
      return null;
    }
  }, [apply, showToast]);

  const put = useCallback(async (path, body) => {
    try {
      const d = await apiPut(path, body);
      if (d && !d.error) apply(d);
      return d;
    } catch (e) {
      showToast(e.message);
      return null;
    }
  }, [apply, showToast]);

  const closeEvent = useCallback(() => setEventQueue((q) => q.slice(1)), []);
  const closeAchieve = useCallback(() => setAchieveQueue((q) => q.slice(1)), []);
  const dismissLevelUp = useCallback(() => setLevelUp(null), []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <Ctx.Provider
      value={{ ...data, refresh, get, post, put, toast, showToast, eventQueue, closeEvent, achieveQueue, closeAchieve, levelUp, dismissLevelUp }}
    >
      {children}
    </Ctx.Provider>
  );
}
