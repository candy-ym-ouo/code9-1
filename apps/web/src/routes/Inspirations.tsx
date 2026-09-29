import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Col, Empty, Row, Segmented, Select, Space, Tag, Typography } from 'antd';
import type { InspirationDto } from '@flil/shared';
import { useInspirations, useTags } from '../api/hooks.js';
import { STATUS_META, fmtDateTime, hitRateText } from '../lib/format.js';
import { authedImageUrl } from '../api/client.js';
import { useSession } from '../stores/session.js';

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'ready', label: '已就绪' },
  { value: 'scheduled', label: '已接单' },
  { value: 'shot', label: '已实拍' },
  { value: 'timing_missing', label: '待补条件' },
  { value: 'draft,tagging', label: '待整理' },
];

export default function Inspirations() {
  const tz = useSession((s) => s.libraryTz);
  const [status, setStatus] = useState('ready');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [sort, setSort] = useState('recent');
  const { data: tags } = useTags();

  const list = useInspirations({ status, tagIds: tagIds.join(','), sort, size: 48 });
  const flat = (tags?.items ?? []).flatMap((g) => (g.children ?? []).map((c) => ({ id: c.id, name: c.name, domain: g.domain })));

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small">
        <Space wrap>
          <Segmented value={status} onChange={(v) => setStatus(String(v))} options={STATUS_OPTIONS} />
          <Select
            mode="multiple"
            allowClear
            placeholder="按标签筛选"
            style={{ minWidth: 320 }}
            value={tagIds}
            onChange={setTagIds}
            options={flat.map((t) => ({ value: t.id, label: `${t.name}` }))}
            maxTagCount={4}
          />
          <Select
            value={sort}
            onChange={setSort}
            style={{ width: 160 }}
            options={[
              { value: 'recent', label: '最近整理' },
              { value: 'hit_rate', label: '命中率' },
              { value: 'window_heat', label: '时机热度' },
              { value: 'rarity', label: '可复现难度' },
            ]}
          />
          <Typography.Text type="secondary">共 {list.data?.total ?? 0} 张</Typography.Text>
        </Space>
      </Card>

      {(list.data?.items ?? []).length === 0 ? (
        <Empty description="没有符合条件的卡片" />
      ) : (
        <Row gutter={[12, 12]}>
          {list.data!.items.map((i) => (
            <Col xs={24} md={12} xl={8} key={i.id}>
              <Card
                size="small"
                hoverable
                title={<Link to={`/inspirations/${i.id}`}>{i.title}</Link>}
                extra={<Tag color={STATUS_META[i.status].color}>{STATUS_META[i.status].label}</Tag>}
              >
                {i.assets[0] ? (
                  <img
                    src={authedImageUrl(i.assets[0].thumbUrl)}
                    alt={i.title}
                    style={{ width: '100%', height: 150, objectFit: 'cover', borderRadius: 6, marginBottom: 8 }}
                  />
                ) : (
                  <div
                    style={{
                      height: 90,
                      background: '#f0f2f4',
                      borderRadius: 6,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#999',
                      marginBottom: 8,
                    }}
                  >
                    还没有图片
                  </div>
                )}
                <Space wrap size={[4, 4]} style={{ marginBottom: 6 }}>
                  {i.tags.slice(0, 6).map((t) => (
                    <Tag key={t.id}>{t.name}</Tag>
                  ))}
                </Space>
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {i.spot ? `${i.spot.fuzz.label}` : '机位未定'}
                    {i.timing ? ` · ${i.timing.timeAnchor}` : ' · 条件缺失'}
                  </Typography.Text>
                </div>
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    命中率 {hitRateText(i.hitRate, i.hitCount + i.partialCount + i.missCount)}
                    {i.windowSummary?.nextGoodAt ? ` · 下次可拍 ${fmtDateTime(i.windowSummary.nextGoodAt, tz)}` : ''}
                  </Typography.Text>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </Space>
  );
}
