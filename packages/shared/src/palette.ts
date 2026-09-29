export interface PaletteColor {
  hex: string;
  ratio: number;
}

export function parseHex(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = Number.parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function colorDistance(a: string, b: string): number {
  const x = parseHex(a);
  const y = parseHex(b);
  // 近似感知权重（红均值加权，比裸欧氏更接近人眼判断）
  const rMean = (x.r + y.r) / 2;
  const dr = x.r - y.r;
  const dg = x.g - y.g;
  const db = x.b - y.b;
  const d =
    (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db;
  return Math.sqrt(d / 6) / 255;
}

export function brightness(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function saturation(hex: string): number {
  const { r, g, b } = parseHex(hex);
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max === 0) return 0;
  const l = (max + min) / 2;
  return (max - min) / (1 - Math.abs(2 * l - 1) || 1);
}

/**
 * 两个主色序列的相似度（1 = 完全一致）。
 * 按占比加权做最小匹配距离，再叠加亮度/饱和度差异惩罚。
 */
export function paletteSimilarity(a: PaletteColor[], b: PaletteColor[]): number {
  if (!a.length || !b.length) return 0;
  let weighted = 0;
  let totalWeight = 0;
  for (const ca of a) {
    let best = 1;
    for (const cb of b) {
      const d = colorDistance(ca.hex, cb.hex);
      if (d < best) best = d;
    }
    weighted += best * ca.ratio;
    totalWeight += ca.ratio;
  }
  const base = totalWeight > 0 ? weighted / totalWeight : 1;
  const domA = a.reduce((m, c) => (c.ratio > m.ratio ? c : m), a[0]).hex;
  const domB = b.reduce((m, c) => (c.ratio > m.ratio ? c : m), b[0]).hex;
  const penalty =
    0.3 * Math.abs(brightness(domA) - brightness(domB)) +
    0.2 * Math.abs(saturation(domA) - saturation(domB));
  return Math.max(0, Math.min(1, 1 - base - penalty));
}
