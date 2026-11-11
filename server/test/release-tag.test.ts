import { describe, expect, it } from 'vitest'
// @ts-expect-error 发布脚本是 .mjs，无声明文件；仅测试纯函数。
import { buildTagName, changelogHasVersion, parseVersion } from '../../scripts/release/tag-release.mjs'

describe('release tag validation', () => {
  it('normalizes stable and preview versions', () => {
    expect(parseVersion('1.3.6')).toBe('1.3.6')
    expect(parseVersion('v1.4.0')).toBe('1.4.0')
    expect(parseVersion('1.3.7-preview.1')).toBe('1.3.7-preview.1')
    expect(buildTagName('1.3.6')).toBe('v1.3.6')
  })

  it('rejects malformed versions', () => {
    for (const bad of ['1.3', 'v', '1.3.x', '1.3.6.1', '']) {
      expect(() => parseVersion(bad)).toThrow()
    }
  })

  it('requires an exact changelog version heading', () => {
    const changelog = '# 更新记录\n\n## 1.3.6（2026-11-09，修正）\n\n- item\n\n## 1.3.5（2026-11-08）\n'
    expect(changelogHasVersion(changelog, '1.3.6')).toBe(true)
    expect(changelogHasVersion(changelog, '1.3.5')).toBe(true)
    expect(changelogHasVersion(changelog, '1.3.4')).toBe(false)
    expect(changelogHasVersion(changelog, '1.3')).toBe(false)
  })
})