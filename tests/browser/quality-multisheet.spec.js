import { selectedControl } from './dropdown-helpers.js';
import { test, expect, devices } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { selectDataSheets, openSheetResults, closeSheetResults } from './quality-helpers.js';
const fixture='tests/fixtures/quality-template-multisheet.xlsx';
test.beforeAll(async({request})=>{const r=await request.post('/api/auth/setup',{data:{username:'admin',password:'Test-admin-123'}});expect([201,409]).toContain(r.status());});
test.beforeEach(async({page})=>{
  expect((await page.request.post('/api/auth/login',{data:{username:'admin',password:'Test-admin-123'}})).ok()).toBe(true);
  const c=await(await page.request.get('/api/settings/r2-backup')).json();
  expect((await page.request.put('/api/settings/r2-backup',{data:{...c,account_id:'a'.repeat(32),bucket:'erp-backups',access_key:'test-access',secret_key:'test-secret',excel_prefix:'excel',enabled:false}})).ok()).toBe(true);
});
async function range(page,start,end) {
  const a=page.locator(`[data-address="${start}"]`),b=page.locator(`[data-address="${end}"]`);
  await a.scrollIntoViewIfNeeded();await b.scrollIntoViewIfNeeded();const ra=await a.boundingBox(),rb=await b.boundingBox();
  await page.mouse.move(ra.x+ra.width/2,ra.y+ra.height/2);await page.mouse.down();await page.mouse.move(rb.x+rb.width/2,rb.y+rb.height/2,{steps:8});await page.mouse.up();
}
test('a single-sheet template parses multiple data sheets with different names into one acceptance',async({page,browser})=>{
  test.setTimeout(60000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));let workers=0;page.on('worker',()=>workers++);
  await page.goto('/#quality');await page.getByLabel('上传模板 Excel').setInputFiles('tests/fixtures/quality-template.xlsx');await page.getByLabel('模板名称',{exact:true}).fill('单表规则多表验收');
  await page.locator('[data-address=A11]').click({button:'right'});await page.getByRole('menuitem',{name:/添加为 Key（右）/}).click();await page.getByRole('checkbox',{name:'必填',exact:true}).check();await page.getByRole('button',{name:'完成配置',exact:true}).click();
  await page.locator('[data-address=A16]').click({button:'right'});await page.getByRole('menuitem',{name:'添加为对象 Key',exact:true}).click();
  await range(page,'A17','F17');await page.getByRole('dialog').getByRole('button',{name:'确认并选择值区域'}).click();await range(page,'A18','F20');await page.getByRole('dialog').getByRole('button',{name:'完成对象配置'}).click();
  await page.getByRole('button',{name:'启用模板',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'模板已启用'})).toBeVisible();
  const list=await(await page.request.get('/api/quality/templates?q=单表规则多表验收')).json();const id=list.templates[0].id;
  const template=await(await page.request.get(`/api/quality/templates/${id}`)).json();expect(template.definition.schemaVersion).toBe(1);expect(template.definition.sheetName).toBe('Sheet1');expect(template.definition.fields).toHaveLength(2);expect(template.definition.sheets).toBeUndefined();
  await page.getByRole('button',{name:'返回模板列表'}).click();await page.getByRole('button',{name:'验收单',exact:true}).click();await page.getByRole('button',{name:'导入验收单',exact:true}).click();
  await page.getByRole('combobox',{name:'验收模板',exact:true}).click();await page.getByRole('option',{name:'单表规则多表验收 · v1',exact:true}).click();
  const bytes=await readFile(fixture),zip=unzipSync(bytes);zip['xl/worksheets/sheet3.xml']=strToU8(strFromU8(zip['xl/worksheets/sheet3.xml']).replace(/<c r="B11"[^>]*>[\s\S]*?<\/c>/,'<c r="B11"/>'));
  await page.getByLabel('上传验收单 Excel').setInputFiles({name:'第二批漏填.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(zipSync(zip))});
  await selectDataSheets(page,['一批到货','二批到货']);
  await openSheetResults(page,'二批到货');
  const issues=page.getByRole('region',{name:'解析问题'});await expect(issues).toContainText('必填值为空');await expect(page.getByRole('button',{name:'确认保存验收单'})).toBeDisabled();
  await issues.getByRole('button',{name:'二批到货!B11 · 定位'}).click();const modal=page.getByRole('dialog',{name:'上传文件单元格定位'});
  await expect(selectedControl(modal.getByRole('combobox'))).toContainText('二批到货');await expect(modal.locator('[data-address=B11]')).toHaveClass(/quality-source-error/);await modal.getByRole('button',{name:'关闭弹窗'}).click();await closeSheetResults(page);
  await page.getByLabel('上传验收单 Excel').setInputFiles(fixture);await selectDataSheets(page,['一批到货','二批到货']);await expect(page.getByRole('status').filter({hasText:'解析通过'})).toBeVisible();
  const results=page.getByRole('region',{name:'验收解析结果'});await expect(results).toHaveCount(0);
  for(const [name,value] of [['一批到货','第一批供应商'],['二批到货','第二批供应商']]){
    await openSheetResults(page,name);await expect(results).toContainText(value);
    await expect(results.locator('.quality-sheet-results')).toHaveCount(1);await closeSheetResults(page);
  }
  const parsedWorkers=workers,firstSheet=page.getByRole('checkbox',{name:'解析工作表 一批到货',exact:true});
  await firstSheet.uncheck();
  await expect(page.getByRole('region',{name:'物料绑定 一批到货',exact:true})).toHaveCount(0);
  await expect(page.getByRole('region',{name:'物料绑定 二批到货',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'确认保存验收单'})).toBeEnabled();
  await firstSheet.check();
  await expect(page.getByRole('region',{name:'物料绑定 一批到货',exact:true})).toBeVisible();
  await expect(page.getByRole('checkbox',{name:'绑定物料 一批到货',exact:true})).not.toBeChecked();
  await expect(page.getByRole('status').filter({hasText:'解析通过'})).toBeVisible();
  expect(workers).toBe(parsedWorkers);
  await page.screenshot({path:'output/ui-preview/quality-repeated-sheets-preview.png',fullPage:true});
  const response=page.waitForResponse(r=>r.url().endsWith('/api/quality/acceptances')&&r.request().method()==='POST');await page.getByRole('button',{name:'确认保存验收单'}).click();const acceptance=await(await response).json();
  expect(acceptance.result.value.一批到货.公司名称).toBe('第一批供应商');expect(acceptance.result.value.二批到货.公司名称).toBe('第二批供应商');expect(acceptance.result.value.二批到货.采购明细[0].数量).toBe('12');expect(acceptance.definition.sheets).toBeUndefined();
  await expect(page.getByRole('heading',{name:'验收单详情',exact:true})).toBeVisible();const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载上传原文件'}).click();expect(await readFile(await(await download).path())).toEqual(bytes);
  const after=await(await page.request.get(`/api/quality/templates/${id}`)).json();expect(after.definition).toEqual(template.definition);
  for(const device of ['Pixel 7','iPhone 13']){
    const context=await browser.newContext({...devices[device],baseURL:'http://127.0.0.1:3199',serviceWorkers:'block',storageState:await page.context().storageState()});
    try{
      const mobile=await context.newPage();mobile.on('pageerror',e=>errors.push(e.message));
      await mobile.goto('/#quality');await expect(mobile.locator('.mw-tabs')).toBeVisible();
      await mobile.getByRole('navigation',{name:'品质管理功能'}).getByRole('button',{name:'验收单',exact:true}).click();
      await mobile.getByRole('row').filter({hasText:acceptance.number}).getByRole('button',{name:'查看详情',exact:true}).click();
      const results=mobile.getByRole('region',{name:'验收解析结果'}),navigation=mobile.getByRole('navigation',{name:'工作表切换'});
      await expect(results.locator('.quality-sheet-results')).toHaveCount(1);
      await expect(results).toContainText('第一批供应商');
      await navigation.getByRole('button',{name:'下一张',exact:true}).click();
      await expect(results).toContainText('第二批供应商');
      await expect(results).not.toContainText('第一批供应商');
      await expect(navigation.getByRole('button',{name:'下一张',exact:true})).toBeDisabled();
      await navigation.getByRole('combobox',{name:'当前工作表',exact:true}).fill('一批');
      await mobile.getByRole('option',{name:'一批到货',exact:true}).click();
      await expect(results).toContainText('第一批供应商');
      expect(await mobile.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
      await mobile.screenshot({path:`output/ui-preview/quality-detail-${device.replaceAll(' ','-')}.png`,fullPage:true});
    }finally{await context.close();}
  }
  expect(errors).toEqual([]);
});
