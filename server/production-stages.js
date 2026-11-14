import { operationInput } from './process-routes.js';
import { validateStageReceipts, migrateStageReceipts, stageEventTime, stageReceiptDocument, receiptTransfers, receiptTransferComponents, installStageReceipts } from './production-stage-receipts.js';
import { operationAllocation } from '../shared/operation-overflow.js';
import { stagePoolPaths, productionPoolOrder, pooledProductionStages, productionPoolPathMap } from '../shared/production-pools.js';
import { productionRegistrationGroup } from './production-access.js';
import { assertOutputOpen, reopenAfterRootOutputVoid } from './post-processing.js';
import { assertOperationsFinished, recordOperationOutput, voidOperationOutput } from './process-routes.js';
import { deriveProductionStages, stageDisplayStandardQuantity, productionStageItems, stageInputCanBeZero } from '../shared/production-stages.js';
import { addQuantity, materialQuantity, validQuantity, validStoredQuantity, quantityUnits, QUANTITY_SCALE } from '../shared/quantity.js';
import { allocate } from './commerce.js';
import { hasPermission } from '../shared/permissions.js';
import { assertNoPendingMaterials } from './production-materials.js';
import { createProductionReceipt, assertReceiptReversalPermission, voidProductionReceipt } from './production-receipts.js';
import { validateScrapActuals, scrapExpectedQuantity } from '../shared/scrap.js';
import { exactQuantity, exactAdd, exactSubtract, exactMultiply, exactDivide, exactCompare, exactMin, exactNumber, exactSum, exactRatio, quantityFields, parseProductionQuantity as parseExactQuantity, validExactQuantity } from '../shared/exact-quantity.js';
import { saveExactQuantity } from './exact-quantity.js';
import { finalizeProductionQuantities, reopenProductionQuantities } from './production-rounding.js';
export { deriveProductionStages };
export const productionStageTables = ['production_stages','production_stage_batches','production_stage_inputs','production_stage_allocations','production_stage_components','production_stage_allocation_components','production_stage_receipts'];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), {status}); };
const actor = req => req.operationRegistrar?.registered_by_name || req.user.name || req.user.username;
const sum = exactSum;

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
    migrateStageReceipts(db);
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
    items:(data.production_stage_inputs||[]).filter(i=>i.batch_id===b.id&&i.usage_mode==='stock').map(i=>({...i,...quantityFields(exactQuantity(i), 'actual_quantity')}))}));
}
export function stageBatchRemaining(batch, allocations, allocationComponents) {
  const taken=allocations.filter(a=>a.source_batch_id===batch.id), components=(batch.components||[]).map(c=>{
    const parts=allocationComponents.filter(p=>p.product_id===c.product_id&&taken.some(a=>a.id===p.allocation_id));
    return {...c,...quantityFields(exactSubtract(exactQuantity(c),sum(parts,'quantity'))),cost_cents:c.cost_cents-parts.reduce((n,p)=>n+p.cost_cents,0)};
  });
  return {...quantityFields(exactSubtract(exactQuantity(batch, 'completed_quantity'),sum(taken,'quantity'))),cost_cents:batch.total_cost_cents-taken.reduce((n,a)=>n+a.cost_cents,0),components};
}
// Largest-remainder apportionment makes component cents sum to the batch allocation.
export function allocateStageComponents(components, quantity, remainingQuantity, targetCost) {
  const [q, denominator] = exactRatio(exactDivide(quantity, remainingQuantity));
  const rows=components.map(c=>{const numerator=BigInt(c.cost_cents)*q;return {...c,
    ...quantityFields(exactMultiply(exactQuantity(c), exactDivide(quantity, remainingQuantity))),
    cost_cents:Number(numerator/denominator),remainder:numerator%denominator};});
  let extra=targetCost-rows.reduce((n,r)=>n+r.cost_cents,0);
  for(const r of [...rows].sort((a,b)=>a.remainder===b.remainder?a.product_id-b.product_id:a.remainder>b.remainder?-1:1)) if(extra>0&&r.cost_cents<components.find(c=>c.product_id===r.product_id).cost_cents){r.cost_cents++;extra--;}
  if(extra!==0) fail('半成品组成成本分配不守恒。');
  return rows.map(({remainder,...r})=>r);
}
export function stageLedger(db, id) {
  const batches=db.prepare('SELECT * FROM production_stage_batches WHERE production_id=? ORDER BY id').all(id);
  const inputs=db.prepare('SELECT i.* FROM production_stage_inputs i JOIN production_stage_batches b ON b.id=i.batch_id WHERE b.production_id=? ORDER BY i.id').all(id);
  const allocations=db.prepare(`SELECT a.* FROM production_stage_allocations a JOIN production_stage_inputs i ON i.id=a.input_id JOIN production_stage_batches b ON b.id=i.batch_id WHERE b.production_id=? AND b.status='active' ORDER BY a.id`).all(id);
  const ac=db.prepare(`SELECT c.* FROM production_stage_allocation_components c JOIN production_stage_allocations a ON a.id=c.allocation_id JOIN production_stage_inputs i ON i.id=a.input_id JOIN production_stage_batches b ON b.id=i.batch_id WHERE b.production_id=? AND b.status='active'`).all(id);
  for(const b of batches) b.components=db.prepare('SELECT * FROM production_stage_components WHERE batch_id=? ORDER BY product_id').all(b.id);
  const receipts=db.prepare("SELECT * FROM production_stage_receipts WHERE production_id=? AND status!='void' ORDER BY id").all(id);
  return {batches,inputs,allocations:[...allocations,...receiptTransfers(receipts)],allocationComponents:[...ac,...receiptTransferComponents(receipts)],receipts};
}
export function readProductionStages(db, order) {
  if(!order.stage_workflow) return;
  const ledger=stageLedger(db,order.id);
  order.receipt_documents.push(...db.prepare('SELECT id FROM production_stage_receipts WHERE production_id=? ORDER BY id').all(order.id).map(r=>stageReceiptDocument(db,r.id,order.warehouse_id)));
  order.stage_receipt_cost_cents=ledger.receipts.reduce((n,r)=>n+r.total_cost_cents,0);
  order.stage_direct_batches=ledger.batches.map(b=>({...b,items:ledger.inputs.filter(i=>i.batch_id===b.id&&i.usage_mode==='stock').map(i=>({...i,...quantityFields(exactQuantity(i), 'actual_quantity')}))}));
  order.stages=db.prepare('SELECT * FROM production_stages WHERE production_id=? ORDER BY id').all(order.id).map(s=>{
    const batches=ledger.batches.filter(b=>b.path===s.path&&b.status==='active'), remaining=batches.map(b=>stageBatchRemaining(b,ledger.allocations,ledger.allocationComponents));
    const completed=sum(batches,'completed_quantity'), available=sum(remaining,'quantity');
    const receipts=ledger.receipts.filter(r=>batches.some(b=>b.id===r.source_batch_id));
    const transferred=sum(receipts,'quantity');
    const activeIds=new Set(batches.map(b=>b.id));
    const items=productionStageItems(order,s.path).map(n=>{
      let standard_quantity=null;
      try { standard_quantity=stageDisplayStandardQuantity(n,completed); } catch { /* Keep historical actuals readable when cumulative standards exceed limits. */ }
      return {...n,standard_quantity,...quantityFields(sum(ledger.inputs.filter(i=>i.path===n.path&&activeIds.has(i.batch_id)),'quantity'), 'actual_quantity')};
    });
    return {...s,...quantityFields(completed, 'completed_quantity'), ...quantityFields(exactSubtract(exactSubtract(completed,available),transferred), 'consumed_quantity'), ...quantityFields(sum(receipts.filter(r=>r.status==='pending'),'quantity'),'pending_receipt_quantity'), ...quantityFields(sum(receipts.filter(r=>r.status==='confirmed'),'quantity'),'received_quantity'), ...quantityFields(available, 'available_quantity'),
      available_cost_cents:remaining.reduce((n,r)=>n+r.cost_cents,0),items};
  });
  order.direct_material_cost_cents=order.stage_direct_batches.filter(b=>b.status==='active').reduce((n,b)=>n+b.items.reduce((n,i)=>n+i.cost_cents,0),0);
  order.work_in_progress_cost_cents=order.stages.filter(s=>s.path!=='').reduce((n,s)=>n+s.available_cost_cents,0);
  const byBatch=new Map(ledger.batches.map(b=>[b.id,b])),byInput=new Map(ledger.inputs.map(i=>[i.id,i]));
  const byStage=new Map(order.stages.map(s=>[s.path,s])),usages=new Map();
  for(const allocation of ledger.allocations.filter(a=>!a.receipt)){
    const consumer=byBatch.get(byInput.get(allocation.input_id).batch_id),source=byBatch.get(allocation.source_batch_id);
    const destinations=usages.get(source.path)||new Map(),prior=destinations.get(consumer.path);
    destinations.set(consumer.path,{path:consumer.path,name:byStage.get(consumer.path).name,...quantityFields(exactAdd(exactQuantity(prior),exactQuantity(allocation)))});
    usages.set(source.path,destinations);
  }
  for(const stage of order.stages)stage.pool_usages=[...(usages.get(stage.path)?.values()||[])];
  if(!Number.isSafeInteger(order.direct_material_cost_cents)||!Number.isSafeInteger(order.work_in_progress_cost_cents))fail('分层生产累计成本超出范围。');
}
export function populateStageBalances(order) {
  if(!order.stage_workflow)return;
  const pools=productionPoolPathMap(order),byStage=new Map(order.stages.map(s=>[s.path,s]));
  for(const stage of order.stages)stage.items=stage.items.map(n=>({...n,...quantityFields(n.usage_mode==='explode'?sum((pools.get(n.path)||[n.path]).map(path=>byStage.get(path)),'available_quantity'):exactQuantity(order.items.find(i=>i.product_id===n.product_id),'available_quantity'),'available_quantity')}));
  order.stage_pools=pooledProductionStages(order).filter(stage=>stage.pool_paths);
}
export function assertStagesFinished(order) {
  if(order.receipt_documents?.some(d=>d.kind==='stage'&&d.status==='pending'))fail('仍有半成品待入库，请先由仓库批准或取消申请。',409);
  const remaining=(order.stages||[]).filter(s=>s.path!==''&&exactCompare(exactQuantity(s, 'available_quantity'), 0)!==0);
  if(remaining.length)fail(`仍有本单半成品余额：${remaining.map(s=>`${s.name}［${s.path}］${s.available_quantity} ${s.unit}`).join('、')}。请继续登记或将剩余半成品申请入库。`,409);
}
export function deleteProductionStages(db,id) {
  const scope=id===undefined?'':` WHERE b.production_id=${Number(id)}`;
  db.exec(`DELETE FROM production_stage_receipts${id===undefined?'':` WHERE production_id=${Number(id)}`};
    DELETE FROM production_stage_allocation_components WHERE allocation_id IN (SELECT a.id FROM production_stage_allocations a JOIN production_stage_inputs i ON i.id=a.input_id JOIN production_stage_batches b ON b.id=i.batch_id${scope});
    DELETE FROM production_stage_allocations WHERE input_id IN (SELECT i.id FROM production_stage_inputs i JOIN production_stage_batches b ON b.id=i.batch_id${scope});
    DELETE FROM production_stage_components WHERE batch_id IN (SELECT b.id FROM production_stage_batches b${scope});
    DELETE FROM production_stage_inputs WHERE batch_id IN (SELECT b.id FROM production_stage_batches b${scope});
    DELETE FROM production_stage_batches${id===undefined?'':` WHERE production_id=${Number(id)}`};
    DELETE FROM production_stages${id===undefined?'':` WHERE production_id=${Number(id)}`};`);
}

export function installProductionStages(app,db,{route,current,version,units,updateBatchTotals,reverseBatch,stockBefore,notifyStockChanges}) {
  installStageReceipts(app,db,{route,current,version});
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
    const paths=stagePoolPaths(o,path),ledger=stageLedger(db,o.id),all=ledger.batches.filter(b=>paths.includes(b.path)),total=all.length;
    const batches=all.slice(Number(offset),Number(offset)+Number(limit)).map(b=>({...b,items:ledger.inputs.filter(i=>i.batch_id===b.id).map(i=>({...productionStageItems(o,b.path).find(n=>n.path===i.path),...i,...quantityFields(exactQuantity(i), 'actual_quantity'),
      allocations:db.prepare('SELECT a.*,b.path AS source_path,b.batch_number AS source_batch_number FROM production_stage_allocations a JOIN production_stage_batches b ON b.id=a.source_batch_id WHERE a.input_id=? ORDER BY a.id').all(i.id)}))}));
    return {batches,total,has_more:Number(offset)+batches.length<total};
  }));
  const completeStage = req=>{
    const o=stageOrder(req); version(req,o);units(o);
    if(o.status!=='in_progress')fail('请先开始生产并由仓库批准领料后登记。',409);
    const s=o.stages.find(s=>s.path===req.body.path);if(!s)fail('生产层不存在。',404);
    if(s.path===''&&!req.operationRegistrar)assertOutputOpen(o);
    if(!validExactQuantity(parseExactQuantity(req.body.completed_quantity,true),true)||req.body.note!==undefined&&(typeof req.body.note!=='string'||req.body.note.length>500)||typeof req.body.finish_order!=='boolean')fail('请核对本批产量、备注及继续生产选项。');
    if(s.path!==''&&(req.body.finish_order||req.body.scraps?.length))fail('半成品层只能登记继续，不登记废料或结束整单。');
    if (Array.isArray(req.body.items)) {
      const supplied = new Set(req.body.items.map(item => item?.path));
      const postOnly = new Set(o.items.filter(item => item.is_post_processing_only).map(item => item.product_id));
      req.body.items = [...req.body.items, ...s.items.filter(item => (postOnly.has(item.product_id) || req.operationRegistrar) && item.is_supplemental_input && !supplied.has(item.path))
        .map(item => ({ path: item.path, quantity: 0 }))];
    }
    if(!Array.isArray(req.body.items)||req.body.items.length!==s.items.length||new Set(req.body.items.map(i=>i?.path)).size!==s.items.length)fail('请核对全部直属投入，路径不能重复或增删。');
    const actuals=s.items.map(n=>{const a=req.body.items.find(i=>i?.path===n.path);if(!a||!validExactQuantity(parseExactQuantity(a.quantity,!stageInputCanBeZero(n,s.items)),!stageInputCanBeZero(n,s.items))||a.variance_reason!==undefined&&(typeof a.variance_reason!=='string'||a.variance_reason.length>500))fail('直属投入需为有效数量且最多 4 位小数；有库存投入的半成品允许本单投入为零。');
      const p=db.prepare('SELECT * FROM products WHERE id=?').get(n.product_id);if(!p||p.warehouse_id!==o.warehouse_id||p.unit!==n.unit||p.unit_round_up!==n.unit_round_up)fail(`${n.name}单位或取整规则已变化。`,409);if(!p.active)fail(`${n.name}已停用。`);
      return {...n, ...quantityFields(parseExactQuantity(a.quantity,!stageInputCanBeZero(n,s.items))),variance_reason:(a.variance_reason||'').trim()};});
    if(!actuals.some(a=>a.quantity>0))fail('至少一种直属投入需大于零。');
    const output=db.prepare('SELECT * FROM products WHERE id=?').get(s.product_id);if(output.unit!==s.unit||output.unit_round_up!==s.unit_round_up||!output.active)fail('本层产品已停用或单位、取整规则已变化。',409);
    const q=parseExactQuantity(req.body.completed_quantity,true),ledger=stageLedger(db,o.id),count=ledger.batches.filter(b=>b.path===s.path).length,pools=productionPoolPathMap(o);
    if(count>=1000||ledger.batches.length>=10000)fail('层级批次达到上限（每层 1000 批、整单 10000 批，含作废），请拆分生产单。');
    if(!validExactQuantity(exactAdd(exactQuantity(s, 'completed_quantity'),q),true))fail('累计产量超出范围。');
    if (s.path === '') validateScrapActuals(req.body.scraps??[],o.scraps);
    operationInput(db,req,o,s.path,q,true);
    if (req.registrationValidation) return;
    const registrationGroup=req.operationRegistrar ? {id:req.operationRegistrar.production_group_id,name:req.operationRegistrar.production_group_name} : productionRegistrationGroup(req.user,o);
    const at=stageEventTime(db,o.id),owner=actor(req),components=new Map(),pool=new Map(o.items.map(i=>[i.product_id,{...quantityFields(exactQuantity(i,'available_quantity')),cost_cents:i.available_cost_cents}]));
    const id=Number(db.prepare(`INSERT INTO production_stage_batches(production_id,stage_id,path,batch_number,completed_quantity,total_cost_cents,note,created_by,created_by_name,production_group_id,production_group_name,created_at) VALUES (?,?,?,?,?,0,?,?,?,?,?,?)`).run(o.id,s.id,s.path,count+1,exactNumber(q),(req.body.note||'').trim(),req.operationRegistrar ? req.operationRegistrar.registered_by : req.user.id,owner,registrationGroup.id,registrationGroup.name,at).lastInsertRowid);
    saveExactQuantity(db, 'production_stage_batches', id, 'completed_quantity', q);
    const merge=c=>{const prev=components.get(c.product_id)||{product_id:c.product_id,quantity:0,cost_cents:0};Object.assign(prev, quantityFields(exactAdd(exactQuantity(prev),exactQuantity(c))));prev.cost_cents+=c.cost_cents;if(!validExactQuantity(exactQuantity(prev))||!Number.isSafeInteger(prev.cost_cents))fail('原料组成累计超出范围。');components.set(c.product_id,prev);};
    let total=0;
    for(const a of actuals){
      let cost=0;const splits=[];
      if(a.usage_mode==='stock'){const p=pool.get(a.product_id);if(exactCompare(exactQuantity(a),exactQuantity(p))>0)fail(`${a.name}已领未耗余额不足（当前 ${p.quantity} ${a.unit}）。请补料或核对实际投入。`);cost=a.quantity?allocate(p.cost_cents,exactQuantity(a),exactQuantity(p)):0;Object.assign(p,quantityFields(exactSubtract(exactQuantity(p),exactQuantity(a))));p.cost_cents-=cost;merge({product_id:a.product_id,...quantityFields(exactQuantity(a)),cost_cents:cost});}
      else {
        const sourcePaths=pools.get(a.path)||[a.path];
        let need=exactQuantity(a);for(const source of ledger.batches.filter(b=>sourcePaths.includes(b.path)&&b.status==='active')){if(exactCompare(need,0)===0)break;const left=stageBatchRemaining(source,ledger.allocations,ledger.allocationComponents);if(exactCompare(exactQuantity(left),0)===0)continue;
          const used=exactMin(need,exactQuantity(left)),c=allocate(left.cost_cents,used,exactQuantity(left)),parts=allocateStageComponents(left.components,used,exactQuantity(left),c);splits.push({source,...quantityFields(used),cost_cents:c,parts});cost+=c;need=exactSubtract(need,used);}
        if(exactCompare(need,0)>0)fail(`${a.name}来源层［${a.path}］半成品余额不足（还缺 ${need} ${a.unit}），请先登记下层生产。`);
      }
      const inputId=Number(db.prepare('INSERT INTO production_stage_inputs(batch_id,path,product_id,usage_mode,quantity,cost_cents,variance_reason) VALUES (?,?,?,?,?,?,?)').run(id,a.path,a.product_id,a.usage_mode,a.quantity,cost,a.variance_reason).lastInsertRowid);
      saveExactQuantity(db, 'production_stage_inputs', inputId, 'quantity', exactQuantity(a));
      for(const split of splits){const aid=Number(db.prepare('INSERT INTO production_stage_allocations(input_id,source_batch_id,quantity,cost_cents) VALUES (?,?,?,?)').run(inputId,split.source.id,split.quantity,split.cost_cents).lastInsertRowid);
        saveExactQuantity(db,'production_stage_allocations',aid,'quantity',exactQuantity(split));
        ledger.allocations.push({id:aid,input_id:inputId,source_batch_id:split.source.id,...quantityFields(exactQuantity(split)),cost_cents:split.cost_cents});
        for(const c of split.parts){db.prepare('INSERT INTO production_stage_allocation_components(allocation_id,product_id,quantity,cost_cents) VALUES (?,?,?,?)').run(aid,c.product_id,c.quantity,c.cost_cents);saveExactQuantity(db,'production_stage_allocation_components',db.prepare('SELECT id FROM production_stage_allocation_components WHERE allocation_id=? AND product_id=?').get(aid,c.product_id).id,'quantity',exactQuantity(c));ledger.allocationComponents.push({...c,allocation_id:aid});merge(c);}}
      total+=cost;if(!Number.isSafeInteger(total))fail('本批成本超出范围。');
    }
    for(const c of components.values()) {
      const componentId=Number(db.prepare('INSERT INTO production_stage_components(batch_id,product_id,quantity,cost_cents) VALUES (?,?,?,?)').run(id,c.product_id,c.quantity,c.cost_cents).lastInsertRowid);
      saveExactQuantity(db,'production_stage_components',componentId,'quantity',exactQuantity(c));
    }
    db.prepare('UPDATE production_stage_batches SET total_cost_cents=? WHERE id=?').run(total,id);
    if(s.path===''){
      validateScrapActuals(req.body.scraps??[],o.scraps);const number=(o.batches.at(-1)?.batch_number??0)+1;
      const rootId=Number(db.prepare(`INSERT INTO production_batches(production_id,batch_number,completed_quantity,total_cost_cents,note,created_by_name,created_at,receipt_required,created_by,production_group_id,production_group_name) VALUES (?,?,?,?,?,?,?,1,?,?,?)`).run(o.id,number,exactNumber(q),total,(req.body.note||'').trim(),owner,at,req.operationRegistrar ? req.operationRegistrar.registered_by : req.user.id,registrationGroup.id,registrationGroup.name).lastInsertRowid);
      saveExactQuantity(db,'production_batches',rootId,'completed_quantity',q);
      for(const item of o.items){const c=components.get(item.product_id)||{quantity:0,cost_cents:0};db.prepare('INSERT INTO production_batch_items(batch_id,product_id,actual_quantity,cost_cents,variance_reason) VALUES (?,?,?,?,?)').run(rootId,item.product_id,c.quantity,c.cost_cents,actuals.filter(a=>a.product_id===item.product_id&&a.usage_mode==='stock').map(a=>a.variance_reason).filter(Boolean).join('；'));saveExactQuantity(db,'production_batch_items',db.prepare('SELECT id FROM production_batch_items WHERE batch_id=? AND product_id=?').get(rootId,item.product_id).id,'actual_quantity',exactQuantity(c));}
      for(const rule of o.scraps) {
        const actual=req.body.scraps.find(a=>a.product_id===rule.product_id),quantity=parseExactQuantity(actual.quantity);
        const expected=scrapExpectedQuantity(rule,q,o.base_quantity,actuals.filter(a=>a.usage_mode==='stock').map(a=>({product_id:a.product_id,quantity:exactQuantity(a)})),o.quantity_decimals);
        const scrapId=Number(db.prepare('INSERT INTO production_batch_scraps(batch_id,product_id,expected_quantity,actual_quantity,disposition) VALUES (?,?,?,?,?)').run(rootId,rule.product_id,exactNumber(expected),exactNumber(quantity),actual.disposition).lastInsertRowid);
        saveExactQuantity(db,'production_batch_scraps',scrapId,'actual_quantity',quantity);
        saveExactQuantity(db,'production_batch_scraps',scrapId,'expected_quantity',expected);
      }
      db.prepare('UPDATE production_stage_batches SET root_batch_id=? WHERE id=?').run(rootId,id);createProductionReceipt(db,req,o,rootId);updateBatchTotals(db,o,'draft',owner,at);
    }else db.prepare('UPDATE production_orders SET updated_by_name=?,updated_at=? WHERE id=?').run(owner,at,o.id);
    recordOperationOutput(db,req,o,s.path,q,'stage',id);
    if(req.body.finish_order){const fresh=current(req);assertNoPendingMaterials(db,fresh);assertOperationsFinished(db,o.id);assertStagesFinished(fresh);finalizeProductionQuantities(db,req,fresh);db.prepare("UPDATE production_orders SET status='completed',updated_by_name=?,updated_at=? WHERE id=?").run(owner,at,o.id);}
    return current(req);
  };
  app.post('/api/production-orders/:id/stages/complete',route(req=>{
    if (req.body.auto_overflow !== true) return completeStage(req);
    const order = stageOrder(req); version(req, order);
    if (req.body.finish_order !== false) fail('自动分配登记必须继续生产。');
    const allocations = operationAllocation(order, req.body.path, req.body.operation_node_id, req.body.completed_quantity);
    if (!Array.isArray(req.body.allocations) || req.body.allocations.length !== allocations.length) fail('请核对工序分配明细。');
    for (const [index, allocation] of allocations.entries()) {
      const actual = req.body.allocations[index];
      if (!actual || actual.path !== allocation.path || actual.quantity !== allocation.quantity) fail('工序分配已变化，请刷新后核对。',409);
      const fresh = current(req);
      completeStage({ ...req, body: { ...req.body, auto_overflow: false, version: fresh.version,
        path: allocation.path, operation_node_id: allocation.node_id, completed_quantity: allocation.quantity,
        items: actual.items, scraps: req.body.scraps } });
    }
    if (req.registrationValidation) return;
    return current(req);
  },true,undefined,'stages/complete'));
  app.post('/api/production-orders/:id/stages/batches/:batchId/void',route(req=>{
    const o=stageOrder(req);version(req,o);if(o.status==='void')fail('生产单已经作废。',409);
    const b=stageBatch(o,req.params.batchId);if(b.status!=='active')fail('层级批次已经作废。',409);
    const stage=o.stages.find(s=>s.path===b.path);
    for(const n of [stage,...stage.items]){const p=db.prepare('SELECT unit,unit_round_up FROM products WHERE id=?').get(n.product_id);if(!p||p.unit!==n.unit||p.unit_round_up!==n.unit_round_up)fail(`${n.name}单位或取整规则已变化，无法按原快照作废。`,409);}
    if(typeof req.body.reason!=='string'||!req.body.reason.trim()||req.body.reason.length>500)fail('请填写作废原因（最多 500 字）。');
    if(db.prepare("SELECT 1 FROM production_stage_receipts WHERE source_batch_id=? AND status!='void'").get(b.id))fail('此批次有半成品入库申请，请先取消或作废入库单。',409);
    const dependents=db.prepare(`SELECT DISTINCT b.path,b.batch_number FROM production_stage_allocations a JOIN production_stage_inputs i ON i.id=a.input_id JOIN production_stage_batches b ON b.id=i.batch_id WHERE a.source_batch_id=? AND b.status='active'`).all(b.id);
    if(dependents.length)fail(`此批次已被上层使用，请先作废上层批次：${dependents.map(d=>`［${d.path||'根层'}］第 ${d.batch_number} 批`).join('、')}。`,409);
    if(b.root_batch_id)reopenAfterRootOutputVoid(db,o,o.batches.find(root=>root.id===b.root_batch_id));
    reopenProductionQuantities(db,req,o);
    const at=stageEventTime(db,o.id),owner=actor(req),why=req.body.reason.trim();
    if(b.root_batch_id){const root=o.batches.find(r=>r.id===b.root_batch_id),before=stockBefore(o);units(o,false);reverseBatch(req,o,root);voidProductionReceipt(db,root.id,owner,at,why);db.prepare("UPDATE production_batches SET status='void',voided_by_name=?,voided_at=?,void_reason=? WHERE id=?").run(owner,at,why,root.id);notifyStockChanges(db,req,before,{production_id:o.id,number:o.number,batch_id:root.id});}
    voidOperationOutput(db,'stage',b.id,owner,at,why);
    db.prepare("UPDATE production_stage_batches SET status='void',voided_by_name=?,voided_at=?,void_reason=? WHERE id=?").run(owner,at,why,b.id);updateBatchTotals(db,o,'draft',owner,at);return current(req);
  },true,req=>{if(!hasPermission(req.user,'production')||!hasPermission(req.user,'corrections'))fail('需要生产管理和单据纠正权限。',403);const o=stageOrder(req),b=stageBatch(o,req.params.batchId);if(b.root_batch_id)assertReceiptReversalPermission(db,req,o.batches.find(r=>r.id===b.root_batch_id));}));
}

// Used by restore before any rows are written. Validate each immutable transfer
// and the live ledger independently; a balanced root summary cannot hide WIP.
export function validateProductionStageBackup(data) {
  validateStageReceipts(data);
  const liveReceipts=(data.production_stage_receipts||[]).filter(r=>r.status!=='void');
  const receiptAllocations=receiptTransfers(liveReceipts),receiptParts=receiptTransferComponents(liveReceipts);
  const money=n=>Number.isSafeInteger(n)&&n>=0;
  const text=(s,max,required=false)=>typeof s==='string'&&s.length<=max&&(!required||!!s.trim());
  const date=s=>text(s,100,true)&&Number.isFinite(Date.parse(s));
  const orders=new Map(data.production_orders.map(o=>[o.id,o]));
  const tables=Object.fromEntries(productionStageTables.map(t=>[t,data[t]||[]]));
  const keyed=t=>{const rows=tables[t],m=new Map(rows.map(r=>[r.id,r]));if(m.size!==rows.length||rows.some(r=>!Number.isSafeInteger(r.id)||r.id<1))fail('备份分层记录编号无效或重复。');return m;};
  const stages=keyed('production_stages'), batches=keyed('production_stage_batches'),inputs=keyed('production_stage_inputs'),allocations=keyed('production_stage_allocations');
  const poolOrders=new Map([...orders.values()].map(order=>[order.id,productionPoolPathMap(productionPoolOrder(data,order))]));
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
      !validExactQuantity(exactQuantity(b,'completed_quantity'),true)||!money(b.total_cost_cents)||!['active','void'].includes(b.status)||
      !text(b.note,500)||!text(b.created_by_name,60,true)||!date(b.created_at)||!text(b.production_group_name,100)||!text(b.voided_by_name,60)||!text(b.void_reason,500)||
      (b.status==='active'?(b.voided_at!==null||b.voided_by_name!==''||b.void_reason!=='') : !date(b.voided_at)||!b.voided_by_name.trim()||!b.void_reason.trim())||order.status==='void'&&b.status==='active')fail('备份层级批次字段、状态或归属无效。');
    unique.add(k);
    if(b.path===''){
      if(!root||rootIds.has(root.id)||root.production_id!==b.production_id||exactCompare(exactQuantity(root,'completed_quantity'),exactQuantity(b,'completed_quantity'))!==0||['completed_quantity','total_cost_cents','status','note','created_by_name','created_at','voided_by_name','voided_at','void_reason','production_group_id','production_group_name'].some(k=>root[k]!==b[k])||root.receipt_required!==1)fail('备份根层与成品批次不一致。');
      rootIds.add(root.id);
    }else if(b.root_batch_id!==null)fail('半成品批次不能关联仓库成品批次。');
    const nodes=data.production_bom_nodes.filter(n=>n.production_id===order.id&&n.parent_path===b.path),rows=[...inputs.values()].filter(i=>i.batch_id===b.id);
    if(nodes.some(node=>!rows.some(row=>row.path===node.path))||!rows.some(i=>i.quantity>0))fail('备份直属投入不完整。');
    if(rows.reduce((n,i)=>n+i.cost_cents,0)!==b.total_cost_cents)fail('备份层级批次投入成本不一致。');
  }
  for(const i of inputs.values()){
    const b=batches.get(i.batch_id), order=b&&orders.get(b.production_id);
    const choices=b?productionStageItems({...order,nodes:data.production_bom_nodes.filter(n=>n.production_id===order.id),items:data.production_items.filter(item=>item.production_id===order.id)},b.path):[];
    const node=choices.find(n=>n.path===i.path),k=`input:${i.batch_id}:${i.path}`;
    if(!b||!node||unique.has(k)||i.product_id!==node.product_id||i.usage_mode!==node.usage_mode||!validExactQuantity(exactQuantity(i),!stageInputCanBeZero(node,choices))||!money(i.cost_cents)||i.quantity===0&&i.cost_cents!==0||!text(i.variance_reason,500))fail('备份层级直属投入无效。');
    unique.add(k);const parts=[...allocations.values()].filter(a=>a.input_id===i.id);
    if(i.usage_mode==='stock'?parts.length!==0:(i.quantity>0&&!parts.length)||exactCompare(sum(parts,'quantity'),exactQuantity(i))!==0||parts.reduce((n,a)=>n+a.cost_cents,0)!==i.cost_cents)fail('备份半成品分配与投入不一致。');
  }
  for(const a of allocations.values()){
    const i=inputs.get(a.input_id),consumer=i&&batches.get(i.batch_id),source=batches.get(a.source_batch_id),k=`allocation:${a.input_id}:${a.source_batch_id}`;
    if(!i||i.usage_mode!=='explode'||!source||!consumer||unique.has(k)||source.production_id!==consumer.production_id||!(poolOrders.get(consumer.production_id).get(i.path)||[i.path]).includes(source.path)||source.id>=consumer.id||source.created_at>consumer.created_at||
      !validExactQuantity(exactQuantity(a),true)||exactCompare(exactQuantity(a),exactQuantity(source,'completed_quantity'))>0||!money(a.cost_cents)||a.cost_cents>source.total_cost_cents||consumer.status==='active'&&source.status!=='active')fail('备份半成品来源跨单、层级或状态依赖无效。');
    unique.add(k);const parts=tables.production_stage_allocation_components.filter(c=>c.allocation_id===a.id);
    if(!parts.length||parts.reduce((n,c)=>n+c.cost_cents,0)!==a.cost_cents)fail('备份半成品分配组成成本不一致。');
    const sourceParts=tables.production_stage_components.filter(c=>c.batch_id===source.id);
    if(parts.length!==sourceParts.length||parts.some(c=>{const p=sourceParts.find(p=>p.product_id===c.product_id);return !p||exactCompare(exactQuantity(c),exactQuantity(p))>0||c.cost_cents>p.cost_cents;}))fail('备份半成品分配原料组成不完整或超额。');
  }
  for(const [table,parentKey,parentMap] of [['production_stage_components','batch_id',batches],['production_stage_allocation_components','allocation_id',allocations]])for(const c of tables[table]){
    const parent=parentMap.get(c[parentKey]),batch=table==='production_stage_components'?parent:parent&&batches.get(inputs.get(parent.input_id)?.batch_id),k=`${table}:${c[parentKey]}:${c.product_id}`;
    if(!parent||!batch||unique.has(k)||!data.production_items.some(i=>i.production_id===batch.production_id&&i.product_id===c.product_id)||!validExactQuantity(exactQuantity(c))||!money(c.cost_cents))fail('备份分层原料组成无效。');
    unique.add(k);
  }
  for(const b of batches.values()){
    const components=tables.production_stage_components.filter(c=>c.batch_id===b.id),expected=new Map();
    const merge=c=>{const p=expected.get(c.product_id)||{quantity:0,cost_cents:0};Object.assign(p,quantityFields(exactAdd(exactQuantity(p),exactQuantity(c))));p.cost_cents+=c.cost_cents;expected.set(c.product_id,p);};
    for(const i of [...inputs.values()].filter(i=>i.batch_id===b.id))if(i.usage_mode==='stock')merge(i);else for(const a of [...allocations.values()].filter(a=>a.input_id===i.id))for(const c of tables.production_stage_allocation_components.filter(c=>c.allocation_id===a.id))merge(c);
    if(components.length!==expected.size||components.reduce((n,c)=>n+c.cost_cents,0)!==b.total_cost_cents||components.some(c=>{const e=expected.get(c.product_id);return !e||exactCompare(exactQuantity(c),exactQuantity(e))!==0||c.cost_cents!==e.cost_cents;}))fail('备份层级原料组成不守恒。');
    const live=[...allocations.values()].filter(a=>batches.get(inputs.get(a.input_id).batch_id).status==='active');
    const left=stageBatchRemaining({...b,components},[...live,...receiptAllocations],[...tables.production_stage_allocation_components,...receiptParts]);
    if(b.status==='active'&&(!validExactQuantity(exactQuantity(left))||!money(left.cost_cents)||left.quantity===0&&left.cost_cents!==0||left.components.some(c=>!validExactQuantity(exactQuantity(c))||!money(c.cost_cents)||left.quantity===0&&(c.quantity!==0||c.cost_cents!==0))||left.components.reduce((n,c)=>n+c.cost_cents,0)!==left.cost_cents))fail('备份半成品来源超额分配或数量成本不守恒。');
    if(b.root_batch_id){const orderItems=data.production_items.filter(i=>i.production_id===b.production_id),rootItems=data.production_batch_items.filter(i=>i.batch_id===b.root_batch_id);if(rootItems.length!==orderItems.length||rootItems.some(i=>{const c=components.find(c=>c.product_id===i.product_id)||{quantity:0,cost_cents:0};return exactCompare(exactQuantity(i,'actual_quantity'),exactQuantity(c))!==0||i.cost_cents!==c.cost_cents;}))fail('备份根层原料追溯投影不一致。');}
  }
  for(const o of orders.values())if(o.stage_workflow){
    const active=[...batches.values()].filter(b=>b.production_id===o.id&&b.status==='active'),live=[...allocations.values()].filter(a=>batches.get(inputs.get(a.input_id).batch_id).status==='active');
    const wip=active.filter(b=>b.path!=='').map(b=>stageBatchRemaining({...b,components:tables.production_stage_components.filter(c=>c.batch_id===b.id)},[...live,...receiptAllocations],[...tables.production_stage_allocation_components,...receiptParts]));
    const direct=[...inputs.values()].filter(i=>i.usage_mode==='stock'&&active.some(b=>b.id===i.batch_id)).reduce((n,i)=>n+i.cost_cents,0);
    const root=active.filter(b=>b.path==='').reduce((n,b)=>n+b.total_cost_cents,0);
    if(direct!==root+wip.reduce((n,b)=>n+b.cost_cents,0)+liveReceipts.filter(r=>r.production_id===o.id).reduce((n,r)=>n+r.total_cost_cents,0)||o.status==='completed'&&wip.some(b=>b.quantity!==0))fail('备份整单分层成本或结束状态不守恒。');
  }
  validateStageAllocationHistory(tables,batches,inputs,allocations,poolOrders);
}

// Current balances alone cannot prove an immutable transfer: reducing its
// quantity must also change its cents and raw provenance. Reproduce the source
// balances that existed when each consumer was registered, restoring the exact
// saved shares on correction rather than applying an original batch ratio.
function validateStageAllocationHistory(tables,batches,inputs,allocations,poolOrders) {
  // Replay warehouse transfers as terminal consumers of one exact source batch.
  batches=new Map(batches);inputs=new Map(inputs);allocations=new Map(allocations);
  tables={...tables,production_stage_allocation_components:[...tables.production_stage_allocation_components]};
  let nextBatch=Math.max(0,...batches.keys()),nextInput=Math.max(0,...inputs.keys());
  for(const receipt of tables.production_stage_receipts||[]) {
    const source=batches.get(receipt.source_batch_id),batchId=++nextBatch,inputId=++nextInput;
    batches.set(batchId,{id:batchId,production_id:receipt.production_id,path:`@receipt:${receipt.id}`,completed_quantity:receipt.quantity,completed_quantity_fraction:receipt.quantity_fraction,total_cost_cents:receipt.total_cost_cents,
      status:receipt.status==='void'?'void':'active',created_at:receipt.created_at,voided_at:receipt.voided_at});
    inputs.set(inputId,{id:inputId,batch_id:batchId,path:source.path,usage_mode:'explode',...quantityFields(exactQuantity(receipt)),receipt_source:source.id});
    allocations.set(-receipt.id,{...receiptTransfers([receipt])[0],input_id:inputId});
    tables.production_stage_allocation_components.push(...receiptTransferComponents([receipt]));
  }
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
    Object.assign(left,quantityFields(exactAdd(exactQuantity(left),exactMultiply(direction,exactQuantity(allocation)))));
    left.cost_cents+=direction*allocation.cost_cents;
    for(const part of allocationComponents.get(allocation.id)||[]){
      const component=left.components.get(part.product_id);
      Object.assign(component,quantityFields(exactAdd(exactQuantity(component),exactMultiply(direction,exactQuantity(part)))));
      component.cost_cents+=direction*part.cost_cents;
    }
  };
  const matchesCreation=batch=>{
    const working=new Map();
    for(const input of batchInputs.get(batch.id)||[]){
      if(input.usage_mode!=='explode')continue;
      let needed=exactQuantity(input),index=0;
      const saved=inputAllocations.get(input.id)||[];
      // Historical path-specific FIFO is retained. Cross-path transfers use pool FIFO.
      const paths=saved.some(a=>batches.get(a.source_batch_id).path!==input.path)?poolOrders.get(batch.production_id).get(input.path):[input.path];
      const sources=input.receipt_source?[batches.get(input.receipt_source)]:paths.flatMap(path=>sourceBatches.get(`${batch.production_id}:${path}`)||[]).sort((a,b)=>a.id-b.id);
      for(const source of sources){
        if(exactCompare(needed,0)===0)break;
        if(!live.has(source.id))continue;
        if(!working.has(source.id)) { const original=remaining.get(source.id); working.set(source.id,{...original,components:new Map([...original.components].map(([id,c])=>[id,{...c}]))}); }
        const left=working.get(source.id);
        if(exactCompare(exactQuantity(left),0)===0)continue;
        const quantity=exactMin(needed,exactQuantity(left)),cost=allocate(left.cost_cents,quantity,exactQuantity(left));
        const allocation=saved[index++];
        if(!allocation||allocation.source_batch_id!==source.id||exactCompare(exactQuantity(allocation),quantity)!==0||allocation.cost_cents!==cost)return false;
        const expected=allocateStageComponents([...left.components.values()],quantity,exactQuantity(left),cost);
        const actual=allocationComponents.get(allocation.id)||[];
        if(expected.length!==actual.length||expected.some(e=>{const a=actual.find(a=>a.product_id===e.product_id);return !a||exactCompare(exactQuantity(a),exactQuantity(e))!==0||a.cost_cents!==e.cost_cents;}))return false;
        Object.assign(left,quantityFields(exactSubtract(exactQuantity(left),quantity)));left.cost_cents-=cost;
        for(const part of actual){const component=left.components.get(part.product_id);Object.assign(component,quantityFields(exactSubtract(exactQuantity(component),exactQuantity(part))));component.cost_cents-=part.cost_cents;}
        needed=exactSubtract(needed,quantity);
      }
      if(exactCompare(needed,0)!==0||index!==saved.length)return false;
    }
    return true;
  };
  const create=batch=>{
    remaining.set(batch.id,{...quantityFields(exactQuantity(batch,'completed_quantity')),cost_cents:batch.total_cost_cents,
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
