# PACK 桌面应用形态（exe 打包）

```json
{
  "id": "PACK",
  "title": "产品形态升级：Windows 独立桌面应用（exe 打包，Electron 内嵌服务）",
  "state": "active",
  "summary": "用户需求 2026-10-06 原话：「下一个 K 线训练器正式版本的发布，不能再依赖当前 web 应用包的形态了，为了更便于后续开发和用户使用，我们需要升级产品形态，使用 exe 应用的打包方案，独立成一个 Windows 应用。」架构师选型（provisional）：Electron 主进程进程内启动现有 Fastify server，BrowserWindow 加载 http://127.0.0.1:<port>；electron-builder 产出便携 exe（portable 目标，NSIS 安装器留 PACK-05）；更新通道 PACK-04 用 electron-updater。降级树：进程内不可行（Node 版本/ABI/API 差异）→ Electron 内 sidecar（打包 node.exe 子进程跑 server/dist）；Electron 本机不可解阻塞（二进制持续下载失败）→ 回退 Tauri 2 sidecar（备忘录记录）。既有 zip 形态与 PORT-02/UPD 已交付语义零破坏。",
  "task_ids": [
    "PACK-01",
    "PACK-02"
  ],
  "verification_refs": [
    "docs/verification/2026-10/PACK-01/README.md",
    "docs/verification/2026-10/PACK-02/README.md"
  ],
  "acceptance_ref": null,
  "next_action": "PACK-01（选型＋原型）与 PACK-02（完整生命周期：单实例/优雅退出复用冻结排空/端口冲突三应答/外部链接/窗口记忆/安全基线）均完成工程验证（review 态）；矩阵 desktop-app covered=12/open=8/RED=0。PACK-03/04（electron-updater）/05（NSIS）待派发；PACK-02 的 8 项 proposed_default 待用户拍板（见其验证记录 README 第五节）。"
}
```

## 冻结边界（PACK-01 派发简报）

- 禁改 `web/src/**`、`scripts/release/**`、`launcher.cjs`、`server/src` 除 index.ts 入口外的业务代码、数据库 schema；越界即停。
- `git diff --stat origin/main..HEAD` 不得包含 scripts/release/**、web/**、launcher.cjs（零破坏证明）。
- 打包冒烟绝不触碰真实用户数据（`%USERPROFILE%\.a-share-kline-trainer` 与既有 zip data/ 目录）：临时 dataDir/TRAINER_DB，TDX_ROOT 只读或空。
- 矩阵 `desktop-app.yaml`：PACK-01 行以 planned 起步，PACK-02..05 预期行占位 planned。
