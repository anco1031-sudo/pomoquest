// ทดสอบระบบต่อสู้บอสใหม่ — ตั้งรับ (guard) / โกรธจัด (rage) / ชาร์จท่าไม้ตาย (charge) / สุดทน (fury) / สเกลตามเมือง
// + smoke test API ว่า /boss และ /boss/act ส่ง fight state (rage/fury/charging) กลับมา
process.env.POMOQUEST_DB = `/tmp/pq-test-boss-${Date.now()}.db`;

const express = (await import('express')).default;
const routes = (await import('../server/routes.js')).default;
const { db } = await import('../server/db.js');
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
  r = await api('/boss/act', { method: 'POST', body: { action: 'guard' } });
  expect('api /boss/act guard: ไม่ error + มี fight state', r.status === 200 && !r.json.error && r.json.fight && r.json.fight.rage === false,
    JSON.stringify(r.json.fight));
  expect('api /boss/act guard: บอสยังอยู่', !!r.json.boss && r.json.boss.hp > 0);
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
