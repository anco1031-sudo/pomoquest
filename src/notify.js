// src/notify.js — แจ้งเตือนเบราว์เซอร์ (Web Notifications API)
// ใช้ตอนจบ session / พักหมด / สู้บอส — เด้งเป็น notification ของระบบปฏิบัติการ
// แจ้งเฉพาะตอนแท็บอยู่เบื้องหลัง (กำลังมองแอพอยู่จะเห็นหน้าจอเอง ไม่ต้องแจ้งซ้ำ)
const ICON = '/icon-192.png';
const KEY = 'pomoquest-notify'; // สวิตช์เปิด/ปิดในแท็บตั้งค่า (ค่า default = เปิด)

export const isNotifyEnabled = () => {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
};

export const setNotifyEnabled = (v) => {
  try {
    localStorage.setItem(KEY, v ? '1' : '0');
  } catch { /* ignore */ }
};

export const canNotify = () => {
  try {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted';
  } catch {
    return false;
  }
};

// ขออนุญาตแจ้งเตือน (เบราว์เซอร์จะโชว์ prompt เอง) — คืน true ถ้าอนุญาต
// เรียกซ้ำกี่ครั้งก็ได้ — ถ้า grant/deny ไปแล้วจะ return ทันที
// ข้ามถ้าสวิตช์ในตั้งค่าปิดอยู่
export const requestNotifyPermission = async () => {
  try {
    if (!isNotifyEnabled()) return false;
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const p = await Notification.requestPermission();
    return p === 'granted';
  } catch {
    return false;
  }
};

// ส่ง notification — เงียบถ้า: สวิตช์ปิด / ไม่รองรับ / ไม่ได้อนุญาต / แท็บอยู่ foreground
export const notify = (title, body) => {
  try {
    if (!isNotifyEnabled()) return;
    if (typeof Notification === 'undefined') return;
    if (typeof document !== 'undefined' && !document.hidden) return;
    if (Notification.permission !== 'granted') return;
    const n = new Notification(title, { body, icon: ICON, badge: ICON });
    n.onclick = () => {
      try {
        window.focus();
        n.close();
      } catch { /* ignore */ }
    };
  } catch {
    /* ไม่รองรับ / ถูกบล็อก — ข้ามไป */
  }
};
