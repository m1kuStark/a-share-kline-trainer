"""Read-only local task monitor. No model calls and no Zcode database writes."""
import argparse
import ctypes
import json
import os
import pathlib
import re
import secrets
import sqlite3
import subprocess
import time
import urllib.request
from urllib.parse import urlparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from telemetry import ModelLogReader

DEFAULT_HOME = pathlib.Path(os.environ.get('CODEX_HOME', pathlib.Path.home() / '.codex')) / 'headroom-cache' / 'glm-monitor'
DEFAULT_DB = pathlib.Path.home() / '.zcode' / 'cli' / 'db' / 'db.sqlite'
MODEL_LOG = ModelLogReader(pathlib.Path.home() / '.zcode' / 'cli' / 'log')


def atomic_write(path, value):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + secrets.token_hex(4) + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(temporary, path)


def read_result(path):
    text = pathlib.Path(path).read_text(encoding='utf-8', errors='replace')
    decoder = json.JSONDecoder()
    for match in re.finditer(r'(?m)^\s*\{', text):
        try:
            value, _ = decoder.raw_decode(text[match.start():].lstrip())
            if isinstance(value, dict) and 'sessionId' in value and 'response' in value:
                return value
        except ValueError:
            continue
    return None


def redact(value):
    text = str(value or '')
    text = re.sub(r'(?im)(authorization\s*[:=]\s*)(?:bearer\s+)?[^\r\n]+', r'\1[已隐藏]', text)
    text = re.sub(r'(?i)((?:api[_-]?key|access[_-]?token|password|secret)\s*[=:]\s*)[^\s,;]+', r'\1[已隐藏]', text)
    return re.sub(r'\bsk-[A-Za-z0-9_-]{12,}', '[已隐藏]', text)


def process_alive(pid, started_at=None):
    if not isinstance(pid, int) or pid <= 0:
        return False
    if os.name != 'nt':
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
    kernel.OpenProcess.restype = ctypes.c_void_p
    kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    kernel.WaitForSingleObject.restype = ctypes.c_uint32
    kernel.GetProcessTimes.argtypes = [ctypes.c_void_p] + [ctypes.POINTER(ctypes.c_uint64)] * 4
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    handle = kernel.OpenProcess(0x100000 | 0x1000, False, pid)
    if not handle:
        return False
    try:
        if kernel.WaitForSingleObject(handle, 0) != 258:
            return False
        if started_at:
            created, ended, system, user = (ctypes.c_uint64() for _ in range(4))
            if kernel.GetProcessTimes(handle, ctypes.byref(created), ctypes.byref(ended), ctypes.byref(system), ctypes.byref(user)):
                created_ms = created.value / 10000 - 11644473600000
                # Reject PID reuse; the runner persists time immediately around spawn.
                if abs(created_ms - started_at) > 15000:
                    return False
        return True
    finally:
        kernel.CloseHandle(handle)


def normalize_path(value):
    return os.path.normcase(os.path.abspath(value)).replace('\\', '/').lower()


def session_activity(db, job):
    session_id = job.get('sessionId')
    if session_id:
        row = db.execute('select id,directory,time_updated from session where id=?', (session_id,)).fetchone()
    else:
        # Current runner knows cwd and start time before Zcode has allocated a session id.
        rows = db.execute('select id,directory,time_updated from session where time_created>=? order by time_created desc limit 100', (job.get('startedAt', 0) - 2000,)).fetchall()
        row = next((r for r in rows if normalize_path(r[1]) == normalize_path(job['worktree'])), None)
    if row is None:
        return {'sessionId': session_id, 'activity': [], 'lastActivity': None, 'warning': '尚无会话记录'}
    if normalize_path(row[1]) != normalize_path(job['worktree']):
        return {'activity': [], 'warning': '会话目录与登记任务不匹配，已停止读取'}
    session_id = row[0]
    rows = db.execute('select time_updated,data from part where session_id=? order by time_updated desc limit 240', (session_id,)).fetchall()
    activity = []
    for timestamp, raw in rows:
        value = json.loads(raw)
        if value.get('type') != 'tool':
            continue
        state = value.get('state', {})
        inputs = state.get('input', {})
        # Deliberately exclude commands, tool output, request headers and reasoning text.
        description = inputs.get('description') or inputs.get('filePath') or inputs.get('file_path') or state.get('title') or value.get('tool', '')
        activity.append({'at': timestamp, 'tool': value.get('tool', ''), 'status': state.get('status', 'unknown'), 'description': redact(description)[:400]})
        if len(activity) >= 35:
            break
    usage = db.execute('select status,model_id,started_at,first_token_at,completed_at,error_message from model_usage where session_id=? order by started_at desc limit 1', (session_id,)).fetchone()
    last = max([row[2]] + [r[0] for r in rows] + ([usage[2], usage[3] or 0, usage[4] or 0] if usage else []))
    return {'sessionId': session_id, 'activity': activity, 'lastActivity': last,
            'lastToolAt': max((item['at'] for item in activity), default=None),
            'request': {'status': usage[0], 'model': usage[1], 'startedAt': usage[2], 'firstTokenAt': usage[3], 'completedAt': usage[4], 'error': redact(usage[5])[:400]} if usage else None}


def session_activity_stamp(database, worktree, session_id, started_at):
    """Newest persisted activity (ms) for the registered session, or None when unknown or unreadable."""
    try:
        db = sqlite3.connect(pathlib.Path(database).resolve().as_uri() + '?mode=ro', uri=True, timeout=1)
        db.execute('pragma query_only=on')
    except sqlite3.Error:
        return None
    try:
        if session_id:
            row = db.execute('select directory from session where id=?', (session_id,)).fetchone()
            if row is None or normalize_path(row[0]) != normalize_path(worktree):
                return None
        else:
            rows = db.execute('select id,directory from session where time_created>=? order by time_created desc limit 100', (started_at - 2000,)).fetchall()
            match = next((item for item in rows if normalize_path(item[1]) == normalize_path(worktree)), None)
            if match is None:
                return None
            session_id = match[0]
        stamps = db.execute('select max(time_updated) from part where session_id=?', (session_id,)).fetchone()[0]
        usage = db.execute('select max(latest) from (select max(started_at) latest from model_usage where session_id=?'
                           ' union all select max(completed_at) from model_usage where session_id=?)', (session_id, session_id)).fetchone()[0]
        values = [value for value in (stamps, usage) if value]
        return max(values) if values else None
    except (sqlite3.Error, TypeError):
        return None
    finally:
        if db is not None:
            db.close()


def resolve_chain(item, by_id):
    """Walk followupId links bounded by registry size; cycles and missing successors stay unresolved."""
    seen = {item['id']}
    current = item
    for _ in range(len(by_id)):
        followup_id = current.get('followupId')
        if not followup_id:
            return current, None
        if followup_id in seen:
            return None, 'cycle'
        followup = by_id.get(followup_id)
        if followup is None:
            return None, 'missing'
        seen.add(followup_id)
        current = followup
    return None, 'cycle'


def snapshot(registry, database):
    jobs, warnings = [], []
    db = None
    try:
        db = sqlite3.connect(pathlib.Path(database).resolve().as_uri() + '?mode=ro', uri=True, timeout=1)
        db.execute('pragma query_only=on')
    except sqlite3.Error:
        warnings.append('Zcode会话数据库暂不可读；任务登记仍可查看')
    try:
        for path in pathlib.Path(registry).glob('*.json'):
            try:
                job = json.loads(path.read_text(encoding='utf-8-sig'))
                safe_keys = ['id', 'title', 'worktree', 'branch', 'state', 'startedAt', 'finishedAt', 'model', 'effort', 'contextConfigured', 'prompt', 'response', 'error', 'review', 'logPath', 'exitCode', 'followupId']
                item = {key: job[key] for key in safe_keys if key in job}
                for field in ['prompt', 'response', 'error']:
                    if field in item:
                        item[field] = redact(item[field])[:70000]
                item.update(activity=[], lastActivity=None)
                state = job.get('state', 'queued')
                review = job.get('review', {}).get('state')
                item['phase'] = ('reviewed' if review == 'passed' else 'needs_changes' if review == 'changes_requested' else
                                 'awaiting_review' if state == 'completed' else
                                 'running' if state == 'running' and process_alive(job.get('pid'), job.get('processStartedAt')) else
                                 'interrupted' if state == 'running' else state)
                if db is not None and state != 'queued':
                    try:
                        item.update(session_activity(db, job))
                        if item.get('sessionId') and not item.get('warning') and database == DEFAULT_DB:
                            signal = MODEL_LOG.read(item['sessionId'], job.get('startedAt', 0))
                            if signal:
                                signal.pop('query', None)
                                item['modelSignal'] = signal
                    except (OSError, sqlite3.Error, ValueError, TypeError) as error:
                        item['warning'] = '会话活动暂不可读：' + type(error).__name__
                elif db is None:
                    item['warning'] = 'Zcode会话数据库暂不可读'
                jobs.append(item)
            except (OSError, ValueError, KeyError, TypeError):
                warnings.append('一份任务登记暂不可读：' + path.name)
    finally:
        if db is not None:
            db.close()
    jobs.sort(key=lambda j: j.get('startedAt', 0), reverse=True)
    by_id = {item['id']: item for item in jobs}
    for item in jobs:
        if item.get('followupId'):
            followup = by_id.get(item['followupId'])
            item['followup'] = {key: followup.get(key) for key in ['id', 'title', 'phase']} if followup else None
        # Raw state/review are never rewritten; resolved is a display-level chain verdict only.
        tip, issue = resolve_chain(item, by_id)
        item['chainIssue'] = issue
        item['superseded'] = tip is not None and tip is not item
        item['resolved'] = tip is not None and tip.get('phase') == 'reviewed'
        if tip is not None:
            item['chainTip'] = {key: tip.get(key) for key in ['id', 'title', 'phase']}
        model = str(item.get('model') or '')
        item['jobKind'] = 'glm' if not model or 'glm' in model.lower() else 'local'
    current = [j for j in jobs if not j['superseded']]
    summary = {'running': sum(1 for j in current if j['phase'] == 'running'),
               'awaitingReview': sum(1 for j in current if j['phase'] == 'awaiting_review'),
               'needsAttention': sum(1 for j in current if j['phase'] in ('failed', 'interrupted', 'needs_changes'))}
    return {'generatedAt': int(time.time() * 1000), 'jobs': jobs, 'summary': summary, 'warnings': warnings}


def open_window(url):
    edge = pathlib.Path(os.environ.get('PROGRAMFILES(X86)', r'C:\Program Files (x86)')) / 'Microsoft/Edge/Application/msedge.exe'
    if edge.exists():
        subprocess.Popen([str(edge), '--app=' + url], close_fds=True)
    else:
        import webbrowser
        webbrowser.open(url)


def validate_instance_url(value):
    parsed = urlparse(value)
    if (parsed.scheme != 'http' or parsed.hostname != '127.0.0.1'
            or parsed.username is not None or parsed.password is not None
            or not parsed.port or parsed.port > 65535 or parsed.query or parsed.fragment
            or not re.fullmatch(r'/[A-Za-z0-9_-]{24,64}/', parsed.path)):
        raise ValueError('Monitor instance URL must be an exact loopback token URL')
    return parsed


class NoInstanceRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def read_instance_health(url):
    validate_instance_url(url)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoInstanceRedirect())
    with opener.open(url + 'health', timeout=2) as response:
        return json.load(response)


def serve(home, database, launch, reuse_address=False):
    home.mkdir(parents=True, exist_ok=True)
    metadata = home / 'server.json'
    previous = None
    try:
        previous = json.loads(metadata.read_text(encoding='utf-8'))
        if process_alive(previous['pid'], previous.get('startedAt')):
            valid = read_instance_health(previous['url']).get('instance') == previous['instance']
            if valid:
                if launch:
                    open_window(previous['url'])
                return
    except (OSError, ValueError, KeyError):
        pass
    token = secrets.token_urlsafe(24)
    port = 0
    if reuse_address and previous and not process_alive(previous['pid'], previous.get('startedAt')):
        try:
            parsed = validate_instance_url(previous['url'])
            port, token = parsed.port, parsed.path.strip('/')
        except (TypeError, ValueError, KeyError):
            pass
    instance = secrets.token_hex(16)

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.headers.get('Host') != '127.0.0.1:' + str(self.server.server_port):
                self.send_error(403)
                return
            prefix = '/' + token + '/'
            if not self.path.startswith(prefix):
                self.send_error(404)
                return
            route = self.path[len(prefix):]
            if route == '':
                body, content_type = pathlib.Path(__file__).with_name('index.html').read_bytes(), 'text/html; charset=utf-8'
            elif route == 'state':
                body, content_type = json.dumps(snapshot(home / 'jobs', database), ensure_ascii=False).encode(), 'application/json; charset=utf-8'
            elif route == 'health':
                body, content_type = json.dumps({'instance': instance}).encode(), 'application/json'
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    url = 'http://127.0.0.1:' + str(server.server_port) + '/' + token + '/'
    atomic_write(metadata, {'pid': os.getpid(), 'url': url, 'instance': instance, 'startedAt': int(time.time() * 1000)})
    if launch:
        open_window(url)
    server.serve_forever()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--home', type=pathlib.Path, default=DEFAULT_HOME)
    parser.add_argument('--db', type=pathlib.Path, default=DEFAULT_DB)
    parser.add_argument('--open', action='store_true')
    parser.add_argument('--reuse-address', action='store_true')
    args = parser.parse_args()
    serve(args.home, args.db, args.open, args.reuse_address)
