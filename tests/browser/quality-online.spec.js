import { test, expect, devices } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const ExcelJS=createRequire(import.meta.url)('exceljs');

const fields=[
  {id:'code',name:'检验单号',type:'uniqueKey',labelRegion:'A3',valueRegion:'B3:C3',required:true},
  {id:'date',name:'检验日期',type:'date',dateFormat:'YYYY-MM-DD',labelRegion:'D3',valueRegion:'E3:F3',required:true},
  {id:'product',name:'产品名称',type:'string',labelRegion:'A4',valueRegion:'B4:C4',required:true},
  {id:'quantity',name:'批次数量',type:'number',labelRegion:'D4',valueRegion:'E4:F4',required:true},
  {id:'items',name:'检验明细',type:'object',labelRegion:'A6:F6',propertyRegion:'A7:F7',valueRegion:'A8:F10',required:true,
    properties:['检验项目','规格要求','实测值','判定','检验员','备注'].map((name,i)=>({id:`p${i}`,name,type:i===2?'number':i===3?'single':'string',required:[0,2,3].includes(i),
      ...(i===3?{checkChar:'☑',uncheckChars:'□',options:'合格\n不合格',choiceMode:'markers'}:{})}))},
  {id:'result',name:'综合判定',type:'single',labelRegion:'A12',valueRegion:'B12:C12',required:true,checkChar:'✓',options:'合格\n不合格',choiceMode:'markers',markerPosition:'after'},
  {id:'tags',name:'检验方式',type:'multi',labelRegion:'A16',valueRegion:'B16:C16',checkChar:'★',uncheckChars:'☆',options:'外观\n尺寸',choiceMode:'markers'},
  {id:'inspector',name:'检验员',type:'string',labelRegion:'D12',valueRegion:'E12:F12',required:true},
];
async function sample() {
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('检验记录');
  sheet.columns=Array.from({length:6},()=>({width:20}));
  for(const region of ['A1:F1','B3:C3','E3:F3','B4:C4','E4:F4','A6:F6','B12:C12','E12:F12','A14:F14','B16:C16'])sheet.mergeCells(region);
  for(const [address,value] of Object.entries({A16:'检验方式',A1:'产品质量检验记录单',A3:'检验单号',B3:'示例编号',D3:'检验日期',E3:'2026-10-21',A4:'产品名称',B4:'示例产品',D4:'批次数量',E4:100,
    A6:'检验明细',A8:'外径',B8:'12 ± 0.2 mm',C8:12,D8:'☑合格',E8:'张三',A12:'综合判定',B12:'合格✓',D12:'检验员',E12:'张三',A14:'请依据本批次实测结果填写，核对后提交。'}))sheet.getCell(address).value=value;
  fields.find(f=>f.id==='items').properties.forEach((p,i)=>sheet.getCell(7,i+1).value=p.name);
  sheet.eachRow(row=>{row.height=32;row.eachCell({includeEmpty:true},cell=>{
    cell.font={name:'微软雅黑',size:11,color:{argb:'FF24354B'}};cell.alignment={vertical:'middle',wrapText:true};
    cell.border=Object.fromEntries(['top','right','bottom','left'].map(edge=>[edge,{style:'thin',color:{argb:'FFD5DDE7'}}]));
  });});
  sheet.getRow(1).height=56;sheet.getCell('A1').font={name:'微软雅黑',size:22,bold:true};sheet.getCell('A1').alignment={horizontal:'center',vertical:'middle'};
  for(const address of ['A6','A7','B7','C7','D7','E7','F7']){sheet.getCell(address).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFEAF0F8'}};sheet.getCell(address).font={size:11,bold:true};}
  return Buffer.from(await book.xlsx.writeBuffer());
}
const original=await sample();
test.beforeAll(async({request})=>{
  const response=await request.post('/api/auth/setup',{data:{username:'admin',password:'Test-admin-123'}});expect([201,409]).toContain(response.status());
});
async function prepare(request,name) {
  expect((await request.post('/api/auth/login',{data:{username:'admin',password:'Test-admin-123'}})).ok()).toBe(true);
  const config=await(await request.get('/api/settings/r2-backup')).json();
  expect((await request.put('/api/settings/r2-backup',{data:{...config,account_id:'a'.repeat(32),bucket:'erp-backups',access_key:'test-access',secret_key:'test-secret',excel_prefix:'excel',enabled:false}})).ok()).toBe(true);
  const response=await request.post('/api/quality/templates',{multipart:{file:{name:'产品质量检验.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:original},name,
    definition:JSON.stringify({sheetName:'检验记录',fields}),request_id:`online-${name}-${Date.now()}`}});
  expect(response.ok()).toBe(true);const row=await response.json();
  const published=await request.post(`/api/quality/templates/${row.id}/publish`,{data:{version:row.version}});expect(published.ok()).toBe(true);return published.json();
}
async function start(page,name,{mobile=false,prefill=false}={}) {
  await page.goto('/#quality');
  if(!mobile)await page.getByRole('navigation',{name:'品质管理功能'}).getByRole('button',{name:'验收单',exact:true}).click();
  await page.getByRole('button',{name:'在线新建验收单',exact:true}).click();
  await page.getByRole('combobox',{name:'验收模板',exact:true}).click();await page.getByRole('option',{name:`${name} · v1`,exact:true}).click();
  if(prefill)await page.getByRole('checkbox',{name:'带入模板预填内容（请逐项核对）',exact:true}).check();
  await page.getByRole('button',{name:'开始填写',exact:true}).click();
  await expect(page.getByRole('region',{name:'在线填写验收单',exact:true})).toBeVisible();
}
async function edit(page,label,value) {
  const textbox=page.getByRole('textbox',{name:label,exact:true});
  if(!await textbox.count())await page.getByRole('button',{name:label,exact:true}).dblclick();
  await textbox.fill(value);
}
async function fill(page) {
  for(const [label,value] of Object.entries({'检验单号 · B3':'0000128','检验日期 · E3':'2026-10-21','产品名称 · B4':'精密连接件','批次数量 · E4':'100',
    '检验明细 · 第 1 条 · 检验项目 · A8':'外径','检验明细 · 第 1 条 · 规格要求 · B8':'12 ± 0.2 mm','检验明细 · 第 1 条 · 实测值 · C8':'12.08','检验明细 · 第 1 条 · 检验员 · E8':'李明','检验员 · E12':'李明'}))
    await edit(page,label,value);
  await page.getByRole('radio',{name:'检验明细 · 第 1 条 · 判定 · D8 · 合格',exact:true}).check();
  await page.getByRole('radio',{name:'综合判定 · B12 · 不合格',exact:true}).check();
  await page.getByRole('radio',{name:'综合判定 · B12 · 合格',exact:true}).check();
  await expect(page.getByRole('radio',{name:'综合判定 · B12 · 不合格',exact:true})).not.toBeChecked();
  const visual=page.getByRole('checkbox',{name:'检验方式 · B16 · 外观',exact:true}),dimension=page.getByRole('checkbox',{name:'检验方式 · B16 · 尺寸',exact:true});
  await visual.check();await dimension.check();await visual.uncheck();await expect(dimension).toBeChecked();
  await expect(dimension).toHaveText('★尺寸');
}
async function validate(page) {
  await page.getByRole('button',{name:'校验并预览',exact:true}).click();
  await expect(page.getByRole('region',{name:'物料绑定 检验记录',exact:true})).toBeVisible();
  await page.getByRole('checkbox',{name:'绑定物料 检验记录',exact:true}).uncheck();
}
async function save(page) {
  const response=page.waitForResponse(r=>r.url().endsWith('/api/quality/acceptances')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'确认保存验收单',exact:true}).click();
  const result=await response;expect(result.ok()).toBe(true);
  const saved=await result.json();
  await expect(page.getByRole('heading',{name:'验收单详情',exact:true})).toBeVisible();
  expect(saved.result.value.检验记录.检验单号).toBe('0000128');expect(saved.result.value.检验记录.检验明细[0].实测值).toBe(12.08);
  return saved;
}

test('desktop online entry validates, invalidates preview after edits, saves and exports filled Excel without changing the template',async({page})=>{
  const name='在线检验演示模板',row=await prepare(page.request,name),errors=[],uploads=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>{if(r.headers()['content-type']?.includes('multipart/form-data'))uploads.push(r.url());});
  await start(page,name);
  await expect(page.locator('.quality-online-scroll textarea')).toHaveCount(0);
  await expect(page.locator('.quality-online-scroll [data-address=B3]')).toHaveCSS('background-color','rgb(255, 248, 230)');
  const code=page.getByRole('button',{name:'检验单号 · B3',exact:true});
  await code.click();await expect(page.getByRole('textbox',{name:'检验单号 · B3',exact:true})).toHaveCount(0);
  await code.dblclick();await expect(page.getByRole('textbox',{name:'检验单号 · B3',exact:true})).toBeFocused();
  await page.getByRole('textbox',{name:'检验单号 · B3',exact:true}).fill('取消的编号');
  await page.getByRole('textbox',{name:'检验单号 · B3',exact:true}).press('Escape');await expect(code).toHaveText('');
  await code.press('Enter');await page.getByRole('textbox',{name:'检验单号 · B3',exact:true}).press('Enter');
  await expect(code).toBeVisible();
  await expect(page.locator('.quality-online-scroll [data-address=A1]')).toHaveCSS('text-align','center');
  await fill(page);
  await expect(page.locator('.quality-online-scroll [data-address=B3]')).toHaveCSS('background-color','rgb(241, 248, 242)');
  await edit(page,'批次数量 · E4','一百');
  await validate(page);await expect(page.getByRole('button',{name:'批次数量 · E4',exact:true})).toHaveAttribute('aria-invalid','true');
  await expect(page.getByRole('button',{name:'确认保存验收单'})).toBeDisabled();
  await edit(page,'批次数量 · E4','100');
  await expect(page.getByRole('button',{name:'确认保存验收单'})).toBeDisabled();
  await validate(page);await expect(page.getByRole('button',{name:'确认保存验收单'})).toBeEnabled();
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'output/ui-preview/quality-online-desktop.png',fullPage:true});
  expect(uploads).toEqual([]);
  const saved=await save(page);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载上传原文件'}).click();
  const book=new ExcelJS.Workbook();await book.xlsx.load(await readFile(await(await download).path()));
  const sheet=book.getWorksheet('检验记录');expect(sheet.getCell('B3').value).toBe('0000128');expect(sheet.getCell('C8').value).toBe(12.08);
  expect(sheet.getCell('B16').value).toBe('★尺寸');
  expect(sheet.getCell('A1').font.size).toBe(22);expect(sheet.getCell('A1').alignment.horizontal).toBe('center');
  expect(await(await page.request.get(`/api/quality/templates/${row.id}/download`)).body()).toEqual(original);
  expect((await(await page.request.get(`/api/quality/acceptances/${saved.id}`)).json()).result).toEqual(saved.result);
  expect(uploads).toHaveLength(1);expect(errors).toEqual([]);
});

test('prefilled online entry protects unsaved work and detects newly published versions',async({page})=>{
  const name='在线版本校验模板',row=await prepare(page.request,name);
  await start(page,name,{prefill:true});await expect(page.getByRole('button',{name:'检验单号 · B3',exact:true})).toHaveText('示例编号');
  page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'返回验收单列表'}).click();
  await expect(page.getByRole('region',{name:'在线填写验收单',exact:true})).toBeVisible();
  const changed=structuredClone(row.definition);changed.fields.find(field=>field.id==='quantity').name='批次总数量';
  const draft=await(await page.request.put(`/api/quality/templates/${row.id}/draft`,{data:{name,version:row.version,note:'新版本',definition:changed}})).json();
  expect((await page.request.post(`/api/quality/templates/${row.id}/publish`,{data:{version:draft.version}})).ok()).toBe(true);
  await page.getByRole('button',{name:'校验并预览'}).click();
  await expect(page.getByRole('alert')).toContainText('发布版本已变化');await expect(page.getByRole('button',{name:'确认保存验收单'})).toBeDisabled();
  page.once('dialog',dialog=>dialog.dismiss());
  await page.getByRole('combobox',{name:'验收模板',exact:true}).click();await page.getByRole('option',{name:`${name} · v2`,exact:true}).click();
  await expect(page.getByRole('button',{name:'检验单号 · B3',exact:true})).toHaveText('示例编号');
});

for(const platform of ['Android PWA','iPhone'])test(`${platform} opens from workspace and fills, validates and submits online`,async({browser})=>{
  const context=await browser.newContext({...devices[platform==='iPhone'?'iPhone 13':'Pixel 7'],baseURL:'http://127.0.0.1:3199',serviceWorkers:platform==='Android PWA'?'allow':'block'});
  try{
    if(platform==='Android PWA')await context.addInitScript(()=>{const original=window.matchMedia.bind(window);window.matchMedia=query=>{const result=original(query);if(query==='(display-mode: standalone)')Object.defineProperty(result,'matches',{value:true});return result;};});
    const name=`${platform}在线模板`;await prepare(context.request,name);
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('/');await page.getByRole('navigation',{name:'移动端主导航'}).getByRole('button',{name:'更多',exact:true}).click();
    await page.getByRole('button',{name:'品质管理 · 在线验收',exact:true}).click();
    await expect(page.getByRole('heading',{name:'验收单',exact:true})).toBeVisible();
    await start(page,name,{mobile:true});await expect(page.getByRole('button',{name:'字段填写',exact:true})).toHaveAttribute('aria-pressed','true');
    await page.getByRole('button',{name:'表格填写',exact:true}).click();
    await page.getByRole('button',{name:'检验单号 · B3',exact:true}).tap();
    await expect(page.getByRole('textbox',{name:'检验单号 · B3',exact:true})).toBeFocused();
    await page.getByRole('textbox',{name:'检验单号 · B3',exact:true}).fill('手机填写');
    await page.getByRole('button',{name:'字段填写',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'检验单号 · B3',exact:true})).toHaveValue('手机填写');
    await fill(page);await validate(page);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.getByRole('textbox',{name:'检验单号 · B3',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:`output/ui-preview/quality-online-${platform==='iPhone'?'ios':'android'}.png`});
    await save(page);expect(errors).toEqual([]);
  }finally{await context.close();}
});
