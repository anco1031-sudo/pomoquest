import { useEffect, useState } from 'react';
import { useGame } from '../context.jsx';
import { sfx } from '../sound.js';
import { fmtTime } from './ui.jsx';
import CharacterSheet from './CharacterSheet.jsx';
import ItemStatChips from './ItemStats.jsx';

const TABS = [
  { key: 'shop', label: 'ร้านค้า', icon: '🛒' },
  { key: 'quest', label: 'ภารกิจ', icon: '📜' },
  { key: 'inv', label: 'กระเป๋า', icon: '🎒' },
  { key: 'char', label: 'ตัวละคร', icon: '🛡️' },
];

export default function CampScreen({ remain, total, running, onSkip, visit }) {
  const { character, get, post, inventory, showToast } = useGame();
  const [tab, setTab] = useState('shop');
  const [shop, setShop] = useState([]);
  const [quests, setQuests] = useState([]);
  const [doneQuests, setDoneQuests] = useState({});
  const [questResults, setQuestResults] = useState({});

  useEffect(() => {
    (async () => {
      const d = await get(`/camp${visit ? `?visit=${encodeURIComponent(visit)}` : ''}`);
      if (d) {
        setShop(d.shop || []);
        setQuests(d.quests || []);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [get, visit]);

  const buy = async (item) => {
    sfx.click();
    const d = await post('/shop/buy', { itemId: item.id, visit });
    if (d) {
      showToast(`ซื้อ ${item.name} แล้ว`);
      setShop((s) => s.map((i) => (i.id === item.id ? { ...i, bought: 1 } : i)));
    }
  };

  const doQuest = async (q) => {
    sfx.click();
    const d = await post('/quest/do', { questId: q.id });
    if (d) {
      setDoneQuests((s) => ({ ...s, [q.id]: true }));
      setQuestResults((s) => ({ ...s, [q.id]: d.result }));
      showToast(d.result.success ? 'ภารกิจสำเร็จ!' : 'ภารกิจไม่สำเร็จ…');
    }
  };

  const useItem = async (i) => {
    const d = await post('/inventory/use', { itemId: i.item_id });
    if (d) showToast(d.message || 'ใช้แล้ว');
  };

  const equipItem = async (i) => {
    const d = await post('/inventory/equip', { itemId: i.item_id });
    if (d) showToast(d.message || 'สวมแล้ว');
  };

  const sellItem = async (i) => {
    if (!window.confirm(`ขาย ${i.name} x1?`)) return;
    const d = await post('/shop/sell', { itemId: i.item_id, qty: 1 });
    if (d) showToast(d.message || 'ขายแล้ว');
  };

  const twoHandTag = (i) => (i.type === 'weapon' && i.handed === 2 ? <span className="twohand-tag">สองมือ</span> : null);

  const rest = async () => {
    sfx.complete();
    const d = await post('/camp/rest');
    if (d) showToast('🔥 พลังเต็มเปี่ยม!');
  };

  if (!character) return null;

  return (
    <div className="screen">
      <header className="camp-header">
        <div>
          <div className="timer-title">🔥 ค่ายพัก</div>
          <div className="camp-sub">พักผ่อน เตรียมตัว เตรียมใจ ⏳ {fmtTime(remain)}</div>
        </div>
        <button className="btn btn-sm" onClick={onSkip}>จบพักเร็ว ⏩</button>
      </header>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => { setTab(t.key); sfx.click(); }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'shop' && (
        <div className="panel">
          <div className="panel-title">🛒 ร้านค้าของพ่อค้าเร่ร่อน</div>
          <div className="shop-list">
            {shop.map((i) => (
              <div className="shop-row" key={i.id}>
                <span className="inv-icon">{i.icon}</span>
                <div className="inv-info">
                  <div className="inv-name">{i.name} {twoHandTag(i)}</div>
                  <ItemStatChips item={i} />
                  <div className="inv-desc">{i.desc}</div>
                </div>
                {i.bought ? (
                  <span className="sold-tag">ขายแล้ว</span>
                ) : (
                  <button
                    className="btn btn-sm"
                    disabled={character.gold < i.price}
                    onClick={() => buy(i)}
                  >
                    💰 {i.price}
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="hint">ทองของคุณ: 💰 {character.gold} — สินค้าสุ่มเปลี่ยนทุกค่ายพัก ซื้อได้ครั้งเดียวต่อค่ายพัก</p>
        </div>
      )}

      {tab === 'quest' && (
        <div className="panel">
          <div className="panel-title">📜 ภารกิจย่อย (ทำได้ 1 ครั้งต่อพัก)</div>
          {quests.map((q) => {
            const done = doneQuests[q.id];
            const res = questResults[q.id];
            return (
              <div className={`quest-card ${done ? 'done' : ''}`} key={q.id}>
                <div className="quest-top">
                  <span className="quest-icon">{q.icon}</span>
                  <div className="quest-info">
                    <div className="quest-title">{q.title}</div>
                    <div className="quest-detail">{q.detail}</div>
                  </div>
                </div>
                <div className="quest-rewards">
                  <span className="reward-xp">+{q.xp} XP</span>
                  {q.gold > 0 && <span className="reward-gold">+{q.gold} ทอง</span>}
                  <span className="quest-chance">โอกาสสำเร็จ {Math.round(q.success * 100)}%</span>
                </div>
                {res && <div className={`quest-result ${res.success ? 'ok' : 'fail'}`}>{res.detail}</div>}
                {!done && (
                  <button className="btn btn-primary btn-big" onClick={() => doQuest(q)}>🚀 ลงมือทำภารกิจ</button>
                )}
                {done && !res && <div className="quest-result fail">ทำแล้ว</div>}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'inv' && (
        <div className="panel">
          <div className="panel-title">🎒 กระเป๋า</div>
          {inventory.length === 0 ? (
            <p className="hint">กระเป๋าว่างเปล่า — ไปหา treasure กัน!</p>
          ) : (
            inventory.map((i) => (
              <div className="inv-row" key={i.item_id}>
                <span className="inv-icon">{i.icon}</span>
                <div className="inv-info">
                  <div className="inv-name">{i.name} {twoHandTag(i)} <span className="inv-qty">x{i.qty}</span>{i.exclusive ? <span className="exclusive-tag">✦ พิเศษ</span> : null}</div>
                  <ItemStatChips item={i} />
                  <div className="inv-desc">{i.desc}</div>
                </div>
                <div className="inv-actions">
                  {i.type === 'consumable' ? (
                    <button className="btn btn-sm" onClick={() => useItem(i)}>ใช้</button>
                  ) : (
                    <button className="btn btn-sm" onClick={() => equipItem(i)}>สวม</button>
                  )}
                  <button className="btn btn-sm btn-danger-soft" onClick={() => sellItem(i)}>ขาย</button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'char' && (
        <>
          <button className="btn btn-primary btn-big" onClick={rest}>🔥 พักฟื้นพลังเต็ม (ฟรี)</button>
          <CharacterSheet />
        </>
      )}
    </div>
  );
}
