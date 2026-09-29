import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, Col, Descriptions, Form, Input, InputNumber, Modal, Row, Select, Space, Table, Tag, Typography, message } from 'antd';
import { get, patch, post } from '../api/client.js';
import { usePlaces, useSpots } from '../api/hooks.js';
import { MapCanvas, type MapPoint } from '../components/MapCanvas.js';
import { FUZZ_LABEL } from '../lib/format.js';
import { useSession } from '../stores/session.js';

export default function Places() {
  const qc = useQueryClient();
  const { data: places } = usePlaces();
  const { data: spots } = useSpots();
  const [creating, setCreating] = useState(false);
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(null);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [form] = Form.useForm();
  const libraryTz = useSession((s) => s.libraryTz);

  const points: MapPoint[] = (spots?.items ?? []).map((s) => ({
    id: s.id,
    lat: s.precise?.lat ?? s.fuzz.lat ?? 0,
    lng: s.precise?.lng ?? s.fuzz.lng ?? 0,
    label: s.placeName,
    kind: s.precise ? 'precise' : 'fuzzy',
  }));

  async function createSpot() {
    const values = await form.validateFields();
    if (!picked) {
      message.warning('先在地图上点一下机位位置');
      return;
    }
    let placeId = values.placeId as string;
    if (values.newPlaceName) {
      const created = await post<{ id: string }>('/places', {
        name: values.newPlaceName,
        city: values.city,
        district: values.district,
        category: values.category,
      });
      placeId = created.id;
    }
    await post('/spots', {
      placeId,
      lat: picked.lat,
      lng: picked.lng,
      cameraBearing: values.cameraBearing ?? 0,
      elevationM: values.elevationM ?? null,
      accessNote: values.accessNote ?? null,
      bestTimeNote: values.bestTimeNote ?? null,
      tz: libraryTz,
    });
    message.success('机位已保存（精确坐标只存在你自己的库里）');
    setCreating(false);
    setPicked(null);
    form.resetFields();
    await qc.invalidateQueries({ queryKey: ['spots'] });
    await qc.invalidateQueries({ queryKey: ['places'] });
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title="机位地图（精确点仅你自己可见）"
        extra={
          <Space>
            <Select
              size="small"
              defaultValue="g500"
              style={{ width: 160 }}
              onChange={async (level) => {
                const first = spots?.items[0];
                if (!first) return;
                const res = await get<{ precise: { lat: number; lng: number }; fuzz: unknown }>(
                  `/spots/${first.id}/fuzz-preview?level=${level}`,
                );
                setPreview(res as unknown as Record<string, unknown>);
              }}
              options={[
                { value: 'g100', label: '预览 100m' },
                { value: 'g500', label: '预览 500m' },
                { value: 'g1k', label: '预览 1km' },
                { value: 'neighborhood', label: '预览 街区' },
              ]}
            />
            <Button size="small" type="primary" onClick={() => setCreating(true)}>
              新建机位
            </Button>
          </Space>
        }
      >
        <MapCanvas
          points={points}
        />
        {preview ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            模糊预览：真实 {JSON.stringify(preview.precise)} →「{JSON.stringify(preview.fuzz)}」——分享时只会看到后者。
          </Typography.Text>
        ) : null}
      </Card>

      <Row gutter={16}>
        <Col xs={24} lg={10}>
          <Card title="地点">
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={places?.items ?? []}
              columns={[
                { title: '名称', dataIndex: 'name' },
                { title: '城市', dataIndex: 'city' },
                { title: '区', dataIndex: 'district' },
                {
                  title: '机位数',
                  dataIndex: 'spot_count',
                  width: 80,
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card title="机位">
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={spots?.items ?? []}
              columns={[
                { title: '地点', dataIndex: 'placeName' },
                {
                  title: '朝向',
                  render: (_, s) => `${Math.round(s.cameraBearing)}°`,
                },
                {
                  title: '对外可见性',
                  render: (_, s) => (
                    <Space>
                      <Tag color={s.visibility === 'private' ? 'red' : 'green'}>
                        {s.visibility === 'private' ? '私有' : '可模糊共享'}
                      </Tag>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {s.fuzz.label}
                      </Typography.Text>
                    </Space>
                  ),
                },
                {
                  title: '精确坐标',
                  render: (_, s) =>
                    s.precise ? (
                      <Typography.Text type="warning" style={{ fontSize: 12 }}>
                        {s.precise.lat}, {s.precise.lng}
                      </Typography.Text>
                    ) : (
                      <Typography.Text type="secondary">不可见</Typography.Text>
                    ),
                },
                {
                  title: '操作',
                  render: (_, s) => (
                    <Select
                      size="small"
                      defaultValue={s.visibility}
                      style={{ width: 130 }}
                      onChange={async (v) => {
                        await patch(`/spots/${s.id}/set-visibility`, { visibility: v });
                        message.success('已更新可见性');
                      }}
                      options={[
                        { value: 'private', label: '私有' },
                        { value: 'fuzzy_shared', label: '可模糊共享' },
                      ]}
                    />
                  ),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Modal open={creating} title="新建机位" onCancel={() => setCreating(false)} onOk={createSpot} okText="保存机位">
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          先在地图上点一下机位位置（精确坐标只存进你自己的库）。
        </Typography.Text>
        <div style={{ margin: '8px 0 12px' }}>
          <MapCanvas
            points={points}
            picked={picked}
            height={240}
            onPick={(lat, lng) => setPicked({ lat, lng })}
          />
        </div>
        <Form form={form} layout="vertical">
          <Form.Item label="选择已有地点" name="placeId">
            <Select
              allowClear
              placeholder="从已有地点里选，或在下面新建"
              options={(places?.items ?? []).map((p) => ({ value: p.id, label: p.name }))}
            />
          </Form.Item>
          <Space>
            <Form.Item label="或新建地点" name="newPlaceName">
              <Input placeholder="例如：M50 创意园 3 号楼连廊" />
            </Form.Item>
            <Form.Item label="城市" name="city">
              <Input style={{ width: 120 }} />
            </Form.Item>
            <Form.Item label="区" name="district">
              <Input style={{ width: 120 }} />
            </Form.Item>
          </Space>
          <Descriptions size="small" column={1}>
            <Descriptions.Item label="已拾取坐标">
              {picked ? `${picked.lat}, ${picked.lng}` : '在地图上点一下'}
            </Descriptions.Item>
          </Descriptions>
          <Form.Item label="镜头朝向（度，正北 0，顺时针）" name="cameraBearing" initialValue={0}>
            <InputNumber min={0} max={360} style={{ width: 160 }} />
          </Form.Item>
          <Form.Item label="机位描述（例如：桥下东侧第二个桥墩，蹲下拍）" name="accessNote">
            <Input />
          </Form.Item>
          <Form.Item label="最佳时段备注" name="bestTimeNote">
            <Input placeholder="可选" />
          </Form.Item>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            精确坐标只对你（owner）可见。协作者与分享链接看到的都是模糊到 {FUZZ_LABEL.g500} 的结果。
          </Typography.Text>
        </Form>
      </Modal>
    </Space>
  );
}
