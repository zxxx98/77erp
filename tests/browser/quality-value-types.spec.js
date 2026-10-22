import { test, expect, devices } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const ExcelJS = createRequire(import.meta.url)('exceljs');

test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/auth/setup', { data: { username:'admin', password:'Test-admin-123' } });
  expect([201,409]).toContain(response.status());
});

for (const platform of ['desktop','iPhone','Android PWA']) test(`${platform} configures and exports percentages, dates, timestamps and false`, async ({ browser }) => {
  const context = await browser.newContext({ ...(platform==='desktop'?{}:devices[platform==='iPhone'?'iPhone 13':'Pixel 7']), baseURL:'http://127.0.0.1:3199', serviceWorkers:platform==='Android PWA'?'allow':'block' });
  try {
    if (platform==='Android PWA') await context.addInitScript(() => {
      const original=window.matchMedia.bind(window);
      window.matchMedia=query=>{const result=original(query);if(query==='(display-mode: standalone)')Object.defineProperty(result,'matches',{value:true});return result;};
    });
    expect((await context.request.post('/api/auth/login',{data:{username:'admin',password:'Test-admin-123'}})).ok()).toBe(true);
    const settings=await(await context.request.get('/api/settings/r2-backup')).json();
    expect((await context.request.put('/api/settings/r2-backup',{data:{...settings,account_id:'a'.repeat(32),bucket:'erp-backups',access_key:'test-access',secret_key:'test-secret',excel_prefix:'excel',enabled:false}})).ok()).toBe(true);
    const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('类型');
    sheet.addRows([['合格率',0.954321],['日期','29/02/2024'],['采集时间','2024.2.29 12:30'],['开关',false]]);
    sheet.getCell('B1').numFmt='0.00%';
    const fields=['合格率','日期','采集时间','开关'].map((name,i)=>({id:`f${i}`,name,labelRegion:`A${i+1}`,valueRegion:`B${i+1}`,type:'string',required:true}));
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto('/#quality');
    if(platform!=='desktop')await page.getByRole('navigation',{name:'品质管理功能'}).getByRole('button',{name:'模板配置',exact:true}).click();
    await page.getByLabel('上传模板 Excel').setInputFiles({name:'扩展类型.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await book.xlsx.writeBuffer())});
    const name=`扩展类型-${platform}`;
    await page.getByLabel('模板名称',{exact:true}).fill(name);
    await page.getByLabel('导入模板字段配置').setInputFiles({name:'配置.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({sheetName:'类型',fields}))});
    const editor=page.getByRole('complementary',{name:'字段独立编辑'});
    for(const [field,type,format,result] of [['合格率','数字',null,'95.4321'],['日期','日期','DD/MM/YYYY','"2024-02-29"'],['采集时间','日期时间','YYYY.M.D HH:mm','"2024-02-29T12:30:00"'],['开关','布尔',null,'false']]) {
      await page.locator('.quality-field').filter({hasText:field}).click();
      await editor.getByRole('combobox',{name:'数据类型',exact:true}).click();await page.getByRole('option',{name:type,exact:true}).click();
      if(field==='合格率') {
        await editor.getByRole('combobox',{name:'数字模式',exact:true}).click();await page.getByRole('option',{name:'百分比（95% → 95）',exact:true}).click();
        await expect(editor).toContainText('95 或 95% 均解析为 95');
      }
      if(format){await editor.getByRole('combobox',{name:'日期格式',exact:true}).click();await page.getByRole('option',{name:format,exact:true}).click();}
      if(field==='开关'){await editor.getByRole('textbox',{name:'真值文字',exact:true}).fill('启用\nyes');await editor.getByRole('textbox',{name:'假值文字',exact:true}).fill('停用\nno');}
      await editor.getByRole('tab',{name:'解析预览',exact:true}).click();
      await expect(editor.locator('.quality-preview-result pre')).toHaveText(result);
      if(field==='合格率')await expect(editor.getByText('百分数值，单位 %（95% → 95）',{exact:true})).toBeVisible();
      await editor.getByRole('button',{name:'完成配置',exact:true}).click();
    }
    await page.getByRole('button',{name:'启用模板',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'模板已启用'})).toBeVisible();
    await page.reload();
    if(platform!=='desktop')await page.getByRole('navigation',{name:'品质管理功能'}).getByRole('button',{name:'模板配置',exact:true}).click();
    await page.getByRole('row').filter({hasText:name}).getByRole('button',{name:'编辑',exact:true}).click();
    await page.locator('.quality-field').filter({hasText:'合格率'}).click();await expect(editor.getByRole('combobox',{name:'数字模式',exact:true})).toHaveValue('百分比（95% → 95）');
    await editor.getByRole('button',{name:'完成配置',exact:true}).click();await page.getByRole('button',{name:'返回模板列表',exact:true}).click();
    await page.getByRole('navigation',{name:'品质管理功能'}).getByRole('button',{name:'验收单',exact:true}).click();
    await page.getByRole('button',{name:'在线新建验收单',exact:true}).click();
    await page.getByRole('combobox',{name:'验收模板',exact:true}).click();await page.getByRole('option',{name:`${name} · v1`,exact:true}).click();
    await page.getByRole('checkbox',{name:'带入模板预填内容（请逐项核对）',exact:true}).check();await page.getByRole('button',{name:'开始填写',exact:true}).click();
    await page.getByRole('button',{name:'字段填写',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'合格率 · B1',exact:true})).toHaveValue('95.4321%');
    const off=page.getByRole('radio',{name:'开关 · B4 · 停用',exact:true});await expect(off).toBeChecked();
    await off.click();await expect(off).not.toBeChecked();await off.check();
    await page.getByRole('textbox',{name:'合格率 · B1',exact:true}).fill('99.125%');
    await page.getByRole('textbox',{name:'日期 · B2',exact:true}).fill('01/03/2024');
    await page.getByRole('textbox',{name:'采集时间 · B3',exact:true}).fill('2024.3.1 23:59');
    await page.getByRole('button',{name:'校验并预览',exact:true}).click();
    await page.getByRole('checkbox',{name:'绑定物料 类型',exact:true}).uncheck();
    await page.getByRole('button',{name:'查看解析结果',exact:true}).click();
    const modal=page.getByRole('dialog',{name:'工作表解析结果',exact:true});
    for(const value of ['99.125','"2024-03-01"','"2024-03-01T23:59:00"','false'])await expect(modal.getByText(value,{exact:true}).last()).toBeVisible();
    await expect(modal.getByText('百分数值，单位 %（95% → 95）',{exact:true})).toBeVisible();
    await modal.getByRole('button',{name:'关闭弹窗',exact:true}).click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    const response=page.waitForResponse(r=>r.url().endsWith('/api/quality/acceptances')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'确认保存验收单',exact:true}).click();
    const saved=await response;expect(saved.ok()).toBe(true);
    expect((await saved.json()).result.value.类型).toEqual({合格率:99.125,日期:'2024-03-01',采集时间:'2024-03-01T23:59:00',开关:false});
    const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载上传原文件',exact:true}).click();
    const exported=new ExcelJS.Workbook();await exported.xlsx.load(await readFile(await(await download).path()));
    const output=exported.getWorksheet('类型');expect(output.getCell('B1').value).toBe(0.99125);expect(output.getCell('B1').numFmt).toContain('%');
    expect(output.getCell('B2').value.toISOString()).toBe('2024-03-01T00:00:00.000Z');expect(output.getCell('B3').value.toISOString()).toBe('2024-03-01T23:59:00.000Z');expect(output.getCell('B4').value).toBe(false);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
