import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Form, Input, Space, Tabs, Typography, message } from 'antd';
import type { AuthUser } from '@flil/shared';
import { post } from '../api/client.js';
import { useSession } from '../stores/session.js';

export default function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const setSession = useSession((s) => s.setSession);

  async function submit(values: { email: string; password: string; displayName?: string; libraryName?: string }) {
    setLoading(true);
    setError(null);
    try {
      const res =
        mode === 'login'
          ? await post<{ token: string; user: AuthUser }>('/auth/login', values)
          : await post<{ token: string; user: AuthUser }>('/auth/register', values);
      setSession(res.token, res.user);
      message.success(mode === 'login' ? '已登录' : '已创建你的灵感库');
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg,#12303f,#2f6f8f)',
      }}
    >
      <Card style={{ width: 420 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Title level={3} style={{ marginBottom: 0 }}>
            电影取景灵感库
          </Typography.Title>
          <Typography.Text type="secondary">
            收藏现实中的光线、建筑、色彩与构图，并记下"什么时候、什么天气"才能再拍到。
          </Typography.Text>
          <Tabs
            activeKey={mode}
            onChange={(k) => setMode(k as 'login' | 'register')}
            items={[
              { key: 'login', label: '登录' },
              { key: 'register', label: '注册（首个账号即库所有者）' },
            ]}
          />
          {error ? <Alert type="error" showIcon message={error} /> : null}
          <Form layout="vertical" onFinish={submit}>
            <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email' }]}>
              <Input placeholder="you@example.com" />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true, min: mode === 'register' ? 8 : 1 }]}
              extra={mode === 'register' ? '至少 8 位' : undefined}
            >
              <Input.Password />
            </Form.Item>
            {mode === 'register' ? (
              <>
                <Form.Item name="displayName" label="昵称" rules={[{ required: true }]}>
                  <Input />
                </Form.Item>
                <Form.Item name="libraryName" label="库名称（可选）">
                  <Input placeholder="我的取景灵感库" />
                </Form.Item>
              </>
            ) : null}
            <Button type="primary" htmlType="submit" block loading={loading}>
              {mode === 'login' ? '登录' : '创建库'}
            </Button>
          </Form>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            注册后系统会写入四域内置标签（光线 / 建筑场景 / 色彩 / 构图），但不会预置任何灵感卡——所有数据都是你自己的。
          </Typography.Text>
        </Space>
      </Card>
    </div>
  );
}
