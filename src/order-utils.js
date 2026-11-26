import { t as translate, getFormatLocale } from './i18n/index.js';
const orderLabels = {
  internal: { in: 'warehouse.internal.stock.in', out: 'warehouse.internal.stock.out' },
  transfer: { in: 'warehouse.transfer.in', out: 'warehouse.transfer.out' },
  return: { in: 'warehouse.sales.return', out: 'warehouse.purchase.return' },
  normal: { in: 'warehouse.stock.in', out: 'warehouse.stock.out' },
};
export function orderLabel(order, lng) {
  let key = (orderLabels[order.kind] || orderLabels.normal)[order.type];
  if (order.return_mode === 'exchange') key = 'warehouse.returns.exchangeOut';
  if (order.return_mode === 'replacement') key = 'warehouse.returns.receipt';
  return translate(key, { lng }) + (order.status === 'void' ? translate('warehouse.voided.2', { lng }) : '');
}
export const businessType = (o) =>
  o.kind === "transfer" ? "transfer" : o.kind === "return" ? (o.type === "in" ? "out" : "in") : o.type;
// Reports use the original business direction; returns reduce its amount.
// Warehouse transfers move stock without money, so they stay out of the totals.
export const reportOrders = (orders) =>
  orders
    .filter((o) => o.status === "active" && !o.return_mode && !["transfer", "internal"].includes(o.kind))
    .map((o) =>
      o.kind === "return"
        ? { ...o, type: o.type === "in" ? "out" : "in", total: -o.total }
        : o,
    );

export const orderIconTone = order => ['void', 'rejected', 'cancelled'].includes(order.status) ? 'red' : order.status === 'active' ? 'green' : 'blue';

export function supplierReturnStatus(order, lng) {
  if (order.status !== 'active') return translate(`stockApproval.${order.status}`, { lng });
  if (order.replacement_status === 'pending') return translate('warehouse.returns.receiptPending', { lng });
  if (order.return_mode === 'exchange') return translate(order.replacement_number ? 'warehouse.returns.received' : 'warehouse.returns.awaiting', { lng });
  return translate('warehouse.returns.returned', { lng });
}
