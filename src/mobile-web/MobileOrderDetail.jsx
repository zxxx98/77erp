import React from 'react';
import { Payments } from '../Commerce.jsx';
import { OrderActions, orderLabel } from '../Operations.jsx';
import { usePermissions } from '../permissions.jsx';
import { orderLineAmount } from '../../shared/money.js';
import { MobileButton, DetailRow, money, count, dateTime } from './ui.jsx';

export function MobileOrderDetail({ order, Modal, onClose, onSaved }) {
  const { can } = usePermissions();
  return <Modal title="单据详情" onClose={onClose}>
    <div className="form-body mw-stack"><section className="mw-card mw-stack"><h2>{orderLabel(order)}</h2><DetailRow label="单据号">{order.number}</DetailRow><DetailRow label="往来单位">{order.partner}</DetailRow><DetailRow label="创建时间">{dateTime(order.created_at)}</DetailRow><DetailRow label="合计金额">{money(order.total)}</DetailRow></section>
      {order.items.map((item, index) => <section className="mw-card mw-stack" key={item.id || `${item.product_id}:${index}`}><strong>{item.name}</strong><p className="mw-muted">{item.barcode}</p><div className="mw-between"><span>{count(item.quantity)} × {money(item.price)}</span><strong>{money(orderLineAmount(item) / 100)}</strong></div></section>)}
      <p className="mw-muted">开单人：{order.created_by_name || '历史记录，操作人未知'}</p>
      {order.note && <section className="mw-card mw-stack"><span className="mw-muted">备注</span><p>{order.note}</p></section>}
      {can('finance') && <Payments order={order} />}
      {can('corrections') && <OrderActions order={order} onSaved={onSaved} />}
    </div><div className="modal-footer"><MobileButton onClick={onClose}>关闭详情</MobileButton></div>
  </Modal>;
}
