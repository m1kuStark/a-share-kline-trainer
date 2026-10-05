import { evidencePath, runtime } from './runtime'
import { expect, test, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// UPD-02 设置面板「关于与更新」分栏（在线版本更新 UI）真实浏览器回归。
// 消费契约=docs/verification/2026-10/UPD-01/design.md §2（服务端已由 UPD-01 交付，提交 098c442）。
//
// 架构（受 e2e/AGENTS.md「不得硬编码端口」与 journey 隔离服务 currentVersion=null 现实约束）：
// ① fixture 清单 HTTP：spec 自起（listen 临时端口 0），模块级可变状态——三态清单内容切换后
//    点「检查更新」，服务端逐请求重取清单；零 api.github.com 访问（注入通道=env
//    TRAINER_UPDATE_MANIFEST_URL，manifest.ts 四级优先级之首，journey runEnv 透传 process.env）。
// ② 次级真实服务：种子 <repo>/.runs/package.json（=仓库 package.json 版本，测试侧独立读取）
//    后 spawn run.serverDir 编译产物（journey 隔离服务 APP_ROOT 落 .runs，读种子版本——
//    主 journey 服务因无 package.json 而 currentVersion=null，触达不了「有新版」态）。
//    无 TRAINER_RUN_ID＝开发形态；apply 守卫走真实 503 UPDATE_NOT_PACKAGED（包根无 release.json）。
//    关停=IPC trainer:shutdown(runId:null)（index.ts 消息分支 null===null 匹配），超时 SIGKILL。
// ③ 浏览器 page.goto(次级 baseURL)：⚙ 设置入口在 app-shell rail 常驻，无需创建训练。
//
// 真实换装全流程（发布包布局＋真重启＋断线窗口）不进 e2e（简报裁剪，留用户真机验收）；
// 状态机文案/重连退避/终态语义由 server/test/updater-ui.test.ts 纯函数级锁定。

const run = runtime()

// ===== fixture 清单 HTTP（可变状态；任何路径都返回当前状态） =====
interface FixtureResponse { status: number, body: string }

let fixtureState: FixtureResponse = { status: 200, body: '{}' }
let fixtureServer: Server | null = null
let fixturePort = 0

function manifestBody(tagName: string, notes: string, zipPort: number): string {
  const version = tagName.replace(/^v/, '')
  return JSON.stringify({
    tag_name: tagName,
    name: `K线训练器 ${tagName}`,
    body: notes,
    assets: [
      { name: `kline-trainer-v${version}-windows-x64.zip`, browser_download_url: `http://127.0.0.1:${zipPort}/zip`, size: 123456 },
      { name: 'SHA256SUMS', browser_download_url: `http://127.0.0.1:${zipPort}/sums`, size: 99 },
    ],
  })
}

// ===== 次级真实服务 =====
let secondary: { baseURL: string, child: ChildProcess } | null = null
const seededPackageJson = join(run.root, '.runs', 'package.json')
const secondaryWorkDir = join(run.artifactsDir, 'update-e2e')

async function waitForSecondaryReady(child: ChildProcess, readyFile: string, deadlineMs: number): Promise<string> {
  const deadline = Date.now() + deadlineMs
  for (;;) {
    if (child.exitCode !== null) throw new Error(`次级服务提前退出（code=${child.exitCode}）`)
    try {
      const ready = JSON.parse(await readFile(readyFile, 'utf8')) as { pid?: unknown, baseURL?: unknown }
      if (ready.pid === child.pid && typeof ready.baseURL === 'string') return ready.baseURL
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (Date.now() > deadline) throw new Error('等待次级服务就绪超时')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

test.beforeAll(async () => {
  test.setTimeout(120_000)
  // ① fixture 清单 HTTP（临时端口）
  await new Promise<void>(resolve => {
    fixtureServer = createServer((request, response) => {
      response.writeHead(fixtureState.status, { 'Content-Type': 'application/json' })
      response.end(fixtureState.body)
    })
    fixtureServer.listen(0, '127.0.0.1', () => {
      fixturePort = (fixtureServer!.address() as { port: number }).port
      resolve()
    })
  })
  // ② 种子包根版本＋次级服务（journey 编译产物，开发形态）
  const repoVersion = (JSON.parse(await readFile(join(run.root, 'package.json'), 'utf8')) as { version: string }).version
  await mkdir(secondaryWorkDir, { recursive: true })
  await writeFile(seededPackageJson, `${JSON.stringify({ version: repoVersion })}\n`)
  const readyFile = join(secondaryWorkDir, 'ready.json')
  const child = spawn(process.execPath, [join(run.serverDir, 'index.js')], {
    cwd: run.root,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: '0',
      OPEN_BROWSER: '0',
      TDX_ROOT: '',
      TRAINER_DB: join(secondaryWorkDir, 'trainer.sqlite'),
      TRAINER_STATIC_DIR: run.webDir,
      TRAINER_READY_FILE: readyFile,
      TRAINER_UPDATE_MANIFEST_URL: `http://127.0.0.1:${fixturePort}/manifest`,
      // 开发形态：剥离 journey 隔离标记（runId 会切 loadConfig 隔离分支）
      TRAINER_RUN_ID: '',
      TRAINER_RUN_MANIFEST: '',
      TRAINER_BASE_URL: '',
      TRAINER_VERIFY_DIR: '',
    },
  })
  secondary = { baseURL: await waitForSecondaryReady(child, readyFile, 30_000), child }
})

test.afterAll(async () => {
  const current = secondary
  if (current) {
    await new Promise<void>(resolve => {
      const killTimer = setTimeout(() => { current.child.kill('SIGKILL') }, 10_000)
      current.child.once('close', () => { clearTimeout(killTimer); resolve() })
      if (current.child.connected) current.child.send({ type: 'trainer:shutdown', runId: null }, () => {})
      else current.child.kill('SIGKILL')
    })
  }
  // 种子文件必清：残留在后续 journey 运行里仍会被隔离服务读到（跨运行污染）
  await writeFile(seededPackageJson, '').catch(() => {})
  const { rm } = await import('node:fs/promises')
  await rm(seededPackageJson, { force: true }).catch(() => {})
  await new Promise<void>(resolve => fixtureServer ? fixtureServer.close(() => resolve()) : resolve())
})

// ===== 页面助手 =====
const errors = new WeakMap<Page, string[]>()

test.beforeEach(({ page }) => {
  const list: string[] = []
  errors.set(page, list)
  page.on('pageerror', error => list.push(error.message))
})
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]) })

async function openUpdateSection(page: Page): Promise<void> {
  await page.goto(secondary!.baseURL)
  await page.getByRole('button', { name: '训练默认设置' }).click()
  const dialog = page.getByRole('dialog', { name: '训练默认设置' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '关于与更新' }).click()
  await expect(dialog.getByRole('button', { name: '关于与更新' })).toHaveClass(/selected/)
}

test('update section shows the real current version and keeps existing sections (UPD-UI-SECTION / UPD-UI-SETTINGS-INTACT)', async ({ page }) => {
  test.setTimeout(180_000)
  await openUpdateSection(page)
  const dialog = page.getByRole('dialog', { name: '训练默认设置' })

  // 当前版本＝次级服务 health.currentVersion＝种子值＝仓库 package.json 版本（测试侧独立读取的 oracle）
  const repoVersion = (JSON.parse(await readFile(join(run.root, 'package.json'), 'utf8')) as { version: string }).version
  await expect(dialog.locator('.update-current-version')).toHaveText(`当前版本：v${repoVersion}`)

  // 既有四分栏导航仍在，且「默认设置」可切回、表单内容不缺（新增分栏不挤掉既有分栏）
  for (const name of ['默认设置', '偏好设置', '动画效果', '数据目录']) {
    await expect(dialog.getByRole('button', { name })).toBeVisible()
  }
  await dialog.getByRole('button', { name: '默认设置' }).click()
  await expect(dialog.getByLabel('新训练收取手续费（佣金/印花税）')).toBeVisible()
  await expect(dialog.getByLabel('新训练启用 T+1（当日买入次日可卖）')).toBeVisible()
  // 切回关于与更新仍正常（分栏互切无残留）
  await dialog.getByRole('button', { name: '关于与更新' }).click()
  await expect(dialog.locator('.update-current-version')).toBeVisible()
  await page.screenshot({ path: evidencePath('update-settings-section.png') })
})

test('check update renders the three states from a local fixture manifest (UPD-UI-CHECK-STATES)', async ({ page }) => {
  test.setTimeout(180_000)
  await openUpdateSection(page)
  const dialog = page.getByRole('dialog', { name: '训练默认设置' })
  const checkButton = dialog.getByRole('button', { name: '检查更新' })
  const result = dialog.locator('.update-check-result')

  // 态一：有新版（fixture v9.9.9 > 仓库版本）——新版本号＋可折叠更新内容＋下载并更新
  fixtureState = { status: 200, body: manifestBody('v9.9.9', '修复若干问题，提升训练稳定性（fixture 演示更新说明）', fixturePort) }
  await checkButton.click()
  await expect(result).toContainText('发现新版本 v9.9.9')
  const notes = dialog.locator('.update-release-notes')
  await expect(notes).toBeVisible()
  await expect(notes).toContainText('fixture 演示更新说明')
  await expect(dialog.getByRole('button', { name: '下载并更新' })).toBeVisible()

  // 态二：已是最新（fixture v1.0.0 < 仓库版本）——提示语，无更新按钮
  fixtureState = { status: 200, body: manifestBody('v1.0.0', '旧版本说明', fixturePort) }
  await checkButton.click()
  await expect(result).toContainText('已是最新版本')
  await expect(dialog.getByRole('button', { name: '下载并更新' })).toHaveCount(0)

  // 态三：检查失败（fixture HTTP 500 → 服务端 200＋error 人话）＋重试可用
  fixtureState = { status: 500, body: 'boom' }
  await checkButton.click()
  await expect(dialog.locator('.update-check-error')).toContainText('无法检查更新')
  await expect(dialog.getByRole('button', { name: '重试' })).toBeVisible()
  // 重试：重设 fixture 后点重试回到有新版态（重试＝重新执行检查，不是死胡同）
  fixtureState = { status: 200, body: manifestBody('v9.9.9', '修复若干问题，提升训练稳定性（fixture 演示更新说明）', fixturePort) }
  await dialog.getByRole('button', { name: '重试' }).click()
  await expect(result).toContainText('发现新版本 v9.9.9')
  await page.screenshot({ path: evidencePath('update-settings-check-states.png') })
})

test('apply guard UPDATE_NOT_PACKAGED shows the human message without polling (UPD-UI-GUARD-MESSAGES)', async ({ page }) => {
  test.setTimeout(180_000)
  await openUpdateSection(page)
  const dialog = page.getByRole('dialog', { name: '训练默认设置' })

  // 有新版态 → 下载并更新 → 确认弹窗（说明将自动重启）→ 次级服务为开发形态：真实 503 UPDATE_NOT_PACKAGED
  fixtureState = { status: 200, body: manifestBody('v9.9.9', '修复若干问题（fixture 演示更新说明）', fixturePort) }
  await dialog.getByRole('button', { name: '检查更新' }).click()
  await expect(dialog.locator('.update-check-result')).toContainText('发现新版本 v9.9.9')

  page.once('dialog', dialogEvent => void dialogEvent.accept())
  await dialog.getByRole('button', { name: '下载并更新' }).click()

  await expect(dialog.locator('.update-apply-error')).toContainText('当前为开发/源码运行，请使用发布包更新')
  // 守卫拒绝不进入状态机轮询：无任何进度/状态机文案，且留在可重试态（按钮可用）
  await expect(dialog.locator('.update-progress')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: '下载并更新' })).toBeEnabled()
  await page.screenshot({ path: evidencePath('update-settings-apply-guard.png') })
})
