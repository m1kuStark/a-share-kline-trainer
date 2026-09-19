"""Bounded parallel GLM runner with exclusive worktrees and durable per-job status."""
import argparse
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time
from monitor import DEFAULT_HOME, atomic_write, read_result, redact


def release_locks(paths):
    for path in reversed(paths):
        path.unlink(missing_ok=True)


def acquire_locks(home, cwd, batch, parallelism):
    if not 1 <= parallelism <= 4:
        raise ValueError('parallelism must be 1..4')
    if (home / 'worker.lock').exists():
        raise FileExistsError('Legacy worker.lock exists; verify its owner before migration.')
    folder = home / 'locks'
    folder.mkdir(parents=True, exist_ok=True)
    locks = []
    owner = {'pid': os.getpid(), 'batch': batch, 'worktree': str(cwd.resolve()), 'startedAt': int(time.time() * 1000)}

    def claim(name):
        path = folder / name
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        locks.append(path)
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            json.dump(owner, output)

    try:
        key = hashlib.sha256(os.path.normcase(str(cwd.resolve())).encode()).hexdigest()
        claim('tree-' + key + '.lock')
        claim('batch-' + hashlib.sha256(batch.encode()).hexdigest() + '.lock')
        for slot in range(parallelism):
            try:
                claim('slot-' + str(slot) + '.lock')
                return locks
            except FileExistsError:
                continue
        raise FileExistsError('All GLM slots are occupied; enqueue after completion, do not steal locks.')
    except Exception:
        release_locks(locks)
        raise


def run(args):
    task_home = args.home
    task_home.mkdir(parents=True, exist_ok=True)
    parallelism = getattr(args, 'parallelism', 1)
    if parallelism > 1 and getattr(args, 'wake_state', None):
        raise ValueError('Parallel jobs use per-job registry status; omit the shared --wake-state.')
    path = task_home / 'jobs' / (args.batch + '.json')
    if path.exists():
        raise ValueError('Batch ID already exists; use a new ID to preserve prior evidence.')
    job = {'id': args.batch, 'title': args.title, 'worktree': str(args.cwd.resolve()),
           'state': 'starting', 'model': 'GLM-5.3-Flash', 'effort': 'max', 'contextConfigured': 1000000,
           'startedAt': int(time.time() * 1000), 'logPath': str(args.log.resolve()), 'parallelism': parallelism}
    locks = acquire_locks(task_home, args.cwd, args.batch, parallelism)
    if path.exists():
        release_locks(locks)
        raise ValueError('Batch ID already exists; preserve prior result.')
    child = None

    def update():
        atomic_write(path, job)
        if args.wake_state:
            atomic_write(args.wake_state, {**job, 'batch': args.batch, 'log': job['logPath'], 'handled': False})

    try:
        job['prompt'] = args.prompt.read_text(encoding='utf-8-sig')
        job['branch'] = subprocess.check_output(['git', 'branch', '--show-current'], cwd=args.cwd, text=True, creationflags=subprocess.CREATE_NO_WINDOW).strip()
        base = json.loads(args.provider.read_text(encoding='utf-8-sig'))
        selection = base['config']['defaultModelSelection']
        if selection['modelId'] != 'GLM-5.3-Flash' or selection.get('options', {}).get('reasoningLevel') != 'max':
            raise ValueError('Expected GLM-5.3-Flash with reasoningLevel=max.')
        for rule in base['config']['modelConfigRules'].get('manualProviderModelRules', []):
            rule['config']['optionSpecs']['maxOutputTokens']['max'] = 32768
        args.log.parent.mkdir(parents=True, exist_ok=True)
        provider = pathlib.Path(str(args.log) + '.provider.json')
        atomic_write(provider, base)
        builtin = args.cli.parent.parent / 'config/provider/zcode-builtin.json'
        if not builtin.is_file():
            raise ValueError('Zcode builtin provider file not found beside the selected CLI.')
        env = os.environ.copy()
        env.update(ZCODE_BUILTIN_PROVIDER_CONFIG_FILE=str(builtin),
                   ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE=str(builtin),
                   ZCODE_PERSONAL_PROVIDER_CONFIG_FILE=str(provider),
                   ZCODE_MODEL_RETRY_MAX_RETRIES='2', ZCODE_MODEL_RETRY_BASE_DELAY_MS='10000',
                   ZCODE_MODEL_RETRY_MAX_DELAY_MS='30000')
        command = [args.node, str(args.cli), '--cwd', str(args.cwd), '--prompt', job['prompt'], '--output-format', 'stream-json', '--no-color']
        attachments = [pathlib.Path(path).resolve(strict=True) for path in getattr(args, 'attach', [])]
        for attachment in attachments:
            if not attachment.is_file():
                raise ValueError('Attachment must be a local file: ' + str(attachment))
            command += ['--attach', str(attachment)]
        job['attachments'] = [str(path) for path in attachments]
        job['outputFormat'] = 'stream-json'
        if args.resume:
            command += ['--resume', args.resume]
        with args.log.open('w', encoding='utf-8') as output:
            spawn_at = int(time.time() * 1000)
            child = subprocess.Popen(command, cwd=args.cwd, env=env, stdin=subprocess.DEVNULL,
                                     stdout=output, stderr=output, creationflags=subprocess.CREATE_NO_WINDOW)
            job.update(state='running', pid=child.pid, processStartedAt=spawn_at)
            pathlib.Path(str(args.log) + '.pid').write_text(str(child.pid))
            update()
            code = child.wait()
        result = read_result(args.log)
        job.update(state='completed' if code == 0 and result else 'failed', exitCode=code, finishedAt=int(time.time() * 1000))
        if result:
            job.update(sessionId=result['sessionId'], response=redact(result['response']), usage=result.get('usage', {}))
        else:
            job['error'] = 'CLI未返回完整答复。请检查指定日志和工作树，禁止直接重复执行任务。'
        update()
        return 0 if job['state'] == 'completed' else 1
    except Exception as error:
        job.update(state='failed', error=redact(str(error)), finishedAt=int(time.time() * 1000))
        update()
        return 1
    finally:
        if child is None or child.poll() is not None:
            release_locks(locks)


def parser():
    p = argparse.ArgumentParser()
    p.add_argument('--home', type=pathlib.Path, default=DEFAULT_HOME)
    p.add_argument('--batch', required=True)
    p.add_argument('--title', required=True)
    p.add_argument('--cwd', type=pathlib.Path, required=True)
    p.add_argument('--prompt', type=pathlib.Path, required=True)
    p.add_argument('--log', type=pathlib.Path, required=True)
    p.add_argument('--provider', type=pathlib.Path, required=True)
    p.add_argument('--cli', type=pathlib.Path, required=True)
    p.add_argument('--node', default=shutil.which('node'))
    p.add_argument('--wake-state', type=pathlib.Path)
    p.add_argument('--resume')
    p.add_argument('--attach', action='append', type=pathlib.Path, default=[], help='Explicit task image/video attachment; repeat for multiple files')
    p.add_argument('--parallelism', type=int, default=1, choices=[1, 2, 3, 4])
    return p


if __name__ == '__main__':
    options = parser().parse_args()
    import re
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,100}', options.batch):
        raise SystemExit('Invalid batch ID')
    sys.exit(run(options))
