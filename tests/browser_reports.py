"""Vehicle dossier and report UI against a disposable local account."""
from playwright.sync_api import sync_playwright, expect
from pathlib import Path
from urllib.request import urlopen
import csv, io, os, subprocess, tempfile, time

with tempfile.TemporaryDirectory() as tmp:
    process=subprocess.Popen(['python3','server.py'],cwd=Path(__file__).resolve().parents[1],env={**os.environ,'PORT':'8005','FLEETON_DB':str(Path(tmp)/'reports.sqlite3')})
    try:
        for _ in range(100):
            try:urlopen('http://127.0.0.1:8005/').close();break
            except OSError:time.sleep(.05)
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
            page=browser.new_page(viewport={'width':1440,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto('http://127.0.0.1:8005/')
            page.locator('#email').fill('reports@example.com');page.locator('#password').fill('reports-test-password');page.get_by_role('button',name='Criar conta',exact=True).click();page.locator('#user-email').wait_for()
            page.evaluate('''async()=>{
              const t=Date.parse('2026-10-10T08:00-03:00');const c=document.createElement('canvas');c.width=c.height=10;const photo=c.toDataURL('image/jpeg');
              const state={cars:[{id:1,placa:'AAA1234',modelo:'Uno',km:125,prox:10000,uso:null,ipva:'2027-01-01',lic:'',seg:'',revdata:'',pecas:[]},{id:2,placa:'BBB5678',modelo:'Gol',km:500,prox:10000,uso:{mot:'Bia',dest:'Cliente',quando:'10/10/2026',kmIni:500},pecas:[]}],drivers:[],fines:[{id:1,placa:'AAA1234',data:'2026-10-10T08:30',valor:50,desc:'Infração',pago:false}],log:[
               {tipo:'Saída',placa:'AAA1234',trip_id:'trip',det:'Ana → Cliente',t,km:110,foto:photo},
               {tipo:'Abastecimento',placa:'AAA1234',t:t+60000,valor:100,litros:20,det:'Posto'},
               {tipo:'Devolução',placa:'AAA1234',trip_id:'trip',det:'Ana rodou 15 km',t:t+3600000,km:125,rodou:15},
               {tipo:'Revisão',placa:'AAA1234',t:t+7200000,valor:200,det:'Óleo'},
               ...Array.from({length:55},(_,i)=>({tipo:'Outro',placa:'BBB5678',t:t+i,valor:1,det:i===0?'=FORMULA()':'Custo '+i}))]};
              const data=await api('fleet',{version:cloud.version,state});cloud.version=data.version;resetView(state);cloud.lastState=JSON.stringify(stateOnly());
            }''')
            expect(page.locator('.fleet-overview .kpi')).to_have_count(4)
            page.screenshot(path='/tmp/fleeton-simplified-dashboard.png',full_page=True,animations='disabled')
            expect(page.locator('#dash')).to_contain_text('Bia → Cliente')
            page.locator('[data-overview-page="fin"]').click();expect(page.locator('#fin')).to_be_visible();page.locator('[data-t="dash"]').click()
            expect(page.locator('#dashboard-analytics')).not_to_be_visible()
            original_state=page.evaluate('stateOnly()');original_version=page.evaluate('cloud.version')
            page.locator('#dashboard-analysis-disclosure > summary').click();expect(page.get_by_role('heading',name='Gasto por mês',exact=True)).to_be_visible()
            page.locator('[data-go="per:tri"]').click();expect(page.get_by_role('heading',name='Gasto por mês',exact=True)).to_be_visible()
            page.locator('#dashboard-analysis-disclosure > summary').click()
            page.evaluate('''()=>{const copy=structuredClone(stateOnly());for(let i=3;i<9;i++)copy.cars.push({id:i,placa:'EXTRA'+i,modelo:'Carro',km:500,prox:10000,uso:{mot:'Bia',dest:'Cliente',quando:'Hoje',kmIni:500},pecas:[]});resetView(copy)}''')
            expect(page.locator('.overview-item')).to_have_count(5);page.locator('[data-overview-inuse]').click();expect(page.locator('#vehicle-status')).to_have_value('inuse');expect(page.locator('.car:visible')).to_have_count(7)
            page.evaluate('(state)=>resetView(state)',original_state);assert page.evaluate('cloud.version')==original_version
            page.locator('[data-t="dash"]').click();page.locator('[data-overview-page="reports"]').click();expect(page.locator('#reports')).to_be_visible()
            page.locator('[data-t="car"]').click();page.locator('#clear-vehicle-filters').click();expect(page.locator('[data-go="docs:1"]')).not_to_be_visible()
            page.locator('.car[data-car-id="1"] .vehicle-options summary').focus();page.keyboard.press('Enter');expect(page.locator('[data-go="docs:1"]')).to_be_visible()
            page.locator('[data-go="docs:1"]').click();expect(page.locator('#d1')).to_be_visible();page.locator('[data-go="cancel:0"]').click();page.wait_for_function('!cloud.busy')
            page.screenshot(path='/tmp/fleeton-simplified-vehicles.png',full_page=True,animations='disabled')
            page.locator('#car [data-open-vehicle="1"]').click()

            expect(page.locator('#detail')).to_be_visible();expect(page.locator('#detail')).to_contain_text('R$ 350,00')
            page.locator('[data-detail-tab="trips"]').click();expect(page.locator('#detail-content tbody tr')).to_have_count(2)
            page.locator('[data-detail-tab="photos"]').click();expect(page.locator('#detail-content img')).to_have_count(1)
            page.locator('#detail-content .inspection-gallery button').click();expect(page.locator('#inspection-photo-dialog')).to_be_visible();page.keyboard.press('Escape')
            page.locator('[data-detail-tab="maintenance"]').click();expect(page.locator('#detail-content')).to_contain_text('Óleo')
            page.locator('[data-detail-tab="documents"]').click();expect(page.locator('#detail-content')).to_contain_text('01/01/2027')
            page.locator('[data-detail-tab="costs"]').click();expect(page.locator('#detail-content')).to_contain_text('Total registrado: R$ 350,00')
            page.screenshot(path='/tmp/fleeton-vehicle.png',full_page=True)
            page.locator('[data-detail-report]').click();expect(page.locator('#report-count')).to_contain_text('5 registros')
            page.locator('#report-driver').select_option('n:ana');expect(page.locator('#report-count')).to_contain_text('4 registros')
            page.locator('#report-kind').select_option('fuel');expect(page.locator('#report-count')).to_contain_text('1 registro')
            page.locator('[data-report-period="all"]').click();expect(page.locator('#report-kind')).to_have_value('fuel');expect(page.locator('#report-driver')).to_have_value('n:ana')
            page.locator('#clear-report-filters').click();expect(page.locator('#report-count')).to_contain_text('60 registros');expect(page.locator('#report-results tbody tr')).to_have_count(50)
            page.locator('#report-next').click();expect(page.locator('#report-results tbody tr')).to_have_count(10)
            with page.expect_download() as download_info:page.locator('#export-report').click()
            downloaded=download_info.value
            with open(downloaded.path(),encoding='utf-8-sig',newline='') as f:rows=list(csv.reader(f,delimiter=';'))
            assert len(rows)==61 and any("'=FORMULA()" in cell for row in rows for cell in row)
            page.evaluate('window.print=()=>{window.dispatchEvent(new Event("beforeprint"))}')
            page.locator('#print-report').click();expect(page.locator('#report-print tbody tr')).to_have_count(60)
            page.emulate_media(media='print');expect(page.locator('#report-print')).to_be_visible();expect(page.locator('#report-results')).not_to_be_visible();page.pdf(path='/tmp/fleeton-report.pdf');page.emulate_media(media='screen')
            page.locator('#report-from').fill('2026-10-11');page.locator('#report-to').fill('2026-10-10');expect(page.locator('#report-error')).to_contain_text('posterior');expect(page.locator('#export-report')).to_be_disabled()
            page.locator('#report-from').fill('2026-10-10');expect(page.locator('#report-count')).to_contain_text('60 registros')
            page.locator('#report-vehicle').select_option('AAA1234');expect(page.locator('#report-count')).to_contain_text('5 registros')
            page.evaluate('resetView(stateOnly())');expect(page.locator('#reports')).to_be_visible();expect(page.locator('#report-vehicle')).to_have_value('AAA1234');expect(page.locator('#report-count')).to_contain_text('5 registros')
            page.screenshot(path='/tmp/fleeton-reports.png',full_page=True)
            page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path='/tmp/fleeton-reports-mobile.png',full_page=True,animations='disabled')
            page.locator('#menu-toggle').click();page.locator('[data-t="car"]').click();page.locator('#car [data-open-vehicle="2"]').click();expect(page.locator('#detail-content')).to_contain_text('Bia');assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            page.locator('[data-detail-tab="overview"]').focus();page.keyboard.press('End');expect(page.locator('[data-detail-tab="costs"]')).to_be_focused()
            page.locator('[data-detail-tab="maintenance"]').click();page.locator('[data-detail-edit="maintenance"]').click();expect(page.locator('#lc')).to_have_value('2');expect(page.locator('#lt')).to_have_value('Revisão');expect(page.locator('#lk')).to_have_value('500')
            page.evaluate('openVehicleDetail(2)');page.locator('[data-detail-tab="documents"]').click();page.locator('[data-detail-edit="documents"]').click();expect(page.locator('#car')).to_be_visible();assert page.evaluate('docOpen')==2
            page.reload();page.locator('#user-email').wait_for();page.locator('#menu-toggle').click();page.locator('[data-t="reports"]').click();page.locator('#clear-report-filters').click();expect(page.locator('#report-count')).to_contain_text('60 registros')
            assert not errors,errors
            browser.close();print('PASS: detalhes, fotos, custos, documentos, motorista, filtros, paginação, CSV completo, PDF completo, persistência e celular.')
    finally:
        process.terminate();process.wait(timeout=5)
