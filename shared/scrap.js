import { validQuantity } from './quantity.js';
import { bomRequiredQuantity, validateBomQuantity } from './bom.js';

export const SCRAP_MAX_ITEMS = 100;

// A rule belongs to a BOM, never to the stock item. Input ratios are explicit
// percentages of one material in the same unit; no implicit unit conversion.
export function validateScrapRules(scraps, productId, materials) {
  if (!Array.isArray(scraps) || scraps.length > SCRAP_MAX_ITEMS) throw new Error('废料产出最多 100 种。');
  const seen = new Set();
  for (const row of scraps) {
    if (!row || !Number.isSafeInteger(row.product_id) || row.product_id < 1 || seen.has(row.product_id) ||
        row.product_id === productId || materials.some(item => item.product_id === row.product_id))
      throw new Error('废料不能重复，也不能与成品或投入材料相同；可用原料剩余请按余料处理。');
    seen.add(row.product_id);
    if (typeof row.unit !== 'string' || !row.unit.trim() || row.unit.length > 100 ||
        typeof row.note !== 'string' || row.note.length > 200) throw new Error('废料单位或备注无效。');
    if (!['output', 'input_ratio'].includes(row.method)) throw new Error('废料计算方式无效。');
    validateBomQuantity(row.quantity, row.quantity_fraction ?? '');
    if (row.method === 'input_ratio') {
      const source = materials.find(item => item.product_id === row.source_product_id);
      if (!source || source.unit !== row.unit || row.quantity > 100 || (row.quantity_fraction ?? '') !== '')
        throw new Error('废料比例需为大于 0 且不超过 100 的百分数，来源须为同单位的投入材料。');
    } else if (row.source_product_id !== null) throw new Error('按产量计算的废料不能指定投入材料。');
  }
  const totals = new Map();
  for (const row of scraps.filter(row => row.method === 'input_ratio')) {
    const key = row.source_product_id;
    totals.set(key, (totals.get(key) || 0) + Math.round(row.quantity * 1e6));
    if (totals.get(key) > 100e6) throw new Error('同一投入材料的废料比例合计不能超过 100%。');
  }
}

export function scrapExpectedQuantity(rule, outputQuantity, baseQuantity, materials) {
  const source = rule.method === 'input_ratio' ? materials.find(item => item.product_id === rule.source_product_id)?.quantity : outputQuantity;
  if (!validQuantity(source)) throw new Error('请先填写有效的产量和实际耗料，再核对预计废料。');
  if (source === 0) return 0;
  return bomRequiredQuantity(rule.quantity, source, rule.method === 'input_ratio' ? 100 : baseQuantity, rule.quantity_fraction ?? '');
}

export function validateScrapActuals(actuals, rules) {
  if (!Array.isArray(actuals) || actuals.length !== rules.length) throw new Error('请核对全部废料的实际产出与处理方式。');
  const expected = new Set(rules.map(row => row.product_id)), seen = new Set();
  for (const row of actuals) {
    if (!row || !expected.has(row.product_id) || seen.has(row.product_id) || !validQuantity(row.quantity) || !['stock', 'discard'].includes(row.disposition))
      throw new Error('废料实际产出需为非负数且最多 6 位小数，处理方式为入库或直接处置，物料不能增删或重复。');
    seen.add(row.product_id);
  }
}
