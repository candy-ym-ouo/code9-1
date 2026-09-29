import { expect, test } from '@playwright/test';

/**
 * 主闭环的界面级验证（文档 6.1）：
 * 注册 → 收件箱建卡 → 打标 → 建机位 → 绑定 → 设条件 → 看窗口 → 接单 → 回填
 */
test('从注册到回填的完整闭环可以在界面上走通', async ({ page }) => {
  const email = `e2e-${Date.now()}@flil.local`;

  // —— 1. 注册 ——
  await page.goto('/login');
  await page.getByRole('tab', { name: /注册/ }).click();
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码').fill('password123');
  await page.getByLabel('昵称').fill('E2E 用户');
  await page.getByRole('button', { name: '创建库' }).click();

  // 落地到"今日"，且顶部出现用户名
  await expect(page.getByText('现在这一刻能去哪')).toBeVisible();
  await expect(page.getByText('E2E 用户')).toBeVisible();

  // —— 2. 收件箱建卡 + 打标 ——
  await page.getByRole('link', { name: '收件箱' }).click();
  const title = `E2E 连廊黄昏 ${Date.now()}`;
  await page.getByPlaceholder(/一句话描述这条灵感/).fill(title);
  await page.getByRole('button', { name: '加入收件箱' }).click();
  await expect(page.getByText('已加入收件箱，先去打标签')).toBeVisible();

  // 用搜索快速打标（对应文档 10.2① 的"10 秒打标"）
  await page.getByPlaceholder(/搜索标签/).fill('逆光');
  await page.getByTestId('tag-逆光').click();
  await page.getByPlaceholder(/搜索标签/).fill('连廊');
  await page.getByTestId('tag-连廊').click();
  await page.getByRole('button', { name: '应用到已选卡片' }).click();
  await expect(page.getByText(/已为 1 张卡添加/)).toBeVisible();

  // —— 3. 建机位（地图拾取坐标）——
  await page.getByRole('link', { name: '地点' }).click();
  await page.getByRole('button', { name: '新建机位' }).click();
  // 弹窗里的地图（页面上的那张只做展示）
  const mapBox = page.getByRole('dialog', { name: '新建机位' }).getByTestId('map-canvas');
  await mapBox.click({ position: { x: 300, y: 160 } });
  await expect(page.getByText(/已拾取坐标/)).toBeVisible();
  await page.getByLabel('或新建地点').fill('E2E 创意园连廊');
  await page.getByLabel('城市').fill('上海');
  await page.getByLabel('区').fill('普陀区');
  await page.getByLabel('机位描述（例如：桥下东侧第二个桥墩，蹲下拍）').fill('东侧第二个桥墩');
  await page.getByRole('button', { name: '保存机位' }).click();
  await expect(page.getByText(/机位已保存/)).toBeVisible();

  // —— 4. 回到卡片，绑定机位 ——
  // 这张卡刚打完标、还没条件，所以它在收件箱里（"灵感卡"列表默认只看已就绪）
  await page.getByRole('link', { name: '收件箱' }).click();
  await page.getByRole('link', { name: title }).click();
  await expect(page.getByText('条件与机位')).toBeVisible();
  const spotSelect = page.getByTestId('spot-select');
  await spotSelect.selectOption({ index: 1 });
  await expect(page.getByText(/已绑定机位|E2E 创意园连廊/).first()).toBeVisible();

  // —— 5. 设条件（用默认值 + 保存，服务端会立即算出 7 天窗口）——
  await page.getByRole('button', { name: '编辑拍摄条件' }).click();
  await page.getByRole('button', { name: '用今天的数据试算' }).click();
  await expect(page.getByText('今天的锚点长什么样')).toBeVisible();
  await expect(page.getByText('可满足性检查（避免设出永远不成立的严条件）')).toBeVisible();
  await page.getByRole('button', { name: '保存并重算窗口' }).click();
  await expect(page.getByText(/已保存，并重算了 7 天窗口/)).toBeVisible();

  // —— 6. 窗口列表出现判定与理由 ——
  await expect(page.getByText('未来 7 天可拍窗口')).toBeVisible();
  await expect(page.getByText(/窗口 \d{2}:\d{2}–\d{2}:\d{2}/).first()).toBeVisible();
  await expect(page.getByText(/日落前 \d+ 分/).first()).toBeVisible();

  // —— 7. 接单 → 生成出行计划 ——
  // 注意：antd 会在两个汉字之间插入空格（"接 单"），所以用正则匹配
  const planButton = page.getByRole('button', { name: /接\s*单/ }).first();
  const hasWindow = await planButton.isVisible().catch(() => false);
  if (!hasWindow) {
    test.info().annotations.push({
      type: 'note',
      description: '未来 7 天没有非 bad 的窗口（真实天气导致），跳过接单与回填步骤',
    });
    return;
  }
  await planButton.click();
  await expect(page.getByText('接单成出行计划')).toBeVisible();
  await page.getByRole('button', { name: '生成计划' }).click();
  await expect(page.getByText(/已接单：出发时间/)).toBeVisible();

  // —— 8. 回填（闭环最后一厘米）——
  await page.getByRole('link', { name: '计划' }).click();
  // 注意 "只看待回填" 也包含"回填"，所以要限定在计划行内点击
  await page
    .getByRole('row', { name: new RegExp(title) })
    .getByRole('button', { name: /回\s*填/ })
    .click();
  await expect(page.getByText(/去拍了吗/)).toBeVisible();
  await page.getByRole('button', { name: '差一点' }).click();
  await page.getByText('时间差了').click();
  await page.getByRole('button', { name: /提\s*交/ }).click();
  await expect(page.getByText(/该卡命中率更新为/)).toBeVisible();
});

test('分享页不需要登录，且不显示精确坐标', async ({ page, request }) => {
  const email = `e2e-share-${Date.now()}@flil.local`;
  const register = await request.post('/api/auth/register', {
    data: { email, password: 'password123', displayName: '分享测试' },
  });
  const { token } = (await register.json()) as { token: string };
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  const place = await (await request.post('/api/places', { headers: auth, data: { name: '分享测试地点' } })).json();
  const spot = await (
    await request.post('/api/spots', {
      headers: auth,
      data: { placeId: place.id, lat: 31.2471, lng: 121.4462, cameraBearing: 265 },
    })
  ).json();

  const link = await (
    await request.post('/api/share-links', {
      headers: auth,
      data: { scope: 'inspiration', scopeId: spot.id, fuzzLevel: 'exact', expiresInDays: 1 },
    })
  ).json();

  // 申请的是 exact，服务端必须强制降级
  expect(link.fuzzLevel).toBe('g500');
  expect(link.downgraded).toBe(true);

  await page.goto(`/share/${link.token}`);
  await expect(page.getByText(/只读分享链接/)).toBeVisible();
});
