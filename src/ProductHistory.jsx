import { Button as AntButton } from './ui/controls.jsx';

import { LoadingStatus } from './Loading.jsx';
import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { orderLabel } from './order-utils.js';
import './product-history.css';
import { price, currencySymbol } from './app/format.js';

const count = value => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 4 });
const label = record => ({ production_scrap_in: '生产废料入库', production_scrap_void_out: '作废生产扣回废料', production_in: '生产完工入库', production_out: '生产实际耗料', production_void_out: '作废生产扣回成品', production_void_in: '作废生产退回材料' }[record.event]) || (record.event === 'price_change' ? '物料改价' : record.event === 'void' ? `作废${orderLabel({ ...record, status: 'active' })}`
  : record.event === 'order' ? orderLabel(record) : record.event === 'reduce' ? '减少库存（报损）' : record.event === 'increase' ? '增加库存（退料）' : '库存盘点');

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
    <AntButton type="default" htmlType="button" className="btn btn-secondary" aria-expanded={opened} onClick={() => {
      if (!opened) { setOffset(0); setRecords([]); setHasMore(false); setLoading(true); }
      setOpened(value => !value);
    }}>{opened ? '收起操作记录' : '查看操作记录'}</AntButton>
    {opened && <div className="product-history-body">
      <h4>当前物料操作记录</h4>
      <p className="muted">当前仓库的出入库、退货、作废记录，以及有权限查看的生产、盘点／报损／退料、改价记录，按时间倒序显示。</p>
      <ol className="product-history-list">{records.map(record => <li key={`${record.event}:${record.event_id}`}>
        <div className="product-history-title"><strong>{label(record)}</strong>{record.event !== 'price_change' && <span>{record.delta === null ? '期初已结转' : `${record.delta > 0 ? '+' : ''}${count(record.delta)} ${record.unit || product.unit}`}</span>}</div>
        <time dateTime={record.created_at}>{new Date(record.created_at).toLocaleString('zh-CN', { hour12: false })}</time>
        {record.order_id && <div><AntButton type="text" htmlType="button" className="text-button" onClick={() => onViewOrder(record.order_id)}>{record.number}</AntButton>{record.partner && <span> · {record.partner}</span>}</div>}
        {record.kind === 'production' && <p>{record.number}</p>}
        {record.before_stock !== null && <p>库存：{count(record.before_stock)} → {count(record.after_stock)} {product.unit}</p>}
        {record.event === 'price_change' && <>
          {record.before_cost !== record.after_cost && <p>成本价：{currencySymbol()} {price(record.before_cost)} → {currencySymbol()} {price(record.after_cost)}</p>}
          {record.before_price !== record.after_price && <p>售价：{currencySymbol()} {price(record.before_price)} → {currencySymbol()} {price(record.after_price)}</p>}
        </>}
        {record.operator && <p>操作人：{record.operator}</p>}
        {record.note && <p>{record.note}</p>}
      </li>)}</ol>
      {loading && <p><LoadingStatus>正在读取操作记录…</LoadingStatus></p>}
      {error && <div role="alert"><p className="form-error">{error}</p><AntButton type="default" htmlType="button" className="btn" onClick={() => setAttempt(value => value + 1)}>重新读取记录</AntButton></div>}
      {!loading && !error && !records.length && <p>当前物料暂无操作记录。</p>}
      {hasMore && !error && <AntButton type="default" htmlType="button" className="btn" disabled={loading} onClick={() => setOffset(records.length)}>加载更多记录</AntButton>}
    </div>}
  </section>;
}
