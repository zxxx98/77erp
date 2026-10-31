import { addQuantity, validQuantity } from './quantity.js';

// Allocate only equivalent immutable snapshots; each path keeps its own ledger.
export function operationAllocation(order, path, nodeId, quantity) {
  if (!validQuantity(quantity, true)) throw new Error('工序数量需为正数，最多 4 位小数。');
  const layers = order.stage_workflow ? order.stages : [{ ...order, path: '' }];
  const layer = layers.find(row => row.path === path);
  const route = order.operation_routes?.find(row => row.path === path);
  const node = route?.operations.find(row => row.id === nodeId);
  if (!layer || !node) throw new Error('请选择有效工序。');
  if (layer.unit_round_up && !Number.isInteger(quantity)) throw new Error('工序数量必须符合物料取整规则。');
  // Shared stages already expose pooled predecessor progress. Register once;
  // the next production layer determines the actual destination on consumption.
  if (order.stage_workflow && order.nodes?.length) return [{ path, node_id: nodeId, layer, node, quantity }];
  const peers = layers.filter(row => row.path !== path && row.product_id === layer.product_id && row.bom_id === layer.bom_id && row.bom_version === layer.bom_version && row.unit === layer.unit && row.unit_round_up === layer.unit_round_up);
  const candidates = [layer, ...peers].flatMap(row => {
    const snapshot = order.operation_routes.find(r => r.path === row.path);
    const operation = snapshot?.operations.find(n => n.id === nodeId);
    if (!operation || snapshot.route_id !== route.route_id || snapshot.route_version !== route.route_version || JSON.stringify(snapshot.graph) !== JSON.stringify(route.graph)) return [];
    const planned = Math.max(0, addQuantity(row.planned_quantity, -operation.completed_quantity));
    const capacity = Math.floor(Math.min(planned, operation.available_quantity ?? planned) * (row.unit_round_up ? 1 : 10000) + 1e-7) / (row.unit_round_up ? 1 : 10000);
    return [{ path: row.path, node_id: nodeId, layer: row, node: operation, capacity }];
  });
  // Preserve intentional overproduction when this operation has no equivalent paths.
  if (candidates.length < 2) return [{ path, node_id: nodeId, layer, node, quantity }];
  let remaining = quantity;
  const result = [];
  for (const candidate of candidates) {
    const allocated = Math.min(remaining, candidate.capacity);
    if (allocated > 0) result.push({ ...candidate, quantity: allocated });
    remaining = addQuantity(remaining, -allocated);
    if (!remaining) break;
  }
  if (remaining) throw new Error('相同工序剩余可登记数量不足，请核对计划数量及前序报工。');
  return result;
}
