import crypto from 'node:crypto';
import { getDb, newId, nowIso } from '../db.js';
import { config } from '../config.js';
import { errors } from '../http/errors.js';

export type MemberRole = 'owner' | 'member';

export interface InviteRow {
  id: string;
  library_id: string;
  email: string;
  role: MemberRole;
  token: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  invited_by: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  created_at: string;
  updated_at: string;
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** 该库还剩几个所有者（最后一个 owner 是不可移除/降级的红线） */
export function countOwners(libraryId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM library_member WHERE library_id = ? AND role = 'owner'")
    .get(libraryId) as { n: number };
  return row.n;
}

function isMember(libraryId: string, userId: string): boolean {
  return Boolean(
    getDb()
      .prepare('SELECT 1 AS x FROM library_member WHERE library_id = ? AND user_id = ?')
      .get(libraryId, userId),
  );
}

/**
 * 即时失效（文档 13.4 / 本需求第一句）：
 * 当某用户被移除，或从 owner 降为 member 时，他**以 owner 身份开过的历史分享**必须立即作废。
 * share_link 的校验每请求都重读 revoked_at（无缓存），因此这里把 revoked_at 写上后，
 * 旧链接（含图片令牌）下一次请求即 401，无需重启、无需通知客户端。
 *
 * 只撤销"仍然有效"的链接（未撤销、未过期）；过期/已撤销的不动。
 * 返回被作废旧链接的数量。
 */
export function revokeActiveSharesByUser(libraryId: string, userId: string, reason: string): number {
  const now = nowIso();
  const res = getDb()
    .prepare(
      `UPDATE share_link
         SET revoked_at = ?
       WHERE library_id = ?
         AND created_by = ?
         AND revoked_at IS NULL
         AND expires_at > ?`,
    )
    .run(now, libraryId, userId, now);
  if (res.changes > 0) {
    // 审计：记录失效原因，便于事后回答"这条链接为什么突然不能用了"
    const rows = getDb()
      .prepare('SELECT id FROM share_link WHERE library_id = ? AND created_by = ? AND revoked_at = ?')
      .all(libraryId, userId, now) as { id: string }[];
    const insertLog = getDb().prepare(
      'INSERT INTO share_access_log (id, share_link_id, ip_hash, user_agent, path, allowed, deny_reason, at) VALUES (?,?,NULL,NULL,NULL,0,?,?)',
    );
    for (const r of rows) insertLog.run(newId(), r.id, reason, now);
  }
  return res.changes;
}

// --------------------------------------------------------------- invites

/** owner 创建邀请；同一库+邮箱已有 pending 时复用（不重复造链接） */
export function createInvite(params: {
  libraryId: string;
  email: string;
  role: MemberRole;
  invitedBy: string;
}): { invite: InviteRow; reused: boolean } {
  if (!config.enableShare) throw errors.badRequest('邀请功能已被服务端关闭（ENABLE_SHARE=false）');
  const email = normalizeEmail(params.email);
  const db = getDb();

  // 已经是成员：不再发邀请（接受会幂等，创建这一步也直接挡住，避免"邀请现任成员"的困惑）
  const existingUser = db.prepare('SELECT id FROM "user" WHERE lower(email) = ?').get(email) as
    | { id: string }
    | undefined;
  if (existingUser && isMember(params.libraryId, existingUser.id)) {
    throw errors.alreadyMember();
  }

  const pending = db
    .prepare("SELECT * FROM library_invite WHERE library_id = ? AND email = ? AND status = 'pending'")
    .get(params.libraryId, email) as InviteRow | undefined;
  if (pending) {
    // 复用旧邀请；如角色有调整则同步角色（角色调整同样要即时反映到"待接受"的邀请上）
    if (pending.role !== params.role) {
      db.prepare('UPDATE library_invite SET role = ?, updated_at = ? WHERE id = ?').run(
        params.role,
        nowIso(),
        pending.id,
      );
      pending.role = params.role;
    }
    return { invite: pending, reused: true };
  }

  const id = newId();
  const now = nowIso();
  const expiresAt = new Date(Date.now() + config.inviteTtlDays * 86400000).toISOString();
  db.prepare(
    `INSERT INTO library_invite (id, library_id, email, role, token, status, invited_by, expires_at, created_at, updated_at)
     VALUES (?,?,?,?,?, 'pending', ?, ?, ?, ?)`,
  ).run(id, params.libraryId, email, params.role, crypto.randomBytes(24).toString('base64url'), params.invitedBy, expiresAt, now, now);
  return { invite: db.prepare('SELECT * FROM library_invite WHERE id = ?').get(id) as InviteRow, reused: false };
}

export function listInvites(libraryId: string): InviteRow[] {
  return getDb()
    .prepare('SELECT * FROM library_invite WHERE library_id = ? ORDER BY created_at DESC')
    .all(libraryId) as InviteRow[];
}

export function revokeInvite(inviteId: string, libraryId: string): void {
  // 撤销即时生效：接受接口每次都重读 status，撤销后下一次接受即被拒
  const res = getDb()
    .prepare(
      "UPDATE library_invite SET status = 'revoked', updated_at = ? WHERE id = ? AND library_id = ? AND status = 'pending'",
    )
    .run(nowIso(), inviteId, libraryId);
  if (res.changes === 0) throw errors.inviteNotPending();
}

/** 按 token 取邀请，并把过期/撤销/不存在都挡掉（接受前预览与真正接受共用，口径一致） */
export function requireUsableInvite(token: string): InviteRow {
  const invite = getDb().prepare('SELECT * FROM library_invite WHERE token = ?').get(token) as
    | InviteRow
    | undefined;
  if (!invite) throw errors.notFound('邀请链接');
  if (invite.status === 'revoked') throw errors.inviteRevoked();
  if (invite.status === 'accepted') throw errors.inviteAccepted();
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    // 惰性落库过期状态
    getDb().prepare("UPDATE library_invite SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'pending'").run(
      nowIso(),
      invite.id,
    );
    throw errors.inviteExpired();
  }
  return invite;
}

/**
 * 接受邀请（幂等核心）：
 * - 重复接受 / 已是成员（无论因历史接受还是直接添加）：返回 alreadyJoined，绝不插第二条关系。
 *   library_member 的 UNIQUE(library_id,user_id) 是最终兜底，这里先查给出干净语义。
 * - 撤销/过期的邀请仍按 requireUsableInvite 拒绝（那不是"重复接受"，是失效链接）。
 * - 首次接受：在同一事务里①落成员关系 ②把邀请置为 accepted。
 */
export function acceptInvite(params: {
  token: string;
  userId: string;
  userEmail: string;
}): { libraryId: string; role: MemberRole; alreadyJoined: boolean } {
  const rawInvite = getDb().prepare('SELECT * FROM library_invite WHERE token = ?').get(params.token) as
    | InviteRow
    | undefined;
  if (!rawInvite) throw errors.notFound('邀请链接');

  // "已接受"的邀请允许重复接受（幂等）；撤销/过期必须拒绝。
  if (rawInvite.status === 'revoked') throw errors.inviteRevoked();
  if (rawInvite.status === 'expired' || new Date(rawInvite.expires_at).getTime() < Date.now()) {
    if (rawInvite.status === 'pending') {
      getDb()
        .prepare("UPDATE library_invite SET status = 'expired', updated_at = ? WHERE id = ?")
        .run(nowIso(), rawInvite.id);
    }
    throw errors.inviteExpired();
  }

  const invite = rawInvite.status === 'accepted'
    ? rawInvite
    : requireUsableInvite(params.token); // pending：再过一遍统一校验
  if (normalizeEmail(params.userEmail) !== invite.email) {
    throw errors.inviteEmailMismatch();
  }
  const db = getDb();

  const existing = db
    .prepare('SELECT role FROM library_member WHERE library_id = ? AND user_id = ?')
    .get(invite.library_id, params.userId) as { role: MemberRole } | undefined;
  if (existing) {
    // 重复接受 / 已是成员：不建双关系。邀请若仍 pending（例如关系是 owner 直接添加的），
    // 顺手把它收敛为 accepted，避免它继续挂在待接受列表里。
    db.prepare(
      "UPDATE library_invite SET status = 'accepted', accepted_at = ?, accepted_by = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
    ).run(nowIso(), params.userId, nowIso(), invite.id);
    return { libraryId: invite.library_id, role: existing.role, alreadyJoined: true };
  }

  // 邀请已被别人接受过（理论上同邮箱同账号；此处用户已匹配邮箱），不应再建关系以外的异常状态
  if (invite.status === 'accepted') {
    // 邮箱匹配却查不到成员：邀请可能被接受后该成员又被移除。不自动重建，需重新邀请。
    throw errors.inviteAccepted();
  }

  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare(
      'INSERT INTO library_member (id, library_id, user_id, role, created_at) VALUES (?,?,?,?,?)',
    ).run(newId(), invite.library_id, params.userId, invite.role, now);
    // 接受成功：本邀请 accepted；同库同邮箱不会有第二条 pending（唯一索引保证）。
    db.prepare(
      "UPDATE library_invite SET status = 'accepted', accepted_at = ?, accepted_by = ?, updated_at = ? WHERE id = ?",
    ).run(now, params.userId, now, invite.id);
  });
  tx();
  return { libraryId: invite.library_id, role: invite.role, alreadyJoined: false };
}

// --------------------------------------------------------- role / removal

/**
 * 调整成员角色。
 * 红线：不允许把最后一个 owner 降为 member（否则该库将无 owner，无人可管理/看到精确坐标）。
 * 即时失效：owner → member 时，撤销他历史上以 owner 身份开的分享；
 *           member → owner 是授权扩大，不牵动历史分享（不会因此泄露任何新坐标）。
 */
export function setMemberRole(params: {
  libraryId: string;
  targetUserId: string;
  role: MemberRole;
}): { revokedShareCount: number } {
  const db = getDb();
  const target = db
    .prepare('SELECT role FROM library_member WHERE library_id = ? AND user_id = ?')
    .get(params.libraryId, params.targetUserId) as { role: MemberRole } | undefined;
  if (!target) throw errors.notFound('成员');
  if (target.role === params.role) throw errors.badRequest('该成员已是此角色，无需调整');

  if (target.role === 'owner' && params.role === 'member' && countOwners(params.libraryId) <= 1) {
    throw errors.lastOwnerCannotChange();
  }

  db.prepare('UPDATE library_member SET role = ? WHERE library_id = ? AND user_id = ?').run(
    params.role,
    params.libraryId,
    params.targetUserId,
  );

  let revokedShareCount = 0;
  if (target.role === 'owner' && params.role === 'member') {
    // 降级即时收回：历史分享（owner 可开到 g500，且其视角含精确坐标）立即失效
    revokedShareCount = revokeActiveSharesByUser(params.libraryId, params.targetUserId, 'role_demoted');
  }
  return { revokedShareCount };
}

/**
 * 移除成员。
 * 红线：最后一个 owner 不可移除。
 * 即时失效：移除后其旧 JWT 立即失权（鉴权每请求回查成员表），
 *           并撤销他历史上开过的、仍有效的分享链接（含图片令牌）。
 */
export function removeMember(libraryId: string, targetUserId: string): { revokedShareCount: number } {
  const db = getDb();
  const target = db
    .prepare('SELECT role FROM library_member WHERE library_id = ? AND user_id = ?')
    .get(libraryId, targetUserId) as { role: MemberRole } | undefined;
  if (!target) throw errors.notFound('成员');
  if (target.role === 'owner' && countOwners(libraryId) <= 1) {
    throw errors.lastOwnerCannotChange();
  }
  const revokedShareCount = revokeActiveSharesByUser(libraryId, targetUserId, 'member_removed');
  db.prepare('DELETE FROM library_member WHERE library_id = ? AND user_id = ?').run(libraryId, targetUserId);
  // 该用户名下若有未接受的邀请（理论上成员不应再有 pending，但收敛一下）也一并作废
  db.prepare(
    `UPDATE library_invite SET status = 'revoked', updated_at = ?
      WHERE library_id = ? AND lower(email) = (SELECT lower(email) FROM "user" WHERE id = ?) AND status = 'pending'`,
  ).run(nowIso(), libraryId, targetUserId);
  return { revokedShareCount };
}

/** owner 直接按邮箱加成员（保留原入口）；重复添加不建双关系，返回 alreadyMember */
export function addExistingMemberByEmail(params: {
  libraryId: string;
  email: string;
}): { userId: string; alreadyMember: boolean } {
  const email = normalizeEmail(params.email);
  const db = getDb();
  const user = db.prepare('SELECT id FROM "user" WHERE lower(email) = ?').get(email) as
    | { id: string }
    | undefined;
  if (!user) throw errors.notFound('该邮箱对应的用户（需先注册）');
  if (isMember(params.libraryId, user.id)) {
    return { userId: user.id, alreadyMember: true };
  }
  db.prepare(
    'INSERT INTO library_member (id, library_id, user_id, role, created_at) VALUES (?,?,?,?,?)',
  ).run(newId(), params.libraryId, user.id, 'member', nowIso());
  return { userId: user.id, alreadyMember: false };
}
