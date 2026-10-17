# MIN：实际最小内容区修复准备

状态：研究完成；尚未执行正式 RED 或修改产品。root 独占全量 journey/browser lane，本阶段未启动浏览器、构建或预览。HEAD `6d557a12f400ce45b50418b8556f943d39fef754`。

## 注入、范围与来源

- 本阶段全文注入 Harness candidate v1.12 的 SKILL、development-principles、supervised-delivery、oracle，以及 UIUX core v0.4.1 的 SKILL、failure-patterns。首批输出截断后分别补读。候选目录缺 `references/bug-loop.md`，按正式工作区同名文件补读；这是候选包依赖缺口，未自行补写候选。
- 重新生成 `task-manifest.mjs --task UIUX-REFINE-01`：原生 exit 0；A1 第19项为 `docs/status.md`；A2 HEAD 与 base `6d557a12` 一致；A3 同步任务卡，root 代办。
- `check-binding.mjs --strict --include-untracked`：原生 exit **3**，5 planned、0 covered、5 open、0 RED。不是通过。受影响行为行 `UIUX-TRAINING-GEOMETRY`；矩阵和第五步共享台账仍由 root 单写。
- 唯一写入授权是本文件。产品和 e2e 的后续 diff 仅为计划，需 root 授予文件与运行通道后执行。
- 缺陷事实来自 `output/root-min-content.log`、`output/playwright/uiux-root-training-actual-min.png` 和 `packaged-runtime.json`。本 worker 已读日志和截图，未冒称自行浏览器复现。

## 可观察契约与独立预算

root 已确认：默认状态下买卖按钮、首个常用工具、自定义常用、画线底部动作同屏；其余常用工具和其他工具入口允许局部滚动，必须真实 wheel 可达。125% 语义字号允许 console 局部滚动；先证实溢出，再滚动并验证底部命中。图表/连续推进目标不能移动，不要求7个常用工具同时完整显示。

此契约来自连续看图、下单、画线的任务关系，不来自“当前 CSS 应当是多少”。数值预算用于解释空间是否够用；它不是通用 UI 标准，也不将现状反推为 oracle。

| 区域 | 当前来源 / 预算 |
|---|---|
| 桌面外框与内容 | `window-bounds.ts` 外框最小1024×680；root unpacked 实测内容1008×641、DPR1。原浏览器1024×680证据覆盖的是另一尺寸。 |
| 横向主区 | 内容1008 − 导航76 − 网格左右24 − 侧栏270 − 栏间8 = 图表面板630；边框后628。仍占工作网格宽度一半以上。 |
| 网格纵向 | 内容641 − 顶栏28 − 训练栏38 − 状态条20 − 网格上下12 = 面板543。 |
| 图表绘制宿主 | 面板543 − 边框2 − 交易标记栏40 = 501。主图及3副图沿用现有图表逻辑；修侧栏不得借用图表高度。保留现有测试 `chart.height > viewport.height - 220`，并检查4个pane都有正面积、完整落在宿主内、操作前后不变。不得把正面积单独说成视觉可用性证明，仍需截图人工复核。 |
| 右侧内部 | 面板543 − 边框2 − 上下padding20 = 521；默认画线192 + 间距8，留给console321。 |
| 已观测内容需求 | console y103，买入 y422/h34：账户至买入底需要353，超出console32。买入中心y439实际命中画线区域，证实真实点击受阻。 |
| 画线列表 | 192px总高内预留标题28/动作28/状态28、3个gap共12、上padding8与border1，列表剩87。7个常用工具3行约92，再加其他入口38，已有局部滚动是必要路径；缩小整块高度会进一步损害发现性。 |

源代码因果：`styles.css:66` 的 `console-scroll` 是可收缩且可滚动的flex项；`styles.css:140` 的画线区不收缩；`Training.vue:1189` 在短高固定画线192px。由此在实际内容高度641时console被分配321px。不是图表库侵占空间，也不是 z-index 问题；提高买卖按钮层级将覆盖画线，不能解决预算。

## 最小候选 CSS（尚未应用）

仅在 `Training.vue` scoped 的更短高度分支压缩空白；不改字体、按钮高度、工具数量、默认展开状态、API或订单语义。建议分支 `max-height: 680px`，覆盖实际641与原680，避免改变大桌面。680是任务已支持的紧凑内容检查点，不是标准阈值。

```css
@media (max-height: 680px) {
  .trade-panel { padding-top: 8px; padding-bottom: 8px; }
  .equity-block { padding-top: 4px; padding-bottom: 4px; }
  .account-stats { row-gap: 4px; padding-top: 4px; padding-bottom: 4px; }
  .panel-divider { margin-bottom: 4px; }
  .weight-grid { margin-top: 4px; margin-bottom: 4px; }
  .shares-row { margin-bottom: 3px; }
  .draw-toolbar { margin-top: 4px; }
}
```

预测：console可视区增加8px（padding4 + 间距4），账户/订单内容缩短29px（权益8、统计10、分隔4、仓位5、股数2），相对缺口32剩约5px余量。这只是源码预算，需RED/GREEN实际几何确认，不能先认定已经修复。若字体或条件单标题换行使预算不足，应先记录实际测量，再选择可解释的间距调整；不能抬高测试容差。

更大重排（账户四列、移出普通下单按钮到独立footer）需要更改信息层级或模板，回归面较大；目前预算足以支持局部间距修正。直接缩画线高度、隐藏账户/工具、缩按钮/字号、自动折叠工具或整页滚动均不作为候选。

## RED 测试 diff 草案（仅文档）

在现有 `e2e/uiux-training.spec.ts` 保留所有断言，增加实际内容尺寸与真实命中；测试 first failure 必须落在 buy containment/hit，不能被准备时序掩盖。下列为计划核心 diff，正式执行时补 helper 类型和截图名称，保持原测试名称以便根绑定延续。

```diff
- for (const size of [{ width: 1024, height: 680 }, { width: 1440, height: 900 }]) {
+ for (const size of [{ width: 1008, height: 641 }, { width: 1024, height: 680 }, { width: 1440, height: 900 }]) {
+   for (const theme of ['light', 'dark']) {
+     if (await page.locator('body').evaluate(el => el.classList.contains('dark')) !== (theme === 'dark'))
+       await page.locator('.theme-toggle').click()
      // 保留原console containment、图表占比和高度断言。
+     for (const label of ['买入', '卖出']) {
+       const action = page.getByRole('button', { name: label, exact: true })
+       const b = (await action.boundingBox())!
+       expect(b.y).toBeGreaterThanOrEqual(consoleBox.y)
+       expect(b.y + b.height).toBeLessThanOrEqual(consoleBox.y + consoleBox.height + 1)
+       expect(await action.evaluate(el => {
+         const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
+         return hit === el || el.contains(hit)
+       })).toBe(true)
+     }
+     // 保存同一个推进中心，连续三次真实mouse点击；每次等日期改变/ready，
+     // 采样矩形并比对原中心，禁止locator.click自动重寻掩盖位移。
+     // 首个常用工具、自定义常用、多选、吸附均同样检查完整可视与center hit。
+     // 点击首个工具 -> active -> Escape；交易采用真实mouse点击并等真实trade响应。
+   }
  }
```

追加独立测试 `training keeps enlarged text and every drawing entry reachable by local wheel at actual minimum content size`，步骤必须如下：

1. 真实 `/api/trainings` 创建同一生产者训练，启动后确认drawing保存就绪、训练grid解除inert；设内容1008×641。记录7档语义字号原值，一次乘1.25，禁止每主题重复乘。明确这是文本token压力，不是Windows DPI或浏览器zoom。
2. 每主题通过真实theme toggle切换。先记录chart、advance、draw heading/actions矩形及document scrollY。读取console `scrollHeight/clientHeight`，只有真实溢出才声称测试了滚动。
3. 指针移到console中部，真实 `mouse.wheel(0, 1200)`；等待`scrollTop > before`。买卖完整落在console交集内，中心elementFromPoint属于相应按钮；真实mouse点击买入，等待POST `/api/trainings/{id}/trade`成功及账户持仓增加，不能只靠`toBeVisible`。
4. 断言chart、advance、画线标题/底部动作位置未因console滚动变化，document scrollY不变。再真实wheel回到console顶部。若125%恰好不溢出，使用条件单真实表单/挂单列表长状态造真实内容，不插入假div制造滚动。
5. 工具列表先证实`scrollHeight > clientHeight`。在其内部真实wheel到下方，等待scrollTop增加；最后常用工具及“其他工具”入口分别完整可视、center hit。用真实鼠标展开其他工具，工具列表再wheel到末项，实际点选末项并确认active/Escape。不通过evaluate改scrollTop替代滚轮；允许用它只读取。
6. 进入自定义常用后，favorites/other各自滚动；确认末项移动入口可达及“完成自定义”命中，退出后恢复默认工具集合。若仅验证可达无需改变收藏，不触发持久化重排。
7. 每个稳定状态截图。所有断言在有限入场动画完成后测稳定几何；本切片未新增motion，动画中间帧由root整体motion测试负责。记录主图/VOL/MACD/KDJ pane实际尺寸供人工判断。

## 运行与归因交接

获得root运行通道后先执行正式RED，保留失败run，再由root确认矩阵行语义后最小CSS，GREEN执行本spec和既有compact-chart/order-panel/chart-toggles。统一隔离journey且`--retries=0`，TDX_ROOT为root提供的只读snapshot；每条命令紧接捕获 `$LASTEXITCODE`。禁止触碰13311预览和未知服务。

门禁漏检归因：**入口盲区/环境边界**为主——原测试把Electron外框最小值当浏览器内容viewport；已有containment断言在错误尺寸上可绿。此外原测试只检查“自定义常用”可见，未验证裁切列表的滚轮路径和真实命中，属于**断言不锁**。原1024×680证据保留，不回写成实际最小窗口通过。

纸面变异：恢复短高空白间距应使实际1008×641 buy containment/hit失败；将工具列表overflow改hidden应使真实wheel/末项命中失败。未执行变异，标记`paper_only`。

未验证：候选CSS的实际效果、125%顶栏横向预算、当前候选完整journey、重建unpacked/NSIS、人类美感及实际设备/屏幕阅读器。若125%暴露root拥有的顶栏问题，只回报测量，不越界修改全局布局。
