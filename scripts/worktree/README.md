# 候选编排层（scripts/worktree）

集成候选的生命周期门禁：准备、验证、晋升、清理。CLI 入口为 [worktree.ts](../worktree.ts)（create/list/prepare/verify/promote/cleanup），业务流在 [workflow.ts](workflow.ts)，全程持集成锁。

## 分类与评审画像

[review-profile.ts](review-profile.ts) 从候选自身提交重算 base..head 变更集并分类：

- `docs-only`：全部为 docs/ 或根 README/CONTRIBUTING 下的普通（100644）Markdown 增删改；控制文档目录、AGENTS/CLAUDE 文件、代码路径一律 `full`。
- 工作树防线：skip-worktree/assume-unchanged 隐藏位，或变更路径父链存在符号链接/junction 时强制回 `full`；删除文件按提交树校验，不要求文件存在。
- 变更集指纹（sha256）写入证明，消费方重算比对，不信任证明内回显的画像或路径。

## 证据门禁

[evidence.ts](evidence.ts)：候选证明（.runs/candidate-proof.json）必须绑定精确 task/base/commit/tree 且全部检查通过；runManifest 必须存在并位于候选 .runs 内（realpath 解析，拒绝缺失、外部与 junction 重定向）。v2 证明另须 policyVersion、画像、指纹、visual 一致且 cleanBefore/cleanAfter 均为 true；v1 保留旧七项检查兼容。手动 UI 评审要求见 assertVisual。

## 验证 CLI

`npm run verify:candidate -- --base SHA --task ID`（[verify-candidate.ts](../verify-candidate.ts)）：docs-only 只跑 docs/impact/status，不触产品构建、TDX、服务器、M2、Journey；其余跑全量八项。检查结束后重算分类，画像或指纹与初始不一致即拒绝签发证明；仅当全部通过且工作树前后干净时写入候选证明。

## 测试

- [review-profile.test.ts](../../server/test/review-profile.test.ts)：分类边界、索引隐藏位、真实临时 junction 回归（平台不支持则跳过）、真实 CLI 的 docs-only 覆盖。
- [worktree-tools.test.ts](../../server/test/worktree-tools.test.ts)：生命周期与证明绑定、清单归属、干净承诺等门禁。
