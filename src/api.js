async function request(method, path, body, extraHeaders = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง');
  return data;
}

export const apiGet = (path) => request('GET', path);
export const apiPost = (path, body) => request('POST', path, body);
export const apiPut = (path, body) => request('PUT', path, body);

// dev test — ส่ง token จาก localStorage ด้วย (ดู server/dev.js)
export const apiDevPost = (path, body) =>
  request('POST', path, body, { 'x-dev-token': localStorage.getItem('pomoquest-dev-token') || '' });
