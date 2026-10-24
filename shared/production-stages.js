import { bomRequiredQuantity } from './bom.js';
import { materialQuantity } from './quantity.js';
import { calculateBomNodes } from './bom-expansion.js';

export function stageDisplayStandardQuantity(item, outputQuantity) {
  if (outputQuantity === 0) return 0;
  const quantity = bomRequiredQuantity(item.quantity, outputQuantity, item.bom_base_quantity,
    item.quantity_fraction, item.loss_rate, item.loss_method, 6);
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
