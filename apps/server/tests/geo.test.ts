import { describe, expect, it } from 'vitest';
import {
  decodeGeohashBounds,
  distanceBand,
  distanceKm,
  encodeGeohash,
  geohashCenter,
  projectMercator,
  unprojectMercator,
} from '@flil/shared';

const SHANGHAI = { lat: 31.2471, lng: 121.4462 };

describe('geohash 与地点模糊化', () => {
  it('同一坐标编码稳定（结果恒定，不随请求漂移）', () => {
    expect(encodeGeohash(SHANGHAI, 7)).toBe(encodeGeohash(SHANGHAI, 7));
  });

  it('精度越高网格越小', () => {
    const coarse = decodeGeohashBounds(encodeGeohash(SHANGHAI, 5));
    const fine = decodeGeohashBounds(encodeGeohash(SHANGHAI, 8));
    const span = (b: { minLat: number; maxLat: number }) => b.maxLat - b.minLat;
    expect(span(fine)).toBeLessThan(span(coarse));
  });

  it('真实坐标必定落在自己所属的网格内', () => {
    for (const len of [4, 5, 6, 7, 8]) {
      const bounds = decodeGeohashBounds(encodeGeohash(SHANGHAI, len));
      expect(SHANGHAI.lat).toBeGreaterThanOrEqual(bounds.minLat);
      expect(SHANGHAI.lat).toBeLessThanOrEqual(bounds.maxLat);
      expect(SHANGHAI.lng).toBeGreaterThanOrEqual(bounds.minLng);
      expect(SHANGHAI.lng).toBeLessThanOrEqual(bounds.maxLng);
    }
  });

  it('g500 网格中心与真实点的偏差不超过半个网格对角线', () => {
    const center = geohashCenter(encodeGeohash(SHANGHAI, 7));
    const d = distanceKm(SHANGHAI, center);
    expect(d).toBeLessThan(0.15);
  });

  it('不同网格的坐标不会落到同一个模糊点上', () => {
    const a = geohashCenter(encodeGeohash({ lat: 31.2471, lng: 121.4462 }, 7));
    const b = geohashCenter(encodeGeohash({ lat: 31.3001, lng: 121.5002 }, 7));
    expect(a.lat).not.toBe(b.lat);
  });
});

describe('距离与距离区间', () => {
  it('同一点距离为 0', () => {
    expect(distanceKm(SHANGHAI, SHANGHAI)).toBeCloseTo(0, 6);
  });

  it('上海到北京约 1050–1100 km', () => {
    const d = distanceKm(SHANGHAI, { lat: 39.9042, lng: 116.4074 });
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThan(1120);
  });

  it('距离以区间文案输出，不暴露精确值（模糊坐标下）', () => {
    expect(distanceBand(0.3)).toBe('500m 内');
    expect(distanceBand(2.4)).toBe('3km 内');
    expect(distanceBand(500)).toBe('100km 以外');
  });
});

describe('墨卡托投影（前端自绘地图）', () => {
  it('投影与反投影互逆', () => {
    const p = projectMercator(SHANGHAI);
    const back = unprojectMercator(p.x, p.y);
    expect(back.lat).toBeCloseTo(SHANGHAI.lat, 6);
    expect(back.lng).toBeCloseTo(SHANGHAI.lng, 6);
  });
});
