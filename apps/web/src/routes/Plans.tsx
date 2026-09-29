import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Card, Space, Table, Tag, Typography, message } from 'antd';
import type { PlanDto, ReminderDto } from '@flil/shared';
import { usePlans, useReminderAction, useReminders } from '../api/hooks.js';
import { HIT_LABEL, fmtDate, fmtDateTime, fmtTime, relative } from '../lib/format.js';
import { ResultForm } from '../components/ResultForm.js';
import { useSession } from '../stores/session.js';

export default function Plans() {
  const tz = useSession((s) => s.libraryTz);
  const [filter, setFilter] = useState<string | undefined>();
  const plans = usePlans(filter);
  const reminders = useReminders('pending,notified');
  const reminderAction = useReminderAction();
  const [filling, setFilling] = useState<{ id: string; title: string } | null>(null);

  async function act(r: ReminderDto, action: 'done' | 'dismiss') {
    try {
      if (action === 'dismiss') {
        await reminderAction.mutateAsync({ id: r.id, action, payload: { reason: '手动标记为稍后处理' } });
      } else {
        await reminderAction.mutateAsync({ id: r.id, action });
      }
      message.success('已处理');
    } catch (err) {
      message.error((err as Error).message);
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title="提醒"
        extra={
          <Space>
            <Button size="small" onClick={() => setFilter(undefined)} type={filter === undefined ? 'primary' : 'default'}>
              全部计划
            </Button>
            <Button
              size="small"
              onClick={() => setFilter('pending_result')}
              type={filter === 'pending_result' ? 'primary' : 'default'}
            >
              只看待回填
            </Button>
          </Space>
        }
      >
        {(reminders.data?.items ?? []).length === 0 ? (
          <Typography.Text type="secondary">暂无待处理提醒。</Typography.Text>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }}>
            {reminders.data!.items.map((r) => (
              <Alert
                key={r.id}
                type={r.ruleCode === 'R3' ? 'warning' : 'info'}
                showIcon
                message={
                  <Space>
                    <Tag>{r.ruleCode ?? '事件'}</Tag>
                    {r.title}
                  </Space>
                }
                description={
                  <Space direction="vertical" size={4}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {r.body} · 到期 {fmtDateTime(r.dueAt, tz)}（{relative(r.dueAt)}）
                    </Typography.Text>
                    <Space>
                      {r.actionKind === 'fill_result' && r.actionPayload ? (
                        <Button
                          size="small"
                          type="primary"
                          onClick={() =>
                            setFilling({
                              id: String((r.actionPayload as Record<string, unknown>).planId),
                              title: r.title,
                            })
                          }
                        >
                          去回填
                        </Button>
                      ) : null}
                      <Button size="small" onClick={() => void act(r, 'done')}>
                        完成
                      </Button>
                      <Button size="small" onClick={() => void act(r, 'dismiss')}>
                        忽略
                      </Button>
                    </Space>
                  </Space>
                }
              />
            ))}
          </Space>
        )}
      </Card>

      <Card title="出行计划">
        <Table<PlanDto>
          rowKey="id"
          size="small"
          dataSource={plans.data?.items ?? []}
          pagination={false}
          columns={[
            {
              title: '灵感卡',
              render: (_, p) => <Link to={`/inspirations/${p.inspirationId}`}>{p.inspirationTitle}</Link>,
            },
            {
              title: '窗口',
              render: (_, p) => `${fmtDate(p.plannedAt, tz)} ${fmtTime(p.plannedAt, tz)}`,
            },
            {
              title: '出发',
              render: (_, p) => (
                <Typography.Text type={p.leaveAt && new Date(p.leaveAt).getTime() < Date.now() ? 'secondary' : undefined}>
                  {p.leaveAt ? `${fmtDate(p.leaveAt, tz)} ${fmtTime(p.leaveAt, tz)}` : '—'}
                </Typography.Text>
              ),
            },
            {
              title: '状态',
              width: 120,
              render: (_, p) => (
                <Tag color={p.status === 'done' ? 'purple' : p.status === 'cancelled' ? 'default' : 'blue'}>
                  {p.status === 'done' ? '已回填' : p.status === 'cancelled' ? '已取消' : '待出发'}
                </Tag>
              ),
            },
            {
              title: '结果',
              render: (_, p) =>
                p.result ? (
                  <Space>
                    <Tag color={p.result.hitLevel === 'hit' ? 'green' : p.result.hitLevel === 'partial' ? 'orange' : 'red'}>
                      {HIT_LABEL[p.result.hitLevel]}
                    </Tag>
                    {p.result.missReasons.length ? (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {p.result.missReasons.join('、')}
                      </Typography.Text>
                    ) : null}
                  </Space>
                ) : (
                  '—'
                ),
            },
            {
              title: '操作',
              width: 120,
              render: (_, p) =>
                p.status === 'planned' ? (
                  <Space>
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => setFilling({ id: p.id, title: p.inspirationTitle })}
                    >
                      回填
                    </Button>
                    <Button
                      size="small"
                      onClick={async () => {
                        await fetch(`/api/plans/${p.id}`, {
                          method: 'PATCH',
                          headers: {
                            'content-type': 'application/json',
                            authorization: `Bearer ${localStorage.getItem('flil.token')}`,
                          },
                          body: JSON.stringify({ status: 'cancelled', cancelReason: '临时有事' }),
                        });
                        message.success('已取消（需填原因）');
                        void plans.refetch();
                      }}
                    >
                      取消
                    </Button>
                  </Space>
                ) : null,
            },
          ]}
        />
      </Card>

      <ResultForm
        open={Boolean(filling)}
        planId={filling?.id ?? null}
        inspirationTitle={filling?.title}
        onClose={() => {
          setFilling(null);
          void plans.refetch();
          void reminders.refetch();
        }}
      />
    </Space>
  );
}
