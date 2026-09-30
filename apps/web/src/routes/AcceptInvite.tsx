import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Card, Result, Space, Spin, Typography } from 'antd';
import { post } from '../api/client.js';
import { useSession } from '../stores/session.js';

/**
 * 邀请落地页 /accept-invite/:token
 * - 未登录：先去登录（登录后回到这里）；
 * - 邮箱不符 / 邀请失效：明确报错，令牌不可转交；
 * - 重复接受：幂等提示，不建双关系；
 * - 成功：换发指向受邀库的 token，会话即时切换。
 */
export default function AcceptInvite() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const session = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setLoading(true);
    setError(null);
    try {
      const res = await post<{
        token: string;
        already: boolean;
        user: import('@flil/shared').AuthUser;
        library: { id: string; name: string };
      }>(`/auth/invitations/${token}/accept`, {});
      session.switchSession(res.token, res.user);
      navigate('/', { state: { inviteAccepted: res.already ? 'duplicate' : 'fresh', library: res.library.name } });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (!session.user) {
    return (
      <div style={wrap}>
        <Card style={{ width: 460 }}>
          <Result
            status="info"
            title="先登录再接受邀请"
            subTitle="为核对受邀邮箱，请先登录你收到邀请的账号；登录后会自动回到本页。"
            extra={
              <Button type="primary">
                <Link to={`/login?next=/accept-invite/${encodeURIComponent(token)}`}>去登录 / 注册</Link>
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <Card style={{ width: 460 }}>
        <Spin spinning={loading}>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Typography.Title level={4} style={{ marginBottom: 0 }}>
              接受库邀请
            </Typography.Title>
            <Typography.Text type="secondary">
              当前登录：{session.user.email}。接受后你的活动库将切换到受邀库，角色权限当场生效。
            </Typography.Text>
            {error ? <Alert type="error" showIcon message={error} /> : null}
            <Space>
              <Button type="primary" onClick={accept} loading={loading}>
                接受邀请
              </Button>
              <Button onClick={() => navigate('/')}>返回</Button>
            </Space>
          </Space>
        </Spin>
      </Card>
    </div>
  );
}

const wrap: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'linear-gradient(135deg,#12303f,#2f6f8f)',
};
