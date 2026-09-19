import json
import os
import pathlib
import sqlite3
import tempfile
import shutil
import unittest
from unittest.mock import patch

import monitor
import run_glm
from types import SimpleNamespace


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.database = self.root / 'cli.sqlite'
        with sqlite3.connect(self.database) as db:
            db.executescript('''
              create table session(id text,directory text,title text,time_created int,time_updated int);
              create table part(id text,session_id text,time_created int,time_updated int,data text);
              create table model_usage(session_id text,status text,model_id text,started_at int,first_token_at int,completed_at int,error_message text);
            ''')
            db.execute('insert into session values(?,?,?,?,?)', ('ours', str(self.root / 'task'), 'task', 1000, 2000))
            db.execute('insert into session values(?,?,?,?,?)', ('other', '/private', 'PRIVATE TASK', 1000, 9000))
            db.execute('insert into part values(?,?,?,?,?)', ('p', 'ours', 1500, 1800, json.dumps({'type': 'tool', 'tool': 'Bash', 'state': {'status': 'completed', 'input': {'description': '运行定向测试', 'command': 'secret command'}, 'output': 'private output'}})))
            db.execute('insert into part values(?,?,?,?,?)', ('r', 'ours', 1600, 1900, json.dumps({'type': 'reasoning', 'text': 'hidden reasoning'})))
        self.registry = self.root / 'jobs'
        self.registry.mkdir()
        self.job = {'id': 'job1', 'title': '测试任务', 'worktree': str(self.root / 'task'), 'sessionId': 'ours', 'state': 'completed', 'startedAt': 1000, 'finishedAt': 2000}
        self.write_job()

    def write_job(self):
        (self.registry / 'job1.json').write_text(json.dumps(self.job), encoding='utf-8')

    def tearDown(self):
        self.temp.cleanup()

    def test_only_registered_session_and_safe_activity_are_returned(self):
        value = monitor.snapshot(self.registry, self.database)
        text = json.dumps(value, ensure_ascii=False)
        self.assertIn('运行定向测试', text)
        for secret in ['PRIVATE TASK', 'secret command', 'private output', 'hidden reasoning']:
            self.assertNotIn(secret, text)
        self.assertEqual(value['jobs'][0]['phase'], 'awaiting_review')

    def test_unknown_or_mismatched_session_cannot_expose_other_project(self):
        self.job['sessionId'] = 'other'
        self.write_job()
        item = monitor.snapshot(self.registry, self.database)['jobs'][0]
        self.assertEqual(item['activity'], [])
        self.assertIn('不匹配', item['warning'])

    @patch('monitor.process_alive', return_value=False)
    def test_dead_process_is_interrupted_not_running(self, _):
        self.job.update(state='running', pid=123)
        self.write_job()
        self.assertEqual(monitor.snapshot(self.registry, self.database)['jobs'][0]['phase'], 'interrupted')

    @patch('monitor.process_alive', return_value=True)
    def test_active_process_without_new_events_stays_running(self, _):
        self.job.update(state='running', pid=123)
        self.write_job()
        self.assertEqual(monitor.snapshot(self.registry, self.database)['jobs'][0]['phase'], 'running')

    def test_review_result_is_distinct_from_model_completion(self):
        self.job['review'] = {'state': 'passed', 'summary': '定向测试通过，等待集成'}
        self.write_job()
        self.assertEqual(monitor.snapshot(self.registry, self.database)['jobs'][0]['phase'], 'reviewed')

    def test_redaction(self):
        result = monitor.redact('Authorization: Bearer SECRET123\napi_key=supersecret\nordinary text')
        self.assertNotIn('SECRET123', result)
        self.assertNotIn('supersecret', result)
        self.assertIn('ordinary text', result)

    def test_missing_database_preserves_job_and_explains_gap(self):
        item = monitor.snapshot(self.registry, self.root / 'missing')['jobs'][0]
        self.assertEqual(item['title'], '测试任务')
        self.assertIn('数据库', item['warning'])

    def test_atomic_registry_update_and_completed_result(self):
        log = self.root / 'output.log'
        log.write_text('startup\n' + json.dumps({'sessionId': 'ours', 'response': '开发完成，需验收'}), encoding='utf-8')
        result = monitor.read_result(log)
        self.assertEqual(result['sessionId'], 'ours')
        self.assertEqual(result['response'], '开发完成，需验收')
        monitor.atomic_write(self.root / 'state.json', {'state': 'completed'})
        self.assertEqual(json.loads((self.root / 'state.json').read_text())['state'], 'completed')

    def test_reused_batch_does_not_overwrite_prior_evidence(self):
        prior = (self.registry / 'job1.json').read_text()
        with self.assertRaisesRegex(ValueError, 'already exists'):
            run_glm.run(SimpleNamespace(home=self.root, batch='job1'))
        self.assertEqual((self.registry / 'job1.json').read_text(), prior)

    def test_second_runner_cannot_take_live_lock(self):
        lock = self.root / 'worker.lock'
        lock.write_text('existing owner', encoding='utf-8')
        with self.assertRaises(FileExistsError):
            run_glm.run(SimpleNamespace(home=self.root, batch='new-task', title='test', cwd=self.root, log=self.root / 'log'))
        self.assertEqual(lock.read_text(), 'existing owner')

    @unittest.skipUnless(os.name == 'nt' and shutil.which('node'), 'Windows Node runner')
    @patch('run_glm.subprocess.check_output', return_value='task/fixture\n')
    def test_runner_persists_real_child_completion_and_wake_marker(self, _):
        cli = self.root / 'resources/glm/mock.cjs'
        cli.parent.mkdir(parents=True)
        cli.write_text('console.log(JSON.stringify({sessionId:"fixture",response:"finished"}))')
        builtin = self.root / 'resources/config/provider/zcode-builtin.json'
        builtin.parent.mkdir(parents=True)
        builtin.write_text('{}')
        provider = self.root / 'provider.json'
        provider.write_text(json.dumps({'config': {'defaultModelSelection': {'modelId': 'GLM-5.3-Flash', 'options': {'reasoningLevel': 'max'}}, 'modelConfigRules': {'manualProviderModelRules': []}}}))
        prompt = self.root / 'prompt.md'
        prompt.write_text('bounded test')
        args = SimpleNamespace(home=self.root, batch='fixture', title='测试', cwd=self.root, log=self.root / 'fixture.log', prompt=prompt, provider=provider, cli=cli, node=shutil.which('node'), resume=None, wake_state=self.root / 'wake.json')
        self.assertEqual(run_glm.run(args), 0)
        state = json.loads((self.registry / 'fixture.json').read_text(encoding='utf-8'))
        self.assertEqual(state['state'], 'completed')
        self.assertEqual(state['response'], 'finished')
        self.assertEqual(json.loads(args.wake_state.read_text(encoding='utf-8'))['batch'], 'fixture')
        self.assertFalse((self.root / 'worker.lock').exists())


if __name__ == '__main__':
    unittest.main()
