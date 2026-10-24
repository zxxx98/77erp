import { Button as AntButton, Checkbox as AntCheckbox, Input as AntInput } from './ui/controls.jsx';

import { LoadingIndicator, LoadingStatus } from './Loading.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, Search } from 'lucide-react';
import { api } from './api.js';
import { download } from './data-files.js';
import { multiStocktakeCSV } from './multi-stocktake-csv.js';
import './multi-stocktake.css';

const format = quantity => quantity.toLocaleString('zh-CN', { maximumFractionDigits: 4 });
const PAGE_SIZE = 30;

export function MultiStocktake({ warehouses = [], warehouseId, active = true }) {
  const current = warehouses.find(w => w.id === warehouseId);
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
    } catch (e) { if (!controller.signal.aborted) setError(e.message); }
    finally { comparison.current = null; if (!controller.signal.aborted) setBusy(false); }
  };
  const exportCSV = () => {
    download(multiStocktakeCSV(snapshot), `多仓库盘点-${snapshot.captured_at.slice(0, 19).replaceAll(':', '-')}.csv`, 'text/csv;charset=utf-8');
    setNotice('已生成 CSV，内容与本次盘点表格一致。');
  };

  return <div className="multi-stocktake">
    <div className="multi-stocktake-heading"><h3>多仓库盘点</h3><p>当前仓库：{current?.name || <LoadingStatus size={20}>加载中</LoadingStatus>}</p></div>
    <nav className="multi-stocktake-steps" aria-label="多仓库盘点步骤">
      {['选择仓库', '添加物料', '盘点结果'].map((label, i) => <React.Fragment key={label}>
        {i > 0 && <span className="multi-stocktake-connector" />}
        <AntButton type="text" htmlType="button" aria-current={step === i + 1 ? 'step' : undefined}
          className={step > i + 1 ? 'done' : ''} disabled={busy || !current || (i === 2 && !snapshot)} onClick={() => go(i + 1)}>
          <span>{i + 1}</span>{label}
        </AntButton>
      </React.Fragment>)}
    </nav>
    {step === 1 && <section className="multi-stocktake-stage" aria-label="选择盘点仓库">
      <h4>选择参与盘点的仓库</h4>
      <div className="multi-stocktake-warehouses">
        {[current, ...warehouses.filter(w => w.id !== warehouseId)].filter(Boolean).map(w => <AntCheckbox key={w.id} className={`multi-stocktake-warehouse ${warehouseIds.includes(w.id) ? 'selected' : ''}`} checked={warehouseIds.includes(w.id)} disabled={w.id === warehouseId || (!warehouseIds.includes(w.id) && warehouseIds.length >= 100)} onChange={e => { edit(); setWarehouseIds(ids => e.target.checked ? [...ids, w.id] : ids.filter(id => id !== w.id)); }}>

          <span><strong>{w.name}{w.id === warehouseId && <span className="multi-stocktake-tag">当前</span>}</strong>
            <small>{w.id === warehouseId ? '作为差值对照基准' : '参与本次盘点'}</small></span>
        </AntCheckbox>)}
      </div>
      {warehouseIds.length >= 100 && <p className="multi-stocktake-status">每次最多选择 100 个仓库。</p>}
      <div className="multi-stocktake-footer"><span>已选择 {orderedWarehouses.length} 个仓库</span>
        <AntButton type="primary" htmlType="button" className="btn btn-primary" disabled={!current} onClick={() => go(2)}>下一步<ArrowRight size={16} /></AntButton>
      </div>
    </section>}
    {step === 2 && <section className="multi-stocktake-stage" aria-label="添加待盘点物料">
      <label className="multi-stocktake-search-label" htmlFor="multi-stocktake-search">搜索物料（{current?.name}）</label>
      <div className="multi-stocktake-search"><Search size={18} aria-hidden="true" />
        <AntInput id="multi-stocktake-search" type="search" value={query} maxLength={100} disabled={busy}
          placeholder="输入料号或物料名称" autoComplete="off" onChange={e => {
            const value = e.target.value;
            setQuery(value);
            if (value.trim() !== term) {
              setPage(0); setSearch({ products: [], loading: !!value.trim(), error: '', has_more: false });
            }
          }} />
      </div>
      {term && <div className="multi-stocktake-results" aria-label="物料搜索结果">
        {search.products.map(p => <div className="multi-stocktake-product-row" key={p.id}>
          <ProductName product={p} />
          <AntButton type="default" htmlType="button" className="btn btn-secondary" disabled={busy || selected.some(item => item.id === p.id) || selected.length >= 1000}
            onClick={() => { edit(); setSelected(items => items.some(item => item.id === p.id) ? items : [...items, p]); }}>{selected.some(item => item.id === p.id) ? '已添加' : '添加'}</AntButton>
        </div>)}
        {search.loading && <p className="multi-stocktake-status" role="status"><LoadingIndicator size={20} />正在搜索…</p>}
        {!search.loading && !search.error && !search.products.length && <p className="multi-stocktake-empty">没有找到匹配的物料</p>}
        {search.error && <div className="multi-stocktake-search-error"><p className="form-error" role="alert">{search.error}</p><AntButton type="default" htmlType="button" className="btn btn-secondary" onClick={() => setRetry(n => n + 1)}>重试搜索</AntButton></div>}
        {!search.loading && !search.error && search.has_more && <AntButton type="default" htmlType="button" className="btn btn-secondary" onClick={() => setPage(n => n + 1)}>加载更多匹配物料</AntButton>}
      </div>}
      <div className="multi-stocktake-section-bar"><h4>待盘点物料</h4><span aria-live="polite">已添加 {selected.length} 种</span></div>
      <div className="multi-stocktake-selected" aria-label="待盘点物料列表">
        {selected.map(p => <div className="multi-stocktake-product-row" key={p.id}><ProductName product={p} />
          <AntButton type="default" htmlType="button" className="btn btn-secondary" disabled={busy} aria-label={`移除${p.name}`} onClick={() => { edit(); setSelected(items => items.filter(item => item.id !== p.id)); }}>移除</AntButton>
        </div>)}
        {!selected.length && <p className="multi-stocktake-empty">搜索物料后，点击「添加」加入待盘点列表</p>}
      </div>
      {selected.length >= 1000 && <p className="multi-stocktake-status">每次最多选择 1000 种物料。</p>}
      <div className="multi-stocktake-footer"><AntButton type="default" htmlType="button" className="btn btn-secondary" disabled={busy} onClick={() => go(1)}>上一步</AntButton>
        <AntButton type="primary" htmlType="button" className="btn btn-primary" disabled={busy || !selected.length} onClick={start}>
          {busy ? <><LoadingIndicator size={20} />正在读取库存…</> : <>开始盘点<ArrowRight size={16} /></>}
        </AntButton>
      </div>
    </section>}
    {step === 3 && snapshot && <section className="multi-stocktake-stage" aria-label="各仓库数量对照表">
      <div className="multi-stocktake-section-bar"><div><h4>盘点结果</h4><span>{snapshot.rows.length} 种物料 · {snapshot.warehouses.length} 个仓库</span></div>
        <AntButton type="primary" htmlType="button" className="btn btn-primary" onClick={exportCSV}><Download size={16} />导出 CSV</AntButton>
      </div>
      <div className="multi-stocktake-table-scroll" tabIndex={0} role="region" aria-label="可横向滚动的仓库盘点表格">
        <table className="multi-stocktake-table" style={{ minWidth: 180 + snapshot.warehouses.length * 135 }}>
          <thead><tr><th scope="col">名称 / 编号</th>{snapshot.warehouses.map((w, i) => <th scope="col" key={w.id} className={i === 0 ? 'multi-stocktake-base' : ''}>{w.name}{i === 0 && <span className="multi-stocktake-tag">当前仓库</span>}</th>)}</tr></thead>
          <tbody>{snapshot.rows.map(row => <tr key={row.product_id}><th scope="row"><ProductName product={row} /></th>{row.cells.map((cell, i) => <td key={cell.warehouse_id} className={i === 0 ? 'multi-stocktake-base' : ''}>
            {cell.status === 'missing' ? <span className="multi-stocktake-difference">未建档</span> : <>
              <span className="multi-stocktake-quantity">{format(cell.quantity)}</span>
              {cell.status === 'unit_mismatch' ? <span className="multi-stocktake-difference">{cell.unit} · 单位不同</span> : i > 0 && <span className={`multi-stocktake-difference ${cell.difference > 0 ? 'positive' : cell.difference < 0 ? 'negative' : ''}`}>差值 {cell.difference > 0 ? '+' : ''}{format(cell.difference)}</span>}
            </>}
          </td>)}</tr>)}</tbody>
        </table>
      </div>
      <p className="multi-stocktake-note">差值相对{snapshot.warehouses[0].name}；未建档或单位不同时不计算差值。</p>
      <div className="multi-stocktake-footer"><AntButton type="default" htmlType="button" className="btn btn-secondary" onClick={() => go(2)}><ArrowLeft size={16} />返回添加物料</AntButton>
        <span>库存读取时间：{new Date(snapshot.captured_at).toLocaleString('zh-CN')}</span></div>
    </section>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="multi-stocktake-notice" role="status">{notice}</p>}
  </div>;
}

function ProductName({ product }) {
  return <div className="multi-stocktake-product-name"><strong>{product.name}</strong>
    <small>{product.barcode} · {product.unit}{product.specification ? ` · ${product.specification}` : ''}{product.active === 0 ? ' · 已停用' : ''}</small>
  </div>;
}
