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
    return p ? snapshot(p, line) : { ...line, name: line.name || '正在读取物料' };
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
    if (!found && items.length >= 100) { reportError('一张单据最多添加 100 种物料。'); return; }
    try {
      setItems(found ? items.map(line => line === found ? { ...line, quantity: addQuantity(parseQuantity(line.quantity), 1) } : line) : [...items, snapshot(product)]);
      setQuery(''); setBarcode(''); reportError('');
    } catch (e) { reportError(e.message); }
  };
  const scan = async code => {
    setCamera(false);
    try {
      const product = await lookupProductCode(code, data);
      if (!product) throw new Error(`未找到条码「${code.trim()}」，请先建立物料档案。`);
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
    if (!partner.trim() || partner.length > 100) throw new Error('请填写 1–100 字的往来单位。');
    if (note.length > 500) throw new Error('备注最多 500 字。');
    if (!items.length || items.length > 100) throw new Error('请添加 1–100 种物料。');
    if (stale.length) throw new Error('物料资料已变化，请核对最新档案后继续。');
    const seen = new Set();
    return { type, partner: partner.trim(), ...(partnerId ? { partner_id: partnerId } : {}), note, items: items.map(line => {
      const p = data.products.find(p => p.id === line.product_id);
      if (!p) throw new Error(`「${line.name || '物料'}」已不存在，请移除后重新选择。`);
      if (seen.has(p.id)) throw new Error('同一物料不能重复添加。');
      seen.add(p.id);
      const quantity = materialQuantity(parseQuantity(line.quantity, true), p), price = Number(line.price);
      if (!/^\d+(\.\d{1,4})?$/.test(String(line.price).trim()) || !Number.isFinite(price) || price > 99999999) throw new Error(`${p.name} 单价需为非负金额，最多四位小数。`);
      if (type === 'out' && quantity > p.stock) throw new Error(`${p.name} 库存不足（当前 ${count(p.stock)} ${p.unit}）。`);
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
    if (!navigator.onLine) { reportError('当前离线，请联网后确认。'); return; }
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
        reportError(`提交结果待确认。${e.status ? e.message : '网络响应未完成，请联网后核对原提交。'}`);
      }
    } finally { clearTimeout(timeout); lock.current = false; setBusy(false); }
    if (receipt) {
      finished.current = true;
      let message = `单据 ${receipt.number} 已保存`;
      try { await removeDraft(scope, id); }
      catch { message += '；本地草稿清理失败，请在草稿中核对后清理。'; }
      await onSaved(message);
    }
  };
  const saveTemplate = overwrite => templateAction.run(async () => {
    if (pending) return;
    const body = payload();
    const result = await templateAction.send('/templates', { ...(overwrite && template ? { id: template.id, version: template.version } : {}), name: templateName, type, partner: body.partner, partner_id: partnerId, note, items: body.items });
    setTemplate(result); setTemplateName(result.name); setTemplateRevision(value => value + 1); setTemplateMessage(`模板「${result.name}」已保存，可反复套用`);
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
      if (discard && pending) throw new Error('请先核对待确认的提交结果。');
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
    <Modal title={internal ? (type === 'in' ? '内部入库' : '内部出库') : type === 'in' ? '入库' : '出库'} subtitle={data.settings.warehouse_name} className="mw-order-modal" onClose={close}>
      <AntForm noValidate layout="vertical" scrollToFirstError={{ focus: true }} onFinish={confirm} className="mw-order-form">
        <div ref={bodyRef} className="form-body mw-stack mw-order-body">
          <Notice>{error.message || selection.error || contacts.error}</Notice><Notice>{storageError}</Notice>
          <p className="mw-muted" aria-live="polite">{savedAt ? `草稿已保存 · ${new Date(savedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : '本地草稿自动保存'}</p>
          {pending && <section className="mw-card mw-stack"><h2>提交结果待确认</h2><p>保留原单据内容，核对时不会重复开单。</p><Button primary busy={busy} disabled={!online} onClick={submit}>核对并重试原提交</Button></section>}
          {!!stale.length && !pending && <section className="mw-card mw-stack"><Notice>物料资料已变化：{stale.map(line => line.name).join('、')}。请核对物料与成交单价。</Notice><Button onClick={() => setItems(current => current.map(line => { const p = data.products.find(p => p.id === line.product_id); return p ? { ...line, name: p.name, barcode: p.barcode, unit: p.unit, version: p.version } : line; }))}>使用最新档案继续核对</Button></section>}
          <AntConfigProvider componentDisabled={disabled}><fieldset disabled={disabled} className="mw-stack mw-fieldset">
            {online && <Templates collapsible type={type} activeId={template?.id} refreshKey={templateRevision} disabled={disabled} onUse={selected => {
              if (items.length && !window.confirm('套用模板将替换当前编辑内容，是否继续？')) return false;
              setTemplate(selected); setTemplateName(selected.name); setTemplateMessage(''); setPartner(selected.partner); setPartnerId(selected.partner_id); setNote(selected.note);
              setItems(selected.items.map(line => { const p = data.products.find(p => p.id === line.product_id); return p ? snapshot(p, line) : { ...line, name: line.name || '正在读取物料' }; }));
            }} />}
            {template && <p className="mw-muted">已套用「{template.name}」，本次修改不会自动更新模板。</p>}
            {manageTemplates && <section className="mw-card mw-stack"><label className="mw-field">模板名称<AntInput maxLength={100} placeholder="例如：每周日用品补货" value={templateName} onChange={e => setTemplateName(e.target.value)} /></label><Button icon={FilePenLine} busy={templateAction.busy} disabled={!online || !items.length} onClick={() => saveTemplate(false)}>{template ? '另存为模板' : '保存为模板'}</Button>{template && <Button busy={templateAction.busy} disabled={!online || !items.length} onClick={() => saveTemplate(true)}>更新模板</Button>}{templateMessage && <p className="mw-muted" role="status">{templateMessage}</p>}<Notice>{templateAction.error}</Notice></section>}
            <ContactPicker contacts={partners} value={partner} selectedId={partnerId} searchable label={type === 'in' ? '供应商' : '客户 / 往来单位'} required disabled={disabled} onSelect={contact => { setPartner(contact.name); setPartnerId(contact.id); }} />
            {internal && <p className="mw-muted">内部流转仅调整库存，不计入采购额、销售额、利润及应收应付。入库单价用于库存计价。</p>}
            <Button primary icon={Camera} disabled={!online} onClick={() => setCamera(value => !value)}>{camera ? '关闭摄像头' : '扫码添加物料'}</Button>
            {camera && <CameraScanner onResult={scan} onClose={() => setCamera(false)} title="扫码添加物料" note="识别后自动添加到当前单据"
              onManual={() => { setCamera(false); requestAnimationFrame(() => barcodeInput.current?.focus()); }} />}
            <label className="mw-field">手动输入物料条码<div className="mw-manual-row"><AntInput ref={barcodeInput} aria-label="扫描物料条码" value={barcode} onChange={e => setBarcode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (barcode.trim()) scan(barcode); } }} /><Button disabled={!online || !barcode.trim()} onClick={() => scan(barcode)}>添加</Button></div></label>
            <SearchField label="搜索要添加的物料或条码" value={query} onChange={setQuery} />
            {!!query.trim() && <section className="mw-card">{online ? matches.length ? matches.map(p => <ProductRow key={p.id} product={p} onOpen={add} />) : <p className="mw-muted">未找到物料，请先建立物料档案。</p> : <p className="mw-muted">联网后可以查询并添加物料。</p>}</section>}
            <Button onClick={() => setIncludeInactive(value => !value)}>{includeInactive ? '隐藏停用物料' : '包含停用物料（清库存等）'}</Button>
            {!items.length && <section className="mw-card"><p className="mw-muted">扫码或搜索，添加第一件物料。</p></section>}
            {items.map(line => {
              const p = data.products.find(p => p.id === line.product_id);
              const name = p?.name || line.name || '物料已不存在';
              return <section key={line.product_id} className="mw-card mw-stack"><div className="mw-between"><div><strong>{name}{p?.active === 0 ? '（已停用）' : ''}</strong><p className="mw-muted">{p ? `可用库存 ${count(p.stock)} ${p.unit}` : '物料已不存在，请移除'}</p></div><MobileIcon icon={Trash2} label={`移除 ${name}`} onClick={() => setItems(current => current.filter(item => item.product_id !== line.product_id))} /></div><div className="mw-columns"><label className="mw-field">数量<FormField value={line.quantity} required type="number" min="0.0001" max="99999999" label={`${name} 数量`}><AntInput type="number" inputMode="decimal" min="0.0001" max="99999999" step="0.0001"  aria-label={`${name} 数量`} value={line.quantity} onBlur={() => { if (p?.unit_round_up && validQuantity(Number(line.quantity), true)) update(line.product_id, "quantity", Math.ceil(Number(line.quantity))); }} onChange={e => update(line.product_id, 'quantity', e.target.value)} /></FormField></label><label className="mw-field">单价<FormField value={line.price} required type="number" min="0" max="99999999" label={`${name} 单价`}><AntInput type="number" inputMode="decimal" min="0" max="99999999" step="0.0001"  aria-label={`${name} 单价`} value={line.price} onChange={e => update(line.product_id, 'price', e.target.value)} /></FormField></label></div><div className="mw-between"><div className="mw-inline"><MobileIcon icon={Minus} label={`减少 ${name} 数量`} onClick={() => update(line.product_id, 'quantity', Math.max(0.0001, addQuantity(Number(line.quantity) || 0, -1)))} /><MobileIcon icon={Plus} label={`增加 ${name} 数量`} onClick={() => update(line.product_id, 'quantity', addQuantity(Number(line.quantity) || 0, 1))} /></div><strong>{moneyBase(Math.round((data.products.find(p => p.id === line.product_id)?.unit_round_up ? Math.ceil(Number(line.quantity)) : Number(line.quantity)) * Number(line.price) * 100) / 100)}</strong></div></section>;
            })}
            <label className="mw-field">备注（选填）<AntInput.TextArea rows={3} maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></label>
          </fieldset></AntConfigProvider>
        </div>
        <div className="modal-footer mw-stack"><div className="mw-between"><span className="mw-muted">{items.length} 种物料 · 总量 {count(totalQuantity)}</span><h2>{moneyBase(total)}</h2></div><Button type="submit" primary icon={Check} busy={busy} disabled={!items.length || !!pending || templateAction.busy || !online}>确认{type === 'in' ? '入库' : '出库'}</Button></div>
      </AntForm>
    </Modal>
    {confirming && <Modal title={internal ? (type === 'in' ? '确认内部入库？' : '确认内部出库？') : type === 'in' ? '确认入库？' : '确认出库？'} className="mw-confirm" onClose={() => setConfirming(false)}><div className="form-body mw-stack"><p>{items.length} 种物料，合计 {moneyBase(total)}。确认后立即更新库存。</p><p className="mw-muted">{data.settings.warehouse_name} · {partner}</p></div><div className="modal-footer mw-stack"><Button onClick={() => setConfirming(false)}>继续编辑</Button><Button primary disabled={!online || busy} onClick={submit}>确认提交</Button></div></Modal>}
    {closing && <Modal title={pending ? '保存待核对单据？' : '保存本地草稿？'} className="mw-confirm" onClose={() => !savingClose && setClosing(false)}><div className="form-body"><p>{pending ? '提交结果尚未确认，请保留草稿，联网后核对原提交。' : '保存后可从“更多 → 本地草稿”继续编辑。'}</p></div><div className="modal-footer mw-stack"><Button primary busy={savingClose} onClick={() => leave(false)}>保存草稿并关闭</Button>{!pending && <Button danger disabled={savingClose} onClick={() => leave(true)}>放弃草稿</Button>}<Button disabled={savingClose} onClick={() => setClosing(false)}>继续编辑</Button></div></Modal>}
  </>;
}
