import React from 'react';
import { Payments } from '../LazyComponents.jsx';
import { OrderActions } from '../LazyComponents.jsx';
import { orderLabel } from '../order-utils.js';
import { usePermissions } from '../permissions.jsx';
import { orderLineAmount } from '../../shared/money.js';
import { MobileButton, DetailRow, Notice, money, price, count, dateTime } from './ui.jsx';

export function MobileOrderDetail({ order, Modal, onClose, onSaved }) {
  const { can, costs } = usePermissions();
  // Transfer legs move stock without money: they show the counterpart warehouse
  // and the moved cost, and they are corrected from the transfer list instead.
  const transfer = order.kind === 'transfer';
  const counterpart = transfer ? (order.transfer_warehouse_id ? `仓库 #${order.transfer_warehouse_id}` : '对方仓库') : order.partner;
  const costTotal = transfer ? order.items.reduce((sum, item) => sum + (item.cost_cents || 0), 0) / 100 : 0;
  const totalQuantity = order.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const totalLabel = transfer ? '调拨成本' : order.kind === 'internal' ? '参考金额' : '合计金额';
  return <Modal title="单据详情" onClose={onClose}>
    <div className="form-body mw-stack"><section className="mw-card mw-stack"><h2>{orderLabel(order)}</h2><DetailRow label="单据号">{order.number}</DetailRow><DetailRow label={transfer ? (order.type === 'in' ? '来自仓库' : '发往仓库') : '往来单位'}>{counterpart}</DetailRow><DetailRow label="创建时间">{dateTime(order.created_at)}</DetailRow></section>
      {order.items.map((item, index) => <section className="mw-card mw-stack" key={item.id || `${item.product_id}:${index}`}><strong>{item.name}</strong><p className="mw-muted">{item.barcode}</p>{transfer
        ? <div className="mw-between"><span>数量 {count(item.quantity)}</span><strong>{costs && item.cost_cents != null ? `成本 ${money(item.cost_cents / 100)}` : '—'}</strong></div>
        : <div className="mw-between"><span>{count(item.quantity)} × {price(item.price)}</span><strong>{money(orderLineAmount(item) / 100)}</strong></div>}</section>)}
      <section className="mw-card mw-stack mw-order-total"><div className="mw-between"><span>总计 · {order.items.length} 种物料</span><strong>总数量 {count(totalQuantity)}</strong></div><div className="mw-between"><span className="mw-muted">{totalLabel}</span><strong>{transfer ? (costs ? money(costTotal) : '—') : money(order.total)}</strong></div></section>
      {order.kind === "internal" && <Notice>内部流转不计入采购、销售、利润及应收应付；金额仅供库存流转参考。</Notice>}
      {transfer && <Notice>仓库间调拨不涉及金额。如需撤销，请在「更多 → 业务管理 → 仓库调拨」中操作调出仓库的记录。</Notice>}
      <p className="mw-muted">开单人：{order.created_by_name || '历史记录，操作人未知'}</p>
      {order.note && <section className="mw-card mw-stack"><span className="mw-muted">备注</span><p>{order.note}</p></section>}
      {!transfer && order.kind !== 'internal' && can('finance') && <Payments order={order} />}
      {!transfer && can('corrections') && <OrderActions order={order} onSaved={onSaved} />}
    </div><div className="modal-footer"><MobileButton onClick={onClose}>关闭详情</MobileButton></div>
  </Modal>;
}
