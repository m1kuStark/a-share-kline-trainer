# 发布与版本

版本与更新通道是"对外承诺"；源码 push 不是发布。发布规则与 [Git 工作流](git-workflow.md)、[CI 门禁](ci.md) 配套。

## 版本

- 语义化版本 `MAJOR.MINOR.PATCH`；`package.json`、CHANGELOG、tag、GitHub Release 必须一致。
- 版本号在任务分支上修改；**只有包含该版本提交的 main 才能打 tag**。
- 不修改已发布 tag；发现错误时发新 patch。

## 稳定 / 预览双通道

| 通道 | 来源 | 行为 |
|---|---|---|
| 稳定 | GitHub Release latest + 稳定更新 feed | 默认用户可见；只在用户验收通过后移动 |
| 预览 | 预览 feed / GitHub pre-release（可选） | 需显式加入或明确标注；**不得写稳定 latest 指针** |

预览版不得再次"检查更新即被普通用户看到"。发布脚本与 feed 同步必须分开处理两个通道；切换通道前先完成对应治理任务。

## tag 与 Release

- 从干净 main 打 **annotated + signed tag**：`git tag -a vX.Y.Z -m "vX.Y.Z"`，签名配置后自动签名。
- 发布资产至少：NSIS 安装包、ZIP 免安装包、`SHA256SUMS`；按发布手册逐项核对并记录 SHA256。
- GitHub Release 说明写用户可见行为变化；预览版标 pre-release，不写"latest 稳定"。
- 追溯：任务卡 `integration_ref` → 版本提交 → tag → Release → 验证记录。

## tag-release 脚本（2026-11-11 起）

`npm run release:tag -- --version X.Y.Z` 默认 **dry-run**，只打印计划；加 `--execute` 才创建签名 annotated tag。校验项：

- 当前分支必须是 `main`，工作树干净；`--version` 与 `package.json` 一致。
- `CHANGELOG.md` 必须有对应版本小节。
- 本地/远端 tag 不存在；最新 main CI run 必须 success 且覆盖当前 HEAD（可用 `--skip-ci-check` 仅用于离线演练）。
- `--push` 推送 tag；`--release --notes <文件> [--asset <文件>...] [--prerelease]` 创建 GitHub Release。实际发布仍须按下面检查清单人工核对资产与通道。

## 发布前检查清单

1. `git status` 干净；main 与 origin/main 一致或已推送。
2. `npm run verify:baseline` 通过并保存收据；journey 失败项已定性。
3. 主代理真实 UI/视觉检查通过（产品行为改动时）。
4. 用户验收记录已写（发布物验收，不是源码 push）。
5. 版本号/CHANGELOG/README 口径一致；`docs:check`、`docs:status -- --check` 0 error。
6. `npm run release:tag -- --version X.Y.Z` dry-run 通过 → `--execute --push`；Release 资产按需用 `gh release create` 上传 → 核对 SHA256SUMS。
7. 只移动对应通道的指针；稳定 feed 不指向预览。

> 当前（2026-11-12）**v1.3.7 候选**（CHART-LAYOUT-01 / UI-TOOLBAR-03 / CHART-MEASURE-04）已在本地打包交用户人工验收：未打 tag、未发 GitHub Release、未移动稳定更新 feed、未上传国内镜像；用户验收通过后才执行发布步骤。

> 历史（2026-11-11）v1.3.4 / v1.3.5 / v1.3.6 已补**签名 annotated tag**（分别指向 100f5c8 / 3ef59fe / 527ab29）；GitHub 仅 **v1.3.6 为 pre-release**（setup / blockmap / ZIP / SHA256SUMS），latest 稳定版仍为 **v1.3.3**。v1.3.4/v1.3.5 无 GitHub Release；正式稳定版等 v1.4.0。

## 回滚

- 代码：`git revert` 新提交回滚，不 reset 共享历史。
- 发布：先恢复 feed/tag 指向可用的稳定版本，再发 patch；已安装用户的数据迁移保持兼容。
- 任何回滚写验证记录与任务卡，不静默处理。
