import { usePermissions } from '../permissions.jsx';
import { useState, useEffect } from 'react';
import { useQuery, queryPath } from '../queries.js';
import {
  QueryStatus,
  PageHeading,
  Button,
  CategoryTree,
  ProductArt,
  ProductName,
  Badge,
  Empty,
  Pagination,
} from '../components/common.jsx';
import {
  Warehouse,
  Truck,
  ArrowDownToLine,
  Boxes,
  TriangleAlert,
  Package,
  Search,
  Plus,
  Minus,
  ShieldCheck,
} from 'lucide-react';
import { count, money, stockStatus, stockTone } from '../app/format.js';

function Inventory({ data, filter, setFilter, openOrder, openTransfer, reduceStock, increaseStock, showBarcode, showProduct }) {
  const { can, costs } = usePermissions();
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  const [category, setCategory] = useState(null);
  const categories = data.categories || [];
  useEffect(() => { if (category && !categories.some(c => c.id === category)) setCategory(null); }, [categories, category]);
  const stats = useQuery('/dashboard', data);
  const summary = stats.result?.products;
  const list = useQuery(queryPath('/products', { limit: 8, offset: (page - 1) * 8, q: query, status: 'active', stock: filter === 'warning' ? 'low' : filter, category_id: category }), data, query ? 250 : 0);
  const filtered = list.result?.products || [];
  const total = list.result?.total || 0;
  const lowCount = (summary?.low_stock || 0) + (summary?.out_of_stock || 0);
  useEffect(() => setPage(1), [filter, query, category]);
  useEffect(() => { if (list.result) setPage(p => Math.min(p, Math.max(1, Math.ceil(total / 8)))); }, [list.result, total]);
  return (
    <>
      <QueryStatus query={list} /><QueryStatus query={stats} />
      <PageHeading
        eyebrow="INVENTORY"
        title="库存管理"
        description="查看现有库存、库存成本及补货预警。"
      >
        <span className="warehouse-chip">
          <Warehouse size={15} />
          {data.settings.warehouse_name}
        </span>
        <Button permission="transfer" icon={Truck} onClick={openTransfer}>
          仓库调拨
        </Button>
        <Button permission="purchase"
          kind="primary"
          icon={ArrowDownToLine}
          onClick={() => openOrder("in")}
        >
          采购入库
        </Button>
      </PageHeading>
      <div className="inventory-stats">
        <div>
          <span className="metric-icon icon-blue">
            <Boxes size={21} />
          </span>
          <span>
            <small>在库总数量</small>
            <strong>
              {count(summary?.active_stock || 0)}
              <em> 件</em>
            </strong>
          </span>
        </div>
        <div>
          <span className="metric-icon icon-purple">
            <Warehouse size={21} />
          </span>
          <span>
            <small>库存成本金额</small>
            <strong>
              <em>¥ </em>
              {costs ? money((summary?.active_value_cents || 0) / 100) : '—'}
            </strong>
          </span>
        </div>
        <div>
          <span className="metric-icon icon-orange">
            <TriangleAlert size={21} />
          </span>
          <span>
            <small>低库存物料</small>
            <strong>
              {lowCount}
              <em> 种</em>
            </strong>
          </span>
        </div>
        <div>
          <span className="metric-icon icon-red">
            <Package size={21} />
          </span>
          <span>
            <small>缺货物料</small>
            <strong>
              {summary?.out_of_stock || 0}
              <em> 种</em>
            </strong>
          </span>
        </div>
      </div>
      <div className="catalog-layout">
        <aside className="panel category-sidebar">
          <h3>物料分类</h3>
          <CategoryTree categories={categories} counts={stats.result?.category_counts} active selected={category} onSelect={setCategory} />
        </aside>
      <section className="panel products-panel">
        <div className="table-toolbar">
          <div className="filter-tabs">
            {[
              ["all", "全部库存", summary?.active || 0],
              ["warning", "库存预警", lowCount],
              ["empty", "已缺货", summary?.out_of_stock || 0],
            ].map(([id, label, n]) => (
              <button
                key={id}
                className={filter === id ? "active" : ""}
                onClick={() => setFilter(id)}
              >
                {label}
                <span>{n}</span>
              </button>
            ))}
          </div>
          <div className="table-search">
            <Search size={16} />
            <input
              aria-label="搜索库存物料"
              placeholder="搜索物料或条码"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>物料信息</th>
                <th>分类</th>
                <th className="number-cell">现有库存</th>
                <th className="number-cell">安全库存</th>
                <th>库存状态</th>
                <th className="number-cell">库存成本</th>
                <th className="number-cell">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="product-info">
                      <ProductArt product={p} />
                      <div>
                        <strong><ProductName product={p} onView={showProduct} /></strong>
                        <button
                          className="barcode-link"
                          onClick={() => showBarcode(p)}
                        >
                          {p.barcode}
                        </button>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="category-tag">{p.category}</span>
                  </td>
                  <td className="number-cell">
                    <strong
                      className={
                        ({ red: "red-text", orange: "orange-text" })[stockTone(p)] || ""
                      }
                    >
                      {p.stock}
                    </strong>
                    <span className="muted"> {p.unit}</span>
                  </td>
                  <td className="number-cell muted">
                    {p.threshold} {p.unit}
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
                  <td className="number-cell">¥ {costs ? money((p.inventory_value_cents ?? Math.round(p.cost * p.stock * 100)) / 100) : '—'}</td>
                  <td className="number-cell">
                    <div className="row-actions">
                      <button
                        className="text-button"
                        hidden={!can("purchase")} onClick={() => openOrder("in", p)}
                      >
                        <Plus size={14} />
                        补货
                      </button>
                      <button className="text-button" hidden={!can("stocktake")} onClick={() => increaseStock(p)}>
                        <Plus size={14} />增加库存（退料）
                      </button>
                      <button
                        className="text-button danger"
                        hidden={!can("stocktake")} onClick={() => reduceStock(p)}
                      >
                        <Minus size={14} />
                        减少
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && (
            <Empty
              title="暂无符合条件的物料"
              description="调整筛选条件，查看其他库存。"
            />
          )}
        </div>
        <Pagination total={total} page={page} setPage={setPage} />
      </section>
      </div>
      <div className="page-hint">
        <ShieldCheck size={16} />
        库存随单据确认自动更新，安全库存可在物料档案中调整。
      </div>
    </>
  );
}

export { Inventory };
