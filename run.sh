#!/usr/bin/env bash
# run.sh — ตัวรัน PomoQuest (Pomodoro RPG)
#
# วิธีใช้:
#   ./run.sh            # เท่ากับ dev (โหมดพัฒนา — server :3001 + frontend :5173)
#   ./run.sh dev        # โหมดพัฒนา (รันหน้าจอ — Ctrl+C เพื่อหยุด)
#   ./run.sh prod       # build + รัน production ที่ http://localhost:3001 (รันหน้าจอ)
#   ./run.sh start      # รัน production แบบ background (daemon) — log ที่ /tmp/pomoquest.log
#   ./run.sh stop       # หยุด server ที่รันอยู่
#   ./run.sh reset      # RESET เกม: หยุด server → ลบฐานข้อมูล → รันใหม่ (ต้องพิมพ์ reset ยืนยัน, ใช้ -y ข้าม)
#   ./run.sh backup     # สำรองฐานข้อมูลไปที่ backups/ (snapshot ตอนนี้ — server รันอยู่ได้)
#   ./run.sh restore    # กู้คืนจาก backup (เลือกไฟล์ หรือ ./run.sh restore backups/xxx.db) — ต้องยืนยัน
#   ./run.sh status     # ดูสถานะ: server / LLM ที่ port 8080
#   ./run.sh llm        # เช็คว่า LLM (localhost:8080) พร้อมใช้งานไหม
#   ./run.sh help       # ดูวิธีใช้
set -euo pipefail
cd "$(dirname "$0")"

DEV_PORT=5173
API_PORT=3001
LLM_PORT=8080

help() {
  # พิมพ์เฉพาะ block comment ด้านบน (บรรทัดที่ขึ้นต้นด้วย # ยกเว้น shebang)
  tail -n +2 "$0" | grep '^#' | sed 's/^# \{0,1\}//'
}

llm_check() {
  if curl -s -m 3 -o /dev/null "http://localhost:${LLM_PORT}/v1/models"; then
    echo "✅ LLM พร้อมใช้งานที่ localhost:${LLM_PORT}/v1 (model: \"default\")"
  else
    echo "⚠️  ไม่พบ LLM ที่ localhost:${LLM_PORT} — เกมยังรันได้ แต่เรื่องราวการผจญภัยจะใช้ข้อความเดิม"
    echo "   (รัน g4f / Ollama / LLM server ที่ OpenAI-compatible ไว้ที่ port ${LLM_PORT})"
    return 1
  fi
}

status() {
  echo "=== PomoQuest สถานะ ==="
  if pgrep -f "node server/index.js" >/dev/null 2>&1; then
    echo "✅ server: กำลังรัน (API ที่ http://localhost:${API_PORT})"
  else
    echo "⛔ server: ยังไม่รัน"
  fi
  if curl -s -m 2 -o /dev/null "http://localhost:${DEV_PORT}"; then
    echo "✅ frontend (dev): กำลังรันที่ http://localhost:${DEV_PORT}"
  else
    echo "⛔ frontend (dev): ยังไม่รัน"
  fi
  llm_check || true
}

case "${1:-dev}" in
  dev)
    echo "🚀 โหมดพัฒนา: server :${API_PORT} + frontend :${DEV_PORT} (http://localhost:${DEV_PORT})"
    echo "   (หยุดด้วย Ctrl+C)"
    npm run dev
    ;;
  prod)
    echo "🔨 build + รัน production ที่ http://localhost:${API_PORT}"
    npm run build
    npm start
    ;;
  start)
    echo "🔨 build + รัน production แบบ background…"
    npm run build
    nohup npm start > /tmp/pomoquest.log 2>&1 &
    echo "✅ รันแล้ว: http://localhost:${API_PORT}  (log: /tmp/pomoquest.log, หยุดด้วย ./run.sh stop)"
    ;;
  stop)
    if pkill -f "node server/index.js" 2>/dev/null; then
      echo "🛑 หยุด server แล้ว"
    else
      echo "ℹ️  ไม่มี server รันอยู่"
    fi
    ;;
  backup)
    mkdir -p backups
    dest="backups/pomoquest-$(date +%Y%m%d-%H%M%S).db"
    node scripts/backup-db.mjs backup "$dest"
    echo "   ดูไฟล์: ls backups/"
    ;;
  restore)
    src="${2:-}"
    if [[ -z "$src" ]]; then
      echo "📂 backup ที่มี (ล่าสุด 10):"
      ls -1t backups/*.db 2>/dev/null | head -10 || echo "   (ยังไม่มี backup — ใช้ ./run.sh backup ก่อน)"
      echo "วิธีใช้: ./run.sh restore backups/pomoquest-xxxxxxxx.db"
      exit 1
    fi
    [[ -f "$src" ]] || { echo "❌ ไม่พบไฟล์: $src" >&2; exit 1; }
    echo "⚠️  จะแทนที่ข้อมูลปัจจุบันด้วย $src — ข้อมูลที่ไม่ได้ backup จะหาย!"
    if [[ "${3:-}" != "-y" && "${3:-}" != "--yes" ]]; then
      read -r -p "พิมพ์ 'restore' เพื่อยืนยัน: " confirm
      [[ "$confirm" == "restore" ]] || { echo "🚫 ยกเลิก"; exit 1; }
    fi
    echo "🛑 หยุด server…"
    pkill -f "node server/index.js" 2>/dev/null || true
    sleep 1
    echo "♻️  กู้คืนจาก $src …"
    node scripts/backup-db.mjs restore "$src"
    echo "🔨 build + รันใหม่แบบ background…"
    npm run build
    nohup npm start > /tmp/pomoquest.log 2>&1 &
    echo "✅ restore เสร็จ: http://localhost:${API_PORT}  (log: /tmp/pomoquest.log)"
    ;;
  reset)
    echo "⚠️  RESET เกมทั้งหมด: จะลบตัวละคร/ไอเทม/ประวัติ session ทั้งหมด — กู้คืนไม่ได้!"
    if [[ "${2:-}" != "-y" && "${2:-}" != "--yes" ]]; then
      read -r -p "พิมพ์ 'reset' เพื่อยืนยัน: " confirm
      [[ "$confirm" == "reset" ]] || { echo "🚫 ยกเลิก"; exit 1; }
    fi
    echo "🛑 หยุด server…"
    pkill -f "node server/index.js" 2>/dev/null || true
    sleep 1
    echo "🗑️  ลบฐานข้อมูล…"
    rm -f server/data/pomoquest.db server/data/pomoquest.db-wal server/data/pomoquest.db-shm
    echo "🔨 build + รันใหม่แบบ background…"
    npm run build
    nohup npm start > /tmp/pomoquest.log 2>&1 &
    echo "✅ reset เสร็จ — ข้อมูลเริ่มต้นใหม่แล้ว: http://localhost:${API_PORT}  (log: /tmp/pomoquest.log)"
    ;;
  status)
    status
    ;;
  llm)
    llm_check
    ;;
  help | -h | --help)
    help
    ;;
  *)
    echo "ไม่รู้จักคำสั่ง: $1" >&2
    help
    exit 1
    ;;
esac
