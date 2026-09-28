# SETUP-AUTH-01 受保护 setup 请求判定

```json
{
  "id": "SETUP-AUTH-01",
  "title": "SETUP-01 第三片：受保护 setup 请求判定",
  "owner": "integrator",
  "state": "review",
  "milestone": "M5",
  "summary": "control-guard.ts 纯函数 validateSetupRequest：Host 逐字、Origin 逐字＋Fetch Metadata same-origin 浏览器路径（不要求暴露令牌）、无 Origin 助手路径（非空 expectedToken＋controlToken 逐字）、混合身份令牌必须匹配；拒绝码 HOST_MISMATCH/ORIGIN_MISMATCH/FETCH_METADATA_MISMATCH/TOKEN_MISSING/TOKEN_INVALID/TOKEN_UNCONFIGURED（401/403 结构化）。测试 15/15，纯函数零环境/网络/文件读取，不打印令牌。",
  "next_action": "GPT 定向复核；后续切片（Fastify 接线、一次性令牌颁发、原生目录选择、原子保存、受控重启）按边界另片冻结。",
  "allowed_paths": [
    "server/src/setup/control-guard.ts",
    "server/test/setup-control-guard.test.ts",
    "docs/work-items/tasks/SETUP-AUTH-01.md"
  ],
  "depends_on": ["SETUP-CLUES-02"],
  "base_commit": "2ef9dd73645ee92e04465babaec40da7d4fab6c8",
  "docs_impact": {
    "reason": "SETUP-AUTH-01 冻结合同授权的三文件切片；纯判定模块，不接 Fastify/CORS/launcher/UI/配置保存。",
    "update": ["docs/work-items/tasks/SETUP-AUTH-01.md"]
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 冻结规则（SETUP-AUTH-01-contract.md）

1. Host 逐字等于 expectedHost，否则 403 HOST_MISMATCH。
2. 有 Origin：逐字等于 expectedOrigin（403 ORIGIN_MISMATCH）；secFetchSite 存在时必须 same-origin（403 FETCH_METADATA_MISMATCH）；满足即 browser，不要求暴露控制令牌。
3. 无 Origin：expectedToken 非空（401 TOKEN_UNCONFIGURED）、controlToken 非空（401 TOKEN_MISSING）、逐字相等（401 TOKEN_INVALID）；满足即 helper。
4. Origin 同时带令牌：令牌必须匹配（401 TOKEN_INVALID），防混合身份。
5. 纯函数：不读环境、不生成令牌、不记录路径/密钥；逐字（大小写敏感）比较。

## 门禁

- setup-control-guard 15/15（浏览器/助手成功、四类不匹配、缺失/错误/未配置令牌、混合身份、空值、大小写敏感）；相邻 SETUP 测试与既有门禁见 attempt-glm-coord-01/logs/。
