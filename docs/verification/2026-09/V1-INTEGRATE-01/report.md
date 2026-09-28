# V1-INTEGRATE-01 组合候选验证报告

状态：**组合门禁运行中，待 GPT 一次限定复核**（reply_to=control-handoff-20260928-46）。分支 `task/V1-INTEGRATE-01`；base `3f8c61246d5c057743fc312b07ebdd704d23658a`；fast-forward 至 `52889a70b6bd3037339e3414adc47ccdad0d104f`（TRAIN 代码 `c0fa04c126…`、NOTE 代码 `6cbf7a6798…` 均为祖先；已验不含失败 SETUP 提交 `3875941ad2…`/`309e754e70…`）。

## 继承范围（不重实现）

base..52889a7 恰为 49 个变更文件（`inherited-paths.json`），覆盖已接受的两片行为：

- **NOTE-DETAIL-01**（只读成交详情，5/5 接受）：B→S 方向、hover 焦点穿透 Teleport、pin 后离屏仍显当前成交、深浅文本对比、离线回放后退清未来详情且零业务写；schemaVersion v1/v2/v3 读取兼容。
- **TRAIN-01**（训练规则快照，5/5 接受）：费用/T+1 默认 API 与局部弹层、创建冻结快照（数值驱动执行+支持域校验）、raw/forward 权息一致、推进短事务状态重查、legacy raw 只读保护、一次迁移标记防损坏重冻、录像 rules 接本局快照。

本片只做串行组合、完整候选门禁与集成 UI 复验；SETUP 严格排除。

## 组合验证计划

1. `npm run verify:candidate -- --base 3f8c61246d5c057743fc312b07ebdd704d23658a --task V1-INTEGRATE-01`（docs/impact/unit/types/build/snapshot/M2/Journey，Journey retries=0），TDX_ROOT 指向冻结样本 `tdx-20260916-d8339f32`（先核 6 文件 hash 对 snapshot.json，运行时做隔离副本）。
2. NOTE+TRAIN 共存 UI 语义检查：录制进行中打开/修改设置不卸载训练、A 局规则保持/新 B 局用新默认、B→S 交易详情准确、离线回放后退清未来详情、840/1440 深浅、pageerror。

## 门禁结果

（待运行——本节在门禁后由运行记录填充；门禁后不再修改本报告以外的受跟踪文件来宣称旧 proof 绑定新 HEAD。）

## 边界与预算

不声称完整 1.0、完整 M4/M5、DATA-03/04、两布尔之外的设置项或用户发布批准。新功能 V1-ACCEPTED-INTEGRATION 预算 3 单位：设计 1＋本次执行 1 已用，剩一次 GPT review；TRAIN/NOTE 历史 5/5 不变，不声称降本。
