import json
import os
import pathlib
import sqlite3
import tempfile
import shutil
import subprocess
import sys
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

    def test_snapshot_exposes_canonical_workflow_state_when_configured(self):
        control = self.root / 'control'
        control.mkdir()
        (control / 'trainer-state.json').write_text(json.dumps({
            'schema_version': 1, 'state_revision': 3, 'project_id': 'a-share-kline-trainer',
            'active_task': 'TASK-01', 'tasks': {}, 'candidate': None, 'candidates': {},
            'runs': {}, 'artifacts': {},
            'acceptance': {'engineering': 'unknown', 'user': 'unknown', 'publish': 'unknown'},
            'events': [], 'reconcile': {'status': 'clean', 'checked_at': '2026-10-01T00:00:00Z'},
            'next_action': 'wait', 'updated_at': '2026-10-01T00:00:00Z'}, ensure_ascii=False), encoding='utf-8')
        with patch.dict(os.environ, {'TRAINER_CONTROL_ROOT': str(control)}):
            value = monitor.snapshot(self.registry, self.database)
        self.assertEqual(value['workflowState']['state_revision'], 3)
        self.assertEqual(value['workflowState']['active_task'], 'TASK-01')

    def test_only_registered_session_and_safe_activity_are_returned(self):
        value = monitor.snapshot(self.registry, self.database)
        text = json.dumps(value, ensure_ascii=False)
        self.assertIn('运行定向测试', text)
        for secret in ['PRIVATE TASK', 'secret command', 'private output', 'hidden reasoning']:
            self.assertNotIn(secret, text)
        self.assertEqual(value['jobs'][0]['phase'], 'awaiting_review')

    def test_session_and_media_metadata_are_explicit_and_minimized(self):
        self.assertEqual(monitor.snapshot(self.registry, self.database)['jobs'][0].get('sessionMode'), 'unknown')
        self.job.update(sessionMode='resume', resumedFrom='ours', cliVersion='0.16.9',
                        attachments=['D:/private-folder/chart.png'], attachmentCount=1)
        self.write_job()
        row = monitor.snapshot(self.registry, self.database)['jobs'][0]
        self.assertEqual(row['sessionMode'], 'resume')
        self.assertEqual(row['resumedFrom'], 'ours')
        self.assertEqual(row['attachments'], ['chart.png'])
        self.assertEqual(row['attachmentCount'], 1)
        self.assertNotIn('private-folder', str(row))

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

    @patch('monitor.process_alive', return_value=True)
    def test_followup_link_preserves_historical_review(self, _):
        self.job.update(review={'state': 'changes_requested', 'summary': 'old finding'}, followupId='fix')
        self.write_job()
        fix = {**self.job, 'id': 'fix', 'state': 'running', 'pid': 123, 'review': None, 'followupId': None}
        fix.pop('review')
        (self.registry / 'fix.json').write_text(json.dumps(fix), encoding='utf-8')
        original = next(j for j in monitor.snapshot(self.registry, self.database)['jobs'] if j['id'] == 'job1')
        self.assertEqual(original['phase'], 'needs_changes')
        self.assertEqual(original['followup']['phase'], 'running')
        (self.registry / 'fix.json').unlink()
        self.assertIsNone(monitor.snapshot(self.registry, self.database)['jobs'][0]['followup'])

    def write_registry_job(self, name, drop=(), **overrides):
        job = {**self.job, 'id': name, 'title': name, **overrides}
        for field in drop:
            job.pop(field, None)
        (self.registry / (name + '.json')).write_text(json.dumps(job), encoding='utf-8')
        return job

    def jobs_by_id(self):
        return {job['id']: job for job in monitor.snapshot(self.registry, self.database)['jobs']}

    @patch('monitor.process_alive', return_value=True)
    def test_three_hop_chain_keeps_raw_history_and_points_to_running_tip(self, _):
        self.job.update(state='failed', exitCode=1, review={'state': 'changes_requested', 'summary': 'round1 finding'}, followupId='cand2')
        self.write_job()
        self.write_registry_job('cand2', state='failed', exitCode=1,
                                review={'state': 'changes_requested', 'summary': 'round2 finding'}, followupId='cand3')
        self.write_registry_job('cand3', drop=('review', 'followupId'), state='running', pid=7)
        jobs = self.jobs_by_id()
        self.assertEqual(jobs['job1']['phase'], 'needs_changes')
        self.assertEqual(jobs['job1']['review']['state'], 'changes_requested')
        self.assertTrue(jobs['job1']['superseded'])
        self.assertFalse(jobs['job1']['resolved'])
        self.assertEqual(jobs['job1']['chainTip']['id'], 'cand3')
        self.assertEqual(jobs['job1']['chainTip']['phase'], 'running')
        self.assertEqual(jobs['cand2']['chainTip']['id'], 'cand3')
        self.assertFalse(jobs['cand3']['superseded'])
        self.assertEqual(jobs['cand3']['chainTip']['id'], 'cand3')

    @patch('monitor.process_alive', return_value=True)
    def test_failed_tip_stays_attention_and_never_resolved(self, _):
        self.job.update(state='failed', exitCode=1, review={'state': 'changes_requested', 'summary': 'old finding'}, followupId='fix')
        self.write_job()
        self.write_registry_job('fix', drop=('review', 'followupId'), state='failed', exitCode=2)
        jobs = self.jobs_by_id()
        self.assertEqual(jobs['job1']['chainTip']['phase'], 'failed')
        self.assertFalse(jobs['job1']['resolved'])
        self.assertEqual(jobs['fix']['phase'], 'failed')
        self.assertFalse(jobs['fix']['superseded'])

    def test_reviewed_tip_marks_chain_resolved_without_rewriting_history(self):
        self.job.update(state='failed', exitCode=1, review={'state': 'changes_requested', 'summary': 'old finding'}, followupId='fix')
        self.write_job()
        self.write_registry_job('fix', drop=('followupId',), state='completed', review={'state': 'passed', 'summary': 'integration passed'})
        jobs = self.jobs_by_id()
        self.assertEqual(jobs['job1']['phase'], 'needs_changes')
        self.assertEqual(jobs['job1']['review']['state'], 'changes_requested')
        self.assertTrue(jobs['job1']['superseded'])
        self.assertTrue(jobs['job1']['resolved'])
        self.assertEqual(jobs['fix']['phase'], 'reviewed')
        self.assertFalse(jobs['fix']['superseded'])

    def test_missing_successor_is_not_claimed_resolved(self):
        self.job.update(state='failed', exitCode=1, review={'state': 'changes_requested', 'summary': 'old finding'}, followupId='ghost')
        self.write_job()
        item = monitor.snapshot(self.registry, self.database)['jobs'][0]
        self.assertEqual(item['phase'], 'needs_changes')
        self.assertFalse(item['superseded'])
        self.assertFalse(item['resolved'])
        self.assertEqual(item['chainIssue'], 'missing')

    @patch('monitor.process_alive', return_value=True)
    def test_cycle_is_reported_and_never_resolved(self, _):
        self.job.update(state='failed', exitCode=1, review={'state': 'changes_requested', 'summary': 'old finding'}, followupId='ping')
        self.write_job()
        self.write_registry_job('ping', drop=('review',), state='completed', followupId='job1')
        jobs = self.jobs_by_id()
        for item in jobs.values():
            self.assertEqual(item['chainIssue'], 'cycle')
            self.assertFalse(item['superseded'])
            self.assertFalse(item['resolved'])
        self.assertEqual(jobs['job1']['phase'], 'needs_changes')

    @patch('monitor.process_alive', return_value=True)
    def test_summary_counts_only_current_jobs_not_superseded_history(self, _):
        self.job.update(state='failed', exitCode=1, review={'state': 'changes_requested', 'summary': 'old finding'}, followupId='fix')
        self.write_job()
        self.write_registry_job('fix', drop=('review', 'followupId'), state='failed', exitCode=2)
        self.write_registry_job('other', drop=('review', 'followupId'), state='running', pid=5, startedAt=900)
        self.assertEqual(monitor.snapshot(self.registry, self.database)['summary'],
                         {'running': 1, 'awaitingReview': 0, 'needsAttention': 1})

    def test_job_kind_separates_local_gates_from_glm_development(self):
        for model, expected in [('Local automated gates', 'local'), ('本机自动测试', 'local'), ('GLM-5.3-Flash', 'glm')]:
            self.job['model'] = model
            self.write_job()
            self.assertEqual(monitor.snapshot(self.registry, self.database)['jobs'][0]['jobKind'], expected)
        self.job.pop('model')
        self.write_job()
        self.assertEqual(monitor.snapshot(self.registry, self.database)['jobs'][0]['jobKind'], 'glm')

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

    def test_parallel_workers_have_independent_slots_and_exclusive_worktrees(self):
        first = run_glm.acquire_locks(self.root, self.root / 'a', 'a', 2)
        try:
            with self.assertRaises(FileExistsError):
                run_glm.acquire_locks(self.root, self.root / 'a', 'same-tree', 2)
            second = run_glm.acquire_locks(self.root, self.root / 'b', 'b', 2)
            try:
                with self.assertRaises(FileExistsError):
                    run_glm.acquire_locks(self.root, self.root / 'c', 'c', 2)
                expanded = run_glm.acquire_locks(self.root, self.root / 'c', 'c', 3)
                run_glm.release_locks(expanded)
                with self.assertRaises(FileExistsError):
                    run_glm.acquire_locks(self.root, self.root / 'd', 'a', 2)
                self.assertTrue(all(path.exists() for path in first + second))
            finally:
                run_glm.release_locks(second)
            third = run_glm.acquire_locks(self.root, self.root / 'c', 'c', 2)
            run_glm.release_locks(third)
        finally:
            run_glm.release_locks(first)
        self.assertEqual(list((self.root / 'locks').glob('*.lock')), [])

    def test_legacy_global_lock_blocks_new_parallel_launches(self):
        (self.root / 'worker.lock').write_text('prior live owner')
        with self.assertRaises(FileExistsError):
            run_glm.acquire_locks(self.root, self.root / 'new', 'batch', 2)

    def test_parallel_mode_rejects_shared_wake_file(self):
        with self.assertRaisesRegex(ValueError, 'per-job'):
            run_glm.run(SimpleNamespace(home=self.root, parallelism=2, wake_state=self.root / 'shared.json'))

    def test_two_actual_processes_share_slots_but_not_worktrees(self):
        code = ('import pathlib,sys; from run_glm import acquire_locks,release_locks; '
                'locks=acquire_locks(pathlib.Path(sys.argv[1]),pathlib.Path(sys.argv[2]),sys.argv[3],2); '
                'print("ready",flush=True); sys.stdin.readline(); release_locks(locks)')
        processes = []
        try:
            for name in ['process-a', 'process-b']:
                process = subprocess.Popen([sys.executable, '-c', code, str(self.root), str(self.root / name), name],
                    cwd=pathlib.Path(__file__).parent, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE, text=True, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
                processes.append(process)
                self.assertEqual(process.stdout.readline().strip(), 'ready')
            self.assertTrue(all(process.poll() is None for process in processes))
            with self.assertRaises(FileExistsError):
                run_glm.acquire_locks(self.root, self.root / 'third', 'third', 2)
            with self.assertRaises(FileExistsError):
                run_glm.acquire_locks(self.root, self.root / 'process-a', 'other', 2)
        finally:
            for process in processes:
                output, error = process.communicate('\n', timeout=10)
                self.assertEqual(process.returncode, 0, error)

    @unittest.skipUnless(os.name == 'nt' and shutil.which('node'), 'Windows Node runner')
    @patch('run_glm.subprocess.check_output', return_value='task/fixture\n')
    def test_runner_persists_real_child_completion_and_wake_marker(self, _):
        cli = self.root / 'resources/glm/mock.cjs'
        cli.parent.mkdir(parents=True)
        attachment = self.root / 'trainer-shot.png'
        attachment.write_bytes(b'fixture-image')
        cli.write_text('''
const fs = require('node:fs');
const args = process.argv.slice(2);
const format = args[args.indexOf('--output-format') + 1];
const file = args[args.indexOf('--attach') + 1];
if (format !== 'stream-json' || !file || fs.readFileSync(file, 'utf8') !== 'fixture-image') process.exit(7);
console.log(JSON.stringify({type:'session_started',sessionId:'fixture'}));
console.log(JSON.stringify({sessionId:'fixture',response:'finished'}));
''')
        builtin = self.root / 'resources/config/provider/zcode-builtin.json'
        builtin.parent.mkdir(parents=True)
        builtin.write_text('{}')
        provider = self.root / 'provider.json'
        provider.write_text(json.dumps({'config': {'defaultModelSelection': {'modelId': 'GLM-5.3-Flash', 'options': {'reasoningLevel': 'max'}}, 'modelConfigRules': {'manualProviderModelRules': [{'modelId': 'GLM-5.3-Flash', 'config': {'optionSpecs': {'maxOutputTokens': {'max': 32768}}}}]}}}))
        prompt = self.root / 'prompt.md'
        prompt.write_text('bounded test')
        args = SimpleNamespace(home=self.root, batch='fixture', title='测试', cwd=self.root, log=self.root / 'fixture.log', prompt=prompt, provider=provider, cli=cli, node=shutil.which('node'), resume=None, wake_state=self.root / 'wake.json')
        args.attach = [attachment]
        self.assertEqual(run_glm.run(args), 0)
        state = json.loads((self.registry / 'fixture.json').read_text(encoding='utf-8'))
        self.assertEqual(state['state'], 'completed')
        self.assertEqual(state['mode'], 'yolo')
        self.assertEqual(state['response'], 'finished')
        self.assertEqual(json.loads(args.wake_state.read_text(encoding='utf-8'))['batch'], 'fixture')
        self.assertFalse((self.root / 'worker.lock').exists())


if __name__ == '__main__':
    unittest.main()
