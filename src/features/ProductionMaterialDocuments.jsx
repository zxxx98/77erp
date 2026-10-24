import { useState } from 'react';
import { Input } from '../ui/controls.jsx';
import { Button, Badge, QueryStatus } from '../components/common.jsx';
import { Select } from '../Dropdown.jsx';
import { usePermissions } from '../permissions.jsx';
import { useBusiness } from '../business-api.js';
import { queryPath, useQuery } from '../queries.js';
import { count, dateTime, money, currencySymbol } from '../app/format.js';
import './production-materials.css';

const statusLabels = { pending: '待批准', confirmed: '已完成', cancelled: '已取消' };
const titleFor = doc => doc.type === 'in' ? '生产退料' : doc.kind === 'supplement' ? '生产补料' : '生产领料';

export function MaterialDocumentList({ documents, busy, onConfirm, onCancel }) {
  const { can } = usePermissions();
  const [expanded, setExpanded] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [reason, setReason] = useState('');
  return <div className="material-documents">{documents.map(doc => <article className="material-document" key={doc.id}>
    <div className="material-document-heading"><div><strong>{doc.number}</strong><p>{titleFor(doc)} · {doc.production_number}</p></div>
      <Badge tone={doc.status === 'pending' ? 'orange' : doc.status === 'confirmed' ? 'green' : 'gray'}>{statusLabels[doc.status]}</Badge></div>
    <p>{doc.product_name}</p>
    <p className="material-muted">申请：{doc.created_by_name} · {dateTime(doc.created_at)}</p>
    {doc.confirmed_at && <p className="material-muted">确认：{doc.confirmed_by_name} · {dateTime(doc.confirmed_at)}</p>}
    {doc.cancelled_at && <p className="material-muted">取消：{doc.cancelled_by_name} · {dateTime(doc.cancelled_at)}{doc.cancel_reason && ` · ${doc.cancel_reason}`}</p>}
    {doc.note && <p className="material-note">{doc.note}</p>}
    <div className="material-actions">
      <Button disabled={busy} aria-expanded={expanded === doc.id} onClick={() => setExpanded(expanded === doc.id ? null : doc.id)}>{expanded === doc.id ? '收起材料明细' : '查看材料明细'}</Button>
      {doc.status === 'pending' && onConfirm && <Button kind="primary" disabled={busy} onClick={() => onConfirm(doc)}>批准并确认{doc.type === 'out' ? '出库' : '入库'}</Button>}
      {doc.status === 'pending' && onCancel && <Button disabled={busy} onClick={() => { setCancelling(doc.id); setReason(''); }}>取消申请</Button>}
    </div>
    {expanded === doc.id && <ul className="material-document-lines">{doc.items.map(item => <li key={item.product_id}>
      <div><strong>{item.name}</strong><small>{item.barcode}{item.specification && ` · ${item.specification}`}</small></div>
      <span>{count(item.quantity)} {item.unit}</span>
      {can('finance') && item.cost_cents != null && <small>材料成本 {currencySymbol()}{money(item.cost_cents / 100)}</small>}
    </li>)}</ul>}
    {cancelling === doc.id && doc.status === 'pending' && <div className="material-cancel">
      <label>取消原因<Input.TextArea aria-label="取消申请原因" rows={2} maxLength={500} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
      <div className="material-actions"><Button disabled={busy} onClick={() => setCancelling(null)}>保留申请</Button><Button kind="danger" disabled={busy || !reason.trim()} onClick={() => onCancel(doc, reason.trim())}>确认取消申请</Button></div>
    </div>}
  </article>)}</div>;
}

export function ProductionMaterialDocuments({ data, type, onChanged }) {
  const { can } = usePermissions();
  const [status, setStatus] = useState('pending'), [q, setQ] = useState(''), [offset, setOffset] = useState(0);
  const [message, setMessage] = useState('');
  const action = useBusiness();
  const allowed = can(type === 'out' ? 'sale' : 'purchase');
  const list = useQuery(allowed ? queryPath('/production-material-documents', { type, status, q, offset, limit: 20 }) : null, data, q ? 200 : 0);
  if (!allowed) return null;
  const confirm = doc => action.run(async () => {
    const direction = doc.type === 'out' ? '出库' : '入库';
    if (!window.confirm(`确认批准 ${doc.number} 并整单${direction}？${doc.type === 'out' ? '材料将从当前仓库扣除，交付生产使用。' : '未用材料将退回当前仓库。'}`)) return;
    await action.send(`/production-material-documents/${doc.id}/confirm`, { version: doc.version }, { warehouseId: data.warehouse_id });
    setMessage(`${doc.number} 已${direction}。`); list.retry(); await onChanged?.();
  });
  const cancel = (doc, reason) => action.run(async () => {
    await action.send(`/production-material-documents/${doc.id}/cancel`, { version: doc.version, reason }, { warehouseId: data.warehouse_id });
    setMessage(`${doc.number} 已取消，库存未变动。`); list.retry(); await onChanged?.();
  });
  const title = type === 'out' ? '生产领料出库单' : '生产退料入库单';
  return <section className="panel material-queue" aria-label={title}>
    <div className="material-document-heading"><h2>{title}</h2><Button disabled={action.busy || list.loading} onClick={() => { action.setError(''); list.retry(); }}>刷新生产单据</Button></div>
    <p className="material-muted">{type === 'out' ? '核对领料或补料申请，批准并确认出库后扣除库存。' : '核对未用材料，批准并确认入库后退回库存。'}生产材料流转不计入采购销售额。</p>
    <div className="material-filters"><Input type="search" aria-label="搜索生产材料单" placeholder="搜索单号、生产单或成品" maxLength={100} value={q} disabled={action.busy} onChange={event => { setQ(event.target.value); setOffset(0); }} />
      <Select aria-label="生产材料单状态" value={status} disabled={action.busy} onChange={value => { setStatus(value); setOffset(0); }}><option value="all">全部状态</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></div>
    {message && <p className="material-success" role="status">{message}</p>}
    {action.error && <p className="form-error" role="alert">{action.error} 可刷新后核对当前状态。</p>}
    <QueryStatus query={list} />
    <MaterialDocumentList documents={list.result?.documents || []} busy={action.busy} onConfirm={confirm} onCancel={cancel} />
    {list.result && !list.result.documents.length && <p className="material-muted">暂无符合条件的生产材料单。</p>}
    {list.result && (offset > 0 || list.result.has_more) && <div className="material-actions"><Button disabled={action.busy || !offset} onClick={() => setOffset(value => value - 20)}>上一页生产材料单</Button><span>共 {list.result.total} 张</span><Button disabled={action.busy || !list.result.has_more} onClick={() => setOffset(value => value + 20)}>下一页生产材料单</Button></div>}
  </section>;
}
