interface LogFields {
  [key: string]: unknown;
}

/**
 * 结构化日志。**禁止写入精确坐标**（文档 13.3）：这里统一过滤敏感键。
 */
const SENSITIVE_KEYS = /^(lat|lng|latitude|longitude|preciseLat|preciseLng|password|passwordHash|token)$/i;

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.test(k) ? '[redacted]' : sanitize(v, depth + 1);
  }
  return out;
}

function emit(level: string, msg: string, fields?: LogFields): void {
  if (process.env.LOG_SILENT === 'true') return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...(fields ? (sanitize(fields) as LogFields) : {}),
  });
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger = {
  info: (msg: string, fields?: LogFields) => emit('info', msg, fields),
  warn: (msg: string, fields?: LogFields) => emit('warn', msg, fields),
  error: (msg: string, fields?: LogFields) => emit('error', msg, fields),
  debug: (msg: string, fields?: LogFields) => {
    if (process.env.LOG_LEVEL === 'debug') emit('debug', msg, fields);
  },
};
