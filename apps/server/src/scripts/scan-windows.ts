import { migrate } from '../db.js';
import { scanWindowsForAllLibraries } from '../jobs/windowScan.js';

migrate();
const days = Number(process.argv[2] ?? 7);
const result = await scanWindowsForAllLibraries(days);
process.stdout.write(`窗口扫描完成：库 ${result.libraries} 个，卡片 ${result.cards} 张（未来 ${days} 天）\n`);
