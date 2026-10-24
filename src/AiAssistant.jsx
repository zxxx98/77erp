import { FormField } from './ui/FormField.jsx';
import { Form as AntForm } from 'antd';
import { Checkbox as AntCheckbox, Input as AntInput, Button as AntButton } from './ui/controls.jsx';

import { chartTypeLabels, metricLabels } from '../shared/quality-charts.js';
import { orderLabel } from './order-utils.js';
import React, { useEffect, useRef, useState } from 'react';
import { api, getWarehouseId } from './api.js';
import { parseCSV } from './data-files.js';
import { Sparkles, Plus, ArrowUp, ArrowUpRight, PackageSearch, ChartColumn, ArrowLeftRight, FileSpreadsheet, Copy, Check, X, History, LoaderCircle, ShieldCheck } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './ai.css';
import { moneyBase, priceBase, baseCurrencySymbol } from './app/format.js';

const AiChartView=React.lazy(()=>import('./pages/QualityChartView.jsx').then(module=>({default:module.QualityChartView})));

const AI_STAGES = ['正在理解你的需求…', '正在查询业务数据…', '正在核对并整理回答…'];

export function AiSettings({ onBusy = () => {} }) {
  const [form, setForm] = useState(null), [error, setError] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState(false), [audit, setAudit] = useState(null);
  const lock = useRef(false);
  useEffect(() => { let alive = true; api('/settings/ai').then(c => { if (alive) setForm({ ...c, secret: '' }); }).catch(e => { if (alive) setError(e.message); }); return () => { alive = false; }; }, []);
  const run = async test => {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusy(true); setError(''); setStatus('');
    try {
      const c = await api('/settings/ai', { method: 'PUT', body: form });
      setForm({ ...c, secret: '' });
      if (test) await api('/settings/ai/test', { method: 'POST', body: {} });
      setStatus(test ? '配置已保存，连接测试成功。' : 'AI 设置已保存。');
    } catch (e) { setError(e.message); }
    finally { lock.current = false; setBusy(false); onBusy(false); }
  };
  return <section className="ai-settings">
    <h3>AI 助手</h3><p>支持工具调用的兼容 Chat Completions 接口。请求由服务器发送，员工需分配 AI 助手权限；写操作仍需对应业务权限并逐批确认。</p>
    {form && <div className="ai-fields">
      {!form.encryption_ready && <p className="form-error">服务器尚未配置 AI_ENCRYPTION_KEY，请先由部署人员配置加密密钥。</p>}
      <AntCheckbox  checked={form.enabled} disabled={busy} onChange={e => setForm({ ...form, enabled: e.target.checked })}>启用 AI 助手</AntCheckbox>
      <label>API 基础地址<AntInput type="url" placeholder="https://你的服务地址/v1" value={form.base_url} disabled={busy} onChange={e => setForm({ ...form, base_url: e.target.value })} /></label>
      <label>模型名称<AntInput value={form.model} maxLength={100} disabled={busy} onChange={e => setForm({ ...form, model: e.target.value })} /></label>
      <label>API Key<AntInput type="password" autoComplete="new-password" value={form.secret} disabled={busy} placeholder={form.has_secret ? '已保存，留空保留原密钥' : '请输入 API Key'} onChange={e => setForm({ ...form, secret: e.target.value })} /></label>
      <AntCheckbox  checked={!!form.clear_secret} disabled={busy} onChange={e => setForm({ ...form, clear_secret: e.target.checked })}>清除已保存密钥（请同时关闭助手）</AntCheckbox>
      <label>每人每日最多请求数<FormField value={form.daily_limit} type="number" min="1" max="10000" label="每人每日最多请求数"><AntInput type="number" min="1" max="10000" value={form.daily_limit} disabled={busy} onChange={e => setForm({ ...form, daily_limit: Number(e.target.value) })} /></FormField></label>
      <AntCheckbox  checked={form.writes} disabled={busy} onChange={e => setForm({ ...form, writes: e.target.checked })}>允许生成并确认写操作</AntCheckbox>
      <p>查询所需数据及上传表格的表头和前5行会发送给配置的模型服务。完整导入数据由本系统校验处理。单批最多20张出入库单、合计100行；物料导入最多1000行。</p>
      <div className="ai-buttons"><AntButton type="primary" htmlType="button" className="btn primary" disabled={busy} onClick={() => run(false)}>保存 AI 设置</AntButton><AntButton type="default" htmlType="button" className="btn" disabled={busy} onClick={() => run(true)}>保存并测试连接</AntButton></div>
    </div>}
    <AntButton type="default" htmlType="button" className="btn" disabled={busy} onClick={() => api('/settings/ai/audit').then(setAudit).catch(e => setError(e.message))}>查看最近操作记录</AntButton>
    {audit && <div className="ai-table"><table><thead><tr><th>时间</th><th>操作人</th><th>操作</th><th>状态 / 详情</th></tr></thead><tbody>{audit.map(row => <tr key={row.id}><td>{row.created_at}</td><td>{row.username}</td><td>{row.tool}</td><td>{row.status}<details><summary>详情</summary><pre>{row.detail}</pre></details></td></tr>)}</tbody></table></div>}
    {error && <p className="form-error" role="alert">{error}</p>}{status && <p role="status">{status}</p>}
  </section>;
}

const fields = { name: '物料名称', barcode: '条码', category: '分类', unit: '单位', cost: '参考采购价', price: '参考销售价', threshold: '安全库存', stock: '期初库存', specification: '规格型号', note: '备注', is_fixed_asset: '固定资产' };
function ActionResult({ action }) {
  const p = action.preview, result = action.result;
  return <p role="status">已完成{result.orders ? `：${result.orders.map(o => o.number).join('、')}` : action.kind === 'quality_chart' ? `，已保存图表“${result.name}”，可在品质管理的图表中查看` : action.kind === 'transfer' ? `：${result.number} / ${result.in_number}` : action.kind === 'stocktake' ? `，已盘点 ${p.stocktake.items.length} 种物料` : action.kind === 'inspection' ? `，已更新 ${result.count} 种物料的校验提醒` : action.kind === 'mark_inspected' ? `，已标记 ${result.count} 种物料为已校验` : `，新增 ${result.count} 个物料`}。</p>;
}

function ActionCard({ action, busy, confirm }) {
  const [expanded, setExpanded] = useState(false);
  if (action.result) return <section className="ai-action-result">
    <ActionResult action={action}/>
    <AntButton type="text" htmlType="button" className="ai-result-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起详情' : action.kind === 'quality_chart' ? '查看图表与详情' : '查看操作详情'}</AntButton>
    {expanded && <ActionPreview action={action} busy={busy} confirm={confirm}/>}
  </section>;
  return <ActionPreview action={action} busy={busy} confirm={confirm}/>;
}

function ActionPreview({ action, busy, confirm }) {
  const p = action.preview, expired = action.expires_at < Date.now();
  return <section className="ai-action">
    <h3>{{ orders: '批量出入库预览', import: '新增物料预览', transfer: '仓库调拨预览', stocktake: '库存盘点预览', inspection: '设置校验提醒预览', mark_inspected: '标记已校验预览', quality_chart: '品质图表配置预览' }[action.kind]} · {action.result ? '已完成' : expired ? '已过期' : '待确认'}</h3>
    {action.kind==='quality_chart'&&<>
      <p><strong>{p.name}</strong> · {p.warehouse_name}</p>
      <dl className="ai-chart-config">
        <div><dt>数据模板</dt><dd>{p.template_name} v{p.revision}</dd></div>
        <div><dt>图表分类 / 类型</dt><dd>{p.config.kind==='material'?'物料图表':'普通图表'} · {chartTypeLabels[p.config.chartType]}</dd></div>
        <div><dt>记录口径</dt><dd>{p.object_label}</dd></div>
        <div><dt>{p.config.chartType==='pie'?'分类':'横轴'}</dt><dd>{p.x_label}</dd></div>
        <div><dt>统计值</dt><dd>{metricLabels[p.config.metric.aggregation]}{p.config.metric.value?` · ${p.metric_label}`:''}</dd></div>
        <div><dt>分组</dt><dd>{p.group_label}</dd></div>
        <div><dt>日期筛选 / 汇总</dt><dd>{p.date_label} · {{day:'按日',week:'按周',month:'按月'}[p.config.bucket]}</dd></div>
        {p.product&&<div><dt>预览物料</dt><dd>{p.product.name} · {p.product.barcode}</dd></div>}
      </dl>
      {p.warning&&<p>{p.warning}</p>}
      {!!p.rows.length&&<React.Suspense fallback={<p>正在加载图表预览…</p>}><AiChartView result={{rows:p.rows,unit:p.unit,xType:p.x_type}} type={p.config.chartType} title={p.name}/></React.Suspense>}
      {p.stats&&<p>已保存数据：{p.stats.sheets} 个工作表 · {p.stats.records} 条记录；预览显示 {p.rows.length} / {p.total_groups} 项统计。{p.stats.incompatibleSheets?`另有 ${p.stats.incompatibleSheets} 个工作表字段不兼容。`:''}{p.stats.excluded?`${p.stats.excluded} 条记录未参与统计。`:''}</p>}
      <details><summary>查看图表配置</summary><pre className="ai-chart-json">{JSON.stringify(p.config,null,2)}</pre></details>
    </>}
    {p.orders?.map((o, index) => <div key={index}>
      <p><strong>{o.warehouse_name} · {orderLabel(o)}</strong> · {o.partner}</p>
      {o.kind === "internal" && <p>内部流转不计入采购、销售、利润及应收应付。</p>}
      {o.note && <p>备注：{o.note}</p>}
      <div className="ai-table"><table><thead><tr>{['物料 / 条码', '规格', '数量', '单价', '金额', '库存变化'].map(s => <th key={s}>{s}</th>)}</tr></thead><tbody>{o.items.map((i, n) => <tr key={n}><td>{i.name}<small>{i.barcode}</small></td><td>{i.specification || '—'}</td><td>{i.quantity} {i.unit}</td><td>{baseCurrencySymbol()}{priceBase(i.price)}</td><td>{baseCurrencySymbol()}{moneyBase(i.quantity * i.price)}</td><td>{i.stock} → {i.after_stock}</td></tr>)}</tbody></table></div>
      <p>合计：{baseCurrencySymbol()}{moneyBase(o.items.reduce((n, i) => n + Math.round(i.quantity * i.price * 100), 0) / 100)}</p>
    </div>)}
    {p.transfer && <>
      <p><strong>{p.transfer.warehouse_name} → {p.transfer.target_name}</strong> · 原因：{p.transfer.reason}</p>
      <div className="ai-table"><table><thead><tr>{['调出物料 / 条码', '调入物料 / 条码', '调拨数量', '调出仓库存', '调入仓库存', '目标档案'].map(s => <th key={s}>{s}</th>)}</tr></thead><tbody>{p.transfer.items.map(i => <tr key={i.product_id}><td>{i.name}<small>{i.barcode} · {i.specification || '无规格'}</small></td><td>{i.target_name}<small>{i.target_barcode}</small></td><td>{i.quantity} {i.unit}</td><td>{i.before_stock} → {i.after_stock}</td><td>{i.target_before} → {i.target_after}</td><td>{i.creates_product ? '将新建物料档案' : '使用已有档案'}</td></tr>)}</tbody></table></div>
      <p>确认后同步扣减调出仓、增加调入仓库存，并生成关联的调出和调入单据。</p>
    </>}
    {p.stocktake && <>
      <p><strong>{p.stocktake.warehouse_name}</strong> · 原因：{p.stocktake.reason}</p>
      <div className="ai-table"><table><thead><tr>{['物料 / 条码', '规格', '单位', '账面库存', '实盘数量', '差额'].map(s => <th key={s}>{s}</th>)}</tr></thead><tbody>{p.stocktake.items.map(i => <tr key={i.product_id}><td>{i.name}<small>{i.barcode}</small></td><td>{i.specification || '—'}</td><td>{i.unit}</td><td>{i.before_stock}</td><td>{i.counted}</td><td>{i.difference > 0 ? '+' : ''}{i.difference}</td></tr>)}</tbody></table></div>
      <p>确认后将以上物料库存调整为实盘数量；未列出的物料不变。请确认实盘数量是总数，并非增减数量。</p>
    </>}
    {action.kind==='import'&&p.rows && <>
      <p>{p.warehouse_name} · 新增 {p.rows.length} 个物料，不覆盖已有物料。期初库存会直接计入库存。</p>
      <p>列对应：{Object.entries(p.mapping).map(([k, v]) => `${fields[k]} ← ${v}`).join('；')}</p>
      {p.default_category && <p>未映射分类的行统一归入已有分类：{p.default_category.path}。</p>}
      {!!p.created_categories?.length && <p>以下分类当前不存在，将新建为一级分类：{p.created_categories.join('、')}。请确认名称无误。</p>}
      {!!p.defaults.length && <p>未提供：{p.defaults.map(k => `${fields[k]}=${['cost', 'price', 'stock', 'threshold'].includes(k) ? '0' : k === 'barcode' ? '自动生成' : k === 'is_fixed_asset' ? '否' : '空'}`).join('；')}。请核对这些默认值。</p>}
      <div className="ai-table"><table><thead><tr>{Object.values(fields).map(v => <th key={v}>{v}</th>)}</tr></thead><tbody>{p.rows.map((row, index) => <tr key={index}>{Object.keys(fields).map(k => <td key={k}>{k === 'is_fixed_asset' ? (row[k] ? '是' : '否') : row[k]}</td>)}</tr>)}</tbody></table></div>
    </>}
    {p.warehouse_name && p.items && p.items.some(i => 'after_date' in i) && <>
      <p><strong>{p.warehouse_name}</strong> · {action.kind === 'inspection' ? `设置校验提醒 · ${p.items.length} 种物料` : `标记已校验 · 校验日 ${p.last_inspected_on}`}</p>
      <div className="ai-table"><table><thead><tr>{['物料 / 条码', '单位', '原校验日期', action.kind === 'inspection' ? '新校验日期' : '下次校验日期', '校验周期'].map(s => <th key={s}>{s}</th>)}</tr></thead><tbody>{p.items.map(i => <tr key={i.product_id}><td>{i.name}<small>{i.barcode}</small></td><td>{i.unit}</td><td>{i.before_date || '未配置'}</td><td>{i.after_date}</td><td>{i.interval ? `每 ${i.interval} ${{ day: '天', month: '月', year: '年' }[i.interval_unit] || '月'}` : '手动设置日期'}</td></tr>)}</tbody></table></div>
      <p>{action.kind === 'inspection' ? '确认后按以上日期和周期更新校验提醒。' : `确认后将上次校验日期记为 ${p.last_inspected_on}，有周期的物料从该日期按配置周期顺延。`}</p>
    </>}
    {!action.result && <><p>操作人是当前登录用户。核对全部明细后确认；预览15分钟内有效，业务数据变化需重新生成。继续聊天会取消本批未确认预览。</p><AntButton type="primary" htmlType="button" className="btn primary" disabled={busy || expired} onClick={() => confirm(action.id)}>{action.kind==='quality_chart'?'确认保存图表':'确认执行本批操作'}</AntButton></>}
  </section>;
}

function UserMessage({ content, attachment }) {
  return <>
    <p>{content}</p>
    {attachment && <div className="ai-message-attachment"><FileSpreadsheet size={15} /><span>{attachment.name} · {attachment.rows} 行</span></div>}
  </>;
}

export function AiAssistant({ onChanged, userId, warehouseName, mode = 'warehouse' }) {
  const [text, setText] = useState(''), [thread, setThread] = useState({ messages: [], actions: [] }), [file, setFile] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [history, setHistory] = useState([]), [historyError, setHistoryError] = useState(''), [showHistory, setShowHistory] = useState(false), [pending, setPending] = useState(''), [copied, setCopied] = useState(null), [stage, setStage] = useState(0);
  const lock = useRef(false), input = useRef(null), prompt = useRef(null), feed = useRef(null), warehouse = useRef(getWarehouseId());
  useEffect(() => {
    if (!busy) { setStage(0); return; }
    const timer = setInterval(() => setStage(s => Math.min(s + 1, AI_STAGES.length - 1)), 2600);
    return () => clearInterval(timer);
  }, [busy]);
  const refreshHistory = async () => {
    try { setHistory(await api('/ai/conversations')); setHistoryError(''); }
    catch (e) { setHistoryError(e.message); }
  };
  useEffect(() => { let alive = true; api('/ai/conversations').then(rows => { if (alive) setHistory(rows); }).catch(e => { if (alive) setHistoryError(e.message); }); return () => { alive = false; }; }, []);
  useEffect(() => { if (feed.current) feed.current.scrollTop = thread.messages.length || pending ? feed.current.scrollHeight : 0; }, [thread, pending, busy]);
  const storageKey = `77erp-ai:${userId}:${warehouse.current}`;
  useEffect(() => {
    let alive = true;
    let id;
    try { id = sessionStorage.getItem(storageKey); } catch { /* Storage is optional. */ }
    if (id) {
      lock.current = true; setBusy(true);
      api(`/ai/conversations/${id}`).then(result => { if (alive) setThread(result); }).catch(e => {
        if (alive) setError(e.message);
        try { sessionStorage.removeItem(storageKey); } catch { /* Storage is optional. */ }
      }).finally(() => { if (alive) { lock.current = false; setBusy(false); } });
    }
    return () => { alive = false; };
  }, [storageKey]);
  const run = async fn => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e.message); } finally { lock.current = false; setBusy(false); setPending(''); }
  };
  const upload = selected => run(async () => {
    if (!selected) return;
    if (selected.size > 5 * 1024 * 1024) throw new Error('文件不能超过5 MB。');
    let table;
    if (/\.xlsx$/i.test(selected.name)) { const { readSheet } = await import('read-excel-file/browser'); table = await readSheet(selected); }
    else if (/\.csv$/i.test(selected.name)) table = parseCSV(await selected.text());
    else throw new Error('请选择 .xlsx 或 UTF-8 .csv 文件。');
    while (table.length && table.at(-1).every(v => v == null || String(v).trim() === '')) table.pop();
    if (table.length < 2 || table.length > 1001) throw new Error('第一张工作表需有表头和1–1000行数据。');
    if (table.some(row => row.some(v => v instanceof Date))) throw new Error('表格含日期格式，请将物料字段改为文本或数字格式。');
    setFile({ name: selected.name, table });
  });
  const send = () => run(async () => {
    if (!text.trim()) return;
    const message = text, attachment = file;
    setPending(attachment ? { content: message, attachment: { name: attachment.name, rows: attachment.table.length - 1 } } : message);
    setText(''); setFile(null); if (input.current) input.current.value = '';
    let result;
    try {
      result = await api('/ai/chat', { method: 'POST', warehouseId: warehouse.current, body: { message, conversation_id: thread.conversation_id, ...(attachment ? { table: attachment.table, table_name: attachment.name } : {}) } });
    } catch (e) {
      setText(message); setFile(attachment);
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
  const clearDraft = () => { setFile(null); setText(''); setError(''); setCopied(null); if (input.current) input.current.value = ''; };
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
    catch { setError('无法复制，请选择回复文字手动复制。'); }
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
    <aside className={`ai-sidebar ${showHistory ? 'is-open' : ''}`} aria-label="对话历史">
      <div className="ai-brand"><span>77</span>ERP <AntButton type="text" htmlType="button" className="ai-icon ai-history-close" aria-label="关闭历史对话" onClick={() => setShowHistory(false)}><X size={18} /></AntButton></div>
      <AntButton type="text" htmlType="button" className="ai-new" disabled={busy} onClick={newThread}><Plus size={16} />开始新对话</AntButton>
      <div className="ai-sidebar-caption">最近对话 · 所有仓库</div>
      <div className="ai-history-list">
        {historyError ? <p className="ai-history-error" role="status">{historyError}<AntButton type="text" htmlType="button" className="ai-new" onClick={refreshHistory}>重新加载</AntButton></p> : history.length ? history.map(h => <AntButton type="text" htmlType="button" key={h.id} className={`ai-history-item ${thread.conversation_id === h.id ? 'active' : ''}`} disabled={busy} onClick={() => openThread(h.id)} title={h.title} aria-current={thread.conversation_id === h.id ? 'true' : undefined}><span>{h.title}</span><small>{new Date(h.created_at).toLocaleDateString('zh-CN')}</small></AntButton>) : <p className="ai-history-empty">开始聊天后，对话会保存在这里。</p>}
      </div>
      <div className="ai-sidebar-footer"><Sparkles size={15} />你的业务助手<p>查询、整理，协助日常工作</p></div>
    </aside>
    <section className="ai-chat" aria-label="AI 对话">
      <div className="ai-context"><span className="ai-context-title"><Sparkles size={17} />{warehouseName || '当前仓库'} · {mode === 'production' ? '生产' : '仓储'}</span><span className="ai-context-note">库存与业务，随时问我</span><div className="ai-mobile-tools"><AntButton type="text" htmlType="button" className="ai-icon" aria-label="查看历史对话" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}><History size={18} /></AntButton><AntButton type="text" htmlType="button" className="ai-icon" aria-label="开始新对话" disabled={busy} onClick={newThread}><Plus size={19} /></AntButton></div></div>
      <div className="ai-feed" ref={feed}>
        {!thread.messages.length && !busy && <div className="ai-welcome">
          <div className="ai-welcome-icon"><Sparkles size={30} /></div><h3>今天，有什么<br />可以帮你？</h3><p>{mode === 'production' ? '查询分批完工进度、分析耗料差异、测算备料和废料。' : '查库存、整理单据、导入物料。'}<br />把需求告诉我，剩下的一起完成。</p>
          <div className="ai-suggestions">{[
            mode === 'production' ? [PackageSearch, '查询BOM', '当前仓库有哪些BOM？请列出成品和基准产量。'] : [PackageSearch, '查询物料数量', '当前仓库有多少种物料？'],
            mode === 'production' ? [ArrowLeftRight, '查询待生产任务', '当前仓库有哪些待生产的生产单？请列出成品、计划产量和单号。'] : [ArrowLeftRight, '查询跨仓库库存', '我想对比不同仓库的物料库存，请先列出仓库。'],
            [ChartColumn, '推荐品质图表', '请查看当前仓库已保存的验收数据，推荐可以生成哪些品质图表，并说明统计口径。'],
            [FileSpreadsheet, '上传表格，新增物料', '我想上传表格新增物料档案，请帮我核对列对应关系。'],
          ].sort((a, b) => mode === 'production' ? Number(b[0] === ChartColumn) - Number(a[0] === ChartColumn) : 0).map(([Icon, label, value]) => <AntButton type="default" htmlType="button" key={label} onClick={() => suggest(value)}><Icon size={19} /><span>{label}</span><ArrowUpRight size={15} /></AntButton>)}</div>
        </div>}
        <div className="ai-messages" aria-live="polite" aria-busy={busy}>
          {turns.map((turn, turnIndex) => <div className="ai-turn" key={turnIndex}>
          {turn.messages.map((m, i) => <div className={`ai-message ai-${m.role}`} key={i}>
            {m.role !== 'user' && <div className="ai-avatar"><Sparkles size={17} /></div>}
            <div className="ai-message-body">{m.role !== 'user' && <div className="ai-author">AI 助手</div>}
              {m.role === 'user' ? <UserMessage content={m.content} attachment={m.attachment} /> : <><div className="ai-markdown"><Markdown skipHtml urlTransform={url => /^https?:\/\//i.test(url) ? url : undefined} remarkPlugins={[remarkGfm]} components={{ table: ({ children }) => <div className="ai-table" tabIndex={0} aria-label="查询结果"><table>{children}</table></div>, a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>, img: ({ alt }) => <span>{alt}</span> }}>{m.content}</Markdown></div><AntButton type="text" htmlType="button" className="ai-copy" onClick={() => copy(m.content, `${turnIndex}:${i}`)}>{copied === `${turnIndex}:${i}` ? <Check size={13} /> : <Copy size={13} />}{copied === `${turnIndex}:${i}` ? '已复制' : '复制'}</AntButton></>}
            </div>
          </div>)}
          {!!turn.actions.length && <div className="ai-actions">{turn.actions.map(action => <ActionCard key={action.id} action={action} busy={busy} confirm={confirm}/>)}</div>}
          </div>)}
          {pending && <div className="ai-message ai-user"><div className="ai-message-body">{typeof pending === 'object' ? <UserMessage content={pending.content} attachment={pending.attachment} /> : <p>{pending}</p>}</div></div>}
          {busy && <div className="ai-processing" role="status"><LoaderCircle size={16} />{AI_STAGES[stage]}</div>}
        </div>
      </div>
      <div className="ai-compose-area">
        {error && <p className="form-error" role="alert">{error}</p>}
        <AntForm noValidate layout="vertical" scrollToFirstError={{ focus: true }} className="ai-composer" onFinish={() => {  send(); }}>
          {file && <div className="ai-attachment"><FileSpreadsheet size={17} /><span>{file.name} · {file.table.length - 1} 行</span><AntButton type="text" htmlType="button" className="ai-icon" aria-label="移除附件" disabled={busy} onClick={() => { setFile(null); input.current.value = ''; }}><X size={15} /></AntButton></div>}
          <AntInput.TextArea ref={prompt} aria-label="你的需求" rows={2} maxLength={4000} value={text} disabled={busy} placeholder="描述你的需求，或上传物料表格…" onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
          <div className="ai-composer-tools"><input className="ai-file-input" ref={input} aria-label="附加物料 Excel / CSV" type="file" accept=".xlsx,.csv" disabled={busy} onChange={e => upload(e.target.files?.[0])} /><AntButton type="text" className="ai-upload" htmlType="button" disabled={busy} onClick={() => input.current?.click()}><Plus size={19} /><span>添加表格</span></AntButton><span className="ai-shortcut">Ctrl / ⌘ + Enter 发送</span><AntButton type="text" htmlType="submit" className="ai-send" aria-label="发送" disabled={busy || !text.trim()}><ArrowUp size={21} /></AntButton></div>
        </AntForm>
        <details className="ai-upload-help"><summary>Excel / CSV 上传说明</summary><p>仅解析第一张工作表，最多1000行、5 MB；条码请设为文本以保留前导零。请说明数量是期初库存还是入出库数量。</p></details>
        <p className="ai-safety"><ShieldCheck size={12} />涉及库存变更的操作，将在你确认后执行</p>
      </div>
    </section>
  </div>;
}
