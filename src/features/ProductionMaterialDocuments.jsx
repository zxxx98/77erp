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
import { parseQuantity } from '../../shared/quantity.js';
import { useBusiness } from '../business-api.js';
import { queryPath, useQuery } from '../queries.js';
import { count, dateTime, money, currencySymbol } from '../app/format.js';
import './production-materials.css';

const statusLabels = (type = 'out') => ({ pending: pt("production.pendingApproval"), confirmed: pt(type === 'in' ? "production.completed" : "production.fullyIssued"),
  ...(type === 'in' ? { cancelled: pt("production.cancelled") } : { partial: pt("production.partiallyIssued"), closed: pt("production.requestClosed") }) });
const titleFor = doc => doc.type === 'in' ? pt("production.productionMaterialReturn") : doc.kind === 'supplement' ? pt("production.productionMaterialSupplement") : pt("production.productionMaterialIssue");

export function MaterialDocumentList({ documents, busy, onConfirm, onCancel, defaultExpanded = false }) {
  useLocale();
  const { can } = usePermissions();
  const [expanded, setExpanded] = useState(() => defaultExpanded ? documents[0]?.id : null);
  const [cancelling, setCancelling] = useState(null);
  const [reason, setReason] = useState('');
  const [quantities, setQuantities] = useState({}), [error, setError] = useState('');
  const confirm = doc => {
    try {
      setError('');
      const items = doc.type === 'out' ? doc.items.filter(item => item.pending_quantity > 0).map(item => ({ product_id: item.product_id,
        quantity: parseQuantity(quantities[`${doc.id}:${item.product_id}`] ?? String(item.pending_quantity)) })).filter(item => item.quantity > 0) : undefined;
      if (items && !items.length) throw new Error(pt('production.enterIssueQuantity'));
      if (items?.some(row => doc.items.find(item => item.product_id === row.product_id).unit_round_up && !Number.isInteger(row.quantity))) throw new Error(pt('production.issuedMaterialMustBeWhole'));
      if (items?.some(row => row.quantity > doc.items.find(item => item.product_id === row.product_id).pending_quantity)) throw new Error(pt('production.issueExceedsRemaining'));
      onConfirm(doc, items);
    } catch (error) { setError(error.message); }
  };
  return <div className="material-documents">{documents.map(doc => <article className="material-document" key={doc.id}>
    <div className="material-document-heading"><div><strong>{doc.number}</strong><p>{titleFor(doc)} · {doc.production_number}</p></div>
      <Badge tone={doc.status === 'pending' ? 'orange' : doc.status === 'confirmed' ? 'green' : 'gray'}>{statusLabels(doc.type)[doc.fulfillment_status || doc.status]}</Badge></div>
    <p>{doc.product_name}</p>
    <p className="material-muted">{pt("production.requested")}{doc.created_by_name} · {dateTime(doc.created_at)}</p>
    {doc.confirmed_at && <p className="material-muted">{pt("production.confirmed")}{doc.confirmed_by_name} · {dateTime(doc.confirmed_at)}</p>}
    {doc.cancelled_at && <p className="material-muted">{pt("production.cancelled2")}{doc.cancelled_by_name} · {dateTime(doc.cancelled_at)}{doc.cancel_reason && ` · ${doc.cancel_reason}`}</p>}
    {doc.note && <p className="material-note">{doc.note}</p>}
    <div className="material-actions">
      <Button disabled={busy} aria-expanded={expanded === doc.id} onClick={() => setExpanded(expanded === doc.id ? null : doc.id)}>{expanded === doc.id ? pt("production.collapseMaterialDetails") : pt("production.viewMaterialDetails")}</Button>
      {doc.status === 'pending' && onConfirm && <Button kind="primary" disabled={busy} onClick={() => confirm(doc)}>{pt("production.approveAndConfirm")}{doc.type === 'out' ? pt("production.issue") : pt("production.receipt2")}</Button>}
      {doc.status === 'pending' && onCancel && <Button disabled={busy} onClick={() => { setCancelling(doc.id); setReason(''); }}>{doc.type === 'out' && doc.issues?.length ? pt('production.closeRemaining') : pt("production.cancelRequest")}</Button>}
    </div>
    {error && <p className="form-error" role="alert">{productionMessage(error)}</p>}
    {expanded === doc.id && <ul className="material-document-lines">{doc.items.map(item => <li key={item.product_id}>
      <div><strong>{item.name}</strong><small>{item.barcode}{item.specification && ` · ${item.specification}`}</small></div>
      <div><small>{pt("production.applicationQuantity")}</small><span>{count(item.quantity)} {item.unit}</span></div>
      {doc.type === 'out' && <div className="material-issue-progress">
        <span>{pt('production.issued')} {count(item.issued_quantity)} {item.unit}</span>
        <span>{pt('production.pendingIssue')} {count(item.pending_quantity)} {item.unit}</span>
        {item.closed_quantity > 0 && <span>{pt('production.closedQuantity')} {count(item.closed_quantity)} {item.unit}</span>}
      </div>}
      {doc.status === 'pending' && doc.type === 'out' && onConfirm && item.pending_quantity > 0 && <label className="material-issue-input">{pt('production.currentIssue')}
        <Input aria-label={pt('production.currentIssueFor', { name: item.name })} inputMode="decimal" disabled={busy}
          value={quantities[`${doc.id}:${item.product_id}`] ?? String(item.pending_quantity)}
          onChange={event => { setError(''); setQuantities(previous => ({ ...previous, [`${doc.id}:${item.product_id}`]: event.target.value })); }} />
      </label>}
      {can('finance') && item.cost_cents != null && <small>{pt("production.materialCost")} {currencySymbol()}{money(item.cost_cents / 100)}</small>}
    </li>)}</ul>}
    {expanded === doc.id && doc.issues?.length > 0 && <section className="material-issue-history" aria-label={pt('production.issueHistory')}>
      <h3>{pt('production.issueHistory')}</h3>{doc.issues.map(issue => <div className="material-issue-record" key={issue.id}>
        <strong>{issue.number}</strong><p className="material-muted">{issue.confirmed_by_name} · {dateTime(issue.confirmed_at)}</p>
        {issue.items.map(row => { const item = doc.items.find(item => item.product_id === row.product_id); return <p key={row.product_id}>
          {item.name} · {count(row.quantity)} {item.unit}
          {can('finance') && row.cost_cents != null && <small> · {pt('production.materialCost')} {currencySymbol()}{money(row.cost_cents / 100)}</small>}
        </p>; })}
      </div>)}
    </section>}
    {cancelling === doc.id && doc.status === 'pending' && <div className="material-cancel">
      <label>{pt("production.cancellationReason")}<Input.TextArea aria-label={pt("production.requestCancellationReason")} rows={2} maxLength={500} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
      <div className="material-actions"><Button disabled={busy} onClick={() => setCancelling(null)}>{pt("production.keepRequest")}</Button><Button kind="danger" disabled={busy || !reason.trim()} onClick={() => onCancel(doc, reason.trim())}>{doc.issues?.length ? pt("production.confirmCloseRemaining") : pt("production.confirmCancellation")}</Button></div>
    </div>}
  </article>)}</div>;
}

export function ProductionMaterialDocuments({ data, type, onChanged, initialQuery = '', onRefresh }) {
  useLocale();
  const { can } = usePermissions();
  const [status, setStatus] = useState(initialQuery ? 'all' : 'pending'), [q, setQ] = useState(initialQuery), [offset, setOffset] = useState(0);
  const [message, setMessage] = useState('');
  const [selection, setSelection] = useState(null);
  const action = useBusiness();
  const allowed = can(type === 'out' ? 'sale' : 'purchase');
  const list = useQuery(allowed ? queryPath('/production-material-documents', { type, status, q, offset, limit: 10 }) : null, data, q ? 200 : 0);
  const scope = JSON.stringify([data.warehouse_id, type, status, q, offset]);
  const documents = list.result?.documents || [];
  const selected = selection?.scope === scope ? selection.document : null;
  useEffect(() => {
    setSelection(current => current?.scope === scope && list.result?.documents.some(doc => doc.id === current.id) ? current : null);
  }, [scope, list.result]);
  useEffect(() => {
    if (list.result && offset > 0 && !list.result.documents.length) setOffset(Math.max(0, (Math.ceil(list.result.total / 10) - 1) * 10));
  }, [list.result, offset]);
  if (!allowed) return null;
  const completed = async () => {
    setSelection(null);
    if (offset > 0 && documents.length === 1 && status === 'pending') setOffset(value => Math.max(0, value - 10));
    list.retry();
    await Promise.all([onChanged?.(), onRefresh?.()]);
  };
  const confirm = (doc, items) => action.run(async () => {
    const direction = doc.type === 'out' ? pt("production.issue") : pt("production.receipt2");
    if (!window.confirm(doc.type === 'out' ? pt('production.confirmCurrentIssue', { number: doc.number }) : pt("production.approveAndTheEntireOrder", { v0: doc.number, v1: direction, v2: pt("production.unusedMaterialsWillReturnToTheCurrentWarehouse") }))) return;
    await action.send(`/production-material-documents/${doc.id}/confirm`, { version: doc.version, ...(items ? { items } : {}) }, { warehouseId: data.warehouse_id });
    setMessage(pt("production.confirmed2", { v0: doc.number, v1: direction })); await completed();
  });
  const cancel = (doc, reason) => action.run(async () => {
    await action.send(`/production-material-documents/${doc.id}/cancel`, { version: doc.version, reason }, { warehouseId: data.warehouse_id });
    setMessage(doc.issues?.length ? pt("production.remainingRequestClosed", { number: doc.number }) : pt("production.cancelledStockUnchanged", { v0: doc.number })); await completed();
  });
  const title = type === 'out' ? pt("production.productionMaterialIssueOrders") : pt("production.productionMaterialReturnReceipts");
  return <section className="panel material-queue" aria-label={title}>
    <div className="material-document-heading"><h2>{title}</h2><Button disabled={action.busy || list.loading} onClick={() => { action.setError(''); list.retry(); onRefresh?.(); }}>{pt("production.refreshProductionDocuments")}</Button></div>
    <p className="material-muted">{type === 'out' ? pt("production.verifyIssueOrSupplementRequestsStockIsDeducted") : pt("production.verifyUnusedMaterialsStockIsRestoredAfterApproval")}{pt("production.productionMaterialTransfersDoNotCountAsPurchases")}</p>
    <div className="material-filters"><Input type="search" aria-label={pt("production.searchProductionMaterialDocuments")} placeholder={pt("production.searchDocumentNumberProductionOrderOrProduct")} maxLength={100} value={q} disabled={action.busy} onChange={event => { setQ(event.target.value); setOffset(0); }} />
      <Select aria-label={pt("production.productionMaterialDocumentStatus")} value={status} disabled={action.busy} onChange={value => { setStatus(value); setOffset(0); }}><option value="all">{pt("production.allStatuses")}</option>{Object.entries(statusLabels(type)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></div>
    {message && <p className="material-success" role="status">{productionMessage(message)}</p>}
    {productionMessage(action.error) && !selected && <p className="form-error" role="alert">{productionMessage(action.error)} {pt("production.refreshToCheckTheCurrentStatus")}</p>}
    <QueryStatus query={list} />
    <ProductionApprovalList documents={documents} busy={action.busy || list.loading} onView={id => { action.setError(''); setSelection({ id, scope, document: documents.find(doc => doc.id === id) }); }} statusLabels={statusLabels(type)} />
    {list.result && !list.result.documents.length && <p className="material-muted">{pt("production.noMatchingProductionMaterialDocuments")}</p>}
    {list.result && (offset > 0 || list.result.has_more) && <div className="material-actions"><Button disabled={action.busy || list.loading || !offset} onClick={() => setOffset(value => Math.max(0, value - 10))}>{pt("production.previousMaterialDocuments")}</Button><span>{pt("production.total")} {list.result.total} {pt("production.ordersPage")} {offset / 10 + 1} {pt("production.page")}</span><Button disabled={action.busy || list.loading || !list.result.has_more} onClick={() => setOffset(value => value + 10)}>{pt("production.nextMaterialDocuments")}</Button></div>}
    {selected && <ProductionApprovalDialog title={titleFor(selected)} subtitle={selected.number} busy={action.busy} onClose={() => setSelection(null)}>
      <div className="form-body">
        {productionMessage(action.error) && <p className="form-error" role="alert">{productionMessage(action.error)} {pt("production.closeDetailsAndRefreshToCheckTheCurrent")}</p>}
        <MaterialDocumentList key={selected.id} documents={[selected]} busy={action.busy} defaultExpanded onConfirm={confirm} onCancel={cancel} />
      </div>
    </ProductionApprovalDialog>}
  </section>;
}
