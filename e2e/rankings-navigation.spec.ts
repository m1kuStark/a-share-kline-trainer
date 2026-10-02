// 排行层级回归：自定义区间属于训练周期；真实点击验证分组与请求迟到后的列表保持。
// 本测试只固定排行读取响应，Vue 页面、导航事件与请求版本守卫使用真实实现。
import { expect, test, type Page } from '@playwright/test'
import type { RankingGroups, RankingItem } from '../web/src/api'
import { evidencePath } from './runtime'

test.use({ viewport: { width: 1440, height: 940 } })

function item(id: number, name: string, tier = '1M'): RankingItem {
  return {
    id, code: '600519', name, tier, startDate: '2026-04-15', settleDate: '2026-05-15',
    classification: 'complete', actualDays: 21, initialCash: 1_000_000, finalEquity: 1_100_000,
    returnRate: 0.1, maxDrawdown: 0.02, tradeCount: 2, winRate: 1, profitLossRatio: null,
    benchmarkExcess: null, benchmarkExcessReason: '测试基准不可用',
  }
}

function fixedGroups(tier = '1M'): RankingGroups {
  return {
    tier, view: 'tier', complete: [item(8101, `固定周期${tier}`, tier)], earlySettled: [],
    excludedUnavailable: 0, benchmark: { status: 'unavailable', reason: '测试基准不可用' },
  }
}

function rangeGroups(): RankingGroups {
  return {
    tier: 'RANGE', view: 'range', complete: [], earlySettled: [], excludedUnavailable: 0,
    benchmark: { status: 'unavailable', reason: '测试基准不可用' },
    rangeGroups: [{ key: '2026-04-15|2026-05-15', startDate: '2026-04-15', endDate: '2026-05-15', complete: [item(8102, '自定义区间成绩', 'RANGE')], earlySettled: [] }],
  }
}

async function openRankings(page: Page): Promise<void> {
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  await page.goto('/')
  await expect(page.getByRole('button', { name: '开始训练', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '五档排行', exact: true }).click()
  await expect(page.getByRole('region', { name: '五档排行', exact: true })).toBeVisible()
}

test('自定义区间是训练周期的子列表，固定周期与区间成绩互不混入', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/rankings?*', async route => {
    const query = new URL(route.request().url()).searchParams
    if (query.get('view') === 'range') await route.fulfill({ json: rangeGroups() })
    else if (query.get('view') === 'industry') await route.fulfill({ json: { ...fixedGroups(), complete: [], industry: { status: 'unavailable', reason: '测试行业目录不可用' } } })
    else await route.fulfill({ json: fixedGroups(query.get('tier') ?? '') })
  })
  await openRankings(page)

  const modes = page.getByRole('navigation', { name: '排行模式', exact: true })
  await expect(modes.getByRole('button')).toHaveText(['训练周期', '行业板块', '单只股票'])
  const cycleTypes = page.getByRole('navigation', { name: '训练周期类型', exact: true })
  await expect(cycleTypes.getByRole('button')).toHaveText(['固定周期', '自定义区间'])
  const tiers = page.getByRole('navigation', { name: '固定训练周期', exact: true })
  await expect(tiers.getByRole('button')).toHaveText(['1个月', '3个月', '6个月', '1年', '2年'])
  await tiers.getByRole('button', { name: '3个月', exact: true }).click()
  await expect(page.getByRole('region', { name: '完整周期排行', exact: true })).toContainText('固定周期3M')

  await cycleTypes.getByRole('button', { name: '自定义区间', exact: true }).click()
  await expect(modes.getByRole('button', { name: '训练周期', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(cycleTypes.getByRole('button', { name: '自定义区间', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(tiers).toHaveCount(0)
  const custom = page.getByRole('region', { name: '自定义区间排行', exact: true })
  await expect(custom).toContainText('2026-04-15 ~ 2026-05-15')
  await expect(custom).toContainText('自定义区间成绩')
  await expect(page.getByText('固定周期3M', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: evidencePath('rankings-custom-dark-1440.png'), fullPage: true })

  await modes.getByRole('button', { name: '行业板块', exact: true }).click()
  await expect(cycleTypes).toHaveCount(0)
  await expect(page.getByRole('alert')).toContainText('行业排行暂不可用')
  await modes.getByRole('button', { name: '训练周期', exact: true }).click()
  await expect(custom).toContainText('自定义区间成绩')
  await cycleTypes.getByRole('button', { name: '固定周期', exact: true }).click()
  await expect(tiers.getByRole('button', { name: '3个月', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('region', { name: '完整周期排行', exact: true })).toContainText('固定周期3M')
  await expect(custom).toHaveCount(0)
  await page.getByRole('button', { name: '切换到浅色主题', exact: true }).click()
  await page.screenshot({ path: evidencePath('rankings-fixed-light-1440.png'), fullPage: true })
  expect(errors).toEqual([])
})

test('从自定义区间切回固定周期后，迟到的区间响应不覆盖当前列表', async ({ page }) => {
  let releaseRange!: () => void
  const rangeGate = new Promise<void>(resolve => { releaseRange = resolve })
  let rangeRequested = false
  await page.route('**/api/rankings?*', async route => {
    const query = new URL(route.request().url()).searchParams
    if (query.get('view') === 'range') {
      rangeRequested = true
      await rangeGate
      await route.fulfill({ json: rangeGroups() })
    } else await route.fulfill({ json: fixedGroups(query.get('tier') ?? '') })
  })
  await openRankings(page)
  const cycleTypes = page.getByRole('navigation', { name: '训练周期类型', exact: true })
  await cycleTypes.getByRole('button', { name: '自定义区间', exact: true }).click()
  await expect.poll(() => rangeRequested).toBe(true)
  await expect(page.getByText('加载中…', { exact: true })).toBeVisible()
  await cycleTypes.getByRole('button', { name: '固定周期', exact: true }).click()
  const fixed = page.getByRole('region', { name: '完整周期排行', exact: true })
  await expect(fixed).toContainText('固定周期1M')
  const response = page.waitForResponse(value => new URL(value.url()).searchParams.get('view') === 'range')
  releaseRange()
  await response
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect(fixed).toContainText('固定周期1M')
  await expect(page.getByRole('region', { name: '自定义区间排行', exact: true })).toHaveCount(0)
  await expect(page.getByText('加载中…', { exact: true })).toHaveCount(0)
})
