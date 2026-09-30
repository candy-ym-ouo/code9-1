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
  invitationInvalid: () => new ApiError('INVITATION_INVALID', 404, '邀请链接不存在'),
  invitationExpired: () => new ApiError('INVITATION_EXPIRED', 410, '邀请已过期'),
  invitationNotPending: (detail = '邀请已被使用或撤销') =>
    new ApiError('INVITATION_NOT_PENDING', 410, detail),
  invitationEmailMismatch: () =>
    new ApiError('INVITATION_EMAIL_MISMATCH', 403, '该邀请不属于当前登录的账号，请用受邀邮箱登录'),
  invitationAlreadyMember: () => new ApiError('INVITATION_ALREADY_MEMBER', 409, '该用户已经是库成员'),
  lastOwner: (detail = '库必须保留至少一名所有者，最后所有者不可移除或降级') =>
    new ApiError('LAST_OWNER', 409, detail),
  badRequest: (message: string, details?: Record<string, unknown>) =>
    new ApiError('BAD_REQUEST', 400, message, details),
};
