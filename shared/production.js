import { calculateBomNodes } from './bom-expansion.js';
import { validQuantity, quantityUnits, QUANTITY_SCALE, validStoredQuantity } from './quantity.js';
import { bomRequiredQuantity } from './bom.js';

export const productionStatusLabels = { draft: '待生产', awaiting_materials: '待领料', in_progress: '生产中', completed: '已完工', void: '已作废' };
export const productionPlannedQuantity = bomRequiredQuantity;
export function productionItemQuantity(item, quantity, order, standards) {
  if (order.snapshot_format === 2 || order.multi_level) {
    if (standards) return standards.get(item.product_id);
    const row = calculateBomNodes(order.nodes, quantity, order.quantity_decimals ?? 6).rows.find(row => row.product_id === item.product_id);
    if (!row) throw new Error('生产配方缺少该领料项。');
    return row.required;
  }
  const standard = productionPlannedQuantity(item.base_quantity, quantity, order.base_quantity, item.base_quantity_fraction, item.loss_rate, order.loss_method, order.quantity_decimals ?? 6);
  return item.unit_round_up ? Math.ceil(standard) : standard;
}

export function validateProductionPlan(value, stored = false) {
  if (!value || !validQuantity(value.planned_quantity, true, stored ? 6 : 4)) throw new Error('计划产量需为正数，最多 4 位小数。');
  if (typeof value.note !== 'string' || value.note.length > 500) throw new Error('生产备注最多 500 字。');
}

export function validateProductionCompletion(value, items, stored = false) {
  if (!value || !validQuantity(value.completed_quantity, true, stored ? 6 : 4)) throw new Error('合格成品数量需为正数，最多 4 位小数。');
  if (value.finish_order !== undefined && typeof value.finish_order !== 'boolean') throw new Error('请明确本批入库后是否结束生产。');
  if (value.note !== undefined && (typeof value.note !== 'string' || value.note.length > 500)) throw new Error('本批备注最多 500 字。');
  if (!Array.isArray(value.items) || value.items.length !== items.length) throw new Error('请核对全部材料的实际耗料。');
  const expected = new Set(items.map(item => item.product_id)), seen = new Set();
  for (const item of value.items) {
    if (!item || !expected.has(item.product_id) || seen.has(item.product_id) || !validQuantity(item.quantity, false, stored ? 6 : 4))
      throw new Error('实际耗料需为非负数且最多 4 位小数，材料不能重复或增删。');
    if (item.variance_reason !== undefined && (typeof item.variance_reason !== 'string' || item.variance_reason.length > 500))
      throw new Error('每种材料的耗料差异原因最多 500 字。');
    seen.add(item.product_id);
  }
  if (!value.items.some(item => item.quantity > 0)) throw new Error('至少一种材料的实际耗料需大于零。');
}

// Compare against the saved recipe scaled to actual good output, not the plan.
// Derived analysis must never prevent an otherwise valid stock posting. Older
// orders may have actual output whose theoretical requirement exceeds the cap.
export function productionMaterialAnalysis(item, completedQuantity, baseQuantity, actualQuantity, lossMethod = 'internal', nodes, decimals = 4) {
  try {
    if (!validStoredQuantity(actualQuantity)) throw new Error('实际耗料无效。');
    const rawStandard = nodes instanceof Map ? nodes.get(item.product_id) : nodes ? calculateBomNodes(nodes, completedQuantity, decimals).rows.find(row => row.product_id === item.product_id).required : productionPlannedQuantity(item.base_quantity, completedQuantity, baseQuantity, item.base_quantity_fraction ?? '', item.loss_rate === undefined ? 0 : item.loss_rate, lossMethod, decimals);
    const standard = item.unit_round_up ? Math.ceil(rawStandard) : rawStandard;
    if (!validStoredQuantity(standard, true)) throw new Error('标准耗料无效。');
    const difference = quantityUnits(actualQuantity) - quantityUnits(standard);
    return { standard_quantity: standard, variance_quantity: difference / QUANTITY_SCALE,
      variance_rate: difference * 100 / quantityUnits(standard), analysis_error: '' };
  } catch {
    return { standard_quantity: null, variance_quantity: null, variance_rate: null,
      analysis_error: '标准耗料暂无法计算，请核对合格产量、实际耗料和本单配方；标准数量超出上限时仅保留实际记录。' };
  }
}
