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
import { authenticate, requireOwner, signToken } from '../http/middleware.js';
import { ctxOf } from '../http/context.js';
import { buildTagTree } from '../services/serialization.js';
import { createTag, listTags, mergeTags, suggestTags, updateTag } from '../services/tags.js';
import {
  acceptInvite,
  addExistingMemberByEmail,
  createInvite,
  listInvites,
  removeMember,
  requireUsableInvite,
  revokeInvite,
  setMemberRole,
} from '../services/members.js';
import { errors } from '../http/errors.js';

export const libraryRouter = Router();

// ---------------------------------------------------------------------------
// 接受 / 预览邀请：必须挂在成员回查（libraryRouter.use(authenticate())）之外，
// 因为被邀请人此时尚不是该库成员——他自己的 JWT 指向的是自己注册时创建的库。
// 这里仅要求"已登录"，库归属由邀请 token 自身决定。
// ---------------------------------------------------------------------------

const invitePreviewSchema = z.object({ token: z.string().min(10) });

/** 接受前预览：库名、邀请角色、过期时间、当前登录邮箱是否匹配（不泄露成员关系） */
libraryRouter.get(
  '/invites/:token',
  authenticate(),
  ah(async (req, res) => {
    const invite = requireUsableInvite(req.params.token);
    const library = getDb()
      .prepare('SELECT id, name FROM library WHERE id = ?')
      .get(invite.library_id) as { id: string; name: string };
    ok(res, {
      libraryName: library.name,
      role: invite.role,
      email: invite.email,
      expiresAt: invite.expires_at,
      matchesCurrentUser: String(req.auth!.email).trim().toLowerCase() === invite.email,
    });
  }),
);

/**
 * 接受邀请（幂等）：重复接受 / 已是成员 → alreadyJoined，不建第二条关系。
 * 成功后签发指向目标库的新 token：前端切换会话，后续请求的精确坐标/角色按新库计算。
 */
libraryRouter.post(
  '/invites/:token/accept',
  authenticate(),
  ah(async (req, res) => {
    invitePreviewSchema.shape.token.parse(req.params.token);
    const result = acceptInvite({
      token: req.params.token,
      userId: req.auth!.id,
      userEmail: req.auth!.email,
    });
    const library = getDb()
      .prepare('SELECT id, name, tz FROM library WHERE id = ?')
      .get(result.libraryId) as { id: string; name: string; tz: string };
    const user = {
      id: req.auth!.id,
      email: req.auth!.email,
      displayName: req.auth!.displayName,
      libraryId: result.libraryId,
      role: result.role,
    };
    ok(res, {
      alreadyJoined: result.alreadyJoined,
      role: result.role,
      library,
      token: signToken(user),
      user,
    });
  }),
);

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
        `SELECT m.role, u.id, u.email, u.display_name FROM library_member m
         JOIN "user" u ON u.id = m.user_id WHERE m.library_id = ?`,
      )
      .all(ctx.libraryId);
    // 邀请名单仅 owner 可见（含邮箱/角色，属于管理信息）
    const invites =
      ctx.role === 'owner'
        ? listInvites(ctx.libraryId).map((i) => ({
            id: i.id,
            email: i.email,
            role: i.role,
            status: i.status,
            token: i.token,
            expiresAt: i.expires_at,
            createdAt: i.created_at,
          }))
        : [];
    ok(res, { library, members, invites });
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

// ------------------------------------------------------------ invites（owner）

libraryRouter.post(
  '/library/invites',
  ah(async (req, res) => {
    requireOwner(req);
    const ctx = ctxOf(req);
    const input = z
      .object({
        email: z.string().email(),
        role: z.enum(['owner', 'member']).default('member'),
      })
      .parse(req.body);
    const { invite, reused } = createInvite({
      libraryId: ctx.libraryId,
      email: input.email,
      role: input.role,
      invitedBy: req.auth!.id,
    });
    ok(
      res,
      {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        token: invite.token,
        acceptUrl: `/invite/${invite.token}`,
        expiresAt: invite.expires_at,
        reused,
      },
      reused ? 200 : 201,
    );
  }),
);

libraryRouter.delete(
  '/library/invites/:id',
  ah(async (req, res) => {
    requireOwner(req);
    const ctx = ctxOf(req);
    revokeInvite(req.params.id, ctx.libraryId);
    // 撤销即时生效：接受接口每次重读 status，下一次接受即 410
    ok(res, { revoked: true });
  }),
);

// ------------------------------------------------------------ members（owner）

/** 兼容入口：owner 直接按邮箱把"已注册用户"加为成员（重复添加不建双关系） */
libraryRouter.post(
  '/library/members',
  ah(async (req, res) => {
    requireOwner(req);
    const ctx = ctxOf(req);
    const input = z.object({ email: z.string().email(), role: z.enum(['member']).default('member') }).parse(req.body);
    const result = addExistingMemberByEmail({ libraryId: ctx.libraryId, email: input.email });
    ok(
      res,
      { added: !result.alreadyMember, alreadyMember: result.alreadyMember, userId: result.userId },
      result.alreadyMember ? 200 : 201,
    );
  }),
);

/**
 * 角色调整。
 * member→owner 为授权扩大；owner→member 会即时撤销其历史有效分享；
 * 最后一个 owner 不允许降级（服务层红线）。
 */
libraryRouter.patch(
  '/library/members/:userId/role',
  ah(async (req, res) => {
    requireOwner(req);
    const ctx = ctxOf(req);
    const { role } = z.object({ role: z.enum(['owner', 'member']) }).parse(req.body);
    const result = setMemberRole({ libraryId: ctx.libraryId, targetUserId: req.params.userId, role });
    // 角色即时生效：被调整者的下一个请求由鉴权回查到新 role，精确坐标/分享能力立刻变化
    ok(res, { role, ...result });
  }),
);

libraryRouter.delete(
  '/library/members/:userId',
  ah(async (req, res) => {
    requireOwner(req);
    const ctx = ctxOf(req);
    // 最后一个 owner 不可移除；移除即时作废其旧 token（鉴权回查）与历史分享
    const result = removeMember(ctx.libraryId, req.params.userId);
    ok(res, { removed: true, ...result });
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
