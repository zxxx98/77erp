import { productionMessage } from '../i18n/production-errors.js';
import { t as pt } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { useEffect, useState } from 'react';
import { Input } from '../ui/controls.jsx';
import { Button, Badge, QueryStatus } from '../components/common.jsx';
import { ProductionApprovalList } from './ProductionApprovalList.jsx';
import { ProductionApprovalDialog } from './ProductionApprovalDialog.jsx';
import { Select } from '../Dropdown.jsx';
import { usePermissions } from '../permissions.jsx';
import { useBusiness } from '../business-api.js';
import { queryPath, useQuery } from '../queries.js';
import { count, dateTime, money, currencySymbol } from '../app/format.js';
import './production-materials.css';

const statusLabels = () => ({ pending: pt("production.pendingReceipt"), confirmed: pt("production.received"), void: pt("production.voided2") });

export function ProductionReceiptList({ documents, busy, onConfirm, defaultExpanded = false }) {
  useLocale();
  const { can } = usePermissions();
  const [expanded, setExpanded] = useState(() => defaultExpanded ? documents[0]?.id : null);
  return <div className="material-documents">{documents.map(doc => <article className="material-document" id={`production-receipt-${doc.id}`} tabIndex={-1} key={doc.id}>
    <div className="material-document-heading"><div><strong>{doc.number}</strong><p>{doc.production_number} {pt("production.batch3")} {doc.batch_number} {pt("production.batch2")}</p></div>
      <Badge tone={doc.status === 'pending' ? 'orange' : doc.status === 'confirmed' ? 'green' : 'gray'}>{statusLabels()[doc.status]}</Badge></div>
    <p>{doc.product_name} · {count(doc.quantity)} {doc.unit}</p>
    <p className="material-muted">{pt("production.registered")}{doc.created_by_name} · {dateTime(doc.created_at)}</p>
    {doc.confirmed_at && <p className="material-muted">{pt("production.received2")}{doc.confirmed_by_name} · {dateTime(doc.confirmed_at)}</p>}
    {doc.voided_at && <p className="material-muted">{pt("production.voided")}{doc.voided_by_name} · {dateTime(doc.voided_at)}{doc.void_reason && ` · ${doc.void_reason}`}</p>}
    {can('finance') && doc.total_cost_cents != null && <p>{pt("production.productCost")} {currencySymbol()}{money(doc.total_cost_cents / 100)}</p>}
    {doc.note && <p className="material-note">{doc.note}</p>}
    <div className="material-actions">
      <Button disabled={busy} aria-expanded={expanded === doc.id} onClick={() => setExpanded(expanded === doc.id ? null : doc.id)}>{expanded === doc.id ? pt("production.collapseReceiptDetails") : pt("production.viewReceiptDetails")}</Button>
      {doc.status === 'pending' && onConfirm && <Button kind="primary" disabled={busy} onClick={() => onConfirm(doc)}>{pt("production.approveAndConfirmReceipt")}</Button>}
    </div>
    {expanded === doc.id && <ul className="material-document-lines">{doc.items.map(item => <li key={`${item.kind}:${item.product_id}`}>
      <div><strong>{item.name}</strong><small>{item.kind === 'scrap' ? pt("production.scrap") : pt("production.acceptedProducts")} · {item.barcode}{item.specification && ` · ${item.specification}`}</small></div>
      <span>{count(item.quantity)} {item.unit}</span>
      {can('finance') && item.cost_cents != null && <small>{pt("production.receiptCost")} {currencySymbol()}{money(item.cost_cents / 100)}</small>}
    </li>)}</ul>}
  </article>)}</div>;
}

export function ProductionReceipts({ data, onChanged, initialQuery = '', onRefresh }) {
  useLocale();
  const { can } = usePermissions();
  const [status, setStatus] = useState(initialQuery ? 'all' : 'pending'), [q, setQ] = useState(initialQuery), [offset, setOffset] = useState(0);
  const [message, setMessage] = useState('');
  const [selection, setSelection] = useState(null);
  const action = useBusiness();
  const allowed = can('purchase');
  const list = useQuery(allowed ? queryPath('/production-receipts', { status, q, offset, limit: 10 }) : null, data, q ? 200 : 0);
  const scope = JSON.stringify([data.warehouse_id, status, q, offset]);
  const documents = list.result?.documents || [];
  const selected = selection?.scope === scope ? documents.find(doc => doc.id === selection.id) : null;
  useEffect(() => {
    setSelection(current => current?.scope === scope && list.result?.documents.some(doc => doc.id === current.id) ? current : null);
  }, [scope, list.result]);
  useEffect(() => {
    if (list.result && offset > 0 && !list.result.documents.length) setOffset(Math.max(0, (Math.ceil(list.result.total / 10) - 1) * 10));
  }, [list.result, offset]);
  if (!allowed) return null;
  const confirm = doc => action.run(async () => {
    setMessage('');
    if (!window.confirm(pt("production.approveAndReceiveTheFullBatchAndListed", { v0: doc.number, v1: count(doc.quantity), v2: doc.unit, v3: doc.product_name }))) return;
    await action.send(`/production-receipts/${doc.id}/confirm`, { version: doc.version }, { warehouseId: data.warehouse_id });
    setMessage(pt("production.received3", { v0: doc.number }));
    setSelection(null);
    if (offset > 0 && documents.length === 1 && status === 'pending') setOffset(value => Math.max(0, value - 10));
    list.retry();
    await Promise.all([onChanged?.(), onRefresh?.()]);
  });
  return <section className="panel material-queue" aria-label={pt("production.productionProductReceipts")}>
    <div className="material-document-heading"><h2>{pt("production.productionProductReceipts")}</h2><Button disabled={action.busy || list.loading} onClick={() => { action.setError(''); list.retry(); onRefresh?.(); }}>{pt("production.refreshProductionReceipts")}</Button></div>
    <p className="material-muted">{pt("production.verifyAcceptedProductsAndScrapForEachBatch")}</p>
    <div className="material-filters"><Input type="search" aria-label={pt("production.searchProductionReceipts")} placeholder={pt("production.searchDocumentNumberProductionOrderOrProduct")} maxLength={100} value={q} disabled={action.busy} onChange={event => { setQ(event.target.value); setOffset(0); }} />
      <Select aria-label={pt("production.productionReceiptStatus")} value={status} disabled={action.busy} onChange={value => { setStatus(value); setOffset(0); }}><option value="all">{pt("production.allStatuses")}</option>{Object.entries(statusLabels()).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></div>
    {message && <p className="material-success" role="status">{productionMessage(message)}</p>}
    {productionMessage(action.error) && !selected && <p className="form-error" role="alert">{productionMessage(action.error)} {pt("production.refreshToCheckTheCurrentStatus")}</p>}
    <QueryStatus query={list} />
    <ProductionApprovalList documents={documents} busy={action.busy || list.loading} onView={id => { action.setError(''); setSelection({ id, scope }); }} statusLabels={statusLabels()} receipt />
    {list.result && !list.result.documents.length && <p className="material-muted">{pt("production.noMatchingProductionReceipts")}</p>}
    {list.result && (offset > 0 || list.result.has_more) && <div className="material-actions"><Button disabled={action.busy || list.loading || !offset} onClick={() => setOffset(value => Math.max(0, value - 10))}>{pt("production.previousProductionReceipts")}</Button><span>{pt("production.total")} {list.result.total} {pt("production.ordersPage")} {offset / 10 + 1} {pt("production.page")}</span><Button disabled={action.busy || list.loading || !list.result.has_more} onClick={() => setOffset(value => value + 10)}>{pt("production.nextProductionReceipts")}</Button></div>}
    {selected && <ProductionApprovalDialog title={pt("production.productionProductReceipt")} subtitle={selected.number} busy={action.busy} onClose={() => setSelection(null)}>
      <div className="form-body">
        {productionMessage(action.error) && <p className="form-error" role="alert">{productionMessage(action.error)} {pt("production.closeDetailsAndRefreshToCheckTheCurrent")}</p>}
        <ProductionReceiptList key={selected.id} documents={[selected]} busy={action.busy} defaultExpanded onConfirm={confirm} />
      </div>
    </ProductionApprovalDialog>}
  </section>;
}
