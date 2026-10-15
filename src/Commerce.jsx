import { LoadingIndicator, LoadingStatus } from './Loading.jsx';
import { Select, ContactPicker } from "./Dropdown.jsx";
export { ContactPicker } from "./Dropdown.jsx";
import { usePermissions } from './permissions.jsx';
import React, { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Clock3, FilePenLine, Package, Trash2, UserRound } from "lucide-react";
import { api } from "./api.js";
import { orderLabel, Stocktake, ProductImport } from "./Operations.jsx";
import "./commerce.css";
import { MultiStocktake } from './MultiStocktake.jsx';
const money = (n) => `¥ ${(n / 100).toFixed(2)}`;
export const paymentLabel = {
  unverified: "待核对",
  unpaid: "未收付",
  partial: "部分收付",
  paid: "已结清",
  void: "已作废",
};
export function useBusiness() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    key = useRef({});
  const run = async (fn) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const send = async (path, body) => {
    const fingerprint = JSON.stringify([path, body]);
    if (key.current.fingerprint !== fingerprint)
      key.current = {
        fingerprint,
        id: Array.from(crypto.getRandomValues(new Uint32Array(4)), (x) =>
          x.toString(16),
        ).join("-"),
      };
    const id = key.current.id;
    const result = await api(path, {
      method: "POST",
      body: { ...body, request_id: id },
    });
    if (key.current.id === id) key.current = {};
    return result;
  };
  return { busy, error, setError, run, send };
}
export function BusinessTools({ products = [], warehouses = [], warehouseId, onSaved, onUse, onRefresh, initialTab }) {
  const { can, manage } = usePermissions();
  const available = [
    ...(can('business') ? [['contacts', '供应商与客户']] : []),
    ['templates', '单据模板'],
    ...(can('finance') ? [['finance', '收付款与欠款'], ['profit', '成本与毛利']] : []),
    ...(can('stocktake') ? [['stocktake', '库存盘点'], ['multi-stocktake', '多仓库盘点']] : []),
    ...(manage('data_io') ? [['import', '批量导入']] : []),
  ];
  const [tab, setTab] = useState(initialTab || available[0][0]);
  const active = available.some(([id]) => id === tab) ? tab : available[0][0];
  return (
    <section className="operation-panel">
      <div className="operation-tabs" aria-label="业务分类">
        {available.map(([id, label]) => (
          <button type="button" key={id} aria-pressed={active === id}
            className={`btn btn-${active === id ? 'primary' : 'secondary'}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {active === 'contacts' && <Contacts onRefresh={onRefresh} />}
      {active === 'templates' && <Templates onUse={onUse} />}
      {active === 'finance' && <Finance />}
      {active === 'profit' && <Profit />}
      {can('stocktake') && <div hidden={active !== 'stocktake'}><Stocktake products={products} onSaved={onSaved} /></div>}
      {can('stocktake') && <div hidden={active !== 'multi-stocktake'}><MultiStocktake key={warehouseId} warehouses={warehouses} warehouseId={warehouseId} active={active === 'multi-stocktake'} /></div>}
      {manage('data_io') && <div hidden={active !== 'import'}><ProductImport onSaved={onSaved} /></div>}
    </section>
  );
}
function Contacts({ onRefresh }) {
  const empty = {
    role: "supplier",
    name: "",
    person: "",
    phone: "",
    address: "",
    note: "",
    active: 1,
  };
  const [contacts, setContacts] = useState([]),
    [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(true);
  const { busy, error, setError, run, send } = useBusiness();
  const load = async () => setContacts(await api("/contacts"));
  useEffect(() => {
    load().catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);
  return (
    <div>
      {busy && <p><LoadingStatus>正在保存往来单位…</LoadingStatus></p>}
      <p>
        同一类型下名称不可重复。编辑不改写历史单据名称；停用后不能再开新单。
      </p>
      <ContactPicker contacts={contacts} value={form.id ? form.name : ""} selectedId={form.id}
        label="搜索往来单位" loading={loading} disabled={busy} onSelect={setForm} />
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={() => { setForm(empty); }}
      >
        新增往来单位
      </button>
      <label>
        往来类型
        <Select
          value={form.role}
          disabled={busy || !!form.id}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
        >
          <option value="supplier">供应商</option>
          <option value="customer">客户</option>
        </Select>
      </label>
      {[
        ["name", "单位名称", 100],
        ["person", "联系人", 100],
        ["phone", "联系电话", 50],
        ["address", "地址", 300],
        ["note", "往来备注", 500],
      ].map(([key, label, max]) => (
        <label key={key}>
          {label}
          <input
            value={form[key]}
            maxLength={max}
            disabled={busy}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          />
        </label>
      ))}
      <label>
        <input
          type="checkbox"
          checked={!!form.active}
          disabled={busy}
          onChange={(e) =>
            setForm({ ...form, active: e.target.checked ? 1 : 0 })
          }
        />
        启用此往来单位
      </label>
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        onClick={() =>
          run(async () => {
            await send("/contacts", form);
            setForm(empty);
            await load();
            await onRefresh?.();
          })
        }
      >
        保存往来单位
      </button>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
}
export function Templates({ onUse, type, collapsible = false, disabled = false, activeId, refreshKey = 0 }) {
  const { can, templates: manageTemplates } = usePermissions();
  const [templates, setTemplates] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const listId = useId();
  const trigger = useRef(null);
  const { busy, error, setError, run, send } = useBusiness();
  const load = async () => {
    setLoading(true);
    try {
      setTemplates(await api("/templates"));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [refreshKey]);
  const visibleTemplates = templates.filter((d) => !type || d.type === type);
  const header = <>
    <span className="template-heading-icon"><FilePenLine size={20} aria-hidden="true" /></span>
    <span className="template-heading-copy">
      <strong>{collapsible ? "选择单据模板" : "单据模板"}</strong>
      <span>{collapsible ? "套用常用物料组合，快速开单" : "保存常用开单内容，可反复套用"}</span>
    </span>
    {!loading && !error && <span className="template-count">{visibleTemplates.length} 份</span>}
  </>;
  return (
    <section className={`template-panel${collapsible ? " template-picker" : ""}`}>
      {collapsible ? <button
        ref={trigger}
        type="button"
        className="template-trigger"
        aria-label="选择单据模板"
        aria-expanded={expanded}
        aria-controls={listId}
        disabled={disabled || busy}
        onClick={() => setExpanded(!expanded)}
      >{header}<ChevronDown className="template-chevron" size={18} aria-hidden="true" /></button>
        : <div className="template-heading">{header}</div>}
      <div id={listId} className="template-content" hidden={collapsible && !expanded}>
        {collapsible && <p className="template-hint">套用后可修改本次单据，提交后模板仍会保留。</p>}
        {(loading || busy) && <div className="template-empty" role="status"><LoadingIndicator size={24} /><span>{loading ? "正在加载模板…" : "正在处理模板…"}</span></div>}
        {!loading && !error && !visibleTemplates.length && <div className="template-empty">
          <FilePenLine size={28} aria-hidden="true" />
          <strong>暂无模板</strong>
          <span>{type ? `当前仓库还没有${type === "in" ? "采购" : "销售"}模板` : "在开单页面保存常用物料组合，即可在这里套用"}</span>
        </div>}
        <div className="template-list" aria-busy={loading}>
          {visibleTemplates.map((d) => (
            <article className={`template-card${d.id === activeId ? " is-active" : ""}`} key={d.id}>
              <div className="template-card-top">
                <span className={`template-type template-type-${d.type}`}>{d.type === "in" ? "采购入库" : "销售出库"}</span>
                <span className="template-number">#{d.id}</span>
                {d.id === activeId && <span className="template-active">本次已套用</span>}
              </div>
              <h4>{d.name}</h4>
              <p className="template-partner">{d.partner || "未指定往来单位"}</p>
              <div className="template-meta">
                <span><Package size={14} aria-hidden="true" />{d.items.length} 种物料</span>
                <span><UserRound size={14} aria-hidden="true" />{d.created_by_name || "操作人未知"}</span>
                <span><Clock3 size={14} aria-hidden="true" /><time dateTime={d.updated_at}>{new Date(d.updated_at).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</time></span>
              </div>
              {d.note && <p className="template-note" title={d.note}>{d.note}</p>}
              <div className="template-actions">
                <button
                  type="button"
                  className="btn btn-secondary template-resume"
                  aria-label={`使用模板 #${d.id}`}
                  disabled={busy || disabled || loading || !can(d.type === 'in' ? 'purchase' : 'sale')}
                  onClick={() => {
                    if (onUse(d) !== false && collapsible) {
                      setExpanded(false);
                      trigger.current?.focus();
                    }
                  }}
                >
                  使用模板 <ArrowRight size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="template-delete"
                  hidden={!manageTemplates}
                  aria-label={`删除模板 #${d.id}`}
                  title="删除模板"
                  disabled={busy || disabled || loading}
                  onClick={() =>
                    run(async () => {
                      if (!window.confirm("确认删除此模板？")) return;
                      await send(`/templates/${d.id}/delete`, { version: d.version });
                      await load();
                    })
                  }
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            </article>
          ))}
        </div>
        {error && (
          <div className="template-error">
            <p role="alert" className="form-error">{error}</p>
            <button type="button" className="btn btn-secondary" disabled={busy || disabled} onClick={() => run(load)}>重新加载</button>
          </div>
        )}
      </div>
    </section>
  );
}
export function Payments({ order, onChanged }) {
  const [data, setData] = useState(null),
    [amount, setAmount] = useState(""),
    [method, setMethod] = useState("银行转账"),
    [note, setNote] = useState("");
  const { busy, error, setError, run, send } = useBusiness();
  const load = async () => setData(await api(`/orders/${order.id}/payments`));
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [order.id]);
  const changed = async () => {
    await load();
    await onChanged?.();
  };
  return (
    <section className="operation-panel">
      <h3>收付款记录</h3>
      {!data && !busy && !error && <p><LoadingStatus>正在读取收付款记录…</LoadingStatus></p>}
      {busy && <p><LoadingStatus>正在保存收付款…</LoadingStatus></p>}
      {data && (
        <>
          <p>
            {data.direction === "receive" ? "应收" : "应付"}{" "}
            {money(Math.round(data.total * 100))} · 已登记{" "}
            {money(data.paid_cents)} · {paymentLabel[data.payment_status]}
            {data.payment_status !== "unverified" &&
              ` · 待${data.direction === "receive" ? "收" : "付"} ${money(data.due_cents)}`}
          </p>
          {order.status !== "void" &&
            (data.payment_status === "unverified" || data.due_cents > 0) && (
              <>
                <label>
                  {data.payment_status === "unverified"
                    ? "历史已收付金额"
                    : "本次收付款金额"}
                  <input
                    aria-label="收付款金额"
                    type="number"
                    min="0"
                    step="0.01"
                    value={amount}
                    disabled={busy}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <label>
                  收付款方式
                  <input
                    value={method}
                    maxLength={50}
                    disabled={busy}
                    onChange={(e) => setMethod(e.target.value)}
                  />
                </label>
                <label>
                  收付款说明
                  <input
                    value={note}
                    maxLength={500}
                    disabled={busy}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      if (!/^\d+(\.\d{1,2})?$/.test(amount))
                        throw new Error("请填写有效金额，最多两位小数。");
                      if (
                        !window.confirm(
                          data.payment_status === "unverified"
                            ? "确认历史已收付金额，并将此单据纳入欠款统计？"
                            : "确认登记此次收付款？只记录实际已发生的资金收付。",
                        )
                      )
                        return;
                      await send(
                        `/orders/${order.id}/${data.payment_status === "unverified" ? "settlement" : "payments"}`,
                        data.payment_status === "unverified"
                          ? {
                              paid: Number(amount),
                              note,
                              confirmation: "TRACK_SETTLEMENT",
                            }
                          : { amount: Number(amount), method, note },
                      );
                      setAmount("");
                      await changed();
                    })
                  }
                >
                  {data.payment_status === "unverified"
                    ? "确认历史收付"
                    : "登记收付款"}
                </button>
              </>
            )}
          <p>
            登记只记录资金流水；退货单单独登记退款，不自动冲抵原单欠款。撤销登记不代表实际退款。
          </p>
          {data.entries.map((p) => (
            <div className="operation-row" key={p.id}>
              <p>
                {money(p.amount_cents)} · {p.method} · {p.note} ·{" "}
                {new Date(p.created_at).toLocaleString()}{" "}
                {p.reversed_at ? `已撤销：${p.reverse_reason}` : ""}
              </p>
              {!p.reversed_at && (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const reason = window.prompt(
                        "撤销收付款登记的原因（不执行实际退款）",
                      );
                      if (reason === null) return;
                      await send(`/payments/${p.id}/reverse`, { reason });
                      await changed();
                    })
                  }
                >
                  撤销登记 #{p.id}
                </button>
              )}
            </div>
          ))}
        </>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  );
}
function Finance() {
  const [data, setData] = useState(null),
    [selected, setSelected] = useState(null);
  const { error, setError } = useBusiness();
  const load = async () => setData(await api("/finance"));
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  return (
    <div>
      <p>
        欠款按原单和退货单分别登记；历史待核对单据暂不计入。金额为业务应收应付，不是银行余额。
      </p>
      {!data && !error && <p><LoadingStatus>正在读取财务数据…</LoadingStatus></p>}
      {data && (
        <>
          <div className="operation-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>往来单位</th>
                  <th>应收未收</th>
                  <th>应付未付</th>
                  <th>待核对单据</th>
                </tr>
              </thead>
              <tbody>
                {data.balances.map((b, i) => (
                  <tr key={i}>
                    <td>{b.name}</td>
                    <td>{money(b.receivable_cents)}</td>
                    <td>{money(b.payable_cents)}</td>
                    <td>{b.unverified}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label>
            选择收付款单据
            <Select
              value={selected?.id || ""}
              onChange={(e) =>
                setSelected(
                  data.orders.find((o) => o.id === Number(e.target.value)) ||
                    null,
                )
              }
            >
              <option value="">请选择</option>
              {data.orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.number} · {orderLabel(o)} · {o.partner} ·{" "}
                  {paymentLabel[o.payment_status]}
                </option>
              ))}
            </Select>
          </label>
          {selected && (
            <Payments key={selected.id} order={selected} onChanged={load} />
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
function Profit() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today.slice(0, 7) + "-01"),
    [to, setTo] = useState(today),
    [data, setData] = useState(null);
  const { busy, error, run } = useBusiness();
  const load = () =>
    run(async () =>
      setData(await api(`/reports/profit?from=${from}&to=${to}`)),
    );
  useEffect(() => {
    void load();
  }, []);
  return (
    <div>
      {busy && <p><LoadingStatus>正在读取毛利报表…</LoadingStatus></p>}
      <p>
        移动加权平均成本，销售时保存成本。旧库存以升级时参考采购价估算期初成本；旧单据成本未知，单独列出，不计入已知毛利。毛利不含运费、税费和经营费用；退货按退货日冲减，日期按
        UTC。
      </p>
      <label>
        开始日期
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </label>
      <label>
        结束日期
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </label>
      <button type="button" className="btn" disabled={busy} onClick={load}>
        查询毛利
      </button>
      {data && (
        <>
          <p>
            销售净额 {money(data.totals.revenue_cents)} · 已知销售成本{" "}
            {money(data.totals.cost_cents)} · 已知毛利{" "}
            {money(data.totals.gross_profit_cents)} · 成本未知净额{" "}
            {money(data.totals.unknown_revenue_cents)}（
            {data.totals.unknown_lines} 条）
          </p>
          <p>当前库存成本 {money(data.inventory_value_cents)}</p>
          <div className="operation-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>物料</th>
                  <th>净销量</th>
                  <th>销售净额</th>
                  <th>已知成本</th>
                  <th>已知毛利</th>
                  <th>已知毛利率</th>
                  <th>成本未知条数</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.product_id}>
                    <td>{r.name}</td>
                    <td>{r.quantity}</td>
                    <td>{money(r.revenue_cents)}</td>
                    <td>{money(r.cost_cents)}</td>
                    <td>{money(r.gross_profit_cents)}</td>
                    <td>
                      {r.margin === null
                        ? "—"
                        : `${(r.margin * 100).toFixed(2)}%`}
                    </td>
                    <td>{r.unknown_lines}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
}
