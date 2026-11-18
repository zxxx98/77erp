import { allocate, moveInventory } from './commerce.js';
import { notifyStockChanges } from './notifications.js';
import { saveExactQuantity } from './exact-quantity.js';
import { stageLedger, allocateStageComponents } from './production-stages.js';
import { materialBalances } from './production-materials.js';
import { readPostMaterialUsage } from './process-routes.js';
import { postMaterialPlanByProduct } from './post-processing-materials.js';
import { productionRounding } from './production-rounding.js';
import { productionPoolPathMap } from '../shared/production-pools.js';
import { productionStageItems, stageInputCanBeZero } from '../shared/production-stages.js';
import { scrapExpectedQuantity } from '../shared/scrap.js';
import {
  exactQuantity,
  exactAdd,
  exactSubtract,
  exactCompare,
  exactMin,
  exactSum,
  exactNumber,
  quantityFields,
  parseProductionQuantity as parseExactQuantity,
  validExactQuantity,
} from '../shared/exact-quantity.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const isId = value => Number.isSafeInteger(value) && value > 0;

function parseVarianceReason(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > 500) fail('复核差异说明最多 500 字。');
  return value.trim();
}

function adjustProductCostForReceipt(db, productId, costDiff, productName) {
  if (!costDiff) return;
  const product = db.prepare('SELECT stock,stock_fraction,inventory_value_cents FROM products WHERE id=?').get(productId);
  if (!product || (exactCompare(exactQuantity(product, 'stock'), 0) === 0 && product.inventory_value_cents + costDiff !== 0)) {
    fail(`${productName}已全部出库且库存成本已结清，不能再调整已入库批次成本。`, 409);
  }
  moveInventory(db, productId, 0, Math.abs(costDiff), costDiff < 0);
}

function syncBatchScrapExpected(db, order, batchId, scrapInputs) {
  for (const rule of order.scraps) {
    const scrap = db.prepare('SELECT id FROM production_batch_scraps WHERE batch_id=? AND product_id=?').get(batchId, rule.product_id);
    if (!scrap) continue;
    const batch = db.prepare('SELECT completed_quantity,completed_quantity_fraction FROM production_batches WHERE id=?').get(batchId);
    const expected = scrapExpectedQuantity(rule, exactQuantity(batch, 'completed_quantity'), order.base_quantity, scrapInputs, order.quantity_decimals);
    db.prepare('UPDATE production_batch_scraps SET expected_quantity=? WHERE id=?').run(exactNumber(expected), scrap.id);
    saveExactQuantity(db, 'production_batch_scraps', scrap.id, 'expected_quantity', expected);
  }
}

function syncRootBatchFromStage(db, order, stageBatch, components) {
  const rootId = stageBatch.root_batch_id;
  if (!rootId) return;
  const rootBefore = db.prepare('SELECT total_cost_cents FROM production_batches WHERE id=?').get(rootId);
  const costDiff = stageBatch.total_cost_cents - rootBefore.total_cost_cents;
  db.prepare('UPDATE production_batches SET total_cost_cents=? WHERE id=?').run(stageBatch.total_cost_cents, rootId);
  const stageInputs = db.prepare("SELECT product_id,quantity,quantity_fraction,usage_mode,variance_reason FROM production_stage_inputs WHERE batch_id=? AND usage_mode='stock'").all(stageBatch.id);
  for (const item of order.items) {
    const comp = components.get(item.product_id) || { quantity: 0, quantity_fraction: '', cost_cents: 0 };
    const reason = stageInputs.filter(row => row.product_id === item.product_id).map(row => row.variance_reason).filter(Boolean).join('；');
    db.prepare('UPDATE production_batch_items SET actual_quantity=?,cost_cents=?,variance_reason=? WHERE batch_id=? AND product_id=?')
      .run(exactNumber(exactQuantity(comp)), comp.cost_cents, reason, rootId, item.product_id);
    const row = db.prepare('SELECT id FROM production_batch_items WHERE batch_id=? AND product_id=?').get(rootId, item.product_id);
    if (row) saveExactQuantity(db, 'production_batch_items', row.id, 'actual_quantity', exactQuantity(comp));
  }
  syncBatchScrapExpected(db, order, rootId, stageInputs.map(row => ({ product_id: row.product_id, quantity: exactQuantity(row) })));
  const receipt = db.prepare('SELECT id,status,total_cost_cents FROM production_receipts WHERE batch_id=?').get(rootId);
  if (receipt) {
    db.prepare('UPDATE production_receipts SET total_cost_cents=? WHERE id=?').run(stageBatch.total_cost_cents, receipt.id);
    db.prepare("UPDATE production_receipt_items SET cost_cents=? WHERE document_id=? AND kind='product'").run(stageBatch.total_cost_cents, receipt.id);
    if (receipt.status === 'confirmed' && costDiff !== 0) adjustProductCostForReceipt(db, order.product_id, costDiff, order.product_name);
  }
}

function applyQuantityDelta({ rows, targetQty, canReduceRow, canZeroOutBatch, onDelta, label }) {
  const currentTotal = exactSum(rows, 'qty');
  const diff = exactSubtract(targetQty, currentTotal);
  if (exactCompare(diff, 0) === 0) return false;
  if (exactCompare(diff, 0) > 0) {
    const receiver = rows.find(row => row.preferReceive) || rows.at(-1);
    onDelta(receiver, diff);
    return true;
  }
  let need = exactSubtract(0, diff);
  const ordered = [
    ...rows.filter(row => row.preferReduce).reverse(),
    ...rows.filter(row => !row.preferReduce).reverse(),
  ];
  for (const pass of [1, 2]) {
    for (const row of ordered) {
      if (exactCompare(need, 0) === 0) break;
      const available = row.qty;
      if (exactCompare(available, 0) <= 0) continue;
      if (pass === 1 && !canReduceRow(row)) continue;
      if (row.mustStayPositive || !canZeroOutBatch(row)) {
        const minLeave = exactCompare(available, 0.0001) <= 0 ? available : 0.0001;
        const maxTake = exactSubtract(available, minLeave);
        if (exactCompare(maxTake, 0) <= 0) continue;
        const take = exactMin(need, maxTake);
        onDelta(row, exactSubtract(0, take));
        need = exactSubtract(need, take);
      } else {
        const take = exactMin(need, available);
        onDelta(row, exactSubtract(0, take));
        need = exactSubtract(need, take);
      }
    }
  }
  if (exactCompare(need, 0) > 0) fail(`${label}复核数量过低，需保证每个有效批次至少保留必耗或大于 0 的耗料。`);
  return true;
}

function reviewNonStageOrder(db, req, order, { stockBefore, actor, updateBatchTotals }) {
  const entries = req.body.items;
  if (!Array.isArray(entries) || entries.length > order.items.length || new Set(entries.map(row => row?.product_id)).size !== entries.length) {
    fail('请核对复核材料明细，材料不能重复或超出本生产单范围。');
  }
  const activeBatches = order.batches.filter(batch => batch.status === 'active');
  if (!activeBatches.length) fail('请先登记至少一个有效完工批次后再复核。', 409);

  const byProduct = new Map(order.items.map(item => [item.product_id, item]));
  const parsed = entries.map(row => {
    const item = isId(row?.product_id) && byProduct.get(row.product_id);
    if (!item) fail('材料需属于本生产单。');
    const quantity = parseExactQuantity(row.quantity, false);
    if (!validExactQuantity(quantity, false)) fail('复核耗料需为非负数且最多 4 位小数。');
    const variance_reason = parseVarianceReason(row.variance_reason);
    const recorded = exactSum(
      activeBatches.map(batch => batch.items.find(entry => entry.product_id === item.product_id)).filter(Boolean),
      'actual_quantity',
    );
    if (item.is_post_processing_only && exactCompare(quantity, recorded) !== 0) {
      fail(`${item.name}为后处理固定耗料，请在后处理工序中核对，不能在复核单修改。`);
    }
    return { item, quantity, recorded, variance_reason };
  });

  const plannedTargets = new Map(order.items.map(item => [
    item.product_id,
    parsed.find(entry => entry.item.product_id === item.product_id)?.quantity
      ?? exactSum(activeBatches.map(batch => batch.items.find(entry => entry.product_id === item.product_id)).filter(Boolean), 'actual_quantity'),
  ]));
  if (![...plannedTargets.values()].some(quantity => exactCompare(quantity, 0) > 0)) {
    fail('至少一种材料的实际耗料需大于零。');
  }

  const before = stockBefore(order);
  const workingBatches = activeBatches.map(batch => ({
    ...batch,
    items: batch.items.map(row => ({
      ...row,
      qty: exactQuantity(row, 'actual_quantity'),
      cost_cents: row.cost_cents,
      touched: false,
    })),
    touched: false,
  }));

  for (const entry of parsed) {
    const { item, quantity, recorded, variance_reason } = entry;
    const diff = exactSubtract(quantity, recorded);
    if (exactCompare(diff, 0) > 0) {
      const available = order.material_workflow ? exactQuantity(item, 'available_quantity') : exactQuantity(item.product, 'stock');
      if (exactCompare(diff, available) > 0) {
        fail(`${item.name}${order.material_workflow ? '已领未耗余额' : '库存'}不足（当前 ${available} ${item.unit}）。请先补料或核对复核耗料。`);
      }
    }

    const rowRefs = workingBatches.map(batch => {
      const row = batch.items.find(itemRow => itemRow.product_id === item.product_id);
      return {
        batch,
        row,
        get qty() { return row.qty; },
        preferReceive: batch.receipt_status === 'pending',
        preferReduce: batch.receipt_status === 'pending',
        mustStayPositive: false,
      };
    });

    if (exactCompare(diff, 0) === 0) {
      if (variance_reason !== undefined && variance_reason !== '') {
        const target = rowRefs.at(-1);
        target.row.variance_reason = variance_reason;
        target.row.touched = true;
        target.batch.touched = true;
      }
      continue;
    }

    let poolAvailable = order.material_workflow ? exactQuantity(item, 'available_quantity') : 0;
    let poolCost = order.material_workflow ? item.available_cost_cents : 0;

    applyQuantityDelta({
      rows: rowRefs,
      targetQty: quantity,
      canReduceRow: ref => ref.batch.items.some(other => other.product_id !== item.product_id && exactCompare(other.qty, 0) > 0),
      canZeroOutBatch: ref => ref.batch.items.some(other => other.product_id !== item.product_id && exactCompare(other.qty, 0) > 0),
      label: item.name,
      onDelta: (ref, delta) => {
        if (exactCompare(delta, 0) > 0) {
          const addedCost = order.material_workflow
            ? allocate(poolCost, delta, poolAvailable)
            : moveInventory(db, item.product_id, exactSubtract(0, delta));
          if (order.material_workflow) {
            poolAvailable = exactSubtract(poolAvailable, delta);
            poolCost -= addedCost;
          }
          ref.row.qty = exactAdd(ref.row.qty, delta);
          ref.row.cost_cents += addedCost;
        } else {
          const take = exactSubtract(0, delta);
          const refundCost = exactCompare(take, ref.row.qty) === 0
            ? ref.row.cost_cents
            : allocate(ref.row.cost_cents, take, ref.row.qty);
          if (!order.material_workflow) {
            moveInventory(db, item.product_id, take, refundCost);
          } else {
            poolAvailable = exactAdd(poolAvailable, take);
            poolCost += refundCost;
          }
          ref.row.qty = exactSubtract(ref.row.qty, take);
          ref.row.cost_cents -= refundCost;
        }
        if (variance_reason !== undefined) ref.row.variance_reason = variance_reason;
        ref.row.touched = true;
        ref.batch.touched = true;
      },
    });
  }

  const at = new Date().toISOString();
  const owner = actor(req);
  let inventoryTouched = !order.material_workflow;
  for (const batch of workingBatches) {
    if (!batch.items.some(row => exactCompare(row.qty, 0) > 0)) {
      fail(`第 ${batch.batch_number} 批需保留至少一种大于零的材料耗料。`);
    }
    if (!batch.touched) continue;
    for (const row of batch.items) {
      if (!row.touched) continue;
      if (!Number.isSafeInteger(row.cost_cents) || row.cost_cents < 0) fail('材料成本超出范围。');
      db.prepare('UPDATE production_batch_items SET actual_quantity=?,cost_cents=?,variance_reason=? WHERE id=?')
        .run(exactNumber(row.qty), row.cost_cents, row.variance_reason, row.id);
      saveExactQuantity(db, 'production_batch_items', row.id, 'actual_quantity', row.qty);
    }
    const newTotalCost = batch.items.reduce((sum, row) => sum + row.cost_cents, 0);
    if (!Number.isSafeInteger(newTotalCost)) fail('本次材料成本超出范围，请拆分生产单。');
    const costDiff = newTotalCost - batch.total_cost_cents;
    db.prepare('UPDATE production_batches SET total_cost_cents=? WHERE id=?').run(newTotalCost, batch.id);
    syncBatchScrapExpected(db, order, batch.id, batch.items.map(row => ({ product_id: row.product_id, quantity: row.qty })));
    const receipt = db.prepare('SELECT id,status,total_cost_cents FROM production_receipts WHERE batch_id=?').get(batch.id);
    if (receipt) {
      db.prepare('UPDATE production_receipts SET total_cost_cents=?,updated_at=? WHERE id=?').run(newTotalCost, at, receipt.id);
      db.prepare("UPDATE production_receipt_items SET cost_cents=? WHERE document_id=? AND kind='product'").run(newTotalCost, receipt.id);
    }
    const posted = !batch.receipt_required || receipt?.status === 'confirmed';
    if (posted && costDiff !== 0) {
      adjustProductCostForReceipt(db, order.product_id, costDiff, order.product_name);
      inventoryTouched = true;
    }
  }
  updateBatchTotals(db, order, 'draft', owner, at);
  if (inventoryTouched) notifyStockChanges(db, req, before, { production_id: order.id, number: order.number });
}

function recalculateStageLedger(db, req, order) {
  const initialPools = materialBalances(
    { ...order, quantity_rounding: [], stage_direct_batches: [] },
    readPostMaterialUsage(db, order.id),
    postMaterialPlanByProduct(order.operation_routes),
  );
  const rawPool = new Map(initialPools.map(item => [
    item.product_id,
    {
      name: item.name,
      unit: item.unit,
      quantity: exactQuantity(item, 'available_quantity'),
      cost_cents: item.available_cost_cents,
    },
  ]));
  const ledger = stageLedger(db, order.id);
  const poolMap = productionPoolPathMap(order);
  const byBatchId = new Map(ledger.batches.map(batch => [batch.id, batch]));
  const allReceipts = db.prepare('SELECT * FROM production_stage_receipts WHERE production_id=? ORDER BY id').all(order.id);
  const inputsByBatch = new Map();
  for (const input of ledger.inputs) {
    const list = inputsByBatch.get(input.batch_id) || [];
    list.push(input);
    inputsByBatch.set(input.batch_id, list);
  }
  const stageProductByPath = new Map(order.stages.map(stage => [stage.path, stage]));

  const events = [
    ...ledger.batches.map(batch => ({
      time: Date.parse(batch.created_at),
      kind: 'create_batch',
      order: 1,
      id: batch.id,
      batch,
    })),
    ...allReceipts.map(receipt => ({
      time: Date.parse(receipt.created_at),
      kind: 'create_receipt',
      order: 2,
      id: receipt.id,
      receipt,
    })),
    ...ledger.batches.filter(batch => batch.status === 'void').map(batch => ({
      time: Date.parse(batch.voided_at),
      kind: 'void_batch',
      order: 3,
      id: batch.id,
      batch,
    })),
    ...allReceipts.filter(receipt => receipt.status === 'void').map(receipt => ({
      time: Date.parse(receipt.voided_at),
      kind: 'void_receipt',
      order: 4,
      id: receipt.id,
      receipt,
    })),
  ].sort((a, b) => a.time - b.time || a.order - b.order || a.id - b.id);

  const liveBatches = new Map();
  const liveReceiptReservations = new Map();
  const changedProducts = new Set();

  const applyAllocation = (sourceId, qty, cost, parts) => {
    const left = liveBatches.get(sourceId);
    left.quantity = exactSubtract(left.quantity, qty);
    left.cost_cents -= cost;
    for (const part of parts) {
      const comp = left.components.get(part.product_id);
      comp.quantity = exactSubtract(comp.quantity, exactQuantity(part));
      comp.cost_cents -= part.cost_cents;
    }
  };

  for (const ev of events) {
    if (ev.kind === 'create_batch') {
      const batch = ev.batch;
      const inputs = inputsByBatch.get(batch.id) || [];
      const choices = productionStageItems(order, batch.path);
      const components = new Map();
      const merge = c => {
        const prev = components.get(c.product_id) || { product_id: c.product_id, quantity: 0, cost_cents: 0 };
        prev.quantity = exactAdd(prev.quantity, exactQuantity(c));
        prev.cost_cents += c.cost_cents;
        if (!validExactQuantity(prev.quantity) || !Number.isSafeInteger(prev.cost_cents)) fail('原料组成累计超出范围。');
        components.set(c.product_id, prev);
      };

      const oldAllocations = db.prepare('SELECT id,source_batch_id FROM production_stage_allocations WHERE input_id IN (SELECT id FROM production_stage_inputs WHERE batch_id=?)').all(batch.id);
      for (const old of oldAllocations) {
        db.prepare('DELETE FROM production_stage_allocation_components WHERE allocation_id=?').run(old.id);
      }
      db.prepare('DELETE FROM production_stage_allocations WHERE input_id IN (SELECT id FROM production_stage_inputs WHERE batch_id=?)').run(batch.id);

      let total = 0;
      const createdAllocations = [];
      for (const input of inputs) {
        const inputQty = exactQuantity(input);
        const node = choices.find(entry => entry.path === input.path);
        let cost = 0;
        if (input.usage_mode === 'stock') {
          if (batch.status === 'active') {
            const p = rawPool.get(input.product_id);
            if (!p || exactCompare(inputQty, p.quantity) > 0) {
              fail(`${node?.name || p?.name || '原材料'}已领未耗余额不足（当前 ${p?.quantity ?? 0} ${p?.unit || ''}）。请先补料或核对复核耗料。`);
            }
            cost = exactCompare(inputQty, 0) > 0 ? allocate(p.cost_cents, inputQty, p.quantity) : 0;
            p.quantity = exactSubtract(p.quantity, inputQty);
            p.cost_cents -= cost;
            db.prepare('UPDATE production_stage_inputs SET cost_cents=? WHERE id=?').run(cost, input.id);
          } else {
            cost = input.cost_cents;
          }
          merge({ product_id: input.product_id, quantity: inputQty, cost_cents: cost });
        } else {
          const sourcePaths = poolMap.get(input.path) || [input.path];
          const sources = ledger.batches
            .filter(candidate => sourcePaths.includes(candidate.path) && candidate.id < batch.id && liveBatches.has(candidate.id))
            .sort((a, b) => a.id - b.id);
          let need = inputQty;
          for (const source of sources) {
            if (exactCompare(need, 0) === 0) break;
            const left = liveBatches.get(source.id);
            if (exactCompare(left.quantity, 0) <= 0) continue;
            const used = exactMin(need, left.quantity);
            const allocCost = allocate(left.cost_cents, used, left.quantity);
            const parts = allocateStageComponents([...left.components.values()], used, left.quantity, allocCost);
            applyAllocation(source.id, used, allocCost, parts);
            createdAllocations.push({ source_id: source.id, qty: used, cost: allocCost, parts });
            const allocId = Number(db.prepare('INSERT INTO production_stage_allocations(input_id,source_batch_id,quantity,cost_cents) VALUES (?,?,?,?)')
              .run(input.id, source.id, exactNumber(used), allocCost).lastInsertRowid);
            saveExactQuantity(db, 'production_stage_allocations', allocId, 'quantity', used);
            for (const part of parts) {
              const partId = Number(db.prepare('INSERT INTO production_stage_allocation_components(allocation_id,product_id,quantity,cost_cents) VALUES (?,?,?,?)')
                .run(allocId, part.product_id, exactNumber(exactQuantity(part)), part.cost_cents).lastInsertRowid);
              saveExactQuantity(db, 'production_stage_allocation_components', partId, 'quantity', exactQuantity(part));
              merge(part);
            }
            cost += allocCost;
            need = exactSubtract(need, used);
          }
          if (exactCompare(need, 0) > 0) {
            fail(`${node?.name || '半成品'}来源层［${input.path}］半成品余额不足（还缺 ${need} ${node?.unit || ''}），请核对复核耗料或先取消待入库半成品单。`);
          }
          db.prepare('UPDATE production_stage_inputs SET cost_cents=? WHERE id=?').run(cost, input.id);
        }
        total += cost;
        if (!Number.isSafeInteger(total)) fail('本批成本超出范围。');
      }

      db.prepare('DELETE FROM production_stage_components WHERE batch_id=?').run(batch.id);
      for (const comp of components.values()) {
        const compId = Number(db.prepare('INSERT INTO production_stage_components(batch_id,product_id,quantity,cost_cents) VALUES (?,?,?,?)')
          .run(batch.id, comp.product_id, exactNumber(comp.quantity), comp.cost_cents).lastInsertRowid);
        saveExactQuantity(db, 'production_stage_components', compId, 'quantity', comp.quantity);
      }
      db.prepare('UPDATE production_stage_batches SET total_cost_cents=? WHERE id=?').run(total, batch.id);
      batch.total_cost_cents = total;
      batch._createdAllocations = createdAllocations;

      liveBatches.set(batch.id, {
        quantity: exactQuantity(batch, 'completed_quantity'),
        cost_cents: total,
        components: new Map([...components.entries()].map(([pid, c]) => [pid, { product_id: pid, ...quantityFields(c.quantity), cost_cents: c.cost_cents }])),
      });
      if (batch.path === '' && batch.root_batch_id) {
        const oldRoot = db.prepare('SELECT total_cost_cents FROM production_batches WHERE id=?').get(batch.root_batch_id);
        const receipt = db.prepare('SELECT status FROM production_receipts WHERE batch_id=?').get(batch.root_batch_id);
        syncRootBatchFromStage(db, order, batch, components);
        if (receipt?.status === 'confirmed' && total !== oldRoot.total_cost_cents) changedProducts.add(order.product_id);
      }
    } else if (ev.kind === 'create_receipt') {
      const r = ev.receipt;
      const left = liveBatches.get(r.source_batch_id);
      const rQty = exactQuantity(r);
      if (!left || exactCompare(rQty, left.quantity) > 0) {
        fail('调整后半成品可用余额不足以覆盖已提交的半成品入库单，请先取消或作废半成品入库单后再复核。', 409);
      }
      const newCost = allocate(left.cost_cents, rQty, left.quantity);
      const parts = allocateStageComponents([...left.components.values()], rQty, left.quantity, newCost)
        .map(c => ({ product_id: c.product_id, ...quantityFields(exactQuantity(c)), cost_cents: c.cost_cents }));
      applyAllocation(r.source_batch_id, rQty, newCost, parts);
      liveReceiptReservations.set(r.id, { source_batch_id: r.source_batch_id, qty: rQty, cost: newCost, parts });
      const costDiff = newCost - r.total_cost_cents;
      if (costDiff !== 0 || JSON.stringify(parts) !== r.components) {
        db.prepare('UPDATE production_stage_receipts SET total_cost_cents=?,components=? WHERE id=?').run(newCost, JSON.stringify(parts), r.id);
        if (r.status === 'confirmed' && costDiff !== 0) {
          const stage = stageProductByPath.get(byBatchId.get(r.source_batch_id).path);
          adjustProductCostForReceipt(db, stage.product_id, costDiff, stage.name);
          changedProducts.add(stage.product_id);
        }
      }
    } else if (ev.kind === 'void_batch') {
      const batch = ev.batch;
      for (const alloc of batch._createdAllocations || []) {
        if (!liveBatches.has(alloc.source_id)) continue;
        const left = liveBatches.get(alloc.source_id);
        left.quantity = exactAdd(left.quantity, alloc.qty);
        left.cost_cents += alloc.cost;
        for (const part of alloc.parts) {
          const comp = left.components.get(part.product_id);
          comp.quantity = exactAdd(comp.quantity, exactQuantity(part));
          comp.cost_cents += part.cost_cents;
        }
      }
      liveBatches.delete(batch.id);
    } else if (ev.kind === 'void_receipt') {
      const r = ev.receipt;
      const resv = liveReceiptReservations.get(r.id);
      if (resv && liveBatches.has(resv.source_batch_id)) {
        const left = liveBatches.get(resv.source_batch_id);
        left.quantity = exactAdd(left.quantity, resv.qty);
        left.cost_cents += resv.cost;
        for (const part of resv.parts) {
          const comp = left.components.get(part.product_id);
          comp.quantity = exactAdd(comp.quantity, exactQuantity(part));
          comp.cost_cents += part.cost_cents;
        }
      }
      liveReceiptReservations.delete(r.id);
    }
  }
  return changedProducts;
}

function reviewStageOrder(db, req, order, { actor, stockBefore, updateBatchTotals }) {
  const entries = req.body.stage_inputs;
  const key = (stagePath, inputPath) => `${stagePath}::${inputPath}`;
  if (!Array.isArray(entries) || new Set(entries.map(row => key(row?.stage_path, row?.input_path))).size !== entries.length) {
    fail('请核对各层复核耗料明细，不能重复提交相同投入项。');
  }

  const stageByPath = new Map(order.stages.map(stage => [stage.path, stage]));
  const ledger = stageLedger(db, order.id);
  const activeBatchesByStage = new Map();
  for (const batch of ledger.batches.filter(b => b.status === 'active')) {
    const list = activeBatchesByStage.get(batch.path) || [];
    list.push(batch);
    activeBatchesByStage.set(batch.path, list);
  }
  const activeBatchIds = new Set(ledger.batches.filter(b => b.status === 'active').map(b => b.id));
  const inputsByBatch = new Map();
  for (const input of ledger.inputs) {
    if (!activeBatchIds.has(input.batch_id)) continue;
    const list = inputsByBatch.get(input.batch_id) || [];
    list.push({ ...input, qty: exactQuantity(input), touched: false });
    inputsByBatch.set(input.batch_id, list);
  }

  const parsed = entries.map(row => {
    if (typeof row?.stage_path !== 'string' || typeof row?.input_path !== 'string') fail('请核对复核层路径。');
    const stage = stageByPath.get(row.stage_path);
    if (!stage) fail('生产层不存在。', 404);
    const choices = productionStageItems(order, stage.path);
    const node = choices.find(entry => entry.path === row.input_path);
    if (!node) fail('投入物料或半成品不属于该生产层。');
    const batches = activeBatchesByStage.get(stage.path) || [];
    if (!batches.length) fail(`生产层［${stage.name}］暂无有效产出批次，不能调整复核数量。`, 409);
    const quantity = parseExactQuantity(row.quantity, false);
    if (!validExactQuantity(quantity, false)) fail('复核耗料需为非负数且最多 4 位小数。');
    const cannotBeZero = !stageInputCanBeZero(node, choices);
    if (cannotBeZero && exactCompare(quantity, 0) <= 0) {
      fail(`${node.name}为本层必耗半成品，不能复核为 0。`);
    }
    const variance_reason = parseVarianceReason(row.variance_reason);
    return { stage, node, batches, quantity, cannotBeZero, variance_reason };
  });

  if (!parsed.length) return;

  for (const entry of parsed) {
    const { stage, node, batches, quantity, cannotBeZero, variance_reason } = entry;
    const rowRefs = batches.map(batch => {
      const list = inputsByBatch.get(batch.id);
      let row = list.find(item => item.path === node.path);
      if (!row && node.is_supplemental_input) {
        const inputId = Number(db.prepare('INSERT INTO production_stage_inputs(batch_id,path,product_id,usage_mode,quantity,cost_cents,variance_reason) VALUES (?,?,?,?,0,0,?)')
          .run(batch.id, node.path, node.product_id, node.usage_mode, '').lastInsertRowid);
        row = { id: inputId, batch_id: batch.id, path: node.path, product_id: node.product_id, usage_mode: node.usage_mode, cost_cents: 0, variance_reason: '', qty: 0, touched: false };
        list.push(row);
      }
      return {
        batch,
        row,
        get qty() { return row.qty; },
        preferReceive: true,
        preferReduce: false,
        mustStayPositive: cannotBeZero,
      };
    });
    const recorded = exactSum(rowRefs, 'qty');
    if (exactCompare(quantity, recorded) === 0) {
      if (variance_reason !== undefined && variance_reason !== '') {
        const target = rowRefs.at(-1);
        target.row.variance_reason = variance_reason;
        target.row.touched = true;
      }
      continue;
    }
    applyQuantityDelta({
      rows: rowRefs,
      targetQty: quantity,
      canReduceRow: ref => inputsByBatch.get(ref.batch.id).some(other => other.path !== node.path && exactCompare(other.qty, 0) > 0),
      canZeroOutBatch: ref => inputsByBatch.get(ref.batch.id).some(other => other.path !== node.path && exactCompare(other.qty, 0) > 0),
      label: `${stage.name} · ${node.name}`,
      onDelta: (ref, delta) => {
        ref.row.qty = exactAdd(ref.row.qty, delta);
        if (variance_reason !== undefined) ref.row.variance_reason = variance_reason;
        ref.row.touched = true;
      },
    });
  }

  for (const batch of ledger.batches.filter(b => b.status === 'active')) {
    const list = inputsByBatch.get(batch.id) || [];
    if (!list.some(row => exactCompare(row.qty, 0) > 0)) {
      fail(`［${batch.path || '成品层'}］第 ${batch.batch_number} 批需保留至少一项大于零的直属投入。`);
    }
    for (const row of list) {
      if (!row.touched) continue;
      db.prepare('UPDATE production_stage_inputs SET quantity=?,variance_reason=? WHERE id=?')
        .run(exactNumber(row.qty), row.variance_reason, row.id);
      saveExactQuantity(db, 'production_stage_inputs', row.id, 'quantity', row.qty);
    }
  }

  const beforeIds = [...new Set([order.product_id, ...order.stages.map(stage => stage.product_id)])];
  const beforeById = new Map(beforeIds.map(id => [id, db.prepare('SELECT * FROM products WHERE id=?').get(id)]));
  const changedProducts = recalculateStageLedger(db, req, order);
  const at = new Date().toISOString();
  const owner = actor(req);
  updateBatchTotals(db, order, 'draft', owner, at);
  if (changedProducts.size) {
    const before = [...changedProducts].map(id => beforeById.get(id)).filter(Boolean);
    notifyStockChanges(db, req, before, { production_id: order.id, number: order.number });
  }
}

export function reviewProductionConsumption(db, req, order, helpers) {
  helpers.checkOpen(req, order);
  helpers.units(order);
  if (productionRounding(db, order.id).length) {
    fail('生产单已完结取整，请先回退后再复核耗料。', 409);
  }
  if (order.stage_workflow) {
    reviewStageOrder(db, req, order, helpers);
  } else {
    reviewNonStageOrder(db, req, order, helpers);
  }
  return helpers.current(req);
}
