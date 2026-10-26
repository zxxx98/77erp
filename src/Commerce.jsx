import { localizeError } from './i18n/errors.js';
import { t as translate, getFormatLocale } from './i18n/index.js';
import { useLocale } from './i18n/react.jsx';
import { currencySymbol, money as formatMoney } from './app/format.js';
import { FormField } from './ui/FormField.jsx';
import { Button as AntButton, Input as AntInput, Checkbox as AntCheckbox } from './ui/controls.jsx';

import { useBusiness } from './business-api.js';
export { useBusiness } from './business-api.js';
import { LoadingIndicator, LoadingStatus } from './Loading.jsx';
import { Select, ContactPicker } from "./Dropdown.jsx";
export { ContactPicker } from "./Dropdown.jsx";
import { usePermissions } from './permissions.jsx';
import React, { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Clock3, FilePenLine, Package, Trash2, UserRound } from "lucide-react";
import { api } from "./api.js";
import { Stocktake, ProductImport, ProductExport, Transfer } from './Operations.jsx';
import { orderLabel } from './order-utils.js';
import "./commerce.css";
import { MultiStocktake } from './MultiStocktake.jsx';
const money = (n) => `${currencySymbol()}${formatMoney(n / 100)}`;
export const paymentLabel = {
  get unverified() { return translate("warehouse.to.verify"); },
  get unpaid() { return translate("warehouse.unpaid"); },
  get partial() { return translate("warehouse.partially.paid"); },
  get paid() { return translate("warehouse.settled"); },
  get void() { return translate("warehouse.voided"); },
};
export function BusinessTools({ data, warehouses = [], warehouseId, onSaved, onUse, onRefresh, initialTab }) {
  useLocale();
  const { can, manage } = usePermissions();
  const available = [
    ...(can('business') ? [['contacts', translate("warehouse.business.partner")]] : []),
    ...(can('basic_view') || can('business') ? [['templates', translate("warehouse.document.template")]] : []),
    ...(can('finance') ? [['finance', translate("warehouse.payments.and.balances")], ['profit', translate("warehouse.cost.and.gross.profit")]] : []),
    ...(can('transfer') ? [['transfer', translate("warehouse.warehouse.transfer")]] : []),
    ...(can('stocktake') ? [['stocktake', translate("warehouse.stocktake")], ['multi-stocktake', translate("warehouse.multi.warehouse.stocktake")]] : []),
    ...(manage('data_io') ? [['import', translate("warehouse.batch.import")], ['export', translate("warehouse.batch.export")]] : []),
  ];
  const [tab, setTab] = useState(initialTab || available[0]?.[0]);
  const active = available.some(([id]) => id === tab) ? tab : available[0]?.[0];
  const [visited, setVisited] = useState(() => new Set([tab]));
  return (
    <section className="operation-panel">
      <div className="operation-tabs" aria-label={translate("warehouse.business.classification")}>
        {available.map(([id, label]) => (
          <AntButton type="primary" htmlType="button" key={id} aria-pressed={active === id}
            className={`btn btn-${active === id ? 'primary' : 'secondary'}`} onClick={() => { setTab(id); setVisited(current => new Set([...current, id])); }}>{label}</AntButton>
        ))}
      </div>
      {active === 'contacts' && <Contacts onRefresh={onRefresh} />}
      {active === 'templates' && <Templates onUse={onUse} />}
      {active === 'finance' && <Finance />}
      {active === 'profit' && <Profit />}
      {can('stocktake') && (active === 'stocktake' || visited.has('stocktake')) && <div hidden={active !== 'stocktake'}><Stocktake data={data} onSaved={onSaved} /></div>}
      {can('transfer') && (active === 'transfer' || visited.has('transfer')) && <div hidden={active !== 'transfer'}><Transfer data={data} warehouses={warehouses} warehouseId={warehouseId} onSaved={onSaved} /></div>}
      {can('stocktake') && <div hidden={active !== 'multi-stocktake'}><MultiStocktake key={warehouseId} warehouses={warehouses} warehouseId={warehouseId} active={active === 'multi-stocktake'} /></div>}
      {manage('data_io') && <div hidden={active !== 'import'}><ProductImport onSaved={onSaved} /></div>}
      {manage('data_io') && <div hidden={active !== 'export'}><ProductExport warehouses={warehouses} warehouseId={warehouseId} /></div>}
    </section>
  );
}
function Contacts({ onRefresh }) {
  useLocale();
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
    load().catch((e) => setError(localizeError(e.message))).finally(() => setLoading(false));
  }, []);
  return (
    <div>
      {busy && <p><LoadingStatus>{translate("warehouse.saving.correspondence.units")}</LoadingStatus></p>}
      <p>{translate("warehouse.names.cannot.be.repeated.under.the.same.type.editing.does.not")}</p>
      <ContactPicker contacts={contacts} value={form.id ? form.name : ""} selectedId={form.id}
        label={translate("warehouse.search.for.entities.you.are.dealing.with")} searchable loading={loading} disabled={busy} onSelect={setForm} />
      <AntButton type="default"
        htmlType="button"
        className="btn"
        disabled={busy}
        onClick={() => { setForm(empty); }}
      >{translate("warehouse.add.new.contact.units")}</AntButton>
      <label>{translate("warehouse.type.of.transaction")}<Select
          aria-label={translate("warehouse.type.of.transaction")}
          value={form.role}
          disabled={busy || !!form.id}
          onChange={(e) => setForm({ ...form, role: e })}
        >
          <option value="supplier">{translate("warehouse.supplier")}</option>
          <option value="customer">{translate("warehouse.customer")}</option>
          <option value="internal">{translate("warehouse.internal.unit")}</option>
        </Select>
      </label>
      {[
        ["name", translate("warehouse.unit.name"), 100],
        ["person", translate("warehouse.contact.person"), 100],
        ["phone", translate("warehouse.contact.number"), 50],
        ["address", translate("warehouse.address"), 300],
        ["note", translate("warehouse.remarks.on.correspondence"), 500],
      ].map(([key, label, max]) => (
        <label key={key}>
          {label}
          <AntInput
            value={form[key]}
            maxLength={max}
            disabled={busy}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          />
        </label>
      ))}
      <AntCheckbox  checked={!!form.active} disabled={busy} onChange={(e) =>
            setForm({ ...form, active: e.target.checked ? 1 : 0 })
          }>{translate("warehouse.activate.this.correspondent")}</AntCheckbox>
      <AntButton type="primary"
        htmlType="button"
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
      >{translate("warehouse.save.correspondence.units")}</AntButton>
      {form.id && <AntButton type="default" danger htmlType="button" className="btn btn-danger" disabled={busy} onClick={() => {
        if (!window.confirm(translate("warehouse.are.you.sure.you.want.to.delete.it.cannot.be.restored", { v0: form.name }))) return;
        void run(async () => {
          await send(`/contacts/${form.id}/delete`, { version: form.version });
          setForm(empty);
          await load();
          await onRefresh?.();
        });
      }}>{translate("warehouse.delete.the.corresponding.unit")}</AntButton>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
}
export function Templates({ onUse, type, collapsible = false, disabled = false, activeId, refreshKey = 0 }) {
  useLocale();
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
    load().catch((e) => setError(localizeError(e.message)));
  }, [refreshKey]);
  const visibleTemplates = templates.filter((d) => !type || d.type === type);
  const header = <span className="template-heading-main">
    <span className="template-heading-icon"><FilePenLine size={20} aria-hidden="true" /></span>
    <span className="template-heading-copy">
      <strong>{collapsible ? translate("warehouse.select.document.template") : translate("warehouse.document.template")}</strong>
      <span>{collapsible ? translate("warehouse.apply.common.material.combinations.to.quickly.issue.orders") : translate("warehouse.save.frequently.used.billing.content.and.apply.it.repeatedly")}</span>
    </span>
    {!loading && !error && <span className="template-count">{visibleTemplates.length}{" "}{translate("warehouse.templates")}</span>}
  </span>;
  return (
    <section className={`template-panel${collapsible ? " template-picker" : ""}`}>
      {collapsible ? <AntButton type="text"
        ref={trigger}
        htmlType="button"
        className="template-trigger"
        aria-label={translate("warehouse.select.document.template")}
        aria-expanded={expanded}
        aria-controls={listId}
        disabled={disabled || busy}
        onClick={() => setExpanded(!expanded)}
      >{header}<ChevronDown className="template-chevron" size={18} aria-hidden="true" /></AntButton>
        : <div className="template-heading">{header}</div>}
      <div id={listId} className="template-content" hidden={collapsible && !expanded}>
        {collapsible && <p className="template-hint">{translate("warehouse.this.document.can.be.modified.after.application.and.the.template.will")}</p>}
        {(loading || busy) && <div className="template-empty" role="status"><LoadingIndicator size={24} /><span>{loading ? translate("warehouse.loading.templates") : translate("warehouse.processing.template")}</span></div>}
        {!loading && !error && !visibleTemplates.length && <div className="template-empty">
          <FilePenLine size={28} aria-hidden="true" />
          <strong>{translate("warehouse.no.template.yet")}</strong>
          <span>{type ? translate("warehouse.the.current.warehouse.does.not.have.template.yet", { v0: type === "in" ? translate("warehouse.procurement") : translate("warehouse.sales") }) : translate("warehouse.save.frequently.used.material.combinations.on.the.billing.page.and.apply")}</span>
        </div>}
        <div className="template-list" aria-busy={loading}>
          {visibleTemplates.map((d) => (
            <article className={`template-card${d.id === activeId ? " is-active" : ""}`} key={d.id}>
              <div className="template-card-top">
                <span className={`template-type template-type-${d.type}`}>{d.type === "in" ? translate("warehouse.stock.in") : translate("warehouse.stock.out")}</span>
                <span className="template-number">#{d.id}</span>
                {d.id === activeId && <span className="template-active">{translate("warehouse.applied.this.time")}</span>}
              </div>
              <h4>{d.name}</h4>
              <p className="template-partner">{d.partner || translate("warehouse.no.contact.unit.specified")}</p>
              <div className="template-meta">
                <span><Package size={14} aria-hidden="true" />{d.items.length}{" "}{translate("warehouse.materials")}</span>
                <span><UserRound size={14} aria-hidden="true" />{d.created_by_name || translate("warehouse.operator.unknown")}</span>
                <span><Clock3 size={14} aria-hidden="true" /><time dateTime={d.updated_at}>{new Date(d.updated_at).toLocaleString(getFormatLocale(), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</time></span>
              </div>
              {d.note && <p className="template-note" title={d.note}>{d.note}</p>}
              <div className="template-actions">
                <AntButton type="default"
                  htmlType="button"
                  className="btn btn-secondary template-resume"
                  aria-label={translate("warehouse.using.template", { v0: d.id })}
                  disabled={busy || disabled || loading || !can(d.type === 'in' ? 'purchase' : 'sale')}
                  onClick={() => {
                    if (onUse(d) !== false && collapsible) {
                      setExpanded(false);
                      trigger.current?.focus();
                    }
                  }}
                >{translate("warehouse.use.templates")}<ArrowRight size={15} aria-hidden="true" />
                </AntButton>
                <AntButton type="text"
                  htmlType="button"
                  className="template-delete"
                  hidden={!manageTemplates}
                  aria-label={translate("warehouse.delete.template", { v0: d.id })}
                  title={translate("warehouse.delete.template.2")}
                  disabled={busy || disabled || loading}
                  onClick={() =>
                    run(async () => {
                      if (!window.confirm(translate("warehouse.confirm.to.delete.this.template"))) return;
                      await send(`/templates/${d.id}/delete`, { version: d.version });
                      await load();
                    })
                  }
                >
                  <Trash2 size={16} aria-hidden="true" />
                </AntButton>
              </div>
            </article>
          ))}
        </div>
        {error && (
          <div className="template-error">
            <p role="alert" className="form-error">{error}</p>
            <AntButton type="default" htmlType="button" className="btn btn-secondary" disabled={busy || disabled} onClick={() => run(load)}>{translate("warehouse.reload")}</AntButton>
          </div>
        )}
      </div>
    </section>
  );
}
export function Payments({ order, onChanged }) {
  useLocale();
  const [data, setData] = useState(null),
    [amount, setAmount] = useState(""),
    [method, setMethod] = useState("银行转账"),
    [note, setNote] = useState("");
  const { busy, error, setError, run, send } = useBusiness();
  const load = async () => setData(await api(`/orders/${order.id}/payments`));
  useEffect(() => {
    load().catch((e) => setError(localizeError(e.message)));
  }, [order.id]);
  const changed = async () => {
    await load();
    await onChanged?.();
  };
  return (
    <section className="operation-panel">
      <h3>{translate("warehouse.payment.and.receipt.records")}</h3>
      {!data && !busy && !error && <p><LoadingStatus>{translate("warehouse.reading.payment.records")}</LoadingStatus></p>}
      {busy && <p><LoadingStatus>{translate("warehouse.saving.payment")}</LoadingStatus></p>}
      {data && (
        <>
          <p>
            {data.direction === "receive" ? translate("warehouse.receivable") : translate("warehouse.payable")}{" "}
            {money(Math.round(data.total * 100))}{" "}{translate("warehouse.registered")}{" "}
            {money(data.paid_cents)} · {paymentLabel[data.payment_status]}
            {data.payment_status !== "unverified" &&
              translate("warehouse.waiting.for", { v0: data.direction === "receive" ? translate("warehouse.receive") : translate("warehouse.pay"), v1: money(data.due_cents) })}
          </p>
          {order.status !== "void" &&
            (data.payment_status === "unverified" || data.due_cents > 0) && (
              <>
                <label>
                  {data.payment_status === "unverified"
                    ? translate("warehouse.historical.paid.amount")
                    : translate("warehouse.the.amount.of.this.payment")}
                  <FormField value={amount} type="number" min="0" label={translate("warehouse.payment.amount")}><AntInput
                    aria-label={translate("warehouse.payment.amount")}
                    type="number"
                    min="0"
                    step="0.01"
                    value={amount}
                    disabled={busy}
                    onChange={(e) => setAmount(e.target.value)}
                  /></FormField>
                </label>
                <label>{translate("warehouse.payment.method")}<AntInput
                    value={method}
                    maxLength={50}
                    disabled={busy}
                    onChange={(e) => setMethod(e.target.value)}
                  />
                </label>
                <label>{translate("warehouse.payment.instructions")}<AntInput
                    value={note}
                    maxLength={500}
                    disabled={busy}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <AntButton type="primary"
                  htmlType="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      if (!/^\d+(\.\d{1,2})?$/.test(amount))
                        throw new Error(translate("warehouse.please.enter.a.valid.amount.up.to.two.decimal.places"));
                      if (
                        !window.confirm(
                          data.payment_status === "unverified"
                            ? translate("warehouse.confirm.the.historical.paid.amount.and.include.this.document.into.the")
                            : translate("warehouse.confirm.to.register.this.payment.only.actual.receipts.and.disbursements.of"),
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
                    ? translate("warehouse.confirm.historical.payment")
                    : translate("warehouse.register.for.payments")}
                </AntButton>
              </>
            )}
          <p>{translate("warehouse.the.registration.only.records.the.flow.of.funds.the.return.order")}</p>
          {data.entries.map((p) => (
            <div className="operation-row" key={p.id}>
              <p>
                {money(p.amount_cents)} · {p.method} · {p.note} ·{" "}
                {new Date(p.created_at).toLocaleString(getFormatLocale())}{" "}
                {p.reversed_at ? translate("warehouse.revoked", { v0: p.reverse_reason }) : ""}
              </p>
              {!p.reversed_at && (
                <AntButton type="default"
                  htmlType="button"
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const reason = window.prompt(
                        translate("warehouse.reasons.for.canceling.collection.and.payment.registration.no.actual.refund.is"),
                      );
                      if (reason === null) return;
                      await send(`/payments/${p.id}/reverse`, { reason });
                      await changed();
                    })
                  }
                >{translate("warehouse.unregister")}{p.id}
                </AntButton>
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
  useLocale();
  const [data, setData] = useState(null),
    [selected, setSelected] = useState(null);
  const { error, setError } = useBusiness();
  const load = async () => setData(await api("/finance"));
  useEffect(() => {
    load().catch((e) => setError(localizeError(e.message)));
  }, []);
  return (
    <div>
      <p>{translate("warehouse.arrears.are.registered.separately.according.to.the.original.document.and.the")}</p>
      {!data && !error && <p><LoadingStatus>{translate("warehouse.reading.financial.data")}</LoadingStatus></p>}
      {data && (
        <>
          <div className="operation-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{translate("warehouse.business.partner")}</th>
                  <th>{translate("warehouse.receivables.yet.to.be.received")}</th>
                  <th>{translate("warehouse.payable.and.unpaid")}</th>
                  <th>{translate("warehouse.documents.to.be.verified")}</th>
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
          <label>{translate("warehouse.select.payment.document")}<Select aria-label={translate("warehouse.select.payment.document")}
              value={selected?.id || ""}
              onChange={(e) =>
                setSelected(
                  data.orders.find((o) => o.id === Number(e)) ||
                    null,
                )
              }
            >
              <option value="">{translate("warehouse.please.select")}</option>
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
  useLocale();
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
      {busy && <p><LoadingStatus>{translate("warehouse.reading.gross.profit.report")}</LoadingStatus></p>}
      <p>{translate("warehouse.moving.weighted.average.cost.saving.costs.when.selling.the.opening.cost")}</p>
      <label>{translate("warehouse.start.date")}<AntInput
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </label>
      <label>{translate("warehouse.end.date")}<AntInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </label>
      <AntButton type="default" htmlType="button" className="btn" disabled={busy} onClick={load}>{translate("warehouse.check.gross.profit")}</AntButton>
      {data && (
        <>
          <p>{translate("warehouse.net.sales")}{money(data.totals.revenue_cents)}{" "}{translate("warehouse.known.cost.of.sales")}{" "}
            {money(data.totals.cost_cents)}{" "}{translate("warehouse.known.gross.profit")}{" "}
            {money(data.totals.gross_profit_cents)}{" "}{translate("warehouse.unknown.net.cost")}{" "}
            {money(data.totals.unknown_revenue_cents)}（
            {data.totals.unknown_lines}{translate("warehouse.article.2")}</p>
          <p>{translate("warehouse.current.inventory.cost")}{" "}{money(data.inventory_value_cents)}</p>
          <div className="operation-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{translate("warehouse.material")}</th>
                  <th>{translate("warehouse.net.sales.2")}</th>
                  <th>{translate("warehouse.net.sales")}</th>
                  <th>{translate("warehouse.known.cost")}</th>
                  <th>{translate("warehouse.known.gross.profit.2")}</th>
                  <th>{translate("warehouse.known.gross.profit.margin")}</th>
                  <th>{translate("warehouse.unknown.number.of.costs")}</th>
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
