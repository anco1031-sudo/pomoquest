import { useEffect, useState } from 'react';
import { useGame } from '../context.jsx';
import { sfx } from '../sound.js';
import { fmtTime } from './ui.jsx';
import CharacterSheet from './CharacterSheet.jsx';
import ItemStatChips, { itemReqMissing } from './ItemStats.jsx';

const TABS = [
  { key: 'shop', label: 'ร้านค้า', icon: '🛒' },
  { key: 'quest', label: 'ภารกิจ', icon: '📜' },
  { key: 'inv', label: 'กระเป๋า', icon: '🎒' },
  { key: 'char', label: 'ตัวละคร', icon: '🛡️' },
];

export default function CampScreen({ remain, total, running, breakOver = false, overrun = 0, onSkip, visit }) {
  const { character, get, post, inventory, showToast } = useGame();
  const [tab, setTab] = useState('shop');
  const [shop, setShop] = useState([]);
  const [quests, setQuests] = useState([]);
  const [sellPrices, setSellPrices] = useState({}); // ราคาขายของแต่ละชิ้นตอนค่ายพักนี้ (พ่อค้าต้องการของบางชิ้น → แพงขึ้น)
  const [doneQuests, setDoneQuests] = useState({});
  const [questResults, setQuestResults] = useState({});
  const [blackMarket, setBlackMarket] = useState(null); // null = ไม่เจอตลาดมืดในค่ายนี้
  const [festival, setFestival] = useState(null); // เทศกาลประจำสัปดาห์ของเมืองนี้ (null = ไม่มี)

  useEffect(() => {
    (async () => {
      const d = await get(`/camp${visit ? `?visit=${encodeURIComponent(visit)}` : ''}`);
      if (d) {
        setShop(d.shop || []);
        setQuests(d.quests || []);
        setSellPrices(d.sellPrices || {});
        setBlackMarket(d.blackMarket || null);
        setFestival(d.festival || null);
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
    const sp = sellPrices[i.item_id] || {};
    const bmNote = blackMarket && i.type === 'junk' ? ' (ตลาดมืดรับซื้อแพงกว่า +25%!)' : sp.wanted ? ' (พ่อค้าต้องการของชิ้นนี้ — ขายได้แพง!)' : '';
    if (!window.confirm(`ขาย ${i.name} x1?${bmNote}`)) return;
    const d = await post('/shop/sell', { itemId: i.item_id, qty: 1, visit });
    if (d) showToast(d.message || 'ขายแล้ว');
  };

  const twoHandTag = (i) => (i.type === 'weapon' && i.handed === 2 ? <span className="twohand-tag">สองมือ</span> : null);

  const rest = async () => {
    sfx.complete();
    const d = await post('/camp/rest');
    if (d) showToast('🔥 พลังเต็มเปี่ยม!');
    // โหมดเอาชีวิตรอด: พักไม่ฟรี — ใช้ error จาก server เป็น toast
  };
  const isSurvival = character?.challengeMode === 'survival';

  if (!character) return null;

  return (
    <div className="screen">
      <header className="camp-header">
        <div>
          <div className="timer-title">🔥 ค่ายพัก</div>
          <div className="camp-sub">
            {breakOver
              ? `⏰ เลยเวลาพัก ${fmtTime(overrun)} — กด "เริ่มโฟกัส" เมื่อพร้อม`
              : `พักผ่อน เตรียมตัว เตรียมใจ ⏳ ${fmtTime(remain)}`}
          </div>
        </div>
        <div className="camp-header-right">
          <span className="gold-chip" title="ทองของคุณ">💰 {character.gold}</span>
          <button className="btn btn-sm" onClick={onSkip}>จบพักเร็ว ⏩</button>
        </div>
      </header>

      {/* สถานะตัวละครระหว่างพัก */}
      <div className="camp-vitals">
        <div className="hp-row"><span>❤️ HP</span><span>{character.hp}/{character.maxHp}</span></div>
        <div className="hp-bar"><div className="hp-fill hp-color" style={{ width: `${(character.hp / character.maxHp) * 100}%` }} /></div>
        <div className="hp-row"><span>💧 MP</span><span>{character.mp}/{character.maxMp}</span></div>
        <div className="hp-bar"><div className="hp-fill mp-color" style={{ width: `${(character.mp / character.maxMp) * 100}%` }} /></div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => { setTab(t.key); sfx.click(); }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'shop' && (
        <>
          {festival && (
            <div className="panel festival-panel">
              <div className="panel-title festival-title">{festival.icon} {festival.name} กำลังจัด!</div>
              <p className="festival-desc">{festival.desc} — สินค้าพิเศษในร้านลด 20% (สัปดาห์นี้ของเมืองนี้เท่านั้น)</p>
            </div>
          )}
          {blackMarket && (
            <div className="panel bm-panel">
              <div className="panel-title bm-title">🖤 ตลาดมืด (พ่อค้าเงาลึกลับ)</div>
              <p className="bm-hint">รับซื้อของขวัญ (junk) แพงกว่าปกติ <b>+25%</b> · ขายของหายาก + ของพิเศษ exclusive (ปกติได้จาก Daily Quest เท่านั้น!) ราคาลดพิเศษ — ซื้อได้ครั้งเดียวต่อค่ายพัก</p>
              <div className="shop-list">
                {blackMarket.items.map((i) => (
                  <div className="shop-row" key={i.id}>
                    <span className="inv-icon">{i.icon}</span>
                    <div className="inv-info">
                      <div className="inv-name">
                        {i.name} <span className="bm-tag">{i.bmTag}</span>
                      </div>
                      <ItemStatChips item={i} character={character} />
                      <div className="inv-desc">{i.desc}</div>
                      {i.bmNormal > 0 && (
                        <div className="bm-normal">ปกติ {i.bmNormal} ทอง → <b>{i.price} ทอง</b></div>
                      )}
                      {itemReqMissing(i, character).length > 0 && (
                        <div className="inv-req-block shop-warn">⚠️ ซื้อแล้วสวมไม่ได้ตอนนี้: {itemReqMissing(i, character).join(' · ')}</div>
                      )}
                    </div>
                    {i.bought ? (
                      <span className="sold-tag">ขายแล้ว</span>
                    ) : (
                      <button
                        className="btn btn-sm bm-buy"
                        disabled={character.gold < i.price}
                        onClick={() => buy(i)}
                      >
                        🖤 {i.price}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="panel">
            <div className="panel-title">🛒 ร้านค้าของพ่อค้าเร่ร่อน</div>
            <div className="shop-list">
              {shop.map((i) => (
                <div className="shop-row" key={i.id}>
                  <span className="inv-icon">{i.icon}</span>
                  <div className="inv-info">
                    <div className="inv-name">
                      {i.name} {twoHandTag(i)}
                      {i.festival ? <span className="festival-tag">{festival?.icon} ของเทศกาล -20%</span> : i.hot ? <span className="market-hot">🔥 ราคาขึ้น x{i.priceMult?.toFixed(1)}</span> : i.sale ? <span className="market-sale">🏷️ ลดราคา x{i.priceMult?.toFixed(1)}</span> : null}
                    </div>
                    <ItemStatChips item={i} character={character} />
                    <div className="inv-desc">{i.desc}</div>
                    {itemReqMissing(i, character).length > 0 && (
                      <div className="inv-req-block shop-warn">⚠️ ซื้อแล้วสวมไม่ได้ตอนนี้: {itemReqMissing(i, character).join(' · ')}</div>
                    )}
                  </div>
                  {i.bought ? (
                    <span className="sold-tag">ขายแล้ว</span>
                  ) : (
                    <div className="shop-buy">
                      {/* ราคาเดิม (ก่อนลด/ขึ้น) — ขีดฆ่าให้เห็นว่าราคาต่างจากปกติ */}
                      {(i.sale || i.hot) && i.originalPrice > 0 && i.originalPrice !== i.price && (
                        <s className="price-original">{i.originalPrice}</s>
                      )}
                      <button
                        className="btn btn-sm"
                        disabled={character.gold < i.price}
                        onClick={() => buy(i)}
                      >
                        💰 {i.price}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="hint">ทองของคุณ: 💰 {character.gold} — ราคาตามตลาดวันนี้ (🔥 ขึ้น / 🏷️ ลด) สินค้าสุ่มเปลี่ยนทุกค่ายพัก ซื้อได้ครั้งเดียวต่อค่ายพัก</p>
          </div>
        </>
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
            inventory.map((i) => {
              const sp = sellPrices[i.item_id] || {};
              return (
                <div className="inv-row" key={i.item_id}>
                  <span className="inv-icon">{i.icon}</span>
                  <div className="inv-info">
                    <div className="inv-name">
                      {i.name} {twoHandTag(i)} <span className="inv-qty">x{i.qty}</span>
                      {i.exclusive ? <span className="exclusive-tag">✦ พิเศษ</span> : null}
                      {sp.wanted ? <span className="wanted-tag">🔥 พ่อค้าต้องการ!</span> : null}
                      {blackMarket && i.type === 'junk' ? <span className="bm-tag">🖤 ตลาดมืดรับซื้อ +25%</span> : null}
                    </div>
                    <ItemStatChips item={i} character={character} />
                    <div className="inv-desc">{i.desc}</div>
                  </div>
                  <div className="inv-actions">
                    {i.type === 'consumable' ? (
                      <button className="btn btn-sm" onClick={() => useItem(i)}>ใช้</button>
                    ) : i.type === 'scroll' ? (
                      <span className="junk-note">📖 ใช้เรียนรู้สกิล (แท็บตัวละคร)</span>
                    ) : i.type === 'junk' ? null : (
                      <button className="btn btn-sm" onClick={() => equipItem(i)}>สวม</button>
                    )}
                    {i.type !== 'scroll' && (
                      <button className={`btn btn-sm ${blackMarket && i.type === 'junk' ? 'bm-buy' : sp.wanted ? 'btn-wanted' : 'btn-danger-soft'}`} onClick={() => sellItem(i)}>
                        💰 {sp.price ?? Math.round(i.price * 0.5)}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <p className="hint">ราคาขายเป็นราคาที่พ่อค้าแคมป์นี้รับซื้อ — ของที่พ่อค้า "ต้องการ" (🔥) ขายได้แพงขึ้น{blackMarket ? ' · 🖤 วันที่ตลาดมืดแวะมา รับซื้อของขวัญแพงกว่า +25%' : ''}</p>
        </div>
      )}

      {tab === 'char' && (
        <>
          {isSurvival ? (
            <button className="btn btn-primary btn-big" onClick={rest} style={{ background: '#7f1d1d' }}>🩸 พักฟื้นพลัง (โหมดเอาชีวิตรอด — ใช้ยาเท่านั้น)</button>
          ) : (
            <button className="btn btn-primary btn-big" onClick={rest}>🔥 พักฟื้นพลังเต็ม (ฟรี)</button>
          )}
          <CharacterSheet />
        </>
      )}
    </div>
  );
}
