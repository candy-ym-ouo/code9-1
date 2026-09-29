import { useEffect, useRef, useState } from 'react';
import { Button, Empty, Space, Switch, Tag, Typography } from 'antd';
import { bearingFromArrow } from '@flil/shared';

export interface DraftAnnotation {
  kind: 'light_arrow' | 'rule_of_thirds' | 'leading_line' | 'frame' | 'negative_space';
  geometry: Record<string, unknown>;
  label?: string | null;
}

interface Props {
  imageUrl: string;
  initial?: DraftAnnotation[];
  /** 图片上的光标角度限制：true 时显示三分线参考 */
  cameraBearing?: number;
  onChange: (items: DraftAnnotation[]) => void;
}

type Tool = DraftAnnotation['kind'];

const TOOL_LABEL: Record<Tool, string> = {
  light_arrow: '光位箭头',
  rule_of_thirds: '三分线交点',
  leading_line: '引导线',
  frame: '框架边界',
  negative_space: '留白区',
};

/**
 * 构图 / 光位标注编辑器（文档 10.2②）。
 * 坐标一律归一化到 [0,1]，与图片分辨率解耦；缩放不会影响已画的标注。
 */
export function AnnotationEditor({ imageUrl, initial = [], cameraBearing = 0, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [items, setItems] = useState<DraftAnnotation[]>(initial);
  const [tool, setTool] = useState<Tool>('light_arrow');
  const [showThirds, setShowThirds] = useState(true);
  const [pending, setPending] = useState<{ x: number; y: number }[]>([]);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      draw();
    };
    img.src = imageUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, pending, showThirds]);

  function draw() {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const maxW = 820;
    const scale = Math.min(1, maxW / img.naturalWidth);
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    if (showThirds) {
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 1;
      for (const f of [1 / 3, 2 / 3]) {
        ctx.beginPath();
        ctx.moveTo(w * f, 0);
        ctx.lineTo(w * f, h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, h * f);
        ctx.lineTo(w, h * f);
        ctx.stroke();
      }
    }

    for (const item of items) drawItem(ctx, item, w, h);
    for (const p of pending) {
      ctx.fillStyle = '#ffd666';
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawItem(ctx: CanvasRenderingContext2D, item: DraftAnnotation, w: number, h: number) {
    ctx.lineWidth = 2.5;
    if (item.kind === 'light_arrow') {
      const g = item.geometry as { from: { x: number; y: number }; to: { x: number; y: number } };
      ctx.strokeStyle = '#ffd666';
      ctx.beginPath();
      ctx.moveTo(g.from.x * w, g.from.y * h);
      ctx.lineTo(g.to.x * w, g.to.y * h);
      ctx.stroke();
      const angle = Math.atan2((g.to.y - g.from.y) * h, (g.to.x - g.from.x) * w);
      ctx.beginPath();
      ctx.moveTo(g.to.x * w, g.to.y * h);
      ctx.lineTo(g.to.x * w - 14 * Math.cos(angle - 0.4), g.to.y * h - 14 * Math.sin(angle - 0.4));
      ctx.lineTo(g.to.x * w - 14 * Math.cos(angle + 0.4), g.to.y * h - 14 * Math.sin(angle + 0.4));
      ctx.closePath();
      ctx.fillStyle = '#ffd666';
      ctx.fill();
      ctx.fillStyle = '#ffd666';
      ctx.font = '13px sans-serif';
      ctx.fillText(`光位 ${Math.round(item.geometry.bearingDeg as number)}°`, g.to.x * w + 6, g.to.y * h - 6);
    } else if (item.kind === 'frame' || item.kind === 'negative_space') {
      const rect = (item.geometry.rect ?? {}) as { x: number; y: number; w: number; h: number };
      ctx.strokeStyle = item.kind === 'frame' ? '#69b1ff' : '#95de64';
      ctx.setLineDash(item.kind === 'negative_space' ? [6, 4] : []);
      ctx.strokeRect(rect.x * w, rect.y * h, rect.w * w, rect.h * h);
      ctx.setLineDash([]);
    } else if (item.kind === 'leading_line') {
      const points = (item.geometry.points ?? []) as { x: number; y: number }[];
      ctx.strokeStyle = '#ff7a45';
      ctx.beginPath();
      points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x * w, p.y * h) : ctx.lineTo(p.x * w, p.y * h)));
      ctx.stroke();
    } else {
      const points = (item.geometry.points ?? []) as { x: number; y: number }[];
      ctx.fillStyle = '#ffadd2';
      for (const p of points) {
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    if (tool === 'rule_of_thirds') {
      commit({ kind: tool, geometry: { points: [{ x, y }] } });
      return;
    }
    if (tool === 'leading_line' || tool === 'light_arrow') {
      const next = [...pending, { x, y }];
      if (next.length < 2) {
        setPending(next);
        return;
      }
      const [from, to] = next;
      setPending([]);
      if (tool === 'light_arrow') {
        // 光位角约定：0° = 正对面光源（顺光），90° = 光从右侧来，180° = 逆光
        commit({
          kind: 'light_arrow',
          geometry: { from, to, bearingDeg: bearingFromArrow(from, to) },
        });
      } else {
        commit({ kind: 'leading_line', geometry: { points: next } });
      }
      return;
    }
    // 框类工具：两次点击确定对角
    const next = [...pending, { x, y }];
    if (next.length < 2) {
      setPending(next);
      return;
    }
    const [a, b] = next;
    setPending([]);
    const rectGeo = {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(a.x - b.x),
      h: Math.abs(a.y - b.y),
    };
    if (rectGeo.w < 0.01 || rectGeo.h < 0.01) return;
    commit({ kind: tool, geometry: { rect: rectGeo } });
  }

  function commit(item: DraftAnnotation) {
    const next = [...items, item];
    setItems(next);
    onChange(next);
  }

  function undo() {
    const next = items.slice(0, -1);
    setItems(next);
    onChange(next);
  }

  function clearAll() {
    setItems([]);
    setPending([]);
    onChange([]);
  }

  return (
    <div>
      <Space wrap style={{ marginBottom: 10 }}>
        {(Object.keys(TOOL_LABEL) as Tool[]).map((t) => (
          <Tag.CheckableTag key={t} checked={tool === t} onChange={() => { setTool(t); setPending([]); }}>
            {TOOL_LABEL[t]}
          </Tag.CheckableTag>
        ))}
        <span>
          <Typography.Text style={{ fontSize: 12, marginRight: 4 }}>三分线参考</Typography.Text>
          <Switch size="small" checked={showThirds} onChange={setShowThirds} />
        </span>
        <Button size="small" onClick={undo} disabled={!items.length}>
          撤销
        </Button>
        <Button size="small" danger onClick={clearAll} disabled={!items.length}>
          清空
        </Button>
      </Space>

      <canvas
        ref={canvasRef}
        onClick={handleClick}
        style={{ maxWidth: '100%', border: '1px solid #e5e5e5', borderRadius: 8, cursor: 'crosshair', display: 'block' }}
      />

      <div style={{ marginTop: 8 }}>
        {imgRef.current ? null : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="图片加载中…" />}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          当前机位朝向 {Math.round(cameraBearing)}°。
          {tool === 'light_arrow'
            ? ' 点两次画一条箭头表示光从哪来：0° 表示正对面（顺光），90° 表示光从右侧来，180° 表示逆光。'
            : ' 点两次即可落笔；框类工具点两次是矩形的对角。'}
        </Typography.Text>
      </div>
    </div>
  );
}
