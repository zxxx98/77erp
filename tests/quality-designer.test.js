import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { blankDesigner, changeDesigner, designerRegion, designerDefinition, inspectionDesigner, readDesignerWorkbook, writeDesignerWorkbook } from '../shared/quality-designer.js';
import { readQualityWorkbook } from '../shared/quality-workbook.js';
import { validateDefinition } from '../shared/quality-template.js';
import { createOnlineWorkbook } from '../shared/quality-online.js';
import { parseAcceptance } from '../shared/quality-acceptance.js';

test('a blank template becomes a styled, merged Excel workbook with literal text and addressable blank regions',async()=>{
  const commands=[
    {type:'text',region:'A1',text:'检验记录'},
    {type:'merge',region:'A1:D1'},
    {type:'format',region:'A1:D1',patch:{font:{size:22,bold:true,name:'宋体'},alignment:{horizontal:'center',vertical:'middle',wrapText:true}}},
    {type:'format',region:'A1:D1',patch:{fill:{type:'pattern',pattern:'solid',fgColor:{argb:'FFFFEEDD'}}}},
    {type:'border',region:'A1:D1',mode:'outer'},
    {type:'rowHeight',region:'A1',value:56},
    {type:'columnWidth',region:'B1',value:160},
    {type:'text',region:'B3',text:'0000128'},
    {type:'text',region:'C3',text:'=1+1'},
    {type:'resize',rows:30,cols:12},
  ].map(command=>({sheetName:'检验模板',...command}));
  const source=blankDesigner(),model=commands.reduce(changeDesigner,source);
  assert.deepEqual(source,blankDesigner());assert.deepEqual(designerRegion(model.sheets[0],'B1'),{r1:1,r2:1,c1:1,c2:4});
  const bytes=await writeDesignerWorkbook(null,commands),book=new ExcelJS.Workbook();await book.xlsx.load(bytes);
  const sheet=book.getWorksheet('检验模板');
  assert.equal(sheet.getCell('A1').font.size,22);assert.equal(sheet.getCell('A1').font.bold,true);
  assert.equal(sheet.getCell('A1').alignment.horizontal,'center');assert.equal(sheet.getCell('A1').fill.fgColor.argb,'FFFFEEDD');
  assert.equal(sheet.getCell('A1').border.right.style,'thin');assert.equal(sheet.getCell('D1').master.address,'A1');
  assert.equal(sheet.getRow(1).height,42);assert.equal(sheet.getColumn(2).width,160/7);
  assert.equal(sheet.getCell('B3').value,'0000128');assert.equal(sheet.getCell('C3').type,ExcelJS.ValueType.String);
  const reloaded=await readDesignerWorkbook(bytes);assert.equal(reloaded.sheets[0].rows,30);assert.equal(reloaded.sheets[0].cols,12);
  const parsed=await readQualityWorkbook(bytes);assert.ok(parsed.sheets[0].rows>=30&&parsed.sheets[0].cols>=12);
  const smaller=await writeDesignerWorkbook(bytes,[{sheetName:'检验模板',type:'resize',rows:5,cols:4}]);
  const resized=await readDesignerWorkbook(smaller);assert.equal(resized.sheets[0].rows,5);assert.equal(resized.sheets[0].cols,4);
});

test('range validation prevents destructive merges, truncation and invalid sizes',()=>{
  const command=operation=>({sheetName:'检验模板',...operation});
  let model=changeDesigner(blankDesigner(),command({type:'text',region:'B1',text:'不能丢失'}));
  assert.throws(()=>changeDesigner(model,command({type:'merge',region:'A1:B1'})),/其他内容/);
  assert.throws(()=>changeDesigner(model,command({type:'resize',rows:1,cols:1})),/移除内容/);
  model=changeDesigner(model,command({type:'clear',region:'B1'}));
  model=changeDesigner(model,command({type:'merge',region:'A1:B2'}));
  assert.throws(()=>changeDesigner(model,command({type:'resize',rows:1,cols:1})),/合并单元格/);
  model=changeDesigner(model,command({type:'unmerge',region:'B2'}));
  assert.deepEqual(model.sheets[0].merges,[]);
  for(const operation of [{type:'resize',rows:2000,cols:100},{type:'format',region:'A1',patch:{font:{size:0}}},{type:'text',region:'A1',text:'x'.repeat(10001)},{type:'rowHeight',region:'A1',value:0},{type:'rename',name:'无效/名称'}])
    assert.throws(()=>changeDesigner(model,command(operation)));
});

test('the inspection starter publishes and accepts an online report without desktop Excel',async()=>{
  const starter=inspectionDesigner(),bytes=await writeDesignerWorkbook(null,starter.commands);
  const workbook=await readQualityWorkbook(bytes),definition=validateDefinition(starter.definition,workbook,{publish:true});
  const filled=await createOnlineWorkbook(bytes,{definition,workbook},{values:{B3:'0001',F3:'2026-10-21',B4:'连接件',F4:'100',A8:'外观',B8:'无划伤',D8:'合格',B13:'合格',F13:'李明'}});
  const parsed=parseAcceptance(definition,workbook,await readQualityWorkbook(filled.buffer));
  assert.deepEqual(parsed.issues,[]);assert.equal(parsed.value.检验单号,'0001');assert.equal(parsed.value.批次数量,100);
  assert.equal(parsed.value.检验明细[0].检验项目,'外观');
});

test('editing a source retains other sheets, comments and formulas and remaps renamed rule sheets',async()=>{
  const original=new ExcelJS.Workbook(),sheet=original.addWorksheet('检验模板');
  sheet.getCell('A1').value='标题';sheet.getCell('A1').note='需要保留的批注';sheet.getCell('D1').value={formula:'1+1',result:2,shareType:'shared',ref:'D1:D2'};
  sheet.getCell('D2').value={sharedFormula:'D1',result:2};original.addWorksheet('说明页').getCell('A1').value='操作说明';
  sheet.getCell('C5').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFEAF0F8'}};
  const source=await original.xlsx.writeBuffer(),before=Buffer.from(source);
  const loaded=await readDesignerWorkbook(source);assert.equal(loaded.sheets[0].cells.C5.format.fill.fgColor.argb,'FFEAF0F8');
  assert.throws(()=>changeDesigner(loaded,{sheetName:'检验模板',type:'merge',region:'C1:D1'}),/其他内容/);
  const rename={sheetName:'检验模板',type:'rename',name:'新模板'};
  assert.throws(()=>changeDesigner(loaded,rename),/含公式/);
  const commands=[{sheetName:'检验模板',type:'text',region:'D1',text:'手填值'},{sheetName:'检验模板',type:'format',region:'C5',patch:{font:{size:16}}}];
  const bytes=await writeDesignerWorkbook(source,commands),book=new ExcelJS.Workbook();await book.xlsx.load(bytes);
  assert.deepEqual(Buffer.from(source),before);assert.equal(book.getWorksheet('说明页').getCell('A1').value,'操作说明');
  assert.equal(book.getWorksheet('检验模板').getCell('A1').note,'需要保留的批注');assert.equal(book.getWorksheet('检验模板').getCell('D2').formula,'1+1');
  assert.equal(book.getWorksheet('检验模板').getCell('D2').result,undefined);
  assert.equal(book.getWorksheet('检验模板').getCell('C5').fill.fgColor.argb,'FFEAF0F8');
  const renamed=await readDesignerWorkbook(await writeDesignerWorkbook(null,[rename]));assert.equal(renamed.sheets[0].name,'新模板');
  assert.deepEqual(designerDefinition({sheetName:'检验模板',fields:[]},[rename]),{sheetName:'新模板',fields:[]});
});
