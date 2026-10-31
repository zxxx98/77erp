import { test, expect, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const ExcelJS=createRequire(import.meta.url)('exceljs');
import { createApp } from '../../server/app.js';
import { productionRegistrationUrl } from '../../shared/production-link.js';

async function fixture(page) {
  const objects=new Map(),storage={async head(c,key){if(!objects.has(key))throw new Error('missing');},async put(c,key,bytes){objects.set(key,Buffer.from(bytes));},async get(c,key){if(!objects.has(key))throw new Error('missing');return objects.get(key);},async remove(c,key){objects.delete(key);}};
  const {app,db,notifications,r2Backup}=createApp(':memory:',{qualityStorage:storage});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=async(path,body,method='POST')=>{const response=await page.request.fetch(`${base}/api${path}`,{method,data:{request_id:randomUUID(),schema_version:2,stage_schema_version:1,operation_schema_version:1,...body}});const result=await response.json();expect(response.ok(),JSON.stringify(result)).toBe(true);return result;};
  await post('/auth/setup',{username:'acceptadmin',password:'Admin-test-123'});await post('/settings/reset',{confirmation:'RESET_BUSINESS_DATA'});
  const settings=await(await page.request.get(`${base}/api/settings/r2-backup`)).json();
  await post('/settings/r2-backup',{...settings,account_id:'a'.repeat(32),bucket:'erp-backups',access_key:'test-access',secret_key:'test-secret'},'PUT');
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('验收');sheet.getCell('A1').value='测量值';sheet.getCell('B1').value=10;
  const definition={sheetName:'验收',fields:[{id:'measurement',name:'测量值',type:'number',labelRegion:'A1',valueRegion:'B1',required:true}]};
  const upload=await page.request.post(`${base}/api/quality/templates`,{multipart:{name:'工序验收测试',definition:JSON.stringify(definition),request_id:randomUUID(),file:{name:'工序验收.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await book.xlsx.writeBuffer())}}});
  const template=await upload.json();expect(upload.ok(),JSON.stringify(template)).toBe(true);
  await post(`/quality/templates/${template.id}/publish`,{version:template.version});
  const graph={nodes:['cut','out'].map((id,i)=>({id,name:i?'最终检验':'下料',note:'',x:24+220*i,y:24,acceptance_template_id:template.id})),edges:[{from:'cut',to:'out'}]};
  const route=await post('/process-routes',{name:'验收工艺',note:'',enabled:1,graph});
  const raw=await post('/products',{name:'验收原料',barcode:randomUUID(),category:'生产',unit:'件',cost:1,price:2,threshold:0});
  const product=await post('/products',{name:'验收产物',barcode:randomUUID(),category:'生产',unit:'件',cost:1,price:2,threshold:0,default_route_id:route.id});
  db.prepare('UPDATE products SET stock=100,inventory_value_cents=10000 WHERE id=?').run(raw.id);
  const bom=await post('/boms',{name:'验收配方',product_id:product.id,base_quantity:1,base_unit:'件',note:'',enabled:1,items:[{product_id:raw.id,quantity:2,unit:'件',note:''}]});
  const group=await post('/production-groups',{name:'检验生产组',description:''});
  const position=await post('/positions',{name:'现场登记员',access_mode:'production_only',permissions:['production_register']});
  await post('/users',{username:'acceptworker',employee_no:'acceptworker',password:'Worker-test-123',name:'现场检验员',role:'employee',position_id:position.id,production_group_id:group.id});
  const plan=await post('/production-orders/prepare',{bom_id:bom.id,bom_version:bom.version,planned_quantity:10});
  const draft=await post('/production-orders',{bom_id:bom.id,bom_version:bom.version,planned_quantity:10,structure_token:plan.structure_token,note:'',production_group_id:group.id});
  const started=await post(`/production-orders/${draft.id}/start`,{version:draft.version}),doc=started.material_documents[0];
  await post(`/production-material-documents/${doc.id}/confirm`,{version:doc.version});
  await post('/auth/logout',{});await post('/auth/login',{username:'acceptworker',password:'Worker-test-123'});
  const link=productionRegistrationUrl({origin:base,warehouseId:1,orderId:draft.id,number:draft.number,sourceId:db.prepare("SELECT value FROM app_metadata WHERE key='instance_id'").get().value});
  return {base,db,position,draft,link,objects,route,template,close:async()=>{await notifications.stop();await r2Backup.stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}};
}

for(const mode of ['desktop','mobile','pwa']) test(`${mode} requires an inspector and atomically registers a completed acceptance form`,async({browser})=>{
  const context=await browser.newContext({locale:'zh-CN',...(mode==='desktop'?{}:devices['iPhone 13']),serviceWorkers:mode==='pwa'?'allow':'block'});
  if(mode==='pwa') await context.addInitScript(()=>{const match=window.matchMedia.bind(window);window.matchMedia=query=>{const result=match(query);if(query==='(display-mode: standalone)')Object.defineProperty(result,'matches',{value:true});return result;};});
  const page=await context.newPage(),f=await fixture(page),errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(f.link);await expect(page.getByRole('heading',{name:'生产登记',exact:true})).toBeVisible();
    const dialogPromise=page.waitForEvent('dialog');
    const click=page.locator('.registration-operation').filter({hasText:'下料'}).click();
    const denied=await dialogPromise;expect(denied.message()).toBe('该工序需要验收，请通知验收员');await denied.accept();await click;
    expect(f.db.prepare('SELECT COUNT(*) n FROM production_operation_reports').get().n).toBe(0);
    f.db.prepare('UPDATE positions SET permissions=? WHERE id=?').run(JSON.stringify(['production_register','operation_accept']),f.position.id);
    await page.goto(f.link);await page.locator('.registration-operation').filter({hasText:'下料'}).click();
    await page.getByLabel('本次数量',{exact:true}).fill('2');await page.getByRole('button',{name:'提交登记',exact:true}).click();
    let modal=page.getByRole('dialog',{name:'工序验收单',exact:true});await expect(modal).toBeVisible();
    await modal.getByRole('button',{name:'取消',exact:true}).click();await expect(modal).toHaveCount(0);
    expect(f.db.prepare('SELECT COUNT(*) n FROM production_operation_reports').get().n).toBe(0);
    await page.getByRole('button',{name:'提交登记',exact:true}).click();modal=page.getByRole('dialog',{name:'工序验收单',exact:true});
    await modal.getByRole('button',{name:'字段填写',exact:true}).click();
    await modal.getByRole('button',{name:'校验并预览',exact:true}).click();await expect(modal.getByRole('button',{name:'验收合格并登记',exact:true})).toBeDisabled();
    await modal.getByRole('textbox',{name:'测量值 · B1',exact:true}).fill('12');
    await modal.getByRole('button',{name:'校验并预览',exact:true}).click();
    await modal.getByRole('checkbox',{name:'我已核对本批验收内容，确认验收合格',exact:true}).check();
    await page.screenshot({path:`/tmp/77erp-operation-acceptance-${mode}.png`,fullPage:true});
    await modal.getByRole('button',{name:'验收合格并登记',exact:true}).click();await expect(modal).toHaveCount(0);
    await expect(page.getByRole('status').filter({hasText:'已登记'})).toBeVisible();
    expect(f.db.prepare('SELECT COUNT(*) n FROM quality_acceptances').get().n).toBe(1);
    const report=f.db.prepare('SELECT * FROM production_operation_reports').get();expect(report.quantity).toBe(2);expect(report.acceptance_id).toBeGreaterThan(0);
    const acceptance=f.db.prepare('SELECT result FROM quality_acceptances').get();expect(JSON.parse(acceptance.result).sheets[0].value.测量值).toBe(12);
    await page.locator('.registration-operation').filter({hasText:'最终检验'}).click();await page.getByLabel('本次数量',{exact:true}).fill('1');
    await page.getByRole('button',{name:'提交登记',exact:true}).click();modal=page.getByRole('dialog',{name:'工序验收单',exact:true});
    await modal.getByRole('button',{name:'字段填写',exact:true}).click();await modal.getByRole('textbox',{name:'测量值 · B1',exact:true}).fill('11');
    await modal.getByRole('button',{name:'校验并预览',exact:true}).click();await modal.getByRole('checkbox',{name:'我已核对本批验收内容，确认验收合格',exact:true}).check();
    await modal.getByRole('button',{name:'验收合格并登记',exact:true}).click();await expect(modal).toHaveCount(0);
    await expect.poll(()=>f.db.prepare('SELECT COUNT(*) n FROM production_batches').get().n).toBe(1);
    expect(f.db.prepare('SELECT COUNT(*) n FROM quality_acceptances').get().n).toBe(2);
    expect(errors).toEqual([]);
  }finally{await f.close();await context.close();}
});

for(const mode of ['desktop','mobile']) test(`${mode} edits operation template bindings while existing orders keep their snapshot`,async({browser})=>{
  const context=await browser.newContext({locale:'zh-CN',...(mode==='desktop'?{}:devices['iPhone 13'])}),page=await context.newPage(),f=await fixture(page);
  try{
    await page.request.post(`${f.base}/api/auth/logout`,{data:{}});await page.request.post(`${f.base}/api/auth/login`,{data:{username:'acceptadmin',password:'Admin-test-123'}});
    await page.goto(`${f.base}/#process-routes`);await page.getByRole('button',{name:'编辑路线',exact:true}).click();
    const binding=page.getByRole('combobox',{name:'绑定验收模板',exact:true});
    await binding.click();await page.getByRole('option',{name:'不需要验收',exact:true}).click();
    await page.getByRole('button',{name:'保存路线',exact:true}).click();await expect(page.getByText('工艺路线已保存',{exact:true})).toBeVisible();
    expect(JSON.parse(f.db.prepare('SELECT graph FROM process_routes WHERE id=?').get(f.route.id).graph).nodes[0].acceptance_template_id).toBeNull();
    const snapshot=JSON.parse(f.db.prepare('SELECT graph FROM production_routes WHERE production_id=?').get(f.draft.id).graph);
    expect(snapshot.nodes[0].acceptance_template_id).toBe(f.template.id);
    await page.getByRole('button',{name:'编辑路线',exact:true}).click();await binding.click();await page.getByRole('option').filter({hasText:'工序验收测试'}).click();
    await page.getByRole('button',{name:'保存路线',exact:true}).click();await expect(page.getByText('工艺路线已保存',{exact:true})).toBeVisible();
    expect(JSON.parse(f.db.prepare('SELECT graph FROM process_routes WHERE id=?').get(f.route.id).graph).nodes[0].acceptance_template_id).toBe(f.template.id);
  }finally{await f.close();await context.close();}
});
