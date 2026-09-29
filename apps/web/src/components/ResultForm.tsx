import { useState } from 'react';
import { Alert, Button, Form, Input, Modal, Space, Tag, Typography } from 'antd';
import type { HitLevel } from '@flil/shared';
import { HIT_LABEL } from '../lib/format.js';
import { useFillResult, useMeta } from '../api/hooks.js';

interface Props {
  open: boolean;
  planId: string | null;
  inspirationTitle?: string;
  onClose: (changed: boolean) => void;
}

const HIT_COLOR: Record<HitLevel, string> = { hit: 'green', partial: 'orange', miss: 'default' };

/** 回填是闭环的最后一厘米：三个按钮 + 最多再问一个问题（文档 10.2⑤） */
export function ResultForm({ open, planId, inspirationTitle, onClose }: Props) {
  const [hitLevel, setHitLevel] = useState<HitLevel | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [feedback, setFeedback] = useState<string[]>([]);
  const fill = useFillResult();
  const { data: meta } = useMeta();

  async function submit() {
    if (!planId || !hitLevel) return;
    if (hitLevel !== 'hit' && reasons.length === 0) return;
    try {
      const res = await fill.mutateAsync({ planId, hitLevel, missReasons: reasons, note: note || null });
      const lines: string[] = [`该卡命中率更新为 ${(res.hitRate * 100).toFixed(0)}%`];
      for (const t of res.tightened) {
        lines.push(`系统已把 ${t.field} 从 ${JSON.stringify(t.before)} 收紧到 ${JSON.stringify(t.after)}（可在校准历史中撤销）`);
      }
      lines.push(...res.suggestions);
      setFeedback(lines);
      setHitLevel(null);
      setReasons([]);
      setNote('');
    } catch (err) {
      setFeedback([(err as Error).message]);
    }
  }

  return (
    <Modal
      open={open}
      title={`去拍了吗？${inspirationTitle ? `（${inspirationTitle}）` : ''}`}
      onCancel={() => {
        setFeedback([]);
        onClose(feedback.length > 0);
      }}
      footer={
        feedback.length ? (
          <Button type="primary" onClick={() => onClose(true)}>
            知道了
          </Button>
        ) : (
          <Space>
            <Button onClick={() => onClose(false)}>稍后</Button>
            <Button type="primary" loading={fill.isPending} disabled={!hitLevel} onClick={submit}>
              提交
            </Button>
          </Space>
        )
      }
    >
      {feedback.length ? (
        <Space direction="vertical">
          {feedback.map((f) => (
            <Alert key={f} type="info" showIcon message={f} />
          ))}
        </Space>
      ) : (
        <Form layout="vertical">
          <Space size="large" style={{ marginBottom: 16 }}>
            {(['hit', 'partial', 'miss'] as HitLevel[]).map((level) => (
              <Button
                key={level}
                type={hitLevel === level ? 'primary' : 'default'}
                danger={false}
                onClick={() => setHitLevel(level)}
              >
                {HIT_LABEL[level]}
              </Button>
            ))}
          </Space>

          {hitLevel && hitLevel !== 'hit' ? (
            <Form.Item label="差在哪？（可多选）" required>
              <Space wrap>
                {(meta?.missReasons ?? []).map((r) => (
                  <Tag.CheckableTag
                    key={r.key}
                    checked={reasons.includes(r.key)}
                    onChange={() =>
                      setReasons((prev) => (prev.includes(r.key) ? prev.filter((x) => x !== r.key) : [...prev, r.key]))
                    }
                  >
                    {r.label}
                  </Tag.CheckableTag>
                ))}
              </Space>
            </Form.Item>
          ) : null}

          <Form.Item label="备注">
            <Input.TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="可选" />
          </Form.Item>

          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            连拍成片可以在卡片详情页以「实拍」角色上传，会和参考图并排展示。
          </Typography.Text>
          <div style={{ marginTop: 8 }}>
            <Tag color={hitLevel ? HIT_COLOR[hitLevel] : undefined}>
              {hitLevel ? HIT_LABEL[hitLevel] : '先选一个结果'}
            </Tag>
          </div>
        </Form>
      )}
    </Modal>
  );
}
