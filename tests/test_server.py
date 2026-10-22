import http.cookiejar
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import build_opener, HTTPCookieProcessor, Request
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class API(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        server.DB = Path(cls.tmp.name) / 'test.sqlite3'
        server.initialize()
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.url = 'http://127.0.0.1:' + str(cls.http.server_port)
        threading.Thread(target=cls.http.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.tmp.cleanup()

    def client(self):
        return build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, client, path, body=None, csrf='', origin=None):
        headers = {'Content-Type': 'application/json', 'X-CSRF-Token': csrf}
        if origin:
            headers['Origin'] = origin
        req = Request(self.url + path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
        try:
            res = client.open(req)
        except HTTPError as e:
            res = e
        return res.status, json.loads(res.read())

    def test_workflow_isolation_conflict_logout(self):
        a, b, other = self.client(), self.client(), self.client()
        self.assertEqual(self.request(a, '/api/fleet')[0], 401)
        status, login = self.request(a, '/api/register', {'email':'a@example.com','password':'secure-password'})
        self.assertEqual(status, 200)
        self.assertEqual(self.request(b, '/api/login', {'email':'a@example.com','password':'wrong-password'})[0], 401)
        status, second = self.request(b, '/api/login', {'email':'a@example.com','password':'secure-password'})
        self.assertEqual(status, 200)
        status, stranger = self.request(other, '/api/register', {'email':'b@example.com','password':'secure-password'})
        self.assertEqual(status, 200)
        state = dict(cars=[dict(id=1, placa='ABC1D23',modelo='Teste',km=10,prox=10000,uso=None)], drivers=[], log=[], fines=[])
        body = {'version':0, 'state':state}
        self.assertEqual(self.request(a, '/api/fleet', body)[0], 403)
        self.assertEqual(self.request(a, '/api/fleet', body, login['csrf'], 'https://evil.test')[0], 403)
        self.assertEqual(self.request(a, '/api/fleet', body, login['csrf'])[0], 200)
        self.assertEqual(self.request(b, '/api/fleet')[1]['state'], state)
        self.assertEqual(self.request(b, '/api/fleet', body, second['csrf'])[0], 409)
        self.assertEqual(self.request(other, '/api/fleet')[1]['state']['cars'], [])
        self.assertEqual(self.request(a, '/api/logout', {}, login['csrf'])[0], 200)
        self.assertEqual(self.request(a, '/api/fleet')[0], 401)
        self.assertEqual(self.request(b, '/api/fleet')[0], 200)
        server.initialize()  # Reinitialization must preserve stored fleets.
        self.assertEqual(self.request(b, '/api/fleet')[1]['state'], state)

    def test_reject_unsafe_import(self):
        for car in [{'id':'1" onclick="alert(1)'}, {'id':1, 'foto':'x" onerror="alert(1)'}]:
            self.assertFalse(server.valid_state(dict(cars=[car],drivers=[],log=[],fines=[])))

if __name__ == '__main__':
    unittest.main()
