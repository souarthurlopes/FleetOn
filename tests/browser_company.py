"""Company registration, branding, PDF and account isolation using disposable local DB."""
from playwright.sync_api import sync_playwright, expect
from pathlib import Path
from urllib.request import urlopen
import base64, os, subprocess, tempfile, time
with tempfile.TemporaryDirectory() as tmp:
    process=subprocess.Popen(['python3','server.py'],cwd=Path(__file__).resolve().parents[1],env={**os.environ,'PORT':'8006','FLEETON_DB':str(Path(tmp)/'company.sqlite3')})
    try:
        for _ in range(100):
            try:urlopen('http://127.0.0.1:8006/').close();break
            except OSError:time.sleep(.05)
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
            page=browser.new_page(viewport={'width':1440,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto('http://127.0.0.1:8006/');page.locator('#email').fill('company@example.com');page.locator('#password').fill('company-test-password');page.get_by_role('button',name='Criar conta',exact=True).click();page.locator('#user-email').wait_for()
            page.locator('[data-t="company"]').click();page.locator('#company-name').fill('Transportes Horizonte');page.locator('#company-cnpj').fill('abc');page.get_by_role('button',name='Salvar empresa',exact=True).click();expect(page.locator('#company-status')).to_contain_text('14 dígitos')
            page.locator('#company-cnpj').fill('12.345.678/0001-90');page.locator('#company-phone').fill('(11) 99999-9999');page.locator('#company-address').fill('Rua das Flores, 100')
            payload=page.evaluate("(()=>{const c=document.createElement('canvas');c.width=600;c.height=180;const ctx=c.getContext('2d');ctx.fillStyle='#2563eb';ctx.fillRect(0,0,600,180);ctx.fillStyle='white';ctx.font='bold 60px sans-serif';ctx.fillText('Horizonte',30,110);return c.toDataURL('image/png').split(',')[1]})()")
            page.locator('#company-logo').set_input_files({'name':'logo.png','mimeType':'image/png','buffer':base64.b64decode(payload)})
            page.get_by_role('button',name='Salvar empresa',exact=True).click();expect(page.locator('#company-status')).to_have_text('Empresa salva.')
            expect(page.locator('#company-identity')).to_contain_text('Transportes Horizonte');expect(page.locator('#company-identity img')).to_have_count(1)
            assert page.evaluate('!hasWorkspaceDraft()')
            assert page.locator('#company-logo-preview img').evaluate('(img)=>img.naturalWidth/img.naturalHeight')>3
            page.screenshot(path='/tmp/fleeton-company.png',full_page=True,animations='disabled')
            page.locator('#company-name').fill('Rascunho');page.evaluate('resetView(stateOnly())');expect(page.locator('#company-name')).to_have_value('Rascunho')
            page.on('dialog',lambda d:d.accept());page.locator('#refresh').click();expect(page.locator('#company-name')).to_have_value('Transportes Horizonte')
            page.reload();page.locator('#user-email').wait_for();page.locator('[data-t="company"]').click();expect(page.locator('#company-name')).to_have_value('Transportes Horizonte')
            page.locator('[data-t="reports"]').click()
            with page.expect_download() as download_info:page.locator('#export-report').click()
            assert 'CNPJ da empresa' in Path(download_info.value.path()).read_text(encoding='utf-8-sig')
            page.evaluate('window.print=()=>window.dispatchEvent(new Event("beforeprint"))');page.locator('#print-report').click();expect(page.locator('.company-print-heading')).to_contain_text('Transportes Horizonte');expect(page.locator('.company-print-heading')).to_contain_text('12.345.678/0001-90');expect(page.locator('.company-print-heading img')).to_have_count(1)
            page.locator('[data-t="company"]').click();page.set_viewport_size({'width':390,'height':844});page.screenshot(path='/tmp/fleeton-company-mobile.png',full_page=True,animations='disabled');assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            page.locator('#company-remove-logo').click();page.get_by_role('button',name='Salvar empresa',exact=True).click();expect(page.locator('#company-status')).to_have_text('Empresa salva.');expect(page.locator('#company-identity img')).to_have_count(0)
            page.locator('#menu-toggle').click();page.locator('#logout').click();page.locator('#email').wait_for();expect(page.locator('#company-identity')).to_have_count(0)
            page.locator('#email').fill('other-company@example.com');page.locator('#password').fill('company-test-password');page.get_by_role('button',name='Criar conta',exact=True).click();page.locator('#user-email').wait_for();page.locator('#menu-toggle').click();page.locator('[data-t="company"]').click();expect(page.locator('#company-name')).to_have_value('');expect(page.locator('#company-identity')).not_to_be_visible()
            assert not errors,errors
            browser.close();print('PASS: cadastro da empresa, logo proporcional, edição, rascunho, persistência, PDF, celular e isolamento entre contas.')
    finally:process.terminate();process.wait(timeout=5)
