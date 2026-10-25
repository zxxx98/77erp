import { localizeError } from '../i18n/errors.js';
import { t as translate, getFormatLocale, translateText } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
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
  return list.length > 5 ? translate("warehouse.and.other.items", { v0: names, v1: list.length }) : translate("warehouse.items.in.total", { v0: names, v1: list.length });
}

export function ProductBatchDialog({ mode, selectedProducts, onClose, onCompleted }) {
  useLocale();
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
        if (alive) setError(localizeError(e.message));
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
        ? translate("warehouse.items.deactivated.items.skipped", { v0: res.updated.length, v1: skippedCount })
        : translate("warehouse.items.have.been.deactivated", { v0: res.updated.length });
      await onCompleted({ clearedIds: selectedProducts.map(p => p.id), message });
      onClose();
    } catch (e) {
      setError(localizeError(e.message));
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
          ? translate("warehouse.materials.have.been.deleted.items.have.not.been.deleted.due.to", { v0: deletedIds.length, v1: blocked.length })
          : translate("warehouse.items.have.been.deleted", { v0: deletedIds.length }),
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
        setError(localizeError(e.message));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (mode === 'deactivate') {
    return (
      <Modal title={translate("warehouse.deactivate.materials.in.batches")} onClose={submitting ? () => {} : onClose}>
        <div className="form-body batch-dialog-body">
          <p>{translate("warehouse.materials.to.be.deactivated")}{summarizeProductNames(activeItems)}</p>
          {inactiveCount > 0 && (
            <p className="muted">{translate("warehouse.selected.additional")}{" "}{inactiveCount}{" "}{translate("warehouse.the.item.is.inactive.and.will.be.automatically.skipped")}</p>
          )}
          <div className="info-box">{translate("warehouse.only.affects.the.current.warehouse.disables.the.retention.of.inventory.and")}</div>
          {error && <div className="info-box" role="alert">{error}</div>}
        </div>
        <div className="modal-footer">
          <Button onClick={onClose} disabled={submitting}>{translate("warehouse.cancel")}</Button>
          <Button kind="primary" busy={submitting} disabled={!activeItems.length} onClick={handleDeactivate}>{translate("warehouse.confirm.deactivation")}</Button>
        </div>
      </Modal>
    );
  }

  if (result) {
    return (
      <Modal title={translate("warehouse.delete.results.in.batches")} onClose={onClose}>
        <div className="form-body batch-dialog-body">
          <p>
            <strong>{translate("warehouse.successfully.deleted")}{" "}{result.deletedCount}{" "}{translate("warehouse.items.2")}</strong>{translate("warehouse.failed")}{" "}{result.failed.length}{translate("warehouse.items.failed.items.remain.selected")}</p>
          {result.rolledBack && (
            <div className="info-box" role="alert">
              {result.error || translate("warehouse.it.is.detected.that.the.material.status.has.changed.and.no")}
            </div>
          )}
          {result.failed.length > 0 && (
            <div className="batch-blocked-section" role="region" aria-label={translate("warehouse.delete.failed.materials")}>
              <strong>{translate("warehouse.failed.materials.and.reasons")}</strong>
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
          <Button kind="primary" onClick={onClose}>{translate("warehouse.close")}</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={translate("warehouse.delete.materials.in.batches")} onClose={submitting ? () => {} : onClose}>
      <div className="form-body batch-dialog-body">
        <p>{translate("warehouse.selected.materials")}{summarizeProductNames(selectedProducts)}</p>
        <div className="info-box">{translate("warehouse.only.affects.the.current.warehouse.disables.the.retention.of.inventory.and.2")}</div>
        {previewing && <p><LoadingStatus>{translate("warehouse.pre.checking.material.deletion.conditions")}</LoadingStatus></p>}
        {error && <div className="info-box" role="alert">{error}</div>}
        {preview && (
          <>
            <p>{translate("warehouse.pre.check.results")}<strong>{translate("warehouse.can.be.deleted")}{" "}{preview.deletable.length}{" "}{translate("warehouse.items.2")}</strong>{translate("warehouse.cannot.be.deleted")}{" "}{preview.blocked.length}{translate("warehouse.item")}</p>
            {preview.blocked.length > 0 && (
              <div className="batch-blocked-section" role="region" aria-label={translate("warehouse.items.that.cannot.be.deleted")}>
                <strong>{translate("warehouse.below")}{" "}{preview.blocked.length}{" "}{translate("warehouse.item.item.cannot.be.deleted")}</strong>
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
        <Button onClick={onClose} disabled={submitting}>{translate("warehouse.cancel")}</Button>
        <Button
          kind="primary"
          className="btn-danger"
          busy={submitting}
          disabled={previewing || !preview?.deletable?.length}
          onClick={handleDelete}
        >{translate("warehouse.confirm.deletion")}{preview?.deletable?.length ? ` (${preview.deletable.length})` : ''}
        </Button>
      </div>
    </Modal>
  );
}

function Products({ data, search, setSearch, edit, showProduct, barcode, onCategoriesChanged, onSaved, isAdmin }) {
  useLocale();
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
      ? translate("warehouse.are.you.sure.you.want.to.delete.deletion.cannot.be.recovered", { v0: product.name })
      : translate("warehouse.are.you.sure.only.affects.the.current.warehouse", { v0: active ? translate("warehouse.activate") : translate("warehouse.deactivate"), v1: product.name, v2: active ? translate("warehouse.after.activation.the.normal.ordering.selection.will.be.restored") : translate("warehouse.after.deactivation.the.general.ordering.selection.will.be.hidden.by.default") });
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
      await onSaved(remove ? translate("warehouse.material.deleted") : active ? translate("warehouse.material.is.enabled") : translate("warehouse.material.has.been.deactivated"));
    } catch (e) { setActionError(e.message); }
    finally { actionLock.current = false; setBusy(false); }
  };
  const lifecycleActions = (p) => isAdmin && <>
    <AntButton type="text" htmlType="button" className="text-button" disabled={busy} aria-label={`${p.active === 0 ? translate("warehouse.activate") : translate("warehouse.deactivate")} ${p.name}`} onClick={() => changeProduct(p)}>{p.active === 0 ? translate("warehouse.activate") : translate("warehouse.deactivate")}</AntButton>
    <AntButton type="text" htmlType="button" className="text-button product-delete" disabled={busy} aria-label={translate("warehouse.delete", { v0: p.name })} onClick={() => changeProduct(p, true)}>{translate("warehouse.delete.2")}</AntButton>
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
        title={translate("warehouse.material.management")}
        description={translate("warehouse.maintain.material.pictures.specifications.and.models.prices.and.remarks.by.category")}
      >
        <Button permission="products" kind="primary" icon={Plus} onClick={() => edit(null)}>{translate("warehouse.add.new.material")}</Button>
      </PageHeading>
      {busy && <p><LoadingStatus>{translate("warehouse.updating.material")}</LoadingStatus></p>}
      {actionError && <div className="info-box" role="alert">{actionError}</div>}
      <div className="catalog-layout">
        <aside className="panel category-sidebar">
          <h3>{translate("warehouse.material.categories")}</h3>
          <CategoryTree categories={categories} counts={stats.result?.category_counts} selected={category} onSelect={setCategory} />
        </aside>
      <section className="panel products-panel">
        <div className="table-toolbar">
          {isAdmin && (
            <div className="product-toolbar-left">
              <Button onClick={() => setManaging(true)}>{translate("warehouse.management.classification")}</Button>
              {view === "grid" && visible.length > 0 && (
                <AntCheckbox className="batch-select-all" indeterminate={somePageSelected} aria-label={translate("warehouse.select.all.materials.on.this.page")} checked={allPageSelected} onChange={togglePageAll} disabled={busy}>

                  <span>{translate("warehouse.select.all.this.page")}</span>
                </AntCheckbox>
              )}
              {selectedList.length > 0 && (
                <div className="batch-selection-bar" role="region" aria-label={translate("warehouse.batch.operations")}>
                  <span className="batch-selection-count">{translate("warehouse.selected")}{" "}{selectedList.length}{" "}{translate("warehouse.items.2")}</span>
                  <AntButton type="text" htmlType="button" className="text-button" disabled={busy} onClick={clearSelection}>{translate("warehouse.clear.selection")}</AntButton>
                </div>
              )}
              <Button
                disabled={busy || activeSelected.length === 0}
                onClick={() => setBatchMode("deactivate")}
              >{translate("warehouse.deactivate.selected")}</Button>
              <Button
                className="product-delete"
                disabled={busy || selectedList.length === 0}
                onClick={() => setBatchMode("delete")}
              >{translate("warehouse.delete.selected")}</Button>
            </div>
          )}
          <div className="toolbar-right product-toolbar-actions">
            <div className="filter-tabs product-status-filter" role="group" aria-label={translate("warehouse.material.usage.status")}>
              {[["all", translate("warehouse.all.status")], ["active", translate("warehouse.enabled")], ["inactive", translate("warehouse.deactivated")]].map(([value, label]) => (
                <AntButton type="text" key={value} htmlType="button" className={status === value ? "active" : ""} aria-pressed={status === value} onClick={() => setStatus(value)}>{label}</AntButton>
              ))}
            </div>
            <div className="table-search">
              <AntInput prefix={<Search size={16} />} allowClear={{ clearIcon: <X size={14} aria-label={translate("warehouse.clear.search")} /> }}
                aria-label={translate("warehouse.filter.materials")}
                placeholder={translate("warehouse.search.by.name.barcode.specification.or.customer.part.number")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />

            </div>
            <div className="view-toggle">
              <AntButton type="text" htmlType="button"
                className={view === "list" ? "active" : ""}
                aria-label={translate("warehouse.list.view")}
                onClick={() => setView("list")}
              >
                <List size={17} />
              </AntButton>
              <AntButton type="text" htmlType="button"
                className={view === "grid" ? "active" : ""}
                aria-label={translate("warehouse.grid.view")}
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
                          aria-label={translate("warehouse.select.all.materials.on.this.page")}
                          checked={allPageSelected}
                          onChange={togglePageAll}
                          disabled={busy || !visible.length}
                        />
                      </th>
                    )}
                    <th>{translate("warehouse.material.information")}</th>
                    <th>{translate("warehouse.classification")}</th>
                    <th>{translate("warehouse.production.type")}</th>
                    <th className="number-cell">{translate("warehouse.reference.purchase.price.reference.sales.price")}</th>
                    <th className="number-cell">{translate("warehouse.current.inventory")}</th>
                    <th>{translate("warehouse.stock.status")}</th>
                    <th className="number-cell">{translate("warehouse.operation")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <tr key={p.id} className={selectedMap.has(p.id) ? "row-selected" : ""}>
                      {isAdmin && (
                        <td className="checkbox-cell">
                          <AntCheckbox
                            aria-label={translate("warehouse.select", { v0: p.name })}
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
                            {p.active === 0 && <Badge tone="orange">{translate("warehouse.deactivated")}</Badge>}
                            <small>{p.barcode}</small>
                            {p.specification && <small className="product-spec">{p.specification}</small>}
                            {p.note && <small className="product-note" title={p.note}>{p.note}</small>}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="category-tag">{p.category}</span>
                      </td>
                      <td>{translateText(p.production_type) || translate("warehouse.not.set")}</td>
                      <td className="number-cell">
                        <div className="price-pair">
                          <strong>{currencySymbol()} {price(p.price)}</strong>
                          <small>{translate("warehouse.procurement")}{" "}{currencySymbol()} {price(p.cost)}</small>
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
                            aria-label={translate("warehouse.view.barcode", { v0: p.name })}
                            onClick={() => barcode(p)}
                          >
                            <ScanLine size={17} />
                          </AntButton>
                          <AntButton type="text" htmlType="button"
                            className="text-button"
                            hidden={!can("products")} onClick={() => edit(p)}
                          >{translate("warehouse.edit")}</AntButton>
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
                          aria-label={translate("warehouse.select", { v0: p.name })}
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
                  <h3><ProductName product={p} onView={showProduct} /> {p.active === 0 && <Badge tone="orange">{translate("warehouse.deactivated")}</Badge>}</h3>
                  <p>{p.barcode}</p>
                  <p>{p.category}</p>
                  <p>{translate("warehouse.production.type.2")}{translateText(p.production_type) || translate("warehouse.not.set")}</p>
                  {p.specification && <p className="product-spec">{p.specification}</p>}
                  {p.note && <p className="product-note" title={p.note}>{p.note}</p>}
                  <div className="product-grid-stats">
                    <strong>{currencySymbol()} {price(p.price)}</strong>
                    <span>{translate("warehouse.stock")}{p.stock} {p.unit}
                    </span>
                  </div>
                  <div className="product-grid-actions">
                    <AntButton type="text" htmlType="button" onClick={() => barcode(p)}>
                      <ScanLine size={15} />{translate("warehouse.material.barcode")}</AntButton>
                    <AntButton type="text" htmlType="button" hidden={!can("products")} onClick={() => edit(p)}>{translate("warehouse.edit")}<ChevronRight size={13} />
                    </AntButton>
                    {lifecycleActions(p)}
                  </div>
                </article>
              ))}
            </div>
          )
        ) : !list.loading && !list.error && (
          <Empty
            title={translate("warehouse.material.not.found")}
            description={translate("warehouse.please.adjust.the.search.conditions.or.add.new.materials")}
            action={
              <Button permission="products" icon={Plus} onClick={() => edit(null)}>{translate("warehouse.add.new.material")}</Button>
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
        <span>{translate("warehouse.material.barcodes.can.be.automatically.generated.supporting.code.scanning.and.label")}</span>
      </div>
    </>
  );
}

export { Products };
