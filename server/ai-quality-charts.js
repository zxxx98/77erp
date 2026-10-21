import { aggregateQualityChart, chartFields, chartTypeLabels, metricLabels, refKey, validateChart } from '../shared/quality-charts.js';
import { acceptanceSheetResults } from '../shared/quality-bindings.js';
import { createQualityChart, normalizeQualityChart, qualityChartEntries, qualityChartRevision } from './quality-charts.js';

const fail=message=>{throw new Error(message);};
const validId=id=>Number.isSafeInteger(id)&&id>0;
const dimensions=['string','uniqueKey','single','date','number'];
const text=value=>String(value).slice(0,160);
export function aiChartTemplates(db,warehouseId,query='') {
  if(typeof query!=='string'||query.length>100)fail('模板查询条件最多100字。');
  const rows=db.prepare(`SELECT t.id AS template_id,r.id AS revision_id,r.name,r.revision,t.enabled,
    (SELECT COUNT(*) FROM quality_acceptances a WHERE a.template_id=t.id AND a.warehouse_id=t.warehouse_id) AS acceptance_count
    FROM quality_templates t JOIN quality_template_revisions r ON r.id=t.published_revision
    WHERE t.warehouse_id=? AND instr(r.name,?)>0 ORDER BY t.id DESC LIMIT 51`).all(warehouseId,query);
  return {templates:rows.slice(0,50),has_more:rows.length>50,chart_types:chartTypeLabels,aggregations:metricLabels};
}
function context(db,warehouseId,revisionId) {
  if(!validId(revisionId))fail('请选择有效的模板发布版本。');
  const revision=qualityChartRevision(db,warehouseId,revisionId);
  return {revision,definition:JSON.parse(revision.definition),entries:qualityChartEntries(db,warehouseId,revision.template_id)};
}
export function aiChartData(db,warehouseId,revisionId) {
  const {revision,definition,entries}=context(db,warehouseId,revisionId);
  const scopes=[{id:null,name:'每个工作表一条记录'},...definition.fields.filter(f=>f.type==='object').map(f=>({id:f.id,name:f.name}))];
  const recommendations=[];
  const profiles=scopes.map(scope=>{
    const fields=chartFields(definition,scope.id).filter(f=>dimensions.includes(f.type)).map(field=>({...field,nonempty:0,missing:0,distinct:new Set(),samples:[]}));
    let records=0;
    for(const entry of entries){
      const available=chartFields(entry.definition,scope.id);
      for(const sheet of acceptanceSheetResults(entry.definition,entry.result)){
        const rows=scope.id?sheet.results.find(f=>f.id===scope.id)?.rows||[]:[null];
        for(const row of rows){
          records++;
          for(const field of fields){
            const compatible=available.some(f=>refKey(f.ref)===refKey(field.ref)&&f.type===field.type&&f.unit===field.unit);
            const value=!compatible?null:field.ref.propertyId?row?.cells.find(c=>c.id===field.ref.propertyId)?.value:sheet.results.find(f=>f.id===field.ref.fieldId)?.value;
            if(value===null||value===undefined||value===''){field.missing++;continue;}
            field.nonempty++;field.distinct.add(JSON.stringify(value));
            if(field.samples.length<5&&!field.samples.includes(text(value)))field.samples.push(text(value));
          }
        }
      }
    }
    const date=fields.find(f=>f.type==='date'&&f.nonempty),category=fields.find(f=>['string','single','uniqueKey'].includes(f.type)&&f.nonempty);
    const numbers=fields.filter(f=>f.type==='number'&&f.nonempty);
    const add=(name,reason,x,metric,chartType)=>{
      if(recommendations.length>=8)return;
      const config=validateChart({schemaVersion:1,kind:'ordinary',chartType,objectId:scope.id,x:x.ref,dateField:date?.ref||null,bucket:'day',groupBy:null,metric},definition);
      try{
        const data=aggregateQualityChart(config,definition,entries);
        if(data.rows.length)recommendations.push({name:name.slice(0,60),reason,config,stats:data.stats,preview:data.rows.slice(0,5)});
      }catch{/* A field with excessive groups can still be inspected in the profile. */}
    };
    if(date)for(const field of numbers.slice(0,2))add(`${field.name}趋势`,'日期字段与数字字段均有已保存数据，按日期查看平均值。',date,{aggregation:'avg',value:field.ref},'line');
    const distribution=category||numbers[0]||date;
    if(distribution){
      add(`${distribution.name}记录分布`,'按横轴字段统计记录数；对象来源按明细记录计数。',distribution,{aggregation:'count'},'bar');
      for(const field of numbers.filter(f=>refKey(f.ref)!==refKey(distribution.ref)).slice(0,2))add(`${distribution.name}与${field.name}`,'按分类比较数字字段平均值，不推算合格率。',distribution,{aggregation:'avg',value:field.ref},'bar');
    }
    if(distribution)add(`${scope.name}统计明细`,'以明细表呈现分组记录数，可核对各项统计。',distribution,{aggregation:'count'},'table');
    return {...scope,records,fields:fields.map(({distinct,...field})=>({...field,distinct_count:distinct.size}))};
  });
  return {template:{template_id:revision.template_id,revision_id:revision.id,name:revision.name,revision:revision.revision},acceptance_count:entries.length,bound_material_sheets:entries.reduce((n,e)=>n+(e.bindings||[]).filter(b=>b.product_id).length,0),
    chart_types:chartTypeLabels,aggregations:metricLabels,scopes:profiles,recommendations,
    note:entries.length?'仅依据已保存验收数据；不同版本字段不兼容时不纳入对应统计。物料图表只读取已绑定到当前物料的数据。':'当前没有已保存的验收数据，不能宣称已有趋势；可先配置图表，导入验收单后再查看。'};
}
export function aiChartPreview(db,warehouseId,args) {
  const {revision,definition,entries}=context(db,warehouseId,args.revision_id);
  const chart=normalizeQualityChart(db,warehouseId,{...args,template_id:revision.template_id});
  let product=null;
  if(args.product_id!==undefined){
    if(!validId(args.product_id))fail('预览物料编号无效。');
    product=db.prepare('SELECT id,name,barcode FROM products WHERE id=? AND warehouse_id=?').get(args.product_id,warehouseId);
    if(!product)fail('预览物料不存在或不属于当前仓库。');
  }
  const fields=chartFields(definition,chart.config.objectId),label=ref=>ref?.system==='material'?'物料':fields.find(f=>refKey(f.ref)===refKey(ref))?.name||'无';
  const needsProduct=chart.config.kind==='material'&&!product;
  const data=needsProduct?null:aggregateQualityChart(chart.config,definition,entries,{productId:product?.id});
  return {payload:{warehouse_id:warehouseId,quality_chart:chart,...(product?{product_id:product.id}:{})},display:{
    warehouse_name:db.prepare('SELECT name FROM warehouses WHERE id=?').get(warehouseId).name,
    name:chart.name,template_name:revision.name,revision:revision.revision,config:chart.config,
    x_label:label(chart.config.x),group_label:label(chart.config.groupBy),date_label:label(chart.config.dateField),metric_label:label(chart.config.metric.value),
    object_label:chart.config.objectId?definition.fields.find(f=>f.id===chart.config.objectId).name:'每个工作表一条记录',
    product,x_type:data?.xType,rows:data?.rows.slice(0,20)||[],stats:data?.stats||null,unit:data?.unit||'',total_groups:data?.rows.length||0,
    warning:needsProduct?'物料图表按当前物料取数，未指定预览物料；保存后可在物料详情查看。':!data.rows.length?'当前没有可用于此配置的已保存数据。':'',
  }};
}
export function aiChartState(db,payload) {
  const chart=payload.quality_chart;
  return {warehouse:db.prepare('SELECT * FROM warehouses WHERE id=?').get(payload.warehouse_id),
    template:db.prepare('SELECT id,warehouse_id,version FROM quality_templates WHERE id=? AND warehouse_id=?').get(chart.templateId,payload.warehouse_id),
    revision:qualityChartRevision(db,payload.warehouse_id,chart.revisionId),
    entries:qualityChartEntries(db,payload.warehouse_id,chart.templateId),
    product:payload.product_id?db.prepare('SELECT id,warehouse_id,name,barcode FROM products WHERE id=?').get(payload.product_id):null};
}
export function aiCreateChart(db,req,payload) {
  if(payload.warehouse_id!==req.warehouse.id)fail('请切回生成图表预览时的仓库后确认。');
  return createQualityChart(db,payload.warehouse_id,payload.quality_chart,req.user.name||req.user.username);
}
