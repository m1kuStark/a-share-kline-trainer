"""Bounded parallel GLM runner with exclusive worktrees, durable per-job status, and bounded waits."""
import argparse
import hashlib
import json
import os
import pathlib
import re
import shutil
import signal
import subprocess
import sys
import time
from monitor import DEFAULT_DB, DEFAULT_HOME, atomic_write, read_result, redact, session_activity_stamp
from telemetry import ModelLogReader

MODEL_ID = 'GLM-5.3-Flash'
# CLI 0.16.9 实测仅接受图片/视频附件后缀
ATTACH_SUFFIXES = {'.gif', '.jpeg', '.jpg', '.png', '.webp',
                   '.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi'}
OFFICIAL_MAX_OUTPUT_TOKENS = 128000
MAX_PROMPT_CHARS = 30000
POLL_SECONDS = 10
SESSION_PATTERN = re.compile(r'"sessionId"\s*:\s*"(sess_[A-Za-z0-9._-]+)"')


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


def validate_prompt(text):
    if not text or not text.strip():
        raise ValueError('Prompt 文件为空。')
    if len(text) > MAX_PROMPT_CHARS:
        raise ValueError('Prompt %d 字符超过 Windows 命令行安全上限 %d；请拆分任务或精简后重派。' % (len(text), MAX_PROMPT_CHARS))
    return text


def validate_attachments(paths):
    resolved = []
    for raw in paths:
        path = pathlib.Path(raw).resolve(strict=True)
        if not path.is_file():
            raise ValueError('附件必须是本地文件：' + str(path))
        if path.suffix.lower() not in ATTACH_SUFFIXES:
            raise ValueError('附件 %s 后缀不受CLI支持；仅接受图片/视频：%s'
                             % (path.name, ' '.join(sorted(ATTACH_SUFFIXES))))
        resolved.append(path)
    return resolved


def apply_output_budget(provider_document, model_id, budget):
    if budget > OFFICIAL_MAX_OUTPUT_TOKENS:
        raise ValueError('输出预算 %d 超过官方上限 %d。' % (budget, OFFICIAL_MAX_OUTPUT_TOKENS))
    rules = ((provider_document.get('config') or {}).get('modelConfigRules') or {}).get('manualProviderModelRules') or []
    touched = 0
    for rule in rules:
        if rule.get('modelId') not in (None, model_id):
            continue
        spec = ((rule.get('config') or {}).get('optionSpecs') or {}).get('maxOutputTokens')
        if not isinstance(spec, dict) or 'max' not in spec:
            raise ValueError('provider 规则缺少 optionSpecs.maxOutputTokens 路径，无法设置输出预算；请核对个人配置 schema。')
        spec['max'] = budget
        touched += 1
    if not touched:
        raise ValueError('provider 配置中没有 %s 的 manualProviderModelRules 规则。' % model_id)


def kill_tree(pid):
    if os.name == 'nt':
        subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'],
                       creationflags=subprocess.CREATE_NO_WINDOW, capture_output=True)
    else:
        os.kill(pid, signal.SIGTERM)


def discover_session_id(log_path):
    try:
        with log_path.open('r', encoding='utf-8', errors='replace') as source:
            match = SESSION_PATTERN.search(source.read(65536))
    except OSError:
        return None
    return match.group(1) if match else None


def supervise(child, log_path, *, database, worktree, started_at, total_ms=0, idle_ms=0,
              reader=None, session_id=None, poll_seconds=POLL_SECONDS):
    """Bounded wait. Activity = own log growth, session DB stamps, or a model request still in flight.
    Idle check arms only after the session is identified, so startup phases never idle-kill."""
    last_activity = time.time() * 1000
    size = 0
    while True:
        try:
            return child.wait(timeout=poll_seconds)
        except subprocess.TimeoutExpired:
            pass
        now = time.time() * 1000
        try:
            grown = log_path.stat().st_size
        except OSError:
            grown = size
        if grown > size:
            size = grown
            last_activity = now
        if session_id is None:
            session_id = discover_session_id(log_path)
        if session_id:
            if reader is not None:
                signals = reader.read(session_id, started_at) or {}
                in_flight = bool(signals.get('requestStartedAt')) and not signals.get('responseAt') and not signals.get('failureAt')
                stamps = [signals.get(key) for key in ('requestStartedAt', 'responseAt', 'failureAt')]
                if in_flight or any(stamp and stamp > last_activity for stamp in stamps):
                    last_activity = now
            stamp = session_activity_stamp(database, worktree, session_id, started_at)
            if stamp and stamp > last_activity:
                last_activity = stamp
            if idle_ms and now - last_activity > idle_ms:
                return 'idle-timeout'
        if total_ms and now - started_at > total_ms:
            return 'total-timeout'


def run(args):
    task_home = args.home
    task_home.mkdir(parents=True, exist_ok=True)
    parallelism = getattr(args, 'parallelism', 1)
    if parallelism > 1 and getattr(args, 'wake_state', None):
        raise ValueError('Parallel jobs use per-job registry status; omit the shared --wake-state.')
    path = task_home / 'jobs' / (args.batch + '.json')
    if path.exists():
        raise ValueError('Batch ID already exists; use a new ID to preserve prior evidence.')
    node = getattr(args, 'node', None) or shutil.which('node')
    if not node:
        raise ValueError('未找到 node 解释器；请用 --node 显式指定。')
    total_ms = int(getattr(args, 'timeout_minutes', 0.0) * 60000)
    idle_ms = int(getattr(args, 'idle_minutes', 5.0) * 60000)
    permission_mode = getattr(args, 'permission_mode', 'yolo')
    budget = getattr(args, 'max_output_tokens', 32768)
    database = getattr(args, 'db', None) or DEFAULT_DB
    job = {'id': args.batch, 'title': args.title, 'worktree': str(args.cwd.resolve()),
           'state': 'starting', 'model': MODEL_ID, 'effort': 'max', 'contextConfigured': 1000000,
           'startedAt': int(time.time() * 1000), 'logPath': str(args.log.resolve()), 'parallelism': parallelism,
           'mode': permission_mode, 'timeoutMinutes': getattr(args, 'timeout_minutes', 0.0),
           'idleMinutes': getattr(args, 'idle_minutes', 5.0)}
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
        job['prompt'] = validate_prompt(args.prompt.read_text(encoding='utf-8-sig'))
        job['branch'] = subprocess.check_output(['git', 'branch', '--show-current'], cwd=args.cwd, text=True, creationflags=subprocess.CREATE_NO_WINDOW).strip()
        base = json.loads(args.provider.read_text(encoding='utf-8-sig'))
        selection = base['config']['defaultModelSelection']
        if selection['modelId'] != MODEL_ID or selection.get('options', {}).get('reasoningLevel') != 'max':
            raise ValueError('Expected GLM-5.3-Flash with reasoningLevel=max.')
        apply_output_budget(base, MODEL_ID, budget)
        attachments = validate_attachments(getattr(args, 'attach', []))
        job['attachments'] = [str(item) for item in attachments]
        args.log.parent.mkdir(parents=True, exist_ok=True)
        provider = pathlib.Path(str(args.log) + '.provider.json')
        atomic_write(provider, base)
        builtin = args.cli.parent.parent / 'config/provider/zcode-builtin.json'
        if not builtin.is_file():
            raise ValueError('Zcode builtin provider file not found beside the selected CLI.')
        try:
            job['cliVersion'] = subprocess.run([node, str(args.cli), '--version'], capture_output=True, text=True,
                                               timeout=60, creationflags=subprocess.CREATE_NO_WINDOW).stdout.strip() or None
        except (OSError, subprocess.SubprocessError):
            job['cliVersion'] = None
        env = os.environ.copy()
        env.update(ZCODE_BUILTIN_PROVIDER_CONFIG_FILE=str(builtin),
                   ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE=str(builtin),
                   ZCODE_PERSONAL_PROVIDER_CONFIG_FILE=str(provider),
                   ZCODE_MODEL_RETRY_MAX_RETRIES='2', ZCODE_MODEL_RETRY_BASE_DELAY_MS='10000',
                   ZCODE_MODEL_RETRY_MAX_DELAY_MS='30000')
        command = [node, str(args.cli), '--cwd', str(args.cwd), '--mode', permission_mode,
                   '--prompt', job['prompt'], '--output-format', 'stream-json', '--no-color']
        for attachment in attachments:
            command += ['--attach', str(attachment)]
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
            reader = ModelLogReader(pathlib.Path.home() / '.zcode' / 'cli' / 'log')
            verdict = supervise(child, args.log, database=database, worktree=str(args.cwd.resolve()),
                                started_at=spawn_at, total_ms=total_ms, idle_ms=idle_ms, reader=reader,
                                session_id=args.resume or None)
            if isinstance(verdict, str):
                kill_tree(child.pid)
                child.wait()
        if isinstance(verdict, str):
            job.update(state='failed', finishedAt=int(time.time() * 1000), timeoutKind=verdict)
            if verdict == 'idle-timeout':
                job['error'] = ('空闲超时：%g 分钟无新活动（日志/会话/模型请求均无）被终止。若属单次长思考或任务确需更久，'
                                '请核对工作树已有改动后，以新批次ID用更大的 --idle-minutes（设0关闭空闲判定）重新派发。'
                                % getattr(args, 'idle_minutes', 5.0))
            else:
                job['error'] = ('总时长超时：%g 分钟被终止。若任务规模确需更久，请确认工作树改动状态后，'
                                '以新批次ID与更大的 --timeout-minutes 重新派发。'
                                % getattr(args, 'timeout_minutes', 0.0))
            update()
            return 1
        result = read_result(args.log)
        job.update(state='completed' if child.returncode == 0 and result else 'failed',
                   exitCode=child.returncode, finishedAt=int(time.time() * 1000))
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
    p.add_argument('--db', type=pathlib.Path, default=DEFAULT_DB)
    p.add_argument('--wake-state', type=pathlib.Path)
    p.add_argument('--resume')
    p.add_argument('--attach', action='append', type=pathlib.Path, default=[], help='Explicit task image/video attachment; repeat for multiple files')
    p.add_argument('--parallelism', type=int, default=1, choices=[1, 2, 3, 4])
    p.add_argument('--permission-mode', default='yolo', choices=['build', 'edit', 'plan', 'yolo'],
                   help='显式传给 CLI --mode，防止未来默认值变化导致无头权限死锁')
    p.add_argument('--timeout-minutes', type=float, default=0.0, help='总时长上限（分钟）；0=不限')
    p.add_argument('--idle-minutes', type=float, default=5.0, help='无新活动上限（分钟）；0=关闭空闲判定')
    p.add_argument('--max-output-tokens', type=int, default=32768, help='输出预算；官方上限 128000')
    return p


if __name__ == '__main__':
    options = parser().parse_args()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,100}', options.batch):
        raise SystemExit('Invalid batch ID')
    sys.exit(run(options))
