"""QR PNG/print and login deep links against real local API with isolated accounts."""
from playwright.sync_api import sync_playwright, expect
from pathlib import Path
from urllib.request import urlopen
import os, subprocess, tempfile, time
with tempfile.TemporaryDirectory() as tmp:
    process=subprocess.Popen(['python3','server.py'],cwd=Path(__file__).resolve().parents[1],env={**os.environ,'PORT':'8008','FLEETON_DB':str(Path(tmp)/'qr.sqlite3')})
    try:
        for _ in range(100):
            try:urlopen('http://127.0.0.1:8008/').close();break
            except OSError:time.sleep(.05)
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
            context=browser.new_context(viewport={'width':1440,'height':1000});page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto('http://127.0.0.1:8008/');page.locator('#email').fill('qr@example.com');page.locator('#password').fill('qr-test-password');page.get_by_role('button',name='Criar conta',exact=True).click();page.locator('#user-email').wait_for()
            page.evaluate('''async()=>{const state={cars:[{id:1,placa:'QR1234',modelo:'Uno',km:100,prox:10000,uso:null},{id:2,placa:'QR5678',modelo:'Gol',km:200,prox:10000,uso:null}],drivers:[],log:[],fines:[]};const result=await api('fleet',{version:cloud.version,state});cloud.version=result.version;resetView(state);cloud.lastState=JSON.stringify(stateOnly());}''')
            # Saved company logo is drawn above the QR without covering its modules.
            page.evaluate('''async()=>{
              const link=FleetQRLinks.url(location.origin,cloud.context.user_id,1);
              const plain=await vehicleQRLabel(link,S.cars[0],{name:'Empresa sem logo'});if(plain.hasLogo)throw new Error('Unexpected logo');
              const invalid=await vehicleQRLabel(link,S.cars[0],{name:'Empresa',logo:'data:image/jpeg;base64,AAAA'});if(invalid.hasLogo)throw new Error('Invalid image accepted');
              const c=document.createElement('canvas');c.width=400;c.height=112;const x=c.getContext('2d');x.fillStyle='#1655bb';x.fillRect(0,0,400,112);x.fillStyle='#fff';x.font='bold 30px sans-serif';x.fillText('EMPRESA DE TESTE',25,68);
              companyState=await api('company',{name:'Empresa de teste',cnpj:'',phone:'',address:'',logo:c.toDataURL('image/jpeg',.9)});displayCompany();
            }''')
            page.locator('[data-t="car"]').click();page.locator('#car [data-open-vehicle="1"]').click();page.locator('#detail [data-vehicle-qr="1"]').click();expect(page.locator('#vehicle-qr-status')).to_contain_text('Pronto')
            expect(page.locator('#vehicle-qr-dialog')).to_be_visible();assert page.evaluate('isFleetEditing()');link=page.locator('#vehicle-qr-link').input_value();assert '#vehicle=1&fleet=' in link
            with page.expect_download() as info:page.locator('#download-vehicle-qr').click()
            assert info.value.suggested_filename=='fleeton-QR1234-qr.png';assert Path(info.value.path()).read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
            # Decode the actual generated printable PNG using an independent reader.
            page.add_script_tag(path=str(Path(__file__).resolve().parents[1]/'node_modules/jsqr/dist/jsQR.js'))
            decoded=page.evaluate('''async()=>{const img=document.querySelector('#vehicle-qr-image');await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return jsQR(ctx.getImageData(0,0,c.width,c.height).data,c.width,c.height)?.data;}''')
            assert decoded==link
            expect(page.locator('#vehicle-qr-status')).to_contain_text('com a logo')
            assert page.locator('#vehicle-qr-image').evaluate('(img)=>img.naturalHeight')==1000
            color=page.evaluate("(()=>{const img=document.querySelector('#vehicle-qr-image'),c=document.createElement('canvas');c.width=680;c.height=1000;const x=c.getContext('2d');x.drawImage(img,0,0);return Array.from(x.getImageData(150,40,1,1).data)})()")
            assert color[2]>150 and color[0]<50,color
            page.screenshot(path='/tmp/fleeton-qr.png',full_page=True,animations='disabled')
            page.evaluate('window.print=()=>window.dispatchEvent(new Event("beforeprint"))');page.locator('#print-vehicle-qr').click();page.emulate_media(media='print');expect(page.locator('#vehicle-qr-print')).to_be_visible();expect(page.locator('main')).not_to_be_visible();page.pdf(path='/tmp/fleeton-qr.pdf');page.emulate_media(media='screen');page.evaluate('window.dispatchEvent(new Event("afterprint"))');assert not page.evaluate('document.body.dataset.printVehicleQr')
            page.set_viewport_size({'width':390,'height':844});page.screenshot(path='/tmp/fleeton-qr-mobile.png',full_page=True,animations='disabled');assert page.locator('#vehicle-qr-dialog').evaluate('(d)=>d.scrollWidth<=d.clientWidth')
            page.keyboard.press('Escape');expect(page.locator('#vehicle-qr-dialog')).to_have_count(0)
            scan=context.new_page();scan.goto(link);scan.locator('#user-email').wait_for();expect(scan.locator('#detail')).to_be_visible();expect(scan.locator('#detail h2')).to_have_text('QR1234');assert not scan.evaluate('location.hash')
            scan.locator('[data-t="car"]').click();scan.locator('#np').fill('DRAFT')
            scan.evaluate('(link)=>location.hash=new URL(link).hash',link.replace('vehicle=1','vehicle=2'));expect(scan.locator('#sync-status')).to_contain_text('Termine a edição');expect(scan.locator('#np')).to_have_value('DRAFT')
            scan.goto(link.replace('vehicle=1','vehicle=999'));scan.reload();expect(scan.locator('#sync-status')).to_contain_text('Veículo não encontrado')
            fresh=browser.new_context();login=fresh.new_page();login.goto(link);expect(login.locator('#email')).to_be_visible();assert not login.locator('#workspace').is_visible()
            login.locator('#email').fill('qr@example.com');login.locator('#password').fill('qr-test-password');login.get_by_role('button',name='Entrar',exact=True).click();expect(login.locator('#detail')).to_be_visible();expect(login.locator('#detail h2')).to_have_text('QR1234')
            other=browser.new_context().new_page();other.goto(link);other.locator('#email').fill('other-qr@example.com');other.locator('#password').fill('qr-test-password');other.get_by_role('button',name='Criar conta',exact=True).click();expect(other.locator('#sync-status')).to_contain_text('outra empresa');expect(other.locator('#detail')).not_to_be_visible()
            assert not errors,errors
            browser.close();print('PASS: QR com logo salvo, proporções, fallback sem logo/imagem inválida, leitura do PNG, PDF, celular, login e isolamento.')
    finally:process.terminate();process.wait(timeout=5)
