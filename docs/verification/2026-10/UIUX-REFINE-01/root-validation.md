# 主代理界面与候选身份验收

2026-10-17，root 独立操作与审查。源码基线 `6d557a12f400ce45b50418b8556f943d39fef754`；最终九个产品文件摘要 `f0dd15e269f7e3ac88358c36d8f055ae36e08856c0d7d6f77d312991f6d221f2`。本轮全部使用独立 SQLite、浏览器上下文和只读 TDX 冻结样本，未使用个人训练库。

## 运行身份

最终浏览器预览为 `http://127.0.0.1:9238/`，manifest=`.runs/run-7848f005-d069-431d-93e3-178252adda2d/manifest.json`。`output/verify-uiux-identity-final.mjs` 原生0，四份 HTTP 资源、预览构建、web/dist 与 asar 逐字节一致，详见 [身份收据](candidate-identity-final.json)。产品源码此后未变；最后修改仅测试与报告。

最终 NSIS 包：`output/uiux-package-final/desktop/release/kline-trainer-desktop-setup-v1.3.0-windows-x64.exe`，117241530 bytes，SHA256=`00e742f1fb9c13ed844cd797ad2823c26ee3187a18271ff82e82c185a75d2b39`。版本号沿用仓库1.3.0，不能据此与公开包混同。包内真实 node_modules，无 junction。`npm run release:desktop` 原生0，publish never。

未运行安装器、未覆盖用户安装。通过隔离 unpacked Electron + CDP 检查实际渲染；进程以 Hidden 启动，因此不能称为人工操纵可见原生窗口。实际外框1024×680，内容1008×641、DPR1、scale1。深浅主题买卖按钮bottom426≤console430，中心命中；两主题真实买入POST200。JS/CSS哈希与最终包一致，[包内运行收据](packaged-runtime-final.json)。所测流程pageerrors为空；既有退出生命周期HOST_MISMATCH403保留，退出流程未认证。

## root 实际交互与构图

使用外部 Edge、Playwright CLI 的鼠标/键盘与真实 API；不能用子代理截图代替本节。最终图片在 `output/playwright/uiux-final-*`，root已逐张查看创建、训练深浅、历史、排行深浅、成绩单、录像库、125%文字与长错误。

| 路径 | 观察与收据 |
|---|---|
| 创建→训练 | 实际创建300857/2026-04-15，确认过期数据提示；并列规则/标的，底部开始区稳定。旧宽屏及经典/随机检查见W1，新实际最小窗口见最终截图。 |
| 连续推进与交易 | `output/root-final-training.log`：浅色推进4/17、4/20、4/21，深色4/22、4/23、4/24；两主题真实买卖均POST200。固定推进box始终x749/y33.5/w99/h26，交易按钮无遮挡。 |
| 放大文字与设置错误 | `output/root-final-settings-r2.log`：125%字体token两主题console实际360/329，wheel使scrollTop0→31。注入PUT500长错误：首字top553≥容器552，末字bottom597.56≤600，scroll29；保存box保持691/557/172/38。 |
| 结算→历史→报告 | 实际结算保留录像，历史Enter打开真实5笔交易报告；导出录像成功。`output/root-final-records-r2.log`。 |
| 排行/录像 | 深浅主题巡检；真实导出bundle、确认删除本地录像、刷新仍0条。字体CDP实际Microsoft YaHei Bold。非空排行大数值压力由新journey负责，真实预览排行截图为空态，不冒充该压力场景。 |

构图判断：图表在紧凑窗口仍为主区域；账户、交易、工具顺序清楚；创建操作固定，设置保存不被正文推走；历史行按事实与动作分组。审美、动效节奏和使用偏好仍待用户体验，不从这些观察推断用户满意。

## 保留的失败与边界

- `root-final-ui.log` 首次连续点击未等待ready而超时；新脚本按真实就绪推进后通过。`root-final-settings.log` 首次在6px入场尚未结束时测量，r2等待有限动画settle。`root-final-records.log` 使用过期“返回首页”选择器，新快照确认“完成，返回首页”后r2成功。三者均为验收准备问题，原日志保留。
- unpacked首个脚本使用无baseURL的相对请求导致InvalidURL，改绝对URL后原生0，首次日志保留。
- 尝试清理旧打包staging被自动审批拒绝，未执行；改用新目录成功，旧产物留存，未继续删除。
- 125%/200%表示字体token压力，不是Windows DPI或浏览器缩放；未测屏幕阅读器、真实触屏、多浏览器或全WCAG符合。200%排行仅测试该表格，导航全应用200%可用性不在通过声明中。
- 用户安装升级/卸载、真实原生窗口操作、退出HOST_MISMATCH及全量既有失败仍未验收，不作为发布通过证据。

## 排行压力测量修正

`run-2bdcae9c` 12项中11过/1败，native1。失败发生在无剩余左行程重复大幅wheel后，trace入口变about:blank；保留原收据，按剩余行程滚动并校验URL。同期独立审查修正winRate=.5678与1234总交易数的不可能组合为67/118，显示仍56.78%。

`run-3cdd152c` native1：125%表scrollWidth890/client877，真实wheel13和120均无位移。root独立CLI `diagnose-ranking-wheel-r2.log` 测得outerWidth892、stable gutter15，内容实际放得下；200%scrollWidth1303时wheel13→13、120→133。分支改为实际可见盒宽，保留200双溢出、真实wheel、末列及默认/125逐格完整可见要求。

`run-e3957b30` native1：200%末th ratio0.996715。独立CLI `diagnose-ranking-wheel-r3.log`：最大scroll411、table.right996、cell.right996.46875，文字right986.46875完整可见。仅给整盒边界0.5 CSSpx舍入容差，文字四边严格内含，保留中心命中；不是允许文字裁切。

`run-ffff36ef` native1：新增纵滚前提错误地假设rankings-page是滚动owner。`output/read-ranking-scroll.log` 实测该元素sh=ch869，document根sh907/ch680/top100；改为实际document.scrollingElement，并继续以真实wheel、剩余行程和最终表格上下界验证。上述修正均未改变产品样式，不把夹具或测量失败冒充产品RED。

最终 `run-8dbfff05-a57c-4b40-9601-eda844bea45b` 原生0，排行1项通过全部两尺寸×双主题×100/125/200固定文字档。测试SHA256=`d03b58e166a26e781f1525d1cc853066f8d8b7ab2d10086a8bff03f2bd312f94`。原其余11项在2bdcae9c通过；本轮没有再跑未变断言，组合收据不声称一次全套通过。
