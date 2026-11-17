# 任务事实对账（2026-11-18，静态核对）

任务：[ENG-PLAN-01](../../../work-items/tasks/ENG-PLAN-01.md)。基线 `2c66477f0c4875ac3a100338fdbc42b4878dadd8`；逐卡完整提交及祖先检查见 [ancestry.json](ancestry.json)。下表中的“已集成”只证明对应提交为本基线祖先，并结合当前源码/历史收据确认能力存在，不证明当前候选动态通过或用户验收。

所有22张原任务卡的 `state`、`acceptance_ref` 原值保留；没有直接人工证据的项目仍为未记录。历史摘要与收据保留对应版本的语境，不把旧 `proposed_default` 列表直接派发为今天的新功能。

| 卡片 | 已集成提交 | 后继或当前依据 | 本轮结论及人工边界 |
|---|---|---|---|
| TRAIN-03 | `784a4d2` | `server/src/db.ts` 的clock_mode/current_phase迁移；`server/src/train/engine.ts`创建、推进阶段分支；[V4-01](../../../work-items/tasks/V4-01.md) | 时钟主体已有实现；planned标签保留，不重做。完整旧数据/录制/理由验收未记录 |
| ORDER-01 | `784a4d2`；`1e965e5`修订 | [V1.2.3反馈](../../2026-10/V1.2.3-feedback/README.md)；当前引擎条件单和占用校验 | 单挂单旧目标已被多挂单替代；确认后的撮合/录制残项另切，非从零实现 |
| TRAIN-FEE-01 | `3a91c4c` | [原验证](../TRAIN-FEE-01/README.md) | 已集成，单卡人工验收未记录 |
| SETUP-PASTE-01 | `dac4c95` | [原验证](../SETUP-PASTE-01/README.md) | 已集成，单卡人工验收未记录 |
| CHART-WEEKDAY-01 | `7affecb` | [原验证](../CHART-WEEKDAY-01/README.md) | 已集成；不以此证明随机遮蔽当前复验通过 |
| CHART-ZOOM-01 | `4a8f44e` | [原验证](../CHART-ZOOM-01/README.md) | 已集成，单卡人工验收未记录 |
| CHART-PAN-01 | `529105a` | [原验证](../CHART-PAN-01/README.md) | 已集成，单卡人工验收未记录 |
| UI-TOOLBAR-01 | `ae9f6b8` | [UI-TOOLBAR-02](../../../work-items/tasks/UI-TOOLBAR-02.md)、[UI-TOOLBAR-03](../../../work-items/tasks/UI-TOOLBAR-03.md) | 初版布局已有后继，不恢复旧尺寸/位置 |
| UI-TOOLBAR-02 | `0b369a7` | `599f40d`/PR#39；[V137用户验收](../V137-user-acceptance/README.md) | pin/resize已实现且2026-11-13获用户验收；不补造本卡其他范围的验收 |
| M7-01 | `825af65` | [RF-05](../../../work-items/tasks/RF-05.md)、[RF2-02-03](../../../work-items/tasks/RF2-02-03.md)、[M2-RANDOM-AXIS-01](../../2026-10/M2-RANDOM-AXIS-01/README.md) | 随机服务端已有实现；本卡完整人工覆盖未记录 |
| M7-02 | `cd06a71` | 同上；`web/src/views/Launcher.vue`/`Training.vue` | 随机入口与呈现已有实现，旧文案清单先对照后继；未动态复验 |
| PACK-01 | `cc6289f` | PACK-02..05、[现行桌面手册](../../../release/desktop-release-manual.md) | 不重做Electron选型；原型轮路径/版本不是当前默认oracle |
| PACK-02 | `5f74db0` | 当前`desktop/src/main.ts`、[RUNTIME-CANCEL-02](../../../work-items/tasks/RUNTIME-CANCEL-02.md) | 生命周期已有实现；清理基线缺陷独立修复，非重建整个桌面宿主 |
| PACK-03 | `091cf98` | [MIG-ONECLICK-01](../../../work-items/tasks/MIG-ONECLICK-01.md)、[MIG-ONECLICK-02](../../../work-items/tasks/MIG-ONECLICK-02.md)、[INSTALLER-UPGRADE-01](../../../work-items/tasks/INSTALLER-UPGRADE-01.md) | 数据兼容已有后继；自然升级和旧浏览器录像迁移按对应候选逐项验收 |
| PACK-04 | `65540f4` | [PORT-UPD-01](../../../work-items/tasks/PORT-UPD-01.md)及其后继修订 | 安装版/便携版更新链分别核验，不能沿用初版便携走NSIS假设 |
| PACK-05 | `ee6c162` | [现行桌面手册](../../../release/desktop-release-manual.md)、当前`desktop/scripts/release-desktop.mjs` | 打包流水线已有实现，旧“首个Release”不是今天的操作指令；本轮无打包/上传 |
| UPD-01 | `098c442` | UPD-02、PACK-04、PORT-UPD-01 | UI接线已有后继，不再待派发；实际更新以当前形态核验 |
| UPD-02 | `1844d36` | `web/src/components/TrainingSettings.vue`、PACK-04/PORT-UPD-01 | 设置页已有实现，不重做；本轮未执行真实换装 |
| UPD-BUSY-HEAL-01 | `3f68a32`合入（实现`0f7a4a9`） | [原验证](../../2026-10/UPD-BUSY-HEAL-01/README.md)；共享updater矩阵对应行已有test_ids/status=covered | “待root回填矩阵”已过时；[健康检查](../ENG-HEALTH-02/validation.md)仍有完整轮失败，隔离绿不冒充整轮绿 |
| UPD-NSIS-RETRY-01 | `ad97668`合入（实现`ea8441e`） | [原验证](../../2026-10/UPD-NSIS-RETRY-01/README.md)；共享updater矩阵对应行已有test_ids/status=covered | 矩阵无需重复回填；真机中断自愈仍未在本轮验证，不以合并标题证明全部场景验收 |
| E2E-SPEC-SYNC-01 | `7a19e81`合入（实现`32bef4e`） | [历史规格同步](../../2026-10/E2E-SPEC-SYNC-01/README.md) | 已有12项历史定向转绿记录；不用再次派发同批旧断言 |
| E2E-BASELINE-01 | `6533196`分类记录 | [20项逐例静态对账](e2e-static.md)、`215528a`/`6251f4b`后继修复 | 保留active；旧失败已有后继，但当前完整Journey/真实迁移未跑，不宣称当前零债 |

## 本轮没有验证的事项

- 所有产品功能的当前运行结果、全量单测、完整Journey、UI视觉及Windows包。
- PACK/UPD自然升级、真实中断恢复、旧浏览器IndexedDB录像迁移等真实场景。
- M7旧提案清单每个参数或文案是否已被用户接受。当前规则先查现行规格和直接批准记录，不能因旧列表仍在就要求重新拍板全部项目。
- 用户批准开发与三示例默认停用只见[本次批准记录](approval.md)，不扩展至上述人工验收或发布。
