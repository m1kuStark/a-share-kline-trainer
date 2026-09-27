import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

// TRAIN-01 前端接线契约（源形状断言，沿用 frontend-contract 模式）：
// 设置入口（侧栏）、局部弹层、本局规则展示、legacy raw 提示、设置打开期间训练热键隔离。

const appPath = new URL('../../web/src/App.vue', import.meta.url)
const trainingPath = new URL('../../web/src/views/Training.vue', import.meta.url)
const panelPath = new URL('../../web/src/components/TrainingSettings.vue', import.meta.url)
const storePath = new URL('../../web/src/settingsPanel.ts', import.meta.url)
const apiPath = new URL('../../web/src/api.ts', import.meta.url)

describe('TRAINING-RULES 前端接线', () => {
  it('侧栏设置入口可用，设置以局部弹层打开且不卸载训练视图', async () => {
    const app = await readFile(appPath, 'utf8')
    // 设置按钮不再以 disabled 占位（M5 文案退役）
    expect(app).not.toMatch(/设置（M5 开放）/)
    expect(app).not.toMatch(/rail-bottom[^>]*disabled/)
    expect(app).toMatch(/TrainingSettings/)
    expect(app).toMatch(/trainingSettingsOpen/)
    // 弹层与 Training 同级渲染（Training 保持挂载，录制不被卸载）
    expect(app).toMatch(/<TrainingSettings /)
  })

  it('设置打开期间隔离训练快捷键，不能从设置触发买卖/推进', async () => {
    const training = await readFile(trainingPath, 'utf8')
    // 训练页全局键处理在设置弹层打开时直接返回
    expect(training).toMatch(/trainingSettingsOpen\.value/)
  })

  it('训练页展示本局规则（费用/T+1 冻结）与旧训练来源说明', async () => {
    const training = await readFile(trainingPath, 'utf8')
    expect(training).toMatch(/training\.rules/)
    expect(training).toMatch(/本局冻结|创建时冻结/)
    expect(training).toMatch(/旧训练按升级时设置继续，历史设置未记录/)
  })

  it('legacy raw 运行训练显示只读警示', async () => {
    const training = await readFile(trainingPath, 'utf8')
    expect(training).toMatch(/legacy-raw-unverified/)
    expect(training).toMatch(/旧版不复权训练缺少完整权息记录，请保留记录后新建训练/)
  })

  it('设置面板保存/取消语义与默认提示齐备', async () => {
    const panel = await readFile(panelPath, 'utf8')
    // 面板调用设置 API
    expect(panel).toMatch(/fetchTrainingSettings/)
    expect(panel).toMatch(/putTrainingSettings/)
    // 明示只影响新训练；取消不变更本局；成功有明确反馈
    expect(panel).toMatch(/默认只影响新训练/)
    expect(panel).toMatch(/已保存/)
  })

  it('设置 API 客户端绑定 /api/settings/training 并校验布尔载荷', async () => {
    const api = await readFile(apiPath, 'utf8')
    expect(api).toMatch(/\/api\/settings\/training/)
    expect(api).toMatch(/feesEnabled/)
    expect(api).toMatch(/tPlusOne/)
  })
})
