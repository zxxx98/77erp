import { t as translate, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { Button as AntButton, Input as AntInput } from '../ui/controls.jsx';

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
import { count, money, stockStatus, stockTone, currencySymbol } from '../app/format.js';

function Inventory({ data, filter, setFilter, openOrder, openTransfer, reduceStock, increaseStock, showBarcode, showProduct }) {
  useLocale();
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
        title={translate("warehouse.inventory.management")}
        description={translate("warehouse.view.on.hand.inventory.inventory.costs.and.replenishment.alerts")}
      >
        <span className="warehouse-chip">
          <Warehouse size={15} />
          {data.settings.warehouse_name}
        </span>
        <Button permission="transfer" icon={Truck} onClick={openTransfer}>{translate("warehouse.warehouse.transfer")}</Button>
        <Button permission="purchase"
          kind="primary"
          icon={ArrowDownToLine}
          onClick={() => openOrder("in")}
        >{translate("warehouse.stock.in")}</Button>
      </PageHeading>
      <div className="inventory-stats">
        <div>
          <span className="metric-icon icon-blue">
            <Boxes size={21} />
          </span>
          <span>
            <small>{translate("warehouse.total.quantity.in.stock")}</small>
            <strong>
              {count(summary?.active_stock || 0)}
              <em>{" "}{translate("warehouse.items")}</em>
            </strong>
          </span>
        </div>
        <div>
          <span className="metric-icon icon-purple">
            <Warehouse size={21} />
          </span>
          <span>
            <small>{translate("warehouse.inventory.cost.amount")}</small>
            <strong>
              <em>{currencySymbol()} </em>
              {costs ? money((summary?.active_value_cents || 0) / 100) : '—'}
            </strong>
          </span>
        </div>
        <div>
          <span className="metric-icon icon-orange">
            <TriangleAlert size={21} />
          </span>
          <span>
            <small>{translate("warehouse.low.inventory.materials")}</small>
            <strong>
              {lowCount}
              <em>{" "}{translate("warehouse.types")}</em>
            </strong>
          </span>
        </div>
        <div>
          <span className="metric-icon icon-red">
            <Package size={21} />
          </span>
          <span>
            <small>{translate("warehouse.out.of.stock.material")}</small>
            <strong>
              {summary?.out_of_stock || 0}
              <em>{" "}{translate("warehouse.types")}</em>
            </strong>
          </span>
        </div>
      </div>
      <div className="catalog-layout">
        <aside className="panel category-sidebar">
          <h3>{translate("warehouse.material.categories")}</h3>
          <CategoryTree categories={categories} counts={stats.result?.category_counts} active selected={category} onSelect={setCategory} />
        </aside>
      <section className="panel products-panel">
        <div className="table-toolbar">
          <div className="filter-tabs">
            {[
              ["all", translate("warehouse.all.in.stock"), summary?.active || 0],
              ["warning", translate("warehouse.stock.alert"), lowCount],
              ["empty", translate("warehouse.out.of.stock"), summary?.out_of_stock || 0],
            ].map(([id, label, n]) => (
              <AntButton type="text" htmlType="button"
                key={id}
                className={filter === id ? "active" : ""}
                onClick={() => setFilter(id)}
              >
                {label}
                <span>{n}</span>
              </AntButton>
            ))}
          </div>
          <div className="table-search">
            <AntInput prefix={<Search size={16} />} allowClear
              aria-label={translate("warehouse.search.for.inventory.items")}
              placeholder={translate("warehouse.search.for.items.or.barcodes")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{translate("warehouse.material.information")}</th>
                <th>{translate("warehouse.classification")}</th>
                <th className="number-cell">{translate("warehouse.on.hand.inventory")}</th>
                <th className="number-cell">{translate("warehouse.safety.stock")}</th>
                <th>{translate("warehouse.stock.status")}</th>
                <th className="number-cell">{translate("warehouse.inventory.cost")}</th>
                <th className="number-cell">{translate("warehouse.operation")}</th>
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
                        <AntButton type="text" htmlType="button"
                          className="barcode-link"
                          onClick={() => showBarcode(p)}
                        >
                          {p.barcode}
                        </AntButton>
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
                  <td className="number-cell">{currencySymbol()} {costs ? money((p.inventory_value_cents ?? Math.round(p.cost * p.stock * 100)) / 100) : '—'}</td>
                  <td className="number-cell">
                    <div className="row-actions">
                      <AntButton type="text" htmlType="button"
                        className="text-button"
                        hidden={!can("purchase")} onClick={() => openOrder("in", p)}
                      >
                        <Plus size={14} />{translate("warehouse.restock")}</AntButton>
                      <AntButton type="text" htmlType="button" className="text-button" hidden={!can("stocktake")} onClick={() => increaseStock(p)}>
                        <Plus size={14} />{translate("warehouse.increase.stock.return")}</AntButton>
                      <AntButton type="text" danger htmlType="button"
                        className="text-button danger"
                        hidden={!can("stocktake")} onClick={() => reduceStock(p)}
                      >
                        <Minus size={14} />{translate("warehouse.reduce")}</AntButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && (
            <Empty
              title={translate("warehouse.there.are.currently.no.materials.that.meet.the.criteria")}
              description={translate("warehouse.adjust.your.filters.to.see.other.inventory")}
            />
          )}
        </div>
        <Pagination total={total} page={page} setPage={setPage} />
      </section>
      </div>
      <div className="page-hint">
        <ShieldCheck size={16} />{translate("warehouse.inventory.is.automatically.updated.with.document.confirmation.and.safety.stock.can")}</div>
    </>
  );
}

export { Inventory };
