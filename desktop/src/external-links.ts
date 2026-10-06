// PACK-02 外部链接处置决策（DESKTOP-EXTERNAL-LINKS）。
// 纯函数：URL → 'external'（交系统默认浏览器）| 'in-app'（应用源内放行）| 'denied'（拒绝且不外开）。
// 口径＝PACK-02 派发简报决策④＋WHATWG URL 标准解析。
export type UrlDisposition = 'external' | 'in-app' | 'denied'

export function classifyUrl(rawUrl: string, appOrigin: string): UrlDisposition {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return 'denied'
  }
  if (parsed.origin === appOrigin) return 'in-app'
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return 'external'
  return 'denied'
}
