# PORT-UPD-01 便携版自研 exe 替换式自更新

```json
{
  "id": "PORT-UPD-01", "title": "便携 exe 内置自更新（electron-updater 不支持 portable target 的自研替换式方案 A）", "owner": "zcode:portable-selfupdate",
  "state": "review", "milestone": "PACK",
  "summary": "已实现（用户拍板方案 A，2026-10-11）：便携形态（PORTABLE_EXECUTABLE_DIR 注入）下更新链在适配器层切换到自研 PortableUpdater（desktop/src/portable-updater.ts，实现同一 DesktopUpdaterAdapter 面——controller/IPC/preload/渲染端零改动）；dev/NSIS 路径零改动仍走 electron-updater。检查＝拉 latest.yml（feed 复用 env TRAINER_DESKTOP_UPDATE_FEED > GitHub 常量口径）＋compareVersions 单一口径；下载＝落 <dataDir>/update-staging/<便携产物名>＋sha512/size 对 latest.yml 条目 fail-closed 校验（失败删文件拒绝应用）；应用＝既有排空退出管线 exit 分支→应用前复验→渲染 cmd 替换脚本（路径烘焙、goto 分支、findstr 探活——find 会被 Git Bash PATH 解析为 GNU find，tasklist 无匹配 rc 亦为 0，双坑实测）落 staging→detached spawn→退出主进程→脚本等待旧 pid 消失→旧 exe 改 .old→staging 移入原路径→（移入失败回滚 .old）→删 .old→启动新 exe；数据目录与 exe 分离，替换不触数据；启动时清理 staging 与 .old 残留。发布侧：release-desktop.mjs 给 latest.yml 追加便携 exe sha512/size 条目（幂等，setup/path 原样，NSIS 通道零影响）＋新增 migrate-v127.zip 产物（P3：纯 Node STORE 型 zip 写入器，零新依赖，正确性由 server UPD-01 zip 读取器独立校验）。desktop 新增 32 例（纯逻辑与适配器 23＋真实 spawn 冒烟 3＋发布管线 6，含 main.ts 源码契约）TDD 先红后绿；desktop 全量 147/147＋server updater 定向 53/53＋build＋build:desktop:main 全 exit 0；updater 矩阵 strict 绑定检查 22/22 covered RED=0（新行为 8 行 EARS 提案随收尾报告待入矩阵）。真实便携 exe 端到端更新（发布 Release 含新 latest.yml 形状→旧便携版在线升级）留真机验收。",
  "next_action": "待用户真机验收便携 exe 在线自更新端到端；updater 矩阵 8 行 EARS 提案待矩阵域（工作区 .zcode）录入；proposed_default 清单（见验证记录 README）待拍板。",
  "allowed_paths": ["desktop/src/desktop-updates.ts", "desktop/src/update-adapter.ts", "desktop/src/main.ts", "desktop/src/portable-updater.ts", "desktop/resources/update-replace.cmd", "desktop/test/portable-updater*.test.ts", "desktop/scripts/release-desktop.mjs", "docs/work-items/tasks/PORT-UPD-01.md", "docs/verification/2026-10/PORT-UPD-01/**", "docs/status.md"],
  "depends_on": ["PACK-04", "PACK-05"],
  "docs_impact": { "update": [], "reason": "行为实现于主进程适配器层与发布脚本，不改对外 API/用户文档；desktop/resources/update-replace.cmd 按运行时渲染方案未创建（asar 内 .cmd 无法 spawn 且 electron-builder.yml 不在本任务 allowed_paths，见验证记录 README 偏差登记）。" },
  "verification_refs": ["docs/verification/2026-10/PORT-UPD-01/README.md"], "integration_ref": null, "acceptance_ref": null
}
```

用户拍板（oracle 来源）：「采用推荐的 exe 便携版方案即可」（2026-10-11）；语境＝v1.3.0 起仅提供便携版，内置更新是核心承诺（「从 v1.3.0 之后，就都可以直接通过软件内置的版本更新功能推送新版本和自动完成下载更新并保留数据」）。背景事实：electron-updater 官方不支持 portable target 自更新。

实现落点：`desktop/src/portable-updater.ts`（新建，纯逻辑＋可注入适配器）、`desktop/src/main.ts`（更新绑定段：便携分支＋数据目录回填＋启动清理，仅更新相关行）、`desktop/scripts/release-desktop.mjs`（latest.yml 便携条目＋migrate-v127.zip）。测试：`desktop/test/portable-updater.test.ts`（23）＋`portable-updater-smoke.test.ts`（3，真实 spawn 替换/回滚/超时）＋`portable-updater-release.test.ts`（6，lib 解析器＋server zip 读取器双独立 oracle）。
