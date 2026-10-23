"""Fine due dates: new/legacy records, editing, payment, reports and persistence."""
from playwright.sync_api import sync_playwright, expect
from pathlib import Path
from urllib.request import urlopen
import os, subprocess, tempfile, time
with tempfile.TemporaryDirectory() as tmp:
    process=subprocess.Popen(['python3','server.py'],cwd=Path(__file__).resolve().parents[1],env={**os.environ,'PORT':'8007','FLEETON_DB':str(Path(tmp)/'fines.sqlite3')})
    try:
        for _ in range(100):
            try:urlopen('http://127.0.0.1:8007/').close();break
            except OSError:time.sleep(.05)
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
            page=browser.new_page(viewport={'width':1440,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto('http://127.0.0.1:8007/');page.locator('#email').fill('fines@example.com');page.locator('#password').fill('fines-test-password');page.get_by_role('button',name='Criar conta',exact=True).click();page.locator('#user-email').wait_for()
            page.evaluate('''async()=>{const state={cars:[{id:1,placa:'FINE123',modelo:'Uno',km:100,prox:10000,uso:null}],drivers:[],log:[],fines:[{id:1,placa:'FINE123',data:'2026-10-10T10:00',desc:'Multa antiga',valor:50,pago:false}]};const data=await api('fleet',{version:cloud.version,state});cloud.version=data.version;resetView(state);cloud.lastState=JSON.stringify(stateOnly());}''')
            dates=page.evaluate("(()=>{const day=FleetInsights.civilDay(FleetInsights.today());return {past:new Date((day-1)*86400000).toISOString().slice(0,10),future:new Date((day+10)*86400000).toISOString().slice(0,10)}})()")
            page.locator('[data-t="fin"]').click();expect(page.locator('#fin tbody')).to_contain_text('Não informado')
            page.locator('#fd').fill('2026-10-20T09:00');page.locator('#fine-due').fill(dates['past']);page.locator('#fv').fill('100.50');page.locator('#fo').fill('Multa com vencimento');page.locator('[data-go="addf:0"]').click();page.wait_for_function('!cloud.busy')
            expect(page.locator('#fin tbody')).to_contain_text('Vencida');fine_id=page.evaluate('S.fines[1].id')
            assert page.evaluate('S.fines[1].vencimento')==dates['past']
            page.reload();page.locator('#user-email').wait_for();page.locator('[data-t="fin"]').click();expect(page.locator('#fin tbody')).to_contain_text('Vencida')
            page.locator(f'[data-go="payf:{fine_id}"]').click();page.wait_for_function('!cloud.busy');expect(page.locator('#fin tbody')).not_to_contain_text('Vencida');expect(page.locator(f'[data-go="payf:{fine_id}"]')).to_have_text('Paga')
            page.locator(f'[data-go="payf:{fine_id}"]').click();page.wait_for_function('!cloud.busy');expect(page.locator('#fin tbody')).to_contain_text('Vencida')
            page.locator('[data-go="editfinedue:1"]').click();page.wait_for_function('!cloud.busy');assert page.evaluate('isFleetEditing()')
            page.locator('#fine-due-edit').fill(dates['future']);page.locator('[data-go="savefinedue:1"]').click();page.wait_for_function('!cloud.busy');assert page.evaluate('S.fines[0].vencimento')==dates['future']
            expect(page.locator('#fin tbody')).to_contain_text('A vencer')
            page.locator('[data-go="editfinedue:1"]').click();page.wait_for_function('!cloud.busy');page.locator('#fine-due-edit').fill('');page.locator('[data-go="cancelfinedue:0"]').click();page.wait_for_function('!cloud.busy');assert page.evaluate('S.fines[0].vencimento')==dates['future']
            page.screenshot(path='/tmp/fleeton-fine-due.png',full_page=True,animations='disabled')
            page.locator('[data-t="reports"]').click();page.locator('#clear-report-filters').click();expect(page.locator('#report-results')).to_contain_text('Vencimento: '+ '/'.join(reversed(dates['past'].split('-'))))
            with page.expect_download() as info:page.locator('#export-report').click()
            csv=Path(info.value.path()).read_text(encoding='utf-8-sig');assert 'Vencimento da multa' in csv and '/'.join(reversed(dates['future'].split('-'))) in csv
            page.locator('[data-t="fin"]').click();page.set_viewport_size({'width':390,'height':844});page.screenshot(path='/tmp/fleeton-fine-due-mobile.png',full_page=True,animations='disabled');assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            page.locator('[data-go="editfinedue:1"]').click();page.wait_for_function('!cloud.busy');page.locator('#fine-due-edit').fill('');page.locator('[data-go="savefinedue:1"]').click();page.wait_for_function('!cloud.busy');assert page.evaluate('S.fines[0].vencimento')==''
            assert not errors,errors
            browser.close();print('PASS: vencimento de multa, legado, cadastro, edição, cancelamento, pagamento, CSV, persistência e celular.')
    finally:process.terminate();process.wait(timeout=5)
