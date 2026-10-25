# MIG-INLINE-01 v1.2.7 迁移内置向导

```json
{
  "id": "MIG-INLINE-01",
  "title": "迁移工具内置化：首启弹窗＋路径引导＋历史/录像迁移＋安全卸载指引",
  "owner": "zcode:root",
  "state": "closed",
  "milestone": "M6",
  "summary": "用户 2026-10-25 拍板：外置 migrate-v127 有损体验，内置到 v1.3.2。交互=首启弹询问（可跳过）→引导填 v1.2.7 安装路径（校验+摘要）→历史全自动迁移（幂等合并）→录像可选迁移（旧 origin 伺服导出页+浏览器一键导出回流）→完成页含安全卸载指引（删 v1.2.7 文件夹即可）。三项拍板已确认：录像折衷接受/首启弹一次+设置页常驻入口/同号重发 v1.3.2。",
  "next_action": "已闭环：v1.3.2 修复轮已同号重发（GitHub+镜像双源核对绿）；git push 因本机 github.com 主站断连待网络恢复后补推（api/uploads 子域正常）。",
  "evidence": {
    "desktop_unit": "desktop/test/mig-inline.test.ts 9/9（inspect 四态/history 合并幂等+零损伤/导出伺服三态）",
    "e2e": "e2e/migration-inline.spec.ts 3/3（首启弹一次+重载不弹（含遮罩样式回归断言）/校验→迁移→完成页逐字卸载指引/设置页常驻入口）",
    "guard_sync": "server/test/migration-oneclick-settings.test.ts 按内置化拍板改写（独立分栏仍禁；常驻入口+桥探测必须存在）；旧矩阵 migration-tool-v127.yaml SETTINGS-PANEL-REMOVED 行同步",
    "matrix": "ai-harness matrix migration-inline.yaml 6/6 covered、check-binding RED=0",
    "bug_reflection": "向导曾裸用 TrainingSettings 的 scoped 类名致平铺无遮罩——已补组件自有样式并转为 e2e 回归断言（getComputedStyle(position)==fixed）",
    "realbox_bug": "真机自验暴露产品缺陷（e24 已修，e084f1e）：首启检测打的是不存在的 GET /api/trainings（404 静默吞→弹窗永不出现）；e2e mock 曾发明该路由掩盖缺陷（mock 漂移）。修复=改打真实 /api/trainings/history 判 total===0；e2e mock 同步镜像真实端点形状",
    "realbox_receipt": "realbox-flows（工作区级，非仓库）install-flow.ps1＋wizard-flow.ps1（UIA 语义定位＋BM_CLICK/WM_SETTEXT，用户拍板固化真机固定流程）：安装向导全页走完 PASS；向导六步 PASS＋node:sqlite 断言 2 局/1 笔成交迁入全新 TRAINER_DATA_DIR；完成页卸载指引逐字可见",
    "release_receipt": "v1.3.2 同号重发两轮（首轮 0ececa0、修复轮 e084f1e）：GitHub 6 资产逐名置换（id 前置核对）＋CloudBase 镜像 6 件；API 通道字节级核对全绿（sha256/sha512/latest 指针/镜像 feed）；SHA256SUMS-desktop.txt 3 行（migrate 行手工裁剪，脚本口径错配已挂待办）",
    "hotfix_v133": "用户真机首用即中（2026-10-25）：向导「选择文件夹…」误接旧外置工具的迁移清单.json 文件选择器——所有用户必见系统「找不到文件」提示（cda3f3b 修复：inline-pick-root 原生 openDirectory 目录选择器）。因 v1.3.2 已发给用户且 electron-updater 按版本号比较，热补丁升版 v1.3.3 发布（f160750）——已装 v1.3.2 用户首页将收到常规更新提示；用户侧闭环＝首启提示先「不再提示」→ 更新 1.3.3 → 设置→数据目录→「从 v1.2.7 迁移老数据…」"
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
