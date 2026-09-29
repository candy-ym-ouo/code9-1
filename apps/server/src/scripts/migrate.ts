import { migrate } from '../db.js';
import { ensureDirs } from '../config.js';
import { baselineTagCount, businessDataCounts, ensureBaselineTags } from '../seed/baseline.js';
import { getDb } from '../db.js';

ensureDirs();
const applied = migrate();
const db = getDb();
const libraries = db.prepare('SELECT id FROM library').all() as { id: string }[];
let inserted = 0;
for (const lib of libraries) inserted += ensureBaselineTags(lib.id).inserted;

process.stdout.write(
  [
    applied.length ? `已应用迁移：${applied.join(', ')}` : '迁移已是最新（无变更）',
    `数据库：${db.name}`,
    `库数量：${libraries.length}；本次写入基线标签：${inserted}`,
    `基线标签总量（每个库）：${baselineTagCount().total}`,
    `业务数据（未创建账号时应全为 0）：${JSON.stringify(businessDataCounts())}`,
    '',
  ].join('\n'),
);
