// 受保护 setup 请求判定（SETUP-AUTH-01 冻结合同）：纯函数行为回归。
// 测试不打印令牌（断言只用常量比对）；大小写敏感逐字比较。
import { describe, expect, it } from 'vitest'
import { validateSetupRequest, type SetupGuardInput } from '../src/setup/control-guard'

const BASE: SetupGuardInput = {
  host: '127.0.0.1:8787',
  origin: 'http://127.0.0.1:8787',
  secFetchSite: 'same-origin',
  controlToken: undefined,
  expectedHost: '127.0.0.1:8787',
  expectedOrigin: 'http://127.0.0.1:8787',
  expectedToken: 'secret-token',
}

function withOverrides(overrides: Partial<SetupGuardInput>): SetupGuardInput {
  return { ...BASE, ...overrides }
}

describe('validateSetupRequest: browser path', () => {
  it('accepts a correct same-origin browser request without a token', () => {
    const result = validateSetupRequest(BASE)
    expect(result).toEqual({ ok: true, principal: 'browser' })
  })

  it('rejects host mismatch with 403 HOST_MISMATCH', () => {
    const result = validateSetupRequest(withOverrides({ host: '127.0.0.1:9999' }))
    expect(result).toEqual({ ok: false, statusCode: 403, code: 'HOST_MISMATCH' })
  })

  it('rejects origin mismatch with 403 ORIGIN_MISMATCH', () => {
    const result = validateSetupRequest(
      withOverrides({ origin: 'http://evil.example:8787' }),
    )
    expect(result).toEqual({ ok: false, statusCode: 403, code: 'ORIGIN_MISMATCH' })
  })

  it('rejects non-same-origin fetch metadata with 403 FETCH_METADATA_MISMATCH', () => {
    for (const site of ['cross-site', 'same-site', 'none']) {
      const result = validateSetupRequest(withOverrides({ secFetchSite: site }))
      expect(result).toEqual({ ok: false, statusCode: 403, code: 'FETCH_METADATA_MISMATCH' })
    }
  })

  it('accepts requests without fetch metadata (header absent)', () => {
    const result = validateSetupRequest(withOverrides({ secFetchSite: undefined }))
    expect(result).toEqual({ ok: true, principal: 'browser' })
  })

  it('accepts Chromium same-origin requests whose GET omits Origin', () => {
    const result = validateSetupRequest(withOverrides({ origin: undefined }))
    expect(result).toEqual({ ok: true, principal: 'browser' })
  })

  it('rejects a no-Origin cross-site request instead of treating it as a helper', () => {
    const result = validateSetupRequest(withOverrides({ origin: undefined, secFetchSite: 'cross-site' }))
    expect(result).toEqual({ ok: false, statusCode: 403, code: 'FETCH_METADATA_MISMATCH' })
  })

  it('origin comparison is case-sensitive (literal match)', () => {
    const result = validateSetupRequest(
      withOverrides({ origin: 'HTTP://127.0.0.1:8787' }),
    )
    expect(result).toEqual({ ok: false, statusCode: 403, code: 'ORIGIN_MISMATCH' })
  })
})

describe('validateSetupRequest: helper path (no origin)', () => {
  function withoutOrigin(overrides: Partial<SetupGuardInput> = {}): SetupGuardInput {
    return withOverrides({ origin: undefined, secFetchSite: undefined, ...overrides })
  }

  it('accepts a correct helper token', () => {
    const result = validateSetupRequest(withoutOrigin({ controlToken: 'secret-token' }))
    expect(result).toEqual({ ok: true, principal: 'helper' })
  })

  it('rejects missing token with 401 TOKEN_MISSING', () => {
    const result = validateSetupRequest(withoutOrigin({ controlToken: undefined }))
    expect(result).toEqual({ ok: false, statusCode: 401, code: 'TOKEN_MISSING' })
  })

  it('rejects empty-string token with 401 TOKEN_MISSING', () => {
    const result = validateSetupRequest(withoutOrigin({ controlToken: '' }))
    expect(result).toEqual({ ok: false, statusCode: 401, code: 'TOKEN_MISSING' })
  })

  it('rejects wrong token with 401 TOKEN_INVALID', () => {
    const result = validateSetupRequest(withoutOrigin({ controlToken: 'wrong' }))
    expect(result).toEqual({ ok: false, statusCode: 401, code: 'TOKEN_INVALID' })
  })

  it('rejects when expectedToken is unconfigured with 401 TOKEN_UNCONFIGURED', () => {
    const result = validateSetupRequest(
      withoutOrigin({ controlToken: 'anything', expectedToken: '' }),
    )
    expect(result).toEqual({ ok: false, statusCode: 401, code: 'TOKEN_UNCONFIGURED' })
  })

  it('token comparison is case-sensitive', () => {
    const result = validateSetupRequest(withoutOrigin({ controlToken: 'Secret-Token' }))
    expect(result).toEqual({ ok: false, statusCode: 401, code: 'TOKEN_INVALID' })
  })
})

describe('validateSetupRequest: mixed identity', () => {
  it('browser request with a wrong token is rejected 401 TOKEN_INVALID', () => {
    const result = validateSetupRequest(withOverrides({ controlToken: 'wrong' }))
    expect(result).toEqual({ ok: false, statusCode: 401, code: 'TOKEN_INVALID' })
  })

  it('browser request with the correct token still succeeds as browser', () => {
    const result = validateSetupRequest(withOverrides({ controlToken: 'secret-token' }))
    expect(result).toEqual({ ok: true, principal: 'browser' })
  })

  it('undefined expectedToken with browser carrying a token is invalid', () => {
    const result = validateSetupRequest(
      withOverrides({ controlToken: 'x', expectedToken: '' }),
    )
    expect(result).toEqual({ ok: false, statusCode: 401, code: 'TOKEN_INVALID' })
  })
})
