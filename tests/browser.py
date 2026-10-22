from playwright.sync_api import sync_playwright
import time
import os
from pathlib import Path
import subprocess
import tempfile
from urllib.request import urlopen
with tempfile.TemporaryDirectory() as tmp:
 process=subprocess.Popen(['python3', 'server.py'], cwd=Path(__file__).resolve().parents[1], env={**os.environ, 'PORT':'8001', 'FLEETON_DB':str(Path(tmp)/'test.sqlite3')})
 try:
  for _ in range(100):
   try:
    urlopen('http://127.0.0.1:8001/').close(); break
   except OSError:
    time.sleep(.05)
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
   errors=[]
   a=browser.new_context(); page=a.new_page(); page.on('pageerror',lambda e:errors.append(str(e)))
   page.goto('http://127.0.0.1:8001')
   email=f'browser-{time.time_ns()}@example.com'
   page.locator('#email').fill(email); page.locator('#password').fill('test-password-123')
   page.get_by_role('button',name='Criar conta',exact=True).click()
   page.locator('#user-email').wait_for()
   page.locator('[data-t="car"]').click()
   page.locator('#np').fill('TEST123');page.locator('#nm').fill('Veículo teste');page.locator('#nk').fill('150');page.locator('#nr').fill('10000')
   page.locator('[data-go="add:0"]').click()
   page.get_by_text('Salvo no servidor.',exact=True).wait_for()
   assert page.locator('.plate').inner_text()=='TEST123'
   b=browser.new_context(); other=b.new_page();other.on('pageerror',lambda e:errors.append(str(e)))
   other.goto('http://127.0.0.1:8001');other.locator('#email').fill(email);other.locator('#password').fill('test-password-123');other.get_by_role('button',name='Entrar',exact=True).click();other.locator('#user-email').wait_for();other.locator('[data-t="car"]').click()
   assert other.locator('.plate').inner_text()=='TEST123'
   page.locator('[data-t="drv"]').click();page.locator('#dn').fill('Ana');page.locator('[data-go="addd:0"]').click();page.get_by_text('Salvo no servidor.',exact=True).wait_for()
   other.locator('#np').fill('STALE');other.locator('#nm').fill('Conflito');other.locator('[data-go="add:0"]').click()
   other.get_by_text('A frota mudou em outro dispositivo.',exact=False).wait_for()
   assert other.locator('#workspace').evaluate('(e)=>e.inert')
   other.locator('#refresh').click(no_wait_after=True)
   other.on('dialog',lambda d:d.accept())
   # Reload to recover authoritative state; unsaved state is intentionally warned about.
   other.reload();other.locator('#user-email').wait_for();other.locator('[data-t="drv"]').click();assert other.get_by_text('Ana',exact=True).is_visible()
   other.locator('#logout').click();other.locator('#email').wait_for();assert not other.locator('#workspace').is_visible()
   imported={'cars':[{'id':99,'placa':'IMP1234','modelo':'Importado','km':100,'prox':10000,'uso':None}],'drivers':[],'log':[],'fines':[]}
   other.locator('#email').fill('import-'+email);other.locator('#password').fill('test-password-123');other.get_by_role('button',name='Criar conta',exact=True).click();other.locator('#user-email').wait_for()
   import json
   other.locator('#import').set_input_files({'name':'backup.json','mimeType':'application/json','buffer':json.dumps(imported).encode()})
   other.get_by_text('Dados importados e salvos no servidor.',exact=True).wait_for()
   other.reload();other.locator('#user-email').wait_for();other.locator('[data-t="car"]').click();assert other.locator('.plate').inner_text()=='IMP1234'
   assert not errors, errors
   browser.close()
   print('PASS: cadastro, login, veículo, segundo navegador, motorista, conflito, saída e importação persistente; sem erros JavaScript.')
 finally:
  process.terminate(); process.wait(timeout=5)
