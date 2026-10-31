import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
      (SELECT 1 FROM production_operation_reports p WHERE p.production_id=? AND p.acceptance_id=a.id)`).get(Number(req.params.acceptanceId),req.warehouse.id,Number(req.params.id));
    if(!row) fail('此生产单的工序验收单不存在。',404);
    return row;
  };
  return {
    async detail(req) {
      const row=associated(req), r=db.prepare('SELECT * FROM quality_template_revisions WHERE id=?').get(row.revision_id);
      const reports=db.prepare('SELECT id,node_id,quantity,status,worker_name,registered_by_name,void_reason FROM production_operation_reports WHERE production_id=? AND acceptance_id=?').all(Number(req.params.id),row.id);
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

// Called inside the production transaction. The generated file is only retained
// after the acceptance, report and (for final operations) output all commit.
export function saveOperationAcceptance(db,req,order,input) {
  if(!input.node.acceptance_template_id) return null;
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
  const note=`工序验收合格；生产层：${input.route.path||'根层'}；本次登记数量：${req.body.quantity??req.body.completed_quantity} ${layer.unit}；作业员工：${input.worker.name||input.worker.username}`;
  db.prepare(`INSERT INTO quality_acceptances(id,warehouse_id,number,name,note,template_id,revision_id,file_id,result,created_by_name,created_at,bindings,checks_acknowledged)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`).run(id,order.warehouse_id,number,title,note,prepared.revision.template_id,prepared.revision.id,fid,JSON.stringify(prepared.result),name,now,JSON.stringify(bindings));
  prepared.id=id;
  return id;
}
