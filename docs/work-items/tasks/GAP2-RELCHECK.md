# GAP2-RELCHECK 发布资产 manifest 与上传后双源核对

```json
{
  "id": "GAP2-RELCHECK",
  "title": "release 资产 manifest 产出＋上传后核对脚本（防误删类事故）",
  "owner": "integrator",
  "state": "review",
  "milestone": "REL",
  "summary": "复盘缺口 G2（用户 2026-10-19 拍板）：release:desktop 产出资产 manifest（文件名/大小/sha256）；新增发布后核对脚本——GitHub release 与镜像 feed 双源核对资产数量、SHA256SUMS 与实际资产一致、latest.yml version/文件名/size/sha512 一致、latest 指针指向预期；发布手册补「发布后核对」一节（含每轮发布后核验 latest 指针与各 release 状态）。零产品码改动（纪律适配预声明：不新增矩阵行为行，替代收据＝单测＋对现有 v1.3.0/v1.3.1 的实测核对输出）。",
  "next_action": "TDD 实现核对逻辑（fixture 单测）；对 GitHub v1.3.0/v1.3.1（公开只读，不带凭证打印）与镜像 feed 实测 7/7；构造缺资产场景验证 fail-closed 报红。",
  "allowed_paths": [
    "desktop/scripts/**",
    "desktop/test/**",
    "docs/release/**",
    "docs/verification/**",
    "docs/work-items/tasks/GAP2-RELCHECK.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/release/desktop-release-manual.md"
    ],
    "reason": "发布手册需新增发布后核对步骤，把人工上传最后一步的高风险工具化（v1.3.1 误删事故教训）。"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": "docs/复盘缺口修补-开发计划.md"
}
```

## 验收要点

- 对现有 latest=v1.3.0 与 prerelease=v1.3.1 双 release 实测核对：7 资产/7 资产全中。
- 缺资产/校验和不符/latest 指针错三类注入场景报红（fail-closed，不猜不放过）。
- 手册一节含命令与判读说明。
