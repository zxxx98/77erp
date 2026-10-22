import { selectDataSheets, openSheetResults, closeSheetResults } from './quality-helpers.js';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
const original=await readFile('tests/fixtures/quality-template.xlsx');
const fields=[{id:'items',name:'采购明细',labelRegion:'A16:F16',type:'object',propertyRegion:'A17:F17',valueRegion:'A18:F20',properties:['名称','规格','数量','单价（元）','小计（元）','备注'].map((name,i)=>({id:`p${i}`,name,type:i===2?'number':'string',required:i===2}))},
  {id:'budget',name:'预算',type:'number',labelRegion:'A5',valueRegion:'B5',required:true}];
test.beforeAll(async({request})=>{
  const response=await request.post('/api/auth/setup',{data:{username:'admin',password:'Test-admin-123'}});expect([201,409]).toContain(response.status());
});
test.beforeEach(async({page})=>{
  await page.route('**/api/quality/acceptances/preview',route=>route.abort());
  await page.route('**/api/quality/workbook-preview',route=>route.abort());
  expect((await page.request.post('/api/auth/login',{data:{username:'admin',password:'Test-admin-123'}})).ok()).toBe(true);
  const config=await(await page.request.get('/api/settings/r2-backup')).json();
  expect((await page.request.put('/api/settings/r2-backup',{data:{...config,account_id:'a'.repeat(32),bucket:'erp-backups',access_key:'test-access',secret_key:'test-secret',excel_prefix:'excel',enabled:false}})).ok()).toBe(true);
});
async function template(page,name) {
  const response=await page.request.post('/api/quality/templates',{multipart:{file:{name:'采购申请单示例.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:original},name,definition:JSON.stringify({sheetName:'Sheet1',fields}),request_id:`browser-${name}-${Date.now()}`}});
  expect(response.ok()).toBe(true);const created=await response.json();
  const published=await page.request.post(`/api/quality/templates/${created.id}/publish`,{data:{version:created.version}});expect(published.ok()).toBe(true);return published.json();
}
async function importPage(page,name) {
  await page.goto('/#quality');await page.getByRole('navigation',{name:'品质管理功能'}).getByRole('button',{name:'验收单',exact:true}).click();
  await page.getByRole('button',{name:'导入验收单',exact:true}).click();
  await page.getByRole('combobox',{name:'验收模板',exact:true}).click();await page.getByRole('option',{name:`${name} · v1`,exact:true}).click();
}
test('acceptance import previews typed values, saves an immutable version and downloads the exact filled Excel',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const uploads=[];page.on('request',request=>{if(request.headers()['content-type']?.includes('multipart/form-data'))uploads.push(request.url());});
  await page.addInitScript(()=>Object.defineProperty(Crypto.prototype,'randomUUID',{value:undefined,configurable:true}));
  const name='验收流程模板';await template(page,name);await importPage(page,name);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载此版本 Excel'}).click();expect(await readFile(await(await download).path())).toEqual(original);
  await expect(page.getByRole('button',{name:'确认保存验收单'})).toBeDisabled();
  await page.getByLabel('验收单名称',{exact:true}).fill('第一批服务器到货');await page.getByLabel('验收备注',{exact:true}).fill('检查完成');
  await page.getByLabel('上传验收单 Excel').setInputFiles({name:'第一批验收.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:original});await selectDataSheets(page,['Sheet1']);
  await expect(page.getByRole('status').filter({hasText:'解析通过'})).toBeVisible();
  await expect(page.getByRole('region',{name:'验收解析结果'})).toHaveCount(0);
  await openSheetResults(page,'Sheet1');
  await expect(page.getByRole('region',{name:'验收解析结果'}).getByRole('cell',{name:'机架式服务器',exact:true})).toBeVisible();
  await expect(page.getByText('128000.5',{exact:true})).toBeVisible();
  expect(uploads).toEqual([]);
  await closeSheetResults(page);
  await page.screenshot({path:'output/ui-preview/quality-acceptance-preview.png',fullPage:true});
  const savedResponse=page.waitForResponse(r=>r.url().endsWith('/api/quality/acceptances')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'确认保存验收单'}).click();const saved=await(await savedResponse).json();
  expect(uploads).toEqual(['http://127.0.0.1:3199/api/quality/acceptances']);
  await expect(page.getByRole('heading',{name:'验收单详情',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'第一批服务器到货',exact:true})).toBeVisible();
  await expect(page.getByRole('navigation',{name:'工作表切换'})).toHaveCount(0);
  expect(saved.result.value.Sheet1.采购明细[0].数量).toBe(8);expect(saved.revision).toBe(1);
  const uploaded=page.waitForEvent('download');await page.getByRole('button',{name:'下载上传原文件'}).click();const attachment=await uploaded;expect(attachment.suggestedFilename()).toBe('第一批验收.xlsx');expect(await readFile(await attachment.path())).toEqual(original);
  await page.getByRole('button',{name:'返回验收单列表'}).click();await page.getByLabel('搜索验收单').fill('第一批服务器到货');
  await page.getByRole('row').filter({hasText:'第一批服务器到货'}).getByRole('button',{name:'查看详情'}).click();await expect(page.getByText('检查完成',{exact:true})).toBeVisible();
  await page.screenshot({path:'output/ui-preview/quality-acceptance-detail.png',fullPage:true});
  expect(errors).toEqual([]);
});
test('invalid values locate their source cell, block saving and can be corrected by reuploading',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const name='验收错误定位模板';await template(page,name);await importPage(page,name);
  const zip=unzipSync(original);zip['xl/worksheets/sheet1.xml']=strToU8(strFromU8(zip['xl/worksheets/sheet1.xml']).replace(/(<c r="C18"[\s\S]*?<t>)8(<\/t>)/,'$1十二台$2'));
  const invalid=Buffer.from(zipSync(zip));
  await page.getByLabel('上传验收单 Excel').setInputFiles({name:'数字无效.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:invalid});await selectDataSheets(page,['Sheet1']);
  await openSheetResults(page,'Sheet1');
  const issues=page.getByRole('region',{name:'解析问题'});await expect(issues).toContainText('数字格式无效');await expect(page.getByRole('button',{name:'确认保存验收单'})).toBeDisabled();
  await issues.getByRole('button',{name:'Sheet1!C18 · 定位'}).click();const modal=page.getByRole('dialog',{name:'上传文件单元格定位'});
  await expect(modal.locator('[data-address=C18]')).toHaveClass(/quality-source-error/);await expect(modal.locator('[data-address=C18]')).toHaveText('十二台');
  await page.screenshot({path:'output/ui-preview/quality-acceptance-errors.png',fullPage:true});
  await modal.getByRole('button',{name:'关闭弹窗',exact:true}).click();await closeSheetResults(page);
  await page.getByLabel('上传验收单 Excel').setInputFiles({name:'已修正.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:original});await selectDataSheets(page,['Sheet1']);
  await expect(page.getByRole('status').filter({hasText:'解析通过'})).toBeVisible();await expect(issues).toHaveCount(0);await expect(page.getByRole('button',{name:'确认保存验收单'})).toBeEnabled();
  page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'模板配置',exact:true}).click();await expect(page.getByRole('heading',{name:'导入验收单',exact:true})).toBeVisible();
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'模板配置',exact:true}).click();await expect(page.getByRole('heading',{name:'品质管理',exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});
test('publishing a new template after preview requires reselecting and parsing the new version',async({page})=>{
  const name='验收版本变化模板',row=await template(page,name);await importPage(page,name);
  await page.getByLabel('上传验收单 Excel').setInputFiles('tests/fixtures/quality-template.xlsx');await selectDataSheets(page,['Sheet1']);await expect(page.getByRole('button',{name:'确认保存验收单'})).toBeEnabled();
  const changed=structuredClone(row.definition);changed.fields[0].name='采购明细新版';
  const draft=await(await page.request.put(`/api/quality/templates/${row.id}/draft`,{data:{name,note:'新版本',definition:changed,version:row.version}})).json();
  expect((await page.request.post(`/api/quality/templates/${row.id}/publish`,{data:{version:draft.version}})).ok()).toBe(true);
  await page.getByRole('button',{name:'确认保存验收单'}).click();await expect(page.getByRole('alert')).toContainText('发布版本已变化');await expect(page.getByRole('button',{name:'确认保存验收单'})).toBeDisabled();
  await page.getByRole('combobox',{name:'验收模板',exact:true}).click();await page.getByRole('option',{name:`${name} · v2`,exact:true}).click();
  await page.getByLabel('上传验收单 Excel').setInputFiles('tests/fixtures/quality-template.xlsx');await selectDataSheets(page,['Sheet1']);await expect(page.getByRole('status').filter({hasText:'解析通过'})).toContainText('v2');
  await page.getByRole('button',{name:'确认保存验收单'}).click();await expect(page.getByRole('heading',{name:'验收单详情',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'采购明细新版',exact:true})).toBeVisible();
});

test('twenty sheets stay compact and show only the requested sheet in a result dialog',async({page})=>{
  const {createRequire}=await import('node:module');
  const ExcelJS=createRequire(import.meta.url)('exceljs');
  const excel=new ExcelJS.Workbook();await excel.xlsx.load(original);
  const source=structuredClone(excel.getWorksheet('Sheet1').model);
  for(const sheet of [...excel.worksheets])excel.removeWorksheet(sheet.id);
  for(let i=1;i<=20;i++){
    const sheet=excel.addWorksheet(`批次${i}`);sheet.model={...structuredClone(source),name:sheet.name,mergeCells:source.merges};
    sheet.getCell('B5').value=1000+i;
  }
  const name='二十页紧凑预览';await template(page,name);await importPage(page,name);
  await page.getByLabel('上传验收单 Excel').setInputFiles({name:'二十页.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await excel.xlsx.writeBuffer())});
  const rows=page.locator('.quality-sheet-summary');await expect(rows).toHaveCount(20);
  await expect(page.getByRole('region',{name:'验收解析结果'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'确认保存验收单'})).toBeDisabled();
  await openSheetResults(page,'批次20');
  const modal=page.getByRole('dialog',{name:'工作表解析结果',exact:true});
  await expect(modal.locator('.quality-sheet-results')).toHaveCount(1);
  await expect(modal.getByText('1020',{exact:true}).last()).toBeVisible();await closeSheetResults(page);
  await openSheetResults(page,'批次1');await expect(modal.getByText('1001',{exact:true}).last()).toBeVisible();await closeSheetResults(page);
  await page.setViewportSize({width:800,height:900});
  await rows.first().scrollIntoViewIfNeeded();
  await expect(rows.first().getByRole('button',{name:'手动选择物料',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'output/ui-preview/quality-compact-sheets.png',fullPage:true});
  await selectDataSheets(page,Array.from({length:20},(_,i)=>`批次${i+1}`));
  await page.getByRole('button',{name:'确认保存验收单',exact:true}).click();
  await expect(page.getByRole('heading',{name:'验收单详情',exact:true})).toBeVisible();
  const results=page.getByRole('region',{name:'验收解析结果'}),navigation=page.getByRole('navigation',{name:'工作表切换'});
  await expect(results.locator('.quality-sheet-results')).toHaveCount(1);
  await expect(navigation).toContainText('1 / 20 个工作表');
  await expect(navigation.getByRole('button',{name:'上一张',exact:true})).toBeDisabled();
  const picker=navigation.getByRole('combobox',{name:'当前工作表',exact:true});
  await picker.fill('批次20');await picker.press('ArrowDown');await picker.press('Enter');
  await expect(results.getByText('1020',{exact:true}).last()).toBeVisible();
  await expect(results.locator('.quality-sheet-results')).toHaveCount(1);
  await expect(navigation).toContainText('20 / 20 个工作表');
  await expect(navigation.getByRole('button',{name:'下一张',exact:true})).toBeDisabled();
  await navigation.getByRole('button',{name:'上一张',exact:true}).click();
  await expect(results.getByText('1019',{exact:true}).last()).toBeVisible();
  await page.screenshot({path:'output/ui-preview/quality-detail-sheet-navigation.png',fullPage:true});
});

test('acceptances can be deleted from the list and detail after confirmation',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const name='验收单删除模板',t=await template(page,name),saved=[];
  for(const suffix of ['列表删除','详情删除']){
    const response=await page.request.post('/api/quality/acceptances',{multipart:{file:{name:'验收.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:original},template_id:String(t.id),revision_id:String(t.published_revision),name:`${name}-${suffix}`,request_id:`delete-${suffix}-${Date.now()}`}});
    expect(response.ok()).toBe(true);saved.push(await response.json());
  }
  await page.goto('/#quality');await page.getByRole('navigation',{name:'品质管理功能'}).getByRole('button',{name:'验收单',exact:true}).click();
  await page.getByLabel('搜索验收单').fill(name);
  const row=page.getByRole('row').filter({hasText:`${name}-列表删除`});
  page.once('dialog',dialog=>dialog.dismiss());await row.getByRole('button',{name:'删除',exact:true}).click();
  await expect(row).toBeVisible();expect((await page.request.get(`/api/quality/acceptances/${saved[0].id}`)).ok()).toBe(true);
  page.once('dialog',dialog=>dialog.accept());await row.getByRole('button',{name:'删除',exact:true}).click();
  await expect(row).toHaveCount(0);await expect(page.getByRole('status')).toContainText('验收单已删除');
  await page.getByRole('row').filter({hasText:`${name}-详情删除`}).getByRole('button',{name:'查看详情'}).click();
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'删除验收单',exact:true}).click();
  await expect(page.getByRole('heading',{name:'已保存验收单',exact:true})).toBeVisible();
  await expect(page.getByText('暂无匹配的验收单')).toBeVisible();
  for(const row of saved)expect((await page.request.get(`/api/quality/acceptances/${row.id}`)).status()).toBe(404);
  expect(errors).toEqual([]);
});

test('source panel corrects and restores invalid data, then retains manual markers and the original download',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const name='单元格手动修正模板';await template(page,name);await importPage(page,name);
  const zip=unzipSync(original);zip['xl/worksheets/sheet1.xml']=strToU8(strFromU8(zip['xl/worksheets/sheet1.xml']).replace(/(<c r="C18"[\s\S]*?<t>)8(<\/t>)/,'$1十二台$2'));
  const invalid=Buffer.from(zipSync(zip));
  await page.getByLabel('上传验收单 Excel').setInputFiles({name:'保留原始错误.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:invalid});
  await selectDataSheets(page,['Sheet1']);await openSheetResults(page,'Sheet1');
  await page.getByRole('region',{name:'解析问题'}).getByRole('button',{name:'Sheet1!C18 · 定位'}).click();
  const modal=page.getByRole('dialog',{name:'上传文件单元格定位',exact:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await expect(modal.getByLabel('修正内容')).toHaveValue('十二台');
  await modal.getByLabel('修正内容').fill('还是错误');await modal.getByRole('button',{name:'应用手动修正'}).click();
  await expect(modal.locator('.form-error')).toContainText(['数字格式无效']);
  await modal.getByLabel('修正内容').fill('12');await modal.getByRole('button',{name:'应用手动修正'}).click();
  await expect(modal.getByRole('button',{name:'恢复原始内容'})).toBeVisible();
  await expect(modal.locator('[data-address=C18]')).toContainText('手动修正');
  await modal.getByRole('button',{name:'恢复原始内容'}).click();
  await expect(modal.getByLabel('修正内容')).toHaveValue('十二台');await expect(modal.getByRole('button',{name:'恢复原始内容'})).toHaveCount(0);
  await modal.getByLabel('修正内容').fill('12');await modal.getByRole('button',{name:'应用手动修正'}).click();
  await expect(modal.getByRole('button',{name:'恢复原始内容'})).toBeVisible();
  await page.screenshot({path:'output/ui-preview/quality-manual-correction-narrow.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await modal.getByRole('button',{name:'关闭弹窗',exact:true}).click();
  const history=page.getByRole('region',{name:'手动修正记录',exact:true});
  await expect(history).toContainText('十二台');await expect(history).toContainText('12');
  await expect(page.locator('.quality-preview-table td').filter({hasText:/^12手动修正$/})).toBeVisible();
  await closeSheetResults(page);await expect(page.getByRole('button',{name:'确认保存验收单'})).toBeEnabled();
  const savedResponse=page.waitForResponse(r=>r.url().endsWith('/api/quality/acceptances')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'确认保存验收单'}).click();const response=await savedResponse;expect(response.ok()).toBe(true);const saved=await response.json();
  expect(saved.result.value.Sheet1.采购明细[0].数量).toBe(12);
  expect(saved.result.sheets[0].manualCorrections).toEqual([{address:'C18',original:'十二台',text:'12'}]);
  await expect(page.getByRole('heading',{name:'验收单详情',exact:true})).toBeVisible();await expect(history).toContainText('十二台');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载上传原文件'}).click();expect(await readFile(await(await download).path())).toEqual(invalid);
  await page.reload();await page.getByRole('navigation',{name:'品质管理功能'}).getByRole('button',{name:'验收单',exact:true}).click();
  await page.getByLabel('搜索验收单').fill(name);await page.getByRole('row').filter({hasText:name}).getByRole('button',{name:'查看详情'}).click();
  await expect(history).toContainText('十二台');expect(errors).toEqual([]);
});
