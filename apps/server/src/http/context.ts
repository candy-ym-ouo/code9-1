import type { Request } from 'express';
import { getDb } from '../db.js';
import { config } from '../config.js';
import { errors } from './errors.js';
import { currentUser } from './middleware.js';
import type { SerializeContext } from '../services/serialization.js';

export function libraryTz(libraryId: string): string {
  const row = getDb().prepare('SELECT tz FROM library WHERE id = ?').get(libraryId) as { tz: string } | undefined;
  return row?.tz ?? config.tz;
}

export function ctxOf(req: Request, opts: { includePrecise?: boolean } = {}): SerializeContext {
  const user = currentUser(req);
  const row = getDb()
    .prepare('SELECT default_fuzz_level FROM library WHERE id = ?')
    .get(user.libraryId) as { default_fuzz_level: string } | undefined;
  if (!row) throw errors.notFound('库');
  return {
    libraryId: user.libraryId,
    role: user.role,
    defaultFuzzLevel: (row.default_fuzz_level as SerializeContext['defaultFuzzLevel']) ?? config.defaultFuzzLevel,
    includePrecise: opts.includePrecise === true && user.role === 'owner',
  };
}
