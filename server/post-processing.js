import { exactCompare, exactQuantity, exactSubtract } from '../shared/exact-quantity.js';
import { postProcessingLimit, productionOutputCompleted } from '../shared/post-processing.js';

const conflict = message => { throw Object.assign(new Error(message), { status: 409 }); };

export function assertOutputOpen(order) {
  if (order.output_completion_confirmed) conflict('成品生产已确认完成，请先撤销确认再登记成品。');
}

export function assertPostProcessingLimits(order, quantity, confirmed) {
  const completed = productionOutputCompleted(order, quantity, confirmed);
  for (const route of order.operation_routes.filter(route => route.product_coefficient != null)) {
    const limit = postProcessingLimit(quantity, route.product_coefficient, completed, route.graph);
    if (exactCompare(exactQuantity(route.operations[0], 'completed_quantity'), limit) > 0)
      conflict('调整后已登记后处理次数将超过可登记上限，请先作废相应后处理记录。');
  }
}

export function reopenAfterRootOutputVoid(db, order, batch) {
  if (!order.operation_routes.some(route => route.product_coefficient != null)) return;
  const quantity = exactSubtract(exactQuantity(order, 'completed_quantity'), exactQuantity(batch, 'completed_quantity'));
  assertPostProcessingLimits(order, quantity, false);
  db.prepare('UPDATE production_orders SET output_completion_confirmed=0 WHERE id=?').run(order.id);
}
