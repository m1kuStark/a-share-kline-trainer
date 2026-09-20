import json
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import unittest

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
        child = subprocess.Popen([sys.executable, '-c', code],
                                 stdout=log.open('w'), stderr=subprocess.DEVNULL)
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


if __name__ == '__main__':
    unittest.main()
