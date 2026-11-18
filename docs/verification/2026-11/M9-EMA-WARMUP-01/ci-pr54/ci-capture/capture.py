import concurrent.futures
import datetime
import hashlib
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path('C:/Users/Stark_Du666/.codex/headroom-cache/M9-EMA-WARMUP-01-ci')
ROOT.mkdir(parents=True, exist_ok=True)

def capture(name, args):
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    ended = datetime.datetime.now(datetime.timezone.utc).isoformat()
    stdout = ROOT / (name + '.stdout')
    stderr = ROOT / (name + '.stderr')
    stdout.write_bytes(result.stdout)
    stderr.write_bytes(result.stderr)
    receipt = dict(name=name, args=args, startedAt=started, endedAt=ended, nativeExitCode=result.returncode,
                   stdout=dict(path=str(stdout), bytes=len(result.stdout), sha256=hashlib.sha256(result.stdout).hexdigest()),
                   stderr=dict(path=str(stderr), bytes=len(result.stderr), sha256=hashlib.sha256(result.stderr).hexdigest()))
    (ROOT / (name + '.receipt.json')).write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
    return receipt

if __name__ == '__main__':
    if len(sys.argv) > 2:
        receipt = capture(sys.argv[1], sys.argv[2:])
        print(json.dumps(receipt, ensure_ascii=False))
        if receipt['nativeExitCode']:
            print(pathlib.Path(receipt['stderr']['path']).read_text(encoding='utf-8', errors='replace'))
        raise SystemExit(receipt['nativeExitCode'])
    tasks = [
        ('pr-initial', ['gh','pr','view','54','--repo','m1kuStark/a-share-kline-trainer','--json','number,url,headRefOid,baseRefName,state,isDraft,statusCheckRollup']),
        ('run-initial', ['gh','api','repos/m1kuStark/a-share-kline-trainer/actions/runs/44152821795']),
        ('required-initial', ['gh','pr','checks','54','--repo','m1kuStark/a-share-kline-trainer','--required','--json','name,state,bucket,workflow,link'])
    ]
    if sys.argv[1:] == ['--final']:
        tasks = [
            ('pr-final', ['gh','pr','view','54','--repo','m1kuStark/a-share-kline-trainer','--json','number,url,headRefOid,baseRefName,state,isDraft,statusCheckRollup']),
            ('run-final', ['gh','api','repos/m1kuStark/a-share-kline-trainer/actions/runs/44152821795']),
            ('required-final', ['gh','pr','checks','54','--repo','m1kuStark/a-share-kline-trainer','--required','--json','name,state,bucket,workflow,link']),
            ('jobs-final', ['gh','api','repos/m1kuStark/a-share-kline-trainer/actions/runs/44152821795/jobs?per_page=100']),
            ('run-logs-archive', ['gh','api','repos/m1kuStark/a-share-kline-trainer/actions/runs/44152821795/logs'])
        ]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for receipt in pool.map(lambda task: capture(*task), tasks):
            print(json.dumps(receipt,ensure_ascii=False))
            if receipt['nativeExitCode']:
                print(pathlib.Path(receipt['stderr']['path']).read_text(encoding='utf-8',errors='replace'))
