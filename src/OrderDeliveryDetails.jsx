import { t } from './i18n/index.js';
export function OrderDeliveryDetails({ order }) {
  if (order.type !== 'in' || !['normal', 'internal'].includes(order.kind)) return null;
  return <div className="detail-meta">{['delivery_number', 'delivery_time', 'order_number'].map(key => <div key={key}><small>{t(`warehouse.${key.replaceAll('_', '.')}`)}</small><strong>{(order[key] || '—').replace('T', ' ')}</strong></div>)}</div>;
}
