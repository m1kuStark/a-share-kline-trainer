// INSTALL-01（2026-10-11 用户拍板，矩阵行 INSTALL-NSIS-ASSISTED）main.ts 数据目录粘合源码契约。
// main.ts 属 Electron 粘合层（import electron 的文件无法在 vitest 直接加载），按既有
// 「主进程粘合源码契约」先例（main-process-guards.test.ts / desktop-updates.test.ts PACK-04
// 契约段）以源码正则锁定 INSTALL-01 收敛语义：
//   - 双候选决策对话框（「发现两份训练数据」）随 exe-data 候选退役：唯一候选不可能双命中，
//     askDataHomeDialog 及其 env 应答注入（parseDataHomeAnswerEnv）不再存在于启动路径；
//   - data-home 依赖以无 ask 形态构造（createNodeDataHomeDeps({})）；
//   - saved-tdx-choice 搜索目录注入 homeDir（savedChoiceSearchDir 第三参＝homedir()，
//     不再传 exeDir——兜底目录＝唯一默认 %USERPROFILE%\.a-share-kline-trainer）。
// oracle：用户 2026-10-11 拍板原文（矩阵行 oracle 字段）。CRLF 兼容：正则用 \s 而非字面换行。
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

async function readMainSource(): Promise<string> {
  return readFile(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8')
}

describe('INSTALL-01: main.ts data-home glue (source contract)', () => {
  it('the retired dual-candidate dialog (askDataHomeDialog) is absent from the boot path', async () => {
    const source = await readMainSource()
    expect(source).not.toMatch(/askDataHomeDialog/)
  })

  it('the env answer injection (parseDataHomeAnswerEnv) is no longer consumed at boot', async () => {
    const source = await readMainSource()
    expect(source).not.toMatch(/parseDataHomeAnswerEnv/)
  })

  it('data-home deps are constructed without an ask callback (single candidate cannot ask)', async () => {
    const source = await readMainSource()
    expect(source).toMatch(/createNodeDataHomeDeps\(\s*\{\s*\}\s*\)/)
  })

  it('savedChoiceSearchDir receives the home dir (unique default fallback), not the exe dir', async () => {
    const source = await readMainSource()
    expect(source).toMatch(/savedChoiceSearchDir\(\s*process\.env\s*,\s*resolution\s*,\s*homedir\(\)\s*\)/)
  })
})
