import { getDb, newId, nowIso } from '../db.js';
import { slugify } from '../services/inspirations.js';

/**
 * 四域内置标签基线（文档 11.1）。
 * 结构：域 → 一级分组 → 标签。分组本身也作为标签写入（可被父级检索）。
 */
export const BASELINE_TAGS: Record<string, Record<string, string[]>> = {
  light: {
    时段光: ['日出光', '黄金时刻（晨）', '黄金时刻（昏）', '蓝调时刻（晨）', '蓝调时刻（昏）', '正午硬光', '夜间人工光'],
    光位: ['顺光', '侧顺光', '正侧光', '侧逆光', '逆光', '顶光', '脚光'],
    光质: ['硬光', '半硬光', '柔光', '漫射光', '斑驳光'],
    特殊现象: ['丁达尔光', '反射光斑', '镜面反射', '水面波光', '霓虹溢光', '屏幕光', '车灯光轨'],
    影子: ['长投影', '条纹影', '剪影', '投影几何'],
  },
  scene: {
    建筑语言: ['清水混凝土', '红砖', '玻璃幕墙', '钢结构', '木质结构', '石材', '马赛克', '涂料色块'],
    结构元素: [
      '拱廊',
      '券门',
      '旋转楼梯',
      '直跑楼梯',
      '天井',
      '连廊',
      '柱列',
      '阳台',
      '屋顶天台',
      '地下通道',
      '隧道',
      '桥底',
    ],
    场所: [
      '老街',
      '菜市场',
      '工厂',
      '车站月台',
      '图书馆',
      '美术馆',
      '教堂',
      '停车场',
      '便利店',
      '加油站',
      '洗衣店',
      '理发店',
      '河边栈道',
      '沙滩',
      '麦田',
      '山林',
    ],
    材质细节: ['锈迹', '水磨石', '瓷砖', '铁艺', '帆布棚', '卷帘门', '电线缠绕', '空调外机'],
    人文痕迹: ['涂鸦', '旧招牌', '霓虹招牌', '灯笼', '广告灯箱', '晾衣', '单车', '摊贩'],
  },
  color: {
    主色调: ['暖橙', '琥珀', '砖红', '玫红', '青蓝', '湖蓝', '靛蓝', '薄荷绿', '橄榄绿', '米白', '灰调', '黑白'],
    配色关系: ['互补（青橙）', '互补（红绿）', '邻近色调', '单色调', '分裂互补', '三元'],
    饱和度: ['高饱和', '中饱和', '低饱和', '近乎去色'],
    明度与对比: ['高调（明亮）', '低调（暗调）', '高对比', '低对比（灰调）'],
    色彩现象: ['霓虹紫粉', '黄昏橙蓝渐变', '雨后高饱和', '雪景冷蓝', '室内钨丝暖黄'],
  },
  composition: {
    经典法则: ['三分法', '对称式', '中心置入', '对角构图', '三角形', '黄金分割'],
    线条: ['引导线', '汇聚线', 'S 形曲线', '重复韵律', '对角线切割'],
    框与层: ['框架式', '前景遮挡', '多层纵深', '剪影作框'],
    空间: ['负空间留白', '密集满构图', '大透视夸张', '平视正交', '俯拍', '仰拍'],
    主体关系: ['人物占位', '无人的空景', '对称人物', '镜像反射'],
  },
};

export function baselineTagCount(): { total: number; byDomain: Record<string, number> } {
  const byDomain: Record<string, number> = {};
  let total = 0;
  for (const [domain, groups] of Object.entries(BASELINE_TAGS)) {
    let n = 0;
    for (const leaves of Object.values(groups)) n += leaves.length + 1; // +1 = 分组自身
    byDomain[domain] = n;
    total += n;
  }
  return { total, byDomain };
}

/** 幂等写入基线标签：已存在则跳过（重复执行不会产生重复标签） */
export function ensureBaselineTags(libraryId: string): { inserted: number } {
  const db = getDb();
  const ts = nowIso();
  let inserted = 0;

  const run = db.transaction(() => {
    for (const [domain, groups] of Object.entries(BASELINE_TAGS)) {
      let order = 10;
      for (const [groupName, leaves] of Object.entries(groups)) {
        const groupSlug = slugify(groupName);
        let groupRow = db
          .prepare('SELECT id FROM tag WHERE library_id = ? AND domain = ? AND slug = ?')
          .get(libraryId, domain, groupSlug) as { id: string } | undefined;
        if (!groupRow) {
          const id = newId();
          db.prepare(
            `INSERT INTO tag (id, library_id, domain, parent_id, name, slug, is_builtin, disabled, sort_order,
               usage_count, created_at, updated_at)
             VALUES (?,?,?,NULL,?,?,1,0,?,0,?,?)`,
          ).run(id, libraryId, domain, groupName, groupSlug, order, ts, ts);
          groupRow = { id };
          inserted += 1;
        }
        order += 10;

        for (const leaf of leaves) {
          const slug = slugify(leaf);
          const exists = db
            .prepare('SELECT id FROM tag WHERE library_id = ? AND domain = ? AND slug = ?')
            .get(libraryId, domain, slug);
          if (exists) continue;
          db.prepare(
            `INSERT INTO tag (id, library_id, domain, parent_id, name, slug, is_builtin, disabled, sort_order,
               usage_count, created_at, updated_at)
             VALUES (?,?,?,?,?,?,1,0,?,0,?,?)`,
          ).run(newId(), libraryId, domain, groupRow.id, leaf, slug, order, ts, ts);
          order += 10;
          inserted += 1;
        }
      }
    }
  });
  run();
  return { inserted };
}

/** 质量门：seed 后不得存在任何业务数据（文档 18.4） */
export function businessDataCounts(): Record<string, number> {
  const db = getDb();
  const tables = ['inspiration', 'spot', 'place', 'album', 'shoot_plan', 'shoot_result', 'repro_window'];
  const out: Record<string, number> = {};
  for (const table of tables) {
    out[table] = (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  }
  return out;
}
