import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, Col, Form, Input, Modal, Row, Select, Space, Tag, Typography, message } from 'antd';
import type { AlbumDto } from '@flil/shared';
import { useAlbums, useCreateAlbum, useTags } from '../api/hooks.js';

const STATUS_LABEL: Record<string, string> = {
  planning: '规划中',
  collecting: '收集缺口',
  ready: '可发布',
  published: '已发布',
  archived: '已归档',
};

export default function Albums() {
  const albums = useAlbums();
  const create = useCreateAlbum();
  const { data: tags } = useTags();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const navigate = useNavigate();

  const flat = (tags?.items ?? []).flatMap((g) => (g.children ?? []).map((c) => ({ id: c.id, name: c.name })));

  async function submit() {
    const values = await form.validateFields();
    try {
      const res = await create.mutateAsync({
        title: values.title,
        themeNote: values.themeNote ?? null,
        rules: {
          requireTags: (values.requireTags ?? []).map((tagId: string) => ({
            tagIds: [tagId],
            min: 1,
            required: true,
          })),
          requireAnchors: values.requireAnchor
            ? [{ anchor: values.requireAnchor, min: 1, required: false }]
            : [],
          requireWeather: [],
          requireResultShots: values.requireResultShots
            ? { min: Number(values.requireResultShots), required: false }
            : undefined,
          totalMin: Number(values.totalMin ?? 6),
          autoMatch: { enabled: true, minTagHits: Math.max(1, (values.requireTags ?? []).length) },
        },
      });
      message.success('画册已创建，系统已算出缺口清单');
      setOpen(false);
      navigate(`/albums/${res.id}`);
    } catch (err) {
      message.error((err as Error).message);
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title="主题画册"
        extra={
          <Button type="primary" onClick={() => setOpen(true)}>
            新建画册
          </Button>
        }
      >
        <Typography.Text type="secondary">
          画册不是文件夹：定下主题后，系统会告诉你"还差什么、去哪补"，缺口不闭合就发布不了。
        </Typography.Text>
      </Card>

      {(albums.data?.items ?? []).length === 0 ? (
        <Card>
          <Typography.Text type="secondary">还没有画册。可以先建一个"雨天霓虹"或"清水混凝土"试试。</Typography.Text>
        </Card>
      ) : (
        <Row gutter={[12, 12]}>
          {(albums.data?.items ?? []).map((a: AlbumDto) => (
            <Col xs={24} md={12} xl={8} key={a.id}>
              <Card
                title={<Link to={`/albums/${a.id}`}>{a.title}</Link>}
                extra={<Tag color={a.openRequiredGaps ? 'orange' : 'green'}>{STATUS_LABEL[a.status] ?? a.status}</Tag>}
              >
                <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }}>
                  {a.themeNote ?? '（未填主题说明）'}
                </Typography.Paragraph>
                <Space>
                  <Tag>已入册 {a.itemCount}</Tag>
                  {a.openRequiredGaps ? <Tag color="red">必需缺口 {a.openRequiredGaps}</Tag> : <Tag color="green">无必需缺口</Tag>}
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Modal open={open} title="新建主题画册" onCancel={() => setOpen(false)} onOk={submit} okText="创建" confirmLoading={create.isPending}>
        <Form form={form} layout="vertical" initialValues={{ totalMin: 6 }}>
          <Form.Item label="主题名" name="title" rules={[{ required: true }]}>
            <Input placeholder="例如：雨天的霓虹" />
          </Form.Item>
          <Form.Item label="主题说明" name="themeNote">
            <Input.TextArea rows={2} placeholder="这本册子想表达什么？" />
          </Form.Item>
          <Form.Item label="必须命中的标签（全部为必需）" name="requireTags">
            <Select mode="multiple" options={flat.map((t) => ({ value: t.id, label: t.name }))} />
          </Form.Item>
          <Form.Item label="希望覆盖的时段（可选）" name="requireAnchor">
            <Select
              allowClear
              options={[
                { value: 'blue_pm', label: '蓝调时刻（昏）' },
                { value: 'golden_pm', label: '黄金时刻（昏）' },
                { value: 'golden_am', label: '黄金时刻（晨）' },
                { value: 'night', label: '夜间' },
              ]}
            />
          </Form.Item>
          <Space>
            <Form.Item label="至少几张" name="totalMin">
              <Input type="number" style={{ width: 120 }} />
            </Form.Item>
            <Form.Item label="其中实拍成片至少" name="requireResultShots">
              <Input type="number" style={{ width: 120 }} placeholder="可选" />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </Space>
  );
}
