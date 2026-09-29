import { useState } from 'react';
import { Button, Card, InputNumber, Modal, Space, Tag, Tooltip, Typography, message } from 'antd';
import type { ReproWindowDto } from '@flil/shared';
import { VERDICT_META, fmtTime, weekday } from '../lib/format.js';
import { useCreatePlan, useRecomputeWindows } from '../api/hooks.js';

interface Props {
  inspirationId: string;
  windows: ReproWindowDto[];
  tz: string;
  onPlanned?: () => void;
}

export function WindowList({ inspirationId, windows, tz, onPlanned }: Props) {
  const [open, setOpen] = useState<ReproWindowDto | null>(null);
  const [commuteMin, setCommuteMin] = useState(30);
  const [companions, setCompanions] = useState('');
  const createPlan = useCreatePlan();
  const recompute = useRecomputeWindows();

  async function plan() {
    if (!open || !open.id) return;
    try {
      const res = await createPlan.mutateAsync({
        windowId: open.id,
        commuteMin,
        companions: companions || null,
      });
      message.success(`已接单：出发时间 ${fmtTime(res.leaveAt, tz)}`);
      setOpen(null);
      onPlanned?.();
    } catch (err) {
      message.error((err as Error).message);
    }
  }

  return (
    <Card
      size="small"
      title="未来 7 天可拍窗口"
      extra={
        <Button size="small" loading={recompute.isPending} onClick={() => recompute.mutate({ id: inspirationId, days: 7 })}>
          用最新预报重算
        </Button>
      }
    >
      {windows.length === 0 ? (
        <Typography.Text type="secondary">还没有窗口数据，先保存拍摄条件。</Typography.Text>
      ) : null}
      <Space direction="vertical" style={{ width: '100%' }}>
        {windows.map((w) => {
          const meta = VERDICT_META[w.verdict];
          return (
            <div
              key={w.id ?? `${w.date}-${w.startAt}`}
              style={{
                border: '1px solid #eee',
                borderLeft: `4px solid ${meta.color}`,
                borderRadius: 8,
                padding: '10px 12px',
                background: meta.bg,
              }}
            >
              <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
                <Space>
                  <Tag color={meta.color} style={{ color: '#fff' }}>
                    {meta.label}
                  </Tag>
                  <strong>{w.date}</strong>
                  <Typography.Text type="secondary">{weekday(w.startAt, tz)}</Typography.Text>
                  <span>
                    {fmtTime(w.startAt, tz)} – {fmtTime(w.endAt, tz)}
                  </span>
                  {w.weatherDegraded ? <Tag color="orange">未含天气</Tag> : null}
                </Space>
                {w.verdict !== 'bad' ? (
                  <Button size="small" type="primary" onClick={() => setOpen(w)}>
                    接单
                  </Button>
                ) : null}
              </Space>
              <div style={{ marginTop: 6 }}>
                {w.reasons.map((r) => (
                  <div key={`${r.code}-${r.text}`} style={{ fontSize: 12, color: r.level === 'bad' ? '#a8071a' : '#555' }}>
                    {r.level === 'ok' ? '✓' : r.level === 'warn' ? '!' : r.level === 'bad' ? '✗' : '·'} {r.text}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </Space>

      <Modal
        open={Boolean(open)}
        title="接单成出行计划"
        onCancel={() => setOpen(null)}
        onOk={plan}
        confirmLoading={createPlan.isPending}
        okText="生成计划"
      >
        {open ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Typography.Text>
              窗口：{open.date} {fmtTime(open.startAt, tz)} – {fmtTime(open.endAt, tz)}
            </Typography.Text>
            <Space>
              <Typography.Text type="secondary">通勤时间（分钟）</Typography.Text>
              <InputNumber min={0} max={600} value={commuteMin} onChange={(v) => setCommuteMin(Number(v ?? 30))} />
            </Space>
            <Tooltip title="出发时间 = 窗口开始 − 通勤时间">
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                系统会在出发前 2 小时用最新预报再算一次，若判定下降会提醒你。
              </Typography.Text>
            </Tooltip>
            <Space>
              <Typography.Text type="secondary">同行</Typography.Text>
              <input
                value={companions}
                onChange={(e) => setCompanions(e.target.value)}
                placeholder="可选"
                style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #d9d9d9' }}
              />
            </Space>
          </Space>
        ) : null}
      </Modal>
    </Card>
  );
}
