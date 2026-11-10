import { MAX_QUANTITY, QUANTITY_SCALE, quantityUnits, parseQuantity, parseQuantityFraction, validStoredQuantity } from './quantity.js';
import { exactRatio } from './exact-quantity.js';

export const BOM_MAX_ITEMS = 100;
export const bomLossMethodLabels = { internal: '内扣法', external: '外包法' };
export const bomLossMethodFormulas = { internal: '净用量 ÷（1－损耗率）', external: '净用量 ×（1＋损耗率）' };
export function validateBomLossMethod(value) {
  if (!['internal', 'external'].includes(value)) throw new Error('请选择有效的标准损耗计算方式（内扣法或外包法）。');
}
// Percentage points: 10 means 10%; the BOM selects the calculation method.
export function validateBomLossRate(value) {
  if (!validStoredQuantity(value) || value >= 100) throw new Error('标准损耗率需为 0（含）至 100（不含）的百分数，最多 6 位小数。');
}
const text = (value, max, required = false) => typeof value === 'string' && value.length <= max && (!required || !!value.trim());
const id = value => Number.isSafeInteger(value) && value > 0;

const ceilDivide = (numerator, denominator) => (numerator + denominator - 1n) / denominator;

export function parseBomQuantity(value, stored = false) {
  if (typeof value !== 'string' || !value.includes('/')) return { quantity: parseQuantity(value, true), quantity_fraction: '' };
  const fraction = parseQuantityFraction(value, true, stored);
  const [numerator, denominator] = exactRatio(fraction);
  return { quantity: Number(ceilDivide(numerator * 10000n, denominator)) / 10000,
    quantity_fraction: fraction };
}

export function validateBomQuantity(quantity, fraction = '', stored = true) {
  if (!validStoredQuantity(quantity, true)) throw new Error('材料用量需为正数且最多 4 位小数。');
  if (fraction !== '') {
    const parsed = parseBomQuantity(fraction, stored);
    const [numerator, denominator] = exactRatio(fraction);
    const legacyQuantity = Number(ceilDivide(numerator * BigInt(QUANTITY_SCALE), denominator)) / QUANTITY_SCALE;
    if (!parsed.quantity_fraction || parsed.quantity_fraction !== fraction || (parsed.quantity !== quantity && legacyQuantity !== quantity))
      throw new Error('材料用量与分数不一致，请重新填写用量。');
  }
}

export function validateBom(value, stored = false) {
  if (!value || !id(value.product_id)) throw new Error('请选择成品物料。');
  if (!text(value.name, 100, true)) throw new Error('请填写 1–100 字的BOM名称。');
  if (!validStoredQuantity(value.base_quantity, true)) throw new Error('基准产量需为正数，最多 4 位小数。');
  validateBomLossMethod(value.loss_method === undefined ? 'internal' : value.loss_method);
  if (!text(value.base_unit, 100, true) || !text(value.note, 500) || ![0, 1].includes(value.enabled))
    throw new Error('单位、备注或启用状态无效。');
  if (!Array.isArray(value.items) || !value.items.length || value.items.length > BOM_MAX_ITEMS)
    throw new Error(`请添加 1–${BOM_MAX_ITEMS} 种材料。`);
  const seen = new Set();
  for (const item of value.items) {
    if (!item || !id(item.product_id) || !validStoredQuantity(item.quantity, true) || !text(item.unit, 100, true) || !text(item.note, 200))
      throw new Error('材料、用量、单位或备注无效，用量需为正数且最多 4 位小数。');
    validateBomQuantity(item.quantity, item.quantity_fraction, stored);
    validateBomLossRate(item.loss_rate === undefined ? 0 : item.loss_rate);
    const mode = item.usage_mode === undefined ? 'stock' : item.usage_mode;
    if (!['stock', 'explode'].includes(mode) || (mode === 'explode' ? !id(item.child_bom_id) : item.child_bom_id != null))
      throw new Error('请选择有效的用料方式；展开时必须指定下级配方，直接领用时不能指定下级配方。');
    if (item.product_id === value.product_id) throw new Error('成品不能作为自身的材料。');
    if (seen.has(item.product_id)) throw new Error('同一材料不能重复添加，请合并用量。');
    seen.add(item.product_id);
  }
  return value;
}

// Keep fractions and the selected loss allowance exact through scaling;
// round only the final demand up to four decimals.
export function bomRequiredQuantity(quantity, productionQuantity, baseQuantity, fraction = '', lossRate = 0, lossMethod = 'internal', decimals = 4) {
  if (![quantity, productionQuantity, baseQuantity].every(value => validStoredQuantity(value, true)))
    throw new Error('生产数量和用量需为正数，最多 4 位小数。');
  validateBomQuantity(quantity, fraction);
  validateBomLossRate(lossRate);
  validateBomLossMethod(lossMethod);
  const [numerator, denominator] = fraction ? exactRatio(fraction) : [BigInt(quantityUnits(quantity)), BigInt(QUANTITY_SCALE)];
  const percentScale = BigInt(100 * QUANTITY_SCALE);
  const rate = BigInt(quantityUnits(lossRate));
  const multiplier = lossMethod === 'external' ? percentScale + rate : percentScale;
  const divisor = denominator * BigInt(quantityUnits(baseQuantity)) * (lossMethod === 'external' ? percentScale : percentScale - rate);
  const result = ceilDivide(numerator * BigInt(quantityUnits(productionQuantity)) * BigInt(10 ** decimals) * multiplier, divisor);
  if (result > BigInt(MAX_QUANTITY * 10 ** decimals)) throw new Error('材料需求超出数量上限，请减少生产数量。');
  return Number(result) / 10 ** decimals;
}

export function bomShortage(required, stock) {
  return Math.max(0, quantityUnits(required) - quantityUnits(stock)) / QUANTITY_SCALE;
}
