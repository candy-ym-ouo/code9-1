import crypto from 'node:crypto';
import { getDb, newId, nowIso } from '../db.js';
import { config } from '../config.js';
import { errors } from '../http/errors.js';
import { revokeShareLinksByCreator } from './share.js';

export type MemberRole = 'owner' | 'member';

export interface InvitationRow {
  id: string;
  library_id: string;
  email: string;
  role: MemberRole;
  token_hash: string;
  status: 'pending' | 'accepted' | 'revoked' | 'replaced';
  expires_at: string;
  accepted_at: string | null;
  accepted_user: string | null;
  invited_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreatedInvitation {
  row: InvitationRow;
  /** 明文令牌仅在创建/重发时返回这一次；库里只存哈希 */
  token: string;
  /** 此前是否有一条被顶替的待接受邀请（其旧令牌已即时失效） */
  replaced: boolean;
}

export function hashInvitationToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function findUserByEmail(email: string): { id: string } | undefined {
  return getDb()
    .prepare('SELECT id FROM "user" WHERE lower(email) = lower(?)')
    .get(email) as { id: string } | undefined;
}

function getMember(libraryId: string, userId: string): { role: MemberRole } | undefined {
  return getDb()
    .prepare('SELECT role FROM library_member WHERE library_id = ? AND user_id = ?')
    .get(libraryId, userId) as { role: MemberRole } | undefined;
}

function ownerCount(libraryId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM library_member WHERE library_id = ? AND role = 'owner'")
    .get(libraryId) as { n: number };
  return row.n;
}

/**
 * 创建（或重发）邀请。
 * - 已是成员 → 409（邀请不允许覆盖现有关系）；
 * - 同一邮箱已有待接受邀请 → 旧条目标记 replaced，旧令牌立刻失效（幂等地"重发"）。
 */
export function createInvitation(params: {
  libraryId: string;
  email: string;
  role: MemberRole;
  invitedBy: string;
  expiresInDays?: number;
}): CreatedInvitation {
  const db = getDb();
  const email = params.email.trim().toLowerCase();
  if (findUserByEmail(email) && getMember(params.libraryId, findUserByEmail(email)!.id)) {
    throw errors.invitationAlreadyMember();
  }

  const token = crypto.randomBytes(24).toString('base64url');
  const tokenHash = hashInvitationToken(token);
  const days = Math.min(Math.max(1, params.expiresInDays ?? 7), config.shareMaxExpireDays);
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
  const id = newId();
  const ts = nowIso();

  let replaced = false;
  const run = db.transaction(() => {
    const prior = db
      .prepare(
        `SELECT id FROM library_invitation
         WHERE library_id = ? AND lower(email) = ? AND status = 'pending'`,
      )
      .get(params.libraryId, email) as { id: string } | undefined;
    if (prior) {
      db.prepare(
        `UPDATE library_invitation SET status = 'replaced', updated_at = ? WHERE id = ? AND status = 'pending'`,
      ).run(ts, prior.id);
      replaced = true;
    }
    db.prepare(
      `INSERT INTO library_invitation
         (id, library_id, email, role, token_hash, status, expires_at, invited_by, created_at, updated_at)
       VALUES (?,?,?,?,?, 'pending', ?,?,?,?)`,
    ).run(id, params.libraryId, email, params.role, tokenHash, expiresAt, params.invitedBy, ts, ts);
  });
  run();

  return { row: db.prepare('SELECT * FROM library_invitation WHERE id = ?').get(id) as InvitationRow, token, replaced };
}

/** 按明文令牌取邀请（不校验归属） */
export function findInvitationByToken(token: string): InvitationRow | undefined {
  return getDb()
    .prepare('SELECT * FROM library_invitation WHERE token_hash = ?')
    .get(hashInvitationToken(token)) as InvitationRow | undefined;
}

/**
 * 接受邀请。事务 + 成员唯一约束保证：**重复接受绝不建立第二条成员关系**。
 * 返回 already: true 表示此前已接受过（幂等响应，不报错、不插数据）。
 */
export function acceptInvitation(
  token: string,
  user: { id: string; email: string },
): { invitation: InvitationRow; role: MemberRole; already: boolean } {
  const db = getDb();
  const invitation = findInvitationByToken(token);
  if (!invitation) throw errors.invitationInvalid();
  if (invitation.email !== user.email.trim().toLowerCase()) throw errors.invitationEmailMismatch();

  const existing = getMember(invitation.library_id, user.id);
  if (existing) {
    // 已在库中（无论邀请是 pending 还是 accepted）：不重复建关系
    if (invitation.status === 'pending') {
      db.prepare(
        `UPDATE library_invitation SET status = 'accepted', accepted_at = ?, accepted_user = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      ).run(nowIso(), user.id, nowIso(), invitation.id);
    }
    return { invitation, role: existing.role, already: true };
  }

  if (invitation.status !== 'pending') throw errors.invitationNotPending();
  if (new Date(invitation.expires_at).getTime() < Date.now()) throw errors.invitationExpired();

  const run = db.transaction(() => {
    // 条件更新：只有仍处于 pending 才能消费；并发下只有一次能改成功
    const consumed = db
      .prepare(
        `UPDATE library_invitation
           SET status = 'accepted', accepted_at = ?, accepted_user = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(nowIso(), user.id, nowIso(), invitation.id);
    if (consumed.changes === 0) throw errors.invitationNotPending();
    // UNIQUE(library_id, user_id) + DO NOTHING：双保险，不建双关系
    db.prepare(
      `INSERT INTO library_member (id, library_id, user_id, role, created_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT (library_id, user_id) DO NOTHING`,
    ).run(newId(), invitation.library_id, user.id, invitation.role, nowIso());
  });
  run();

  return {
    invitation: db.prepare('SELECT * FROM library_invitation WHERE id = ?').get(invitation.id) as InvitationRow,
    role: invitation.role,
    already: false,
  };
}

/** 撤销邀请：旧令牌下一次使用即失效（每次接受都现查状态，无缓存） */
export function revokeInvitation(id: string, libraryId: string): void {
  const res = getDb()
    .prepare(
      `UPDATE library_invitation SET status = 'revoked', updated_at = ?
       WHERE id = ? AND library_id = ? AND status = 'pending'`,
    )
    .run(nowIso(), id, libraryId);
  if (res.changes === 0) throw errors.notFound('待处理的邀请');
}

export function listInvitations(libraryId: string): InvitationRow[] {
  return getDb()
    .prepare('SELECT * FROM library_invitation WHERE library_id = ? ORDER BY created_at DESC')
    .all(libraryId) as InvitationRow[];
}

/** 当前用户的待处理邀请（登录后用于横幅/弹窗提示）；令牌绝不出现在列表中 */
export function listPendingInvitationsForUser(
  userId: string,
  email: string,
): (InvitationRow & { library_name: string })[] {
  return getDb()
    .prepare(
      `SELECT i.*, l.name AS library_name FROM library_invitation i
       JOIN library l ON l.id = i.library_id
       LEFT JOIN library_member m ON m.library_id = i.library_id AND m.user_id = ?
       WHERE lower(i.email) = lower(?) AND i.status = 'pending' AND i.expires_at > ? AND m.id IS NULL
       ORDER BY i.created_at DESC`,
    )
    .all(userId, email, nowIso()) as (InvitationRow & { library_name: string })[];
}

/**
 * 调整成员角色。
 * 降级 owner → member 时，若对方是最后一个 owner 则拒绝；
 * 降级意味着精确坐标访问权即时收回，且其创建的历史分享链接全部即时撤销。
 */
export function setMemberRole(libraryId: string, userId: string, role: MemberRole): {
  changed: boolean;
  revokedShares: number;
} {
  const db = getDb();
  const target = getMember(libraryId, userId);
  if (!target) throw errors.notFound('成员');
  if (target.role === role) return { changed: false, revokedShares: 0 };
  if (target.role === 'owner' && role === 'member' && ownerCount(libraryId) <= 1) {
    throw errors.lastOwner();
  }

  const run = db.transaction(() => {
    db.prepare('UPDATE library_member SET role = ? WHERE library_id = ? AND user_id = ?').run(
      role,
      libraryId,
      userId,
    );
    // 角色调整即信任边界变化：当事人开过的历史口子（含图片令牌）同步即时失效。
    // 升级为 owner 同样撤销——之前以 member 身份发出的链接不应在提权后继续代表新身份存在。
    return revokeShareLinksByCreator(libraryId, userId);
  });
  return { changed: true, revokedShares: run() };
}

/**
 * 移除成员。owner 不可移除（且最后所有者由 owner 计数兜底保护）。
 * 移除即失去一切库访问权（旧 JWT 下次请求现查成员表即 401），
 * 其创建的历史分享链接全部即时撤销（图片令牌同步失效）。
 */
export function removeMember(libraryId: string, userId: string): { revokedShares: number } {
  const db = getDb();
  const target = getMember(libraryId, userId);
  if (!target) throw errors.notFound('成员');
  if (target.role === 'owner') throw errors.lastOwner('所有者不能被移除；如需移除请先将其降级为协作者');

  const run = db.transaction(() => {
    const revoked = revokeShareLinksByCreator(libraryId, userId);
    db.prepare('DELETE FROM library_member WHERE library_id = ? AND user_id = ?').run(libraryId, userId);
    return revoked;
  });
  return { revokedShares: run() };
}

/** 直接加入（供旧的 POST /library/members 使用，保持幂等：已是成员则原样返回） */
export function addExistingUserAsMember(
  libraryId: string,
  email: string,
  role: MemberRole = 'member',
): { added: boolean } {
  const user = findUserByEmail(email);
  if (!user) throw errors.notFound('该邮箱对应的用户（需先注册）');
  const res = getDb()
    .prepare(
      `INSERT INTO library_member (id, library_id, user_id, role, created_at)
       VALUES (?,?,?,?,?) ON CONFLICT (library_id, user_id) DO NOTHING`,
    )
    .run(newId(), libraryId, user.id, role, nowIso());
  return { added: res.changes > 0 };
}
