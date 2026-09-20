# v0.3.0 发布与后续 CI 修正

2026-09-21，用户已接受M3/REC，授权便携版、桌面入口及GitHub发布。当前Windows包已交付并验证；GitHub的Linux检查暴露额外问题，REL-CI任务继续处理，未宣称远端全绿。

## 已验证交付

- 私有主干按精确候选推进至 `29fec35f3a17539a6aa1a04b7b09f4a30f00b10f`：764项单测、类型与构建、24项M2、72项Journey全部通过。见[candidate-proof.json](candidate-proof.json)。主代理实际深浅主题检查见[root-visual.json](root-visual.json)与visual目录。
- 公开源码：[m1kuStark/kline-trainer](https://github.com/m1kuStark/kline-trainer)，与私有历史隔离；公开提交 `4024a107fbd1eb97293b314d296d6e4e1095db80`、标签v0.3.0。Git直连失败，改用官方Git Database API上传，三个提交的SHA与本地逐一核对一致，无强推。
- [Windows发布包](https://github.com/m1kuStark/kline-trainer/releases/tag/v0.3.0)：内置Node24.15.0，54178552字节，SHA256 `33d4bbaaa1a1d7c5678c9015333e8bc1eeddf5a19321764364cedbb6dffad6f0`。已无认证下载并比对散列。
- 实际解压7080文件一致；中文/空格/方括号目录、仅系统PATH下Start/Stop、重复启动、真实只读TDX交易、T+1拒绝、重启SQLite保留、结算和外来端口拒绝通过。见[包核验](package-integrity.json)、[启动闭环](package-smoke.json)。
- 本机7529已切到便携版，原库11张表计数不变，SQLite完整性通过，旧浏览器origin保持。桌面新旧入口均指向新Start.cmd；快捷方式目标/图标/工作目录已核对，目标启动器复用原PID。组合式“启动快捷方式并检查”命令被自动审批拒绝，改为只读核对链接及直接验证已审查的目标启动器，未绕过检查。备份与回退说明留在安装目录，见[部署核验](local-deployment.json)。

## 保留的失败与待办

首次打包暴露pkg变量未传入拆分函数，已修复并重建；初次源候选因随后源码变化被正确拒绝promote，保留了当次全绿测试。最终候选再次完整通过。临时包测试脚本先后修复自身cmd引号和API响应取值错误后通过，不把这些脚本失败当作产品回归。

GitHub [Linux CI](https://github.com/m1kuStark/kline-trainer/actions/runs/35535978552)报告三项失败：TRAINER_DB测试硬编码Windows路径；并发Stop/Start中的launch被拒绝；1MiB随机gzip以1字节输入块读入超过30秒。Windows任务被矩阵fail-fast取消，并未独立报产品断言失败。原始日志保留在工程外缓存；REL-CI-LAUNCH、REL-CI-GZIP将按真实失败修复，不能删除Linux覆盖或放宽阈值来伪造通过。

修改如果涉及运行代码，应产生新的补丁版本和真实包回归，保留v0.3.0标签及资产；只修测试/CI时保留已发程序版本。M4/M5未启动。
