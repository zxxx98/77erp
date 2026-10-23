import { MAX_QUANTITY, QUANTITY_SCALE, validQuantity, quantityUnits, parseQuantity } from './quantity.js';

export const BOM_MAX_ITEMS = 100;
const text = (value, max, required = false) => typeof value === 'string' && value.length <= max && (!required || !!value.trim());
const id = value => Number.isSafeInteger(value) && value > 0;

function fractionParts(value) {
  const match = typeof value === 'string' && value.length <= 60 && value.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
  if (!match || ![match[1], match[2]].every(part => Number.isSafeInteger(Number(part)) && Number(part) > 0 && Number(part) <= MAX_QUANTITY))
    throw new Error(`材料用量分数的分子、分母需为 1–${MAX_QUANTITY} 的整数，例如 1/40。`);
  return [BigInt(match[1]), BigInt(match[2])];
}

const ceilDivide = (numerator, denominator) => (numerator + denominator - 1n) / denominator;

export function parseBomQuantity(value) {
  if (typeof value !== 'string' || !value.includes('/')) return { quantity: parseQuantity(value, true), quantity_fraction: '' };
  const [numerator, denominator] = fractionParts(value);
  return { quantity: Number(ceilDivide(numerator * BigInt(QUANTITY_SCALE), denominator)) / QUANTITY_SCALE,
    quantity_fraction: `${numerator}/${denominator}` };
}

export function validateBomQuantity(quantity, fraction = '') {
  if (!validQuantity(quantity, true)) throw new Error('材料用量需为正数且最多 6 位小数。');
  if (fraction !== '') {
    const parsed = parseBomQuantity(fraction);
    if (!parsed.quantity_fraction || parsed.quantity_fraction !== fraction || parsed.quantity !== quantity)
      throw new Error('材料用量与分数不一致，请重新填写用量。');
  }
}

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
    validateBomQuantity(item.quantity, item.quantity_fraction);
    if (item.product_id === value.product_id) throw new Error('成品不能作为自身的材料。');
    if (seen.has(item.product_id)) throw new Error('同一材料不能重复添加，请合并用量。');
    seen.add(item.product_id);
  }
  return value;
}

// Keep fractions exact through scaling; round only the final demand up to a
// millionth. The numeric quantity remains available to older clients.
export function bomRequiredQuantity(quantity, productionQuantity, baseQuantity, fraction = '') {
  if (![quantity, productionQuantity, baseQuantity].every(value => validQuantity(value, true)))
    throw new Error('生产数量和用量需为正数，最多 6 位小数。');
  validateBomQuantity(quantity, fraction);
  const [numerator, denominator] = fraction ? fractionParts(fraction) : [BigInt(quantityUnits(quantity)), BigInt(QUANTITY_SCALE)];
  const divisor = denominator * BigInt(quantityUnits(baseQuantity));
  const result = ceilDivide(numerator * BigInt(quantityUnits(productionQuantity)) * BigInt(QUANTITY_SCALE), divisor);
  if (result > BigInt(MAX_QUANTITY * QUANTITY_SCALE)) throw new Error('材料需求超出数量上限，请减少生产数量。');
  return Number(result) / QUANTITY_SCALE;
}

export function bomShortage(required, stock) {
  return Math.max(0, quantityUnits(required) - quantityUnits(stock)) / QUANTITY_SCALE;
}
