# M5-DEFAULTS-01 组合候选验证报告

状态：**实现与定向验证完成，完整门禁按合同在本提交后一次运行**（reply_to=control-handoff-20260928-50）。分支 `codex/m5-training-defaults`，base `888778cfc7a4b69e4446012a26618b93a8b05b20`（V1 已接受切片）；工作树提交后干净，门禁结果写 `C:/Users/Stark_Du666/.codex/headroom-cache/m5-defaults-20260928-50/evidence/`（不在本树追加跟踪文件，保持 proof 绑定测试时 HEAD）。

## 交付范围（五 scope，一个写者整片）

1. **DEFAULTS-api-atomic**：`GET/PUT /api/settings/training` 四字段完整对象（feesEnabled/tPlusOne/initialCash/adjustMode）同一事务原子保存；旧两布尔 PUT 兼容（只更新旧两键，保留新默认）；部分对象/未知字段/非对象 400 零写；资金域 0.01..1,000,000,000 元至多两位小数；损坏键 GET 409 `TRAINING_DEFAULTS_UNREADABLE`，完整合法 PUT 修复；文件库重开持久；drain 503 保持；触发器中途失败全回滚。
2. **DEFAULTS-create-precedence**：显式合法值 > 持久默认 > 缺省内建（1,000,000/forward）；缺省仅 undefined，显式 null/错误类型 400；省略字段 BEGIN IMMEDIATE 提交边界解析（beforeCommit 验证等待期漂移）；初始权益＝最终资金；五档与 RANGE 共用提交段；写入既有列不改 rules_json schema。
3. **DEFAULTS-preview-races**：预览未给复权取当时默认并固化（响应 `adjustMode` 可解释）；提交省略复权遇边界默认漂移 409 `RANGE_PREVIEW_STALE` 零写；显式一致可创建；资金省略用边界最新默认。
4. **DEFAULTS-user-flow**：设置弹层四字段保存（损坏默认＝面板修复入口）；Launcher 装配默认初值、读取完成前禁用开始训练、失败可重试、迟到/重复响应按字段 dirty 不覆盖已编辑、设置保存只更新未编辑字段（提示"本次使用自定义值"）、实际复权变化使预览失效；录制不卸载。
5. **DEFAULTS-compatibility**：规则快照/一次迁移/损坏保护、T+1/费用/权息、TRAIN-02 预览、新旧录像与 NOTE 详情回归由全量单测与 Journey 继承覆盖。

## 先 RED 后实现

- `evidence/red-m5-defaults.log`（exit 1）：17 失败/16 过——四字段 GET/PUT、损坏 409、创建优先级、beforeCommit 边界、RANGE 预览/漂移 409 全部按预期失败。
- 过程修复两处测试自身缺陷（equity INSERT 用解析后值、触发器拦 INSERT 而非 UPDATE），记录于 `green-m5-server.log`。

## 定向验证（实现后）

- 服务端 GREEN：`green-m5-server-2.log` exit 0，33/33（settings 21＋creation-defaults 12）。
- 前端契约＋设置定向：`targeted-frontend.log` exit 0，58/58。
- e2e 三用例（真实隔离服务，retries=0）：`e2e-training-defaults-3.log` exit 0，3 passed/34.2s——完整用户流（A 显式 80万/raw→改默认 120万/forward→A 不变→B 新默认→C 显式 60万/raw）、保存失败/取消/键盘 Tab 环游/Esc 还焦点、迟到读取不覆盖已编辑、840 浅/1440 深、pageerror 0。前两轮失败已修复并披露：①`v-model` 在 number 输入上把 ref 变数字导致模板 `.trim()` TypeError 组件卸载（修复＝parse 先字符串化）；②断言字段名中英文不一致。

## 全量

全量 unit `m5-full-unit.log` exit 0 **1161/1161**（87 文件）。完整候选门禁（docs/impact/unit/types/build/snapshot/M2/Journey retries=0）在本提交后一次运行，proof 或失败原件见 evidence。

## 边界

不做 TDX 路径/重启、自动检查偏好、训练时钟、条件单、排行、DATA 版本系统；不声称 M5 整体完成。预算：设计 1＋本次执行＝2/5 已用，余初审 1/必要返修 1/末审 1；TRAIN/NOTE/V1 历史不动。
