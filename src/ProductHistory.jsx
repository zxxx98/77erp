import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { orderLabel } from './Operations.jsx';
import './product-history.css';

const count = value => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 6 });
const label = record => record.event === 'void' ? `作废${orderLabel({ ...record, status: 'active' })}`
  : record.event === 'order' ? orderLabel(record) : record.event === 'reduce' ? '减少库存（报损）' : '库存盘点';

export function ProductHistory({ product, onViewOrder }) {
  const [opened, setOpened] = useState(false);
  const [records, setRecords] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!opened) return;
    let alive = true;
    setLoading(true); setError('');
    api(`/products/${product.id}/history?offset=${offset}`)
      .then(result => {
        if (!alive) return;
        setRecords(previous => offset === 0 ? result.records : [...previous, ...result.records]);
        setHasMore(result.has_more);
      })
      .catch(e => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [product.id, opened, offset, attempt]);
  return <section className="product-history" aria-label="当前物料操作记录">
    <button type="button" className="btn btn-secondary" aria-expanded={opened} onClick={() => {
      if (!opened) { setOffset(0); setRecords([]); setHasMore(false); setLoading(true); }
      setOpened(value => !value);
    }}>{opened ? '收起操作记录' : '查看操作记录'}</button>
    {opened && <div className="product-history-body">
      <h4>当前物料操作记录</h4>
      <p className="muted">当前仓库的出入库、退货、作废记录，以及有权限查看的盘点／报损记录，按时间倒序显示。</p>
      <ol className="product-history-list">{records.map(record => <li key={`${record.event}:${record.event_id}`}>
        <div className="product-history-title"><strong>{label(record)}</strong><span>{record.delta === null ? '期初已结转' : `${record.delta > 0 ? '+' : ''}${count(record.delta)} ${product.unit}`}</span></div>
        <time dateTime={record.created_at}>{new Date(record.created_at).toLocaleString('zh-CN', { hour12: false })}</time>
        {record.order_id && <div><button type="button" className="text-button" onClick={() => onViewOrder(record.order_id)}>{record.number}</button>{record.partner && <span> · {record.partner}</span>}</div>}
        {record.before_stock !== null && <p>库存：{count(record.before_stock)} → {count(record.after_stock)} {product.unit}</p>}
        {record.operator && <p>操作人：{record.operator}</p>}
        {record.note && <p>{record.note}</p>}
      </li>)}</ol>
      {loading && <p role="status">正在读取操作记录…</p>}
      {error && <div role="alert"><p className="form-error">{error}</p><button type="button" className="btn" onClick={() => setAttempt(value => value + 1)}>重新读取记录</button></div>}
      {!loading && !error && !records.length && <p>当前物料暂无操作记录。</p>}
      {hasMore && !error && <button type="button" className="btn" disabled={loading} onClick={() => setOffset(records.length)}>加载更多记录</button>}
    </div>}
  </section>;
}
