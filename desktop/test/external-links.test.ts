// PACK-02（DESKTOP-EXTERNAL-LINKS）：外部链接处置决策。
// oracle 独立性：期望来自 PACK-02 派发简报决策④（应用源之外的 http(s) 一律系统默认浏览器，
// 应用内不弹新 Electron 窗口；非 http(s) 拒绝）＋ WHATWG URL 标准解析口径。
import { describe, expect, it } from 'vitest'
import { classifyUrl } from '../src/external-links.js'

const APP_ORIGIN = 'http://127.0.0.1:8787'

describe('DESKTOP-EXTERNAL-LINKS：外部链接处置', () => {
  it('DESKTOP-EXTERNAL-LINKS: an external http(s) link opens in the system browser and never a new Electron window', () => {
    expect(classifyUrl('https://github.com/m1kustark/a-share-kline-trainer', APP_ORIGIN)).toBe('external')
    expect(classifyUrl('http://example.com/docs', APP_ORIGIN)).toBe('external')
    // 应用源不同端口＝外部
    expect(classifyUrl('http://127.0.0.1:9999/other', APP_ORIGIN)).toBe('external')
    // localhost 与 127.0.0.1 不同 host＝外部（保守：源比较逐字）
    expect(classifyUrl('http://localhost:8787/', APP_ORIGIN)).toBe('external')
  })

  it('DESKTOP-EXTERNAL-LINKS: app-origin navigation stays in-app', () => {
    expect(classifyUrl('http://127.0.0.1:8787/', APP_ORIGIN)).toBe('in-app')
    expect(classifyUrl('http://127.0.0.1:8787/training?tab=1', APP_ORIGIN)).toBe('in-app')
  })

  it('DESKTOP-EXTERNAL-LINKS: non-http schemes are denied without external handling', () => {
    expect(classifyUrl('file:///C:/Windows/win.ini', APP_ORIGIN)).toBe('denied')
    expect(classifyUrl('mailto:someone@example.com', APP_ORIGIN)).toBe('denied')
    expect(classifyUrl('about:blank', APP_ORIGIN)).toBe('denied')
    expect(classifyUrl('chrome://settings', APP_ORIGIN)).toBe('denied')
    // 垃圾字符串：无法解析 → 拒绝
    expect(classifyUrl('not a url', APP_ORIGIN)).toBe('denied')
    expect(classifyUrl('', APP_ORIGIN)).toBe('denied')
  })
})
