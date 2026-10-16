import React from 'react';
import { Payments } from '../Commerce.jsx';
import { OrderActions, orderLabel } from '../Operations.jsx';
import { usePermissions } from '../permissions.jsx';
import { orderLineAmount } from '../../shared/money.js';
import { MobileButton, DetailRow, Notice, money, count, dateTime } from './ui.jsx';

export function MobileOrderDetail({ order, Modal, onClose, onSaved }) {
  const { can, costs } = usePermissions();
  // Transfer legs move stock without money: they show the counterpart warehouse
  // and the moved cost, and they are corrected from the transfer list instead.
  const transfer = order.kind === 'transfer';
  const counterpart = transfer ? (order.transfer_warehouse_id ? `仓库 #${order.transfer_warehouse_id}` : '对方仓库') : order.partner;
  const costTotal = transfer ? order.items.reduce((sum, item) => sum + (item.cost_cents || 0), 0) / 100 : 0;
  return <Modal title="单据详情" onClose={onClose}>
    <div className="form-body mw-stack"><section className="mw-card mw-stack"><h2>{orderLabel(order)}</h2><DetailRow label="单据号">{order.number}</DetailRow><DetailRow label={transfer ? (order.type === 'in' ? '来自仓库' : '发往仓库') : '往来单位'}>{counterpart}</DetailRow><DetailRow label="创建时间">{dateTime(order.created_at)}</DetailRow>{transfer ? costs && <DetailRow label="调拨成本">{money(costTotal)}</DetailRow> : <DetailRow label="合计金额">{money(order.total)}</DetailRow>}</section>
      {order.items.map((item, index) => <section className="mw-card mw-stack" key={item.id || `${item.product_id}:${index}`}><strong>{item.name}</strong><p className="mw-muted">{item.barcode}</p>{transfer
        ? <div className="mw-between"><span>数量 {count(item.quantity)}</span><strong>{costs && item.cost_cents != null ? `成本 ${money(item.cost_cents / 100)}` : '—'}</strong></div>
        : <div className="mw-between"><span>{count(item.quantity)} × {money(item.price)}</span><strong>{money(orderLineAmount(item) / 100)}</strong></div>}</section>)}
      {transfer && <Notice>仓库间调拨不涉及金额。如需撤销，请在「更多 → 业务管理 → 仓库调拨」中操作调出仓库的记录。</Notice>}
      <p className="mw-muted">开单人：{order.created_by_name || '历史记录，操作人未知'}</p>
      {order.note && <section className="mw-card mw-stack"><span className="mw-muted">备注</span><p>{order.note}</p></section>}
      {!transfer && can('finance') && <Payments order={order} />}
      {!transfer && can('corrections') && <OrderActions order={order} onSaved={onSaved} />}
    </div><div className="modal-footer"><MobileButton onClick={onClose}>关闭详情</MobileButton></div>
  </Modal>;
}
