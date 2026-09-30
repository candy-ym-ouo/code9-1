import type { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { errors } from './errors.js';
import { logger } from '../logger.js';
import { fail } from './respond.js';
import type { AuthUser } from '@flil/shared';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthUser;
    requestId?: string;
  }
}

export interface JwtPayload extends AuthUser {
  iat?: number;
  exp?: number;
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ ...user }, config.jwtSecret, { expiresIn: '7d' });
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  req.requestId = req.header('x-request-id') ?? crypto.randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}

export function requestLog(req: Request, res: Response, next: NextFunction): void {
  const started = Date.now();
  res.on('finish', () => {
    logger.info('http', {
      requestId: req.requestId,
      method: req.method,
      // 只记路径模式，避免 query 里夹带坐标
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - started,
    });
  });
  next();
}

export function authenticate(required = true) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      if (required) {
        fail(res, errors.authRequired());
        return;
      }
      next();
      return;
    }
    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
    } catch {
      if (required) {
        fail(res, errors.authRequired());
        return;
      }
      next();
      return;
    }

    // 即时失效的关键：JWT 只证明"你是谁"，成员关系与角色**每次请求回库现查**，
    // 不信任签发时冻结在 token 里的 role/libraryId（token 最长 7 天）。
    // 角色调整 → 本次请求起即按新角色鉴权（含精确坐标出口）；
    // 成员从 token 所指库移除（或邀请关系失效）→ 下次请求即 401，
    // 不静默切到该用户名下其他库（他仍可重新登录或凭新邀请令牌换发新 token）。
    const member = getDb()
      .prepare('SELECT library_id, role FROM library_member WHERE user_id = ? AND library_id = ?')
      .get(payload.id, payload.libraryId) as { library_id: string; role: AuthUser['role'] } | undefined;
    if (!member) {
      if (required) {
        fail(res, errors.authRequired());
        return;
      }
      next();
      return;
    }
    req.auth = { ...payload, libraryId: member.library_id, role: member.role };
    next();
  };
}

export function requireOwner(req: Request): void {
  if (!req.auth) throw errors.authRequired();
  // role 已在 authenticate 中按库内最新关系刷新，这里读到的是实时值
  if (req.auth.role !== 'owner') throw errors.forbiddenRole('该操作仅所有者（owner）可执行');
}

export function currentUser(req: Request): AuthUser {
  if (!req.auth) throw errors.authRequired();
  return req.auth;
}

/** 简单内存限流（个人自用场景足够） */
export function rateLimit(name: string, max: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${name}:${req.ip ?? 'unknown'}`;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt < now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    entry.count += 1;
    if (entry.count > max) {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: '请求过于频繁', details: {} } });
      return;
    }
    next();
  };
}
