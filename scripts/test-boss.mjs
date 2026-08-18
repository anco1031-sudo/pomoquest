process.env.POMOQUEST_CLASS_PERKS = '0'; // ปิดค่าพิเศษคลาส (ทดสอบเฉพาะใน test-class-perks)

// ทดสอบระบบต่อสู้บอสใหม่ — ตั้งรับ (guard) / โกรธจัด (rage) / ชาร์จท่าไม้ตาย (charge) / สุดทน (fury) / สเกลตามเมือง
// + smoke test API ว่า /boss และ /boss/act ส่ง fight state (rage/fury/charging) กลับมา
process.env.POMOQUEST_DB = `/tmp/pq-test-boss-${Date.now()}.db`;
process.env.POMOQUEST_NO_WANDER = '1'; // ปิดบอสเร่ร่อนรายสัปดาห์ — กันผลขึ้นกับสัปดาห์จริง (เทสต์บอสเมืองตรง ๆ)
process.env.POMOQUEST_NO_DRAGON = '1'; // ปิดสุ่มจ้าวมังกรทอง — กัน 4% มาแทรกตอนเทสต์บอสเมือง (บังคับเปิดในเทสต์มังกรทองเอง)

const express = (await import('express')).default;
const routes = (await import('../server/routes.js')).default;
const { db, addItem } = await import('../server/db.js');
const { generateBoss, bossPlayerTurn } = await import('../server/game.js');

const app = express();
app.use(express.json());
app.use('/api', routes);
const server = app.listen(0);
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

let pass = 0;
let fail = 0;
const expect = (label, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
  cond ? pass++ : fail++;
};

const api = async (path, { method = 'GET', body } = {}) => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};

// ตัวละครจำลอง (ไม่ต้องมีใน DB — ทดสอบ attack/guard ซึ่งไม่แตะตารางสกิล)
const makeChar = (o = {}) => ({
  id: 999, name: 'ผู้ทดสอบ', class: 'warrior', level: 5, xp: 0, gold: 100,
  hp: 100000, max_hp: 100000, mp: 50, max_mp: 100, atk: 30, def: 200, spd: 5, crit: 5,
  ...o,
});

try {
  // --- เมืองยิ่งลึก บอสยิ่งแข็ง (x1.05/เมือง) + มี baseAtk ---
  const b0 = generateBoss(10, 0, null);
  const b5 = generateBoss(10, 5, null);
  const b11 = generateBoss(10, 11, null);
  expect('generateBoss: มี baseAtk (= ATK ปกติ)', b0.baseAtk === b0.atk);
  expect('generateBoss: เมือง 5 แข็งกว่าเมือง 0 (x1.25)', b5.maxHp > b0.maxHp && b5.atk > b0.atk, `maxHp ${b0.maxHp} → ${b5.maxHp}`);
  expect('generateBoss: เมือง 11 แข็งกว่าเมือง 5 (x1.55)', b11.maxHp > b5.maxHp, `maxHp ${b5.maxHp} → ${b11.maxHp}`);

  // --- 🛡️ ตั้งรับ: ลดดาเมจ 60% + ฟื้น MP 10% (guard ถูกใช้ตอนบอสตอบโต้ในเทิร์นเดียวกัน) ---
  const g = makeChar({ mp: 10, atk: 1, max_hp: 100000, hp: 100000, def: 0, spd: 0 });
  const gRes = bossPlayerTurn(g, { boss: generateBoss(1, 0) }, 'guard', null, null);
  expect('guard: ฟื้น MP 10% ของ maxMp', g.mp === 20, `mp=${g.mp}`);
  expect('guard: log มีข้อความตั้งรับ', gRes.log.some((l) => l.includes('ตั้งรับ')));
  expect('guard: ไม่มี error', !gRes.error);
  // ตั้งรับ vs ไม่ตั้งรับ ท่าไม้ตาย (บังคับ bossCharging เพื่อตัด RNG สกิลบอสออก)
  // บอสเลเวล 50 (ATK 134 x2.6): ไม่ตั้งรับเสีย ≥ 296 HP เสมอ, ตั้งรับ (ลด 60%) เสีย ≤ 250 HP เสมอ
  const gn = makeChar({ atk: 1, max_hp: 100000, hp: 100000, def: 0, spd: 0 });
  bossPlayerTurn(gn, { boss: generateBoss(50, 0), bossCharging: true }, 'attack', null, null);
  const gg = makeChar({ atk: 1, max_hp: 100000, hp: 100000, def: 0, spd: 0 });
  bossPlayerTurn(gg, { boss: generateBoss(50, 0), bossCharging: true }, 'guard', null, null);
  const lossNorm = 100000 - gn.hp;
  const lossGuard = 100000 - gg.hp;
  expect('guard: ตั้งรับลดดาเมจท่าไม้ตาย 60%', lossGuard <= 250 && lossGuard < lossNorm, `ปกติ ${lossNorm} vs ตั้งรับ ${lossGuard}`);

  // --- 😡 โกรธจัด: HP ≤ 50% → rage + ATK x1.4 ---
  const rBoss = generateBoss(5, 0); // maxHp = 90+160 = 250
  rBoss.hp = 100; // 40%
  const rf = { boss: rBoss };
  const rChar = makeChar({ atk: 30 });
  const rRes = bossPlayerTurn(rChar, rf, 'attack', null, null);
  expect('rage: bossRage = true เมื่อ HP ≤ 50%', rf.bossRage === true);
  expect('rage: ATK พุ่งเป็น baseAtk x1.4', rf.boss.atk === Math.round(rBoss.baseAtk * 1.4), `atk ${rBoss.baseAtk} → ${rf.boss.atk}`);
  expect('rage: log ประกาศโกรธจัด', rRes.log.some((l) => l.includes('โกรธจัด')));
  expect('rage: ยังไม่จบ (บอสไม่ตาย)', rRes.outcome !== 'win');

  // --- ⚠️ ชาร์จท่าไม้ตาย: ครบกำหนด → เริ่มชาร์จ (ไม่โจมตีเทิร์นนั้น) ---
  const cBoss = generateBoss(50, 0); // maxHp = 90+1600 = 1690, def = 53
  const cf = { boss: cBoss, bossChargeIn: 1 };
  const cChar = makeChar({ level: 50, atk: 400, max_hp: 100000, hp: 100000 });
  const c1 = bossPlayerTurn(cChar, cf, 'attack', null, null);
  expect('charge: ครบ 5 เทิร์น → bossCharging = true', cf.bossCharging === true);
  expect('charge: log เตือนกำลังรวบรวมพลัง', c1.log.some((l) => l.includes('รวบรวมพลัง')));

  // --- 💥 สลายการชาร์จ: ทำดาเมจ ≥ 12% HP สูงสุดในเทิร์นที่ชาร์จ → บอสชะงัก (ข้ามเทิร์น) ---
  const hpBeforeBreak = cChar.hp;
  const c2 = bossPlayerTurn(cChar, cf, 'attack', null, null);
  expect('break: ทำดาเมจถึงเกณฑ์ → สลายชาร์จได้', cf.bossCharging === false);
  expect('break: นับครั้งสลาย (fight.breaks=1)', cf.breaks === 1);
  expect('break: บอสชะงัก (log บอกชะงัก + ข้ามเทิร์น)', c2.log.some((l) => l.includes('ชะงัก')));
  expect('break: ท่าไม้ตายไม่ถูกปล่อย (ผู้เล่นไม่เสีย HP)', cChar.hp === hpBeforeBreak, `hp ${hpBeforeBreak} → ${cChar.hp}`);
  expect('break: log บอกสลายแล้ว', c2.log.some((l) => l.includes('สลาย')));

  // --- 💥 ไม่สลาย → ท่าไม้ตายปล่อย (ผู้เล่นเสีย HP) + ชาร์จถัดไปนับใหม่ ---
  const uBoss = generateBoss(50, 0);
  const uf = { boss: uBoss, bossChargeIn: 1 };
  const uChar = makeChar({ level: 50, atk: 1, max_hp: 100000, hp: 100000, def: 0, spd: 0 });
  bossPlayerTurn(uChar, uf, 'attack', null, null); // เทิร์น 1: เริ่มชาร์จ
  expect('unleash: เทิร์น 1 หลังชาร์จเริ่ม → ยังไม่ปล่อย (เทิร์นนี้บอสไม่โจมตี)', uChar.hp === 100000);
  const hpBeforeUnleash = uChar.hp;
  const u2 = bossPlayerTurn(uChar, uf, 'attack', null, null); // เทิร์น 2: โจมตีเบา ไม่สลาย → บอสปล่อยท่าไม้ตาย
  expect('unleash: ท่าไม้ตายปล่อย — ผู้เล่นเสีย HP', uChar.hp < hpBeforeUnleash, `hp ${hpBeforeUnleash} → ${uChar.hp}`);
  expect('unleash: log บอกปล่อยท่าไม้ตาย', u2.log.some((l) => l.includes('ท่าไม้ตาย')));
  expect('unleash: สถานะชาร์จเคลียร์แล้ว', uf.bossCharging === false && uf.bossChargeIn === 5);

  // --- 🎭 ท่าไม้ตายเฉพาะตัว: แต่ละบอสมี ult ต่างกัน (smash/shield/regen/dodge) ---
  expect('ult: เมือง 0 (โจรป่า) = smash (โจมตี)', generateBoss(5, 0).ult?.type === 'attack');
  expect('ult: เมือง 2 (แม่ทัพเงา) = dodge (เงามายา)', generateBoss(5, 2).ult?.type === 'dodge');
  expect('ult: เมือง 3 (ราชินีแม่มด) = regen (พลังฟื้นฟู)', generateBoss(5, 3).ult?.type === 'heal');
  expect('ult: เมือง 4 (โกลเลมไฟ) = shield (เกราะมหึมา)', generateBoss(5, 4).ult?.type === 'shield');
  expect('ult: บอสลับ (ปีศาจทมิฬ) = regen', generateBoss(5, 4, makeChar({ city_rounds: 4 })).ult?.type === 'heal');

  // --- 🛡️ เกราะมหึมา (shield): ปล่อยแล้ว bossGuard ติด กันดาเมจ 60% (2 เทิร์น) ---
  const shBoss = generateBoss(50, 5); // คริสตัลการ์เดี้ยน — ult shield (loadout ไม่มีสกิลฟื้น)
  const shf = { boss: shBoss, bossCharging: true };
  const shWeak = makeChar({ level: 50, atk: 1, max_hp: 100000, hp: 100000, def: 0, spd: 0 });
  const shRes = bossPlayerTurn(shWeak, shf, 'attack', null, null); // โจมตีเบา ไม่สลาย → ปล่อยเกราะ
  expect('ult shield: bossGuard ติด (กัน 60% = mult 0.4, 2 เทิร์น)', shf.bossGuard?.mult === 0.4 && shf.bossGuard?.turns === 2,
    JSON.stringify(shf.bossGuard));
  expect('ult shield: log บอกปล่อยเกราะมหึมา', shRes.log.some((l) => l.includes('เกราะมหึมา')));
  // เทิร์นถัดไป: ดาเมจที่ทำได้ถูกลดลง (เทียบกับบอสไม่มีเกราะ)
  const ctrlBoss = generateBoss(50, 5);
  const ctrlChar = makeChar({ level: 50, atk: 400, max_hp: 100000, hp: 100000 });
  const ctrlHp = ctrlBoss.hp;
  bossPlayerTurn(ctrlChar, { boss: ctrlBoss }, 'attack', null, null);
  const dmgCtrl = ctrlHp - ctrlBoss.hp;
  const hpBeforeG = shBoss.hp;
  const shStrong = makeChar({ level: 50, atk: 400, max_hp: 100000, hp: 100000 });
  bossPlayerTurn(shStrong, shf, 'attack', null, null);
  const dmgGuarded = hpBeforeG - shBoss.hp;
  expect('ult shield: ดาเมจมีเกราะ < ไม่มีเกราะ (ลดลงชัดเจน)', dmgGuarded < dmgCtrl * 0.6, `guarded=${dmgGuarded} ctrl=${dmgCtrl}`);

  // --- 💚 พลังฟื้นฟู (regen): ปล่อยแล้วฟื้น HP 40% ของ HP สูงสุด ---
  const rgBoss = generateBoss(50, 3); // ราชินีแม่มด — ult regen
  rgBoss.hp = Math.round(rgBoss.maxHp * 0.4);
  const rgf = { boss: rgBoss, bossCharging: true };
  const rgChar = makeChar({ level: 50, atk: 1, max_hp: 100000, hp: 100000, def: 0, spd: 0 });
  const rgRes = bossPlayerTurn(rgChar, rgf, 'attack', null, null); // ไม่สลาย → ปล่อยพลังฟื้นฟู
  expect('ult regen: HP เพิ่มขึ้น ~40% ของ HP สูงสุด', rgBoss.hp > Math.round(rgBoss.maxHp * 0.75) && rgBoss.hp < rgBoss.maxHp,
    `hp=${rgBoss.hp} maxHp=${rgBoss.maxHp}`);
  expect('ult regen: log บอกฟื้น HP', rgRes.log.some((l) => l.includes('ฟื้น HP')));

  // --- 💨 เงามายา (dodge): ปล่อยแล้วบอสหลบโจมตี 50% (2 เทิร์น) + พิษโดนแน่นอน ---
  const dgBoss = generateBoss(50, 2); // แม่ทัพเงา — ult dodge
  const dgf = { boss: dgBoss, bossCharging: true };
  const dgChar = makeChar({ level: 50, atk: 1, max_hp: 100000, hp: 100000, def: 0, spd: 0 });
  const dgRes = bossPlayerTurn(dgChar, dgf, 'attack', null, null); // โจมตีเบา ไม่สลาย → ปล่อยเงามายา
  expect('ult dodge: bossDodge ติด (หลบ 50%, 2 เทิร์น)', dgf.bossDodge?.chance === 0.5 && dgf.bossDodge?.turns === 2,
    JSON.stringify(dgf.bossDodge));
  expect('ult dodge: log บอกปล่อยเงามายา', dgRes.log.some((l) => l.includes('เงามายา')));
  // บังคับหลบ 100% → การโจมตีไม่โดนเลย (HP บอสไม่ลด)
  const dgBoss2 = generateBoss(50, 2);
  const dgf2 = { boss: dgBoss2, bossDodge: { chance: 1, turns: 1 } };
  const dgChar2 = makeChar({ level: 50, atk: 400, max_hp: 100000, hp: 100000 });
  const hpBeforeD = dgBoss2.hp;
  bossPlayerTurn(dgChar2, dgf2, 'attack', null, null);
  expect('ult dodge: หลบ 100% → ผู้เล่นทำดาเมจไม่ได้', dgBoss2.hp === hpBeforeD, `hp ${hpBeforeD} → ${dgBoss2.hp}`);
  // พิษไม่โดนหลบ (ดาเมจต่อเนื่อง — ยังลด HP บอสได้ตอนเงามายาติด)
  const pBoss = generateBoss(5, 2);
  const pf = { boss: pBoss, bossDodge: { chance: 1, turns: 2 }, bossPoison: { pct: 0.05, turns: 1 } };
  const pChar = makeChar({ atk: 1, max_hp: 100000, hp: 100000, def: 0, spd: 0 });
  const hpBeforeP = pBoss.hp;
  bossPlayerTurn(pChar, pf, 'attack', null, null);
  expect('ult dodge: พิษโดนแน่นอน (ไม่โดนหลบเงามายา)', pBoss.hp < hpBeforeP, `hp ${hpBeforeP} → ${pBoss.hp}`);

  // --- 🔥 สุดทน: สู้ยืดเยื้อเกิน 30 เทิร์น → ATK พุ่งถาวร x1.6 ---
  const fBoss = generateBoss(5, 0);
  const ff = { boss: fBoss, turn: 29 };
  const fChar = makeChar({ atk: 30 });
  const fRes = bossPlayerTurn(fChar, ff, 'attack', null, null);
  expect('fury: เทิร์น 30 → bossFury = true', ff.bossFury === true);
  expect('fury: ATK พุ่งเป็น baseAtk x1.6', ff.boss.atk === Math.round(fBoss.baseAtk * 1.6), `atk ${fBoss.baseAtk} → ${ff.boss.atk}`);
  expect('fury: log ประกาศสุดทน', fRes.log.some((l) => l.includes('สุดทน')));

  // --- ชนะบอสยังทำงาน (โจมตีแรงมาก → win) ---
  const wBoss = generateBoss(5, 0);
  const wf = { boss: wBoss };
  const wChar = makeChar({ atk: 5000 });
  const wRes = bossPlayerTurn(wChar, wf, 'attack', null, null);
  expect('win: โจมตีแรงพอ → ชนะบอส', wRes.outcome === 'win' && wf.boss.hp === 0);

  // --- รางวัลฝีมือ: สลายท่าไม้ตาย +8% XP/ทอง ต่อครั้ง (สูงสุด +24%) / ชนะตอนสุดทน +15% ทอง ---
  // กำหนด deterministic: level 50 → base XP = 250+60*50 = 3250, base gold = 120+40*50 = 2120
  const baseXp = 250 + 60 * 50;
  const baseGold = 120 + 40 * 50;
  const bk2 = makeChar({ level: 50, atk: 5000 });
  const bf2 = { boss: generateBoss(50, 0), breaks: 2 };
  const br2 = bossPlayerTurn(bk2, bf2, 'attack', null, null);
  expect('bonus: สลาย 2 ครั้ง → XP x1.16', br2.outcome === 'win' && br2.xp === Math.round(baseXp * 1.16), `xp=${br2.xp} (คาด ${Math.round(baseXp * 1.16)})`);
  expect('bonus: สลาย 2 ครั้ง → gold x1.16', br2.gold === Math.round(baseGold * 1.16), `gold=${br2.gold}`);
  expect('bonus: log โชว์รางวัลฝีมือ', br2.log.some((l) => l.includes('รางวัลฝีมือ')));
  const bk3 = makeChar({ level: 50, atk: 5000 });
  const bf3 = { boss: generateBoss(50, 0), breaks: 3 };
  const br3 = bossPlayerTurn(bk3, bf3, 'attack', null, null);
  expect('bonus: สลาย 3 ครั้ง → XP x1.24 (แคป +24%)', br3.xp === Math.round(baseXp * 1.24), `xp=${br3.xp}`);
  const bk4 = makeChar({ level: 50, atk: 5000 });
  const bf4 = { boss: generateBoss(50, 0), breaks: 4 };
  const br4 = bossPlayerTurn(bk4, bf4, 'attack', null, null);
  expect('bonus: สลายเกิน 3 → แคปที่ x1.24', br4.xp === Math.round(baseXp * 1.24), `xp=${br4.xp}`);
  const bk5 = makeChar({ level: 50, atk: 5000 });
  const bf5 = { boss: generateBoss(50, 0), bossFury: true, turn: 35 };
  const br5 = bossPlayerTurn(bk5, bf5, 'attack', null, null);
  expect('bonus: ชนะตอนสุดทน → gold x1.15 (และ XP ปกติ)', br5.outcome === 'win' && br5.gold === Math.round(baseGold * 1.15) && br5.xp === baseXp,
    `gold=${br5.gold} xp=${br5.xp}`);
  expect('bonus: ชนะตอนสุดทน → furyWin=true ใน result', br5.furyWin === true);
  expect('bonus: ชนะตอนสุดทน → log โชว์โบนัสอดทน', br5.log.some((l) => l.includes('อดทน')));

  // --- smoke test API: /boss + /boss/act ส่ง fight state ---
  let r = await api('/character/create', { method: 'POST', body: { name: 'บอสเทสเตอร์', class: 'warrior' } });
  expect('api: สร้างตัวละคร', r.status === 200 && !!r.json.character?.id);
  r = await api('/boss');
  expect('api /boss: มี fight state (rage/fury/charging)', r.status === 200 && r.json.fight && typeof r.json.fight.rage === 'boolean' && typeof r.json.fight.charging === 'boolean',
    JSON.stringify(r.json.fight));
  expect('api /boss: มี flags armor/dodge (สถานะเกราะ/หลบ)', r.status === 200 && r.json.fight && typeof r.json.fight.armor === 'boolean' && typeof r.json.fight.dodge === 'boolean',
    JSON.stringify(r.json.fight));
  expect('api /boss: บอสมี ult (ท่าไม้ตายเฉพาะตัว)', r.status === 200 && r.json.boss?.ult?.type === 'attack' && !!r.json.boss.ult.name,
    JSON.stringify(r.json.boss?.ult));
  r = await api('/boss/act', { method: 'POST', body: { action: 'guard' } });
  expect('api /boss/act guard: ไม่ error + มี fight state', r.status === 200 && !r.json.error && r.json.fight && r.json.fight.rage === false,
    JSON.stringify(r.json.fight));
  expect('api /boss/act guard: บอสยังอยู่', !!r.json.boss && r.json.boss.hp > 0);
  // สกิลต้องส่งเป็น skillId (บั๊กเดิม: client ส่งเป็น itemId → server หาไม่เจอ → "สกิลไม่พบ")
  r = await api('/boss/act', { method: 'POST', body: { action: 'skill', skillId: 'ws_power' } });
  expect('api /boss/act skill: ส่ง skillId ใช้ได้ (ไม่ error "สกิลไม่พบ")', r.status === 200 && !r.json.error,
    JSON.stringify(r.json.error || '(ไม่มี error)'));
  expect('api /boss/act skill: log มีการใช้สกิล (ฟันแหลก)', r.status === 200 && r.json.log?.some((l) => l.includes('ฟันแหลก')),
    JSON.stringify(r.json.log || []));
  // ชนะบอสผ่าน API (อัปเกรดพลัง → ชนะภายในไม่กี่เทิร์น) — ตรวจ response มี breaks/furyWin + progress.charge_breaks
  const cid2 = r.json.character.id;
  db.prepare('UPDATE character SET level = 50, max_hp = 5000, hp = 5000, mp = 500, max_mp = 500, atk = 2000, def = 500, spd = 0, crit = 0 WHERE id = ?').run(cid2);
  let win2 = null;
  for (let i = 0; i < 40 && !win2; i++) {
    const act = await api('/boss/act', { method: 'POST', body: { action: 'attack' } });
    if (act.json.outcome === 'win') win2 = act.json;
  }
  expect('api: ชนะบอสได้', !!win2 && win2.outcome === 'win');
  expect('api: response มี breaks (0) + furyWin (false)', win2 && win2.breaks === 0 && win2.furyWin === false,
    `breaks=${win2?.breaks} furyWin=${win2?.furyWin}`);
  expect('api: progress มี charge_breaks (ยัง 0 — ไม่ได้สลาย)', win2 && win2.progress?.charge_breaks === 0,
    `charge_breaks=${win2?.progress?.charge_breaks}`);
  expect('api: log ไม่มีรางวัลฝีมือ (ชนะปกติ)', win2 && !win2.log.some((l) => l.includes('รางวัลฝีมือ')));
  const trophies = db.prepare('SELECT boss_key FROM trophy WHERE character_id = ?').all(cid2);
  expect('api: ชนะบอส → เก็บถ้วยรางวัลบอสนั้น (ครั้งแรก)', trophies.length === 1 && !!trophies[0].boss_key, JSON.stringify(trophies));

  // --- 🦄 ยูนิคอร์น: กันกับดัก 1 ครั้ง/รอบ (โล่สะสมตอนชนะบอส → ตกกับดักไม่เสียพลัง) ---
  {
    const uc = cid2;
    db.prepare("INSERT OR IGNORE INTO pet (character_id, pet_id, is_active) VALUES (?, 'p_unicorn', 1)").run(uc);
    db.prepare('UPDATE pet SET is_active = 1 WHERE character_id = ? AND pet_id = ?').run(uc, 'p_unicorn');
    db.prepare('UPDATE pet SET is_active = 0 WHERE character_id = ? AND pet_id != ?').run(uc, 'p_unicorn');
    // ตั้งโล่กับดัก (เหมือนชนะบอสเพิ่งได้) + ฟื้น HP เต็ม
    db.prepare('UPDATE progress SET pet_trap_shield = 1 WHERE character_id = ?').run(uc);
    db.prepare('UPDATE character SET hp = max_hp WHERE id = ?').run(uc);
    const hpBefore = db.prepare('SELECT hp FROM character WHERE id = ?').get(uc).hp;
    r = await api('/adventure/event', { method: 'POST', body: { key: 'trap' } });
    const hpAfter = db.prepare('SELECT hp FROM character WHERE id = ?').get(uc).hp;
    expect('pet: ยูนิคอร์นกันกับดัก → ไม่เสียพลัง + โล่หาย', r.status === 200 && hpAfter === hpBefore
      && db.prepare('SELECT pet_trap_shield FROM progress WHERE character_id = ?').get(uc).pet_trap_shield === 0,
      `hp ${hpBefore} → ${hpAfter} · detail: ${r.json.event?.detail}`);
    // โล่หมดแล้ว → ตกกับดักครั้งถัดไปเสียพลังปกติ
    r = await api('/adventure/event', { method: 'POST', body: { key: 'trap' } });
    const hpAfter2 = db.prepare('SELECT hp FROM character WHERE id = ?').get(uc).hp;
    expect('pet: ยูนิคอร์นโล่หมด → ตกกับดักเสียพลังปกติ', hpAfter2 < hpAfter, `hp ${hpAfter} → ${hpAfter2}`);
  }

  // --- 🌟 บอสจ้าวมังกรทอง: สุ่มเจอแทนบอสเมือง (~4%) โหดสุด ชนะได้ 🎁 2 กล่องการันตี + แพ้โดนบทลงโทษ ---
  {
    const normB = generateBoss(10, 0, null); // บอสเมืองปกติ (ก่อนบังคับมังกร)
    process.env.POMOQUEST_DRAGON = '1'; // บังคับให้เจอมังกรทอง (ปิดหลังจบ)
    const dgB = generateBoss(10, 0, null);
    expect('dragon: จ้าวมังกรทอง isDragon + แข็งกว่าบอสเมืองชัดเจน (em x1.5)', dgB.isDragon === true && dgB.maxHp > normB.maxHp * 1.4 && dgB.atk > normB.atk * 1.4,
      `maxHp ปกติ ${normB.maxHp} vs มังกร ${dgB.maxHp} · atk ${normB.atk} vs ${dgB.atk}`);
    // API: สร้างตัวละครใหม่ → เจอมังกรทองแทนบอสเมือง
    r = await api('/character/create', { method: 'POST', body: { name: 'มังกรเทสเตอร์', class: 'warrior' } });
    const dcid = r.json.character.id;
    r = await api('/boss');
    expect('dragon: /boss เจอจ้าวมังกรทอง (isDragon + ชื่อถูก)', r.status === 200 && r.json.boss?.isDragon === true && r.json.boss?.name === 'จ้าวมังกรทอง', `${r.json.boss?.name}`);
    // อัปเกรดพลัง → ชนะ → ได้ 🎁 2 กล่องการันตี + นับ rare_wins + รางวัล x1.5
    db.prepare('UPDATE character SET level = 50, max_hp = 5000, hp = 5000, mp = 500, max_mp = 500, atk = 2000, def = 500, spd = 0, crit = 0 WHERE id = ?').run(dcid);
    const goldBefore = db.prepare('SELECT gold FROM character WHERE id = ?').get(dcid).gold;
    let dwin = null;
    for (let i = 0; i < 40 && !dwin; i++) {
      const act = await api('/boss/act', { method: 'POST', body: { action: 'attack' } });
      if (act.json.outcome === 'win') dwin = act.json;
    }
    expect('dragon: ชนะจ้าวมังกรทองได้', !!dwin);
    const dInv = dwin?.inventory || [];
    const giftQty = dInv.find((x) => x.item_id === 193)?.qty || 0;
    expect('dragon: ชนะ → ได้ 🎁 ของขวัญจ้าวมังกรทอง 2 กล่องการันตี', giftQty >= 2, `qty=${giftQty}`);
    expect('dragon: ชนะ → นับ rare_wins (ตราลับ "นักล่าตำนาน")', (dwin?.progress?.rare_wins || 0) >= 1, `rare_wins=${dwin?.progress?.rare_wins}`);
    expect('dragon: ชนะ → นับ dragon_boss_wins (สถิติ)', (dwin?.progress?.dragon_boss_wins || 0) >= 1, `dragon_boss_wins=${dwin?.progress?.dragon_boss_wins}`);
    const goldAfter = db.prepare('SELECT gold FROM character WHERE id = ?').get(dcid).gold;
    expect('dragon: ชนะ → รางวัล x1.5 (ทองเพิ่มเยอะกว่าบอสปกติ)', goldAfter > goldBefore + 500, `gold ${goldBefore} → ${goldAfter}`);
    // ตัวละครใหม่ → เจอมังกร → ถอยทัพ → บทลงโทษ (เสียของ/ทอง/คอมโบ + HP เหลือ 1)
    r = await api('/character/create', { method: 'POST', body: { name: 'มังกรหนี', class: 'rogue' } });
    const rcid = r.json.character.id;
    db.prepare('UPDATE character SET gold = 500, hp = 500, max_hp = 500 WHERE id = ?').run(rcid);
    db.prepare('UPDATE progress SET streak = 3 WHERE character_id = ?').run(rcid);
    addItem(rcid, 45, 1);
    r = await api('/boss');
    expect('dragon: ตัวละครใหม่เจอมังกรทอง', r.json.boss?.isDragon === true, r.json.boss?.name);
    r = await api('/boss/retreat', { method: 'POST' });
    const after = db.prepare('SELECT gold, hp FROM character WHERE id = ?').get(rcid);
    const invAfter = (await api('/state')).json.inventory || [];
    const streakAfter = db.prepare('SELECT streak FROM progress WHERE character_id = ?').get(rcid).streak;
    expect('dragon: แพ้ (หนี) → เสียทอง 10% (500 → 450)', after.gold === 450, `gold=${after.gold}`);
    expect('dragon: แพ้ (หนี) → HP เหลือ 1', after.hp === 1, `hp=${after.hp}`);
    expect('dragon: แพ้ (หนี) → เสียของสุ่ม 1 ชิ้นจากกระเป๋า', !invAfter.some((x) => x.item_id === 45), JSON.stringify(invAfter.map((x) => x.item_id)));
    expect('dragon: แพ้ (หนี) → คอมโบโฟกัสหาย (streak=0)', streakAfter === 0, `streak=${streakAfter}`);
    const losesAfter = db.prepare('SELECT dragon_boss_loses FROM progress WHERE character_id = ?').get(rcid).dragon_boss_loses;
    expect('dragon: แพ้ (หนี) → นับ dragon_boss_loses (สถิติ)', losesAfter === 1, `dragon_boss_loses=${losesAfter}`);
    process.env.POMOQUEST_DRAGON = '0';
  }

  // --- reset: หมุน "world epoch" — session ที่พักค้างใน localStorage (โลกเก่า) ถูกทิ้งอัตโนมัติ ---
  r = await api('/state');
  expect('epoch: /state มี epoch', typeof r.json.epoch === 'string' && r.json.epoch.length > 0);
  const epochBefore = r.json.epoch;
  r = await api('/reset', { method: 'POST' });
  expect('epoch: reset สำเร็จ', r.status === 200);
  r = await api('/state');
  expect('epoch: reset หมุน epoch ใหม่ (timer เก่าไม่กู้คืน)', r.json.epoch && r.json.epoch !== epochBefore,
    `${epochBefore.slice(0, 8)}… → ${r.json.epoch.slice(0, 8)}…`);

  console.log(`\nผลลัพธ์: ${pass} ผ่าน, ${fail} ตก`);
} finally {
  server.close();
  process.exit(fail > 0 ? 1 : 0);
}
