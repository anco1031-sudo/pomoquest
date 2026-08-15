// scripts/backup-db.mjs — สำรอง / กู้คืนฐานข้อมูล PomoQuest
// วิธีใช้:
//   node scripts/backup-db.mjs backup <dest.db>   # สำรอง (ได้ snapshot สม่ำเสมอแม้ server รันอยู่)
//   node scripts/backup-db.mjs restore <src.db>   # กู้คืน (ต้องหยุด server ก่อน — run.sh จัดการให้)
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'server', 'data', 'pomoquest.db');

const [cmd, file] = process.argv.slice(2);

if (cmd === 'backup') {
  if (!file) { console.error('❌ ระบุ path ปลายทาง: node scripts/backup-db.mjs backup <dest.db>'); process.exit(1); }
  if (!fs.existsSync(DB_PATH)) { console.error('❌ ไม่พบฐานข้อมูล: ' + DB_PATH); process.exit(1); }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(DB_PATH, { readonly: true });
  try {
    await db.backup(file); // online backup — snapshot สม่ำเสมอแม้มี server เขียนอยู่
    console.log(`✅ สำรองข้อมูลแล้ว: ${file}`);
  } finally {
    db.close();
  }
} else if (cmd === 'restore') {
  if (!file) { console.error('❌ ระบุไฟล์ backup: node scripts/backup-db.mjs restore <src.db>'); process.exit(1); }
  if (!fs.existsSync(file)) { console.error('❌ ไม่พบไฟล์ backup: ' + file); process.exit(1); }
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.copyFileSync(file, DB_PATH);
  // ลบ WAL/SHM เก่า — กันข้อมูลค้างจาก DB เดิมปนเข้ามา
  for (const f of [DB_PATH + '-wal', DB_PATH + '-shm']) fs.rmSync(f, { force: true });
  console.log(`✅ กู้คืนข้อมูลจาก: ${file}`);
} else {
  console.error('❌ คำสั่งไม่รู้จัก: ' + (cmd || '(ว่าง)'));
  console.error('   backup:  node scripts/backup-db.mjs backup <dest.db>');
  console.error('   restore: node scripts/backup-db.mjs restore <src.db>');
  process.exit(1);
}
