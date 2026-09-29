import { describe, expect, it } from 'vitest';
import {
  angleWithin,
  bearingFromArrow,
  expectedAzimuth,
  paletteSimilarity,
  validateGeometry,
} from '@flil/shared';

describe('标注几何校验（坐标必须归一化在 [0,1]）', () => {
  it('接受合法的光位箭头', () => {
    expect(
      validateGeometry('light_arrow', {
        from: { x: 0.1, y: 0.2 },
        to: { x: 0.7, y: 0.6 },
      }).ok,
    ).toBe(true);
  });

  it('拒绝越界的点', () => {
    const r = validateGeometry('light_arrow', { from: { x: 1.4, y: 0.2 }, to: { x: 0.7, y: 0.6 } });
    expect(r.ok).toBe(false);
  });

  it('拒绝起止点重合的箭头', () => {
    expect(validateGeometry('light_arrow', { from: { x: 0.5, y: 0.5 }, to: { x: 0.5, y: 0.5 } }).ok).toBe(false);
  });

  it('拒绝少于 2 个点的引导线', () => {
    expect(validateGeometry('leading_line', { points: [{ x: 0.1, y: 0.1 }] }).ok).toBe(false);
  });

  it('拒绝超出画面的框架框', () => {
    expect(validateGeometry('frame', { rect: { x: 0.8, y: 0.2, w: 0.5, h: 0.3 } }).ok).toBe(false);
  });

  it('接受合法的框架框', () => {
    expect(validateGeometry('frame', { rect: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 } }).ok).toBe(true);
  });
});

describe('光位角 → 期望太阳方位角', () => {
  it('顺光（光位角 0°）+ 朝西 265° → 期望方位角 265°', () => {
    expect(expectedAzimuth(265, 0)).toBe(265);
  });

  it('逆光（光位角 180°）+ 朝西 265° → 期望方位角 85°', () => {
    expect(expectedAzimuth(265, 180)).toBe(85);
  });

  it('角度环绕：350° + 30° = 20°', () => {
    expect(expectedAzimuth(350, 30)).toBe(20);
  });

  it('容差判断跨越 0° 边界仍然正确', () => {
    expect(angleWithin(2, 358, 10)).toBe(true);
    expect(angleWithin(30, 358, 10)).toBe(false);
  });

  it('从箭头的起止点推算光位角', () => {
    // 箭头指向画面左侧偏上 → 光源来自左侧
    const bearing = bearingFromArrow({ x: 0.8, y: 0.5 }, { x: 0.2, y: 0.5 });
    expect(bearing).toBeCloseTo(270, 0);
  });
});

describe('主色相似度', () => {
  it('同一组主色相似度为 1', () => {
    const p = [
      { hex: '#2b4a6f', ratio: 0.6 },
      { hex: '#e0a44a', ratio: 0.4 },
    ];
    expect(paletteSimilarity(p, p)).toBeCloseTo(1, 2);
  });

  it('暖色与冷色相似度明显更低', () => {
    const warm = [{ hex: '#e0762b', ratio: 1 }];
    const cool = [{ hex: '#2b4a6f', ratio: 1 }];
    expect(paletteSimilarity(warm, cool)).toBeLessThan(0.5);
  });
});
