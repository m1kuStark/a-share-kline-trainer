# UIUX-REFINE-01 训练工作台与交互层级重构

```json
{
  "id": "UIUX-REFINE-01",
  "title": "基于 UIUX core 的训练工作台与交互层级重构",
  "owner": "codex:root",
  "state": "review",
  "milestone": "M5",
  "summary": "UIUX候选已完成实现和分层自验：22项新UIUX组合收据通过、1912单测通过、7行L2闭合；NSIS隔离包已生成，用户体验与17项全量回归债待验，未发布。",
  "next_action": "用户验收UIUX呈现与NSIS候选；按regression-debt.md另行关闭17项全量遗留失败及安装/退出路径，再评估发布。",
  "base_commit": "6d557a12",
  "allowed_paths": [
    "web/src/App.vue",
    "web/src/styles.css",
    "web/src/tokens.css",
    "web/src/views/Launcher.vue",
    "web/src/views/Training.vue",
    "web/src/views/History.vue",
    "web/src/views/Rankings.vue",
    "web/src/components/RecordingLibrary.vue",
    "web/src/components/TrainingSettings.vue",
    "e2e/uiux-*.spec.ts",
    "e2e/compact-chart.spec.ts",
    "e2e/recording-bulk.spec.ts",
    "e2e/acceptance-feedback.spec.ts",
    "e2e/data-update.spec.ts",
    "e2e/cost-basis.spec.ts",
    "server/test/uiux-*.test.ts",
    "docs/work-items/tasks/UIUX-REFINE-01.md",
    "docs/verification/2026-10/UIUX-REFINE-01/**",
    "docs/status.md",
    "e2e/port-fallback.spec.ts"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/UIUX-REFINE-01.md"
    ],
    "reason": "呈现与布局重构，业务/API/数据语义不变；验证与设计在本任务记录。"
  },
  "verification_refs": [
    "docs/verification/2026-10/UIUX-REFINE-01/README.md"
  ],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 契约与独立预期

用户本轮要求：可重构界面布局与组件布置，改善比例、流畅度和动效，并监督 subagent、修订 skills。旧 B6 不新增页面动效的局部决定由本次授权替代；M6-05R 的数字滚动偏好不变。保留 T+1、整手、撮合、防未来、随机遮蔽、快捷键、数据源和 API，不增加依赖。

- 创建页：训练标的/周期和本局规则分区，桌面使用有效横向空间；提交区域稳定可达。经典初始资金保留与日期同行，随机初始资金仍独立，维度切换不移动公共操作。1440×900、1024×680、125% 文字均检查。
- 应用层：紧凑工具型导航与清晰当前页，页面、设置、提示的动效按事件定义；高频交易/推进仍即时，减少动效不损失信息与操作。不得用出场等待拖延保存/退出，不改数字滚动。
- 训练页：保持图表主副布局与交互，理顺账户、交易、画线区域的层级，维护图表有效高度和固定推进目标。
- 最小窗口预算修正：Electron 配置的1024×680是外框，2026-10-17隔离unpacked实测内容为1008×641、DPR=1。以实际内容区补验，不能把外框当浏览器viewport；交易按钮须完整落在console可视区且点击命中按钮，默认画线入口同时可达。125%文字压力允许局部滚动，但不能遮挡或丢失操作。原1024×680浏览器证据保留其原范围。
- 历史/排行/录像：结构一致，密集数据清晰，1024 宽不溢出，保留播放、导出、删除入口与区别。明确空/错/加载状态。
- 审美配色、间距、动效参数是呈现候选，待用户验收；几何可达性、实际事件、键盘、盲训等行为由测试锁定，不能用样式快照代替可用性。

## 所有权与验证

root 是任务卡、矩阵、台账、构建/预览、状态文件和最终提交的唯一写者。worker 禁写共享状态、不提交其他人的修改。每次任务首读当前 Harness、UIUX 文档全文；研究型书面简报替代 task-manifest（零产品写入），实现统一锚定此卡。gate 0=通过，非零保留原生退出码。

单测/构建/全量 journey/doc gates 由 root 集成运行；定向 RED 与 GREEN 分次运行，保留首次失败、源码指纹和实际加载构建证据。数据来自只读冻结 TDX 样本，全部运行用独立 manifest/DB/端口。打包需真实 node_modules，联接不可用于出包。

## 集成验证范围修正

2026-10-17 root 复核发现 compact-chart 旧测试精确匹配 ?tf=1D，而基线请求已有 warmup 参数，初始夹具未进入图表（run-20b8e382）。为解除本任务完整验证阻塞，将该测试加入 root 写面：按 endpoint + tf 匹配并增加拦截次数活性断言，保留全部日期、防未来和回到最新断言；不修改产品取数行为。首轮失败留存。

录像库快速导航回归发现env隔离初始化超过3秒时，界面已允许批量导入但短重试耗尽。属于明确可复现的就绪呈现缺陷：新增UIUX-RECORDING-READY，W2先延迟env回归RED，再将真实初始化busy状态传入库入口，准备中禁用导入、完成后自动启用；失败沿已有错误和重新连接路径。存储、命名空间与导入语义不变。旧bulk测试仅将准备就绪作为动作前提，全部业务断言保留。

全量运行另确认 port-fallback 的 env 夹具缺少 recordingNamespace，导致消费端初始化失败；第三条负断言因此可能假通过。root授权仅补完整 EnvView 形状与首页就绪前提，保留全部端口文案/缺席断言。历史/排行新原生按钮的可访问名称须包含可见主标签；先以实际名称断言 RED 再修，不改变打开成绩单动作。录像准备行补失败→重新连接的真实交互回归，不能以损坏导入文件替代环境恢复。
