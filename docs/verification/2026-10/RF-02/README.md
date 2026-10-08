# RF-02 验证记录：条件单挂单/撤单进录像

任务：`docs/work-items/tasks/RF-02.md`（base 9d5530a，分支 rf02-cond-recording，worktree D:\tmp\rf02）
oracle：用户报告原文（挂条件单操作未录像＝信息丢失）＋架构师拍板语义（回放可见、向后兼容、params 关键信息、触发成交不录）。

## 一、RED（先写失败测试亲证）

### 单测 `server/test/recording-order-actions.test.ts`（新建，8 例）

```
npx vitest run --config server/vitest.config.ts server/test/recording-order-actions.test.ts
EXIT=1（7 failed / 1 passed）
```

失败关键行（正确原因＝缺功能，非语法/环境错）：

- `AssertionError: expected [ 'training.create', …(21) ] to include 'training.order.create'`
- `expected [Function] to not throw an error but 'Error: 录制文件校验失败：events[2].action 不在动作白名单内（收到 "training.order.create"）' was thrown`
- `isBusinessAction: expected false to be true`
- `businessEvents: expected [] to deeply equal [ 'training.order.create', …(2) ]`
- 唯一通过例＝「旧文件（无任何条件单动作）校验不受白名单扩展影响」——该例为兼容性守卫，预期修复前后均绿。

### e2e `e2e/recording-orders.spec.ts`（新建，1 例）

```
TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/recording-orders.spec.ts --retries=0
EXIT=1
```

失败关键行（挂/撤 UI 交互全部成功后，导出录像中断言事件流为空——正是用户报告的信息丢失）：

```
Error: expect(received).toEqual(expected) // deep equality
- Array [ "started", "finished", "started", "finished" ]
+ Array []
```

## 二、GREEN（最小实现）

改动文件（+新增测试）：

| 文件 | 改动 |
|---|---|
| `web/src/recording/types.ts` | ACTIONS 白名单 +`training.order.create` +`training.order.cancel` |
| `web/src/recording/businessEvents.ts` | BUSINESS_ACTIONS 纳入两动作（业务口径） |
| `web/src/recording/replay.ts` | ACTION_LABELS 补「挂条件单/撤条件单」 |
| `web/src/recording/dailyReplay.ts` | BUSINESS_ACTION_LABELS 补两项＋orderLabel（result.order 优先，拒单回退 params） |
| `web/src/views/Training.vue` | placeOrder/cancelOrder 接 recording.begin/finish/rejected（同 training.trade 模式）＋orderRecordingView 摘要 |
| `server/test/recording-order-actions.test.ts` | 新建（白名单/录制/业务口径/紧凑兼容/旧文件/回放标签） |
| `e2e/recording-orders.spec.ts` | 新建（挂两笔→撤一笔→结算→导出核对→历史回放断言） |

action 命名与 params/result 结构：

- create：params=`{ side, orderType, triggerPrice, shares, reason? }`；result=`{ order: { id, side, orderType, triggerPrice, shares, expiresDate } }`
- cancel：params=`{ orderId }`；result 同上（服务端返回的已撤单 OrderView 子集）
- outcome：成功 accepted；失败 recording.rejected（ApiError<500→rejected，否则 unknown）

兼容性处理：白名单纯增量（旧 action 全保留），v1/v2 校验 ACTION_SET 均由 ACTIONS 派生自动扩展；compactCodec 事件原样透传零改动；compactValidation 复用 validation.assertEvent。旧文件回归由单测「旧文件校验不受白名单扩展影响」锁定（修复前后均绿）。

## 三、机器收据（命令＋退出码）

| # | 命令 | 结果 | 退出码 |
|---|---|---|---|
| 1 | `npx vitest run --config server/vitest.config.ts server/test/recording-order-actions.test.ts`（实现前） | 7 failed / 1 passed | 1 |
| 2 | `TDX_ROOT=… npm run journey -- e2e/recording-orders.spec.ts --retries=0`（实现前） | 1 failed（事件流空数组） | 1 |
| 3 | `npx vitest run --config server/vitest.config.ts server/test/recording-order-actions.test.ts`（实现后） | 8 passed | 0 |
| 4 | `npx vitest run --config server/vitest.config.ts server/test/recording-`（22 个 recording 测试文件） | 381 passed | 0 |
| 5 | `npm run build`（typecheck:web＋build:server＋build:web） | 通过 | 0 |
| 6 | `npm run build:journey` | 通过 | 0 |
| 7 | `TDX_ROOT=… npm run journey -- e2e/recording-orders.spec.ts --retries=0`（实现后） | 1 passed | 0 |
| 8 | `TDX_ROOT=… npm run journey -- e2e/order-panel.spec.ts --retries=0` | 1 passed | 0 |
| 9 | `TDX_ROOT=… npm run journey -- e2e/recording.spec.ts --retries=0` | 3 passed / 1 failed（存量） | 1 |
| 10 | base 9d5530a（git stash 后）`npm run build:journey`＋同命令复跑 #9 | 3 passed / 1 failed（同测试同断言） | 1 |

## 四、已知存量失败对照（#9/#10）

失败测试：`recording.spec.ts:57 默认录制交易拒单、周期和画线，暂停恢复后可导出并离线只读回放`，
断言点：`跳到最后一天`后 `__trainerChart.drawings().length` 期望 >0 收到 0（回放末日画线恢复）。
base 9d5530a（本任务改动全部 stash 后重建）同测试同断言失败——**存量缺陷，非 RF-02 引入**（与派发简报预告一致）。修复后分支与 base 均 3 passed / 1 failed，无新增失败。

## 五、语义锁定抽检（P4 纸面变异）

| 变异（改回旧实现） | 杀手测试 | 结论 |
|---|---|---|
| 删除 types.ts ACTIONS 两项 | 单测「training.order.create 与 training.order.cancel 进入 ACTIONS 白名单」（toContain 失败）＋「含挂单/撤单事件的录制文件通过 v1 校验」（白名单拒绝）＋ e2e（导出/导入校验失败） | 杀死 |
| businessEvents 移除两动作（保留白名单） | 单测「businessEvents 保留完成的挂/撤与被拒挂单」（businessEvents 过滤为空）＋「挂单/撤单属于业务动作」＋e2e 业务列表 count 断言 | 杀死 |
| dailyReplay 删 orderLabel 分支（回落基础标签） | 单测「businessItems 含挂/撤条目」`toContain('买入')`/`toContain('12.50')` 失败（基础标签只有「挂条件单」） | 杀死 |
| Training.vue 摘掉录制接线 | e2e「条件单挂单与撤单被录制」（导出事件流空数组，同 RED 形态） | 杀死 |

断言值来源（独立 oracle）：ACTIONS 先例清单、用户报告原文、架构师拍板口径、e2e 中挂单触发价/方向来自运行时真实行情 API（非实现回读）。

## 六、范围与披露

- 触碰真实数据：无——e2e 走 journey 隔离服务与隔离库；样本 300857 只读行情。
- 触发成交不录事件＝用户拍板口径；侦查确认回放由持仓检查点呈现（既有机制），未见需扩 scope 的明确缺口（相邻风险见任务卡「相邻登记」）。
- `docs:check` 现存 ERROR：milestones/RF.md 引用 RF-04/RF-05（架构师预留槽，base 即有，非本任务产生；RF-02 引用已随本任务消解）。
