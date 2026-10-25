import { localizeError } from '../i18n/errors.js';
import { ExportLanguageSelect } from '../ExportLanguageSelect.jsx';
import { t as translate, getFormatLocale, getLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { Button as AntButton, Input as AntInput } from '../ui/controls.jsx';

import { downloadFile } from '../app/download.js';
import { api } from '../api.js';
import { orderLabel } from '../order-utils.js';
import { orderLineAmount } from '../../shared/money.js';
import { todayKey, money, count, dateTime, currencySymbol } from '../app/format.js';
import { useState, useEffect } from 'react';
import { useQuery, queryPath } from '../queries.js';
import { QueryStatus, PageHeading, Button, Badge, Empty, Pagination } from '../components/common.jsx';
import { Download, Plus, PackageCheck, Search, ArrowDownLeft, ArrowUpRight, ChevronRight } from 'lucide-react';
import { Select } from '../Dropdown.jsx';
import { OrderApprovalWorkspace } from '../features/OrderApprovalWorkspace.jsx';

async function exportOrders(orders, notify, language = getLocale()) {
  const exportText = (key, params) => translate(key, { ...params, lng: language });
  try {
    const exported = await api('/orders/export');
    const ids = new Set(orders.map(o => o.id));
    orders = exported.filter(o => ids.has(o.id));
  } catch (error) { notify(localizeError(error.message)); return; }
  const cell = (s) =>
    '"' +
    String(s)
      .replaceAll('"', '""')
      .replace(/^[=+\-@]/, "'") +
    '"';
  const rows = [
    [
      exportText("warehouse.document.number"),
      exportText("warehouse.type"),
      exportText("warehouse.business.partner"),
      exportText("warehouse.amount"),
      exportText("warehouse.time"),
      exportText("warehouse.material"),
      exportText("warehouse.quantity"),
      exportText("warehouse.unit.price"),
      exportText("warehouse.detailed.amount"),
      exportText("warehouse.remarks"),
    ],
    ...orders.flatMap((o) =>
      o.items.map((i) => [
        o.number,
        orderLabel(o, language),
        o.partner,
        o.total,
        o.created_at,
        i.name,
        i.quantity,
        i.price,
        (orderLineAmount(i) / 100).toFixed(2),
        o.note,
      ]),
    ),
  ];
  try {
    await downloadFile(
      "\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n"),
      exportText("warehouse.77erp.document.csv", { v0: todayKey() }),
      "text/csv;charset=utf-8",
    );
    notify(translate("warehouse.document.exported.to.csv"));
  } catch (error) { notify(localizeError(error.message)); }
}

function Orders(props) {
  useLocale();
  const { page, data, openOrder, onChanged } = props;
  const type = page === 'purchases' ? 'in' : page === 'sales' ? 'out' : null;
  const title = type === 'in' ? translate("warehouse.stock.in") : type === 'out' ? translate("warehouse.stock.out") : translate("warehouse.activity.history");
  return <>
    <PageHeading title={title} description={type === 'in' ? translate("warehouse.check.the.warehousing.records.and.check.the.documents.to.be.stored") : type === 'out' ? translate("warehouse.check.outbound.records.and.verify.production.picking.and.replenishment.applications") : translate("warehouse.view.all.inbound.and.outbound.documents.and.trace.materials.quantities.and")}>
      {type && <Button permission={type === 'in' ? 'purchase' : 'sale'} kind="primary" icon={Plus} onClick={() => openOrder(type)}>{translate("warehouse.new")}{title}</Button>}
    </PageHeading>
    <OrderApprovalWorkspace key={`${data.warehouse_id}:${page}`} data={data} type={type} onChanged={onChanged}>
      <OrderRecords {...props} />
    </OrderApprovalWorkspace>
  </>;
}

function OrderRecords({ page, data, openOrder, showDetail, notify }) {
  useLocale();
  const [exportLanguage, setExportLanguage] = useState('');
  const type = page === "purchases" ? "in" : page === "sales" ? "out" : null;
  const [query, setQuery] = useState(""),
    [days, setDays] = useState("all"),
    [pageNum, setPageNum] = useState(1),
    [tab, setTab] = useState("all");
  useEffect(() => {
    setPageNum(1);
    setQuery("");
    setTab("all");
  }, [page]);
  useEffect(() => setPageNum(1), [query, days, tab]);
  const direction = type || tab;
  const list = useQuery(queryPath('/orders', { limit: 8, offset: (pageNum - 1) * 8, q: query,
    business: ['in', 'out'].includes(direction) ? direction : null, kind: ['transfer', 'internal'].includes(direction) ? direction : null,
    from: days === 'all' ? null : new Date(Date.now() - Number(days) * 86400000).toISOString().slice(0, 10),
  }), data, query ? 250 : 0);
  const filtered = list.result?.orders || [];
  const total = list.result?.total || 0;
  const aggregate = list.result?.aggregate;
  useEffect(() => { if (list.result) setPageNum(p => Math.min(p, Math.max(1, Math.ceil(total / 8)))); }, [list.result, total]);
  const titles = {
    purchases: ["PURCHASES", translate("warehouse.stock.in"), translate("warehouse.stock.in")],
    sales: ["SALES", translate("warehouse.stock.out"), translate("warehouse.stock.out")],
    history: ["ACTIVITY", translate("warehouse.activity.history"), translate("warehouse.activity.history")],
  };
  const [, , label] = titles[page];
  return (
    <>
      <QueryStatus query={list} />
      <div className="order-summary">
        <div>
          <span>{translate("warehouse.net.amount.within.the.screen.excluding.voiding.transfers.and.internal.transfers")}</span>
          <strong>
            <small>{currencySymbol()} </small>
            {money(aggregate?.net_total || 0)}
          </strong>
        </div>
        <div>
          <span>{translate("warehouse.valid.documents")}</span>
          <strong>
            {aggregate?.active_count || 0}
            <small>{" "}{translate("warehouse.transactions")}</small>
          </strong>
        </div>
        <div>
          <span>{translate("warehouse.material.circulation.quantity")}</span>
          <strong>
            {count(
              aggregate?.quantity || 0,
            )}
            <small>{" "}{translate("warehouse.items")}</small>
          </strong>
        </div>
        <div className="order-summary-note">
          <PackageCheck size={26} />
          <span>{translate("warehouse.update.inventory.after.confirming.documents")}<br />
            <small>{translate("warehouse.support.viewing.material.details.and.transaction.amounts")}</small>
          </span>
        </div>
      </div>
      <section className="panel">
        <div className="table-toolbar">
          <div className="filter-tabs">
            {(type
              ? [[type, translate("warehouse.all.orders", { v0: label })]]
              : [
                  ["all", translate("warehouse.all.operations")],
                  ["in", translate("warehouse.stock.in")],
                  ["out", translate("warehouse.stock.out")],
                  ["transfer", translate("warehouse.warehouse.transfer")],
                  ["internal", translate("warehouse.internal.movement")],
                ]
            ).map(([id, name]) => (
              <AntButton type="text" htmlType="button"
                key={id}
                className={type || tab === id ? "active" : ""}
                onClick={() => setTab(id)}
              >
                {name}
                <span>
                  {type ? total : list.result?.counts?.[`${id}_count`] || 0}
                </span>
              </AntButton>
            ))}
          </div>
          <div className="toolbar-right">
            <ExportLanguageSelect value={exportLanguage} onChange={setExportLanguage} /><Button icon={Download} permission="data_io" onClick={() => exportOrders(filtered, notify, exportLanguage || getLocale())} disabled={!filtered.length}>{translate("warehouse.export.documents")}</Button>
            <div className="table-search">
              <AntInput prefix={<Search size={16} />} allowClear
                aria-label={translate("warehouse.search.documents")}
                placeholder={translate("warehouse.search.for.order.number.unit.or.material")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Select
              className="filter-select"
              aria-label={translate("warehouse.document.time.range")}
              value={days}
              onChange={(e) => setDays(e)}
            >
              <option value="all">{translate("warehouse.all.time")}</option>
              <option value="7">{translate("warehouse.last.7.days")}</option>
              <option value="30">{translate("warehouse.last.30.days")}</option>
            </Select>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table orders-table">
            <thead>
              <tr>
                <th>{translate("warehouse.document.number")}</th>
                <th>{translate("warehouse.business.partner")}</th>
                <th>{translate("warehouse.material.details")}</th>
                <th className="number-cell">{translate("warehouse.amount")}</th>
                <th>{translate("warehouse.creation.time")}</th>
                <th>{translate("warehouse.status")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr
                  key={o.id}
                  className="clickable-row"
                  onClick={() => showDetail(o)}
                >
                  <td>
                    <div className="order-info">
                      <span
                        className={`order-icon ${o.type === "in" ? "green" : "blue"}`}
                      >
                        {o.type === "in" ? (
                          <ArrowDownLeft size={17} />
                        ) : (
                          <ArrowUpRight size={17} />
                        )}
                      </span>
                      <div>
                        <strong className="order-number">{o.number}</strong>
                        <small>
                          {orderLabel(o)}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td>{o.partner}</td>
                  <td>
                    <div className="order-item-preview">
                      <strong>{o.item_names?.[0]}</strong>
                      <small>
                        {o.item_count}{" "}{translate("warehouse.material.2")}{" "}
                        {count(o.item_quantity)}{translate("warehouse.items")}</small>
                    </div>
                  </td>
                  <td className="number-cell amount-cell">
                    {o.kind === "transfer" ? (
                      <span className="muted">{translate("warehouse.no.financial.amount")}</span>
                    ) : (
                      `${o.kind === "internal" ? translate("warehouse.reference.2") : ""}${currencySymbol()} ${money(o.total)}`
                    )}
                  </td>
                  <td className="muted">{dateTime(o.created_at)}</td>
                  <td>
                    <Badge>{translate("warehouse.completed")}</Badge>
                  </td>
                  <td>
                    <AntButton type="text" htmlType="button"
                      className="table-arrow"
                      aria-label={translate("warehouse.view.document", { v0: o.number })}
                      onClick={(e) => {
                        e.stopPropagation();
                        showDetail(o);
                      }}
                    >
                      <ChevronRight size={16} />
                    </AntButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && (
            <Empty
              title={translate("warehouse.there.are.currently.no.documents.that.meet.the.criteria")}
              description={translate("warehouse.adjust.the.search.or.date.range.or.start.creating.a.document")}
              action={
                type && (
                  <Button permission={type === 'in' ? 'purchase' : 'sale'} icon={Plus} onClick={() => openOrder(type)}>{translate("warehouse.create.new.document")}</Button>
                )
              }
            />
          )}
        </div>
        <Pagination
          total={total}
          page={pageNum}
          setPage={setPageNum}
        />
      </section>
    </>
  );
}

export { Orders };
