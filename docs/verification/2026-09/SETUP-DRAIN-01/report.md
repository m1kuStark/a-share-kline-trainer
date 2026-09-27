# SETUP-DRAIN-01 控制层接受（2026-09-27）

结论：accept_with_followups。源提交d63ded2cf4cbce0c156ecd3369ff9aa3ffb3d4c5的F1/F2/F3已闭合，接入隔离候选8e7da052f557d0fda1e75b0a262dd9914c39e7a3；产品main未提升、未push。仅接受受保护排空/取消/关闭服务端行为，尚不是首次接入UI或真实重启闭环验收。

## 绑定与验证

- 控制审查event drain-review-20260927-36，裁决drain-accept-20260927-36；候选完整SHA与冻结五场景已登记同一FIRST-USE-PRODUCT预算。
- 独立定向5文件52/52通过（setup-drain、setup-control-api、setup-control-process、data-refresh、catalog-protection）。真实server子进程正常退出、ready清理与端口再绑的正例保留。
- F1原生refresh deferred交错：202但scan未完时prepared仍pending、shutdown拒绝；scan完成正例正式回归通过。F2实际0.0.0.0监听拒绝403，活动查询0、gate不变；127.0.0.1正例200。F3同步throw与返回rejection专用日志捕获，index现返回Promise；真实HTTP延迟onSend顺序已为onSend-end→response-finish→shutdown-called。
- Journey run-ab558f41-e490-4d5d-93d8-89d3760029f2：77 expected、1 flaky后重试通过、0 unexpected/skip，exit0。manifest记录提交前ca0ae3c且dirty，不能冒称原生记录d63ded2。控制层重新编译当前d63ded2的70个server JS/d.ts与该run保留产物逐字相等；web/e2e/package配置未变，完成修复代码与运行产物的补充绑定（source map路径相关字节除外）。
- 旧全unit1075/1075只绑定babb70b/ca0ae3c源码；本次受影响175项执行者日志与GPT52项覆盖新增改动，不称重新跑全量。M2继承ca0ae3c冻结样本24/24：本次不改api/refresh发布语义及engine，index/control组件为M2脚本未调用部分。

本机完整证据：`headroom-cache/drain-accept-20260927-36/`下targeted.log、build.log、journey-binding.json、probes/，以及原`resume-product-20260927-32/glm-repair-34/`和Journey artifacts。此前RED和probe夹具错误仍留存。集成代码与源提交的差异仅TRAIN-02历史基线文字；不重复跑同字节产品门禁。

## 非阻断事项

- SETUP-CONTROL-ATTEMPT-REPORT：closing时不同attempt也报202，但只关闭一次，无权限扩大。
- SETUP-CONTROL-HEADER-STRICTNESS：含逗号token与重复header拼接等值边界，无已证实凭据绕过。
- SETUP-DRAIN-REGRESSION-FIDELITY：正式sync-throw用例实际async、F1缺prepared pending直接断言、HTTP504标题仍测200；真实独立探针已补证，后续补入正式回归。
- JOURNEY-DRAWING-BASIS-FLAKY：本轮一次重试成功，保留首失败；无因果证据则不归咎本片也不宣称已修复。

多进程同库、复杂多标签退出/最后标签回收不是本片保证。连接提前断开后的close触发保持当前行为，尚无长稳证据；不以此扩大本次已冻结验收。后续完整首次接入与启动器接线仍需真实隔离UI/进程验证。
