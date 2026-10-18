# migrate-v127：v1.2.7 → v1.3.0 训练数据迁移工具（MIG-01 ＋ MIG-EXT-01）

服务 v1.2.7 老用户升级 v1.3.0 的一次性过渡工具。设计调研与方案 A（同源导出页＋REC-BULK 导入）：
`ai-harness-lab/proposals/migration-tool-v127.md`（只读）。契约附录：`web/src/recording/recording-file.md`「迁移工具载荷适配」节。
MIG-EXT-01 扩展：导出页新增「训练历史」分节（检测 data/trainer.sqlite → 只读副本校验/计数 → 产出
「训练历史迁移-<时间戳>/」＝自包含 trainer.sqlite 副本＋迁移清单.json，中文文件名＋ASCII 键）；新侧导入面在
desktop/src/mig-import.ts（设置页「从 v1.2.7 迁移」分栏，fail-closed：空库采用＋migrations 升级、非空人话拒绝、原子换库）。

## 形态

交付物是 `dist/migrate-v127/` 文件夹（构建产物，已提交），用户整夹拷入 v1.2.7 包根（与 Start.cmd 同级）：

| 文件 | 作用 |
|---|---|
| `导出训练录像.cmd` | 入口（ASCII 内容，中文文件名——沿用 Start.cmd 惯例）；用包内 `..\runtime\node.exe` 运行工具 |
| `export-v127.cjs` | Node 侧工具（CommonJS、零第三方依赖）：定位数据目录/端口 → 只读训练库取录像命名空间＋训练历史摘要 → 停服门禁 → 在旧 origin 端口伺服导出页；内嵌导出页 HTML+JS；`/pack-history` 产出训练历史迁移包 |
| `迁移兜底-浏览器控制台脚本.txt` | 方案 C 兜底：旧训练器运行中，其页面 F12 粘贴的同源导出脚本（与导出页同一份核心逻辑；仅录像，不涉及训练库文件） |
| `迁移说明.md` | 用户操作指引（旧侧导出录像+历史 → 新侧录像库导入+设置分栏导入历史） |

## 构建

```
node tools/migrate-v127/build.mjs
```

用仓库 node_modules 的 esbuild（无新依赖）：

1. `src/export-page.ts` → IIFE 注入 `src/page-template.html`（`<!--V127_PAGE_SCRIPT-->` 标记）；
2. `src/console-fallback.ts` → IIFE，拼进兜底 txt；
3. `src/export-tool.cjs` 的 `"__V127_PAGE_HTML__"` 占位符替换为完整页面 HTML（JSON 字符串化）；
4. `static/` 的 cmd 与说明复制进 dist。

**保真关键**：`src/export-core.ts` 直接 import 仓库正源 `web/src/recording/{validation,compactCodec,compactValidation,storage}`——
与 v1.2.7 对应文件逐字段一致（main 侧枚举集合仅是超集：+KDJ 窗格、+random 区间模式），因此 v1.2.7 合法录像必然通过新版导入校验。
compact 行重组（assemble）是 `compactStorage.ts` 内部函数的只读镜像（原函数未导出、该文件不属本任务可改范围），等价性由
`server/test/migration-tool.test.ts` 用 `MemoryCompactStorage` 落库行做深等回归锁定。

## 安全口径（真实数据铁律）

- 老库 IndexedDB：一律**无版本号 open**（绝不触发 upgrade/写）；打开不存在库产生的空 v1 壳会被识别并删除（只清自建残留）；
- 老库 SQLite：只读取 `cache_meta.recording_namespace`，且先把 db/-wal/-shm **复制到临时目录**再打开（源库零写入）；
- 旧 origin 端口被占＝失败报错（绝不静默换端口——换了 origin 就读不到录像）；状态文件 PID 存活＝拒绝导出；
- 对用户 v1.2.7 目录只新增文件（工具夹/迁移导出夹），绝不改删既有文件。

## 测试

- 单测：`server/test/migration-tool.test.ts`（vitest；bundle 组装、旧载荷转换、compact 行重组等价、损坏容错、Node 侧纯函数）
  ＋ `server/test/migration-tool-history.test.ts`（MIG-EXT-01：历史包产出契约、WAL 折叠、损坏/缺表/缺列拒绝、
  sha256 一致、迁移链经 server migrateDatabase 升级可读、导出页模板契约）；
- 单测（新侧导入面）：`desktop/test/mig-import.test.ts`（清单解析、包体检、fail-closed 暂存/拒绝、
  原子中断恢复、boot 换库/备份/回退、IPC 路由；真实工具产包＋真实 migrateDatabase＋node:sqlite 直查）；
- e2e：`e2e/migration-v127.spec.ts`（`npm run journey`；环境变量 `MIG_V127_PACKAGE` 指向 v1.2.7 包路径才运行，否则 skip：
  真实老包起隔离服务 → 旧格式种子录像 → 旧应用录像库可见 → 跑本工具导出 → 新版本录像库导入回放）；
- v1.2.7 真实包实测：`docs/verification/2026-10/MIG-01/`；真实训练库只读拷贝全链路（产包→体检→暂存→换库→升级直查）见 MIG-EXT-01 收尾报告。
