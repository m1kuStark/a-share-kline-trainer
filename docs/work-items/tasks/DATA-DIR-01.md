# DATA-DIR-01 训练数据目录设置（V1.2.6）

```json
{
  "id": "DATA-DIR-01",
  "title": "训练数据目录设置：可自定义、默认安装目录（版本独立）",
  "owner": "integrator",
  "state": "closed",
  "milestone": "M5",
  "summary": "设置面板新增训练数据目录区块（查看当前生效目录/数据库文件、原生选目录、保存写回 trainer.config.json 的 dataDir，重启生效）；launcher 默认 dataDir 从用户主目录改为包根 data，便携包各版本训练数据相互独立；排行/历史/回放复盘读该目录数据库，自动跟随。",
  "next_action": "用户验收通过（随 V1.2.6 包，2026-10-02）；无后续动作。",
  "allowed_paths": [
    "server/src/**",
    "server/test/**",
    "web/src/**",
    "scripts/release/launcher.cjs",
    "e2e/**",
    "docs/verification/**",
    "docs/work-items/tasks/DATA-DIR-01.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "CHANGELOG.md",
      "docs/work-items/tasks/DATA-DIR-01.md"
    ],
    "reason": "默认数据目录变更与设置能力是产品口径变化：跨版本数据独立性、旧主目录数据的迁移提示必须在 CHANGELOG 与设置面板文案中一致。"
  },
  "verification_refs": [
    "docs/verification/2026-10/V1.2.6-data-dir/README.md"
  ],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 设计要点

- **设置存稳定位置**：与 TDX 路径设置（saved-choice.json 存 dataDir 内）不同，数据目录设置写启动器配置 trainer.config.json——被改的目录本身不能存自己的设置。launcher 经 TRAINER_CONFIG_PATH 注入配置文件路径（launch 与受控重启两条链路）；独立运行（无注入）GET 可读、PUT 409 结构化拒绝。
- **优先级不变**：env TRAINER_DATA_DIR/TRAINER_DB > config.dataDir > 默认（包根 data）。保存时合并保留 tdxRoot/port、清除 databasePath 显式覆盖（否则它优先于 dataDir 派生，设置不生效），原子写。
- **版本独立**：默认改为包根 data 后，便携包解压目录不同即数据不同；旧主目录数据保留原位，设置面板文案给出旧路径提示，用户可指回。
- **排行/回放复盘**：全部读 config.databasePath 的 SQLite，路径变化自动跟随，无代码改动；切换目录后仅能看到新目录中的历史训练（预期行为，面板已提示）。
