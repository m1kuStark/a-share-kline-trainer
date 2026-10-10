# migrate-v127：v1.2.7 → v1.3.0 训练录像迁移工具（MIG-01）

服务 v1.2.7 老用户升级 v1.3.0 的一次性过渡工具。设计调研与方案 A（同源导出页＋REC-BULK 导入）：
`ai-harness-lab/proposals/migration-tool-v127.md`（只读）。契约附录：`web/src/recording/recording-file.md`「迁移工具载荷适配」节。

## 形态

交付物是 `dist/migrate-v127/` 文件夹（构建产物，已提交），用户整夹拷入 v1.2.7 包根（与 Start.cmd 同级）：

| 文件 | 作用 |
|---|---|
| `导出训练录像.cmd` | 入口（ASCII 内容，中文文件名——沿用 Start.cmd 惯例）；用包内 `..\runtime\node.exe` 运行工具 |
| `export-v127.cjs` | Node 侧工具（CommonJS、零第三方依赖）：定位数据目录/端口 → 只读训练库取录像命名空间 → 停服门禁 → 在旧 origin 端口伺服导出页；内嵌导出页 HTML+JS |
| `迁移兜底-浏览器控制台脚本.txt` | 方案 C 兜底：旧训练器运行中，其页面 F12 粘贴的同源导出脚本（与导出页同一份核心逻辑） |
| `迁移说明.md` | 用户操作指引（旧侧导出 → 新侧录像库导入 → SQLite 沿用） |

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

- 单测：`server/test/migration-tool.test.ts`（vitest；bundle 组装、旧载荷转换、compact 行重组等价、损坏容错、Node 侧纯函数）；
- e2e：`e2e/migration-v127.spec.ts`（`npm run journey`；环境变量 `MIG_V127_PACKAGE` 指向 v1.2.7 包路径才运行，否则 skip：
  真实老包起隔离服务 → 旧格式种子录像 → 旧应用录像库可见 → 跑本工具导出 → 新版本录像库导入回放）；
- v1.2.7 真实包实测：`docs/verification/2026-10/MIG-01/`。
