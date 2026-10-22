import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { selectDataSheets, openSheetResults, closeSheetResults } from './quality-helpers.js';

const source=await readFile('tests/fixtures/quality-template.xlsx');
const multi='tests/fixtures/quality-template-multisheet.xlsx';
test.beforeAll(async({request})=>{
  const response=await request.post('/api/auth/setup',{data:{username:'admin',password:'Test-admin-123'}});expect([201,409]).toContain(response.status());
});
test.beforeEach(async({page})=>{
  expect((await page.request.post('/api/auth/login',{data:{username:'admin',password:'Test-admin-123'}})).ok()).toBe(true);
  const config=await(await page.request.get('/api/settings/r2-backup')).json();
  expect((await page.request.put('/api/settings/r2-backup',{data:{...config,account_id:'a'.repeat(32),bucket:'erp-backups',access_key:'test-access',secret_key:'test-secret',excel_prefix:'excel',enabled:false}})).ok()).toBe(true);
});
async function product(page,extra={}) {
  const response=await page.request.post('/api/products',{data:{name:'绑定测试物料',barcode:`BIND-${randomUUID().slice(0,8)}`,category:'品质绑定测试',unit:'件',cost:1,price:2,threshold:0,...extra}});
  expect(response.ok()).toBe(true);return response.json();
}
async function start(page,name,type='uniqueKey',keys=['绑定自动名称','BIND-CUSTOMER-KEY']) {
  const created=await page.request.post('/api/quality/templates',{multipart:{file:{name:'模板.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:source},name,
    definition:JSON.stringify({sheetName:'Sheet1',fields:[{id:'material',name:'物料标识',labelRegion:'A11',valueRegion:'B11',type}]}),request_id:randomUUID()}});
  expect(created.ok()).toBe(true);const row=await created.json();
  expect((await page.request.post(`/api/quality/templates/${row.id}/publish`,{data:{version:row.version}})).ok()).toBe(true);
  await page.goto('/#quality');await page.getByRole('button',{name:'验收单',exact:true}).click();await page.getByRole('button',{name:'导入验收单',exact:true}).click();
  await page.getByRole('combobox',{name:'验收模板',exact:true}).click();await page.getByRole('option',{name:`${name} · v1`,exact:true}).click();
  const zip=unzipSync(await readFile(multi));
  for(const [index,key] of keys.entries()){
    const path=`xl/worksheets/sheet${index?3:1}.xml`,text=key.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
    zip[path]=strToU8(strFromU8(zip[path]).replace(/<c r="B11"[^>]*>[\s\S]*?<\/c>/,`<c r="B11" t="inlineStr"><is><t>${text}</t></is></c>`));
  }
  await page.getByLabel('上传验收单 Excel').setInputFiles({name:'绑定验收数据.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(zipSync(zip))});
  await selectDataSheets(page,['一批到货','二批到货'],{skipBindings:false});
}
async function selectProduct(page,sheetName,code) {
  await page.getByRole('region',{name:`物料绑定 ${sheetName}`,exact:true}).getByRole('button',{name:/手动选择物料|更换绑定物料/}).click();
  const modal=page.getByRole('dialog',{name:'选择绑定物料',exact:true});
  await modal.getByRole('textbox',{name:'搜索绑定物料'}).fill(code);
  await modal.getByRole('row').filter({hasText:code}).getByRole('button',{name:'选择此物料',exact:true}).click();
}
test('multiple Sheets auto match material names and customer part numbers, allow override and keep saved bindings',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const automatic=await product(page,{name:'绑定自动名称',barcode:'BIND-NAME'});
  const customerResponse=await page.request.post('/api/contacts',{data:{name:'品质绑定客户',role:'customer',active:1,person:'',phone:'',address:'',note:'',request_id:randomUUID()}});expect(customerResponse.ok()).toBe(true);
  const customer=(await(await page.request.get('/api/contacts')).json()).find(customer=>customer.name==='品质绑定客户');
  const byPart=await product(page,{name:'客户料号物料',barcode:'BIND-PART',customer_part_numbers:[{customer_id:customer.id,part_number:'BIND-CUSTOMER-KEY'}]});
  const manual=await product(page,{name:'更换后的物料',barcode:'BIND-OVERRIDE',specification:'蓝色 / 12mm'});
  await start(page,'自动物料绑定');
  const first=page.getByRole('region',{name:'物料绑定 一批到货',exact:true}),second=page.getByRole('region',{name:'物料绑定 二批到货',exact:true});
  await expect(first).toContainText('BIND-NAME');await expect(second).toContainText('BIND-PART');await expect(first).toContainText('自动匹配');
  await expect(page.getByRole('button',{name:'确认保存验收单'})).toBeEnabled();
  await selectProduct(page,'二批到货','BIND-OVERRIDE');await expect(second).toContainText('手动选择');await expect(second).toContainText('蓝色 / 12mm');
  await expect(page.getByRole('region',{name:'验收解析结果'})).toHaveCount(0);
  await openSheetResults(page,'二批到货');await closeSheetResults(page);
  await expect(second).toContainText('BIND-OVERRIDE');
  await first.getByRole('checkbox').uncheck();await expect(first).toContainText('此 Sheet 不绑定物料');await first.getByRole('checkbox').check();await expect(first).toContainText('BIND-NAME');
  await page.screenshot({path:'output/ui-preview/quality-material-bindings.png',fullPage:true});
  const response=page.waitForResponse(response=>response.url().endsWith('/api/quality/acceptances')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'确认保存验收单'}).click();const saved=await(await response).json();
  expect(saved.bindings.map(binding=>binding.product_id)).toEqual([automatic.id,manual.id]);expect(saved.bindings[1].product_id).not.toBe(byPart.id);
  await expect(page.getByRole('heading',{name:'验收单详情',exact:true})).toBeVisible();await expect(first).toContainText('BIND-NAME');await page.getByRole('button',{name:'下一张',exact:true}).click();await expect(second).toContainText('BIND-OVERRIDE');
  await page.getByRole('button',{name:'返回验收单列表'}).click();await page.getByRole('row').filter({hasText:saved.number}).getByRole('button',{name:'查看详情',exact:true}).click();
  await expect(first).toContainText('BIND-NAME');await page.getByRole('button',{name:'下一张',exact:true}).click();await expect(second).toContainText('BIND-OVERRIDE');expect(errors).toEqual([]);
});
test('unmatched and ambiguous keys require manual choice or opt-out independently for each Sheet',async({page})=>{
  const a=await product(page,{name:'重复匹配名称',barcode:'BIND-DUPLICATE'});
  await product(page,{name:'重复匹配名称',barcode:'BIND-DUP-OTHER'});
  await start(page,'匹配冲突和手选','uniqueKey',['重复匹配名称','不存在料号']);
  const first=page.getByRole('region',{name:'物料绑定 一批到货',exact:true}),second=page.getByRole('region',{name:'物料绑定 二批到货',exact:true});
  await expect(first).toContainText('命中多个物料');await expect(page.getByRole('button',{name:'确认保存验收单'})).toBeDisabled();
  await selectProduct(page,'一批到货','BIND-DUPLICATE');await expect(first).toContainText(a.barcode);
  await expect(second).toContainText('未找到编码、名称或客户料号');
  await expect(page.getByRole('button',{name:'确认保存验收单'})).toBeDisabled();
  await second.getByRole('checkbox').uncheck();await expect(page.getByRole('button',{name:'确认保存验收单'})).toBeEnabled();
  const response=page.waitForResponse(response=>response.url().endsWith('/api/quality/acceptances')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'确认保存验收单'}).click();const saved=await(await response).json();expect(saved.bindings[1].product_id).toBeNull();expect(saved.bindings[0].mode).toBe('manual');
});
test('templates without a unique key support manual binding and opt-out without changing parsed data',async({page})=>{
  await product(page,{name:'无 KEY 手选物料',barcode:'BIND-NOKEY'});
  await start(page,'无 KEY 物料绑定','string');
  const first=page.getByRole('region',{name:'物料绑定 一批到货',exact:true}),second=page.getByRole('region',{name:'物料绑定 二批到货',exact:true});
  await expect(first).toContainText('模板未配置唯一 KEY');await expect(second).toContainText('模板未配置唯一 KEY');
  await expect(page.getByRole('button',{name:'确认保存验收单'})).toBeDisabled();
  await selectProduct(page,'一批到货','BIND-NOKEY');await second.getByRole('checkbox').uncheck();
  await page.getByRole('button',{name:'确认保存验收单'}).click();await expect(page.getByRole('heading',{name:'验收单详情',exact:true})).toBeVisible();
  await expect(first).toContainText('BIND-NOKEY');await page.getByRole('button',{name:'下一张',exact:true}).click();await expect(second).toContainText('此 Sheet 不绑定物料');
});

test('manual corrections refresh automatic key matches per sheet and retain deliberate material choices',async({page})=>{
  const a=await product(page,{name:'修正匹配物料甲',barcode:'CORRECT-KEY-A'}),b=await product(page,{name:'修正匹配物料乙',barcode:'CORRECT-KEY-B'});
  await start(page,'修正唯一KEY绑定','uniqueKey',[a.barcode,a.barcode]);
  const first=page.getByRole('region',{name:'物料绑定 一批到货',exact:true}),second=page.getByRole('region',{name:'物料绑定 二批到货',exact:true});
  await expect(first).toContainText(a.barcode);await expect(second).toContainText(a.barcode);
  await page.getByRole('button',{name:'查看上传表格',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'上传文件单元格定位',exact:true});
  await modal.locator('[data-address=B11]').click();await modal.getByLabel('修正内容').fill(b.barcode);await modal.getByRole('button',{name:'应用手动修正'}).click();
  await expect(modal.getByRole('button',{name:'恢复原始内容'})).toBeVisible();
  await modal.getByRole('button',{name:'关闭弹窗',exact:true}).click();
  await expect(first).toContainText(b.barcode);await expect(first).toContainText('自动匹配');await expect(second).toContainText(a.barcode);
  await selectProduct(page,'一批到货',a.barcode);await openSheetResults(page,'一批到货');
  await page.getByRole('region',{name:'手动修正记录',exact:true}).getByRole('button',{name:'B11 · 定位',exact:true}).click();
  await modal.getByLabel('修正内容').fill('无法匹配的新KEY');await modal.getByRole('button',{name:'应用手动修正'}).click();
  await expect(modal.locator('[data-address=B11]')).toContainText('无法匹配的新KEY');
  await expect(modal.getByRole('button',{name:'恢复原始内容'})).toBeEnabled();
  await modal.getByRole('button',{name:'关闭弹窗',exact:true}).click();await closeSheetResults(page);
  await expect(first).toContainText(a.barcode);await expect(first).toContainText('手动选择');
  const response=page.waitForResponse(r=>r.url().endsWith('/api/quality/acceptances')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'确认保存验收单'}).click();const saved=await(await response).json();
  expect(saved.bindings[0].product_id).toBe(a.id);expect(saved.bindings[0].keyValue).toBe('无法匹配的新KEY');expect(saved.bindings[1].product_id).toBe(a.id);
});
