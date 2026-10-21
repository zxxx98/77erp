import { test, expect, devices } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const ExcelJS=createRequire(import.meta.url)('exceljs');

test('suffix marker position survives editing, saving and reloading single and multi choices',async({page})=>{
  const excel=new ExcelJS.Workbook(),sheet=excel.addWorksheet('抽样');
  sheet.getCell('A1').value='抽样方式';
  sheet.getCell('B1').value='按MIL-STD-105E Ⅱ 单次抽样                  正常检验■                          加严检验□                                          减量检验□';
  for(const type of ['单选','多选']){
    const name=`后置标记保存-${type}`;
    await page.goto('/#quality');
    await page.getByLabel('上传模板 Excel').setInputFiles({name:'抽样.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await excel.xlsx.writeBuffer())});
    await page.getByLabel('模板名称',{exact:true}).fill(name);
    await page.locator('[data-address=A1]').click({button:'right'});
    await page.getByRole('menuitem',{name:/添加为 Key（右）/}).click();
    const editor=page.getByRole('complementary',{name:'字段独立编辑'});
    await editor.getByRole('combobox').first().click();await page.getByRole('option',{name:type,exact:true}).click();
    await showTextRules(editor);await editor.getByRole('textbox',{name:'忽略内容',exact:true}).fill('按MIL-STD-105E Ⅱ 单次抽样');
    await editor.getByRole('textbox',{name:'勾选字符',exact:true}).fill('■');
    await editor.getByRole('textbox',{name:'未选中标记',exact:true}).fill('□');
    await editor.getByRole('textbox',{name:'允许选项（每行一个）',exact:true}).fill('正常检验\n加严检验\n减量检验');
    await editor.getByRole('button',{name:'完成配置',exact:true}).click();
    await page.getByRole('button',{name:'保存草稿',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'草稿已保存'})).toBeVisible();
    await page.getByRole('button',{name:'启用模板',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'模板已启用'})).toBeVisible();
    await page.locator('.quality-field').click();
    await editor.getByRole('combobox',{name:'标记位置',exact:true}).click();
    await page.getByRole('option',{name:'文字后（合格■ 拒收□）',exact:true}).click();
    await editor.getByRole('button',{name:'完成配置',exact:true}).click();
    await page.getByRole('button',{name:'发布新版本',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'模板已启用'})).toBeVisible();
    await page.reload();
    await page.getByRole('row').filter({hasText:name}).getByRole('button',{name:'编辑',exact:true}).click();
    await page.locator('.quality-field').click();
    await expect(editor.getByRole('combobox',{name:'标记位置',exact:true})).toHaveValue('文字后（合格■ 拒收□）');
    await editor.getByRole('tab',{name:'解析预览',exact:true}).click();await showPreviewDetails(editor);
    await expect(editor.getByRole('region',{name:'选项拆分结果'}).locator('.quality-choice-part')).toHaveCount(3);
    await expect(editor.locator('.quality-preview-result pre')).toHaveText(type==='单选'?'"正常检验"':'["正常检验"]');
  }
});

const fixturePath='tests/fixtures/quality-template.xlsx';
test.beforeAll(async({request})=>{
  const r=await request.post('/api/auth/setup',{data:{username:'admin',password:'Test-admin-123'}});expect([201,409]).toContain(r.status());
});
test.beforeEach(async({page})=>{
  await page.route('**/api/quality/workbook-preview',route=>route.abort());
  expect((await page.request.post('/api/auth/login',{data:{username:'admin',password:'Test-admin-123'}})).ok()).toBe(true);
  const c=await(await page.request.get('/api/settings/r2-backup')).json();
  expect((await page.request.put('/api/settings/r2-backup',{data:{...c,account_id:'a'.repeat(32),bucket:'erp-backups',access_key:'test-access',secret_key:'test-secret',excel_prefix:'excel',enabled:false}})).ok()).toBe(true);
});
async function showTextRules(panel){
  const details=panel.locator('.quality-text-rules').first();
  if(!await details.evaluate(el=>el.open))await details.locator(':scope > summary').click();
}
async function showPreviewDetails(panel){
  const details=panel.locator('.quality-preview-details');
  if(await details.count()&&!await details.evaluate(el=>el.open))await details.locator(':scope > summary').click();
}
async function editProperty(editor,index){
  const back=editor.getByRole('button',{name:'返回属性列表',exact:true});
  if(await back.isVisible())await back.click();
  await editor.locator('.quality-property-item').nth(index).click();
  return editor.locator('.quality-property-settings');
}
async function selectRange(page,start,end){
  const a=page.locator(`[data-address="${start}"]`),b=page.locator(`[data-address="${end}"]`);
  await a.scrollIntoViewIfNeeded();await b.scrollIntoViewIfNeeded();
  const ra=await a.boundingBox(),rb=await b.boundingBox();
  await page.mouse.move(ra.x+ra.width/2,ra.y+ra.height/2);await page.mouse.down();await page.mouse.move(rb.x+rb.width/2,rb.y+rb.height/2,{steps:10});await page.mouse.up();
}
async function newEditor(page){
  await page.goto('/#quality');await expect(page.getByRole('heading',{name:'品质管理',exact:true})).toBeVisible();
  await page.getByLabel('上传模板 Excel').setInputFiles(fixturePath);
  await expect(page.getByRole('heading',{name:'新建验收单模板'})).toBeVisible();
}
test('Excel preview trims empty edges while keeping merged cells, internal blanks and configured empty regions',async({page})=>{
  const excel=new ExcelJS.Workbook(),sheet=excel.addWorksheet('裁剪预览');
  sheet.getCell('A1').value='检验报告';sheet.mergeCells('A1:F1');
  sheet.getCell('B2').value='字段';sheet.getCell('D2').value='内容';
  sheet.getCell('E5').value=0;sheet.getCell('F6').value=false;
  sheet.getCell('H20').value=' \n ';sheet.getCell('J22').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFFFFF'}};
  const buffer=Buffer.from(await excel.xlsx.writeBuffer());
  await page.goto('/#quality');
  await page.getByLabel('上传模板 Excel').setInputFiles({name:'裁剪空白区域.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer});
  const table=page.getByRole('table',{name:'Excel 模板表格'});
  await expect(table.locator('thead th')).toHaveCount(7);await expect(table.locator('tbody tr')).toHaveCount(6);
  await expect(table.locator('[data-address=A1]')).toHaveAttribute('colspan','6');
  await expect(table.locator('[data-address=C3]')).toBeVisible();
  await expect(table.locator('[data-address=E5]')).toContainText('0');await expect(table.locator('[data-address=F6]')).toContainText('false');
  expect(await page.locator('.quality-sheet-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  const definition={schemaVersion:1,sheetName:'裁剪预览',fields:[{id:'field',name:'字段',type:'string',labelRegion:'B2',valueRegion:'H10',configured:true}]};
  await page.getByLabel('导入模板字段配置').setInputFiles({name:'配置.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(definition))});
  await expect(table.locator('thead th')).toHaveCount(9);await expect(table.locator('tbody tr')).toHaveCount(10);
  await expect(table.locator('[data-address=H10]')).toBeVisible();
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'草稿已保存'})).toBeVisible();
  const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'下载原始 Excel',exact:true}).click();
  const download=await downloadEvent;expect(await readFile(await download.path())).toEqual(buffer);
  await page.reload();await page.getByRole('row').filter({hasText:'裁剪空白区域'}).getByRole('button',{name:'编辑',exact:true}).click();
  await expect(table.locator('[data-address=H10]')).toBeVisible();
  await page.locator('.quality-field').click();
  const editor=page.getByRole('complementary',{name:'字段独立编辑'});
  await editor.getByLabel('取值区域',{exact:true}).fill('D2');
  await editor.getByRole('button',{name:'完成配置',exact:true}).click();
  await expect(table.locator('thead th')).toHaveCount(7);await expect(table.locator('tbody tr')).toHaveCount(6);
});
test('object wizard requires attributes and values, reads three string records, persists and downloads exact original',async({page})=>{
  // Public HTTP previews have getRandomValues but no secure-context randomUUID.
  await page.addInitScript(()=>Object.defineProperty(Crypto.prototype,'randomUUID',{value:undefined,configurable:true}));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await newEditor(page);
  await page.locator('[data-address=A16]').click({button:'right'});
  await page.getByRole('menuitem',{name:'添加为对象 Key',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'第 1 步'})).toBeVisible();
  await expect(page.getByRole('button',{name:'保存草稿',exact:true})).toBeDisabled();
  await selectRange(page,'A17','F17');
  let dialog=page.getByRole('dialog',{name:'确认对象属性'});await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox',{name:'属性 A17',exact:true})).toHaveValue('名称');
  await expect(dialog.getByText('字符串',{exact:true})).toHaveCount(6);
  await dialog.getByRole('button',{name:'确认并选择值区域'}).click();
  await expect(page.getByRole('status').filter({hasText:'第 3 步'})).toBeVisible();
  await expect(page.getByRole('button',{name:'保存草稿',exact:true})).toBeDisabled();
  await selectRange(page,'A18','E20');await expect(page.getByRole('alert')).toContainText('起止列一致');
  await selectRange(page,'A18','F20');
  dialog=page.getByRole('dialog',{name:'对象数据预览'});await expect(dialog).toBeVisible();
  await expect(dialog.getByText('机架式服务器',{exact:true})).toBeVisible();await expect(dialog.getByText('网络交换机',{exact:true})).toBeVisible();
  await expect(dialog.getByRole('cell',{name:'42,000.00',exact:true})).toBeVisible();await expect(dialog.getByText('584,600.00',{exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:'完成对象配置'}).click();
  await expect(page.locator('.quality-field')).toHaveCount(1);
  await page.screenshot({path:'output/ui-preview/quality-editor.png',fullPage:true});
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'草稿已保存'})).toBeVisible();
  await page.getByRole('button',{name:'启用模板',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'模板已启用'})).toBeVisible();
  const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'下载原始 Excel',exact:true}).click();
  const download=await downloadEvent;expect(await readFile(await download.path())).toEqual(await readFile(fixturePath));
  await page.reload();await page.getByRole('button',{name:'编辑',exact:true}).first().click();
  await expect(page.locator('.quality-field')).toContainText('采购明细');await expect(page.locator('.quality-field')).toContainText('6 个属性');
  await page.getByRole('button',{name:'查看完整解析预览'}).click();
  await expect(page.getByRole('dialog').getByText('网络交换机',{exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});
test('custom Key can be added without selecting a label, previewed, saved and edited',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const excel=new ExcelJS.Workbook(),sheet=excel.addWorksheet('公司');sheet.getCell('A1').value='某某公司';
  await page.goto('/#quality');
  await page.getByLabel('上传模板 Excel').setInputFiles({name:'自定义公司.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await excel.xlsx.writeBuffer())});
  await page.getByRole('button',{name:'添加自定义 Key',exact:true}).click();
  const editor=page.getByRole('complementary',{name:'字段独立编辑'});
  await editor.getByLabel('字段名称',{exact:true}).fill('公司名');
  await editor.getByRole('button',{name:'完成配置',exact:true}).click();
  await expect(editor.getByRole('alert')).toContainText('区域格式');
  await editor.getByRole('button',{name:'框选',exact:true}).click();
  await selectRange(page,'A1','A1');
  await expect(editor.getByLabel('取值区域',{exact:true})).toHaveValue('A1');
  await editor.getByRole('tab',{name:'解析预览'}).click();
  await expect(editor.locator('.quality-preview-result pre')).toHaveText('"某某公司"');
  await editor.getByRole('button',{name:'完成配置',exact:true}).click();
  await expect(page.locator('.quality-cell-marker')).toHaveCount(0);
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'草稿已保存'})).toBeVisible();
  await page.reload();
  await page.getByRole('row').filter({hasText:'自定义公司'}).getByRole('button',{name:'编辑',exact:true}).click();
  await page.locator('.quality-field').filter({hasText:'公司名'}).click();
  await expect(editor.getByLabel('字段名称',{exact:true})).toHaveValue('公司名');
  await expect(editor.getByLabel('取值区域',{exact:true})).toHaveValue('A1');
  await expect(editor).toContainText('自定义 Key');
  await editor.getByRole('button',{name:'移除字段',exact:true}).click();
  await expect(page.locator('.quality-field')).toHaveCount(0);
  await page.getByRole('button',{name:'添加自定义 Key',exact:true}).click();
  await editor.getByRole('button',{name:'取消编辑',exact:true}).click();
  await expect(page.locator('.quality-field')).toHaveCount(0);expect(errors).toEqual([]);
});
test('normal key directions, custom values and object cancel keep explicit choices',async({page})=>{
  await newEditor(page);
  await page.locator('[data-address=A8]').click({button:'right'});
  await expect(page.getByRole('menuitem',{name:/添加为 Key（右）/})).toContainText('B8:F8');
  await expect(page.getByRole('menuitem',{name:/添加为 Key（左）/})).toBeDisabled();
  await page.getByRole('menuitem',{name:/添加为 Key（右）/}).click();
  await page.getByRole('button',{name:'完成配置',exact:true}).click();
  await page.locator('[data-address=A16]').click({button:'right'});await page.getByRole('menuitem',{name:'添加为对象 Key',exact:true}).click();
  await selectRange(page,'A17','F17');await page.getByRole('dialog').getByRole('button',{name:'取消添加',exact:true}).click();
  await expect(page.locator('.quality-field')).toHaveCount(1);await expect(page.getByRole('button',{name:'保存草稿',exact:true})).toBeEnabled();
});
test('inline radio and checkbox labels match decorated allowed options in editor and server previews',async({page})=>{
  await newEditor(page);await page.getByLabel('模板名称',{exact:true}).fill('选项标记模板');
  const editor=page.getByRole('complementary',{name:'字段独立编辑'});
  for(const [address,type,checkChar,options,expected] of [
    ['A6','单选','●','● CNY\n○ USD\n○ EUR','CNY'],
    ['A7','多选','☑','☑ 到场安装\n☐ 三年质保\n☐ 上门培训',['到场安装','三年质保']]
  ]){
    await page.locator(`[data-address=${address}]`).click({button:'right'});
    await page.getByRole('menuitem',{name:/添加为 Key（右）/}).click();
    await editor.getByRole('combobox').first().click();await page.getByRole('option',{name:type,exact:true}).click();
    await expect(editor.getByRole('textbox',{name:'未选中标记',exact:true})).toHaveValue('');
    await editor.getByRole('textbox',{name:/^勾选字符/}).fill(checkChar);
    await editor.getByRole('textbox',{name:'未选中标记',exact:true}).fill(type==='单选'?'○':'☐');
    await editor.getByRole('textbox',{name:/^允许选项/}).fill(options);
    await editor.getByRole('tab',{name:'解析预览',exact:true}).click();await showPreviewDetails(editor);
    await expect(editor.locator('.quality-preview-result pre')).toHaveText(JSON.stringify(expected));
    const split=editor.getByRole('region',{name:'选项拆分结果'});await expect(split.locator('.quality-choice-part')).toHaveCount(3);
    await expect(split.getByText('已选中',{exact:true})).toHaveCount(type==='单选'?1:2);await expect(split.getByText('未选中',{exact:true})).toHaveCount(type==='单选'?2:1);
    await expect(editor.locator('.form-error')).toHaveCount(0);
    await editor.getByRole('button',{name:'完成配置',exact:true}).click();
  }
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'草稿已保存'})).toBeVisible();
  const list=await(await page.request.get('/api/quality/templates?q=选项标记模板')).json(),id=list.templates[0].id;
  const preview=await(await page.request.post(`/api/quality/templates/${id}/preview`,{data:{}})).json();
  expect(preview.value).toMatchObject({币种:'CNY',交付方式:['到场安装','三年质保']});expect(preview.issues).toEqual([]);
  await page.getByRole('button',{name:'启用模板',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'模板已启用'})).toBeVisible();
});
test('custom choice markers and strict separator mode persist whitespace and never fall back',async({page})=>{
  await page.goto('/#quality');
  await page.getByLabel('上传模板 Excel').setInputFiles('tests/fixtures/quality-choice-symbols.xlsx');
  await expect(page.getByRole('heading',{name:'新建验收单模板'})).toBeVisible();
  await page.getByLabel('模板名称',{exact:true}).fill('自定义符号与严格分隔');
  await page.locator('[data-address=A1]').click({button:'right'});await page.getByRole('menuitem',{name:/添加为 Key（右）/}).click();
  const editor=page.getByRole('complementary',{name:'字段独立编辑'});
  await editor.getByRole('combobox').first().click();await page.getByRole('option',{name:'单选',exact:true}).click();
  await expect(editor.getByRole('textbox',{name:'选项分隔符',exact:true})).toHaveCount(0);
  await editor.getByRole('textbox',{name:'勾选字符',exact:true}).fill('★');
  await editor.getByRole('textbox',{name:'未选中标记',exact:true}).fill('☆');
  await editor.getByRole('textbox',{name:'允许选项（每行一个）',exact:true}).fill('★ CNY\n☆ USD\n☆ EUR');
  await editor.getByRole('tab',{name:'解析预览',exact:true}).click();await showPreviewDetails(editor);
  await expect(editor.locator('.quality-preview-result pre')).toHaveText('"CNY"');
  await editor.getByRole('tab',{name:'字段设置',exact:true}).click();
  await editor.getByRole('combobox',{name:'选项拆分方式',exact:true}).click();await page.getByRole('option',{name:'按指定分隔符拆分',exact:true}).click();
  await editor.getByRole('textbox',{name:'选项分隔符',exact:true}).fill('乱填');
  await editor.getByRole('tab',{name:'解析预览',exact:true}).click();await showPreviewDetails(editor);
  await expect(editor.getByText(/分隔符与原文不匹配/)).toBeVisible();
  await expect(editor.locator('.quality-preview-result pre')).toHaveText('null');
  await editor.getByRole('tab',{name:'字段设置',exact:true}).click();
  await editor.getByRole('textbox',{name:'选项分隔符',exact:true}).fill(' ');
  await editor.getByRole('tab',{name:'解析预览',exact:true}).click();await showPreviewDetails(editor);
  await expect(editor.locator('.quality-preview-result pre')).toHaveText('"CNY"');
  await expect(editor.locator('.form-error')).toHaveCount(0);
  await editor.getByRole('button',{name:'完成配置',exact:true}).click();
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'草稿已保存'})).toBeVisible();
  const listed=await(await page.request.get('/api/quality/templates?q=自定义符号与严格分隔')).json(),id=listed.templates[0].id;
  const detail=await(await page.request.get(`/api/quality/templates/${id}`)).json();
  expect(detail.definition.fields[0]).toMatchObject({choiceMode:'separator',checkChar:'★',uncheckChars:'☆',separator:' '});
  const preview=await(await page.request.post(`/api/quality/templates/${id}/preview`,{data:{}})).json();
  expect(preview.value.币种).toBe('CNY');expect(preview.issues).toEqual([]);
});
test('Shift toggles disjoint keys and batch creation keeps merged value regions after saving',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await newEditor(page);await page.getByLabel('模板名称',{exact:true}).fill('Shift批量模板');
  await page.locator('[data-address=A8]').click();
  for(const address of ['A11','A13','A11','A11'])await page.locator(`[data-address=${address}]`).click({modifiers:['Shift']});
  await expect(page.locator('.quality-selected')).toHaveCount(3);
  await page.locator('[data-address=A8]').click({button:'right'});
  await expect(page.locator('.quality-selected')).toHaveCount(3);
  await expect(page.getByRole('menuitem',{name:'添加为对象 Key',exact:true})).toHaveCount(0);
  await expect(page.getByRole('menuitem',{name:/批量添加为 Key（左）/})).toBeDisabled();
  await page.getByRole('menuitem',{name:/批量添加为 Key（右）/}).click();
  const dialog=page.getByRole('dialog',{name:'批量添加普通 Key'});
  await expect(dialog.getByRole('cell',{name:'B8:F8',exact:true})).toBeVisible();
  await expect(dialog.getByRole('cell',{name:'B11',exact:true})).toBeVisible();
  await expect(dialog.getByRole('cell',{name:'B13',exact:true})).toBeVisible();
  await expect(dialog.getByRole('cell',{name:'字符串',exact:true})).toHaveCount(3);
  await expect(page.getByRole('button',{name:'保存草稿',exact:true})).toBeDisabled();
  await dialog.getByRole('textbox',{name:'字段名称 A13',exact:true}).fill('公司名称');
  await dialog.getByRole('button',{name:'确认批量添加',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('名称不能重复');
  await expect(page.locator('.quality-field')).toHaveCount(0);
  await dialog.getByRole('textbox',{name:'字段名称 A13',exact:true}).fill('供应商电话');
  await dialog.getByRole('button',{name:'确认批量添加',exact:true}).click();
  await expect(page.locator('.quality-field')).toHaveCount(3);
  await expect(page.getByRole('status').filter({hasText:'已批量添加 3 个普通 Key'})).toBeVisible();
  await page.locator('.quality-field').filter({hasText:'供应商电话'}).click();
  await expect(page.getByRole('textbox',{name:'字段名称',exact:true})).toHaveValue('供应商电话');
  await page.getByRole('button',{name:'完成配置',exact:true}).click();
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'草稿已保存'})).toBeVisible();
  await page.reload();await page.getByRole('row').filter({hasText:'Shift批量模板'}).getByRole('button',{name:'编辑',exact:true}).click();
  await expect(page.locator('.quality-field')).toHaveCount(3);
  const listed=await(await page.request.get('/api/quality/templates?q=Shift批量模板')).json();
  const saved=await(await page.request.get(`/api/quality/templates/${listed.templates[0].id}`)).json();
  expect(saved.definition.fields.map(f=>[f.labelRegion,f.valueRegion,f.type,f.direction,f.configured])).toEqual([
    ['A8','B8:F8','string','right',true],['A13','B13','string','right',true],['A11','B11','string','right',true]
  ]);
  expect(errors).toEqual([]);
});
test('batch cancel preserves fields, outside right click resets selection and existing keys are protected',async({page})=>{
  await newEditor(page);
  await page.locator('[data-address=A11]').click();
  await page.locator('[data-address=A12]').click({modifiers:['Shift']});
  await page.getByRole('button',{name:'添加字段',exact:true}).click();
  await page.getByRole('menuitem',{name:/批量添加为 Key（右）/}).click();
  await page.getByRole('dialog',{name:'批量添加普通 Key'}).getByRole('button',{name:'取消添加',exact:true}).click();
  await expect(page.locator('.quality-field')).toHaveCount(0);
  await expect(page.locator('.quality-selected')).toHaveCount(2);
  await page.getByRole('button',{name:'清除多选',exact:true}).click();
  await expect(page.locator('.quality-selected')).toHaveCount(0);
  await page.locator('[data-address=A11]').click();await page.locator('[data-address=A12]').click({modifiers:['Shift']});
  await page.locator('[data-address=A14]').click({button:'right'});
  await expect(page.locator('.quality-selected')).toHaveCount(1);
  await expect(page.getByRole('menuitem',{name:/批量添加为 Key/})).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('[data-address=A11]').click({button:'right'});
  await page.getByRole('menuitem',{name:/添加为 Key（右）/}).click();await page.getByRole('button',{name:'完成配置',exact:true}).click();
  await page.locator('[data-address=A12]').click({modifiers:['Shift']});
  await page.locator('[data-address=A12]').click({button:'right'});
  await page.getByRole('menuitem',{name:/批量添加为 Key（右）/}).click();
  await expect(page.getByRole('alert')).toContainText('A11 已配置 Key');
  await expect(page.locator('.quality-field')).toHaveCount(1);
  await page.locator('[data-address=A11]').click({modifiers:['Shift']});
  await expect(page.locator('.quality-selected')).toHaveCount(1);
  await page.locator('[data-address=A12]').click({button:'right'});
  await page.getByRole('menuitem',{name:/添加为 Key（右）/}).click();await page.getByRole('button',{name:'完成配置',exact:true}).click();
  await expect(page.locator('.quality-field')).toHaveCount(2);
});
test('field items open a dedicated editor with separate preview, picking and discard protection',async({page})=>{
  await newEditor(page);
  await page.locator('[data-address=A11]').click({button:'right'});
  await page.getByRole('menuitem',{name:/添加为 Key（右）/}).click();
  await page.getByRole('button',{name:'完成配置',exact:true}).click();
  await page.locator('.quality-field').click();
  const editor=page.getByRole('complementary',{name:'字段独立编辑'});
  await expect(editor).toBeVisible();await expect(page.locator('.quality-field-list')).toHaveCount(0);
  await expect(editor.getByRole('tab',{name:'字段设置',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(editor.getByRole('textbox',{name:'字段名称',exact:true})).toHaveValue('公司名称');
  await editor.getByRole('tab',{name:'解析预览',exact:true}).click();await showPreviewDetails(editor);
  await expect(editor.getByText('星辰科技有限公司',{exact:true})).toBeVisible();
  await expect(editor.getByRole('textbox',{name:'字段名称',exact:true})).toHaveCount(0);
  await editor.getByRole('tab',{name:'字段设置',exact:true}).click();
  await editor.getByRole('textbox',{name:'字段名称',exact:true}).fill('未应用的名称');
  page.once('dialog',d=>d.dismiss());await editor.getByRole('button',{name:'返回字段列表',exact:true}).click();
  await expect(editor.getByRole('textbox',{name:'字段名称',exact:true})).toHaveValue('未应用的名称');
  page.once('dialog',d=>d.accept());await editor.getByRole('button',{name:'返回字段列表',exact:true}).click();
  await expect(page.locator('.quality-field')).toContainText('公司名称');
  await expect(page.locator('.quality-field-preview')).toHaveCount(0);
  await page.locator('.quality-field').click();
  await editor.getByRole('textbox',{name:'字段名称',exact:true}).fill('供应商联系人');
  await editor.getByRole('button',{name:'框选',exact:true}).click();await selectRange(page,'B12','B12');
  await expect(editor.getByRole('textbox',{name:'取值区域',exact:true})).toHaveValue('B12');
  await editor.getByRole('tab',{name:'解析预览',exact:true}).click();await showPreviewDetails(editor);
  await expect(editor.getByText('李婷',{exact:true})).toBeVisible();
  await editor.getByRole('tab',{name:'字段设置',exact:true}).click();
  await page.locator('.quality-editor').screenshot({path:'output/ui-preview/quality-field-detail.png'});
  await editor.getByRole('button',{name:'完成配置',exact:true}).click();
  await expect(page.locator('.quality-field')).toContainText('供应商联系人');
  await expect(page.locator('.quality-field')).toContainText('B12');
});
test('object reselect returns to its field editor and cancel keeps the pending draft',async({page})=>{
  await newEditor(page);
  await page.locator('[data-address=A16]').click({button:'right'});await page.getByRole('menuitem',{name:'添加为对象 Key',exact:true}).click();
  await selectRange(page,'A17','F17');await page.getByRole('dialog').getByRole('button',{name:'确认并选择值区域'}).click();
  await selectRange(page,'A18','F20');await page.getByRole('dialog').getByRole('button',{name:'完成对象配置'}).click();
  await page.locator('.quality-field').click();
  const editor=page.getByRole('complementary',{name:'字段独立编辑'});
  await editor.getByRole('textbox',{name:'字段名称',exact:true}).fill('采购明细（编辑）');
  await editor.getByRole('button',{name:'重新选择属性和值区域'}).click();
  await page.getByRole('button',{name:'取消重选',exact:true}).click();
  await expect(editor.getByRole('textbox',{name:'字段名称',exact:true})).toHaveValue('采购明细（编辑）');
  await editor.getByRole('button',{name:'重新选择属性和值区域'}).click();
  await selectRange(page,'A17','F17');await page.getByRole('dialog').getByRole('button',{name:'确认并选择值区域'}).click();
  await selectRange(page,'A18','F19');await page.getByRole('dialog').getByRole('button',{name:'完成对象配置'}).click();
  await expect(editor).toBeVisible();await expect(page.locator('.quality-field-list')).toHaveCount(0);
  await editor.getByRole('tab',{name:'解析预览',exact:true}).click();await showPreviewDetails(editor);
  await expect(editor.getByRole('cell',{name:'机架式服务器',exact:true})).toBeVisible();
  await expect(editor.getByRole('cell',{name:'网络交换机',exact:true})).toHaveCount(0);
  await page.locator('.quality-editor').screenshot({path:'output/ui-preview/quality-object-field-detail.png'});
  await editor.getByRole('button',{name:'完成配置',exact:true}).click();
  await expect(page.locator('.quality-field')).toContainText('采购明细（编辑）');
  await expect(page.locator('.quality-field')).toContainText('A18:F19');
});
test('vertical attribute selection maps right-hand columns to records and survives reopening',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/#quality');
  await page.getByLabel('上传模板 Excel').setInputFiles('tests/fixtures/quality-template-vertical.xlsx');
  await expect(page.getByRole('heading',{name:'新建验收单模板'})).toBeVisible();
  await page.locator('[data-address=A1]').click({button:'right'});
  await page.getByRole('menuitem',{name:'添加为对象 Key',exact:true}).click();
  await selectRange(page,'A3','B5');await expect(page.getByRole('alert')).toContainText('一行或一列');
  await selectRange(page,'A3','A5');
  let dialog=page.getByRole('dialog',{name:'确认对象属性'});
  await expect(dialog.getByRole('textbox',{name:'属性 A3',exact:true})).toHaveValue('名称');
  await expect(dialog.getByRole('textbox',{name:'属性 A5',exact:true})).toHaveValue('数量');
  await expect(dialog.getByText('字符串',{exact:true})).toHaveCount(3);
  await dialog.getByRole('button',{name:'确认并选择值区域'}).click();
  await expect(page.getByRole('status').filter({hasText:'第 3 步'})).toContainText('每列一条记录');
  await selectRange(page,'B3','D4');await expect(page.getByRole('alert')).toContainText('起止行一致');
  await selectRange(page,'B3','D5');
  dialog=page.getByRole('dialog',{name:'对象数据预览'});
  await expect(dialog.getByText('当前 2 条记录',{exact:false})).toBeVisible();
  await expect(dialog.getByRole('columnheader',{name:'源列',exact:true})).toBeVisible();
  await expect(dialog.getByRole('rowheader',{name:'B',exact:true})).toBeVisible();
  await expect(dialog.getByRole('rowheader',{name:'D',exact:true})).toBeVisible();
  await expect(dialog.getByText('服务器',{exact:true})).toBeVisible();
  await expect(dialog.getByText('交换机',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'完成对象配置'}).click();
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'草稿已保存'})).toBeVisible();
  await page.getByRole('button',{name:'启用模板',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'模板已启用'})).toBeVisible();
  await page.reload();
  await page.getByRole('row').filter({hasText:'quality-template-vertical.xlsx'}).getByRole('button',{name:'编辑',exact:true}).click();
  await page.getByRole('button',{name:'查看完整解析预览'}).click();
  await expect(page.getByRole('dialog').getByRole('rowheader',{name:'D',exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});
test('unique KEY has one shared slot, releases it on type change and persists on reopen',async({page})=>{
  await newEditor(page);await page.getByLabel('模板名称',{exact:true}).fill('唯一 KEY 测试');
  const editor=page.getByRole('complementary',{name:'字段独立编辑'});
  const choose=async name=>{
    await editor.getByRole('combobox').first().click();
    await page.getByRole('option',{name,exact:true}).click();
  };
  await page.locator('[data-address=A8]').click({button:'right'});
  await page.getByRole('menuitem',{name:/添加为 Key（右）/}).click();
  await choose('唯一 KEY');
  await editor.getByRole('button',{name:'完成配置',exact:true}).click();
  await expect(page.locator('.quality-field')).toContainText('唯一 KEY');
  await page.locator('[data-address=A6]').click({button:'right'});
  await page.getByRole('menuitem',{name:/添加为 Key（右）/}).click();
  await editor.getByRole('combobox').first().click();
  await expect(page.getByRole('option',{name:'唯一 KEY',exact:true})).toBeDisabled();
  await page.keyboard.press('Escape');
  await editor.getByRole('button',{name:'完成配置',exact:true}).click();
  await page.locator('.quality-field').filter({hasText:'唯一 KEY'}).click();
  await choose('字符串');await editor.getByRole('button',{name:'完成配置',exact:true}).click();
  await page.locator('[data-address=A16]').click({button:'right'});
  await page.getByRole('menuitem',{name:'添加为对象 Key',exact:true}).click();
  await selectRange(page,'A17','F17');
  await page.getByRole('dialog').getByRole('button',{name:'确认并选择值区域'}).click();
  await selectRange(page,'A18','F20');
  await page.getByRole('dialog').getByRole('button',{name:'完成对象配置'}).click();
  await page.locator('.quality-field').filter({hasText:'采购明细'}).click();
  let property=await editProperty(editor,0);
  await property.getByRole('combobox').first().click();
  await expect(page.getByRole('option',{name:'唯一 KEY',exact:true})).toBeEnabled();
  await page.getByRole('option',{name:'唯一 KEY',exact:true}).click();
  property=await editProperty(editor,1);
  await property.getByRole('combobox').first().click();
  await expect(page.getByRole('option',{name:'唯一 KEY',exact:true})).toBeDisabled();
  await page.keyboard.press('Escape');
  await editor.getByRole('button',{name:'完成配置',exact:true}).click();
  await page.locator('.quality-field').filter({hasText:'B8:F8'}).click();
  await editor.getByRole('combobox').first().click();
  await expect(page.getByRole('option',{name:'唯一 KEY',exact:true})).toBeDisabled();
  await page.keyboard.press('Escape');
  await editor.getByRole('button',{name:'完成配置',exact:true}).click();
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'草稿已保存'})).toBeVisible();
  await page.reload();
  await page.getByRole('row').filter({hasText:'唯一 KEY 测试'}).getByRole('button',{name:'编辑',exact:true}).click();
  await page.locator('.quality-field').filter({hasText:'采购明细'}).click();
  await expect(editor.locator('.quality-property-item').first()).toContainText('唯一 KEY');
});
test('mobile has no quality navigation or editor entry',async({browser})=>{
  const context=await browser.newContext({...devices['iPhone 13'],baseURL:'http://127.0.0.1:3199'});
  try{
    await context.request.post('/api/auth/login',{data:{username:'admin',password:'Test-admin-123'}});const page=await context.newPage();
    await page.goto('/#quality');await expect(page.getByRole('heading',{name:'工作台',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'更多',exact:true}).click();
    await expect(page.getByRole('link',{name:'品质管理',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'品质管理',exact:true})).toHaveCount(0);
    await expect(page.getByRole('heading',{name:'验收单模板',exact:true})).toHaveCount(0);
  }finally{await context.close();}
});

test('an object Key can also be the first vertical property and reverse drags open confirmation',async({page})=>{
  await page.goto('/#quality');
  await page.getByLabel('上传模板 Excel').setInputFiles('tests/fixtures/quality-template-vertical.xlsx');
  await expect(page.getByRole('heading',{name:'新建验收单模板'})).toBeVisible();
  await page.locator('[data-address=A3]').click({button:'right'});
  await page.getByRole('menuitem',{name:'添加为对象 Key',exact:true}).click();
  await selectRange(page,'A3','A5');
  let dialog=page.getByRole('dialog',{name:'确认对象属性'});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox',{name:'属性 A3',exact:true})).toHaveValue('名称');
  await dialog.getByRole('button',{name:'重新框选',exact:true}).click();
  await selectRange(page,'A5','A3');
  dialog=page.getByRole('dialog',{name:'确认对象属性'});
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox',{name:'对象 Key 名称',exact:true}).fill('竖向属性内对象 Key');
  await dialog.getByRole('button',{name:'确认并选择值区域',exact:true}).click();
  await selectRange(page,'B3','D5');
  await page.getByRole('dialog',{name:'对象数据预览'}).getByRole('button',{name:'完成对象配置',exact:true}).click();
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'草稿已保存'})).toBeVisible();
});

for(const vertical of [true,false])test(`${vertical?'vertical':'horizontal'} merged properties and values configure by logical cells without splitting the original Excel`,async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/#quality');await page.getByLabel('上传模板 Excel').setInputFiles('tests/fixtures/quality-template-merged-objects.xlsx');
  await expect(page.getByRole('heading',{name:'新建验收单模板'})).toBeVisible();
  if(!vertical){await page.getByRole('combobox',{name:'模板工作表'}).click();await page.getByRole('option',{name:'横向合并',exact:true}).click();}
  await page.getByLabel('模板名称',{exact:true}).fill(`合并单元格${vertical?'竖向':'横向'}对象`);
  await page.locator('[data-address=A1]').click({button:'right'});await page.getByRole('menuitem',{name:'添加为对象 Key',exact:true}).click();
  await selectRange(page,'A1','C3');
  await expect(page.locator('.quality-selection-error')).toContainText('一行或一列');
  await expect(page.locator('.quality-selection-error')).toBeInViewport();
  await selectRange(page,'A1',vertical?'A5':'E1');
  let dialog=page.getByRole('dialog',{name:'确认对象属性'});await expect(dialog).toBeVisible();
  await expect(dialog.getByText('字符串',{exact:true})).toHaveCount(3);
  await dialog.getByRole('textbox',{name:'对象 Key 名称',exact:true}).fill('缺陷统计');
  for(const [index,name] of ['缺点等级','允收/拒收','不良数'].entries())await dialog.getByRole('textbox',{name:`属性 ${vertical?'A'+(index*2+1):['A1','C1','E1'][index]}`,exact:true}).fill(name);
  await dialog.getByRole('button',{name:'确认并选择值区域',exact:true}).click();
  await selectRange(page,vertical?'C1':'A3',vertical?'G5':'E7');
  dialog=page.getByRole('dialog',{name:'对象数据预览'});await expect(dialog).toBeVisible();
  await expect(dialog.getByText('当前 3 条记录',{exact:false})).toBeVisible();
  await expect(dialog.getByRole('cell',{name:'2/3',exact:true})).toBeVisible();
  await page.screenshot({path:`output/ui-preview/quality-${vertical?'vertical':'horizontal'}-merged-object.png`,fullPage:true});
  await dialog.getByRole('button',{name:'完成对象配置',exact:true}).click();
  await page.getByRole('button',{name:'启用模板',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'模板已启用'})).toBeVisible();
  const response=await page.request.get(`/api/quality/templates?q=${encodeURIComponent(`合并单元格${vertical?'竖向':'横向'}对象`)}`),rows=await response.json();
  const detail=await(await page.request.get(`/api/quality/templates/${rows.templates[0].id}`)).json();
  expect(detail.definition.fields[0].orientation).toBe(vertical?'vertical':'horizontal');expect(detail.definition.fields[0].properties).toHaveLength(3);
  const download=await page.request.get(`/api/quality/templates/${detail.id}/download`);expect(await download.body()).toEqual(await readFile('tests/fixtures/quality-template-merged-objects.xlsx'));
  await page.reload();await page.getByRole('row').filter({hasText:detail.name}).getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('button',{name:'查看完整解析预览',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('cell',{name:'2/3',exact:true})).toBeVisible();expect(errors).toEqual([]);
});

for(const vertical of [false,true])test(`${vertical?'vertical':'horizontal'} multilevel headers flatten grouped leaves and retain typed properties through reselect and publication`,async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:vertical?1920:1440,height:1200});
  const templateName=`多级表头${vertical?'竖向':'横向'}验证`;
  await page.goto('/#quality');await page.getByLabel('上传模板 Excel').setInputFiles('tests/fixtures/quality-template-multiheaders.xlsx');
  await expect(page.getByRole('heading',{name:'新建验收单模板'})).toBeVisible();
  if(vertical){await page.getByRole('combobox',{name:'模板工作表',exact:true}).click();await page.getByRole('option',{name:'竖向多级',exact:true}).click();}
  await page.getByLabel('模板名称',{exact:true}).fill(templateName);
  await page.locator('[data-address=A1]').click({button:'right'});await page.getByRole('menuitem',{name:'添加为对象 Key',exact:true}).click();
  await page.getByRole('combobox',{name:'对象表头模式',exact:true}).click();await page.getByRole('option',{name:'多级表头（完整表头区域）',exact:true}).click();
  if(vertical){await page.getByRole('combobox',{name:'多级表头排列方向',exact:true}).click();await page.getByRole('option',{name:'竖向表头：右侧每列一条记录',exact:true}).click();}
  const headers=()=>selectRange(page,'A1',vertical?'A7':'G1');
  const values=()=>selectRange(page,vertical?'C1':'A3',vertical?'E7':'G5');
  await headers();let dialog=page.getByRole('dialog',{name:'确认对象属性'});await expect(dialog).toBeVisible();
  await expect(dialog.getByText('字符串',{exact:true})).toHaveCount(7);
  await expect(dialog.getByRole('columnheader',{name:'原始表头路径'})).toBeVisible();
  const leaf=vertical?'B5':'E2';
  await expect(dialog.getByRole('textbox',{name:`属性 ${leaf}`,exact:true})).toHaveValue(/缺点件数.* \/ MA/);
  await expect(dialog.getByRole('row').filter({has:page.getByRole('textbox',{name:`属性 ${leaf}`,exact:true})})).toContainText(vertical?'A4:A6':'D1:F1');
  await dialog.getByRole('textbox',{name:'对象 Key 名称',exact:true}).fill('检验明细');
  const names=['检验项目','检验要求','检验结果','缺点件数 / CR','缺点件数 / MA','缺点件数 / MI','判定'];
  const addresses=vertical?['A1','A2','A3','B4','B5','B6','A7']:['A1','B1','C1','D2','E2','F2','G1'];
  for(let i=0;i<names.length;i++)await dialog.getByRole('textbox',{name:`属性 ${addresses[i]}`,exact:true}).fill(names[i]);
  await page.screenshot({path:`output/ui-preview/quality-multiheaders-${vertical?'vertical':'horizontal'}-confirm.png`,fullPage:true});
  await dialog.getByRole('button',{name:'确认并选择值区域',exact:true}).click();await values();
  dialog=page.getByRole('dialog',{name:'对象数据预览'});await expect(dialog).toBeVisible();await expect(dialog.getByText('当前 3 条记录',{exact:false})).toBeVisible();
  await dialog.getByRole('button',{name:'完成对象配置',exact:true}).click();await page.locator('.quality-field').click();
  const editor=page.getByRole('complementary',{name:'字段独立编辑'});
  for(const index of [3,4,5]){
    const property=await editProperty(editor,index);
    await property.getByRole('combobox').first().click();await page.getByRole('option',{name:'数字',exact:true}).click();await editor.getByRole('button',{name:'返回属性列表',exact:true}).click();
  }
  await editor.getByRole('button',{name:'重新选择属性和值区域',exact:true}).click();await headers();
  dialog=page.getByRole('dialog',{name:'确认对象属性'});await expect(dialog.getByRole('textbox',{name:`属性 ${leaf}`,exact:true})).toHaveValue('缺点件数 / MA');await expect(dialog.getByText('数字',{exact:true})).toHaveCount(3);
  await dialog.getByRole('button',{name:'确认并选择值区域',exact:true}).click();await values();
  await page.getByRole('dialog',{name:'对象数据预览'}).getByRole('button',{name:'完成对象配置',exact:true}).click();
  await editor.getByRole('button',{name:'完成配置',exact:true}).click();
  await page.getByRole('button',{name:'启用模板',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'模板已启用'})).toBeVisible();
  const listed=await(await page.request.get(`/api/quality/templates?q=${encodeURIComponent(templateName)}`)).json();
  const detail=await(await page.request.get(`/api/quality/templates/${listed.templates[0].id}`)).json();
  const field=detail.definition.fields[0];expect(field).toMatchObject({headerMode:'multi',orientation:vertical?'vertical':'horizontal',propertyRegion:vertical?'A1:B7':'A1:G2',valueRegion:vertical?'C1:E7':'A3:G5'});
  expect(field.properties.map(p=>p.name)).toEqual(names);expect(field.properties[4].headerPath.map(p=>p.text)).toEqual(['缺点件数\nSố lượng khiếm khuyết','MA']);
  const preview=await(await page.request.post(`/api/quality/templates/${detail.id}/preview`,{data:{}})).json();expect(preview.issues).toEqual([]);
  expect(preview.value.检验明细[0]).toMatchObject({'缺点件数 / CR':null,'缺点件数 / MA':0,'缺点件数 / MI':null});expect(preview.value.检验明细[1]['缺点件数 / MA']).toBe(2);
  const download=await page.request.get(`/api/quality/templates/${detail.id}/download`);expect(await download.body()).toEqual(await readFile('tests/fixtures/quality-template-multiheaders.xlsx'));
  await page.reload();await page.getByRole('row').filter({hasText:templateName}).getByRole('button',{name:'编辑',exact:true}).click();await page.locator('.quality-field').click();
  await expect(editor.locator('.quality-field-regions')).toContainText('多级表头');await expect(editor.locator('.quality-property-item').nth(4)).toContainText('缺点件数 / MA');await expect(editor.locator('.quality-property-item').nth(4)).toContainText('数字');expect(errors).toEqual([]);
});

test('report layout guides the exact value columns and identifies the merged footer before a corrected selection succeeds',async({page})=>{
  await page.setViewportSize({width:1920,height:2000});
  await page.goto('/#quality');await page.getByLabel('上传模板 Excel').setInputFiles('tests/fixtures/quality-template-report-layout.xlsx');
  await expect(page.getByRole('heading',{name:'新建验收单模板'})).toBeVisible();
  await page.getByLabel('模板名称',{exact:true}).fill('多级表头选区错误定位');
  await page.locator('[data-address=A9]').click({button:'right'});await page.getByRole('menuitem',{name:'添加为对象 Key',exact:true}).click();
  await expect(page.getByText('对象 Key 的单元格也可以同时作为属性表头，需要读取时请一并框选。')).toBeVisible();
  await page.getByRole('combobox',{name:'对象表头模式',exact:true}).click();await page.getByRole('option',{name:'多级表头（完整表头区域）',exact:true}).click();
  await selectRange(page,'A11','O31');
  await expect(page.locator('.quality-selection-error')).toContainText('第 1 步（选择属性表头）');
  await expect(page.locator('.quality-selection-error')).toContainText('A11:O31');
  await expect(page.locator('.quality-selection-error')).toContainText('先仅框选表头并确认属性，再选择值区域');
  await selectRange(page,'B9','O9');
  let dialog=page.getByRole('dialog',{name:'确认对象属性'});await expect(dialog.getByText('字符串',{exact:true})).toHaveCount(6);
  await dialog.getByRole('textbox',{name:'对象 Key 名称',exact:true}).fill('检验明细');
  await dialog.getByRole('button',{name:'确认并选择值区域',exact:true}).click();
  const guide=page.getByRole('note',{name:'对象值区域要求'});await expect(guide).toContainText('已确认表头：B9:O10');await expect(guide).toContainText('B～O 列');
  await selectRange(page,'A11','O32');const error=page.locator('.quality-selection-error');
  await expect(error).toContainText('已确认表头 B9:O10，当前值区域 A11:O32');await expect(error).toContainText('返回重选属性');
  await selectRange(page,'B11','O32');await expect(error).toContainText('B32:J32');await expect(error).toContainText('B9:G10');await expect(error).toContainText('备注或合计行');
  await page.screenshot({path:'output/ui-preview/quality-range-guide.png',fullPage:true});
  await page.getByRole('button',{name:'返回重选属性',exact:true}).click();
  await selectRange(page,'A9','O9');dialog=page.getByRole('dialog',{name:'确认对象属性'});await expect(dialog.getByText('字符串',{exact:true})).toHaveCount(7);
  await dialog.getByRole('button',{name:'确认并选择值区域',exact:true}).click();await expect(guide).toContainText('A9:O10');await expect(guide).toContainText('A～O 列');
  await selectRange(page,'A11','O31');dialog=page.getByRole('dialog',{name:'对象数据预览'});await expect(dialog).toContainText('当前 21 条记录');await expect(dialog.getByRole('cell',{name:'项目21',exact:true})).toBeVisible();await expect(dialog.getByRole('cell',{name:'备注与合计',exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:'完成对象配置',exact:true}).click();await page.getByRole('button',{name:'启用模板',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'模板已启用'})).toBeVisible();
});

test('choice preview shows actual split parts and clearing unchecked markers stays empty after saving and reopening',async({page})=>{
  await page.goto('/#quality');await page.getByLabel('上传模板 Excel').setInputFiles('tests/fixtures/quality-choice-symbols.xlsx');
  await page.getByLabel('模板名称',{exact:true}).fill('空未选标记与拆分预览');
  await page.locator('[data-address=A1]').click({button:'right'});await page.getByRole('menuitem',{name:/添加为 Key（右）/}).click();
  const editor=page.getByRole('complementary',{name:'字段独立编辑'});
  await editor.getByRole('combobox').first().click();await page.getByRole('option',{name:'单选',exact:true}).click();
  await expect(editor.getByRole('textbox',{name:'未选中标记',exact:true})).toHaveValue('');
  await editor.getByRole('textbox',{name:'勾选字符',exact:true}).fill('★');await editor.getByRole('textbox',{name:'允许选项（每行一个）',exact:true}).fill('CNY\nUSD\nEUR');
  await editor.getByRole('tab',{name:'解析预览',exact:true}).click();await showPreviewDetails(editor);
  const split=editor.getByRole('region',{name:'选项拆分结果'});
  await expect(split.locator('.quality-choice-part')).toHaveCount(1);await expect(split.locator('dd').nth(1)).toHaveText('CNY ☆USD ☆EUR');await expect(split.getByText('未匹配允许选项',{exact:true})).toHaveCount(1);
  await expect(editor.locator('.quality-preview-result pre')).toHaveText('null');
  await editor.getByRole('tab',{name:'字段设置',exact:true}).click();await editor.getByRole('textbox',{name:'未选中标记',exact:true}).fill('☆');await editor.getByRole('tab',{name:'解析预览',exact:true}).click();await showPreviewDetails(editor);
  await expect(split.locator('.quality-choice-part')).toHaveCount(3);await expect(split.getByText('已选中',{exact:true})).toHaveCount(1);await expect(split.getByText('未选中',{exact:true})).toHaveCount(2);await expect(editor.locator('.quality-preview-result pre')).toHaveText('"CNY"');
  await page.locator('.quality-editor').screenshot({path:'output/ui-preview/quality-choice-split.png'});
  await editor.getByRole('tab',{name:'字段设置',exact:true}).click();await editor.getByRole('textbox',{name:'未选中标记',exact:true}).fill('');
  await editor.getByRole('combobox',{name:'选项拆分方式',exact:true}).click();await page.getByRole('option',{name:'按指定分隔符拆分',exact:true}).click();await editor.getByRole('textbox',{name:'选项分隔符',exact:true}).fill(' ');
  await editor.getByRole('tab',{name:'解析预览',exact:true}).click();await showPreviewDetails(editor);await expect(split.locator('.quality-choice-part')).toHaveCount(3);await expect(split.getByText('未识别标记',{exact:true})).toHaveCount(2);await expect(split.getByText('未选中',{exact:true})).toHaveCount(0);await expect(editor.locator('.quality-preview-result pre')).toHaveText('"CNY"');
  await editor.getByRole('button',{name:'完成配置',exact:true}).click();await page.getByRole('button',{name:'启用模板',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'模板已启用'})).toBeVisible();
  const listed=await(await page.request.get('/api/quality/templates?q=空未选标记与拆分预览')).json();const detail=await(await page.request.get(`/api/quality/templates/${listed.templates[0].id}`)).json();expect(detail.definition.fields[0].uncheckChars).toBe('');
  const preview=await(await page.request.post(`/api/quality/templates/${detail.id}/preview`,{data:{}})).json();expect(preview.value.币种).toBe('CNY');expect(preview.issues).toEqual([]);
  await page.getByRole('button',{name:'查看完整解析预览',exact:true}).click();await expect(page.getByRole('dialog').getByRole('region',{name:'选项拆分结果'}).getByText('未识别标记',{exact:true})).toHaveCount(2);
  await page.reload();await page.getByRole('row').filter({hasText:'空未选标记与拆分预览'}).getByRole('button',{name:'编辑',exact:true}).click();await page.locator('.quality-field').click();await expect(editor.getByRole('textbox',{name:'未选中标记',exact:true})).toHaveValue('');
});

test('object single and multiple choice properties expose split results for each record in their preview',async({page})=>{
  await page.goto('/#quality');await page.getByLabel('上传模板 Excel').setInputFiles('tests/fixtures/quality-choice-object.xlsx');
  await page.locator('[data-address=A1]').click({button:'right'});await page.getByRole('menuitem',{name:'添加为对象 Key',exact:true}).click();await selectRange(page,'A3','B3');await page.getByRole('dialog').getByRole('button',{name:'确认并选择值区域',exact:true}).click();await selectRange(page,'A4','B5');await page.getByRole('dialog').getByRole('button',{name:'完成对象配置',exact:true}).click();await page.locator('.quality-field').click();
  const editor=page.getByRole('complementary',{name:'字段独立编辑'});
  for(const [i,type,checked,unchecked,options] of [[0,'单选','★','☆','合格\n不合格'],[1,'多选','☑','☐','到场安装\n三年质保\n上门培训']]){
    const property=await editProperty(editor,i);await property.getByRole('combobox').first().click();await page.getByRole('option',{name:type,exact:true}).click();await expect(property.getByRole('textbox',{name:'未选中标记',exact:true})).toHaveValue('');await property.getByRole('textbox',{name:'勾选字符',exact:true}).fill(checked);await property.getByRole('textbox',{name:'未选中标记',exact:true}).fill(unchecked);await property.getByRole('textbox',{name:'允许选项（每行一个）',exact:true}).fill(options);await editor.getByRole('button',{name:'返回属性列表',exact:true}).click();
  }
  await editor.getByRole('tab',{name:'解析预览',exact:true}).click();await showPreviewDetails(editor);
  const first=editor.locator('tbody tr').first();
  const radio=first.locator('td').nth(0);await radio.locator('.quality-choice-details summary').click();await expect(radio.getByRole('region',{name:'选项拆分结果'}).locator('.quality-choice-part')).toHaveCount(2);await expect(radio.getByText('已选中',{exact:true})).toHaveCount(1);
  const multi=first.locator('td').nth(1);await multi.locator('.quality-choice-details summary').click();await expect(multi.getByRole('region',{name:'选项拆分结果'}).locator('.quality-choice-part')).toHaveCount(3);await expect(multi.getByText('已选中',{exact:true})).toHaveCount(2);await expect(multi.getByText('未选中',{exact:true})).toHaveCount(1);
  await editor.getByRole('button',{name:'完成配置',exact:true}).click();
});

test('cell text lines and ignored content update choice splits and persist after reopening',async({page})=>{
  await page.goto('/#quality');await page.getByLabel('上传模板 Excel').setInputFiles('tests/fixtures/quality-text-lines.xlsx');
  await page.getByLabel('模板名称',{exact:true}).fill('双语文字过滤');
  await page.locator('[data-address=A1]').click({button:'right'});await page.getByRole('menuitem',{name:/添加为 Key（右）/}).click();
  const editor=page.getByRole('complementary',{name:'字段独立编辑'});
  await showTextRules(editor);await expect(editor.getByRole('combobox',{name:'解析行',exact:true})).toHaveValue('所有行');
  await editor.getByRole('combobox',{name:'解析行',exact:true}).click();
  await expect(page.getByRole('option',{name:'第 2 行',exact:true})).toBeVisible();await expect(page.getByRole('option',{name:'第 3 行',exact:true})).toHaveCount(0);
  await page.getByRole('option',{name:'第 1 行',exact:true}).click();await showTextRules(editor);await editor.getByRole('textbox',{name:'忽略内容',exact:true}).fill('结果：');
  await editor.getByRole('combobox').first().click();await page.getByRole('option',{name:'单选',exact:true}).click();
  await editor.getByRole('textbox',{name:'勾选字符',exact:true}).fill('★');await editor.getByRole('textbox',{name:'未选中标记',exact:true}).fill('☆');await editor.getByRole('textbox',{name:'允许选项（每行一个）',exact:true}).fill('合格\n不合格');
  await editor.getByRole('tab',{name:'解析预览',exact:true}).click();await showPreviewDetails(editor);
  await expect(editor.locator('.quality-processed-text pre')).toHaveText('★合格 ☆不合格');await expect(editor.getByRole('region',{name:'选项拆分结果'}).locator('.quality-choice-part')).toHaveCount(2);await expect(editor.locator('.quality-preview-result pre')).toHaveText('"合格"');
  await editor.getByRole('button',{name:'完成配置',exact:true}).click();await page.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'草稿已保存'})).toBeVisible();
  await page.reload();await page.getByRole('row').filter({hasText:'双语文字过滤'}).getByRole('button',{name:'编辑',exact:true}).click();await page.locator('.quality-field').click();
  await showTextRules(editor);await expect(editor.getByRole('combobox',{name:'解析行',exact:true})).toHaveValue('第 1 行');await expect(editor.getByRole('textbox',{name:'忽略内容',exact:true})).toHaveValue('结果：');
  await editor.getByRole('tab',{name:'解析预览',exact:true}).click();await showPreviewDetails(editor);await page.locator('.quality-editor').screenshot({path:'output/ui-preview/quality-text-processing.png'});
  await editor.getByRole('button',{name:'完成配置',exact:true}).click();
});

test('object property text line settings process bilingual cells and retain numeric zero',async({page})=>{
  await page.goto('/#quality');await page.getByLabel('上传模板 Excel').setInputFiles('tests/fixtures/quality-text-lines.xlsx');
  await page.locator('[data-address=A1]').click({button:'right'});await page.getByRole('menuitem',{name:'添加为对象 Key',exact:true}).click();await selectRange(page,'A3','B3');await page.getByRole('dialog').getByRole('button',{name:'确认并选择值区域',exact:true}).click();await selectRange(page,'A4','B5');await page.getByRole('dialog').getByRole('button',{name:'完成对象配置',exact:true}).click();await page.locator('.quality-field').click();
  const editor=page.getByRole('complementary',{name:'字段独立编辑'});
  for(const [i,ignoreContent] of [[0,'名称：'],[1,'数量：\n台']]){
    const property=await editProperty(editor,i);
    await showTextRules(property);await expect(property.getByRole('combobox',{name:'解析行',exact:true})).toHaveValue('所有行');await property.getByRole('combobox',{name:'解析行',exact:true}).click();await page.getByRole('option',{name:'第 1 行',exact:true}).click();await property.getByRole('textbox',{name:'忽略内容',exact:true}).fill(ignoreContent);
    if(i===1){await property.getByRole('combobox').first().click();await page.getByRole('option',{name:'数字',exact:true}).click();}await editor.getByRole('button',{name:'返回属性列表',exact:true}).click();
  }
  await editor.getByRole('tab',{name:'解析预览',exact:true}).click();await showPreviewDetails(editor);await expect(editor.locator('.form-error')).toHaveCount(0);
  const first=editor.locator('tbody tr').first();await expect(first.locator('td').first()).toContainText('机架');await first.locator('td').nth(1).getByText('查看内容处理',{exact:true}).click();await expect(first.locator('td').nth(1).locator('.quality-processed-text pre').last()).toHaveText('12');
  await expect(editor.locator('tbody tr').nth(1).locator('td').nth(1)).toContainText('0');await editor.getByRole('button',{name:'完成配置',exact:true}).click();
});

test('string and number regex replacement previews, persists and matches saved acceptance results',async({page})=>{
  const excel=new ExcelJS.Workbook(),sheet=excel.addWorksheet('正则');
  sheet.addRows([['字符串','编号：AB-001'],['数字','数量：12.50 kg']]);
  const buffer=Buffer.from(await excel.xlsx.writeBuffer()),file={name:'正则.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer};
  await page.goto('/#quality');await page.getByLabel('上传模板 Excel').setInputFiles(file);
  await page.getByLabel('模板名称',{exact:true}).fill('正则替换端到端');
  const editor=page.getByRole('complementary',{name:'字段独立编辑'});
  for(const [address,type,pattern,replacement,expected] of [['A1','字符串','^编号：([A-Z]+)-(\\d+)$','$1/$2','"AB/001"'],['A2','数字','^数量：([0-9.]+) kg$','$1','12.5']]){
    await page.locator(`[data-address=${address}]`).click({button:'right'});await page.getByRole('menuitem',{name:/添加为 Key（右）/}).click();
    await editor.getByRole('combobox').first().click();await page.getByRole('option',{name:type,exact:true}).click();
    await showTextRules(editor);await editor.getByRole('textbox',{name:'正则表达式',exact:true}).fill('[');
    await editor.getByRole('button',{name:'完成配置',exact:true}).click();await expect(editor.getByRole('alert')).toContainText('正则表达式无效');
    await editor.getByRole('textbox',{name:'正则表达式',exact:true}).fill(pattern);
    await editor.getByRole('textbox',{name:'正则替换内容',exact:true}).fill(replacement);
    await editor.getByRole('tab',{name:'解析预览',exact:true}).click();await showPreviewDetails(editor);await expect(editor.locator('.quality-preview-result pre')).toHaveText(expected);
    await editor.getByRole('button',{name:'完成配置',exact:true}).click();
  }
  await page.getByRole('button',{name:'启用模板',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'模板已启用'})).toBeVisible();
  await page.reload();await page.getByRole('row').filter({hasText:'正则替换端到端'}).getByRole('button',{name:'编辑',exact:true}).click();
  await page.locator('.quality-field').filter({hasText:'数字'}).click();
  await showTextRules(editor);await expect(editor.getByRole('textbox',{name:'正则表达式',exact:true})).toHaveValue('^数量：([0-9.]+) kg$');await expect(editor.getByRole('textbox',{name:'正则替换内容',exact:true})).toHaveValue('$1');
  await editor.getByRole('button',{name:'完成配置',exact:true}).click();await page.getByRole('button',{name:'返回模板列表',exact:true}).click();
  await page.getByRole('button',{name:'验收单',exact:true}).click();await page.getByRole('button',{name:'导入验收单',exact:true}).click();
  await page.getByRole('combobox',{name:'验收模板',exact:true}).click();await page.getByRole('option',{name:'正则替换端到端 · v1',exact:true}).click();
  await page.getByLabel('上传验收单 Excel').setInputFiles(file);await page.getByRole('checkbox',{name:'绑定物料 正则',exact:true}).uncheck();
  await page.getByRole('button',{name:'查看解析结果',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'工作表解析结果',exact:true});await expect(modal.getByText('"AB/001"',{exact:true})).toBeVisible();await expect(modal.getByText('12.5',{exact:true})).toBeVisible();await modal.getByRole('button',{name:'关闭弹窗',exact:true}).click();
  const response=page.waitForResponse(r=>r.url().endsWith('/api/quality/acceptances')&&r.request().method()==='POST');await page.getByRole('button',{name:'确认保存验收单',exact:true}).click();
  const saved=await(await response).json();expect(saved.result.value.正则).toEqual({字符串:'AB/001',数字:12.5});
});
