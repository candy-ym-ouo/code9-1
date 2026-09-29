import { migrate } from '../db.js';
import { dispatchForAllLibraries } from '../jobs/dispatch.js';

migrate();
const result = await dispatchForAllLibraries({ evaluate: true });
process.stdout.write(
  `提醒派发完成：库 ${result.libraries} 个，新生成 ${result.created} 条，已通知 ${result.notified} 条，过期 ${result.expired} 条\n`,
);
