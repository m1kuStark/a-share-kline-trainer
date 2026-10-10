# MIG-01 验证记录：v1.2.7→v1.3.0 迁移工具

任务卡：[docs/work-items/tasks/MIG-01.md](../../../work-items/tasks/MIG-01.md)。工具源码：`tools/migrate-v127/`（构建方式见其 README）。
真实数据安全铁律执行情况：用户 v1.2.7 安装目录（`C:\Users\Stark_Du666\Desktop\kline-trainer-v1.2.7-windows-x64`）**零写入**；用户 `~/.a-share-kline-trainer` 训练库与 Edge 真实 IndexedDB **零触碰**。

## 零、门禁收据（2026-10-10）

| 命令 | 结果 |
|---|---|
| `node tools/migrate-v127/build.mjs` | exit 0（dist 129.8KB cjs＋91.5KB 兜底 txt＋cmd＋说明） |
| `npx vitest run --config server/vitest.config.ts server/test/migration-tool.test.ts` | exit 0，18/18 |
| `TDX_ROOT=… MIG_V127_PACKAGE=… npm run journey -- e2e/migration-v127.spec.ts --retries=0` | exit 0，1 passed (13.9s)，run-7155e58c |
| `npm run build:server` | exit 0 |
| `npm test`（server vitest ＋ desktop vitest 链） | exit 0（desktop 115/115） |
| `npm run docs:check` | exit 0（0 errors；先修 1 个验证记录相对链接层级错误） |
| `npm run docs:status` ＋ `workflow:state task --id MIG-01 --status review` | exit 0 |
| 复跑 `npx vitest run --config server/vitest.config.ts`（全量） | 间歇失败＝`server/test/review-profile.test.ts`（约 30s 超时类用例，隔离复跑 16/16 exit 0）——CI-01 已登记的存量 flaky，与本任务无关（本任务不触碰 worktree/junction 逻辑）；本任务测试文件在全量运行中全部通过 |

## 一、单测（server/test/migration-tool.test.ts，vitest）

覆盖四层共 18 例：compact 行重组与 `MemoryCompactStorage` 落库行深等＋六类损坏中文拒绝；旧 v1 转换链（与 v1.2.7 `loadLocalRecording` 同链、损坏返回原因不抛出）；micro-fake IndexedDB 三来源扫描（compact/legacy/imports、同 id compact 优先、损坏计入 failures、转换失败原样入包）；合并包契约（新版 `parseRecordingBundle` 接受、空库文案与 REC-BULK 一致、v1.2.7 语义录像通过 main 校验）；Node 侧纯函数（config 解析/状态身份/目录端口优先级/参数校验）。

## 二、工具 Node 侧行为冒烟（本机）

- 伪造包根＋合成 sqlite（含合法 namespace）＋状态文件：`/healthz` 200；`/` 返回页面且 `__V127_INFO__` 注入正确 namespace；`POST /pack-sqlite` 复制三件套到迁移导出文件夹；`POST /shutdown` 退出码 0。
- 停服门禁 fail-closed：对在跑的 8787 验收服务执行工具 → 拒绝退出（exit 2，提示「像是训练器，请先退出」）。**验收服务未受任何影响（只读探针）**。

## 三、v1.2.7 真实包实测链路（e2e/migration-v127.spec.ts，journey）

**最终绿收据：run-7155e58c-4d7c-45b5-9046-916a906c5d23（2026-10-10）——`1 passed (13.9s)`，journey 整体 exit 0。**
（过程性 RED：run-7a04ee07＝显式 --data-dir 被评分改写；run-a390a158/run-0fd11248＝journey 注入的 TRAINER_DB 等 env 泄漏进老包 spawn 使老库落到 journey 运行库、namespace 不可读——该两轮导出页以「发现模式」列出全部 4 场仍完成扫描；run-599fffe3＝fixture 检查点 afterSeq 晚于事件 seq 被导入校验如实拒绝；run-0436e6c6＝新导入录像需父列表刷新后才可回放。每轮修复见下。）

环境：`MIG_V127_PACKAGE`＝用户桌面真实 v1.2.7 zip 包；`TDX_ROOT`＝journey 样本源。老服务一律 `launcher.cjs --config <隔离 trainer.config.json>`（隔离端口 8917＋隔离临时数据目录）——**绝不用默认 `~/.a-share-kline-trainer` 起老服务**；spawn 前剥离 TRAINER_*/PORT/TDX_ROOT 等继承 env（journey 运行时会注入，老包 launcher 的 env 覆盖优先于 --config）。

链路：真实老包起服（约 1s ready）→ 旧 origin 页面按 v1.2.7 行形状播种（1 legacy v1＋2 compact＋1 imported）→ **旧应用自己的录像库显示 本机训练录像 (3)＋导入的分享录像 (1)**（种子格式经老版本自证）→ `launcher --stop`（v1.2.7 应急停止语义，会清状态文件）→ 迁移工具交付物 `export-v127.cjs --package-root <真实包> --data-dir <隔离目录> --port 8917` → 同源导出页（检测信息含库名/4 行清单）→ 下载合并包（文件名 `训练录像库-<yyyyMMddHHmm>.trainer-recordings.json`）→ 契约断言（format/version/items=4/sessionId 集合）→ 当前 main（模拟 v1.3.0）录像库「导入录制」选合并包 → **批量导入完成：成功 4** → 回放打开可见。

证据：`.runs/run-*/artifacts/screenshots/migration-v127-*.png`（旧应用录像库/导出页/新版回放三张）＋ journey.log。

### 实测中抓到并修复的缺陷（RED→GREEN，逐轮）

1. **显式 `--data-dir` 被候选评分改写**（run-7a04ee07）：`launcher --stop` 清掉隔离目录状态文件后，包根 `data/`（含用户真实状态文件，端口 8788）按 hasState 优先胜出，工具转向伺服 8788、测试在 8917 等待超时（RED）。该轮工具对用户真实数据只做了只读访问（状态文件读取＋sqlite 临时副本读 namespace），页面无人访问、零写入、无损害。修复：显式 `--data-dir` 权威采用（不评分、不受包根 trainer.config.json 影响）。纪律案例：显式参数被静默改写＝歧义静默决定，禁止。
2. **journey env 泄漏**（run-a390a158 / run-0fd11248）：journey 运行时给子进程注入 `TRAINER_DB` 等，老包 launcher 的 env 覆盖优先于 `--config`，老服务的库被静默指到 journey 运行库（一次性测试工件，非用户数据；数据目录只剩 server.log 是诊断线索）。修复：e2e spawn 前剥离 TRAINER_*/PORT/TDX_ROOT 等 env。意外收获：该两轮工具读不到 namespace 时，导出页**发现模式**（indexedDB.databases() 枚举）自动找到唯一录像库并完成全部扫描——兜底路径获得真实条件下的验证。
3. **fixture 自身非法**（run-599fffe3）：检查点 `afterSeq:2` 被 seq=1 事件引用＝「指向未来快照」，新版导入端逐条如实拒绝并给出精确原因（成功 1/失败 3）——同时实证了「转换失败原样入包→导入端计失败不静默丢弃」的契约链。修复 fixture 后 4/4。
4. **新导入录像回放需父列表刷新**（run-0436e6c6）：导入后直接点开回放不出现回放视图；与 recording-bulk 同口径「返回训练→重开录像库→回放」后正常。

## 四、语义锁定抽检（变异纸面推演）

1. 重组若无行数/counts 一致性检查 → 单测「缺行/多行/重复行/未知 kind/非法 id/坏 counts 均以中文错误拒绝」死亡（缺行用例）。
2. 扫描若静默丢弃损坏条目 → 单测「compact 行损坏计入 failures 而非静默丢弃；legacy 转换失败时原样入包并标记」死亡（items 长度断言）。
3. 端口解析若无状态文件优先级 → 单测「resolvePort：--port > 状态文件 > 显式配置 > 默认 8787」死亡。
4. 显式 --data-dir 被评分改写 → e2e 第一轮实测死亡（见上，已修复）。

## 五、遗留与边界

- 用户真实浏览器里的旧录像（Edge IndexedDB）未触碰，端到端复验留给用户按迁移说明执行；
- e2e 无 `MIG_V127_PACKAGE` 时 skip（`npx playwright test --list` 可见），CI 无老包环境不阻断；
- 老录像转换失败时原样入包 → 新版导入计为失败并逐条给出原因（不静默丢弃，契约附录已写明）。
