import { aggregateQualityChart, validateChart, validateChartFilters } from '../shared/quality-charts.js';
import { previewDefinition } from '../shared/quality-template.js';
import { operationRequest, saveOperationRequest } from './operations.js';

const error=(message,status=400)=>Object.assign(new Error(message),{status});
// Voided operation inspections remain auditable, but no longer contribute to charts.
export const activeQualityAcceptance = (alias='a') => `(NOT EXISTS (SELECT 1 FROM production_operation_reports p WHERE p.acceptance_id=${alias}.id) OR EXISTS (SELECT 1 FROM production_operation_reports p WHERE p.acceptance_id=${alias}.id AND p.status='active'))`;
export function migrateQualityCharts(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS quality_charts (
    id INTEGER PRIMARY KEY, warehouse_id INTEGER NOT NULL REFERENCES warehouses(id), template_id INTEGER NOT NULL REFERENCES quality_templates(id),
    revision_id INTEGER NOT NULL REFERENCES quality_template_revisions(id), name TEXT NOT NULL, config TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1, created_by_name TEXT NOT NULL, updated_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS quality_charts_warehouse ON quality_charts(warehouse_id,template_id);`);
}
export function validateQualityChartsBackup(data) {
  const templates=new Map(data.quality_templates.map(row=>[row.id,row])),revisions=new Map(data.quality_template_revisions.map(row=>[row.id,row]));
  for(const row of data.quality_charts){
    const template=templates.get(row.template_id),revision=revisions.get(row.revision_id);
    if(!template||!revision||revision.template_id!==template.id||template.warehouse_id!==row.warehouse_id||typeof row.name!=='string'||!row.name.trim()||row.name.length>60||
      typeof row.config!=='string'||row.config.length>20000||![0,1].includes(row.enabled)||!Number.isSafeInteger(row.version)||row.version<1||
      ['created_by_name','updated_by_name','created_at','updated_at'].some(key=>typeof row[key]!=='string'||row[key].length>100))throw error('备份品质图表无效。');
    const config=JSON.parse(row.config),normalized=validateChart(config,JSON.parse(revision.definition));
    if(JSON.stringify(config)!==JSON.stringify(normalized))throw error('备份品质图表配置无效。');
  }
}
export function qualityChartRevision(db,warehouseId,id) {
  const row=db.prepare(`SELECT r.*,t.warehouse_id FROM quality_template_revisions r JOIN quality_templates t ON t.id=r.template_id WHERE r.id=? AND t.warehouse_id=?`).get(Number(id),warehouseId);
  if(!row)throw error('模板发布版本不存在或不属于当前仓库。',404);
  return row;
}
export function qualityChartEntries(db,warehouseId,templateId,filters={}) {
  const clauses=['a.warehouse_id=?','a.template_id=?',activeQualityAcceptance()],args=[warehouseId,templateId];
  if(filters.acceptanceId){clauses.push('a.id=?');args.push(filters.acceptanceId);}
  if(filters.productId){clauses.push("EXISTS (SELECT 1 FROM json_each(a.bindings) b WHERE json_extract(b.value,'$.product_id')=?)");args.push(filters.productId);}
  const rows=db.prepare(`SELECT a.id,a.number,a.name,a.result,a.bindings,r.definition FROM quality_acceptances a JOIN quality_template_revisions r ON r.id=a.revision_id WHERE ${clauses.join(' AND ')} ORDER BY a.id LIMIT 2001`).all(...args);
  if(rows.length>2000)throw error('验收单超过 2000 张，请先选择单张验收单缩小统计范围。');
  return rows.map(row=>({...row,result:JSON.parse(row.result),bindings:JSON.parse(row.bindings),definition:JSON.parse(row.definition)}));
}
export function normalizeQualityChart(db,warehouseId,input) {
  const name=typeof input.name==='string'?input.name.trim():'';
  if(!name||name.length>60)throw error('请输入 1–60 字的图表名称。');
  const base=qualityChartRevision(db,warehouseId,input.revision_id);
  if(Number(input.template_id)!==base.template_id)throw error('模板与发布版本不匹配。');
  return {name,templateId:base.template_id,revisionId:base.id,config:validateChart(input.config,JSON.parse(base.definition))};
}
export function createQualityChart(db,warehouseId,chart,owner) {
  // Revalidate through the same path used by the editor before every insertion.
  chart=normalizeQualityChart(db,warehouseId,{name:chart.name,template_id:chart.templateId,revision_id:chart.revisionId,config:chart.config});
  const now=new Date().toISOString();
  const id=Number(db.prepare('INSERT INTO quality_charts(warehouse_id,template_id,revision_id,name,config,created_by_name,updated_by_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(warehouseId,chart.templateId,chart.revisionId,chart.name,JSON.stringify(chart.config),owner,owner,now,now).lastInsertRowid);
  return {id,name:chart.name};
}
export function installQualityCharts(router,db,{run,transaction,owner}) {
  const revision=(req,id)=>qualityChartRevision(db,req.warehouse.id,id);
  const get=req=>{
    const row=db.prepare('SELECT * FROM quality_charts WHERE id=? AND warehouse_id=?').get(Number(req.params.id),req.warehouse.id);
    if(!row)throw error('图表不存在或不属于当前仓库。',404);return row;
  };
  const source=revision=>({template_id:revision.template_id,revision_id:revision.id,name:revision.name,revision:revision.revision,definition:JSON.parse(revision.definition)});
  const detail=(req,row)=>({...row,config:JSON.parse(row.config),source:source(revision(req,row.revision_id))});
  const version=(req,row)=>{if(req.body.version!==row.version)throw error('图表已被修改，请保留配置并重新打开。',409);};
  const product=(req,id)=>{
    if(!id)return null;
    const row=db.prepare('SELECT id,name,barcode,specification,unit FROM products WHERE id=? AND warehouse_id=?').get(id,req.warehouse.id);
    if(!row)throw error('物料不存在或不属于当前仓库。',404);return row;
  };
  const entries=(req,templateId,filters)=>qualityChartEntries(db,req.warehouse.id,templateId,filters);
  const query=(req,row,input,trace=null)=>{
    const base=revision(req,row.revision_id),definition=JSON.parse(base.definition),config=validateChart(JSON.parse(row.config),definition);
    const sample=input.sample===true;
    const filters=validateChartFilters(input,config,{sample}),selectedProduct=product(req,filters.productId);
    let data;
    if(sample){
      const workbook=JSON.parse(db.prepare('SELECT workbook FROM quality_template_files WHERE id=?').get(base.file_id).workbook);
      const result=previewDefinition(definition,workbook);
      data=[{sample:true,id:null,name:'模板样表',number:'样表',definition,result,bindings:selectedProduct?[{sheetName:definition.sheetName,product_id:selectedProduct.id,product:selectedProduct}]:[]}];
    }else data=entries(req,base.template_id,filters);
    return {...aggregateQualityChart(config,definition,data,filters,trace),sample,product:selectedProduct};
  };
  const normalized=req=>normalizeQualityChart(db,req.warehouse.id,req.body);
  router.get('/chart-sources',run(req=>({sources:db.prepare(`SELECT t.id AS template_id,r.id AS revision_id,r.name,r.revision FROM quality_templates t
    JOIN quality_template_revisions r ON r.id=t.published_revision WHERE t.warehouse_id=? ORDER BY t.updated_at DESC,t.id DESC`).all(req.warehouse.id)})));
  router.get('/chart-sources/:revision',run(req=>source(revision(req,req.params.revision))));
  router.get('/chart-acceptances',run(req=>{
    const templateId=Number(req.query.template_id),q=String(req.query.q||'').trim().slice(0,100);
    const rows=db.prepare(`SELECT id,name,number FROM quality_acceptances a WHERE ${activeQualityAcceptance()} AND warehouse_id=? AND template_id=? AND (instr(name,?)>0 OR instr(number,?)>0) ORDER BY id DESC LIMIT 101`).all(req.warehouse.id,templateId,q,q);
    return {acceptances:rows.slice(0,100),has_more:rows.length>100};
  }));
  router.get('/charts',run(req=>{
    const q=String(req.query.q||'').slice(0,100),kind=req.query.kind||'all',offset=Number(req.query.offset||0);
    if(!['all','ordinary','material'].includes(kind)||!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw error('图表筛选条件无效。');
    const where=`c.warehouse_id=? AND instr(c.name,?)>0${kind==='all'?'':" AND json_extract(c.config,'$.kind')=?"}`,args=[req.warehouse.id,q,...(kind==='all'?[]:[kind])];
    return {charts:db.prepare(`SELECT c.*,r.name AS template_name,r.revision FROM quality_charts c JOIN quality_template_revisions r ON r.id=c.revision_id WHERE ${where} ORDER BY c.id DESC LIMIT 20 OFFSET ?`).all(...args,offset).map(row=>({...row,config:JSON.parse(row.config)})),
      total:db.prepare(`SELECT COUNT(*) AS n FROM quality_charts c WHERE ${where}`).get(...args).n};
  }));
  router.get('/products/:product/charts',run(req=>{
    const productId=Number(req.params.product);if(!Number.isSafeInteger(productId)||productId<1)throw error('物料编号无效。');product(req,productId);
    const rows=db.prepare(`SELECT c.*,r.name AS template_name FROM quality_charts c JOIN quality_template_revisions r ON r.id=c.revision_id
      WHERE c.warehouse_id=? AND c.enabled=1 AND json_extract(c.config,'$.kind')='material'
      AND EXISTS (SELECT 1 FROM quality_acceptances a,json_each(a.bindings) b WHERE a.warehouse_id=c.warehouse_id AND a.template_id=c.template_id AND ${activeQualityAcceptance()} AND json_extract(b.value,'$.product_id')=?) ORDER BY c.id DESC`).all(req.warehouse.id,productId);
    return {charts:rows.map(row=>({...row,config:JSON.parse(row.config)}))};
  }));
  router.post('/charts/preview',run(req=>{
    const chart=normalized(req);return query(req,{revision_id:chart.revisionId,config:JSON.stringify(chart.config)},req.body);
  }));
  router.post('/charts',run(req=>transaction(()=>{
    const request=operationRequest(db,req);if(request.previous)return detail(req,db.prepare('SELECT * FROM quality_charts WHERE id=? AND warehouse_id=?').get(request.previous.id,req.warehouse.id)||(()=>{throw error('原图表已删除，请使用新的操作标识。',409);})());
    const chart=normalized(req),{id}=createQualityChart(db,req.warehouse.id,chart,owner(req));
    saveOperationRequest(db,request,{id});return detail(req,db.prepare('SELECT * FROM quality_charts WHERE id=?').get(id));
  })));
  router.get('/charts/:id',run(req=>detail(req,get(req))));
  router.put('/charts/:id',run(req=>transaction(()=>{
    const row=get(req);version(req,row);const chart=normalized(req);
    db.prepare('UPDATE quality_charts SET template_id=?,revision_id=?,name=?,config=?,updated_by_name=?,updated_at=?,version=version+1 WHERE id=?').run(chart.templateId,chart.revisionId,chart.name,JSON.stringify(chart.config),owner(req),new Date().toISOString(),row.id);
    return detail(req,get(req));
  })));
  router.post('/charts/:id/status',run(req=>transaction(()=>{
    const row=get(req);version(req,row);if(typeof req.body.enabled!=='boolean')throw error('图表启用状态无效。');
    db.prepare('UPDATE quality_charts SET enabled=?,version=version+1,updated_by_name=?,updated_at=? WHERE id=?').run(req.body.enabled?1:0,owner(req),new Date().toISOString(),row.id);return detail(req,get(req));
  })));
  router.delete('/charts/:id',run(req=>transaction(()=>{const row=get(req);version(req,row);db.prepare('DELETE FROM quality_charts WHERE id=?').run(row.id);return {ok:true};})));
  router.get('/charts/:id/data',run(req=>query(req,get(req),req.query)));
  router.get('/charts/:id/sources',run(req=>{
    const offset=Number(req.query.offset||0);if(!Number.isSafeInteger(offset)||offset<0||offset>20000||typeof req.query.x!=='string'||req.query.x.length>10000||typeof req.query.series!=='string'||req.query.series.length>10000)throw error('图表来源查询条件无效。');
    return query(req,get(req),req.query,{x:req.query.x,series:req.query.series,offset});
  }));
}
