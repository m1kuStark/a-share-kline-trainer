# v0.3.1 发布验收

2026-09-21完成工程验收、桌面升级与公开发布。用户此前已接受M3/REC；本报告记录补丁工程验证，不代替用户对新版本的使用反馈。M4/M5未开始。

## 版本与结果

- 私有候选 `dbe6727c035f1f2f02e82bd3c4d62a5c5ad88ab0` 已promote：770项单测、类型/构建、24项M2、72项Journey通过，见[candidate-proof.json](candidate-proof.json)。
- 公开提交 `a3b6ff429f77f8d3480c35a2a11c683135f79d44`：[源码](https://github.com/m1kuStark/kline-trainer)、[v0.3.1发布](https://github.com/m1kuStark/kline-trainer/releases/tag/v0.3.1)。[双平台CI](release-patch-ci-passed.json)通过。生产依赖审计0项已知漏洞，该结论不含开发依赖。
- ZIP为54178817字节，SHA256 `8726e7efceca78caacd5d2d71f204f2e8f17085d1c960d1144a29c65cd773159`。实际解压7080文件一致，已无认证下载并核对散列，见[包核验](package-integrity.json)、[公开下载](release-patch-public-verification.json)。
- 使用内置Node、仅系统PATH，在中文/空格/方括号路径验证Start/Stop、重复和并发启停、真实只读TDX交易、T+1拒绝、结算、SQLite重启保留及外来端口拒绝，见[实际包检查](package-smoke.json)。
- 主代理实际完成训练、录像gzip导出、文件选择器导入、按日回放及周期切换；深浅主题已检查，控制台0错误、无水平溢出。见[视觉记录](root-visual.json)与visual目录。

## 修复与边界

启停共用生命周期锁，状态确认和复用不再抢在锁外。小块gzip输入以有界缓冲合并，读入和写出分别拥有字节副本，避免上游及原生解压器引用可变内存。原格式、预算、取消语义和30秒压力用例保留。

Windows的fork池曾发生IPC中断，原始worker退出原因未被日志证实；采用threads池并将cwd测试改为独立进程验证，保留所有断言和4worker。不能将执行器中断误报成业务失败。

首轮门禁发现任务卡未同步，Linux随后发现写出视图被复用，均修正后重跑。细节见[review.json](review.json)。GLM报告保留为自测材料，不替代主代理验收。

## 本机交付

桌面“Ｋ线训练器”和旧“阶段验收”入口均指向v0.3.1。已核对快捷方式属性并验证目标启动器复用；未声称自动执行Windows外壳点击。地址仍为`http://127.0.0.1:7529`，沿用原库，11张表计数不变、SQLite完整性正常，未清理浏览器录像。见[部署结果](local-deployment.json)。v0.3.0程序、标签、资产及升级前备份保留。

后续从当前私有主干继续。公开库保持独立历史与SOURCE-MANIFEST映射，禁止同步私有行情和验收历史。第三方解码表的授权现状按用户决定保留在声明中。
