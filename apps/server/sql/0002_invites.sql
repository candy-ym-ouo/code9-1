-- 成员邀请（第 13 章：邀请与角色调整的即时失效）
-- 现状：library_member 只有 owner/member，且只能加"已注册同邮箱"用户，没有邀请/接受/撤销流程。
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS library_invite (
  id          TEXT PRIMARY KEY,
  library_id  TEXT NOT NULL REFERENCES library(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,                 -- 统一小写存储，接受时按小写比对
  role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  token       TEXT NOT NULL UNIQUE,          -- 接受链接 /invite/:token 携带
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','accepted','revoked','expired')),
  invited_by  TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  accepted_at TEXT,
  accepted_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invite_library ON library_invite(library_id, status);

-- 同一库、同一邮箱，同一时刻只允许一条 pending 邀请。
-- 重复邀请（已存在 pending）必须复用旧记录，而不是再插一条；
-- 接受后也不应残留第二条 pending（接受会把唯一的 pending 置为 accepted）。
CREATE UNIQUE INDEX IF NOT EXISTS uq_invite_pending_per_email
  ON library_invite(library_id, email)
  WHERE status = 'pending';
