// scripts/backup-db.mjs — สำรอง / กู้คืนฐานข้อมูล PomoQuest
// วิธีใช้:
//   node scripts/backup-db.mjs backup <dest.db>          # สำรอง .db (snapshot สม่ำเสมอ แม้ server รันอยู่)
//   node scripts/backup-db.mjs backup-json <dest.json.gz> # สำรองเป็น JSON บีบอัด (อ่าน/แก้ได้)
//   node scripts/backup-db.mjs restore <src>              # กู้คืน (.db หรือ .json.gz — ตรวจเวอร์ชันก่อน)
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { exportJsonData, restoreFromJson, checkDbSchema } from '../server/data-io.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.POMOQUEST_DB || path.join(__dirname, '..', 'server', 'data', 'pomoquest.db');

const [cmd, file] = process.argv.slice(2);

const fail = (msg) => { console.error('❌ ' + msg); process.exit(1); };

if (cmd === 'backup' || cmd === 'backup-json') {
  if (!file) fail(`ระบุ path ปลายทาง: node scripts/backup-db.mjs ${cmd} <dest>`);
  if (!fs.existsSync(DB_PATH)) fail('ไม่พบฐานข้อมูล: ' + DB_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (cmd === 'backup') {
    const db = new Database(DB_PATH, { readonly: true });
    try {
      await db.backup(file); // online backup — snapshot สม่ำเสมอแม้มี server เขียนอยู่
      console.log(`✅ สำรองข้อมูลแล้ว (SQLite): ${file}`);
    } finally {
      db.close();
    }
  } else {
    const db = new Database(DB_PATH, { readonly: true });
    try {
      const gz = zlib.gzipSync(Buffer.from(JSON.stringify(exportJsonData(db))), { level: 9 });
      fs.writeFileSync(file, gz);
      console.log(`✅ สำรองข้อมูลแล้ว (JSON gzip): ${file}`);
    } finally {
      db.close();
    }
  }
} else if (cmd === 'restore') {
  if (!file) fail('ระบุไฟล์ backup: node scripts/backup-db.mjs restore <src>');
  if (!fs.existsSync(file)) fail('ไม่พบไฟล์ backup: ' + file);
  const buf = fs.readFileSync(file);
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  // .json.gz (gzip magic bytes 0x1f 0x8b) — เขียนลงตารางทันที ไม่ต้องรีสตาร์ท
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    let json;
    try {
      json = JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
    } catch {
      fail('ไฟล์ .json.gz เสียหาย (แกะ gzip ไม่ได้): ' + file);
    }
    const db = new Database(DB_PATH);
    try {
      restoreFromJson(db, json);
      console.log(`✅ กู้คืนข้อมูลแล้ว (JSON): ${file} — มีผลทันที`);
    } catch (e) {
      fail(e.message);
    } finally {
      db.close();
    }
  } else {
    // .db — ตรวจ schema/เวอร์ชันก่อนแทนที่ไฟล์
    const test = new Database(file, { readonly: true });
    const schemaErr = checkDbSchema(test);
    test.close();
    if (schemaErr) fail(schemaErr + ' — ' + file);
    fs.copyFileSync(file, DB_PATH);
    for (const f of [DB_PATH + '-wal', DB_PATH + '-shm']) fs.rmSync(f, { force: true });
    console.log(`✅ กู้คืนข้อมูลแล้ว (SQLite): ${file} — ต้องรีสตาร์ท server`);
  }
} else {
  fail(
    'คำสั่งไม่รู้จัก: ' + (cmd || '(ว่าง)') + '\n' +
    '   backup:      node scripts/backup-db.mjs backup <dest.db>\n' +
    '   backup-json: node scripts/backup-db.mjs backup-json <dest.json.gz>\n' +
    '   restore:     node scripts/backup-db.mjs restore <src>'
  );
}
