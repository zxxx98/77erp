import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readQualityWorkbook} from '../server/quality-workbook.js';
import {parseAcceptance} from '../shared/quality-acceptance.js';
import {validateDefinition,previewDefinition} from '../shared/quality-template.js';
import {parseMeasurements,validateChecks,needsQualityReview} from '../shared/quality-checks.js';
const workbook=await readQualityWorkbook(await readFile('tests/fixtures/quality-hangjia-shipping.xlsx'));
const definition=JSON.parse(await readFile('docs/examples/hangjia-shipping-checks.json','utf8'));
const parse=(changes={},def=definition)=>{
  const wb=structuredClone(workbook);for(const [address,value] of Object.entries(changes))wb.sheets[0].cells[address]={value,text:String(value)};
  return parseAcceptance(def,workbook,wb);
};
const find=(parsed,id)=>parsed.checks.find(check=>check.id===id);
test('measurement lists split complete decimal values without dropping blanks, labels or oversized inputs',()=>{
  assert.deepEqual(parseMeasurements(' 2065 / 2061 / 2060 '),[2065,2061,2060]);
  assert.deepEqual(parseMeasurements('-1.2|+2|.5','|'),[-1.2,2,.5]);assert.equal(parseMeasurements('  '),null);
  for(const raw of ['1//3','1/','/1','1e3/2','1mm/2','实测值 8.71/8.69','NaN','Infinity',Array(101).fill('1').join('/'),'9007199254740992'])assert.throws(()=>parseMeasurements(raw),/测量值/);
});
test('real report has ten passed checks and a separate incomplete final-verdict review',()=>{
  assert.deepEqual(validateDefinition(definition,workbook,{publish:true}),definition);
  const parsed=parse();assert.deepEqual(parsed.issues,[]);assert.equal(parsed.value.最终判定,'合格');
  assert.equal(parsed.checks.filter(c=>c.status==='pass').length,10);assert.equal(find(parsed,'final_check').status,'review');
  assert.equal(needsQualityReview(parsed),true);
  assert.deepEqual(find(parsed,'tail').measurements.map(m=>[m.name,m.value]),[['L',36],['N',56],['E',75]]);
  assert.deepEqual(find(parsed,'length').measurements.map(m=>m.value),[2065,2061,2060]);
  assert.equal(parsed.results.find(r=>r.id==='items').rows.find(r=>r.row===23).cells.find(c=>c.id==='result').raw,'实测值 8.71/8.69');
});
test('inclusive asymmetric bounds, strict upper bound, component counts and changed requirements are distinguished',()=>{
  assert.equal(find(parse({H15:'2050/2090'}),'length').status,'pass');
  const exceeded=parse({H15:'2049/2091'});assert.equal(find(exceeded,'length').status,'fail');assert.equal(find(exceeded,'final_check').status,'fail');assert.equal(exceeded.value.最终判定,'合格');
  assert.equal(find(parse({H23:'实测值 8.88/8.87'}),'resistance').status,'fail');
  assert.equal(find(parse({H13:'36/56'}),'tail').status,'review');
  assert.equal(find(parse({H13:'36/75/56'}),'tail').status,'fail');
  const changed=parse({B15:'全长改为 1800MM'});assert.equal(find(changed,'length').status,'review');assert.match(find(changed,'length').message,/要求已变化/);
  const malformed=parse({H15:'2065//2060'});assert.match(malformed.issues[0].message,/测量值/);assert.equal(find(malformed,'length').status,'review');
});
test('sum checks never conflate missing, not applicable, fractional or negative defect counts',()=>{
  assert.equal(find(parse({M11:1}),'sum_MA').status,'fail');
  assert.equal(find(parse({M11:1,M32:1,N6:1}),'sum_MA').status,'pass');
  for(const value of [-1,.5,''])assert.equal(find(parse({M11:value,N6:''}),'sum_MA').status,'review');
  const def=structuredClone(definition);def.checks.find(c=>c.id==='sum_MA').emptyPolicy='review';
  assert.equal(find(parse({},def),'sum_MA').status,'review');
  assert.equal(find(parse({M16:'/'}),'sum_MA').status,'pass');
});
test('acceptance checks read explicit report limits and never derive an AQL plan',()=>{
  assert.equal(find(parse({N6:3}),'accept_MA').status,'pass');assert.equal(find(parse({N6:4}),'accept_MA').status,'fail');
  assert.equal(find(parse({N5:'3/5',N6:4}),'accept_MA').status,'review');
  for(const limits of ['4/3','3/3','3/四','3','3.5/4'])assert.equal(find(parse({N5:limits}),'accept_MA').status,'review');
  assert.equal(find(parse({M6:1}),'accept_CR').status,'fail');
});
test('final verdict checks compare observed and reported row results and retain incomplete rows as review',()=>{
  const p=parse({H11:'OK是□ NG否■',O11:'OK'});assert.equal(find(p,'final_check').status,'fail');assert.match(find(p,'final_check').message,/O11.*不一致/);
  const absent=parse();assert.equal(find(absent,'final_check').expected,null);
  const completed={};for(const row of [16,17,24,25,26,27,28]){completed[`H${row}`]='OK是■ NG否□';completed[`O${row}`]='OK';}
  assert.equal(find(parse(completed),'final_check').status,'pass');
  assert.equal(find(parse({...completed,I8:'合格□ 拒收■\nPhù hợp Từ chối'}),'final_check').status,'fail');
  assert.equal(find(parse({...completed,H11:'OK是□ NG否■',O11:'NG',I8:'合格□ 拒收■\nPhù hợp Từ chối'}),'final_check').status,'pass');
});
test('validation rejects broken references, empty bounds, overlapping verdict labels and cycles through duplicate decisions',()=>{
  for(const change of [
    d=>d.checks[0].source.fieldId='missing',d=>d.checks[0].source.propertyId='missing',d=>d.checks[0].source.match.propertyId='missing',
    d=>d.checks[0].bounds[0].min=100,d=>{d.checks[0].bounds[0].min=null;d.checks[0].bounds[0].max=null;},
    d=>{d.checks[0].bounds[0].min=40;d.checks[0].bounds[0].maxInclusive=false;},
    d=>d.checks.push({...d.checks.at(-1),id:'second'}),d=>d.checks.at(-1).failValues=['OK'],
    d=>d.checks[4].emptyPolicy='guess',d=>d.checks[0].requirement.expected='',
  ]){const d=structuredClone(definition);change(d);assert.throws(()=>validateDefinition(d,workbook,{publish:true}));}
  assert.deepEqual(validateChecks(undefined,definition.fields),[]);
});
test('checks run independently per data sheet and old templates keep identical result shape',()=>{
  const wb=structuredClone(workbook),second=structuredClone(wb.sheets[0]);second.name='二批';second.cells.H15={value:'2100',text:'2100'};wb.sheets.push(second);
  const parsed=parseAcceptance(definition,workbook,wb,{sheetNames:[wb.sheets[0].name,'二批']});assert.equal(find(parsed.sheets[0],'length').status,'pass');assert.equal(find(parsed.sheets[1],'length').status,'fail');assert.equal(needsQualityReview(parsed),true);
  const old=structuredClone(definition);delete old.checks;assert.equal(previewDefinition(old,workbook).checks,undefined);
});

test('unfinished editor check configurations show a review message rather than an unbounded pass',()=>{
  const def=structuredClone(definition);def.checks[0].bounds=[{name:'未完成',min:null,max:null}];
  const result=previewDefinition(def,workbook);assert.equal(result.checks.length,1);assert.equal(result.checks[0].status,'review');assert.match(result.checks[0].message,/公差上下限/);
});

test('manual source corrections recalculate system checks and preserve the reported verdict',()=>{
  const uploaded=structuredClone(workbook);uploaded.sheets[0].cells.H15={text:'2065//2060',value:'2065//2060'};
  const name=uploaded.sheets[0].name;
  const run=text=>parseAcceptance(definition,workbook,uploaded,{sheetNames:[name],corrections:[{sheetName:name,address:'H15',text}]}).sheets[0];
  const outOfRange=run('2100');assert.deepEqual(outOfRange.issues,[]);assert.equal(find(outOfRange,'length').status,'fail');
  const corrected=run('2065/2061/2060');assert.deepEqual(corrected.issues,[]);assert.equal(find(corrected,'length').status,'pass');
  assert.equal(corrected.value.最终判定,'合格');assert.equal(corrected.manualCorrections[0].original,'2065//2060');
  assert.equal(uploaded.sheets[0].cells.H15.text,'2065//2060');
});
