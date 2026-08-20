# 📋 TODO — โอกาสหน้า (backlog จาก review)

> รายการงานที่เก็บจาก review รอบ 19-Aug-26 — ยังไม่เร่งทำ เก็บไว้ทำเมื่อมีโอกาส / ก่อนลุย feature ใหญ่
> แหล่ง: Lin (หลิน) — `PomoQuest-Codebase-Overview-2026-08-19.md` · Cher (เฌอ) — `PomoQuest-README-Assessment-2026-08-19.md`

## 🔴 ลำดับแรก (เมื่อจะลุย feature ใหญ่)

- [ ] **แยกโมดูลไฟล์ใหญ่** — `routes.js` (1,822 บรรทัด), `game.js` (1,361), `Game.jsx` (1,213), `styles.css` (85KB), `data.js` (103KB) — เริ่มจาก routes แยกเป็น modules แล้ว compose router
- [ ] **ยกระดับ testing เข้า CI** — ยังไม่มี GitHub Actions — เอา `scripts/test-*.mjs` + `*.browser.mjs` ไปรันอัตโนมัติใน pipeline (รันมืออย่างเดียวตอนนี้)

## 🟡 กลาง

- [ ] **พิจารณา TypeScript** — โค้ด data-heavy เสี่ยง runtime error เงียบตอน refactor ใหญ่ — ค่อยๆ ย้ายทีละไฟล์ (ไม่ต้องทั้งโปรเจกต์พร้อมกัน)
- [ ] **SQLite / Fly.io strategy** — volume 256MB + auto-stop: หา auto-backup อัตโนมัติ (ตอนนี้ manual ผ่าน `run.sh backup`), ศึกษา lock/contention เมื่อมีผู้ใช้พร้อมกันหลายคน (มี WAL ช่วยแล้ว)
- [ ] **ทดสอบ 2 โหมด LLM** — พฤติกรรมเกมต่างกันตอนมี/ไม่มี LLM (localhost:8080) — ทำ test matrix ครอบคลุมทั้ง 2 โหมด

## 🟢 เบา / เนื้อหา

- [ ] **README: เพิ่ม Version & Deploy section** — อ้างอิง `fly.toml` + Docker สรุป 1 บรรทัด (จาก Cher: Should-have #2)
- [ ] **README: อธิบาย Class Perks เงื่อนไขเวลาจริง** — "(ตามเวลาระบบของเครื่องคุณ)" (จาก Cher: Should-have #4)
- [ ] **README: screenshot/สื่อตัวอย่าง UI** — อ้างอิง `public/manifest.json` หรือเพิ่มรูป (จาก Cher: Should-have #3 + Nice-to-have #3)
- [ ] **README: Changelog/Roadmap สั้นๆ** — 3 จุดใหม่ล่าสุดจาก `git log` (จาก Cher: Nice-to-have #1)
- [ ] **README: เพิ่ม Boss Victory Flow** — อธิบาย flow ใหม่หลังชนะบอส: เลือก "พักเพื่อโฟกัสต่อ" (อยู่เมืองเดิม/ไปเมืองใหม่) หรือ "จบงาน เลิกโฟกัส" (สรุปผลกลับหน้าหลัก) · เพิ่ม ability ทิ้ง session ได้ระหว่างพักหลังบอส (20-Aug-26)
- [ ] **ล้าง `.omo/` session state ในเครื่อง** — ไฟล์ session ค้าง (gitignore ไว้แล้ว ไม่กระทบ repo — เป็นการล้างเครื่องล้วนๆ)

---

*สร้าง 19-Aug-26 โดย Aiy — จากรายงานของ Lin (codebase) + Cher (README) · อัปเดตได้เรื่อยๆ เมื่อ review ใหม่*