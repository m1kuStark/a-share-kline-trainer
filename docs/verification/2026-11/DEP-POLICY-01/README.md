# DEP-POLICY-01 验证记录

> 状态：配置/文档完成，PR 门禁待跑；基线 bdea4c6（main）。
> 任务：Dependabot 全局忽略 major，保留 klinecharts 钉定忽略；记录本批 PR 处置。

## 触发证据

- GOV-CLOSE-01 后 Dependabot 又创建 #29-33（含 pinia 4 / @types/node 26 / vite 8 等 major），说明逐项忽略不可持续。
- #29 生产依赖分组（6 项 minor/patch）已验证通过并合并（bdea4c6）。
- #30（vitest 4.1.12 补丁，verify 失败/冲突）、#31 pinia major、#32 @types/node major、#33 vite major 已关闭并留理由。

## 改动

- `.github/dependabot.yml`：npm 与 github-actions 均加 `dependency-name: "*"` + `version-update:semver-major` 忽略；klinecharts 保留全忽略。
- `docs/engineering/ci.md`：依赖更新策略改为全局 major 忽略，注明升级需专项任务。

## 门禁

| 检查 | 命令 | 结果 |
|---|---|---|
| 文档结构/任务卡 | npm run docs:check | 执行中 |
| 状态生成区 | npm run docs:status -- --check | 执行中 |
| 范围/文档影响 | npm run docs:impact -- --base bdea4c6 --task DEP-POLICY-01 | 执行中 |
| PR 门禁 | docs / verify / pr-policy | 执行中 |

## 边界

- 只改依赖机器人策略与文档，不改产品代码/依赖版本。
- major 升级仍是人工专项任务；忽略不是永不升级。