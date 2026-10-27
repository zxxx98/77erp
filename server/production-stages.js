import { productionRegistrationGroup } from './production-access.js';
import { recordOperationOutput, voidOperationOutput } from './process-routes.js';
import { deriveProductionStages, stageDisplayStandardQuantity } from '../shared/production-stages.js';
import { addQuantity, materialQuantity, validQuantity, validStoredQuantity, quantityUnits, QUANTITY_SCALE } from '../shared/quantity.js';
import { allocate } from './commerce.js';
import { hasPermission } from '../shared/permissions.js';
import { assertNoPendingMaterials } from './production-materials.js';
import { createProductionReceipt, assertReceiptReversalPermission, voidProductionReceipt } from './production-receipts.js';
import { validateScrapActuals, scrapExpectedQuantity } from '../shared/scrap.js';
export { deriveProductionStages };
export const productionStageTables = ['production_stages','production_stage_batches','production_stage_inputs','production_stage_allocations','production_stage_components','production_stage_allocation_components'];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), {status}); };
const actor = req => req.user.name || req.user.username;
const sum = (rows, key) => rows.reduce((n,r)=>addQuantity(n,r[key]),0);

export function migrateProductionStages(db) {
  db.exec('SAVEPOINT production_stage_migration');
  try {
  if (!db.prepare('PRAGMA table_info(production_orders)').all().some(c=>c.name==='stage_workflow'))
    db.exec('ALTER TABLE production_orders ADD COLUMN stage_workflow INTEGER NOT NULL DEFAULT 0 CHECK(stage_workflow IN (0,1))');
  db.exec(`CREATE TABLE IF NOT EXISTS production_stages (
    id INTEGER PRIMARY KEY, production_id INTEGER NOT NULL REFERENCES production_orders(id),path TEXT NOT NULL,parent_path TEXT,
    product_id INTEGER NOT NULL REFERENCES products(id),name TEXT NOT NULL,unit TEXT NOT NULL,unit_round_up INTEGER NOT NULL,
    bom_id INTEGER NOT NULL REFERENCES boms(id),bom_version INTEGER NOT NULL,bom_name TEXT NOT NULL,base_quantity REAL NOT NULL,
    loss_method TEXT NOT NULL,planned_quantity REAL NOT NULL,UNIQUE(production_id,path));
    CREATE TABLE IF NOT EXISTS production_stage_batches (
    id INTEGER PRIMARY KEY,production_id INTEGER NOT NULL REFERENCES production_orders(id),stage_id INTEGER NOT NULL REFERENCES production_stages(id),
    path TEXT NOT NULL,batch_number INTEGER NOT NULL,completed_quantity REAL NOT NULL,total_cost_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','void')),root_batch_id INTEGER UNIQUE REFERENCES production_batches(id),
    note TEXT NOT NULL DEFAULT '',created_by INTEGER REFERENCES users(id),created_by_name TEXT NOT NULL,
    production_group_id INTEGER REFERENCES production_groups(id),production_group_name TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,
    voided_by_name TEXT NOT NULL DEFAULT '',voided_at TEXT,void_reason TEXT NOT NULL DEFAULT '',UNIQUE(stage_id,batch_number));
    CREATE TABLE IF NOT EXISTS production_stage_inputs (
    id INTEGER PRIMARY KEY,batch_id INTEGER NOT NULL REFERENCES production_stage_batches(id),path TEXT NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id),usage_mode TEXT NOT NULL CHECK(usage_mode IN ('stock','explode')),
    quantity REAL NOT NULL,cost_cents INTEGER NOT NULL,variance_reason TEXT NOT NULL DEFAULT '',UNIQUE(batch_id,path));
    CREATE TABLE IF NOT EXISTS production_stage_allocations (
    id INTEGER PRIMARY KEY,input_id INTEGER NOT NULL REFERENCES production_stage_inputs(id),source_batch_id INTEGER NOT NULL REFERENCES production_stage_batches(id),
    quantity REAL NOT NULL,cost_cents INTEGER NOT NULL,UNIQUE(input_id,source_batch_id));
    CREATE TABLE IF NOT EXISTS production_stage_components (
    id INTEGER PRIMARY KEY,batch_id INTEGER NOT NULL REFERENCES production_stage_batches(id),product_id INTEGER NOT NULL REFERENCES products(id),
    quantity REAL NOT NULL,cost_cents INTEGER NOT NULL,UNIQUE(batch_id,product_id));
    CREATE TABLE IF NOT EXISTS production_stage_allocation_components (
    id INTEGER PRIMARY KEY,allocation_id INTEGER NOT NULL REFERENCES production_stage_allocations(id),product_id INTEGER NOT NULL REFERENCES products(id),
    quantity REAL NOT NULL,cost_cents INTEGER NOT NULL,UNIQUE(allocation_id,product_id));
    CREATE INDEX IF NOT EXISTS production_stage_batch_order ON production_stage_batches(production_id,path,id);
    CREATE INDEX IF NOT EXISTS production_stage_source ON production_stage_allocations(source_batch_id);`);
    db.exec('RELEASE SAVEPOINT production_stage_migration');
  } catch (error) {
    db.exec('ROLLBACK TO SAVEPOINT production_stage_migration');
    db.exec('RELEASE SAVEPOINT production_stage_migration');
    throw error;
  }
}

export function saveProductionStages(db, order) {
  const stages = deriveProductionStages(order);
  const insert=db.prepare(`INSERT INTO production_stages(production_id,path,parent_path,product_id,name,unit,unit_round_up,bom_id,bom_version,bom_name,base_quantity,loss_method,planned_quantity) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const s of stages) insert.run(order.id,s.path,s.parent_path,s.product_id,s.name,s.unit,s.unit_round_up,s.bom_id,s.bom_version,s.bom_name,s.base_quantity,s.loss_method,s.planned_quantity);
  db.prepare('UPDATE production_orders SET stage_workflow=1 WHERE id=?').run(order.id);
}

export function stageDirectBatches(data, orderId) {
  return (data.production_stage_batches || []).filter(b=>b.production_id===orderId).map(b=>({...b,
    items:(data.production_stage_inputs||[]).filter(i=>i.batch_id===b.id&&i.usage_mode==='stock').map(i=>({...i,actual_quantity:i.quantity}))}));
}
export function stageBatchRemaining(batch, allocations, allocationComponents) {
  const taken=allocations.filter(a=>a.source_batch_id===batch.id), components=(batch.components||[]).map(c=>{
    const parts=allocationComponents.filter(p=>p.product_id===c.product_id&&taken.some(a=>a.id===p.allocation_id));
    return {...c,quantity:addQuantity(c.quantity,-sum(parts,'quantity')),cost_cents:c.cost_cents-parts.reduce((n,p)=>n+p.cost_cents,0)};
  });
  return {quantity:addQuantity(batch.completed_quantity,-sum(taken,'quantity')),cost_cents:batch.total_cost_cents-taken.reduce((n,a)=>n+a.cost_cents,0),components};
}
// Largest-remainder apportionment makes component cents sum to the batch allocation.
export function allocateStageComponents(components, quantity, remainingQuantity, targetCost) {
  const q=BigInt(quantityUnits(quantity)), denominator=BigInt(quantityUnits(remainingQuantity));
  const rows=components.map(c=>{const numerator=BigInt(c.cost_cents)*q;return {...c,
    quantity:quantity===remainingQuantity?c.quantity:Number(BigInt(quantityUnits(c.quantity))*q/denominator)/QUANTITY_SCALE,
    cost_cents:Number(numerator/denominator),remainder:numerator%denominator};});
  let extra=targetCost-rows.reduce((n,r)=>n+r.cost_cents,0);
  for(const r of [...rows].sort((a,b)=>a.remainder===b.remainder?a.product_id-b.product_id:a.remainder>b.remainder?-1:1)) if(extra>0&&r.cost_cents<components.find(c=>c.product_id===r.product_id).cost_cents){r.cost_cents++;extra--;}
  if(extra!==0) fail('半成品组成成本分配不守恒。');
  return rows.map(({remainder,...r})=>r);
}
function stageLedger(db, id) {
  const batches=db.prepare('SELECT * FROM production_stage_batches WHERE production_id=? ORDER BY id').all(id);
  const inputs=db.prepare('SELECT i.* FROM production_stage_inputs i JOIN production_stage_batches b ON b.id=i.batch_id WHERE b.production_id=? ORDER BY i.id').all(id);
  const allocations=db.prepare(`SELECT a.* FROM production_stage_allocations a JOIN production_stage_inputs i ON i.id=a.input_id JOIN production_stage_batches b ON b.id=i.batch_id WHERE b.production_id=? AND b.status='active' ORDER BY a.id`).all(id);
  const ac=db.prepare(`SELECT c.* FROM production_stage_allocation_components c JOIN production_stage_allocations a ON a.id=c.allocation_id JOIN production_stage_inputs i ON i.id=a.input_id JOIN production_stage_batches b ON b.id=i.batch_id WHERE b.production_id=? AND b.status='active'`).all(id);
  for(const b of batches) b.components=db.prepare('SELECT * FROM production_stage_components WHERE batch_id=? ORDER BY product_id').all(b.id);
  return {batches,inputs,allocations,allocationComponents:ac};
}
export function readProductionStages(db, order) {
  if(!order.stage_workflow) return;
  const ledger=stageLedger(db,order.id);
  order.stage_direct_batches=ledger.batches.map(b=>({...b,items:ledger.inputs.filter(i=>i.batch_id===b.id&&i.usage_mode==='stock').map(i=>({...i,actual_quantity:i.quantity}))}));
  order.stages=db.prepare('SELECT * FROM production_stages WHERE production_id=? ORDER BY id').all(order.id).map(s=>{
    const batches=ledger.batches.filter(b=>b.path===s.path&&b.status==='active'), remaining=batches.map(b=>stageBatchRemaining(b,ledger.allocations,ledger.allocationComponents));
    const completed=sum(batches,'completed_quantity'), available=sum(remaining,'quantity');
    const activeIds=new Set(batches.map(b=>b.id));
    const items=order.nodes.filter(n=>n.parent_path===s.path).map(n=>{
      let standard_quantity=null;
      try { standard_quantity=stageDisplayStandardQuantity(n,completed); } catch { /* Keep historical actuals readable when cumulative standards exceed limits. */ }
      return {...n,standard_quantity,actual_quantity:sum(ledger.inputs.filter(i=>i.path===n.path&&activeIds.has(i.batch_id)),'quantity')};
    });
    return {...s,completed_quantity:completed,consumed_quantity:addQuantity(completed,-available),available_quantity:available,
      available_cost_cents:remaining.reduce((n,r)=>n+r.cost_cents,0),items};
  });
  order.direct_material_cost_cents=order.stage_direct_batches.filter(b=>b.status==='active').reduce((n,b)=>n+b.items.reduce((n,i)=>n+i.cost_cents,0),0);
  order.work_in_progress_cost_cents=order.stages.filter(s=>s.path!=='').reduce((n,s)=>n+s.available_cost_cents,0);
  if(!Number.isSafeInteger(order.direct_material_cost_cents)||!Number.isSafeInteger(order.work_in_progress_cost_cents))fail('分层生产累计成本超出范围。');
}
export function populateStageBalances(order) {
  if(!order.stage_workflow)return;
  for(const stage of order.stages)stage.items=stage.items.map(n=>({...n,available_quantity:n.usage_mode==='explode'?order.stages.find(s=>s.path===n.path).available_quantity:order.items.find(i=>i.product_id===n.product_id).available_quantity}));
}
export function assertStagesFinished(order) {
  const remaining=(order.stages||[]).filter(s=>s.path!==''&&s.available_quantity!==0);
  if(remaining.length)fail(`仍有本单半成品余额：${remaining.map(s=>`${s.name}［${s.path}］${s.available_quantity} ${s.unit}`).join('、')}。请按实际情况继续登记。`,409);
}
export function deleteProductionStages(db,id) {
  const scope=id===undefined?'':` WHERE b.production_id=${Number(id)}`;
  db.exec(`DELETE FROM production_stage_allocation_components WHERE allocation_id IN (SELECT a.id FROM production_stage_allocations a JOIN production_stage_inputs i ON i.id=a.input_id JOIN production_stage_batches b ON b.id=i.batch_id${scope});
    DELETE FROM production_stage_allocations WHERE input_id IN (SELECT i.id FROM production_stage_inputs i JOIN production_stage_batches b ON b.id=i.batch_id${scope});
    DELETE FROM production_stage_components WHERE batch_id IN (SELECT b.id FROM production_stage_batches b${scope});
    DELETE FROM production_stage_inputs WHERE batch_id IN (SELECT b.id FROM production_stage_batches b${scope});
    DELETE FROM production_stage_batches${id===undefined?'':` WHERE production_id=${Number(id)}`};
    DELETE FROM production_stages${id===undefined?'':` WHERE production_id=${Number(id)}`};`);
}

export function installProductionStages(app,db,{route,current,version,units,updateBatchTotals,reverseBatch,stockBefore,notifyStockChanges}) {
  const stageOrder=req=>{const o=current(req);if(!o.stage_workflow)fail('此单使用原有生产流程。',409);return o;};
  const stageBatch=(o,id)=>{const b=db.prepare('SELECT * FROM production_stage_batches WHERE id=? AND production_id=?').get(Number(id),o.id);if(!b)fail('层级批次不存在或不属于此生产单。',404);return b;};
  app.post('/api/production-orders/:id/stages/enable',route(req=>{
    const o=current(req); version(req,o);
    if(req.body.stage_schema_version!==1||o.stage_workflow||!o.material_workflow||o.status!=='draft'||o.completed_at||o.batches.length||o.material_documents.length||o.receipt_documents.length||!o.nodes.some(n=>n.usage_mode==='explode'))fail('仅未开始、无作业记录的多层材料流程草稿可以启用分层。',409);
    saveProductionStages(db,o);db.prepare('UPDATE production_orders SET updated_at=?,updated_by_name=? WHERE id=?').run(new Date().toISOString(),actor(req),o.id);return current(req);
  },true));
  app.get('/api/production-orders/:id/stages/batches',route(req=>{
    const o=stageOrder(req),{path,offset='0',limit='20'}=req.query;
    if(typeof path!=='string'||!o.stages.some(s=>s.path===path))fail('生产层不存在。',404);
    if(!/^\d+$/.test(offset)||!Number.isSafeInteger(Number(offset))||!/^\d+$/.test(limit)||Number(limit)<1||Number(limit)>100)fail('批次分页参数无效。');
    const total=db.prepare('SELECT COUNT(*) n FROM production_stage_batches WHERE production_id=? AND path=?').get(o.id,path).n;
    const ledger=stageLedger(db,o.id),batches=ledger.batches.filter(b=>b.path===path).slice(Number(offset),Number(offset)+Number(limit)).map(b=>({...b,items:ledger.inputs.filter(i=>i.batch_id===b.id).map(i=>({...o.nodes.find(n=>n.path===i.path),...i,actual_quantity:i.quantity,
      allocations:db.prepare('SELECT a.*,b.path AS source_path,b.batch_number AS source_batch_number FROM production_stage_allocations a JOIN production_stage_batches b ON b.id=a.source_batch_id WHERE a.input_id=? ORDER BY a.id').all(i.id)}))}));
    return {batches,total,has_more:Number(offset)+batches.length<total};
  }));
  app.post('/api/production-orders/:id/stages/complete',route(req=>{
    const o=stageOrder(req); version(req,o);units(o);
    if(o.status!=='in_progress')fail('请先开始生产并由仓库批准领料后登记。',409);
    const s=o.stages.find(s=>s.path===req.body.path);if(!s)fail('生产层不存在。',404);
    if(!validQuantity(req.body.completed_quantity,true)||req.body.note!==undefined&&(typeof req.body.note!=='string'||req.body.note.length>500)||typeof req.body.finish_order!=='boolean')fail('请核对本批产量、备注及继续生产选项。');
    if(s.path!==''&&(req.body.finish_order||req.body.scraps?.length))fail('半成品层只能登记继续，不登记废料或结束整单。');
    if(!Array.isArray(req.body.items)||req.body.items.length!==s.items.length||new Set(req.body.items.map(i=>i?.path)).size!==s.items.length)fail('请核对全部直属投入，路径不能重复或增删。');
    const actuals=s.items.map(n=>{const a=req.body.items.find(i=>i?.path===n.path);if(!a||!validQuantity(a.quantity,n.usage_mode==='explode')||a.variance_reason!==undefined&&(typeof a.variance_reason!=='string'||a.variance_reason.length>500))fail('直属投入需为有效数量且最多 4 位小数；半成品投入必须大于零。');
      const p=db.prepare('SELECT * FROM products WHERE id=?').get(n.product_id);if(!p||p.warehouse_id!==o.warehouse_id||p.unit!==n.unit||p.unit_round_up!==n.unit_round_up)fail(`${n.name}单位或取整规则已变化。`,409);if(!p.active)fail(`${n.name}已停用。`);
      return {...n,quantity:materialQuantity(a.quantity,n),variance_reason:(a.variance_reason||'').trim()};});
    if(!actuals.some(a=>a.quantity>0))fail('至少一种直属投入需大于零。');
    const output=db.prepare('SELECT * FROM products WHERE id=?').get(s.product_id);if(output.unit!==s.unit||output.unit_round_up!==s.unit_round_up||!output.active)fail('本层产品已停用或单位、取整规则已变化。',409);
    const q=materialQuantity(req.body.completed_quantity,s),ledger=stageLedger(db,o.id),count=ledger.batches.filter(b=>b.path===s.path).length;
    if(count>=1000||ledger.batches.length>=10000)fail('层级批次达到上限（每层 1000 批、整单 10000 批，含作废），请拆分生产单。');
    if(!validStoredQuantity(addQuantity(s.completed_quantity,q),true))fail('累计产量超出范围。');
    const registrationGroup=productionRegistrationGroup(req.user,o);
    const at=new Date().toISOString(),owner=actor(req),components=new Map(),pool=new Map(o.items.map(i=>[i.product_id,{quantity:i.available_quantity,cost_cents:i.available_cost_cents}]));
    const id=Number(db.prepare(`INSERT INTO production_stage_batches(production_id,stage_id,path,batch_number,completed_quantity,total_cost_cents,note,created_by,created_by_name,production_group_id,production_group_name,created_at) VALUES (?,?,?,?,?,0,?,?,?,?,?,?)`).run(o.id,s.id,s.path,count+1,q,(req.body.note||'').trim(),req.user.id,owner,registrationGroup.id,registrationGroup.name,at).lastInsertRowid);
    const merge=c=>{const prev=components.get(c.product_id)||{product_id:c.product_id,quantity:0,cost_cents:0};prev.quantity=addQuantity(prev.quantity,c.quantity);prev.cost_cents+=c.cost_cents;if(!validStoredQuantity(prev.quantity)||!Number.isSafeInteger(prev.cost_cents))fail('原料组成累计超出范围。');components.set(c.product_id,prev);};
    let total=0;
    for(const a of actuals){
      let cost=0;const splits=[];
      if(a.usage_mode==='stock'){const p=pool.get(a.product_id);if(a.quantity>p.quantity)fail(`${a.name}已领未耗余额不足（当前 ${p.quantity} ${a.unit}）。请补料或核对实际投入。`);cost=a.quantity?allocate(p.cost_cents,a.quantity,p.quantity):0;p.quantity=addQuantity(p.quantity,-a.quantity);p.cost_cents-=cost;merge({product_id:a.product_id,quantity:a.quantity,cost_cents:cost});}
      else {
        let need=a.quantity;for(const source of ledger.batches.filter(b=>b.path===a.path&&b.status==='active')){if(!need)break;const left=stageBatchRemaining(source,ledger.allocations,ledger.allocationComponents);if(!left.quantity)continue;
          const used=Math.min(need,left.quantity),c=allocate(left.cost_cents,used,left.quantity),parts=allocateStageComponents(left.components,used,left.quantity,c);splits.push({source,quantity:used,cost_cents:c,parts});cost+=c;need=addQuantity(need,-used);}
        if(need)fail(`${a.name}来源层［${a.path}］半成品余额不足（还缺 ${need} ${a.unit}），请先登记下层生产。`);
      }
      const inputId=Number(db.prepare('INSERT INTO production_stage_inputs(batch_id,path,product_id,usage_mode,quantity,cost_cents,variance_reason) VALUES (?,?,?,?,?,?,?)').run(id,a.path,a.product_id,a.usage_mode,a.quantity,cost,a.variance_reason).lastInsertRowid);
      for(const split of splits){const aid=Number(db.prepare('INSERT INTO production_stage_allocations(input_id,source_batch_id,quantity,cost_cents) VALUES (?,?,?,?)').run(inputId,split.source.id,split.quantity,split.cost_cents).lastInsertRowid);for(const c of split.parts){db.prepare('INSERT INTO production_stage_allocation_components(allocation_id,product_id,quantity,cost_cents) VALUES (?,?,?,?)').run(aid,c.product_id,c.quantity,c.cost_cents);merge(c);}}
      total+=cost;if(!Number.isSafeInteger(total))fail('本批成本超出范围。');
    }
    for(const c of components.values())db.prepare('INSERT INTO production_stage_components(batch_id,product_id,quantity,cost_cents) VALUES (?,?,?,?)').run(id,c.product_id,c.quantity,c.cost_cents);
    db.prepare('UPDATE production_stage_batches SET total_cost_cents=? WHERE id=?').run(total,id);
    if(s.path===''){
      validateScrapActuals(req.body.scraps??[],o.scraps);const number=(o.batches.at(-1)?.batch_number??0)+1;
      const rootId=Number(db.prepare(`INSERT INTO production_batches(production_id,batch_number,completed_quantity,total_cost_cents,note,created_by_name,created_at,receipt_required,created_by,production_group_id,production_group_name) VALUES (?,?,?,?,?,?,?,1,?,?,?)`).run(o.id,number,q,total,(req.body.note||'').trim(),owner,at,req.user.id,registrationGroup.id,registrationGroup.name).lastInsertRowid);
      for(const item of o.items){const c=components.get(item.product_id)||{quantity:0,cost_cents:0};db.prepare('INSERT INTO production_batch_items(batch_id,product_id,actual_quantity,cost_cents,variance_reason) VALUES (?,?,?,?,?)').run(rootId,item.product_id,c.quantity,c.cost_cents,actuals.filter(a=>a.product_id===item.product_id&&a.usage_mode==='stock').map(a=>a.variance_reason).filter(Boolean).join('；'));}
      for(const rule of o.scraps){const actual=req.body.scraps.find(a=>a.product_id===rule.product_id),quantity=materialQuantity(actual.quantity,rule);db.prepare('INSERT INTO production_batch_scraps(batch_id,product_id,expected_quantity,actual_quantity,disposition) VALUES (?,?,?,?,?)').run(rootId,rule.product_id,scrapExpectedQuantity(rule,q,o.base_quantity,actuals.filter(a=>a.usage_mode==='stock').map(a=>({product_id:a.product_id,quantity:a.quantity})),o.quantity_decimals),quantity,actual.disposition);}
      db.prepare('UPDATE production_stage_batches SET root_batch_id=? WHERE id=?').run(rootId,id);createProductionReceipt(db,req,o,rootId);updateBatchTotals(db,o,'draft',owner,at);
    }else db.prepare('UPDATE production_orders SET updated_by_name=?,updated_at=? WHERE id=?').run(owner,at,o.id);
    recordOperationOutput(db,req,o,s.path,q,'stage',id);
    if(req.body.finish_order){const fresh=current(req);assertNoPendingMaterials(db,fresh);assertStagesFinished(fresh);db.prepare("UPDATE production_orders SET status='completed',updated_by_name=?,updated_at=? WHERE id=?").run(owner,at,o.id);}
    return current(req);
  },true));
  app.post('/api/production-orders/:id/stages/batches/:batchId/void',route(req=>{
    const o=stageOrder(req);version(req,o);if(o.status==='void')fail('生产单已经作废。',409);
    const b=stageBatch(o,req.params.batchId);if(b.status!=='active')fail('层级批次已经作废。',409);
    const stage=o.stages.find(s=>s.path===b.path);
    for(const n of [stage,...stage.items]){const p=db.prepare('SELECT unit,unit_round_up FROM products WHERE id=?').get(n.product_id);if(!p||p.unit!==n.unit||p.unit_round_up!==n.unit_round_up)fail(`${n.name}单位或取整规则已变化，无法按原快照作废。`,409);}
    if(typeof req.body.reason!=='string'||!req.body.reason.trim()||req.body.reason.length>500)fail('请填写作废原因（最多 500 字）。');
    const dependents=db.prepare(`SELECT DISTINCT b.path,b.batch_number FROM production_stage_allocations a JOIN production_stage_inputs i ON i.id=a.input_id JOIN production_stage_batches b ON b.id=i.batch_id WHERE a.source_batch_id=? AND b.status='active'`).all(b.id);
    if(dependents.length)fail(`此批次已被上层使用，请先作废上层批次：${dependents.map(d=>`［${d.path||'根层'}］第 ${d.batch_number} 批`).join('、')}。`,409);
    const at=new Date().toISOString(),owner=actor(req),why=req.body.reason.trim();
    if(b.root_batch_id){const root=o.batches.find(r=>r.id===b.root_batch_id),before=stockBefore(o);units(o,false);reverseBatch(req,o,root);voidProductionReceipt(db,root.id,owner,at,why);db.prepare("UPDATE production_batches SET status='void',voided_by_name=?,voided_at=?,void_reason=? WHERE id=?").run(owner,at,why,root.id);notifyStockChanges(db,req,before,{production_id:o.id,number:o.number,batch_id:root.id});}
    voidOperationOutput(db,'stage',b.id,owner,at,why);
    db.prepare("UPDATE production_stage_batches SET status='void',voided_by_name=?,voided_at=?,void_reason=? WHERE id=?").run(owner,at,why,b.id);updateBatchTotals(db,o,'draft',owner,at);return current(req);
  },true,req=>{if(!hasPermission(req.user,'production')||!hasPermission(req.user,'corrections'))fail('需要生产管理和单据纠正权限。',403);const o=stageOrder(req),b=stageBatch(o,req.params.batchId);if(b.root_batch_id)assertReceiptReversalPermission(db,req,o.batches.find(r=>r.id===b.root_batch_id));}));
}

// Used by restore before any rows are written. Validate each immutable transfer
// and the live ledger independently; a balanced root summary cannot hide WIP.
export function validateProductionStageBackup(data) {
  const money=n=>Number.isSafeInteger(n)&&n>=0;
  const text=(s,max,required=false)=>typeof s==='string'&&s.length<=max&&(!required||!!s.trim());
  const date=s=>text(s,100,true)&&Number.isFinite(Date.parse(s));
  const orders=new Map(data.production_orders.map(o=>[o.id,o]));
  const tables=Object.fromEntries(productionStageTables.map(t=>[t,data[t]||[]]));
  const keyed=t=>{const rows=tables[t],m=new Map(rows.map(r=>[r.id,r]));if(m.size!==rows.length||rows.some(r=>!Number.isSafeInteger(r.id)||r.id<1))fail('备份分层记录编号无效或重复。');return m;};
  const stages=keyed('production_stages'), batches=keyed('production_stage_batches'),inputs=keyed('production_stage_inputs'),allocations=keyed('production_stage_allocations');
  keyed('production_stage_components');keyed('production_stage_allocation_components');
  const unique=new Set(),rootIds=new Set();
  for(const order of orders.values()) {
    if(![0,1].includes(order.stage_workflow))fail('备份分层流程标志无效。');
    const actual=[...stages.values()].filter(s=>s.production_id===order.id);
    if(!order.stage_workflow){if(actual.length||[...batches.values()].some(b=>b.production_id===order.id))fail('旧流程不能包含分层账。');continue;}
    if(!order.material_workflow||order.snapshot_format!==2)fail('分层生产必须使用材料流程和多层配方快照。');
    const expected=deriveProductionStages({...order,nodes:data.production_bom_nodes.filter(n=>n.production_id===order.id).sort((a,b)=>a.position-b.position)});
    if(expected.length!==actual.length||!expected.length)fail('备份生产层数量无效。');
    for(const e of expected){const s=actual.find(s=>s.path===e.path);if(!s||Object.keys(e).filter(k=>k!=='items').some(k=>s[k]!==e[k]))fail('备份生产层与快照不一致。');}
    const bs=[...batches.values()].filter(b=>b.production_id===order.id);if(bs.length>10000)fail('备份生产单层级批次过多。');
    for(const root of data.production_batches.filter(b=>b.production_id===order.id))if(!bs.some(b=>b.root_batch_id===root.id))fail('备份根完工批次缺少层级登记。');
  }
  for(const s of stages.values())if(!orders.get(s.production_id)?.stage_workflow)fail('备份生产层关联无效。');
  for(const b of batches.values()){
    const order=orders.get(b.production_id),stage=stages.get(b.stage_id),root=data.production_batches.find(r=>r.id===b.root_batch_id);
    const k=`batch:${b.stage_id}:${b.batch_number}`;
    if(!order?.stage_workflow||!stage||stage.production_id!==b.production_id||stage.path!==b.path||unique.has(k)||!Number.isSafeInteger(b.batch_number)||b.batch_number<1||b.batch_number>1000||
      !validQuantity(b.completed_quantity,true)||stage.unit_round_up&&!Number.isInteger(b.completed_quantity)||!money(b.total_cost_cents)||!['active','void'].includes(b.status)||
      !text(b.note,500)||!text(b.created_by_name,60,true)||!date(b.created_at)||!text(b.production_group_name,100)||!text(b.voided_by_name,60)||!text(b.void_reason,500)||
      (b.status==='active'?(b.voided_at!==null||b.voided_by_name!==''||b.void_reason!=='') : !date(b.voided_at)||!b.voided_by_name.trim()||!b.void_reason.trim())||order.status==='void'&&b.status==='active')fail('备份层级批次字段、状态或归属无效。');
    unique.add(k);
    if(b.path===''){
      if(!root||rootIds.has(root.id)||root.production_id!==b.production_id||['completed_quantity','total_cost_cents','status','note','created_by_name','created_at','voided_by_name','voided_at','void_reason','production_group_id','production_group_name'].some(k=>root[k]!==b[k])||root.receipt_required!==1)fail('备份根层与成品批次不一致。');
      rootIds.add(root.id);
    }else if(b.root_batch_id!==null)fail('半成品批次不能关联仓库成品批次。');
    const nodes=data.production_bom_nodes.filter(n=>n.production_id===order.id&&n.parent_path===b.path),rows=[...inputs.values()].filter(i=>i.batch_id===b.id);
    if(rows.length!==nodes.length||!rows.some(i=>i.quantity>0))fail('备份直属投入不完整。');
    if(rows.reduce((n,i)=>n+i.cost_cents,0)!==b.total_cost_cents)fail('备份层级批次投入成本不一致。');
  }
  for(const i of inputs.values()){
    const b=batches.get(i.batch_id),node=b&&data.production_bom_nodes.find(n=>n.production_id===b.production_id&&n.parent_path===b.path&&n.path===i.path),k=`input:${i.batch_id}:${i.path}`;
    if(!b||!node||unique.has(k)||i.product_id!==node.product_id||i.usage_mode!==node.usage_mode||!validQuantity(i.quantity,i.usage_mode==='explode')||node.unit_round_up&&!Number.isInteger(i.quantity)||!money(i.cost_cents)||i.quantity===0&&i.cost_cents!==0||!text(i.variance_reason,500))fail('备份层级直属投入无效。');
    unique.add(k);const parts=[...allocations.values()].filter(a=>a.input_id===i.id);
    if(i.usage_mode==='stock'?parts.length!==0:!parts.length||sum(parts,'quantity')!==i.quantity||parts.reduce((n,a)=>n+a.cost_cents,0)!==i.cost_cents)fail('备份半成品分配与投入不一致。');
  }
  for(const a of allocations.values()){
    const i=inputs.get(a.input_id),consumer=i&&batches.get(i.batch_id),source=batches.get(a.source_batch_id),k=`allocation:${a.input_id}:${a.source_batch_id}`;
    if(!i||i.usage_mode!=='explode'||!source||!consumer||unique.has(k)||source.production_id!==consumer.production_id||source.path!==i.path||source.id>=consumer.id||source.created_at>consumer.created_at||
      !validStoredQuantity(a.quantity,true)||a.quantity>source.completed_quantity||stages.get(source.stage_id).unit_round_up&&!Number.isInteger(a.quantity)||!money(a.cost_cents)||a.cost_cents>source.total_cost_cents||consumer.status==='active'&&source.status!=='active')fail('备份半成品来源跨单、层级或状态依赖无效。');
    unique.add(k);const parts=tables.production_stage_allocation_components.filter(c=>c.allocation_id===a.id);
    if(!parts.length||parts.reduce((n,c)=>n+c.cost_cents,0)!==a.cost_cents)fail('备份半成品分配组成成本不一致。');
    const sourceParts=tables.production_stage_components.filter(c=>c.batch_id===source.id);
    if(parts.length!==sourceParts.length||parts.some(c=>{const p=sourceParts.find(p=>p.product_id===c.product_id);return !p||c.quantity>p.quantity||c.cost_cents>p.cost_cents;}))fail('备份半成品分配原料组成不完整或超额。');
  }
  for(const [table,parentKey,parentMap] of [['production_stage_components','batch_id',batches],['production_stage_allocation_components','allocation_id',allocations]])for(const c of tables[table]){
    const parent=parentMap.get(c[parentKey]),batch=table==='production_stage_components'?parent:parent&&batches.get(inputs.get(parent.input_id)?.batch_id),k=`${table}:${c[parentKey]}:${c.product_id}`;
    if(!parent||!batch||unique.has(k)||!data.production_items.some(i=>i.production_id===batch.production_id&&i.product_id===c.product_id)||!validStoredQuantity(c.quantity)||!money(c.cost_cents))fail('备份分层原料组成无效。');
    unique.add(k);
  }
  for(const b of batches.values()){
    const components=tables.production_stage_components.filter(c=>c.batch_id===b.id),expected=new Map();
    const merge=c=>{const p=expected.get(c.product_id)||{quantity:0,cost_cents:0};p.quantity=addQuantity(p.quantity,c.quantity);p.cost_cents+=c.cost_cents;expected.set(c.product_id,p);};
    for(const i of [...inputs.values()].filter(i=>i.batch_id===b.id))if(i.usage_mode==='stock')merge(i);else for(const a of [...allocations.values()].filter(a=>a.input_id===i.id))for(const c of tables.production_stage_allocation_components.filter(c=>c.allocation_id===a.id))merge(c);
    if(components.length!==expected.size||components.reduce((n,c)=>n+c.cost_cents,0)!==b.total_cost_cents||components.some(c=>{const e=expected.get(c.product_id);return !e||c.quantity!==e.quantity||c.cost_cents!==e.cost_cents;}))fail('备份层级原料组成不守恒。');
    const live=[...allocations.values()].filter(a=>batches.get(inputs.get(a.input_id).batch_id).status==='active');
    const left=stageBatchRemaining({...b,components},live,tables.production_stage_allocation_components);
    if(b.status==='active'&&(!validStoredQuantity(left.quantity)||!money(left.cost_cents)||left.quantity===0&&left.cost_cents!==0||left.components.some(c=>!validStoredQuantity(c.quantity)||!money(c.cost_cents)||left.quantity===0&&(c.quantity!==0||c.cost_cents!==0))||left.components.reduce((n,c)=>n+c.cost_cents,0)!==left.cost_cents))fail('备份半成品来源超额分配或数量成本不守恒。');
    if(b.root_batch_id){const orderItems=data.production_items.filter(i=>i.production_id===b.production_id),rootItems=data.production_batch_items.filter(i=>i.batch_id===b.root_batch_id);if(rootItems.length!==orderItems.length||rootItems.some(i=>{const c=components.find(c=>c.product_id===i.product_id)||{quantity:0,cost_cents:0};return i.actual_quantity!==c.quantity||i.cost_cents!==c.cost_cents;}))fail('备份根层原料追溯投影不一致。');}
  }
  for(const o of orders.values())if(o.stage_workflow){
    const active=[...batches.values()].filter(b=>b.production_id===o.id&&b.status==='active'),live=[...allocations.values()].filter(a=>batches.get(inputs.get(a.input_id).batch_id).status==='active');
    const wip=active.filter(b=>b.path!=='').map(b=>stageBatchRemaining({...b,components:tables.production_stage_components.filter(c=>c.batch_id===b.id)},live,tables.production_stage_allocation_components));
    const direct=[...inputs.values()].filter(i=>i.usage_mode==='stock'&&active.some(b=>b.id===i.batch_id)).reduce((n,i)=>n+i.cost_cents,0);
    const root=active.filter(b=>b.path==='').reduce((n,b)=>n+b.total_cost_cents,0);
    if(direct!==root+wip.reduce((n,b)=>n+b.cost_cents,0)||o.status==='completed'&&wip.some(b=>b.quantity!==0))fail('备份整单分层成本或结束状态不守恒。');
  }
  validateStageAllocationHistory(tables,batches,inputs,allocations);
}

// Current balances alone cannot prove an immutable transfer: reducing its
// quantity must also change its cents and raw provenance. Reproduce the source
// balances that existed when each consumer was registered, restoring the exact
// saved shares on correction rather than applying an original batch ratio.
function validateStageAllocationHistory(tables,batches,inputs,allocations) {
  const groupBy=(rows,key)=>{
    const groups=new Map();
    for(const row of rows){const k=key(row),group=groups.get(k)||[];group.push(row);groups.set(k,group);}
    return groups;
  };
  const batchInputs=groupBy([...inputs.values()],i=>i.batch_id);
  const inputAllocations=groupBy([...allocations.values()].sort((a,b)=>a.id-b.id),a=>a.input_id);
  const batchAllocations=groupBy([...allocations.values()],a=>inputs.get(a.input_id).batch_id);
  const sourceAllocations=groupBy([...allocations.values()],a=>a.source_batch_id);
  const batchComponents=groupBy(tables.production_stage_components,c=>c.batch_id);
  const allocationComponents=groupBy(tables.production_stage_allocation_components,c=>c.allocation_id);
  const sourceKey=b=>`${b.production_id}:${b.path}`;
  const sourceBatches=groupBy([...batches.values()].sort((a,b)=>a.id-b.id),sourceKey);
  const events=new Map();
  const eventAt=time=>{const e=events.get(time)||{creations:[],voids:[]};events.set(time,e);return e;};
  for(const batch of batches.values()){
    const created=Date.parse(batch.created_at);eventAt(created).creations.push(batch);
    if(batch.status==='void'){
      const voided=Date.parse(batch.voided_at);
      if(voided<created)fail('备份层级批次作废时间早于登记时间。');
      eventAt(voided).voids.push(batch);
    }
  }
  const live=new Set(),remaining=new Map();
  const transfer=(allocation,direction)=>{
    const left=remaining.get(allocation.source_batch_id);
    left.quantity=addQuantity(left.quantity,direction*allocation.quantity);
    left.cost_cents+=direction*allocation.cost_cents;
    for(const part of allocationComponents.get(allocation.id)||[]){
      const component=left.components.get(part.product_id);
      component.quantity=addQuantity(component.quantity,direction*part.quantity);
      component.cost_cents+=direction*part.cost_cents;
    }
  };
  const matchesCreation=batch=>{
    for(const input of batchInputs.get(batch.id)||[]){
      if(input.usage_mode!=='explode')continue;
      let needed=input.quantity,index=0;
      const saved=inputAllocations.get(input.id)||[];
      for(const source of sourceBatches.get(`${batch.production_id}:${input.path}`)||[]){
        if(!needed)break;
        if(!live.has(source.id))continue;
        const left=remaining.get(source.id);
        if(!left.quantity)continue;
        const quantity=Math.min(needed,left.quantity),cost=allocate(left.cost_cents,quantity,left.quantity);
        const allocation=saved[index++];
        if(!allocation||allocation.source_batch_id!==source.id||allocation.quantity!==quantity||allocation.cost_cents!==cost)return false;
        const expected=allocateStageComponents([...left.components.values()],quantity,left.quantity,cost);
        const actual=allocationComponents.get(allocation.id)||[];
        if(expected.length!==actual.length||expected.some(e=>{const a=actual.find(a=>a.product_id===e.product_id);return !a||a.quantity!==e.quantity||a.cost_cents!==e.cost_cents;}))return false;
        needed=addQuantity(needed,-quantity);
      }
      if(needed||index!==saved.length)return false;
    }
    return true;
  };
  const create=batch=>{
    remaining.set(batch.id,{quantity:batch.completed_quantity,cost_cents:batch.total_cost_cents,
      components:new Map((batchComponents.get(batch.id)||[]).map(c=>[c.product_id,{...c}]))});
    live.add(batch.id);
    for(const allocation of batchAllocations.get(batch.id)||[])transfer(allocation,-1);
  };
  const undoCreate=batch=>{
    for(const allocation of batchAllocations.get(batch.id)||[])transfer(allocation,1);
    live.delete(batch.id);remaining.delete(batch.id);
  };
  const canVoid=batch=>live.has(batch.id)&&!(sourceAllocations.get(batch.id)||[]).some(a=>live.has(inputs.get(a.input_id).batch_id));
  const correct=(batch,direction)=>{
    for(const allocation of batchAllocations.get(batch.id)||[])transfer(allocation,direction);
    if(direction===1)live.delete(batch.id);else live.add(batch.id);
  };
  for(const [,event] of [...events].sort(([a],[b])=>a-b)){
    const creations=event.creations.sort((a,b)=>a.id-b.id),voids=event.voids.sort((a,b)=>b.id-a.id);
    const pending=new Set(voids.map(b=>b.id)),seen=new Set();
    // ISO timestamps have millisecond precision. A tied correction can precede
    // or follow a creation; try only dependency-valid orders and memoize them.
    // Bound ambiguous histories so forged same-time events cannot force an
    // unbounded combinatorial search during backup validation.
    let attempts=4096,exhausted=false;
    const replay=index=>{
      if(--attempts<0){exhausted=true;return false;}
      const key=`${index}:${voids.filter(b=>pending.has(b.id)).map(b=>b.id).join(',')}`;
      if(seen.has(key))return false;
      seen.add(key);
      if(index===creations.length){
        const applied=[];
        for(const batch of voids)if(pending.has(batch.id)){
          if(!canVoid(batch)){for(const prior of applied.reverse())correct(prior,-1);return false;}
          correct(batch,1);applied.push(batch);
        }
        return true;
      }
      const batch=creations[index];
      if(matchesCreation(batch)){
        create(batch);
        if(replay(index+1))return true;
        undoCreate(batch);
      }
      for(const correction of voids)if(pending.has(correction.id)&&canVoid(correction)){
        correct(correction,1);pending.delete(correction.id);
        if(replay(index))return true;
        pending.add(correction.id);correct(correction,-1);
        if(exhausted)break;
      }
      return false;
    };
    if(!replay(0))fail(exhausted?'备份同一毫秒内的层级事件过多，无法安全确认登记及作废顺序。':'备份半成品分配与登记时的 FIFO、数量、成本或原料组成不一致。');
  }
}
