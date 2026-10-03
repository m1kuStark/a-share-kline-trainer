# SETUP-RESTART-FIX-01 首次配置受控重启修复（V1.2.7）

```json
{
  "id": "SETUP-RESTART-FIX-01",
  "title": "首次配置受控重启修复：CLI 装配层字段断链与终态兜底",
  "owner": "integrator",
  "state": "review",
  "milestone": "M5",
  "summary": "用户从零安装 v1.2.6 首配通达信目录报\"配置超时\"。根因：main() 透传 restartAttemptPath 而监管函数读 attemptPath，字段名断链致 supervisor 启动即崩（stdio ignore 无输出），重启状态永久停在 preflight，前端轮询耗尽报超时。修复字段映射＋main 兜底写终态；新增 2 条 CLI 装配层回归（此前 49 例全直调函数绕过装配层）。",
  "next_action": "等待用户对 v1.2.7 包验收（从零首配→保存→自动切换到已连接）。",
  "allowed_paths": [
    "scripts/release/launcher.cjs",
    "server/test/release-launcher.test.ts",
    "CHANGELOG.md",
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
  "acceptance_ref": null
}
```

## bug 回流反思

- 覆盖盲区：受控重启测试自 SETUP-01 起全部直调 `runSetupRestartAttempt({attemptPath,...})`，真实链路（服务端 spawn → CLI 参数 → main 字段转换）零覆盖；spawn `stdio:'ignore'` 吞掉崩溃输出且无 supervisor 落盘日志，现场只留下"永远 preflight"。
- 回归：新增 CLI 装配层用例两条（reaches ready / 早期失败终态兜底），fixture 补拷 restart-plan.js；未来任何 main 装配层断链都会在此拦截。
