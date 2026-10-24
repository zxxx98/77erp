import { useState } from 'react';
import { Input } from '../ui/controls.jsx';
import { Button, Badge, QueryStatus } from '../components/common.jsx';
import { Select } from '../Dropdown.jsx';
import { usePermissions } from '../permissions.jsx';
import { useBusiness } from '../business-api.js';
import { queryPath, useQuery } from '../queries.js';
import { count, dateTime, money, currencySymbol } from '../app/format.js';
import './production-materials.css';

const statusLabels = { pending: '待入库', confirmed: '已入库', void: '已作废' };

export function ProductionReceiptList({ documents, busy, onConfirm }) {
  const { can } = usePermissions();
  const [expanded, setExpanded] = useState(null);
  return <div className="material-documents">{documents.map(doc => <article className="material-document" id={`production-receipt-${doc.id}`} tabIndex={-1} key={doc.id}>
    <div className="material-document-heading"><div><strong>{doc.number}</strong><p>{doc.production_number} · 第 {doc.batch_number} 批</p></div>
      <Badge tone={doc.status === 'pending' ? 'orange' : doc.status === 'confirmed' ? 'green' : 'gray'}>{statusLabels[doc.status]}</Badge></div>
    <p>{doc.product_name} · {count(doc.quantity)} {doc.unit}</p>
    <p className="material-muted">登记：{doc.created_by_name} · {dateTime(doc.created_at)}</p>
    {doc.confirmed_at && <p className="material-muted">入库：{doc.confirmed_by_name} · {dateTime(doc.confirmed_at)}</p>}
    {doc.voided_at && <p className="material-muted">作废：{doc.voided_by_name} · {dateTime(doc.voided_at)}{doc.void_reason && ` · ${doc.void_reason}`}</p>}
    {can('finance') && doc.total_cost_cents != null && <p>成品成本 {currencySymbol()}{money(doc.total_cost_cents / 100)}</p>}
    {doc.note && <p className="material-note">{doc.note}</p>}
    <div className="material-actions">
      <Button disabled={busy} aria-expanded={expanded === doc.id} onClick={() => setExpanded(expanded === doc.id ? null : doc.id)}>{expanded === doc.id ? '收起入库明细' : '查看入库明细'}</Button>
      {doc.status === 'pending' && onConfirm && <Button kind="primary" disabled={busy} onClick={() => onConfirm(doc)}>批准并确认入库</Button>}
    </div>
    {expanded === doc.id && <ul className="material-document-lines">{doc.items.map(item => <li key={`${item.kind}:${item.product_id}`}>
      <div><strong>{item.name}</strong><small>{item.kind === 'scrap' ? '废料' : '合格成品'} · {item.barcode}{item.specification && ` · ${item.specification}`}</small></div>
      <span>{count(item.quantity)} {item.unit}</span>
      {can('finance') && item.cost_cents != null && <small>入库成本 {currencySymbol()}{money(item.cost_cents / 100)}</small>}
    </li>)}</ul>}
  </article>)}</div>;
}

export function ProductionReceipts({ data, onChanged }) {
  const { can } = usePermissions();
  const [status, setStatus] = useState('pending'), [q, setQ] = useState(''), [offset, setOffset] = useState(0);
  const [message, setMessage] = useState('');
  const action = useBusiness();
  const allowed = can('purchase');
  const list = useQuery(allowed ? queryPath('/production-receipts', { status, q, offset, limit: 20 }) : null, data, q ? 200 : 0);
  if (!allowed) return null;
  const confirm = doc => action.run(async () => {
    setMessage('');
    if (!window.confirm(`确认批准 ${doc.number} 并整批入库？${count(doc.quantity)} ${doc.unit}${doc.product_name}及本单所列废料将增加仓库库存。`)) return;
    await action.send(`/production-receipts/${doc.id}/confirm`, { version: doc.version }, { warehouseId: data.warehouse_id });
    setMessage(`${doc.number} 已入库。`);
    if (offset > 0 && list.result?.documents.length === 1 && status === 'pending') setOffset(value => Math.max(0, value - 20));
    list.retry();
    await onChanged?.();
  });
  return <section className="panel material-queue" aria-label="生产成品入库单">
    <div className="material-document-heading"><h2>生产成品入库单</h2><Button disabled={action.busy || list.loading} onClick={() => { action.setError(''); list.retry(); }}>刷新生产入库单</Button></div>
    <p className="material-muted">核对每批合格成品及入库废料，批准后才增加库存。生产登记与结束生产不自动入库；更正请在生产单中作废对应批次。</p>
    <div className="material-filters"><Input type="search" aria-label="搜索生产入库单" placeholder="搜索单号、生产单或成品" maxLength={100} value={q} disabled={action.busy} onChange={event => { setQ(event.target.value); setOffset(0); }} />
      <Select aria-label="生产入库单状态" value={status} disabled={action.busy} onChange={value => { setStatus(value); setOffset(0); }}><option value="all">全部状态</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></div>
    {message && <p className="material-success" role="status">{message}</p>}
    {action.error && <p className="form-error" role="alert">{action.error} 可刷新后核对当前状态。</p>}
    <QueryStatus query={list} />
    <ProductionReceiptList documents={list.result?.documents || []} busy={action.busy} onConfirm={confirm} />
    {list.result && !list.result.documents.length && <p className="material-muted">暂无符合条件的生产入库单。</p>}
    {list.result && (offset > 0 || list.result.has_more) && <div className="material-actions"><Button disabled={action.busy || list.loading || !offset} onClick={() => setOffset(value => Math.max(0, value - 20))}>上一页生产入库单</Button><span>共 {list.result.total} 张</span><Button disabled={action.busy || list.loading || !list.result.has_more} onClick={() => setOffset(value => value + 20)}>下一页生产入库单</Button></div>}
  </section>;
}
