# SETUP-RESTART-FIX-01 首次配置受控重启修复（V1.2.7）

```json
{
  "id": "SETUP-RESTART-FIX-01",
  "title": "首次配置受控重启修复：CLI 装配层字段断链与终态兜底",
  "owner": "integrator",
  "state": "closed",
  "milestone": "M5",
  "summary": "用户从 GitHub 下载 v1.2.7 包后首配通达信目录，重启实际已完成但页面确认超时。首个根因是 main() 透传 restartAttemptPath 而监管函数读 attemptPath，字段名断链致 supervisor 启动即崩；修复后又定位到 Chromium 同源 GET 通常不带 Origin，控制守卫误把轮询当助手请求而连续返回 401。现已修复 CLI 字段映射、早期失败终态兜底和无 Origin 同源浏览器轮询，并补齐两层回归。",
  "next_action": "已完成用户验收；随 v1.2.7 最终 Windows 包发布。后续若有回归，另立修复任务。",
  "allowed_paths": [
    "scripts/release/launcher.cjs",
    "server/test/release-launcher.test.ts",
    "server/src/setup/control-guard.ts",
    "server/test/setup-control-guard.test.ts",
    "server/test/setup-onboarding.test.ts",
    "CHANGELOG.md",
    "docs/status.md",
    "docs/verification/**",
    "docs/work-items/tasks/SETUP-RESTART-FIX-01.md",
    "package.json",
    "package-lock.json"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "CHANGELOG.md",
      "docs/work-items/tasks/SETUP-RESTART-FIX-01.md"
    ],
    "reason": "首配流程是所有新用户的入口路径；根因、兜底语义与回归补盲必须可追溯。"
  },
  "verification_refs": [
    "docs/verification/2026-10/V1.2.7-setup-restart-fix/README.md"
  ],
  "integration_ref": null,
  "acceptance_ref": "docs/verification/2026-10/V1.2.7-user-acceptance/README.md"
}
```

## bug 回流反思

- 覆盖盲区：受控重启测试自 SETUP-01 起全部直调 `runSetupRestartAttempt({attemptPath,...})`，真实链路（服务端 spawn → CLI 参数 → main 字段转换）零覆盖；spawn `stdio:'ignore'` 吞掉崩溃输出且无 supervisor 落盘日志，现场只留下"永远 preflight"。
- 回归：新增 CLI 装配层用例两条（reaches ready / 早期失败终态兜底），fixture 补拷 restart-plan.js；未来任何 main 装配层断链都会在此拦截。
