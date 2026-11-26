import { Button } from './ui/controls.jsx';
import { t } from './i18n/index.js';
export function OrderDeliveryDetails({ order, onViewOrder }) {
  if (order.kind === 'return' && order.type === 'out' || order.return_mode === 'replacement') {
    const receipt = order.return_mode === 'replacement';
    const fields = [
      [receipt ? 'warehouse.returns.number' : 'warehouse.returns.source', order.source_number, order.source_order_id],
      ['warehouse.returns.po', order.order_number], ['warehouse.delivery.number', order.delivery_number],
      ...(!receipt ? [['warehouse.returns.date', order.return_date || order.created_at.slice(0,10)], ['warehouse.returns.mode', t(order.return_mode === 'exchange' ? 'warehouse.returns.exchange' : 'warehouse.returns.return')]] : []),
      ...(order.replacement_number ? [['warehouse.returns.receipt', order.replacement_number, order.replacement_id]] : []),
    ];
    return <div className="detail-meta return-meta">{fields.map(([key, value, id]) => <div key={key}>
      <small>{t(key)}</small>
      {id && onViewOrder ? <Button type="link" onClick={() => onViewOrder(id)}>{value || id}</Button> : <strong>{value || '—'}</strong>}
    </div>)}</div>;
  }
  if (order.type !== 'in' || !['normal', 'internal'].includes(order.kind)) return null;
  return <div className="detail-meta">{['delivery_number', 'delivery_time', 'order_number'].map(key => <div key={key}><small>{t(`warehouse.${key.replaceAll('_', '.')}`)}</small><strong>{(order[key] || '—').replace('T', ' ')}</strong></div>)}</div>;
}
