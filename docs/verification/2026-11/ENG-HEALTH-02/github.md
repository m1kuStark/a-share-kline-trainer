# GitHub 与分支核对（2026-11-17）

[检查总览](README.md)。

## GitHub 快照

| 项目 | 核对结果 |
|---|---|
| 主线 | 远端与本地 main 均为 `3b5fb11`；GitHub commit verification 为 valid |
| CI | 最新 Source checks run `43975277177` 成功；北京时间 2026-11-17 07:03:37 完成。最近 30 个 workflow run 中的 8 个 main Source checks 均成功 |
| 保护 | Ruleset `27018412/main-protection` active、无 bypass；要求 PR、docs/verify/pr-policy、签名，禁止 force push 与删除 main；自动删头分支开启 |
| 安全设置 | Secret scanning、push protection、Dependabot security updates 开启；存在开放告警，设置启用不等于无漏洞 |
| Issue / PR | 检查开始时仅 Issue #8 与依赖 PR #43 open；#43 三项 required checks 均成功、可合并，保留待独立评审 |
| 远端分支 | 完整 branches API 返回 main 和 PR #43 分支，共 2 项；没有过时远端分支可删 |
| 发布 | latest 稳定为 v1.3.3；v1.3.6 为 pre-release；无 v1.3.7/1.3.8 tag 或 Release，保持暂不发布边界 |

PR #43 更新 plugin-vue 6.0.10→6.0.11、Electron 44.10.2→44.11.3、Vite 7.3.7→7.3.8。本轮保留该 PR；CI 绿不能替代依赖升级评审或 Windows 包验证。最近 #44–47 使用 merge commit，与当前“维护者任务 squash”的文字约定有偏差；历史不改写，后续按[Git 工作流](../../../engineering/git-workflow.md)执行。

API 覆盖范围：Issue 3 项、PR 44 项、分支 2 项、Release 6 项、tag 10 项，均少于每次 limit 100；workflow 抽查最近 30 项。完整原始 JSON 本机缓存位于全局 Headroom 缓存的 `github-audit-20261117`，不提交凭据或完整工作区状态。

Git HTTPS 读取本轮两次失败：首次 `git fetch origin --prune` 为 `Recv failure: Connection was reset`，exit 128；HTTP/1.1 重试为 `Operation too slow. Less than 1000 bytes/sec transferred the last 20 seconds`，exit 128。成功的 GH branches API 提供全量远端清单，本地清理采用带旧 SHA 校验的 `git update-ref -d <ref> <old-sha>`，exit 0；[删除清单与原 SHA](pruned-tracking.json)支持恢复，未删除远端分支。

随后读取已启用的 Windows 系统代理，仅对单次 Git 命令显式指定代理后，`git fetch origin --prune` exit 0，`git rev-list --left-right --count main...origin/main` 为 `0 0`；没有修改全局 Git 配置。`git fsck --no-reflogs` exit 0 的 dangling 对象保留，不做 gc/prune。
