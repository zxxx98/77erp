import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
const ExcelJS=createRequire(import.meta.url)('exceljs');

const types=[['string','字符串','编号：AB-001'],['number','数字',12.5],['date','日期','2026-10-21'],['single','单选','★合格 ☆不合格'],['multi','多选','☑安装 ☑质保 ☐培训'],['measurements','测量值列表','12/13/14'],['uniqueKey','唯一 KEY','000123']];
test.beforeAll(async({request})=>{expect([201,409]).toContain((await request.post('/api/auth/setup',{data:{username:'admin',password:'Test-admin-123'}})).status());});
test.beforeEach(async({page})=>{
  await page.request.post('/api/auth/login',{data:{username:'admin',password:'Test-admin-123'}});
  const settings=await(await page.request.get('/api/settings/r2-backup')).json();
  await page.request.put('/api/settings/r2-backup',{data:{...settings,account_id:'a'.repeat(32),bucket:'erp-backups',access_key:'test-access',secret_key:'test-secret',enabled:false}});
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('设置分组');
  sheet.addRows(types.map(([,name,value])=>[name,value]));sheet.getCell('A9').value='检验明细';
  sheet.getRow(10).values=['项目','结果','数量'];sheet.getRow(11).values=['外观','合格',0];sheet.getRow(12).values=['尺寸','12/13',1];
  const fields=types.map(([type,name],i)=>({id:type,name,type,labelRegion:`A${i+1}`,valueRegion:`B${i+1}`,configured:true,...(['single','multi'].includes(type)?{checkChar:type==='single'?'★':'☑',uncheckChars:type==='single'?'☆':'☐',options:type==='single'?'合格\n不合格':'安装\n质保\n培训'}:{}),...(type==='measurements'?{separator:'/'}:{})}));
  fields.push({id:'items',name:'检验明细',type:'object',configured:true,labelRegion:'A9',propertyRegion:'A10:C10',valueRegion:'A11:C12',properties:[{id:'item',name:'项目',type:'string',headerCell:'A10'},{id:'result',name:'结果',type:'string',headerCell:'B10'},{id:'quantity',name:'数量',type:'number',headerCell:'C10'}]});
  await page.goto('/#quality');await page.getByLabel('上传模板 Excel').setInputFiles({name:'设置分组.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await book.xlsx.writeBuffer())});
  await page.getByLabel('导入模板字段配置').setInputFiles({name:'设置分组.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({schemaVersion:1,sheetName:'设置分组',fields}))});
  await expect(page.locator('.quality-field')).toHaveCount(8);
});

test('all field types expose their common settings and keep processing summaries after saving',async({page})=>{
  const editor=page.getByRole('complementary',{name:'字段独立编辑'});
  for(const [,name] of types){
    await page.locator('.quality-field').filter({has:page.locator('small').filter({hasText:`${name} ·`})}).click();
    await expect(editor.getByRole('region',{name:'基本信息',exact:true}).getByRole('checkbox',{name:'必填',exact:true})).toBeVisible();
    await expect(editor.getByRole('combobox',{name:'数据类型',exact:true})).toHaveValue(name);
    await expect(editor.locator('.quality-text-rules')).not.toHaveAttribute('open','');
    await expect(editor.getByRole('textbox',{name:'忽略内容',exact:true})).toHaveCount(0);
    if(['数字','日期','单选','多选','测量值列表'].includes(name))await expect(editor.getByRole('region',{name:'类型设置',exact:true})).toBeVisible();
    await editor.getByRole('button',{name:'完成配置',exact:true}).click();
  }
  await page.locator('.quality-field').filter({hasText:'字符串 ·'}).click();
  await editor.locator('.quality-text-rules > summary').click();
  await editor.getByRole('textbox',{name:'正则表达式',exact:true}).fill('^编号：([A-Z]+)-(\\d+)$');await editor.getByRole('textbox',{name:'正则替换内容',exact:true}).fill('$1/$2');
  await editor.locator('.quality-text-rules > summary').click();await expect(editor.locator('.quality-text-rules > summary')).toContainText('正则替换');
  await editor.locator('.quality-advanced-rules > summary').click();await editor.getByRole('button',{name:'添加特殊值',exact:true}).click();await editor.getByRole('textbox',{name:'特殊值原文',exact:true}).fill('N/A');
  await editor.locator('.quality-advanced-rules > summary').click();await expect(editor.locator('.quality-advanced-rules > summary')).toContainText('1 条映射');
  await editor.getByRole('tab',{name:'解析预览',exact:true}).click();
  await expect(editor.getByRole('region',{name:'解析结果',exact:true})).toHaveText('解析值"AB/001"');
  await expect(editor.locator('.quality-preview-details')).not.toHaveAttribute('open','');
  const order=await editor.locator('.quality-value-preview').evaluate(el=>[...el.children].map(child=>child.className));expect(order[0]).toBe('quality-preview-result');
  await editor.locator('.quality-preview-details > summary').click();await expect(editor.locator('.quality-processed-text pre')).toHaveText('AB/001');
  await editor.getByRole('tab',{name:'字段设置',exact:true}).click();await expect(editor.locator('.quality-text-rules')).not.toHaveAttribute('open','');
  await editor.getByRole('button',{name:'完成配置',exact:true}).click();await page.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'草稿已保存'})).toBeVisible();
  await page.reload();await page.getByRole('row').filter({hasText:'设置分组'}).getByRole('button',{name:'编辑',exact:true}).click();await page.locator('.quality-field').filter({hasText:'字符串 ·'}).click();
  await expect(editor.locator('.quality-text-rules > summary')).toContainText('正则替换');await expect(editor.locator('.quality-advanced-rules > summary')).toContainText('1 条映射');
  await page.screenshot({path:'output/ui-preview/quality-grouped-field-settings.png',fullPage:true});
});

test('object properties edit one at a time and preserve drafts and selection across preview tabs',async({page})=>{
  await page.locator('.quality-field').filter({hasText:'检验明细'}).click();const editor=page.getByRole('complementary',{name:'字段独立编辑'});
  await expect(editor.locator('.quality-property-item')).toHaveCount(3);
  await editor.locator('.quality-property-item').filter({hasText:'数量'}).click();
  await expect(editor.locator('.quality-property-item')).toHaveCount(0);await expect(editor.locator('.quality-property-settings')).toHaveCount(1);
  await editor.getByRole('textbox',{name:'属性名称',exact:true}).fill('数量（件）');await editor.getByRole('checkbox',{name:'必填',exact:true}).check();
  await editor.locator('.quality-text-rules > summary').click();
  await editor.getByRole('tab',{name:'解析预览',exact:true}).click();await expect(editor.getByRole('columnheader',{name:'数量（件）',exact:true})).toBeVisible();await expect(editor.locator('tbody tr').first().locator('td').last()).toHaveText('0');
  await editor.getByRole('tab',{name:'字段设置',exact:true}).click();await expect(editor.getByRole('textbox',{name:'属性名称',exact:true})).toHaveValue('数量（件）');await expect(editor.locator('.quality-text-rules')).toHaveAttribute('open','');
  await editor.getByRole('button',{name:'返回属性列表',exact:true}).click();await expect(editor.locator('.quality-property-item').last()).toContainText('必填');
  await editor.locator('.quality-property-item').first().click();await editor.getByRole('textbox',{name:'属性名称',exact:true}).fill('检验项目');await editor.getByRole('button',{name:'返回属性列表',exact:true}).click();
  await expect(editor.locator('.quality-property-item').first()).toContainText('检验项目');await expect(editor.locator('.quality-property-item').last()).toContainText('数量（件）');
  for(const width of [1440,1024,850]){
    await page.setViewportSize({width,height:1000});
    const fits=await editor.evaluate(el=>[el,el.querySelector('.quality-field-body')].every(element=>element.scrollWidth<=element.clientWidth));expect(fits).toBe(true);
  }
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'output/ui-preview/quality-property-list.png',fullPage:true});
  await editor.getByRole('button',{name:'完成配置',exact:true}).click();await page.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'草稿已保存'})).toBeVisible();
  const listed=await(await page.request.get('/api/quality/templates?q=设置分组')).json(),saved=await(await page.request.get(`/api/quality/templates/${listed.templates[0].id}`)).json();
  expect(saved.definition.fields.find(field=>field.id==='items').properties).toMatchObject([{name:'检验项目'},{name:'结果'},{name:'数量（件）',required:true}]);
});
