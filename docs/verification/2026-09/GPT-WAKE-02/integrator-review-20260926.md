# 2026-09-26 控制层验收与产品分支裁决

本轮依据实际代码、独立机器回归与合成反例，不把此前代理回复作为验收凭证。时间为北京时间2026-09-26凌晨。main基线`85d65518ceedd2fb2bb96f7ca56cc67d878e3aec`；DATA候选`d4aa4e874f4e8342eafccc871295dd14789bbd75`；TRAIN候选`73d3e871d62a161c25c903627d9fb0c866c9dcd2`。本轮不合并、不推送。

## 裁决

- GPT-WAKE-01/02：采纳现有实现与真实续接证明，但自动闭环验收需修正后再通过。CLI续接、独立验证及verify-only恢复确有产物；GUI探针仅证明一次消息可以进入打开的对话，不能证明任意时刻零冲突、正确对话定位、幂等回调或草稿保护。
- DATA-05：采纳已完成API/首页/离线日历作为后续基线，退回范围内修复，不合main。
- TRAIN-02：采纳服务端预览/创建实现作为后续基线，退回两项正确性修复；前端与新范围录像仍未交付，不合main。
- SETUP-01：在两候选收敛后接续；可先做不写共享文件的侦查，不能重复实现已有discover/inspect，不能抢写API/App/Launcher。

## GPT-WAKE 必修

1. **P1 重复事件重派、证据覆盖。** `run_codex.cmd_wake`未在调用前认领唯一batch。纯合成`_attempt`连续两次使用相同`--batch SAME-EVENT`，返回码均0，调用次数2；jobs文件被覆盖。同秒out_dir也可复用。重复完成通知或重启必须不产生第二次模型调用，保留原attempt证据；不确定结果不能盲重试。
2. **P1 会话身份未绑定。** 请求`pinned-thread`而`thread.started`返回`different-thread`，工具仍completed，并将sessionId与resumedFrom都改成后者。必须保留请求ID并校验返回ID，错误/缺失身份不能成功；控制器同时校验登记sessionId与配置的pinned会话。
3. **P1 GPT执行边界没有继承既有固定策略。** `controller_loop.py`注册仅哈希顶层GLM文件，未哈希`gpt.runner_entry/gpt.cli`，未拒绝candidate内的`gpt.home`。复用LoopFixture注册后改两个GPT文件，`_check_pins`仍接受。所有实际执行的GPT文件、CLI解析结果及控制目录应受同等校验。
4. **P2 显式CLI参数位置错误。** `build_gpt_argv`把`--cli`放在`wake`之后，真实parser返回SystemExit 2（unrecognized arguments）。移到顶层选项位置后同一参数可解析。补真实parser合同测试。
5. writer等待各次stderr累积、timeout清理后仍无确认即释放锁、输出句柄ResourceWarning需要定向回归。等待只由本机程序承担；GPT不参加状态轮询。文档不得把单次环境中的.git限制外推成所有任务必须danger-full-access，也不得把高缓存命中表述为已证明节省费用。

复核：controller相关108项通过；run_codex标准环境首跑12项中1项中文编码失败，显式`PYTHONUTF8=1/PYTHONIOENCODING=utf-8`后12项通过，仍有4条未关闭日志句柄ResourceWarning。上述幂等/会话身份/哈希固定/参数位置均另用零模型调用探针确认。临时演练progress与收据路径实际存在，状态verified，tested_commit=`fbed6e1b2ce017f2322bfe23c76a01b2f2e5cc22`；未再次调用GPT做付费自测。

## DATA-05 必修与接线缺口

1. **P2 定时GET与刷新poll竞争导致永久更新中。** `web/src/dataStatus.ts:56-58,85-91,132-136`共用checkSeq；ticker终态先返回使旧poll过期，ticker却不清dataPolling或执行onDataFinished。真实TS转译合成探针：state=unchanged、dataPolling=true、dataUpdating=true、outcomeSeq=0、scheduledPolls=0，下一ticker仍不解除。补真实异步乱序与隐藏/恢复回归，不能仅用源码正则。
2. **P2 Launcher仍使用旧needsUpdate。** 2026-09-26 15:00上海、cutoff09-24：freshness=current而needsUpdate=true；2026-09-24 15:00、cutoff09-23：freshness=stale而needsUpdate=false。允许保留兼容字段，但当前开始训练提示应接到freshness。明确授权本修复增加`web/src/views/Launcher.vue`及对应前端契约/e2e测试的有限范围。
3. **P2 原有来源可用性缺口仍待补齐。** 临时合成TDX夹具成功基线后移除sh/lday、保留vipdoc，状态仍source.available/current，真实scan却必失败；不是本diff新引入，但未满足来源不可读准确说明。使用有界廉价结构检查或明确当前可读性未知，不能每分钟全盘扫描。

独立回归6文件75项通过；另外3个无个人数据的合成探针复现以上风险。2027越界、unknown、unchanged仍stale、发布屏障均保留。本轮未对产品做全量Journey/最终视觉验收；先修上述缺陷，再跑候选门禁。此前390px有横向溢出，不能沿用早先“真实页面全部通过”的宽泛说法；需说明产品支持的最小宽度并验收指定宽度。

## TRAIN-02 必修与第二片

1. **P2 并发双创建。** `engine.ts:503-536`在async前检查running、落库前未重查。同一previewId两次Promise.allSettled均成功，running=2。异步读完后在同步提交边界重查，新旧创建路径都保持单活动训练，训练行和初始权益同事务；测试同token、新旧路径竞争和失败回滚。
2. **P2 权息快照指纹可过期。** `engine.ts:424-436`使用stat缓存权息（`adjustment-cache.ts:63`）。有效合成gbbq改rightsShares 0→1，保留size/mtime，派生m从1.1→1.2，重新preview指纹却不变、旧token创建成功。新预览/复核从捕获的权息字节派生事件及哈希；允许最小扩到tdx稳定读取适配与合成测试，不扩写全局复权规则。

独立回归：range/engine/preview66项，v1/v2录像校验90项，合计156项通过，另两项合成反例已复现。新RANGE录制被旧tier枚举拒绝，属第二片未完成，不是旧录像回归通过即可宣称兼容。完成上述后先冻结新范围元数据/录像版本的具体接受与拒绝规则，再接Launcher预览失效守卫、类型/区间标签、新范围录制导入回放。DATA修复占用Launcher时TRAIN不得并写；等DATA冻结提交后再集成。

## 后续执行约束

恢复原Zcode对话，先由GLM独立复现本报告再修复；报告可被证据推翻，不机械照抄结论。每个任务单一写者和独立提交，不amend他人历史、不自动main合并。桥修复不得顺带重开ORCH。

完成/需重新设计/重复两次同因失败才产生一次决策请求，包含event_id、task/attempt、commit、实测结果、未决问题、证据位置。不得把测试提示当用户取消产品任务，不得把Computer Use停止当作GLM进程终止。GPT发送本轮裁决后结束，不用sleep/GUI刷新等待。收到GPT答复后才继续依赖该裁决的步骤；原始会话与尝试预算持续保留。
