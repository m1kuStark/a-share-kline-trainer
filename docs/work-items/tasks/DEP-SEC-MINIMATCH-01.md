# DEP-SEC-MINIMATCH-01 构建依赖 minimatch 安全维护

```json
{
  "id": "DEP-SEC-MINIMATCH-01",
  "title": "评估并修复构建依赖 minimatch 安全告警",
  "owner": "integrator",
  "state": "review",
  "milestone": "ENG",
  "base_commit": "2c66477f0c4875ac3a100338fdbc42b4878dadd8",
  "summary": "2026-11-18 独立本地候选：两条父包与 child 请求范围限定的 override 及生产 glob 锁定副本均升级至 minimatch 11.0.9，legacy 3.1.5/5.1.9 保留。npm ci/ls、20 项版本与消费者 API 检查、full/production audit、3023 项测试、build、portable 与 NSIS x64 打包、隔离包内模块运行均通过；候选待集成审查，不代表 GitHub 告警已关闭或用户验收。",
  "next_action": "集成人核对独立审查、ENG/work-items/生成 status 与矩阵台账，完成候选集成；后续 PR、合并及远端告警核对另行执行。安装向导、完整 UI 与用户验收仍需独立安排。",
  "allowed_paths": ["package.json", "package-lock.json", "docs/work-items/tasks/DEP-SEC-MINIMATCH-01.md", "docs/work-items/milestones/ENG.md", "docs/work-items/README.md", "docs/status.md", "docs/verification/2026-11/DEP-SEC-MINIMATCH-01/**"],
  "depends_on": [],
  "docs_impact": {
    "update": ["docs/work-items/tasks/DEP-SEC-MINIMATCH-01.md", "docs/work-items/milestones/ENG.md", "docs/work-items/README.md", "docs/status.md"],
    "reason": "构建依赖升级需要明确受影响链、兼容性与打包收据，不能以当前 CI 绿色替代安全修复。"
  },
  "verification_refs": ["docs/verification/2026-11/DEP-SEC-MINIMATCH-01/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 公告与候选范围（2026-11-18 核对）

- GHSA-g3hv-75wg-m249 范围 `>=7.0.0,<11.0.1`，修复版 `11.0.1`。GitHub alert #48 在本轮远端核对时仍 open。
- 开发链：`electron-builder@26.18.0 → app-builder-lib@26.18.0 → minimatch@10.2.6`；另经 `@electron/universal@2.0.3` 使用 `minimatch@9.0.9`。
- 生产链 `@fastify/static → glob → minimatch@11.0.5` 不在旧公告范围，但落入新增 GHSA-hqmv-qgp3-jx75 的 `11.0.3–11.0.7` 范围（公告头部修复版 `11.0.8`）；此次一并刷新到 `11.0.9`。公告正文仍含旧的“无修复版”措辞，按头部版本范围与当前发布元数据判断，并保留原始公告。
- 生产 `npm audit --omit=dev` 基线为 0 漏洞，未报告上述新公告；不能用该结果替代上游范围核对。
- 不全局放开 Dependabot major 忽略；覆盖选择器同时限定父包版本与原始 child 请求范围，避免 npm 的跨层级 override 污染 legacy 3.x/5.x。后续升级父包须重新核对适用范围。
- 当前默认静态服务采用 wildcard 路由，项目未传入 glob 模式；构建匹配模式来自仓库配置。已确认依赖版本暴露，尚未证明产品存在可由攻击者触发的资源耗尽路径。
- 本卡不授予发布权限；本地候选尚未推送、创建 PR、合并或关闭远端告警。
- 来源及本轮检查边界见[健康检查](../../verification/2026-11/ENG-HEALTH-02/README.md)。

## 验证交接

- 独立 worktree 由基线 `2c66477` 建立，依赖经独立 `npm ci` 安装，没有目录联接或共享 node_modules。
- 失败、重试原因、原生命令退出码和最终指纹见[验证记录](../../verification/2026-11/DEP-SEC-MINIMATCH-01/README.md)。原始宽泛 child override 的 `ELSPROBLEMS` 已保留，最终范围已收窄。
- 卡片全局状态、ENG、work-items 摘要、生成 status 与统一状态由集成人在候选交接时对账；worker 不修改共享状态或行为矩阵。
- 最终验证串行完成：server 2654＋desktop 369 项测试通过；portable 与 NSIS x64 构建通过，包内 Electron 44.10.2 可加载 minimatch 11.0.9、glob、Fastify 静态资源及内置 SQLite。NSIS 首跑下载超时，补齐现有脚本镜像后通过；初始探针的路径、生成更新配置和等待方式错误均保留，未据此修改产品。
- `build:desktop` 仍强制 portable，与 YAML 的 NSIS 目标分歧作为后续维护项，本卡未修改打包入口。包内 NSIS `app-update.yml` 由 builder 生成，不能与静态 fallback 作字节等同判断。
