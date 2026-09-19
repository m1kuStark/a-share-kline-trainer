"""Project-scoped lifecycle metadata; never expose model text, headers or tool payloads."""
import datetime
import json
import pathlib
import threading


class ModelLogReader:
    def __init__(self, folder):
        self.folder = pathlib.Path(folder)
        self.lock = threading.Lock()
        self.sessions = {}

    def read(self, session_id, started_at):
        with self.lock:
            files = sorted(self.folder.glob('zcode-*.jsonl'))[-2:]
            key = (session_id, started_at)
            cache = self.sessions.setdefault(key, {'files': {}, 'value': {}})
            if len(self.sessions) > 100:
                self.sessions.pop(next(iter(self.sessions)))
            for path in files:
                stat = path.stat()
                cursor = cache['files'].get(str(path))
                if cursor and (stat.st_ino != cursor['inode'] or stat.st_size < cursor['offset']):
                    cache['files'].clear()
                    cache['value'].clear()
                    cursor = None
                # Initial reads are bounded; old unavailable signals remain unknown.
                offset = cursor['offset'] if cursor else max(0, stat.st_size - 8 * 1024 * 1024)
                with path.open('rb') as source:
                    source.seek(offset)
                    if cursor is None and offset:
                        source.readline()
                    while True:
                        position = source.tell()
                        line = source.readline(1024 * 1024)
                        if not line:
                            break
                        if not line.endswith(b'\n'):
                            source.seek(position)
                            break
                        if session_id.encode() not in line:
                            continue
                        try:
                            entry = json.loads(line)
                            if entry.get('sessionId') != session_id:
                                continue
                            at = datetime.datetime.fromisoformat(entry['timestamp'].replace('Z', '+00:00')).timestamp() * 1000
                            if at < started_at:
                                continue
                            self._observe(cache['value'], entry, at)
                        except (ValueError, TypeError, KeyError, AttributeError):
                            continue
                    cache['files'][str(path)] = {'offset': source.tell(), 'inode': stat.st_ino}
            return dict(cache['value']) if cache['value'] else None

    @staticmethod
    def _observe(value, entry, at):
        event = entry.get('event')
        if event not in ('model.request.started', 'model.response.diagnostics', 'model.request.failed'):
            return
        if at <= value.get('signalAt', 0):
            return
        context = entry.get('context', {})
        query = context.get('queryId')
        if event != 'model.request.started' and value.get('query') and query != value['query']:
            return
        value['signalAt'] = at
        if event == 'model.request.started':
            value.update(signal='request_started', requestStartedAt=at, query=query)
        elif event == 'model.response.diagnostics':
            finish = context.get('finishReason')
            allowed = {'length', 'stop', 'tool-calls', 'error', 'other', 'unknown'}
            value.update(signal='response_completed', responseAt=at, finishReason=finish if finish in allowed else 'other')
            if finish == 'length':
                value['lengthStops'] = value.get('lengthStops', 0) + 1
            tokens = context.get('usageOutputTokens')
            if isinstance(tokens, (int, float)):
                value['lastOutputTokens'] = tokens
        else:
            value.update(signal='request_failed', failureAt=at)
