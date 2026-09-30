import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';

let app: Express;
let token = '';
let cardId = '';
let spotId = '';
let tagIds: Record<string, string> = {};
let albumId = '';
let shareToken = '';
let linkId = '';
let planId = '';
let tmpDir = '';

function call(method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string, body?: unknown) {
  let req = request(app)[method](url);
  if (token) req = req.set('authorization', `Bearer ${token}`);
  if (body !== undefined) req = req.send(body as object);
  return req;
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flil-test-'));
  process.env.DATABASE_URL = path.join(tmpDir, 'app.db');
  process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
  process.env.THUMB_DIR = path.join(tmpDir, 'thumbs');
  process.env.SHARE_DIR = path.join(tmpDir, 'share');
  process.env.BACKUP_DIR = path.join(tmpDir, 'backups');
  process.env.JWT_SECRET = 'test-secret';
  process.env.WEATHER_PROVIDER = 'fixture';
  process.env.ENABLE_CLIMATE_BASELINE = 'false';

  const { createApp } = await import('../src/app.js');
  const { migrate } = await import('../src/db.js');
  migrate();
  app = createApp();
});

afterAll(async () => {
  const { closeDb } = await import('../src/db.js');
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('E1 采集 → 结构化 → 就绪（状态机无断头）', () => {
  it('注册并写入基线标签（不含业务数据）', async () => {
    const res = await call('post', '/api/auth/register', {
      email: 'owner@test.local',
      password: 'password123',
      displayName: '测试所有者',
    });
    expect(res.status).toBe(201);
    token = res.body.token;

    const cards = await call('get', '/api/inspirations');
    expect(cards.body.total).toBe(0);

    const tags = await call('get', '/api/tags');
    const flat = (tags.body.items as { children?: { id: string; name: string }[] }[]).flatMap(
      (g) => g.children ?? [],
    );
    expect(flat.length).toBeGreaterThan(100);
    tagIds = Object.fromEntries(flat.map((t) => [t.name, t.id]));
    expect(tagIds['逆光']).toBeTruthy();
  });

  it('新建卡片为 draft；打标签但无条件 → timing_missing（可达且不会卡死）', async () => {
    const created = await call('post', '/api/inspirations', { title: '连廊黄昏' });
    cardId = created.body.id;
    let detail = await call('get', `/api/inspirations/${cardId}`);
    expect(detail.body.item.status).toBe('draft');

    await call('post', '/api/inspirations/bulk-tag', {
      ids: [cardId],
      addTagIds: [tagIds['逆光'], tagIds['连廊']],
    });
    detail = await call('get', `/api/inspirations/${cardId}`);
    expect(detail.body.item.status).toBe('timing_missing');
  });

  it('有条件但还没有标签 → tagging（状态机另一个可达分支）', async () => {
    const other = await call('post', '/api/inspirations', { title: '只有条件的卡片' });
    const place = await call('post', '/api/places', { name: '临时地点', city: '上海' });
    const spot = await call('post', '/api/spots', {
      placeId: place.body.id,
      lat: 31.2,
      lng: 121.4,
      cameraBearing: 90,
    });
    await call('post', `/api/inspirations/${other.body.id}/spot`, { spotId: spot.body.id });
    await call('put', `/api/inspirations/${other.body.id}/timing`, {
      timeAnchor: 'sunrise',
      anchorOffsetMin: 0,
      elevationRange: [-90, 90],
      azimuthRange: null,
      azimuthTolerance: 15,
      windowToleranceMin: 12,
      weatherProfile: {},
      seasonWindow: null,
      notes: null,
    });
    const detail = await call('get', `/api/inspirations/${other.body.id}`);
    expect(detail.body.item.status).toBe('tagging');
  });

  it('建地点与机位，绑定条件后 → ready', async () => {
    const place = await call('post', '/api/places', { name: '测试创意园', city: '上海', district: '普陀区' });
    const spot = await call('post', '/api/spots', {
      placeId: place.body.id,
      lat: 31.2471,
      lng: 121.4462,
      cameraBearing: 265,
    });
    spotId = spot.body.id;

    await call('post', `/api/inspirations/${cardId}/spot`, { spotId });
    await call('put', `/api/inspirations/${cardId}/timing`, {
      timeAnchor: 'sunset_minus',
      anchorOffsetMin: 40,
      elevationRange: [-4, 10],
      azimuthRange: null,
      azimuthTolerance: 15,
      windowToleranceMin: 12,
      weatherProfile: { precipProbPctMax: 20 },
      seasonWindow: null,
      notes: null,
    });
    const detail = await call('get', `/api/inspirations/${cardId}`);
    expect(detail.body.item.status).toBe('ready');
  });
});

describe('E2 时机闭环：窗口与判定理由', () => {
  it('产出 7 天窗口，每天都有判定与逐项理由', async () => {
    const res = await call('post', `/api/inspirations/${cardId}/windows/recompute`, { days: 7 });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(7);
    for (const w of res.body.items) {
      expect(['good', 'marginal', 'bad']).toContain(w.verdict);
      expect(w.reasons.length).toBeGreaterThan(2);
      expect(w.reasons.some((r: { code: string }) => r.code === 'ANCHOR_RESOLVED')).toBe(true);
    }
  });

  it('重复计算幂等（同一天不产生第二条窗口）', async () => {
    const first = await call('get', `/api/inspirations/${cardId}/windows?days=7`);
    await call('post', `/api/inspirations/${cardId}/windows/recompute`, { days: 7 });
    const second = await call('get', `/api/inspirations/${cardId}/windows?days=7`);
    expect(second.body.items).toHaveLength(first.body.items.length);
  });

  it('锚点预览给出今天的真实时刻与可满足性建议', async () => {
    const res = await call('post', `/api/inspirations/${cardId}/timing/preview`, {
      timeAnchor: 'golden_pm',
      anchorOffsetMin: 0,
      elevationRange: [-4, 6],
      azimuthRange: null,
      azimuthTolerance: 15,
      windowToleranceMin: 12,
      weatherProfile: {},
      seasonWindow: null,
      notes: null,
    });
    expect(res.status).toBe(200);
    expect(typeof res.body.anchorLocal).toBe('string');
    expect(res.body.satisfiability).toBeTruthy();
  });
});

describe('E3/E4 提醒与出行计划', () => {
  it('扫描后提醒状态合法，且可接单成计划', async () => {
    await call('post', '/api/reminders/scan');
    const list = await call('get', '/api/reminders');
    const allowed = ['pending', 'notified', 'done', 'snoozed', 'dismissed', 'expired'];
    for (const r of list.body.items) expect(allowed).toContain(r.status);

    const windows = await call('get', `/api/inspirations/${cardId}/windows`);
    const good = windows.body.items.find((w: { verdict: string }) => w.verdict !== 'bad');
    const plan = await call('post', '/api/plans', { windowId: good.id, commuteMin: 30 });
    expect(plan.status).toBe(201);
    planId = plan.body.id;
    expect(typeof plan.body.leaveAt).toBe('string');
  });

  it('取消计划必须填原因', async () => {
    const bad = await call('patch', `/api/plans/${planId}`, { status: 'cancelled' });
    expect(bad.status).toBe(400);
  });

  it('重复扫描不产生重复提醒（唯一键幂等）', async () => {
    await call('post', '/api/reminders/scan');
    const first = await call('get', '/api/reminders');
    await call('post', '/api/reminders/scan');
    const second = await call('get', '/api/reminders');
    expect(second.body.items.length).toBe(first.body.items.length);
  });
});

describe('E5 实拍回填与校准', () => {
  it('回填写入并更新命中率；重复回填被拒', async () => {
    const fill = await call('post', `/api/plans/${planId}/result`, {
      hitLevel: 'miss',
      missReasons: ['timing_off'],
      note: '云比预报厚',
    });
    expect(fill.status).toBe(201);
    expect(fill.body.missCount).toBe(1);

    const again = await call('post', `/api/plans/${planId}/result`, { hitLevel: 'hit', missReasons: [] });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('RESULT_ALREADY_FILLED');
  });

  it('连续 3 次同因未命中 → 收紧判断，且可撤销', async () => {
    for (let i = 0; i < 2; i += 1) {
      const windows = await call('get', `/api/inspirations/${cardId}/windows`);
      const usable = windows.body.items.filter((w: { verdict: string }) => w.verdict !== 'bad');
      const plan = await call('post', '/api/plans', { windowId: usable[i + 1].id, commuteMin: 30 });
      await call('post', `/api/plans/${plan.body.id}/result`, {
        hitLevel: 'miss',
        missReasons: ['timing_off'],
      });
    }
    const detail = await call('get', `/api/inspirations/${cardId}`);
    expect(detail.body.item.timing.azimuthTolerance).toBeLessThan(15);

    const logs = await call('get', `/api/inspirations/${cardId}/calibration`);
    expect(logs.body.items.length).toBeGreaterThan(0);
    expect(logs.body.items[0].reason).toContain('收紧');

    const undo = await call(
      'post',
      `/api/inspirations/${cardId}/calibration/${logs.body.items[0].id}/undo`,
      {},
    );
    expect(undo.status).toBe(200);
    const after = await call('get', `/api/inspirations/${cardId}`);
    expect(after.body.item.timing.azimuthTolerance).toBe(15);
  });
});

describe('E6 画册闭环：缺口 → 补齐 → 发布', () => {
  it('建册后生成缺口，且必需缺口阻止发布', async () => {
    const album = await call('post', '/api/albums', {
      title: '黄昏逆光',
      rules: {
        requireTags: [
          { tagIds: [tagIds['逆光']], min: 1, required: true },
          { tagIds: [tagIds['霓虹招牌']], min: 5, required: true },
        ],
        totalMin: 1,
        autoMatch: { enabled: true, minTagHits: 1 },
      },
    });
    expect(album.status).toBe(201);
    albumId = album.body.id;

    const gaps = await call('get', `/api/albums/${albumId}/gaps`);
    expect(gaps.body.items.length).toBeGreaterThanOrEqual(2);
    const requiredOpen = gaps.body.items.filter(
      (g: { isRequired: boolean; status: string }) => g.isRequired && g.status === 'open',
    );
    expect(requiredOpen.length).toBeGreaterThan(0);
    expect(requiredOpen[0].actionHref).toBeTruthy();
    expect(requiredOpen[0].actionLabel).toBeTruthy();

    const blocked = await call('post', `/api/albums/${albumId}/publish`, { createShare: false });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('ALBUM_HAS_REQUIRED_GAPS');
  });

  it('必需缺口不能豁免', async () => {
    const gaps = await call('get', `/api/albums/${albumId}/gaps`);
    const required = gaps.body.items.find((g: { isRequired: boolean }) => g.isRequired);
    const res = await call('post', `/api/albums/${albumId}/gaps/${required.id}/waive`, { reason: '想跳过' });
    expect(res.status).toBe(400);
  });

  it('放宽规则后缺口自动闭合，画册进入 ready', async () => {
    await call('patch', `/api/albums/${albumId}`, {
      rules: {
        requireTags: [{ tagIds: [tagIds['逆光']], min: 1, required: true }],
        requireAnchors: [],
        requireWeather: [],
        totalMin: 1,
        autoMatch: { enabled: true, minTagHits: 1 },
      },
    });
    await call('post', `/api/albums/${albumId}/auto-match`, {});
    const detail = await call('get', `/api/albums/${albumId}`);
    expect(['ready', 'published']).toContain(detail.body.item.status);
    expect(detail.body.item.openRequiredGaps).toBe(0);
    expect(detail.body.gaps.filter((g: { status: string }) => g.status === 'filled').length).toBeGreaterThan(0);
  });

  it('发布生成不可变快照，快照里只有模糊坐标', async () => {
    const publish = await call('post', `/api/albums/${albumId}/publish`, {
      createShare: true,
      fuzzLevel: 'g1k',
      expiresInDays: 2,
    });
    expect(publish.status).toBe(201);
    expect(typeof publish.body.payloadHash).toBe('string');
    shareToken = publish.body.shareToken;

    const snapshots = await call('get', `/api/albums/${albumId}/snapshots`);
    expect(snapshots.body.latest.version).toBe(1);
    const serialized = JSON.stringify(snapshots.body.latest.payload);
    expect(serialized).not.toContain('"precise"');
    expect(serialized).toContain('fuzzLevel');
  });
});

describe('E7 隐私：模糊化、强制降级与撤销', () => {
  it('分享页无需登录即可访问，且不含精确坐标', async () => {
    const saved = token;
    token = '';
    const view = await call('get', `/api/share/${shareToken}`);
    token = saved;
    expect(view.status).toBe(200);
    const nums = (JSON.stringify(view.body).match(/-?\d+\.\d+/g) ?? []).map(Number);
    expect(nums).not.toContain(31.2471);
    expect(JSON.stringify(view.body)).not.toContain('"precise"');
  });

  it('申请 exact 级别被强制降级为 g500 并告知', async () => {
    const link = await call('post', '/api/share-links', {
      scope: 'inspiration',
      scopeId: cardId,
      fuzzLevel: 'exact',
      expiresInDays: 1,
    });
    expect(link.status).toBe(201);
    expect(link.body.fuzzLevel).toBe('g500');
    expect(link.body.downgraded).toBe(true);
  });

  it('跨库访问被拒绝（member 看不到别的库的精确坐标）', async () => {
    const saved = token;
    const member = await call('post', '/api/auth/register', {
      email: 'member@test.local',
      password: 'password123',
      displayName: '协作者',
    });
    token = member.body.token;
    const detail = await call('get', `/api/inspirations/${cardId}`);
    expect([403, 404]).toContain(detail.status);
    token = saved;
  });

  it('撤销后旧链接立即失效，并留下访问审计', async () => {
    const links = await call('get', '/api/share-links');
    const albumLink = links.body.items.find((l: { scope: string }) => l.scope === 'album');
    linkId = albumLink.id;
    const revoke = await call('post', `/api/share-links/${linkId}/revoke`, {});
    expect(revoke.status).toBe(200);

    const saved = token;
    token = '';
    const after = await call('get', `/api/share/${shareToken}`);
    token = saved;
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('SHARE_REVOKED');

    const logs = await call('get', `/api/share-links/${linkId}/logs`);
    expect(logs.body.items.length).toBeGreaterThan(0);
  });

  it('owner 可预览模糊级别，模糊点由网格中心决定', async () => {
    const preview = await call('get', `/api/spots/${spotId}/fuzz-preview?level=g1k`);
    expect(preview.status).toBe(200);
    expect(preview.body.precise.lat).toBe(31.2471);
    expect(preview.body.fuzz.geohash).toBeTruthy();
    expect(preview.body.fuzz.lat).not.toBeNull();
  });
});

describe('E8 检索与零结果兜底', () => {
  it('按标签检索命中', async () => {
    const res = await call('get', `/api/search?tagIds=${tagIds['逆光']}`);
    expect(res.body.total).toBeGreaterThan(0);
  });

  it('零结果时返回放宽说明，不允许静默放宽', async () => {
    const res = await call('get', '/api/search?q=zzz_not_exist_zzz');
    expect(Array.isArray(res.body.relaxed)).toBe(true);
  });

  it('非法参数返回 400 而不是 500', async () => {
    const res = await call('put', `/api/inspirations/${cardId}/timing`, { timeAnchor: 'bad_anchor' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });
});

describe('E9 离线补录幂等', () => {
  it('同一 clientOpId 提交两次只落一条', async () => {
    const opId = 'op-test-0001';
    const first = await call('post', '/api/offline/apply', {
      clientOpId: opId,
      opType: 'create_inspiration',
      payload: { title: '断网时记下的一条' },
    });
    expect(first.status).toBe(201);
    const second = await call('post', '/api/offline/apply', {
      clientOpId: opId,
      opType: 'create_inspiration',
      payload: { title: '断网时记下的一条' },
    });
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.code).toBe('OFFLINE_OP_DUPLICATE');
  });
});

describe('E11 成员邀请与角色调整（即时失效 / 幂等 / 最后所有者保护）', () => {
  let ownerToken = '';
  let memberEmail = '';
  let memberId = '';
  let memberToken = '';
  let inviteToken = '';

  async function login(email: string, password = 'password123') {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password });
    return res.body as { token: string; user: { id: string } };
  }

  function auth(t: string) {
    token = t;
  }

  it('owner 发出邀请，未注册/已注册用户都拿到 acceptUrl', async () => {
    // 自包含登录（本 describe 单独运行时 E1 的注册副作用不一定已执行）
    let loginRes = await login('owner@test.local').catch(() => null);
    if (!loginRes?.token) {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({ email: 'owner@test.local', password: 'password123', displayName: '测试所有者' });
      loginRes = reg.body as { token: string; user: { id: string } };
    }
    ownerToken = loginRes.token;
    memberEmail = `invitee-${Date.now()}@test.local`;
    // 先注册该用户（模拟"被邀请人已注册但不在库中"）
    await request(app)
      .post('/api/auth/register')
      .send({ email: memberEmail, password: 'password123', displayName: '被邀请人' });
    const loginResult = await login(memberEmail);
    memberId = loginResult.user.id;
    memberToken = loginResult.token;

    auth(ownerToken);
    const res = await call('post', '/api/library/invites', { email: memberEmail, role: 'member' });
    expect(res.status).toBe(201);
    expect(res.body.acceptUrl).toContain('/invite/');
    inviteToken = res.body.token;
  });

  it('同一邮箱重复邀请复用旧链接（不造第二条邀请）', async () => {
    auth(ownerToken);
    const again = await call('post', '/api/library/invites', { email: memberEmail, role: 'member' });
    expect(again.status).toBe(200);
    expect(again.body.reused).toBe(true);
    expect(again.body.token).toBe(inviteToken);
  });

  it('接受前可用 token 预览库名与角色', async () => {
    auth(memberToken);
    const preview = await call('get', `/api/invites/${inviteToken}`);
    expect(preview.status).toBe(200);
    expect(preview.body.role).toBe('member');
    expect(preview.body.matchesCurrentUser).toBe(true);
  });

  it('用错误账号接受被拒（邮箱不匹配）', async () => {
    const other = await request(app)
      .post('/api/auth/register')
      .send({ email: `other-${Date.now()}@test.local`, password: 'password123', displayName: '路人' });
    auth(other.body.token);
    const denied = await call('post', `/api/invites/${inviteToken}/accept`, {});
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('INVITE_EMAIL_MISMATCH');
  });

  it('接受邀请成功并拿到指向该库的新 token', async () => {
    auth(memberToken);
    const res = await call('post', `/api/invites/${inviteToken}/accept`, {});
    expect(res.status).toBe(200);
    expect(res.body.alreadyJoined).toBe(false);
    memberToken = res.body.token;
  });

  it('重复接受幂等：不建第二条关系', async () => {
    auth(memberToken);
    const again = await call('post', `/api/invites/${inviteToken}/accept`, {});
    expect(again.status).toBe(200);
    expect(again.body.alreadyJoined).toBe(true);

    // 数据库层兜底：成员关系只有一条
    auth(ownerToken);
    const lib = await call('get', '/api/library');
    const rows = (lib.body.members as { email: string }[]).filter((m) => m.email === memberEmail);
    expect(rows).toHaveLength(1);
  });

  it('member 读卡片拿不到精确坐标', async () => {
    auth(memberToken);
    const detail = await call('get', `/api/inspirations/${cardId}`);
    expect(detail.body.item.spot.precise).toBeNull();
    const precise = await call('get', `/api/spots/${spotId}`);
    expect(precise.body.item.precise).toBeNull();
  });

  it('member 可建分享（分享层只给模糊坐标），其链接用于后续移除/降级验证', async () => {
    auth(memberToken);
    const created = await call('post', '/api/inspirations', { title: '协作者的卡' });
    const memberCardId = created.body.id as string;
    const link = await call('post', '/api/share-links', {
      scope: 'inspiration',
      scopeId: memberCardId,
      fuzzLevel: 'g500',
      expiresInDays: 1,
    });
    expect(link.status).toBe(201);
    (globalThis as Record<string, unknown>).__memberShareToken = link.body.token;
    (globalThis as Record<string, unknown>).__memberCardId = memberCardId;

    // 分享页公开可访问，且只有模糊坐标
    token = '';
    const view = await call('get', `/api/share/${link.body.token as string}`);
    expect(view.status).toBe(200);
    expect(JSON.stringify(view.body)).not.toContain('"precise"');
    auth(ownerToken);
  });

  it('降级 member（已是 member，无需降级）→ 直接测移除：旧 token 立即 401 且历史分享撤销', async () => {
    // 先把 member 提升为 owner（授权扩大，不撤销分享）
    auth(ownerToken);
    const promote = await call('patch', `/api/library/members/${memberId}/role`, { role: 'owner' });
    expect(promote.status).toBe(200);

    // 提权即时生效：旧 memberToken 在下一请求即具备 owner 能力（精确坐标）
    auth(memberToken);
    const asOwner = await call('get', `/api/spots/${spotId}`);
    expect(asOwner.body.item.precise?.lat).toBe(31.2471);

    // owner 身份建一条分享，用于验证降级后被撤销
    const link = await call('post', '/api/share-links', {
      scope: 'inspiration',
      scopeId: cardId,
      fuzzLevel: 'g500',
      expiresInDays: 1,
    });
    expect(link.status).toBe(201);
    const ownerShareToken = link.body.token as string;

    // 降回 member：服务端撤销其有效分享，并即时收回精确坐标
    auth(ownerToken);
    const demote = await call('patch', `/api/library/members/${memberId}/role`, { role: 'member' });
    expect(demote.status).toBe(200);
    expect(demote.body.revokedShareCount).toBeGreaterThanOrEqual(1);

    auth(memberToken);
    const afterDemote = await call('get', `/api/spots/${spotId}`);
    expect(afterDemote.body.item.precise).toBeNull();

    // 历史分享即时失效（下一次公开请求即 401）
    token = '';
    const view = await call('get', `/api/share/${ownerShareToken}`);
    expect(view.status).toBe(401);
    expect(view.body.error.code).toBe('SHARE_REVOKED');
  });

  it('最后一个 owner 不可降级（即使存在第二名 owner 后也保护"最后一个"）', async () => {
    // 当前库有注册者 owner + member(已降回 member)，只有一个 owner。
    // 提升 member 成第二个 owner，再尝试把原始 owner 自己降级到只剩一人——
    // 更直接的红线验证：单人 owner 库禁止降级唯一 owner。
    auth(ownerToken);
    await call('patch', `/api/library/members/${memberId}/role`, { role: 'owner' });
    // 把 member 降回去后，库里又只剩原始 owner
    await call('patch', `/api/library/members/${memberId}/role`, { role: 'member' });
    const ownerRow = (await call('get', '/api/library')).body.members.find(
      (m: { role: string; email: string }) => m.email === 'owner@test.local',
    ) as { id: string; role: string };
    const last = await call('patch', `/api/library/members/${ownerRow.id}/role`, { role: 'member' });
    expect(last.status).toBe(409);
    expect(last.body.error.code).toBe('LAST_OWNER_PROTECTED');
  });

  it('最后一个 owner 不可移除', async () => {
    auth(ownerToken);
    const ownerRow = (await call('get', '/api/library')).body.members.find(
      (m: { email: string }) => m.email === 'owner@test.local',
    ) as { id: string };
    const denied = await call('delete', `/api/library/members/${ownerRow.id}`);
    expect(denied.status).toBe(409);
    expect(denied.body.error.code).toBe('LAST_OWNER_PROTECTED');
  });

  it('移除 member：旧 token 立即失权（401），历史有效分享一并撤销', async () => {
    auth(ownerToken);
    const removed = await call('delete', `/api/library/members/${memberId}`);
    expect(removed.status).toBe(200);

    // 旧 JWT 立即作废：下一请求回查成员表查不到 → 401
    auth(memberToken);
    const afterRemove = await call('get', `/api/spots/${spotId}`);
    expect(afterRemove.status).toBe(401);

    // 该 member 之前建的分享（如成功创建过）也被撤销
    const memberShare = (globalThis as Record<string, unknown>).__memberShareToken as string | null;
    if (memberShare) {
      token = '';
      const view = await call('get', `/api/share/${memberShare}`);
      expect(view.status).toBe(401);
      expect(view.body.error.code).toBe('SHARE_REVOKED');
    }
  });

  it('邀请被撤销后不可再接受（即时失效）', async () => {
    auth(ownerToken);
    const email2 = `invitee2-${Date.now()}@test.local`;
    await request(app)
      .post('/api/auth/register')
      .send({ email: email2, password: 'password123', displayName: '第二个' });
    const inv = await call('post', '/api/library/invites', { email: email2, role: 'member' });
    const revoke = await call('delete', `/api/library/invites/${inv.body.id}`);
    expect(revoke.status).toBe(200);

    const t2 = (await login(email2)).token;
    auth(t2);
    const accept = await call('post', `/api/invites/${inv.body.token}/accept`, {});
    expect(accept.status).toBe(410);
    expect(accept.body.error.code).toBe('INVITE_REVOKED');
  });

  it('owner 直接按邮箱重复加成员不建双关系（兼容入口幂等）', async () => {
    auth(ownerToken);
    const email3 = `direct-${Date.now()}@test.local`;
    await request(app)
      .post('/api/auth/register')
      .send({ email: email3, password: 'password123', displayName: '直加' });
    const first = await call('post', '/api/library/members', { email: email3 });
    expect(first.status).toBe(201);
    expect(first.body.added).toBe(true);
    const second = await call('post', '/api/library/members', { email: email3 });
    expect(second.status).toBe(200);
    expect(second.body.alreadyMember).toBe(true);
    const lib = await call('get', '/api/library');
    expect((lib.body.members as { email: string }[]).filter((m) => m.email === email3)).toHaveLength(1);

    token = ownerToken;
  });
});

describe('E10 备份与质量门', () => {
  it('可创建备份并列出', async () => {
    const backup = await call('post', '/api/backup', {});
    expect(backup.status).toBe(201);
    const list = await call('get', '/api/backup/list');
    expect(list.body.items.length).toBeGreaterThan(0);
  });

  it('还原必须二次确认', async () => {
    const res = await call('post', '/api/backup/restore', { name: 'not-exist', confirm: false });
    expect(res.status).toBe(400);
  });

  it('提醒无悬挂：不存在超期未处理的 pending', async () => {
    const list = await call('get', '/api/reminders');
    const stale = list.body.items.filter(
      (r: { status: string; expireAt: string | null }) =>
        ['pending', 'notified', 'snoozed'].includes(r.status) &&
        r.expireAt !== null &&
        new Date(r.expireAt).getTime() < Date.now(),
    );
    expect(stale).toHaveLength(0);
  });

  it('健康检查报告数据库与图片目录状态', async () => {
    const res = await call('get', '/api/health');
    expect(res.body.db).toBe('ok');
    expect(Object.values(res.body.dirs).every((v) => v === 'ok')).toBe(true);
  });
});
