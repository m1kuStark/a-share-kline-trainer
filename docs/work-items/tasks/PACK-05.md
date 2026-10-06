# PACK-05 发布流水线与打包冒烟门禁（PACK 收官）

```json
{
  "id": "PACK-05",
  "title": "exe 版本发布全套流水线：NSIS 安装器＋latest.yml＋校验和＋打包冒烟门禁＋维护者发布手册＋用户升级指引（zip 流水线零破坏）",
  "owner": "integrator",
  "state": "review",
  "milestone": "PACK",
  "summary": "工程验证完成（2026-10-06）：发布流水线全套交付——`npm run release:desktop`（desktop/scripts/release-desktop.mjs 编排＋release-desktop-lib.mjs 纯函数层）一键产出 NSIS 安装器（one-click=false 向导式/per-user/setup 命名）＋便携 exe＋latest.yml（electron-builder 原生产出＋字节级核验的双路径，--publish never 不触 GitHub）＋SHA256SUMS-desktop.txt（异名避 UPD-01 精确名资产，有测试锁定）。打包冒烟门禁双目标：portable A-H 回归（SMOKE_PASS 119.3s）＋NSIS 静默安装/运行/优雅退出/静默卸载无残留（SMOKE_PASS 37.9s；含 PACK-04 extraResources 回退 NSIS 形态实证＝安装目录 resources/app-update.yml 存在断言）。desktop 115/115（新增 13 例 TDD 先红后绿）＋全量 1524（flaky 2 例逐名登记）＋build/build:desktop:main 过；矩阵 desktop-app 23 covered/9 open 设计内（PACK-05 占位行升实义六行：4 covered＋2 收据行）＋updater 22/22 零降级；禁改区 diff 空；变异 M1/M2 executed 击杀。发布手册（docs/release/desktop-release-manual.md）＋用户升级指引（desktop-upgrade-guide.md）落地。平台实证三条：NSIS 静默安装仍建快捷方式且 shell 目录不受 env 重定向（快照→差集→卸载→断言消失消化）；latest.yml 在 --publish never 下仍原生产出（与包内 app-update.yml 行为不同）；node windowsHide:true 的 SW_HIDE 会被直启 Electron 首窗口继承（窗口不显示但渲染/心跳正常，冒烟已固定 false）。",
  "next_action": "用户验收 proposed_default 4 项（NSIS 向导式/per-user/快捷方式默认、zip 兜底双形态、latest.yml 双路径、发布人工环节清单，见验证记录 §九）后转 done；首个双形态 Release 上传（人工，按发布手册 §三）后真机走通安装版在线更新端到端（UPD-DESKTOP-INSTALL-DRAINS-FIRST 最后一环）",
  "base_commit": "65540f4",
  "allowed_paths": [
    "desktop/**（electron-builder.yml/脚本/冒烟/build-resources）",
    "package.json scripts 增改（依赖不变更）",
    "docs/verification/2026-10/PACK-05/**",
    "docs/work-items/tasks/PACK-05.md",
    "docs/release/**（发布手册与用户升级指引，新文件）",
    "docs/status.md（仅生成器）",
    ".control/trainer-state.json（仅 CLI）",
    "ai-harness-lab/harness-state.jsonl（仅 gate-report）",
    ".zcode/skills/ai-harness/matrix/desktop-app.yaml＋镜像"
  ],
  "depends_on": ["PACK-01", "PACK-02", "PACK-03", "PACK-04", "UPD-01", "UPD-02"],
  "docs_impact": {
    "update": ["docs/work-items/tasks/PACK-05.md", "docs/work-items/milestones/PACK.md"],
    "reason": "PACK 收官任务：发布流水线＋冒烟门禁；矩阵在工作区 harness skill（desktop-app.yaml 六行升实义）。"
  },
  "verification_refs": ["docs/verification/2026-10/PACK-05/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 门禁清单（派发简报冻结）

1. 开卡即 gate-report 登记；check-binding strict --include-untracked（desktop-app.yaml＋updater.yaml 都要过）。
2. 发布脚本可测逻辑（产物清单计算、校验和生成、命名断言、latest.yml 生成/核验）vitest 先红后绿；NSIS 静默安装/卸载属实机编排进冒烟脚本（fail-closed 断言齐全：spawn 前断言 env 重定向解析结果位于临时目录）。
3. `npm test` 全量（存量失败逐名）；`npm run build`；`npm run release:desktop`（产出全套产物）。
4. 冒烟双目标：portable A-H 回归＋NSIS 静默安装→运行→退出→卸载无残留。
5. 零破坏证明：diff 不含 scripts/release/**、launcher.cjs、server/src、web/src；package.json 仅 scripts 增改。
6. 变异抽检 2 行（RELEASE-SCRIPT-GATE 的校验和/清单断言方向）。

## 冻结约束（派发简报）

- 不发布任何 GitHub Release/资产（上传由用户手动/授权后进行）；绝不触碰真实 %USERPROFILE% 数据与 GitHub Releases。
- NSIS 工具链下载走 electron-builder-binaries 镜像（package-desktop.mjs 已固化，沿用）；安装器构建命令独立执行。
- 8787 可能被真实服务占用；动态端口。
- zip 流水线不动（零破坏证明延续）；UPD-01 SHA256SUMS 资产精确名匹配 → desktop 校验和文件必须异名（SHA256SUMS-desktop.txt）。
- app-update.yml extraResources 回退方案在 NSIS 安装形态下复核（安装目录 resources/app-update.yml 实证）。
- Windows→GitHub 偶发重置：push 失败等 60s 重试最多 3 次。

## proposed_default（呈报清单，见收尾报告）

1. NSIS one-click=false 传统向导式＋per-user 安装＋允许自选安装目录。
2. zip 形态保留为兜底（双形态发布策略）。
3. desktop 校验和资产名 SHA256SUMS-desktop.txt（避开 UPD-01 精确名）。
4. 发布步骤人工环节清单（latest.yml 必须同名上传等）。
