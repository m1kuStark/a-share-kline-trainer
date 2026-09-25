import json
import os
import pathlib
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import monitor
import run_glm


class ValidateTests(unittest.TestCase):
    def test_prompt_must_be_nonempty_and_within_command_line_budget(self):
        self.assertEqual('ok', run_glm.validate_prompt('ok'))
        with self.assertRaises(ValueError):
            run_glm.validate_prompt('   ')
        with self.assertRaises(ValueError):
            run_glm.validate_prompt('x' * (run_glm.MAX_PROMPT_CHARS + 1))

    def test_attachments_accept_only_cli_supported_media(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            image = root / 'shot.png'
            image.write_bytes(b'x')
            notes = root / 'notes.txt'
            notes.write_text('x', encoding='utf-8')
            self.assertEqual([image.resolve()], run_glm.validate_attachments([image]))
            with self.assertRaises(ValueError):
                run_glm.validate_attachments([notes])

    def test_output_budget_mutates_only_matching_rules(self):
        document = {'config': {'modelConfigRules': {'manualProviderModelRules': [
            {'modelId': 'GLM-5.3-Flash', 'config': {'optionSpecs': {'maxOutputTokens': {'max': 8192}}}},
            {'modelId': 'other-model', 'config': {'optionSpecs': {'maxOutputTokens': {'max': 4096}}}},
        ]}}}
        run_glm.apply_output_budget(document, 'GLM-5.3-Flash', 32768)
        rules = document['config']['modelConfigRules']['manualProviderModelRules']
        self.assertEqual(32768, rules[0]['config']['optionSpecs']['maxOutputTokens']['max'])
        self.assertEqual(4096, rules[1]['config']['optionSpecs']['maxOutputTokens']['max'])

    def test_output_budget_reports_missing_schema_path_clearly(self):
        document = {'config': {'modelConfigRules': {'manualProviderModelRules': [
            {'modelId': 'GLM-5.3-Flash', 'config': {'optionSpecs': {'reasoningLevel': {}}}},
        ]}}}
        with self.assertRaises(ValueError) as caught:
            run_glm.apply_output_budget(document, 'GLM-5.3-Flash', 32768)
        self.assertIn('optionSpecs', str(caught.exception))

    def test_output_budget_requires_a_matching_rule_and_respects_official_cap(self):
        with self.assertRaises(ValueError):
            run_glm.apply_output_budget({'config': {}}, 'GLM-5.3-Flash', 32768)
        with self.assertRaises(ValueError):
            run_glm.apply_output_budget({'config': {}}, 'GLM-5.3-Flash', run_glm.OFFICIAL_MAX_OUTPUT_TOKENS + 1)


class DiscoverTests(unittest.TestCase):
    def test_session_id_is_read_from_log_head(self):
        with tempfile.TemporaryDirectory() as temp:
            log = pathlib.Path(temp) / 'job.log'
            log.write_text('{"sessionId":"sess_abc-123","type":"session.updated"}\n', encoding='utf-8')
            self.assertEqual('sess_abc-123', run_glm.discover_session_id(log))
            empty = pathlib.Path(temp) / 'empty.log'
            empty.write_text('', encoding='utf-8')
            self.assertIsNone(run_glm.discover_session_id(empty))


class SessionStampTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.database = self.root / 'db.sqlite'
        self.worktree = self.root / 'task'
        with sqlite3.connect(self.database) as db:
            db.executescript('''
              create table session(id text,directory text,time_created int,time_updated int);
              create table part(id text,session_id text,time_updated int);
              create table model_usage(session_id text,status text,started_at int,completed_at int);
            ''')
            db.execute('insert into session values(?,?,?,?)', ('ours', str(self.worktree), 1000, 2000))
            db.execute('insert into part values(?,?,?)', ('p', 'ours', 1800))
            db.execute('insert into model_usage values(?,?,?,?)', ('ours', 'completed', 1500, 1900))

    def tearDown(self):
        self.temp.cleanup()

    def test_stamp_is_newest_session_activity(self):
        self.assertEqual(1900, monitor.session_activity_stamp(self.database, str(self.worktree), 'ours', 1000))
        self.assertEqual(1900, monitor.session_activity_stamp(self.database, str(self.worktree), None, 1000))

    def test_mismatched_or_unknown_sessions_stay_unread(self):
        self.assertIsNone(monitor.session_activity_stamp(self.database, str(self.worktree), 'other', 1000))
        self.assertIsNone(monitor.session_activity_stamp(self.root / 'missing.sqlite', str(self.worktree), 'ours', 1000))


class SuperviseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.database = self.root / 'absent.sqlite'
        self.children = []

    def tearDown(self):
        for child in self.children:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=30)
        self.temp.cleanup()

    def spawn(self, code, log):
        with log.open('w') as output:
            child = subprocess.Popen([sys.executable, '-c', code],
                                     stdout=output, stderr=subprocess.DEVNULL)
        self.children.append(child)
        return child

    def supervise(self, child, log, **kwargs):
        kwargs.setdefault('database', self.database)
        kwargs.setdefault('worktree', str(self.root))
        kwargs.setdefault('started_at', 0)
        return run_glm.supervise(child, log, poll_seconds=0.5, **kwargs)

    def test_quick_exit_returns_real_exit_code(self):
        log = self.root / 'quick.log'
        child = self.spawn('pass', log)
        self.assertEqual(0, self.supervise(child, log, session_id='sess_x'))

    def test_silent_child_hits_idle_timeout(self):
        log = self.root / 'idle.log'
        child = self.spawn('import time;time.sleep(60)', log)
        self.assertEqual('idle-timeout', self.supervise(child, log, session_id='sess_x', idle_ms=1500))

    def test_total_timeout_fires_even_with_unknown_session(self):
        log = self.root / 'total.log'
        child = self.spawn('import time;time.sleep(60)', log)
        self.assertEqual('total-timeout', self.supervise(child, log, idle_ms=0, total_ms=800))

    def test_log_growth_counts_as_activity(self):
        log = self.root / 'growing.log'
        child = self.spawn("import time;print('x'*400,flush=True);time.sleep(1.5);"
                           "print('y'*400,flush=True);time.sleep(0.5)", log)
        self.assertEqual(0, self.supervise(child, log, session_id='sess_x', idle_ms=2000))


class ParserTests(unittest.TestCase):
    def test_defaults_pin_yolo_and_bounded_idle(self):
        options = run_glm.parser().parse_args([
            '--batch', 'B', '--title', 'T', '--cwd', '.', '--prompt', 'p.txt',
            '--log', 'l.log', '--provider', 'prov.json', '--cli', 'x/zcode.cjs'])
        self.assertEqual('yolo', options.permission_mode)
        self.assertEqual(0.0, options.timeout_minutes)
        self.assertEqual(5.0, options.idle_minutes)
        self.assertEqual(32768, options.max_output_tokens)
        self.assertEqual('GLM-5.3-Flash', options.model)

    def test_model_whitelist_rejects_unknown(self):
        with self.assertRaises(SystemExit):
            run_glm.parser().parse_args([
                '--batch', 'B', '--title', 'T', '--cwd', '.', '--prompt', 'p.txt',
                '--log', 'l.log', '--provider', 'prov.json', '--cli', 'x/zcode.cjs',
                '--model', 'GLM-4.7'])


class ModelVariantTests(unittest.TestCase):
    """--model 白名单：GLM-5.3 非图像重活显式派发；provider 与 model 不匹配即拒绝。"""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    COMPLETED_CLI = (
        "const fs=require('fs');const args=process.argv.slice(2);"
        "if(args.includes('--version'))process.exit(0);"
        "fs.writeSync(1,JSON.stringify({type:'session_started',sessionId:'sess_v1'})+'\\n');"
        "fs.writeSync(1,JSON.stringify({sessionId:'sess_v1',response:'done'})+'\\n');")

    def run_with(self, model, provider_model):
        cli = self.root / 'resources/glm/mock.cjs'
        cli.parent.mkdir(parents=True, exist_ok=True)
        cli.write_text(self.COMPLETED_CLI, encoding='utf-8')
        builtin = self.root / 'resources/config/provider/zcode-builtin.json'
        builtin.parent.mkdir(parents=True, exist_ok=True)
        builtin.write_text('{}', encoding='utf-8')
        provider = self.root / 'provider.json'
        provider.write_text(json.dumps({'config': {
            'defaultModelSelection': {'modelId': provider_model, 'options': {'reasoningLevel': 'max'}},
            'modelConfigRules': {'manualProviderModelRules': [
                {'modelId': provider_model, 'config': {'optionSpecs': {'maxOutputTokens': {'max': 32768}}}}]}}}),
            encoding='utf-8')
        prompt = self.root / 'prompt.md'
        prompt.write_text('model variant test', encoding='utf-8')
        args = SimpleNamespace(home=self.root, batch='variant', title='变体', cwd=self.root,
                               log=self.root / 'variant.log', prompt=prompt, provider=provider,
                               cli=cli, node=shutil.which('node'), db=self.root / 'absent.sqlite',
                               wake_state=None, resume=None, attach=[], parallelism=1,
                               permission_mode='yolo', timeout_minutes=0.0, idle_minutes=5.0,
                               max_output_tokens=32768, model=model)
        with patch('run_glm.subprocess.check_output', return_value='main\n'):
            code = run_glm.run(args)
        record = json.loads((self.root / 'jobs' / 'variant.json').read_text(encoding='utf-8'))
        return code, record

    def test_glm53_variant_accepted_when_provider_matches(self):
        code, record = self.run_with('GLM-5.3', 'GLM-5.3')
        self.assertEqual(0, code)
        self.assertEqual('completed', record['state'])
        self.assertEqual('GLM-5.3', record['model'])

    def test_model_provider_mismatch_fails_job(self):
        code, record = self.run_with('GLM-5.3', 'GLM-5.3-Flash')
        self.assertEqual(1, code)
        self.assertEqual('failed', record['state'])
        self.assertIn('Expected GLM-5.3', record.get('error', ''))


class RunnerMetadataTests(unittest.TestCase):
    """会话元数据生命周期：new/resume、失败保留关联、超时从流日志补登。"""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def build(self, batch, cli_code, resume=None, with_attachment=False):
        cli = self.root / 'resources/glm/mock.cjs'
        cli.parent.mkdir(parents=True, exist_ok=True)
        cli.write_text(cli_code, encoding='utf-8')
        builtin = self.root / 'resources/config/provider/zcode-builtin.json'
        builtin.parent.mkdir(parents=True, exist_ok=True)
        builtin.write_text('{}', encoding='utf-8')
        provider = self.root / 'provider.json'
        provider.write_text(json.dumps({'config': {
            'defaultModelSelection': {'modelId': 'GLM-5.3-Flash', 'options': {'reasoningLevel': 'max'}},
            'modelConfigRules': {'manualProviderModelRules': [
                {'modelId': 'GLM-5.3-Flash', 'config': {'optionSpecs': {'maxOutputTokens': {'max': 32768}}}}]}}}),
            encoding='utf-8')
        prompt = self.root / 'prompt.md'
        prompt.write_text('metadata lifecycle test', encoding='utf-8')
        attach = []
        if with_attachment:
            image = self.root / 'shot.png'
            image.write_bytes(b'fixture-image')
            attach.append(image)
        args = SimpleNamespace(home=self.root, batch=batch, title='元数据', cwd=self.root,
                               log=self.root / (batch + '.log'), prompt=prompt, provider=provider,
                               cli=cli, node=shutil.which('node'), db=self.root / 'absent.sqlite',
                               wake_state=None, resume=resume, attach=attach, parallelism=1,
                               permission_mode='yolo', timeout_minutes=0.0, idle_minutes=5.0,
                               max_output_tokens=32768)
        return args, cli

    COMPLETED_CLI = (
        "const fs=require('fs');const args=process.argv.slice(2);"
        "if(args.includes('--version'))process.exit(0);"
        "if(args.indexOf('--attach')<0)process.exit(7);"
        "fs.writeSync(1,JSON.stringify({type:'session_started',sessionId:'sess_new_123'})+'\\n');"
        "fs.writeSync(1,JSON.stringify({sessionId:'sess_new_123',response:'done'})+'\\n');")

    @patch('run_glm.subprocess.check_output', return_value='task/fixture\n')
    def test_completed_new_job_records_full_session_metadata(self, _):
        args, cli = self.build('meta-new', self.COMPLETED_CLI, with_attachment=True)
        self.assertEqual(0, run_glm.run(args))
        state = json.loads((self.root / 'jobs' / 'meta-new.json').read_text(encoding='utf-8'))
        self.assertEqual('completed', state['state'])
        self.assertEqual('new', state['sessionMode'])
        self.assertIsNone(state['resumedFrom'])
        self.assertEqual('sess_new_123', state['sessionId'])
        self.assertEqual(str(cli.resolve()), state['cliPath'])
        self.assertEqual(1, state['attachmentCount'])
        self.assertEqual([str(args.attach[0].resolve())], state['attachments'])

    @patch('run_glm.subprocess.check_output', return_value='task/fixture\n')
    def test_resume_metadata_keeps_association_when_run_fails(self, _):
        args, _ = self.build('meta-resume-fail', 'process.exit(9);', resume='sess_prev_42')
        self.assertEqual(1, run_glm.run(args))
        state = json.loads((self.root / 'jobs' / 'meta-resume-fail.json').read_text(encoding='utf-8'))
        self.assertEqual('failed', state['state'])
        self.assertEqual('resume', state['sessionMode'])
        self.assertEqual('sess_prev_42', state['resumedFrom'])
        self.assertEqual('sess_prev_42', state['sessionId'])

    @patch('run_glm.subprocess.check_output', return_value='task/fixture\n')
    def test_failed_resultless_job_recovers_session_id_from_log(self, _):
        code = ("const fs=require('fs');const args=process.argv.slice(2);"
                "if(args.includes('--version'))process.exit(0);"
                "fs.writeSync(1,JSON.stringify({type:'session_started',sessionId:'sess_lost_9'})+'\\n');"
                "process.exit(5);")
        args, _ = self.build('meta-no-result', code)
        self.assertEqual(1, run_glm.run(args))
        state = json.loads((self.root / 'jobs' / 'meta-no-result.json').read_text(encoding='utf-8'))
        self.assertEqual('failed', state['state'])
        self.assertEqual('new', state['sessionMode'])
        self.assertIsNone(state['resumedFrom'])
        self.assertEqual('sess_lost_9', state['sessionId'])

    @patch('run_glm.subprocess.check_output', return_value='task/fixture\n')
    def test_timeout_keeps_session_association_from_stream_log(self, _):
        code = ("const fs=require('fs');const args=process.argv.slice(2);"
                "if(args.includes('--version'))process.exit(0);"
                "fs.writeSync(1,JSON.stringify({type:'session_started',sessionId:'sess_timeout_7'})+'\\n');"
                "setInterval(function(){},1000);")
        args, _ = self.build('meta-timeout', code)

        def fake_supervise(child, log, **kwargs):
            time.sleep(1.0)
            return 'idle-timeout'

        with patch('run_glm.supervise', side_effect=fake_supervise):
            self.assertEqual(1, run_glm.run(args))
        state = json.loads((self.root / 'jobs' / 'meta-timeout.json').read_text(encoding='utf-8'))
        self.assertEqual('failed', state['state'])
        self.assertEqual('idle-timeout', state['timeoutKind'])
        self.assertEqual('new', state['sessionMode'])
        self.assertEqual('sess_timeout_7', state['sessionId'])
        pid = int(pathlib.Path(str(args.log) + '.pid').read_text(encoding='utf-8'))
        deadline = time.time() + 8
        while monitor.process_alive(pid) and time.time() < deadline:
            time.sleep(0.2)
        self.assertFalse(monitor.process_alive(pid))


if __name__ == '__main__':
    unittest.main()
