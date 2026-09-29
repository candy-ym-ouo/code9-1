import type { Request, Response } from 'express';
import { ApiError } from './errors.js';

export function ok<T>(res: Response, data: T, status = 200): void {
  res.status(status).json(data);
}

export function fail(res: Response, err: unknown): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details ?? {} },
    });
    return;
  }
  // zod 校验失败应视为 400（而不是 500），并把 issue 列表返回给前端
  const maybeZod = err as { name?: string; issues?: { path: (string | number)[]; message: string }[] };
  if (maybeZod?.name === 'ZodError' && Array.isArray(maybeZod.issues)) {
    res.status(400).json({
      error: {
        code: 'BAD_REQUEST',
        message: '请求参数校验失败',
        details: {
          issues: maybeZod.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      },
    });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, details: {} } });
}

type AsyncHandler = (req: Request, res: Response) => Promise<unknown>;

/** 包装 async 路由，异常统一走 fail() */
export function ah(fn: AsyncHandler) {
  return (req: Request, res: Response): void => {
    void fn(req, res).catch((err) => fail(res, err));
  };
}
