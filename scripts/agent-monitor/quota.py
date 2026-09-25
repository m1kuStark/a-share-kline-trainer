"""Read-only remote plan balances. Values and units come from Zcode's service."""
import copy
import datetime
import json
import math
import pathlib
import re
import threading
import time
import urllib.request

SOURCE = 'Zcode billing/balance'
CODING_URL = 'https://bigmodel.cn/api/monitor/usage/quota/limit'


def number(value):
    if isinstance(value, bool) or value is None:
        return None
    try:
        value = float(value)
        return value if math.isfinite(value) and value >= 0 else None
    except (ValueError, TypeError):
        return None


def label(value, default=''):
    return value[:160] if isinstance(value, str) and value.strip() else default


def normalize_balance(payload, family):
    if (not isinstance(payload, dict) or type(payload.get('code')) is not int
            or payload.get('code') != 0 or not isinstance(payload.get('data'), dict)):
        raise ValueError('额度服务返回无效响应')
    data = payload['data']
    plans, balances = data.get('plans', []), data.get('balances', [])
    if not isinstance(plans, list) or not isinstance(balances, list):
        raise ValueError('额度服务返回无效结构')
    active = [p for p in plans if isinstance(p, dict) and p.get('status') == 'active']
    accounts = []
    for bucket in balances:
        if not isinstance(bucket, dict):
            continue
        plan = next((p for p in active if
                     (bucket.get('user_plan_id') and p.get('user_plan_id') == bucket['user_plan_id']) or
                     (not bucket.get('user_plan_id') and bucket.get('plan_id') and p.get('plan_id') == bucket['plan_id'])), None)
        if plan is None:
            continue
        unit = label(bucket.get('unit_type'), '单位未提供')
        metrics = [{'label': name, 'value': number(bucket.get(key)), 'unit': unit}
                   for name, key in [('剩余', 'remaining_units'), ('已用', 'used_units'), ('总额', 'total_units'),
                                     ('可用', 'available_units'), ('预留', 'reserved_units')]]
        accounts.append({'provider': 'BigModel' if family == 'bigmodel' else 'Z.ai',
                         'plan': label(plan.get('name'), '套餐名称未提供'),
                         'scope': label(bucket.get('show_name') or bucket.get('meter'), '账户共享额度'),
                         'metrics': metrics,
                         'resetAt': (number(bucket.get('period_end')) or 0) * 1000 or None,
                         'resetLabel': '周期结束', 'expiresAt': (number(bucket.get('expires_at')) or 0) * 1000 or None})
    return {'status': 'available' if accounts else 'unavailable', 'source': SOURCE,
            'accounts': accounts, 'serverTime': number(data.get('server_time')),
            'message': '远端账户共享额度；与当前委派通道的对应关系未确认。' if accounts else '当前账户未返回可归属的有效套餐余额。'}


def normalize_coding(payload):
    if (not isinstance(payload, dict) or type(payload.get('code')) is not int or payload.get('code') not in (0, 200)
            or payload.get('success') is False or not isinstance(payload.get('data'), dict)):
        raise ValueError('官方额度响应无效')
    data = payload['data']
    limits = data.get('limits')
    if not isinstance(limits, list):
        raise ValueError('官方额度缺少额度池')
    stamp = int(time.time() * 1000)
    accounts = []
    for limit in limits:
        if not isinstance(limit, dict):
            continue
        credit = limit.get('type') == 'CREDIT_LIMIT'
        unit = '积分' if credit else label(limit.get('type'), '单位未提供')
        window = {(3, 5): '5 小时额度', (6, 1): '每周额度'}.get((limit.get('unit'), limit.get('number')), '服务端额度池')
        accounts.append({'provider': 'BigModel', 'plan': 'Coding Plan · ' + label(data.get('level'), '等级未提供'),
                         'scope': window + ' · 当前委派通道', 'source': CODING_URL, 'updatedAt': stamp,
                         'status': 'available', 'metrics': [
                             {'label': title, 'value': number(limit.get(key)), 'unit': unit}
                             for title, key in [('剩余', 'remaining'), ('已用', 'currentValue'), ('总额', 'usage')]],
                         'resetAt': number(limit.get('nextResetTime'))})
    return {'status': 'available' if accounts else 'unavailable', 'source': CODING_URL,
            'accounts': accounts, 'message': '服务端实际额度；账户共享，非单任务费用。'}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def query_coding(provider_file):
    """Use the explicit delegate provider only, and never send its key to another host."""
    config = json.loads(pathlib.Path(provider_file).read_text(encoding='utf-8-sig'))['config']
    selection = config.get('defaultModelSelection', {})
    rule = next((r for r in config.get('providerConfigRules', {}).get('providerRules', [])
                 if r.get('providerId') == selection.get('providerId') and r.get('templateId') == 'bigmodel-api'), None)
    if rule is None or rule.get('config', {}).get('api'):
        raise ValueError('当前委派配置不是已验证的 BigModel Coding Plan 通道')
    access = rule['config'].get('access', {})
    key = access.get('apiKey')
    if access.get('type') != 'api-key' or not isinstance(key, str) or not key.strip():
        raise ValueError('当前委派凭据不可用')
    request = urllib.request.Request(CODING_URL, headers={'Authorization': key, 'Accept': 'application/json'})
    # Never copy credentials to a redirected host or include error bodies in UI/logs.
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=15) as response:
        raw = response.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise ValueError('官方额度响应过大')
    return normalize_coding(json.loads(raw))


def read_desktop_snapshot(folder):
    """Allowlisted projection of the latest official balance response already in Desktop logs."""
    decoder = json.JSONDecoder()
    for path in sorted(pathlib.Path(folder).glob('????-??-??.log'), reverse=True)[:3]:
        with path.open('rb') as stream:
            stream.seek(0, 2)
            size = stream.tell()
            stream.seek(max(0, size - 4 * 1024 * 1024))
            if size > 4 * 1024 * 1024:
                stream.readline()
            lines = stream.read().decode('utf-8', errors='replace').splitlines()
        for line in reversed(lines):
            if 'billing/balance' not in line or '{' not in line:
                continue
            match = re.match(r'\[(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3})\]', line)
            if match is None:
                continue
            try:
                entry, _ = decoder.raw_decode(line[line.index('{'):])
                provider = entry.get('providerId')
                if provider not in ('account:bigmodel-start-plan', 'account:zai-start-plan') or entry.get('success') is not True:
                    continue
                result = normalize_balance(entry.get('payload'), 'bigmodel' if 'bigmodel' in provider else 'zai')
                stamp = int(datetime.datetime.fromisoformat(match[1]).timestamp() * 1000)
                for account in result['accounts']:
                    account.update(source='Zcode 桌面官方余额快照', updatedAt=stamp,
                                   status='stale' if int(time.time()*1000)-stamp > 120000 else 'available')
                    account['scope'] += ' · 桌面套餐快照'
                result.update(source='Zcode 桌面官方余额快照', updatedAt=stamp,
                              status='stale' if int(time.time()*1000)-stamp > 120000 else result['status'],
                              message='桌面快照，非实时查询；在 Zcode Desktop 查看套餐余额后自动同步。')
                return result
            except (ValueError, TypeError, AttributeError):
                continue
    return {'status': 'unavailable', 'source': 'Zcode 桌面官方余额快照', 'accounts': [],
            'message': '未找到桌面官方额度快照；请在 Zcode Desktop 查看套餐余额。'}


def combine_sources(coding, desktop):
    accounts = coding.get('accounts', []) + desktop.get('accounts', [])
    states = [coding['status'], desktop['status']]
    status = ('available' if 'available' in states else 'stale' if accounts else
              'loading' if 'loading' in states else 'unavailable')
    return {'status': status, 'source': 'BigModel 官方接口 / Zcode 桌面快照', 'accounts': accounts,
            'updatedAt': max(coding.get('updatedAt') or 0, desktop.get('updatedAt') or 0) or None,
            'lastAttemptAt': max(coding.get('lastAttemptAt') or 0, desktop.get('lastAttemptAt') or 0) or None,
            'refreshAfter': min(v['refreshAfter'] for v in (coding, desktop) if v.get('refreshAfter')) if any(v.get('refreshAfter') for v in (coding, desktop)) else None,
            'message': ' '.join(v.get('message', '') for v in (coding, desktop))}


class QuotaCache:
    """Single remote query per cooldown; HTTP reads never wait for the network."""
    def __init__(self, query=None, ttl=60):
        self.query, self.ttl = query, ttl
        self._lock = threading.Lock()
        self._busy = False
        self._next = 0
        self._value = {'status': 'unavailable' if query is None else 'loading', 'source': SOURCE,
                       'updatedAt': None, 'lastAttemptAt': None, 'refreshAfter': None, 'accounts': [],
                       'message': '尚未连接官方额度来源。' if query is None else '正在读取官方额度。'}

    def get(self):
        with self._lock:
            if self.query is not None and not self._busy and time.monotonic() >= self._next:
                self._busy = True
                self._value['lastAttemptAt'] = int(time.time() * 1000)
                threading.Thread(target=self._refresh, daemon=True).start()
            return copy.deepcopy(self._value)

    def _refresh(self):
        try:
            result = self.query()
            with self._lock:
                self._value.update(result, updatedAt=result.get('updatedAt', int(time.time() * 1000)))
        except Exception:
            with self._lock:
                self._value.update(status='stale' if self._value['accounts'] else 'unavailable',
                                   message='官方额度暂不可读；保留上次数据，稍后自动重试。')
                for account in self._value['accounts']:
                    account['status'] = 'stale'
        finally:
            with self._lock:
                self._busy = False
                self._next = time.monotonic() + self.ttl
                self._value['refreshAfter'] = int((time.time() + self.ttl) * 1000)


class QuotaSources:
    def __init__(self, provider_file, desktop_logs):
        self.provider_file = pathlib.Path(provider_file) if provider_file else None
        self.desktop = QuotaCache(lambda: read_desktop_snapshot(desktop_logs))
        self.coding = QuotaCache()
        self._fingerprint = None
        self._lock = threading.Lock()

    def get(self):
        # A changed/missing provider must not retain an old account's balance as the current channel.
        with self._lock:
            try:
                stat = self.provider_file.stat() if self.provider_file else None
                fingerprint = (stat.st_mtime_ns, stat.st_size) if stat else None
            except OSError:
                fingerprint = None
            if fingerprint != self._fingerprint:
                self._fingerprint = fingerprint
                self.coding = QuotaCache((lambda: query_coding(self.provider_file)) if fingerprint else None)
            return combine_sources(self.coding.get(), self.desktop.get())
