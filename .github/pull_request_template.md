## 任务

Task: <TASK-ID>（维护者填写，链接任务卡；外部贡献可删除本行，由维护者合并前补充）

## 改动

描述解决的问题及修改后的行为；关联任务卡/Issue。

## 范围与风险

- 影响面：
- 兼容/迁移：
- 已知限制：

## 门禁结果

列出实际执行的命令、退出码与 CI run 链接；未运行的项目说明原因。

- [ ] `npm run docs:check`
- [ ] `npm run docs:status -- --check`
- [ ] `npm run build`
- [ ] `npm test`
- [ ] 其他（journey / verify:baseline / 视觉检查）

## 文档与兼容

说明需要同步的使用文档、数据迁移或已知限制；没有影响可注明。

## 检查清单

- [ ] 提交信息符合 Conventional Commits；维护者 task 分支带 `Task: <ID>`
- [ ] 无密钥、大文件、调试残留、被跟踪的 `.env`
- [ ] 行为变更补有效回归；未删断言/未加 skip/未放宽验收
- [ ] 界面改动附截图（真实页面、深浅主题）
- [ ] 合并后回填任务卡 `integration_ref` 与验证记录
