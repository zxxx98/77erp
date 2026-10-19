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
  Empty,
  Pagination,
} from '../components/common.jsx';
import { Plus, Search, X, List, Grid2X2, ScanLine, ChevronRight } from 'lucide-react';
import { LoadingStatus } from '../Loading.jsx';
import { money, count, stockStatus, stockTone } from '../app/format.js';
import { CategoryManager } from '../LazyComponents.jsx';

function Products({ data, search, setSearch, edit, showProduct, barcode, onCategoriesChanged, onSaved, isAdmin }) {
  const { can } = usePermissions();
  const [status, setStatus] = useState("active");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const actionLock = useRef(false);
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
      await onSaved(remove ? "物料已删除" : active ? "物料已启用" : "物料已停用");
    } catch (e) { setActionError(e.message); }
    finally { actionLock.current = false; setBusy(false); }
  };
  const lifecycleActions = (p) => isAdmin && <>
    <button className="text-button" disabled={busy} aria-label={`${p.active === 0 ? "启用" : "停用"} ${p.name}`} onClick={() => changeProduct(p)}>{p.active === 0 ? "启用" : "停用"}</button>
    <button className="text-button product-delete" disabled={busy} aria-label={`删除 ${p.name}`} onClick={() => changeProduct(p, true)}>删除</button>
  </>;
  const [category, setCategory] = useState(null),
    [view, setView] = useState("list"),
    [pageNum, setPageNum] = useState(1);
  const [managing, setManaging] = useState(false);
  const categories = data.categories || [];
  useEffect(() => { if (category && !categories.some(c => c.id === category)) setCategory(null); }, [categories, category]);
  useEffect(() => setPageNum(1), [category, search, status]);
  const list = useQuery(queryPath('/products', { limit: 8, offset: (pageNum - 1) * 8, q: search, status, category_id: category }), data, search ? 250 : 0);
  const stats = useQuery('/dashboard', data);
  const filtered = list.result?.products || [];
  const total = list.result?.total || 0;
  useEffect(() => { if (list.result) setPageNum(p => Math.min(p, Math.max(1, Math.ceil(total / 8)))); }, [list.result, total]);
  const visible = filtered;
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
          {isAdmin && <Button onClick={() => setManaging(true)}>管理分类</Button>}
          <div className="toolbar-right product-toolbar-actions">
            <div className="filter-tabs product-status-filter" role="group" aria-label="物料使用状态">
              {[["all", "全部状态"], ["active", "已启用"], ["inactive", "已停用"]].map(([value, label]) => (
                <button key={value} type="button" className={status === value ? "active" : ""} aria-pressed={status === value} onClick={() => setStatus(value)}>{label}</button>
              ))}
            </div>
            <div className="table-search">
              <Search size={16} />
              <input
                aria-label="筛选物料"
                placeholder="搜索名称、条码或规格型号"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button aria-label="清除搜索" onClick={() => setSearch("")}>
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="view-toggle">
              <button
                className={view === "list" ? "active" : ""}
                aria-label="列表视图"
                onClick={() => setView("list")}
              >
                <List size={17} />
              </button>
              <button
                className={view === "grid" ? "active" : ""}
                aria-label="网格视图"
                onClick={() => setView("grid")}
              >
                <Grid2X2 size={16} />
              </button>
            </div>
          </div>
        </div>
        <QueryStatus query={list} />
        {filtered.length ? (
          view === "list" ? (
            <div className="table-scroll">
              <table className="data-table product-table">
                <thead>
                  <tr>
                    <th>物料信息</th>
                    <th>分类</th>
                    <th className="number-cell">参考采购价 / 参考销售价</th>
                    <th className="number-cell">当前库存</th>
                    <th>库存状态</th>
                    <th className="number-cell">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <tr key={p.id}>
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
                      <td className="number-cell">
                        <div className="price-pair">
                          <strong>¥ {money(p.price)}</strong>
                          <small>采购 ¥ {money(p.cost)}</small>
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
                          <button
                            className="icon-button"
                            aria-label={`查看 ${p.name} 条码`}
                            onClick={() => barcode(p)}
                          >
                            <ScanLine size={17} />
                          </button>
                          <button
                            className="text-button"
                            hidden={!can("products")} onClick={() => edit(p)}
                          >
                            编辑
                          </button>
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
                <article key={p.id} className="product-grid-card">
                  <div className="product-grid-top">
                    <ProductArt product={p} size="large" />
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
                  {p.specification && <p className="product-spec">{p.specification}</p>}
                  {p.note && <p className="product-note" title={p.note}>{p.note}</p>}
                  <div className="product-grid-stats">
                    <strong>¥ {money(p.price)}</strong>
                    <span>
                      库存 {p.stock} {p.unit}
                    </span>
                  </div>
                  <div className="product-grid-actions">
                    <button onClick={() => barcode(p)}>
                      <ScanLine size={15} />
                      物料条码
                    </button>
                    <button hidden={!can("products")} onClick={() => edit(p)}>
                      编辑
                      <ChevronRight size={13} />
                    </button>
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
      <div className="page-hint">
        <ScanLine size={16} />
        <span>物料条码可自动生成，支持扫码识别及标签下载。</span>
      </div>
    </>
  );
}

export { Products };
