import { validQuantity } from './quantity.js';
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
    seen.add(item.product_id);
  }
  if (!value.items.some(item => item.quantity > 0)) throw new Error('至少一种材料的实际耗料需大于零。');
}
