"""Single-provider GLM runner with durable, human-visible status and wake handoff."""
import argparse
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time
from monitor import DEFAULT_HOME, atomic_write, read_result, redact


def run(args):
    task_home = args.home
    task_home.mkdir(parents=True, exist_ok=True)
    path = task_home / 'jobs' / (args.batch + '.json')
    if path.exists():
        raise ValueError('Batch ID already exists; use a new ID to preserve prior evidence.')
    job = {'id': args.batch, 'title': args.title, 'worktree': str(args.cwd.resolve()),
           'state': 'starting', 'model': 'GLM-5.3-Flash', 'effort': 'max', 'contextConfigured': 1000000,
           'startedAt': int(time.time() * 1000), 'logPath': str(args.log.resolve())}
    lock = task_home / 'worker.lock'
    # Never steal a possibly-live provider call, including after a host crash.
    fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        json.dump({'pid': os.getpid(), 'batch': args.batch, 'startedAt': int(time.time() * 1000)}, stream)
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
        command = [args.node, str(args.cli), '--cwd', str(args.cwd), '--prompt', job['prompt'], '--json', '--no-color']
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
            lock.unlink(missing_ok=True)


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
    return p


if __name__ == '__main__':
    options = parser().parse_args()
    import re
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,100}', options.batch):
        raise SystemExit('Invalid batch ID')
    sys.exit(run(options))
