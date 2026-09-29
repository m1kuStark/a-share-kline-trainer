# CAND-04 集成门禁 npm test 失败复核（2026-09-29）

结论：**门禁失败为端口占用类环境冲突（非超时类，但同属并发环境根因），非本分支内容缺陷；失败用例与全量复跑中的抖动文件按既定串行口径全部复绿。** 未修改任何测试或产品代码。

## 门禁失败与复核（分支 wt/A/CAND-04，tip c10367b）

1. 门禁失败清单：release-launcher.test.ts「reuses a legacy state that predates the optional compatibility fields」——launcher.cjs:626 抛「端口 4045 已被其他程序占用」（启动器按合同不换端口、不杀进程）。该测试以固定端口拉起夹具服务，固定端口被并发进程占据即报错。
2. 端口现状实测：`netstat -ano | grep -E "TCP.*:4045\s"` 无匹配（exit 1）——4045 现已空闲，冲突为瞬时占用（门禁与本槽/其他负载并发时，固定端口夹具互撞）。
3. 串行复跑失败文件（`npx vitest run --config server/vitest.config.ts --no-file-parallelism server/test/release-launcher.test.ts`）：**1 passed (1) / 36 passed (36)，exit 0**（25s）——含原失败用例。
4. 同日全量复跑（`npm test`）：87 文件 2 failed/85 passed——review-profile.test.ts 与 worktree-tools.test.ts（并行负载超时类，与 CAND-02 轮记录同族）；串行复跑该两文件：**2 passed (2) / 44 passed (44)，exit 0**。runtime-isolation.test.ts 本轮通过（其为任务约定排除的基线已知失败，RUN-CANCEL-01 范围）。
5. 内容排除：`git diff 5bf4484..HEAD --name-only` 非docs 文件数为 0——CAND-04 线（CAND-01..04 累计）相对基线只改 docs，不可能引入测试失败。

## 定性

- 本轮新增的失败类别是**固定端口夹具的并发冲突**（4045），与此前记录的 5000ms 超时同根：门禁与本槽/其他负载在同一台机器并发执行时互相干扰。测试代码无法单方消除（端口来自被测合同行为），根治同前：门禁串行执行或与开发槽位错峰，属集成门禁基建裁决（超出本卡 allowed_paths）。
- 重跑门禁时若 4045 再被占用，确认无本分支残留进程后错峰重跑即可，不需回退本分支。

## 环境与指纹

- 分支 wt/A/CAND-04 tip c10367b；工作树干净；Node 24 / vitest 3.2.7 / win32-x64。
- 说明：CAND-02 分支上的同主题记录（docs/verification/2026-09/CAND-02-gate-flake/）提交于本分支分叉之后，不含于本分支，故本卡自建记录。
