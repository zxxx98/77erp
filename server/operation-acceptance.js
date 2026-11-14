import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { MAX_QUANTITY } from '../shared/quantity.js';
import { productionStageItems, stageInputCanBeZero } from '../shared/production-stages.js';
import { validateProductionCompletion } from '../shared/production.js';
import { validateScrapActuals } from '../shared/scrap.js';
import { exactQuantity, exactCompare, exactNumber, parseProductionQuantity } from '../shared/exact-quantity.js';
import { hasPermission } from '../shared/permissions.js';
import { createOnlineWorkbook } from '../shared/quality-online.js';
import { parseAcceptance } from '../shared/quality-acceptance.js';
import { needsQualityReview } from '../shared/quality-checks.js';
import { sheetUniqueKey } from '../shared/quality-bindings.js';
import { readQualityWorkbook } from './quality-workbook.js';
import { qualityStorage } from './quality-storage.js';

export const acceptancePermissionMessage = '该工序需要验收，请通知验收员';
const fail = (message, status = 400) => { throw Object.assign(new Error(message), {status}); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function operationAcceptanceNode(db, req) {
  const path = req.method === 'GET' ? req.query.path : req.body.path;
  const nodeId = req.method === 'GET' ? req.query.node_id : req.body.operation_node_id;
  const snapshot = db.prepare(`SELECT r.* FROM production_routes r JOIN production_orders o ON o.id=r.production_id
    WHERE r.production_id=? AND o.warehouse_id=? AND r.path=?`).get(Number(req.params.id),req.warehouse.id,path ?? '');
  return snapshot && JSON.parse(snapshot.graph).nodes.find(node => node.id === nodeId);
}

export function assertOperationAcceptancePermission(db, req) {
  const node = operationAcceptanceNode(db,req);
  if (node?.acceptance_template_id && !hasPermission(req.user,'operation_accept')) fail(acceptancePermissionMessage,403);
  return node;
}

export function createOperationAcceptanceService(db, options) {
  const store = options.qualityStorage || qualityStorage;
  const revision = (req,node) => {
    const row = db.prepare(`SELECT r.* FROM quality_template_revisions r JOIN quality_templates t ON t.id=r.template_id
      WHERE r.id=? AND r.template_id=? AND t.warehouse_id=?`).get(node.acceptance_revision_id,node.acceptance_template_id,req.warehouse.id);
    if (!row) fail('工序验收模板版本不存在，请联系管理员。',409);
    return row;
  };
  const config = file => {
    const c=JSON.parse(db.prepare('SELECT config FROM r2_backup_settings WHERE id=1').get().config);
    if (!c.account_id || !c.bucket || !c.access_key || !c.secret_key) fail('请管理员先配置验收单 Excel 文件存储。',503);
    if (file && (file.account_id !== c.account_id || file.bucket !== c.bucket)) fail('验收模板原文件存储连接已变化，请联系管理员。',503);
    return c;
  };
  const source = async row => {
    const file=db.prepare('SELECT * FROM quality_template_files WHERE id=?').get(row.file_id);
    const c=config(file), bytes=await store.get(c,file.object_key);
    if(bytes.length !== file.size || digest(bytes) !== file.sha256) fail('验收模板原文件校验失败。',409);
    return {file,c,bytes};
  };
  const associated = req => {
    const row=db.prepare(`SELECT a.* FROM quality_acceptances a WHERE a.id=? AND a.warehouse_id=? AND EXISTS
      (SELECT 1 FROM production_operation_reports p WHERE p.production_id=? AND p.acceptance_id=a.id UNION ALL SELECT 1 FROM production_operation_registrations r WHERE r.production_id=? AND r.acceptance_id=a.id)`).get(Number(req.params.acceptanceId),req.warehouse.id,Number(req.params.id),Number(req.params.id));
    if(!row) fail('此生产单的工序验收单不存在。',404);
    return row;
  };
  return {
    async detail(req) {
      const row=associated(req), r=db.prepare('SELECT * FROM quality_template_revisions WHERE id=?').get(row.revision_id);
      const reports=db.prepare('SELECT id,node_id,quantity,quantity_fraction,status,worker_name,registered_by_name,void_reason FROM production_operation_reports WHERE production_id=? AND acceptance_id=?').all(Number(req.params.id),row.id);
      return {id:row.id,number:row.number,name:row.name,note:row.note,created_by_name:row.created_by_name,created_at:row.created_at,
        definition:JSON.parse(r.definition),result:JSON.parse(row.result),reports};
    },
    async template(req) {
      const node=assertOperationAcceptancePermission(db,req);
      if (!node?.acceptance_template_id) return {required:false};
      const r=revision(req,node), {file,bytes}=await source(r);
      const order=db.prepare('SELECT number FROM production_orders WHERE id=? AND warehouse_id=?').get(Number(req.params.id),req.warehouse.id);
      return {required:true,context:{number:order.number,operation:node.name,path:req.query.path??''},template:{definition:JSON.parse(r.definition),workbook:JSON.parse(file.workbook),
        template:{id:r.template_id,revision_id:r.id,revision:r.revision,name:r.name}},source_base64:bytes.toString('base64')};
    },
    async prepare(req) {
      const node=assertOperationAcceptancePermission(db,req);
      if (!node?.acceptance_template_id) {
        if(req.body.operation_acceptance !== undefined) fail('此工序未配置验收模板。');
        return null;
      }
      const input=req.body.operation_acceptance;
      if (!input || input.revision_id !== node.acceptance_revision_id || input.passed !== true || !input.values || typeof input.values !== 'object')
        fail('请填写本工序验收单，并确认验收合格后登记。');
      const r=revision(req,node), {file,c,bytes}=await source(r);
      const template={definition:JSON.parse(r.definition),workbook:JSON.parse(file.workbook)};
      const generated=await createOnlineWorkbook(bytes,template,{values:input.values});
      const workbook=await readQualityWorkbook(generated.buffer);
      const result=parseAcceptance(template.definition,template.workbook,workbook,{sheetNames:[template.definition.sheetName]});
      if (result.issues.length) fail('验收单仍有填写错误，请核对必填项及字段格式。');
      // A report needing review is not automatically released by confirming a form.
      if(needsQualityReview(result)) fail('验收单存在系统核对差异或待确认项，请核实并修正后登记。');
      if(Buffer.byteLength(JSON.stringify(result))>5*1024*1024) fail('验收单解析结果超过 5 MB。');
      const key=`${c.excel_prefix||'excel'}/${db.prepare("SELECT value FROM app_metadata WHERE key='instance_id'").get().value}/acceptances/${randomUUID()}.xlsx`;
      try { await store.put(c,key,Buffer.from(generated.buffer)); }
      catch { await store.remove(c,key).catch(()=>{}); fail('验收单 Excel 保存失败，请重试。',502); }
      return {revision:r,workbook,result,key,config:c,size:generated.buffer.length,sha256:digest(generated.buffer),
        cleanup:()=>store.remove(c,key).catch(()=>{})};
    },
  };
}

// Called inside the production transaction. A passed inspection may commit on
// a pending registration before its material ledger and output batch settle.
export function saveOperationAcceptance(db,req,order,input) {
  if(!input.node.acceptance_template_id || req.validatingRegistration) return null;
  if(req.settledAcceptanceId) {
    const saved=db.prepare('SELECT a.id FROM quality_acceptances a JOIN production_operation_registrations r ON r.acceptance_id=a.id WHERE r.id=? AND r.production_id=? AND a.revision_id=?').get(req.operationRegistrar?.id,order.id,input.node.acceptance_revision_id);
    if(!saved || saved.id!==req.settledAcceptanceId) fail('已验收登记关联无效。',409);
    return saved.id;
  }
  if (!hasPermission(req.user,'operation_accept')) fail(acceptancePermissionMessage,403);
  const prepared=req.operationAcceptance;
  if(!prepared || prepared.revision.id !== input.node.acceptance_revision_id) fail('请先完成本工序验收单。');
  if (prepared.id) return prepared.id; // One inspection may cover an explicitly allocated batch.
  const now=new Date().toISOString(), name=(req.user.name||req.user.username);
  const fid=Number(db.prepare(`INSERT INTO quality_template_files(warehouse_id,account_id,bucket,object_key,filename,size,sha256,workbook,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(order.warehouse_id,prepared.config.account_id,prepared.config.bucket,prepared.key,'工序验收单.xlsx',prepared.size,prepared.sha256,JSON.stringify(prepared.workbook),now).lastInsertRowid);
  const layer=order.stages?.find(s=>s.path===input.route.path)||order;
  const product=db.prepare('SELECT id,name,barcode,specification,unit FROM products WHERE id=? AND warehouse_id=?').get(layer.product_id,order.warehouse_id);
  const sheet=prepared.result.sheets[0];
  const bindings=[{sheetName:sheet.sheetName,mode:'manual',product_id:product.id,product,keyValue:sheetUniqueKey(JSON.parse(prepared.revision.definition),sheet).keyValue}];
  const last=Number(db.prepare("SELECT value FROM app_metadata WHERE key='quality_acceptance_last_deleted_id'").get()?.value||0);
  const id=Math.max(last,db.prepare('SELECT COALESCE(MAX(id),0) id FROM quality_acceptances').get().id)+1;
  const number=`QA-${now.slice(0,10).replaceAll('-','')}-${randomBytes(6).toString('hex').toUpperCase()}`;
  const title=`${order.number} · ${input.node.name}`.slice(0,100);
  const note=`工序验收合格；${input.route.product_coefficient != null ? '后处理工序' : `生产层：${input.route.path||'根层'}`}；本次登记数量：${req.body.quantity??req.body.completed_quantity} ${input.route.unit ?? layer.unit}；作业员工：${input.worker.name||input.worker.username}`;
  db.prepare(`INSERT INTO quality_acceptances(id,warehouse_id,number,name,note,template_id,revision_id,file_id,result,created_by_name,created_at,bindings,checks_acknowledged)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`).run(id,order.warehouse_id,number,title,note,prepared.revision.template_id,prepared.revision.id,fid,JSON.stringify(prepared.result),name,now,JSON.stringify(bindings));
  prepared.id=id;
  return id;
}

export function validateOperationRegistrationBackup(data) {
  const ids=new Set();
  const text=(v,max,required=false)=>typeof v==='string'&&v.length<=max&&(!required||!!v.trim());
  const identity=v=>v===null||Number.isSafeInteger(v)&&v>0;
  for(const row of data.production_operation_registrations||[]) {
    const order=data.production_orders.find(o=>o.id===row.production_id);
    const route=data.production_routes.find(r=>r.production_id===row.production_id&&r.path===row.path);
    let body,node;
    try {
      body=JSON.parse(row.body);
      if(route) {const graph=JSON.parse(route.graph),found=graph.nodes.find(n=>n.id===row.node_id);if(found) node={...found,is_output:route.product_coefficient==null&&!graph.edges.some(edge=>edge.from===found.id)};}
    } catch {fail('备份验收登记内容无效。');}
    if(!Number.isSafeInteger(row.id)||row.id<1||ids.has(row.id)||!order||!['acceptance','settlement'].includes(row.kind)||
      (row.kind==='acceptance'?!node?.acceptance_revision_id:!!node?.acceptance_revision_id)||
      (row.node_id!==''&&!node)||
      !['operations/report','complete','stages/complete'].includes(row.endpoint)||!['pending','approved','void'].includes(row.status)||
      !body||Array.isArray(body)||(body.operation_node_id??'')!==row.node_id||(body.path??'')!==row.path||body.operation_acceptance!==undefined||
      !identity(row.registered_by)||!identity(row.worker_id)||!identity(row.production_group_id)||!text(row.production_group_name,100)||!text(row.registered_by_name,100,true)||!text(row.worker_name,100,true)||
      !text(row.created_at,100,true)||!Number.isFinite(Date.parse(row.created_at))||!text(row.resolved_by_name,100)||
      (row.status==='pending' ? row.resolved_at!==null||row.resolved_by_name!==''||order.status!=='draft'
        : !text(row.resolved_at,100,true)||!Number.isFinite(Date.parse(row.resolved_at))||!row.resolved_by_name.trim())) fail('备份验收登记记录无效。');
    let initialIssues;
    try {initialIssues=JSON.parse(row.initial_issues);} catch {fail('备份登记问题记录无效。');}
    if(!Array.isArray(initialIssues)||initialIssues.length>1000) fail('备份登记问题记录无效。');
    for(const issue of initialIssues) {
      if(!issue||!['material','semi','predecessor','post_processing'].includes(issue.kind)||!text(issue.key,500,true)||!text(issue.name,100,true)||!text(issue.unit,100,true)) fail('备份登记问题记录无效。');
      for(const key of ['missing_quantity','required_quantity','available_quantity']) {
        try {
          const value=exactQuantity(issue,key);
          if(typeof issue[key]!=='number'||!Number.isFinite(issue[key])||typeof issue[`${key}_fraction`]!=='string'||exactCompare(value,0)<0||exactCompare(value,MAX_QUANTITY*100)>0||exactNumber(value)!==issue[key]) fail('备份登记问题数量无效。');
        } catch {fail('备份登记问题数量无效。');}
      }
    }
    ids.add(row.id);
    const quantity=body.quantity??body.completed_quantity;
    // Exact fractions are accepted by the normal registration validator on approval.
    try {parseProductionQuantity(quantity,true);} catch {fail('备份验收登记数量无效。');}
    if(row.kind==='settlement') {
      validateSettlementBody(data,order,row,body,node);
      if(row.acceptance_id!==null) fail('待结算登记不能关联验收单。');
    } else if(row.acceptance_id!==null) {
      const acceptance=data.quality_acceptances.find(a=>a.id===row.acceptance_id);
      if(!acceptance||acceptance.warehouse_id!==order.warehouse_id||acceptance.revision_id!==node.acceptance_revision_id||
        row.status==='approved'&&!data.production_operation_reports.some(r=>r.production_id===order.id&&r.node_id===row.node_id&&r.acceptance_id===row.acceptance_id)) fail('备份验收登记关联无效。');
    } else if(row.status==='approved') fail('通过的登记缺少验收单。');
  }
}

function validateSettlementBody(data, order, row, body, node) {
  const failBody=()=>fail('备份待结算登记内容或关联无效。');
  const materials=data.production_items.filter(item=>item.production_id===order.id);
  const scraps=data.production_scraps.filter(item=>item.production_id===order.id);
  if (body.finish_order!==false && row.endpoint!=='operations/report' ||
      body.note!==undefined && (typeof body.note!=='string'||body.note.length>500)) failBody();
  if(row.endpoint==='operations/report') {
    if(!node||node.id!==row.node_id||node.is_output) failBody();
    if(row.path.startsWith('@post:')&&!Number.isSafeInteger(body.quantity)) failBody();
    return;
  }
  if(node&&!node.is_output) failBody();
  if(row.endpoint==='complete') {
    if(order.stage_workflow||row.path!=='') failBody();
    if(!Array.isArray(body.items)) failBody();
    const supplied=new Set(body.items.map(item=>item?.product_id));
    validateProductionCompletion({...body,items:[...body.items,...materials.filter(item=>item.base_quantity===0&&!supplied.has(item.product_id)).map(item=>({product_id:item.product_id,quantity:0}))]},materials);
    validateScrapActuals(body.scraps??[],scraps);
  } else {
    if(!order.stage_workflow) failBody();
    const parts=body.auto_overflow?body.allocations:[body];
    if(!Array.isArray(parts)||!parts.length||parts.length>100) failBody();
    for(const part of parts) {
      if(!data.production_stages.some(stage=>stage.production_id===order.id&&stage.path===part.path)||!Array.isArray(part.items)||!part.items.length||part.items.length>500||
        new Set(part.items.map(item=>item.path)).size!==part.items.length) failBody();
      parseProductionQuantity(part.completed_quantity??part.quantity,true);
      const sources=productionStageItems({...order,items:materials,nodes:data.production_bom_nodes.filter(n=>n.production_id===order.id)},part.path);
      if(sources.some(source=>!source.is_supplemental_input&&!part.items.some(item=>item.path===source.path))) failBody();
      for(const item of part.items) {
        const source=sources.find(source=>source.path===item.path);
        if(!source) failBody();
        parseProductionQuantity(item.quantity,!stageInputCanBeZero(source,sources));
        if(item.variance_reason!==undefined&&(typeof item.variance_reason!=='string'||item.variance_reason.length>500)) failBody();
      }
    }
    validateScrapActuals(body.scraps??[],row.path===''?scraps:[]);
  }
}
