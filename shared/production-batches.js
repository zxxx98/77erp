import { validStoredQuantity as validQuantity, quantityUnits, QUANTITY_SCALE } from './quantity.js';

export function sumProductionQuantities(values) {
  const units = values.reduce((sum, value) => {
    if (!validQuantity(value)) throw new Error('生产批次数量无效。');
    return sum + quantityUnits(value);
  }, 0);
  const quantity = units / QUANTITY_SCALE;
  if (!Number.isSafeInteger(units) || !validQuantity(quantity)) throw new Error('生产累计数量超出上限，请拆分生产单。');
  return quantity;
}

function sumCosts(values) {
  const sum = values.reduce((sum, value) => sum + value, 0);
  if (values.some(value => !Number.isSafeInteger(value) || value < 0) || !Number.isSafeInteger(sum))
    throw new Error('生产累计成本超出范围，请拆分生产单。');
  return sum;
}

// Sum posted batch facts. Cumulative standard consumption is calculated once
// from total good output elsewhere, rather than summing rounded batch standards.
export function productionBatchSummary(items, scraps, batches) {
  return {
    completed_quantity: sumProductionQuantities(batches.map(batch => batch.completed_quantity)),
    total_cost_cents: sumCosts(batches.map(batch => batch.total_cost_cents)),
    items: items.map(item => {
      const rows = batches.map(batch => batch.items.find(row => row.product_id === item.product_id));
      return { product_id: item.product_id, actual_quantity: sumProductionQuantities(rows.map(row => row.actual_quantity)),
        cost_cents: sumCosts(rows.map(row => row.cost_cents)), variance_reason: rows.length === 1 ? rows[0].variance_reason : '' };
    }),
    scraps: scraps.map(scrap => {
      const rows = batches.map(batch => batch.scraps.find(row => row.product_id === scrap.product_id));
      const stock = sumProductionQuantities(rows.filter(row => row.disposition === 'stock').map(row => row.actual_quantity));
      const discard = sumProductionQuantities(rows.filter(row => row.disposition === 'discard').map(row => row.actual_quantity));
      const dispositions = new Set(rows.map(row => row.disposition));
      return { product_id: scrap.product_id, expected_quantity: sumProductionQuantities(rows.map(row => row.expected_quantity)),
        actual_quantity: sumProductionQuantities(rows.map(row => row.actual_quantity)), stock_quantity: stock, discard_quantity: discard,
        disposition: dispositions.size > 1 ? 'mixed' : rows[0]?.disposition ?? null };
    }),
  };
}
