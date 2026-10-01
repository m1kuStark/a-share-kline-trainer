# V1.1.1 用户反馈修订验证

候选工作树：`wt/integration/v1`。本记录只描述工程自验，不代表用户验收或 GitHub 发布。

## 本轮范围

- 通达信目录选择绑定训练器前台窗口；选择期间锁定页面，退出先取消选择器；启动器不再扫描默认目录。
- 成绩单浮窗适配深浅主题，保留单一关闭出口，规则改为 Tag，移除独立画线清单。
- 训练收益率、上证指数、国证 2000 使用同一张共享 SVG 图，带日期轴、百分比轴、悬停提示和独立复选框。
- 文档将任务卡、zcode/GLM 作业、Git 候选和状态摘要收敛到外部 `.control/trainer-state.json` 的统一状态边界。

## 验证命令

| 命令 | 结果 |
|---|---|
| `npm run docs:status` | 通过，0 errors |
| `npm run docs:check` | 通过，0 errors；28 条既有长度警告 |
| `npm run docs:status -- --check` | 通过，0 errors |
| `git diff --check` | 通过 |
| 定向 Vitest（API、setup、history、equity、frontend、launcher） | 137/139 通过；2 项端口回退夹具受已有 127.0.0.1:8787 服务占用影响，已保留失败证据 |
| `npm run build` | 通过：web 类型检查、server 编译、Vite 生产构建 |
| `npm run journey -- e2e/report-feedback.spec.ts --retries=0` | 通过：1/1，覆盖深浅主题、桌面/390px、三条曲线切换和悬停日期 |

原生桥额外验证：`defaultDirectoryPicker()` 在 Windows 上成功启动目录选择器进程；调用 `cancelActiveDirectoryPicker()` 后返回 `status=cancelled`，不再出现 Windows Forms 程序集编译错误。

## 未决事项

- Windows 用户仍需手动验收目录选择器是否始终置于 Edge 前台、选择有效路径后的真实重启和退出流程。
- 当前工程验收和用户验收仍分开记录；`user=unknown`、`publish=unknown`，本轮不自动 push、tag 或发布 GitHub Release。
- 两项端口回退单测只能在 8787 无占用时补跑；它们不影响本轮目录选择、成绩单或生命周期测试结论。
