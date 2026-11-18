import datetime
import hashlib
import io
import json
import pathlib
import re
import zipfile

root = pathlib.Path('C:/Users/Stark_Du666/.codex/headroom-cache/M9-EMA-WARMUP-01-ci')
expected = 'a7df3f800a838746a2d4509cc3ca96e005bec121'
read = lambda name: json.loads((root / (name + '.stdout')).read_bytes())
pr, run, required, jobs = [read(name) for name in ['pr-final','run-final','required-final','jobs-final']]
assert pr['number'] == 54 and pr['headRefOid'] == expected
assert run['id'] == 44152821795 and run['head_sha'] == expected
assert run['name'] == 'Source checks' and run['status'] == 'completed' and run['conclusion'] == 'success'
assert {item['name'] for item in required} == {'docs','verify','pr-policy'}
assert all(item['state'] == 'SUCCESS' and item['bucket'] == 'pass' for item in required)
assert jobs['total_count'] == 3
assert {item['name'] for item in jobs['jobs']} == {'docs','verify','pr-policy'}
assert all(item['status'] == 'completed' and item['conclusion'] == 'success' and item['head_sha'] == expected for item in jobs['jobs'])

receipts = []
for path in sorted(root.glob('*.receipt.json')):
    receipt = json.loads(path.read_text(encoding='utf8'))
    for stream in ['stdout','stderr']:
        raw = pathlib.Path(receipt[stream]['path']).read_bytes()
        assert len(raw) == receipt[stream]['bytes']
        assert hashlib.sha256(raw).hexdigest() == receipt[stream]['sha256']
    receipts.append(receipt)

archive_raw = (root / 'run-logs-archive.stdout').read_bytes()
(root / 'run-logs.zip').write_bytes(archive_raw)
logs_root = root / 'logs'
logs_root.mkdir(exist_ok=True)
entries = []
with zipfile.ZipFile(io.BytesIO(archive_raw)) as archive:
    assert archive.testzip() is None
    for index, entry in enumerate(archive.infolist()):
        if entry.is_dir():
            continue
        raw = archive.read(entry)
        filename = f'{index:03d}-' + re.sub(r'[^A-Za-z0-9._-]', '_', entry.filename)
        local = logs_root / filename
        local.write_bytes(raw)
        entries.append(dict(archive_name=entry.filename, path=str(local), bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest()))

result = dict(
    verifiedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
    pr=54, repository='m1kuStark/a-share-kline-trainer', head=expected,
    runId=run['id'], runAttempt=run['run_attempt'], event=run['event'], workflow=run['name'],
    status=run['status'], conclusion=run['conclusion'], runStartedAt=run['run_started_at'], updatedAt=run['updated_at'],
    required=required,
    jobs=[dict(id=item['id'],name=item['name'],status=item['status'],conclusion=item['conclusion'],
               startedAt=item['started_at'],completedAt=item['completed_at'],steps=item['steps']) for item in jobs['jobs']],
    failedSteps=[dict(job=item['name'],step=step) for item in jobs['jobs'] for step in item['steps'] if step.get('conclusion') not in ['success','skipped',None]],
    rawReceipts=receipts,
    archive=dict(path=str(root/'run-logs.zip'),bytes=len(archive_raw),sha256=hashlib.sha256(archive_raw).hexdigest(),zipCrcValidated=True),
    logEntries=entries,
    operations='Read-only gh pr view/checks, gh api GET, gh run watch only; no pushes, merges or reruns.'
)
(root/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
(root/'evidence-inventory.json').write_text(json.dumps(dict(archive=result['archive'],logEntries=entries,rawReceipts=receipts),ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(dict(pr=result['pr'],head=expected,runId=run['id'],status=run['status'],conclusion=run['conclusion'],
                     required=[dict(name=item['name'],state=item['state']) for item in required],
                     jobs=[dict(name=item['name'],conclusion=item['conclusion'],completedAt=item['completed_at']) for item in jobs['jobs']],
                     receiptsVerified=len(receipts),archive=result['archive'],logEntries=len(entries),failedSteps=result['failedSteps']),ensure_ascii=False))
