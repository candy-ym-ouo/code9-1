import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import { get, patch, post } from '../api/client.js';
import {
  useLibrary,
  useMemberActions,
  useReminders,
  useRevokeShare,
  useShareLinks,
  useTags,
} from '../api/hooks.js';
import { FUZZ_LABEL, fmtDateTime } from '../lib/format.js';
import { useSession } from '../stores/session.js';

function MembersPanel() {
  const qc = useQueryClient();
  const session = useSession();
  const { data } = useLibrary();
  const actions = useMemberActions();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'owner' | 'member'>('member');
  const [sending, setSending] = useState(false);
  const isOwner = session.user?.role === 'owner';

  const members = data?.members ?? [];
  const ownerCount = members.filter((m) => m.role === 'owner').length;

  async function sendInvite() {
    if (!email.trim()) return;
    setSending(true);
    try {
      const res = await actions.createInvitation.mutateAsync({ email: email.trim(), role });
      Modal.success({
        title: res.replaced ? '已重发邀请（旧链接即时失效）' : '邀请已创建',
        content: (
          <Space direction="vertical" style={{ marginTop: 8 }}>
            <Typography.Text>把下面的链接发给受邀人（仅显示这一次，请立即复制）：</Typography.Text>
            <Typography.Text copyable code style={{ wordBreak: 'break-all' }}>
              {`${window.location.origin}${res.url}`}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              受邀人需用对应邮箱登录后打开；接受即加入库，重复接受不会产生重复关系。
            </Typography.Text>
          </Space>
        ),
        width: 560,
      });
      setEmail('');
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function changeRole(userId: string, next: 'owner' | 'member') {
    try {
      const res = await actions.setRole.mutateAsync({ userId, role: next });
      await qc.invalidateQueries();
      message.success(
        res.updated
          ? `角色已调整，即时生效${res.revokedShares > 0 ? `；其 ${res.revokedShares} 条历史分享已同步撤销` : ''}`
          : '角色未变化',
      );
    } catch (err) {
      message.error((err as Error).message);
    }
  }

  async function remove(userId: string) {
    try {
      const res = await actions.remove.mutateAsync(userId);
      await qc.invalidateQueries();
      message.success(`成员已移除，访问权即时失效${res.revokedShares > 0 ? `；其 ${res.revokedShares} 条历史分享已撤销` : ''}`);
    } catch (err) {
      message.error((err as Error).message);
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Card title="成员" extra={<Typography.Text type="secondary" style={{ fontSize: 12 }}>
        所有者 {ownerCount} 名；库必须至少保留一名所有者
      </Typography.Text>}>
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={members}
          columns={[
            { title: '昵称', dataIndex: 'displayName' },
            { title: '邮箱', dataIndex: 'email' },
            {
              title: '角色',
              dataIndex: 'role',
              width: 100,
              render: (v: string) => (v === 'owner' ? <Tag color="gold">所有者</Tag> : <Tag>协作者</Tag>),
            },
            ...(isOwner
              ? [
                  {
                    title: '操作',
                    width: 220,
                    render: (_: unknown, m: { id: string; email: string; role: string }) => {
                      const self = m.id === session.user?.id;
                      const isLastOwner = m.role === 'owner' && ownerCount <= 1;
                      return (
                        <Space>
                          {m.role === 'member' ? (
                            <Button size="small" onClick={() => changeRole(m.id, 'owner')}>
                              设为所有者
                            </Button>
                          ) : (
                            <Button size="small" disabled={isLastOwner} onClick={() => changeRole(m.id, 'member')}>
                              降为协作者
                            </Button>
                          )}
                          <Popconfirm
                            title={m.role === 'owner' ? '所有者不能直接移除，请先降级' : `移除 ${m.email}？`}
                            description={m.role === 'owner' ? undefined : '其访问权与历史分享链接将立即失效'}
                            okText="移除"
                            okButtonProps={{ danger: true }}
                            disabled={m.role === 'owner'}
                            onConfirm={() => remove(m.id)}
                          >
                            <Button size="small" danger disabled={m.role === 'owner'}>
                              {self ? '退出' : '移除'}
                            </Button>
                          </Popconfirm>
                        </Space>
                      );
                    },
                  },
                ]
              : []),
          ]}
        />
        {!isOwner ? <Alert style={{ marginTop: 12 }} type="info" showIcon message="仅所有者可邀请成员与调整角色。" /> : null}
      </Card>

      {isOwner ? (
        <Card title="邀请新成员">
          <Space wrap>
            <Input
              placeholder="受邀人注册邮箱"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: 260 }}
            />
            <Select
              value={role}
              onChange={setRole}
              style={{ width: 140 }}
              options={[
                { value: 'member', label: '协作者' },
                { value: 'owner', label: '所有者' },
              ]}
            />
            <Button type="primary" loading={sending} onClick={sendInvite}>
              生成邀请链接
            </Button>
          </Space>

          <Table
            style={{ marginTop: 16 }}
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={data?.invitations ?? []}
            columns={[
              { title: '邮箱', dataIndex: 'email' },
              {
                title: '角色',
                dataIndex: 'role',
                width: 90,
                render: (v: string) => (v === 'owner' ? <Tag color="gold">所有者</Tag> : <Tag>协作者</Tag>),
              },
              {
                title: '状态',
                dataIndex: 'status',
                width: 100,
                render: (v: string) => {
                  const map: Record<string, { color: string; text: string }> = {
                    pending: { color: 'blue', text: '待接受' },
                    accepted: { color: 'green', text: '已接受' },
                    revoked: { color: 'red', text: '已撤销' },
                    replaced: { color: 'default', text: '已重发' },
                  };
                  const s = map[v] ?? { color: 'default', text: v };
                  return <Tag color={s.color}>{s.text}</Tag>;
                },
              },
              { title: '过期时间', dataIndex: 'expiresAt', width: 200, render: (v: string) => fmtDateTime(v, session.libraryTz) },
              {
                title: '操作',
                width: 90,
                render: (_: unknown, r: { id: string; status: string }) =>
                  r.status === 'pending' ? (
                    <Button
                      size="small"
                      danger
                      onClick={async () => {
                        await actions.revokeInvitation.mutateAsync(r.id);
                        message.success('邀请已撤销，旧链接即时失效');
                      }}
                    >
                      撤销
                    </Button>
                  ) : (
                    <Typography.Text type="secondary">—</Typography.Text>
                  ),
              },
            ]}
          />
          <Alert
            style={{ marginTop: 12 }}
            type="warning"
            showIcon
            message="角色调整或移除成员会即时生效：旧登录凭证下次请求即失效，当事人创建的历史分享链接（含图片令牌）同步撤销。"
          />
        </Card>
      ) : null}
    </Space>
  );
}

export default function Settings() {
  const qc = useQueryClient();
  const tz = useSession((s) => s.libraryTz);
  const { data: tags, refetch: refetchTags } = useTags();
  const links = useShareLinks();
  const revoke = useRevokeShare();
  const reminders = useReminders();
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [form] = Form.useForm();
  const [newTag, setNewTag] = useState({ domain: 'light', name: '' });

  async function saveLibrary() {
    const values = await form.validateFields();
    const res = await patch<{ downgraded?: boolean }>('/library', values);
    message.success(
      res.downgraded ? '已保存（库级默认不允许精确级别，已自动降级为 500m）' : '已保存',
    );
  }

  async function runHealth() {
    const res = await get<Record<string, unknown>>('/health');
    const assets = await get<Record<string, unknown>>('/health/verify-assets');
    setHealth({ ...res, assets });
  }

  return (
    <Tabs
      items={[
        {
          key: 'members',
          label: '成员与邀请',
          children: <MembersPanel />,
        },
        {
          key: 'library',
          label: '库设置',
          children: (
            <Card title="库与隐私默认值">
              <Form
                form={form}
                layout="vertical"
                initialValues={{ defaultFuzzLevel: 'g500' }}
                style={{ maxWidth: 520 }}
              >
                <Form.Item label="库名称" name="name">
                  <Input placeholder="不改可留空" />
                </Form.Item>
                <Form.Item label="时区" name="tz">
                  <Input placeholder="Asia/Shanghai" />
                </Form.Item>
                <Form.Item
                  label="对外默认模糊级别"
                  name="defaultFuzzLevel"
                  extra="这是协作者与分享页看到的默认精度；精确级别不允许设为默认值。"
                >
                  <Select
                    options={[
                      { value: 'g500', label: FUZZ_LABEL.g500 },
                      { value: 'g1k', label: FUZZ_LABEL.g1k },
                      { value: 'neighborhood', label: FUZZ_LABEL.neighborhood },
                      { value: 'district', label: FUZZ_LABEL.district },
                    ]}
                  />
                </Form.Item>
                <Button type="primary" onClick={saveLibrary}>
                  保存
                </Button>
              </Form>
            </Card>
          ),
        },
        {
          key: 'tags',
          label: '标签字典',
          children: (
            <Card
              title="四域标签（内置标签可停用，不可改名）"
              extra={
                <Space>
                  <Select
                    value={newTag.domain}
                    onChange={(v) => setNewTag((t) => ({ ...t, domain: v }))}
                    style={{ width: 130 }}
                    options={[
                      { value: 'light', label: '光线' },
                      { value: 'scene', label: '建筑场景' },
                      { value: 'color', label: '色彩' },
                      { value: 'composition', label: '构图' },
                    ]}
                  />
                  <Input
                    placeholder="新标签名"
                    value={newTag.name}
                    onChange={(e) => setNewTag((t) => ({ ...t, name: e.target.value }))}
                    style={{ width: 180 }}
                  />
                  <Button
                    onClick={async () => {
                      if (!newTag.name.trim()) return;
                      try {
                        await post('/tags', { domain: newTag.domain, name: newTag.name.trim() });
                        message.success('已新增标签');
                        setNewTag((t) => ({ ...t, name: '' }));
                        await refetchTags();
                        await qc.invalidateQueries({ queryKey: ['meta'] });
                      } catch (err) {
                        message.error((err as Error).message);
                      }
                    }}
                  >
                    新增
                  </Button>
                </Space>
              }
            >
              <Table
                size="small"
                rowKey="id"
                pagination={{ pageSize: 12 }}
                dataSource={(tags?.items ?? []).flatMap((g) =>
                  (g.children ?? []).map((c) => ({ ...c, groupName: g.name })),
                )}
                columns={[
                  { title: '域', dataIndex: 'domain', width: 100 },
                  { title: '分组', dataIndex: 'groupName', width: 120 },
                  { title: '名称', dataIndex: 'name' },
                  { title: '使用次数', dataIndex: 'usageCount', width: 100 },
                  {
                    title: '内置',
                    dataIndex: 'isBuiltin',
                    width: 80,
                    render: (v: boolean) => (v ? <Tag>内置</Tag> : <Tag color="blue">自定义</Tag>),
                  },
                ]}
              />
            </Card>
          ),
        },
        {
          key: 'share',
          label: '分享审计',
          children: (
            <Card
              title="我对外开过哪些口子"
              extra={
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  撤销即时生效，旧链接下一次请求即 401
                </Typography.Text>
              }
            >
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={links.data?.items ?? []}
                columns={[
                  { title: '范围', dataIndex: 'scope', width: 100 },
                  {
                    title: '级别',
                    dataIndex: 'fuzzLevel',
                    render: (v: string) => <Tag color="green">{FUZZ_LABEL[v as keyof typeof FUZZ_LABEL] ?? v}</Tag>,
                  },
                  { title: '状态', dataIndex: 'status', width: 90 },
                  { title: '访问次数', dataIndex: 'viewCount', width: 90 },
                  {
                    title: '过期时间',
                    render: (_, r) => fmtDateTime(r.expiresAt, tz),
                  },
                  {
                    title: '操作',
                    render: (_, r) =>
                      r.status === 'active' ? (
                        <Button
                          size="small"
                          danger
                          onClick={async () => {
                            await revoke.mutateAsync(r.id);
                            message.success('已撤销');
                          }}
                        >
                          撤销
                        </Button>
                      ) : (
                        <Typography.Text type="secondary">—</Typography.Text>
                      ),
                  },
                ]}
              />
            </Card>
          ),
        },
        {
          key: 'system',
          label: '系统与备份',
          children: (
            <Card
              title="健康检查与备份"
              extra={
                <Space>
                  <Button size="small" onClick={runHealth}>
                    运行健康检查
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    onClick={async () => {
                      const res = await post<{ name: string }>('/backup', {});
                      message.success(`备份完成：${res.name}`);
                    }}
                  >
                    立即备份
                  </Button>
                </Space>
              }
            >
              {health ? (
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="数据库">{String(health.db)}</Descriptions.Item>
                  <Descriptions.Item label="目录">{JSON.stringify(health.dirs)}</Descriptions.Item>
                  <Descriptions.Item label="天气源">
                    {String(health.weatherProvider)}
                    {health.weatherDegraded ? '（已降级）' : ''}
                  </Descriptions.Item>
                  <Descriptions.Item label="图片一致性">
                    {JSON.stringify(health.assets)}
                  </Descriptions.Item>
                </Descriptions>
              ) : (
                <Typography.Text type="secondary">点右上角运行一次检查。</Typography.Text>
              )}

              <Alert
                style={{ marginTop: 16 }}
                type="info"
                showIcon
                message="备份内容包含数据库与图片目录；还原前系统会自动再备份一份当前状态（可回滚）。"
              />
            </Card>
          ),
        },
        {
          key: 'reminders',
          label: '提醒历史',
          children: (
            <Card title="提醒记录（每条都有终态，不会永远挂着）">
              <Table
                size="small"
                rowKey="id"
                pagination={{ pageSize: 15 }}
                dataSource={reminders.data?.items ?? []}
                columns={[
                  { title: '规则', dataIndex: 'ruleCode', width: 80 },
                  { title: '标题', dataIndex: 'title' },
                  {
                    title: '状态',
                    dataIndex: 'status',
                    width: 110,
                    render: (v: string) => (
                      <Tag color={v === 'done' ? 'green' : v === 'expired' ? 'default' : v === 'dismissed' ? 'orange' : 'blue'}>
                        {v}
                      </Tag>
                    ),
                  },
                  { title: '到期', render: (_, r) => fmtDateTime(r.dueAt, tz) },
                  {
                    title: '过期时间',
                    render: (_, r) => (r.expireAt ? fmtDateTime(r.expireAt, tz) : '—'),
                  },
                ]}
              />
            </Card>
          ),
        },
      ]}
    />
  );
}
