# DEP-SEC-MINIMATCH-01 集成复核

实施提交 `f493364bdefb2165f36cf4924cd983ab98842592`，正常 hooks 通过，独立 SSH 签名核验 exit0，交付工作树干净。随后吸收主线 `f4bbc6af283562c8d567918fb4a59f3f51d71ffe`（含PR50与PR51）；package/lock和消费者helper字节不变。最新CI须绑定后续PR的准确head，不能复用旧Dependabot PR43的绿灯。

独立五维审查 Critical/Important/Minor 均0，报告见 `review-dependency.md/json`。冻结result SHA256 `d687cdfe06f72631260b3f01033a2ac16915eb4668cf5c345016ba4dbd066472`；134项归档及128份可逆收据经独立逐项字节、大小与SHA核对。原始CRLF收据以raw.b64保存，解码后与缓存逐字节一致；没有放宽空白或密钥检查。一次冗余格式诊断超出既有hook maxBuffer，失败记录与后续正常hook均保留；超长重复诊断原件仅在外部缓存，result含指纹。

本地正式完整测试为server2654＋desktop369项、原生exit0，真实公式语料显式存在；另有干净安装、依赖树、20项版本与消费者API检查、生产构建、portable和显式NSIS x64构建，以及真实app.asar依赖的glob/静态资源/SQLite探针。NSIS首轮网络超时、探针准备错误及修正后的通过分别保留。这些证明未覆盖安装向导、完整UI启动和人工验收。

desktop-app整表存量10项planned没有被依赖维护冒充闭合；本任务不改这些oracle或产品行为。依赖版本暴露与攻击者可触发的产品路径分别判断，audit0不替代公告版本核验。

root单写ENG、任务索引、共享状态与生成status，并执行docs:check/status/impact和正常签名提交。远端告警仅在合入后刷新，当前记录不宣称已关闭。后继M9在同一源码候选上执行整批Journey、视觉和Windows包运行；PR43保持独立评审，不叠加其Electron/Vite升级。
