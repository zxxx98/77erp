import { isProductionAssignee, productionAssignments } from '../shared/production-assignment.js';
import { hasPermission } from '../shared/permissions.js';
const fail = (message, status) => { throw Object.assign(new Error(message), {status}); };
export const isGroupProductionWorker = user => !!user && !hasPermission(user, 'production') && hasPermission(user, 'production_register');
export function assertProductionReader(user) {
  if (user && !hasPermission(user,'production') && !hasPermission(user,'production_register')) fail('需要生产管理或生产登记权限。',403);
}
export function assertProductionOrderAccess(user, order) {
  assertProductionReader(user);
  if (isGroupProductionWorker(user) && !isProductionAssignee(user, order))
    fail('生产单不存在或未指派给当前用户。',404);
}
// Registered quantities and material identities are sufficient for shop-floor work.
// Inventory balances and accounting values must never enter the restricted response.
export function productionWorkerProjection(value) {
  if (Array.isArray(value)) return value.map(productionWorkerProjection);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['stock','inventory_value_cents'].includes(key) && !/(?:^|_)(?:cost|price)(?:_|$)/.test(key))
    .map(([key, child]) => [key,productionWorkerProjection(child)]));
  return value;
}

export function productionRegistrationGroup(user, order) {
  if (!isGroupProductionWorker(user)) return { id: order.production_group_id, name: order.production_group_name };
  const group = productionAssignments(order).assigned_groups.find(group => group.id === user.production_group_id);
  return { id: group?.id ?? null, name: group?.name ?? '' };
}
