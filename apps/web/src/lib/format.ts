import type { FuzzLevel, HitLevel, InspirationStatus, WindowVerdict } from '@flil/shared';

export function fmtDateTime(iso: string | null | undefined, tz: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: tz,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export function fmtTime(iso: string | null | undefined, tz: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export function fmtDate(iso: string | null | undefined, tz: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

export function weekday(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: tz, weekday: 'short' }).format(new Date(iso));
}

export const VERDICT_META: Record<WindowVerdict, { color: string; label: string; bg: string }> = {
  good: { color: '#1f7a44', label: '可拍', bg: '#e6f4ec' },
  marginal: { color: '#9a6b00', label: '勉强', bg: '#fdf3dd' },
  bad: { color: '#7a7a7a', label: '不可拍', bg: '#f0f0f0' },
};

export const STATUS_META: Record<InspirationStatus, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'default' },
  tagging: { label: '待打标', color: 'blue' },
  timing_missing: { label: '待补条件', color: 'orange' },
  ready: { label: '已就绪', color: 'green' },
  scheduled: { label: '已接单', color: 'cyan' },
  shot: { label: '已实拍', color: 'purple' },
  archived: { label: '已归档', color: 'default' },
  dropped: { label: '已放弃', color: 'default' },
};

export const HIT_LABEL: Record<HitLevel, string> = {
  hit: '拍到了',
  partial: '差一点',
  miss: '没拍成',
};

export const FUZZ_LABEL: Record<FuzzLevel, string> = {
  exact: '精确坐标（仅自己）',
  g100: '约 100m',
  g500: '约 500m',
  g1k: '约 1km',
  neighborhood: '街区',
  district: '行政区',
};

export function hitRateText(rate: number, fills: number): string {
  if (!fills) return '暂无回填';
  return `${(rate * 100).toFixed(0)}%（${fills} 次回填）`;
}

export function relative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const unit = abs < 3600000 ? '分钟' : abs < 86400000 ? '小时' : '天';
  const value = Math.round(abs / (unit === '分钟' ? 60000 : unit === '小时' ? 3600000 : 86400000));
  return diff >= 0 ? `${value} ${unit}后` : `${value} ${unit}前`;
}
