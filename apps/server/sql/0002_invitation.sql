-- 成员邀请（文档 13.5：邀请制加入、接受幂等、变更即时失效）
-- 令牌只在创建时明文返回一次，库存 sha256 哈希。
CREATE TABLE IF NOT EXISTS library_invitation (
  id              TEXT PRIMARY KEY,
  library_id      TEXT NOT NULL REFERENCES library(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('owner','member')) DEFAULT 'member',
  token_hash      TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','accepted','revoked','replaced')),
  expires_at      TEXT NOT NULL,
  accepted_at     TEXT,
  accepted_user   TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  invited_by      TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
-- 同一库 + 邮箱：最多只有一条待接受邀请（重新邀请会把旧条目标记为 replaced，旧令牌即时失效）
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitation_pending
  ON library_invitation(library_id, lower(email))
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_invitation_library ON library_invitation(library_id, status);
CREATE INDEX IF NOT EXISTS idx_invitation_email ON library_invitation(lower(email), status);
