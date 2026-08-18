import { useEffect, useState } from 'react';
import { useGame } from '../context.jsx';
import { sfx, isMuted, setMuted } from '../sound.js';
import { fmtTime } from './ui.jsx';
import CharacterSheet from './CharacterSheet.jsx';
import ItemStatChips, { itemReqMissing } from './ItemStats.jsx';
import ItemCompare from './ItemCompare.jsx';
import { petMoodOf, petPerkLabel } from '../meta.js';

const TABS = [
  { key: 'shop', label: 'ร้านค้า', icon: '🛒' },
  { key: 'quest', label: 'ภารกิจ', icon: '📜' },
  { key: 'craft', label: 'คราฟต์', icon: '🛠️' },
  { key: 'inv', label: 'กระเป๋า', icon: '🎒' },
  { key: 'char', label: 'ตัวละคร', icon: '🛡️' },
  { key: 'trophy', label: 'ถ้วยรางวัล', icon: '🏆' },
];

export default function CampScreen({ remain, total, running, breakOver = false, overrun = 0, onSkip, onHome, visit, postBoss = null }) {
  const { character, progress, get, post, inventory, showToast } = useGame();
  const [tab, setTab] = useState('shop');
  const [muted, setMutedState] = useState(isMuted());
  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    setMutedState(m);
    localStorage.setItem('pomoquest-muted', m ? '1' : '0');
  };
  const [shop, setShop] = useState([]);
  const [quests, setQuests] = useState([]);
  const [sellPrices, setSellPrices] = useState({}); // ราคาขายของแต่ละชิ้นตอนค่ายพักนี้ (พ่อค้าต้องการของบางชิ้น → แพงขึ้น)
  const [doneQuests, setDoneQuests] = useState({});
  const [questResults, setQuestResults] = useState({});
  const [blackMarket, setBlackMarket] = useState(null); // null = ไม่เจอตลาดมืดในค่ายนี้
  const [festival, setFestival] = useState(null); // เทศกาลประจำสัปดาห์ของเมืองนี้ (null = ไม่มี)
  const [recipes, setRecipes] = useState([]); // สูตรคราฟต์ที่เรียนรู้แล้ว (จากแบบแปลน) + สถานะวัสดุ
  const [trophies, setTrophies] = useState([]); // ถ้วยรางวัล (ชนะบอสครั้งแรกของบอสนั้น)
  const [sellTarget, setSellTarget] = useState(null); // ของที่กำลังกดขาย (มีซ้ำ >1 — ถามจำนวน)
  const [sellQty, setSellQty] = useState(1);

  useEffect(() => {
    (async () => {
      const d = await get(`/camp${visit ? `?visit=${encodeURIComponent(visit)}` : ''}`);
      if (d) {
        setShop(d.shop || []);
        setQuests(d.quests || []);
        // ภารกิจที่ทำแล้วในค่ายพักนี้ (server จำ — กลับหน้าหลักแล้วกลับมา ยังทำซ้ำไม่ได้)
        setDoneQuests(d.doneQuests || {});
        setSellPrices(d.sellPrices || {});
        setBlackMarket(d.blackMarket || null);
        setFestival(d.festival || null);
        setRecipes(d.recipes || []);
        setTrophies(d.trophies || []);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [get, visit]);

  const buy = async (item) => {
    sfx.click();
    const d = await post('/shop/buy', { itemId: item.id, visit });
    if (d) {
      // ขึ้นป้าย "ขายแล้ว" ทั้งร้านปกติและตลาดมืด (server โชว์ toast ยืนยันเองผ่าน d.message)
      setShop((s) => s.map((i) => (i.id === item.id ? { ...i, bought: 1 } : i)));
      setBlackMarket((bm) => (bm ? { ...bm, items: bm.items.map((i) => (i.id === item.id ? { ...i, bought: 1 } : i)) } : bm));
    }
  };

  const doQuest = async (q) => {
    sfx.click();
    const d = await post('/quest/do', { questId: q.id, visit }); // ส่ง visit — server จำว่าทำภารกิจนี้ในค่ายพักนี้แล้ว (ทำซ้ำไม่ได้)
    if (d) {
      setDoneQuests((s) => ({ ...s, [q.id]: true }));
      setQuestResults((s) => ({ ...s, [q.id]: d.result }));
      showToast(d.result.success ? 'ภารกิจสำเร็จ!' : 'ภารกิจไม่สำเร็จ…');
    }
  };

  const useItem = async (i) => {
    // server โชว์ toast ยืนยันเองผ่าน d.message (context apply)
    await post('/inventory/use', { itemId: i.item_id });
  };

  // คราฟต์ตามสูตรที่เรียนรู้แล้ว — วัสดุ (junk) ตัดจากกระเป๋า อัปเดตจำนวนที่เหลือทันที
  const craft = async (rc) => {
    sfx.click();
    const d = await post('/craft', { recipeId: rc.id });
    if (d) {
      setRecipes((rs) => rs.map((x) => (x.id !== rc.id ? x : { ...x, materials: x.materials.map((m) => ({ ...m, have: d.inventory?.find((i) => i.item_id === m.id)?.qty || 0 })) })));
    }
  };

  const equipItem = async (i) => {
    await post('/inventory/equip', { itemId: i.item_id });
  };

  // ขายของ — เปิด modal เลือกจำนวนเสมอ (แม้ 1 ชิ้น)
  const openSell = (i) => {
    sfx.click();
    setSellTarget(i);
    setSellQty(1);
  };

  const sellItem = async (i, qty) => {
    await post('/shop/sell', { itemId: i.item_id, qty, visit }); // server โชว์ toast ยืนยันเองผ่าน d.message
    setSellTarget(null);
  };

  const confirmSell = async () => {
    if (!sellTarget || sellQty < 1) return;
    await sellItem(sellTarget, Math.min(sellQty, sellTarget.qty));
  };
  const sellAll = async () => {
    if (!sellTarget) return;
    await sellItem(sellTarget, sellTarget.qty);
  };

  const twoHandTag = (i) => (i.type === 'weapon' && i.handed === 2 ? <span className="twohand-tag">สองมือ</span> : null);

  const rest = async () => {
    sfx.complete();
    // server โชว์ toast ยืนยันเองผ่าน d.message / error (โหมดเอาชีวิตรอด: พักไม่ฟรี)
    await post('/camp/rest');
  };
  const isSurvival = character?.challengeMode === 'survival';

  if (!character) return null;
  // 🐾 สัตว์เลี้ยงที่ใช้งาน — ฟองข้างชื่อค่าย (เหมือนฟองบนหน้าโฟกัส/Home)
  const activePet = (character.pets || []).find((p) => p.active) || null;
  const petMood = activePet ? petMoodOf(activePet, progress?.last_focus_date) : null;

  return (
    <div className="screen">
      <header className="camp-header">
        <div className="camp-title-block">
          <div className="camp-pet">
            {activePet && (
              <div
                className={`companion-bubble pet-mood-${petMood.level}`}
                title={`🐾 ${activePet.name} (Lv.${activePet.level}) — ${activePet.desc}\n📈 ค่าพิเศษปัจจุบัน: ${petPerkLabel(activePet)}\n${petMood.msg}`}
              >
                {activePet.icon}
                <span className="pet-lv-tag">Lv.{activePet.level}</span>
                <span className="pet-mood-emoji">{petMood.msg.split(' ')[0]}</span>
              </div>
            )}
          </div>
          <div>
            <div className="timer-title">{postBoss ? '🏆 พักหลังชัยชนะ!' : '🔥 ค่ายพัก'}</div>
            <div className="camp-sub">
              {breakOver
                ? `⏰ เลยเวลาพัก ${fmtTime(overrun)} — กด "เริ่มโฟกัส" เมื่อพร้อม`
                : postBoss
                  ? `${postBoss} — เตรียมตัวให้พร้อมก่อนเริ่มรอบใหม่ ⏳ ${fmtTime(remain)}`
                  : `พักผ่อน เตรียมตัว เตรียมใจ ⏳ ${fmtTime(remain)}`}
            </div>
          </div>
        </div>
        <div className="camp-header-right">
          <span className="gold-chip" title="ทองของคุณ">💰 {character.gold}</span>
          <button className="icon-btn" onClick={toggleMute} title={muted ? 'เปิดเสียง' : 'ปิดเสียง'}>
            {muted ? '🔇' : '🔊'}
          </button>
          {character.hatchPending && (
            <span className="hatch-chip" title="🥚 ไข่ปริศนากำลังฟักอยู่ — จะฟักหลังจบ 1 session โฟกัส">🥚 กำลังฟัก…</span>
          )}
          {onHome && (
            <button className="btn btn-sm" onClick={onHome} title="กลับหน้าหลัก — เวลาพักยังนับต่อ (หมดเวลาแล้วยังถามเริ่มโฟกัส/ต่อพักเหมือนเดิม)">
              🏠 กลับหน้าหลัก
            </button>
          )}
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
          {/* เจอตลาดมืด → พ่อค้าทั่วไปปิดร้าน ให้มีเพียงตลาดมืดเท่านั้น (เทศกาลของร้านก็เลื่อนไปด้วย) */}
          {!blackMarket && festival && (
            <div className="panel festival-panel">
              <div className="panel-title festival-title">{festival.icon} {festival.name} กำลังจัด!</div>
              <p className="festival-desc">{festival.desc} — สินค้าพิเศษในร้านลด 20% (สัปดาห์นี้ของเมืองนี้เท่านั้น)</p>
            </div>
          )}
          {blackMarket && (
          <>
            <div className="panel bm-panel">
              <div className="panel-title bm-title">🖤 ตลาดมืด (พ่อค้าเงาลึกลับ)</div>
              <p className="bm-hint">รับซื้อของขวัญ (junk) แพงกว่าปกติ <b>+25%</b> · ขายของหายาก/แบบแปลน/ของพิเศษ exclusive (ปกติได้จาก Daily Quest เท่านั้น!) ราคาลดพิเศษ — ขยะ/ของหายาก (junk) ราคาเต็ม (รับซื้อ +25% อยู่แล้ว ไม่ลดซ้ำ) — ซื้อได้ครั้งเดียวต่อค่ายพัก · บางชิ้นตลาดมืดไม่อยากได้ → ยกให้ฟรี 🎁</p>
              <div className="shop-list">
                {blackMarket.items.map((i) => (
                  <div className="shop-row" key={i.id}>
                    <span className="inv-icon">{i.icon}</span>
                    <div className="inv-info">
                      <div className="inv-name">
                        {i.name} {i.free ? <span className="free-tag">🎁 ของแถม</span> : null} <span className="bm-tag">{i.bmTag}</span>
                      </div>
                      <ItemStatChips item={i} character={character} />
                      <div className="inv-desc">{i.desc}</div>
                      {i.bmNormal > 0 && i.bmNormal !== i.price && (
                        <div className="bm-normal">ปกติ {i.bmNormal} ทอง → {i.free ? <b className="free-price">ฟรี!</b> : <b>{i.price} ทอง</b>}</div>
                      )}
                      <ItemCompare item={i} character={character} />
                      {itemReqMissing(i, character).length > 0 && (
                        <div className="inv-req-block shop-warn">⚠️ ซื้อแล้วสวมไม่ได้ตอนนี้: {itemReqMissing(i, character).join(' · ')}</div>
                      )}
                    </div>
                    {i.bought ? (
                      <span className="sold-tag">ขายแล้ว</span>
                    ) : (
                      <button
                        className={`btn btn-sm ${i.free ? 'free-buy' : 'bm-buy'}`}
                        disabled={character.gold < i.price}
                        onClick={() => buy(i)}
                      >
                        {i.free ? '🎁 ฟรี' : `🖤 ${i.price}`}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="shop-closed-note">🛒 พ่อค้าเร่ร่อนหลบไปให้ตลาดมืดคืนนี้ — ร้านปกติปิด (จะกลับมาเปิดอีกครั้งค่ายหน้า)</div>
          </>
          )}
          {!blackMarket && (
          <div className="panel">
            <div className="panel-title">🛒 ร้านค้าของพ่อค้าเร่ร่อน</div>
            <div className="shop-list">
              {shop.map((i) => (
                <div className="shop-row" key={i.id}>
                  <span className="inv-icon">{i.icon}</span>
                  <div className="inv-info">
                    <div className="inv-name">
                      {i.name} {twoHandTag(i)}
                      {i.free ? <span className="free-tag">🎁 ของแถม (พ่อค้าไม่อยากได้)</span> : i.festival ? <span className="festival-tag">{festival?.icon} ของเทศกาล -20%</span> : i.hot ? <span className="market-hot">🔥 ราคาขึ้น x{i.priceMult?.toFixed(1)}</span> : i.sale ? <span className="market-sale">🏷️ ลดราคา x{i.priceMult?.toFixed(1)}</span> : null}
                    </div>
                    <ItemStatChips item={i} character={character} />
                    <div className="inv-desc">{i.desc}</div>
                    {itemReqMissing(i, character).length > 0 && (
                      <div className="inv-req-block shop-warn">⚠️ ซื้อแล้วสวมไม่ได้ตอนนี้: {itemReqMissing(i, character).join(' · ')}</div>
                    )}
                    <ItemCompare item={i} character={character} />
                  </div>
                  {i.bought ? (
                    <span className="sold-tag">ขายแล้ว</span>
                  ) : (
                    <div className="shop-buy">
                      {/* ราคาเดิม (ก่อนลด/ขึ้น) — ขีดฆ่าให้เห็นว่าราคาต่างจากปกติ */}
                      {(i.sale || i.hot || i.free) && i.originalPrice > 0 && i.originalPrice !== i.price && (
                        <s className="price-original">{i.originalPrice}</s>
                      )}
                      <button
                        className={`btn btn-sm ${i.free ? 'free-buy' : ''}`}
                        disabled={character.gold < i.price}
                        onClick={() => buy(i)}
                      >
                        {i.free ? '🎁 ฟรี' : `💰 ${i.price}`}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="hint">ทองของคุณ: 💰 {character.gold} — ราคาตามตลาดวันนี้ (🔥 ขึ้น / 🏷️ ลด) สินค้าสุ่มเปลี่ยนทุกค่ายพัก ซื้อได้ครั้งเดียวต่อค่ายพัก · บางชิ้นพ่อค้าไม่อยากได้ → ยกให้ฟรี 🎁 (ของแถม)</p>
          </div>
          )}
        </>
      )}

      {tab === 'craft' && (
        <div className="panel">
          <div className="panel-title">🛠️ คราฟต์ — สูตรที่เรียนรู้แล้ว ({recipes.length})</div>
          {recipes.length === 0 ? (
            <p className="hint">ยังไม่มีสูตร — หาแบบแปลน 📋 ได้จากกล่องสมบัติ (โอกาสสูงกว่าใบสกิลนิดหน่อย) หรือชนะบอสเร่ร่อน 🐉 แล้วใช้เรียนรู้เหมือนคัมภีร์สกิล</p>
          ) : (
            <div className="craft-list">
              {recipes.map((rc) => {
                const ok = rc.materials.every((m) => m.have >= m.qty);
                return (
                  <div className={`craft-card ${ok ? 'can' : ''}`} key={rc.id}>
                    <div className="craft-top">
                      <span className="inv-icon">{rc.icon}</span>
                      <div className="inv-info">
                        <div className="inv-name">{rc.name}</div>
                        <div className="inv-desc">{rc.desc}</div>
                        <div className="craft-mats">
                          {rc.materials.map((m) => (
                            <span key={m.id} className={`craft-mat ${m.have >= m.qty ? 'ok' : 'no'}`}>
                              {m.icon} {m.name} {m.have}/{m.qty}
                            </span>
                          ))}
                          <span className="craft-arrow">→</span>
                          <span className="craft-result">{rc.result.icon} {rc.result.name} x{rc.result.qty}</span>
                        </div>
                      </div>
                    </div>
                    <button className={`btn btn-sm ${ok ? 'btn-primary' : ''}`} disabled={!ok} onClick={() => craft(rc)}>🛠️ คราฟต์</button>
                  </div>
                );
              })}
            </div>
          )}
          <p className="hint">วัสดุคือของขวัญ (junk) ที่ล่ามาได้ — คราฟต์ไม่เสียทอง · สูตรใหม่หาได้จากแบบแปลน 📋 (สมบัติ / บอสเร่ร่อน)</p>
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
                      <button
                        className="btn btn-sm"
                        onClick={() => useItem(i)}
                        disabled={!!(i.useEgg && (character.hatchPending || (character.pets || []).some((p) => p.active)))}
                        title={i.useEgg && character.hatchPending ? '🥚 มีไข่กำลังฟักอยู่แล้ว — รอให้ฟักหลังจบ 1 session ก่อนใช้ใบใหม่' : i.useEgg && (character.pets || []).some((p) => p.active) ? '🐾 มีสัตว์เลี้ยงอยู่ — ต้องเก็บสัตว์เลี้ยงก่อน (ใช้ 👜 กระเป๋าเก็บสัตว์)' : ''}
                      >
                        {i.useGift ? '🎁 เปิด' : i.usePetBag ? '👜 เก็บสัตว์' : 'ใช้'}
                      </button>
                    ) : i.type === 'scroll' ? (
                      <span className="junk-note">📖 ใช้เรียนรู้สกิล (แท็บตัวละคร)</span>
                    ) : i.type === 'blueprint' ? (
                      <span className="junk-note">📋 ใช้เรียนรู้สูตร (แท็บตัวละคร)</span>
                    ) : i.type === 'junk' ? null : (
                      <button className="btn btn-sm" onClick={() => equipItem(i)}>สวม</button>
                    )}
                    {i.type !== 'scroll' && (
                      <button className={`btn btn-sm ${blackMarket && i.type === 'junk' ? 'bm-buy' : sp.wanted ? 'btn-wanted' : 'btn-danger-soft'}`} onClick={() => openSell(i)}>
                        💰 {sp.price ?? Math.round(i.price * 0.5)}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <p className="hint">ราคาขายเป็นราคาที่พ่อค้าแคมป์นี้รับซื้อ — ของที่พ่อค้า "ต้องการ" (🔥) ขายได้แพงขึ้น · เมืองยิ่งไกล ราคายิ่งดี (x1.05/เมือง){blackMarket ? ' · 🖤 วันที่ตลาดมืดแวะมา รับซื้อของขวัญแพงกว่า +25%' : ''}</p>
        </div>
      )}

      {tab === 'trophy' && (
        <div className="panel">
          <div className="panel-title">🏆 ห้องเก็บถ้วยรางวัล ({trophies.length})</div>
          {trophies.length === 0 ? (
            <p className="hint">ยังไม่มีถ้วยรางวัล — ชนะบอสตัวแรกเพื่อเก็บถ้วยแรก! (ชนะบอสแต่ละตัวเป็นครั้งแรกจะได้ถ้วยสะสม)</p>
          ) : (
            <div className="trophy-list">
              {trophies.map((t) => (
                <div className="trophy-row" key={t.boss_key}>
                  <span className="trophy-icon">{t.icon}</span>
                  <span className="trophy-name">{t.boss_key}</span>
                  <span className="trophy-date">{(t.won_at || '').slice(0, 10)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="hint">ถ้วยจะถูกเก็บเมื่อชนะบอสตัวนั้นเป็นครั้งแรก — บอสเมือง 12 ตัว + บอสลับ + บอสเร่ร่อน 🐉 (พร้อมของรางวัลการันตี + แบบแปลน)</p>
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

      {/* ถามจำนวนที่จะขาย — เมื่อมีของชนิดเดียวกันมากกว่า 1 ชิ้น */}
      {sellTarget && (
        <div className="modal-backdrop" onClick={() => setSellTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>💰 ขาย {sellTarget.icon} {sellTarget.name}</h2>
            <p className="hint">
              มีอยู่ x{sellTarget.qty} — ขายกี่ชิ้น? (ชิ้นละ {sellPrices[sellTarget.item_id]?.price ?? Math.round(sellTarget.price * 0.5)} ทอง)
            </p>
            <div className="qty-picker">
              <button className="btn" onClick={() => setSellQty((q) => Math.max(1, q - 1))}>−</button>
              <span className="qty-picker-num">{sellQty}</span>
              <button className="btn" onClick={() => setSellQty((q) => Math.min(sellTarget.qty, q + 1))}>+</button>
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={confirmSell}>
                💰 ขาย {sellQty} ชิ้น — {(sellPrices[sellTarget.item_id]?.price ?? Math.round(sellTarget.price * 0.5)) * sellQty} ทอง
              </button>
              {sellTarget.qty > 1 && (
                <button className="btn btn-wanted" onClick={sellAll}>
                  💰 ขายทั้งหมด x{sellTarget.qty} — {(sellPrices[sellTarget.item_id]?.price ?? Math.round(sellTarget.price * 0.5)) * sellTarget.qty} ทอง
                </button>
              )}
              <button className="btn" onClick={() => setSellTarget(null)}>ยกเลิก</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
