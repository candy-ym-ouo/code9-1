import sharp from 'sharp';
import { colorDistance, rgbToHex, type PaletteColor } from '@flil/shared';

/**
 * 主色提取（文档 11.4）：缩小到 64×64 → 剔除过暗/过曝 → 每通道 4bit 量化 → 合并相近色 → 取前 6。
 * 纯统计方法，不引入模型推理。
 */
export async function extractPalette(filePath: string): Promise<PaletteColor[]> {
  const { data, info } = await sharp(filePath)
    .resize(64, 64, { fit: 'inside' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const total = info.width * info.height;
  const buckets = new Map<string, { r: number; g: number; b: number; count: number }>();

  for (let i = 0; i < total; i += 1) {
    const r = data[i * channels];
    const g = data[i * channels + 1];
    const b = data[i * channels + 2];
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (lum < 0.05 || lum > 0.95) continue;
    const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.count += 1;
    } else {
      buckets.set(key, { r, g, b, count: 1 });
    }
  }

  const sorted = [...buckets.values()]
    .map((b) => ({ hex: rgbToHex(b.r / b.count, b.g / b.count, b.b / b.count), count: b.count }))
    .sort((a, b) => b.count - a.count);

  const merged: PaletteColor[] = [];
  for (const c of sorted) {
    const near = merged.find((m) => colorDistance(m.hex, c.hex) < 0.08);
    if (near) continue;
    merged.push({ hex: c.hex, ratio: c.count });
    if (merged.length >= 6) break;
  }

  const sum = merged.reduce((acc, m) => acc + m.ratio, 0) || 1;
  return merged.map((m) => ({ hex: m.hex, ratio: Number((m.ratio / sum).toFixed(4)) }));
}
