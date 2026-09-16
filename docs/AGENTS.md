# 文档维护规则

适用docs子树，从[索引](README.md)进入任务相关主题。

- specs定义产品规则；实现说明放代码附近；work-items记录任务，verification记录事实；status是生成摘要。
- 改行为同步相关正文、测试与任务卡。无文档影响写理由；改入口更新最近README及反向链接。
- AGENTS只写约束，README负责路由；不用多个入口重复维护进度和测试数量。大文档按语义拆，字符数优先于行数。
- 验证记录含命令、退出码、提交或工作树指纹、环境、数据范围；失败和复跑保留。证据缺失填未记录，不补造用户验收。
- 历史正文、用户原话和数据不改结论；归档加适用范围与后继入口，有效规则必须出现在当前正文。
- 删除旧文档先确认规则迁移与引用处理；兼容页仅跳转。正式证据不按年龄自动删除。
- 完成编辑运行docs:check；改任务/阶段则docs:status，提交前docs:status -- --check。

细则：[更新协议](engineering/documentation.md)、[读取协议](engineering/reading.md)、[证据格式](verification/README.md)。
