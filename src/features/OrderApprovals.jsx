import { addQuantity } from '../../shared/quantity.js';
import { OrderDeliveryDetails } from '../OrderDeliveryDetails.jsx';
import { useEffect, useState } from 'react';
import { t } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { localizeError } from '../i18n/errors.js';
import { usePermissions } from '../permissions.jsx';
import { useBusiness } from '../business-api.js';
import { useQuery, queryPath } from '../queries.js';
import { Button, Badge, QueryStatus } from '../components/common.jsx';
import { Input } from '../ui/controls.jsx';
import { Select } from '../Dropdown.jsx';
import { ProductionApprovalDialog } from './ProductionApprovalDialog.jsx';
import { money, price, count, dateTime, currencySymbol } from '../app/format.js';
import { orderLabel } from '../order-utils.js';
import './production-materials.css';

export const orderStatusLabel = (order, language) => t(order.approval_origin === 'legacy' && order.status === 'active' ? 'stockApproval.legacy' : `stockApproval.${order.status}`, language ? {lng:language} : {});
const tone = status => status === 'pending' ? 'orange' : status === 'active' ? 'green' : 'gray';

export function OrderApprovalContent({ order, onChanged, onCopy, onBusy }) {
  useLocale();
  const { can, user } = usePermissions();
  const action = useBusiness();
  const [reasonAction, setReasonAction] = useState(null), [reason, setReason] = useState('');
  useEffect(() => { onBusy?.(action.busy); }, [action.busy,onBusy]);
  const pending = order.status === 'pending';
  const quantities = order.items.reduce((totals, item) => totals.set(item.product_id, addQuantity(totals.get(item.product_id) || 0, item.quantity)), new Map());
  const process = kind => action.run(async () => {
    if (kind === 'approve' && !window.confirm(t('stockApproval.approveConfirm',{number:order.number}))) return;
    await action.send(`/orders/${order.id}/${kind}`,{version:order.version,...(kind !== 'approve' ? {reason} : {})},{warehouseId:order.warehouse_id});
    await onChanged?.(t('stockApproval.processed'));
  });
  return <article className="material-document stock-approval-document">
    <div className="material-document-heading"><div><strong>{order.number}</strong><p>{orderLabel(order)}</p></div><Badge tone={tone(order.status)}>{orderStatusLabel(order)}</Badge></div>
    <OrderDeliveryDetails order={order} />
    <p>{t('warehouse.business.partner')}：{order.partner}</p>
    <p className="material-muted">{t('stockApproval.submitter')}：{order.created_by_name || '—'} · {dateTime(order.submitted_at || order.created_at)}</p>
    {order.approved_at && <p className="material-muted">{t('stockApproval.approver')}：{order.approved_by_name} · {dateTime(order.approved_at)}</p>}
    {order.note && <p className="material-note">{order.note}</p>}
    {order.reject_reason && <p className="material-note">{t('stockApproval.rejected')}：{order.rejected_by_name} · {dateTime(order.rejected_at)} · {order.reject_reason}</p>}
    {order.cancel_reason && <p className="material-note">{t('stockApproval.cancelled')}：{order.cancelled_by_name} · {dateTime(order.cancelled_at)} · {order.cancel_reason}</p>}
    {pending && <p className="info-box">{t('stockApproval.noStockChange')}</p>}
    <ul className="material-document-lines">{order.items.map(item => <li key={item.id}>
      <div><strong>{item.name}</strong><small>{item.barcode}</small></div>
      <div><small>{t('warehouse.quantity')}</small><span>{count(item.quantity)} {item.unit}</span></div>
      <div><small>{t('warehouse.unit.price')}</small><span>{currencySymbol()}{price(item.price)}</span></div>
      <div><small>{t('warehouse.amount')}</small><span>{currencySymbol()}{money(item.amount_cents / 100)}</span></div>
      {pending && <div className="stock-approval-balance"><small>{t('stockApproval.currentStock')}</small><span>{item.current_stock == null ? '—' : count(item.current_stock)} {item.current_unit}</span><small>{t('stockApproval.afterStock')}</small><span>{item.current_stock == null || item.current_unit !== item.unit || item.current_unit_round_up !== item.unit_round_up ? '—' : count(addQuantity(item.current_stock, (order.type === 'in' ? 1 : -1) * quantities.get(item.product_id)))} {item.unit}</span>{order.type === 'out' && item.current_stock < item.quantity && <small className="form-error">{t('stockApproval.insufficient')}</small>}</div>}
    </li>)}</ul>
    <p><strong>{t('warehouse.total')} {currencySymbol()}{money(order.total)}</strong></p>
    {action.error && <p className="form-error" role="alert">{localizeError(action.error)}</p>}
    <div className="material-actions stock-approval-actions">
      {pending && can('stock_approve') && <><Button kind="primary" disabled={action.busy || navigator.onLine === false} onClick={() => process('approve')}>{t('stockApproval.approve')}</Button><Button disabled={action.busy} onClick={() => {setReasonAction('reject');setReason('');}}>{t('stockApproval.reject')}</Button></>}
      {pending && order.created_by === user.id && can(order.type === 'in' ? 'purchase' : 'sale') && <Button disabled={action.busy} onClick={() => {setReasonAction('cancel');setReason('');}}>{t('stockApproval.cancel')}</Button>}
      {['rejected','cancelled'].includes(order.status) && onCopy && can(order.type === 'in' ? 'purchase' : 'sale') && <Button onClick={() => onCopy(order)}>{t('stockApproval.copy')}</Button>}
    </div>
    {reasonAction && <div className="material-cancel"><label>{t('stockApproval.reason')}<Input.TextArea aria-label={t('stockApproval.reason')} maxLength={500} rows={3} disabled={action.busy} value={reason} onChange={e=>setReason(e.target.value)} /></label><div className="material-actions"><Button disabled={action.busy} onClick={()=>setReasonAction(null)}>{t('warehouse.cancel')}</Button><Button kind="primary" disabled={action.busy || !reason.trim() || navigator.onLine === false} onClick={()=>process(reasonAction)}>{t('stockApproval.confirmReason')}</Button></div></div>}
  </article>;
}

export function OrderApprovalDetail({ order, onClose, onChanged, onCopy }) {
  const [busy,setBusy] = useState(false);
  return <ProductionApprovalDialog title={t(order.type === 'in' ? 'stockApproval.inTitle' : 'stockApproval.outTitle')} subtitle={order.number} busy={busy} onClose={onClose}>
    <div className="form-body"><OrderApprovalContent order={order} onChanged={onChanged} onCopy={onCopy} onBusy={setBusy} /></div>
  </ProductionApprovalDialog>;
}

export function OrderApprovals({data,type,initialQuery='',onChanged,onRefresh,onCopy}) {
  useLocale(); const { can } = usePermissions();
  const [status,setStatus]=useState('pending'),[q,setQ]=useState(initialQuery),[offset,setOffset]=useState(0),[selection,setSelection]=useState(null);
  const scope=JSON.stringify([data.warehouse_id,type,status,q,offset]);
  const list=useQuery(queryPath('/orders',{approval:1,type,status:status==='all'?null:status,q,offset,limit:10}),data,q?200:0);
  const detail=useQuery(selection?.scope===scope?`/orders/${selection.id}`:null,data);
  useEffect(()=>{setSelection(null);},[scope]);
  useEffect(()=>{if(list.result && offset>0 && !list.result.orders.length) setOffset(Math.max(0,(Math.ceil(list.result.total/10)-1)*10));},[list.result,offset]);
  const completed=async()=>{setSelection(null);list.retry();await Promise.all([onChanged?.(),onRefresh?.()]);};
  return <section className="panel material-queue" aria-label={t('stockApproval.title')}>
    <div className="settings-section-heading"><h2>{t(type==='in'?'stockApproval.inTitle':type==='out'?'stockApproval.outTitle':'stockApproval.title')}</h2><Button onClick={()=>{list.retry();detail.retry();onRefresh?.();}}>{t('stockApproval.refresh')}</Button></div>
    <p className="material-muted">{t('stockApproval.description')}</p>
    <div className="material-filters"><Input type="search" aria-label={t('stockApproval.search')} placeholder={t('stockApproval.search')} value={q} onChange={e=>{setQ(e.target.value);setOffset(0);}}/><Select aria-label={t('warehouse.status')} value={status} onChange={value=>{setStatus(value);setOffset(0);}}><option value="all">{t('stockApproval.all')}</option>{['pending','active','rejected','cancelled','void'].map(key=><option key={key} value={key}>{t(`stockApproval.${key}`)}</option>)}</Select></div>
    <QueryStatus query={list}/>
    <ul className="production-approval-list">{list.result?.orders.map(order=><li className="production-approval-row" key={order.id}><div className="production-approval-summary"><div className="production-approval-number"><strong>{order.number}</strong><Badge tone={tone(order.status)}>{orderStatusLabel(order)}</Badge></div><p>{order.partner} · {order.item_names.join('、')}</p><small>{orderLabel(order)} · {order.item_count} {t('warehouse.materials')} · {order.created_by_name} · {dateTime(order.submitted_at||order.created_at)}</small></div><Button onClick={()=>setSelection({id:order.id,scope})}>{order.status==='pending'&&can('stock_approve')?t('warehouse.view.and.approve'):t('warehouse.view.details')}</Button></li>)}</ul>
    {list.result&&!list.result.orders.length&&<p className="material-muted">{t('stockApproval.empty')}</p>}
    {list.result && (offset>0||list.result.has_more)&&<div className="material-actions"><Button disabled={!offset||list.loading} onClick={()=>setOffset(Math.max(0,offset-10))}>{t('stockApproval.previous')}</Button><span>{t('stockApproval.page',{total:list.result.total,page:offset/10+1})}</span><Button disabled={!list.result.has_more||list.loading} onClick={()=>setOffset(offset+10)}>{t('stockApproval.next')}</Button></div>}
    {selection && <QueryStatus query={detail}/>}
    {selection?.scope===scope&&detail.result?.order&&<OrderApprovalDetail key={selection.id} order={detail.result.order} onClose={()=>setSelection(null)} onChanged={completed} onCopy={onCopy}/>}
  </section>;
}
