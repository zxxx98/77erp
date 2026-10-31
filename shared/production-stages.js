import { bomRequiredQuantity } from './bom.js';
import { materialQuantity } from './quantity.js';
import { calculateBomNodes, supplyFraction } from './bom-expansion.js';

export function stageDisplayStandardQuantity(item, outputQuantity) {
  if (outputQuantity === 0 || item.is_supplemental_input) return 0;
  let quantity = bomRequiredQuantity(item.quantity, outputQuantity, item.bom_base_quantity,
    item.quantity_fraction, item.loss_rate, item.loss_method, 6);
  if (item.supply_fraction) {
    const [n, d] = supplyFraction(item.supply_fraction);
    const gross = materialQuantity(quantity, item);
    const scale = item.unit_round_up ? 1 : 1000000;
    quantity = Number((BigInt(Math.round(gross * scale)) * n + d - 1n) / d) / scale;
  }
  return item.unit_round_up ? Math.ceil(quantity) : quantity;
}

export function stageStandardQuantity(item, outputQuantity) {
  return materialQuantity(stageDisplayStandardQuantity(item, outputQuantity), item);
}

// Identity is the immutable node path, never a product ID or current BOM.
export function deriveProductionStages(order) {
  if (!order.nodes?.some(n => n.usage_mode === 'explode')) return [];
  const calculated = calculateBomNodes(order.nodes, order.planned_quantity, order.quantity_decimals ?? 4);
  const paths = ['', ...order.nodes.filter(n => n.usage_mode === 'explode').map(n => n.path)];
  return paths.map(path => {
    const node = order.nodes.find(n => n.path === path), children = order.nodes.filter(n => n.parent_path === path), first = children[0];
    return { path, parent_path: node?.parent_path ?? null, product_id: node?.product_id ?? order.product_id,
      name: node?.name ?? order.product_name, unit: node?.unit ?? order.unit, unit_round_up: node?.unit_round_up ?? order.unit_round_up,
      bom_id: first.bom_id, bom_version: first.bom_version, bom_name: first.bom_name, base_quantity: first.bom_base_quantity,
      loss_method: first.loss_method, planned_quantity: path ? calculated.nodes.find(n => n.path === path).required : order.planned_quantity,
      items: children };
  });
}


// Additional issued materials are separate stock inputs, never edits to BOM nodes.
export function productionStageItems(order, path) {
  const direct = order.nodes.filter(node => node.parent_path === path);
  const outputId = path ? order.nodes.find(node => node.path === path)?.product_id : order.product_id;
  const extras = (order.items || []).filter(item => item.product_id !== outputId &&
    !direct.some(node => node.usage_mode === 'stock' && node.product_id === item.product_id) &&
    (item.base_quantity === 0 || direct.some(node => node.usage_mode === 'explode' && node.product_id === item.product_id)));
  return [...direct, ...extras.map(item => ({ ...item, path: `@stock:${path || 'root'}:${item.product_id}`, parent_path: path,
    usage_mode: 'stock', quantity: 0, quantity_fraction: '', loss_rate: 0, loss_method: order.loss_method,
    bom_base_quantity: 1, is_supplemental_input: true }))];
}

export function stageInputCanBeZero(item, items) {
  return item.usage_mode !== 'explode' || items.some(row => row.usage_mode === 'stock' && row.product_id === item.product_id);
}

export function stageInputDefaults(items, quantity) {
  const rows = items.map(item => ({ path: item.path, quantity: stageStandardQuantity(item, quantity), variance_reason: '' }));
  const remaining = new Map(items.filter(item => item.usage_mode === 'stock').map(item => [item.product_id, item.available_quantity || 0]));
  for (const item of items.filter(item => item.usage_mode === 'explode')) {
    const stock = items.find(row => row.usage_mode === 'stock' && row.product_id === item.product_id);
    if (!stock) continue;
    const row = rows.find(row => row.path === item.path), replacement = rows.find(row => row.path === stock.path);
    const available = Math.max(0, (remaining.get(item.product_id) || 0) - replacement.quantity);
    const replace = Math.min(available, Math.max(0, row.quantity - (item.available_quantity || 0)));
    row.quantity = Math.round((row.quantity - replace) * 10000) / 10000;
    replacement.quantity = Math.round((replacement.quantity + replace) * 10000) / 10000;
    remaining.set(item.product_id, Math.max(0, available - replace));
  }
  return rows.map(row => ({ ...row, quantity: String(row.quantity) }));
}
