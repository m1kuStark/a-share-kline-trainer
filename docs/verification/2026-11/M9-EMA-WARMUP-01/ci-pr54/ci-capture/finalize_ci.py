import hashlib
import json
import pathlib

root = pathlib.Path('C:/Users/Stark_Du666/.codex/headroom-cache/M9-EMA-WARMUP-01-ci')
result = json.loads((root/'result.json').read_text(encoding='utf8'))
result['testedMergeCommit'] = '893b1aa437a42a04d865311f0410f3647f64da13'
result['testedBaseCommit'] = 'df6cedd82fa3fe591615724259f83d16f6bb70fa'
result['tests'] = dict(server=dict(files=188,tests=2664),desktop=dict(files=34,tests=369),total=3033,singleNpmTestInvocation=True,retryObserved=False)
result['logInterpretation'] = 'No failed suites or Actions error markers. Download abort, SHA mismatch and fake-update-source 404 stderr are fault-injection cases whose suites passed; raw stack traces are retained.'
raw_aliases = []
for name in ['pr-initial','run-initial','required-initial','pr-final','run-final','required-final','jobs-final']:
    raw = (root/(name+'.stdout')).read_bytes()
    target = root/(name+'.raw.json')
    target.write_bytes(raw)
    raw_aliases.append(dict(path=str(target),bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest()))
result['rawJsonAliases'] = raw_aliases
(root/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
(root/'README.md').write_text('''# PR #54 Source checks 只读核验

结论：Source checks run `44152821795`、attempt 1 已 completed / success。required `docs`、`verify`、`pr-policy` 全部 SUCCESS，3 个 job 无失败步骤。

- PR head：`a7df3f800a838746a2d4509cc3ca96e005bec121`。
- CI 实际 checkout：`893b1aa437a42a04d865311f0410f3647f64da13`，即上述 head 与 base `df6cedd82fa3fe591615724259f83d16f6bb70fa` 的 GitHub PR 合并测试提交。
- 同次 CI npm test：server 188 文件 / 2664 测试，desktop 34 文件 / 369 测试，全过，共 3033。未发现失败套件、Actions error 标记或测试重试。
- 故障注入用例预期 stderr（下载中断、SHA 不匹配、假更新源 404）及堆栈保存在原始日志，没有误判为 CI 失败。

原始 JSON 字节见 `*.raw.json`，原始 GitHub logs ZIP 见 `run-logs.zip`；32 个原始日志条目解码至 `logs/`。9 份 CLI 收据、stdout/stderr 和所有条目哈希见 `result.json` / `evidence-inventory.json`。ZIP 原始 103033 字节，SHA256 `e1db95d32f43ec992ca74cc8bb330844629c2064b66e4889407532ca29e507ef`，CRC 检查通过。

仅执行 gh pr view/checks、gh api GET 与 gh run watch（60 秒间隔）；未 push、merge、重跑 CI 或修改仓库/control/矩阵。
''',encoding='utf8')
inventory=json.loads((root/'evidence-inventory.json').read_text(encoding='utf8'))
inventory['rawJsonAliases']=raw_aliases
(root/'evidence-inventory.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(dict(result=str(root/'result.json'),report=str(root/'README.md'),resultSha256=hashlib.sha256((root/'result.json').read_bytes()).hexdigest()),ensure_ascii=False))
