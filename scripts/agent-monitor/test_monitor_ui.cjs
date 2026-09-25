'use strict';
/* GLM 任务看板 UI 冒烟测试：本地 fixture HTTP 服务 + 主仓库 Playwright（外部路径引用，不安装依赖）。
 * 运行：node test_monitor_ui.cjs
 * 证据（日志/截图）写入仓库外 $CODEX_HOME/headroom-cache/GLM-MONITOR-02-evidence
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const assert = require('assert/strict');

const EVIDENCE = process.env.MONITOR_EVIDENCE || path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'headroom-cache', 'GLM-MONITOR-02-evidence', 'integrator-ui');
const HTML_PATH = path.join(__dirname, 'index.html');
const gitCommon = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {cwd: __dirname, encoding: 'utf8'}).trim();
const PLAYWRIGHT_CANDIDATES = [path.join(__dirname, '../..', 'node_modules/playwright'), path.join(path.dirname(gitCommon), 'node_modules/playwright')];

function loadPlaywright() {
  for (const candidate of PLAYWRIGHT_CANDIDATES) {
    try { return require(candidate); } catch (error) { /* try next */ }
  }
  throw new Error('未找到 Playwright；请在 PLAYWRIGHT_CANDIDATES 中补充主仓库路径');
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------- fixtures ---------- */
const now = Date.now();
const jobs = [
  {
    id: 'job-a', title: '任务A · 修复续跑', branch: 'task/GLM-MONITOR-UI', worktree: 'D:/wt/ui',
    phase: 'running', jobKind: 'glm', model: 'GLM-5.3-Flash', effort: 'max',
    startedAt: now - 3600e3, lastToolAt: now - 30e3,
    activity: [{ at: now - 30e3, tool: 'Read', description: '读取 index.html', status: 'completed' }],
    prompt: '任务A prompt', sessionId: 'sess-a',
    sessionMode: 'resume', resumedFrom: 'batch-old-01',
    attachments: ['shot.png', 'log.txt'], attachmentCount: 2, cliVersion: '1.2.3',
  },
  {
    id: 'job-b', title: '任务B 待验收', branch: 'task/OTHER', worktree: 'D:/wt/other',
    phase: 'awaiting_review', jobKind: 'glm', startedAt: now - 7200e3, finishedAt: now - 600e3,
    lastToolAt: now - 600e3, activity: [], prompt: '任务B prompt', response: '答复B',
    sessionId: 'sess-b', sessionMode: 'new', resumedFrom: null,
    attachments: [], attachmentCount: 0, cliVersion: '1.2.3',
  },
  {
    id: 'job-old', title: '任务A 旧轮次', branch: 'task/GLM-MONITOR-UI', worktree: 'D:/wt/ui',
    phase: 'failed', jobKind: 'glm', startedAt: now - 7200e3, lastToolAt: now - 4000e3,
    superseded: true, resolved: false, chainTip: { id: 'job-a', title: '任务A · 修复续跑', phase: 'running' },
    prompt: '旧轮次 prompt', sessionId: 'sess-old', sessionMode: 'unknown', resumedFrom: null,
    attachments: [], attachmentCount: null, cliVersion: null,
  },
];
const usageSessions = {
  'sess-a': {
    status: 'available', source: 'cli-logs', scope: 'session', updatedAt: now - 10e3,
    inputTokens: null, outputTokens: 2345, totalTokens: 0, cacheReadTokens: 12000,
    cacheCreationTokens: null, reasoningTokens: 1234, modelRequestCount: 7, modelErrorCount: 0, message: null,
  },
  'sess-b': {
    status: 'available', source: 'cli-logs', scope: 'session', updatedAt: now - 20e3,
    inputTokens: 100, outputTokens: 200, totalTokens: 300, cacheReadTokens: 0,
    cacheCreationTokens: 5, reasoningTokens: 0, modelRequestCount: 3, modelErrorCount: 1, message: null,
  },
};
const quotaAccount = {
  provider: 'bigmodel', plan: 'GLM Coding 个人版', scope: '账号共享 · 当日窗口',
  source: 'Zcode 桌面官方余额快照', updatedAt: now - 600e3, status: 'stale', resetLabel: '周期结束',
  metrics: [
    { label: '当日请求', value: 42, unit: '次' },
    { label: '5小时窗口', value: '80%', unit: '' },
    { label: '剩余', value: null, unit: null },
  ],
  resetAt: '2026-09-26 00:00:00',
};
const fixtures = {
  usage: { mode: 'ok' }, // ok | missing | error | slow | stale
  quota: { mode: 'ok' }, // ok | missing | error | unavailable
};
const usagePayload = () => {
  if (fixtures.usage.mode === 'stale') {
    return {
      status: 'stale', source: 'cli-logs', updatedAt: now - 600e3,
      message: '日志读取延迟，以下为上次数据', sessions: usageSessions,
    };
  }
  return {
    status: 'available', source: 'cli-logs', updatedAt: now - 10e3, message: null,
    sessions: usageSessions,
  };
};
const quotaPayload = () => {
  if (fixtures.quota.mode === 'unavailable') {
    return {
      status: 'unavailable', source: null, updatedAt: null, lastAttemptAt: now - 600e3,
      refreshAfter: now + 60e3, message: '远端额度服务暂时不可用', accounts: [],
    };
  }
  return {
    status: 'available', source: 'remote-api', updatedAt: now - 30e3, lastAttemptAt: now - 30e3,
    refreshAfter: now + 30e3, message: null, accounts: [quotaAccount],
  };
};
const statePayload = () => ({
  generatedAt: Date.now(), warnings: [], jobs,
  summary: { running: 1, awaitingReview: 1, needsAttention: 0 },
});

/* ---------- fixture server ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };
  if (url.pathname === '/favicon.ico') { res.writeHead(404); res.end(); return; }
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(HTML_PATH).pipe(res);
    return;
  }
  if (url.pathname === '/state') { send(200, statePayload()); return; }
  if (url.pathname === '/usage') {
    if (fixtures.usage.mode === 'missing') { send(404, { error: 'not found' }); return; }
    if (fixtures.usage.mode === 'error') { send(500, { error: 'boom' }); return; }
    if (fixtures.usage.mode === 'slow') await delay(3000);
    send(200, usagePayload());
    return;
  }
  if (url.pathname === '/quota') {
    if (fixtures.quota.mode === 'missing') { send(404, { error: 'not found' }); return; }
    if (fixtures.quota.mode === 'error') { send(500, { error: 'boom' }); return; }
    send(200, quotaPayload());
    return;
  }
  res.writeHead(404); res.end();
});

/* ---------- test driver ---------- */
const results = [];
const consoleErrors = [];
async function step(name, fn) {
  try { await fn(); results.push(`GREEN: ${name}`); console.log(`GREEN: ${name}`); }
  catch (error) {
    results.push(`RED: ${name} :: ${error.message.split('\n')[0]}`);
    console.log(`RED: ${name} :: ${error.message.split('\n')[0]}`);
  }
}
function watchPage(page) {
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (msg.text().includes('favicon.ico')) return;
    // fetch 命中 404/500 属于被测降级路径本身，资源加载日志不算脚本错误
    if (msg.text().includes('Failed to load resource')) return;
    consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
}
const waitConnected = (page) => page.waitForFunction(
  () => document.querySelector('#connection')?.textContent === '本机监控已连接',
  { timeout: 6000 },
);
const readUsageMetrics = (page) => page.evaluate(() => {
  const grids = [...document.querySelectorAll('#usage-block .meta')];
  const grid = grids[grids.length - 1];
  if (!grid) return null;
  return [...grid.children].map((cell) => ({
    label: cell.querySelector('span').textContent,
    value: cell.querySelector('strong').textContent,
  }));
});

(async () => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const { chromium } = loadPlaywright();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/`;
  const browser = await (async () => {
    for (const options of [{}, { channel: 'msedge' }, { channel: 'chrome' }]) {
      try { return await chromium.launch(options); } catch (error) { /* try next */ }
    }
    throw new Error('无可用的 Chromium/Edge/Chrome 浏览器');
  })();
  const page = await browser.newPage();
  watchPage(page);
  const shot = (name) => page.screenshot({ path: path.join(EVIDENCE, name), fullPage: true });

  await step('可用数据：状态/用量/额度全部连接', async () => {
    fixtures.usage.mode = 'ok'; fixtures.quota.mode = 'ok';
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await waitConnected(page);
    await page.waitForFunction(() => document.querySelector('#quota-region')?.textContent.includes('bigmodel'), { timeout: 6000 });
  });

  await step('额度区：provider/plan/scope/原始单位/重置/官方链接', async () => {
    const text = await page.locator('#quota-region').innerText();
    for (const part of ['账号额度', 'bigmodel', 'GLM Coding 个人版', '范围：账号共享 · 当日窗口',
      '当日请求：42 次', '5小时窗口：80%', '剩余：未提供', '周期结束：2026-09-26 00:00:00',
      '最近采集', '来源 remote-api', '共享账号', 'Zcode 桌面官方余额快照', '已过期']) assert.ok(text.includes(part), `缺少「${part}」`);
    const link = page.locator('#quota-region a');
    assert.equal(await link.getAttribute('href'), 'https://www.bigmodel.cn/coding-plan/personal/usage');
    assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
  });

  await step('任务A用量：会话累计标注/续接标注/附件/CLI版本/六指标含0与未提供', async () => {
    const block = page.locator('#usage-block');
    const text = await block.innerText();
    for (const part of ['Token 用量（会话累计）', '累计用量', '不单计本轮任务', '不汇总', '不折算费用',
      '续接会话 · 续接自 batch-old-01', '2 个：shot.png、log.txt', '1.2.3',
      '可用', '来源 cli-logs']) assert.ok(text.includes(part), `缺少「${part}」`);
    const metrics = await readUsageMetrics(page);
    assert.deepEqual(metrics, [
      { label: '总Token', value: '0' }, { label: '输入', value: '未提供' },
      { label: '输出', value: '2,345' }, { label: '缓存读取', value: '12,000' },
      { label: '请求数', value: '7' }, { label: '失败请求', value: '0' },
    ]);
    await page.locator('#usage-block details summary').click();
    const detailText = await page.locator('#usage-block details pre').innerText();
    for (const part of ['缓存写入：未提供', '推理：1,234', '数据范围：session']) {
      assert.ok(detailText.includes(part), `明细缺少「${part}」`);
    }
    await shot('01-available.png');
  });

  await step('切换任务B：新会话/0个附件/指标映射，明细面板保持展开', async () => {
    await page.locator('#jobs button').filter({ hasText: '任务B 待验收' }).first().click();
    await page.waitForFunction(() => document.querySelector('article h2')?.textContent === '任务B 待验收', { timeout: 3000 });
    const metrics = await readUsageMetrics(page);
    assert.deepEqual(metrics, [
      { label: '总Token', value: '300' }, { label: '输入', value: '100' },
      { label: '输出', value: '200' }, { label: '缓存读取', value: '0' },
      { label: '请求数', value: '3' }, { label: '失败请求', value: '1' },
    ]);
    const text = await page.locator('#usage-block').innerText();
    assert.ok(text.includes('新会话'), '应显示新会话');
    assert.ok(text.includes('0 个'), '应显示 0 个附件');
    assert.ok(await page.locator('#usage-block details').getAttribute('open') !== null, '明细面板应保持展开');
  });

  await step('历史轮次：unknown会话显示未记录，缺失用量显示未提供', async () => {
    await page.locator('#history-group summary').click();
    await page.locator('#history-group button').filter({ hasText: '任务A 旧轮次' }).first().click();
    await page.waitForFunction(() => document.querySelector('article h2')?.textContent === '任务A 旧轮次', { timeout: 3000 });
    const text = await page.locator('#usage-block').innerText();
    for (const part of ['未记录', '该会话暂无用量记录（未提供）。']) assert.ok(text.includes(part), `缺少「${part}」`);
    assert.ok((await page.locator('article').innerText()).includes('已被取代的历史轮次'), '应显示历史横幅');
  });

  await step('刷新后保持选中任务/历史展开/明细展开', async () => {
    await page.locator('#jobs button').filter({ hasText: '任务A · 修复续跑' }).first().click();
    await page.waitForFunction(() => document.querySelector('article h2')?.textContent.includes('任务A · 修复续跑'), { timeout: 3000 });
    await page.locator('#usage-block details summary').click();
    assert.ok(await page.locator('#usage-block details').getAttribute('open') !== null, '切回任务A明细应可展开');
    jobs[1].title = '任务B 待验收（改名）';
    await page.waitForFunction(() => document.querySelector('#jobs')?.textContent.includes('改名'), { timeout: 9000 });
    assert.ok((await page.locator('article h2').innerText()).includes('任务A · 修复续跑'), '刷新后选中任务应保持');
    assert.equal(await page.locator('#history-group').getAttribute('open'), '', '历史分组应保持展开');
    assert.ok(await page.locator('#usage-block details').getAttribute('open') !== null, '刷新后明细应保持展开');
  });

  await step('恶意字符串按纯文本渲染，不注入HTML', async () => {
    jobs[0].title = '<img src=x onerror="window.__pwned=1">任务A';
    usageSessions['sess-a'].message = '<script>window.__pwned=1</script>注入说明';
    quotaAccount.metrics[0].label = '<b>恶意标签</b>';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitConnected(page);
    await page.waitForFunction(() => document.querySelector('article')?.textContent.includes('<img src=x'), { timeout: 6000 });
    await page.waitForFunction(() => document.querySelector('#usage-block')?.textContent.includes('注入说明'), { timeout: 6000 });
    assert.equal(await page.evaluate(() => window.__pwned), undefined, 'onerror 不应执行');
    assert.equal(await page.locator('article img').count(), 0, 'article 内不应出现 img 元素');
    assert.ok((await page.locator('#quota-region').innerText()).includes('<b>恶意标签</b>'), '额度标签应原样显示');
    assert.equal(await page.locator('.quota-account b').count(), 0, '额度区不应出现 b 元素');
    await shot('02-malicious.png');
  });

  await step('stale/不可用：显式状态且stale保留数值，不可用显示原因', async () => {
    fixtures.usage.mode = 'stale'; fixtures.quota.mode = 'unavailable';
    usageSessions['sess-a'].message = null; quotaAccount.metrics[0].label = '当日请求';
    jobs[0].title = '任务A · 修复续跑';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitConnected(page);
    await page.waitForFunction(() => document.querySelector('#usage-block')?.textContent.includes('已过期'), { timeout: 6000 });
    const usageText = await page.locator('#usage-block').innerText();
    for (const part of ['已过期（保留上次数据）', '2,345', '日志读取延迟，以下为上次数据']) {
      assert.ok(usageText.includes(part), `用量区缺少「${part}」`);
    }
    await page.waitForFunction(() => document.querySelector('#quota-region')?.textContent.includes('不可用'), { timeout: 6000 });
    const quotaText = await page.locator('#quota-region').innerText();
    for (const part of ['远端额度服务暂时不可用', '暂无账号额度数据（未提供）。']) {
      assert.ok(quotaText.includes(part), `额度区缺少「${part}」`);
    }
    await shot('03-stale-error.png');
  });

  await step('可选接口缺失(404)：优雅降级且主任务状态不受影响', async () => {
    fixtures.usage.mode = 'missing'; fixtures.quota.mode = 'missing';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitConnected(page);
    await page.waitForFunction(() => document.querySelector('#usage-block')?.textContent.includes('本机服务未提供用量接口'), { timeout: 6000 });
    await page.waitForFunction(() => document.querySelector('#quota-region')?.textContent.includes('本机服务未提供账号额度接口'), { timeout: 6000 });
    assert.equal((await page.locator('#error').innerText()).trim(), '', '主状态错误横幅应保持为空');
    assert.ok((await page.locator('#usage-block').innerText()).includes('任务状态不受影响'));
    await shot('04-missing.png');
  });

  await step('慢用量接口不阻塞状态连接；刷新按钮重读缓存并标注时间', async () => {
    fixtures.usage.mode = 'slow'; fixtures.quota.mode = 'ok';
    const t0 = Date.now();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitConnected(page);
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 3000, `状态连接耗时 ${elapsed}ms，不应被慢用量接口阻塞`);
    assert.ok((await page.locator('#usage-block').innerText()).includes('正在读取会话用量…'), '用量应处于读取中');
    await page.waitForFunction(() => document.querySelector('#usage-block')?.textContent.includes('总Token'), { timeout: 9000 });
    await page.locator('#quota-region button').click();
    await page.waitForFunction(() => document.querySelector('#quota-region')?.textContent.includes('本页读取'), { timeout: 3000 });
  });

  await step('390px 窄屏无横向溢出', async () => {
    const narrow = await browser.newPage({ viewport: { width: 390, height: 844 } });
    watchPage(narrow);
    fixtures.usage.mode = 'ok';
    await narrow.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await narrow.waitForFunction(() => document.querySelector('#usage-block')?.textContent.includes('总Token'), { timeout: 9000 });
    const width = await narrow.evaluate(() => Math.max(
      document.documentElement.scrollWidth, document.body.scrollWidth,
    ));
    assert.ok(width <= 391, `页面横向宽度 ${width}px 超出 390px 视口`);
    await narrow.screenshot({ path: path.join(EVIDENCE, '05-narrow-390.png'), fullPage: true });
    await narrow.close();
  });

  await step('浅色模式可渲染', async () => {
    const light = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
    watchPage(light);
    await light.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await light.waitForFunction(() => document.querySelector('#quota-region')?.textContent.includes('bigmodel'), { timeout: 6000 });
    await light.screenshot({ path: path.join(EVIDENCE, '06-light.png'), fullPage: true });
    await light.close();
  });

  await step('全程无页面脚本错误', async () => {
    assert.deepEqual(consoleErrors, []);
  });

  await browser.close();
  server.close();

  const red = results.filter((line) => line.startsWith('RED'));
  const summary = [
    `GLM-MONITOR-02 UI evidence — ${new Date().toISOString()}`,
    `结果：${results.length - red.length} 绿 / ${red.length} 红`,
    ...results,
    red.length ? `\n存在 ${red.length} 项失败` : '\n全部通过',
  ].join('\n');
  fs.writeFileSync(path.join(EVIDENCE, 'log.txt'), summary + '\n', 'utf8');
  console.log(`\n证据目录：${EVIDENCE}`);
  process.exit(red.length ? 1 : 0);
})().catch(async (error) => {
  results.push(`RED: 测试驱动异常 :: ${error.message}`);
  fs.mkdirSync(EVIDENCE, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE, 'log.txt'), results.join('\n') + '\n', 'utf8');
  console.error(error);
  process.exit(1);
});
