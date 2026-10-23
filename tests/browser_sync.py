"""Two browser sessions: automatic fleet updates without destroying drafts."""
from playwright.sync_api import sync_playwright, expect
from pathlib import Path
from urllib.request import urlopen
import os
import subprocess
import tempfile
import time

with tempfile.TemporaryDirectory() as tmp:
    process=subprocess.Popen(['python3','server.py'],cwd=Path(__file__).resolve().parents[1],env={**os.environ,'PORT':'8004','FLEETON_DB':str(Path(tmp)/'sync.sqlite3')})
    try:
        for _ in range(100):
            try:urlopen('http://127.0.0.1:8004/').close();break
            except OSError:time.sleep(.05)
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
            first=browser.new_context();manager=first.new_page();errors=[];manager.on('pageerror',lambda e:errors.append(str(e)))
            # Install a controllable clock so the production 20-second timer is exercised.
            manager.clock.install()
            manager.goto('http://127.0.0.1:8004/')
            manager.locator('#email').fill('sync@example.com');manager.locator('#password').fill('sync-test-password');manager.get_by_role('button',name='Criar conta',exact=True).click();manager.locator('#user-email').wait_for()
            second=browser.new_context();writer=second.new_page();writer.goto('http://127.0.0.1:8004/')
            writer.locator('#email').fill('sync@example.com');writer.locator('#password').fill('sync-test-password');writer.get_by_role('button',name='Entrar',exact=True).click();writer.locator('#user-email').wait_for()
            def remote_change(change):
                writer.evaluate("""async change=>{
                  const session=await (await fetch('/api/session')).json();
                  const fleet=await (await fetch('/api/fleet')).json();
                  if(change==='create')fleet.state.cars=[{id:1,placa:'SYNC123',modelo:'Teste',km:100,prox:10000,uso:null}];
                  if(change==='out')fleet.state.cars[0].uso={mot:'Ana da Frota',dest:'Cliente',quando:'Agora',kmIni:100};
                  if(change==='in'){fleet.state.cars[0].uso=null;fleet.state.cars[0].km=125;}
                  const res=await fetch('/api/fleet',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:JSON.stringify({version:fleet.version,state:fleet.state})});
                  if(!res.ok)throw new Error('Remote fixture failed');
                }""",change)
            requests=[]
            manager.on('request',lambda r:requests.append(r.url))
            remote_change('create');manager.clock.fast_forward(20001)
            expect(manager.locator('#auto-sync-status')).to_contain_text('atualizada automaticamente')
            assert manager.evaluate('S.cars.length')==1
            reads=sum('/api/fleet' in u and '/api/fleetStatus' not in u for u in requests)
            manager.clock.fast_forward(20001)
            expect(manager.locator('#auto-sync-status')).to_contain_text('verificada')
            assert sum('/api/fleet' in u and '/api/fleetStatus' not in u for u in requests)==reads
            remote_change('out');manager.clock.fast_forward(20001)
            expect(manager.locator('#dash')).to_contain_text('Ana da Frota → Cliente')
            assert manager.evaluate('S.cars[0].uso.mot')=='Ana da Frota'
            manager.locator('[data-t="car"]').click();expect(manager.locator('.car')).to_contain_text('Ana da Frota')
            manager.locator('#np').fill('DRAFT999');manager.locator('#nm').fill('Não apagar')
            remote_change('in');manager.clock.fast_forward(20001)
            expect(manager.locator('#auto-sync-status')).to_contain_text('Há novidades')
            assert manager.locator('#np').input_value()=='DRAFT999' and manager.locator('#nm').input_value()=='Não apagar'
            assert manager.evaluate('S.cars[0].uso.mot')=='Ana da Frota'
            manager.on('dialog',lambda d:d.accept());manager.locator('#refresh').click();manager.locator('#user-email').wait_for()
            expect(manager.locator('.car')).to_contain_text('Disponível');assert manager.evaluate('S.cars[0].km')==125
            # A request started before the user types may not overwrite that new draft.
            remote_change('out')
            pending=[]
            manager.route('**/api/fleet',lambda route:pending.append(route))
            manager.evaluate('void pollFleetStatus()')
            manager.wait_for_function('fleetSyncRunning')
            for _ in range(100):
                if pending:break
                manager.wait_for_timeout(10)
            assert pending
            manager.locator('#np').fill('RACE999');pending.pop().continue_()
            expect(manager.locator('#auto-sync-status')).to_contain_text('Há novidades')
            assert manager.locator('#np').input_value()=='RACE999' and manager.evaluate('S.cars[0].uso') is None
            manager.unroute('**/api/fleet');manager.locator('#refresh').click();manager.locator('#user-email').wait_for()
            manager.wait_for_function("!hasWorkspaceDraft() && S.cars[0]?.uso?.mot==='Ana da Frota'")
            # A network failure must retain the last fleet and show its stale state.
            manager.route('**/api/fleetStatus',lambda route:route.abort())
            manager.evaluate('void pollFleetStatus()');expect(manager.locator('#auto-sync-status')).to_contain_text('Não foi possível verificar')
            assert manager.evaluate('S.cars[0].uso.mot')=='Ana da Frota'
            manager.unroute('**/api/fleetStatus')
            manager.evaluate('void pollFleetStatus()');expect(manager.locator('#auto-sync-status')).to_contain_text('verificada')
            # Logout stops background checks and ignores an actual late response.
            delayed=[];manager.route('**/api/fleetStatus',lambda route:delayed.append(route))
            manager.evaluate('void pollFleetStatus()')
            for _ in range(100):
                if delayed:break
                manager.wait_for_timeout(10)
            assert delayed
            manager.locator('#logout').click();manager.locator('#email').wait_for()
            delayed.pop().fulfill(status=200,content_type='application/json',body='{"role":"manager","owner_id":1,"version":999}')
            manager.wait_for_timeout(50)
            assert manager.evaluate('S.cars.length')==0 and manager.locator('#email').is_visible()
            before=len(requests)
            manager.clock.fast_forward(60001)
            assert len(requests)==before
            assert not errors,errors
            browser.close();print('PASS: polling real de 20 s, duas sessões, retirada/devolução, versão sem mudança, rascunhos, corrida de edição, falha de rede e saída.')
    finally:
        process.terminate();process.wait(timeout=5)
