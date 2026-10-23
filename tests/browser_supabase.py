"""Offline browser contract test against the real Supabase SDK with mocked HTTPS APIs.
The PostgreSQL/RLS migration is independently exercised by npm test.
"""
from playwright.sync_api import sync_playwright, expect
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
        profile_context={'role':'manager','user_id':user['id'],'owner_id':user['id'],'profile':{'name':'','avatar':''},'invitation':None}
        invite_failure={'enabled':False}
        team={'members':[],'invites':[]}
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
            if path.startswith('/rest/v1/rpc/fleeton_sync_status'):return reply({'role':profile_context['role'],'owner_id':profile_context['owner_id'],'version':fleet['version']})
            if path.startswith('/rest/v1/rpc/fleeton_context'):return reply(profile_context)
            if path.startswith('/rest/v1/rpc/fleeton_accept_invite'):
                if invite_failure['enabled']:return reply({'code':'P0001','message':'TEAM_OTHER_FLEET'},400)
                profile_context.update(role='driver',owner_id='22222222-2222-2222-2222-222222222222',invitation=None);return reply(profile_context)
            if path.startswith('/rest/v1/rpc/fleeton_save_profile'):
                args=req.post_data_json;profile_context['profile']={'name':args['p_name'],'avatar':args['p_avatar']};return reply(profile_context['profile'])
            if path.startswith('/rest/v1/rpc/fleeton_team'):
                args=req.post_data_json
                if args['p_action']=='invite':team['invites']=[{'email':args['p_email']}]
                if args['p_action']=='remove':team['invites']=[]
                return reply(team)
            if path.startswith('/rest/v1/rpc/fleeton_driver_odometer'):
                args=req.post_data_json
                car=fleet['state']['cars'][0]
                if args['p_action']=='out':car['uso']={'user_id':user['id'],'mot':'Ana','dest':args['p_destination'],'quando':'Hoje','kmIni':car['km']}
                else:car['uso']=None;car['km']=args['p_km']
                fleet['version']+=1;return reply(fleet)
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
        assert not page.locator('#account-settings').evaluate('(e)=>e.open')
        page.locator('#profile-navigation').click()
        page.locator('#edit-name').fill('Ana Lopes')
        image=page.evaluate("(()=>{const c=document.createElement('canvas');c.width=c.height=10;c.getContext('2d').fillRect(0,0,10,10);return c.toDataURL('image/png').split(',')[1]})()")
        page.locator('#edit-avatar').set_input_files({'name':'avatar.png','mimeType':'image/png','buffer':base64.b64decode(image)})
        page.get_by_role('button',name='Salvar perfil',exact=True).click();page.get_by_text('Perfil salvo.',exact=True).wait_for()
        assert page.locator('#profile-name').inner_text()=='Ana Lopes'
        assert profile_context['profile']['avatar'].startswith('data:image/jpeg;base64,')
        page.locator('#invite-email').fill('driver@example.com');page.get_by_role('button',name='Convidar motorista',exact=True).click()
        page.get_by_text('driver@example.com · Convite pendente',exact=True).wait_for()
        page.locator('[data-t="dash"]').click()
        assert page.locator('#profile-navigation').get_attribute('aria-current')=='false'
        page.screenshot(path='/tmp/fleeton-profile.png',full_page=True,animations='disabled')
        page.locator('[data-t="car"]').click();page.locator('#np').fill('CLOUD123');page.locator('#nm').fill('Nuvem');page.locator('#nk').fill('100');page.locator('#nr').fill('10000');page.locator('[data-go="add:0"]').click()
        page.get_by_text('Salvo no servidor.',exact=True).wait_for()
        assert fleet['state']['cars'][0]['placa']=='CLOUD123'
        page.reload();page.locator('#user-email').wait_for();page.locator('[data-t="car"]').click();assert page.locator('.plate').inner_text()=='CLOUD123'
        page.set_viewport_size({'width':390,'height':844})
        page.wait_for_function("document.querySelector('#app-sidebar').inert")
        page.locator('#menu-toggle').click();page.locator('#profile-navigation').click()
        assert page.locator('#account-settings').is_visible()
        assert page.locator('#workspace').is_hidden()
        assert page.locator('#page-title').inner_text()=='Meu perfil'
        page.screenshot(path='/tmp/fleeton-mobile.png',full_page=True,animations='disabled')
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.locator('.theme-toggle').click();assert page.locator('html').get_attribute('data-theme')=='dark'
        page.screenshot(path='/tmp/fleeton-mobile-dark.png',full_page=True,animations='disabled')
        page.locator('#menu-toggle').click();page.keyboard.press('Escape')
        assert page.locator('#menu-toggle').get_attribute('aria-expanded')=='false'
        page.locator('#menu-toggle').click();page.locator('[data-t="car"]').click()
        assert page.locator('#workspace').is_visible()
        page.set_viewport_size({'width':1280,'height':720})
        page.wait_for_function("!document.querySelector('#app-sidebar').inert")
        page.locator('.theme-toggle').click()
        # Use dates relative to the same Brasilia calendar as the application.
        dates=page.evaluate("(()=>{const day=FleetInsights.today();const offset=n=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);return {past:offset(-1),today:day,soon:offset(1),future:offset(60)}})()")
        original_car=fleet['state']['cars'][0]
        original_car['ipva']=dates['past'];original_car['seg']=dates['today']
        fleet['state']['cars'] += [{'id':2,'placa':'XYZ-4567','modelo':'Saveiro','km':100,'prox':10000,'uso':{'mot':'João da Silva','dest':'Cliente','quando':'Hoje','kmIni':100}}, {'id':3,'placa':'REV1234','modelo':'Fiorino','km':9500,'prox':10000,'uso':None}]
        fleet['state']['drivers']=[{'id':7,'nome':'Ana teste','cnh':dates['soon']}]
        page.locator('#refresh').click();page.get_by_text('Dados carregados do servidor.',exact=True).wait_for()
        expect(page.locator('#logout')).to_have_count(1)
        expect(page.locator('#profile-avatar')).to_have_count(1)
        expect(page.locator('.account-header .account-identity')).to_have_count(0)
        page.locator('#alerts-shortcut').click()
        expect(page.locator('.alert-item')).to_have_count(4)
        page.locator('#alert-severity').select_option('urgent');expect(page.locator('.alert-item')).to_have_count(2)
        page.locator('#alert-category').select_option('drivers');expect(page.locator('.alert-item')).to_have_count(0)
        page.locator('#clear-alert-filters').click();expect(page.locator('.alert-item')).to_have_count(4)
        page.locator('[data-alert-car]').first.click()
        expect(page.locator('.car:visible')).to_have_count(1)
        page.locator('#clear-vehicle-filters').click();expect(page.locator('.car:visible')).to_have_count(3)
        page.locator('#vehicle-search').fill('joao da silva');assert page.locator('.car:visible .plate').inner_text()=='XYZ-4567'
        page.locator('#vehicle-search').fill('xyz4567');expect(page.locator('.car:visible')).to_have_count(1)
        page.locator('#clear-vehicle-filters').click()
        page.locator('#vehicle-status').select_option('available');expect(page.locator('.car:visible')).to_have_count(2)
        page.locator('#vehicle-driver').select_option('João da Silva');expect(page.locator('.car:visible')).to_have_count(0)
        assert page.locator('#vehicle-empty').is_visible()
        page.locator('#clear-vehicle-filters').click();page.locator('#vehicle-status').select_option('attention');expect(page.locator('.car:visible')).to_have_count(2)
        page.locator('#clear-vehicle-filters').click()
        first_id=original_car['id']
        page.locator(f'[data-go="docs:{first_id}"]').click();page.locator('#d1').fill(dates['future'])
        page.locator('#vehicle-search').fill('cloud123')
        assert page.locator('#d1').input_value()==dates['future']
        page.locator(f'[data-go="savedocs:{first_id}"]').click();page.get_by_text('Salvo no servidor.',exact=True).wait_for()
        page.locator('#alerts-shortcut').click();expect(page.locator('.alert-item')).to_have_count(3)
        page.locator('[data-alert-target="drv"]').click()
        page.locator('[data-go="editcnh:7"]').click();page.locator('#driver-cnh-date').fill(dates['future']);page.locator('[data-go="savecnh:7"]').click()
        page.get_by_text('Salvo no servidor.',exact=True).wait_for();page.locator('#alerts-shortcut').click();expect(page.locator('.alert-item')).to_have_count(2)
        page.screenshot(path='/tmp/fleeton-alerts.png',full_page=True,animations='disabled')
        page.set_viewport_size({'width':390,'height':844});page.wait_for_function("document.querySelector('#app-sidebar').inert")
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.screenshot(path='/tmp/fleeton-alerts-mobile.png',full_page=True,animations='disabled')
        page.set_viewport_size({'width':1280,'height':720});page.wait_for_function("!document.querySelector('#app-sidebar').inert")
        # Return to the original fixture for the remaining permission/conflict checks.
        fleet['state']['cars']=[original_car];original_car.pop('ipva',None);original_car.pop('seg',None);fleet['state']['drivers']=[]
        page.locator('#refresh').click();page.get_by_text('Dados carregados do servidor.',exact=True).wait_for()
        page.locator('[data-t="car"]').click();page.locator('#clear-vehicle-filters').click()
        fleet['version']+=1
        page.locator('#np').fill('STALE123');page.locator('#nm').fill('Conflito');page.locator('[data-go="add:0"]').click()
        page.get_by_text('A frota mudou em outro dispositivo.',exact=False).wait_for();assert page.locator('#workspace').evaluate('(e)=>e.inert')
        page.on('dialog',lambda d:d.accept());page.locator('#refresh').click();page.get_by_text('Dados carregados do servidor.',exact=True).wait_for()
        page.evaluate("window.dispatchEvent(new Event('fleeton-recovery'))")
        page.locator('#new-password').fill('new-password-123');page.get_by_role('button',name='Salvar senha',exact=True).click();page.locator('#user-email').wait_for()
        # Missing optional sync migration is reported without downloading photos repeatedly.
        context.route('**/rest/v1/rpc/fleeton_sync_status',lambda route:route.fulfill(status=404,headers={'Access-Control-Allow-Origin':'*'},content_type='application/json',body=json.dumps({'code':'PGRST202','message':'Could not find fleeton_sync_status'})))
        page.evaluate('void pollFleetStatus()');expect(page.locator('#auto-sync-status')).to_contain_text('004_auto_sync.sql')
        assert page.evaluate('fleetSyncSetupRequired')
        context.unroute('**/rest/v1/rpc/fleeton_sync_status')
        page.locator('#refresh').click();page.locator('#user-email').wait_for()
        profile_context['role']='manager'
        profile_context['invitation']={'email':'manager@example.com'}
        invite_failure['enabled']=True
        page.reload();expect(page.locator('#auth-error')).to_contain_text('outra frota');expect(page.locator('#workspace')).not_to_be_visible()
        failed_context=max(i for i,x in enumerate(calls) if '/fleeton_context' in x)
        assert not any('/fleeton_get_fleet' in x for x in calls[failed_context:])
        invite_failure['enabled']=False
        invitation_start=len(calls)
        profile_context['owner_id']='22222222-2222-2222-2222-222222222222'
        fleet['state']['drivers']=[{'id':0,'nome':'Ana Lopes'}];fleet['state']['log']=[];fleet['state']['fines']=[]
        page.reload();page.locator('#user-email').wait_for()
        assert page.locator('#profile-role').inner_text()=='Motorista'
        accept_index=next(i for i,x in enumerate(calls[invitation_start:]) if '/fleeton_accept_invite' in x)
        fleet_index=next(i for i,x in enumerate(calls[invitation_start:]) if '/fleeton_get_fleet' in x)
        assert accept_index< fleet_index
        expect(page.get_by_role('button',name='Aceitar convite',exact=True)).to_have_count(0)
        page.reload();page.locator('#user-email').wait_for()
        assert sum('/fleeton_accept_invite' in x for x in calls[invitation_start:])==1
        assert not page.locator('.tabs').is_visible()
        expect(page.locator('#alerts-shortcut')).to_have_count(0)
        expect(page.locator('.alert-item')).to_have_count(0)
        expect(page.locator('#invite-form')).to_have_count(0) and page.locator('#import').count()==0
        assert not page.locator('[data-go="add:0"]').is_visible()
        page.locator('[data-go^="open:"]').click();page.locator('#dest').fill('Cliente');page.locator('#kmi').fill('100');page.locator('#comb').select_option('Cheio');page.locator('#inspection-confirm').check();page.locator('[data-go^="out:"]').click()
        page.get_by_text('Viagem registrada.',exact=True).wait_for();assert fleet['state']['cars'][0]['uso']['user_id']==user['id']
        page.locator('[data-go^="open:"]').click();page.locator('#kmf').fill('125');page.locator('#comb').select_option('1/2');page.locator('#inspection-confirm').check();page.locator('[data-go^="in:"]').click()
        page.wait_for_function("document.querySelector('.meta').textContent.includes('125')")
        assert fleet['state']['cars'][0]['km']==125
        expect(page.locator('#reports')).to_be_empty();expect(page.locator('#detail')).to_be_empty();expect(page.locator('.vehicle-detail-link:visible')).to_have_count(0)
        assert any('/fleeton_driver_odometer' in call for call in calls)
        page.locator('#logout').click();page.locator('#email').wait_for();assert not page.locator('#workspace').is_visible()
        assert any('/recover' in x for x in calls)
        assert not errors,errors
        browser.close()
        print('PASS: SDK Supabase (APIs simuladas), configuração ausente, confirmação de e-mail, recuperação, login, gravação, sessão restaurada, conflito, perfil com foto, convite, central de alertas, filtros, atualização de CNH, permissões nas telas, retirada/devolução e saída.')
finally:
    process.terminate();process.wait(timeout=5)
