import { useMemo, useState } from 'react';
import { Checkbox, Collapse, Empty, Input, Space, Tag, Typography } from 'antd';
import type { TagDto } from '@flil/shared';

interface Props {
  tree: TagDto[];
  value: string[];
  onChange: (next: string[]) => void;
  /** 每个域的常用标签置顶数量（对应文档 10.2① 的 10 秒打标） */
  quickCount?: number;
}

const DOMAIN_LABEL: Record<string, string> = {
  light: '光线',
  scene: '建筑场景',
  color: '色彩',
  composition: '构图',
};

interface FlatTag {
  id: string;
  name: string;
  domain: string;
  usageCount: number;
  groupName: string;
}

function flatten(tree: TagDto[]): FlatTag[] {
  const out: FlatTag[] = [];
  for (const group of tree) {
    for (const leaf of group.children ?? []) {
      out.push({
        id: leaf.id,
        name: leaf.name,
        domain: leaf.domain,
        usageCount: leaf.usageCount,
        groupName: group.name,
      });
    }
  }
  return out;
}

export function TagPicker({ tree, value, onChange, quickCount = 8 }: Props) {
  const [keyword, setKeyword] = useState('');
  const flat = useMemo(() => flatten(tree), [tree]);

  const quick = useMemo(() => {
    const byDomain = new Map<string, FlatTag[]>();
    for (const t of flat) {
      const list = byDomain.get(t.domain) ?? [];
      list.push(t);
      byDomain.set(t.domain, list);
    }
    return [...byDomain.entries()].map(([domain, list]) => ({
      domain,
      items: list.sort((a, b) => b.usageCount - a.usageCount).slice(0, quickCount),
    }));
  }, [flat, quickCount]);

  const searched = useMemo(() => {
    if (!keyword.trim()) return [];
    const k = keyword.trim().toLowerCase();
    return flat.filter((t) => t.name.toLowerCase().includes(k) || t.groupName.toLowerCase().includes(k)).slice(0, 30);
  }, [flat, keyword]);

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  const idToName = new Map(flat.map((t) => [t.id, t.name]));

  return (
    <div>
      <Input.Search
        placeholder="搜索标签（如：逆光 / 拱廊 / 雨）"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        allowClear
        style={{ marginBottom: 12 }}
      />

      {keyword.trim() ? (
        <Space wrap size={[6, 6]} style={{ marginBottom: 12 }}>
          {searched.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的标签" /> : null}
          {searched.map((t) => (
            <Tag.CheckableTag
              key={t.id}
              data-testid={`tag-${t.name}`}
              checked={value.includes(t.id)}
              onChange={() => toggle(t.id)}
            >
              {t.name}
              <span style={{ opacity: 0.5, marginLeft: 4 }}>{DOMAIN_LABEL[t.domain]}</span>
            </Tag.CheckableTag>
          ))}
        </Space>
      ) : null}

      <div style={{ marginBottom: 12 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          已选 {value.length} 个：
        </Typography.Text>
        <Space wrap size={[4, 4]} style={{ marginLeft: 8 }}>
          {value.length === 0 ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              还没选标签，卡片无法进入检索
            </Typography.Text>
          ) : (
            value.map((id) => (
              <Tag key={id} closable onClose={() => toggle(id)} color="blue">
                {idToName.get(id) ?? id}
              </Tag>
            ))
          )}
        </Space>
      </div>

      <Collapse
        size="small"
        items={tree.map((group) => ({
          key: group.id,
          label: (
            <span>
              <strong>{DOMAIN_LABEL[group.domain]}</strong>
              <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                {group.name} · {(group.children ?? []).length} 个
              </Typography.Text>
            </span>
          ),
          children: (
            <Checkbox.Group
              value={value}
              onChange={(next) => onChange(next as string[])}
              style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
            >
              {(group.children ?? []).map((leaf) => (
                <Checkbox key={leaf.id} value={leaf.id}>
                  {leaf.name}
                  {leaf.usageCount > 0 ? (
                    <Typography.Text type="secondary" style={{ marginLeft: 4, fontSize: 11 }}>
                      {leaf.usageCount}
                    </Typography.Text>
                  ) : null}
                </Checkbox>
              ))}
            </Checkbox.Group>
          ),
        }))}
      />

      <div style={{ marginTop: 12 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          高频标签（点一下就打上）
        </Typography.Text>
        <div style={{ marginTop: 6 }}>
          {quick.map(({ domain, items }) => (
            <div key={domain} style={{ marginBottom: 6 }}>
              <Typography.Text style={{ fontSize: 12, marginRight: 6 }}>{DOMAIN_LABEL[domain]}</Typography.Text>
              <Space wrap size={[4, 4]}>
                {items.map((t) => (
                  <Tag.CheckableTag
                    key={t.id}
                    data-testid={`quick-tag-${t.name}`}
                    checked={value.includes(t.id)}
                    onChange={() => toggle(t.id)}
                  >
                    {t.name}
                  </Tag.CheckableTag>
                ))}
              </Space>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
