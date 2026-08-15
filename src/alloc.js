// จัดสรรแต้มสถานะอัตโนมัติ — น้ำหนักตามคลาส + ปรับตามอุปกรณ์ที่สวม (เติม stat ที่ขาด)
export const CLASS_WEIGHTS = {
  warrior: { hp: 3, atk: 3, def: 2, spd: 1.5, mp: 0.5 },    // นักรบ: เลือดหนา + บุกหนัก + ทน
  mage:    { mp: 3, atk: 2.5, spd: 1.5, hp: 1.5, def: 0.5 }, // นักเวทย์: มานา (ใช้สกิลเวท) + โจมตีเวท
  rogue:   { spd: 3, atk: 2.5, hp: 1.5, def: 1, mp: 0.5 },   // โจร: ว่องไว (หลบ + พลัง) + คริติคอล
  cleric:  { hp: 2.5, mp: 2.5, def: 2, atk: 1.5, spd: 1 },  // นักบวช: สมดุล ทน + มานาฟื้นพลัง
};
export const AUTO_KEYS = ['hp', 'mp', 'atk', 'def', 'spd'];

// ปรับน้ำหนักตามอุปกรณ์: stat ที่เกียร์ให้อยู่แล้ว (เทียบกับค่า base) ลดน้ำหนักลง (สูงสุด -50%)
// → แต้มจะไปเติม stat ที่ขาดแทน (เช่น สวมเกราะ DEF เยอะแล้ว → ไปเพิ่ม ATK/HP)
export function gearAdjustedWeights(cls, gearBonus, base) {
  const w = CLASS_WEIGHTS[cls] || CLASS_WEIGHTS.warrior;
  const adj = {};
  for (const k of AUTO_KEYS) {
    const ratio = (base[k] || 0) > 0 ? (gearBonus[k] || 0) / base[k] : 0;
    adj[k] = w[k] * (1 - 0.5 * Math.min(ratio, 1));
  }
  return adj;
}

// แจกแต้มตามน้ำหนัก — สัดส่วนพอดี + เศษที่เหลือให้ stat ที่เศษมากที่สุด (ถ้าเสมอกันให้ตัวที่น้ำหนักสูงกว่า)
export function allocatePoints(total, weights) {
  const out = { hp: 0, mp: 0, atk: 0, def: 0, spd: 0 };
  if (total <= 0) return out;
  const sum = AUTO_KEYS.reduce((a, k) => a + (weights[k] || 0), 0);
  if (sum <= 0) return out;
  const raw = {};
  for (const k of AUTO_KEYS) raw[k] = (total * (weights[k] || 0)) / sum;
  let used = 0;
  for (const k of AUTO_KEYS) { out[k] = Math.floor(raw[k]); used += out[k]; }
  const order = AUTO_KEYS.map((k) => [k, raw[k] - out[k]]).sort((x, y) => (y[1] - x[1]) || ((weights[y[0]] || 0) - (weights[x[0]] || 0)));
  let i = 0;
  while (used < total) { out[order[i % order.length][0]] += 1; used += 1; i += 1; }
  return out;
}
