"""Quota values are remote measurements, never locally estimated balances."""
import importlib.util
import pathlib
import json
import tempfile
import threading
import time
import unittest

SPEC = importlib.util.find_spec('quota')
if SPEC:
    import quota
else:
    quota = None


class QuotaContractTests(unittest.TestCase):
    def test_coding_plan_keeps_remote_remaining_even_when_rounding_differs(self):
        self.assertTrue(hasattr(quota, 'normalize_coding'), 'coding plan adapter is missing')
        result = quota.normalize_coding({'success': True, 'code': 200, 'data': {'level': 'pro', 'limits': [
            {'type': 'CREDIT_LIMIT', 'unit': 3, 'number': 5, 'usage': 12000, 'currentValue': 157,
             'remaining': 11842, 'percentage': 1, 'nextResetTime': 1790335654966}]}})
        row = result['accounts'][0]
        self.assertEqual(row['scope'], '5 小时额度 · 当前委派通道')
        self.assertEqual(row['metrics'][0], {'label': '剩余', 'value': 11842, 'unit': '积分'})
        self.assertEqual(row['resetAt'], 1790335654966)

    def test_desktop_snapshot_retains_original_time_not_file_mtime(self):
        self.assertTrue(hasattr(quota, 'read_desktop_snapshot'), 'desktop snapshot adapter is missing')
        with tempfile.TemporaryDirectory() as directory:
            payload = {'code': 0, 'data': {'plans': [{'plan_id': 'p', 'status': 'active', 'name': 'Token Plan'}],
                'balances': [{'plan_id': 'p', 'unit_type': 'token', 'remaining_units': 123}]}}
            entry = {'providerId': 'account:bigmodel-start-plan', 'success': True, 'payload': payload,
                     'Authorization': 'do-not-echo'}
            line = '[2026-09-25 14:56:45.616] [info] [usage-stats] billing/balance 请求完成 ' + json.dumps(entry)
            pathlib.Path(directory, '2026-09-25.log').write_text(line, encoding='utf-8')
            result = quota.read_desktop_snapshot(pathlib.Path(directory))
            self.assertEqual(result['accounts'][0]['metrics'][0]['value'], 123)
            self.assertIn('桌面', result['accounts'][0]['source'])
            self.assertNotIn('do-not-echo', str(result))
            self.assertLess(result['accounts'][0]['updatedAt'], int(time.time()*1000))

    def test_remote_numbers_and_original_units_not_local_arithmetic(self):
        self.assertIsNotNone(quota, 'remote quota adapter is missing')
        payload = {'code': 0, 'data': {'server_time': 1790000000,
            'plans': [{'plan_id': 'p1', 'status': 'active', 'name': 'Token Plan'}],
            'balances': [{'plan_id': 'p1', 'unit_type': 'credit', 'meter': 'model_usage',
                'total_units': '1000', 'used_units': '10', 'remaining_units': '987',
                'available_units': 980, 'reserved_units': 7, 'period_end': 1790100000,
                'show_name': 'GLM', 'secret': 'never-expose'}]}}
        result = quota.normalize_balance(payload, 'bigmodel')
        self.assertEqual(result['status'], 'available')
        record = result['accounts'][0]
        metrics = {v['label']: v for v in record['metrics']}
        self.assertEqual(metrics['剩余']['value'], 987)
        self.assertEqual(metrics['剩余']['unit'], 'credit')
        self.assertNotIn('secret', str(result))
        self.assertEqual(record['plan'], 'Token Plan')

    def test_missing_is_unknown_zero_is_measured_and_orphans_not_claimed(self):
        self.assertIsNotNone(quota, 'remote quota adapter is missing')
        payload = {'code': 0, 'data': {'plans': [{'plan_id': 'p', 'status': 'active', 'name': 'Token Plan'}],
            'balances': [{'plan_id': 'p', 'remaining_units': 0}, {'plan_id': 'alien', 'remaining_units': 9}]}}
        result = quota.normalize_balance(payload, 'bigmodel')
        self.assertEqual(len(result['accounts']), 1)
        metrics = {v['label']: v for v in result['accounts'][0]['metrics']}
        self.assertEqual(metrics['剩余']['value'], 0)
        self.assertIsNone(metrics['已用']['value'])
        self.assertEqual(metrics['剩余']['unit'], '单位未提供')

    def test_failure_never_echoes_server_message_or_credentials(self):
        self.assertIsNotNone(quota, 'remote quota adapter is missing')
        for payload in ({'code': 401, 'msg': 'Bearer hidden-secret'}, {'code': 0, 'data': []}, {'code': False, 'data': {}}):
            with self.assertRaises(ValueError) as caught:
                quota.normalize_balance(payload, 'bigmodel')
            self.assertNotIn('hidden-secret', str(caught.exception))

    def test_expiry_is_not_reported_as_refill(self):
        row = quota.normalize_balance({'code': 0, 'data': {'plans': [{'plan_id': 'p', 'status': 'active'}],
            'balances': [{'plan_id': 'p', 'remaining_units': 1, 'expires_at': 2000000000}]}}, 'bigmodel')['accounts'][0]
        self.assertIsNone(row['resetAt'])

    def test_cache_is_nonblocking_single_flight_and_retains_stale_measurement(self):
        self.assertIsNotNone(quota, 'remote quota adapter is missing')
        started, release = threading.Event(), threading.Event()
        calls = []
        def query():
            calls.append(1)
            started.set()
            release.wait(2)
            if len(calls) > 1:
                raise ValueError('must-not-leak-secret')
            return {'status': 'available', 'source': 'official', 'accounts': [{'plan': 'Token Plan'}]}
        cache = quota.QuotaCache(query, ttl=0.08)
        self.assertEqual(cache.get()['status'], 'loading')
        self.assertTrue(started.wait(1))
        for _ in range(10):
            cache.get()
        self.assertEqual(len(calls), 1)
        release.set()
        deadline = time.monotonic() + 2
        while cache.get()['status'] == 'loading' and time.monotonic() < deadline:
            time.sleep(0.005)
        self.assertEqual(cache.get()['accounts'][0]['plan'], 'Token Plan')
        time.sleep(0.1)
        cache.get()
        deadline = time.monotonic() + 2
        while len(calls) < 2 and time.monotonic() < deadline:
            time.sleep(0.005)
        time.sleep(0.01)
        value = cache.get()
        self.assertEqual(value['status'], 'stale')
        self.assertEqual(value['accounts'][0]['plan'], 'Token Plan')
        self.assertEqual(value['accounts'][0]['status'], 'stale')
        self.assertNotIn('must-not-leak', str(value))

    def test_sources_do_not_hide_desktop_when_coding_is_unavailable(self):
        self.assertTrue(hasattr(quota, 'combine_sources'), 'independent sources are missing')
        result = quota.combine_sources({'status': 'unavailable', 'accounts': [], 'message': 'coding failure'},
                                       {'status': 'stale', 'accounts': [{'plan': 'Desktop', 'status': 'stale'}], 'updatedAt': 1000})
        self.assertEqual(result['accounts'][0]['plan'], 'Desktop')
        self.assertEqual(result['status'], 'stale')
        self.assertIn('coding failure', result['message'])


if __name__ == '__main__':
    unittest.main()
