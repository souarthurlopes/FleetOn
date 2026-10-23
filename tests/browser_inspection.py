"""Real local API/browser test: photos, required fields, persistence and comparison."""
from playwright.sync_api import sync_playwright, expect
from pathlib import Path
from urllib.request import urlopen
import base64
import os
import subprocess
import tempfile
import time

with tempfile.TemporaryDirectory() as tmp:
    process=subprocess.Popen(['python3','server.py'],cwd=Path(__file__).resolve().parents[1],env={**os.environ,'PORT':'8003','FLEETON_DB':str(Path(tmp)/'inspection.sqlite3')})
    try:
        for _ in range(100):
            try:urlopen('http://127.0.0.1:8003/').close();break
            except OSError:time.sleep(.05)
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
            page=browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto('http://127.0.0.1:8003/')
            page.locator('#email').fill('inspection@example.com');page.locator('#password').fill('inspection-test-password');page.get_by_role('button',name='Criar conta',exact=True).click();page.locator('#user-email').wait_for()
            page.locator('[data-t="drv"]').click();page.locator('#dn').fill('Ana da Frota');page.locator('[data-go="addd:0"]').click();page.wait_for_function('!cloud.busy')
            page.locator('[data-t="car"]').click();page.locator('#np').fill('CHECK123');page.locator('#nm').fill('Carro de teste');page.locator('#nk').fill('100');page.locator('#nr').fill('10000');page.locator('[data-go="add:0"]').click();page.wait_for_function('!cloud.busy')
            page.locator('[data-go^="open:"]').click();page.wait_for_function('!cloud.busy');page.locator('#dest').fill('Av. São João, 123, São Paulo - SP & Loja #2')
            page.locator('[data-go^="out:"]').click();expect(page.locator('#sync-status')).to_have_text('Informe o km da retirada, igual ou maior que o último registrado.')
            page.locator('#kmi').fill('99');page.locator('[data-go^="out:"]').click();expect(page.locator('#sync-status')).to_have_text('Informe o km da retirada, igual ou maior que o último registrado.')
            page.locator('#kmi').fill('110')
            page.locator('[data-go^="out:"]').click();expect(page.locator('.inspection-error')).to_have_text('Selecione o nível de combustível.')
            page.locator('#comb').select_option('Cheio')
            for el in page.locator('[data-inspection-item]').all():el.select_option('ok')
            page.locator('[data-inspection-item="exterior"]').select_option('damage')
            page.locator('[data-go^="out:"]').click();expect(page.locator('.inspection-error')).to_have_text('Descreva a avaria nas observações.')
            page.locator('#av').fill('Risco antigo na porta esquerda')
            page.locator('[data-go^="out:"]').click();expect(page.locator('.inspection-error')).to_have_text('Confirme as informações do checklist antes de continuar.')
            page.locator('#inspection-confirm').check()
            page.locator('[data-inspection-photo="front"]').set_input_files({'name':'invalid.png','mimeType':'image/png','buffer':b'invalid image'})
            expect(page.locator('[data-inspection-status="front"]')).to_contain_text('Não foi possível abrir')
            page.locator('[data-go^="out:"]').click();expect(page.locator('.inspection-error')).to_have_text('Substitua ou remova a foto que apresentou erro.')
            page.locator('[data-remove-inspection-photo="front"]').click()
            payload=page.evaluate("(()=>{const c=document.createElement('canvas');c.width=1400;c.height=1000;const x=c.getContext('2d');x.fillStyle='#079e91';x.fillRect(0,0,c.width,c.height);return c.toDataURL('image/png').split(',')[1]})()")
            image={'name':'vehicle.png','mimeType':'image/png','buffer':base64.b64decode(payload)}
            for side in ['front','rear']:
                page.locator(f'[data-inspection-photo="{side}"]').set_input_files(image);expect(page.locator(f'[data-inspection-status="{side}"]')).to_have_text('Foto pronta.')
            page.locator('[data-inspection-preview="front"] button').click();expect(page.locator('#inspection-photo-dialog')).to_be_visible();page.get_by_role('button',name='Fechar foto',exact=True).click()
            page.locator('[data-remove-inspection-photo="rear"]').click();expect(page.locator('[data-inspection-preview="rear"] img')).to_have_count(0)
            page.locator('[data-inspection-photo="rear"]').set_input_files(image);expect(page.locator('[data-inspection-status="rear"]')).to_have_text('Foto pronta.')
            page.set_viewport_size({'width':390,'height':844});page.wait_for_function("document.querySelector('#app-sidebar').inert")
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            page.screenshot(path='/tmp/fleeton-checklist-mobile.png',full_page=True,animations='disabled')
            page.locator('[data-go^="out:"]').click();page.wait_for_function('!cloud.busy && S.cars[0].uso!==null')
            route=page.locator('#car .vehicle-route');expect(route).to_be_visible();assert route.get_attribute('target')=='_blank'
            from urllib.parse import urlparse, parse_qs
            assert parse_qs(urlparse(route.get_attribute('href')).query)['destination']==['Av. São João, 123, São Paulo - SP & Loja #2']
            saved=page.evaluate('S.log[0]');assert len(saved['inspection']['photos'])==2 and saved['trip_id']
            assert saved['km']==110 and page.evaluate('S.cars[0].uso.kmIni')==110
            assert all(len(photo)<=65536 for photo in saved['inspection']['photos'].values())
            page.reload();page.locator('#user-email').wait_for();page.locator('#menu-toggle').click();page.locator('[data-t="car"]').click()
            page.locator('[data-go^="open:"]').click();page.wait_for_function('!cloud.busy');page.locator('#kmf').fill('125');page.locator('#comb').select_option('3/4')
            for el in page.locator('[data-inspection-item]').all():el.select_option('ok')
            page.locator('[data-inspection-item="exterior"]').select_option('damage');page.locator('[data-inspection-item="tires"]').select_option('damage');page.locator('#av').fill('Risco antigo e dano no pneu traseiro');page.locator('#inspection-confirm').check()
            page.locator('[data-inspection-photo="front"]').set_input_files(image);expect(page.locator('[data-inspection-status="front"]')).to_have_text('Foto pronta.')
            page.locator('[data-go^="in:"]').click();page.wait_for_function('!cloud.busy && S.cars[0].uso===null')
            expect(page.locator('#car .vehicle-route')).to_have_count(0)
            assert page.evaluate('S.log[0].trip_id===S.log[1].trip_id')
            assert page.evaluate('S.log[1].rodou')==15 and page.evaluate('S.log[1].km_fim')==125
            page.locator('#menu-toggle').click();page.locator('[data-t="hist"]').click();page.locator('[data-go="cmp:1"]').click();page.wait_for_function('!cloud.busy')
            expect(page.locator('.inspection-changed')).to_have_count(2)
            expect(page.locator('.inspection-gallery img')).to_have_count(3)
            page.screenshot(path='/tmp/fleeton-comparison-mobile.png',full_page=True,animations='disabled')
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            page.set_viewport_size({'width':1280,'height':900});page.wait_for_function("!document.querySelector('#app-sidebar').inert")
            page.screenshot(path='/tmp/fleeton-comparison.png',full_page=True,animations='disabled')
            page.locator('.inspection-gallery button').first.click();expect(page.locator('#inspection-photo-dialog')).to_be_visible();page.keyboard.press('Escape');expect(page.locator('#inspection-photo-dialog')).not_to_be_visible()
            page.reload();page.locator('#user-email').wait_for();page.locator('[data-t="hist"]').click();page.locator('[data-go="cmp:1"]').click();page.wait_for_function('!cloud.busy');expect(page.locator('.inspection-gallery img')).to_have_count(3)
            assert not errors,errors
            browser.close();print('PASS: checklist real com fotos compactadas, validações, retirada/devolução, persistência, comparação e celular.')
    finally:
        process.terminate();process.wait(timeout=5)
