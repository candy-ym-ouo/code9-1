import { migrate } from '../db.js';
import { ensureDirs } from '../config.js';
import { getDb } from '../db.js';
import { baselineTagCount, businessDataCounts, ensureBaselineTags } from './baseline.js';
import { WEATHER_PRESETS, TIME_ANCHORS, FUZZ_LEVEL_LABEL, MISS_REASON_LABEL } from '@flil/shared';

export function seed(): void {
  ensureDirs();
  const ran = migrate();
  const db = getDb();

  const libraries = db.prepare('SELECT id, name FROM library').all() as { id: string; name: string }[];
  let inserted = 0;
  for (const lib of libraries) {
    inserted += ensureBaselineTags(lib.id).inserted;
  }

  const counts = baselineTagCount();
  const business = businessDataCounts();

  process.stdout.write(
    [
      `migrations applied: ${ran.length ? ran.join(', ') : '(none)'}`,
      `libraries: ${libraries.length}`,
      `baseline tags inserted: ${inserted}`,
      `baseline per domain: ${JSON.stringify(counts.byDomain)}  total=${counts.total}`,
      `time anchors: ${TIME_ANCHORS.length}`,
      `weather presets: ${WEATHER_PRESETS.length}`,
      `fuzz levels: ${Object.keys(FUZZ_LEVEL_LABEL).length}`,
      `miss reasons: ${Object.keys(MISS_REASON_LABEL).length}`,
      `business data (must be 0 on fresh install): ${JSON.stringify(business)}`,
      libraries.length === 0
        ? '提示：当前还没有账号/库。基线标签会在注册第一个账号时自动写入，之后也可再次运行 db:seed。'
        : '完成：基线标签已就绪（不含任何虚构的灵感卡、机位、画册）。',
      '',
    ].join('\n'),
  );
}

seed();
