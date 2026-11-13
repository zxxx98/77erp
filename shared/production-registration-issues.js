import { exactQuantity, exactAdd, exactSubtract, exactMultiply, exactCompare, exactMax, quantityFields, parseProductionQuantity } from './exact-quantity.js';
import { stagePoolPaths } from './production-pools.js';

// Pending registrations claim quantities for reporting only. They never change
// the stock, material cost pool or FIFO allocations before settlement.
export function registrationRequirements(order, body, endpoint) {
  const requirements = new Map();
  const add = (key, kind, item, quantity, available) => {
    const previous = requirements.get(key);
    requirements.set(key, { key, kind, name: item.name, unit: item.unit, product_id: item.product_id,
      path: item.path ?? '', quantity: exactAdd(previous?.quantity ?? 0, quantity), available });
  };
  const material = (item, quantity) => {
    if (item.usage_mode === 'explode') {
      const paths = stagePoolPaths(order, item.path).sort();
      add(`semi:${paths.join('|')}`, 'semi', item, quantity, exactQuantity(item, 'available_quantity'));
    } else {
      const source = order.items.find(row => row.product_id === item.product_id);
      add(`material:${item.product_id}`, 'material', item, quantity,
        order.material_workflow ? exactQuantity(source, 'available_quantity') : exactQuantity(source.product, 'stock'));
    }
  };
  const operation = (path, quantity, output) => {
    const route = order.operation_routes?.find(row => row.path === path);
    const node = route?.operations.find(row => row.id === body.operation_node_id);
    if (node?.available_quantity != null) {
      const paths = route.product_coefficient == null ? stagePoolPaths(order, path).sort() : [path];
      add(`operation:${paths.join('|')}:${node.id}`, route.product_coefficient == null ? 'predecessor' : 'post_processing',
        { ...node, path, unit: route.unit ?? order.stages?.find(row => row.path === path)?.unit ?? order.unit }, quantity, exactQuantity(node, 'available_quantity'));
    }
    if (!output && route?.product_coefficient != null) for (const item of node?.materials ?? [])
      material(item, exactMultiply(item.quantity, quantity));
  };
  if (endpoint === 'operations/report') {
    operation(body.path, parseProductionQuantity(body.quantity, true), false);
  } else if (endpoint === 'stages/complete') {
    for (const part of body.auto_overflow ? body.allocations : [body]) {
      const stage = order.stages.find(row => row.path === part.path);
      for (const actual of part.items) material(stage.items.find(row => row.path === actual.path), parseProductionQuantity(actual.quantity));
      operation(part.path, parseProductionQuantity(part.completed_quantity ?? part.quantity, true), true);
    }
  } else {
    for (const actual of body.items) material(order.items.find(row => row.product_id === actual.product_id), parseProductionQuantity(actual.quantity));
    operation('', parseProductionQuantity(body.completed_quantity, true), true);
  }
  return [...requirements.values()];
}

export function registrationIssueState(order, registrations) {
  const claimed = new Map(), summary = new Map();
  const rows = [...registrations].sort((a, b) => a.id - b.id).map(row => {
    if (row.status !== 'pending') return { ...row, issues: [] };
    const issues = [];
    for (const requirement of registrationRequirements(order, JSON.parse(row.body), row.endpoint)) {
      const needed = exactAdd(claimed.get(requirement.key) ?? 0, requirement.quantity);
      claimed.set(requirement.key, needed);
      const missing = exactMax(0, exactSubtract(needed, requirement.available));
      if (exactCompare(missing, 0) > 0) {
        const { quantity, available, ...metadata } = requirement;
        const issue = { ...metadata, ...quantityFields(missing, 'missing_quantity'),
          ...quantityFields(needed, 'required_quantity'), ...quantityFields(available, 'available_quantity') };
        issues.push(issue);
        summary.set(requirement.key, issue);
      }
    }
    return { ...row, issues };
  });
  return { rows, issues: [...summary.values()] };
}
