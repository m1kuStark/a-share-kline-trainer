"""zcode_usage 定向测试：官方 session/usage 查询、边界与缓存行为；无账号数据，全部使用本地假CLI。"""
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import monitor
import zcode_usage

# 假 app-server：仅接受 session/usage 方法，按 FAKE_MODE 模拟各类响应行为。
FAKE_CLI = r'''
const fs = require('fs');
const base = __filename.slice(0, -'.cjs'.length);
try { fs.writeFileSync(base + '.pid', String(process.pid)); } catch (e) {}
const mode = process.env.FAKE_MODE || 'ok';
const counts = {};
const usageFor = (sid) => ({ sessionId: sid, inputTokens: 11, outputTokens: 7, totalTokens: 18,
  reasoningTokens: 3, cacheReadTokens: 100, cacheCreationTokens: 5, modelRequestCount: 2,
  modelErrorCount: 0, inputBaselineBySource: { secretBaseline: 1 },
  headers: { authorization: 'SECRET-TOKEN' }, model: 'GLM-5.3-Flash', unknownFutureField: 'mystery' });
const reply = (id, body) => { process.stdout.write(JSON.stringify(Object.assign({ id: id }, body)) + '\n'); };
const refuse = () => { fs.writeFileSync(base + '.badmethod', 'x'); process.exit(3); };
const readline = require('readline').createInterface({ input: process.stdin });
readline.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch (e) { return; }
  if (msg.method !== 'session/usage') { refuse(); return; }
  const sid = msg.params && msg.params.sessionId;
  counts[sid] = (counts[sid] || 0) + 1;
  fs.writeFileSync(base + '.counts', JSON.stringify(counts));
  if (mode === 'notifications') {
    process.stdout.write(JSON.stringify({ method: 'session.updated', params: { sessionId: sid } }) + '\n');
    process.stdout.write('this is not json\n');
    reply(msg.id, { result: usageFor(sid) });
  } else if (mode === 'error') {
    reply(msg.id, { error: { code: -32000, message: 'SECRET-ERROR-DETAIL' } });
  } else if (mode === 'mixed') {
    if (String(sid).indexOf('bad') >= 0) { reply(msg.id, { error: { code: -32000, message: 'SECRET-ERROR-DETAIL' } }); }
    else { reply(msg.id, { result: usageFor(sid) }); }
  } else if (mode === 'garbage') {
    process.stdout.write('}broken json\n');
    reply(msg.id, { result: 'not-an-object' });
  } else if (mode === 'spam') {
    const pad = new Array(65536).join('x');
    // 故意不随 stdin EOF 停止：真实洪泛只因进程被终止而结束
    setInterval(() => {
      process.stdout.write(JSON.stringify({ method: 'noise', params: pad }) + '\n');
    }, 5);
  } else if (mode === 'hang') {
    setInterval(() => {}, 1000);
  } else {
    reply(msg.id, { result: usageFor(sid) });
  }
});
'''


class NormalizeTests(unittest.TestCase):
    def test_measured_zero_is_preserved_and_invalid_values_are_not_zeros(self):
        record = zcode_usage._record({'inputTokens': 0, 'modelErrorCount': 0}, zcode_usage.STATUS_AVAILABLE)
        self.assertEqual(0, record['inputTokens'])
        self.assertEqual(0, record['modelErrorCount'])
        self.assertIsNone(record['outputTokens'])
        record = zcode_usage._record({'inputTokens': True, 'outputTokens': -3, 'totalTokens': float('nan'),
                                      'reasoningTokens': float('inf'), 'cacheReadTokens': '12',
                                      'cacheCreationTokens': 2.5}, zcode_usage.STATUS_AVAILABLE)
        for key in ('inputTokens', 'outputTokens', 'totalTokens', 'reasoningTokens', 'cacheReadTokens'):
            self.assertIsNone(record[key], key)
        self.assertEqual(2.5, record['cacheCreationTokens'])

    def test_total_tokens_come_from_source_and_are_never_derived(self):
        record = zcode_usage._record({'inputTokens': 10, 'outputTokens': 5}, zcode_usage.STATUS_AVAILABLE)
        self.assertIsNone(record['totalTokens'])
        record = zcode_usage._record({'inputTokens': 10, 'outputTokens': 5, 'totalTokens': 15},
                                     zcode_usage.STATUS_AVAILABLE)
        self.assertEqual(15, record['totalTokens'])

    def test_record_exposes_only_the_known_field_set(self):
        record = zcode_usage._record({'sessionId': 'sess_x', 'model': 'GLM-5.3-Flash',
                                      'inputBaselineBySource': {'a': 1}, 'headers': {'authorization': 'SECRET'},
                                      'unknown': 1}, zcode_usage.STATUS_AVAILABLE)
        self.assertEqual({'status', 'source', 'scope', 'updatedAt', 'inputTokens', 'outputTokens', 'totalTokens',
                          'reasoningTokens', 'cacheReadTokens', 'cacheCreationTokens', 'modelRequestCount',
                          'modelErrorCount'}, set(record))
        self.assertNotIn('message', record)
        self.assertEqual('Zcode CLI session/usage', record['source'])
        self.assertEqual('session', record['scope'])
        self.assertIsInstance(record['updatedAt'], int)

    def test_unavailable_record_keeps_message_sanitized(self):
        record = zcode_usage._record(None, zcode_usage.STATUS_UNAVAILABLE, 'CLI返回查询错误')
        self.assertIsNone(record['inputTokens'])
        self.assertEqual('CLI返回查询错误', record['message'])
        self.assertNotIn('SECRET', json.dumps(record, ensure_ascii=False))

    def test_unique_ids_keep_valid_strings_once(self):
        self.assertEqual(['a', 'b'], zcode_usage._unique_ids(['a', ' a ', 'b', 'a', '', 5, None]))
        self.assertEqual([], zcode_usage._unique_ids([None, 7]))
        self.assertEqual([], zcode_usage._unique_ids(None))


@unittest.skipUnless(os.name == 'nt' and shutil.which('node'), 'Windows Node runner')
class QuerySessionsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.cli = self.root / 'fake-cli.cjs'
        self.cli.write_text(FAKE_CLI, encoding='utf-8')

    def tearDown(self):
        self.terminate_leftovers()
        self.temp.cleanup()

    def pid(self):
        try:
            return int((self.root / 'fake-cli.pid').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return None

    def terminate_leftovers(self):
        pid = self.pid()
        if pid and monitor.process_alive(pid):
            subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'], capture_output=True)

    def counts(self):
        try:
            return json.loads((self.root / 'fake-cli.counts').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return {}

    def assert_dead(self, pid, seconds=8):
        deadline = time.time() + seconds
        while monitor.process_alive(pid) and time.time() < deadline:
            time.sleep(0.2)
        self.assertFalse(monitor.process_alive(pid))

    def test_batch_query_correlates_ids_and_ignores_notifications(self):
        records = zcode_usage.query_sessions(self.cli, ['sess_a', 'sess_b'], timeout=15)
        self.assertEqual(['sess_a', 'sess_b'], sorted(records))
        for sid in ('sess_a', 'sess_b'):
            record = records[sid]
            self.assertEqual('available', record['status'])
            self.assertEqual(18, record['totalTokens'])
            self.assertEqual(11, record['inputTokens'])
            self.assertEqual(7, record['outputTokens'])
            self.assertEqual(2, record['modelRequestCount'])
            self.assertEqual(0, record['modelErrorCount'])
            text = json.dumps(record, ensure_ascii=False)
            for secret in ('SECRET', 'inputBaselineBySource', 'mystery', 'headers'):
                self.assertNotIn(secret, text)
        self.assertFalse((self.root / 'fake-cli.badmethod').exists())

    @patch.dict(os.environ, {'FAKE_MODE': 'mixed'})
    def test_cli_error_and_measured_zero_are_distinguishable(self):
        records = zcode_usage.query_sessions(self.cli, ['sess_good', 'sess_bad'], timeout=15)
        self.assertEqual('available', records['sess_good']['status'])
        self.assertEqual(0, records['sess_good']['modelErrorCount'])
        failed = records['sess_bad']
        self.assertEqual('unavailable', failed['status'])
        for key in zcode_usage.COUNTER_KEYS:
            self.assertIsNone(failed[key], key)
        self.assertNotIn('SECRET-ERROR-DETAIL', json.dumps(records, ensure_ascii=False))

    @patch.dict(os.environ, {'FAKE_MODE': 'garbage'})
    def test_malformed_result_reports_unavailable_without_fabricated_counts(self):
        records = zcode_usage.query_sessions(self.cli, ['sess_x'], timeout=15)
        record = records['sess_x']
        self.assertEqual('unavailable', record['status'])
        for key in zcode_usage.COUNTER_KEYS:
            self.assertIsNone(record[key], key)

    def test_duplicate_ids_are_queried_once(self):
        records = zcode_usage.query_sessions(self.cli, ['sess_a', 'sess_a', 'sess_b'], timeout=15)
        self.assertEqual(['sess_a', 'sess_b'], list(records))
        self.assertEqual({'sess_a': 1, 'sess_b': 1}, self.counts())

    @patch.dict(os.environ, {'FAKE_MODE': 'hang'})
    def test_hanging_server_is_bounded_and_leaves_no_zombie(self):
        started = time.monotonic()
        records = zcode_usage.query_sessions(self.cli, ['sess_hang'], timeout=3)
        self.assertLess(time.monotonic() - started, 15)
        record = records['sess_hang']
        self.assertEqual('unavailable', record['status'])
        self.assertEqual(zcode_usage.MSG_TIMEOUT, record['message'])
        pid = self.pid()
        self.assertIsNotNone(pid)
        self.assert_dead(pid)

    @patch.dict(os.environ, {'FAKE_MODE': 'spam'})
    def test_output_flood_is_bounded_and_server_stopped(self):
        started = time.monotonic()
        records = zcode_usage.query_sessions(self.cli, ['sess_flood'], timeout=6)
        self.assertLess(time.monotonic() - started, 15)
        record = records['sess_flood']
        self.assertEqual('unavailable', record['status'])
        self.assertEqual(zcode_usage.MSG_OVERFLOW, record['message'])
        pid = self.pid()
        self.assertIsNotNone(pid)
        self.assert_dead(pid)


class ServerCommandTests(unittest.TestCase):
    def setUp(self):
        self.env_patch = patch.dict(os.environ, {}, clear=True)
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.cli = self.root / 'servers' / 'server'
        self.cli.parent.mkdir(parents=True, exist_ok=True)
        self.cli.write_text('placeholder', encoding='utf-8')

    def tearDown(self):
        self.temp.cleanup()

    def builtin(self):
        path = self.root / 'config' / 'provider' / 'zcode-builtin.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('{}', encoding='utf-8')
        return path

    @patch('pathlib.Path.home')
    def test_builtin_env_points_beside_selected_cli(self, mock_home):
        mock_home.return_value = self.root
        builtin = self.builtin()
        command, env = zcode_usage._server_command(self.cli)
        self.assertEqual([str(self.cli), 'app-server'], command)
        self.assertEqual(str(builtin.resolve()), env.get('ZCODE_BUILTIN_PROVIDER_CONFIG_FILE'))
        self.assertEqual(str(builtin.resolve()), env.get('ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE'))

    @patch('pathlib.Path.home')
    def test_missing_builtin_config_is_left_unset(self, mock_home):
        mock_home.return_value = self.root
        _, env = zcode_usage._server_command(self.cli)
        self.assertFalse('ZCODE_BUILTIN_PROVIDER_CONFIG_FILE' in env)

    @patch('pathlib.Path.home')
    def test_personal_provider_defaults_to_official_v2_file(self, mock_home):
        mock_home.return_value = self.root
        personal = self.root / '.zcode' / 'v2' / 'provider_config.json'
        personal.parent.mkdir(parents=True, exist_ok=True)
        personal.write_text('{}', encoding='utf-8')
        self.builtin()
        _, env = zcode_usage._server_command(self.cli)
        self.assertEqual(str(personal), env.get('ZCODE_PERSONAL_PROVIDER_CONFIG_FILE'))

    @patch('pathlib.Path.home')
    def test_provided_personal_provider_is_never_overridden(self, mock_home):
        mock_home.return_value = self.root
        personal = self.root / '.zcode' / 'v2' / 'provider_config.json'
        personal.parent.mkdir(parents=True, exist_ok=True)
        personal.write_text('{}', encoding='utf-8')
        self.builtin()
        with patch.dict(os.environ, {'ZCODE_PERSONAL_PROVIDER_CONFIG_FILE': 'custom.json'}):
            _, env = zcode_usage._server_command(self.cli)
        self.assertEqual('custom.json', env.get('ZCODE_PERSONAL_PROVIDER_CONFIG_FILE'))

    @patch('pathlib.Path.home')
    def test_absent_personal_v2_file_is_not_invented(self, mock_home):
        mock_home.return_value = self.root
        _, env = zcode_usage._server_command(self.cli)
        self.assertFalse('ZCODE_PERSONAL_PROVIDER_CONFIG_FILE' in env)


class CacheTests(unittest.TestCase):
    def cache(self, fn, ttl):
        return zcode_usage.UsageCache('fake-cli', ttl=ttl, query_fn=fn)

    def test_first_get_is_nonblocking_single_flight_then_available(self):
        calls = []

        def slow(ids):
            calls.append(list(ids))
            time.sleep(0.2)
            return {sid: zcode_usage._record({'totalTokens': 5, 'inputTokens': 4}, 'available') for sid in ids}

        cache = self.cache(slow, ttl=0.3)
        started = time.monotonic()
        value = cache.get(['sess_a', 'sess_b'])
        self.assertLess(time.monotonic() - started, 0.4)
        self.assertEqual('loading', value['status'])
        self.assertEqual(set(), set(value['sessions']))
        self.assertEqual(1, len(calls))
        value = cache.get(['sess_a'])
        self.assertEqual(1, len(calls))  # single flight：进行中的查询不会被再次触发
        time.sleep(0.35)
        value = cache.get(['sess_a', 'sess_b'])
        self.assertEqual('available', value['status'])
        self.assertEqual(5, value['sessions']['sess_a']['totalTokens'])
        self.assertIsInstance(value['updatedAt'], int)
        self.assertEqual(1, len(calls))  # 冷却期内的新鲜数据不再查询
        time.sleep(0.4)
        value = cache.get(['sess_a', 'sess_b'])  # 过期后重新查询
        self.assertEqual(2, len(calls))
        self.assertEqual('stale', value['status'])
        time.sleep(0.3)
        value = cache.get(['sess_a', 'sess_b'])
        self.assertEqual('available', value['status'])

    def test_only_requested_ids_returned_and_unique_ids_queried(self):
        seen = []

        def fn(ids):
            seen.append(list(ids))
            records = {sid: zcode_usage._record({'totalTokens': 9}, 'available') for sid in ids}
            records['sess_ghost'] = zcode_usage._record({'totalTokens': 1}, 'available')
            return records

        cache = self.cache(fn, ttl=60)
        cache.get(['sess_a', 'sess_a', 'sess_b'])
        time.sleep(0.1)
        value = cache.get(['sess_a', 'sess_b'])
        self.assertEqual(['sess_a', 'sess_b'], sorted(value['sessions']))
        self.assertEqual([['sess_a', 'sess_b']], seen)

    def test_failure_preserves_previous_measurements_as_stale(self):
        calls = []

        def flaky(ids):
            calls.append(list(ids))
            if len(calls) == 1:
                return {sid: zcode_usage._record({'totalTokens': 42, 'inputTokens': 40}, 'available')
                        for sid in ids}
            return {sid: zcode_usage._record(None, 'unavailable', zcode_usage.MSG_CLI_ERROR) for sid in ids}

        cache = self.cache(flaky, ttl=0.3)
        cache.get(['sess_a'])
        time.sleep(0.1)
        value = cache.get(['sess_a'])
        self.assertEqual('available', value['status'])
        self.assertEqual(42, value['sessions']['sess_a']['totalTokens'])
        time.sleep(0.4)
        value = cache.get(['sess_a'])  # 第二次查询失败，保留旧测量并标记 stale
        self.assertEqual('stale', value['status'])
        time.sleep(0.05)
        value = cache.get(['sess_a'])
        self.assertEqual('stale', value['status'])
        self.assertEqual(42, value['sessions']['sess_a']['totalTokens'])
        self.assertEqual('stale', value['sessions']['sess_a']['status'])
        self.assertEqual(2, len(calls))  # 失败不触发反复进程轮询

    def test_stale_cache_labels_each_session_stale_with_original_updated_at(self):
        def fresh(ids):
            return {sid: zcode_usage._record({'totalTokens': 7, 'inputTokens': 6}, 'available')
                    for sid in ids}

        cache = self.cache(fresh, ttl=0.3)
        cache.get(['sess_a'])
        time.sleep(0.1)
        value = cache.get(['sess_a'])
        self.assertEqual('available', value['sessions']['sess_a']['status'])
        original_updated_at = value['sessions']['sess_a']['updatedAt']
        time.sleep(0.4)
        value = cache.get(['sess_a'])
        self.assertEqual('stale', value['status'])
        record = value['sessions']['sess_a']
        self.assertEqual('stale', record['status'])
        self.assertEqual(original_updated_at, record['updatedAt'])
        self.assertEqual(7, record['totalTokens'])

    def test_missing_cli_reports_unavailable_configuration_without_query(self):
        calls = []

        def fn(ids):
            calls.append(list(ids))
            return {}

        cache = zcode_usage.UsageCache(None, ttl=60, query_fn=fn)
        value = cache.get(['sess_a'])
        self.assertEqual('unavailable', value['status'])
        self.assertIn('CLI', value['message'])
        self.assertEqual('unavailable', value['sessions']['sess_a']['status'])
        self.assertEqual([], calls)

    def test_concurrent_get_is_safe(self):
        gate = threading.Event()

        def fn(ids):
            gate.wait(1.0)
            return {sid: zcode_usage._record({'totalTokens': 3}, 'available') for sid in ids}

        cache = self.cache(fn, ttl=60)
        results = []

        def worker():
            results.append(cache.get(['sess_a']))

        threads = [threading.Thread(target=worker) for _ in range(6)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(5)
        self.assertEqual(6, len(results))
        self.assertTrue(all(item['status'] in ('loading', 'available') for item in results))

    def test_empty_id_list_is_handled_without_query(self):
        calls = []

        def fn(ids):
            calls.append(list(ids))
            return {}

        cache = self.cache(fn, ttl=60)
        value = cache.get(['  ', None])
        self.assertEqual('unavailable', value['status'])
        self.assertEqual({}, value['sessions'])
        self.assertEqual([], calls)


if __name__ == '__main__':
    unittest.main()
