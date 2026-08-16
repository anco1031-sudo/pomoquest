import { useEffect, useState } from 'react';
import { useGame } from '../context.jsx';
import { fmtDuration } from './ui.jsx';
import { sfx } from '../sound.js';

// การ์ดลัด 4 ใบบนหน้าแรก — โชว์ข้อมูลย่อ + กดเปิดแท็บเต็ม
export default function HomeQuickCards({ onGo }) {
  const { character, progress, get } = useGame();
  const [story, setStory] = useState(null);
  const [challenge, setChallenge] = useState(null);

  useEffect(() => {
    get('/story').then((d) => d && setStory(d));
    get('/challenge/progress').then((d) => d && setChallenge(d));
  }, [get, character?.id]);

  const claimable = story?.quests?.filter((q) => q.status === 'claimable').length || 0;
  const challengeSessions = challenge?.sessions || 0;

  const cards = [
    {
      key: 'story',
      icon: '📖',
      title: 'เนื้อเรื่อง',
      sub: story
        ? `${story.doneCount}/${story.total} เควสต์${claimable > 0 ? ` · 🎁 รับได้ ${claimable}` : ''}`
        : 'เรื่องราวตามเมืองที่ปลดล็อก',
    },
    {
      key: 'challenge',
      icon: '🔥',
      title: 'ชาเลนจ์',
      sub: challenge
        ? `สัปดาห์นี้ ${challengeSessions} session · ${Math.round((challenge?.focusSec || 0) / 60)} นาที`
        : 'ตั้งเป้าโฟกัสรายสัปดาห์',
    },
    {
      key: 'sheet',
      icon: '🗺️',
      title: 'เดินทาง',
      sub: character ? `📍 ${character.city.icon} ${character.city.name} · ปลดล็อก ${character.cityIndex + 1} เมือง` : '',
    },
    {
      key: 'stats',
      icon: '📊',
      title: 'สถิติ',
      sub: progress ? `${progress.sessions_completed || 0} session · ${fmtDuration(progress.total_focus_sec || 0)}` : '',
    },
  ];

  return (
    <div className="quick-grid">
      {cards.map((c) => (
        <button
          key={c.key}
          className="quick-card"
          onClick={() => { sfx.click(); onGo(c.key); }}
        >
          <span className="quick-icon">{c.icon}</span>
          <span className="quick-title">{c.title}</span>
          <span className="quick-sub">{c.sub}</span>
          <span className="quick-go">เปิด →</span>
        </button>
      ))}
    </div>
  );
}
