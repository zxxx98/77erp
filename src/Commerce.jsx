import React, { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { orderLabel } from "./Operations.jsx";
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
export function BusinessTools({ onResume, onRefresh }) {
  const [tab, setTab] = useState("contacts");
  return (
    <section className="operation-panel">
      <h3>往来、草稿与财务</h3>
      <div className="operation-tabs">
        {[
          ["contacts", "供应商与客户"],
          ["drafts", "单据草稿"],
          ["finance", "收付款与欠款"],
          ["profit", "成本与毛利"],
        ].map(([id, label]) => (
          <button
            type="button"
            key={id}
            className={`btn btn-${tab === id ? "primary" : "secondary"}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "contacts" && <Contacts onRefresh={onRefresh} />}
      {tab === "drafts" && <Drafts onResume={onResume} />}
      {tab === "finance" && <Finance />}
      {tab === "profit" && <Profit />}
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
    [form, setForm] = useState(empty),
    [query, setQuery] = useState("");
  const { busy, error, setError, run, send } = useBusiness();
  const load = async () => setContacts(await api("/contacts"));
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  return (
    <div>
      <p>
        同一类型下名称不可重复。编辑不改写历史单据名称；停用后不能再开新单。
      </p>
      <label>
        搜索往来单位
        <input value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="operation-scroll">
        {contacts
          .filter((c) => `${c.name} ${c.person} ${c.phone}`.includes(query))
          .map((c) => (
            <div className="operation-row" key={c.id}>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => setForm(c)}
              >
                {c.role === "supplier" ? "供应商" : "客户"} · {c.name}
                {!c.active ? "（已停用）" : ""}
              </button>
              <small>
                {c.person} {c.phone} {c.address}
              </small>
            </div>
          ))}
      </div>
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={() => setForm(empty)}
      >
        新增往来单位
      </button>
      <label>
        往来类型
        <select
          value={form.role}
          disabled={busy || !!form.id}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
        >
          <option value="supplier">供应商</option>
          <option value="customer">客户</option>
        </select>
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
export function Drafts({ onResume, type }) {
  const [drafts, setDrafts] = useState([]);
  const { busy, error, setError, run, send } = useBusiness();
  const load = async () => setDrafts(await api("/drafts"));
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  return (
    <div>
      <p>草稿保存在服务器，不影响库存；保存后可在网页或安卓继续。</p>
      {drafts
        .filter((d) => !type || d.type === type)
        .map((d) => (
          <div className="operation-row" key={d.id}>
            <p>
              {d.type === "in" ? "采购" : "销售"} ·{" "}
              {d.partner || "未填往来单位"} · {d.items.length} 种商品 ·{" "}
              {new Date(d.updated_at).toLocaleString()}
            </p>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => onResume(d)}
            >
              继续草稿 #{d.id}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (!window.confirm("确认删除此草稿？")) return;
                  await send(`/drafts/${d.id}/discard`, { version: d.version });
                  await load();
                })
              }
            >
              删除草稿 #{d.id}
            </button>
          </div>
        ))}
      {!drafts.length && <p>暂无草稿</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
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
            <select
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
            </select>
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
      <p>
        移动加权平均成本，销售时保存成本。旧库存以升级时采购价估算期初成本；旧单据成本未知，单独列出，不计入已知毛利。毛利不含运费、税费和经营费用；退货按退货日冲减，日期按
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
                  <th>商品</th>
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
