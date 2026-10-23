import { validQuantity, quantityUnits, QUANTITY_SCALE } from './quantity.js';
import { bomRequiredQuantity } from './bom.js';

export const productionStatusLabels = { draft: '待生产', completed: '已完工', void: '已作废' };
export const productionPlannedQuantity = bomRequiredQuantity;

export function validateProductionPlan(value) {
  if (!value || !validQuantity(value.planned_quantity, true)) throw new Error('计划产量需为正数，最多 6 位小数。');
  if (typeof value.note !== 'string' || value.note.length > 500) throw new Error('生产备注最多 500 字。');
}

export function validateProductionCompletion(value, items) {
  if (!value || !validQuantity(value.completed_quantity, true)) throw new Error('合格成品数量需为正数，最多 6 位小数。');
  if (!Array.isArray(value.items) || value.items.length !== items.length) throw new Error('请核对全部材料的实际耗料。');
  const expected = new Set(items.map(item => item.product_id)), seen = new Set();
  for (const item of value.items) {
    if (!item || !expected.has(item.product_id) || seen.has(item.product_id) || !validQuantity(item.quantity))
      throw new Error('实际耗料需为非负数且最多 6 位小数，材料不能重复或增删。');
    if (item.variance_reason !== undefined && (typeof item.variance_reason !== 'string' || item.variance_reason.length > 500))
      throw new Error('每种材料的耗料差异原因最多 500 字。');
    seen.add(item.product_id);
  }
  if (!value.items.some(item => item.quantity > 0)) throw new Error('至少一种材料的实际耗料需大于零。');
}

// Compare against the saved recipe scaled to actual good output, not the plan.
// Derived analysis must never prevent an otherwise valid stock posting. Older
// orders may have actual output whose theoretical requirement exceeds the cap.
export function productionMaterialAnalysis(item, completedQuantity, baseQuantity, actualQuantity) {
  try {
    if (!validQuantity(actualQuantity)) throw new Error('实际耗料无效。');
    const standard = productionPlannedQuantity(item.base_quantity, completedQuantity, baseQuantity, item.base_quantity_fraction ?? '', item.loss_rate === undefined ? 0 : item.loss_rate);
    const difference = quantityUnits(actualQuantity) - quantityUnits(standard);
    return { standard_quantity: standard, variance_quantity: difference / QUANTITY_SCALE,
      variance_rate: difference * 100 / quantityUnits(standard), analysis_error: '' };
  } catch {
    return { standard_quantity: null, variance_quantity: null, variance_rate: null,
      analysis_error: '标准耗料暂无法计算，请核对合格产量、实际耗料和本单配方；标准数量超出上限时仅保留实际记录。' };
  }
}
