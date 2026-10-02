import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

// M5-01 前端接线契约（源形状断言，沿用 training-rules-frontend 模式）：
// 应用偏好客户端/偏好 store、dataStatus 自动检查门闩（手动路径保留）、
// 设置面板应用偏好与数据目录两区块、服务端两个待注册模块的入口函数。
// 注册契约（集成阶段）：server/src/api.ts 各加一行 registerAppSettingsRoutes(app, database) 与
// registerTdxPathSettingsRoutes(app, config, { dataDir: dirname(config.databasePath) })。

const appSettingsPath = new URL('../../web/src/appSettings.ts', import.meta.url)
const dataStatusPath = new URL('../../web/src/dataStatus.ts', import.meta.url)
const panelPath = new URL('../../web/src/components/TrainingSettings.vue', import.meta.url)
const serverAppPath = new URL('../../server/src/settings/app.ts', import.meta.url)
const serverTdxPath = new URL('../../server/src/settings/tdx-path.ts', import.meta.url)

describe('M5-01 应用偏好接线', () => {
  it('appSettings.ts：两命名空间端点、偏好 store 与尽力预取齐备', async () => {
    const source = await readFile(appSettingsPath, 'utf8')
    expect(source).toMatch(/export function fetchAppSettings\(\): Promise<AppSettingsView> \{\s*return request\('\/api\/settings\/app'\)/)
    expect(source).toMatch(/method: 'PUT',\s*headers: \{ 'Content-Type': 'application\/json' \},\s*body: JSON\.stringify\(\{ autoDataCheck \}\)/s)
    expect(source).toMatch(/export const appAutoDataCheck = ref\(true\)/)
    expect(source).toMatch(/export function ensureAppSettingsLoaded\(\): Promise<void>/)
    // 预取失败静默保持缺省 true（＝现状），不冒充已读取
    expect(source).toMatch(/\.catch\(\(\) => \{/)
    // TDX 数据目录三端点
    expect(source).toMatch(/return request\('\/api\/settings\/tdx-path'\)/)
    expect(source).toMatch(/'\/api\/settings\/tdx-path\/validate'/)
    expect(source).toMatch(/restartRequired/)
  })

  it('dataStatus.ts：自动路径按偏好门闩，手动路径显式绕过', async () => {
    const source = await readFile(dataStatusPath, 'utf8')
    expect(source).toMatch(/import \{ appAutoDataCheck, ensureAppSettingsLoaded \} from '\.\/appSettings'/)
    // checkDataStatus：非 manual 调用先预取偏好，关闭时直接跳过
    expect(source).toMatch(/options\?: \{ force\?: boolean; manual\?: boolean \}/)
    expect(source).toMatch(/if \(!options\?\.manual\) \{\s*void ensureAppSettingsLoaded\(\)\s*if \(!appAutoDataCheck\.value\) return\s*\}/s)
    // 60s 重判定时器同样受门闩
    expect(source).toMatch(/startStatusTicker[\s\S]*?if \(!appAutoDataCheck\.value\) \{\s*void ensureAppSettingsLoaded\(\)\s*return\s*\}/)
    // 手动刷新流程显式 manual，绕过门闩；running 轮询不受影响
    expect(source).toMatch(/checkDataStatus\(\{ force: true, manual: true \}\)/)
    // 手动更新入口本体不受偏好影响（不出现早退）
    expect(source).not.toMatch(/export async function refreshDataNow[\s\S]{0,400}appAutoDataCheck/)
  })

  it('设置面板：应用偏好开关与数据目录区块齐备，失败可恢复、重启提示明确', async () => {
    const source = await readFile(panelPath, 'utf8')
    expect(source).toMatch(/from '\.\.\/appSettings'/)
    expect(source).toMatch(/aria-label="自动检查日线数据"/)
    expect(source).toMatch(/@change="onAutoDataCheckChange"/)
    // 失败还原开关，不假称保存
    expect(source).toMatch(/autoDataCheckForm\.value = previous/)
    // 数据目录：当前生效/已保存展示、校验、保存、离线提示与重启语义
    // V1.2.6：标签页改含两个子区块——训练数据目录（自定义历史数据保存位置）＋ 通达信目录
    expect(source).toMatch(/aria-label="数据目录"/)
    expect(source).toMatch(/<h4 class="settings-subsection">训练数据目录<\/h4>/)
    expect(source).toMatch(/aria-label="历史训练数据保存目录"/)
    expect(source).toMatch(/saveDataDir/)
    expect(source).toMatch(/重启训练器后生效/)
    expect(source).toMatch(/各版本安装目录相互独立/)
    expect(source).toMatch(/离线导入回放仍可用/)
    expect(source).toMatch(/检查此路径/)
    expect(source).toMatch(/保存数据目录/)
    expect(source).toMatch(/重启应用后生效/)
    // journey 返修：静态文案不得包含『已保存』子串（弹层级 not.toContainText('已保存') 负向断言依赖）
    expect(source).toMatch(/保存失败不会改动之前的选择/)
    expect(source).not.toMatch(/保存失败不会改动已保存的选择/)
    // 校验结果展示问题清单与权息/名称/基准
    expect(source).toMatch(/tdxCheck\.problems/)
    expect(source).toMatch(/基准指数/)
  })

  it('服务端两模块暴露注册入口，等集成阶段在 api.ts 一行接线', async () => {
    const serverApp = await readFile(serverAppPath, 'utf8')
    const serverTdx = await readFile(serverTdxPath, 'utf8')
    expect(serverApp).toMatch(/export function registerAppSettingsRoutes\(app: FastifyInstance, database: DatabaseSync\): void/)
    expect(serverTdx).toMatch(/export function registerTdxPathSettingsRoutes\(\s*app: FastifyInstance,\s*config: AppConfig,\s*options: RegisterTdxPathSettingsOptions,\s*\): void/)
    // 两模块均不读环境变量、不热切换 config.tdxRoot（保存后重启生效的边界写在模块头注）
    expect(serverTdx).toMatch(/restartRequired: true/)
    expect(serverTdx).toMatch(/dataDir/)
  })
})
