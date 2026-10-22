import { acceptanceSheetResults } from './quality-bindings.js';

const fail = message => { throw new Error(message); };
export const chartTypeLabels = { line: '折线图', bar: '柱状图', table: '明细表' };
export const metricLabels = { sum: '求和', avg: '平均值', min: '最小值', max: '最大值', count: '记录数' };
export const chartDimensionTypes = ['string','uniqueKey','single','date','datetime','boolean','number'];
export const chartDateTypes = ['date','datetime'];
export const refKey = ref => ref?.system ? `$${ref.system}` : ref ? JSON.stringify([ref.fieldId,ref.propertyId||null]) : '';
export function chartFields(definition, objectId = null) {
  return definition.fields.flatMap(field=>field.type==='object'
    ? field.id===objectId ? field.properties.filter(property=>!property.itemRules?.length).map(property=>({ref:{fieldId:field.id,propertyId:property.id},name:`${field.name} / ${property.name}`,type:property.type,unit:property.unit||''})) : []
    : [{ref:{fieldId:field.id},name:field.name,type:field.type,unit:field.unit||''}]);
}
export function validateChart(input, definition) {
  if(!input || input.schemaVersion!==1 || !['ordinary','material'].includes(input.kind) || !Object.hasOwn(chartTypeLabels,input.chartType))fail('请选择有效的图表分类和图表类型。');
  const objectId=input.objectId||null;
  if(objectId!==null&&!definition.fields.some(field=>field.id===objectId&&field.type==='object'))fail('图表的对象数据来源不存在。');
  const fields=chartFields(definition,objectId);
  const readRef=(ref,types,label)=>{
    const field=fields.find(field=>refKey(field.ref)===refKey(ref));
    if(!field||!types.includes(field.type))fail(`${label}字段不存在或数据类型不适用。`);
    return {...field.ref};
  };
  const x=readRef(input.x,chartDimensionTypes,'横轴');
  const xField=fields.find(field=>refKey(field.ref)===refKey(x));
  const dateField=input.dateField===null?null:input.dateField?readRef(input.dateField,chartDateTypes,'日期筛选'):chartDateTypes.includes(xField.type)?x:null;
  const bucket=input.bucket||'day';if(!['day','week','month'].includes(bucket))fail('日期汇总方式无效。');
  let groupBy=null;
  if(input.groupBy){
    if(input.groupBy.system==='material'){
      if(input.kind==='material')fail('物料图表已限定当前物料，无需再次按物料分组。');
      groupBy={system:'material'};
    }else groupBy=readRef(input.groupBy,chartDimensionTypes,'分组');
  }
  const source=input.metric;
  if(!source||!Object.hasOwn(metricLabels,source.aggregation))fail('统计方式无效。');
  let metric={aggregation:source.aggregation};
  if(['sum','avg','min','max'].includes(source.aggregation))metric.value=readRef(source.value,['number'],'统计值');
  return {schemaVersion:1,kind:input.kind,chartType:input.chartType,objectId,x,dateField,bucket,groupBy,metric};
}
export function chartReferences(config) {
  return [config.x,config.dateField,config.groupBy,config.metric.value].filter(ref=>ref&&!ref.system);
}
export function chartCompatible(config, definition, candidate) {
  if(config.objectId&&!candidate.fields.some(field=>field.id===config.objectId&&field.type==='object'))return false;
  const original=chartFields(definition,config.objectId),current=chartFields(candidate,config.objectId);
  return chartReferences(config).every(ref=>{
    const a=original.find(field=>refKey(field.ref)===refKey(ref)),b=current.find(field=>refKey(field.ref)===refKey(ref));
    return a&&b&&a.type===b.type&&a.unit===b.unit;
  });
}
export function validChartDate(value) {
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
}
function calendarDate(value, type) {
  if (type === 'datetime') {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return null;
    const date = new Date(`${value}Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,19) !== value) return null;
    value = value.slice(0,10);
  }
  return validChartDate(value) ? value : null;
}
export function validateChartFilters(input,config,{sample=false}={}) {
  const integer=(value,label)=>{
    if(value===undefined||value===null||value==='')return null;
    if(!/^[1-9]\d*$/.test(String(value))||!Number.isSafeInteger(Number(value)))fail(`${label}无效。`);
    return Number(value);
  };
  const productId=integer(input.product_id,'物料编号'),acceptanceId=integer(input.acceptance_id,'验收单编号');
  const from=input.from||'',to=input.to||'';
  if(from&&!validChartDate(from)||to&&!validChartDate(to)||from&&to&&from>to)fail('请选择有效的起止日期。');
  if((from||to)&&!config.dateField)fail('此图表未配置日期筛选字段。');
  if(config.kind==='material'&&!sample&&!productId)fail('请选择用于预览的物料。');
  return {productId,acceptanceId,from,to};
}
function dateBucket(value, bucket) {
  if(bucket==='month')return value.slice(0,7);
  if(bucket==='week'){
    const date=new Date(value);date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));return date.toISOString().slice(0,10);
  }
  return value;
}
const empty=value=>value===null||value===undefined||value==='';
const number=value=>typeof value==='number'&&Number.isFinite(value);

// Inputs are immutable acceptance snapshots; fields are addressed by IDs, never renamed labels.
export function aggregateQualityChart(config,definition,entries,filters={},trace=null) {
  const fields=chartFields(definition,config.objectId),axis=fields.find(field=>refKey(field.ref)===refKey(config.x));
  const groups=new Map(),stats={sheets:0,records:0,excluded:0,incompatibleSheets:0};
  for(const entry of entries){
    if(filters.acceptanceId&&entry.id!==filters.acceptanceId)continue;
    const compatible=chartCompatible(config,definition,entry.definition);
    for(const sheet of acceptanceSheetResults(entry.definition,entry.result)){
      const binding=entry.bindings?.find(binding=>binding.sheetName===sheet.sheetName);
      if(filters.productId&&binding?.product_id!==filters.productId)continue;
      if(config.kind==='material'&&!entry.sample&&!binding?.product_id)continue;
      if(!compatible){stats.incompatibleSheets++;continue;}
      stats.sheets++;
      const object=config.objectId?sheet.results.find(result=>result.id===config.objectId):null;
      const records=config.objectId?object?.rows||[]:[null];
      for(const record of records){
        const read=ref=>!ref?null:ref.propertyId?record?.cells.find(cell=>cell.id===ref.propertyId)?.value:sheet.results.find(result=>result.id===ref.fieldId)?.value;
        const date=calendarDate(read(config.dateField),fields.find(field=>refKey(field.ref)===refKey(config.dateField))?.type);
        if((filters.from||filters.to)&&(!validChartDate(date)||filters.from&&date<filters.from||filters.to&&date>filters.to)){stats.excluded++;continue;}
        let x=read(config.x);
        if(empty(x)||chartDateTypes.includes(axis.type)&&!calendarDate(x,axis.type)){stats.excluded++;continue;}
        if(chartDateTypes.includes(axis.type))x=dateBucket(calendarDate(x,axis.type),config.bucket);
        const grouped=config.groupBy?.system==='material'?(binding?.product_id?`material:${binding.product_id}`:'未绑定物料'):read(config.groupBy);
        const series=config.groupBy?String(empty(grouped)?'（空）':grouped):'统计值';
        const metric=config.metric,aggregation=metric.aggregation;
        const value=read(metric.value);
        if(aggregation!=='count'&&!number(value)){stats.excluded++;continue;}
        const key=JSON.stringify([x,series]);
        let group=groups.get(key);
        if(!group){group={x,series,seriesLabel:config.groupBy?.system==='material'&&binding?.product?`${binding.product.name} · ${binding.product.barcode}`:series,count:0,sum:0,min:Infinity,max:-Infinity,sources:[]};groups.set(key,group);}
        if(groups.size>1000||stats.records>=20000)fail('图表数据超过 1000 个分组或 20000 条记录，请缩小时间或验收单范围。');
        group.count++;stats.records++;
        if(number(value)){group.sum+=value;group.min=Math.min(group.min,value);group.max=Math.max(group.max,value);}
        group.sources.push({acceptanceId:entry.id,number:entry.number,name:entry.name,sheetName:sheet.sheetName,row:record?.row??null,column:record?.column??null,date:validChartDate(date)?date:null,
          product:binding?.product||null,value:aggregation==='count'?1:value});
      }
    }
  }
  const sorted=[...groups.values()].sort((a,b)=>typeof a.x==='number'&&typeof b.x==='number'?a.x-b.x:String(a.x).localeCompare(String(b.x),'zh-CN',{numeric:true}));
  if(trace){
    const sources=sorted.find(group=>String(group.x)===trace.x&&group.series===trace.series)?.sources||[];
    return {sources:sources.slice(trace.offset,trace.offset+50),total:sources.length};
  }
  const rows=sorted.map(group=>{
    const aggregation=config.metric.aggregation;
    let value=aggregation==='count'?group.count:aggregation==='avg'?group.sum/group.count:aggregation==='min'?group.min:aggregation==='max'?group.max:group.sum;
    if(value!==null&&!Number.isFinite(value))fail('统计结果超出数值范围，请缩小统计范围。');
    return {x:group.x,series:group.series,seriesLabel:group.seriesLabel,value,count:group.count};
  });
  return {rows,stats,xType:axis.type==='datetime'?'date':axis.type,unit:fields.find(field=>refKey(field.ref)===refKey(config.metric.value))?.unit||''};
}
