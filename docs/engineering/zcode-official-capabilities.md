# Zcode官方资料与本机能力

2026-09-20实取官方页面并对照桌面3.12.3随附CLI0.16.5。当前工具应称Zcode随附CLI，不套用第三方同名GLM CLI文档。

## 模型与参数

[GLM-5.3-Flash官方说明](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash)确认原生图像/视频/文本/文件输入，1M上下文、最高128K输出，推荐reasoning_effort=max且thinking始终开启。项目仍固定GLM-5.3-Flash；当前输出预算32768与最高思考档分别控制，不因任务小而降低思考档。

[Zcode配置](https://zcode.z.ai/cn/docs/configuration)区分模型协议：OpenAI格式reasoning_effort、Anthropic兼容thinking/effort。Coding Plan内置上下文由服务端下发，本地更改可能被同步覆盖。因此模型原生1M已有官方依据，本次会话生效1M仍须另有运行证据，不能仅凭本地字段宣称。

## 本机CLI

实际解析器支持`--attach <path>`（可重复）、`--output-format stream-json`、`--resume`、`--continue`、`--browser-use headless --browser-executable <path>`。组合`--help`无模型调用验证退出0；帮助遗漏stream-json，但源码有逐事件输出及末尾摘要。路径文字本身不等于图片输入，使用明确附件或Read图像。

派发器已新增`--attach`，后续调用默认stream-json并保留最终摘要解析。真实短子进程回归证明附件参数和事件流后摘要可用，截图模型实测单独登记；浏览器参数尚未做GLM实际控制实测。[Browser Use](https://zcode.z.ai/cn/docs/browser-use)与[命令文档](https://zcode.z.ai/cn/docs/commands)用于后续有界验证，不能仅凭解析成功宣称可用。

## Hooks边界

[官方Hooks](https://zcode.z.ai/cn/docs/hooks)：配置在session启动时读取；异步hook不回写后续阻断结果；Stop作用于现有模型循环，不是唤醒外部Codex的接口。继续使用子进程退出登记完成＋原线程heartbeat续接，避免活跃轮次轮询。插件入口：[官方仓库](https://github.com/zai-org/zcode-plugins)。

资料快照及源码调查保存在全局缓存`zcode-official-research/`；现有文档与已安装版本可能不同，调用前核对实际解析器和有界实测。凭据不进入Prompt、截图、报告或Git。实际模型结果、工程自测、主代理复核和用户验收分别记录。
