import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import routes from './routes.js';
import devRoutes from './dev.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

app.use('/api', routes);
app.use('/api', devRoutes); // dev test (login: admin/admin)

// เสิร์ฟ frontend ที่ build แล้ว (production)
const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.join(distDir, 'index.html'));
    }
    next();
  });
} else {
  app.get('/', (req, res) => res.send('PomoQuest server ทำงานอยู่ — รัน `npm run dev` เพื่อเปิด frontend'));
}

app.listen(PORT, () => {
  console.log(`⚔️ PomoQuest server พร้อมใช้งานที่ http://localhost:${PORT}`);
});
