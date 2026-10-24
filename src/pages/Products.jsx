import { Button as AntButton, Checkbox as AntCheckbox, Input as AntInput } from '../ui/controls.jsx';

import { usePermissions } from '../permissions.jsx';
import { useState, useRef, useEffect } from 'react';
import { api } from '../api.js';
import { useQuery, queryPath } from '../queries.js';
import {
  PageHeading,
  Button,
  CategoryTree,
  QueryStatus,
  ProductArt,
  ProductName,
  Badge,
  Modal,
  Empty,
  Pagination,
} from '../components/common.jsx';
import { Plus, Search, X, List, Grid2X2, ScanLine, ChevronRight } from 'lucide-react';
import { LoadingStatus } from '../Loading.jsx';
import { money, price, count, stockStatus, stockTone, currencySymbol } from '../app/format.js';
import { CategoryManager } from '../LazyComponents.jsx';

export function summarizeProductNames(list) {
  const names = list.slice(0, 5).map(p => `「${p.name}」`).join('、');
  return list.length > 5 ? `${names} 等 ${list.length} 项` : `${names}（共 ${list.length} 项）`;
}

export function ProductBatchDialog({ mode, selectedProducts, onClose, onCompleted }) {
  const [submitting, setSubmitting] = useState(false);
  const [previewing, setPreviewing] = useState(mode === 'delete');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (mode !== 'delete') return;
    let alive = true;
    setPreviewing(true);
    setError('');
    setPreview(null);
    setResult(null);
    api('/products/batch/delete/preview', {
      method: 'POST',
      body: { ids: selectedProducts.map(p => p.id) },
    })
      .then(data => {
        if (alive) setPreview({ deletable: data.deletable || [], blocked: data.blocked || [] });
      })
      .catch(e => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setPreviewing(false);
      });
    return () => { alive = false; };
  }, [mode]);

  if (!mode) return null;

  const activeItems = selectedProducts.filter(p => p.active !== 0);
  const inactiveCount = selectedProducts.length - activeItems.length;

  const handleDeactivate = async () => {
    if (submitting || !activeItems.length) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await api('/products/batch/status', {
        method: 'POST',
        body: { ids: selectedProducts.map(p => p.id), active: 0 },
      });
      const skippedCount = res.skipped?.length || 0;
      const message = skippedCount
        ? `已停用 ${res.updated.length} 种物料，跳过 ${skippedCount} 项`
        : `已停用 ${res.updated.length} 种物料`;
      await onCompleted({ clearedIds: selectedProducts.map(p => p.id), message });
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (submitting || !preview?.deletable?.length) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await api('/products/batch/delete', {
        method: 'POST',
        body: { ids: preview.deletable.map(item => item.id) },
      });
      const deletedIds = res.deleted || [];
      const blocked = preview.blocked || [];
      await onCompleted({
        clearedIds: deletedIds,
        message: blocked.length
          ? `已删除 ${deletedIds.length} 种物料，${blocked.length} 项因关联约束未删除`
          : `已删除 ${deletedIds.length} 种物料`,
      });
      if (blocked.length) {
        setResult({ deletedCount: deletedIds.length, failed: blocked });
      } else {
        onClose();
      }
    } catch (e) {
      if (Array.isArray(e.data?.failed) && e.data.failed.length) {
        await onCompleted({ clearedIds: [], message: '' });
        setResult({
          deletedCount: 0,
          failed: e.data.failed,
          rolledBack: true,
          error: e.message,
        });
      } else {
        setError(e.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (mode === 'deactivate') {
    return (
      <Modal title="批量停用物料" onClose={submitting ? () => {} : onClose}>
        <div className="form-body batch-dialog-body">
          <p>待停用物料：{summarizeProductNames(activeItems)}</p>
          {inactiveCount > 0 && (
            <p className="muted">已选中的另外 {inactiveCount} 项已是停用状态，将自动跳过。</p>
          )}
          <div className="info-box">
            仅影响当前仓库；停用保留库存和历史记录，普通开单选品默认隐藏，可从库存页面开单清库存。
          </div>
          {error && <div className="info-box" role="alert">{error}</div>}
        </div>
        <div className="modal-footer">
          <Button onClick={onClose} disabled={submitting}>取消</Button>
          <Button kind="primary" busy={submitting} disabled={!activeItems.length} onClick={handleDeactivate}>
            确认停用
          </Button>
        </div>
      </Modal>
    );
  }

  if (result) {
    return (
      <Modal title="批量删除结果" onClose={onClose}>
        <div className="form-body batch-dialog-body">
          <p>
            <strong>成功删除 {result.deletedCount} 项</strong>，失败 {result.failed.length} 项（失败项已保留选中）。
          </p>
          {result.rolledBack && (
            <div className="info-box" role="alert">
              {result.error || '检测到物料状态已变化，本次未删除任何物料。'}
            </div>
          )}
          {result.failed.length > 0 && (
            <div className="batch-blocked-section" role="region" aria-label="删除失败的物料">
              <strong>失败物料及原因：</strong>
              <ul className="batch-blocked-list">
                {result.failed.map(item => (
                  <li key={item.id}>
                    <strong>{item.name}</strong>
                    {item.barcode ? <span className="muted">（{item.barcode}）</span> : null}：{item.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <Button kind="primary" onClick={onClose}>关闭</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="批量删除物料" onClose={submitting ? () => {} : onClose}>
      <div className="form-body batch-dialog-body">
        <p>已选物料：{summarizeProductNames(selectedProducts)}</p>
        <div className="info-box">
          仅影响当前仓库；停用保留库存和历史，开单选品默认隐藏；删除不可恢复。
        </div>
        {previewing && <p><LoadingStatus>正在预检物料删除条件…</LoadingStatus></p>}
        {error && <div className="info-box" role="alert">{error}</div>}
        {preview && (
          <>
            <p>
              预检结果：<strong>可删除 {preview.deletable.length} 项</strong>，无法删除 {preview.blocked.length} 项。
            </p>
            {preview.blocked.length > 0 && (
              <div className="batch-blocked-section" role="region" aria-label="无法删除的物料">
                <strong>以下 {preview.blocked.length} 项物料无法删除：</strong>
                <ul className="batch-blocked-list">
                  {preview.blocked.map(item => (
                    <li key={item.id}>
                      <strong>{item.name}</strong>
                      {item.barcode ? <span className="muted">（{item.barcode}）</span> : null}：{item.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
      <div className="modal-footer">
        <Button onClick={onClose} disabled={submitting}>取消</Button>
        <Button
          kind="primary"
          className="btn-danger"
          busy={submitting}
          disabled={previewing || !preview?.deletable?.length}
          onClick={handleDelete}
        >
          确认删除{preview?.deletable?.length ? ` (${preview.deletable.length})` : ''}
        </Button>
      </div>
    </Modal>
  );
}

function Products({ data, search, setSearch, edit, showProduct, barcode, onCategoriesChanged, onSaved, isAdmin }) {
  const { can } = usePermissions();
  const [status, setStatus] = useState("active");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const actionLock = useRef(false);
  const [selectedMap, setSelectedMap] = useState(() => new Map());
  const [batchMode, setBatchMode] = useState(null);
  const changeProduct = async (product, remove = false) => {
    if (actionLock.current) return;
    const active = product.active === 0 ? 1 : 0;
    const message = remove
      ? `确定删除「${product.name}」？删除无法恢复，仅允许删除库存为零且没有单据、盘点和模板关联的物料。仅影响当前仓库。`
      : `确定${active ? "启用" : "停用"}「${product.name}」？${active ? "启用后恢复普通开单选品。" : "停用后普通开单选品默认隐藏，库存和历史记录保留，可从库存页面开单清库存。"}仅影响当前仓库。`;
    if (!window.confirm(message)) return;
    actionLock.current = true;
    setBusy(true); setActionError("");
    try {
      await api(`/products/${product.id}${remove ? "" : "/status"}`, { method: remove ? "DELETE" : "POST", body: remove ? {} : { active } });
      setSelectedMap(prev => {
        if (!prev.has(product.id)) return prev;
        const next = new Map(prev);
        if (remove) next.delete(product.id);
        else next.set(product.id, { ...next.get(product.id), active });
        return next;
      });
      await onSaved(remove ? "物料已删除" : active ? "物料已启用" : "物料已停用");
    } catch (e) { setActionError(e.message); }
    finally { actionLock.current = false; setBusy(false); }
  };
  const lifecycleActions = (p) => isAdmin && <>
    <AntButton type="text" htmlType="button" className="text-button" disabled={busy} aria-label={`${p.active === 0 ? "启用" : "停用"} ${p.name}`} onClick={() => changeProduct(p)}>{p.active === 0 ? "启用" : "停用"}</AntButton>
    <AntButton type="text" htmlType="button" className="text-button product-delete" disabled={busy} aria-label={`删除 ${p.name}`} onClick={() => changeProduct(p, true)}>删除</AntButton>
  </>;
  const [category, setCategory] = useState(null),
    [view, setView] = useState("list"),
    [pageNum, setPageNum] = useState(1);
  const [managing, setManaging] = useState(false);
  const categories = data.categories || [];
  useEffect(() => { if (category && !categories.some(c => c.id === category)) setCategory(null); }, [categories, category]);
  useEffect(() => setPageNum(1), [category, search, status]);
  useEffect(() => {
    setSelectedMap(new Map());
    setBatchMode(null);
  }, [category, search, status, data.warehouse_id]);
  const list = useQuery(queryPath('/products', { limit: 8, offset: (pageNum - 1) * 8, q: search, status, category_id: category }), data, search ? 250 : 0);
  const stats = useQuery('/dashboard', data);
  const filtered = list.result?.products || [];
  const total = list.result?.total || 0;
  useEffect(() => { if (list.result) setPageNum(p => Math.min(p, Math.max(1, Math.ceil(total / 8)))); }, [list.result, total]);
  const visible = filtered;
  useEffect(() => {
    if (!visible.length) return;
    setSelectedMap(prev => {
      if (!prev.size) return prev;
      let changed = false;
      const next = new Map(prev);
      for (const p of visible) {
        const existing = next.get(p.id);
        if (existing && (existing.name !== p.name || existing.barcode !== p.barcode || existing.active !== p.active)) {
          next.set(p.id, { id: p.id, name: p.name, barcode: p.barcode, active: p.active });
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [visible]);
  const selectedList = [...selectedMap.values()];
  const activeSelected = selectedList.filter(p => p.active !== 0);
  const selectedOnPageCount = visible.filter(p => selectedMap.has(p.id)).length;
  const allPageSelected = visible.length > 0 && selectedOnPageCount === visible.length;
  const somePageSelected = selectedOnPageCount > 0 && !allPageSelected;
  const toggleSelect = (p) => {
    setSelectedMap(prev => {
      const next = new Map(prev);
      if (next.has(p.id)) next.delete(p.id);
      else next.set(p.id, { id: p.id, name: p.name, barcode: p.barcode, active: p.active });
      return next;
    });
  };
  const togglePageAll = () => {
    setSelectedMap(prev => {
      const next = new Map(prev);
      if (allPageSelected) {
        for (const p of visible) next.delete(p.id);
      } else {
        for (const p of visible) next.set(p.id, { id: p.id, name: p.name, barcode: p.barcode, active: p.active });
      }
      return next;
    });
  };
  const clearSelection = () => setSelectedMap(new Map());
  const handleBatchCompleted = async ({ clearedIds, message }) => {
    if (clearedIds?.length) {
      setSelectedMap(prev => {
        const next = new Map(prev);
        for (const id of clearedIds) next.delete(id);
        return next;
      });
    }
    if (message) await onSaved(message);
    else {
      list.retry();
      stats.retry();
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="MATERIALS"
        title="物料管理"
        description="按分类维护物料图片、规格型号、价格及备注。"
      >
        <Button permission="products" kind="primary" icon={Plus} onClick={() => edit(null)}>
          新增物料
        </Button>
      </PageHeading>
      {busy && <p><LoadingStatus>正在更新物料…</LoadingStatus></p>}
      {actionError && <div className="info-box" role="alert">{actionError}</div>}
      <div className="catalog-layout">
        <aside className="panel category-sidebar">
          <h3>物料分类</h3>
          <CategoryTree categories={categories} counts={stats.result?.category_counts} selected={category} onSelect={setCategory} />
        </aside>
      <section className="panel products-panel">
        <div className="table-toolbar">
          {isAdmin && (
            <div className="product-toolbar-left">
              <Button onClick={() => setManaging(true)}>管理分类</Button>
              {view === "grid" && visible.length > 0 && (
                <AntCheckbox className="batch-select-all" indeterminate={somePageSelected} aria-label="全选本页物料" checked={allPageSelected} onChange={togglePageAll} disabled={busy}>

                  <span>全选本页</span>
                </AntCheckbox>
              )}
              {selectedList.length > 0 && (
                <div className="batch-selection-bar" role="region" aria-label="批量操作">
                  <span className="batch-selection-count">已选 {selectedList.length} 项</span>
                  <AntButton type="text" htmlType="button" className="text-button" disabled={busy} onClick={clearSelection}>
                    清除选择
                  </AntButton>
                </div>
              )}
              <Button
                disabled={busy || activeSelected.length === 0}
                onClick={() => setBatchMode("deactivate")}
              >
                批量停用
              </Button>
              <Button
                className="product-delete"
                disabled={busy || selectedList.length === 0}
                onClick={() => setBatchMode("delete")}
              >
                批量删除
              </Button>
            </div>
          )}
          <div className="toolbar-right product-toolbar-actions">
            <div className="filter-tabs product-status-filter" role="group" aria-label="物料使用状态">
              {[["all", "全部状态"], ["active", "已启用"], ["inactive", "已停用"]].map(([value, label]) => (
                <AntButton type="text" key={value} htmlType="button" className={status === value ? "active" : ""} aria-pressed={status === value} onClick={() => setStatus(value)}>{label}</AntButton>
              ))}
            </div>
            <div className="table-search">
              <AntInput prefix={<Search size={16} />} allowClear={{ clearIcon: <X size={14} aria-label="清除搜索" /> }}
                aria-label="筛选物料"
                placeholder="搜索名称、条码、规格或客户料号"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />

            </div>
            <div className="view-toggle">
              <AntButton type="text" htmlType="button"
                className={view === "list" ? "active" : ""}
                aria-label="列表视图"
                onClick={() => setView("list")}
              >
                <List size={17} />
              </AntButton>
              <AntButton type="text" htmlType="button"
                className={view === "grid" ? "active" : ""}
                aria-label="网格视图"
                onClick={() => setView("grid")}
              >
                <Grid2X2 size={16} />
              </AntButton>
            </div>
          </div>
        </div>
        <QueryStatus query={list} block />
        {filtered.length ? (
          view === "list" ? (
            <div className="table-scroll">
              <table className="data-table product-table">
                <thead>
                  <tr>
                    {isAdmin && (
                      <th className="checkbox-cell">
                        <AntCheckbox
                          indeterminate={somePageSelected}
                          aria-label="全选本页物料"
                          checked={allPageSelected}
                          onChange={togglePageAll}
                          disabled={busy || !visible.length}
                        />
                      </th>
                    )}
                    <th>物料信息</th>
                    <th>分类</th>
                    <th>生产类型</th>
                    <th className="number-cell">参考采购价 / 参考销售价</th>
                    <th className="number-cell">当前库存</th>
                    <th>库存状态</th>
                    <th className="number-cell">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <tr key={p.id} className={selectedMap.has(p.id) ? "row-selected" : ""}>
                      {isAdmin && (
                        <td className="checkbox-cell">
                          <AntCheckbox
                            aria-label={`选择 ${p.name}`}
                            checked={selectedMap.has(p.id)}
                            onChange={() => toggleSelect(p)}
                            disabled={busy}
                          />
                        </td>
                      )}
                      <td>
                        <div className="product-info">
                          <ProductArt product={p} />
                          <div>
                            <strong><ProductName product={p} onView={showProduct} /></strong>
                            {p.active === 0 && <Badge tone="orange">已停用</Badge>}
                            <small>{p.barcode}</small>
                            {p.specification && <small className="product-spec">{p.specification}</small>}
                            {p.note && <small className="product-note" title={p.note}>{p.note}</small>}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="category-tag">{p.category}</span>
                      </td>
                      <td>{p.production_type || '未设置'}</td>
                      <td className="number-cell">
                        <div className="price-pair">
                          <strong>{currencySymbol()} {price(p.price)}</strong>
                          <small>采购 {currencySymbol()} {price(p.cost)}</small>
                        </div>
                      </td>
                      <td className="number-cell">
                        <strong className="stock-number">
                          {count(p.stock)}
                        </strong>
                        <span className="muted"> {p.unit}</span>
                      </td>
                      <td>
                        <Badge
                          tone={
                            stockTone(p)
                          }
                        >
                          {stockStatus(p)}
                        </Badge>
                      </td>
                      <td>
                        <div className="row-actions">
                          <AntButton type="text" htmlType="button"
                            className="icon-button"
                            aria-label={`查看 ${p.name} 条码`}
                            onClick={() => barcode(p)}
                          >
                            <ScanLine size={17} />
                          </AntButton>
                          <AntButton type="text" htmlType="button"
                            className="text-button"
                            hidden={!can("products")} onClick={() => edit(p)}
                          >
                            编辑
                          </AntButton>
                          {lifecycleActions(p)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="product-grid">
              {visible.map((p) => (
                <article key={p.id} className={`product-grid-card${selectedMap.has(p.id) ? " card-selected" : ""}`}>
                  <div className="product-grid-top">
                    <div className="product-grid-top-left">
                      {isAdmin && (
                        <AntCheckbox

                          className="product-card-checkbox"
                          aria-label={`选择 ${p.name}`}
                          checked={selectedMap.has(p.id)}
                          onChange={() => toggleSelect(p)}
                          disabled={busy}
                        />
                      )}
                      <ProductArt product={p} size="large" />
                    </div>
                    <Badge
                      tone={
                        stockTone(p)
                      }
                    >
                      {stockStatus(p)}
                    </Badge>
                  </div>
                  <h3><ProductName product={p} onView={showProduct} /> {p.active === 0 && <Badge tone="orange">已停用</Badge>}</h3>
                  <p>{p.barcode}</p>
                  <p>{p.category}</p>
                  <p>生产类型：{p.production_type || '未设置'}</p>
                  {p.specification && <p className="product-spec">{p.specification}</p>}
                  {p.note && <p className="product-note" title={p.note}>{p.note}</p>}
                  <div className="product-grid-stats">
                    <strong>{currencySymbol()} {price(p.price)}</strong>
                    <span>
                      库存 {p.stock} {p.unit}
                    </span>
                  </div>
                  <div className="product-grid-actions">
                    <AntButton type="text" htmlType="button" onClick={() => barcode(p)}>
                      <ScanLine size={15} />
                      物料条码
                    </AntButton>
                    <AntButton type="text" htmlType="button" hidden={!can("products")} onClick={() => edit(p)}>
                      编辑
                      <ChevronRight size={13} />
                    </AntButton>
                    {lifecycleActions(p)}
                  </div>
                </article>
              ))}
            </div>
          )
        ) : !list.loading && !list.error && (
          <Empty
            title="没有找到物料"
            description="请调整搜索条件，或新增物料。"
            action={
              <Button permission="products" icon={Plus} onClick={() => edit(null)}>
                新增物料
              </Button>
            }
          />
        )}
        <Pagination
          total={total}
          page={pageNum}
          setPage={setPageNum}
        />
      </section>
      </div>
      {managing && <CategoryManager categories={categories} onClose={() => setManaging(false)} onChanged={onCategoriesChanged} />}
      {isAdmin && batchMode && (
        <ProductBatchDialog
          mode={batchMode}
          selectedProducts={selectedList}
          onClose={() => setBatchMode(null)}
          onCompleted={handleBatchCompleted}
        />
      )}
      <div className="page-hint">
        <ScanLine size={16} />
        <span>物料条码可自动生成，支持扫码识别及标签下载。</span>
      </div>
    </>
  );
}

export { Products };
