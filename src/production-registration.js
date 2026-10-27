import { calculateBomNodes } from '../shared/bom-expansion.js';
import { productionItemQuantity } from '../shared/production.js';
import { stageStandardQuantity } from '../shared/production-stages.js';
import { scrapExpectedQuantity } from '../shared/scrap.js';

// A route snapshot and BOM path identify the operation, never its display name.
export function registrationTargets(order) {
  const layers = order.stage_workflow ? order.stages : [{ ...order, path: '' }];
  const targets = layers.flatMap(layer => {
    const path = layer.path;
    const route = order.operation_routes?.find(row => row.path === path);
    return (route ? route.operations : [null]).map((node, index) => ({
      id: JSON.stringify([path, node?.id ?? null]), path, layer, node,
      name: node?.name ?? layer.name ?? order.product_name,
      routeName: route?.route_name ?? '', bomName: layer.bom_name ?? order.bom_name,
      step: index + 1, unit: layer.unit, output: !node || node.is_output,
    }));
  });
  const count = key => {
    const totals = new Map();
    for (const target of targets) { const value = key(target); totals.set(value, (totals.get(value) || 0) + 1); }
    return target => totals.get(key(target));
  };
  const names = count(row => row.name);
  const routes = count(row => JSON.stringify([row.name, row.routeName]));
  const boms = count(row => JSON.stringify([row.name, row.routeName, row.bomName]));
  const paths = count(row => JSON.stringify([row.name, row.routeName, row.bomName, row.path]));
  return targets.map(row => ({ ...row,
    context: [names(row) > 1 && row.routeName, routes(row) > 1 && row.bomName].filter(Boolean).join(' · '),
    showPath: boms(row) > 1, showStep: paths(row) > 1,
  }));
}

// Defaults follow the existing full registration forms, including rounding and scrap rules.
export function registrationDefaults(order, target, quantity) {
  if (!target.output) return { items: [], scraps: [] };
  const standards = !order.stage_workflow && order.snapshot_format === 2
    ? new Map(calculateBomNodes(order.nodes, quantity, order.quantity_decimals).rows.map(row => [row.product_id, row.required])) : null;
  const items = target.layer.items.map(item => ({
    ...(order.stage_workflow ? { path: item.path } : {}), product_id: item.product_id,
    quantity: String(order.stage_workflow ? stageStandardQuantity(item, quantity) : productionItemQuantity(item, quantity, order, standards)),
    variance_reason: '',
  }));
  const scraps = target.path ? [] : (order.scraps || []).map(row => ({ product_id: row.product_id,
    quantity: String(scrapExpectedQuantity(row, quantity, order.base_quantity,
      items.map(item => ({ product_id: item.product_id, quantity: Number(item.quantity) })), order.quantity_decimals)), disposition: 'stock' }));
  return { items, scraps };
}
