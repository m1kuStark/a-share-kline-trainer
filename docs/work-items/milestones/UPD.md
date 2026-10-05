# UPD 在线版本更新

```json
{
  "id": "UPD",
  "title": "在线版本更新（应用内检查更新＋保留历史训练数据的应用内换装）",
  "state": "active",
  "summary": "用户需求 2026-10-06 原话：『我需要在下一个版本的 K 线训练器中加入在线版本更新功能……让用户能够直接从本地更新 K 线训练器版本，并且保留自己的历史训练数据在本地，不必再使用从 github 上下载最新 release 包替换本地老版本训练器，导致自己的历史训练数据找不回来，只能从头开始的方法。』参考架构师对 cc-switch 的适配方案（proposed_default）：应用内检查更新（GitHub Releases latest API，URL 可配置/可注入）＋数据外置保护＋更新前自动备份＋校验失败拒绝应用＋手动下载永久兜底。UPD-01 服务端核心（检查/下载/校验/备份/换装编排/重启链路/版本暴露/发布 SHA256SUMS 资产）；UPD-02 设置页 UI 接线（不在 UPD-01 范围）。",
  "task_ids": [
    "UPD-01"
  ],
  "verification_refs": [
    "docs/verification/2026-10/UPD-01/README.md"
  ],
  "acceptance_ref": null,
  "next_action": "UPD-01 服务端核心完成工程验证（review 态）：矩阵 11 行全 covered、npm test 1501/1501、变异抽检 2 行击杀；8 项 proposed_default（runtime 完全一致口径/preserve 清单/备份数 5/自动开浏览器/范围裁剪/手动触发/completed 终态/check 200+error 形态）随收尾报告待用户拍板。UPD-02 设置页 UI 接线待派发（契约＝docs/verification/2026-10/UPD-01/design.md §2）。"
}
```

## 范围边界（UPD-01 派发简报冻结）

- v1 范围裁剪（YAGNI，proposed_default）：不做增量更新、不做强制更新、不做自动检查、不做签名校验；`runtime\node.exe` 版本变化场景不做在线换装（检测不兼容则明确提示走全量包重装路径）。
- `web/**` 属 UPD-02，UPD-01 禁改。
- launcher.cjs 启动/停止语义（PORT-02 刚冻结）禁改；更新器只通过「spawn launcher.cjs（Start 语义）＋SETUP-01 控制 API 排空」间接复用，不修改其代码。
- 手动兜底：GitHub Releases 手动下载路径永久可用（文档注明）。
