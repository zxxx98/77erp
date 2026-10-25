import { localizeError } from './i18n/errors.js';
import { t as translate, getFormatLocale, translateText } from './i18n/index.js';
import { useLocale } from './i18n/react.jsx';
import { FormField } from './ui/FormField.jsx';
import { Form as AntForm } from 'antd';
import { Checkbox as AntCheckbox, Input as AntInput, Button as AntButton } from './ui/controls.jsx';

import { chartTypeLabels, metricLabels } from './i18n/production-display.js';
import { orderLabel } from './order-utils.js';
import React, { useEffect, useRef, useState } from 'react';
import { api, getWarehouseId } from './api.js';
import { parseCSV } from './data-files.js';
import { readAiImage } from './ai-images.js';
import { ProductImage } from './ProductImage.jsx';
import { AI_IMAGE_TYPES, AI_IMAGE_MAX_COUNT, AI_IMAGE_ONLY_MESSAGE } from '../shared/ai-images.js';
import { Sparkles, Plus, ImagePlus, ArrowUp, ArrowUpRight, PackageSearch, ChartColumn, ArrowLeftRight, FileSpreadsheet, Copy, Check, X, History, LoaderCircle, ShieldCheck } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './ai.css';
import { moneyBase, priceBase, baseCurrencySymbol } from './app/format.js';

const AiChartView=React.lazy(()=>import('./pages/QualityChartView.jsx').then(module=>({default:module.QualityChartView})));

const AI_STAGES = () => [translate("system.understanding.your.needs"), translate("system.querying.business.data"), translate("system.checking.and.organizing.answers")];

export function AiSettings({ onBusy = () => {} }) {
  useLocale();
  const [form, setForm] = useState(null), [error, setError] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState(false), [audit, setAudit] = useState(null);
  const lock = useRef(false);
  useEffect(() => { let alive = true; api('/settings/ai').then(c => { if (alive) setForm({ ...c, secret: '' }); }).catch(e => { if (alive) setError(localizeError(e.message)); }); return () => { alive = false; }; }, []);
  const run = async test => {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusy(true); setError(''); setStatus('');
    try {
      const c = await api('/settings/ai', { method: 'PUT', body: form });
      setForm({ ...c, secret: '' });
      if (test) await api('/settings/ai/test', { method: 'POST', body: {} });
      setStatus(test ? translate("system.the.configuration.was.saved.and.the.connection.test.was.successful") : translate("system.ai.settings.saved"));
    } catch (e) { setError(localizeError(e.message)); }
    finally { lock.current = false; setBusy(false); onBusy(false); }
  };
  return <section className="ai-settings">
    <h3>{translate("system.ai.assistant")}</h3><p>{translate("system.compatible.chat.completions.interface.that.supports.tool.calls.the.request.is")}</p>
    {form && <div className="ai-fields">
      {!form.encryption_ready && <p className="form-error">{translate("system.the.server.has.not.been.configured.with.ai.encryption.key.please")}</p>}
      <AntCheckbox  checked={form.enabled} disabled={busy} onChange={e => setForm({ ...form, enabled: e.target.checked })}>{translate("system.enable.ai.assistant")}</AntCheckbox>
      <label>{translate("system.api.base.address")}<AntInput type="url" placeholder={translate("system.https.yourserviceaddress.v1")} value={form.base_url} disabled={busy} onChange={e => setForm({ ...form, base_url: e.target.value })} /></label>
      <label>{translate("system.model.name")}<AntInput value={form.model} maxLength={100} disabled={busy} onChange={e => setForm({ ...form, model: e.target.value })} /></label>
      <label>API Key<AntInput type="password" autoComplete="new-password" value={form.secret} disabled={busy} placeholder={form.has_secret ? translate("system.saved.leave.blank.to.retain.the.original.key") : translate("system.please.enter.api.key")} onChange={e => setForm({ ...form, secret: e.target.value })} /></label>
      <AntCheckbox  checked={!!form.clear_secret} disabled={busy} onChange={e => setForm({ ...form, clear_secret: e.target.checked })}>{translate("system.clear.saved.keys.please.close.the.assistant.at.the.same.time")}</AntCheckbox>
      <label>{translate("system.maximum.number.of.requests.per.person.per.day")}<FormField value={form.daily_limit} type="number" min="1" max="10000" label={translate("system.maximum.number.of.requests.per.person.per.day")}><AntInput type="number" min="1" max="10000" value={form.daily_limit} disabled={busy} onChange={e => setForm({ ...form, daily_limit: Number(e.target.value) })} /></FormField></label>
      <AntCheckbox  checked={form.writes} disabled={busy} onChange={e => setForm({ ...form, writes: e.target.checked })}>{translate("system.allow.write.operations.to.be.generated.and.confirmed")}</AntCheckbox>
      <p>{translate("system.the.data.required.for.query.header.first.5.rows.and.pictures")}</p>
      <div className="ai-buttons"><AntButton type="primary" htmlType="button" className="btn primary" disabled={busy} onClick={() => run(false)}>{translate("system.save.ai.settings")}</AntButton><AntButton type="default" htmlType="button" className="btn" disabled={busy} onClick={() => run(true)}>{translate("system.save.and.test.connection")}</AntButton></div>
    </div>}
    <AntButton type="default" htmlType="button" className="btn" disabled={busy} onClick={() => api('/settings/ai/audit').then(setAudit).catch(e => setError(localizeError(e.message)))}>{translate("system.view.recent.operation.history")}</AntButton>
    {audit && <div className="ai-table"><table><thead><tr><th>{translate("system.time")}</th><th>{translate("system.operator")}</th><th>{translate("system.operation")}</th><th>{translate("system.status.details")}</th></tr></thead><tbody>{audit.map(row => <tr key={row.id}><td>{row.created_at}</td><td>{row.username}</td><td>{row.tool}</td><td>{row.status}<details><summary>{translate("system.details")}</summary><pre>{row.detail}</pre></details></td></tr>)}</tbody></table></div>}
    {error && <p className="form-error" role="alert">{error}</p>}{status && <p role="status">{status}</p>}
  </section>;
}

const fields = { get name() { return translate("system.material.name"); }, get barcode() { return translate("system.barcode"); }, get category() { return translate("system.classification"); }, get unit() { return translate("system.unit"); }, get cost() { return translate("system.reference.purchase.price"); }, get price() { return translate("system.reference.sales.price"); }, get threshold() { return translate("system.safety.stock"); }, get stock() { return translate("system.opening.stock"); }, get specification() { return translate("system.specifications.and.models"); }, get note() { return translate("system.remarks"); }, get is_fixed_asset() { return translate("system.fixed.asset"); }, get unit_round_up() { return translate("system.round.quantities.to.whole.units"); }, get production_type() { return translate("system.production.type"); } };
function ActionResult({ action }) {
  useLocale();
  const p = action.preview, result = action.result;
  return <p role="status">{translate("system.completed")}{result.orders ? `：${result.orders.map(o => o.number).join('、')}` : action.kind === 'quality_chart' ? translate("system.the.chart.has.been.saved.and.can.be.viewed.in.the", { v0: result.name }) : action.kind === 'transfer' ? `：${result.number} / ${result.in_number}` : action.kind === 'stocktake' ? translate("system.materials.have.been.counted", { v0: p.stocktake.items.length }) : action.kind === 'inspection' ? translate("system.the.verification.reminders.for.materials.have.been.updated", { v0: result.count }) : action.kind === 'mark_inspected' ? translate("system.materials.have.been.marked.as.verified", { v0: result.count }) : translate("system.add.items", { v0: result.count })}。</p>;
}

function ActionCard({ action, busy, confirm }) {
  useLocale();
  const [expanded, setExpanded] = useState(false);
  if (action.result) return <section className="ai-action-result">
    <ActionResult action={action}/>
    <AntButton type="text" htmlType="button" className="ai-result-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? translate("system.collapse.details") : action.kind === 'quality_chart' ? translate("system.view.charts.and.details") : translate("system.view.operation.details")}</AntButton>
    {expanded && <ActionPreview action={action} busy={busy} confirm={confirm}/>}
  </section>;
  return <ActionPreview action={action} busy={busy} confirm={confirm}/>;
}

function ActionPreview({ action, busy, confirm }) {
  useLocale();
  const p = action.preview, expired = action.expires_at < Date.now();
  return <section className="ai-action">
    <h3>{{ orders: translate("system.batch.warehouse.entry.and.exit.preview"), import: translate("system.new.material.preview"), transfer: translate("system.warehouse.transfer.preview"), stocktake: translate("system.inventory.count.preview"), inspection: translate("system.set.verification.reminder.preview"), mark_inspected: translate("system.mark.verified.preview"), quality_chart: translate("system.quality.chart.configuration.preview") }[action.kind]} · {action.result ? translate("system.completed") : expired ? translate("system.expired") : translate("system.to.be.confirmed")}</h3>
    {action.kind==='quality_chart'&&<>
      <p><strong>{p.name}</strong> · {p.warehouse_name}</p>
      <dl className="ai-chart-config">
        <div><dt>{translate("system.data.template")}</dt><dd>{p.template_name} v{p.revision}</dd></div>
        <div><dt>{translate("system.chart.classification.type")}</dt><dd>{p.config.kind==='material'?translate("system.material.chart"):translate("system.normal.chart")} · {chartTypeLabels[p.config.chartType]}</dd></div>
        <div><dt>{translate("system.record.caliber")}</dt><dd>{p.object_label}</dd></div>
        <div><dt>{p.config.chartType==='pie'?translate("system.classification"):translate("system.horizontal.axis")}</dt><dd>{p.x_label}</dd></div>
        <div><dt>{translate("system.statistical.value")}</dt><dd>{metricLabels[p.config.metric.aggregation]}{p.config.metric.value?` · ${p.metric_label}`:''}</dd></div>
        <div><dt>{translate("system.group")}</dt><dd>{p.group_label}</dd></div>
        <div><dt>{translate("system.date.filter.summary")}</dt><dd>{p.date_label} · {{day:translate("system.by.day"),week:translate("system.by.week"),month:translate("system.by.month")}[p.config.bucket]}</dd></div>
        {p.product&&<div><dt>{translate("system.preview.material")}</dt><dd>{p.product.name} · {p.product.barcode}</dd></div>}
      </dl>
      {p.warning&&<p>{p.warning}</p>}
      {!!p.rows.length&&<React.Suspense fallback={<p>{translate("system.loading.chart.preview")}</p>}><AiChartView result={{rows:p.rows,unit:p.unit,xType:p.x_type}} type={p.config.chartType} title={p.name}/></React.Suspense>}
      {p.stats&&<p>{translate("system.saved.data")}{p.stats.sheets}{" "}{translate("system.worksheets")}{" "}{p.stats.records}{" "}{translate("system.records.preview.display")}{" "}{p.rows.length} / {p.total_groups}{" "}{translate("system.item.statistics")}{p.stats.incompatibleSheets?translate("system.more.worksheet.fields.are.incompatible", { v0: p.stats.incompatibleSheets }):''}{p.stats.excluded?translate("system.records.are.not.included.in.the.statistics", { v0: p.stats.excluded }):''}</p>}
      <details><summary>{translate("system.view.chart.configuration")}</summary><pre className="ai-chart-json">{JSON.stringify(p.config,null,2)}</pre></details>
    </>}
    {p.orders?.map((o, index) => <div key={index}>
      <p><strong>{o.warehouse_name} · {orderLabel(o)}</strong> · {o.partner}</p>
      {o.kind === "internal" && <p>{translate("system.internal.transfers.are.not.included.in.purchases.sales.profits.and.receivables")}</p>}
      {o.note && <p>{translate("system.remarks.2")}{o.note}</p>}
      <div className="ai-table"><table><thead><tr>{[translate("system.material.barcode"), translate("system.specifications"), translate("system.quantity"), translate("system.unit.price"), translate("system.amount"), translate("system.inventory.changes")].map(s => <th key={s}>{s}</th>)}</tr></thead><tbody>{o.items.map((i, n) => <tr key={n}><td>{i.name}<small>{i.barcode}</small></td><td>{i.specification || '—'}</td><td>{i.quantity} {i.unit}</td><td>{baseCurrencySymbol()}{priceBase(i.price)}</td><td>{baseCurrencySymbol()}{moneyBase(i.quantity * i.price)}</td><td>{i.stock} → {i.after_stock}</td></tr>)}</tbody></table></div>
      <p>{translate("system.total")}{baseCurrencySymbol()}{moneyBase(o.items.reduce((n, i) => n + Math.round(i.quantity * i.price * 100), 0) / 100)}</p>
    </div>)}
    {p.transfer && <>
      <p><strong>{p.transfer.warehouse_name} → {p.transfer.target_name}</strong>{" "}{translate("system.reason")}{p.transfer.reason}</p>
      <div className="ai-table"><table><thead><tr>{[translate("system.retrieve.materials.barcodes"), translate("system.import.materials.barcodes"), translate("system.transfer.quantity"), translate("system.transfer.out.warehouse.inventory"), translate("system.transfer.to.warehouse.inventory"), translate("system.target.file")].map(s => <th key={s}>{s}</th>)}</tr></thead><tbody>{p.transfer.items.map(i => <tr key={i.product_id}><td>{i.name}<small>{i.barcode} · {i.specification || translate("system.no.specifications")}</small></td><td>{i.target_name}<small>{i.target_barcode}</small></td><td>{i.quantity} {i.unit}</td><td>{i.before_stock} → {i.after_stock}</td><td>{i.target_before} → {i.target_after}</td><td>{i.creates_product ? translate("system.a.new.material.file.will.be.created") : translate("system.use.existing.file")}</td></tr>)}</tbody></table></div>
      <p>{translate("system.after.confirmation.the.transfer.out.warehouse.inventory.will.be.deducted.simultaneously")}</p>
    </>}
    {p.stocktake && <>
      <p><strong>{p.stocktake.warehouse_name}</strong>{" "}{translate("system.reason")}{p.stocktake.reason}</p>
      <div className="ai-table"><table><thead><tr>{[translate("system.material.barcode"), translate("system.specifications"), translate("system.unit"), translate("system.book.inventory"), translate("system.actual.quantity"), translate("system.difference")].map(s => <th key={s}>{s}</th>)}</tr></thead><tbody>{p.stocktake.items.map(i => <tr key={i.product_id}><td>{i.name}<small>{i.barcode}</small></td><td>{i.specification || '—'}</td><td>{i.unit}</td><td>{i.before_stock}</td><td>{i.counted}</td><td>{i.difference > 0 ? '+' : ''}{i.difference}</td></tr>)}</tbody></table></div>
      <p>{translate("system.after.confirmation.the.inventory.of.the.above.materials.will.be.adjusted")}</p>
    </>}
    {action.kind==='import'&&p.rows && <>
      <p>{p.warehouse_name}{" "}{translate("system.new")}{" "}{p.rows.length}{" "}{translate("system.material.and.does.not.cover.existing.materials.opening.inventory.is.added")}</p>
      <p>{translate("system.column.correspondence")}{Object.entries(p.mapping).map(([k, v]) => `${fields[k]} ← ${v}`).join('；')}</p>
      {p.default_category && <p>{translate("system.rows.without.mapped.categories.are.unified.into.existing.categories")}{p.default_category.path}。</p>}
      {!!p.created_categories?.length && <p>{translate("system.the.following.categories.currently.do.not.exist.and.will.be.created")}{p.created_categories.join('、')}{translate("system.please.confirm.the.name.is.correct")}</p>}
      {!!p.defaults.length && <p>{translate("system.not.provided")}{p.defaults.map(k => `${fields[k]}=${['cost', 'price', 'stock', 'threshold'].includes(k) ? '0' : k === 'production_type' ? translate("system.not.set") : k === 'barcode' ? translate("system.automatically.generated") : ['is_fixed_asset', 'unit_round_up'].includes(k) ? translate("system.no") : translate("system.empty")}`).join('；')}{translate("system.please.check.these.default.values")}</p>}
      <div className="ai-table"><table><thead><tr>{Object.values(fields).map(v => <th key={v}>{v}</th>)}</tr></thead><tbody>{p.rows.map((row, index) => <tr key={index}>{Object.keys(fields).map(k => <td key={k}>{['is_fixed_asset', 'unit_round_up'].includes(k) ? (row[k] ? translate("system.yes") : translate("system.no")) : k === 'production_type' ? (translateText(row[k]) || translate("system.not.set")) : row[k]}</td>)}</tr>)}</tbody></table></div>
    </>}
    {p.warehouse_name && p.items && p.items.some(i => 'after_date' in i) && <>
      <p><strong>{p.warehouse_name}</strong> · {action.kind === 'inspection' ? translate("system.set.verification.reminder.materials", { v0: p.items.length }) : translate("system.mark.verified.verification.date", { v0: p.last_inspected_on })}</p>
      <div className="ai-table"><table><thead><tr>{[translate("system.material.barcode"), translate("system.unit"), translate("system.original.verification.date"), action.kind === 'inspection' ? translate("system.new.verification.date") : translate("system.next.verification.date"), translate("system.inspection.cycle")].map(s => <th key={s}>{s}</th>)}</tr></thead><tbody>{p.items.map(i => <tr key={i.product_id}><td>{i.name}<small>{i.barcode}</small></td><td>{i.unit}</td><td>{i.before_date || translate("system.not.configured")}</td><td>{i.after_date}</td><td>{i.interval ? translate("system.every", { v0: i.interval, v1: { day: translate("system.day"), month: translate("system.month"), year: translate("system.year") }[i.interval_unit] || translate("system.month") }) : translate("system.set.date.manually")}</td></tr>)}</tbody></table></div>
      <p>{action.kind === 'inspection' ? translate("system.after.confirmation.the.verification.reminder.will.be.updated.according.to.the") : translate("system.after.confirmation.the.last.verification.date.will.be.recorded.as.and", { v0: p.last_inspected_on })}</p>
    </>}
    {!action.result && <><p>{translate("system.the.operator.is.the.currently.logged.in.user.confirm.after.checking")}</p><AntButton type="primary" htmlType="button" className="btn primary" disabled={busy || expired} onClick={() => confirm(action.id)}>{action.kind==='quality_chart'?translate("system.confirm.to.save.chart"):translate("system.confirm.execution.of.this.batch.of.operations")}</AntButton></>}
  </section>;
}

function ImageAttachments({ images, onRemove, busy }) {
  useLocale();
  return <div className="ai-image-attachments" role="group" aria-label={onRemove ? translate("system.pictures.to.be.sent") : translate("system.message.picture")}>
    {images.map((image, index) => <div className="ai-image-attachment" key={index}>
      <ProductImage src={image.data_url} alt={image.name} className="ai-image-thumbnail" />
      <span title={image.name}>{image.name}</span>
      {onRemove && <AntButton type="text" htmlType="button" className="ai-image-remove" aria-label={translate("system.remove.image", { v0: image.name })} disabled={busy} onClick={() => onRemove(index)}><X size={16} aria-hidden="true" /></AntButton>}
    </div>)}
  </div>;
}

function UserMessage({ content, attachment, images }) {
  useLocale();
  return <>
    <p>{content}</p>
    {attachment && <div className="ai-message-attachment"><FileSpreadsheet size={15} /><span>{attachment.name} · {attachment.rows}{" "}{translate("system.ok")}</span></div>}
    {!!images?.length && <ImageAttachments images={images} />}
  </>;
}

export function AiAssistant({ onChanged, userId, warehouseName, mode = 'warehouse' }) {
  useLocale();
  const [text, setText] = useState(''), [thread, setThread] = useState({ messages: [], actions: [] }), [file, setFile] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [images, setImages] = useState([]), [readingImages, setReadingImages] = useState(false);
  const [history, setHistory] = useState([]), [historyError, setHistoryError] = useState(''), [showHistory, setShowHistory] = useState(false), [pending, setPending] = useState(''), [copied, setCopied] = useState(null), [stage, setStage] = useState(0);
  const lock = useRef(false), input = useRef(null), imageInput = useRef(null), prompt = useRef(null), feed = useRef(null), warehouse = useRef(getWarehouseId());
  useEffect(() => {
    if (!busy) { setStage(0); return; }
    const timer = setInterval(() => setStage(s => Math.min(s + 1, AI_STAGES().length - 1)), 2600);
    return () => clearInterval(timer);
  }, [busy]);
  const refreshHistory = async () => {
    try { setHistory(await api('/ai/conversations')); setHistoryError(''); }
    catch (e) { setHistoryError(localizeError(e.message)); }
  };
  useEffect(() => { let alive = true; api('/ai/conversations').then(rows => { if (alive) setHistory(rows); }).catch(e => { if (alive) setHistoryError(localizeError(e.message)); }); return () => { alive = false; }; }, []);
  useEffect(() => { if (feed.current) feed.current.scrollTop = thread.messages.length || pending ? feed.current.scrollHeight : 0; }, [thread, pending, busy]);
  const storageKey = `77erp-ai:${userId}:${warehouse.current}`;
  useEffect(() => {
    let alive = true;
    let id;
    try { id = sessionStorage.getItem(storageKey); } catch { /* Storage is optional. */ }
    if (id) {
      lock.current = true; setBusy(true);
      api(`/ai/conversations/${id}`).then(result => { if (alive) setThread(result); }).catch(e => {
        if (alive) setError(localizeError(e.message));
        try { sessionStorage.removeItem(storageKey); } catch { /* Storage is optional. */ }
      }).finally(() => { if (alive) { lock.current = false; setBusy(false); } });
    }
    return () => { alive = false; };
  }, [storageKey]);
  const run = async fn => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(localizeError(e.message)); } finally { lock.current = false; setBusy(false); setPending(''); }
  };
  const upload = selected => run(async () => {
    if (!selected) return;
    if (selected.size > 5 * 1024 * 1024) throw new Error(translate("system.file.cannot.exceed.5.mb"));
    let table;
    if (/\.xlsx$/i.test(selected.name)) { const { readSheet } = await import('read-excel-file/browser'); table = await readSheet(selected); }
    else if (/\.csv$/i.test(selected.name)) table = parseCSV(await selected.text());
    else throw new Error(translate("system.please.select.an.xlsx.or.utf.8.csv.file"));
    while (table.length && table.at(-1).every(v => v == null || String(v).trim() === '')) table.pop();
    if (table.length < 2 || table.length > 1001) throw new Error(translate("system.the.first.worksheet.needs.a.header.and.1.1000.rows.of"));
    if (table.some(row => row.some(v => v instanceof Date))) throw new Error(translate("system.the.table.contains.date.format.please.change.the.material.field.to"));
    setFile({ name: selected.name, table });
  });
  const uploadImages = selected => {
    const files = Array.from(selected || []);
    if (!files.length) return;
    return run(async () => {
      if (images.length + files.length > AI_IMAGE_MAX_COUNT) throw new Error(translate("system.a.maximum.of.pictures.can.be.added.at.a.time.please", { v0: AI_IMAGE_MAX_COUNT }));
      setReadingImages(true);
      try {
        const added = [];
        for (const file of files) added.push(await readAiImage(file));
        setImages(previous => [...previous, ...added]);
      } finally { setReadingImages(false); }
    });
  };
  const pasteImages = event => {
    const files = Array.from(event.clipboardData?.items || []).filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean);
    if (!files.length) return;
    event.preventDefault();
    if (!lock.current) void uploadImages(files);
  };
  const send = () => run(async () => {
    if (!text.trim() && !images.length) return;
    const message = text.trim() ? text : AI_IMAGE_ONLY_MESSAGE, attachment = file, attachedImages = images;
    setPending({ content: message, ...(attachment ? { attachment: { name: attachment.name, rows: attachment.table.length - 1 } } : {}), images: attachedImages });
    setText(''); setFile(null); setImages([]); if (input.current) input.current.value = '';
    let result;
    try {
      result = await api('/ai/chat', { method: 'POST', warehouseId: warehouse.current, body: { message, conversation_id: thread.conversation_id, ...(attachment ? { table: attachment.table, table_name: attachment.name } : {}), ...(attachedImages.length ? { images: attachedImages } : {}) } });
    } catch (e) {
      setText(text); setFile(attachment); setImages(attachedImages);
      throw e;
    }
    try { sessionStorage.setItem(storageKey, result.conversation_id); } catch { /* Storage is optional. */ }
    setPending(''); setThread(result); setError(result.error || '');
    await refreshHistory();
  });
  const confirm = id => run(async () => {
    const result = await api('/ai/confirm', { method: 'POST', warehouseId: warehouse.current, body: { action_id: id } });
    setThread(t => ({ ...t, actions: t.actions.map(a => a.id === id ? { ...a, result } : a) }));
    await onChanged?.();
  });
  const clearDraft = () => { setFile(null); setImages([]); setText(''); setError(''); setCopied(null); if (input.current) input.current.value = ''; };
  const newThread = () => {
    if (lock.current) return;
    try { sessionStorage.removeItem(storageKey); } catch { /* Storage is optional. */ }
    setThread({ messages: [], actions: [] }); clearDraft(); setShowHistory(false);
  };
  const openThread = id => run(async () => {
    const result = await api(`/ai/conversations/${id}`);
    setThread(result); clearDraft(); setShowHistory(false);
    try { sessionStorage.setItem(storageKey, id); } catch { /* Storage is optional. */ }
  });
  const suggest = value => { setText(value); prompt.current?.focus(); };
  const copy = async (content, index) => {
    try { await navigator.clipboard.writeText(content); setCopied(index); }
    catch { setError(translate("system.unable.to.copy.please.select.reply.text.to.copy.manually")); }
  };
  const turns = [];
  for (const message of thread.messages) {
    if (message.role === 'user' || !turns.length) turns.push({ messages: [], actions: [] });
    turns.at(-1).messages.push(message);
  }
  for (const action of thread.actions) {
    if (pending && !action.result) continue;
    const index = Number.isInteger(action.turn_index) ? action.turn_index : 0;
    (turns[index] || turns[0])?.actions.push(action);
  }
  return <div className="ai-assistant">
    <aside className={`ai-sidebar ${showHistory ? 'is-open' : ''}`} aria-label={translate("system.conversation.history")}>
      <div className="ai-brand"><span>77</span>ERP <AntButton type="text" htmlType="button" className="ai-icon ai-history-close" aria-label={translate("system.close.historical.conversation")} onClick={() => setShowHistory(false)}><X size={18} /></AntButton></div>
      <AntButton type="text" htmlType="button" className="ai-new" disabled={busy} onClick={newThread}><Plus size={16} />{translate("system.start.a.new.conversation")}</AntButton>
      <div className="ai-sidebar-caption">{translate("system.recent.conversations.all.repositories")}</div>
      <div className="ai-history-list">
        {historyError ? <p className="ai-history-error" role="status">{historyError}<AntButton type="text" htmlType="button" className="ai-new" onClick={refreshHistory}>{translate("system.reload")}</AntButton></p> : history.length ? history.map(h => <AntButton type="text" htmlType="button" key={h.id} className={`ai-history-item ${thread.conversation_id === h.id ? 'active' : ''}`} disabled={busy} onClick={() => openThread(h.id)} title={h.title} aria-current={thread.conversation_id === h.id ? 'true' : undefined}><span>{h.title}</span><small>{new Date(h.created_at).toLocaleDateString(getFormatLocale())}</small></AntButton>) : <p className="ai-history-empty">{translate("system.once.you.start.a.chat.the.conversation.is.saved.here")}</p>}
      </div>
      <div className="ai-sidebar-footer"><Sparkles size={15} />{translate("system.your.business.assistant")}<p>{translate("system.inquire.organize.and.assist.with.daily.work")}</p></div>
    </aside>
    <section className="ai-chat" aria-label={translate("system.ai.conversation")}>
      <div className="ai-context"><span className="ai-context-title"><Sparkles size={17} />{warehouseName || translate("system.current.warehouse")} · {mode === 'production' ? translate("system.production") : translate("system.warehouse")}</span><span className="ai-context-note">{translate("system.inventory.and.business.feel.free.to.ask.me")}</span><div className="ai-mobile-tools"><AntButton type="text" htmlType="button" className="ai-icon" aria-label={translate("system.view.historical.conversations")} aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}><History size={18} /></AntButton><AntButton type="text" htmlType="button" className="ai-icon" aria-label={translate("system.start.a.new.conversation")} disabled={busy} onClick={newThread}><Plus size={19} /></AntButton></div></div>
      <div className="ai-feed" ref={feed}>
        {!thread.messages.length && !busy && <div className="ai-welcome">
          <div className="ai-welcome-icon"><Sparkles size={30} /></div><h3>{translate("system.today.what.is.there")}<br />{translate("system.can.i.help.you")}</h3><p>{mode === 'production' ? translate("system.query.batch.completion.progress.analyze.material.consumption.differences.and.calculate.material") : translate("system.check.inventory.organize.documents.and.import.materials")}<br />{translate("system.tell.me.your.requirements.and.we.ll.do.the.rest.together")}</p>
          <div className="ai-suggestions">{[
            mode === 'production' ? [PackageSearch, translate("system.query.bom"), translate("system.what.boms.are.currently.in.the.warehouse.please.list.finished.product")] : [PackageSearch, translate("system.query.material.quantity"), translate("system.how.many.materials.are.currently.in.the.warehouse")],
            mode === 'production' ? [ArrowLeftRight, translate("system.query.tasks.to.be.produced"), translate("system.what.production.orders.are.currently.in.the.warehouse.to.be.produced")] : [ArrowLeftRight, translate("system.query.cross.warehouse.inventory"), translate("system.i.want.to.compare.the.material.inventory.of.different.warehouses.please")],
            [ChartColumn, translate("system.recommended.quality.chart"), translate("system.please.check.the.acceptance.data.saved.in.the.current.warehouse.recommend")],
            [FileSpreadsheet, translate("system.upload.the.form.and.add.new.materials"), translate("system.i.want.to.upload.a.table.to.add.a.new.material")],
          ].sort((a, b) => mode === 'production' ? Number(b[0] === ChartColumn) - Number(a[0] === ChartColumn) : 0).map(([Icon, label, value]) => <AntButton type="default" htmlType="button" key={label} onClick={() => suggest(value)}><Icon size={19} /><span>{label}</span><ArrowUpRight size={15} /></AntButton>)}</div>
        </div>}
        <div className="ai-messages" aria-live="polite" aria-busy={busy}>
          {turns.map((turn, turnIndex) => <div className="ai-turn" key={turnIndex}>
          {turn.messages.map((m, i) => <div className={`ai-message ai-${m.role}`} key={i}>
            {m.role !== 'user' && <div className="ai-avatar"><Sparkles size={17} /></div>}
            <div className="ai-message-body">{m.role !== 'user' && <div className="ai-author">{translate("system.ai.assistant")}</div>}
              {m.role === 'user' ? <UserMessage content={m.content} attachment={m.attachment} images={m.images} /> : <><div className="ai-markdown"><Markdown skipHtml urlTransform={url => /^https?:\/\//i.test(url) ? url : undefined} remarkPlugins={[remarkGfm]} components={{ table: ({ children }) => <div className="ai-table" tabIndex={0} aria-label={translate("system.query.results")}><table>{children}</table></div>, a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>, img: ({ alt }) => <span>{alt}</span> }}>{m.content}</Markdown></div><AntButton type="text" htmlType="button" className="ai-copy" onClick={() => copy(m.content, `${turnIndex}:${i}`)}>{copied === `${turnIndex}:${i}` ? <Check size={13} /> : <Copy size={13} />}{copied === `${turnIndex}:${i}` ? translate("system.copied") : translate("system.copy")}</AntButton></>}
            </div>
          </div>)}
          {!!turn.actions.length && <div className="ai-actions">{turn.actions.map(action => <ActionCard key={action.id} action={action} busy={busy} confirm={confirm}/>)}</div>}
          </div>)}
          {pending && <div className="ai-message ai-user"><div className="ai-message-body">{typeof pending === 'object' ? <UserMessage content={pending.content} attachment={pending.attachment} images={pending.images} /> : <p>{pending}</p>}</div></div>}
          {busy && <div className="ai-processing" role="status"><LoaderCircle size={16} />{readingImages ? translate("system.processing.images") : AI_STAGES()[stage]}</div>}
        </div>
      </div>
      <div className="ai-compose-area">
        {error && <p className="form-error" role="alert">{error}</p>}
        <AntForm noValidate layout="vertical" scrollToFirstError={{ focus: true }} className="ai-composer" onPaste={pasteImages} onFinish={() => {  send(); }}>
          {file && <div className="ai-attachment"><FileSpreadsheet size={17} /><span>{file.name} · {file.table.length - 1}{" "}{translate("system.ok")}</span><AntButton type="text" htmlType="button" className="ai-icon" aria-label={translate("system.remove.attachment")} disabled={busy} onClick={() => { setFile(null); input.current.value = ''; }}><X size={15} /></AntButton></div>}
          {!!images.length && <ImageAttachments images={images} busy={busy} onRemove={index => setImages(items => items.filter((_, i) => i !== index))} />}
          <AntInput.TextArea ref={prompt} aria-label={translate("system.your.needs")} rows={2} maxLength={4000} value={text} disabled={busy} placeholder={translate("system.describe.requirements.or.add.tables.pictures")} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
          <div className="ai-composer-tools">
            <input hidden className="ai-file-input" ref={input} aria-label={translate("system.additional.materials.excel.csv")} type="file" accept=".xlsx,.csv" disabled={busy} onChange={e => upload(e.target.files?.[0])} />
            <AntButton type="text" className="ai-upload" htmlType="button" disabled={busy} onClick={() => input.current?.click()}><Plus size={19} /><span>{translate("system.add.table")}</span></AntButton>
            <input hidden ref={imageInput} aria-label={translate("system.attach.pictures")} type="file" accept={AI_IMAGE_TYPES.join(',')} multiple disabled={busy} onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ''; void uploadImages(files); }} />
            <AntButton type="text" className="ai-upload" htmlType="button" disabled={busy || images.length >= AI_IMAGE_MAX_COUNT} onClick={() => imageInput.current?.click()}><ImagePlus size={19} aria-hidden="true" /><span>{translate("system.add.picture")}</span></AntButton>
            <span className="ai-shortcut">{translate("system.ctrl.enter.send")}</span>
            <AntButton type="text" htmlType="submit" className="ai-send" aria-label={translate("system.send")} disabled={busy || (!text.trim() && !images.length)}><ArrowUp size={21} /></AntButton>
          </div>
        </AntForm>
        <details className="ai-upload-help"><summary>{translate("system.form.image.upload.instructions")}</summary><p>{translate("system.excel.csv.only.parses.the.first.worksheet.with.a.maximum.of")}</p><p>{translate("system.supports.selecting.or.pasting.jpg.png.and.webp.images.up.to")}</p></details>
        <p className="ai-safety"><ShieldCheck size={12} />{translate("system.operations.involving.inventory.changes.will.be.performed.after.your.confirmation")}</p>
      </div>
    </section>
  </div>;
}
