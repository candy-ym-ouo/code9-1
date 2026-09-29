import { describe, expect, it } from 'vitest';
import type { TimingDto } from '@flil/shared';
import { computeDay } from '../src/services/windowEngine.js';
import type { HourlyForecast } from '../src/services/weather.js';

const SPOT = { id: 'spot1', lat: 31.2471, lng: 121.4462, camera_bearing: 265, tz: 'Asia/Shanghai' };
const DATE = '2026-10-11';

function timing(patch: Partial<TimingDto> = {}): TimingDto {
  return {
    timeAnchor: 'sunset_minus',
    anchorOffsetMin: 40,
    elevationRange: [-4, 10],
    azimuthRange: null,
    azimuthTolerance: 15,
    windowToleranceMin: 12,
    weatherProfile: {},
    seasonWindow: null,
    notes: null,
    ...patch,
  };
}

/** 确定性逐小时预报，避免测试依赖外网 */
function forecast(overrides: Partial<HourlyForecast> = {}): HourlyForecast[] {
  const out: HourlyForecast[] = [];
  const start = new Date('2026-10-11T00:00:00Z');
  for (let i = 0; i < 48; i += 1) {
    out.push({
      time: new Date(start.getTime() + i * 3600000).toISOString(),
      cloudCoverPct: 30,
      precipProbPct: 5,
      precipMm: 0,
      visibilityKm: 20,
      windSpeedMs: 3,
      tempC: 20,
      humidityPct: 55,
      snowfallCm: 0,
      ...overrides,
    });
  }
  return out;
}

describe('窗口判定：天文项', () => {
  it('条件宽松时判为 good', () => {
    const r = computeDay(SPOT, timing(), DATE, forecast());
    expect(r.verdict).toBe('good');
    expect(r.reasons.some((x) => x.code === 'ANCHOR_RESOLVED')).toBe(true);
  });

  it('仰角区间不可能满足时判 bad 并给出实测值', () => {
    const r = computeDay(SPOT, timing({ elevationRange: [60, 70] }), DATE, forecast());
    expect(r.verdict).toBe('bad');
    const reason = r.reasons.find((x) => x.code === 'ELEVATION_MISS');
    expect(reason?.level).toBe('bad');
    expect(reason?.text).toMatch(/实测/);
  });

  it('方位角不可能满足时判 bad（光位不对）', () => {
    const r = computeDay(SPOT, timing({ azimuthRange: [30, 50] }), DATE, forecast());
    expect(r.verdict).toBe('bad');
    expect(r.reasons.some((x) => x.code === 'AZIMUTH_MISS')).toBe(true);
  });

  it('方位角正确时命中并给出实测区间', () => {
    const r = computeDay(SPOT, timing({ azimuthRange: [255, 275], azimuthTolerance: 20 }), DATE, forecast());
    expect(r.verdict).toBe('good');
    expect(r.reasons.some((x) => x.code === 'AZIMUTH_OK')).toBe(true);
  });

  it('季节窗口之外直接 bad', () => {
    const r = computeDay(SPOT, timing({ seasonWindow: { fromMonth: 6, toMonth: 8 } }), DATE, forecast());
    expect(r.verdict).toBe('bad');
    expect(r.reasons[0].code).toBe('OUT_OF_SEASON');
  });
});

describe('窗口判定：天气项（硬性 vs 软性）', () => {
  it('硬性项（降水概率）不满足 → bad', () => {
    const r = computeDay(
      SPOT,
      timing({ weatherProfile: { precipProbPctMax: 20, hardRequirements: ['precipProbPctMax'] } }),
      DATE,
      forecast({ precipProbPct: 80 }),
    );
    expect(r.verdict).toBe('bad');
    expect(r.reasons.some((x) => x.code === 'PRECIP_FAIL')).toBe(true);
  });

  it('软性项（云量）偏差 → 只降到 marginal，不判死', () => {
    const r = computeDay(
      SPOT,
      timing({ weatherProfile: { cloudCoverPct: { min: 0, max: 20 } } }),
      DATE,
      forecast({ cloudCoverPct: 70 }),
    );
    expect(r.verdict).toBe('marginal');
    expect(r.reasons.some((x) => x.code === 'CLOUD_MARGINAL')).toBe(true);
  });

  it('天气源不可用 → 降级且最高只能到 marginal，并明确标注', () => {
    const r = computeDay(SPOT, timing(), DATE, []);
    expect(r.verdict).toBe('marginal');
    expect(r.reasons.some((x) => x.code === 'WEATHER_DEGRADED')).toBe(true);
    expect(r.episode?.degraded).toBe(true);
  });

  it('每个判定都带可复算的理由（实际值与目标值）', () => {
    const r = computeDay(
      SPOT,
      timing({
        weatherProfile: {
          cloudCoverPct: { min: 20, max: 60 },
          precipProbPctMax: 20,
          visibilityKmMin: 10,
          windSpeedMax: 5,
          hardRequirements: ['precipProbPctMax'],
        },
      }),
      DATE,
      forecast({ windSpeedMs: 9 }),
    );
    const text = r.reasons.map((x) => x.text).join(' | ');
    expect(text).toMatch(/云量 \d+%/);
    expect(text).toMatch(/降水概率 \d+%/);
    expect(text).toMatch(/风速 [\d.]+ m\/s/);
    expect(r.verdict).toBe('marginal');
  });

  it('窗口过短（±1 分钟）会被标为 WINDOW_TOO_SHORT 并降为 marginal', () => {
    const r = computeDay(
      SPOT,
      timing({ timeAnchor: 'sunset', windowToleranceMin: 1 }),
      DATE,
      forecast(),
    );
    const codes = r.reasons.map((x) => x.code);
    expect(codes).toContain('WINDOW_TOO_SHORT');
    expect(r.verdict).toBe('marginal');
  });

  it('短窗口落在两个整点之间时仍能拿到天气（不会静默跳过硬性项）', () => {
    // 只给整点数据，窗口 20 分钟且不跨整点
    const hourly = forecast({ precipProbPct: 90 });
    const r = computeDay(
      SPOT,
      timing({ windowToleranceMin: 10, weatherProfile: { precipProbPctMax: 20 } }),
      DATE,
      hourly,
    );
    const codes = r.reasons.map((x) => x.code);
    expect(codes.some((c) => c.startsWith('PRECIP'))).toBe(true);
    expect(r.verdict).toBe('bad'); // 降水概率 90% 超过硬性上限 20%
  });

  it('相邻整点的天气会被纳入判定（取更保守的一侧）', () => {
    const hourly = forecast({ precipProbPct: 5 });
    // 让窗口后的那个整点下雨
    for (const f of hourly) {
      const t = new Date(f.time);
      if (t.getUTCHours() === 9) f.precipProbPct = 95;
    }
    const r = computeDay(
      SPOT,
      timing({ windowToleranceMin: 10, weatherProfile: { precipProbPctMax: 20 } }),
      DATE,
      hourly,
    );
    const precip = r.reasons.find((x) => x.code.startsWith('PRECIP'));
    expect(precip?.text).toMatch(/9[05]%/);
  });
});
