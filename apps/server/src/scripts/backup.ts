import { createBackup, listBackups } from '../services/backup.js';
import { ensureDirs } from '../config.js';

ensureDirs();
const info = await createBackup();
process.stdout.write(
  `备份完成：${info.name}\n  路径：${info.path}\n  大小：${(info.bytes / 1024).toFixed(1)} KB\n  现有备份 ${listBackups().length} 份\n`,
);
