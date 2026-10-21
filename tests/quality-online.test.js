import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { createOnlineWorkbook, onlineInputCells, onlineCellConfig, onlineChoiceText, onlineChoiceOptions } from '../shared/quality-online.js';
import { readQualityWorkbook } from '../shared/quality-workbook.js';
import { validateDefinition, previewChoice } from '../shared/quality-template.js';
import { parseAcceptance } from '../shared/quality-acceptance.js';

const source=await readFile(new URL('./fixtures/quality-template.xlsx',import.meta.url));
const workbook=await readQualityWorkbook(source);
const definition=validateDefinition({sheetName:'Sheet1',fields:[
  {id:'code',name:'单号',type:'uniqueKey',labelRegion:'A8',valueRegion:'B8:F8',required:true},
  {id:'budget',name:'预算',type:'number',labelRegion:'A5',valueRegion:'B5',required:true},
  {id:'items',name:'采购明细',labelRegion:'A16:F16',type:'object',propertyRegion:'A17:F17',valueRegion:'A18:F20',
    properties:['名称','规格','数量','单价（元）','小计（元）','备注'].map((name,i)=>({id:`p${i}`,name,type:i===2?'number':'string',required:i===2}))},
]},workbook,{publish:true});
const template={definition,workbook};

test('online blanks sample inputs, preserves labels, merges and layout, and applies normal required validation',async()=>{
  const before=Buffer.from(source), original=new ExcelJS.Workbook();await original.xlsx.load(source);
  const generated=await createOnlineWorkbook(source,template);
  const parsedBook=await readQualityWorkbook(generated.buffer);
  const parsed=parseAcceptance(definition,workbook,parsedBook);
  assert.ok(parsed.issues.some(issue=>issue.region==='B8:F8'&&/必填/.test(issue.message)));
  assert.ok(parsed.issues.some(issue=>issue.region==='B5'&&/必填/.test(issue.message)));
  assert.deepEqual(parsed.value.采购明细,[]);
  const output=new ExcelJS.Workbook();await output.xlsx.load(generated.buffer);
  const sheet=output.getWorksheet('Sheet1'), originalSheet=original.getWorksheet('Sheet1');
  for(const address of ['A1','A5','A8','A16','A17'])assert.equal(sheet.getCell(address).text,originalSheet.getCell(address).text);
  assert.deepEqual([...sheet.model.merges].sort(),[...originalSheet.model.merges].sort());
  assert.deepEqual(sheet.getCell('A1').font,originalSheet.getCell('A1').font);
  assert.equal(sheet.getColumn(1).width,originalSheet.getColumn(1).width);
  assert.deepEqual(source,before);
  const prefilled=await createOnlineWorkbook(source,template,{keepValues:true});
  assert.equal(prefilled.online.values.C18,'8');
});

test('filled Excel parses real values, keeps leading zeros and literal formulas, and retains styles',async()=>{
  const values={B8:'0000128',B5:'1,234.50',A18:'新物料',C18:'12',F18:'=1+1'};
  const generated=await createOnlineWorkbook(source,template,{values});
  const parsed=parseAcceptance(definition,workbook,await readQualityWorkbook(generated.buffer));
  assert.deepEqual(parsed.issues,[]);
  assert.equal(parsed.value.单号,'0000128');assert.equal(parsed.value.预算,1234.5);
  assert.equal(parsed.value.采购明细[0].数量,12);assert.equal(parsed.value.采购明细[0].备注,'=1+1');
  const output=new ExcelJS.Workbook();await output.xlsx.load(generated.buffer);
  assert.equal(output.getWorksheet('Sheet1').getCell('F18').type,ExcelJS.ValueType.String);
  assert.equal(output.getWorksheet('Sheet1').getCell('B8').value,'0000128');
  assert.equal(output.getWorksheet('Sheet1').getCell('C18').value,12);
  const invalid=await createOnlineWorkbook(source,template,{values:{...values,C18:'十二台'}});
  assert.ok(parseAcceptance(definition,workbook,await readQualityWorkbook(invalid.buffer)).issues.some(issue=>issue.region==='C18'&&/数字/.test(issue.message)));
});

test('online rejects writes outside input cells and templates overlapping protected headers',async()=>{
  for(const values of [{A1:'改标题'},{C8:'合并格内部'},{B5:1},{B5:'a'.repeat(10001)},{B5:'\u0000'}])
    await assert.rejects(createOnlineWorkbook(source,template,{values}),/无效|过长/);
  assert.throws(()=>onlineInputCells({...definition,fields:[{...definition.fields[0],valueRegion:'A8:F8'}]},workbook),/重叠/);
});

test('vertical merged object records and per-item rules use the same addresses as the parser',async()=>{
  const bytes=await readFile(new URL('./fixtures/quality-template-vertical.xlsx',import.meta.url));
  const wb=await readQualityWorkbook(bytes);
  const def=validateDefinition({sheetName:'竖向明细',fields:[{id:'items',name:'明细',type:'object',labelRegion:'A1',propertyRegion:'A3:A5',valueRegion:'B3:D5',
    properties:['名称','规格','数量'].map((name,i)=>({id:`p${i}`,name,type:'string'}))}]},wb,{publish:true});
  const generated=await createOnlineWorkbook(bytes,{definition:def,workbook:wb},{values:{B3:'第一件',B5:'5',D3:'第二件',D5:'7'}});
  const parsed=parseAcceptance(def,wb,await readQualityWorkbook(generated.buffer));
  assert.deepEqual(parsed.issues,[]);assert.equal(parsed.value.明细.length,2);
  assert.equal(parsed.value.明细[1].名称,'第二件');
  const inputs=[{fieldId:'i',record:0,address:'A1',config:{id:'name',type:'string'}},{fieldId:'i',record:0,address:'B1',config:{id:'value',type:'string',itemRules:[{matchPropertyId:'name',equals:'尺寸',config:{type:'number'}}]}}];
  assert.equal(onlineCellConfig(inputs[1],inputs,{A1:'尺寸'}).type,'number');
  assert.equal(onlineCellConfig(inputs[1],inputs,{A1:'外观'}).type,'string');
});

test('choice controls serialize configured before/after markers and separators into valid Excel text',()=>{
  for(const config of [
    {type:'multi',options:'□合格\n□不合格',checkChar:'☑',uncheckChars:'□',choiceMode:'markers'},
    {type:'single',options:'合格□\n不合格□',checkChar:'✓',uncheckChars:'□',choiceMode:'markers',markerPosition:'after'},
    {type:'multi',options:'合格\n不合格',checkChar:'☑',choiceMode:'separator',separator:' / '},
  ]){
    assert.deepEqual(onlineChoiceOptions(config),['合格','不合格']);
    const selected=config.type==='single'?['合格']:['合格','不合格'];
    const parsed=previewChoice(onlineChoiceText(selected,config),config);
    assert.equal(parsed.error,undefined);assert.deepEqual(parsed.value,config.type==='single'?'合格':selected);
  }
});

test('shared formula masters can be filled without retaining stale formula caches elsewhere',async()=>{
  const book=new ExcelJS.Workbook();await book.xlsx.load(source);
  const sheet=book.getWorksheet('Sheet1');
  sheet.getCell('B5').value={formula:'1+1',result:2,shareType:'shared',ref:'B5:B6'};
  sheet.getCell('B6').value={sharedFormula:'B5',result:2};
  const bytes=await book.xlsx.writeBuffer();
  const generated=await createOnlineWorkbook(bytes,template,{values:{B5:'12',B8:'0001'}});
  const output=new ExcelJS.Workbook();await output.xlsx.load(generated.buffer);
  assert.equal(output.getWorksheet('Sheet1').getCell('B5').value,12);
  assert.equal(output.getWorksheet('Sheet1').getCell('B6').formula,'1+1');
  assert.equal(output.getWorksheet('Sheet1').getCell('B6').result,undefined);
});
