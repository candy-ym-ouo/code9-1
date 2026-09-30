import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { loginSchema, registerSchema, type AuthUser } from '@flil/shared';
import { getDb, newId, nowIso } from '../db.js';
import { errors } from '../http/errors.js';
import { ah, ok } from '../http/respond.js';
import { authenticate, rateLimit, signToken } from '../http/middleware.js';
import { ensureBaselineTags } from '../seed/baseline.js';
import { acceptInvitation, listPendingInvitationsForUser } from '../services/members.js';

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
    // 单一活动库语义：取最近加入的成员关系（接受邀请加入的库排在自建库之后）
    const member = db
      .prepare('SELECT library_id, role FROM library_member WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
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

/** 当前用户的待处理邀请（登录后横幅提示用） */
authRouter.get(
  '/auth/invitations',
  authenticate(),
  ah(async (req, res) => {
    const user = req.auth as AuthUser;
    ok(res, {
      items: listPendingInvitationsForUser(user.id, user.email).map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        libraryName: i.library_name,
        expiresAt: i.expires_at,
        createdAt: i.created_at,
      })),
    });
  }),
);

/**
 * 接受邀请（需登录）。
 * - 仅受邀邮箱本人可接受（防令牌转交）；
 * - 重复接受幂等：已是成员则不建双关系，返回 already:true；
 * - 成功后签发指向受邀库的新 token，角色/精确坐标权限当场切换。
 */
authRouter.post(
  '/auth/invitations/:token/accept',
  rateLimit('invite-accept', 20, 60000),
  authenticate(),
  ah(async (req, res) => {
    const current = req.auth as AuthUser;
    const result = acceptInvitation(req.params.token, { id: current.id, email: current.email });
    const libraryRow = getDb()
      .prepare('SELECT id, name, tz FROM library WHERE id = ?')
      .get(result.invitation.library_id) as { id: string; name: string; tz: string } | undefined;
    if (!libraryRow) throw errors.notFound('库');

    const user: AuthUser = {
      id: current.id,
      email: current.email,
      displayName: current.displayName,
      libraryId: libraryRow.id,
      role: result.role,
    };
    ok(res, {
      token: signToken(user),
      user,
      library: libraryRow,
      already: result.already,
    });
  }),
);

export { randomUUID };
