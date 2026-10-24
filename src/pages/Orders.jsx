import { Button as AntButton, Input as AntInput } from '../ui/controls.jsx';

import { downloadFile } from '../app/download.js';
import { api } from '../api.js';
import { orderLabel } from '../order-utils.js';
import { orderLineAmount } from '../../shared/money.js';
import { todayKey, money, count, dateTime, currencySymbol } from '../app/format.js';
import { usePermissions } from '../permissions.jsx';
import { useState, useEffect } from 'react';
import { useQuery, queryPath } from '../queries.js';
import { QueryStatus, PageHeading, Button, Badge, Empty, Pagination } from '../components/common.jsx';
import { Download, Plus, PackageCheck, Search, ArrowDownLeft, ArrowUpRight, ChevronRight } from 'lucide-react';
import { Select } from '../Dropdown.jsx';
import { ProductionMaterialDocuments } from '../features/ProductionMaterialDocuments.jsx';
import { ProductionReceipts } from '../features/ProductionReceipts.jsx';

async function exportOrders(orders, notify) {
  try {
    const exported = await api('/orders/export');
    const ids = new Set(orders.map(o => o.id));
    orders = exported.filter(o => ids.has(o.id));
  } catch (error) { notify(error.message); return; }
  const cell = (s) =>
    '"' +
    String(s)
      .replaceAll('"', '""')
      .replace(/^[=+\-@]/, "'") +
    '"';
  const rows = [
    [
      "单据编号",
      "类型",
      "往来单位",
      "金额",
      "时间",
      "物料",
      "数量",
      "单价",
      "明细金额",
      "备注",
    ],
    ...orders.flatMap((o) =>
      o.items.map((i) => [
        o.number,
        orderLabel(o),
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
      `77ERP-单据-${todayKey()}.csv`,
      "text/csv;charset=utf-8",
    );
    notify("单据已导出为 CSV");
  } catch (error) { notify(error.message); }
}

function Orders({ page, data, openOrder, showDetail, notify, onChanged }) {
  const { can } = usePermissions();
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
    purchases: ["PURCHASES", "入库", "入库"],
    sales: ["SALES", "出库", "出库"],
    history: ["ACTIVITY", "操作记录", "操作记录"],
  };
  const [eyebrow, title, label] = titles[page];
  return (
    <>
      <QueryStatus query={list} />
      <PageHeading
        eyebrow={eyebrow}
        title={title}
        description={
          type === "in"
            ? "选择供应商或内部单位入库，确认后库存自动增加。内部流转不计入采购额。"
            : type === "out"
              ? "选择客户或内部单位出库，确认后库存自动扣减。内部流转不计入销售额。"
              : "查看全部入出库单据，追溯物料、数量和往来单位。"
        }
      >
        <Button
          icon={Download}
          permission="data_io"
          onClick={() => exportOrders(filtered, notify)}
          disabled={!filtered.length}
        >
          导出单据
        </Button>
        {type && (
          <Button permission={type === 'in' ? 'purchase' : 'sale'} kind="primary" icon={Plus} onClick={() => openOrder(type)}>
            新建{label.slice(-2)}
          </Button>
        )}
      </PageHeading>
      {type && <ProductionMaterialDocuments key={type} data={data} type={type} onChanged={onChanged} />}
      {type === 'in' && <ProductionReceipts data={data} onChanged={onChanged} />}
      <div className="order-summary">
        <div>
          <span>
            筛选内净额（不含作废、调拨及内部流转，扣除退货）
          </span>
          <strong>
            <small>{currencySymbol()} </small>
            {money(aggregate?.net_total || 0)}
          </strong>
        </div>
        <div>
          <span>有效单据</span>
          <strong>
            {aggregate?.active_count || 0}
            <small> 笔</small>
          </strong>
        </div>
        <div>
          <span>物料流转数量</span>
          <strong>
            {count(
              aggregate?.quantity || 0,
            )}
            <small> 件</small>
          </strong>
        </div>
        <div className="order-summary-note">
          <PackageCheck size={26} />
          <span>
            确认单据后更新库存
            <br />
            <small>支持查看物料明细与成交金额</small>
          </span>
        </div>
      </div>
      <section className="panel">
        <div className="table-toolbar">
          <div className="filter-tabs">
            {(type
              ? [[type, `全部${label}单`]]
              : [
                  ["all", "全部操作"],
                  ["in", "入库"],
                  ["out", "出库"],
                  ["transfer", "仓库调拨"],
                  ["internal", "内部流转"],
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
            <div className="table-search">
              <AntInput prefix={<Search size={16} />} allowClear
                aria-label="搜索单据"
                placeholder="搜索单号、单位或物料"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Select
              className="filter-select"
              aria-label="单据时间范围"
              value={days}
              onChange={(e) => setDays(e)}
            >
              <option value="all">全部时间</option>
              <option value="7">近 7 天</option>
              <option value="30">近 30 天</option>
            </Select>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table orders-table">
            <thead>
              <tr>
                <th>单据编号</th>
                <th>往来单位</th>
                <th>物料明细</th>
                <th className="number-cell">金额</th>
                <th>创建时间</th>
                <th>状态</th>
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
                        {o.item_count} 种物料 ·{" "}
                        {count(o.item_quantity)} 件
                      </small>
                    </div>
                  </td>
                  <td className="number-cell amount-cell">
                    {o.kind === "transfer" ? (
                      <span className="muted">不涉及金额</span>
                    ) : (
                      `${o.kind === "internal" ? "参考 " : ""}${currencySymbol()} ${money(o.total)}`
                    )}
                  </td>
                  <td className="muted">{dateTime(o.created_at)}</td>
                  <td>
                    <Badge>已完成</Badge>
                  </td>
                  <td>
                    <AntButton type="text" htmlType="button"
                      className="table-arrow"
                      aria-label={`查看单据 ${o.number}`}
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
              title="暂无符合条件的单据"
              description="调整搜索或日期范围，或开始创建单据。"
              action={
                type && (
                  <Button permission={type === 'in' ? 'purchase' : 'sale'} icon={Plus} onClick={() => openOrder(type)}>
                    新建单据
                  </Button>
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
