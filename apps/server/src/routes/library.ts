import { Router } from 'express';
import { z } from 'zod';
import {
  FUZZ_LEVEL_LABEL,
  MISS_REASON_LABEL,
  TAG_DOMAIN_LABEL,
  TIME_ANCHORS,
  TIME_ANCHOR_LABEL,
  WEATHER_PRESETS,
  createTagSchema,
  updateTagSchema,
} from '@flil/shared';
import { getDb, nowIso } from '../db.js';
import { ah, ok } from '../http/respond.js';
import { authenticate, currentUser, requireOwner } from '../http/middleware.js';
import { ctxOf } from '../http/context.js';
import { buildTagTree } from '../services/serialization.js';
import { createTag, listTags, mergeTags, suggestTags, updateTag } from '../services/tags.js';
import {
  addExistingUserAsMember,
  createInvitation,
  listInvitations,
  removeMember,
  revokeInvitation,
  setMemberRole,
} from '../services/members.js';
import { errors } from '../http/errors.js';

export const libraryRouter = Router();

libraryRouter.use(authenticate());

libraryRouter.get(
  '/library',
  ah(async (req, res) => {
    const ctx = ctxOf(req);
    const library = getDb()
      .prepare('SELECT id, name, tz, default_fuzz_level, created_at FROM library WHERE id = ?')
      .get(ctx.libraryId);
    const members = getDb()
      .prepare(
        `SELECT m.role, m.created_at, u.id, u.email, u.display_name FROM library_member m
         JOIN "user" u ON u.id = m.user_id WHERE m.library_id = ?
         ORDER BY m.role = 'owner' DESC, m.created_at ASC`,
      )
      .all(ctx.libraryId);
    // 邀请列表仅对 owner 暴露（协作者无需看到待入成员的邮箱）
    const invitations =
      currentUser(req).role === 'owner'
        ? listInvitations(ctx.libraryId).map((i) => ({
            id: i.id,
            email: i.email,
            role: i.role,
            status: i.status,
            expiresAt: i.expires_at,
            createdAt: i.created_at,
          }))
        : [];
    ok(res, { library, members, invitations });
  }),
);

libraryRouter.patch(
  '/library',
  ah(async (req, res) => {
    requireOwner(req);
    const ctx = ctxOf(req);
    const input = z
      .object({
        name: z.string().min(1).max(120).optional(),
        tz: z.string().max(64).optional(),
        defaultFuzzLevel: z
          .enum(['exact', 'g100', 'g500', 'g1k', 'neighborhood', 'district'])
          .optional(),
      })
      .parse(req.body);
    const db = getDb();
    if (input.name) db.prepare('UPDATE library SET name = ?, updated_at = ? WHERE id = ?').run(input.name, nowIso(), ctx.libraryId);
    if (input.tz) db.prepare('UPDATE library SET tz = ?, updated_at = ? WHERE id = ?').run(input.tz, nowIso(), ctx.libraryId);
    if (input.defaultFuzzLevel) {
      // 库级默认是"对外默认"，不允许设为精确级别（安全底线：强制降级并告知）
      const level =
        input.defaultFuzzLevel === 'exact' || input.defaultFuzzLevel === 'g100'
          ? 'g500'
          : input.defaultFuzzLevel;
      db.prepare('UPDATE library SET default_fuzz_level = ?, updated_at = ? WHERE id = ?').run(
        level,
        nowIso(),
        ctx.libraryId,
      );
      ok(res, { updated: true, defaultFuzzLevel: level, downgraded: level !== input.defaultFuzzLevel });
      return;
    }
    ok(res, { updated: true });
  }),
);

// ------------------------------------------------------------ 邀请与成员

const invitationCreateSchema = z.object({
  email: z.string().email(),
  role: z.enum(['owner', 'member']).default('member'),
  expiresInDays: z.number().int().min(1).max(180).optional(),
});

/**
 * 创建邀请。明文令牌只在响应中出现一次（库存哈希），调用方负责转给受邀人。
 * 重发同一邮箱：旧待接受邀请被顶替（replaced），旧令牌即时失效，不产生两条待处理邀请。
 */
libraryRouter.post(
  '/library/invitations',
  ah(async (req, res) => {
    requireOwner(req);
    const ctx = ctxOf(req);
    const input = invitationCreateSchema.parse(req.body);
    const created = createInvitation({
      libraryId: ctx.libraryId,
      email: input.email,
      role: input.role,
      invitedBy: currentUser(req).id,
      expiresInDays: input.expiresInDays,
    });
    ok(
      res,
      {
        id: created.row.id,
        email: created.row.email,
        role: created.row.role,
        status: created.row.status,
        expiresAt: created.row.expires_at,
        url: `/accept-invite/${created.token}`,
        token: created.token,
        replaced: created.replaced,
      },
      201,
    );
  }),
);

/** 撤销邀请：旧令牌立即不可用 */
libraryRouter.post(
  '/library/invitations/:id/revoke',
  ah(async (req, res) => {
    requireOwner(req);
    const ctx = ctxOf(req);
    revokeInvitation(req.params.id, ctx.libraryId);
    ok(res, { revoked: true });
  }),
);

/** 调整成员角色（owner ↔ member）；降级最后所有者被拒，变更即时生效 */
libraryRouter.patch(
  '/library/members/:userId/role',
  ah(async (req, res) => {
    requireOwner(req);
    const ctx = ctxOf(req);
    const { role } = z.object({ role: z.enum(['owner', 'member']) }).parse(req.body);
    const result = setMemberRole(ctx.libraryId, req.params.userId, role);
    ok(res, { updated: result.changed, role, revokedShares: result.revokedShares });
  }),
);

libraryRouter.post(
  '/library/members',
  ah(async (req, res) => {
    requireOwner(req);
    const ctx = ctxOf(req);
    // 兼容旧用法：直接把已注册用户加入库（新流程应走 /library/invitations）。
    // 成员关系有 UNIQUE 约束：重复加入不会建双关系。
    const input = z.object({ email: z.string().email(), role: z.enum(['member']).default('member') }).parse(req.body);
    const result = addExistingUserAsMember(ctx.libraryId, input.email, input.role);
    ok(res, { added: result.added }, 201);
  }),
);

/** 移除成员：owner 不可移除；其历史分享链接同步即时撤销，旧 JWT 下次请求即 401 */
libraryRouter.delete(
  '/library/members/:userId',
  ah(async (req, res) => {
    requireOwner(req);
    const ctx = ctxOf(req);
    const result = removeMember(ctx.libraryId, req.params.userId);
    ok(res, { removed: true, revokedShares: result.revokedShares });
  }),
);

/** 元数据：前端下拉与文案的唯一来源（避免前后端口径漂移） */
libraryRouter.get(
  '/meta',
  ah(async (_req, res) => {
    ok(res, {
      tagDomains: Object.entries(TAG_DOMAIN_LABEL).map(([key, label]) => ({ key, label })),
      timeAnchors: TIME_ANCHORS.map((key) => ({ key, label: TIME_ANCHOR_LABEL[key] })),
      weatherPresets: WEATHER_PRESETS,
      fuzzLevels: Object.entries(FUZZ_LEVEL_LABEL).map(([key, label]) => ({ key, label })),
      missReasons: Object.entries(MISS_REASON_LABEL).map(([key, label]) => ({ key, label })),
    });
  }),
);

// ------------------------------------------------------------------ tags

libraryRouter.get(
  '/tags',
  ah(async (req, res) => {
    const ctx = ctxOf(req);
    const includeDisabled = req.query.includeDisabled === 'true';
    ok(res, { items: buildTagTree(listTags(ctx.libraryId, includeDisabled)) });
  }),
);

libraryRouter.post(
  '/tags',
  ah(async (req, res) => {
    const ctx = ctxOf(req);
    const input = createTagSchema.parse(req.body);
    const id = createTag({
      libraryId: ctx.libraryId,
      domain: input.domain,
      name: input.name,
      parentId: input.parentId ?? null,
    });
    ok(res, { id }, 201);
  }),
);

libraryRouter.patch(
  '/tags/:id',
  ah(async (req, res) => {
    const ctx = ctxOf(req);
    updateTag(req.params.id, ctx.libraryId, updateTagSchema.parse(req.body));
    ok(res, { updated: true });
  }),
);

libraryRouter.post(
  '/tags/:id/merge',
  ah(async (req, res) => {
    const ctx = ctxOf(req);
    const { targetId } = z.object({ targetId: z.string().min(1) }).parse(req.body);
    mergeTags(req.params.id, targetId, ctx.libraryId);
    ok(res, { merged: true });
  }),
);

libraryRouter.get(
  '/tags/suggest',
  ah(async (req, res) => {
    const ctx = ctxOf(req);
    const tagIds = String(req.query.tagIds ?? '')
      .split(',')
      .filter(Boolean);
    const limit = Math.min(20, Number(req.query.limit ?? 8));
    ok(res, { items: suggestTags(ctx.libraryId, tagIds, limit) });
  }),
);
