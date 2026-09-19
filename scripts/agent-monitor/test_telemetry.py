import json
import pathlib
import tempfile
import unittest

from telemetry import ModelLogReader


class TelemetryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.path = self.root / 'zcode-2026-09-19.jsonl'
        self.reader = ModelLogReader(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def event(self, event, second, session='ours', **context):
        return {'timestamp': '2026-09-19T07:00:%02dZ' % second, 'sessionId': session,
                'event': event, 'context': {'queryId': 'q1', 'reasoning': 'PRIVATE', 'headers': {'Authorization': 'SECRET'}, **context}}

    def write(self, rows, mode='w'):
        with self.path.open(mode, encoding='utf-8') as output:
            for row in rows:
                output.write(json.dumps(row) + '\n')

    def test_completed_then_new_start_is_distinct_from_tool_progress(self):
        self.write([self.event('model.request.started', 1),
                    self.event('model.response.diagnostics', 9, finishReason='length', usageOutputTokens=32768),
                    self.event('model.request.started', 10)])
        value = self.reader.read('ours', 0)
        self.assertEqual(value['signal'], 'request_started')
        self.assertEqual(value['lengthStops'], 1)
        self.assertGreater(value['requestStartedAt'], value['responseAt'])
        self.assertEqual(value['lastOutputTokens'], 32768)
        self.assertNotIn('PRIVATE', json.dumps(value))
        self.assertNotIn('SECRET', json.dumps(value))

    def test_other_session_and_older_event_cannot_finish_current_request(self):
        self.write([self.event('model.request.started', 10),
                    self.event('model.response.diagnostics', 15, session='other', finishReason='stop'),
                    self.event('model.response.diagnostics', 8, finishReason='stop')])
        self.assertEqual(self.reader.read('ours', 0)['signal'], 'request_started')

    def test_partial_line_is_completed_on_next_read_and_rotation_resets(self):
        row = json.dumps(self.event('model.request.started', 10))
        self.path.write_text(row[:40], encoding='utf-8')
        self.assertIsNone(self.reader.read('ours', 0))
        with self.path.open('a', encoding='utf-8') as output:
            output.write(row[40:] + '\n')
        self.assertEqual(self.reader.read('ours', 0)['signal'], 'request_started')
        self.path.write_text('{bad}\n', encoding='utf-8')
        self.assertIsNone(self.reader.read('ours', 0))

    def test_prior_session_run_cannot_resurrect_old_request(self):
        self.write([self.event('model.request.started', 1)])
        self.assertIsNone(self.reader.read('ours', 9_999_999_999_999))


if __name__ == '__main__':
    unittest.main()
