import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { loginSchema, registerSchema, type AuthUser } from '@flil/shared';
import { getDb, newId, nowIso } from '../db.js';
import { errors } from '../http/errors.js';
import { ah, ok } from '../http/respond.js';
import { authenticate, rateLimit, signToken } from '../http/middleware.js';
import { ensureBaselineTags } from '../seed/baseline.js';

export const authRouter = Router();

authRouter.post(
  '/auth/register',
  rateLimit('register', 10, 60000),
  ah(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const db = getDb();

    const existing = db.prepare('SELECT id FROM "user" WHERE email = ?').get(input.email);
    if (existing) throw errors.badRequest('该邮箱已注册');

    const userId = newId();
    const libraryId = newId();
    const ts = nowIso();
    const tz = input.tz ?? 'Asia/Shanghai';

    const run = db.transaction(() => {
      db.prepare(
        'INSERT INTO "user" (id, email, password_hash, display_name, timezone, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
      ).run(userId, input.email, bcrypt.hashSync(input.password, 10), input.displayName, tz, ts, ts);
      db.prepare(
        'INSERT INTO library (id, name, owner_id, default_fuzz_level, tz, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
      ).run(libraryId, input.libraryName ?? `${input.displayName} 的取景灵感库`, userId, 'g500', tz, ts, ts);
      db.prepare('INSERT INTO library_member (id, library_id, user_id, role, created_at) VALUES (?,?,?,?,?)').run(
        newId(),
        libraryId,
        userId,
        'owner',
        ts,
      );
      db.prepare(
        "INSERT INTO notification_channel (id, library_id, kind, target, enabled, quiet_hours, daily_digest_hour, created_at, updated_at) VALUES (?,?, 'sse', NULL, 1, ?, 8, ?, ?)",
      ).run(newId(), libraryId, '22:00-07:00', ts, ts);
    });
    run();

    // 基线标签随库创建写入（seed 也可再次执行，幂等）
    ensureBaselineTags(libraryId);

    const user: AuthUser = {
      id: userId,
      email: input.email,
      displayName: input.displayName,
      libraryId,
      role: 'owner',
    };
    ok(res, { token: signToken(user), user }, 201);
  }),
);

authRouter.post(
  '/auth/login',
  rateLimit('login', 10, 60000),
  ah(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const db = getDb();
    const row = db.prepare('SELECT * FROM "user" WHERE email = ?').get(input.email) as
      | { id: string; email: string; password_hash: string; display_name: string }
      | undefined;
    if (!row || !bcrypt.compareSync(input.password, row.password_hash)) {
      throw errors.authRequired();
    }
    const member = db
      .prepare('SELECT library_id, role FROM library_member WHERE user_id = ? LIMIT 1')
      .get(row.id) as { library_id: string; role: 'owner' | 'member' } | undefined;
    if (!member) throw errors.notFound('库');

    const user: AuthUser = {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      libraryId: member.library_id,
      role: member.role,
    };
    ok(res, { token: signToken(user), user });
  }),
);

authRouter.get(
  '/auth/me',
  authenticate(),
  ah(async (req, res) => {
    const user = req.auth as AuthUser;
    const library = getDb()
      .prepare('SELECT id, name, tz, default_fuzz_level FROM library WHERE id = ?')
      .get(user.libraryId);
    ok(res, { user, library });
  }),
);

export { randomUUID };
