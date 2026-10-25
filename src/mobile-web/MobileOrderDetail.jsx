import { t as translate, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import React from 'react';
import { Payments } from '../LazyComponents.jsx';
import { OrderActions } from '../LazyComponents.jsx';
import { orderLabel } from '../order-utils.js';
import { usePermissions } from '../permissions.jsx';
import { orderLineAmount } from '../../shared/money.js';
import { MobileButton, DetailRow, Notice, money, price, count, dateTime } from './ui.jsx';

export function MobileOrderDetail({ order, Modal, onClose, onSaved }) {
  useLocale();
  const { can, costs } = usePermissions();
  // Transfer legs move stock without money: they show the counterpart warehouse
  // and the moved cost, and they are corrected from the transfer list instead.
  const transfer = order.kind === 'transfer';
  const counterpart = transfer ? (order.transfer_warehouse_id ? translate("warehouse.warehouse", { v0: order.transfer_warehouse_id }) : translate("warehouse.the.other.party.s.warehouse")) : order.partner;
  const costTotal = transfer ? order.items.reduce((sum, item) => sum + (item.cost_cents || 0), 0) / 100 : 0;
  const totalQuantity = order.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const totalLabel = transfer ? translate("warehouse.transfer.cost") : order.kind === 'internal' ? translate("warehouse.reference.amount") : translate("warehouse.total.amount");
  return <Modal title={translate("warehouse.document.details")} onClose={onClose}>
    <div className="form-body mw-stack"><section className="mw-card mw-stack"><h2>{orderLabel(order)}</h2><DetailRow label={translate("warehouse.document.no")}>{order.number}</DetailRow><DetailRow label={transfer ? (order.type === 'in' ? translate("warehouse.from.warehouse") : translate("warehouse.send.to.warehouse")) : translate("warehouse.business.partner")}>{counterpart}</DetailRow><DetailRow label={translate("warehouse.creation.time")}>{dateTime(order.created_at)}</DetailRow></section>
      {order.items.map((item, index) => <section className="mw-card mw-stack" key={item.id || `${item.product_id}:${index}`}><strong>{item.name}</strong><p className="mw-muted">{item.barcode}</p>{transfer
        ? <div className="mw-between"><span>{translate("warehouse.quantity")}{" "}{count(item.quantity)}</span><strong>{costs && item.cost_cents != null ? translate("warehouse.cost", { v0: money(item.cost_cents / 100) }) : '—'}</strong></div>
        : <div className="mw-between"><span>{count(item.quantity)} × {price(item.price)}</span><strong>{money(orderLineAmount(item) / 100)}</strong></div>}</section>)}
      <section className="mw-card mw-stack mw-order-total"><div className="mw-between"><span>{translate("warehouse.total")}{" "}{order.items.length}{" "}{translate("warehouse.materials")}</span><strong>{translate("warehouse.total.quantity")}{" "}{count(totalQuantity)}</strong></div><div className="mw-between"><span className="mw-muted">{totalLabel}</span><strong>{transfer ? (costs ? money(costTotal) : '—') : money(order.total)}</strong></div></section>
      {order.kind === "internal" && <Notice>{translate("warehouse.internal.transfers.are.not.included.in.purchases.sales.profits.receivables.and")}</Notice>}
      {transfer && <Notice>{translate("warehouse.there.is.no.amount.involved.in.inter.warehouse.transfers.if.you")}</Notice>}
      <p className="mw-muted">{translate("warehouse.biller")}{order.created_by_name || translate("warehouse.historical.record.operator.unknown")}</p>
      {order.note && <section className="mw-card mw-stack"><span className="mw-muted">{translate("warehouse.remarks")}</span><p>{order.note}</p></section>}
      {!transfer && order.kind !== 'internal' && can('finance') && <Payments order={order} />}
      {!transfer && can('corrections') && <OrderActions order={order} onSaved={onSaved} />}
    </div><div className="modal-footer"><MobileButton onClick={onClose}>{translate("warehouse.close.details")}</MobileButton></div>
  </Modal>;
}
