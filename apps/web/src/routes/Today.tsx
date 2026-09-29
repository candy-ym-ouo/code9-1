import { Button, Card, Col, Empty, Row, Space, Tag, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { post } from '../api/client.js';
import { useInspirations, usePlans, useTodayWindows } from '../api/hooks.js';
import { VERDICT_META, fmtDate, fmtTime, relative } from '../lib/format.js';
import { ResultForm } from '../components/ResultForm.js';
import { useSession } from '../stores/session.js';

export default function Today() {
  const tz = useSession((s) => s.libraryTz);
  const navigate = useNavigate();
  const today = useTodayWindows();
  const inbox = useInspirations({ status: 'draft,tagging,timing_missing', size: 6 });
  const pending = usePlans('pending_result');
  const [filling, setFilling] = useState<{ id: string; title: string } | null>(null);
  const [scanning, setScanning] = useState(false);

  const scheduled = usePlans();
  const upcoming = (scheduled.data?.items ?? []).filter((p) => new Date(p.plannedAt).getTime() > Date.now());

  async function scan() {
    setScanning(true);
    try {
      const res = await post<{ cards: number; days: number }>('/windows/scan', { days: 7 });
      message.success(`已用最新预报重算 ${res.cards} 张卡的窗口`);
      void today.refetch();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setScanning(false);
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title="现在这一刻能去哪"
        extra={
          <Button size="small" loading={scanning} onClick={scan}>
            用最新预报重算全部窗口
          </Button>
        }
      >
        {(today.data?.items ?? []).length === 0 ? (
          <Empty description="未来 7 天没有可拍窗口。可以先放宽条件，或去收件箱把没打标的卡整理一下。" />
        ) : (
          <Row gutter={[12, 12]}>
            {today.data!.items.slice(0, 6).map((w) => {
              const meta = VERDICT_META[w.verdict as keyof typeof VERDICT_META];
              return (
                <Col xs={24} md={12} xl={8} key={w.windowId}>
                  <Card
                    size="small"
                    style={{ borderLeft: `4px solid ${meta.color}` }}
                    title={<Link to={`/inspirations/${w.inspirationId}`}>{w.title}</Link>}
                    extra={<Tag color={meta.color} style={{ color: '#fff' }}>{meta.label}</Tag>}
                  >
                    <Typography.Text>
                      {fmtDate(w.startAt, tz)} {fmtTime(w.startAt, tz)} – {fmtTime(w.endAt, tz)}
                    </Typography.Text>
                    <div>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {relative(w.startAt)}
                        {w.distanceBand ? ` · ${w.distanceBand}` : ''}
                      </Typography.Text>
                    </div>
                  </Card>
                </Col>
              );
            })}
          </Row>
        )}
      </Card>

      <Row gutter={16}>
        <Col xs={24} lg={12}>
          <Card title="待回填（闭环的最后一厘米）" extra={<Link to="/plans">全部计划</Link>}>
            {(pending.data?.items ?? []).length === 0 ? (
              <Typography.Text type="secondary">没有待回填的计划。</Typography.Text>
            ) : (
              <Space direction="vertical" style={{ width: '100%' }}>
                {pending.data!.items.map((p) => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Space direction="vertical" size={0}>
                      <Link to={`/inspirations/${p.inspirationId}`}>{p.inspirationTitle}</Link>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        计划时间 {fmtDate(p.plannedAt, tz)} {fmtTime(p.plannedAt, tz)} · {relative(p.plannedAt)}
                      </Typography.Text>
                    </Space>
                    <Button size="small" type="primary" onClick={() => setFilling({ id: p.id, title: p.inspirationTitle })}>
                      去回填
                    </Button>
                  </div>
                ))}
              </Space>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title="待整理" extra={<Link to="/inbox">去整理</Link>}>
            {(inbox.data?.items ?? []).length === 0 ? (
              <Typography.Text type="secondary">收件箱是空的。</Typography.Text>
            ) : (
              <Space direction="vertical" style={{ width: '100%' }}>
                {inbox.data!.items.map((i) => (
                  <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Link to={`/inspirations/${i.id}`}>{i.title}</Link>
                    <Space>
                      <Tag color={i.status === 'timing_missing' ? 'orange' : 'blue'}>
                        {i.status === 'timing_missing' ? '缺条件' : i.status === 'tagging' ? '缺标签' : '草稿'}
                      </Tag>
                      <Button size="small" onClick={() => navigate(`/inspirations/${i.id}`)}>
                        整理
                      </Button>
                    </Space>
                  </div>
                ))}
              </Space>
            )}
          </Card>
        </Col>
      </Row>

      {upcoming.length ? (
        <Card title="已接单，待出发">
          <Space direction="vertical" style={{ width: '100%' }}>
            {upcoming.map((p) => (
              <div key={p.id}>
                <Link to={`/inspirations/${p.inspirationId}`}>{p.inspirationTitle}</Link>
                <Typography.Text type="secondary" style={{ marginLeft: 12, fontSize: 12 }}>
                  出发 {fmtDateTimeSafe(p.leaveAt, tz)} · 窗口 {fmtDateTimeSafe(p.plannedAt, tz)}
                </Typography.Text>
              </div>
            ))}
          </Space>
        </Card>
      ) : null}

      <ResultForm
        open={Boolean(filling)}
        planId={filling?.id ?? null}
        inspirationTitle={filling?.title}
        onClose={() => {
          setFilling(null);
          void pending.refetch();
        }}
      />
    </Space>
  );

  function fmtDateTimeSafe(iso: string | null, zone: string) {
    return iso ? `${fmtDate(iso, zone)} ${fmtTime(iso, zone)}` : '—';
  }
}
