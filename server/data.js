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

// ----- สกิลของแต่ละคลาส (ใช้ตอนสู้บอส + มีโอกาสเล็กน้อยใช้ใน event อัตโนมัติ) -----
// mp = มานาที่ใช้, dmg = ตัวคูณพลังโจมตี, healPct = ฟื้น HP %ของพลังสูงสุด
// critChance/critMult = โอกาส/ตัวคูณคริติคอลของสกิล, freeze = โอกาสแช่แข็งบอส (ข้ามเทิร์น)
// poison = %HP ที่บอสเสียต่อเทิร์น (2 เทิร์น), hits = โจมตีกี่ครั้ง, buffAtk = โจมตีเทิร์นหน้า x?, mpHeal = ฟื้น MP
export const SKILLS = {
  warrior: [
    { id: 'ws_power', name: 'ฟันแหลก',     icon: '⚔️', desc: 'โจมตี x1.8 (คริติคอลได้)',              mp: 6,  dmg: 1.8 },
    { id: 'ws_guard', name: 'เกราะเหล็ก',   icon: '🛡️', desc: 'ฟื้น HP 25% ของพลังสูงสุด',            mp: 10, healPct: 0.25 },
    { id: 'ws_fury',  name: 'คลั่งอาฆาต',   icon: '💥', desc: 'โจมตี x2.5 แต่แลกด้วย MP ที่สูงมาก',  mp: 18, dmg: 2.5 },
  ],
  mage: [
    { id: 'mg_fire',  name: 'ลูกไฟ',        icon: '🔥', desc: 'โจมตี x2.0',                          mp: 8,  dmg: 2.0 },
    { id: 'mg_frost', name: 'น้ำแข็งแหลม',  icon: '❄️', desc: 'โจมตี x1.5 + 30% แช่แข็งบอส (ข้ามเทิร์น)', mp: 12, dmg: 1.5, freeze: 0.3 },
    { id: 'mg_bolt',  name: 'สายฟ้าพิภพ',   icon: '⚡', desc: 'โจมตี x2.8 MP สูงมาก',                 mp: 22, dmg: 2.8 },
  ],
  rogue: [
    { id: 'rg_back',  name: 'แทงลับ',       icon: '🗡️', desc: 'โจมตี x1.6 + คริติคอล 50% (x2.5)',   mp: 8,  dmg: 1.6, critChance: 0.5, critMult: 2.5 },
    { id: 'rg_poison', name: 'ยาพิษ',       icon: '☠️', desc: 'บอสเสีย 8% HP ต่อเทิร์น (2 เทิร์น)',   mp: 14, poison: 0.08 },
    { id: 'rg_dance', name: 'วายุระบำ',     icon: '🌪️', desc: 'โจมตี 3 ครั้ง ครั้งละ x0.7',          mp: 16, hits: 3, dmg: 0.7 },
  ],
  cleric: [
    { id: 'cl_heal',  name: 'ฟื้นพลัง',      icon: '✨', desc: 'ฟื้น HP 35% ของพลังสูงสุด',            mp: 10, healPct: 0.35 },
    { id: 'cl_holy',  name: 'แสงศักดิ์สิทธิ์', icon: '🔆', desc: 'โจมตี x1.4 + ฟื้น HP 15%',            mp: 14, dmg: 1.4, healPct: 0.15 },
    { id: 'cl_bless', name: 'อวยพร',        icon: '🙏', desc: 'เทิร์นหน้าโจมตี x1.5 + ฟื้น MP 20',   mp: 12, buffAtk: 1.5, mpHeal: 20 },
  ],
};

// ----- สกิลที่เรียนได้จากคัมภีร์หายาก (เจอในกล่องสมบัติ — โอกาสน้อยมาก) -----
// เรียนได้ทุกคลาส — เมื่อใช้คัมภีร์ สกิลนี้จะถูกเพิ่มให้ตัวละคร (เลเวล 1 เหมือนสกิลคลาส)
export const SCROLL_SKILLS = [
  { id: 'sc_fireball', name: 'ลูกไฟใหญ่',   icon: '🔥', desc: 'โจมตี x2.2 (คริติคอลได้)',              mp: 14, dmg: 2.2 },
  { id: 'sc_heal',     name: 'แสงรักษา',    icon: '💖', desc: 'ฟื้น HP 50% ของพลังสูงสุด',            mp: 12, healPct: 0.5 },
  { id: 'sc_thunder',  name: 'สายฟ้าพิภพ',  icon: '⚡', desc: 'โจมตี x2.6',                          mp: 18, dmg: 2.6 },
  { id: 'sc_venom',    name: 'พิษร้าย',     icon: '🐍', desc: 'บอสเสีย 12% HP ต่อเทิร์น (2 เทิร์น)',   mp: 16, poison: 0.12 },
  { id: 'sc_guard',    name: 'โล่เวท',      icon: '🛡️', desc: 'ลดดาเมจที่ได้รับ 60% ในเทิร์นนี้',      mp: 10, shield: 0.6 },
  { id: 'sc_haste',    name: 'สายฟ้าแลบ',  icon: '🌀', desc: 'โจมตี 2 ครั้ง ครั้งละ x1.1',           mp: 12, hits: 2, dmg: 1.1 },
];
export const SCROLL_SKILL_BY_ID = Object.fromEntries(SCROLL_SKILLS.map((s) => [s.id, s]));

// item.type: 'consumable' | 'junk' | 'scroll' | 'weapon' | 'shield' | 'armor' | 'head' | 'arms' | 'legs' | 'feet' | 'accessory'
// item.handed: (เฉพาะ weapon) 1 = มือเดียว, 2 = สองมือ (ปิดช่องมือรอง)
export const ITEMS = [
  { id: 1,  name: 'ยาบำบัดน้อย', icon: '🧪', type: 'consumable', heal_pct: 0.3,  mana_pct: 0,   price: 25,  desc: 'ฟื้น HP 30% ของพลังสูงสุด' },
  { id: 2,  name: 'ยาบำบัดใหญ่', icon: '⚗️', type: 'consumable', heal_pct: 0.6,  mana_pct: 0,   price: 60,  desc: 'ฟื้น HP 60% ของพลังสูงสุด' },
  { id: 3,  name: 'น้ำอมฤต',     icon: '💧', type: 'consumable', heal_pct: 0,    mana_pct: 0.4, price: 30,  desc: 'ฟื้น MP 40% ของพลังสูงสุด' },
  { id: 4,  name: 'ยาฟื้นฟูเต็ม', icon: '✨', type: 'consumable', heal_pct: 1,    mana_pct: 1,   price: 120, desc: 'ฟื้น HP และ MP 100%' },
  // โล่โฟกัส — ใช้แล้วกันคอมโบโฟกัสหาย 1 ครั้ง (พัก/ทิ้ง session ครั้งถัดไปไม่เสียคอมโบ)
  { id: 150, name: 'โล่โฟกัส', icon: '🛡️', type: 'consumable', use_shield: 1, price: 220, desc: '🛡️ ใช้แล้วติดตั้งโล่กันคอมโบ 1 ครั้ง — พัก/ทิ้ง session ครั้งหน้า คอมโบไม่หาย (โล่จะแตก)' },

  // ยา/สมุนไพรทั่วไป — ของรางวัลจากเหตุการณ์ (ราคาถูก)
  { id: 5,  name: 'สมุนไพรป่า',  icon: '🌿', type: 'consumable', heal_pct: 0.15, price: 10, desc: 'สมุนไพรป่าแก้เจ็บเล็กน้อย' },
  { id: 6,  name: 'เห็ดเรืองแสง', icon: '🍄', type: 'consumable', heal_pct: 0.2,  price: 15, desc: 'เห็ดที่เรืองแสงอ่อน ๆ ฟื้น HP 20%' },
  { id: 7,  name: 'เนื้อสดย่าง',  icon: '🍖', type: 'consumable', heal_pct: 0.25, price: 18, desc: 'เนื้อย่างหอม ๆ ฟื้น HP 25%' },

  // อาวุธ (handed: 1 = มือเดียว, 2 = สองมือ)
  // classReq = เฉพาะคลาสนี้เท่านั้นที่สวมได้ · statReq = ต้องมีค่าสถานะ (รวมอุปกรณ์) ถึงเกณฑ์
  { id: 10, name: 'มีดสั้นเก่า',   icon: '🔪', type: 'weapon', atk_bonus: 3,  price: 40,  desc: 'มีดเก่า ๆ แต่ยังคม', lvl: 1, handed: 1, classReq: ['rogue'] },
  { id: 11, name: 'ดาบเหล็ก',     icon: '⚔️', type: 'weapon', atk_bonus: 6,  price: 90,  desc: 'ดาบเหล็กมาตรฐานทหาร', lvl: 2, handed: 1 },
  { id: 12, name: 'ขวานสงคราม',   icon: '🪓', type: 'weapon', atk_bonus: 10, price: 180, desc: 'ขวานใหญ่สองมือ ทุบได้ทั้งเกราะ', lvl: 3, handed: 2, classReq: ['warrior'] },
  { id: 13, name: 'ดาบเพชรนิล',   icon: '💎', type: 'weapon', atk_bonus: 15, price: 320, desc: 'ดาบใหญ่ในตำนาน ส่องแสงสีม่วง', lvl: 5, handed: 2, classReq: ['warrior'], statReq: { atk: 20 } },
  { id: 14, name: 'กระบองเหล็ก',   icon: '🏏', type: 'weapon', atk_bonus: 5,  price: 70,  desc: 'กระบองหนักหนึ่งมือ', lvl: 1, handed: 1 },
  { id: 15, name: 'ดาบสั้นคู่ใจ',   icon: '🗡️', type: 'weapon', atk_bonus: 8,  price: 150, desc: 'ดาบสั้นที่เฉียบคม ติดตัวตลอดทาง', lvl: 2, handed: 1, classReq: ['rogue'] },
  { id: 16, name: 'ดาบใหญ่เหล็ก',   icon: '⚔️', type: 'weapon', atk_bonus: 13, price: 280, desc: 'ดาบใหญ่สองมือ หนักแต่ทรงพลัง', lvl: 4, handed: 2, classReq: ['warrior'] },
  { id: 17, name: 'คทาจอมเวท',     icon: '🪄', type: 'weapon', atk_bonus: 9, mp_bonus: 25, price: 300, desc: 'คทาสองมือที่อัดแน่นด้วยเวทมนตร์', lvl: 4, handed: 2, classReq: ['mage'] },

  // เกราะตัว (armor)
  { id: 20, name: 'เกราะหนัง',   icon: '🛡️', type: 'armor', def_bonus: 3,  hp_bonus: 10, price: 50,  desc: 'เกราะหนังสัตว์ เหนียวพอตัว', lvl: 1 },
  { id: 21, name: 'เกราะโซ่',    icon: '⛓️', type: 'armor', def_bonus: 6,  hp_bonus: 25, price: 120, desc: 'เกราะโซ่เหล็ก ทนทาน', lvl: 2 },
  { id: 22, name: 'เกราะเหล็ก',  icon: '🛡️', type: 'armor', def_bonus: 10, hp_bonus: 45, price: 240, desc: 'เกราะเต็มยศของอัศวิน', lvl: 3, statReq: { def: 12 } },
  { id: 23, name: 'เกราะมังกร',  icon: '🐲', type: 'armor', def_bonus: 16, hp_bonus: 80, price: 420, desc: 'ทำจากเกล็ดมังกร กันเวทได้', lvl: 5, statReq: { def: 20 } },

  // โล่ (มือรอง)
  { id: 50, name: 'โล่ไม้',       icon: '🛡️', type: 'shield', def_bonus: 4,  hp_bonus: 8,  price: 45,  desc: 'โล่ไม้เก่า ๆ กันได้นิดหน่อย', lvl: 1 },
  { id: 51, name: 'โล่เหล็ก',     icon: '🛡️', type: 'shield', def_bonus: 8,  hp_bonus: 20, price: 160, desc: 'โล่เหล็กหนักหน่วง กันทุกการโจมตี', lvl: 3, statReq: { def: 10 } },
  { id: 52, name: 'โล่ศักดิ์สิทธิ์', icon: '⛨', type: 'shield', def_bonus: 12, hp_bonus: 35, price: 340, desc: 'โล่แห่งแสง กันได้แม้เวทมนตร์', lvl: 5, classReq: ['cleric'], statReq: { def: 12 } },

  // หมวก (หัว)
  { id: 60, name: 'หมวกผ้า',     icon: '🧢', type: 'head', def_bonus: 1, hp_bonus: 6,  price: 30,  desc: 'หมวกผ้านุ่ม ๆ กันแดด', lvl: 1 },
  { id: 61, name: 'หมวกเหล็ก',   icon: '⛑️', type: 'head', def_bonus: 4, hp_bonus: 12, price: 90,  desc: 'หมวกเหล็กกันกระแทก', lvl: 2 },
  { id: 62, name: 'หมวกมังกร',   icon: '🐲', type: 'head', def_bonus: 7, hp_bonus: 25, price: 300, desc: 'หมวกทำจากเกล็ดมังกร', lvl: 5, statReq: { def: 15 } },

  // แขน
  { id: 70, name: 'สนับแขนหนัง',  icon: '🧤', type: 'arms', def_bonus: 2, atk_bonus: 1, price: 35,  desc: 'สนับแขนหนังเหนียว', lvl: 1 },
  { id: 71, name: 'ถุงมือเหล็ก',   icon: '🥊', type: 'arms', def_bonus: 5, atk_bonus: 2, price: 140, desc: 'ถุงมือเหล็ก กำหมัดได้แรงขึ้น', lvl: 3 },
  { id: 72, name: 'ถุงมือเวท',     icon: '🪶', type: 'arms', mp_bonus: 18, price: 210, desc: 'ถุงมือที่ซึมซับมานา', lvl: 4, classReq: ['mage', 'cleric'], statReq: { mp: 35 } },

  // ขา
  { id: 80, name: 'สนับขาหนัง',   icon: '👖', type: 'legs', def_bonus: 3, hp_bonus: 8,  price: 40,  desc: 'สนับขาหนังยืดหยุ่นดี', lvl: 1 },
  { id: 81, name: 'สนับขาเหล็ก',  icon: '🦵', type: 'legs', def_bonus: 7, hp_bonus: 18, price: 170, desc: 'สนับขาเหล็กหนักแน่น', lvl: 3 },
  { id: 82, name: 'สนับขาเงา',    icon: '🌙', type: 'legs', spd_bonus: 4, price: 220, desc: 'สนับขาเบาเหมือนไร้น้ำหนัก', lvl: 4, classReq: ['rogue'], statReq: { spd: 13 } },

  // เท้า
  { id: 90, name: 'รองเท้าหนัง',   icon: '🥾', type: 'feet', def_bonus: 2, spd_bonus: 1, price: 35,  desc: 'รองเท้าหนังเดินทางไกล', lvl: 1 },
  { id: 91, name: 'รองเท้าบู๊ตเหล็ก', icon: '👢', type: 'feet', def_bonus: 4, spd_bonus: 3, price: 150, desc: 'บู๊ตเหล็กหนักแต่ทรงพลัง', lvl: 3 },
  { id: 92, name: 'รองเท้าเมฆ',    icon: '☁️', type: 'feet', spd_bonus: 6, price: 280, desc: 'เหยียบเมฆได้ ว่องไวกว่าลม', lvl: 5, classReq: ['rogue'], statReq: { spd: 16 } },

  // เครื่องประดับ (ใส่ได้ 4 ช่อง)
  { id: 30, name: 'แหวนเงิน',     icon: '💍', type: 'accessory', spd_bonus: 2, crit_bonus: 2, price: 60,  desc: 'แหวนเงินเรืองแสง', lvl: 1 },
  { id: 31, name: 'สร้อยเวท',     icon: '📿', type: 'accessory', mp_bonus: 20, price: 100, desc: 'สร้อยที่อัดแน่นด้วยมานา', lvl: 2 },
  { id: 32, name: 'รองเท้าเงา',   icon: '👟', type: 'accessory', spd_bonus: 5, price: 150, desc: 'เดินเบาเหมือนเงา', lvl: 3 },
  { id: 33, name: 'ต่างหูมรกต',   icon: '💚', type: 'accessory', crit_bonus: 8, price: 260, desc: 'มรกตเขียวขจี เพิ่มดวง', lvl: 4 },
  { id: 34, name: 'เข็มกลัดพลัง',  icon: '📌', type: 'accessory', atk_bonus: 2, price: 90,  desc: 'เข็มกลัดเพิ่มพลังโจมตี', lvl: 2 },
  { id: 35, name: 'สร้อยมังกร',   icon: '🐉', type: 'accessory', def_bonus: 4, hp_bonus: 15, price: 240, desc: 'สร้อยที่ฝังเกล็ดมังกร', lvl: 4 },
  { id: 36, name: 'แหวนคริติคอล', icon: '💍', type: 'accessory', crit_bonus: 5, price: 180, desc: 'แหวนแห่งโชคชะตา', lvl: 3 },
  { id: 37, name: 'เครื่องรางป้องกัน', icon: '🧿', type: 'accessory', def_bonus: 6, price: 300, desc: 'เครื่องรางโบราณกันอาถรรพ์', lvl: 5, statReq: { def: 15 } },

  // ---- ไอเทมเฉพาะคลาส (classReq) — หาได้จากร้าน/ดรอป/รางวัลตามคลาสของตัวเองเท่านั้น ----
  { id: 200, name: 'ขวานมังกรเพลิง',  icon: '🪓', type: 'weapon', atk_bonus: 16, price: 380, desc: 'ขวานสองมือแช่ในไฟมังกร ทำลายล้างที่สุด', lvl: 5, handed: 2, classReq: ['warrior'], statReq: { atk: 22 } },
  { id: 201, name: 'เกราะไททัน',       icon: '🏛️', type: 'armor', def_bonus: 13, hp_bonus: 60, price: 380, desc: 'เกราะยักษ์โบราณ ทนทานที่สุดของนักรบ', lvl: 4, classReq: ['warrior'], statReq: { def: 15 } },
  { id: 202, name: 'คทาแสงจันทร์',     icon: '🌙', type: 'weapon', atk_bonus: 12, mp_bonus: 35, price: 380, desc: 'คทาที่ชุ่มด้วยแสงจันทร์ เพิ่มพลังเวทมหาศาล', lvl: 5, handed: 2, classReq: ['mage'] },
  { id: 203, name: 'เสื้อคลุมเวทมนตร์', icon: '🧥', type: 'armor', mp_bonus: 30, def_bonus: 5, price: 300, desc: 'เสื้อคลุมถักด้วยเส้นใยเวท ซึมซับมานา', lvl: 4, classReq: ['mage'] },
  { id: 204, name: 'มีดอาบพิษ',        icon: '🗡️', type: 'weapon', atk_bonus: 10, crit_bonus: 6, price: 280, desc: 'มีดคมกริบอาบพิษร้าย คริติคอลถี่', lvl: 4, handed: 1, classReq: ['rogue'], statReq: { atk: 15 } },
  { id: 205, name: 'ชุดเงา',            icon: '🥷', type: 'armor', spd_bonus: 5, def_bonus: 5, price: 280, desc: 'ชุดดำบางเบา ขยับตัวไร้เสียง', lvl: 4, classReq: ['rogue'] },
  { id: 206, name: 'ค้อนศักดิ์สิทธิ์',   icon: '🔨', type: 'weapon', atk_bonus: 8, mp_bonus: 18, price: 280, desc: 'ค้อนที่อวยพรด้วยแสงศักดิ์สิทธิ์', lvl: 4, handed: 1, classReq: ['cleric'] },
  { id: 207, name: 'ชุดนักบวช',        icon: '👘', type: 'armor', def_bonus: 8, hp_bonus: 30, mp_bonus: 12, price: 300, desc: 'ชุดพิธีกรรมโบราณ ปกป้องและหล่อเลี้ยงพลัง', lvl: 4, classReq: ['cleric'] },

  // ---- ไอเทมพิเศษเฉพาะ Daily Quest (exclusive: true — หาซื้อตามร้านไม่ได้) ----
  { id: 40, name: 'ถุงเงินนำโชค',     icon: '🧧', type: 'consumable', use_gold: 150, price: 80, exclusive: true, desc: '✦ พิเศษ — ใช้แล้วได้ทอง 150 ทันที' },
  { id: 41, name: 'คัมภีร์ประสบการณ์', icon: '📜', type: 'consumable', use_xp: 120, price: 80, exclusive: true, desc: '✦ พิเศษ — ใช้แล้วได้ XP 120 ทันที' },
  { id: 42, name: 'สมุดนำโชค',       icon: '🍀', type: 'accessory', spd_bonus: 3, crit_bonus: 4, price: 200, exclusive: true, desc: '✦ พิเศษ — เครื่องรางจากดินแดนแห่งโชค' },
  { id: 43, name: 'มงกุฎนักโฟกัส',   icon: '👑', type: 'accessory', hp_bonus: 40, mp_bonus: 15, price: 250, exclusive: true, desc: '✦ พิเศษ — รางวัลแห่งผู้มุ่งมั่น' },
  { id: 44, name: 'อีลิกเซอร์บริสุทธิ์', icon: '⚡', type: 'consumable', heal_pct: 1, mana_pct: 1, price: 200, exclusive: true, desc: '✦ พิเศษ — ฟื้น HP + MP 100% ทันที' },

  // ---- ของขวัญ/ของขยะทั่วไป — เจอจากเหตุการณ์ เอาไว้ขายตอนค่ายพัก (พ่อค้าอาจอยากได้เป็นพิเศษ) ----
  { id: 45, name: 'กระดูกมอนสเตอร์', icon: '🦴', type: 'junk', price: 12, desc: 'ของเก็บบนเส้นทาง ขายได้นิดหน่อย' },
  { id: 46, name: 'เศษหินเวท',      icon: '🧱', type: 'junk', price: 16, desc: 'หินที่มีพลังเหลืออยู่เล็กน้อย พ่อค้ารับซื้อ' },
  { id: 47, name: 'ดอกไม้เหี่ยวเฉา', icon: '🥀', type: 'junk', price: 8,  desc: 'ดอกไม้ไร้วิญญาณ ขายได้นิดหน่อย' },
  { id: 48, name: 'เศษผ้าขาดวิ่น',   icon: '🧵', type: 'junk', price: 10, desc: 'เศษผ้าเก่า ๆ ของพ่อค้าเร่ร่อนรับซื้อ' },
  { id: 49, name: 'ขนนกยักษ์',      icon: '🪶', type: 'junk', price: 20, desc: 'ขนของนกยักษ์ เอาไปขายได้ราคาดี' },

  // ---- ของขวัญหายาก (rare junk) — เจอได้เฉพาะดรอปพิเศษ/ยาก ขายแพง ----
  { id: 100, name: 'เศษอัญมณีโบราณ', icon: '💎', type: 'junk', price: 140, desc: 'เศษอัญมณีจากยุคโบราณ พ่อค้ารับซื้อแพง' },
  { id: 101, name: 'แจกันโบราณ',     icon: '🏺', type: 'junk', price: 230, desc: 'แจกันลายครามเก่าแก่ ตัวจริงของนักสะสม' },
  { id: 102, name: 'หน้ากากพิธีกรรม', icon: '🎭', type: 'junk', price: 340, desc: 'หน้ากากจากพิธีกรรมโบราณ ล้ำค่ามาก' },

  // ---- ของจากการล่ามอนสเตอร์ (loot เฉพาะตัว — ดรอปบ่อยตอนชนะ แต่ราคาไม่สูง) ----
  { id: 120, name: 'ฟันหนูยักษ์',   icon: '🦷', type: 'junk', price: 6,  desc: 'ฟันแหลมคมของหนูยักษ์ พ่อค้ารับซื้อ' },
  { id: 121, name: 'ปีกค้างคาว',    icon: '🦇', type: 'junk', price: 8,  desc: 'ปีกบาง ๆ ของค้างคาวปีศาจ เอาไปทำยาได้' },
  { id: 122, name: 'ขนหมาป่า',      icon: '🐺', type: 'junk', price: 10, desc: 'ขนหนานุ่มของหมาป่าเถื่อน ขายได้นิดหน่อย' },
  { id: 123, name: 'เจลสไลม์',      icon: '🟢', type: 'junk', price: 9,  desc: 'เจลเหนียวของสไลม์พิษ พ่อค้ารับซื้อ' },
  { id: 124, name: 'เศษหินโกเลม',   icon: '🗿', type: 'junk', price: 12, desc: 'เศษหินแข็งจากโกเลมดิน ใช้ทำเครื่องมือได้' },
  { id: 125, name: 'ไม้กวาดแม่มด',  icon: '🧹', type: 'junk', price: 14, desc: 'ไม้กวาดหักของแม่มดน้อย ของแปลกขายได้ราคา' },
  { id: 126, name: 'เขาอสูร',       icon: '👤', type: 'junk', price: 16, desc: 'เขาสีดำของอสูรเงา พ่อค้าชอบของแปลก' },
  { id: 127, name: 'เกล็ดมังกรน้อย', icon: '🐲', type: 'junk', price: 22, desc: 'เกล็ดแวววาวจากมังกรน้อย ขายได้ราคาดี' },

  // ---- ของรางวัลเฉพาะบอส (loot เฉพาะตัว — ดรอปตอนชนะบอส ~50% ขายแพงกว่า loot มอนสเตอร์) ----
  { id: 130, name: 'ตราโจรป่า',       icon: '🏴', type: 'junk', price: 80,  desc: 'ตราประจำแก๊งของหัวหน้าโจรป่า นักสะสมอยากได้' },
  { id: 131, name: 'ดาบหักกัปตัน',     icon: '🗡️', type: 'junk', price: 90,  desc: 'ดาบหักคู่ใจของกัปตันทหารรับจ้าง' },
  { id: 132, name: 'เข็มทิศแม่ทัพเงา', icon: '🧭', type: 'junk', price: 95,  desc: 'เข็มทิศเรือโจรของแม่ทัพเงาแห่งท่าเรือ' },
  { id: 133, name: 'ยันต์ราชินีแม่มด', icon: '🪄', type: 'junk', price: 110, desc: 'ยันต์ทรงพลังของราชินีแม่มด' },
  { id: 134, name: 'แกนไฟโกลเลม',    icon: '🔥', type: 'junk', price: 120, desc: 'แกนไฟที่ยังร้อนระอุของโกลเลมไฟ' },
  { id: 135, name: 'คริสตัลการ์เดี้ยน', icon: '💠', type: 'junk', price: 130, desc: 'คริสตัลบริสุทธิ์จากร่างการ์เดี้ยน' },
  { id: 136, name: 'หิมะนิรันดร์',     icon: '🧊', type: 'junk', price: 150, desc: 'ก้อนหิมะที่ไม่เคยละลายของมังกรน้ำแข็ง' },
  { id: 137, name: 'หัวใจจอมมาร',     icon: '🖤', type: 'junk', price: 180, desc: 'หัวใจดำมืดของจอมมารเงา ล้ำค่าที่สุด' },
  { id: 138, name: 'มงกุฎมรกต',       icon: '👑', type: 'junk', price: 200, desc: 'มงกุฎที่สลักจากมรกตบริสุทธิ์ของราชามรกต' },
  { id: 139, name: 'แกนสายฟ้า',        icon: '⚡', type: 'junk', price: 220, desc: 'แกนพลังงานสายฟ้าที่ประจุอยู่ตลอดเวลา' },
  { id: 140, name: 'ไข่มุกทราย',       icon: '🫧', type: 'junk', price: 240, desc: 'ไข่มุกโบราณที่ถูกฝังใต้ทรายมานับพันปี' },
  { id: 141, name: 'เกล็ดราชามังกร',   icon: '🐲', type: 'junk', price: 260, desc: 'เกล็ดทองคำของราชามังกร ล้ำค่ายิ่งนัก' },

  // ---- ของรางวัลพิเศษจากบอสลับ (exclusive — ไม่ดรอปตามปกติ ชนะบอสลับเท่านั้น) ----
  { id: 160, name: 'ตราสุริยุปราคา',  icon: '🌑', type: 'junk', price: 350, exclusive: true, desc: '✦ ของพิเศษจากราชันเงา — นักสะสมยอมจ่ายแพง' },
  { id: 161, name: 'หัวใจนิรันดร์',   icon: '💜', type: 'junk', price: 450, exclusive: true, desc: '✦ ของพิเศษจากปีศาจทมิฬ — ล้ำค่าที่สุดในแดนนี้' },
  { id: 162, name: 'มงกุฎโบราณ',    icon: '👑', type: 'junk', price: 550, exclusive: true, desc: '✦ ของพิเศษจากอสูรโบราณ — ตำนานของเมืองนี้' },

  // ---- คัมภีร์สกิลหายาก (type: scroll) — เจอจากกล่องสมบัติเท่านั้น (โอกาสน้อยมาก) ----
  // ใช้แล้วเรียนรู้สกิล (learn_skill) — ถ้าเรียนไปแล้วใช้ไม่ได้
  { id: 110, name: 'คัมภีร์: ลูกไฟใหญ่', icon: '📜', type: 'scroll', learn_skill: 'sc_fireball', price: 260, desc: '✦ หายาก — ใช้แล้วเรียนรู้สกิล 🔥 ลูกไฟใหญ่ (ทุกคลาสเรียนได้)' },
  { id: 111, name: 'คัมภีร์: แสงรักษา', icon: '📜', type: 'scroll', learn_skill: 'sc_heal',     price: 240, desc: '✦ หายาก — ใช้แล้วเรียนรู้สกิล 💖 แสงรักษา (ทุกคลาสเรียนได้)' },
  { id: 112, name: 'คัมภีร์: สายฟ้าพิภพ', icon: '📜', type: 'scroll', learn_skill: 'sc_thunder',  price: 300, desc: '✦ หายาก — ใช้แล้วเรียนรู้สกิล ⚡ สายฟ้าพิภพ (ทุกคลาสเรียนได้)' },
  { id: 113, name: 'คัมภีร์: พิษร้าย',   icon: '📜', type: 'scroll', learn_skill: 'sc_venom',    price: 280, desc: '✦ หายาก — ใช้แล้วเรียนรู้สกิล 🐍 พิษร้าย (ทุกคลาสเรียนได้)' },
  { id: 114, name: 'คัมภีร์: โล่เวท',    icon: '📜', type: 'scroll', learn_skill: 'sc_guard',    price: 260, desc: '✦ หายาก — ใช้แล้วเรียนรู้สกิล 🛡️ โล่เวท (ทุกคลาสเรียนได้)' },
  { id: 115, name: 'คัมภีร์: สายฟ้าแลบ', icon: '📜', type: 'scroll', learn_skill: 'sc_haste',    price: 250, desc: '✦ หายาก — ใช้แล้วเรียนรู้สกิล 🌀 สายฟ้าแลบ (ทุกคลาสเรียนได้)' },
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
  { name: 'หุบเขามรกต',     icon: '💚', terrain: 'หุบเขาปกคลุมด้วยมรกต' },
  { name: 'นครสายฟ้า',      icon: '⚡', terrain: 'เมืองกลางพายุฟ้าคะนอง' },
  { name: 'ทะเลทรายนิรันดร์', icon: '🏜️', terrain: 'ทะเลทรายที่ไม่มีวันสิ้นสุด' },
  { name: 'อาณาจักรมังกร',   icon: '🐉', terrain: 'ดินแดนศักดิ์สิทธิ์ของมังกร' },
];

// loot = ของรางวัลเฉพาะตัว (id ใน ITEMS) — ดรอปตอนชนะบอส (โอกาส ~50%)
export const BOSSES = [
  { name: 'หัวหน้าโจรป่า', icon: '🐗', loot: 130 },
  { name: 'กัปตันทหารรับจ้าง', icon: '⚔️', loot: 131 },
  { name: 'แม่ทัพเงาแห่งท่าเรือ', icon: '🗡️', loot: 132 },
  { name: 'ราชินีแม่มด', icon: '🧙', loot: 133 },
  { name: 'โกลเลมไฟ', icon: '🔥', loot: 134 },
  { name: 'คริสตัลการ์เดี้ยน', icon: '🔮', loot: 135 },
  { name: 'มังกรน้ำแข็ง', icon: '🐉', loot: 136 },
  { name: 'จอมมารเงา', icon: '👹', loot: 137 },
  { name: 'ราชามรกต', icon: '💚', loot: 138 },
  { name: 'ราชินีพายุ', icon: '⚡', loot: 139 },
  { name: 'ทรายดูดยักษ์', icon: '🐍', loot: 140 },
  { name: 'ราชามังกร', icon: '🐲', loot: 141 },
];

// ----- บอสลับ — เจอเมื่อเลือก "สำรวจเมืองเดิมต่อ" ครบตามรอบของเมืองนั้น (แต่ละเมืองรอบไม่เท่ากัน) -----
// ชนะแล้วได้ของพิเศษ (loot) ที่หาซื้อไม่ได้ตามร้าน — ต่อให้สำรวจซ้ำอีก ความยากยิ่งเพิ่มขึ้นเรื่อย ๆ
export const ALT_BOSSES = [
  { name: 'ราชันเงา',   icon: '👁️', loot: 160 },
  { name: 'ปีศาจทมิฬ',  icon: '😈', loot: 161 },
  { name: 'อสูรโบราณ',  icon: '🗿', loot: 162 },
];

// รอบที่ต้องสำรวจเมืองเดิมถึงจะเจอบอสลับ — ต่างกันตามเมือง (2/3/4 สลับกันไป)
export const altBossAt = (cityIndex) => 2 + ((cityIndex + 1) % 3);

// ----- สกิลของบอส — แต่ละเมือง/บอสมีท่าเด็ดของตัวเอง (มีโอกาสใช้แทนโจมตีปกติ) -----
// mult = คูณพลังโจมตี, heal = ฟื้น %HP สูงสุด, poison = %HP ผู้เล่นเสียต่อเทิร์น,
// guard = ลดดาเมจที่บอสได้รับ (ตัวคูณ), drainMp = ผู้เล่นเสีย %MP
export const BOSS_SKILLS = {
  rage:  { name: 'คลั่ง',       icon: '💢', desc: 'โจมตี x1.5 (คริติคอลได้)', mult: 1.5 },
  crush: { name: 'ทุบแหลก',    icon: '🔨', desc: 'โจมตี x2.0 (หนักมาก)',    mult: 2.0 },
  heal:  { name: 'เรียกพลัง',   icon: '💚', desc: 'ฟื้น HP 20%',             heal: 0.2 },
  venom: { name: 'พิษร้าย',     icon: '☠️', desc: 'ผู้เล่นเสีย 5% HP/เทิร์น (2 เทิร์น)', poison: 0.05 },
  guard: { name: 'เกราะแข็ง',   icon: '🛡️', desc: 'ลดดาเมจที่บอสได้รับ 35% (2 เทิร์น)', guard: 0.65 },
  drain: { name: 'ดูดมานา',     icon: '🧿', desc: 'ผู้เล่นเสีย MP 25%',      drainMp: 0.25 },
  // ท่าไม้ตาย — ใช้เฉพาะตอนบอสโกรธจัด (HP ≤ 50%) หรือสุดทน (สู้ยืดเยื้อ)
  fury:  { name: 'ท่าไม้ตาย',   icon: '💥', desc: 'โจมตี x2.2 (หนักที่สุด)', mult: 2.2 },
};

// ท่าเด็ดของบอสแต่ละเมือง (index ตรงกับ BOSSES) — บอสลับใช้ท่าเด็ดของเมืองนั้น ๆ
export const BOSS_LOADOUTS = [
  ['rage', 'guard'],
  ['crush', 'drain'],
  ['rage', 'venom'],
  ['heal', 'venom'],
  ['crush', 'heal'],
  ['guard', 'drain'],
  ['venom', 'guard'],
  ['crush', 'venom'],
  ['heal', 'drain'],
  ['rage', 'crush'],
  ['venom', 'drain'],
  ['crush', 'heal'],
];

// มอนสเตอร์ที่เจอระหว่างผจญภัย (power_mult คูณพลังมอนสเตอร์ตามเลเวล)
// loot = ไอเทมขยะประจำตัว (id ใน ITEMS) — ดรอปตอนชนะ (โอกาส ~40%)
export const MONSTERS = [
  { name: 'หนูยักษ์',     icon: '🐀', power: 0.7, xp: 14, gold: 8,  loot: 120 },
  { name: 'ค้างคาวปีศาจ', icon: '🦇', power: 0.85, xp: 18, gold: 10, loot: 121 },
  { name: 'หมาป่าเถื่อน', icon: '🐺', power: 1.0, xp: 24, gold: 14, loot: 122 },
  { name: 'สไลม์พิษ',    icon: '🟢', power: 0.9, xp: 20, gold: 12, loot: 123 },
  { name: 'โกเลมดิน',    icon: '🗿', power: 1.15, xp: 30, gold: 18, loot: 124 },
  { name: 'แม่มดน้อย',   icon: '🧙‍♀️', power: 1.25, xp: 36, gold: 22, loot: 125 },
  { name: 'อสูรเงา',     icon: '👤', power: 1.35, xp: 42, gold: 26, loot: 126 },
  { name: 'มังกรน้อย',   icon: '🐲', power: 1.5, xp: 55, gold: 35, loot: 127 },
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

// ของรางวัลธรรมดาจากเหตุการณ์: ยา + สมุนไพร + ของขวัญ (พ่อค้าเร่ร่อนแจก / รางวัลภารกิจ / กล่องสมบัติ)
export const COMMON_LOOT = [1, 3, 5, 6, 7, 45, 46, 47, 48, 49];
// ของขวัญหายาก — ดรอปยาก (กล่องสมบัติพิเศษ / พ่อค้าแจกน้อยครั้ง)
export const RARE_JUNK = [100, 101, 102];
// คัมภีร์สกิลหายาก — เจอจากกล่องสมบัติเท่านั้น (โอกาสน้อยมาก ~3% ของการดรอปไอเทม)
export const SCROLL_ITEMS = [110, 111, 112, 113, 114, 115];

// ร้านค้าขายเฉพาะไอเทมธรรมดา — ไอเทม exclusive (พิเศษ) หาซื้อไม่ได้, ของขวัญ (junk) และคัมภีร์ (scroll) ไม่ขายในร้าน
// (item.type: consumable/weapon/armor/accessory, exclusive = ได้จาก Daily Quest เท่านั้น)
export const SHOP_STOCK = ITEMS.filter((i) => !i.exclusive && i.type !== 'junk' && i.type !== 'scroll' && (i.type !== 'consumable' || [1, 2, 3, 4, 150].includes(i.id)));

// ----- ยศ (Rank) — อัปตามเวลาโฟกัสสะสม (นาที) -----
export const RANKS = [
  { name: 'นักเดินทาง', icon: '🥾', minMin: 0 },
  { name: 'ทหารอาสา', icon: '🛡️', minMin: 300 },      // 5 ชม.
  { name: 'อัศวิน', icon: '⚔️', minMin: 900 },          // 15 ชม.
  { name: 'แม่ทัพ', icon: '🎖️', minMin: 2400 },        // 40 ชม.
  { name: 'ปรมาจารย์', icon: '👑', minMin: 6000 },      // 100 ชม.
  { name: 'ตำนาน', icon: '🌟', minMin: 15000 },         // 250 ชม.
];

// ----- Companion (สัตว์เลี้ยง) — โตตามเวลาโฟกัสสะสม (นาที) -----
export const COMPANIONS = [
  { name: 'ไข่ปริศนา', icon: '🥚', minMin: 0, desc: 'อะไรจะฟักออกมา… เริ่มโฟกัสเพื่อเลี้ยงมัน!' },
  { name: 'ลูกหมีน้อย', icon: '🐻', minMin: 60, desc: 'ลูกหมีจอมขี้อ้อน — โฟกัส 1 ชม. แล้วเป็นเพื่อนกัน' },
  { name: 'หมีนักผจญภัย', icon: '🧸', minMin: 600, desc: 'ออกเดินทางตามคุณไปทุกเมือง (โฟกัส 10 ชม.)' },
  { name: 'หมีอัศวิน', icon: '🦸', minMin: 2400, desc: 'สวมเกราะเหล็ก คุ้มครองคุณในทุก session (โฟกัส 40 ชม.)' },
  { name: 'ราชาหมีผู้พิทักษ์', icon: '🐉', minMin: 9000, desc: 'สุดยอดเพื่อนร่วมทางในตำนาน (โฟกัส 150 ชม.)' },
];

// ----- เทศกาลประจำสัปดาห์ — เมืองหมุนเวียนกันจัดงาน (week % 12 == city_index) -----
// items = สินค้าพิเศษราคาลด 20% ที่ร้านค่ายพัก (เฉพาะสัปดาห์ของเมืองนั้น)
export const FESTIVALS = [
  { name: 'เทศกาลเก็บเกี่ยว', icon: '🌾', desc: 'ชาวนาเปิดตลาดสีทอง — สมุนไพรและยาเต็มร้าน!', items: [1, 2, 5, 6] },
  { name: 'งานวัดสายรุ้ง', icon: '🎪', desc: 'ของเล่นสารพัด + เครื่องรางนำโชคจากงานวัด', items: [3, 4, 7, 30] },
  { name: 'เทศกาลเรือมังกร', icon: '🚣', desc: 'สินค้าจากแดนไกลขึ้นฝั่ง — โจรนักล่าราคาพิเศษ', items: [2, 3, 49, 31] },
  { name: 'คืนแสงจันทร์', icon: '🌙', desc: 'ป่าเปล่งแสงเวทมนตร์ — สร้อยและเครื่องประดับลดราคา', items: [31, 34, 36, 71] },
  { name: 'เทศกาลไฟ', icon: '🔥', desc: 'กองไฟใหญ่ + อุปกรณ์เหล็กชุบไฟ', items: [4, 21, 51, 61] },
  { name: 'ตลาดคริสตัล', icon: '💎', desc: 'คริสตัลเรืองแสง — เครื่องประดับชั้นดีราคาถูกลง', items: [33, 35, 37, 60] },
  { name: 'เทศกาลหิมะ', icon: '❄️', desc: 'หมู่บ้านหิมะ — เครื่องกันหนาว + น้ำอมฤตอุ่น ๆ', items: [3, 22, 62, 80] },
  { name: 'ราชสำนักเปิดตลาด', icon: '🏰', desc: 'ของหลวงลดราคา! เกราะและอาวุธชั้นดี', items: [16, 22, 51, 81] },
  { name: 'เทศกาลมรกต', icon: '💚', desc: 'หุบเขามรกตเปิดเหมือง — อัญมณีและเครื่องประดับ', items: [33, 35, 36, 91] },
  { name: 'คืนสายฟ้า', icon: '⚡', desc: 'พายุฟ้าคะนอง — อาวุธประจุไฟฟ้าราคาพิเศษ', items: [11, 14, 17, 34] },
  { name: 'ตลาดโอเอซิส', icon: '🏜️', desc: 'พ่อค้าคาราวานผ่านทะเลทราย — ยาและน้ำลดราคา', items: [1, 2, 4, 6] },
  { name: 'พิธีแห่มังกร', icon: '🐉', desc: 'วันศักดิ์สิทธิ์ของอาณาจักร — ของดีที่สุดลดราคา', items: [13, 23, 52, 92] },
];

// ----- เควสต์เนื้อเรื่อง (Story Quest) — ปลดล็อกตามเมือง/ความคืบหน้า รับรางวัลครั้งเดียว -----
// req: boss = ชนะบอสครบ X ตัว · sessions = โฟกัสครบ X session · level = เลเวล X · city = ไปถึงเมือง index
// reward: gold/xp
// NOTE: city ในเควสต์มีไว้โชว์ว่าเป็นของเมืองไหน (ใช้คู่กับลำดับ) — ไม่บังคับว่าต้องอยู่เมืองนั้น
// รับรางวัลได้จากหน้าเนื้อเรื่อง (แท็บ 📖)
export const STORY_QUESTS = [
  { id: 'sq_0', city: 0, title: 'เสียงเรียกจากทุ่งหญ้า', icon: '🌾', desc: 'ชาวบ้านอีสตาร์เดือดร้อนจากหนูยักษ์ — ชนะบอสตัวแรกของโลกนี้ให้ได้', req: { type: 'boss', value: 1 }, reward: { gold: 120, xp: 80 } },
  { id: 'sq_1', city: 1, title: 'ของหายในตลาดมิราเคิล', icon: '🏘️', desc: 'โฟกัสสะสมจนชาวเมืองเริ่มจำชื่อคุณได้ (ครบ 5 session)', req: { type: 'sessions', value: 5 }, reward: { gold: 150, xp: 100 } },
  { id: 'sq_2', city: 2, title: 'เรือโจรสลัด', icon: '🌊', desc: 'แม่ทัพเงาแห่งท่าเรือขู่ชาวประมง — ชนะบอส 2 ตัวเพื่อไล่มันไป', req: { type: 'boss', value: 2 }, reward: { gold: 180, xp: 120 } },
  { id: 'sq_3', city: 3, title: 'คำสาปแห่งป่าอาร์คานา', icon: '🌲', desc: 'ป่าลึกเปล่งเสียงปริศนา — เติบโตถึงเลเวล 6 แล้วไปสืบความจริง', req: { type: 'level', value: 6 }, reward: { gold: 200, xp: 140 } },
  { id: 'sq_4', city: 4, title: 'หัวใจเพลิง', icon: '🌋', desc: 'โกลเลมไฟคุกคามเทือกเขาอัคนี — ชนะบอส 4 ตัวเพื่อดับมัน', req: { type: 'boss', value: 4 }, reward: { gold: 220, xp: 160 } },
  { id: 'sq_5', city: 5, title: 'คริสตัลต้องสาป', icon: '💎', desc: 'ชาวเมืองคริสตัลต้องการคนพิสูจน์ความมุ่งมั่น — โฟกัสครบ 10 session', req: { type: 'sessions', value: 10 }, reward: { gold: 250, xp: 180 } },
  { id: 'sq_6', city: 6, title: 'ลมหายใจน้ำแข็ง', icon: '🧊', desc: 'หนทางสู่ดินแดนน้ำแข็งต้องแข็งแกร่งพอ — ถึงเลเวล 10', req: { type: 'level', value: 10 }, reward: { gold: 280, xp: 200 } },
  { id: 'sq_7', city: 7, title: 'บัลลังก์แอสการ์ด', icon: '🏰', desc: 'จอมมารเงาหลอกหลอนเมืองหลวง — ชนะบอส 7 ตัวเพื่อกำราบมัน', req: { type: 'boss', value: 7 }, reward: { gold: 320, xp: 240 } },
  { id: 'sq_8', city: 8, title: 'หุบเขามรกต', icon: '💚', desc: 'ชนะบอส 8 ตัวเพื่อเปิดประตูสู่หุบเขามรกต', req: { type: 'boss', value: 8 }, reward: { gold: 360, xp: 280 } },
  { id: 'sq_9', city: 9, title: 'สายฟ้าของราชินี', icon: '⚡', desc: 'ราชินีพายุขวางทางนครสายฟ้า — ชนะบอส 9 ตัว', req: { type: 'boss', value: 9 }, reward: { gold: 400, xp: 320 } },
  { id: 'sq_10', city: 10, title: 'ทรายใต้แสงจันทร์', icon: '🏜️', desc: 'ทะเลทรายนิรันดร์ไม่ไว้ใจคนอ่อนแอ — ถึงเลเวล 16', req: { type: 'level', value: 16 }, reward: { gold: 450, xp: 360 } },
  { id: 'sq_11', city: 11, title: 'ราชามังกรองค์สุดท้าย', icon: '🐉', desc: 'โค่นราชามังกรและปิดตำนานของ PomoQuest — ชนะบอส 11 ตัว', req: { type: 'boss', value: 11 }, reward: { gold: 600, xp: 500 } },
];

// ----- ภารกิจประจำวัน (Daily Quest) — สุ่ม 3 อันต่อวันตามเลเวล -----
// key ตรงกับชื่อ counter ใน daily_counter ตาราง
export const DAILY_QUESTS = [
  { id: 'dq_focus_sessions', name: 'นักโฟกัสประจำวัน', icon: '🎯', key: 'sessions', target: (lvl) => 2 + (lvl >= 10 ? 1 : 0), desc: 'โฟกัสครบ {n} session วันนี้', unit: 'count' },
  { id: 'dq_treasure',      name: 'นักล่าสมบัติ',     icon: '💰', key: 'treasures', target: (lvl) => 2 + (lvl >= 8 ? 1 : 0), desc: 'เจอสมบัติ {n} ครั้งวันนี้', unit: 'count' },
  { id: 'dq_monster',       name: 'นักล่ามอนสเตอร์',  icon: '🐺', key: 'monsters', target: (lvl) => 5 + (lvl >= 8 ? 2 : 0), desc: 'กำจัดมอนสเตอร์ {n} ตัววันนี้', unit: 'count' },
  { id: 'dq_camp_quest',    name: 'สายภารกิจแคมป์',   icon: '📜', key: 'camp_quests', target: () => 2, desc: 'ทำภารกิจแคมป์ {n} ครั้งวันนี้', unit: 'count' },
  { id: 'dq_boss',          name: 'นักล่าบอสรายวัน',  icon: '👹', key: 'boss_wins', target: () => 1, desc: 'ชนะบอส 1 ตัววันนี้', unit: 'count' },
  { id: 'dq_potion',        name: 'นักเล่นแร่แปรธาตุ', icon: '🧪', key: 'potions', target: (lvl) => 3 + (lvl >= 10 ? 2 : 0), desc: 'ใช้ยา {n} ขวดวันนี้', unit: 'count' },
  { id: 'dq_junk',          name: 'คนเก็บขยะ',       icon: '🗑️', key: 'junk_sold', target: (lvl) => 5 + (lvl >= 10 ? 2 : 0), desc: 'ขายของขวัญ {n} ชิ้นวันนี้ (จากมอนสเตอร์/บอส/สมบัติ — วันไหนพ่อค้าต้องการ ขายได้แพงขึ้น!)', unit: 'count' },
  { id: 'dq_shop',          name: 'ลูกค้าประจำ',      icon: '🛒', key: 'items_bought', target: (lvl) => 3 + (lvl >= 8 ? 2 : 0), desc: 'ซื้อของ {n} ชิ้นวันนี้', unit: 'count' },
  { id: 'dq_bm',            name: 'ลูกค้าตลาดมืด',    icon: '🖤', key: 'bm_trades', target: () => 1, desc: 'ค้าขายกับตลาดมืด {n} ครั้งวันนี้ (ซื้อหรือขาย — เจอตลาดมืดที่ค่ายพักแล้วใช้โอกาสนี้!)', unit: 'count' },
  { id: 'dq_focus_min',     name: 'มาราธอนรายวัน',    icon: '⏳', key: 'focus_sec', target: (lvl) => 50 * 60 + (lvl >= 10 ? 10 * 60 : 0), desc: 'โฟกัสครบ {n} นาทีวันนี้', unit: 'min' },
];

// ----- Achievement (stat = ตัวเลขที่ใช้เปรียบเทียบ ดูใน achievements.js) -----
export const ACHIEVEMENTS = [
  { id: 'first_step',  name: 'ก้าวแรก',          icon: '🐣', stat: 'sessions',  target: 1,    reward: { gold: 20 }, desc: 'ทำโฟกัสครบ 1 session' },
  { id: 'first_level', name: 'เริ่มเติบโต',      icon: '⬆️', stat: 'level',     target: 2,    reward: { gold: 25 }, desc: 'อัพเป็นเลเวล 2' },
  { id: 'wanted_5',    name: 'นักขายมือฉมัง',    icon: '🏷️', stat: 'wanted_sales', target: 5,    reward: { gold: 100 }, desc: 'ขายของให้พ่อค้าที่ต้องการ 5 ครั้ง' },
  { id: 'first_boss',  name: 'นักล่าบอส',       icon: '⚔️', stat: 'bosses',    target: 1,    reward: { gold: 100 }, desc: 'ชนะบอสตัวแรก' },
  { id: 'treasure_5',  name: 'นักล่าสมบัติ',     icon: '💰', stat: 'treasures', target: 5,    reward: { gold: 50 }, desc: 'เจอสมบัติ 5 ครั้ง' },
  { id: 'monster_10',  name: 'นักกำจัดมอนสเตอร์', icon: '🐺', stat: 'monsters',  target: 10,   reward: { gold: 50 }, desc: 'กำจัดมอนสเตอร์ 10 ตัว' },
  { id: 'quest_5',     name: 'นักทำภารกิจ',     icon: '📜', stat: 'quests',    target: 5,    reward: { gold: 50 }, desc: 'ทำภารกิจสำเร็จ 5 ครั้ง' },
  { id: 'streak_3',    name: 'คอมโบเริ่มต้น',    icon: '🧵', stat: 'streak',    target: 3,    reward: { gold: 30 }, desc: 'คอมโบโฟกัส 3 session ติดต่อ' },
  { id: 'equip_all',   name: 'พร้อมรบเต็มยศ',   icon: '🔧', stat: 'equip',     target: 1,    reward: { gold: 50 }, desc: 'สวมเกราะครบทั้ง 5 ชิ้น (หัว/ตัว/แขน/ขา/เท้า)' },
  { id: 'class_set',   name: 'เต็มยศประจำคลาส', icon: '🎭', stat: 'classSet',  target: 2,    reward: { gold: 150 }, desc: 'สวมอุปกรณ์เฉพาะคลาส 2 ชิ้นพร้อมกัน (ดูป้ายสี 🎭 ที่ไอเทม)' },
  { id: 'bm_deal',     name: 'สายค้าตลาดมืด',   icon: '🖤', stat: 'bm_buys',   target: 3,    reward: { gold: 100 }, desc: 'ซื้อของจากตลาดมืด 3 ครั้ง' },
  { id: 'bm_king',     name: 'ราชาตลาดมืด',     icon: '👑', stat: 'bm_buys',   target: 10,   reward: { gold: 300 }, desc: 'ซื้อของจากตลาดมืด 10 ครั้ง' },
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
  { id: 'wanted_20',   name: 'ราชาแห่งตลาด',    icon: '💰', stat: 'wanted_sales', target: 20,   reward: { gold: 300 }, desc: 'ขายของให้พ่อค้าที่ต้องการ 20 ครั้ง' },

  { id: 'focus_50',    name: 'สายโฟกัสตัวจริง', icon: '🔥', stat: 'sessions',  target: 50,   reward: { gold: 200 }, desc: 'ทำโฟกัสครบ 50 session' },
  { id: 'level_10',    name: 'นักรบผู้แข็งแกร่ง', icon: '🗡️', stat: 'level',    target: 10,   reward: { gold: 150 }, desc: 'อัพเป็นเลเวล 10' },
  { id: 'boss_10',     name: 'ราชันย์นักล่าบอส', icon: '🐲', stat: 'bosses',   target: 10,   reward: { gold: 500 }, desc: 'ชนะบอส 10 ตัว' },
  { id: 'focus_100',   name: 'ตำนานแห่งโฟกัส', icon: '👑', stat: 'sessions',  target: 100,  reward: { gold: 500 }, desc: 'ทำโฟกัสครบ 100 session' },
  { id: 'level_20',    name: 'ตำนานมีชีวิต',    icon: '🌟', stat: 'level',     target: 20,   reward: { gold: 400 }, desc: 'อัพเป็นเลเวล 20' },
  // ระบบต่อสู้บอส: สลายท่าไม้ตาย (ชาร์จพลัง) — นับรวมทุกครั้งที่สลายได้ตลอดการเล่น
  { id: 'break_5',     name: 'จอมสลาย',       icon: '🛡️', stat: 'charge_breaks', target: 5,  reward: { gold: 150 }, desc: 'สลายท่าไม้ตายบอส 5 ครั้ง' },
  { id: 'break_15',    name: 'ราชันย์จอมสลาย', icon: '💥', stat: 'charge_breaks', target: 15, reward: { gold: 400 }, desc: 'สลายท่าไม้ตายบอส 15 ครั้ง' },
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
  { id: 'challenge_hard',     name: 'นักสู้สุดหิน',   icon: '⚔️', hint: 'เลือกทางที่ยากกว่าเสมอ…',                        reward: { gold: 500 }, check: (ctx) => ctx.challengeMode === 'hard' && ctx.challengeCycles >= 1 },
  { id: 'challenge_marathon', name: 'จิตใจเหนือเหล็ก', icon: '⏱️', hint: 'ไม่มีวันพัก ไม่มีวันแพ้…',                      reward: { gold: 500 }, check: (ctx) => ctx.challengeMode === 'marathon' && ctx.challengeCycles >= 1 },
  { id: 'challenge_survival', name: 'เอาชีวิตรอด',    icon: '🩸', hint: 'เลือดทุกหยดมีค่า…',                           reward: { gold: 500 }, check: (ctx) => ctx.challengeMode === 'survival' && ctx.challengeCycles >= 1 },
  // ระบบต่อสู้บอส: ชนะด้วยการสลายท่าไม้ตาย (breaks ≥ 1 ในไฟต์นั้น) / ชนะตอนบอสสุดทน (สู้ยืดเยื้อ 30+ เทิร์น)
  { id: 'break_win',       name: 'สยบจอมชาร์จ',    icon: '⚡', hint: 'ท่าไม้ตาย… อย่าปล่อยให้มันตั้งหลัก',                  reward: { gold: 300 }, check: (ctx) => ctx.bossBreaks >= 1 },
  { id: 'fury_win',        name: 'อดทนที่สุด',      icon: '🔥', hint: 'ความอดทนมีรางวัลของมันเสมอ',                     reward: { gold: 350 }, check: (ctx) => ctx.bossFury === true },
  { id: 'master',         name: 'จ้าวแห่งการโฟกัส', icon: '🏆', hint: 'เมื่อความสำเร็จทั้งหมดมารวมกัน…',                  reward: { gold: 1000 }, check: (ctx) => ctx.normalUnlocked >= ACHIEVEMENTS.length },
];
