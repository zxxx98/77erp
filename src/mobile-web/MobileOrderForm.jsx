import { t as translate, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { ConfigProvider as AntConfigProvider, Form as AntForm } from 'antd';
import { Input as AntInput } from '../ui/controls.jsx';

import { FormField } from './../ui/FormField.jsx';

import { contactMatchesDirection } from '../../shared/contacts.js';
import { useQuery } from '../queries.js';
import { lookupProductCode, useProductSelection } from '../product-query.js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, FilePenLine, Minus, Plus, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { usePermissions } from '../permissions.jsx';
import { ContactPicker } from '../Dropdown.jsx';
import { Templates } from '../LazyComponents.jsx';
import { useBusiness } from '../business-api.js';
import { addQuantity, parseQuantity, materialQuantity, validQuantity } from '../../shared/quantity.js';
import { draftScope, localId, removeDraft, saveDraft } from '../pwa/drafts.js';
import { usePwa } from '../pwa/Pwa.jsx';
import { MobileButton as Button, MobileIcon, Notice, SearchField, ProductRow, moneyBase, count } from './ui.jsx';

export function MobileOrderForm({ type, initialProduct, initialTemplate, initialDraft, data, userId, Modal, CameraScanner, onClose, onSaved }) {
  useLocale();
  const { templates: manageTemplates } = usePermissions();
  const { online } = usePwa();
  const scope = useMemo(() => draftScope(userId, data.instance_id, data.warehouse_id), [userId, data.instance_id, data.warehouse_id]);
  const [id] = useState(() => initialDraft?.id || localId());
  const [template, setTemplate] = useState(initialDraft?.template || initialTemplate || null);
  const [templateName, setTemplateName] = useState(initialDraft?.templateName || initialTemplate?.name || '');
  const [templateRevision, setTemplateRevision] = useState(0);
  const [templateMessage, setTemplateMessage] = useState('');
  const [partner, setPartner] = useState(initialDraft?.partner ?? initialTemplate?.partner ?? (type === 'out' ? '零售客户' : ''));
  const [partnerId, setPartnerId] = useState(initialDraft?.partnerId ?? initialTemplate?.partner_id ?? null);
  const [note, setNote] = useState(initialDraft?.note ?? initialTemplate?.note ?? '');
  const snapshot = (p, line = {}) => ({ product_id: p.id, name: p.name, barcode: p.barcode, unit: p.unit, version: p.version, quantity: line.quantity ?? 1, price: line.price ?? (type === 'in' ? p.cost : p.price) });
  const [items, setItems] = useState(() => initialDraft?.items || (initialTemplate ? initialTemplate.items.map(line => {
    const p = data.products.find(p => p.id === line.product_id);
    return p ? snapshot(p, line) : { ...line, name: line.name || translate("warehouse.reading.material") };
  }) : initialProduct ? [snapshot(initialProduct)] : []));
  const [pending, setPending] = useState(initialDraft?.pending || null);
  const [query, setQuery] = useState('');
  const [barcode, setBarcode] = useState('');
  const [camera, setCamera] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(false);
  const selection = useProductSelection(data, items, query, includeInactive, initialProduct);
  const contacts = useQuery('/contacts', data);
  data = { ...data, products: selection.products, contacts: contacts.result || [] };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState({ message: '', revision: 0 });
  const [storageError, setStorageError] = useState('');
  const [savedAt, setSavedAt] = useState(initialDraft?.updatedAt || null);
  const [confirming, setConfirming] = useState(false);
  const [closing, setClosing] = useState(false);
  const [savingClose, setSavingClose] = useState(false);
  const lock = useRef(false), finished = useRef(false), hasSaved = useRef(!!initialDraft), latest = useRef(null), latestDirty = useRef(false), bodyRef = useRef(null), barcodeInput = useRef(null);
  const templateAction = useBusiness();
  const reportError = message => setError(value => ({ message, revision: value.revision + 1 }));
  const total = items.reduce((sum, line) => sum + Math.round((data.products.find(p => p.id === line.product_id)?.unit_round_up ? Math.ceil(Number(line.quantity)) : Number(line.quantity)) * Number(line.price) * 100), 0) / 100;
  const totalQuantity = items.reduce((sum, line) => sum + ((data.products.find(p => p.id === line.product_id)?.unit_round_up ? Math.ceil(Number(line.quantity)) : Number(line.quantity)) || 0), 0);
  const dirty = !!(items.length || note || (partner && partner !== (type === 'out' ? '零售客户' : '')) || pending);
  const disabled = busy || templateAction.busy || !!pending;
  const draft = { id, type, partner, partnerId, note, items, template: template ? { id: template.id, version: template.version, name: template.name } : null, templateName, pending };
  latest.current = draft;
  latestDirty.current = dirty;

  const persist = async value => {
    if (finished.current) return;
    const saved = await saveDraft(scope, value);
    hasSaved.current = true;
    if (!finished.current) { setSavedAt(saved.updatedAt); setStorageError(''); }
    return saved;
  };
  useEffect(() => {
    if (!dirty && !hasSaved.current) return;
    const timer = setTimeout(() => { persist(latest.current).catch(e => { if (!finished.current) setStorageError(e.message); }); }, 350);
    return () => clearTimeout(timer);
  }, [partner, partnerId, note, items, template, templateName, pending]);
  useEffect(() => {
    const flush = () => { if (!finished.current && (latestDirty.current || hasSaved.current)) saveDraft(scope, latest.current).catch(() => {}); };
    const visibility = () => { if (document.visibilityState === 'hidden') flush(); };
    const logout = () => { finished.current = true; };
    window.addEventListener('pagehide', flush);
    window.addEventListener('erp:logout', logout);
    document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('pagehide', flush); window.removeEventListener('erp:logout', logout); document.removeEventListener('visibilitychange', visibility); flush(); };
  }, [scope]);
  useEffect(() => { if (error.message) bodyRef.current?.querySelector('[role="alert"]')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [error]);
  useEffect(() => { if (!online) setCamera(false); }, [online]);

  const add = product => {
    if (disabled) return;
    selection.remember(product);
    const found = items.find(line => line.product_id === product.id);
    if (!found && items.length >= 100) { reportError(translate("warehouse.a.maximum.of.100.materials.can.be.added.to.one.document")); return; }
    try {
      setItems(found ? items.map(line => line === found ? { ...line, quantity: addQuantity(parseQuantity(line.quantity), 1) } : line) : [...items, snapshot(product)]);
      setQuery(''); setBarcode(''); reportError('');
    } catch (e) { reportError(e.message); }
  };
  const scan = async code => {
    setCamera(false);
    try {
      const product = await lookupProductCode(code, data);
      if (!product) throw new Error(translate("warehouse.the.barcode.was.not.found.please.create.a.material.file.first", { v0: code.trim() }));
      add(product);
    } catch (e) { reportError(e.message); }
  };
  const update = (productId, key, value) => setItems(current => current.map(line => line.product_id === productId ? { ...line, [key]: value } : line));
  useEffect(() => {
    setItems(current => current.map(line => {
      const product = selection.products.find(p => p.id === line.product_id);
      return product && !line.version ? snapshot(product, line) : line;
    }));
  }, [selection.products.map(p => `${p.id}:${p.version}`).join(',')]);
  const stale = items.filter(line => { const p = data.products.find(p => p.id === line.product_id); return p && line.version && line.version !== p.version; });
  const payload = () => {
    if (!partner.trim() || partner.length > 100) throw new Error(translate("warehouse.please.fill.in.the.correspondence.unit.of.1.100.words"));
    if (note.length > 500) throw new Error(translate("warehouse.notes.can.be.up.to.500.words"));
    if (!items.length || items.length > 100) throw new Error(translate("warehouse.please.add.1.100.items"));
    if (stale.length) throw new Error(translate("warehouse.the.material.information.has.changed.please.check.the.latest.file.before"));
    const seen = new Set();
    return { type, partner: partner.trim(), ...(partnerId ? { partner_id: partnerId } : {}), note, items: items.map(line => {
      const p = data.products.find(p => p.id === line.product_id);
      if (!p) throw new Error(translate("warehouse.no.longer.exists.please.remove.it.and.select.again", { v0: line.name || translate("warehouse.material") }));
      if (seen.has(p.id)) throw new Error(translate("warehouse.the.same.material.cannot.be.added.repeatedly"));
      seen.add(p.id);
      const quantity = materialQuantity(parseQuantity(line.quantity, true), p), price = Number(line.price);
      if (!/^\d+(\.\d{1,4})?$/.test(String(line.price).trim()) || !Number.isFinite(price) || price > 99999999) throw new Error(translate("warehouse.the.unit.price.must.be.a.non.negative.amount.with.up", { v0: p.name }));
      if (type === 'out' && quantity > p.stock) throw new Error(translate("warehouse.is.out.of.stock.currently", { v0: p.name, v1: count(p.stock), v2: p.unit }));
      return { product_id: p.id, quantity, price };
    }) };
  };
  const confirm = () => {

    if (disabled) return;
    try { payload(); reportError(''); setCamera(false); setConfirming(true); }
    catch (e) { reportError(e.message); }
  };
  const submit = async () => {
    if (lock.current || templateAction.busy) return;
    if (!navigator.onLine) { reportError(translate("warehouse.currently.offline.please.connect.to.the.internet.to.confirm")); return; }
    lock.current = true; setBusy(true); setConfirming(false); reportError('');
    let receipt, request = pending, sent = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      if (!request) request = { body: { ...payload(), request_id: localId() } };
      // Persist the exact request before sending it; never replace its ID after an ambiguous response.
      await persist({ ...latest.current, pending: request });
      setPending(request); latest.current = { ...latest.current, pending: request };
      sent = true;
      receipt = await api('/orders', { method: 'POST', warehouseId: scope.warehouseId, body: request.body, signal: controller.signal });
    } catch (e) {
      if (e.status === 400 || e.status === 409 || e.status === 422) {
        setPending(null); latest.current = { ...latest.current, pending: null };
        await persist(latest.current).catch(storage => setStorageError(storage.message));
        reportError(e.message);
      } else if (!sent) {
        reportError(e.message);
      } else {
        // 401/403 can follow an earlier committed request: keep the receipt key until reauthenticated.
        setPending(request); latest.current = { ...latest.current, pending: request };
        reportError(translate("warehouse.submission.results.are.pending.confirmation", { v0: e.status ? e.message : translate("warehouse.the.network.response.is.not.completed.please.check.the.original.submission") }));
      }
    } finally { clearTimeout(timeout); lock.current = false; setBusy(false); }
    if (receipt) {
      finished.current = true;
      let message = translate("warehouse.document.saved", { v0: receipt.number });
      try { await removeDraft(scope, id); }
      catch { message += translate("warehouse.local.draft.cleanup.failed.please.check.it.in.the.draft.and"); }
      await onSaved(message);
    }
  };
  const saveTemplate = overwrite => templateAction.run(async () => {
    if (pending) return;
    const body = payload();
    const result = await templateAction.send('/templates', { ...(overwrite && template ? { id: template.id, version: template.version } : {}), name: templateName, type, partner: body.partner, partner_id: partnerId, note, items: body.items });
    setTemplate(result); setTemplateName(result.name); setTemplateRevision(value => value + 1); setTemplateMessage(translate("warehouse.template.has.been.saved.and.can.be.applied.repeatedly", { v0: result.name }));
  });
  const close = () => {
    if (lock.current || templateAction.busy || savingClose) return;
    if (dirty || hasSaved.current) setClosing(true);
    else { finished.current = true; onClose(); }
  };
  const leave = async discard => {
    if (savingClose) return;
    setSavingClose(true);
    try {
      if (discard && pending) throw new Error(translate("warehouse.please.check.pending.submission.results.first"));
      if (discard) await removeDraft(scope, id);
      else await persist(latest.current);
      finished.current = true; onClose();
    } catch (e) { setClosing(false); reportError(e.message); }
    finally { setSavingClose(false); }
  };
  const partners = (data.contacts || []).filter(c => c.active && contactMatchesDirection(c, type));
  const internal = partners.find(c => c.id === partnerId)?.role === 'internal';
  const matches = query.trim() ? selection.matches : [];

  return <>
    <Modal title={internal ? (type === 'in' ? translate("warehouse.internal.stock.in") : translate("warehouse.internal.stock.out")) : type === 'in' ? translate("warehouse.stock.in") : translate("warehouse.stock.out")} subtitle={data.settings.warehouse_name} className="mw-order-modal" onClose={close}>
      <AntForm noValidate layout="vertical" scrollToFirstError={{ focus: true }} onFinish={confirm} className="mw-order-form">
        <div ref={bodyRef} className="form-body mw-stack mw-order-body">
          <Notice>{error.message || selection.error || contacts.error}</Notice><Notice>{storageError}</Notice>
          <p className="mw-muted" aria-live="polite">{savedAt ? translate("warehouse.draft.saved", { v0: new Date(savedAt).toLocaleTimeString(getFormatLocale(), { hour12: false }) }) : translate("warehouse.local.drafts.are.automatically.saved")}</p>
          {pending && <section className="mw-card mw-stack"><h2>{translate("warehouse.submit.results.to.be.confirmed")}</h2><p>{translate("warehouse.the.content.of.the.original.document.will.be.retained.and.no")}</p><Button primary busy={busy} disabled={!online} onClick={submit}>{translate("warehouse.check.and.retry.the.original.commit")}</Button></section>}
          {!!stale.length && !pending && <section className="mw-card mw-stack"><Notice>{translate("warehouse.the.material.data.has.changed")}{stale.map(line => line.name).join('、')}{translate("warehouse.please.check.the.materials.and.transaction.price")}</Notice><Button onClick={() => setItems(current => current.map(line => { const p = data.products.find(p => p.id === line.product_id); return p ? { ...line, name: p.name, barcode: p.barcode, unit: p.unit, version: p.version } : line; }))}>{translate("warehouse.continue.checking.with.the.latest.file")}</Button></section>}
          <AntConfigProvider componentDisabled={disabled}><fieldset disabled={disabled} className="mw-stack mw-fieldset">
            {online && <Templates collapsible type={type} activeId={template?.id} refreshKey={templateRevision} disabled={disabled} onUse={selected => {
              if (items.length && !window.confirm(translate("warehouse.applying.the.template.will.replace.the.current.editing.content.do.you"))) return false;
              setTemplate(selected); setTemplateName(selected.name); setTemplateMessage(''); setPartner(selected.partner); setPartnerId(selected.partner_id); setNote(selected.note);
              setItems(selected.items.map(line => { const p = data.products.find(p => p.id === line.product_id); return p ? snapshot(p, line) : { ...line, name: line.name || translate("warehouse.reading.material") }; }));
            }} />}
            {template && <p className="mw-muted">{translate("warehouse.applied")}{template.name}{translate("warehouse.this.modification.will.not.automatically.update.the.template")}</p>}
            {manageTemplates && <section className="mw-card mw-stack"><label className="mw-field">{translate("warehouse.template.name")}<AntInput maxLength={100} placeholder={translate("warehouse.for.example.weekly.daily.necessities.replenishment")} value={templateName} onChange={e => setTemplateName(e.target.value)} /></label><Button icon={FilePenLine} busy={templateAction.busy} disabled={!online || !items.length} onClick={() => saveTemplate(false)}>{template ? translate("warehouse.save.as.template") : translate("warehouse.save.as.template.2")}</Button>{template && <Button busy={templateAction.busy} disabled={!online || !items.length} onClick={() => saveTemplate(true)}>{translate("warehouse.update.template")}</Button>}{templateMessage && <p className="mw-muted" role="status">{templateMessage}</p>}<Notice>{templateAction.error}</Notice></section>}
            <ContactPicker contacts={partners} value={partner} selectedId={partnerId} searchable label={type === 'in' ? translate("warehouse.supplier") : translate("warehouse.customers.correspondence.units")} required disabled={disabled} onSelect={contact => { setPartner(contact.name); setPartnerId(contact.id); }} />
            {internal && <p className="mw-muted">{translate("warehouse.internal.transfers.only.adjust.inventory.and.do.not.include.purchases.sales")}</p>}
            <Button primary icon={Camera} disabled={!online} onClick={() => setCamera(value => !value)}>{camera ? translate("warehouse.turn.off.camera") : translate("warehouse.scan.code.to.add.materials")}</Button>
            {camera && <CameraScanner onResult={scan} onClose={() => setCamera(false)} title={translate("warehouse.scan.code.to.add.materials")} note={translate("warehouse.automatically.added.to.the.current.document.after.recognition")}
              onManual={() => { setCamera(false); requestAnimationFrame(() => barcodeInput.current?.focus()); }} />}
            <label className="mw-field">{translate("warehouse.manually.enter.material.barcode")}<div className="mw-manual-row"><AntInput ref={barcodeInput} aria-label={translate("warehouse.scan.material.barcode")} value={barcode} onChange={e => setBarcode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (barcode.trim()) scan(barcode); } }} /><Button disabled={!online || !barcode.trim()} onClick={() => scan(barcode)}>{translate("warehouse.add")}</Button></div></label>
            <SearchField label={translate("warehouse.search.for.items.or.barcodes.to.add")} value={query} onChange={setQuery} />
            {!!query.trim() && <section className="mw-card">{online ? matches.length ? matches.map(p => <ProductRow key={p.id} product={p} onOpen={add} />) : <p className="mw-muted">{translate("warehouse.material.not.found.please.create.a.material.file.first")}</p> : <p className="mw-muted">{translate("warehouse.after.connecting.to.the.internet.you.can.query.and.add.materials")}</p>}</section>}
            <Button onClick={() => setIncludeInactive(value => !value)}>{includeInactive ? translate("warehouse.hide.deactivated.materials") : translate("warehouse.contains.discontinued.materials.clearance.of.inventory.etc")}</Button>
            {!items.length && <section className="mw-card"><p className="mw-muted">{translate("warehouse.scan.the.qr.code.or.search.to.add.the.first.item")}</p></section>}
            {items.map(line => {
              const p = data.products.find(p => p.id === line.product_id);
              const name = p?.name || line.name || translate("warehouse.the.material.no.longer.exists");
              return <section key={line.product_id} className="mw-card mw-stack"><div className="mw-between"><div><strong>{name}{p?.active === 0 ? translate("warehouse.deactivated.2") : ''}</strong><p className="mw-muted">{p ? translate("warehouse.available.inventory", { v0: count(p.stock), v1: p.unit }) : translate("warehouse.the.material.no.longer.exists.please.remove.it")}</p></div><MobileIcon icon={Trash2} label={translate("warehouse.remove", { v0: name })} onClick={() => setItems(current => current.filter(item => item.product_id !== line.product_id))} /></div><div className="mw-columns"><label className="mw-field">{translate("warehouse.quantity")}<FormField value={line.quantity} required type="number" min="0.0001" max="99999999" label={translate("warehouse.quantity.2", { v0: name })}><AntInput type="number" inputMode="decimal" min="0.0001" max="99999999" step="0.0001"  aria-label={translate("warehouse.quantity.2", { v0: name })} value={line.quantity} onBlur={() => { if (p?.unit_round_up && validQuantity(Number(line.quantity), true)) update(line.product_id, "quantity", Math.ceil(Number(line.quantity))); }} onChange={e => update(line.product_id, 'quantity', e.target.value)} /></FormField></label><label className="mw-field">{translate("warehouse.unit.price")}<FormField value={line.price} required type="number" min="0" max="99999999" label={translate("warehouse.unit.price.2", { v0: name })}><AntInput type="number" inputMode="decimal" min="0" max="99999999" step="0.0001"  aria-label={translate("warehouse.unit.price.2", { v0: name })} value={line.price} onChange={e => update(line.product_id, 'price', e.target.value)} /></FormField></label></div><div className="mw-between"><div className="mw-inline"><MobileIcon icon={Minus} label={translate("warehouse.reduce.the.number.of", { v0: name })} onClick={() => update(line.product_id, 'quantity', Math.max(0.0001, addQuantity(Number(line.quantity) || 0, -1)))} /><MobileIcon icon={Plus} label={translate("warehouse.increase.quantity", { v0: name })} onClick={() => update(line.product_id, 'quantity', addQuantity(Number(line.quantity) || 0, 1))} /></div><strong>{moneyBase(Math.round((data.products.find(p => p.id === line.product_id)?.unit_round_up ? Math.ceil(Number(line.quantity)) : Number(line.quantity)) * Number(line.price) * 100) / 100)}</strong></div></section>;
            })}
            <label className="mw-field">{translate("warehouse.remarks.optional")}<AntInput.TextArea rows={3} maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></label>
          </fieldset></AntConfigProvider>
        </div>
        <div className="modal-footer mw-stack"><div className="mw-between"><span className="mw-muted">{items.length}{" "}{translate("warehouse.kind.of.material.total.quantity")}{" "}{count(totalQuantity)}</span><h2>{moneyBase(total)}</h2></div><Button type="submit" primary icon={Check} busy={busy} disabled={!items.length || !!pending || templateAction.busy || !online}>{translate("warehouse.confirm")}{type === 'in' ? translate("warehouse.stock.in") : translate("warehouse.stock.out")}</Button></div>
      </AntForm>
    </Modal>
    {confirming && <Modal title={internal ? (type === 'in' ? translate("warehouse.confirm.internal.storage") : translate("warehouse.confirm.internal.shipment")) : type === 'in' ? translate("warehouse.confirm.storage") : translate("warehouse.confirm.delivery")} className="mw-confirm" onClose={() => setConfirming(false)}><div className="form-body mw-stack"><p>{items.length}{" "}{translate("warehouse.materials.total")}{" "}{moneyBase(total)}{translate("warehouse.inventory.will.be.updated.immediately.upon.confirmation")}</p><p className="mw-muted">{data.settings.warehouse_name} · {partner}</p></div><div className="modal-footer mw-stack"><Button onClick={() => setConfirming(false)}>{translate("warehouse.continue.editing")}</Button><Button primary disabled={!online || busy} onClick={submit}>{translate("warehouse.confirm.submission")}</Button></div></Modal>}
    {closing && <Modal title={pending ? translate("warehouse.save.documents.pending.verification") : translate("warehouse.save.local.draft")} className="mw-confirm" onClose={() => !savingClose && setClosing(false)}><div className="form-body"><p>{pending ? translate("warehouse.the.submission.result.has.not.been.confirmed.yet.please.keep.the") : translate("warehouse.after.saving.you.can.continue.editing.from.more.local.draft")}</p></div><div className="modal-footer mw-stack"><Button primary busy={savingClose} onClick={() => leave(false)}>{translate("warehouse.save.draft.and.close")}</Button>{!pending && <Button danger disabled={savingClose} onClick={() => leave(true)}>{translate("warehouse.abandon.draft")}</Button>}<Button disabled={savingClose} onClick={() => setClosing(false)}>{translate("warehouse.continue.editing")}</Button></div></Modal>}
  </>;
}
