import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateQualityChart, chartCompatible, chartFields, validateChart, validateChartFilters } from '../shared/quality-charts.js';

const definition={sheetName:'Sheet1',fields:[
  {id:'date',name:'日期',type:'date'}, {id:'rate',name:'合格率',type:'number',unit:'%'},
  {id:'category',name:'分类',type:'single'}, {id:'key',name:'物料',type:'uniqueKey'},
  {id:'items',name:'明细',type:'object',properties:[{id:'name',name:'名称',type:'string'},{id:'qty',name:'数量',type:'number'}]},
]};
const config=extra=>validateChart({schemaVersion:1,kind:'ordinary',chartType:'line',objectId:null,x:{fieldId:'date'},dateField:{fieldId:'date'},bucket:'day',groupBy:null,metric:{aggregation:'avg',value:{fieldId:'rate'}},...extra},definition);
function entry(id,values,{productId=1,productName='物料A',candidate=definition,rows=null,sheetName='批次'}={}) {
  const results=Object.entries(values).map(([id,value])=>({id,value}));
  if(rows)results.push({id:'items',rows:rows.map((value,index)=>({row:index+18,cells:Object.entries(value).map(([id,value])=>({id,value}))}))});
  return {id,number:`QA-${id}`,name:'验收',definition:candidate,bindings:productId?[{sheetName,product_id:productId,product:{id:productId,name:productName,barcode:`M${productId}`}}]:[],result:{sheets:[{sheetName,results,issues:[]}]}};
}
test('chart validation supports categorical, numeric, date and unique keys, but only numeric metrics',()=>{
  for(const field of ['category','key','rate','date'])assert.equal(config({x:{fieldId:field}}).x.fieldId,field);
  for(const aggregation of ['sum','avg','min','max','count'])assert.equal(config({metric:{aggregation,value:{fieldId:'rate'}}}).metric.aggregation,aggregation);
  for(const aggregation of ['ratio','passRate'])assert.throws(()=>config({metric:{aggregation}}),/统计方式/);
  assert.throws(()=>config({metric:{aggregation:'sum',value:{fieldId:'category'}}}),/数据类型/);
  assert.throws(()=>config({objectId:'missing'}),/对象/);
  assert.throws(()=>config({kind:'material',groupBy:{system:'material'}}),/无需/);
  assert.throws(()=>config({x:{fieldId:'items',propertyId:'name'}}),/横轴/);
  assert.equal(config({dateField:null}).dateField,null);
  assert.equal(chartFields(definition,'items').length,6);
});
test('date filters validate strict calendar dates and material preview requires a material only for saved data',()=>{
  assert.throws(()=>validateChartFilters({from:'2026-02-30'},config()),/起止日期/);
  assert.throws(()=>validateChartFilters({from:'2026-11-01',to:'2026-10-01'},config()),/起止日期/);
  assert.throws(()=>validateChartFilters({from:'2026-01-01'},config({dateField:null})),/未配置/);
  assert.throws(()=>validateChartFilters({product_id:'1.2'},config()),/物料/);
  assert.throws(()=>validateChartFilters({},config({kind:'material'})),/请选择/);
  assert.equal(validateChartFilters({},config({kind:'material'}),{sample:true}).productId,null);
});
test('numeric percentage fields are used directly without ratio calculation or percent scaling',()=>{
  const entries=[entry(1,{date:'2026-10-20',rate:95}),entry(2,{date:'2026-10-20',rate:99}),entry(3,{date:'2026-10-21',rate:0})];
  const result=aggregateQualityChart(config(),definition,entries);
  assert.equal(result.unit,'%');assert.deepEqual(result.rows.map(row=>row.value),[97,0]);assert.deepEqual(result.rows.map(row=>row.count),[2,1]);
  for(const [aggregation,expected] of [['sum',194],['min',95],['max',99],['count',2]])assert.equal(aggregateQualityChart(config({metric:{aggregation,value:{fieldId:'rate'}}}),definition,entries).rows[0].value,expected);
});
test('date bucketing sorts by time with Monday weeks and inclusive range filtering',()=>{
  const entries=[entry(1,{date:'2026-10-20',rate:99}),entry(2,{date:'2026-10-18',rate:95}),entry(3,{date:'2026-11-01',rate:90})];
  assert.deepEqual(aggregateQualityChart(config({bucket:'week'}),definition,entries).rows.map(row=>row.x),['2026-10-12','2026-10-19','2026-10-26']);
  assert.deepEqual(aggregateQualityChart(config({bucket:'month'}),definition,entries).rows.map(row=>[row.x,row.value]),[['2026-10',97],['2026-11',90]]);
  const result=aggregateQualityChart(config(),definition,entries,{from:'2026-10-20',to:'2026-10-20'});assert.equal(result.rows.length,1);assert.equal(result.stats.excluded,2);
});
test('object rows and vertical columns can mix Sheet scalars, group values and preserve source positions',()=>{
  const chart=config({objectId:'items',x:{fieldId:'items',propertyId:'name'},metric:{aggregation:'sum',value:{fieldId:'items',propertyId:'qty'}}});
  const a=entry(1,{date:'2026-10-20',rate:95},{rows:[{name:'A',qty:3},{name:'A',qty:5},{name:'B',qty:null}]});
  const b=entry(2,{date:'2026-10-21',rate:99},{rows:[{name:'B',qty:10}]});b.result.sheets[0].results.at(-1).rows[0]={...b.result.sheets[0].results.at(-1).rows[0],row:undefined,column:3};
  assert.deepEqual(aggregateQualityChart(chart,definition,[a,b]).rows.map(row=>[row.x,row.value]),[['A',8],['B',10]]);
  const trace=aggregateQualityChart(chart,definition,[a,b],{},{x:'B',series:'统计值',offset:0});assert.equal(trace.sources[0].column,3);assert.equal(trace.sources[0].sheetName,'批次');assert.equal(trace.sources[0].acceptanceId,2);
  const repeated=aggregateQualityChart(config({objectId:'items',metric:{aggregation:'sum',value:{fieldId:'rate'}}}),definition,[a]);assert.equal(repeated.rows[0].value,285,'Sheet scalar repeats once for every object row');
});
test('material rules filter each Sheet and use stable material IDs across renamed snapshots',()=>{
  const entries=[entry(1,{date:'2026-10-20',rate:95}),entry(2,{date:'2026-10-20',rate:99},{productName:'改名后'}),entry(3,{date:'2026-10-20',rate:20},{productId:2}),entry(4,{date:'2026-10-20',rate:30},{productId:null})];
  const grouped=aggregateQualityChart(config({groupBy:{system:'material'}}),definition,entries);assert.equal(grouped.rows.length,3);assert.equal(grouped.rows.find(row=>row.series==='material:1').value,97);
  const scoped=aggregateQualityChart(config({kind:'material'}),definition,entries,{productId:1});assert.equal(scoped.rows[0].value,97);assert.equal(scoped.stats.sheets,2);
  assert.equal(aggregateQualityChart(config({kind:'material'}),definition,entries,{productId:3}).rows.length,0);
  assert.equal(aggregateQualityChart(config(),definition,entries,{acceptanceId:2}).rows[0].value,99);
});
test('revision compatibility uses stable field IDs, exact types and units, with incompatible Sheets reported',()=>{
  const renamed=structuredClone(definition);renamed.fields[1].name='新合格率';assert.equal(chartCompatible(config(),definition,renamed),true);
  const changed=structuredClone(definition);changed.fields[1].unit='';assert.equal(chartCompatible(config(),definition,changed),false);
  changed.fields[1].unit='%';changed.fields[1].type='string';assert.equal(chartCompatible(config(),definition,changed),false);
  const result=aggregateQualityChart(config(),definition,[entry(1,{date:'2026-10-20',rate:99},{candidate:changed})]);assert.equal(result.stats.incompatibleSheets,1);assert.deepEqual(result.rows,[]);
});
test('empty fields are excluded while zeros and negative numbers participate; numeric axes sort numerically',()=>{
  const values=[10,2,0,-1,null];const entries=values.map((rate,i)=>entry(i+1,{rate,date:'2026-10-20'}));
  const result=aggregateQualityChart(config({x:{fieldId:'rate'}}),definition,entries);assert.deepEqual(result.rows.map(row=>row.x),[-1,0,2,10]);assert.equal(result.stats.excluded,1);
});
test('source results are paginated and aggregation refuses excessive groups explicitly',()=>{
  const entries=Array.from({length:70},(_,i)=>entry(i+1,{date:'2026-10-20',rate:95}));
  const trace=aggregateQualityChart(config(),definition,entries,{},{x:'2026-10-20',series:'统计值',offset:50});assert.equal(trace.total,70);assert.equal(trace.sources.length,20);
  assert.throws(()=>aggregateQualityChart(config({x:{fieldId:'rate'}}),definition,Array.from({length:1001},(_,i)=>entry(i+1,{rate:i}))),/1000/);
});
test('multiple Sheets of one Excel independently contribute and bind under the same template',()=>{
  const a=entry(1,{date:'2026-10-20',rate:95},{sheetName:'第一批'}),b=entry(1,{date:'2026-10-21',rate:80},{sheetName:'第二批',productId:2});
  a.result.sheets.push(...b.result.sheets);a.bindings.push(...b.bindings);
  const result=aggregateQualityChart(config(),definition,[a]);assert.equal(result.stats.sheets,2);assert.deepEqual(result.rows.map(row=>row.value),[95,80]);
  const scoped=aggregateQualityChart(config({kind:'material'}),definition,[a],{productId:2});assert.equal(scoped.stats.sheets,1);assert.equal(scoped.rows[0].value,80);
  const trace=aggregateQualityChart(config(),definition,[a],{},{x:'2026-10-21',series:'统计值',offset:0});assert.equal(trace.sources[0].sheetName,'第二批');
});

test('mixed item-rule properties are excluded from chart dimensions and incompatible with old scalar references',()=>{
  const candidate=structuredClone(definition);
  candidate.fields.find(f=>f.id==='items').properties[0].itemRules=[{matchPropertyId:'qty',equals:'1',config:{type:'number'}}];
  assert.ok(!chartFields(candidate,'items').some(f=>f.ref.propertyId==='name'));
  const chart=config({objectId:'items',x:{fieldId:'items',propertyId:'name'},metric:{aggregation:'count'}});
  assert.equal(chartCompatible(chart,definition,candidate),false);
});
