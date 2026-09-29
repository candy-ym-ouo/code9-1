import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db.js';
import { exportAll } from '../services/backup.js';
import { config } from '../config.js';

const db = getDb();
const libraryId = process.argv[2] ?? (db.prepare('SELECT id FROM library LIMIT 1').get() as { id?: string } | undefined)?.id;
if (!libraryId) {
  process.stderr.write('没有可导出的库（请先注册账号）\n');
  process.exit(1);
}
const target = path.join(config.backupDir, `export-${libraryId}-${Date.now()}.json`);
fs.mkdirSync(config.backupDir, { recursive: true });
fs.writeFileSync(target, JSON.stringify(exportAll(libraryId), null, 2));
process.stdout.write(`已导出（含精确坐标，仅限本机自持）：${target}\n`);
