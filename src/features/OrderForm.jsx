import { localizeError } from '../i18n/errors.js';
import { t as translate, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { Form as AntForm } from 'antd';
import { Checkbox as AntCheckbox, Input as AntInput, Button as AntButton } from '../ui/controls.jsx';
import { FormField } from './../ui/FormField.jsx';

import { contactMatchesDirection } from '../../shared/contacts.js';
import { usePermissions } from '../permissions.jsx';
import { useState, useRef } from 'react';
import { useBusiness } from '../business-api.js';
import { Templates, CameraScanner } from '../LazyComponents.jsx';
import { ContactPicker } from '../Dropdown.jsx';
import { useProductSelection, lookupProductCode } from '../product-query.js';
import { useQuery } from '../queries.js';
import { addQuantity, materialQuantity, parseQuantity, validQuantity } from '../../shared/quantity.js';
import { Modal, QueryStatus, Button, ProductArt } from '../components/common.jsx';
import { FilePenLine, Camera, ScanLine, Plus, Search, X, CircleCheck, Trash2, TriangleAlert, Check } from 'lucide-react';
import { moneyBase, baseCurrencySymbol, count } from '../app/format.js';
import { baseCurrency } from '../currency.js';

function OrderForm({ type, initialProduct, initialTemplate, data, onClose, onSaved }) {
  useLocale();
  const { templates } = usePermissions();
  const [template, setTemplate] = useState(initialTemplate || null);
  const [templateName, setTemplateName] = useState(initialTemplate?.name || "");
  const [templateMessage, setTemplateMessage] = useState("");
  const [templateRevision, setTemplateRevision] = useState(0);
  const [partnerId, setPartnerId] = useState(initialTemplate?.partner_id ?? null);
  const templateAction = useBusiness();
  const submitLock = useRef(false);
  const [items, setItems] = useState(
    initialTemplate ? initialTemplate.items : initialProduct
      ? [
          {
            product_id: initialProduct.id,
            quantity: 1,
            price: type === "in" ? initialProduct.cost : initialProduct.price,
          },
        ]
      : [],
  );
  const [partner, setPartner] = useState(initialTemplate?.partner ?? (type === "out" ? "零售客户" : "")),
    [note, setNote] = useState(initialTemplate?.note || ""),
    [barcode, setBarcode] = useState(""),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [camera, setCamera] = useState(false),
    [scanMessage, setScanMessage] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const selection = useProductSelection(data, items, query, includeInactive, initialProduct);
  const contacts = useQuery('/contacts', data);
  data = { ...data, products: selection.products, contacts: contacts.result || [] };
  const add = (p) => {
    selection.remember(p);
    setItems((prev) => {
      const found = prev.find((i) => i.product_id === p.id);
      return found
        ? prev.map((i) =>
            i.product_id === p.id
              ? { ...i, quantity: addQuantity(Number(i.quantity), 1) }
              : i,
          )
        : [
            ...prev,
            {
              product_id: p.id,
              quantity: 1,
              price: type === "in" ? p.cost : p.price,
            },
          ];
    });
    setQuery("");
    setScanMessage(translate("warehouse.added", { v0: p.name, v1: p.active === 0 ? translate("warehouse.deactivated.2") : "" }));
    setError("");
  };
  const scan = async (code) => {
    setCamera(false);
    try {
      const p = await lookupProductCode(code, data);
      if (!p) {
        setError(translate("warehouse.the.barcode.was.not.found.please.create.a.file.in.material", { v0: code.trim() }));
        return;
      }
      add(p);
      setBarcode("");
    } catch (e) {
      setError(localizeError(e.message));
    }
  };
  const update = (id, key, value) =>
    setItems((prev) =>
      prev.map((i) => (i.product_id === id ? { ...i, [key]: value } : i)),
    );
  const quantityOf = i => { const value = Number(i.quantity); return data.products.find(p => p.id === i.product_id)?.unit_round_up ? Math.ceil(value) : value; };
  const total =
    items.reduce(
      (s, i) => s + Math.round(quantityOf(i) * Number(i.price) * 100),
      0,
    ) / 100;
  const totalQuantity = items.reduce(
    (sum, item) => sum + (quantityOf(item) || 0),
    0,
  );
  const submit = async () => {

    if (!items.length) {
      setError(translate("warehouse.please.add.at.least.one.item"));
      return;
    }
    if (submitLock.current || templateAction.busy) return;
    submitLock.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await templateAction.send('/orders', {
        type,
        ...(partnerId ? { partner_id: partnerId } : {}),
        partner, note,
        items: items.map(i => ({ ...i, quantity: materialQuantity(parseQuantity(i.quantity, true), data.products.find(p => p.id === i.product_id)), price: Number(i.price) })),
      });
      await onSaved(translate("warehouse.success", { v0: type === "in" ? translate("warehouse.stock.in") : translate("warehouse.stock.out"), v1: r.number }));
    } catch (e) {
      setError(localizeError(e.message));
    } finally {
      setBusy(false);
      submitLock.current = false;
    }
  };
  const saveTemplate = (overwrite) => templateAction.run(async () => {
    setTemplateMessage("");
    const result = await templateAction.send("/templates", {
      ...(overwrite && template ? { id: template.id, version: template.version } : {}),
      name: templateName, type, partner, partner_id: partnerId, note, items,
    });
    setTemplate(result);
    setTemplateName(result.name);
    setTemplateRevision(value => value + 1);
    setTemplateMessage(translate("warehouse.template.has.been.saved.and.can.be.applied.repeatedly", { v0: result.name }));
  });
  const partners = (data.contacts || []).filter(c => c.active && contactMatchesDirection(c, type));
  const internal = partners.find(c => c.id === partnerId)?.role === 'internal';
  const matches = selection.matches.slice(0, 6);
  return (
    <Modal
      title={internal ? (type === "in" ? translate("warehouse.create.a.new.internal.warehouse") : translate("warehouse.create.a.new.internal.warehouse.2")) : type === "in" ? translate("warehouse.new.stock.in") : translate("warehouse.new.stock.out")}
      subtitle={translate("warehouse.after.confirmation.will.be.put.into.inventory.and.traceable.documents.will", { v0: type === "in" ? translate("warehouse.increase") : translate("warehouse.deduction"), v1: type === "in" ? translate("warehouse.stock.in") : translate("warehouse.stock.out") })}
      onClose={busy || templateAction.busy ? () => {} : onClose}
      wide
    >
      <AntForm noValidate layout="vertical" scrollToFirstError={{ focus: true }} onFinish={submit}>
        {selection.error && <div role="alert">{selection.error}</div>}<QueryStatus query={contacts} />
        <div className="form-body order-form-body">
          <AntCheckbox className="inactive-product-option" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)}>{translate("warehouse.contains.discontinued.materials.used.for.operations.such.as.inventory.clearance")}</AntCheckbox>

          <Templates collapsible type={type} activeId={template?.id} refreshKey={templateRevision} disabled={busy || templateAction.busy} onUse={d => {
            if ((items.length || note) && !window.confirm(translate("warehouse.applying.the.template.will.replace.the.current.editing.content.do.you"))) return false;
            setTemplate(d); setTemplateName(d.name); setTemplateMessage(""); setPartner(d.partner); setPartnerId(d.partner_id); setNote(d.note); setItems(d.items);
          }} />
          {template && <span className="order-template-status"><FilePenLine size={15} aria-hidden="true" />{translate("warehouse.applied")}{template.name}」<small>{translate("warehouse.this.modification.will.not.automatically.update.the.template.2")}</small></span>}
          {templates && <div className="template-save-panel">
            <label>{translate("warehouse.template.name")}<AntInput value={templateName} maxLength={100} placeholder={translate("warehouse.for.example.weekly.daily.necessities.replenishment")} disabled={busy || templateAction.busy} onChange={e => setTemplateName(e.target.value)} /></label>
            <div className="order-template-actions">
              <Button type="button" icon={FilePenLine} busy={templateAction.busy} disabled={busy || !items.length} onClick={() => saveTemplate(false)}>{template ? translate("warehouse.save.as.template") : translate("warehouse.save.as.template.2")}</Button>
              {template && <Button type="button" busy={templateAction.busy} disabled={busy || !items.length} onClick={() => saveTemplate(true)}>{translate("warehouse.update.template")}</Button>}
            </div>
            {templateMessage && <p className="template-success" role="status">{templateMessage}</p>}
          </div>
          }
          {templateAction.error && <p role="alert" className="form-error">{templateAction.error}</p>}
          <div className="form-grid">
            <ContactPicker contacts={partners} value={partner} selectedId={partnerId} searchable
              label={type === "in" ? translate("warehouse.supplier") : translate("warehouse.customers.correspondence.units")}
              placeholder={type === "in" ? translate("warehouse.select.a.vendor.or.internal.unit") : translate("warehouse.select.client.or.internal.unit")}
              required disabled={busy || templateAction.busy}
              onSelect={contact => { setPartner(contact.name); setPartnerId(contact.id); }} />
            <label>{translate("warehouse.inbound.and.outbound.warehouse")}<AntInput value={data.settings.warehouse_name} disabled />
            </label>
          </div>
          {internal && <p className="info-box">{translate("warehouse.internal.transfers.only.adjust.inventory.and.do.not.include.purchases.sales")}</p>}
          <div className="order-scan-row">
            <Button
              type="button"
              kind="primary"
              icon={Camera}
              onClick={() => setCamera(!camera)}
            >
              {camera ? translate("warehouse.turn.off.camera") : translate("warehouse.scan.code.with.mobile.phone")}
            </Button>
            <div className="input-with-icon">

              <AntInput prefix={<ScanLine size={18} />}
                aria-label={translate("warehouse.scan.material.barcode")}
                placeholder={translate("warehouse.manually.enter.material.barcode")}
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (barcode) scan(barcode);
                  }
                }}
              />
            </div>
            <Button
              type="button"
              icon={Plus}
              disabled={!barcode.trim()}
              onClick={() => scan(barcode)}
            >{translate("warehouse.add")}</Button>
          </div>
          {camera && <CameraScanner onResult={scan} onClose={() => setCamera(false)} />}
          <div className="product-picker">
            <div className="table-search">
              <AntInput prefix={<Search size={16} />} allowClear={{ clearIcon: <X size={14} aria-label={translate("warehouse.clear")} /> }}
                aria-label={translate("warehouse.find.and.add.items")}
                placeholder={translate("warehouse.or.search.for.the.material.name.and.click.add")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />

            </div>
            {query && (
              <div className="picker-results">
                {matches.length ? (
                  matches.map((p) => (
                    <AntButton type="text" key={p.id} htmlType="button" onClick={() => add(p)}>
                      <ProductArt product={p} size="small" preview={false} />
                      <span>
                        <strong>{p.name}{p.active === 0 ? translate("warehouse.deactivated.2") : ""}</strong>
                        <small>
                          {p.barcode}{" "}{translate("warehouse.inventory.2")}{" "}{p.stock} {p.unit}
                        </small>
                      </span>
                      <Plus size={16} />
                    </AntButton>
                  ))
                ) : (
                  <p>{translate("warehouse.material.not.found.please.create.a.material.file.first")}</p>
                )}
              </div>
            )}
          </div>
          {scanMessage && (
            <div className="scan-feedback">
              <CircleCheck size={14} />
              {scanMessage}
            </div>
          )}
          <div className="order-items-title">
            <strong>{translate("warehouse.material.details")}<span>{items.length}</span>
            </strong>
            <small>{translate("warehouse.scan.the.same.material.again.and.the.quantity.will.be.automatically")}</small>
          </div>
          <div className="table-scroll form-table-wrap">
            <table className="data-table form-table">
              <thead>
                <tr>
                  <th>{translate("warehouse.material")}</th>
                  <th style={{ width: 100 }}>{translate("warehouse.quantity")}</th>
                  <th style={{ width: 110 }}>{translate("warehouse.unit.price.3")}{baseCurrency()}）</th>
                  <th className="number-cell">{translate("warehouse.subtotal")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const p = data.products.find((p) => p.id === i.product_id);
                  if (!p) return <tr key={i.product_id}><td colSpan={4}>{translate("warehouse.checking.material")}{i.product_id}{translate("warehouse.if.the.material.has.been.deleted.please.remove.it.and.select")}</td><td><AntButton type="text" htmlType="button" aria-label={translate("warehouse.remove.item", { v0: i.product_id })} onClick={() => setItems(current => current.filter(line => line.product_id !== i.product_id))}><Trash2 size={16} /></AntButton></td></tr>;
                  return (
                    <tr key={i.product_id}>
                      <td>
                        <div className="product-info">
                          <ProductArt product={p} size="small" />
                          <div>
                            <strong>{p.name}{p.active === 0 ? translate("warehouse.deactivated.2") : ""}</strong>
                            <small>{translate("warehouse.stock")}{p.stock} {p.unit}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <FormField value={i.quantity} required type="number" min="0.0001" max="99999999" label={translate("warehouse.quantity.2", { v0: p.name })}><AntInput
                          aria-label={translate("warehouse.quantity.2", { v0: p.name })}
                          type="number"
                          min="0.0001"
                          max="99999999"
                          step="0.0001"
                          value={i.quantity}
                          onBlur={() => { if (p.unit_round_up && validQuantity(Number(i.quantity), true)) update(i.product_id, "quantity", Math.ceil(Number(i.quantity))); }}
                          onChange={(e) =>
                            update(i.product_id, "quantity", e.target.value)
                          }
                        /></FormField>
                      </td>
                      <td>
                        <FormField value={i.price} required type="number" min="0" max="99999999" label={translate("warehouse.unit.price.2", { v0: p.name })}><AntInput
                          aria-label={translate("warehouse.unit.price.2", { v0: p.name })}
                          type="number"
                          min="0"
                          max="99999999"
                          step="0.0001"
                          value={i.price}
                          onChange={(e) =>
                            update(i.product_id, "price", e.target.value)
                          }
                        /></FormField>
                      </td>
                      <td className="number-cell">
                        {baseCurrencySymbol()} {moneyBase(quantityOf(i) * Number(i.price))}
                      </td>
                      <td>
                        <AntButton type="text"
                          htmlType="button"
                          className="icon-button"
                          aria-label={translate("warehouse.remove", { v0: p.name })}
                          onClick={() =>
                            setItems(
                              items.filter(
                                (x) => x.product_id !== i.product_id,
                              ),
                            )
                          }
                        >
                          <X size={15} />
                        </AntButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {!!items.length && (
                <tfoot>
                  <tr className="table-total-row">
                    <td>{translate("warehouse.total")}{" "}{items.length}{" "}{translate("warehouse.materials")}</td>
                    <td className="number-cell">{count(totalQuantity)}</td>
                    <td />
                    <td className="number-cell">{baseCurrencySymbol()} {moneyBase(total)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
            {!items.length && (
              <div className="order-form-empty">
                <ScanLine size={25} />
                <span>{translate("warehouse.scan.the.qr.code.or.search.to.add.the.first.item.2")}</span>
              </div>
            )}
          </div>
          <label className="note-label">{translate("warehouse.remarks")}<AntInput.TextArea
              maxLength={500}
              rows={2}
              placeholder={translate("warehouse.optional.record.the.supplementary.information.of.this.entry.and.exit")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {error && (
            <div className="form-error" role="alert">
              <TriangleAlert size={16} />
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer order-form-footer">
          <div>
            <small>{translate("warehouse.material.type")}</small>
            <strong>
              {items.length}
              <span>{" "}{translate("warehouse.types")}</span>
            </strong>
          </div>
          <div>
            <Button type="button" onClick={onClose} disabled={busy}>{translate("warehouse.cancel")}</Button>
            <Button
              type="submit"
              kind="primary"
              icon={Check} busy={busy}
              disabled={busy || templateAction.busy || !items.length}
            >
              {busy ? translate("warehouse.submitting") : translate("warehouse.confirm.2", { v0: type === "in" ? translate("warehouse.stock.in") : translate("warehouse.stock.out") })}
            </Button>
          </div>
        </div>
      </AntForm>
    </Modal>
  );
}

export { OrderForm };
