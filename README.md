# 🍅⚔️ PomoQuest — Pomodoro RPG

โฟกัสงาน… แล้วตัวละครของคุณจะผจญภัยไปกับคุณ!

PomoQuest ผสม **เทคนิค Pomodoro** เข้ากับ **เกม RPG** — ทุกครั้งที่คุณตั้งใจโฟกัสงาน ตัวละครของคุณจะออกเดินทางผจญภัย เก็บเลเวล ต่อสู้กับมอนสเตอร์ หาสมบัติ สู้กับบอส และเดินทางข้ามเมืองไปเรื่อย ๆ

## 🎮 แนวคิดการเล่น

| ช่วงเวลา | สิ่งที่เกิดขึ้นในเกม |
|---|---|
| **Work session (25 นาที)** | ⚔️ ผจญภัยในเมืองปัจจุบัน — ทุก ~90 วินาทีจะเกิดเหตุการณ์สุ่ม: เจอมอนสเตอร์ (สู้แบบอัตโนมัติ ไม่รบกวนสมาธิ) เจอสมบัติ ศาลเจ้าลึกลับ พ่อค้าเร่ร่อน หรือกับดัก |
| **พักสั้น (5 นาที)** | 🔥 ค่ายพัก — ซื้อของที่ร้านค้า ทำภารกิจย่อย (สำเร็จ/เสี่ยง) ใช้ไอเทม ฟื้นพลังฟรี หรือจัดสรรแต้มสถานะ |
| **ครบ 4 sessions** | 👹 **พักยาว (15 นาที) = สู้บอส!** ต่อสู้แบบเทิร์น-by-เทิร์น (โจมตี/สกิล/ใช้ยา) ชนะแล้วได้รางวัลใหญ่และเดินทางสู่เมืองถัดไป |

### ระบบหลัก
- 🧑‍🎤 **สร้างตัวละคร** — เลือกชื่อ + 1 ใน 4 คลาส (นักรบ / นักเวทย์ / โจร / นักบวช) แต่ละคลาสมีค่าสถานะพื้นฐานต่างกัน
- 📈 **เลเวล & แต้มสถานะ** — สะสม XP เพื่อเลเวลอัพ ได้แต้มจัดสรรเอง (HP / MP / ATK / DEF / SPD) พร้อมการเติบโตอัตโนมัติ
- 🎒 **ไอเทม & อุปกรณ์** — ยารักษา, อาวุธ, เกราะ, เครื่องประดับ (ซื้อ/ขาย/สวม/ใช้)
- 🔥 **คอมโบโฟกัส** — ทำ session ต่อเนื่องไม่ทิ้ง ได้โบนัส XP สูงสุด x1.5
- 🗺️ **8 เมือง** — ชนะบอสทีละเมืองเพื่อเดินทางต่อไป (บอสและมอนสเตอร์แข็งแกร่งขึ้นตามเลเวล)
- 🏅 **ระบบ Achievement (25 ตรา)** — ปลดล็อกอัตโนมัติเมื่อถึงเงื่อนไข (session, บอส, มอนสเตอร์, สมบัติ, ภารกิจ, คอมโบ, เลเวล, ทอง ฯลฯ) ได้รางวัลทอง/XP ดูความคืบหน้าได้ที่แท็บ "ตรา"
- 📜 **บันทึกการผจญภัย** — ดูประวัติทุกเหตุการณ์ รางวัล และสถิติสะสม
- 📱 **PWA** — ติดตั้งเป็นแอพบนมือถือได้ (Add to Home Screen) ใช้งานแบบ standalone

## 🛠️ Tech Stack

- **Frontend:** React 19 + Vite (mobile-first CSS, ไม่มี UI framework)
- **Backend:** Express
- **Database:** SQLite (better-sqlite3) — เก็บที่ `server/data/pomoquest.db`
- **PWA:** manifest + service worker (network-first) + ไอคอน PNG สร้างจาก pixel art

## 🚀 วิธีรัน

```bash
npm install          # ติดตั้ง dependencies (ครั้งแรก)
npm run dev          # โหมดพัฒนา — server :3001 + frontend :5173 (เปิด http://localhost:5173)
```

โหมด production:

```bash
npm run build        # build frontend ไปที่ dist/
npm start            # รัน server เดียว เสิร์ฟทั้งแอพที่ http://localhost:3001
```

> 💡 บนมือถือ: เปิดเว็บใน Chrome → เมนู → **Add to Home Screen** → ใช้งานเหมือนแอพจริง

## 📁 โครงสร้างโปรเจกต์

```
├── server/
│   ├── index.js      # Express entry (เสิร์ฟ dist ใน production)
│   ├── routes.js     # API ทั้งหมด
│   ├── db.js         # SQLite schema + seed
│   ├── game.js       # game engine (XP, ต่อสู้, event, บอส, quest)
│   ├── data.js       # ข้อมูลเกม (คลาส, ไอเทม, เมือง, มอนสเตอร์, เหตุการณ์)
│   └── data/         # ไฟล์ฐานข้อมูล (auto-create, อย่า commit)
├── src/
│   ├── Game.jsx      # phase machine: idle → work → พักสั้น → บอส
│   ├── context.jsx   # state กลาง + API actions + toast + level-up signal
│   └── components/   # UI ทั้งหมด (creation, timer, camp, boss, ฯลฯ)
├── public/           # PWA (manifest, sw.js, ไอคอน)
└── scripts/          # gen-icons.mjs — สร้างไอคอนจาก pixel art
```

## 🔌 API หลัก

| Method | Path | ความหมาย |
|---|---|---|
| GET | `/api/state` | สถานะรวม (ตัวละคร, สถิติ, กระเป๋า, บันทึก, ตั้งค่า) |
| POST | `/api/character/create` | สร้างตัวละคร |
| POST | `/api/adventure/event` | สุ่มเหตุการณ์ระหว่าง work session |
| POST | `/api/adventure/complete` | จบ session → แจกรางวัล + คอมโบ |
| GET | `/api/camp` | ร้านค้า + ภารกิจ (ช่วงพัก) |
| POST | `/api/shop/buy` · `/api/quest/do` | ซื้อของ / ทำภารกิจ |
| GET/POST | `/api/boss` · `/api/boss/act` | สู้บอส (โจมตี/สกิล/ยา) |
| POST | `/api/character/allocate` | จัดสรรแต้มสถานะ |
| PUT | `/api/settings` | ปรับเวลา Pomodoro |

## 🧪 การทดสอบ

```bash
npm run build          # ตรวจว่า compile ผ่าน
# ทดสอบ API: รัน `npm start` แล้วใช้ curl ตามตาราง API ด้านบน
```

---

สร้างด้วย 💜 ให้การโฟกัสงานสนุกขึ้นทุกนาที!
