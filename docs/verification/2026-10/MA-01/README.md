# MA-01 均线设置验证

对象：基础提交 `5f74db0ed3e46000f19754efb5ecf7ee7f3e4835` 上的未提交工作树。实现及测试文件SHA-256见[result.json](result.json)，设计见[方案](../../../proposals/ma-settings.md)。没有发布、集成提交或用户验收结论。

本页及result.json保留首次实现的验证结果。2026-10-07按用户要求改为默认加载量与长周期按需补载，最新候选另见[按需加载验证](load-on-demand.md)，不能将首次实现的通过结果当作新代码证明。

## 已通过

- `npm run build`：前端类型、服务端及生产前端编译通过；存在既有大包提示。后续Journey亦独立构建同一运行代码。
- 最终定向 `npx vitest run --config server/vitest.config.ts server/test/ma-settings.test.ts server/test/full-acceptance.test.ts`：11项通过。包括配置损坏恢复、非法输入、保存失败不发布、实际图库MA1000计算、合成2300根日线的1040/1839/840加载边界及防未来。
- `npm run test:desktop`：40项通过。
- `tsx scripts/verify-m2.ts`：24项通过，内存SQLite，通达信只读，报告复制为[M2报告](m2.md)。
- 定向Journey：3项通过，独立run `run-54985be6-2919-4917-b66c-f6424519ecd2`。真实事件覆盖草稿/取消/Esc/校验、预设/颜色、面板热键隔离、视窗和画线保留、日周月共用、刷新、MA1000数值、全0/恢复默认、双主题双桌面尺寸、无pageerror。
- 文档check/impact/status已执行，0错误（仓库既有长度建议告警保留）。最终摘要一致性在收尾时重新检查。

## 主代理视觉检查

主代理实际查看浏览器截图，深色1440×900及浅色1280×720：八行、预设、提示和底部操作均可见，无横向溢出或截断；输入焦点清楚，应用按钮与取消有区别，背景遮罩及主题一致。另外两种组合亦由真实事件用例检查并截图。

![深色面板](ma-settings-dark-1440.png)

![浅色面板](ma-settings-light-1280.png)

## 未通过的完整门禁

`npm test`：服务端1511通过、10超时失败，6个失败文件。失败位于未修改的recording-compact-recorder、recording-compact-validation、runtime-isolation、updater-apply、updater-swap、updater-verify。串行复核这6个文件：93通过、1超时失败，剩updater-verify的UPD-RUNTIME-COMPAT用例（5000ms）。这些文件未被本任务修改；未对基础提交做同机对照，不能断言基线也必然失败。npm test串联的desktop未执行，因此另行运行并通过。

全套Journey启动153项，按首个失败停止：acceptance-feedback首例找不到旧文案“还没有保存的训练录像”，1失败、152未运行，不能视为全量通过。报告保留于 `run-f0d2bf3a-c06d-4fab-9d54-f170ef74a835`，本任务不修改无关录像入口测试或弱化断言。完整门禁尚未通过，任务保持active。

## 首次失败及复跑

沙箱内测试、构建、tsx文档和Journey首次受esbuild子进程spawn EPERM阻止；经执行审批在沙箱外复跑，功能检查继续完成。

Journey前三次分别为 `run-0df965bd-bca9-45f9-95b4-7981b5d7c393`、`run-8128541c-951f-4736-b898-7dcfd6d84810`、`run-5a34b173-c730-4d93-b5b1-673289264d58`，原日志保留在各run。前两次初始化/首页读取超过默认等待；第三次面板视觉用例通过，其余失败为刷新仍使用15秒等待、2025-01-02样本只有830根而误期待MA1000数值。修正刷新等待，长周期用例改2026-01-02（至少1000根），没有补造历史或用短窗口均值替代MA1000，最终3项通过。

实源来自独立冻结的600519、300857、sh000300样本及名称/权息文件，截止2026-09-16，具体散列见[snapshot.json](snapshot.json)。不代表全市场或全历史覆盖；测试不写通达信目录或个人训练库。
