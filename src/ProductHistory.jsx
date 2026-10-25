import { localizeError } from './i18n/errors.js';
import { t as translate, getFormatLocale } from './i18n/index.js';
import { useLocale } from './i18n/react.jsx';
import { Button as AntButton } from './ui/controls.jsx';

import { LoadingStatus } from './Loading.jsx';
import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { orderLabel } from './order-utils.js';
import './product-history.css';
import { price, currencySymbol } from './app/format.js';

const count = value => Number(value).toLocaleString(getFormatLocale(), { maximumFractionDigits: 4 });
const label = record => ({ production_material_out: translate("warehouse.production.picking.and.delivery"), production_material_in: translate("warehouse.production.returns.and.warehousing"), production_scrap_in: translate("warehouse.storage.of.production.waste"), production_scrap_void_out: translate("warehouse.scrap.production.and.deduction.of.scrap"), production_in: translate("warehouse.warehousing.upon.completion.of.production"), production_out: translate("warehouse.actual.production.consumption"), production_void_out: translate("warehouse.scrap.production.and.deduct.finished.products"), production_void_in: translate("warehouse.scrap.production.and.return.materials") }[record.event]) || (record.event === 'price_change' ? translate("warehouse.material.price.change") : record.event === 'void' ? translate("warehouse.void", { v0: orderLabel({ ...record, status: 'active' }) })
  : record.event === 'order' ? orderLabel(record) : record.event === 'reduce' ? translate("warehouse.reduce.stock.loss") : record.event === 'increase' ? translate("warehouse.increase.stock.return") : translate("warehouse.stocktake"));

export function ProductHistory({ product, onViewOrder }) {
  useLocale();
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
      .catch(e => { if (alive) setError(localizeError(e.message)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [product.id, opened, offset, attempt]);
  return <section className="product-history" aria-label={translate("warehouse.current.material.operation.records")}>
    <AntButton type="default" htmlType="button" className="btn btn-secondary" aria-expanded={opened} onClick={() => {
      if (!opened) { setOffset(0); setRecords([]); setHasMore(false); setLoading(true); }
      setOpened(value => !value);
    }}>{opened ? translate("warehouse.close.operation.record") : translate("warehouse.view.operation.records")}</AntButton>
    {opened && <div className="product-history-body">
      <h4>{translate("warehouse.current.material.operation.records")}</h4>
      <p className="muted">{translate("warehouse.the.current.warehouse.s.entry.and.exit.returns.and.invalidation.records")}</p>
      <ol className="product-history-list">{records.map(record => <li key={`${record.event}:${record.event_id}`}>
        <div className="product-history-title"><strong>{label(record)}</strong>{record.event !== 'price_change' && <span>{record.delta === null ? translate("warehouse.already.carried.forward.at.the.beginning.of.the.period") : `${record.delta > 0 ? '+' : ''}${count(record.delta)} ${record.unit || product.unit}`}</span>}</div>
        <time dateTime={record.created_at}>{new Date(record.created_at).toLocaleString(getFormatLocale(), { hour12: false })}</time>
        {record.order_id && <div><AntButton type="text" htmlType="button" className="text-button" onClick={() => onViewOrder(record.order_id)}>{record.number}</AntButton>{record.partner && <span> · {record.partner}</span>}</div>}
        {record.kind === 'production' && <p>{record.number}</p>}
        {record.before_stock !== null && <p>{translate("warehouse.inventory.3")}{count(record.before_stock)} → {count(record.after_stock)} {product.unit}</p>}
        {record.event === 'price_change' && <>
          {record.before_cost !== record.after_cost && <p>{translate("warehouse.cost.price")}{currencySymbol()} {price(record.before_cost)} → {currencySymbol()} {price(record.after_cost)}</p>}
          {record.before_price !== record.after_price && <p>{translate("warehouse.price")}{currencySymbol()} {price(record.before_price)} → {currencySymbol()} {price(record.after_price)}</p>}
        </>}
        {record.operator && <p>{translate("warehouse.operator")}{record.operator}</p>}
        {record.note && <p>{record.note}</p>}
      </li>)}</ol>
      {loading && <p><LoadingStatus>{translate("warehouse.reading.operation.records")}</LoadingStatus></p>}
      {error && <div role="alert"><p className="form-error">{error}</p><AntButton type="default" htmlType="button" className="btn" onClick={() => setAttempt(value => value + 1)}>{translate("warehouse.reread.records")}</AntButton></div>}
      {!loading && !error && !records.length && <p>{translate("warehouse.there.is.no.operation.record.for.the.current.material")}</p>}
      {hasMore && !error && <AntButton type="default" htmlType="button" className="btn" disabled={loading} onClick={() => setOffset(records.length)}>{translate("warehouse.load.more.records")}</AntButton>}
    </div>}
  </section>;
}
