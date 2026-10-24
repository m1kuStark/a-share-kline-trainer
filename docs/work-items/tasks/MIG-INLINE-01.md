# MIG-INLINE-01 v1.2.7 迁移内置向导

```json
{
  "id": "MIG-INLINE-01",
  "title": "迁移工具内置化：首启弹窗＋路径引导＋历史/录像迁移＋安全卸载指引",
  "owner": "zcode:root",
  "state": "review",
  "milestone": "M6",
  "summary": "用户 2026-10-25 拍板：外置 migrate-v127 有损体验，内置到 v1.3.2。交互=首启弹询问（可跳过）→引导填 v1.2.7 安装路径（校验+摘要）→历史全自动迁移（幂等合并）→录像可选迁移（旧 origin 伺服导出页+浏览器一键导出回流）→完成页含安全卸载指引（删 v1.2.7 文件夹即可）。三项拍板已确认：录像折衷接受/首启弹一次+设置页常驻入口/同号重发 v1.3.2。",
  "next_action": "M6：全量回归绿后打包→同号重发 v1.3.2（GitHub+镜像）→verify→真机自验向导（伪造 v1.2.7 目录）",
  "evidence": {
    "desktop_unit": "desktop/test/mig-inline.test.ts 9/9（inspect 四态/history 合并幂等+零损伤/导出伺服三态）",
    "e2e": "e2e/migration-inline.spec.ts 3/3（首启弹一次+重载不弹（含遮罩样式回归断言）/校验→迁移→完成页逐字卸载指引/设置页常驻入口）",
    "guard_sync": "server/test/migration-oneclick-settings.test.ts 按内置化拍板改写（独立分栏仍禁；常驻入口+桥探测必须存在）；旧矩阵 migration-tool-v127.yaml SETTINGS-PANEL-REMOVED 行同步",
    "matrix": "ai-harness matrix migration-inline.yaml 6/6 covered、check-binding RED=0",
    "bug_reflection": "向导曾裸用 TrainingSettings 的 scoped 类名致平铺无遮罩——已补组件自有样式并转为 e2e 回归断言（getComputedStyle(position)==fixed）"
  },
  "allowed_paths": [
    "desktop/src/mig-inline.ts",
    "desktop/src/mig-import.ts",
    "desktop/src/main.ts",
    "desktop/src/preload.cts",
    "desktop/scripts/build-migration-page.mjs",
    "desktop/build-resources/migration-export-page.html",
    "desktop/electron-builder.yml",
    "desktop/test/mig-inline.test.ts",
    "web/src/components/MigrationInlineWizard.vue",
    "web/src/components/TrainingSettings.vue",
    "web/src/App.vue",
    "web/src/api.ts",
    "e2e/migration-inline.spec.ts",
    "docs/work-items/tasks/MIG-INLINE-01.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/MIG-INLINE-01.md"
    ],
    "reason": "外置工具口径（MIG-ONECLICK-01 设置分栏退役）由本卡逆转为内置向导；发布说明与 CHANGELOG 随同号重发更新"
  },
  "verification_refs": [
    "desktop/test/mig-import.test.ts",
    "server/test/migration-tool.test.ts"
  ],
  "integration_ref": null,
  "acceptance_ref": null,
  "acceptance_note": "用户 2026-10-25 三项拍板（录像折衷/弹窗策略/同号重发），全文见 summary"
}
```

## 验收条件

1. 空库首启弹一次询问（跳过后不再弹，localStorage 标记）；设置页常驻入口。
2. 填 v1.2.7 路径→校验（data/trainer.sqlite）→摘要（局数）。
3. 历史迁移全自动：合并幂等（重跑跳过已存在）、ns 不动、失败零损伤（复用 MIG-MERGE-01 语义）。
4. 录像可选：主进程旧 origin 端口伺服内置导出页→自动开浏览器→用户点导出→POST 回流自动导入；可跳过。
5. 完成页：导入汇总＋「确认数据完整后，删除 v1.2.7 整个文件夹即可安全卸载；新版数据独立存放不受影响」。
