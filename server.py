"""FleetOn: same-origin API, authentication and persistent storage (Python 3.12+)."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sqlite3
import time
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

ROOT = Path(__file__).parent
DB = Path(os.environ.get('FLEETON_DB', str(ROOT / 'data/fleeton.sqlite3')))
SECURE = os.environ.get('FLEETON_SECURE_COOKIE', '0') == '1'
TTL = 60 * 60 * 24 * 7
MAX_BODY = 8 * 1024 * 1024


def connect():
    c = sqlite3.connect(DB, timeout=20)
    c.execute('PRAGMA foreign_keys=ON')
    return c


def initialize():
    DB.parent.mkdir(parents=True, exist_ok=True)
    with connect() as c:
        c.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL,
          salt TEXT NOT NULL, password TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
          csrf TEXT NOT NULL, expires INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS fleets (
          user_id INTEGER PRIMARY KEY REFERENCES users(id),
          version INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS profiles (
          user_id INTEGER PRIMARY KEY REFERENCES users(id), name TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '');
        CREATE TABLE IF NOT EXISTS attempts (
          identity TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
        ''')


def password_hash(password, salt):
    return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()


def valid_state(state):
    if not (isinstance(state, dict) and set(state) == {'cars', 'drivers', 'log', 'fines'}
            and all(isinstance(v, list) and all(isinstance(x, dict) for x in v) for v in state.values())):
        return False
    numeric = {'id', 'km', 'prox', 'kmIni', 'valor', 'litros', 'rodou', 't', 'troca', 'vida'}
    def check(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if key in numeric and item is not None and (type(item) not in (int, float) or not __import__('math').isfinite(item)):
                    return False
                if key == 'foto' and item and (not isinstance(item, str) or not item.startswith('data:image/jpeg;base64,') or any(c not in 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=' for c in item[23:])):
                    return False
                if not check(item):
                    return False
            return True
        if isinstance(value, list):
            return all(check(item) for item in value)
        return value is None or type(value) in (str, int, float, bool)
    for group in ('cars', 'drivers', 'fines'):
        if any(type(row.get('id')) is not int for row in state[group]):
            return False
    return check(state)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # Never log passwords, session tokens or fleet content.

    def reply(self, status, data, cookie=None):
        raw = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def cookie(self, token, age=TTL):
        return f'fleeton={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={age}' + ('; Secure' if SECURE else '')

    def session(self, c):
        jar = SimpleCookie()
        try:
            jar.load(self.headers.get('Cookie', ''))
            token = jar['fleeton'].value
        except Exception:
            return None
        return c.execute('SELECT s.token,s.user_id,s.csrf,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?',
                         (hashlib.sha256(token.encode()).hexdigest(), int(time.time()))).fetchone()

    def do_GET(self):
        path = urlsplit(self.path).path
        if path.startswith('/api/'):
            with connect() as c:
                s = self.session(c)
                if not s:
                    return self.reply(401, {'error': 'Entre na sua conta.'})
                if path == '/api/session':
                    return self.reply(200, {'email': s[3], 'csrf': s[2]})
                if path == '/api/context':
                    row = c.execute('SELECT name,avatar FROM profiles WHERE user_id=?', (s[1],)).fetchone()
                    return self.reply(200, {'role':'manager', 'user_id':s[1], 'profile':{'name':row[0] if row else '', 'avatar':row[1] if row else ''}})
                if path == '/api/fleet':
                    row = c.execute('SELECT version,body FROM fleets WHERE user_id=?', (s[1],)).fetchone()
                    return self.reply(200, {'version': row[0], 'state': json.loads(row[1])})
            return self.reply(404, {'error': 'Não encontrado.'})
        if path == '/config.js':
            raw = b'window.FLEETON_CONFIG={backend:"local"};'
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript; charset=utf-8')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            return self.wfile.write(raw)
        files = {'/': 'index.html', '/cloud.js': 'cloud.js', '/supabase-adapter.js': 'supabase-adapter.js', '/vendor/supabase.js': 'vendor/supabase.js', '/account.js':'account.js', '/account.css':'account.css', '/layout.js':'layout.js', '/layout.css':'layout.css', '/fleet-insights.js':'fleet-insights.js', '/fleet-tools.js':'fleet-tools.js', '/fleet-tools.css':'fleet-tools.css', '/inspection.js':'inspection.js', '/inspection-core.js':'inspection-core.js', '/inspection.css':'inspection.css'}
        if path not in files:
            return self.reply(404, {'error': 'Não encontrado.'})
        target = ROOT / 'public' / files[path]
        if not target.is_file():
            return self.reply(404, {'error':'Execute npm run build para gerar os arquivos.'})
        raw = target.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8' if path == '/' else 'text/css; charset=utf-8' if path.endswith('.css') else 'text/javascript; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length <= 0 or length > MAX_BODY:
                return self.reply(413, {'error': 'Dados muito grandes (limite: 8 MB). Exporte um backup.'})
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                return self.reply(415, {'error': 'Formato inválido.'})
            origin = self.headers.get('Origin')
            if origin and urlsplit(origin).netloc != self.headers.get('Host'):
                return self.reply(403, {'error': 'Origem inválida.'})
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError()
            self.post(body)
        except (ValueError, TypeError, KeyError):
            self.reply(400, {'error': 'Dados inválidos.'})
        except sqlite3.Error:
            self.reply(503, {'error': 'Banco indisponível. Tente novamente.'})

    def post(self, body):
        path = urlsplit(self.path).path
        with connect() as c:
            if path in ('/api/register', '/api/login'):
                email, password = body.get('email', ''), body.get('password', '')
                if not isinstance(email, str) or not isinstance(password, str):
                    raise ValueError()
                email = email.strip().lower()
                if len(email) > 254 or '@' not in email or not 10 <= len(password) <= 128:
                    return self.reply(400, {'error': 'Informe e-mail e senha de 10 a 128 caracteres.'})
                identity = hashlib.sha256((self.client_address[0] + email).encode()).hexdigest()
                now = int(time.time())
                c.execute('DELETE FROM attempts WHERE expires<?', (now,))
                c.execute('DELETE FROM sessions WHERE expires<?', (now,))
                attempt = c.execute('SELECT count FROM attempts WHERE identity=?', (identity,)).fetchone()
                if attempt and attempt[0] >= 10:
                    return self.reply(429, {'error': 'Muitas tentativas. Aguarde 15 minutos.'})
                c.execute('INSERT INTO attempts VALUES (?,1,?) ON CONFLICT(identity) DO UPDATE SET count=count+1', (identity, now + 900))
                c.commit()
                row = c.execute('SELECT id,salt,password FROM users WHERE email=?', (email,)).fetchone()
                if path == '/api/register':
                    if row:
                        return self.reply(409, {'error': 'Não foi possível criar a conta. Tente entrar.'})
                    salt = secrets.token_hex(16)
                    try:
                        uid = c.execute('INSERT INTO users(email,salt,password) VALUES (?,?,?)', (email, salt, password_hash(password, salt))).lastrowid
                    except sqlite3.IntegrityError:
                        return self.reply(409, {'error': 'Não foi possível criar a conta.'})
                    c.execute('INSERT INTO fleets VALUES (?,0,?)', (uid, json.dumps(dict(cars=[], drivers=[], log=[], fines=[]))))
                else:
                    digest = password_hash(password, row[1] if row else '00' * 16)
                    if not row or not hmac.compare_digest(digest, row[2]):
                        return self.reply(401, {'error': 'E-mail ou senha incorretos.'})
                    uid = row[0]
                token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
                c.execute('INSERT INTO sessions VALUES (?,?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), uid, csrf, now + TTL))
                c.execute('DELETE FROM attempts WHERE identity=?', (identity,))
                c.commit()
                return self.reply(200, {'email': email, 'csrf': csrf}, self.cookie(token))
            s = self.session(c)
            if not s:
                return self.reply(401, {'error': 'Sessão expirada. Entre novamente.'})
            if not hmac.compare_digest(self.headers.get('X-CSRF-Token', ''), s[2]):
                return self.reply(403, {'error': 'Sessão inválida. Recarregue a página.'})
            if path == '/api/profile':
                name,avatar=body.get('name'),body.get('avatar')
                import re
                if not isinstance(name,str) or not 1 <= len(name.strip()) <= 80 or not isinstance(avatar,str) or len(avatar)>65536 or (avatar and not re.fullmatch(r'data:image/jpeg;base64,[A-Za-z0-9+/=]+',avatar)):
                    raise ValueError()
                c.execute('INSERT INTO profiles VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,avatar=excluded.avatar',(s[1],name.strip(),avatar))
                c.commit()
                return self.reply(200, {'name':name.strip(),'avatar':avatar})
            if path == '/api/logout':
                c.execute('DELETE FROM sessions WHERE token=?', (s[0],))
                c.commit()
                return self.reply(200, {}, self.cookie('', 0))
            if path == '/api/fleet':
                state, version = body.get('state'), body.get('version')
                if not valid_state(state) or type(version) is not int:
                    raise ValueError()
                updated = c.execute('UPDATE fleets SET body=?,version=version+1 WHERE user_id=? AND version=?', (json.dumps(state), s[1], version)).rowcount
                if not updated:
                    return self.reply(409, {'error': 'A frota mudou em outro dispositivo. Exporte suas alterações e recarregue antes de editar.'})
                c.commit()
                return self.reply(200, {'version': version + 1})
            self.reply(404, {'error': 'Não encontrado.'})


if __name__ == '__main__':
    initialize()
    ThreadingHTTPServer((os.environ.get('FLEETON_HOST', '127.0.0.1'), int(os.environ.get('PORT', '8000'))), Handler).serve_forever()
