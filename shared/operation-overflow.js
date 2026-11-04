import { addQuantity, validQuantity } from './quantity.js';
import { parseExactQuantity, exactQuantity, exactAdd, exactSubtract, exactCompare, exactMin, exactMax } from './exact-quantity.js';

// Allocate only equivalent immutable snapshots; each path keeps its own ledger.
export function operationAllocation(order, path, nodeId, quantity) {
  quantity = parseExactQuantity(quantity, true);
  const layers = order.stage_workflow ? order.stages : [{ ...order, path: '' }];
  const layer = layers.find(row => row.path === path);
  const route = order.operation_routes?.find(row => row.path === path);
  const node = route?.operations.find(row => row.id === nodeId);
  if (!layer || !node) throw new Error('请选择有效工序。');

  // Shared stages already expose pooled predecessor progress. Register once;
  // the next production layer determines the actual destination on consumption.
  if (order.stage_workflow && order.nodes?.length) return [{ path, node_id: nodeId, layer, node, quantity }];
  const peers = layers.filter(row => row.path !== path && row.product_id === layer.product_id && row.bom_id === layer.bom_id && row.bom_version === layer.bom_version && row.unit === layer.unit && row.unit_round_up === layer.unit_round_up);
  const candidates = [layer, ...peers].flatMap(row => {
    const snapshot = order.operation_routes.find(r => r.path === row.path);
    const operation = snapshot?.operations.find(n => n.id === nodeId);
    if (!operation || snapshot.route_id !== route.route_id || snapshot.route_version !== route.route_version || JSON.stringify(snapshot.graph) !== JSON.stringify(route.graph)) return [];
    const planned = exactMax(0, exactSubtract(row.planned_quantity, exactQuantity(operation, 'completed_quantity')));
    const capacity = exactMin(planned, operation.available_quantity == null ? planned : exactQuantity(operation, 'available_quantity'));
    return [{ path: row.path, node_id: nodeId, layer: row, node: operation, capacity }];
  });
  // Preserve intentional overproduction when this operation has no equivalent paths.
  if (candidates.length < 2) return [{ path, node_id: nodeId, layer, node, quantity }];
  let remaining = quantity;
  const result = [];
  for (const candidate of candidates) {
    const allocated = exactMin(remaining, candidate.capacity);
    if (exactCompare(allocated, 0) > 0) result.push({ ...candidate, quantity: allocated });
    remaining = exactSubtract(remaining, allocated);
    if (exactCompare(remaining, 0) === 0) break;
  }
  if (exactCompare(remaining, 0) > 0) throw new Error('相同工序剩余可登记数量不足，请核对计划数量及前序报工。');
  return result;
}
