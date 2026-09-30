export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const errors = {
  authRequired: () => new ApiError('AUTH_REQUIRED', 401, '未登录或登录已失效'),
  forbiddenRole: (detail?: string) => new ApiError('FORBIDDEN_ROLE', 403, detail ?? '当前角色无权执行该操作'),
  scopeDenied: () => new ApiError('LIBRARY_SCOPE_DENIED', 403, '不属于当前库的数据'),
  notFound: (what = '资源') => new ApiError('NOT_FOUND', 404, `${what}不存在`),
  fuzzTooPrecise: () =>
    new ApiError('FUZZ_LEVEL_TOO_PRECISE', 400, '对外分享的模糊级别不得高于 500m（不允许 exact / g100）'),
  timingIncomplete: (detail?: string) =>
    new ApiError('TIMING_INCOMPLETE', 422, detail ?? '条件不完整，无法计算窗口'),
  anchorUnresolvable: (detail: string) => new ApiError('ANCHOR_UNRESOLVABLE', 422, detail),
  weatherUnavailable: () => new ApiError('WEATHER_SOURCE_UNAVAILABLE', 503, '天气源不可用，已进入降级模式'),
  albumHasRequiredGaps: (n: number) =>
    new ApiError('ALBUM_HAS_REQUIRED_GAPS', 409, `存在 ${n} 条必需缺口，无法发布`),
  resultAlreadyFilled: () => new ApiError('RESULT_ALREADY_FILLED', 409, '该计划已回填，如需修改请使用修订接口'),
  geoOutOfRange: () => new ApiError('GEO_OUT_OF_RANGE', 422, '坐标越界或缺失'),
  shareExpired: () => new ApiError('SHARE_EXPIRED', 401, '分享链接已过期'),
  shareRevoked: () => new ApiError('SHARE_REVOKED', 401, '分享链接已撤销'),
  sharePasswordRequired: () => new ApiError('SHARE_PASSWORD_REQUIRED', 401, '需要访问密码'),
  alreadyMember: () => new ApiError('ALREADY_MEMBER', 409, '该用户已经是库成员，无需重复邀请'),
  lastOwnerCannotChange: () =>
    new ApiError('LAST_OWNER_PROTECTED', 409, '库至少要保留一名所有者，最后一个所有者不可移除或降级'),
  inviteEmailMismatch: () =>
    new ApiError('INVITE_EMAIL_MISMATCH', 403, '当前登录账号与邀请的邮箱不一致，请用被邀请的邮箱登录'),
  inviteExpired: () => new ApiError('INVITE_EXPIRED', 410, '邀请链接已过期'),
  inviteRevoked: () => new ApiError('INVITE_REVOKED', 410, '邀请链接已被撤销'),
  inviteAccepted: () => new ApiError('INVITE_ACCEPTED', 410, '邀请已被接受，无需重复操作'),
  inviteNotPending: () => new ApiError('INVITE_NOT_PENDING', 409, '邀请不是待接受状态，无法撤销'),
  badRequest: (message: string, details?: Record<string, unknown>) =>
    new ApiError('BAD_REQUEST', 400, message, details),
};
