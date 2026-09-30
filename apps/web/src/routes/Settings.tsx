import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
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
  useInviteMember,
  useLibraryInfo,
  useReminders,
  useRemoveMember,
  useRevokeInvite,
  useRevokeShare,
  useSetMemberRole,
  useShareLinks,
  useTags,
  type LibraryInvite,
  type LibraryMember,
} from '../api/hooks.js';
import { FUZZ_LABEL, fmtDateTime } from '../lib/format.js';
import { useSession } from '../stores/session.js';

function MembersTab() {
  const { data, refetch } = useLibraryInfo();
  const inviteApi = useInviteMember();
  const revokeInvite = useRevokeInvite();
  const changeRoleApi = useSetMemberRole();
  const removeMember = useRemoveMember();
  const session = useSession();
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'owner' | 'member'>('member');
  const [busyId, setBusyId] = useState<string | null>(null);

  const members = data?.members ?? [];
  const invites = data?.invites ?? [];
  const ownerCount = members.filter((m) => m.role === 'owner').length;
  const currentUserId = session.user?.id;

  async function sendInvite() {
    if (!email.trim()) return;
    try {
      const res = await inviteApi.mutateAsync({ email: email.trim(), role: inviteRole });
      const link = `${window.location.origin}${res.acceptUrl}`;
      setEmail('');
      message.success({ content: res.reused ? '该邀请已存在，已复制原链接' : '邀请已创建，链接已复制', duration: 3 });
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        /* 剪贴板不可用时静默 */
      }
    } catch (err) {
      message.error((err as Error).message);
    }
  }

  async function copyInviteLink(inv: LibraryInvite) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/invite/${inv.token}`);
      message.success('邀请链接已复制');
    } catch {
      message.error('复制失败，请手动复制');
    }
  }

  async function changeRole(m: LibraryMember, next: 'owner' | 'member') {
    setBusyId(m.id);
    try {
      const res = await changeRoleApi.mutateAsync({ userId: m.id, role: next });
      message.success(
        next === 'member' && res.revokedShareCount > 0
          ? `已降为协作者，其 ${res.revokedShareCount} 条历史分享已即时失效`
          : '角色已调整，权限即时生效',
      );
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(m: LibraryMember) {
    setBusyId(m.id);
    try {
      const res = await removeMember.mutateAsync(m.id);
      message.success(
        res.revokedShareCount > 0
          ? `已移除，其旧登录与 ${res.revokedShareCount} 条历史分享即时失效`
          : '已移除，其旧登录立即失权',
      );
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Card
        title="邀请成员"
        extra={
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            被邀请人通过邮件中的链接接受；移除/降级即时收回权限
          </Typography.Text>
        }
      >
        <Space wrap>
          <Input
            placeholder="被邀请人邮箱（需已注册）"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: 280 }}
          />
          <Select
            value={inviteRole}
            onChange={setInviteRole}
            style={{ width: 200 }}
            options={[
              { value: 'member', label: '协作者（仅见模糊坐标）' },
              { value: 'owner', label: '所有者（可见精确坐标）' },
            ]}
          />
          <Button type="primary" loading={inviteApi.isPending} onClick={sendInvite}>
            生成邀请链接
          </Button>
        </Space>
        <Alert
          style={{ marginTop: 12 }}
          type="info"
          showIcon
          message="同一邮箱重复邀请会复用原链接；邀请接受是幂等的，重复点击接受不会产生第二条成员关系。"
        />
      </Card>

      <Card title={`成员（${members.length}）`}>
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
              width: 110,
              render: (v: string) =>
                v === 'owner' ? <Tag color="gold">所有者</Tag> : <Tag color="blue">协作者</Tag>,
            },
            {
              title: '操作',
              width: 260,
              render: (_, m) => {
                const isSelf = m.id === currentUserId;
                const isLastOwner = m.role === 'owner' && ownerCount <= 1;
                const disableOwnerAction = isSelf || isLastOwner;
                return (
                  <Space>
                    {m.role === 'member' ? (
                      <Button size="small" disabled={isSelf} loading={busyId === m.id} onClick={() => changeRole(m, 'owner')}>
                        设为所有者
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        disabled={disableOwnerAction}
                        loading={busyId === m.id}
                        title={isLastOwner ? '至少保留一名所有者' : isSelf ? '不能调整自己' : undefined}
                        onClick={() => changeRole(m, 'member')}
                      >
                        降为协作者
                      </Button>
                    )}
                    <Popconfirm
                      title={isLastOwner ? '最后一名所有者不可移除' : `移除 ${m.displayName}？`}
                      description={!isLastOwner ? '其旧登录立即失权，历史有效分享一并撤销。' : undefined}
                      disabled={disableOwnerAction}
                      onConfirm={() => remove(m)}
                    >
                      <Button size="small" danger disabled={disableOwnerAction} loading={busyId === m.id}>
                        移除
                      </Button>
                    </Popconfirm>
                  </Space>
                );
              },
            },
          ]}
        />
        <Alert
          style={{ marginTop: 12 }}
          type="warning"
          showIcon
          message="库必须始终至少有一名所有者：最后一名所有者不可移除、也不可降级。"
        />
      </Card>

      <Card title={`邀请记录（${invites.length}）`}>
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={invites}
          columns={[
            { title: '邮箱', dataIndex: 'email' },
            {
              title: '角色',
              dataIndex: 'role',
              width: 100,
              render: (v: string) => (v === 'owner' ? <Tag color="gold">所有者</Tag> : <Tag color="blue">协作者</Tag>),
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (v: string) => {
                const color = v === 'pending' ? 'processing' : v === 'accepted' ? 'success' : 'default';
                return <Tag color={color}>{v === 'pending' ? '待接受' : v === 'accepted' ? '已接受' : v === 'revoked' ? '已撤销' : '已过期'}</Tag>;
              },
            },
            { title: '过期', width: 170, render: (_, i: LibraryInvite) => fmtDateTime(i.expiresAt, useSession.getState().libraryTz) },
            {
              title: '操作',
              width: 180,
              render: (_, i: LibraryInvite) =>
                i.status === 'pending' ? (
                  <Space>
                    <Button size="small" onClick={() => copyInviteLink(i)}>
                      复制链接
                    </Button>
                    <Popconfirm title="撤销该邀请？撤销后链接立即无法接受。" onConfirm={() => revokeInvite.mutate(i.id)}>
                      <Button size="small" danger>
                        撤销
                      </Button>
                    </Popconfirm>
                  </Space>
                ) : (
                  <Typography.Text type="secondary">—</Typography.Text>
                ),
            },
          ]}
        />
      </Card>
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
          key: 'members',
          label: '成员与邀请',
          children:
            useSession.getState().user?.role === 'owner' ? (
              <MembersTab />
            ) : (
              <Card>
                <Alert type="info" showIcon message="成员与邀请管理仅库所有者可见。" />
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
