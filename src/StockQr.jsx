import { localizeError } from './i18n/errors.js';
import { t as translate, getFormatLocale } from './i18n/index.js';
import { useLocale } from './i18n/react.jsx';
import { parseQuantity, validQuantity, materialQuantity } from '../shared/quantity.js';
import { ConfigProvider as AntConfigProvider, Form as AntForm } from 'antd';
import { Button as AntButton, Input as AntInput, Checkbox as AntCheckbox } from './ui/controls.jsx';

import { FormField } from './ui/FormField.jsx';

import { contactMatchesDirection } from '../shared/contacts.js';
import { useQuery } from './queries.js';
import { lookupProductCode, useProductSelection } from './product-query.js';
import { LoadingIndicator, LoadingStatus } from './Loading.jsx';
import { Select, ContactPicker } from "./Dropdown.jsx";
import React, { useEffect, useId, useRef, useState } from "react";
import { mobileDevice } from './device.js';
import { api } from "./api.js";
import { stockQrPayload, newRequestId } from "./stock-qr-client.js";
import { download } from "./data-files.js";
import { moneyBase, baseCurrencySymbol, priceBase } from './app/format.js';
import "./stock-qr.css";
const money = (n) => `${baseCurrencySymbol()}${moneyBase(n / 100)}`;
const unitPrice = (e4) => `${baseCurrencySymbol()}${priceBase(e4 / 10000)}`;
const button = "btn";
const configSnapshot = form => JSON.stringify([
  ...['name', 'type', 'partner', 'partner_id', 'note']
    .map(key => String(form[key] ?? '')),
  form.max_scans === null ? null : form.max_scans === '' ? '' : Number(form.max_scans),
  Boolean(form.require_confirmation), Boolean(form.enabled),
  form.items.map(item => [item.product_id, item.quantity === '' ? '' : Number(item.quantity), item.price === '' ? '' : Number(item.price)]),
]);
function Lines({ items }) {
  useLocale();
  return (
    <div className="stock-qr-lines">
      {items.map((i) => (
        <div key={i.product_id} className="stock-qr-line">
          <div>
            <strong>{i.name}</strong>
            <small>
              {i.barcode}{" "}{translate("warehouse.inventory.2")}{" "}{i.stock} {i.unit}
            </small>
          </div>
          <div>
            {i.quantity} {i.unit} × {unitPrice(i.price_e4)}
            <small>{money(i.amount_cents ?? Math.round(i.quantity * i.price_e4 / 100))}</small>
          </div>
        </div>
      ))}
    </div>
  );
}
// Keep complete product names and units readable on exported labels.
function PrintableLabel({ qr, symbol, labelRef }) {
  useLocale();
  const wrap = (value, max) => {
    const lines = [];
    let line = "",
      width = 0;
    for (const ch of Array.from(value)) {
      const size = ch.charCodeAt(0) < 128 ? 0.6 : 1;
      if (width + size > max) {
        lines.push(line);
        line = "";
        width = 0;
      }
      line += ch;
      width += size;
    }
    if (line) lines.push(line);
    return lines;
  };
  const textRows = [];
  let y = 24;
  const add = (value, size = 12, max = 30) => {
    for (const text of wrap(value, max)) {
      textRows.push({ text, y, size });
      y += size + 6;
    }
  };
  add(qr.name, 16, 23);
  const qrY = y;
  y += 280;
  add(
    translate("warehouse.materials.3", { v0: qr.warehouse_name, v1: qr.type === "in" ? translate("warehouse.stock.in") : translate("warehouse.stock.out"), v2: qr.require_confirmation ? translate("warehouse.need.confirmation") : translate("warehouse.confirmation.free"), v3: qr.items.length }),
  );
  for (const item of qr.items) {
    y += 6;
    add(`${item.name} · ${item.quantity} ${item.unit}`);
    add(item.barcode, 11);
  }
  y += 10;
  add(translate("warehouse.based.on.the.current.configuration.of.the.system"), 11);
  return (
    <svg
      ref={labelRef}
      role="img"
      aria-label={translate("warehouse.inbound.and.outbound.qr.code")}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 420 ${y}`}
      width="420"
      height={y}
      className="stock-qr-label"
    >
      <rect width="420" height={y} fill="white" />
      <svg
        x="82"
        y={qrY}
        width="256"
        height="256"
        viewBox={`0 0 ${symbol.size} ${symbol.size}`}
        shapeRendering="crispEdges"
      >
        <rect width={symbol.size} height={symbol.size} fill="white" />
        <path d={symbol.path} fill="black" />
      </svg>
      {textRows.map((row, n) => (
        <text key={n} x="20" y={row.y} fontSize={row.size}>
          {row.text}
        </text>
      ))}
    </svg>
  );
}
export function StockQrManager({
  data,
  initialProduct,
  Modal,
  CameraScanner,
  onClose,
}) {
  useLocale();
  const formId = useId();
  const contentRef = useRef(null), errorRef = useRef(null), baseline = useRef(null);
  const [rows, setRows] = useState([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [type, setType] = useState(""),
    [status, setStatus] = useState("");
  const [selected, setSelected] = useState(null),
    [form, setForm] = useState(null),
    [records, setRecords] = useState(null),
    [recordPage, setRecordPage] = useState(1),
    [recordKind, setRecordKind] = useState("usages");
  const [query, setQuery] = useState(""),
    [camera, setCamera] = useState(false),
    [barcode, setBarcode] = useState(""),
    [symbol, setSymbol] = useState(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    request = useRef({}),
    labelRef = useRef(), barcodeInput = useRef();
  const load = async () => {
    const r = await api(
      `/stock-qrs?page=${page}&type=${type}&status=${status}${initialProduct ? `&product_id=${initialProduct.id}` : ""}`,
    );
    setRows(r.rows);
    setTotal(r.total);
  };
  useEffect(() => {
    let live = true;
    setError("");
    api(
      `/stock-qrs?page=${page}&type=${type}&status=${status}${initialProduct ? `&product_id=${initialProduct.id}` : ""}`,
    )
      .then((r) => {
        if (live) {
          setRows(r.rows);
          setTotal(r.total);
        }
      })
      .catch((e) => live && setError(localizeError(e.message)));
    return () => {
      live = false;
    };
  }, [page, type, status, initialProduct]);
  const run = async (fn) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(localizeError(e.message));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const send = async (path, method, body) => {
    const key = JSON.stringify([path, method, body]);
    if (request.current.key !== key)
      request.current = { key, id: newRequestId() };
    return api(path, {
      method,
      body: { ...body, request_id: request.current.id },
    });
  };
  const selection = useProductSelection(data, form?.items || [], query, true, initialProduct);
  const contacts = useQuery('/contacts', data);
  data = { ...data, products: selection.products, contacts: contacts.result || [] };
  const line = (p) => ({
    product_id: p.id,
    name: p.name,
    barcode: p.barcode,
    unit: p.unit,
    stock: p.stock,
    quantity: "1",
    price: String(p.cost),
  });
  const edit = (q) => {
    setSelected(q);
    setRecords(null);
    setError("");
    setSymbol(null);
    const nextForm = q
        ? {
            ...q,
            partner: q.partner_name,
            price: undefined,
            items: q.items.map((i) => ({
              ...i,
              quantity: String(i.quantity),
              price: String(i.price_e4 / 10000),
            })),
          }
        : {
            name: initialProduct ? translate("warehouse.storage", { v0: initialProduct.name }) : translate("warehouse.warehousing.qr.code"),
            type: "in",
            max_scans: "1",
            require_confirmation: true,
            enabled: true,
            partner: "",
            note: "",
            items: initialProduct ? [line(initialProduct)] : [],
          };
    baseline.current = configSnapshot(nextForm);
    setForm(nextForm);
  };
  const add = (p) => {
    selection.remember(p);
    if (form.items.some((i) => i.product_id === p.id)) {
      setError(translate("warehouse.the.material.is.already.in.the.details.please.edit.the.existing"));
      return;
    }
    if (form.items.length >= 100) {
      setError(translate("warehouse.configure.up.to.100.materials"));
      return;
    }
    setForm({
      ...form,
      items: [
        ...form.items,
        { ...line(p), price: String(form.type === "in" ? p.cost : p.price) },
      ],
    });
    setQuery("");
    setError("");
  };
  const scan = async (raw) => {
    setCamera(false);
    try {
      const p = await lookupProductCode(raw, data);
      if (!p) throw new Error(translate("warehouse.material.not.found.please.create.a.material.file.first"));
      add(p);
      setBarcode("");
    } catch (e) {
      setError(localizeError(e.message));
    }
  };
  const updateLine = (id, key, value) =>
    setForm({
      ...form,
      items: form.items.map((i) =>
        i.product_id === id ? { ...i, [key]: value } : i,
      ),
    });
  const quantityOf = i => data.products.find(p => p.id === i.product_id)?.unit_round_up ? Math.ceil(Number(i.quantity)) : Number(i.quantity);
  const save = () =>
    run(async () => {
      if (
        selected &&
        !window.confirm(
          translate("warehouse.after.saving.the.printed.qr.code.will.be.executed.according.to"),
        )
      )
        return;
      const body = {
        name: form.name,
        type: form.type,
        max_scans: form.max_scans === null ? null : Number(form.max_scans),
        require_confirmation: form.require_confirmation,
        enabled: form.enabled,
        partner: form.partner,
        ...(form.partner_id ? { partner_id: form.partner_id } : {}),
        note: form.note,
        items: form.items.map((i) => ({
          product_id: i.product_id,
          quantity: materialQuantity(parseQuantity(i.quantity, true), data.products.find(p => p.id === i.product_id)),
          price_e4: Math.round(Number(i.price) * 10000),
        })),
        ...(selected ? { version: selected.version } : {}),
      };
      if (
        form.items.some(
          (i) =>
            !i.price.trim() ||
            !Number.isFinite(Number(i.price)) ||
            Math.abs(
              Number(i.price) * 10000 - Math.round(Number(i.price) * 10000),
            ) > 0.00001,
        )
      )
        throw new Error(translate("warehouse.the.transaction.unit.price.of.each.material.can.have.up.to"));
      const q = await send(
        selected ? `/stock-qrs/${selected.qr_id}` : "/stock-qrs",
        selected ? "PUT" : "POST",
        body,
      );
      setForm(null);
      setSelected(q);
      await load();
    });
  useEffect(() => {
    if (!selected || form || records) {
      setSymbol(null);
      return;
    }
    let live = true;
    import("./product-code.js")
      .then(({ qrSymbol }) => {
        if (live)
          setSymbol(qrSymbol(stockQrPayload(selected, data.instance_id)));
      })
      .catch((e) => live && setError(localizeError(e.message)));
    return () => {
      live = false;
    };
  }, [selected, form, records, data.instance_id]);
  const recordLoad = (q, kind, n = 1) =>
    run(async () => {
      const r = await api(`/stock-qrs/${q.qr_id}/${kind}?page=${n}`);
      setSelected(q);
      setForm(null);
      setRecordKind(kind);
      setRecordPage(n);
      setRecords(r);
    });
  const canLeave = () => mobileDevice || !form || configSnapshot(form) === baseline.current ||
    window.confirm(translate("warehouse.the.qr.code.configuration.has.not.been.saved.are.you.sure"));
  const back = () => {
    if (busy || !canLeave()) return;
    setSelected(null);
    setForm(null);
    setRecords(null);
    setCamera(false);
    setError("");
  };
  const close = () => {
    if (!busy && canLeave()) onClose();
  };
  const view = form ? 'edit' : records ? 'records' : selected ? 'label' : 'list';
  useEffect(() => {
    if (mobileDevice) return;
    contentRef.current?.scrollTo(0, 0);
    const target = contentRef.current?.querySelector('[data-autofocus]') || contentRef.current?.closest('.modal');
    target?.focus({ preventScroll: true });
  }, [view, selected?.qr_id, recordKind, recordPage, page]);
  useEffect(() => {
    if (!mobileDevice && error) errorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);
  const title = form
    ? selected
      ? translate("warehouse.edit.the.qr.code.for.incoming.and.outgoing.warehouses")
      : translate("warehouse.create.a.new.entry.and.exit.qr.code")
    : records
      ? recordKind === "usages"
        ? translate("warehouse.usage.records")
        : translate("warehouse.configuration.modification.record")
      : selected
        ? translate("warehouse.inbound.and.outbound.qr.code.labels")
        : translate("warehouse.manage.incoming.and.outgoing.qr.codes");
  return (
    <Modal title={title} onClose={close} wide presentation="drawer" drawerSize="wide"
      headerNavigation={(selected || form) && <AntButton type="text" htmlType="button" className={`${button} drawer-header-back`} disabled={busy} onClick={back}>{translate("warehouse.return.to.list")}</AntButton>}
      footer={<div className="modal-footer">
        {form ? <>
          <AntButton type="text" htmlType="button" className={button} disabled={busy} onClick={back}>{translate("warehouse.cancel.edit")}</AntButton>
          <AntButton type="primary" className="btn btn-primary" htmlType="submit" form={formId} disabled={busy} aria-busy={busy}>
            {busy && <LoadingIndicator size={20} />}{translate("warehouse.save.qr.code")}</AntButton>
        </> : <AntButton type="text" htmlType="button" className={button} disabled={busy} onClick={close}>{translate("warehouse.close")}</AntButton>}
      </div>}
    >
      <div ref={contentRef} className="form-body stock-qr-manager" aria-busy={busy}>
        {busy && <p><LoadingStatus>{translate("warehouse.processing.the.inbound.and.outbound.qr.code")}</LoadingStatus></p>}
        {mobileDevice && (selected || form) && (
          <AntButton type="text" htmlType="button" className={button} disabled={busy} onClick={back}>{translate("warehouse.return.to.list")}</AntButton>
        )}
        {error && (
          <p ref={errorRef} className="form-error" role="alert">
            {error}
          </p>
        )}
        {form ? (
          <AntForm noValidate layout="vertical" scrollToFirstError={{ focus: true }}
            id={formId}
            onFinish={() => {

              save();
            }}
          >
            <AntConfigProvider componentDisabled={busy}><fieldset disabled={busy}>
              <label>{translate("warehouse.qr.code.name")}<FormField label={translate("warehouse.qr.code.name")} value={form.name} required maxLength={60}><AntInput

                  data-autofocus
                  maxLength={60}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                /></FormField>
              </label>
              <label>{translate("warehouse.operation.type")}<Select aria-label={translate("warehouse.operation.type")}
                  value={form.type}
                  disabled={!!selected}
                  onChange={(e) => {
                    const t = e;
                    setForm({
                      ...form,
                      type: t,
                      partner: t === "out" ? "零售客户" : "",
                      partner_id: undefined,
                      items: form.items.map((i) => ({
                        ...i,
                        price: String(
                          data.products.find((p) => p.id === i.product_id)?.[
                            t === "in" ? "cost" : "price"
                          ] ?? 0,
                        ),
                      })),
                    });
                  }}
                >
                  <option value="in">{translate("warehouse.stock.in")}</option>
                  <option value="out">{translate("warehouse.stock.out")}</option>
                </Select>
              </label>
              <h3>{translate("warehouse.material.details.3")}{form.items.length}/100）</h3>
              <label>{translate("warehouse.search.to.add.materials")}<AntInput
                  value={query}
                  placeholder={translate("warehouse.enter.name.or.code")}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              {(selection.error || contacts.error) && <div role="alert">{selection.error || contacts.error}</div>}
              <div className="stock-qr-options">
                {query &&
                  selection.matches
                    .map((p) => (
                      <AntButton type="text"
                        htmlType="button"
                        className={button}
                        key={p.id}
                        onClick={() => add(p)}
                      >
                        {p.name} · {p.barcode}
                      </AntButton>
                    ))}
              </div>
              <div className="stock-qr-actions">
                <AntButton type="text"
                  htmlType="button"
                  className={button}
                  onClick={() => setCamera(!camera)}
                >
                  {camera ? translate("warehouse.turn.off.camera") : translate("warehouse.scan.to.add.materials")}
                </AntButton>
                <AntInput
                  ref={barcodeInput}
                  aria-label={translate("warehouse.add.material.barcode")}
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                />
                <AntButton type="text"
                  htmlType="button"
                  className={button}
                  onClick={() => scan(barcode)}
                >{translate("warehouse.identify.materials")}</AntButton>
              </div>
              {camera && <CameraScanner onResult={scan} onClose={() => setCamera(false)} title={translate("warehouse.scan.code.to.add.materials")} note={translate("warehouse.automatically.added.to.the.qr.code.material.details.after.identification")}
                onManual={() => { setCamera(false); requestAnimationFrame(() => barcodeInput.current?.focus()); }} />}
              {form.items.map((i, index) => (
                <div className="stock-qr-edit-line" key={i.product_id}>
                  <strong>
                    {i.name}{" "}
                    <small>
                      {i.barcode}{" "}{translate("warehouse.inventory.2")}{" "}{i.stock} {i.unit}
                    </small>
                  </strong>
                  <label>
                    {i.name}{" "}{translate("warehouse.single.quantity")}{i.unit}）
                    <FormField label={translate("warehouse.single.quantity.2")} value={i.quantity} required type="number" min={0.0001} max={99999999}><AntInput
                      type="number"
                      min={0.0001}
                      max={99999999}
                      step={0.0001}
                      value={i.quantity}
                      onBlur={() => { if (validQuantity(Number(i.quantity), true)) updateLine(i.product_id, "quantity", quantityOf(i)); }}
                      onChange={(e) =>
                        updateLine(i.product_id, "quantity", e.target.value)
                      }
                    /></FormField>
                  </label>
                  <label>
                    {i.name}{translate("warehouse.transaction.unit.price")}<FormField label={translate("warehouse.transaction.unit.price")} value={i.price} required type="number" min={0} max={99999999}><AntInput
                      type="number"
                      min={0}
                      max={99999999}
                      step="0.0001"
                      value={i.price}
                      onChange={(e) =>
                        updateLine(i.product_id, "price", e.target.value)
                      }
                    /></FormField>
                  </label>
                  <span>{translate("warehouse.amount")}{" "}
                    {money(
                      Math.round(quantityOf(i) * Number(i.price) * 100),
                    )}
                  </span>
                  {form.type === "out" && Number(i.quantity) > i.stock && (
                    <p className="form-error">{translate("warehouse.the.current.inventory.is.insufficient.and.the.entire.group.cannot.be")}</p>
                  )}
                  <div className="stock-qr-actions">
                    <AntButton type="text"
                      htmlType="button"
                      className={button}
                      disabled={!index}
                      onClick={() => {
                        const items = [...form.items];
                        [items[index - 1], items[index]] = [
                          items[index],
                          items[index - 1],
                        ];
                        setForm({ ...form, items });
                      }}
                    >{translate("warehouse.move.up")}</AntButton>
                    <AntButton type="text"
                      htmlType="button"
                      className={button}
                      onClick={() =>
                        setForm({
                          ...form,
                          items: form.items.filter(
                            (j) => j.product_id !== i.product_id,
                          ),
                        })
                      }
                    >{translate("warehouse.remove.2")}{i.name}
                    </AntButton>
                  </div>
                </div>
              ))}
              <p>{translate("warehouse.total.amount.per.trip")}{money(
                  form.items.reduce(
                    (s, i) =>
                      s +
                      Math.round(quantityOf(i) * Number(i.price) * 100),
                    0,
                  ),
                )}
              </p>
              {selected && (
                <p>{translate("warehouse.already.used")}{selected.used_scans}{translate("warehouse.times.modifying.the.combination.will.not.clear.the.used.times")}</p>
              )}
              <label>{translate("warehouse.number.of.times.limit")}<Select aria-label={translate("warehouse.number.of.times.limit")}
                  value={form.max_scans === null ? "unlimited" : "limited"}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      max_scans:
                        e === "unlimited"
                          ? null
                          : String(Math.max(selected?.used_scans || 0, 1)),
                    })
                  }
                >
                  <option value="limited">{translate("warehouse.limit.the.number.of.times")}</option>
                  <option value="unlimited">{translate("warehouse.unlimited.times")}</option>
                </Select>
              </label>
              {form.max_scans !== null && (
                <label>{translate("warehouse.number.of.scans.possible.accumulated.upper.limit")}<FormField label={translate("warehouse.number.of.scans.possible.accumulated.upper.limit")} value={form.max_scans} required type="number" min={Math.max(selected?.used_scans || 0, 1)} max={99999999}><AntInput
                    type="number"
                    min={Math.max(selected?.used_scans || 0, 1)}
                    max={99999999}
                    step={1}
                    value={form.max_scans}
                    onChange={(e) =>
                      setForm({ ...form, max_scans: e.target.value })
                    }
                  /></FormField>
                </label>
              )}
              <AntCheckbox className="stock-qr-check" checked={form.require_confirmation} onChange={(e) =>
                    setForm({ ...form, require_confirmation: e.target.checked })
                  }>{translate("warehouse.need.second.confirmation")}</AntCheckbox>
              {!form.require_confirmation && (
                <p className="info-box">{translate("warehouse.after.scanning.the.qr.code.the.entire.document.will.be.directly")}</p>
              )}
              <ContactPicker contacts={(data.contacts || []).filter(c => c.active && contactMatchesDirection(c, form.type))}
                label={translate("warehouse.business.partner")} value={form.partner} selectedId={form.partner_id} required disabled={busy}
                onChange={partner => {
                  const contact = (data.contacts || []).find(c => c.active && contactMatchesDirection(c, form.type) && c.name === partner);
                  setForm({ ...form, partner, partner_id: contact?.id });
                }}
                onSelect={contact => setForm({ ...form, partner: contact.name, partner_id: contact.id })} />
              <label>{translate("warehouse.document.remarks")}<AntInput.TextArea
                  maxLength={500}
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </label>
              <AntCheckbox className="stock-qr-check" checked={form.enabled} onChange={(e) =>
                    setForm({ ...form, enabled: e.target.checked })
                  }>{translate("warehouse.activate")}</AntCheckbox>
              {mobileDevice && <AntButton type="primary" className="btn btn-primary" htmlType="submit">{translate("warehouse.save.qr.code")}</AntButton>}
            </fieldset></AntConfigProvider>
          </AntForm>
        ) : records ? (
          <>
            {!records.rows.length && <p>{translate("warehouse.no.records.yet")}</p>}
            {records.rows.map((r) => (
              <section className="stock-qr-record" key={r.id}>
                <strong>
                  {r.order
                    ? `${r.order.number} · ${r.order.status === "void" ? translate("warehouse.voided") : translate("warehouse.valid")}`
                    : translate("warehouse.configuration.version", { v0: r.version })}
                </strong>
                <p>
                  {r.created_by_name || translate("warehouse.operator.unknown")} · {r.created_at}
                </p>
                <Lines items={r.snapshot.items} />
              </section>
            ))}
            <div className="stock-qr-actions">
              <AntButton type="text" htmlType="button"
                className={button}
                disabled={busy || recordPage === 1}
                onClick={() => recordLoad(selected, recordKind, recordPage - 1)}
              >{translate("warehouse.previous.page")}</AntButton>
              <span>{translate("warehouse.no.2")}{recordPage}{" "}{translate("warehouse.pages.total")}{" "}{records.total}{translate("warehouse.records")}</span>
              <AntButton type="text" htmlType="button"
                className={button}
                disabled={busy || recordPage * 20 >= records.total}
                onClick={() => recordLoad(selected, recordKind, recordPage + 1)}
              >{translate("warehouse.next.page")}</AntButton>
            </div>
          </>
        ) : selected ? (
          <>
            <h3>{selected.name}</h3>
            <p>
              {selected.warehouse_name} ·{" "}
              {selected.type === "in" ? translate("warehouse.stock.in") : translate("warehouse.stock.out")} ·{" "}
              {selected.require_confirmation ? translate("warehouse.need.second.confirmation") : translate("warehouse.confirmation.free")}{" "}{translate("warehouse.used")}{" "}
              {selected.used_scans}/{selected.max_scans ?? translate("warehouse.no.limit")}{translate("warehouse.times")}</p>
            {symbol && (
              <PrintableLabel
                qr={selected}
                symbol={symbol}
                labelRef={labelRef}
              />
            )}
            <Lines items={selected.items} />
            <div className="stock-qr-actions">
              <AntButton type="text" htmlType="button"
                className={button}
                disabled={busy}
                onClick={() => edit(selected)}
              >{translate("warehouse.edit.configuration")}</AntButton>
              <AntButton type="text" htmlType="button"
                className={button}
                disabled={!symbol}
                onClick={() =>
                  download(
                    new XMLSerializer().serializeToString(labelRef.current),
                    `${selected.qr_id}-stock-qr.svg`,
                    "image/svg+xml",
                  )
                }
              >{translate("warehouse.download.tags")}</AntButton>
              <AntButton type="text" htmlType="button"
                className={button}
                disabled={busy}
                onClick={() => recordLoad(selected, "usages")}
              >{translate("warehouse.view.usage.history")}</AntButton>
              <AntButton type="text" htmlType="button"
                className={button}
                disabled={busy}
                onClick={() => recordLoad(selected, "revisions")}
              >{translate("warehouse.view.modification.history")}</AntButton>
            </div>
          </>
        ) : (
          <>
            <div className="stock-qr-actions">
              <AntButton type="primary" htmlType="button" className="btn btn-primary" onClick={() => edit(null)}>{translate("warehouse.create.a.new.qr.code")}</AntButton>
              <Select
                aria-label={translate("warehouse.filter.by.action.type")}
                value={type}
                onChange={(e) => {
                  setType(e);
                  setPage(1);
                }}
              >
                <option value="">{translate("warehouse.all.types")}</option>
                <option value="in">{translate("warehouse.stock.in")}</option>
                <option value="out">{translate("warehouse.stock.out")}</option>
              </Select>
              <Select
                aria-label={translate("warehouse.filter.by.qr.code.status")}
                value={status}
                onChange={(e) => {
                  setStatus(e);
                  setPage(1);
                }}
              >
                <option value="">{translate("warehouse.all.status")}</option>
                <option value="available">{translate("warehouse.available")}</option>
                <option value="exhausted">{translate("warehouse.used.up")}</option>
                <option value="disabled">{translate("warehouse.deactivated")}</option>
              </Select>
            </div>
            {!rows.length && <p>{translate("warehouse.there.is.currently.no.qr.code.for.incoming.and.outgoing.warehouses")}</p>}
            {rows.map((q) => (
              <section key={q.qr_id} className="stock-qr-record">
                <h3>{q.name}</h3>
                <p>
                  {q.type === "in" ? translate("warehouse.stock.in") : translate("warehouse.stock.out")} · {q.items.length}{translate("warehouse.material.used")}{q.used_scans}/{q.max_scans ?? translate("warehouse.no.limit")}{" "}{translate("warehouse.times.2")}{" "}
                  {q.require_confirmation ? translate("warehouse.need.second.confirmation") : translate("warehouse.confirmation.free")} ·{" "}
                  {!q.enabled
                    ? translate("warehouse.deactivated")
                    : q.remaining_scans === 0
                      ? translate("warehouse.used.up")
                      : q.items.some((i) => i.product_changed)
                        ? translate("warehouse.material.has.changed")
                        : translate("warehouse.available")}
                </p>
                <Lines items={q.items} />
                <div className="stock-qr-actions">
                  <AntButton type="text" htmlType="button"
                    className={button}
                    onClick={() => {
                      setSelected(q);
                      setError("");
                    }}
                  >{translate("warehouse.view.tags")}</AntButton>
                  <AntButton type="text" htmlType="button" className={button} aria-label={translate("warehouse.edit.2", { v0: q.name })} onClick={() => edit(q)}>{translate("warehouse.edit")}</AntButton>
                  <AntButton type="text" htmlType="button"
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await send(`/stock-qrs/${q.qr_id}`, "PUT", {
                          ...q,
                          partner: q.partner_name,
                          enabled: !q.enabled,
                        });
                        await load();
                      })
                    }
                  >
                    {q.enabled ? translate("warehouse.deactivate") : translate("warehouse.activate")}
                  </AntButton>
                </div>
              </section>
            ))}
            <div className="stock-qr-actions">
              <AntButton type="text" htmlType="button"
                className={button}
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >{translate("warehouse.previous.page")}</AntButton>
              <span>{translate("warehouse.no.2")}{page}{" "}{translate("warehouse.pages.total")}{" "}{total}{translate("warehouse.records")}</span>
              <AntButton type="text" htmlType="button"
                className={button}
                disabled={page * 20 >= total}
                onClick={() => setPage(page + 1)}
              >{translate("warehouse.next.page")}</AntButton>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export function StockQrExecution({
  label,
  onLabelDone,
  mode,
  userKey,
  data,
  Modal,
  onSaved,
  onBusy,
}) {
  useLocale();
  const storageKey = `77erp-stock-qr-pending:${location.origin}:${data.instance_id}:${userKey}:${data.warehouse_id}`;
  const [preview, setPreview] = useState(null),
    [pending, setPending] = useState(() => {
      try {
        return JSON.parse(localStorage.getItem(storageKey));
      } catch {
        return null;
      }
    }),
    [result, setResult] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const lock = useRef(false),
    processed = useRef(null);
  const execute = async (task) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      localStorage.setItem(storageKey, JSON.stringify(task));
      setPending(task);
      const r = await api(`/stock-qrs/${task.qr_id}/execute`, {
        method: "POST",
        body: task.body,
        warehouseId: data.warehouse_id,
      });
      setResult(r);
      setPreview(null);
      setPending(null);
      localStorage.removeItem(storageKey);
      onLabelDone();
      try {
        await onSaved(translate("warehouse.document.saved", { v0: r.number }));
      } catch {
        setError(translate("warehouse.the.document.has.been.saved.data.refresh.failed.please.refresh.the"));
      }
    } catch (e) {
      setError(localizeError(e.message));
      if (e.status >= 400 && e.status < 500 && ![401, 403].includes(e.status)) {
        setPending(null);
        setPreview(null);
        localStorage.removeItem(storageKey);
        onLabelDone();
      }
    } finally {
      lock.current = false;
      setBusy(false);
      onBusy(false);
    }
  };
  const submit = (p) =>
    execute({
      qr_id: p.qr_id,
      preview: p,
      body: {
        preview_token: p.preview_token,
        confirmed: p.require_confirmation,
        request_id: newRequestId(),
      },
    });
  useEffect(() => {
    if (!label || processed.current === label) return;
    processed.current = label;
    if (pending) {
      setError(translate("warehouse.the.result.of.the.last.qr.code.scan.is.unknown.please"));
      onLabelDone();
      return;
    }
    let live = true;
    setBusy(true);
    onBusy(true);
    setError("");
    setResult(null);
    api("/stock-qrs/preview", {
      method: "POST",
      body: { label, mode },
      warehouseId: data.warehouse_id,
    })
      .then((p) => {
        if (!live) return;
        setPreview(p);
        setBusy(false);
        onBusy(false);
        if (!p.require_confirmation) void submit(p);
      })
      .catch((e) => {
        if (live) {
          setError(localizeError(e.message));
          onLabelDone();
        }
      })
      .finally(() => {
        if (live && !lock.current) {
          setBusy(false);
          onBusy(false);
        }
      });
    return () => {
      live = false;
    };
  }, [label]);
  const cancel = () => {
    if (!busy) {
      setPreview(null);
      setError("");
      onLabelDone();
    }
  };
  return (
    <>
      {busy && <p><LoadingStatus>{translate("warehouse.processing.qr.code.scan.request")}</LoadingStatus></p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {pending && (
        <section className="info-box">
          <p>{translate("warehouse.the.result.of.the.last.qr.code.submission.is.unknown.please")}</p>
          <AntButton type="primary" htmlType="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => execute(pending)}
          >{translate("warehouse.retry.the.original.scan.code.request")}</AntButton>
        </section>
      )}
      {result && (
        <section className="stock-qr-record" role="status">
          <strong>{translate("warehouse.document")}{" "}{result.number}{" "}{translate("warehouse.saved")}</strong>
          <Lines items={result.items} />
          <p>{translate("warehouse.remaining.times")}{result.remaining_scans ?? translate("warehouse.no.limit")}</p>
        </section>
      )}
      {preview?.require_confirmation && !pending && (
        <Modal
          title={preview.type === "in" ? translate("warehouse.confirm.storage.2") : translate("warehouse.confirm.delivery.2")}
          onClose={cancel}
          wide
        >
          <div className="form-body">
            <p>
              {preview.warehouse_name} · {preview.name}
            </p>
            <Lines items={preview.items} />
            <p>{translate("warehouse.total.amount.2")}{money(preview.total_cents)}{translate("warehouse.corresponding.units")}{preview.partner_name}
            </p>
            <p>{translate("warehouse.remarks.2")}{preview.note || translate("warehouse.none")}{translate("warehouse.remaining.times.2")}{preview.remaining_scans ?? translate("warehouse.no.limit")}
            </p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="modal-footer">
            <AntButton type="text" htmlType="button" className={button} disabled={busy} onClick={cancel}>{translate("warehouse.cancel")}</AntButton>
            <AntButton type="primary" htmlType="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => submit(preview)}
              aria-busy={busy}
            >
              {busy && <LoadingIndicator size={20} />}
              {preview.type === "in" ? translate("warehouse.confirm.storage.2") : translate("warehouse.confirm.delivery.2")}
            </AntButton>
          </div>
        </Modal>
      )}
    </>
  );
}
