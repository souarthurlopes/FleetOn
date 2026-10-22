"""Offline browser contract test against the real Supabase SDK with mocked HTTPS APIs.
The PostgreSQL/RLS migration is independently exercised by npm test.
"""
from playwright.sync_api import sync_playwright
import base64
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
process = subprocess.Popen(['python3','-m','http.server','8002','--bind','127.0.0.1','--directory','dist'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
    for _ in range(100):
        try:
            urlopen('http://127.0.0.1:8002/').close();break
        except OSError:
            time.sleep(.05)
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        context=browser.new_context()
        errors=[]
        page=context.new_page();page.on('pageerror',lambda e: errors.append(str(e)))
        context.route('**/config.js',lambda r:r.fulfill(content_type='text/javascript',body='window.FLEETON_CONFIG={backend:"supabase",supabaseUrl:"",supabasePublishableKey:""};'))
        page.goto('http://127.0.0.1:8002/')
        page.get_by_text('A conexão com o banco ainda não foi configurada.',exact=False).wait_for()
        config={'backend':'supabase','supabaseUrl':'https://fleeton-test.supabase.co','supabasePublishableKey':'sb_publishable_test_fixture'}
        context.route('**/config.js',lambda r:r.fulfill(content_type='text/javascript',body='window.FLEETON_CONFIG='+json.dumps(config)))
        user={'id':'11111111-1111-1111-1111-111111111111','aud':'authenticated','role':'authenticated','email':'ana@example.com','email_confirmed_at':'2026-01-01T00:00:00Z','app_metadata':{'provider':'email'},'user_metadata':{},'created_at':'2026-01-01T00:00:00Z'}
        def b64(x):return base64.urlsafe_b64encode(json.dumps(x).encode()).decode().rstrip('=')
        token=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':user['id'],'aud':'authenticated','role':'authenticated','email':user['email'],'exp':int(time.time())+3600})+'.test'
        session={'access_token':token,'refresh_token':'refresh-test','expires_in':3600,'token_type':'bearer','user':user}
        fleet={'version':0,'state':{'cars':[],'drivers':[],'log':[],'fines':[]}}
        calls=[]
        def remote(route):
            req=route.request;path=req.url.split('.co')[1];calls.append(path)
            headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'}
            def reply(body,status=200):route.fulfill(status=status,headers=headers,content_type='application/json',body=json.dumps(body))
            if req.method=='OPTIONS':return reply({})
            if path.startswith('/auth/v1/signup'):return reply({'user':user,'session':None})
            if path.startswith('/auth/v1/token'):return reply(session)
            if path.startswith('/auth/v1/user'):return reply(user)
            if path.startswith('/auth/v1/recover') or path.startswith('/auth/v1/logout'):return reply({})
            if path.startswith('/rest/v1/rpc/fleeton_get_fleet'):return reply(fleet)
            if path.startswith('/rest/v1/rpc/fleeton_save_fleet'):
                body=req.post_data_json
                if body['p_version']!=fleet['version']:return reply({'code':'P0001','message':'FLEET_CONFLICT'},400)
                fleet['version']+=1;fleet['state']=body['p_state'];return reply({'version':fleet['version']})
            return reply({'error':'unhandled test route'},500)
        context.route('https://fleeton-test.supabase.co/**',remote)
        page.reload();page.locator('#email').wait_for();page.locator('#email').fill(user['email']);page.locator('#password').fill('test-password-123')
        page.get_by_role('button',name='Criar conta',exact=True).click()
        page.get_by_text('Confira seu e-mail para confirmar o cadastro.',exact=False).wait_for()
        assert not page.locator('#workspace').is_visible()
        page.locator('#reset-password').click();page.get_by_text('Se o endereço estiver cadastrado',exact=False).wait_for()
        page.locator('#password').fill('test-password-123');page.get_by_role('button',name='Entrar',exact=True).click();page.locator('#user-email').wait_for()
        page.locator('[data-t="car"]').click();page.locator('#np').fill('CLOUD123');page.locator('#nm').fill('Nuvem');page.locator('#nk').fill('100');page.locator('#nr').fill('10000');page.locator('[data-go="add:0"]').click()
        page.get_by_text('Salvo no servidor.',exact=True).wait_for()
        assert fleet['state']['cars'][0]['placa']=='CLOUD123'
        page.reload();page.locator('#user-email').wait_for();page.locator('[data-t="car"]').click();assert page.locator('.plate').inner_text()=='CLOUD123'
        fleet['version']+=1
        page.locator('#np').fill('STALE123');page.locator('#nm').fill('Conflito');page.locator('[data-go="add:0"]').click()
        page.get_by_text('A frota mudou em outro dispositivo.',exact=False).wait_for();assert page.locator('#workspace').evaluate('(e)=>e.inert')
        page.on('dialog',lambda d:d.accept());page.locator('#refresh').click();page.get_by_text('Dados carregados do servidor.',exact=True).wait_for()
        page.evaluate("window.dispatchEvent(new Event('fleeton-recovery'))")
        page.locator('#new-password').fill('new-password-123');page.get_by_role('button',name='Salvar senha',exact=True).click();page.locator('#user-email').wait_for()
        page.locator('#logout').click();page.locator('#email').wait_for();assert not page.locator('#workspace').is_visible()
        assert any('/recover' in x for x in calls)
        assert not errors,errors
        browser.close()
        print('PASS: SDK Supabase (APIs simuladas), configuração ausente, confirmação de e-mail, recuperação, login, gravação, sessão restaurada, conflito e saída.')
finally:
    process.terminate();process.wait(timeout=5)
