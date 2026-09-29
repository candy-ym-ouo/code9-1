import type { WeatherProfile } from './types.js';

export interface WeatherPreset {
  key: string;
  name: string;
  description: string;
  profile: WeatherProfile;
}

/** 天气画像预设（文档 12 与 21.4）：不是演示数据，是用户"点击即用"的起点 */
export const WEATHER_PRESETS: WeatherPreset[] = [
  {
    key: 'clear_hard',
    name: '晴朗硬光',
    description: '云量低、能见度高，适合强方向光、长投影、高对比画面。',
    profile: {
      cloudCoverPct: { min: 0, max: 20 },
      precipProbPctMax: 10,
      visibilityKmMin: 15,
      windSpeedMax: 6,
      phenomena: ['clear'],
      hardRequirements: ['precipProbPctMax'],
    },
  },
  {
    key: 'thin_cloud_soft',
    name: '薄云柔光',
    description: '云量适中，光比柔和，是拍人像与建筑细节最稳的一档。',
    profile: {
      cloudCoverPct: { min: 20, max: 60 },
      precipProbPctMax: 20,
      visibilityKmMin: 10,
      windSpeedMax: 6,
      phenomena: ['thin_cloud'],
      hardRequirements: ['precipProbPctMax'],
    },
  },
  {
    key: 'overcast_scatter',
    name: '阴天散射',
    description: '云量高、无硬阴影，适合色彩与材质的平铺表达。',
    profile: {
      cloudCoverPct: { min: 70, max: 100 },
      precipProbPctMax: 30,
      visibilityKmMin: 8,
      windSpeedMax: 8,
      phenomena: ['overcast'],
      hardRequirements: ['precipProbPctMax'],
    },
  },
  {
    key: 'after_rain_wet',
    name: '雨后湿地面',
    description: '要求窗口前 6 小时有过降水、当下不下雨，地面反光与霓虹倒影的前提。',
    profile: {
      precipProbPctMax: 20,
      visibilityKmMin: 6,
      windSpeedMax: 6,
      phenomena: ['after_rain', 'wet_ground'],
      hardRequirements: ['precipProbPctMax'],
    },
  },
];
