import { test, expect, devices } from '@playwright/test';
import { createRequire } from 'node:module';
const ExcelJS=createRequire(import.meta.url)('exceljs');

test.beforeAll(async({request})=>{
  const response=await request.post('/api/auth/setup',{data:{username:'admin',password:'Test-admin-123'}});expect([201,409]).toContain(response.status());
});
async function login(request) {
  expect((await request.post('/api/auth/login',{data:{username:'admin',password:'Test-admin-123'}})).ok()).toBe(true);
  const config=await(await request.get('/api/settings/r2-backup')).json();
  expect((await request.put('/api/settings/r2-backup',{data:{...config,account_id:'a'.repeat(32),bucket:'erp-backups',access_key:'test-access',secret_key:'test-secret',excel_prefix:'excel',enabled:false}})).ok()).toBe(true);
}
async function start(page,name,{mobile=false}={}) {
  await login(page.request);await page.goto('/#quality');
  if(mobile)await page.getByRole('navigation',{name:'品质管理功能'}).getByRole('button',{name:'模板配置',exact:true}).click();
  await page.getByRole('button',{name:'在线新建模板',exact:true}).click();
  await expect(page.getByRole('table',{name:'在线模板表格'})).toBeVisible();
  await page.getByRole('textbox',{name:'模板名称',exact:true}).fill(name);
}
async function select(page,region) {
  await page.getByRole('textbox',{name:'选择区域',exact:true}).fill(region);
  await page.getByRole('button',{name:'选中区域',exact:true}).click();
}
async function apply(page) {
  await page.getByRole('button',{name:'继续配置字段',exact:true}).click();
  await expect(page.getByRole('button',{name:'编辑表格内容与格式',exact:true})).toBeVisible();
}
async function save(page) {
  const response=page.waitForResponse(r=>/\/api\/quality\/templates(?:\/\d+\/file)?$/.test(r.url())&&r.request().method()==='POST');
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  const result=await response;expect(result.ok()).toBe(true);await expect(page.getByRole('status').filter({hasText:'草稿已保存'})).toBeVisible();return result.json();
}
async function workbook(request,path) {
  const response=await request.get(path);expect(response.ok()).toBe(true);const book=new ExcelJS.Workbook();await book.xlsx.load(await response.body());return book;
}

test('blank template supports formatting, safe merging, undo, field setup and editing a published template',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const name='网页空白新建模板';await start(page,name);
  await page.getByRole('textbox',{name:'单元格内容',exact:true}).fill('验收记录');
  await select(page,'B1');await page.getByRole('textbox',{name:'单元格内容',exact:true}).fill('其他内容');
  await select(page,'A1:D1');await page.getByRole('button',{name:'合并单元格',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('其他内容');
  await select(page,'B1');await page.getByRole('button',{name:'清空内容',exact:true}).click();
  await select(page,'A1:D1');await page.getByRole('button',{name:'合并单元格',exact:true}).click();
  await expect(page.locator('[data-address=A1]')).toHaveAttribute('colspan','4');
  await page.getByRole('spinbutton',{name:'字号',exact:true}).fill('24');await page.getByRole('spinbutton',{name:'字号',exact:true}).press('Enter');
  await page.getByRole('combobox',{name:'水平对齐',exact:true}).selectOption('center');
  await page.getByRole('button',{name:'加粗',exact:true}).click();await page.getByRole('button',{name:'全部边框',exact:true}).click();
  await select(page,'A3');await page.getByRole('textbox',{name:'单元格内容',exact:true}).fill('误输入');
  await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.locator('[data-address=A3]')).toHaveText('');
  await page.getByRole('button',{name:'重做',exact:true}).click();await expect(page.locator('[data-address=A3]')).toHaveText('误输入');
  await page.getByRole('button',{name:'撤销',exact:true}).click();
  page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'返回',exact:true}).click();
  await expect(page.getByRole('table',{name:'在线模板表格'})).toBeVisible();
  await apply(page);await page.getByRole('button',{name:'添加自定义 Key',exact:true}).click();
  const editor=page.getByRole('complementary',{name:'字段独立编辑'});
  await editor.getByRole('textbox',{name:'字段名称',exact:true}).fill('验收结果');await editor.getByRole('textbox',{name:'取值区域',exact:true}).fill('B3');
  await editor.getByRole('button',{name:'完成配置',exact:true}).click();
  const row=await save(page);await page.getByRole('button',{name:'启用模板',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'模板已启用'})).toBeVisible();
  const original=await(await page.request.get(`/api/quality/templates/${row.id}/download`)).body();
  const book=await workbook(page.request,`/api/quality/templates/${row.id}/draft/download`),sheet=book.worksheets[0];
  expect(sheet.getCell('A1').value).toBe('验收记录');expect(sheet.getCell('A1').font.size).toBe(24);expect(sheet.getCell('A1').font.bold).toBe(true);
  expect(sheet.getCell('A1').alignment.horizontal).toBe('center');expect(sheet.getCell('A1').border.top.style).toBe('thin');
  await page.reload();await page.getByRole('row').filter({hasText:name}).getByRole('button',{name:'编辑',exact:true}).click();
  await page.getByRole('button',{name:'编辑表格内容与格式',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'单元格内容',exact:true})).toHaveValue('验收记录');
  await expect(page.getByRole('spinbutton',{name:'字号',exact:true})).toHaveValue('24');
  await page.getByRole('textbox',{name:'单元格内容',exact:true}).fill('在线改版标题');await apply(page);
  await expect(page.locator('.quality-field')).toHaveCount(1);const saved=await save(page);expect(saved.definition.fields[0].name).toBe('验收结果');
  expect(await(await page.request.get(`/api/quality/templates/${row.id}/download`)).body()).toEqual(original);
  const updated=await workbook(page.request,`/api/quality/templates/${row.id}/draft/download`);expect(updated.worksheets[0].getCell('A1').value).toBe('在线改版标题');
  expect(errors).toEqual([]);
});

test('starter template can be created, published, filled and submitted entirely online',async({page})=>{
  const name='完整在线模板流程';await start(page,name);await page.getByRole('button',{name:'使用检验单示例',exact:true}).click();
  await expect(page.locator('[data-address=A1]')).toHaveText('产品质量检验记录单');
  await page.screenshot({path:'output/ui-preview/quality-template-designer-desktop.png',fullPage:true});
  await apply(page);await expect(page.locator('.quality-field')).toHaveCount(7);await save(page);
  await page.getByRole('button',{name:'启用模板',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'模板已启用'})).toBeVisible();
  await page.getByRole('button',{name:'返回模板列表',exact:true}).click();
  await page.getByRole('navigation',{name:'品质管理功能'}).getByRole('button',{name:'验收单',exact:true}).click();
  await page.getByRole('button',{name:'在线新建验收单',exact:true}).click();
  await page.getByRole('combobox',{name:'验收模板',exact:true}).click();await page.getByRole('option',{name:`${name} · v1`,exact:true}).click();
  await page.getByRole('button',{name:'开始填写',exact:true}).click();
  for(const [label,value] of Object.entries({'检验单号 · B3':'QC-001','检验日期 · F3':'2026-10-21','产品名称 · B4':'连接件','批次数量 · F4':'100','检验明细 · 第 1 条 · 检验项目 · A8':'外观','综合判定 · B13':'合格','检验员 · F13':'李明'}))
    await page.getByRole('textbox',{name:label,exact:true}).fill(value);
  await page.getByRole('button',{name:'校验并预览',exact:true}).click();
  await page.getByRole('checkbox',{name:'绑定物料 检验模板',exact:true}).uncheck();
  const response=page.waitForResponse(r=>r.url().endsWith('/api/quality/acceptances')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'确认保存验收单',exact:true}).click();
  const result=await response;expect(result.ok()).toBe(true);const saved=await result.json();
  expect(saved.result.value.检验模板.检验单号).toBe('QC-001');expect(saved.result.value.检验模板.批次数量).toBe(100);
  await expect(page.getByRole('heading',{name:'验收单详情',exact:true})).toBeVisible();
});

for(const platform of ['Android PWA','iPhone'])test(`${platform} creates and saves a template using touch and range controls`,async({browser})=>{
  const context=await browser.newContext({...devices[platform==='iPhone'?'iPhone 13':'Pixel 7'],baseURL:'http://127.0.0.1:3199',serviceWorkers:platform==='Android PWA'?'allow':'block'});
  try{
    if(platform==='Android PWA')await context.addInitScript(()=>{const original=window.matchMedia.bind(window);window.matchMedia=query=>{const result=original(query);if(query==='(display-mode: standalone)')Object.defineProperty(result,'matches',{value:true});return result;};});
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    const name=`${platform}创建模板`;await start(page,name,{mobile:true});
    await page.locator('[data-address=A1]').tap();await page.getByRole('textbox',{name:'单元格内容',exact:true}).fill('手机检验模板');
    await select(page,'A1:D1');await page.getByRole('button',{name:'合并单元格',exact:true}).tap();
    await page.getByRole('combobox',{name:'水平对齐',exact:true}).selectOption('center');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.screenshot({path:`output/ui-preview/quality-template-designer-${platform==='iPhone'?'ios':'android'}.png`,fullPage:true});
    await apply(page);const row=await save(page);expect(row.name).toBe(name);
    const book=await workbook(page.request,`/api/quality/templates/${row.id}/draft/download`);
    expect(book.worksheets[0].getCell('A1').value).toBe('手机检验模板');expect(book.worksheets[0].getCell('D1').master.address).toBe('A1');expect(errors).toEqual([]);
  }finally{await context.close();}
});
