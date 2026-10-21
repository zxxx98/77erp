import { useState, useRef, useEffect, useId } from 'react';
import { FullscreenChart } from '../components/FullscreenChart.jsx';
import { InspectionPanel } from '../InspectionPanel.jsx';
import { sameDay, shortDate, money, count, dateTime } from '../app/format.js';
import { usePermissions } from '../permissions.jsx';
import { useQuery, queryPath } from '../queries.js';
import {
  Box,
  Warehouse,
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  Plus,
  ScanLine,
  Camera,
  Check,
  ArrowRight,
  ArrowDownToLine,
  ChevronRight,
  ArrowUpFromLine,
  ShieldCheck,
} from 'lucide-react';
import { Badge, QueryStatus, PageHeading, Button, Panel, Empty, ProductArt } from '../components/common.jsx';
import { orderLabel } from '../order-utils.js';

function TrendLegend() {
  return <div className="chart-legend">
    <span><i className="legend-dot blue" />销售金额</span>
    <span><i className="legend-dot pale" />采购金额</span>
  </div>;
}

function TrendChart({ orders, days, fullscreen = false }) {
  const gradientId = useId();
  const [hover, setHover] = useState(null);
  const chartRef = useRef();
  const [chartWidth, setChartWidth] = useState(720);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setChartWidth(Math.max(220, entry.contentRect.width)),
    );
    observer.observe(chartRef.current);
    return () => observer.disconnect();
  }, []);
  const series = Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - days + i + 1);
    return {
      date: d,
      in: orders
        .filter((o) => o.type === "in" && sameDay(o.created_at, d))
        .reduce((s, o) => s + o.total, 0),
      out: orders
        .filter((o) => o.type === "out" && sameDay(o.created_at, d))
        .reduce((s, o) => s + o.total, 0),
    };
  });
  const max = Math.max(...series.flatMap((d) => [d.in, d.out]), 1000);
  const cap = Math.ceil(max / 1000) * 1000;
  const floor = Math.floor(Math.min(0, ...series.flatMap(d => [d.in, d.out])) / 1000) * 1000;
  const W = fullscreen ? Math.max(chartWidth, days * 56) : chartWidth,
    H = fullscreen ? Math.max(280, Math.min(600, chartWidth * .55)) : chartWidth < 450 ? 160 : 178,
    L = 40,
    R = 14,
    T = 12,
    B = 29;
  const x = (i) => L + (i * (W - L - R)) / (days - 1),
    y = (v) => T + (1 - (v - floor) / (cap - floor)) * (H - T - B);
  const smooth = (points) => {
    let path = `M${points[0][0]},${points[0][1]}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1],
        p = points[i];
      const mid = (prev[0] + p[0]) / 2;
      path += ` C${mid},${prev[1]} ${mid},${p[1]} ${p[0]},${p[1]}`;
    }
    return path;
  };
  const out = smooth(series.map((d, i) => [x(i), y(d.out)])),
    incoming = smooth(series.map((d, i) => [x(i), y(d.in)]));
  const fractions =
    chartWidth < 450 ? [0, 1 / 3, 2 / 3, 1] : [0, 0.2, 0.4, 0.6, 0.8, 1];
  const labels = fullscreen ? series.map((_,i) => i) : Array.from(
    new Set(fractions.map((f) => Math.round((days - 1) * f))),
  );
  return (
    <div className="chart-wrap" ref={chartRef} style={{overflowX:fullscreen?'auto':undefined}}>
      <svg
        className="trend-chart"
        style={{ height: H, minWidth: fullscreen ? W : undefined }}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`最近 ${days} 天采购与销售金额趋势`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity=".13" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((n) => (
          <g key={n}>
            <line
              x1={L}
              x2={W - R}
              y1={y(floor + ((cap - floor) * n) / 4)}
              y2={y(floor + ((cap - floor) * n) / 4)}
              stroke="#edf0f5"
              strokeDasharray={n === 0 ? "0" : "3 4"}
            />
            <text
              x={L - 12}
              y={y(floor + ((cap - floor) * n) / 4) + 4}
              textAnchor="end"
              fill="#929aaa"
              fontSize="10"
            >
              {floor + ((cap - floor) * n) / 4 >= 1000
                ? `${(floor + ((cap - floor) * n) / 4 / 1000).toFixed(1)}k`
                : floor + ((cap - floor) * n) / 4}
            </text>
          </g>
        ))}
        <path
          d={`${out} L${x(days - 1)},${y(0)} L${x(0)},${y(0)} Z`}
          fill={`url(#${gradientId})`}
        />
        <path
          d={incoming}
          fill="none"
          stroke="#91b7ed"
          strokeWidth="2"
          strokeDasharray="5 5"
        />
        <path
          d={out}
          fill="none"
          stroke="#3478ee"
          strokeWidth="2.8"
          strokeLinecap="round"
        />
        {labels.map((i) => (
          <text
            key={i}
            className="trend-chart-x-label"
            x={x(i)}
            y={H - 7}
            fontSize="10"
            fill="#929aaa"
            textAnchor="middle"
          >
            {shortDate(series[i].date)}
          </text>
        ))}
        {series.map((d, i) => (
          <rect
            key={i}
            x={x(i) - (W - L - R) / (days - 1) / 2}
            y={T}
            width={(W - L - R) / (days - 1)}
            height={H - T - B}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
        {hover !== null && series[hover] && (
          <g pointerEvents="none">
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={T}
              y2={y(0)}
              stroke="#adc8ef"
              strokeDasharray="3 3"
            />
            <circle
              cx={x(hover)}
              cy={y(series[hover].out)}
              r="4"
              fill="#2563eb"
              stroke="white"
              strokeWidth="2"
            />
            <circle
              cx={x(hover)}
              cy={y(series[hover].in)}
              r="3.5"
              fill="#91b7ed"
              stroke="white"
              strokeWidth="2"
            />
          </g>
        )}
      </svg>
      {hover !== null && series[hover] && (
        <div
          className="chart-tooltip"
          style={{
            left: `${Math.min(76, Math.max(12, (hover / (days - 1)) * 100))}%`,
          }}
        >
          <strong>{shortDate(series[hover].date)}</strong>
          <span>
            <i className="legend-dot blue" />
            销售 ¥{money(series[hover].out)}
          </span>
          <span>
            <i className="legend-dot pale" />
            采购 ¥{money(series[hover].in)}
          </span>
        </div>
      )}
    </div>
  );
}

function Dashboard({ data, low, navigate, openOrder, showDetail }) {
  const { can, costs } = usePermissions();
  const [days, setDays] = useState(7),
    [orderTab, setOrderTab] = useState("all");
  const summaryQuery = useQuery(`/dashboard?days=${days}`, data);
  const recentQuery = useQuery(queryPath('/orders', { limit: 5, business: orderTab === 'all' ? null : orderTab }), data);
  const summary = summaryQuery.result;
  const reporting = (summary?.trend || []).flatMap(row => [
    { type: 'in', created_at: `${row.day}T12:00:00`, total: row.purchase_cents / 100 },
    { type: 'out', created_at: `${row.day}T12:00:00`, total: row.sales_cents / 100 },
  ]);
  const totalStock = summary?.products.stock || 0;
  const value = (summary?.products.inventory_value_cents || 0) / 100;
  const salesSum = (summary?.trend || []).reduce((sum, row) => sum + row.sales_cents / 100, 0);
  const filteredOrders = recentQuery.result?.orders || [];
  const warningCount = (summary?.products.low_stock || 0) + (summary?.products.out_of_stock || 0);
  const metrics = [
    {
      label: "物料总数",
      value: summary ? count(summary.products.total) : "—",
      unit: "种",
      icon: Box,
      tone: "blue",
      footer: (
        <>
          <span className="metric-info">在库物料</span>
          <strong>{count(totalStock)}</strong>
          <span className="metric-info">件</span>
        </>
      ),
    },
    {
      label: "库存总金额",
      value: costs ? money(value) : '—',
      prefix: "¥",
      icon: Warehouse,
      tone: "purple",
      footer: (
        <>
          <span className="metric-info">按采购成本统计</span>
          <span className="metric-tail">{data.settings.warehouse_name}</span>
        </>
      ),
    },
    {
      label: "今日采购",
      value: money((summary?.today.purchase_cents || 0) / 100),
      prefix: "¥",
      icon: ArrowDownLeft,
      tone: "green",
      footer: (
        <>
          <Badge tone="green" dot={false}>
            <ArrowDownLeft size={12} />
            {summary?.today.purchase_count || 0} 笔入库
          </Badge>
          <span className="metric-info">已完成</span>
        </>
      ),
    },
    {
      label: "今日销售",
      value: money((summary?.today.sales_cents || 0) / 100),
      prefix: "¥",
      icon: ArrowUpRight,
      tone: "orange",
      footer: (
        <>
          <Badge tone="blue" dot={false}>
            <ArrowUpRight size={12} />
            {summary?.today.sales_count || 0} 笔出库
          </Badge>
          <span className="metric-info">已完成</span>
        </>
      ),
    },
  ];
  return (
    <>
      <QueryStatus query={summaryQuery} /><QueryStatus query={recentQuery} />
      <PageHeading
        title="工作台"
        description="物料、库存及今日入出库数据概览。"
      >
        <span className="date-chip">
          <CalendarDays size={15} />
          {new Date().toLocaleDateString("zh-CN", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
          <span className="date-weekday">
            {new Date().toLocaleDateString("zh-CN", { weekday: "short" })}
          </span>
        </span>
        <Button permission="purchase" kind="primary" icon={Plus} onClick={() => openOrder("in")}>
          新建入库
        </Button>
      </PageHeading>
      <div className="metric-grid">
        {metrics.map((m) => (
          <section className="metric-card" key={m.label}>
            <div className="metric-top">
              <span>{m.label}</span>
              <span className={`metric-icon icon-${m.tone}`}>
                <m.icon size={18} />
              </span>
            </div>
            <div className="metric-value">
              {m.prefix && <span className="currency">{m.prefix}</span>}
              {m.value}
              {m.unit && <span className="metric-unit">{m.unit}</span>}
            </div>
            <div className="metric-footer">{m.footer}</div>
          </section>
        ))}
      </div>
      <InspectionPanel key={data.warehouse_id} data={data} />
      <div className="dashboard-middle">
        <Panel
          title="采购与销售趋势"
          subtitle="按日期统计采购与销售金额"
          className="trend-panel"
          extra={
            <div className="segmented small">
              <button
                className={days === 7 ? "active" : ""}
                onClick={() => setDays(7)}
              >
                近 7 天
              </button>
              <button
                className={days === 30 ? "active" : ""}
                onClick={() => setDays(30)}
              >
                近 30 天
              </button>
            </div>
          }
        >
          <div className="trend-summary">
            <span className="trend-amount">
              <span>¥</span>
              {money(salesSum)}
              <small>期间销售额</small>
            </span>
            <TrendLegend />
          </div>
          <FullscreenChart title={`最近 ${days} 天采购与销售金额趋势`}>{fullscreen => <>
            {fullscreen && <TrendLegend />}
            <TrendChart orders={reporting} days={days} fullscreen={fullscreen}/>
          </>}</FullscreenChart>
        </Panel>
        <section className="quick-panel">
          <div className="quick-panel-heading">
            <span className="quick-label">
              <ScanLine size={13} /> 快捷操作
            </span>
          </div>
          <div className="quick-hero">
            <div>
              <h2>手机扫码</h2>
              <p>使用手机摄像头查询物料及办理入出库。</p>
            </div>
            <div className="phone-scan-illustration" aria-hidden="true">
              <div className="phone-scan-frame">
                <Camera size={20} />
                <ScanLine size={36} />
              </div>
              <span className="phone-scan-check">
                <Check size={14} />
              </span>
            </div>
          </div>
          <button
            className="quick-scan-button"
            onClick={() => navigate("scanner")}
          >
            <ScanLine size={18} />
            打开扫码工作台
            <ArrowRight size={16} />
          </button>
          <div className="quick-action-row">
            <button hidden={!can("purchase")} onClick={() => openOrder("in")}>
              <span className="quick-action-icon green">
                <ArrowDownToLine size={17} />
              </span>
              采购入库
              <ChevronRight size={13} />
            </button>
            <i />
            <button hidden={!can("sale")} onClick={() => openOrder("out")}>
              <span className="quick-action-icon blue">
                <ArrowUpFromLine size={17} />
              </span>
              销售出库
              <ChevronRight size={13} />
            </button>
          </div>
        </section>
      </div>
      <div className="dashboard-bottom">
        <Panel
          title="最近单据"
          className="recent-panel"
          extra={
            <button className="text-button" onClick={() => navigate("history")}>
              查看全部
              <ArrowRight size={14} />
            </button>
          }
        >
          <div className="inline-tabs">
            {[
              ["all", "全部单据"],
              ["in", "采购入库"],
              ["out", "销售出库"],
            ].map(([id, name]) => (
              <button
                key={id}
                className={orderTab === id ? "active" : ""}
                onClick={() => setOrderTab(id)}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="table-scroll">
            <table className="data-table recent-table">
              <thead>
                <tr>
                  <th>单据信息</th>
                  <th>往来单位</th>
                  <th className="number-cell">金额</th>
                  <th>状态</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((o) => (
                  <tr
                    key={o.id}
                    onClick={() => showDetail(o)}
                    className="clickable-row"
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
                            <span>·</span>
                            {dateTime(o.created_at)}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>{o.partner}</td>
                    <td className="number-cell amount-cell">
                      {o.kind === "internal" ? "参考 ¥ " : "¥ "}{money(o.total)}
                    </td>
                    <td>
                      <Badge>已完成</Badge>
                    </td>
                    <td>
                      <button
                        className="table-arrow"
                        aria-label={`查看 ${o.number}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          showDetail(o);
                        }}
                      >
                        <ChevronRight size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filteredOrders.length && <Empty />}
          </div>
        </Panel>
        <Panel
          title="库存预警"
          className="warning-panel"
          extra={<span className="warning-counter">{warningCount} 件物料</span>}
        >
          <div className="warning-description">
            <span className="warning-dot" />
            当前库存低于或等于安全库存的物料。
          </div>
          <div className="warning-list">
            {low.length ? (
              low.slice(0, 4).map((p) => (
                <div className="warning-item" key={p.id}>
                  <ProductArt product={p} />
                  <div className="warning-item-info">
                    <strong>{p.name}</strong>
                    <small>
                      安全库存 {p.threshold} {p.unit}
                    </small>
                  </div>
                  <div className="warning-stock">
                    <strong
                      className={p.stock === 0 ? "red-text" : "orange-text"}
                    >
                      {p.stock}
                      <small> {p.unit}</small>
                    </strong>
                    <span>{p.stock === 0 ? "已缺货" : "库存偏低"}</span>
                  </div>
                  <button
                    className="restock-button"
                    hidden={!can("purchase")} onClick={() => openOrder("in", p)}
                    aria-label={`补货 ${p.name}`}
                  >
                    <Plus size={15} />
                  </button>
                </div>
              ))
            ) : (
              <Empty
                title="暂无库存预警"
                description="所有物料都在安全库存以上。"
              />
            )}
          </div>
          <button
            className="warning-all-button"
            onClick={() => navigate("inventory", "warning")}
          >
            查看库存预警
            <ArrowRight size={14} />
          </button>
          <div className="warning-bottom">
            <ShieldCheck size={13} />
            数据变更后会提示刷新
          </div>
        </Panel>
      </div>
    </>
  );
}

export { Dashboard };
