import { usePermissions } from '../permissions.jsx';
import { Modal, Badge, Button } from '../components/common.jsx';
import { orderLabel } from '../order-utils.js';
import { OrderActions, Payments } from '../LazyComponents.jsx';
import { CheckCheck } from 'lucide-react';
import { money } from '../app/format.js';
import { orderLineAmount } from '../../shared/money.js';

function OrderDetail({ order, onClose, onSaved, isAdmin }) {
  const { can, costs } = usePermissions();
  // Transfers carry no money: they are corrected from the transfer list, and
  // the line value shown is the moved moving-average cost.
  const transfer = order.kind === "transfer";
  const costTotal = order.items.reduce((sum, i) => sum + (i.cost_cents || 0), 0) / 100;
  return (
    <Modal
      title={`${orderLabel(order)}单详情`}
      subtitle={order.number}
      onClose={onClose}
      wide
    >
      <div className="form-body">
        <div className="detail-status">
          <Badge>{order.status === "void" ? "已作废" : "已完成"}</Badge>
          <span>
            <CheckCheck size={15} />
            库存已同步更新
          </span>
        </div>
        <div className="detail-meta">
          <div>
            <small>{transfer ? (order.type === "in" ? "来自仓库" : "发往仓库") : "往来单位"}</small>
            <strong>{order.partner}</strong>
          </div>
          <div>
            <small>创建时间</small>
            <strong>
              {new Date(order.created_at).toLocaleString("zh-CN", {
                hour12: false,
              })}
            </strong>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table detail-table">
            <thead>
              <tr>
                <th>物料名称</th>
                <th>条码</th>
                <th className="number-cell">数量</th>
                <th className="number-cell">{transfer ? "成本单价" : "单价"}</th>
                <th className="number-cell">{transfer ? "成本小计" : "小计"}</th>
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
                      <td className="number-cell">{costs && i.cost_cents != null ? `¥ ${money(i.cost_cents / 100 / i.quantity)}` : "—"}</td>
                      <td className="number-cell">{costs && i.cost_cents != null ? `¥ ${money(i.cost_cents / 100)}` : "—"}</td>
                    </>
                  ) : (
                    <>
                      <td className="number-cell">¥ {money(i.price)}</td>
                      <td className="number-cell">
                        ¥ {money(orderLineAmount(i) / 100)}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="detail-note">
          <small>备注</small>
          <p>{order.note || "无备注"}</p>
        </div>
        <p className="muted">开单人：{order.created_by_name || '历史记录，操作人未知'}</p>
        {transfer && (
          <div className="info-box">
            仓库间调拨不涉及金额，两个仓库的库存已同步调整。请在有调出记录的仓库，通过「业务管理 → 仓库调拨」撤销。
          </div>
        )}
        {!transfer && can('finance') && <Payments order={order} />}
        {!transfer && can('corrections') && <OrderActions order={order} onSaved={onSaved} />}
      </div>
      <div className="modal-footer order-form-footer">
        <div>
          <small>{transfer ? "调拨成本" : "合计金额"}</small>
          <strong>
            {transfer ? (costs ? `¥ ${money(costTotal)}` : "—") : <><span>¥ </span>{money(order.total)}</>}
          </strong>
        </div>
        <Button onClick={onClose}>关闭详情</Button>
      </div>
    </Modal>
  );
}

export { OrderDetail };
