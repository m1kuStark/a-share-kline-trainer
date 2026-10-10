# MIG-01 v1.2.7→v1.3.0 一键录像导出/导入过渡迁移工具

```json
{
  "id": "MIG-01", "title": "v1.2.7→v1.3.0 过渡迁移工具：老侧一键录像导出（同源页面＋控制台兜底）＋新侧 REC-BULK 导入指引", "owner": "zcode:mig-tool",
  "state": "review", "milestone": "RF",
  "summary": "已实现（方案 A＋C 兜底，设计文档 ai-harness-lab/proposals/migration-tool-v127.md，用户拍板 P1-P6 按推荐执行）：交付物 tools/migrate-v127/dist/migrate-v127/（拷入 v1.2.7 包根的 migrate-v127 文件夹）——导出训练录像.cmd（ASCII 内容中文文件名，用包内 runtime\\node.exe 零依赖运行 export-v127.cjs）：定位数据目录（--data-dir > trainer.config.json dataDir > 包根 data/ > ~/.a-share-kline-trainer）与旧 origin 端口（状态文件 > 显式配置 > 8787）→ SQLite 经临时副本只读 cache_meta 取录像命名空间（源库零写入）→ 停服门禁 fail-closed（状态 PID 存活或端口有应答即拒绝，绝不静默换端口）→ 在旧 origin 端口伺服一次性导出页（同源读 IndexedDB 全部三套 store：compactSessions+compactRecords 重组、legacy sessions 内存转换不回写、imports 库原样）→ 汇总为 REC-BULK 合并包下载（v1.2.7 载荷形态，契约附录见 recording-file.md「迁移工具载荷适配」）；同页可选打包 SQLite 三件套到包根迁移导出-时间戳文件夹（默认升级场景零操作，新 exe adopt-in-place）。控制台兜底脚本（F12 粘贴，旧训练器运行中在同源页面执行）与导出页共用 export-core。校验/转换直接 esbuild 打包仓库正源 web/src/recording 模块（与 v1.2.7 逐字段一致；main 枚举超集兼容经 diff＋单测断言）。新侧导入复用 REC-BULK-01 录像库「导入录制」，指引见迁移说明.md。真实链路验证：本地真实 v1.2.7 包（隔离端口+隔离数据目录 launcher --config 起服）→ 播种 1 legacy+2 compact+1 imported → 旧应用录像库自证可见 → 停服跑工具 → 合并包 → 当前 main 录像库批量导入成功 4 → 回放可用（e2e/migration-v127.spec.ts，env 注入老包路径、无包 skip）。单测 18 例：行重组与 MemoryCompactStorage 等价、v1 转换链、三来源扫描容错（损坏计入 failures、转换失败原样入包不静默丢弃）、合并包契约兼容、Node 侧纯函数。",
  "next_action": "待用户在真实浏览器数据上复验（用户 Edge 的旧 IndexedDB 复验留给用户）；P5 导入归属（迁移录像落在新版「导入的分享录像」栏）与 P3 发布物随附形态（migration/ 随 v1.3.0 发布物附带 vs 独立 zip）随收尾报告待拍板。",
  "allowed_paths": ["tools/migrate-v127/**", "server/test/migration-tool*.test.ts", "e2e/migration-v127.spec.ts", "e2e/README.md", "docs/work-items/tasks/MIG-01.md", "docs/verification/2026-10/MIG-01/**", "docs/status.md", "web/src/recording/recording-file.md"],
  "depends_on": ["REC-BULK-01"],
  "docs_impact": { "update": ["web/src/recording/recording-file.md"], "reason": "补「迁移工具载荷适配」契约附录：v1.2.7 三套 store 载荷进合并包的规范化口径与失败不静默丢弃语义。" },
  "verification_refs": ["docs/verification/2026-10/MIG-01/README.md"], "integration_ref": null, "acceptance_ref": null
}
```

用户需求 oracle（2026-10-09/10 两轮拍板）：「迁移工具必须能够针对 v1.2.7 版本进行一键录像导出，然后一键录像导入 v1.3.0 版本。我认为适配 v1.2.7 版本是重点，你可以使用本地已安装的 v1.2.7 版本 K 线训练器做实验和测试」「方案按推荐执行」（P1 合并包=REC-BULK 格式；P2 自定义 dataDir 提示为主；P3 随发布物附带待拍板；P4 中文文件名+ASCII 内容；P5 导入落 imported 栏待拍板；P6 强制停服）。

落点：`tools/migrate-v127/`（src/export-core.ts 页面核心＋src/export-tool.cjs Node 模板＋build.mjs esbuild 构建器＋dist/migrate-v127/ 交付物）；单测 `server/test/migration-tool.test.ts`；e2e `e2e/migration-v127.spec.ts`（MIG_V127_PACKAGE 环境变量注入老包路径，无包环境 skip）。

安全口径：对用户 v1.2.7 目录与真实数据零改删——实测全程用隔离数据目录与隔离端口（launcher --config），工具对老库 IndexedDB 只读（无版本号 open 不触发 upgrade）、SQLite 只经临时副本读取；用户 Edge 真实 IndexedDB 未触碰，复验留给用户。
