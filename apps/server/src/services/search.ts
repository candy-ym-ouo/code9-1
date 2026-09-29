import {
  bboxContains,
  distanceKm,
  paletteSimilarity,
  type PaletteColor,
  type SearchRelaxation,
  type SearchResult,
} from '@flil/shared';
import { getDb, parseJson } from '../db.js';
import { toInspirationDto, type InspirationRow, type SerializeContext } from './serialization.js';
import { paletteOf, type AssetRow } from './assets.js';
import { loadSpotGeom } from './windowEngine.js';

export interface SearchParams {
  q?: string;
  status?: string;
  tagIds?: string[];
  tagMode?: 'any' | 'all';
  anchors?: string[];
  phenomena?: string[];
  season?: number[];
  hitRateMin?: number;
  minFillCount?: number;
  placeId?: string;
  bbox?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  near?: { lat: number; lng: number; radiusKm?: number };
  paletteHex?: string;
  similarToAssetId?: string;
  excludeAlbum?: string;
  sort?: 'recent' | 'hit_rate' | 'window_heat' | 'distance' | 'rarity';
  page?: number;
  size?: number;
}

interface Candidate {
  row: InspirationRow;
  distance: number | null;
  similarity?: number;
}

function fuzzPoint(geom: { lat: number; lng: number }): { lat: number; lng: number } {
  // 非 owner 的地理过滤用模糊点（约 500m 量化到 0.005°），与模糊化输出保持一致
  return { lat: Math.round(geom.lat / 0.005) * 0.005, lng: Math.round(geom.lng / 0.005) * 0.005 };
}

/**
 * 组合检索（文档 15.1）：SQL 收敛候选 → JS 做空间与色彩相似。
 * member 的地理过滤使用模糊坐标，避免精确位置成为旁路（文档 13.5）。
 */
export function search(libraryId: string, ctx: SerializeContext, params: SearchParams): SearchResult {
  const db = getDb();
  const where: string[] = ['i.library_id = ?', 'i.deleted_at IS NULL'];
  const args: (string | number)[] = [libraryId];

  if (params.status) {
    const statuses = params.status
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (statuses.length) {
      where.push(`i.status IN (${statuses.map(() => '?').join(',')})`);
      args.push(...statuses);
    }
  }

  if (params.season?.length) {
    where.push(`(${params.season.map(() => 'i.season_tags LIKE ?').join(' OR ')})`);
    for (const m of params.season) args.push(`%"${m}"%`);
  }

  if (params.placeId) {
    where.push('s.place_id = ?');
    args.push(params.placeId);
  }
  if (params.hitRateMin !== undefined) {
    where.push('i.hit_rate >= ?');
    args.push(params.hitRateMin);
  }
  if (params.minFillCount !== undefined) {
    where.push('(i.hit_count + i.partial_count + i.miss_count) >= ?');
    args.push(params.minFillCount);
  }

  if (params.tagIds?.length) {
    if (params.tagMode === 'all') {
      where.push(
        `(SELECT COUNT(DISTINCT tag_id) FROM inspiration_tag WHERE inspiration_id = i.id AND tag_id IN (${params.tagIds
          .map(() => '?')
          .join(',')})) = ?`,
      );
      args.push(...params.tagIds, params.tagIds.length);
    } else {
      where.push(
        `EXISTS (SELECT 1 FROM inspiration_tag WHERE inspiration_id = i.id AND tag_id IN (${params.tagIds
          .map(() => '?')
          .join(',')}))`,
      );
      args.push(...params.tagIds);
    }
  }

  if (params.anchors?.length) {
    where.push(`t.time_anchor IN (${params.anchors.map(() => '?').join(',')})`);
    args.push(...params.anchors);
  }

  if (params.phenomena?.length) {
    where.push(`(${params.phenomena.map(() => 't.weather_profile LIKE ?').join(' OR ')})`);
    for (const p of params.phenomena) args.push(`%"${p}"%`);
  }

  if (params.excludeAlbum) {
    where.push('NOT EXISTS (SELECT 1 FROM album_item WHERE album_id = ? AND inspiration_id = i.id)');
    args.push(params.excludeAlbum);
  }

  if (params.q && params.q.trim()) {
    where.push(
      `(i.id IN (SELECT inspiration_id FROM inspiration_fts WHERE inspiration_fts MATCH ?) OR i.title LIKE ?)`,
    );
    args.push(`${params.q.trim().replace(/"/g, '')}*`, `%${params.q.trim()}%`);
  }

  const sql = `
    SELECT i.* FROM inspiration i
    LEFT JOIN spot s ON s.id = i.spot_id
    LEFT JOIN timing t ON t.inspiration_id = i.id
    WHERE ${where.join(' AND ')}
    ORDER BY i.updated_at DESC
    LIMIT 500`;

  const rows = db.prepare(sql).all(...args) as InspirationRow[];
  let candidates: Candidate[] = [];

  for (const row of rows) {
    let distance: number | null = null;
    if (params.bbox || params.near) {
      if (!row.spot_id) continue;
      const geom = loadSpotGeom(row.spot_id);
      if (!geom) continue;
      const point = ctx.role === 'owner' ? { lat: geom.lat, lng: geom.lng } : fuzzPoint(geom);
      if (params.bbox && !bboxContains(params.bbox, point)) continue;
      if (params.near) {
        distance = distanceKm(params.near, point);
        if (params.near.radiusKm && distance > params.near.radiusKm) continue;
      }
    }
    candidates.push({ row, distance });
  }

  const targetPalette = resolvePalette(params);
  if (targetPalette) {
    candidates = candidates
      .map((c) => {
        const asset = db
          .prepare('SELECT * FROM asset WHERE inspiration_id = ? ORDER BY created_at ASC LIMIT 1')
          .get(c.row.id) as AssetRow | undefined;
        return { ...c, similarity: asset ? paletteSimilarity(targetPalette, paletteOf(asset)) : 0 };
      })
      .filter((c) => (c.similarity ?? 0) >= 0.35)
      .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
  }

  const sorted = sortCandidates(candidates, params.sort ?? 'recent');
  const page = params.page ?? 1;
  const size = params.size ?? 24;
  const paged = sorted.slice((page - 1) * size, page * size);

  return {
    items: paged.map((c) => toInspirationDto(c.row, ctx, { withWindowSummary: false })),
    total: sorted.length,
    relaxed: [],
  };
}

function resolvePalette(params: SearchParams): PaletteColor[] | null {
  const db = getDb();
  if (params.similarToAssetId) {
    const asset = db.prepare('SELECT * FROM asset WHERE id = ?').get(params.similarToAssetId) as
      | AssetRow
      | undefined;
    if (asset) return parseJson<PaletteColor[]>(asset.palette, []);
  }
  if (params.paletteHex) return [{ hex: params.paletteHex, ratio: 1 }];
  return null;
}

function goodWindowCount(inspirationId: string): number {
  const until = new Date(Date.now() + 30 * 86400000).toISOString();
  return (
    getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM repro_window WHERE inspiration_id = ? AND verdict = 'good' AND start_at <= ?`,
      )
      .get(inspirationId, until) as { n: number }
  ).n;
}

function sortCandidates(items: Candidate[], sort: NonNullable<SearchParams['sort']>): Candidate[] {
  const copy = [...items];
  switch (sort) {
    case 'hit_rate':
      return copy.sort(
        (a, b) =>
          b.row.hit_rate - a.row.hit_rate ||
          b.row.hit_count +
            b.row.partial_count +
            b.row.miss_count -
            (a.row.hit_count + a.row.partial_count + a.row.miss_count),
      );
    case 'distance':
      return copy.sort((a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9));
    case 'window_heat':
      return copy.sort((a, b) => goodWindowCount(b.row.id) - goodWindowCount(a.row.id));
    case 'rarity':
      return copy.sort((a, b) => goodWindowCount(a.row.id) - goodWindowCount(b.row.id));
    default:
      return copy.sort((a, b) => (a.row.updated_at < b.row.updated_at ? 1 : -1));
  }
}

interface Relaxation {
  field: string;
  from: string;
  to: string;
  apply: (p: SearchParams) => void;
}

/** 放宽优先级（文档 15.3）：命中率 → 天气现象 → 时段 → 标签模式 → 季节 → 地理范围 */
function relaxationPlan(params: SearchParams): Relaxation[] {
  return [
    {
      field: 'hitRateMin',
      from: `命中率 ≥ ${params.hitRateMin ?? '（未设）'}`,
      to: '忽略命中率限制',
      apply: (p) => {
        delete p.hitRateMin;
        delete p.minFillCount;
      },
    },
    {
      field: 'phenomena',
      from: `天气现象 ${(params.phenomena ?? []).join('/')}`,
      to: '忽略天气现象',
      apply: (p) => {
        delete p.phenomena;
      },
    },
    {
      field: 'anchors',
      from: `时段 ${(params.anchors ?? []).join('/')}`,
      to: '忽略时段',
      apply: (p) => {
        delete p.anchors;
      },
    },
    {
      field: 'tagMode',
      from: '标签全部命中（all）',
      to: '标签任一命中（any）',
      apply: (p) => {
        p.tagMode = 'any';
      },
    },
    {
      field: 'season',
      from: `季节 ${(params.season ?? []).join('/')} 月`,
      to: '忽略季节',
      apply: (p) => {
        delete p.season;
      },
    },
    {
      field: 'bbox',
      from: '地图框选 / 半径',
      to: '半径扩大 2 倍',
      apply: (p) => {
        if (p.near) p.near = { ...p.near, radiusKm: (p.near.radiusKm ?? 10) * 2 };
        delete p.bbox;
      },
    },
  ];
}

/** 零结果兜底（文档 6.6 / 15.3）：必返回"放宽了什么"，不允许静默放宽。 */
export function searchWithFallback(
  libraryId: string,
  ctx: SerializeContext,
  params: SearchParams,
): SearchResult {
  const direct = search(libraryId, ctx, params);
  if (direct.total > 0) return direct;

  const applied: SearchRelaxation[] = [];
  const working: SearchParams = {
    ...params,
    tagIds: params.tagIds ? [...params.tagIds] : undefined,
    phenomena: params.phenomena ? [...params.phenomena] : undefined,
    anchors: params.anchors ? [...params.anchors] : undefined,
    season: params.season ? [...params.season] : undefined,
  };

  for (const step of relaxationPlan(params)) {
    step.apply(working);
    applied.push({
      field: step.field,
      from: step.from,
      to: step.to,
      note: `已放宽：${step.from} → ${step.to}`,
    });
    const result = search(libraryId, ctx, working);
    if (result.total > 0) return { ...result, relaxed: applied };
  }

  return {
    items: [],
    total: 0,
    relaxed: applied,
    suggestions: {
      tagIds: [],
      tagNames: [],
      message:
        '全部条件放宽后仍无结果。可以：① 新建一张卡；② 检查是否要新增标签；③ 用「以图找相似」换个入口；④ 去收件箱把未整理的卡补上标签。',
    },
  };
}
