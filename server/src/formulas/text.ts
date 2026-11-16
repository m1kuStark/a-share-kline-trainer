/** 全角标点：通达信公式只识别半角标点，命中即告警但不改用户文本 */
const FULL_WIDTH_PUNCTUATION = /[，。；：（）！？、“”‘’【】《》]/

export interface NormalizedFormulaSource {
  source: string
  warnings: string[]
}

/**
 * M9-04A 通达信文本导入规范化：
 * - 去 UTF-8 BOM、CRLF/CR → LF、首尾空白
 * - 全角标点只告警（UI 提示用户改回半角），不静默替换（避免改变用户公式语义）
 * - 多行源码与单行粘贴版同路径；// 与 {…} 注释由引擎 lexer 原生支持
 * - 公式名/参数区不在本函数处理（本卡只保存源码）
 */
export function normalizeFormulaSource(input: string): NormalizedFormulaSource {
  const source = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
  const warnings: string[] = []
  if (FULL_WIDTH_PUNCTUATION.test(source)) {
    warnings.push('检测到全角标点；通达信公式仅识别半角标点，保存/运行前请改为半角')
  }
  if (!source) warnings.push('公式源码为空')
  return { source, warnings }
}
