import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';

let app: Express;
let tmpDir = '';

// 独立账号体系，不与 api.test.ts 的测试数据互相影响
const tokens: Record<string, string> = {};
const userIds: Record<string, string> = {};
let ownerLib = '';
let memberId = '';
let cardId = '';

async function register(name: string, email: string) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'password123', displayName: name });
  expect(res.status).toBe(201);
  tokens[email] = res.body.token;
  userIds[email] = res.body.user.id;
  return res.body as { token: string; user: { id: string; libraryId: string } };
}

function callAs(email: string, method: 'get' | 'post' | 'patch' | 'delete', url: string, body?: unknown) {
  let req = request(app)[method](url).set('authorization', `Bearer ${tokens[email]}`);
  if (body !== undefined) req = req.send(body as object);
  return req;
}
const call = (method: 'get' | 'post' | 'patch' | 'delete', url: string, body?: unknown) =>
  callAs('owner@iv.local', method, url, body);

async function invite(email: string, role: 'owner' | 'member' = 'member') {
  const res = await call('post', '/api/library/invitations', { email, role });
  expect(res.status).toBe(201);
  return res.body as { token: string; replaced: boolean; id: string };
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flil-iv-'));
  process.env.DATABASE_URL = path.join(tmpDir, 'app.db');
  process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
  process.env.THUMB_DIR = path.join(tmpDir, 'thumbs');
  process.env.SHARE_DIR = path.join(tmpDir, 'share');
  process.env.BACKUP_DIR = path.join(tmpDir, 'backups');
  process.env.JWT_SECRET = 'test-secret-iv';
  process.env.WEATHER_PROVIDER = 'fixture';
  process.env.ENABLE_CLIMATE_BASELINE = 'false';

  const { createApp } = await import('../src/app.js');
  const { migrate } = await import('../src/db.js');
  migrate();
  app = createApp();

  await register('邀请库所有者', 'owner@iv.local');
  ownerLib = (await call('get', '/api/library')).body.library.id;
  await register('受邀协作者', 'member@iv.local');
  await register('无关路人', 'other@iv.local');
});

afterAll(async () => {
  const { closeDb } = await import('../src/db.js');
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('I1 邀请创建与重发', () => {
  it('未登录不能创建邀请（401）', async () => {
    const res = await request(app).post('/api/library/invitations').send({ email: 'other@iv.local' });
    expect(res.status).toBe(401);
  });

  it('发邀请：明文令牌只在创建响应里返回，列表中不含令牌', async () => {
    const created = await invite('member@iv.local');
    expect(typeof created.token).toBe('string');
    expect(created.replaced).toBe(false);

    const list = await call('get', '/api/library');
    const pending = list.body.invitations.filter((i: { status: string }) => i.status === 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0].token).toBeUndefined();
  });

  it('已是成员再邀请 → 409', async () => {
    const res = await call('post', '/api/library/invitations', { email: 'owner@iv.local' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVITATION_ALREADY_MEMBER');
  });

  it('重发同邮箱：旧邀请被 replaced，库内仍只有一条待处理邀请，旧令牌即时失效', async () => {
    const first = await invite('other@iv.local');
    const second = await invite('other@iv.local');
    expect(second.replaced).toBe(true);
    expect(second.token).not.toBe(first.token);

    const list = await call('get', '/api/library');
    const pendingForOther = list.body.invitations.filter(
      (i: { email: string; status: string }) => i.email === 'other@iv.local' && i.status === 'pending',
    );
    expect(pendingForOther).toHaveLength(1);

    const acceptOld = await callAs('other@iv.local', 'post', `/api/auth/invitations/${first.token}/accept`, {});
    expect(acceptOld.status).toBe(410);
    expect(acceptOld.body.error.code).toBe('INVITATION_NOT_PENDING');
  });

  it('接受邀请必须登录', async () => {
    const created = await invite('member@iv.local'); // 重发：顶替 I1 第二封
    const res = await request(app).post(`/api/auth/invitations/${created.token}/accept`).send({});
    expect(res.status).toBe(401);
  });
});

describe('I2 接受邀请：归属校验与重复接受幂等', () => {
  let memberInviteToken = '';

  it('邮箱不匹配不能接受（令牌不可转交给别的账号）', async () => {
    // other 的最新待接受令牌来自 I1，用 member 身份去接受 → 邮箱不符
    const otherInvite = await invite('other@iv.local');
    const wrong = await callAs(
      'member@iv.local',
      'post',
      `/api/auth/invitations/${otherInvite.token}/accept`,
      {},
    );
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe('INVITATION_EMAIL_MISMATCH');
  });

  it('本人接受：加入库、签发指向受邀库的新 token', async () => {
    const created = await invite('member@iv.local');
    memberInviteToken = created.token;
    const res = await callAs('member@iv.local', 'post', `/api/auth/invitations/${created.token}/accept`, {});
    expect(res.status).toBe(200);
    expect(res.body.already).toBe(false);
    expect(res.body.user.libraryId).toBe(ownerLib);
    expect(res.body.user.role).toBe('member');
    tokens['member@iv.local'] = res.body.token; // 会话切换到受邀库

    const members = await call('get', '/api/library');
    const joined = members.body.members.find((m: { email: string }) => m.email === 'member@iv.local');
    expect(joined).toBeTruthy();
    memberId = joined.id;
  });

  it('重复接受不建双关系：already:true，成员数不增加', async () => {
    const res = await callAs('member@iv.local', 'post', `/api/auth/invitations/${memberInviteToken}/accept`, {});
    expect(res.status).toBe(200);
    expect(res.body.already).toBe(true);

    const list = await call('get', '/api/library');
    expect(list.body.members.filter((m: { email: string }) => m.email === 'member@iv.local')).toHaveLength(1);
  });

  it('已在库成员不能再被邀请（409）', async () => {
    const res = await call('post', '/api/library/invitations', { email: 'member@iv.local' });
    expect(res.status).toBe(409);
  });

  it('撤销后的邀请立即不可接受', async () => {
    const created = await invite('other@iv.local');
    const list = await call('get', '/api/library');
    const pendingOther = list.body.invitations.find(
      (i: { email: string; status: string }) => i.email === 'other@iv.local' && i.status === 'pending',
    );
    const revoked = await call('post', `/api/library/invitations/${pendingOther.id}/revoke`, {});
    expect(revoked.status).toBe(200);

    const accept = await callAs('other@iv.local', 'post', `/api/auth/invitations/${created.token}/accept`, {});
    expect(accept.status).toBe(410);
    expect(accept.body.error.code).toBe('INVITATION_NOT_PENDING');
  });

  it('未知令牌 → 404', async () => {
    const res = await callAs('other@iv.local', 'post', '/api/auth/invitations/does-not-exist/accept', {});
    expect(res.status).toBe(404);
  });

  it('别库的 member 在 owner 库里不是 owner：创建邀请 403', async () => {
    // member 此刻的活动库已随接受邀请切换为 ownerLib，角色是 member
    const res = await callAs('member@iv.local', 'post', '/api/library/invitations', {
      email: 'x@iv.local',
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
  });
});

describe('I3 角色调整：精确坐标与历史分享即时失效', () => {
  let memberShareToken = '';

  it('准备坐标卡；member 只能看到模糊坐标', async () => {
    const place = await call('post', '/api/places', { name: '邀请测试地点', city: '上海' });
    const spot = await call('post', '/api/spots', { placeId: place.body.id, lat: 31.2471, lng: 121.4462 });
    const card = await call('post', '/api/inspirations', { title: '邀请测试卡' });
    await call('post', `/api/inspirations/${card.body.id}/spot`, { spotId: spot.body.id });
    cardId = card.body.id;

    const detail = await callAs('member@iv.local', 'get', `/api/inspirations/${cardId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.item.spot.precise).toBeNull();

    // member 建一条历史分享（成员可建分享）
    const link = await callAs('member@iv.local', 'post', '/api/share-links', {
      scope: 'inspiration',
      scopeId: cardId,
      fuzzLevel: 'g500',
      expiresInDays: 7,
    });
    expect(link.status).toBe(201);
    memberShareToken = link.body.token;
  });

  it('提升为 owner：持旧 token 的下一次请求立即看到精确坐标（角色实时回库），且历史分享同步撤销', async () => {
    const res = await call('patch', `/api/library/members/${memberId}/role`, { role: 'owner' });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);
    // 信任边界变更（双向）：其以旧身份创建的历史分享即时失效
    expect(res.body.revokedShares).toBe(1);

    const detail = await callAs('member@iv.local', 'get', `/api/inspirations/${cardId}`);
    expect(detail.body.item.spot.precise.lat).toBe(31.2471);

    const view = await request(app).get(`/api/share/${memberShareToken}`);
    expect(view.status).toBe(401);
    expect(view.body.error.code).toBe('SHARE_REVOKED');
  });

  it('降级为 member：精确坐标当场收回（历史分享已在提权时撤销，本次 0 条）', async () => {
    const res = await call('patch', `/api/library/members/${memberId}/role`, { role: 'member' });
    expect(res.status).toBe(200);
    expect(res.body.revokedShares).toBe(0);

    const detail = await callAs('member@iv.local', 'get', `/api/inspirations/${cardId}`);
    expect(detail.body.item.spot.precise).toBeNull();
  });

  it('被降级者的历史分享图片令牌同样 401（随链接撤销即时失效）', async () => {
    const assetView = await request(app).get(`/api/share/${memberShareToken}/assets/whatever`);
    expect(assetView.status).toBe(401);
    expect(assetView.body.error.code).toBe('SHARE_REVOKED');
  });

  it('最后一个 owner 不可降级（409 LAST_OWNER）', async () => {
    const res = await call('patch', `/api/library/members/${userIds['owner@iv.local']}/role`, { role: 'member' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LAST_OWNER');
  });

  it('重复设置相同角色幂等：无变更、无撤销', async () => {
    const res = await call('patch', `/api/library/members/${memberId}/role`, { role: 'member' });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(false);
    expect(res.body.revokedShares).toBe(0);
  });
});

describe('I4 移除成员：即时失权与最后所有者保护', () => {
  it('owner 不可移除（409）', async () => {
    const res = await call('delete', `/api/library/members/${userIds['owner@iv.local']}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LAST_OWNER');
  });

  it('移除 member：其历史分享同步撤销，旧 JWT 下一次请求即 401', async () => {
    const link = await callAs('member@iv.local', 'post', '/api/share-links', {
      scope: 'inspiration',
      scopeId: cardId,
      fuzzLevel: 'g500',
      expiresInDays: 7,
    });

    const removal = await call('delete', `/api/library/members/${memberId}`);
    expect(removal.status).toBe(200);
    expect(removal.body.revokedShares).toBe(1);

    const after = await callAs('member@iv.local', 'get', '/api/library');
    expect(after.status).toBe(401);

    const view = await request(app).get(`/api/share/${link.body.token}`);
    expect(view.status).toBe(401);
    expect(view.body.error.code).toBe('SHARE_REVOKED');
  });

  it('重复移除 → 404', async () => {
    const res = await call('delete', `/api/library/members/${memberId}`);
    expect(res.status).toBe(404);
  });
});

describe('I5 旧的直接加人接口保持幂等', () => {
  it('经邀请加入后再调 POST /library/members：added:false，无双关系', async () => {
    const created = await invite('other@iv.local');
    const accepted = await callAs('other@iv.local', 'post', `/api/auth/invitations/${created.token}/accept`, {});
    expect(accepted.status).toBe(200);
    tokens['other@iv.local'] = accepted.body.token;

    const again = await call('post', '/api/library/members', { email: 'other@iv.local' });
    expect(again.status).toBe(201);
    expect(again.body.added).toBe(false);

    const list = await call('get', '/api/library');
    expect(list.body.members.filter((m: { email: string }) => m.email === 'other@iv.local')).toHaveLength(1);
  });
});
