# 用量与额度的数据来源

本看板没有本地价格表、token估算器或额度换算公式。任务活动每5秒读取本机；统计与额度独立查询，后台缓存60秒，隐藏页面停止轮询。手动刷新也遵守缓存间隔。

## 会话统计

通过Zcode CLI `app-server` 的 `session/usage` 获取原生累计计数。只提交登记任务且目录匹配的会话ID；同一会话只查询一次。新会话与续接在详情标明，历史登记未记录的模式显示未知。

CLI 0.16.9 的 `totalTokens/inputTokens` 使用输入基线去重口径，`cacheReadTokens/reasoningTokens` 也沿用CLI返回值。它们不是供应商逐请求账单，不能据此扣减套餐或累计多个续接任务。失败请求保留在官方会话统计中；缺失计数不填0。查询不发送模型请求，不创建或恢复会话；CLI启动可能执行自身存储初始化检查。

## 账户额度

- **当前委派通道**：使用明确配置的BigModel Coding Plan凭据，直接GET官方 `https://bigmodel.cn/api/monitor/usage/quota/limit`。显示返回的 `remaining/currentValue/usage/nextResetTime`；剩余值不通过减法补算。请求限15秒、拒绝重定向，不输出鉴权头或服务端错误正文。
- **桌面Token Plan/活动套餐**：Zcode Desktop的 `billing/balance` 依赖内部OAuth服务，当前CLI没有可外调的账户额度命令。看板只投影桌面日志里已经收到的官方余额响应，显示服务端套餐名称、原始单位和该条日志时间；不是主动远端查询。超过2分钟标过期，在Desktop查看套餐余额后会同步新快照。不解密凭据、不修改登录态。

2026-09-25现场确认，当前delegate的 `bigmodel-api` 模板是Coding Plan；桌面官方快照还返回独立的 `ZCode Weekend Build`。两者不能混为同一个余额池；当前实现没有替用户切换支付通道。账户额度可能被其他客户端共享，不代表单任务费用。

## 安装与故障

运行目录 `sources.json` 仅保存 `cliPath` 与 `delegateProviderFile` 两个本机路径，不存token/密码，不提交Git。CLI必须与其相邻的内置provider配置匹配。账户查询使用指定委派配置的凭据，升级或切换provider后需同步此路径；不接受页面传入任意URL或凭据。

CLI不可用、缺字段、超时或接口变化时，统计区显示错误而不阻断任务列表。额度请求失败保留上次数据并标过期；从未成功则显示不可用。快照只是最后观察值，尤其不能把页面刷新时间当作Desktop余额采样时间。

入口与派发用法见[README](README.md)。
