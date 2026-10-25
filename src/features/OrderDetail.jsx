import { t as translate, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { usePermissions } from '../permissions.jsx';
import { Modal, Badge, Button } from '../components/common.jsx';
import { orderLabel } from '../order-utils.js';
import { OrderActions, Payments } from '../LazyComponents.jsx';
import { CheckCheck } from 'lucide-react';
import { money, price, count, currencySymbol } from '../app/format.js';
import { orderLineAmount } from '../../shared/money.js';

function OrderDetail({ order, onClose, onSaved, isAdmin }) {
  useLocale();
  const { can, costs } = usePermissions();
  // Transfers carry no money: they are corrected from the transfer list, and
  // the line value shown is the moved moving-average cost.
  const transfer = order.kind === "transfer";
  const costTotal = order.items.reduce((sum, i) => sum + (i.cost_cents || 0), 0) / 100;
  const totalQuantity = order.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const totalLabel = transfer
    ? translate("warehouse.total.transfer.cost")
    : order.kind === "internal"
      ? translate("warehouse.total.reference.amount")
      : translate("warehouse.total.3");
  return (
    <Modal
      title={translate("warehouse.order.details", { v0: orderLabel(order) })}
      subtitle={order.number}
      onClose={onClose}
      presentation="drawer"
      drawerSize="wide"
      wide
    >
      <div className="form-body">
        <div className="detail-status">
          <Badge>{order.status === "void" ? translate("warehouse.voided") : translate("warehouse.completed")}</Badge>
          <span>
            <CheckCheck size={15} />{translate("warehouse.inventory.has.been.updated.simultaneously")}</span>
        </div>
        <div className="detail-meta">
          <div>
            <small>{transfer ? (order.type === "in" ? translate("warehouse.from.warehouse") : translate("warehouse.send.to.warehouse")) : translate("warehouse.business.partner")}</small>
            <strong>{order.partner}</strong>
          </div>
          <div>
            <small>{translate("warehouse.creation.time")}</small>
            <strong>
              {new Date(order.created_at).toLocaleString(getFormatLocale(), {
                hour12: false,
              })}
            </strong>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table detail-table">
            <thead>
              <tr>
                <th>{translate("warehouse.material.name")}</th>
                <th>{translate("warehouse.barcode")}</th>
                <th className="number-cell">{translate("warehouse.quantity")}</th>
                <th className="number-cell">{transfer ? translate("warehouse.cost.unit.price") : translate("warehouse.unit.price")}</th>
                <th className="number-cell">{transfer ? translate("warehouse.cost.subtotal") : translate("warehouse.subtotal")}</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  <td className="mono muted">{i.barcode}</td>
                  <td className="number-cell">{i.quantity}</td>
                  {transfer ? (
                    <>
                      <td className="number-cell">{costs && i.cost_cents != null ? `${currencySymbol()} ${price(i.cost_cents / 100 / i.quantity)}` : "—"}</td>
                      <td className="number-cell">{costs && i.cost_cents != null ? `${currencySymbol()} ${money(i.cost_cents / 100)}` : "—"}</td>
                    </>
                  ) : (
                    <>
                      <td className="number-cell">{currencySymbol()} {price(i.price)}</td>
                      <td className="number-cell">
                        {currencySymbol()} {money(orderLineAmount(i) / 100)}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="table-total-row">
                <td colSpan={2}>{totalLabel} · {order.items.length}{" "}{translate("warehouse.materials")}</td>
                <td className="number-cell">{count(totalQuantity)}</td>
                <td />
                <td className="number-cell">
                  {transfer ? (costs ? `${currencySymbol()} ${money(costTotal)}` : "—") : <>{currencySymbol()} {money(order.total)}</>}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="detail-note">
          <small>{translate("warehouse.remarks")}</small>
          <p>{order.note || translate("warehouse.no.remarks")}</p>
        </div>
        <p className="muted">{translate("warehouse.biller")}{order.created_by_name || translate("warehouse.historical.record.operator.unknown")}</p>
        {order.kind === "internal" && <p className="info-box">{translate("warehouse.internal.transfers.are.not.included.in.purchases.sales.profits.receivables.and")}</p>}
        {transfer && (
          <div className="info-box">{translate("warehouse.there.is.no.amount.involved.in.inter.warehouse.transfers.and.the")}</div>
        )}
        {!transfer && order.kind !== 'internal' && can('finance') && <Payments order={order} />}
        {!transfer && can('corrections') && <OrderActions order={order} onSaved={onSaved} />}
      </div>
      <div className="modal-footer order-form-footer">
        <div>
          <small>{translate("warehouse.material.type")}</small>
          <strong>
            {order.items.length}
            <span>{" "}{translate("warehouse.types")}</span>
          </strong>
        </div>
        <Button onClick={onClose}>{translate("warehouse.close.details")}</Button>
      </div>
    </Modal>
  );
}

export { OrderDetail };
