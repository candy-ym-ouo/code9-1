import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import type { FuzzLevel } from '@flil/shared';

const serverRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(serverRoot, '../..');

function env(key: string, fallback: string): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function resolveDir(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
}

export const config = {
  repoRoot,
  serverRoot,
  env: env('NODE_ENV', 'development'),
  port: Number(env('PORT', '3000')),
  webOrigin: env('WEB_ORIGIN', 'http://localhost:5173'),
  jwtSecret: env('JWT_SECRET', 'dev-secret-change-me'),
  tz: env('TZ', 'Asia/Shanghai'),
  databaseFile: resolveDir(env('DATABASE_URL', './data/app.db').replace(/^file:/, '')),
  uploadDir: resolveDir(env('UPLOAD_DIR', './data/uploads')),
  thumbDir: resolveDir(env('THUMB_DIR', './data/thumbs')),
  shareDir: resolveDir(env('SHARE_DIR', './data/share')),
  backupDir: resolveDir(env('BACKUP_DIR', './data/backups')),
  sqlDir: path.resolve(serverRoot, 'sql'),
  mapTileUrl: env('MAP_TILE_URL', 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'),
  weatherProvider: env('WEATHER_PROVIDER', 'open-meteo') as 'open-meteo' | 'off' | 'fixture',
  weatherCacheTtlMin: Number(env('WEATHER_CACHE_TTL_MIN', '360')),
  defaultFuzzLevel: env('DEFAULT_FUZZ_LEVEL', 'g500') as FuzzLevel,
  shareMaxExpireDays: Number(env('SHARE_MAX_EXPIRE_DAYS', '180')),
  inviteTtlDays: Number(env('INVITE_TTL_DAYS', '14')),
  enableShare: env('ENABLE_SHARE', 'true') === 'true',
  windowForecastDays: Number(env('WINDOW_FORECAST_DAYS', '7')),
  windowScanCron: env('WINDOW_SCAN_CRON', '0 * * * *'),
  reminderQuietHours: env('REMINDER_QUIET_HOURS', '22:00-07:00'),
  backupKeep: Number(env('BACKUP_KEEP', '14')),
  climateBaselineEnabled: env('ENABLE_CLIMATE_BASELINE', 'true') === 'true',
} as const;

export function ensureDirs(): void {
  for (const dir of [config.uploadDir, config.thumbDir, config.shareDir, config.backupDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.mkdirSync(path.dirname(config.databaseFile), { recursive: true });
}
