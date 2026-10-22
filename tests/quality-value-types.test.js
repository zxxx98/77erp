import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { convertQualityValue, previewDefinition, validateDefinition } from '../shared/quality-template.js';
import { booleanRules, formatQualityDate, qualityDateFormats, qualityDateTimeFormats } from '../shared/quality-value-types.js';
import { readQualityWorkbook } from '../shared/quality-workbook.js';
import { createOnlineWorkbook, onlineBooleanOptions } from '../shared/quality-online.js';
import { parseAcceptance } from '../shared/quality-acceptance.js';

const dateSamples=[
  ['YYYY-MM-DD','2024-02-09'],['YYYY-M-D','2024-2-9'],['YYYY/MM/DD','2024/02/09'],['YYYY/M/D','2024/2/9'],
  ['YYYY.MM.DD','2024.02.09'],['YYYY.M.D','2024.2.9'],['YYYY年MM月DD日','2024年02月09日'],['YYYY年M月D日','2024年2月9日'],
  ['YYYYMMDD','20240209'],['DD/MM/YYYY','09/02/2024'],['D/M/YYYY','9/2/2024'],
  ['MM/DD/YYYY','02/09/2024'],['M/D/YYYY','2/9/2024'],['DD-MM-YYYY','09-02-2024'],['MM-DD-YYYY','02-09-2024'],
];
test('explicit date and datetime formats cover common report dates without guessing day/month order',()=>{
  assert.deepEqual(dateSamples.map(([format])=>format),qualityDateFormats);
  const checked=new Set();
  for(const [dateFormat,raw] of dateSamples){
    assert.equal(convertQualityValue(raw,{type:'date',dateFormat}),'2024-02-09');
    assert.equal(formatQualityDate('2024-02-09',dateFormat),raw);
    for(const time of ['HH:mm','HH:mm:ss']){
      const format=`${dateFormat} ${time}`,text=`${raw} ${time==='HH:mm'?'13:04':'13:04:05'}`;
      assert.equal(convertQualityValue(text,{type:'datetime',dateFormat:format}),`2024-02-09T13:04:${time==='HH:mm'?'00':'05'}`);checked.add(format);
    }
  }
  for(const [format,text,result] of [['YYYY-MM-DDTHH:mm','2024-02-09T13:04','2024-02-09T13:04:00'],['YYYY-MM-DDTHH:mm:ss','2024-02-09T13:04:05','2024-02-09T13:04:05']]){
    assert.equal(convertQualityValue(text,{type:'datetime',dateFormat:format}),result);checked.add(format);
  }
  assert.deepEqual([...checked].sort(),[...qualityDateTimeFormats].sort());
  assert.equal(convertQualityValue('03/04/2026',{type:'date',dateFormat:'DD/MM/YYYY'}),'2026-04-03');
  assert.equal(convertQualityValue('03/04/2026',{type:'date',dateFormat:'MM/DD/YYYY'}),'2026-03-04');
  assert.equal(convertQualityValue('2024-02-29',{type:'date'}),'2024-02-29');
  for(const raw of ['2026-02-29','2024-02-30','2026-13-01','2026-00-01','2026-01-00','2026-1-2','26-01-02','2026-01-02备注'])assert.throws(()=>convertQualityValue(raw,{type:'date'}),/日期格式/);
  for(const raw of ['2026-02-29 12:00:00','2026-02-28 24:00:00','2026-02-28 12:60:00','2026-02-28 12:00:60','2026-02-28 12:00:00Z','2026-02-28'])assert.throws(()=>convertQualityValue(raw,{type:'datetime'}),/日期时间格式/);
});

test('percent mode distinguishes native Excel ratios from plain numbers and keeps cached precision',()=>{
  const config={type:'number',numberMode:'percent'};
  for(const [raw,expected] of [['95%',95],['95',95],['0.95',0.95],['0%',0],['-2.5％',-2.5],['1,234.5 %',1234.5]])assert.equal(convertQualityValue(raw,config),expected);
  assert.equal(convertQualityValue('95%',config,{value:0.954321,format:'0%'}),95.4321);
  assert.equal(convertQualityValue('0.00%',config,{value:0,format:'0.00%'}),0);
  assert.equal(convertQualityValue('95%',config,{value:95,format:'0"%"'}),95);
  assert.equal(convertQualityValue('95%',config,{value:95,format:'0\\%'}),95);
  assert.throws(()=>convertQualityValue('1',config,{value:Infinity,format:'0%'}),/超出/);
  for(const raw of ['95%%','95%合格','约95%','95 96','1e3%'])assert.throws(()=>convertQualityValue(raw,config),/百分比格式/);
  assert.equal(convertQualityValue('95%',{type:'number',unit:'%'}),95,'ordinary mode retains existing unit parsing');
});

test('boolean maps are explicit, case insensitive and distinguish false from missing',()=>{
  for(const raw of ['是','true','TRUE','True','1','YES'])assert.equal(convertQualityValue(raw,{type:'boolean'}),true);
  for(const raw of ['否','false','FALSE','False','0','NO'])assert.equal(convertQualityValue(raw,{type:'boolean'}),false);
  assert.equal(convertQualityValue('',{type:'boolean'}),null);
  assert.throws(()=>convertQualityValue('合格',{type:'boolean'}),/未匹配/);
  const config={type:'boolean',trueValues:'启用\n√',falseValues:'停用\n×'};
  assert.equal(convertQualityValue('√',config),true);assert.equal(convertQualityValue('×',config),false);
  assert.equal(convertQualityValue('false',config,{value:false}),false,'native booleans do not require text aliases');
  assert.deepEqual(onlineBooleanOptions(config),[{label:'启用',value:true},{label:'停用',value:false}]);
  for(const changes of [{trueValues:'是\n是'},{trueValues:'true\nTRUE'},{trueValues:'是',falseValues:'是'},{trueValues:''},{falseValues:1}])assert.throws(()=>booleanRules({...config,...changes}),/重复|重叠|配置|字符/);
});

async function fixture({date1904=false}={}){
  const book=new ExcelJS.Workbook();book.properties.date1904=date1904;const sheet=book.addWorksheet('类型');
  for(const [address,value] of Object.entries({A1:'合格率',B1:0.954321,A2:'日期',B2:'09/02/2024',A3:'时刻',B3:new Date('2024-02-09T13:04:05Z'),A4:'有效',B4:false,A5:'文本时刻',B5:'2024.2.9 13:04',A6:'缓存时刻'}))sheet.getCell(address).value=value;
  sheet.getCell('B1').numFmt='0%';sheet.getCell('B3').numFmt='yyyy/mm/dd hh:mm:ss';
  sheet.getCell('B6').value={formula:'DATE(2023,3,15)+TIME(12,0,0)',result:date1904?43538.5:45000.5};sheet.getCell('B6').numFmt='yyyy-mm-dd hh:mm:ss';
  const source=Buffer.from(await book.xlsx.writeBuffer()),workbook=await readQualityWorkbook(source);
  const definition=validateDefinition({sheetName:'类型',fields:[
    {id:'percent',name:'合格率',type:'number',numberMode:'percent',labelRegion:'A1',valueRegion:'B1',required:true},
    {id:'date',name:'日期',type:'date',dateFormat:'DD/MM/YYYY',labelRegion:'A2',valueRegion:'B2'},
    {id:'time',name:'时刻',type:'datetime',labelRegion:'A3',valueRegion:'B3',required:true},
    {id:'enabled',name:'有效',type:'boolean',trueValues:'启用',falseValues:'停用',labelRegion:'A4',valueRegion:'B4',required:true},
    {id:'texttime',name:'文本时刻',type:'datetime',dateFormat:'YYYY.M.D HH:mm',labelRegion:'A5',valueRegion:'B5'},
    {id:'cached',name:'缓存时刻',type:'datetime',labelRegion:'A6',valueRegion:'B6'},
  ]},workbook,{publish:true});
  return {source,workbook,definition};
}

test('native date time caches preserve time in both Excel date systems and snapshots remain stable',async()=>{
  for(const date1904 of [false,true]){
    const {workbook,definition}=await fixture({date1904});
    const parsed=previewDefinition(definition,workbook);assert.deepEqual(parsed.issues,[]);
    assert.deepEqual(parsed.value,{合格率:95.4321,日期:'2024-02-09',时刻:'2024-02-09T13:04:05',有效:false,文本时刻:'2024-02-09T13:04:00',缓存时刻:'2023-03-15T12:00:00'});
    assert.deepEqual(validateDefinition(definition,workbook,{publish:true}),definition);
    assert.equal(workbook.sheets[0].cells.B3.datetime,'2024-02-09T13:04:05');
    const dateOnly=structuredClone(definition);dateOnly.fields[2].type='date';dateOnly.fields[2].dateFormat='YYYY-MM-DD';assert.equal(previewDefinition(dateOnly,workbook).value.时刻,'2024-02-09');
    const corrected=parseAcceptance(definition,workbook,workbook,{corrections:[{sheetName:'类型',address:'B3',text:'2024-02-10 09:00:00'},{sheetName:'类型',address:'B4',text:'停用'}]});
    assert.deepEqual(corrected.issues,[]);assert.equal(corrected.value.时刻,'2024-02-10T09:00:00');assert.equal(corrected.value.有效,false);
    for(const change of [{numberMode:'auto'},{type:'datetime',dateFormat:'auto'},{type:'date',dateFormat:'MM/YY'},{type:'boolean',trueValues:'yes',falseValues:'YES'}]){
      const bad=structuredClone(definition);Object.assign(bad.fields[0],change);assert.throws(()=>validateDefinition(bad,workbook),/模式|格式|重叠/);
    }
    for(const type of ['datetime','boolean']){const bad=structuredClone(definition);Object.assign(bad.fields[0],{type,dateFormat:undefined,valueRegion:'B1:C1'});assert.throws(()=>validateDefinition(bad,workbook),/一个逻辑单元格/);}
  }
});

test('online values export proper Excel types and reimport without percentage scaling or timezone drift',async()=>{
  const {source,workbook,definition}=await fixture();const template={definition,workbook};
  const prefilled=await createOnlineWorkbook(source,template,{keepValues:true});
  assert.equal(prefilled.online.values.B1,'95.4321%');assert.equal(prefilled.online.values.B3,'2024-02-09 13:04:05');assert.equal(prefilled.online.values.B4,'停用');
  const kept=parseAcceptance(definition,workbook,await readQualityWorkbook(prefilled.buffer));assert.deepEqual(kept.issues,[]);assert.equal(kept.value.有效,false);assert.ok(Math.abs(kept.value.合格率-95.4321)<1e-10);
  const generated=await createOnlineWorkbook(source,template,{values:{B1:'99.125%',B2:'29/02/2024',B3:'2024-02-29 23:59:59',B4:'停用',B5:'2024.2.29 09:04',B6:'2024-02-29 12:00:00'}});
  const output=new ExcelJS.Workbook();await output.xlsx.load(generated.buffer);const sheet=output.worksheets[0];
  assert.equal(sheet.getCell('B1').value,0.99125);assert.match(sheet.getCell('B1').numFmt,/%/);assert.equal(sheet.getCell('B4').value,false);assert.ok(sheet.getCell('B3').value instanceof Date);
  const parsed=parseAcceptance(definition,workbook,await readQualityWorkbook(generated.buffer));assert.deepEqual(parsed.issues,[]);assert.equal(parsed.value.合格率,99.125);assert.equal(parsed.value.日期,'2024-02-29');assert.equal(parsed.value.时刻,'2024-02-29T23:59:59');assert.equal(parsed.value.有效,false);
  const missing=await createOnlineWorkbook(source,template,{values:{B1:'0%',B3:'2024-02-29 00:00:00',B4:''}});assert.ok(parseAcceptance(definition,workbook,await readQualityWorkbook(missing.buffer)).issues.some(issue=>issue.fieldId==='enabled'&&/必填/.test(issue.message)));
  for(const format of ['0"%"','0\\%']) {
    sheet.getCell('B1').numFmt=format;
    const literal=await createOnlineWorkbook(new Uint8Array(await output.xlsx.writeBuffer()),template,{values:{B1:'95%'}});
    assert.equal(parseAcceptance(definition,workbook,await readQualityWorkbook(literal.buffer)).value.合格率,95,'literal percent formats must become true percentage formats on export');
  }
});
