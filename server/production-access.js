import { hasPermission } from '../shared/permissions.js';
const fail = (message, status) => { throw Object.assign(new Error(message), {status}); };
export const isGroupProductionWorker = user => !!user && !hasPermission(user, 'production') && hasPermission(user, 'production_register');
export function assertProductionReader(user) {
  if (user && !hasPermission(user,'production') && !hasPermission(user,'production_register')) fail('需要生产管理或生产登记权限。',403);
}
export function assertProductionOrderAccess(user, order) {
  assertProductionReader(user);
  if (isGroupProductionWorker(user) && (!user.production_group_id || order.production_group_id !== user.production_group_id))
    fail('生产单不存在或不属于当前生产组。',404);
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
