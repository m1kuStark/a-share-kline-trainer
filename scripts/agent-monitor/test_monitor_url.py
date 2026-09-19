import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

import monitor


class MonitorReuseUrlTests(unittest.TestCase):
    def test_rejects_nonlocal_or_ambiguous_metadata_before_network(self):
        for value in ['https://127.0.0.1:1234/token/', 'http://example.com:1234/token/',
                      'http://127.0.0.1.example.com:1234/token/', 'http://localhost:1234/token/',
                      'http://u:p@127.0.0.1:1234/token/', 'http://127.0.0.1:1234/token/?a=1',
                      'http://127.0.0.1:1234/token/#x', 'http://127.0.0.1:0/token/',
                      'http://127.0.0.1:1234/../token/', 'http://127.0.0.1:1234/%2e%2e/']:
            with self.subTest(value=value), patch('urllib.request.build_opener') as opened:
                with self.assertRaises(ValueError):
                    monitor.read_instance_health(value)
                opened.assert_not_called()

    def test_local_health_ignores_proxy_and_refuses_redirect(self):
        requests = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path)
                if self.path == '/' + 'r' * 24 + '/health':
                    self.send_response(302)
                    self.send_header('Location', '/target/health')
                    self.end_headers()
                else:
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(json.dumps({'instance': 'owned'}).encode())

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base = 'http://127.0.0.1:%d/' % server.server_port
            with patch.dict('os.environ', {'HTTP_PROXY': 'http://127.0.0.1:1', 'NO_PROXY': ''}):
                self.assertEqual(monitor.read_instance_health(base + 'v' * 24 + '/'), {'instance': 'owned'})
                with self.assertRaises(Exception):
                    monitor.read_instance_health(base + 'r' * 24 + '/')
            self.assertEqual(requests, ['/' + 'v' * 24 + '/health', '/' + 'r' * 24 + '/health'])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
