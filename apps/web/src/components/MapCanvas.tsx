import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Space, Typography } from 'antd';
import { projectMercator, unprojectMercator } from '@flil/shared';

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
  kind: 'precise' | 'fuzzy';
  color?: string;
}

interface Props {
  points: MapPoint[];
  height?: number;
  /** 点击空白处拾取坐标（用于新建机位） */
  onPick?: (lat: number, lng: number) => void;
  picked?: { lat: number; lng: number } | null;
}

const TILE_URL = (import.meta.env.VITE_MAP_TILE_URL as string | undefined) ?? '';
const TILE_SIZE = 256;

/**
 * 轻量自绘地图（Web Mercator + 可配置瓦片源）。
 * 不依赖地图 SDK：瓦片留空时只画经纬网格，离线也能用；
 * 这是文档 7.1 里"地图瓦片源放 .env、可替换"的实现方式。
 */
export function MapCanvas({ points, height = 340, onPick, picked }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [center, setCenter] = useState({ lat: 31.23, lng: 121.47 });
  const [zoom, setZoom] = useState(12);
  const [size, setSize] = useState({ w: 800, h: height });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: height });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);

  useEffect(() => {
    if (!points.length) return;
    const lat = points.reduce((a, p) => a + p.lat, 0) / points.length;
    const lng = points.reduce((a, p) => a + p.lng, 0) / points.length;
    setCenter({ lat, lng });
  }, [points]);

  const project = useMemo(() => {
    const scale = TILE_SIZE * 2 ** zoom;
    const c = projectMercator(center);
    return (lat: number, lng: number) => {
      const p = projectMercator({ lat, lng });
      return { x: (p.x - c.x) * scale + size.w / 2, y: (p.y - c.y) * scale + size.h / 2 };
    };
  }, [center, zoom, size]);

  const tiles = useMemo(() => {
    if (!TILE_URL) return [];
    const scale = TILE_SIZE * 2 ** zoom;
    const c = projectMercator(center);
    const topLeftPx = { x: c.x * scale - size.w / 2, y: c.y * scale - size.h / 2 };
    const minX = Math.floor(topLeftPx.x / TILE_SIZE);
    const maxX = Math.floor((topLeftPx.x + size.w) / TILE_SIZE);
    const minY = Math.max(0, Math.floor(topLeftPx.y / TILE_SIZE));
    const maxY = Math.floor((topLeftPx.y + size.h) / TILE_SIZE);
    const out: { key: string; url: string; left: number; top: number }[] = [];
    const max = 2 ** zoom;
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        if (y < 0 || y >= max) continue;
        const wrapped = ((x % max) + max) % max;
        const sub = ['a', 'b', 'c'][Math.abs(x + y) % 3];
        out.push({
          key: `${zoom}/${x}/${y}`,
          url: TILE_URL.replace('{s}', sub).replace('{z}', String(zoom)).replace('{x}', String(wrapped)).replace('{y}', String(y)),
          left: x * TILE_SIZE - topLeftPx.x,
          top: y * TILE_SIZE - topLeftPx.y,
        });
      }
    }
    return out;
  }, [TILE_URL, center, zoom, size]);

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!onPick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const scale = TILE_SIZE * 2 ** zoom;
    const c = projectMercator(center);
    const px = (x - size.w / 2) / scale + c.x;
    const py = (y - size.h / 2) / scale + c.y;
    const ll = unprojectMercator(px, py);
    onPick(Number(ll.lat.toFixed(5)), Number(ll.lng.toFixed(5)));
  }

  return (
    <div>
      <div
        ref={ref}
        data-testid="map-canvas"
        onClick={handleClick}
        style={{
          position: 'relative',
          height,
          overflow: 'hidden',
          borderRadius: 8,
          background: '#eef2f5',
          border: '1px solid #dcdcdc',
          cursor: onPick ? 'crosshair' : 'default',
        }}
      >
        {tiles.map((t) => (
          <img
            key={t.key}
            src={t.url}
            alt=""
            width={TILE_SIZE}
            height={TILE_SIZE}
            style={{ position: 'absolute', left: t.left, top: t.top, pointerEvents: 'none', opacity: 0.95 }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ))}

        {/* 装饰层不接收指针事件，否则会挡住地图上的拾取点击 */}
        <svg
          width={size.w}
          height={size.h}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          {!TILE_URL
            ? Array.from({ length: 12 }).map((_, i) => (
                <line
                  key={`h${i}`}
                  x1={0}
                  x2={size.w}
                  y1={(i * size.h) / 12}
                  y2={(i * size.h) / 12}
                  stroke="rgba(47,111,143,0.12)"
                />
              ))
            : null}
          {points.map((p) => {
            const pos = project(p.lat, p.lng);
            const r = p.kind === 'fuzzy' ? 26 : 7;
            return (
              <g key={p.id}>
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={r}
                  fill={p.kind === 'fuzzy' ? 'rgba(47,111,143,0.15)' : 'transparent'}
                  stroke={p.color ?? '#2f6f8f'}
                  strokeDasharray={p.kind === 'fuzzy' ? '4 3' : undefined}
                />
                {p.kind === 'precise' ? <circle cx={pos.x} cy={pos.y} r={4} fill={p.color ?? '#2f6f8f'} /> : null}
                <text x={pos.x + 8} y={pos.y - 8} fontSize={12} fill="#333">
                  {p.label}
                </text>
              </g>
            );
          })}
          {picked
            ? (() => {
                const pos = project(picked.lat, picked.lng);
                return <circle cx={pos.x} cy={pos.y} r={6} fill="#fa541c" />;
              })()
            : null}
        </svg>

        <Space style={{ position: 'absolute', right: 8, bottom: 8 }}>
          <Button size="small" onClick={() => setZoom((z) => Math.min(18, z + 1))}>
            +
          </Button>
          <Button size="small" onClick={() => setZoom((z) => Math.max(3, z - 1))}>
            −
          </Button>
        </Space>
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {TILE_URL
          ? '瓦片源来自 VITE_MAP_TILE_URL；模糊点只画一个聚合圆，不显示方向与向量。'
          : '未配置瓦片源：只画经纬网格与点位（离线可用）。'}
        {onPick ? ' 点击地图可拾取坐标。' : ''}
      </Typography.Text>
    </div>
  );
}
