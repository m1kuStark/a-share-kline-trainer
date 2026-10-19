# REL-MIGRATE-SCOPE-01 验证记录：migrate 资产期望集收窄（v1.3.0 专属）

> 任务：verify-release-assets 期望集推导——migrate-v127.zip 仅对 `--migrate-tags` 列表内 tag
> （缺省 `v1.3.0`）计入期望集；列表外 tag 的 Release 带该资产＝已知豁免的多余资产（输出注明
> 「v1.3.0 专属连带资产，非缺陷」，不按 asset-extra 报红）。依据：用户 2026-10-19 批复 3。
> worktree：`D:\tmp\wt-migrscope`（分支 task/REL-MIGRATE-SCOPE-01，基 main=337cbec）。

## 一、改动对照

| 文件 | 改动 |
|---|---|
| `desktop/scripts/verify-release-assets-lib.mjs` | 新增 `MIGRATE_ASSET_NAME`/`DEFAULT_MIGRATE_TAGS` 常量（导出）；`parseVerifyArgs` 新增 `--migrate-tags`（逗号分隔 tag 列表，每项须 vX.Y.Z，缺值/空项/非法项 throw，fail-closed），用法串更新；`verifyReleaseAssets` 新增 `migrateTags` 选项（缺省 `['v1.3.0']`，规整校验后取 Set 成员判定）；期望集段 migrate 由「硬含」改为「仅列表内 tag 计入」；多余资产环对 migrate＋非列表 tag 走已知豁免（计入 `summary.exemptedExtras`，期望集清单后输出注记行），其余多余资产仍 `asset-extra` 报红；校验和文件自身列出该资产时仍按自证计入期望（Release 自身声明优先） |
| `desktop/scripts/verify-release-assets.mjs` | 用法注释补 `[--migrate-tags v1.3.0,v1.3.1]`；启动时回显生效的 migrate 期望 tags（透传经 `...options` 自动携带） |
| `desktop/test/verify-release-assets.test.ts` | parseVerifyArgs 契约对象补 `migrateTags` 字段；新增 `--migrate-tags` 解析用例（缺省/覆盖/非法值）；新增「migrate 期望集收窄」describe（5 用例：v1.3.1 线上形态合法＝期望 6＋豁免注记／v1.3.1 未来形态（无资产无行）合法／`--migrate-tags` 覆盖生效（7/7）／覆盖杀手用例（列表内 tag 删 migrate 仍 asset-missing）／migrateTags 非法值 throw） |
| `docs/release/desktop-release-manual.md` | §三点五命令块补 `--migrate-tags` 项说明；新增「migrate-v127.zip 期望口径」小节（v1.3.0 专属／后续 v1.3.x 不连带资产与校验和行／v1.2.7 用户从 v1.3.0 release 获取／线上 v1.3.1 既有资产不删按豁免注明／流水线仍产 migrate 的上传侧操作注意）；§二产物表与 §三上传清单的 migrate 条目同步标注「仅 v1.3.0 连带」 |
| `docs/work-items/tasks/REL-MIGRATE-SCOPE-01.md` | state planned→review；next_action/verification_refs 收尾更新 |

零产品码改动（desktop/src、server、web 未触碰）。

## 二、TDD 收据（RED → GREEN）

- RED：`npx vitest run --config desktop/vitest.config.ts desktop/test/verify-release-assets.test.ts`
  → **exit 1，6 failed / 23 passed**。失败全部为新功能用例（`--migrate-tags` 解析缺参数支持、
  v1.3.1 期望 6 vs 实现 7、豁免注记行缺失、migrateTags 未校验被静默忽略）；既有 23 用例全绿
  （含「v1.3.0 删 migrate 仍 asset-missing」——该杀手用例在 RED 期即绿，锁定期望集硬含语义，
  GREEN 后继续绿证明列表接管了该语义）。
- GREEN：同命令 → **exit 0，29 passed (29)**。
- 全量：`npm run test:desktop` → **exit 0，32 files / 331 tests passed**。
- 变异抽检（P4 纸面推演）：
  - 杀手 1 `--migrate-tags override killer: deleting migrate from a listed tag stays asset-missing`——
    若实现无视 migrateTags 把 migrate 全局豁免（任何 tag 都不计期望），该用例死（无 asset-missing）。
  - 杀手 2 `v1.3.1 online shape ... legal: expected 6 + exempted extra with explicit note`——
    若回退旧实现（硬含期望集），expectedCount=7≠6 即死；若豁免不输出注记行，note 断言即死。
  - 杀手 3 `missing asset (migrate-v127.zip deleted from the release)`（既有用例）——若默认列表
    丢失 v1.3.0，v1.3.0 场景 migrate 不再期望、豁免吞掉缺陷，该用例死。

## 三、线上复跑（匿名只读，无凭证，未打印任何 token）

### v1.3.0（应仍 PASS，期望集含 migrate）

```
$ node desktop/scripts/verify-release-assets.mjs --tag v1.3.0 --expect-latest
[verify-release-assets] 匿名只读核对（GitHub API × 镜像 feed），不携带任何凭证
[verify-release-assets] mirror base = https://k-line-trainer-d9gbbg6il6bf8c320-1505768275.tcloudbaseapp.com/feed
[verify-release-assets] migrate 资产期望 tags = v1.3.0（列表外 tag 的 migrate-v127.zip 按「v1.3.0 专属连带资产」已知豁免处理，不判缺陷）
[verify-release-assets] repo=m1kuStark/a-share-kline-trainer tag=v1.3.0（--expect-latest）
[verify-release-assets] release: draft=false prerelease=false
[verify-release-assets] latest.yml: version=1.3.0 与 tag 一致
[verify-release-assets] SHA256SUMS-desktop.txt: 4 条校验和，逐条对表 Release 资产
[verify-release-assets] assets: 实际 7 / 期望 7（数量阈值 7）
[verify-release-assets]   ok       SHA256SUMS（103 B）
[verify-release-assets]   ok       SHA256SUMS-desktop.txt（403 B）
[verify-release-assets]   ok       kline-trainer-desktop-setup-v1.3.0-windows-x64.exe（117251283 B）
[verify-release-assets]   ok       kline-trainer-desktop-setup-v1.3.0-windows-x64.exe.blockmap（122386 B）
[verify-release-assets]   ok       kline-trainer-v1.3.0-windows-x64.zip（55649542 B）
[verify-release-assets]   ok       latest.yml（397 B）
[verify-release-assets]   ok       migrate-v127.zip（418801 B）
[verify-release-assets] latest 指针: /releases/latest -> v1.3.0（与 --expect-latest 一致）
[verify-release-assets] 镜像核对: latest.yml=1.3.0 manifest=v1.3.0，与期望 latest 一致
[verify-release-assets] PASS：核对全绿（资产 7/7，缺陷 0）
EXIT=0
```

### v1.3.1（应 PASS 且体现新口径：期望 6＋豁免注记）

```
$ node desktop/scripts/verify-release-assets.mjs --tag v1.3.1
[verify-release-assets] 匿名只读核对（GitHub API × 镜像 feed），不携带任何凭证
[verify-release-assets] mirror base = https://k-line-trainer-d9gbbg6il6bf8c320-1505768275.tcloudbaseapp.com/feed
[verify-release-assets] migrate 资产期望 tags = v1.3.0（列表外 tag 的 migrate-v127.zip 按「v1.3.0 专属连带资产」已知豁免处理，不判缺陷）
[verify-release-assets] repo=m1kuStark/a-share-kline-trainer tag=v1.3.1
[verify-release-assets] release: draft=false prerelease=true
[verify-release-assets] latest.yml: version=1.3.1 与 tag 一致
[verify-release-assets] SHA256SUMS-desktop.txt: 3 条校验和，逐条对表 Release 资产
[verify-release-assets] assets: 实际 7 / 期望 6（数量阈值 6）
[verify-release-assets]   ok       SHA256SUMS（103 B）
[verify-release-assets]   ok       SHA256SUMS-desktop.txt（320 B）
[verify-release-assets]   ok       kline-trainer-desktop-setup-v1.3.1-windows-x64.exe（117249767 B）
[verify-release-assets]   ok       kline-trainer-desktop-setup-v1.3.1-windows-x64.exe.blockmap（122331 B）
[verify-release-assets]   ok       kline-trainer-v1.3.1-windows-x64.zip（55649546 B）
[verify-release-assets]   ok       latest.yml（397 B）
[verify-release-assets]   豁免    migrate-v127.zip（v1.3.0 专属连带资产，非缺陷——不在 --migrate-tags v1.3.0 列表内的 tag，多余资产按已知豁免处理）
[verify-release-assets] 镜像核对: latest.yml=1.3.0 manifest=v1.3.0（未加 --expect-latest：信息报告，不判缺陷）
[verify-release-assets] PASS：核对全绿（资产 7/6，缺陷 0）
EXIT=0
```

线上形态与任务背景假设一致（v1.3.1 校验和 3 条、无 migrate 行；资产 7 个含 migrate），不再依赖
「期望集硬含 migrate」补齐——新口径下为合法状态（期望 6＋豁免多余 1）。

## 四、其他收据

- `npm run docs:check` → exit 1（20 errors），全部为存量（其他任务卡 state 非法枚举、
  UIUX-REFINE-01 验证 README 断链；均不在本次改动文件内，本次改动 0 新增）。按纪律登记不顺手修。
- 行为矩阵：verify-release-assets 非矩阵绑定模块（matrix/ 无引用），零产品码，不新增行为行
  （沿用 GAP2-RELCHECK 的纪律适配预声明口径：替代收据＝单测＋线上双版本实测）。

## 五、已知边界（proposed_default，待验收确认）

1. **校验和自证优先于列表**：若列表外 tag 的 `SHA256SUMS-desktop.txt` 自身仍列出 migrate 行，
   该资产按 Release 自身声明计入期望（非豁免）。用户批复未覆盖该组合；按「对表基准来自
   Release 自身声明」既有原则取此默认（该形态行在资产缺＝`checksums-ref-missing` 报红，fail-closed 不变）。
2. **流水线仍产 migrate 行**：`release:desktop` 仍把 migrate-v127.zip 写入产物并追加进
   SHA256SUMS-desktop.txt（release-desktop.mjs:271-287 既有行为，本次未动——超出任务卡范围）。
   手册口径节已写明上传侧处置（不上传 zip＋上传前删该行）；流水线自动剔除登记为后续任务。
