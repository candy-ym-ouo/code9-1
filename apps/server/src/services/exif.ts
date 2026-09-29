/**
 * 极简 EXIF 解析：只取本项目需要的三样东西
 *  1) DateTimeOriginal（拍摄时间）
 *  2) 是否存在 GPS IFD（hasGpsExif，仅记录布尔值，不落库原始坐标）
 *  3) 相机/镜头/曝光参数
 */

export interface ExifInfo {
  shotAt: Date | null;
  hasGps: boolean;
  cameraModel: string | null;
  lens: string | null;
  iso: number | null;
  aperture: string | null;
  shutter: string | null;
  orientation: number | null;
}

const EMPTY: ExifInfo = {
  shotAt: null,
  hasGps: false,
  cameraModel: null,
  lens: null,
  iso: null,
  aperture: null,
  shutter: null,
  orientation: null,
};

type Entry = { tag: number; type: number; count: number; valueOffset: number };

const TYPE_SIZE: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8,
};

function readEntries(buf: Buffer, ifdOffset: number, little: boolean): Entry[] {
  if (ifdOffset + 2 > buf.length) return [];
  const count = little ? buf.readUInt16LE(ifdOffset) : buf.readUInt16BE(ifdOffset);
  const entries: Entry[] = [];
  for (let i = 0; i < count; i += 1) {
    const base = ifdOffset + 2 + i * 12;
    if (base + 12 > buf.length) break;
    entries.push({
      tag: little ? buf.readUInt16LE(base) : buf.readUInt16BE(base),
      type: little ? buf.readUInt16LE(base + 2) : buf.readUInt16BE(base + 2),
      count: little ? buf.readUInt32LE(base + 4) : buf.readUInt32BE(base + 4),
      valueOffset: base + 8,
    });
  }
  return entries;
}

function readValue(buf: Buffer, entry: Entry, little: boolean): Buffer | number | null {
  const size = (TYPE_SIZE[entry.type] ?? 1) * entry.count;
  if (size <= 4) {
    return buf.subarray(entry.valueOffset, entry.valueOffset + size);
  }
  const off = little ? buf.readUInt32LE(entry.valueOffset) : buf.readUInt32BE(entry.valueOffset);
  if (off + size > buf.length) return null;
  return buf.subarray(off, off + size);
}

function ascii(buf: Buffer, entry: Entry, little: boolean): string | null {
  const v = readValue(buf, entry, little);
  if (!(v instanceof Buffer)) return null;
  const s = v.toString('latin1').replace(/\0+$/, '').trim();
  return s.length ? s : null;
}

function unsigned(buf: Buffer, entry: Entry, little: boolean): number | null {
  const v = readValue(buf, entry, little);
  if (v instanceof Buffer) {
    if (v.length >= 4) return little ? v.readUInt32LE(0) : v.readUInt32BE(0);
    if (v.length >= 2) return little ? v.readUInt16LE(0) : v.readUInt16BE(0);
    return v.length ? v[0] : null;
  }
  return typeof v === 'number' ? v : null;
}

function rational(buf: Buffer, entry: Entry, little: boolean): number | null {
  const v = readValue(buf, entry, little);
  if (!(v instanceof Buffer) || v.length < 8) return null;
  const num = little ? v.readUInt32LE(0) : v.readUInt32BE(0);
  const den = little ? v.readUInt32LE(4) : v.readUInt32BE(4);
  if (!den) return null;
  return num / den;
}

function parseExifDate(value: string | null): Date | null {
  if (!value) return null;
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  // EXIF 时间是"相机本地时间"，此处置为 UTC 中立值，调用方按机位时区解释
  return new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])),
  );
}

export function parseExif(raw: Buffer | undefined | null): ExifInfo {
  if (!raw || raw.length < 8) return { ...EMPTY };
  try {
    let offset = 0;
    if (raw.length > 6 && raw[0] === 0x45 && raw[1] === 0x78 && raw[2] === 0x69 && raw[3] === 0x66) {
      offset = 6; // "Exif\0\0"
    }
    const byteOrder = raw.readUInt16BE(offset);
    const little = byteOrder === 0x4949;
    if (!little && byteOrder !== 0x4d4d) return { ...EMPTY };

    const ifd0Offset = little ? raw.readUInt32LE(offset + 4) : raw.readUInt32BE(offset + 4);
    const ifd0 = readEntries(raw, offset + ifd0Offset, little);
    const info: ExifInfo = { ...EMPTY };

    let exifIfdOffset: number | null = null;
    for (const e of ifd0) {
      if (e.tag === 0x010f) info.cameraModel = ascii(raw, e, little);
      if (e.tag === 0x0112) info.orientation = unsigned(raw, e, little);
      if (e.tag === 0x8769) {
        const v = readValue(raw, e, little);
        if (v instanceof Buffer && v.length >= 4) exifIfdOffset = little ? v.readUInt32LE(0) : v.readUInt32BE(0);
      }
      if (e.tag === 0x8825) info.hasGps = true;
    }

    if (exifIfdOffset !== null) {
      const exifIfd = readEntries(raw, offset + exifIfdOffset, little);
      for (const e of exifIfd) {
        if (e.tag === 0x9003) info.shotAt = parseExifDate(ascii(raw, e, little));
        if (e.tag === 0x9004 && !info.shotAt) info.shotAt = parseExifDate(ascii(raw, e, little));
        if (e.tag === 0x8827) info.iso = unsigned(raw, e, little);
        if (e.tag === 0x829a) {
          const v = rational(raw, e, little);
          if (v !== null) info.shutter = v >= 1 ? `${v}s` : `1/${Math.round(1 / v)}s`;
        }
        if (e.tag === 0x9202) {
          const v = rational(raw, e, little);
          if (v !== null) info.aperture = `f/${v.toFixed(1)}`;
        }
        if (e.tag === 0xa434) info.lens = ascii(raw, e, little);
      }
    }
    return info;
  } catch {
    return { ...EMPTY };
  }
}
