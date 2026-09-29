import fs from 'node:fs';
import { config, ensureDirs } from '../config.js';
import { migrate } from '../db.js';

/** 重置数据库与图片目录（破坏性操作，仅用于开发调试） */
ensureDirs();
for (const file of [config.databaseFile, `${config.databaseFile}-wal`, `${config.databaseFile}-shm`]) {
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
}
for (const dir of [config.uploadDir, config.thumbDir, config.shareDir]) {
  fs.rmSync(dir, { recursive: true, force: true });
}
ensureDirs();
const applied = migrate();
process.stdout.write(`已重置。应用的迁移：${applied.join(', ')}\n`);
