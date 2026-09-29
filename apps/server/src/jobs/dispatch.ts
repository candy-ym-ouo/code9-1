import { getDb } from '../db.js';
import { logger } from '../logger.js';
import { dispatchReminders, evaluateRules } from '../services/reminders.js';

export async function dispatchForAllLibraries(opts: { evaluate: boolean } = { evaluate: true }): Promise<{
  libraries: number;
  created: number;
  notified: number;
  expired: number;
}> {
  const db = getDb();
  const libraries = db.prepare('SELECT id FROM library').all() as { id: string }[];
  let created = 0;
  let notified = 0;
  let expired = 0;

  for (const lib of libraries) {
    try {
      if (opts.evaluate) created += evaluateRules(lib.id).created;
      const result = await dispatchReminders(lib.id);
      notified += result.notified;
      expired += result.expired;
    } catch (err) {
      logger.warn('单库提醒处理失败', { libraryId: lib.id, error: String(err) });
    }
  }

  logger.info('提醒派发完成', { libraries: libraries.length, created, notified, expired });
  return { libraries: libraries.length, created, notified, expired };
}
