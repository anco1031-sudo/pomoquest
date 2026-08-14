// ---- ข้อมูลเกมทั้งหมด (items, classes, monsters, events, quests, cities, bosses) ----

export const CLASSES = {
  warrior: {
    name: 'นักรบ', en: 'Warrior', icon: '⚔️',
    desc: 'เลือดหนา พลังโจมตีสูง เหมาะกับสายบุก',
    base: { hp: 120, mp: 20, atk: 14, def: 10, spd: 8, crit: 5 },
  },
  mage: {
    name: 'นักเวทย์', en: 'Mage', icon: '🔮',
    desc: 'เวทมนตร์รุนแรงที่สุด แต่ร่างกายบอบบาง',
    base: { hp: 80, mp: 60, atk: 16, def: 6, spd: 10, crit: 8 },
  },
  rogue: {
    name: 'โจร', en: 'Rogue', icon: '🗡️',
    desc: 'ว่องไว โจมตีคริติคอลถี่ หลบเก่ง',
    base: { hp: 95, mp: 30, atk: 12, def: 7, spd: 14, crit: 15 },
  },
  cleric: {
    name: 'นักบวช', en: 'Cleric', icon: '✨',
    desc: 'สายสมดุล มนามาก ฟื้นพลังได้เรื่อย ๆ',
    base: { hp: 100, mp: 50, atk: 10, def: 9, spd: 9, crit: 6 },
  },
};

// item.type: 'consumable' | 'weapon' | 'armor' | 'accessory'
export const ITEMS = [
  { id: 1,  name: 'ยาบำบัดน้อย', icon: '🧪', type: 'consumable', heal_pct: 0.3,  mana_pct: 0,   price: 25,  desc: 'ฟื้น HP 30% ของพลังสูงสุด' },
  { id: 2,  name: 'ยาบำบัดใหญ่', icon: '⚗️', type: 'consumable', heal_pct: 0.6,  mana_pct: 0,   price: 60,  desc: 'ฟื้น HP 60% ของพลังสูงสุด' },
  { id: 3,  name: 'น้ำอมฤต',     icon: '💧', type: 'consumable', heal_pct: 0,    mana_pct: 0.4, price: 30,  desc: 'ฟื้น MP 40% ของพลังสูงสุด' },
  { id: 4,  name: 'ยาฟื้นฟูเต็ม', icon: '✨', type: 'consumable', heal_pct: 1,    mana_pct: 1,   price: 120, desc: 'ฟื้น HP และ MP 100%' },

  { id: 10, name: 'มีดสั้นเก่า',   icon: '🔪', type: 'weapon', atk_bonus: 3,  price: 40,  desc: 'มีดเก่า ๆ แต่ยังคม', lvl: 1 },
  { id: 11, name: 'ดาบเหล็ก',     icon: '⚔️', type: 'weapon', atk_bonus: 6,  price: 90,  desc: 'ดาบเหล็กมาตรฐานทหาร', lvl: 2 },
  { id: 12, name: 'ขวานสงคราม',   icon: '🪓', type: 'weapon', atk_bonus: 10, price: 180, desc: 'ขวานหนัก ทุบได้ทั้งเกราะ', lvl: 3 },
  { id: 13, name: 'ดาบเพชรนิล',   icon: '💎', type: 'weapon', atk_bonus: 15, price: 320, desc: 'ดาบในตำนาน ส่องแสงสีม่วง', lvl: 5 },

  { id: 20, name: 'เกราะหนัง',   icon: '🛡️', type: 'armor', def_bonus: 3,  hp_bonus: 10, price: 50,  desc: 'เกราะหนังสัตว์ เหนียวพอตัว', lvl: 1 },
  { id: 21, name: 'เกราะโซ่',    icon: '⛓️', type: 'armor', def_bonus: 6,  hp_bonus: 25, price: 120, desc: 'เกราะโซ่เหล็ก ทนทาน', lvl: 2 },
  { id: 22, name: 'เกราะเหล็ก',  icon: '🛡️', type: 'armor', def_bonus: 10, hp_bonus: 45, price: 240, desc: 'เกราะเต็มยศของอัศวิน', lvl: 3 },
  { id: 23, name: 'เกราะมังกร',  icon: '🐲', type: 'armor', def_bonus: 16, hp_bonus: 80, price: 420, desc: 'ทำจากเกล็ดมังกร กันเวทได้', lvl: 5 },

  { id: 30, name: 'แหวนเงิน',     icon: '💍', type: 'accessory', spd_bonus: 2, crit_bonus: 2, price: 60,  desc: 'แหวนเงินเรืองแสง', lvl: 1 },
  { id: 31, name: 'สร้อยเวท',     icon: '📿', type: 'accessory', mp_bonus: 20, price: 100, desc: 'สร้อยที่อัดแน่นด้วยมานา', lvl: 2 },
  { id: 32, name: 'รองเท้าเงา',   icon: '👟', type: 'accessory', spd_bonus: 5, price: 150, desc: 'เดินเบาเหมือนเงา', lvl: 3 },
  { id: 33, name: 'ต่างหูมรกต',   icon: '💚', type: 'accessory', crit_bonus: 8, price: 260, desc: 'มรกตเขียวขจี เพิ่มดวง', lvl: 4 },

  // ---- ไอเทมพิเศษเฉพาะ Daily Quest (exclusive: true — หาซื้อตามร้านไม่ได้) ----
  { id: 40, name: 'ถุงเงินนำโชค',     icon: '🧧', type: 'consumable', use_gold: 150, price: 80, exclusive: true, desc: '✦ พิเศษ — ใช้แล้วได้ทอง 150 ทันที' },
  { id: 41, name: 'คัมภีร์ประสบการณ์', icon: '📜', type: 'consumable', use_xp: 120, price: 80, exclusive: true, desc: '✦ พิเศษ — ใช้แล้วได้ XP 120 ทันที' },
  { id: 42, name: 'สมุดนำโชค',       icon: '🍀', type: 'accessory', spd_bonus: 3, crit_bonus: 4, price: 200, exclusive: true, desc: '✦ พิเศษ — เครื่องรางจากดินแดนแห่งโชค' },
  { id: 43, name: 'มงกุฎนักโฟกัส',   icon: '👑', type: 'accessory', hp_bonus: 40, mp_bonus: 15, price: 250, exclusive: true, desc: '✦ พิเศษ — รางวัลแห่งผู้มุ่งมั่น' },
  { id: 44, name: 'อีลิกเซอร์บริสุทธิ์', icon: '⚡', type: 'consumable', heal_pct: 1, mana_pct: 1, price: 200, exclusive: true, desc: '✦ พิเศษ — ฟื้น HP + MP 100% ทันที' },
];

export const ITEM_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

// เมืองตามรอบการเดินทาง (index = city_index)
export const CITIES = [
  { name: 'หมู่บ้านอีสตาร์', icon: '🌾', terrain: 'ทุ่งหญ้ากว้าง' },
  { name: 'เมืองมิราเคิล',   icon: '🏘️', terrain: 'ตลาดค้าขาย' },
  { name: 'นครธารา',       icon: '🌊', terrain: 'ท่าเรือกลางทะเล' },
  { name: 'ป่าอาร์คานา',    icon: '🌲', terrain: 'ป่าลึกมีมนต์ขลัง' },
  { name: 'เทือกเขาอัคนี',   icon: '🌋', terrain: 'ภูเขาไฟร้อนระอุ' },
  { name: 'เมืองคริสตัล',    icon: '💎', terrain: 'หุบเขาคริสตัล' },
  { name: 'ดินแดนน้ำแข็ง',   icon: '🧊', terrain: 'ทุ่งหิมะนิรันดร์' },
  { name: 'แอสการ์ด',       icon: '🏰', terrain: 'เมืองหลวงในตำนาน' },
];

export const BOSSES = [
  { name: 'หัวหน้าโจรป่า', icon: '🐗' },
  { name: 'กัปตันทหารรับจ้าง', icon: '⚔️' },
  { name: 'แม่ทัพเงาแห่งท่าเรือ', icon: '🗡️' },
  { name: 'ราชินีแม่มด', icon: '🧙' },
  { name: 'โกลเลมไฟ', icon: '🔥' },
  { name: 'คริสตัลการ์เดี้ยน', icon: '🔮' },
  { name: 'มังกรน้ำแข็ง', icon: '🐉' },
  { name: 'จอมมารเงา', icon: '👹' },
];

// มอนสเตอร์ที่เจอระหว่างผจญภัย (power_mult คูณพลังมอนสเตอร์ตามเลเวล)
export const MONSTERS = [
  { name: 'หนูยักษ์',     icon: '🐀', power: 0.7, xp: 14, gold: 8 },
  { name: 'ค้างคาวปีศาจ', icon: '🦇', power: 0.85, xp: 18, gold: 10 },
  { name: 'หมาป่าเถื่อน', icon: '🐺', power: 1.0, xp: 24, gold: 14 },
  { name: 'สไลม์พิษ',    icon: '🟢', power: 0.9, xp: 20, gold: 12 },
  { name: 'โกเลมดิน',    icon: '🗿', power: 1.15, xp: 30, gold: 18 },
  { name: 'แม่มดน้อย',   icon: '🧙‍♀️', power: 1.25, xp: 36, gold: 22 },
  { name: 'อสูรเงา',     icon: '👤', power: 1.35, xp: 42, gold: 26 },
  { name: 'มังกรน้อย',   icon: '🐲', power: 1.5, xp: 55, gold: 35 },
];

// เหตุการณ์สุ่มระหว่าง session ผจญภัย (weight = โอกาส)
export const EVENT_POOL = [
  {
    key: 'monster', weight: 40,
    title: '🐺 เจอมอนสเตอร์!',
    flavor: 'เสียงคำรามดังมาจากพุ่มไม้… {monster} ขวางเส้นทางอยู่!',
  },
  {
    key: 'treasure', weight: 34,
    title: '🎁 เจอสมบัติ!',
    flavor: 'แสงวาววับใต้โคนต้นไม้ — กล่องสมบัติโบราณ!',
  },
  {
    key: 'shrine', weight: 10,
    title: '⛩️ ศาลเจ้าลึกลับ',
    flavor: 'ศาลเจ้าที่ถูกลืมกลางป่า… มีพลังบางอย่างลอยอบอวล',
  },
  {
    key: 'merchant', weight: 9,
    title: '🧙 พ่อค้าเร่ร่อน',
    flavor: 'พ่อค้าแปลกหน้าโบกมือทัก — “ดูเหมือนนักผจญภัยอย่างนายต้องการของดี ๆ นะ!”',
  },
  {
    key: 'trap', weight: 7,
    title: '⚠️ กับดัก!',
    flavor: 'พื้นทรุดลง — กับดักเก่าของนักล่าสมบัติ!',
  },
];

// ภารกิจย่อยช่วงพักสั้น (success = โอกาสสำเร็จ 0-1)
export const QUESTS = [
  { id: 'q1', title: 'เก็บสมุนไพรให้หมอแคมป์', icon: '🌿', detail: 'หมอประจำแคมป์ขอสมุนไพรหายากกลางป่า', xp: 30, gold: 15, success: 0.9, fail: 'เจอแต่ต้นมีพิษ เดินผิดทางกลับแคมป์', win: 'หมอดีใจมาก มอบรางวัลให้!' },
  { id: 'q2', title: 'ลาดตระเวนรอบค่าย', icon: '🔥', detail: 'ช่วยทหารยามลาดตระเวนรอบค่ายตอนกลางคืน', xp: 20, gold: 10, success: 0.95, fail: 'โดนตำหนิที่เผลอหลับระหว่างเวร', win: 'ปลอดภัยดี ได้ค่าจ้างจากหัวหน้าทหาร' },
  { id: 'q3', title: 'สำรวจถ้ำมืด', icon: '🕳️', detail: 'ถ้ำลึกหลังน้ำตก มีเสียงลึกลับดังออกมา', xp: 50, gold: 25, success: 0.65, fail: 'เจอกับดักหนาม เจ็บตัวหน่อย', win: 'เจอหีบสมบัติของโจรเก่า!' },
  { id: 'q4', title: 'ช่วยชาวบ้านเก็บฟืน', icon: '🪵', detail: 'ชาวบ้านขอแรงช่วยเก็บฟืนหน้าหนาว', xp: 15, gold: 8, success: 0.95, fail: 'ฟืนทับนิ้ว เจ็บเล็กน้อย', win: 'ชาวบ้านเลี้ยงข้าวเย็นให้อิ่มหนำ' },
  { id: 'q5', title: 'ตามหาของหายในตลาด', icon: '🔍', detail: 'แม่ค้าทำแหวนมรดกหายกลางตลาด', xp: 35, gold: 20, success: 0.75, fail: 'หาไม่เจอ โดนแม่ค้าบ่นจนหูชา', win: 'เจอแหวนใต้ร้านขายปลา ได้รางวัล!' },
  { id: 'q6', title: 'ฝึกซ้อมกับทหารยาม', icon: '🤺', detail: 'ท้าประลองกับทหารยามจอมเก่ง', xp: 45, gold: 0, success: 0.7, fail: 'แพ้ซะยับ แต่ก็ได้ประสบการณ์', win: 'ชนะ! ทหารยามยอมรับฝีมือ' },
];

// ร้านค้าขายเฉพาะไอเทมธรรมดา — ไอเทม exclusive (พิเศษ) หาซื้อไม่ได้
// (item.type: consumable/weapon/armor/accessory, exclusive = ได้จาก Daily Quest เท่านั้น)
export const SHOP_STOCK = ITEMS.filter((i) => !i.exclusive && (i.type !== 'consumable' || [1, 2, 3, 4].includes(i.id)));

// ----- ภารกิจประจำวัน (Daily Quest) — สุ่ม 3 อันต่อวันตามเลเวล -----
// key ตรงกับชื่อ counter ใน daily_counter ตาราง
export const DAILY_QUESTS = [
  { id: 'dq_focus_sessions', name: 'นักโฟกัสประจำวัน', icon: '🎯', key: 'sessions', target: (lvl) => 2 + (lvl >= 10 ? 1 : 0), desc: 'โฟกัสครบ {n} session วันนี้', unit: 'count' },
  { id: 'dq_treasure',      name: 'นักล่าสมบัติ',     icon: '💰', key: 'treasures', target: (lvl) => 2 + (lvl >= 8 ? 1 : 0), desc: 'เจอสมบัติ {n} ครั้งวันนี้', unit: 'count' },
  { id: 'dq_monster',       name: 'นักล่ามอนสเตอร์',  icon: '🐺', key: 'monsters', target: (lvl) => 5 + (lvl >= 8 ? 2 : 0), desc: 'กำจัดมอนสเตอร์ {n} ตัววันนี้', unit: 'count' },
  { id: 'dq_camp_quest',    name: 'สายภารกิจแคมป์',   icon: '📜', key: 'camp_quests', target: () => 2, desc: 'ทำภารกิจแคมป์ {n} ครั้งวันนี้', unit: 'count' },
  { id: 'dq_boss',          name: 'นักล่าบอสรายวัน',  icon: '👹', key: 'boss_wins', target: () => 1, desc: 'ชนะบอส 1 ตัววันนี้', unit: 'count' },
  { id: 'dq_potion',        name: 'นักเล่นแร่แปรธาตุ', icon: '🧪', key: 'potions', target: (lvl) => 3 + (lvl >= 10 ? 2 : 0), desc: 'ใช้ยา {n} ขวดวันนี้', unit: 'count' },
  { id: 'dq_shop',          name: 'ลูกค้าประจำ',      icon: '🛒', key: 'items_bought', target: (lvl) => 3 + (lvl >= 8 ? 2 : 0), desc: 'ซื้อของ {n} ชิ้นวันนี้', unit: 'count' },
  { id: 'dq_focus_min',     name: 'มาราธอนรายวัน',    icon: '⏳', key: 'focus_sec', target: (lvl) => 50 * 60 + (lvl >= 10 ? 10 * 60 : 0), desc: 'โฟกัสครบ {n} นาทีวันนี้', unit: 'min' },
];

// ----- Achievement (stat = ตัวเลขที่ใช้เปรียบเทียบ ดูใน achievements.js) -----
export const ACHIEVEMENTS = [
  { id: 'first_step',  name: 'ก้าวแรก',          icon: '🐣', stat: 'sessions',  target: 1,    reward: { gold: 20 }, desc: 'ทำโฟกัสครบ 1 session' },
  { id: 'first_level', name: 'เริ่มเติบโต',      icon: '⬆️', stat: 'level',     target: 2,    reward: { gold: 25 }, desc: 'อัพเป็นเลเวล 2' },
  { id: 'first_boss',  name: 'นักล่าบอส',       icon: '⚔️', stat: 'bosses',    target: 1,    reward: { gold: 100 }, desc: 'ชนะบอสตัวแรก' },
  { id: 'treasure_5',  name: 'นักล่าสมบัติ',     icon: '💰', stat: 'treasures', target: 5,    reward: { gold: 50 }, desc: 'เจอสมบัติ 5 ครั้ง' },
  { id: 'monster_10',  name: 'นักกำจัดมอนสเตอร์', icon: '🐺', stat: 'monsters',  target: 10,   reward: { gold: 50 }, desc: 'กำจัดมอนสเตอร์ 10 ตัว' },
  { id: 'quest_5',     name: 'นักทำภารกิจ',     icon: '📜', stat: 'quests',    target: 5,    reward: { gold: 50 }, desc: 'ทำภารกิจสำเร็จ 5 ครั้ง' },
  { id: 'streak_3',    name: 'คอมโบเริ่มต้น',    icon: '🧵', stat: 'streak',    target: 3,    reward: { gold: 30 }, desc: 'คอมโบโฟกัส 3 session ติดต่อ' },
  { id: 'equip_all',   name: 'พร้อมรบเต็มยศ',   icon: '🔧', stat: 'equip',     target: 1,    reward: { gold: 50 }, desc: 'สวมอุปกรณ์ครบทั้ง 3 ช่อง' },
  { id: 'focus_5h',    name: 'ห้าชั่วโมงแห่งโฟกัส', icon: '⏳', stat: 'focus_sec', target: 18000, reward: { gold: 100 }, desc: 'โฟกัสรวม 5 ชั่วโมง' },
  { id: 'gold_1000',   name: 'เศรษฐีน้อย',      icon: '🏦', stat: 'gold_earned', target: 1000, reward: { gold: 50 }, desc: 'สะสมทองรวม 1,000' },

  { id: 'focus_10',    name: 'นักโฟกัส',        icon: '🎯', stat: 'sessions',  target: 10,   reward: { gold: 50 }, desc: 'ทำโฟกัสครบ 10 session' },
  { id: 'level_5',     name: 'นักผจญภัย',      icon: '🛡️', stat: 'level',     target: 5,    reward: { gold: 50 }, desc: 'อัพเป็นเลเวล 5' },
  { id: 'boss_5',      name: 'นักล่าบอสสายอาชีพ', icon: '🗡️', stat: 'bosses',   target: 5,    reward: { gold: 250 }, desc: 'ชนะบอส 5 ตัว' },
  { id: 'treasure_20', name: 'ราชาสมบัติ',      icon: '💎', stat: 'treasures', target: 20,   reward: { gold: 200 }, desc: 'เจอสมบัติ 20 ครั้ง' },
  { id: 'monster_50',  name: 'นักล่ามอนสเตอร์', icon: '💀', stat: 'monsters',  target: 50,   reward: { gold: 200 }, desc: 'กำจัดมอนสเตอร์ 50 ตัว' },
  { id: 'quest_15',    name: 'สายภารกิจ',      icon: '🏅', stat: 'quests',    target: 15,   reward: { gold: 150 }, desc: 'ทำภารกิจสำเร็จ 15 ครั้ง' },
  { id: 'streak_7',    name: 'คอมโบร้อนแรง',   icon: '⚡', stat: 'streak',    target: 7,    reward: { gold: 100 }, desc: 'คอมโบโฟกัส 7 session ติดต่อ' },
  { id: 'traveler',    name: 'นักเดินทาง',      icon: '🚶', stat: 'cycles',    target: 2,    reward: { gold: 100 }, desc: 'เดินทางครบ 2 รอบเมือง' },
  { id: 'focus_20h',   name: 'ยี่สิบชั่วโมงแห่งโฟกัส', icon: '🧘', stat: 'focus_sec', target: 72000, reward: { gold: 300 }, desc: 'โฟกัสรวม 20 ชั่วโมง' },
  { id: 'gold_5000',   name: 'เศรษฐีใหม่',      icon: '💰', stat: 'gold_earned', target: 5000, reward: { gold: 200 }, desc: 'สะสมทองรวม 5,000' },

  { id: 'focus_50',    name: 'สายโฟกัสตัวจริง', icon: '🔥', stat: 'sessions',  target: 50,   reward: { gold: 200 }, desc: 'ทำโฟกัสครบ 50 session' },
  { id: 'level_10',    name: 'นักรบผู้แข็งแกร่ง', icon: '🗡️', stat: 'level',    target: 10,   reward: { gold: 150 }, desc: 'อัพเป็นเลเวล 10' },
  { id: 'boss_10',     name: 'ราชันย์นักล่าบอส', icon: '🐲', stat: 'bosses',   target: 10,   reward: { gold: 500 }, desc: 'ชนะบอส 10 ตัว' },
  { id: 'focus_100',   name: 'ตำนานแห่งโฟกัส', icon: '👑', stat: 'sessions',  target: 100,  reward: { gold: 500 }, desc: 'ทำโฟกัสครบ 100 session' },
  { id: 'level_20',    name: 'ตำนานมีชีวิต',    icon: '🌟', stat: 'level',     target: 20,   reward: { gold: 400 }, desc: 'อัพเป็นเลเวล 20' },
];

// ----- ตราลับ: เงื่อนไขซ่อน (check(ctx) คืน true เมื่อผ่าน) ctx ดูใน achievements.js -----
export const SECRET_ACHIEVEMENTS = [
  { id: 'owl',            name: 'นกฮูกกลางคืน',   icon: '🌙', hint: 'มีบางอย่างพิเศษในยามวิกาล…',                     reward: { gold: 150 }, check: (ctx) => ctx.hour >= 0 && ctx.hour < 4 },
  { id: 'early_bird',     name: 'นกเช้า',          icon: '🌅', hint: 'รุ่งอรุณมอบพลังให้ผู้ตื่นก่อนใคร',                 reward: { gold: 150 }, check: (ctx) => ctx.hour >= 5 && ctx.hour < 7 },
  { id: 'seven_days',     name: 'เจ็ดวันมหัศจรรย์', icon: '📅', hint: 'ทุกวันคือวันผจญภัย',                             reward: { gold: 500 }, check: (ctx) => ctx.dailyStreak >= 7 },
  { id: 'fenix',          name: 'ฟีนิกซ์',         icon: '🔥', hint: 'ก้าวข้ามขีดจำกัดของมนุษย์',                       reward: { gold: 300 }, check: (ctx) => ctx.streak >= 10 },

  { id: 'legend_treasure', name: 'สมบัติในตำนาน',  icon: '💎', hint: 'สมบัติบางอย่างอยู่ในเงามืดมานาน',                 reward: { gold: 200 }, check: (ctx) => ctx.eventItemLvl >= 4 },
  { id: 'merchant_friend', name: 'เพื่อนพ่อค้า',   icon: '🤝', hint: 'ของขวัญมักมาในหน้ากากของคนแปลกหน้า',              reward: { gold: 100 }, check: (ctx) => ctx.merchantGifts >= 3 },
  { id: 'devotee',        name: 'ผู้ศรัทธา',       icon: '⛩️', hint: 'เทพเจ้าเฝ้ามองผู้ที่เดินทางซ้ำ ๆ',                  reward: { gold: 150 }, check: (ctx) => ctx.shrines >= 5 },
  { id: 'expensive_lesson', name: 'บทเรียนราคาแพง', icon: '🧨', hint: 'ความเจ็บปวดคือครูที่ดีที่สุด',                   reward: { gold: 100 }, check: (ctx) => ctx.traps >= 10 },

  { id: 'abyss',          name: 'ขอบเหว',         icon: '💀', hint: 'ความตายจ้องหน้าคุณ… แล้วคุณก็ยิ้มกลับ',             reward: { gold: 400 }, check: (ctx) => ctx.bossPlayerHp === 1 },
  { id: 'bloodthirst',    name: 'นักสู้เลือดเดือด', icon: '🩸', hint: 'ยิ่งเลือดน้อย ยิ่งโกรธเกรี้ยว',                    reward: { gold: 250 }, check: (ctx) => ctx.bossHpPct >= 0 && ctx.bossHpPct < 15 },
  { id: 'saint',          name: 'นักบุญ',          icon: '🗿', hint: 'แค่สองมือเปล่า ๆ ก็พอ',                           reward: { gold: 350 }, check: (ctx) => ctx.bossNoEquip === true },
  { id: 'alchemist',      name: 'นักเล่นแร่แปรธาตุ', icon: '🧪', hint: 'ผู้ที่เตรียมพร้อม ย่อมชนะเสมอ',                  reward: { gold: 150 }, check: (ctx) => ctx.bossPotions >= 10 },

  { id: 'explorer',       name: 'นักสำรวจ',        icon: '🗺️', hint: 'ขอบโลกมีจริงหรือ?',                              reward: { gold: 600 }, check: (ctx) => ctx.cycles >= 8 },
  { id: 'asgard_slayer',  name: 'ผู้พิชิตแอสการ์ด', icon: '👹', hint: 'ตำนานเล่าถึงจอมมารเงา…',                         reward: { gold: 800 }, check: (ctx) => ctx.bossCityIndex === 7 },
  { id: 'master',         name: 'จ้าวแห่งการโฟกัส', icon: '🏆', hint: 'เมื่อความสำเร็จทั้งหมดมารวมกัน…',                  reward: { gold: 1000 }, check: (ctx) => ctx.normalUnlocked >= ACHIEVEMENTS.length },
];
