# Zcode官方资料与本机能力

2026-09-20实取官方页面并对照桌面3.12.3随附CLI0.16.9（9-19自动升级，前值0.16.5）。当前工具应称Zcode随附CLI，不套用第三方同名GLM CLI文档。

## 模型与参数

[GLM-5.3-Flash官方说明](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash)确认原生图像/视频/文本/文件输入，1M上下文、最高128K输出，推荐reasoning_effort=max且thinking始终开启（官方原文：`thinking.type`仅支持`enabled`，不支持关闭思考；推荐temperature 1、top_p 0.95）。2026-09-20配置核对结论：本机provider配置（providerId=bigmodel-api、modelId=GLM-5.3-Flash、reasoningLevel=max、contextWindow=1000000、输出预算32768≤128K）与官方要求逐项相符；官方推荐采样参数由Zcode会话层管理，runner不覆写。项目仍固定GLM-5.3-Flash；当前输出预算32768与最高思考档分别控制，不因任务小而降低思考档。

[Zcode配置](https://zcode.z.ai/cn/docs/configuration)区分模型协议：OpenAI格式reasoning_effort、Anthropic兼容thinking/effort。Coding Plan内置上下文由服务端下发，本地更改可能被同步覆盖。因此模型原生1M已有官方依据，本次会话生效1M仍须另有运行证据，不能仅凭本地字段宣称。

## 并发与限流（2026-09-20官方核对）

官方**未公布固定并发数**。[速率限制](https://docs.bigmodel.cn/cn/api/rate-limit)：速率（并发数）限制与套餐等级相关、动态调整，原则Max>Pro>Lite，低峰动态提升；Coding Plan用户按订阅等级统一并发，暂不支持申请调整。[使用须知](https://docs.bigmodel.cn/cn/coding-plan/usage-notes)：套餐仅限订阅人专享，违规触发风控。唯一官方"并发规模"参考是[套餐概览](https://docs.bigmodel.cn/cn/coding-plan/overview)推荐同时开发项目数：Lite 1个、Pro 1–2个、Max 2个以上，并建议以Subagent等方式并发调用。

额度按**账号**计（每5小时积分＋每周积分），并发CLI实例共享同一池：Lite 2000/5小时+10000/周、Pro 12000+60000、Max 28000+140000；低峰按基础积分50%抵扣，高峰=工作日14:00–18:00（UTC+8）。错误码（[FAQ](https://docs.bigmodel.cn/cn/faq/api-code)）：1302即HTTP 429账户限流（官方建议降并发、加排队与重试）、1305平台过载、1313公平使用限流、1308/1310等为5小时/周额度上限。ZCode官方文档（usage-stats/configuration/welcome/automations）均无并发上限表述；automations的"每账号20定时任务"与本CLI并发无关。

落地口径：工具`--parallelism`硬上限4；实践2～3路稳定，重现429/1302则有限退避并下调并发，不反复轰击；长批次优先错开高峰，同额度可折半消耗。

## 本机CLI

实际解析器支持`--attach <path>`（可重复，仅图片/视频后缀）、`--output-format stream-json`、`--resume`、`--continue`、`--browser-use headless --browser-executable <path>`、`--mode`（0.16.9起，对--prompt默认yolo）、`--disallowed-tools`、`--target`。组合`--help`无模型调用验证退出0；帮助遗漏stream-json，但源码有逐事件输出及末尾摘要。路径文字本身不等于图片输入，使用明确附件或Read图像。

派发器已新增`--attach`，后续调用默认stream-json并保留最终摘要解析。真实短子进程回归证明附件参数和事件流后摘要可用，截图模型实测单独登记；浏览器参数尚未做GLM实际控制实测。[Browser Use](https://zcode.z.ai/cn/docs/browser-use)与[命令文档](https://zcode.z.ai/cn/docs/commands)用于后续有界验证，不能仅凭解析成功宣称可用。

## Hooks边界

[官方Hooks](https://zcode.z.ai/cn/docs/hooks)：配置在session启动时读取；异步hook不回写后续阻断结果；Stop作用于现有模型循环，不是唤醒外部Codex的接口。继续使用子进程退出登记完成＋原线程heartbeat续接，避免活跃轮次轮询。插件入口：[官方仓库](https://github.com/zai-org/zcode-plugins)。

资料快照及源码调查保存在全局缓存`zcode-official-research/`；现有文档与已安装版本可能不同，调用前核对实际解析器和有界实测。凭据不进入Prompt、截图、报告或Git。实际模型结果、工程自测、主代理复核和用户验收分别记录。
