import { Image, Space, Tag, Typography } from 'antd';
import type { AssetDto } from '@flil/shared';
import { authedImageUrl } from '../api/client.js';
import { fmtDateTime } from '../lib/format.js';

interface Props {
  assets: AssetDto[];
  tz: string;
  onPick?: (asset: AssetDto) => void;
}

const ROLE_LABEL: Record<string, string> = {
  reference: '参考',
  detail: '细节',
  panorama: '全景',
  result: '实拍',
};

export function AssetStrip({ assets, tz, onPick }: Props) {
  if (!assets.length) {
    return <Typography.Text type="secondary">还没有图片。上传后系统会自动生成缩略图并提取主色。</Typography.Text>;
  }
  return (
    <Space wrap size={12}>
      {assets.map((a) => (
        <div key={a.id} style={{ width: 160 }} onClick={() => onPick?.(a)}>
          <Image src={authedImageUrl(a.thumbUrl)} width={160} height={110} style={{ objectFit: 'cover', borderRadius: 8 }} />
          <div style={{ marginTop: 4 }}>
            <Tag color={a.role === 'result' ? 'purple' : 'blue'}>{ROLE_LABEL[a.role] ?? a.role}</Tag>
            {a.hasGpsExif ? <Tag color="orange">含 GPS（未入库）</Tag> : null}
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {a.shotAt ? fmtDateTime(a.shotAt, tz) : '无拍摄时间'}
            {a.sunElevation !== null ? ` · 仰角 ${a.sunElevation.toFixed(1)}°` : ''}
          </Typography.Text>
          {a.palette.length ? (
            <div style={{ display: 'flex', marginTop: 3, height: 8, borderRadius: 4, overflow: 'hidden' }}>
              {a.palette.map((c) => (
                <div key={c.hex} style={{ background: c.hex, flexGrow: c.ratio, flexBasis: 0 }} />
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </Space>
  );
}
