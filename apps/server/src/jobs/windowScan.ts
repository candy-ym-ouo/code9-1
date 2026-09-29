import { getDb } from '../db.js';
import { logger } from '../logger.js';
import { computeWindowsForInspiration } from '../services/windowEngine.js';

/** 全库未来窗口重算：预报刷新后，判定必须随之刷新（文档 12.7 R3 的数据来源） */
export async function scanWindowsForAllLibraries(days = 7): Promise<{ libraries: number; cards: number }> {
  const db = getDb();
  const libraries = db.prepare('SELECT id FROM library').all() as { id: string }[];
  let cards = 0;

  for (const lib of libraries) {
    const rows = db
      .prepare(
        `SELECT i.id FROM inspiration i
         JOIN timing t ON t.inspiration_id = i.id
         WHERE i.library_id = ? AND i.spot_id IS NOT NULL AND i.deleted_at IS NULL
           AND i.status NOT IN ('archived','dropped')`,
      )
      .all(lib.id) as { id: string }[];
    for (const row of rows) {
      try {
        await computeWindowsForInspiration(row.id, { days });
        cards += 1;
      } catch (err) {
        logger.warn('单卡窗口计算失败', { inspirationId: row.id, error: String(err) });
      }
    }
  }

  const started = new Date().toISOString();
  db.prepare('INSERT INTO job_run (id, name, started_at, finished_at, ok, message) VALUES (?,?,?,?,?,?)').run(
    `job${Date.now().toString(36)}`,
    'windowScan',
    started,
    new Date().toISOString(),
    1,
    `libraries=${libraries.length} cards=${cards}`,
  );

  logger.info('窗口扫描完成', { libraries: libraries.length, cards });
  return { libraries: libraries.length, cards };
}
