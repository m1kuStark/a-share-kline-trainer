// RANDOM-PANEL-LAYOUT（第八轮 W2，2026-10-17）：随机维度切换时面板控件大量偏移的布局稳定回归。
// 用户原话：「我在进行随机维度选择时，三种不同的随机维度下，面板按钮出现了大量偏移。并且这些
// 按钮的摆放本身，我认为也并不十分贴合用户的使用习惯。请你对这些按钮的排列逻辑进行完善」。
// provisional 设计（随收尾报告转呈用户确认）：
//   ① 维度条件输入收纳进随机维度组正下方的单一条件输入槽（time=选股、stock=起止/起始日、
//      both=占位说明行）；② 随机模式初始资金固定独立字段行；③ 槽外公共设置纵向位置恒定；
//   ④ 经典模式布局不受影响。
// oracle 独立性：期望文案为设计冻结字面量（维度 hint 与占位说明不从 DOM 抄回）；稳定容差 2px
// （亚像素渲染余量）；测量用选择器（label/role 定位）先于实现改动存在，RED 期能量出真实偏移。
import { expect, test, type Locator, type Page } from '@playwright/test'

const CODE_INPUT = '股票代码，如 600519'

const DIMENSION_BUTTON = {
  random_stock: '随机股票 · 我选时间段',
  random_time: '随机时间段 · 我选股票',
  random_both: '全随机',
} as const
type DimensionKey = keyof typeof DIMENSION_BUTTON

// 维度说明文案（M7-02 冻结文案表）：断言随维度联动，字面量锁定
const DIMENSION_HINT: Record<DimensionKey, string> = {
  random_stock: '选定时间段内由服务器随机选股，结算前隐藏股票名称与代码',
  random_time: '由服务器在该股票历史中随机选一段行情，结算前隐藏真实日期（图表日期为偏移伪日期）',
  random_both: '股票与时间段都由服务器随机，双重隐藏，结算后揭晓',
}

// random_both 占位说明（proposed_default，待用户确认）
const BOTH_PLACEHOLDER = '股票与时间段均由服务器随机，无需选择'

// 纵向恒定容差：亚像素渲染余量（同一元素同构渲染下的抖动上限）
const TOLERANCE = 2

// DATA 守卫需要 current 才不打断创建提示（本 spec 不提交，但保持与其他 spec 同款启动面）
const CURRENT_DATA_STATUS = {
  state: 'unchanged', needsUpdate: false, reason: '本地数据与数据源一致',
  source: { kind: 'tdx', name: '通达信本地数据', available: true },
  tdx: { available: true, root: 'C:/new_tdx' },
  online: { configured: false, provider: null },
  sourceMaxDate: '2026-09-24', lastCheckedAt: '2026-09-25T01:00:00.000Z', lastResult: null, revisionWarning: null,
  freshness: { state: 'current', expectedDate: '2026-09-24', sourceMaxDate: '2026-09-24', checkedAt: '2026-09-25T01:00:00.000Z', reason: '来源最大日期 2026-09-24 已达到应收收盘日 2026-09-24。' },
  calendar: { id: 'sse-2026-annual', from: '2026-01-01', through: '2026-12-31', version: 'e2e' },
}

async function clearActiveTraining(page: Page): Promise<void> {
  const active = await (await page.request.get('/api/trainings/active')).json() as { training?: { id: number } | null }
  if (active.training) await page.request.post(`/api/trainings/${active.training.id}/abandon`)
}

async function openLauncher(page: Page): Promise<void> {
  await clearActiveTraining(page)
  await page.route('**/api/data/status**', route => route.fulfill({ json: CURRENT_DATA_STATUS }))
  await page.goto('/')
  await expect(page.getByText(/数据已最新/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('创建训练').first()).toBeVisible()
}

async function switchToRandomMode(page: Page): Promise<void> {
  await page.getByRole('tab', { name: '随机模式' }).click()
  await expect(page.getByText('随机维度')).toBeVisible()
}

/** 等默认设置读取收敛（loading 提示行在场会使下方按钮纵向位置漂移，测量前必须退场） */
async function waitDefaultsSettled(page: Page): Promise<void> {
  await expect(page.getByText('正在读取训练默认设置…')).toHaveCount(0)
}

async function requireBox(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox()
  expect(box, `缺少可测量元素：${locator.toString()}`).toBeTruthy()
  return box!
}

// —— 槽外公共锚点（实现改动前后都存在的稳定选择器：label 文本与按钮角色） ——
function periodLabel(page: Page): Locator {
  return page.locator('.launcher-form label').filter({ hasText: '训练周期' })
}
function cashInput(page: Page): Locator {
  return page.locator('.form-field').filter({ has: page.locator('label', { hasText: '初始资金' }) }).locator('input')
}
function submitButton(page: Page): Locator {
  return page.getByRole('button', { name: '开始训练', exact: true })
}

test.describe('random panel layout stability (RANDOM-PANEL-LAYOUT)', () => {
  // 核心稳定锁：三维度切换时，槽外公共设置（训练周期/初始资金/开始训练）纵向位置恒定。
  // 选择器均为既有元素——RED 期即可量出当前实现的真实偏移（数值断言失败，非元素缺失）。
  test('common controls keep vertical positions across the three random dimensions', async ({ page }) => {
    await openLauncher(page)
    await switchToRandomMode(page)
    await waitDefaultsSettled(page)

    const anchors: Record<DimensionKey, { period: number; cash: number; submit: number }> = {} as never
    for (const key of Object.keys(DIMENSION_BUTTON) as DimensionKey[]) {
      await page.getByRole('button', { name: DIMENSION_BUTTON[key] }).click()
      await expect(page.getByRole('button', { name: DIMENSION_BUTTON[key] })).toHaveClass(/selected/)
      // 维度说明文案随维度联动（字面量锁定，M7-02 冻结文案）
      const hint = page.locator('.form-field').filter({ has: page.getByText('随机维度', { exact: true }) }).locator('.form-hint')
      await expect(hint).toHaveText(DIMENSION_HINT[key])
      anchors[key] = {
        period: (await requireBox(periodLabel(page))).y,
        cash: (await requireBox(cashInput(page))).y,
        submit: (await requireBox(submitButton(page))).y,
      }
    }

    const dims = Object.keys(anchors) as DimensionKey[]
    for (const a of dims) {
      for (const b of dims) {
        expect(Math.abs(anchors[a].period - anchors[b].period), `训练周期纵向位置：${a} vs ${b}`).toBeLessThanOrEqual(TOLERANCE)
        expect(Math.abs(anchors[a].cash - anchors[b].cash), `初始资金纵向位置：${a} vs ${b}`).toBeLessThanOrEqual(TOLERANCE)
        expect(Math.abs(anchors[a].submit - anchors[b].submit), `开始训练按钮纵向位置：${a} vs ${b}`).toBeLessThanOrEqual(TOLERANCE)
      }
    }
  })

  // 维度条件输入槽：位于随机维度组正下方；三分支内容正确且槽高一致（高度一致是下方公共区
  // 恒定的前提）；random_both 呈占位说明行。
  test('dimension condition slot sits under the dimension group and swaps equal-height content', async ({ page }) => {
    await openLauncher(page)
    await switchToRandomMode(page)
    await waitDefaultsSettled(page)

    const dimensionGrid = page.locator('.tier-grid[aria-label="随机维度"]')
    const slot = page.getByTestId('random-dimension-slot')
    const heights: Partial<Record<DimensionKey, number>> = {}

    // random_time：槽内＝股票检索输入对；无日期输入
    await page.getByRole('button', { name: DIMENSION_BUTTON.random_time }).click()
    await expect(page.getByPlaceholder(CODE_INPUT)).toBeVisible()
    await expect(page.locator('input[type="date"]')).toHaveCount(0)
    const gridBoxTime = await requireBox(dimensionGrid)
    const slotBoxTime = await requireBox(slot)
    expect(slotBoxTime.y, '槽必须在随机维度组正下方').toBeGreaterThanOrEqual(gridBoxTime.y + gridBoxTime.height - TOLERANCE)
    heights.random_time = slotBoxTime.height

    // random_stock：槽内＝起始日输入（默认 3个月档）；无选股器
    await page.getByRole('button', { name: DIMENSION_BUTTON.random_stock }).click()
    await expect(page.locator('input[type="date"]')).toHaveCount(1)
    await expect(page.getByPlaceholder(CODE_INPUT)).toHaveCount(0)
    heights.random_stock = (await requireBox(slot)).height

    // random_both：槽内＝占位说明行（proposed_default 文案）；无任何输入控件
    await page.getByRole('button', { name: DIMENSION_BUTTON.random_both }).click()
    const placeholder = page.getByTestId('random-both-placeholder')
    await expect(placeholder).toBeVisible()
    await expect(placeholder).toHaveText(BOTH_PLACEHOLDER)
    await expect(page.getByPlaceholder(CODE_INPUT)).toHaveCount(0)
    await expect(page.locator('input[type="date"]')).toHaveCount(0)
    heights.random_both = (await requireBox(slot)).height

    const values = Object.values(heights)
    for (const height of values) {
      expect(Math.abs(height - values[0]), '三维度槽高一致（公共区恒定的前提）').toBeLessThanOrEqual(TOLERANCE)
    }
  })

  // 初始资金行位：随机模式恒为独立字段行（不与起始日拼行）；经典模式保留原拼行与选股器位置
  //（经典布局零变化回归锁）。
  test('random initial cash is standalone while classic keeps the inline preset row and picker order', async ({ page }) => {
    await openLauncher(page)
    await switchToRandomMode(page)
    await waitDefaultsSettled(page)

    // 随机 random_stock（默认 3个月档）：起始日在槽内、初始资金在下方独立行——两者不同行
    await expect(page.getByRole('button', { name: DIMENSION_BUTTON.random_stock })).toHaveClass(/selected/)
    const startDate = page.locator('input[type="date"]')
    await expect(startDate).toHaveCount(1)
    const startY = (await requireBox(startDate)).y
    const cashY = (await requireBox(cashInput(page))).y
    expect(cashY - startY, '随机模式初始资金必须独立成行（在起始日下一行）').toBeGreaterThan(40)

    // 经典模式：起始日与初始资金同行（原拼行布局保留）；选股器仍在训练周期上方（原顺序保留）
    await page.getByRole('tab', { name: '经典模式' }).click()
    await expect(page.getByText('随机维度')).toHaveCount(0)
    const classicStart = page.locator('input[type="date"]')
    await expect(classicStart).toHaveCount(1)
    const classicStartY = (await requireBox(classicStart)).y
    const classicCashY = (await requireBox(cashInput(page))).y
    expect(Math.abs(classicCashY - classicStartY), '经典模式保留起始日＋初始资金拼行').toBeLessThanOrEqual(TOLERANCE)
    const pickerY = (await requireBox(page.getByPlaceholder(CODE_INPUT))).y
    const periodY = (await requireBox(periodLabel(page))).y
    expect(pickerY, '经典模式选股器仍在训练周期上方').toBeLessThan(periodY)
  })
})
