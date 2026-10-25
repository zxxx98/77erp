import { localizeError } from './i18n/errors.js';
import { ExportLanguageSelect } from './ExportLanguageSelect.jsx';
import { t as translate, getFormatLocale, getLocale } from './i18n/index.js';
import { useLocale } from './i18n/react.jsx';
import { Button as AntButton, Checkbox as AntCheckbox, Input as AntInput } from './ui/controls.jsx';

import { LoadingIndicator, LoadingStatus } from './Loading.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, Search } from 'lucide-react';
import { api } from './api.js';
import { download } from './data-files.js';
import { multiStocktakeCSV } from './multi-stocktake-csv.js';
import './multi-stocktake.css';

const format = quantity => quantity.toLocaleString(getFormatLocale(), { maximumFractionDigits: 4 });
const PAGE_SIZE = 30;

export function MultiStocktake({ warehouses = [], warehouseId, active = true }) {
  useLocale();
  const current = warehouses.find(w => w.id === warehouseId);
  const [exportLanguage, setExportLanguage] = useState('');
  const [step, setStep] = useState(1);
  const [warehouseIds, setWarehouseIds] = useState([warehouseId]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState({ products: [], loading: false, error: '', has_more: false });
  const [selected, setSelected] = useState([]);
  const [snapshot, setSnapshot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const comparison = useRef(null);
  const term = query.trim();
  const orderedWarehouses = [current, ...warehouses.filter(w => w.id !== warehouseId && warehouseIds.includes(w.id))].filter(Boolean);

  useEffect(() => {
    if (!active || step !== 2 || !term) {
      if (!term) setSearch({ products: [], loading: false, error: '', has_more: false });
      return;
    }
    const controller = new AbortController();
    setSearch(previous => ({ ...previous, loading: true, error: '' }));
    const timer = setTimeout(async () => {
      try {
        const result = await api(`/stocktakes/multi/products?q=${encodeURIComponent(term)}&offset=${page * PAGE_SIZE}`, {
          warehouseId, signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setSearch(previous => ({ ...result, loading: false, error: '',
          products: page === 0 ? result.products : [...previous.products, ...result.products.filter(p => !previous.products.some(old => old.id === p.id))] }));
      } catch (e) {
        if (!controller.signal.aborted) setSearch(previous => ({ ...previous, loading: false, error: e.message }));
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [term, page, retry, step, active, warehouseId]);
  useEffect(() => () => comparison.current?.abort(), []);

  const edit = () => { setSnapshot(null); setError(''); setNotice(''); };
  const go = next => { if (busy) return; setStep(next); setError(''); setNotice(''); };
  const start = async () => {
    if (comparison.current || !selected.length) return;
    const controller = new AbortController();
    comparison.current = controller;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api('/stocktakes/multi/compare', { method: 'POST', warehouseId, signal: controller.signal,
        body: { warehouse_ids: orderedWarehouses.map(w => w.id), product_ids: selected.map(p => p.id) } });
      if (!controller.signal.aborted) { setSnapshot(result); setStep(3); }
    } catch (e) { if (!controller.signal.aborted) setError(localizeError(e.message)); }
    finally { comparison.current = null; if (!controller.signal.aborted) setBusy(false); }
  };
  const exportCSV = () => {
    download(multiStocktakeCSV(snapshot, exportLanguage || getLocale()), translate("warehouse.multi.warehouse.inventory.csv", { v0: snapshot.captured_at.slice(0, 19).replaceAll(':', '-'), lng: exportLanguage || getLocale() }), 'text/csv;charset=utf-8');
    setNotice(translate("warehouse.a.csv.has.been.generated.the.content.is.consistent.with.this"));
  };

  return <div className="multi-stocktake">
    <div className="multi-stocktake-heading"><h3>{translate("warehouse.multi.warehouse.stocktake")}</h3><p>{translate("warehouse.current.warehouse.2")}{current?.name || <LoadingStatus size={20}>{translate("warehouse.loading")}</LoadingStatus>}</p></div>
    <nav className="multi-stocktake-steps" aria-label={translate("warehouse.multi.warehouse.inventory.steps")}>
      {[translate("warehouse.select.warehouse"), translate("warehouse.add.material"), translate("warehouse.stocktake.results")].map((label, i) => <React.Fragment key={label}>
        {i > 0 && <span className="multi-stocktake-connector" />}
        <AntButton type="text" htmlType="button" aria-current={step === i + 1 ? 'step' : undefined}
          className={step > i + 1 ? 'done' : ''} disabled={busy || !current || (i === 2 && !snapshot)} onClick={() => go(i + 1)}>
          <span>{i + 1}</span>{label}
        </AntButton>
      </React.Fragment>)}
    </nav>
    {step === 1 && <section className="multi-stocktake-stage" aria-label={translate("warehouse.select.inventory.warehouse")}>
      <h4>{translate("warehouse.select.warehouses.to.participate.in.inventory")}</h4>
      <div className="multi-stocktake-warehouses">
        {[current, ...warehouses.filter(w => w.id !== warehouseId)].filter(Boolean).map(w => <AntCheckbox key={w.id} className={`multi-stocktake-warehouse ${warehouseIds.includes(w.id) ? 'selected' : ''}`} checked={warehouseIds.includes(w.id)} disabled={w.id === warehouseId || (!warehouseIds.includes(w.id) && warehouseIds.length >= 100)} onChange={e => { edit(); setWarehouseIds(ids => e.target.checked ? [...ids, w.id] : ids.filter(id => id !== w.id)); }}>

          <span><strong>{w.name}{w.id === warehouseId && <span className="multi-stocktake-tag">{translate("warehouse.current")}</span>}</strong>
            <small>{w.id === warehouseId ? translate("warehouse.as.a.benchmark.for.difference.comparison") : translate("warehouse.participate.in.this.inventory")}</small></span>
        </AntCheckbox>)}
      </div>
      {warehouseIds.length >= 100 && <p className="multi-stocktake-status">{translate("warehouse.a.maximum.of.100.warehouses.can.be.selected.at.a.time")}</p>}
      <div className="multi-stocktake-footer"><span>{translate("warehouse.selected.2")}{" "}{orderedWarehouses.length}{" "}{translate("warehouse.warehouses")}</span>
        <AntButton type="primary" htmlType="button" className="btn btn-primary" disabled={!current} onClick={() => go(2)}>{translate("warehouse.next.step")}<ArrowRight size={16} /></AntButton>
      </div>
    </section>}
    {step === 2 && <section className="multi-stocktake-stage" aria-label={translate("warehouse.add.items.to.be.counted")}>
      <label className="multi-stocktake-search-label" htmlFor="multi-stocktake-search">{translate("warehouse.search.for.materials")}{current?.name}）</label>
      <div className="multi-stocktake-search"><Search size={18} aria-hidden="true" />
        <AntInput id="multi-stocktake-search" type="search" value={query} maxLength={100} disabled={busy}
          placeholder={translate("warehouse.enter.the.item.number.or.item.name")} autoComplete="off" onChange={e => {
            const value = e.target.value;
            setQuery(value);
            if (value.trim() !== term) {
              setPage(0); setSearch({ products: [], loading: !!value.trim(), error: '', has_more: false });
            }
          }} />
      </div>
      {term && <div className="multi-stocktake-results" aria-label={translate("warehouse.material.search.results")}>
        {search.products.map(p => <div className="multi-stocktake-product-row" key={p.id}>
          <ProductName product={p} />
          <AntButton type="default" htmlType="button" className="btn btn-secondary" disabled={busy || selected.some(item => item.id === p.id) || selected.length >= 1000}
            onClick={() => { edit(); setSelected(items => items.some(item => item.id === p.id) ? items : [...items, p]); }}>{selected.some(item => item.id === p.id) ? translate("warehouse.added.2") : translate("warehouse.add")}</AntButton>
        </div>)}
        {search.loading && <p className="multi-stocktake-status" role="status"><LoadingIndicator size={20} />{translate("warehouse.searching")}</p>}
        {!search.loading && !search.error && !search.products.length && <p className="multi-stocktake-empty">{translate("warehouse.no.matching.material.found.2")}</p>}
        {search.error && <div className="multi-stocktake-search-error"><p className="form-error" role="alert">{search.error}</p><AntButton type="default" htmlType="button" className="btn btn-secondary" onClick={() => setRetry(n => n + 1)}>{translate("warehouse.retry.search")}</AntButton></div>}
        {!search.loading && !search.error && search.has_more && <AntButton type="default" htmlType="button" className="btn btn-secondary" onClick={() => setPage(n => n + 1)}>{translate("warehouse.load.more.matching.materials")}</AntButton>}
      </div>}
      <div className="multi-stocktake-section-bar"><h4>{translate("warehouse.materials.to.be.counted")}</h4><span aria-live="polite">{translate("warehouse.added.2")}{" "}{selected.length}{" "}{translate("warehouse.types")}</span></div>
      <div className="multi-stocktake-selected" aria-label={translate("warehouse.list.of.materials.to.be.counted")}>
        {selected.map(p => <div className="multi-stocktake-product-row" key={p.id}><ProductName product={p} />
          <AntButton type="default" htmlType="button" className="btn btn-secondary" disabled={busy} aria-label={translate("warehouse.remove.3", { v0: p.name })} onClick={() => { edit(); setSelected(items => items.filter(item => item.id !== p.id)); }}>{translate("warehouse.remove.2")}</AntButton>
        </div>)}
        {!selected.length && <p className="multi-stocktake-empty">{translate("warehouse.after.searching.for.materials.click.add.to.add.them.to.the")}</p>}
      </div>
      {selected.length >= 1000 && <p className="multi-stocktake-status">{translate("warehouse.a.maximum.of.1000.materials.can.be.selected.at.a.time")}</p>}
      <div className="multi-stocktake-footer"><AntButton type="default" htmlType="button" className="btn btn-secondary" disabled={busy} onClick={() => go(1)}>{translate("warehouse.previous.step")}</AntButton>
        <AntButton type="primary" htmlType="button" className="btn btn-primary" disabled={busy || !selected.length} onClick={start}>
          {busy ? <><LoadingIndicator size={20} />{translate("warehouse.reading.inventory")}</> : <>{translate("warehouse.start.taking.inventory")}<ArrowRight size={16} /></>}
        </AntButton>
      </div>
    </section>}
    {step === 3 && snapshot && <section className="multi-stocktake-stage" aria-label={translate("warehouse.quantity.comparison.table.for.each.warehouse")}>
      <div className="multi-stocktake-section-bar"><div><h4>{translate("warehouse.stocktake.results")}</h4><span>{snapshot.rows.length}{" "}{translate("warehouse.material.2")}{" "}{snapshot.warehouses.length}{" "}{translate("warehouse.warehouses")}</span></div>
        <ExportLanguageSelect value={exportLanguage} onChange={setExportLanguage} /><AntButton type="primary" htmlType="button" className="btn btn-primary" onClick={exportCSV}><Download size={16} />{translate("warehouse.export.csv")}</AntButton>
      </div>
      <div className="multi-stocktake-table-scroll" tabIndex={0} role="region" aria-label={translate("warehouse.horizontally.scrollable.warehouse.inventory.form")}>
        <table className="multi-stocktake-table" style={{ minWidth: 180 + snapshot.warehouses.length * 135 }}>
          <thead><tr><th scope="col">{translate("warehouse.name.number")}</th>{snapshot.warehouses.map((w, i) => <th scope="col" key={w.id} className={i === 0 ? 'multi-stocktake-base' : ''}>{w.name}{i === 0 && <span className="multi-stocktake-tag">{translate("warehouse.current.warehouse.3")}</span>}</th>)}</tr></thead>
          <tbody>{snapshot.rows.map(row => <tr key={row.product_id}><th scope="row"><ProductName product={row} /></th>{row.cells.map((cell, i) => <td key={cell.warehouse_id} className={i === 0 ? 'multi-stocktake-base' : ''}>
            {cell.status === 'missing' ? <span className="multi-stocktake-difference">{translate("warehouse.material.notRegistered")}</span> : <>
              <span className="multi-stocktake-quantity">{format(cell.quantity)}</span>
              {cell.status === 'unit_mismatch' ? <span className="multi-stocktake-difference">{cell.unit}{" "}{translate("warehouse.different.units")}</span> : i > 0 && <span className={`multi-stocktake-difference ${cell.difference > 0 ? 'positive' : cell.difference < 0 ? 'negative' : ''}`}>{translate("warehouse.difference.2")}{" "}{cell.difference > 0 ? '+' : ''}{format(cell.difference)}</span>}
            </>}
          </td>)}</tr>)}</tbody>
        </table>
      </div>
      <p className="multi-stocktake-note">{translate("warehouse.relative.difference")}{snapshot.warehouses[0].name}{translate("warehouse.the.difference.will.not.be.calculated.if.the.file.has.not")}</p>
      <div className="multi-stocktake-footer"><AntButton type="default" htmlType="button" className="btn btn-secondary" onClick={() => go(2)}><ArrowLeft size={16} />{translate("warehouse.return.to.add.materials")}</AntButton>
        <span>{translate("warehouse.inventory.read.time")}{new Date(snapshot.captured_at).toLocaleString(getFormatLocale())}</span></div>
    </section>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="multi-stocktake-notice" role="status">{notice}</p>}
  </div>;
}

function ProductName({ product }) {
  useLocale();
  return <div className="multi-stocktake-product-name"><strong>{product.name}</strong>
    <small>{product.barcode} · {product.unit}{product.specification ? ` · ${product.specification}` : ''}{product.active === 0 ? translate("warehouse.deactivated.3") : ''}</small>
  </div>;
}
