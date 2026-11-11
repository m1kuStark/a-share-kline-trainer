# ENG-GOV-03 验证记录

> 状态：本地/发布操作完成；PR 门禁待跑。基线 da87d14（main）。
> 交付：tag-release 脚本与测试、v1.3.4–v1.3.6 签名 tag、v1.3.6 GitHub pre-release、发布文档。

## 一、签名 tag（已推送）

| tag | tag 对象 | 指向提交 | package.json 版本 | 本地验签 |
|---|---|---|---|---|
| v1.3.4 | 4335e823a5e7e7310dc1638ffe8ff003b5b882f0 | 100f5c82e9c763f27e0fce4ecea38681873a6755 | 1.3.4 | Good signature（SSH ED25519） |
| v1.3.5 | 299bbadc12154845219d1ec125268f98d5f87dc1 | 3ef59febc97f0328859df129e9f917d0f42563ef | 1.3.5 | Good signature（SSH ED25519） |
| v1.3.6 | 95244804aa7f73fe97291c1670a7bf50a3efc7a5 | 527ab2962ec495191c029eb8897335e8d26d15eb | 1.3.6 | Good signature（SSH ED25519） |

全部为 annotated + SSH 签名 tag；远端 refs/tags 已核对。

## 二、GitHub pre-release v1.3.6

- URL：https://github.com/m1kuStark/a-share-kline-trainer/releases/tag/v1.3.6
- isPrerelease=true，name=v1.3.6 预览（周/月K 区间统计修正＋测试提速）。
- 资产与 SHA256：
  - kline-trainer-desktop-setup-v1.3.6-windows-x64.exe：sha256 0159168c962e718e27ced80101970f4140d711641413d6a37f3dad16cbc3faab
  - kline-trainer-desktop-setup-v1.3.6-windows-x64.exe.blockmap：sha256 4cde74bfb803edc867944e60cfb1ba4cfb8d7a52b68fccc08eec64e2361480d4
  - kline-trainer-v1.3.6-windows-x64.zip：sha256 dc00d7f4374e2bf1b3f9023775b4d64cb5295480b7087167f115734ade65301b
  - SHA256SUMS：sha256 0b6add1b09c34692a160b9c0a3b46474a661bb477e909c20cf5c49b8e8abc70d
- GitHub latest Release 仍为 v1.3.3（prerelease=false，published 2026-10-25）；稳定指针未移动。

## 三、tag-release 脚本与测试

| 检查 | 命令 | 结果 |
|---|---|---|
| 语法 | node --check scripts/release/tag-release.mjs | exit 0 |
| 纯函数单测 | npx vitest run --config server/vitest.config.ts server/test/release-tag.test.ts | 3/3 passed |
| 隔离 fixture dry-run | 临时 git main 仓库（version 9.9.9，跳过远端/CI 检查） | 打印计划、exit 0，未创建 tag |
| fixture 负向 | 隔离仓库已存在 v9.9.9 时 dry-run | 按预期拒绝（本地 tag 已存在） |

脚本默认 dry-run，必须 --execute 才创建 tag；校验 main/干净树/版本/CHANGELOG/CI/tag 冲突。

## 四、文档与门禁

| 检查 | 命令 | 结果 |
|---|---|---|
| 文档结构/任务卡 | npm run docs:check | 执行中 |
| 状态生成区 | npm run docs:status -- --check | 执行中 |
| 范围/文档影响 | npm run docs:impact -- --base da87d14 --task ENG-GOV-03 | 执行中 |
| PR 门禁 | docs / verify / pr-policy | 执行中 |

## 边界

- v1.3.4/v1.3.5 只有签名 tag，没有 GitHub Release；不回溯发布。
- pre-release 不移动稳定 latest；稳定发布仍需用户验收后按 release.md 执行。
- 用户验收未记录。