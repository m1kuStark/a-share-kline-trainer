# M2-DRAWING-01 画线持久化三缺陷修复（验证记录）

> 执行说明：worker 完成 RED→GREEN 实现后被 API 五小时限额中断（17:03，两 worker 同灭）；root 按续做模式接手收尾（审读实现→类型检查→e2e 回归→变异→本记录→提交）。实现与单元层 RED→GREEN 由 worker 完成，收据在其被中断前的运行中；root 复跑收据如下。

## 三缺陷修复口径（实现审读结论）

1. **撤销历史（DRAW-UNDO-PERSIST-ON-ADVANCE）**：feedData 仅在周期面重建（挂载/切周期）时 reset 撤销史；同周期普通推进保留历史，除权推进的旧撤销步由既有 rebasePriceBasis/adoptDrawings 统一再投影。
2. **自定义样式（DRAW-STYLES-PRESERVE-ON-RESTORE）**：restoreDrawings 逐条 `styles: item.styles ?? fallbackStyle`——保存值优先，configuredOverlayStyle/箭头语义色只兜底无样式旧数据；默认样式仅用于新建。
3. **录像全周期（DRAW-RECORDING-CAPTURE-ALL-PERIODS）**：captureState 经 mergePeriodDrawings（纯函数）合并——当前周期以图上序列化为权威（含最新编辑），他周期从 props.allDrawings 持久面原样并入；Training.vue 接线 :all-drawings。周期隔离仍属显示层（用户拍板口径不回退）。

## 收据（root 复跑）

| 项 | 命令 | 退出码 |
|---|---|---|
| 单元层 | vitest drawing-persistence-contract + recording-chart-capture | 0（12/12） |
| 类型 | npm run typecheck:web | 0 |
| e2e drawing-basis | journey（run-9772e74f 后修正再跑） | **0**（2/2） |
| e2e m3-round3 / m3-tools / recording / m3-feedback | journey 各自 | 0 / 0 / 0 / 0 |
| 变异：styles 回退旧实现 | vitest contract | 1（1 failed 击杀）→还原 0 |
| 变异：feedData 无条件 reset | 纸面推演 | 撤销史断言死（用例①） |

## 断言修订披露（一处，root 裁定）

drawing-basis「跨除权日后价位线跟随」用例尾部三行原断言"切周K 后仍可读到日线价位线"＝跨周期可见旧口径，与用户 2026-10-19 拍板「画线不跨周期可见，维持现状」冲突（同 E2E-SPEC-SYNC-01 隔离断言同批语义）。修订为：周K 视图 drawings 为空＋切回日K 恢复且值仍为除权后重锚价（比旧断言更强：锁定隔离与持久双向）。非为绿弱化——修订前该断言失败于产品正确行为。

## 遗留

- 无 needs_user_decision；无 proposed_default（三修复口径均有用户批复依据）。
- 桶A-①②④就此清零（E2E-BASELINE-01 分类账本同步）。
