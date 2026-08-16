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
    // "โลกเวอร์ชัน" จาก server — ใช้ทิ้ง session ที่พักค้าง (localStorage) เมื่อข้อมูลถูกล้าง/กู้คืน
    epoch: null,
  });
  // toast แบบคิว — โชว์เรียงกัน ไม่ทับ/ไม่หายเมื่อมี toast ใหม่ (แต่ละอันหายเองหลัง 3.5 วิ)
  const [toasts, setToasts] = useState([]);
  const [eventQueue, setEventQueue] = useState([]);
  const [achieveQueue, setAchieveQueue] = useState([]);
  const [levelUpQueue, setLevelUpQueue] = useState([]);

  const showToast = useCallback((msg) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
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
        setLevelUpQueue((q) => [...q, { levels: d.levelUps.levels, statPoints: d.levelUps.statPoints }]);
      }
      if (d.event) {
        setEventQueue((q) => [...q, d.event]);
        // toast สรุปของรางวัล — เด้งแล้วหายเอง ไม่ต้องเปิด modal ก็รู้ผล
        const ev = d.event;
        const parts = [];
        if (ev.xp > 0) parts.push(`+${ev.xp} XP`);
        if (ev.gold > 0) parts.push(`+${ev.gold} ทอง`);
        if (ev.hpChange < 0) parts.push(`-${Math.abs(ev.hpChange)} HP`);
        if (ev.mpChange > 0) parts.push(`+${ev.mpChange} MP`);
        if (ev.item) parts.push(`${ev.item.icon} ${ev.item.name}`);
        if (parts.length) showToast(`🎲 ${ev.title} — ${parts.join(' · ')}`);
      }
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
  const dismissLevelUp = useCallback(() => setLevelUpQueue((q) => q.slice(1)), []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <Ctx.Provider
      value={{ ...data, refresh, get, post, put, toasts, showToast, eventQueue, closeEvent, achieveQueue, closeAchieve, levelUpQueue, dismissLevelUp }}
    >
      {children}
    </Ctx.Provider>
  );
}
