// 受保护 setup 请求判定（SETUP-AUTH-01 冻结合同）：纯函数，不读环境、
// 不生成令牌、不记录路径或密钥、不做网络/文件操作。
// 规则：Host 逐字匹配；有 Origin 走浏览器路径（Origin 逐字 + Fetch Metadata
// same-origin，且不要求暴露控制令牌）；无 Origin 走本机助手路径（非空
// expectedToken + controlToken 逐字相等）；混合身份（Origin+令牌）时令牌
// 也必须匹配。大小写敏感逐字比较。

export interface SetupGuardInput {
  host: string | undefined
  origin: string | undefined
  secFetchSite: string | undefined
  controlToken: string | undefined
  expectedHost: string
  expectedOrigin: string
  expectedToken: string
}

export type SetupGuardResult =
  | { ok: true; principal: 'browser' | 'helper' }
  | {
      ok: false
      statusCode: 401 | 403
      code:
        | 'HOST_MISMATCH'
        | 'ORIGIN_MISMATCH'
        | 'FETCH_METADATA_MISMATCH'
        | 'TOKEN_MISSING'
        | 'TOKEN_INVALID'
        | 'TOKEN_UNCONFIGURED'
    }

/** 判定 setup 请求身份：逐字比较（大小写敏感），全部输入显式传入。 */
export function validateSetupRequest(input: SetupGuardInput): SetupGuardResult {
  // 1) Host 逐字匹配，失败 403
  if (input.host !== input.expectedHost) {
    return { ok: false, statusCode: 403, code: 'HOST_MISMATCH' }
  }

  const hasOrigin = input.origin !== undefined && input.origin !== ''

  if (hasOrigin) {
    // 2) 浏览器路径：Origin 逐字匹配
    if (input.origin !== input.expectedOrigin) {
      return { ok: false, statusCode: 403, code: 'ORIGIN_MISMATCH' }
    }
    // 3) Fetch Metadata 存在时必须是 same-origin
    if (input.secFetchSite !== undefined && input.secFetchSite !== 'same-origin') {
      return { ok: false, statusCode: 403, code: 'FETCH_METADATA_MISMATCH' }
    }
    // 4) 混合身份：浏览器路径同时带令牌时令牌也必须匹配
    if (input.controlToken !== undefined && input.controlToken !== input.expectedToken) {
      return { ok: false, statusCode: 401, code: 'TOKEN_INVALID' }
    }
    return { ok: true, principal: 'browser' }
  }

  // 5) 本机助手路径：无 Origin，必须有非空 expectedToken 与逐字相等的 controlToken
  if (input.expectedToken === '') {
    return { ok: false, statusCode: 401, code: 'TOKEN_UNCONFIGURED' }
  }
  if (input.controlToken === undefined || input.controlToken === '') {
    return { ok: false, statusCode: 401, code: 'TOKEN_MISSING' }
  }
  if (input.controlToken !== input.expectedToken) {
    return { ok: false, statusCode: 401, code: 'TOKEN_INVALID' }
  }
  return { ok: true, principal: 'helper' }
}
