import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Card, Result, Space, Spin, Tag, Typography } from 'antd';
import type { AuthUser } from '@flil/shared';
import { get, post, ApiError } from '../api/client.js';
import { useSession } from '../stores/session.js';

interface InvitePreview {
  libraryName: string;
  role: 'owner' | 'member';
  email: string;
  expiresAt: string;
  matchesCurrentUser: boolean;
}

interface AcceptResult {
  alreadyJoined: boolean;
  role: 'owner' | 'member';
  library: { id: string; name: string; tz: string };
  token: string;
  user: AuthUser;
}

/**
 * 邀请接受页（公开，无需先属于该库）。
 * - 未登录：提示先登录/注册（被邀请邮箱），登录后回到本页。
 * - 已登录但邮箱不符：明确提示切换账号。
 * - 重复接受：后端幂等返回 alreadyJoined，不产生第二条成员关系。
 */
export default function InviteAccept() {
  const { token: inviteToken } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const session = useSession();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [done, setDone] = useState<AcceptResult | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  async function loadPreview() {
    setLoadingPreview(true);
    setError(null);
    try {
      setPreview(await get<InvitePreview>(`/invites/${inviteToken}`));
    } catch (err) {
      const e = err as ApiError;
      setError({ code: e.code, message: e.message });
    } finally {
      setLoadingPreview(false);
    }
  }

  useEffect(() => {
    if (!session.token) {
      setLoadingPreview(false);
      return;
    }
    void loadPreview();
    // 登录后回到本页时 session.token 变化，重新拉预览
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.token, inviteToken]);

  async function accept() {
    setAccepting(true);
    setError(null);
    try {
      const res = await post<AcceptResult>(`/invites/${inviteToken}/accept`, {});
      setDone(res);
      session.setSession(res.token, res.user);
    } catch (err) {
      const e = err as ApiError;
      setError({ code: e.code, message: e.message });
    } finally {
      setAccepting(false);
    }
  }

  const card = (inner: React.ReactNode) => (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg,#12303f,#2f6f8f)',
      }}
    >
      <Card style={{ width: 460 }}>{inner}</Card>
    </div>
  );

  if (done) {
    return card(
      <Result
        status="success"
        title={done.alreadyJoined ? '你已经是该库成员' : '已加入协作库'}
        subTitle={
          <Space direction="vertical">
            <Typography.Text>{done.library.name}</Typography.Text>
            <Tag color={done.role === 'owner' ? 'gold' : 'blue'}>
              {done.role === 'owner' ? '所有者' : '协作者'}
            </Tag>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              角色与坐标权限已即时生效；精确坐标仅所有者可见。
            </Typography.Text>
          </Space>
        }
        extra={
          <Button type="primary" onClick={() => navigate('/')}>
            进入灵感库
          </Button>
        }
      />,
    );
  }

  if (!session.token) {
    return card(
      <Space direction="vertical" style={{ width: '100%' }}>
        <Typography.Title level={4} style={{ marginBottom: 0 }}>
          你收到一个协作邀请
        </Typography.Title>
        <Typography.Text type="secondary">请先用被邀请的邮箱登录（没有账号请先注册），登录后会自动回到本页。</Typography.Text>
        <Button type="primary" block onClick={() => navigate(`/login?next=/invite/${inviteToken}`)}>
          去登录 / 注册
        </Button>
      </Space>,
    );
  }

  if (loadingPreview) return card(<Spin style={{ display: 'block', margin: '24px auto' }} />);

  if (error) {
    const map: Record<string, { title: string; desc: string }> = {
      INVITE_REVOKED: { title: '邀请已被撤销', desc: '邀请链接已被所有者撤销，无法再接受。' },
      INVITE_EXPIRED: { title: '邀请已过期', desc: '邀请链接超过有效期，请联系所有者重新邀请。' },
      INVITE_ACCEPTED: { title: '邀请已使用', desc: '该邀请已被接受。' },
      NOT_FOUND: { title: '邀请不存在', desc: '链接可能有误。' },
    };
    const meta = map[error.code] ?? { title: '无法接受邀请', desc: error.message };
    return card(
      <Result
        status="error"
        title={meta.title}
        subTitle={meta.desc}
        extra={<Button onClick={() => navigate('/')}>返回首页</Button>}
      />,
    );
  }

  if (!preview) return null;

  return card(
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Typography.Title level={4} style={{ marginBottom: 0 }}>
        接受协作邀请
      </Typography.Title>
      <Typography.Text>
        库：<strong>{preview.libraryName}</strong>
      </Typography.Text>
      <Space>
        <span>角色</span>
        <Tag color={preview.role === 'owner' ? 'gold' : 'blue'}>
          {preview.role === 'owner' ? '所有者（可见精确坐标）' : '协作者（仅见模糊坐标）'}
        </Tag>
      </Space>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        被邀请邮箱：{preview.email}
      </Typography.Text>
      {!preview.matchesCurrentUser ? (
        <Alert
          type="warning"
          showIcon
          message="当前登录账号与被邀请邮箱不一致"
          description="请退出后用被邀请的邮箱登录再接受。"
        />
      ) : (
        <Alert
          type="info"
          showIcon
          message="加入即生效"
          description="若你以后被移除或调整角色，你的访问权限与历史分享会立即失效，无需对方重新登录等待。"
        />
      )}
      <Button
        type="primary"
        block
        loading={accepting}
        disabled={!preview.matchesCurrentUser}
        onClick={accept}
      >
        接受邀请
      </Button>
    </Space>,
  );
}
