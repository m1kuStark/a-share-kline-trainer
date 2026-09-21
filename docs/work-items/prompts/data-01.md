# DATA-01

GLM5.3Flash，最高思考档，1M上下文。独立 worktree `trainer-worktrees/DATA-01`，分支 `task/DATA-01`，从当前主干提交基线开始。只修改任务卡允许的 `server/src/data/**`、`server/src/tdx/**`、`server/src/db.ts`、指定数据测试、`server/src/data/docs/publication.md` 和自己的任务卡；不改 `server/src/train/**`、web、全局 status、package 版本、个人数据库或 TDX 文件。不提交远端。

先读根 AGENTS、server AGENTS、数据模块索引、publication.md、DATA-01 卡片和现有刷新/catalog/adjustment/snapshot 测试。用失败回归复现真实边界再实现：

1. 目录刷新成功但权息刷新失败时，不能留下“目录已发布、权息未发布”的混合可见状态；失败必须保留上一份可用状态。
2. 目录/权息/文件状态应有同一批次或版本标识；读取方不能观察到半批数据。不要重建表或删除已有用户数据。
3. 看门狗超时后，迟到的异步扫描/提交不能覆盖新任务或把失败任务写成成功；新任务可以安全开始。优先实现取消令牌、代次检查或提交前状态屏障，不能仅在外层加 sleep。
4. 刷新失败、无来源、重复请求和已运行任务的 API 语义保持现有状态码与中文错误。

先写最小失败测试，确认失败，再改生产代码。保留已有断言与所有测试。测试使用临时 SQLite、合成 TDX 文件和独立任务，不读取真实行情。返回根因、改动、测试命令/退出码、未解决边界。不要把“本地定向测试通过”写成整版验收。完成后正常提交；若安全门禁拦截，停一次交给主代理，禁止 no-verify 或等价绕过。
