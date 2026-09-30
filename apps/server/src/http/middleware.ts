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
    try {
      const payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
      // 即时失效（成员邀请/角色调整第一不变量）：JWT 里的 role/libraryId 只是登录时的快照，
      // 不能据此放行。每个请求都回查成员表——被移除则立即 401（旧 token 当场作废），
      // 被降级则立即按 member 处理（精确坐标出口 toSpotDto 随之只给模糊点）。
      const member = getDb()
        .prepare('SELECT role FROM library_member WHERE library_id = ? AND user_id = ?')
        .get(payload.libraryId, payload.id) as { role: 'owner' | 'member' } | undefined;
      if (!member) throw new Error('membership revoked');
      req.auth = { ...payload, role: member.role };
      next();
    } catch {
      if (required) {
        fail(res, errors.authRequired());
        return;
      }
      next();
    }
  };
}

export function requireOwner(req: Request): void {
  if (!req.auth) throw errors.authRequired();
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
