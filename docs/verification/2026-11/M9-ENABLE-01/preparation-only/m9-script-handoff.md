# M9 真实生产包验收脚本交接

文件：m9-packaged-acceptance.cjs（缓存脚本，不修改仓库）。2026-11-18 只做 node --check，字面退出码0；尚未运行或启动产品。

调用格式（由主任务填入本轮动态路径与实际哈希；此处不是已执行命令）：

node <本缓存目录>\m9-packaged-acceptance.cjs --package <本轮ZIP新解压根目录> --repo <最终提交的主仓库绝对路径> --evidence <新建的仓库外证据绝对目录> --source-sha <完整最终commit> --exe-sha <app中exe的SHA256> --asar-sha <app/resources/app.asar的SHA256> --code <样例行情内六位代码> --start-date <有效交易日YYYY-MM-DD>

请用结构化process参数或PowerShell变量数组传参，路径有空格时逐项传递。若需CLI帮助，脚本缺参会在启动之前明确报错，不会猜动态包路径。

## 执行前要求

- ZIP须含Start-Acceptance.cmd/.ps1、完整app/和sample-market/。fresh extraction不得已有.acceptance-data。
- repo HEAD须恰等于--source-sha；exe与asar实际哈希须恰等于传入值。由主任务独立确认这些哈希来自同一最终提交的构建清单，脚本本身不能从二进制反推出源码commit。
- 样例行情路径应为vipdoc/<sh|sz|bj>/lday/<market><code>.day；指定日期至少有20根前置K线和10根后续K线。失败会在产品启动前停止。
- 使用repo既有@playwright/test的Electron驱动；已确认主仓库存在该模块，npx可用。没有另装依赖。
- --evidence须在仓库外，脚本和证据可留在Codex headroom-cache；所有新数据/profile/home/temp都属于本次解压的.acceptance-data。

## 自动步骤

1. actual packaged exe通过仓库既有packaged.mjs同款electron.launch可见启动；完整清理继承的TRAINER/portable/Node/dev/TDX/端口环境，固定port.txt并复用。读取真实Electron app paths/可见窗口、state/health的runId和pid，断言exe、DB、profile、AppData、home与端口全部隔离。
2. 实际设置DOM选择内置MA_BULL_MAIN，断言默认关闭、名称/源码不可写、不可删除；真实勾选/保存开与关，每次GET只读核对enabled。
3. 经DOM新建main/sub两公式、校验、用样例行情预览、保存；启动经典训练，显式处理旧行情确认弹窗，等待自动录制ready。
4. 真实关闭/启用副图公式，断言持久enabled与实际canvas窗格增减，切周/日；截图交主任务人工检查。生产包缺少journey hook，本脚本没有调用或注入任何图表hook。
5. 真买入、推进三日、界面导出真实gzip录像，解压检查事件/检查点/缺口；显式走结束训练和结算两个dialog，保留录像。
6. 从本机录像库真实打开、逐日/播放回放并截图；经退出dialog保存退出、原生关窗口、等待exit0和端口不可达。
7. 同DB/profile/port再启动，断言新runId、同recordingNamespace、同公式id与启用态、同录像条目；真实再回放后退出。

每步写acceptance-result.json、真实DOM文本/截图与两次trace。发生未知原生dialog时记录、dismiss以防挂死，并把本轮判失败；不是auto-accept。所有产品状态变更通过用户DOM，GET只用于核对。App.evaluate仅读取Electron身份/窗口或原生close窗口，没有写训练/公式/录像或图表。

## 必须保留的限制与风险

- 目前只语法检查通过，根执行是首次真实验收。若失败先保留完整trace/receipt/screenshot，校对准备或选择器后另开新的解压与证据目录；不要删掉初次失败或将局部重跑拼成全套成功。
- 生产图表只提供canvas，窗格增减不能自动证明曲线数值/文字可读；主任务需观察真实窗口和截图，至少检查main/sub、日/周、关/开、回放和重启后的场景。
- 脚本走Playwright直接启动真实exe，隔离与现有包装同源，但不能充当CMD包装入口证据。若要验证CMD，另用独立新解压和缓存改造的zip-smoke收据路径执行，避免写十月历史目录。
- UI源码在主任务并行更新，特别是enabled必须随保存payload到服务端。脚本对此严格断言，当前仅画checkbox而未持久化会失败。不得改用API写入让验收通过。
- 未知原生文件选择器、更新/重启、安装向导及系统授权均不属于本脚本；若意外出现会失败交主任务处理。脚本不会点这些按钮。
- 录制app.gitCommit若已内嵌则严格比较最终commit；若为unknown，在收据中原样披露，二进制身份以外层独立构建清单和exe/asar哈希绑定，不冒充已内嵌源码身份。
- 如果准备的样例只有短历史/没有有效训练日期，脚本会早停；主任务应扩充非个人样例，而不是绕过表单或直接写DB。