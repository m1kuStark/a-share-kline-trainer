"""Zcode CLI 官方会话用量查询（app-server NDJSON 契约）。

仅暴露 session/usage 返回的原始计数，不做本地成本/配额/令牌折算；
只查询父级登记的会话ID，未知字段、inputBaselineBySource 与响应头一律不外泄，
CLI stderr 与任意响应文本不进入日志或消息。
"""
import json
import math
import os
import pathlib
import queue
import shutil
import signal
import subprocess
import threading
import time

SOURCE = 'Zcode CLI session/usage'
SCOPE = 'session'
STATUS_AVAILABLE = 'available'
STATUS_UNAVAILABLE = 'unavailable'
COUNTER_KEYS = ('inputTokens', 'outputTokens', 'totalTokens', 'reasoningTokens',
                'cacheReadTokens', 'cacheCreationTokens', 'modelRequestCount', 'modelErrorCount')
READ_TIMEOUT = 25
MAX_OUTPUT_BYTES = 1 << 20   # 单批次 stdout 读取上限，防止通知洪泛拖垮宿主
MAX_LINE_BYTES = 262144      # NDJSON 行都很小；超长内容直接丢弃不缓冲

MSG_NO_CLI = '未提供CLI路径，无法查询会话用量'
MSG_SPAWN = 'CLI进程启动失败'
MSG_TIMEOUT = '查询会话用量超时'
MSG_OVERFLOW = 'CLI输出超出读取上限'
MSG_NO_RESPONSE = '会话用量查询无响应'
MSG_CLI_ERROR = 'CLI返回查询错误'
MSG_MALFORMED = 'CLI响应格式无效'
MSG_QUERY_FAILED = '会话用量查询失败'


def now_ms():
    return int(time.time() * 1000)


def valid_counter(value):
    """仅接受非负有限数值；bool/NaN/负数/字符串按不可用处理，绝不折算成0。"""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or value < 0:
        return None
    return int(value) if isinstance(value, float) and value.is_integer() else value


def _record(result, status, message=None, at=None):
    record = {'status': status, 'source': SOURCE, 'scope': SCOPE,
              'updatedAt': at if at is not None else now_ms()}
    if message:
        record['message'] = message
    for key in COUNTER_KEYS:
        record[key] = valid_counter(result.get(key)) if isinstance(result, dict) else None
    return record


def _unavailable_all(ids, message):
    at = now_ms()
    return {sid: _record(None, STATUS_UNAVAILABLE, message, at) for sid in ids}


def _unique_ids(session_ids):
    seen, ordered = set(), []
    for sid in session_ids or ():
        if not isinstance(sid, str):
            continue
        sid = sid.strip()
        if sid and sid not in seen:
            seen.add(sid)
            ordered.append(sid)
    return ordered


def _server_command(cli):
    path = pathlib.Path(cli)
    if path.suffix.lower() in ('.cjs', '.mjs', '.js'):
        node = shutil.which('node')
        if not node:
            return None, None
        command = [node, str(path), 'app-server']
    else:
        command = [str(path), 'app-server']
    # 仅写入子进程环境：内置配置钉在所选CLI旁；个人配置默认官方 v2 文件
    # （仅当存在且未被提供时），避免CLI可选的 provider 缓存改写。
    env = os.environ.copy()
    builtin = path.resolve().parent.parent / 'config' / 'provider' / 'zcode-builtin.json'
    if builtin.is_file():
        env['ZCODE_BUILTIN_PROVIDER_CONFIG_FILE'] = str(builtin)
        env['ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE'] = str(builtin)
    personal = pathlib.Path.home() / '.zcode' / 'v2' / 'provider_config.json'
    if personal.is_file() and not env.get('ZCODE_PERSONAL_PROVIDER_CONFIG_FILE'):
        env['ZCODE_PERSONAL_PROVIDER_CONFIG_FILE'] = str(personal)
    return command, env


def _terminate(process):
    if process is None:
        return
    try:
        if process.poll() is None:
            if os.name == 'nt':
                try:
                    process.wait(timeout=0.5)  # 常见情况下先等自然退出
                except subprocess.TimeoutExpired:
                    subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                                   capture_output=True, timeout=5, creationflags=0x08000000)
            else:
                os.killpg(os.getpgid(process.pid), signal.SIGTERM)
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    os.killpg(os.getpgid(process.pid), signal.SIGKILL)
    except (OSError, subprocess.SubprocessError):
        pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            process.kill()
            process.wait(timeout=5)
        except (OSError, subprocess.SubprocessError):
            pass


def query_sessions(cli, session_ids, timeout=READ_TIMEOUT):
    """一批会话ID共用一个有界 app-server 进程；返回 请求ID -> 归一化记录。"""
    ids = _unique_ids(session_ids)
    if not ids:
        return {}
    if not cli:
        return _unavailable_all(ids, MSG_NO_CLI)
    command, env = _server_command(cli)
    if command is None:
        return _unavailable_all(ids, MSG_SPAWN)
    if os.name == 'nt':
        extra = {'creationflags': 0x08000000}
    else:
        extra = {'start_new_session': True}
    try:
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, env=env, **extra)
    except OSError:
        return _unavailable_all(ids, MSG_SPAWN)

    lines = queue.Queue()

    def pump():
        total = 0
        try:
            while True:
                chunk = process.stdout.readline(MAX_LINE_BYTES)
                if not chunk:
                    break
                total += len(chunk)
                if chunk.endswith(b'\n'):
                    lines.put(('line', chunk))
                if total > MAX_OUTPUT_BYTES:
                    lines.put(('overflow', None))  # 上限先于断行判断，超长无换行行同样不可绕过
                    break
        except (OSError, ValueError):
            pass
        finally:
            lines.put(('eof', None))

    reader = threading.Thread(target=pump, daemon=True)
    reader.start()
    pending = {index + 1: sid for index, sid in enumerate(ids)}
    payload = '\n'.join(json.dumps({'id': rid, 'method': 'session/usage', 'params': {'sessionId': sid}},
                                   ensure_ascii=False)
                        for rid, sid in pending.items())
    deadline = time.monotonic() + max(float(timeout), 1.0)
    records, overflow = {}, False
    try:
        try:
            process.stdin.write(payload.encode('utf-8') + b'\n')
            process.stdin.flush()
        except OSError:
            pass
        finally:
            try:
                process.stdin.close()
            except OSError:
                pass
        while pending:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            try:
                kind, raw = lines.get(timeout=remaining)
            except queue.Empty:
                break
            if kind in ('eof', 'overflow'):
                overflow = kind == 'overflow'
                break
            text = raw.decode('utf-8', errors='replace').strip()
            if not text:
                continue
            try:
                message = json.loads(text)
            except ValueError:
                continue  # 通知噪声或坏行：忽略且不记录内容
            if not isinstance(message, dict):
                continue
            rid = message.get('id')
            if isinstance(rid, bool) or rid not in pending:
                continue  # 仅接受精确 id 关联
            sid = pending.pop(rid)
            result = message.get('result')
            if isinstance(result, dict):
                records[sid] = _record(result, STATUS_AVAILABLE)
            elif message.get('error') is not None:
                records[sid] = _record(None, STATUS_UNAVAILABLE, MSG_CLI_ERROR)
            else:
                records[sid] = _record(None, STATUS_UNAVAILABLE, MSG_MALFORMED)
    except Exception:
        records, overflow = {}, False  # 任何意外都收敛为固定消息，不外泄细节
    finally:
        _terminate(process)
        reader.join(timeout=2)
        for stream in (process.stdin, process.stdout):
            try:
                if stream is not None:
                    stream.close()
            except (OSError, ValueError):
                pass
    missing = MSG_OVERFLOW if overflow else (MSG_TIMEOUT if time.monotonic() >= deadline else MSG_NO_RESPONSE)
    for sid in ids:
        if sid not in records:
            records[sid] = _record(None, STATUS_UNAVAILABLE, missing)
    return records


class UsageCache:
    """非阻塞按会话缓存：单飞行后台刷新 + 查询冷却；失败保留旧测量并自然转为 stale。"""

    def __init__(self, cli, ttl=60, query_fn=None):
        self.cli = cli
        self.ttl = max(float(ttl), 0.0)
        self.query_fn = query_fn or (lambda ids: query_sessions(cli, ids, timeout=READ_TIMEOUT))
        self._lock = threading.Lock()
        self._records = {}  # sid -> (record, fetched_at_ms)
        self._cooldown_until = 0.0
        self._refreshing = False

    def get(self, session_ids):
        ids = _unique_ids(session_ids)
        now = now_ms()
        if not self.cli:
            return {'status': STATUS_UNAVAILABLE, 'source': SOURCE, 'updatedAt': now, 'message': MSG_NO_CLI,
                    'sessions': {sid: _record(None, STATUS_UNAVAILABLE, MSG_NO_CLI, now) for sid in ids}}
        with self._lock:
            snapshot, missing, stale = {}, [], False
            for sid in ids:
                entry = self._records.get(sid)
                if entry is None:
                    missing.append(sid)
                    continue
                record, fetched_at = entry
                if now - fetched_at > self.ttl * 1000:
                    stale = True
                    record = dict(record, status='stale')  # 保留原 updatedAt，仅标记过期
                snapshot[sid] = dict(record)
            due = now >= self._cooldown_until and not self._refreshing
            if ids and due and (missing or stale):
                self._cooldown_until = time.time() * 1000 + self.ttl * 1000
                self._refreshing = True
                threading.Thread(target=self._refresh, args=(list(ids),), daemon=True).start()
            updated = [value['updatedAt'] for value in snapshot.values()]
            return {'status': self._top_status(ids, missing, stale, snapshot), 'source': SOURCE,
                    'updatedAt': max(updated) if updated else None,
                    'message': self._top_message(ids, missing, stale, snapshot),
                    'sessions': snapshot}

    @staticmethod
    def _top_status(ids, missing, stale, snapshot):
        if not ids:
            return STATUS_UNAVAILABLE
        if missing:
            return 'loading'
        if stale:
            return 'stale'
        if all(record['status'] == STATUS_AVAILABLE for record in snapshot.values()):
            return STATUS_AVAILABLE
        return STATUS_UNAVAILABLE

    @staticmethod
    def _top_message(ids, missing, stale, snapshot):
        if not ids:
            return '未提供会话ID'
        if missing:
            return '正在查询会话用量'
        if stale:
            return '会话用量已超过刷新周期，显示缓存结果'
        if all(record['status'] == STATUS_AVAILABLE for record in snapshot.values()):
            return '会话用量为官方CLI最近一次测量'
        return '会话用量暂不可用'

    def _refresh(self, ids):
        try:
            try:
                records = self.query_fn(list(ids))
            except Exception:
                records = None
            if not isinstance(records, dict):
                records = {}
            at = now_ms()
            with self._lock:
                for sid in ids:
                    record = records.get(sid)
                    if isinstance(record, dict) and record.get('status') == STATUS_AVAILABLE:
                        self._records[sid] = (record, at)
                        continue
                    existing = self._records.get(sid)
                    if existing is not None and existing[0].get('status') == STATUS_AVAILABLE:
                        continue  # 失败不覆盖历史测量；随时间自然转为 stale
                    self._records[sid] = (record if isinstance(record, dict) else
                                          _record(None, STATUS_UNAVAILABLE, MSG_NO_RESPONSE), at)
        finally:
            with self._lock:
                self._refreshing = False
