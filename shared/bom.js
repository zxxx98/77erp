import { MAX_QUANTITY, QUANTITY_SCALE, validQuantity, quantityUnits } from './quantity.js';

export const BOM_MAX_ITEMS = 100;
const text = (value, max, required = false) => typeof value === 'string' && value.length <= max && (!required || !!value.trim());
const id = value => Number.isSafeInteger(value) && value > 0;

export function validateBom(value) {
  if (!value || !id(value.product_id)) throw new Error('请选择成品物料。');
  if (!text(value.name, 100, true)) throw new Error('请填写 1–100 字的用料清单名称。');
  if (!validQuantity(value.base_quantity, true)) throw new Error('基准产量需为正数，最多 6 位小数。');
  if (!text(value.base_unit, 100, true) || !text(value.note, 500) || ![0, 1].includes(value.enabled))
    throw new Error('单位、备注或启用状态无效。');
  if (!Array.isArray(value.items) || !value.items.length || value.items.length > BOM_MAX_ITEMS)
    throw new Error(`请添加 1–${BOM_MAX_ITEMS} 种材料。`);
  const seen = new Set();
  for (const item of value.items) {
    if (!item || !id(item.product_id) || !validQuantity(item.quantity, true) || !text(item.unit, 100, true) || !text(item.note, 200))
      throw new Error('材料、用量、单位或备注无效，用量需为正数且最多 6 位小数。');
    if (item.product_id === value.product_id) throw new Error('成品不能作为自身的材料。');
    if (seen.has(item.product_id)) throw new Error('同一材料不能重复添加，请合并用量。');
    seen.add(item.product_id);
  }
  return value;
}

// Integer millionths avoid floating-point multiplication and always cover the
// requested amount. Only the final result is rounded up, to one millionth.
export function bomRequiredQuantity(quantity, productionQuantity, baseQuantity) {
  if (![quantity, productionQuantity, baseQuantity].every(value => validQuantity(value, true)))
    throw new Error('生产数量和用量需为正数，最多 6 位小数。');
  const divisor = BigInt(quantityUnits(baseQuantity));
  const result = (BigInt(quantityUnits(quantity)) * BigInt(quantityUnits(productionQuantity)) + divisor - 1n) / divisor;
  if (result > BigInt(MAX_QUANTITY * QUANTITY_SCALE)) throw new Error('材料需求超出数量上限，请减少生产数量。');
  return Number(result) / QUANTITY_SCALE;
}

export function bomShortage(required, stock) {
  return Math.max(0, quantityUnits(required) - quantityUnits(stock)) / QUANTITY_SCALE;
}
