import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ClipboardList, Plus, Save, XCircle } from 'lucide-react';
import { api } from '../api.js';
import { useBusiness } from '../business-api.js';
import { useQuery, queryPath } from '../queries.js';
import { usePermissions } from '../permissions.jsx';
import { PageHeading, Button, Badge, QueryStatus } from '../components/common.jsx';
import { Select } from '../Dropdown.jsx';
import { parseQuantity } from '../../shared/quantity.js';
import { bomShortage } from '../../shared/bom.js';
import { productionStatusLabels, productionPlannedQuantity, validateProductionPlan, validateProductionCompletion, productionMaterialAnalysis } from '../../shared/production.js';
import { scrapExpectedQuantity, validateScrapActuals } from '../../shared/scrap.js';
import { MaterialVariance } from '../features/MaterialVariance.jsx';
import { ScrapOutputs } from '../features/ScrapOutputs.jsx';
import './bom.css';
import './production.css';

const count = value => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 6 });
const money = value => (value / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const time = value => new Date(value).toLocaleString('zh-CN', { hour12: false });
const statusBadge = status => <Badge tone={status === 'completed' ? 'green' : status === 'draft' ? 'blue' : 'orange'}>{productionStatusLabels[status]}</Badge>;

function BomPicker({ data, disabled, onSelect }) {
  const [q, setQ] = useState(''), [offset, setOffset] = useState(0);
  const list = useQuery(queryPath('/production-orders/boms', { q, offset, limit: 10 }), data, 150);
  return <section className="panel bom-section"><h2>选择成品配方</h2>
    <input type="search" aria-label="搜索生产配方" placeholder="搜索成品名称、编码或清单名称" maxLength={100} value={q} disabled={disabled}
      onChange={e => { setQ(e.target.value); setOffset(0); }} />
    <QueryStatus query={list} />
    <div className="production-bom-options">{list.result?.boms.map(bom => <div className="bom-search-product" key={bom.id}>
      <div><strong>{bom.product_name}</strong><small>{bom.barcode} · {bom.name} · 基准产量 {count(bom.base_quantity)} {bom.base_unit}</small></div>
      <Button type="button" disabled={disabled || !bom.product_active} onClick={() => onSelect(bom)} aria-label={`选择配方 ${bom.product_name}`}>选择</Button>
    </div>)}</div>
    {list.result && !list.result.boms.length && <p className="bom-empty">没有匹配的已启用配方，请先在BOM中配置。</p>}
    {(offset > 0 || list.result?.has_more) && <div className="bom-actions bom-pagination">
      <Button type="button" disabled={disabled || !offset || list.loading} onClick={() => setOffset(n => n - 10)}>上一页配方</Button>
      <Button type="button" disabled={disabled || !list.result?.has_more || list.loading} onClick={() => setOffset(n => n + 10)}>下一页配方</Button>
    </div>}
  </section>;
}

function Materials({ rows, complete, disabled, onQuantity, onReason, completedQuantity, baseQuantity, showActual, costs }) {
  return <div className="production-materials">{rows.map(row => {
    const raw = complete ? row.quantity : showActual ? row.actual_quantity : row.planned_quantity;
    const value = Number(raw), valid = raw !== '' && Number.isFinite(value) && value >= 0;
    const shortage = valid && row.product ? bomShortage(value, row.product.stock) : 0;
    let analysis = row;
    if (complete) {
      try { analysis = productionMaterialAnalysis(row, parseQuantity(completedQuantity, true), baseQuantity, parseQuantity(row.quantity)); }
      catch { analysis = { standard_quantity: null, variance_quantity: null, variance_rate: null, analysis_error: '请先填写有效的合格成品数量和实际耗料。' }; }
    }
    return <article className="production-material" key={row.product_id}>
      <div className="production-material-name"><strong>{row.name}</strong><small>{row.barcode}{row.specification && ` · ${row.specification}`}</small>
        <small>基准净用量 {row.base_quantity_fraction || count(row.base_quantity)} {row.unit} · 标准损耗率 {count(row.loss_rate ?? 0)}%</small>
        {row.note && <small>{row.note}</small>}
        {row.product && row.unit !== row.product.unit && <p className="bom-warning">当前单位已变为 {row.product.unit}，此单保留 {row.unit}。</p>}
        {row.product && !row.product.active && <p className="bom-warning">材料已停用</p>}</div>
      <div><small>计划用量</small><span>{count(row.planned_quantity)} {row.unit}</span></div>
      {complete ? <label>实际耗料（{row.unit}）<input aria-label={`${row.name}实际耗料`} inputMode="decimal" required disabled={disabled} value={row.quantity}
        onChange={e => onQuantity(row.product_id, e.target.value)} /></label> : showActual && <div><small>实际耗料</small><span>{count(row.actual_quantity)} {row.unit}</span></div>}
      {!showActual && row.product && <div><small>账面库存</small><span>{count(row.product.stock)} {row.unit}</span>
        {shortage > 0 && <strong className="bom-shortage">缺料 {count(shortage)} {row.unit}</strong>}</div>}
      {costs && showActual && <div><small>材料成本</small><span>¥ {money(row.cost_cents)}</span></div>}
      {(complete || showActual) && <MaterialVariance row={row} analysis={analysis} complete={complete} disabled={disabled} onReason={onReason} />}
    </article>;
  })}</div>;
}

export function Production({ data, initialBom, onChanged }) {
  const { can } = usePermissions();
  const [q, setQ] = useState(''), [status, setStatus] = useState('all'), [offset, setOffset] = useState(0), [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState(null), [editor, setEditor] = useState(null), [baseline, setBaseline] = useState(''), [message, setMessage] = useState('');
  const action = useBusiness();
  const listData = useMemo(() => ({ ...data, productionRevision: revision }), [data, revision]);
  const list = useQuery(queryPath('/production-orders', { q, status, offset }), listData, 150);
  const dirty = !!editor && JSON.stringify(editor) !== baseline;
  useEffect(() => { window.scrollTo({ top: 0 }); }, [detail?.id, editor?.kind]);
  const guard = useRef({}); guard.current = { dirty, busy: action.busy };
  useEffect(() => {
    const before = event => { if (guard.current.busy || guard.current.dirty && !window.confirm('生产单尚未保存，确定离开？')) event.preventDefault(); };
    const unload = event => { if (guard.current.dirty || guard.current.busy) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('erp:before-navigate', before); window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('erp:before-navigate', before); window.removeEventListener('beforeunload', unload); };
  }, []);
  const begin = value => { setEditor(value); setBaseline(JSON.stringify(value)); setMessage(''); action.setError(''); };
  const update = value => { setEditor(previous => ({ ...previous, ...value })); action.setError(''); };
  const chooseBom = async bom => {
    const plan = await api('/production-orders/prepare', { method: 'POST', warehouseId: data.warehouse_id,
      body: { bom_id: bom.id, bom_version: bom.version, planned_quantity: bom.planned_quantity || bom.base_quantity } });
    setEditor(previous => ({ kind: 'new', note: previous?.note || '', planned_quantity: String(plan.production_quantity), plan }));
  };
  const initial = useRef(false);
  useEffect(() => {
    if (!initialBom || initial.current) return;
    initial.current = true;
    begin({ kind: 'new', note: '', planned_quantity: '1', plan: null });
    action.run(() => chooseBom(initialBom));
  }, [initialBom]);
  const back = () => {
    if (action.busy || dirty && !window.confirm('生产单尚未保存，确定离开？')) return;
    if (editor) setEditor(null); else setDetail(null);
    action.setError(''); setMessage('');
  };
  const open = id => action.run(async () => {
    const order = await api(`/production-orders/${id}`, { warehouseId: data.warehouse_id });
    setDetail(order); setEditor(null); setMessage('');
  });
  const saved = async (order, text, stockChanged = false) => {
    setDetail(order); setEditor(null); setMessage(text); setRevision(n => n + 1);
    if (stockChanged) await onChanged?.();
  };
  const submit = event => {
    event.preventDefault();
    action.run(async () => {
      const options = { warehouseId: data.warehouse_id };
      if (editor.kind === 'new' || editor.kind === 'edit') {
        const body = { planned_quantity: parseQuantity(editor.planned_quantity, true), note: editor.note };
        validateProductionPlan(body);
        const path = editor.kind === 'new' ? '/production-orders' : `/production-orders/${detail.id}`;
        if (editor.kind === 'new') { body.bom_id = editor.plan.bom_id; body.bom_version = editor.plan.version; }
        else body.version = detail.version;
        await saved(await action.send(path, body, options), '生产草稿已保存，库存未变动。');
      } else if (editor.kind === 'complete') {
        const body = { version: detail.version, completed_quantity: parseQuantity(editor.completed_quantity, true),
          items: editor.items.map(row => ({ product_id: row.product_id, quantity: parseQuantity(row.quantity), variance_reason: row.variance_reason })),
          scraps: editor.scraps.map(row => ({ product_id: row.product_id, quantity: parseQuantity(row.quantity), disposition: row.disposition })) };
        validateProductionCompletion(body, detail.items);
        validateScrapActuals(body.scraps, detail.scraps || []);
        if (!window.confirm(`确认入库 ${count(body.completed_quantity)} ${detail.unit}${detail.product_name}，并按页面实际耗料扣减材料库存、登记废料产出与入库？`)) return;
        await saved(await action.send(`/production-orders/${detail.id}/complete`, body, options), '生产单已完工，材料已扣减，合格成品已入库。', true);
      } else {
        if (!editor.reason.trim()) throw new Error('请填写作废原因。');
        if (!window.confirm(detail.completed_at ? '确认作废此生产单？系统将扣回成品，并按原数量和原成本退回材料，同时扣回已入库废料。' : '确认作废此生产草稿？')) return;
        await saved(await action.send(`/production-orders/${detail.id}/void`, { version: detail.version, reason: editor.reason }, options),
          detail.completed_at ? '生产单已作废，库存与原成本已回退。' : '生产草稿已作废，库存未变动。', !!detail.completed_at);
      }
    });
  };

  const heading = (title, description, label = '返回生产单') => <PageHeading title={title} description={description}>
    <Button icon={ArrowLeft} disabled={action.busy} onClick={back}>{label}</Button>
  </PageHeading>;
  const notices = <>{message && <p className="bom-success" role="status">{message}</p>}{action.error && <p className="form-error" role="alert">{action.error}</p>}</>;

  if (editor) {
    const planning = ['new', 'edit'].includes(editor.kind), source = editor.kind === 'new' ? editor.plan : detail;
    let rows = source?.items || source?.rows.map(row => ({ ...row, base_quantity: row.quantity, base_quantity_fraction: row.quantity_fraction, planned_quantity: row.required, product: { stock: row.stock, unit: row.unit, active: 1 } })) || [];
    let quantityError = '';
    if (planning && source) {
      try {
        const quantity = parseQuantity(editor.planned_quantity, true);
        rows = rows.map(row => ({ ...row, planned_quantity: productionPlannedQuantity(row.base_quantity, quantity, source.base_quantity, row.base_quantity_fraction, row.loss_rate) }));
      } catch (error) { quantityError = error.message; }
    }
    if (editor.kind === 'complete') rows = rows.map(row => ({ ...row, ...editor.items.find(item => item.product_id === row.product_id) }));
    const scrapRows = (source?.scraps || []).map(row => {
      let planned_quantity = row.planned_quantity, expected_quantity = null;
      try {
        if (planning) planned_quantity = scrapExpectedQuantity(row, parseQuantity(editor.planned_quantity, true), source.base_quantity,
          rows.map(item => ({ product_id: item.product_id, quantity: item.planned_quantity })));
        if (editor.kind === 'complete') expected_quantity = scrapExpectedQuantity(row, parseQuantity(editor.completed_quantity, true), source.base_quantity,
          editor.items.map(item => ({ product_id: item.product_id, quantity: parseQuantity(item.quantity) })));
      } catch { planned_quantity = null; }
      const actual = editor.scraps?.find(item => item.product_id === row.product_id);
      return { ...row, planned_quantity, expected_quantity, actual: actual?.quantity, disposition: actual?.disposition };
    });
    const name = editor.kind === 'new' ? source?.product.name : detail.product_name, unit = editor.kind === 'new' ? source?.product.unit : detail.unit;
    return <div className="bom-page production-page">
      {heading({ new: '新建生产单', edit: '编辑生产草稿', complete: '确认生产完工', void: '作废生产单' }[editor.kind], planning ? '选择配方和计划产量，保存草稿后安排生产。' : `${detail.number} · ${detail.product_name}`, detail ? '返回单据详情' : '返回生产单')}
      <form onSubmit={submit}>
        {editor.kind === 'new' && <BomPicker data={listData} disabled={action.busy} onSelect={bom => action.run(() => chooseBom(bom))} />}
        {source && <section className="panel bom-section">
          <h2>{name}</h2><small>{editor.kind === 'new' ? source.product.barcode : detail.barcode} · {editor.kind === 'new' ? source.name : detail.bom_name}</small>
          {planning ? <>
            <div className="bom-form-grid production-fields"><label>计划产量（{unit}）<input aria-label="计划产量" inputMode="decimal" required value={editor.planned_quantity} disabled={action.busy} onChange={e => update({ planned_quantity: e.target.value })} /></label>
              <label>生产备注<textarea aria-label="生产备注" rows={2} maxLength={500} value={editor.note} disabled={action.busy} onChange={e => update({ note: e.target.value })} /></label></div>
            <p className="bom-hint">净用量与标准损耗率随生产单保存，计划用量已含标准损耗。草稿不预留、不扣减库存，完工时再核对实际耗料。</p>
          </> : editor.kind === 'complete' ? <>
            <p className="bom-hint">计划产量 {count(detail.planned_quantity)} {unit}。实际耗料默认按计划用量带出，请按本次实际情况核对。</p>
            <label className="production-output">合格成品数量（{unit}）<input aria-label="合格成品数量" inputMode="decimal" required disabled={action.busy} value={editor.completed_quantity} onChange={e => update({ completed_quantity: e.target.value })} /></label>
            <p className="bom-hint">只入库本次合格成品；实际耗料包含生产损耗。未使用的材料填 0，至少一种材料需大于 0。</p>
          </> : <>
            <p className="bom-warning">{detail.completed_at ? `将扣回 ${count(detail.completed_quantity)} ${unit}成品和已入库废料，并按原数量、原成本退回材料。成品库存或成本不足、物料单位变化时无法作废。` : '此草稿尚未影响库存，作废后不能继续生产。'}</p>
            <label>作废原因<textarea aria-label="作废原因" required rows={3} maxLength={500} value={editor.reason} disabled={action.busy} onChange={e => update({ reason: e.target.value })} /></label>
          </>}
        </section>}
        {source && editor.kind !== 'void' && <section className="panel bom-section"><div className="bom-section-heading"><h2>{editor.kind === 'complete' ? '核对实际耗料' : '计划备料'}</h2><span className="bom-hint">共 {rows.length} 种材料</span></div>
          {quantityError && <p className="form-error" role="alert">{quantityError}</p>}
          {editor.kind === 'complete' && <p className="bom-hint">标准耗料按本单保存的净用量、标准损耗率和实际合格产量计算，已包含允许的标准损耗。差异 = 实际耗料 − 标准耗料，正数为超耗、负数为节省；差异率以标准耗料为分母。废料单独核对，耗料差异不直接视为损耗或废料。</p>}
          <Materials rows={rows} completedQuantity={editor.completed_quantity} baseQuantity={source.base_quantity}
            onReason={(id, variance_reason) => update({ items: editor.items.map(item => item.product_id === id ? { ...item, variance_reason } : item) })} complete={editor.kind === 'complete'} disabled={action.busy}
            onQuantity={(id, quantity) => update({ items: editor.items.map(item => item.product_id === id ? { ...item, quantity } : item) })} />
          <p className="bom-hint">账面库存读取于 {time(source.captured_at)}，提交完工时会重新校验。</p>
        </section>}
        {source && editor.kind !== 'void' && <section className="panel bom-section"><ScrapOutputs rows={scrapRows} materials={rows} complete={editor.kind === 'complete'} disabled={action.busy}
          onChange={(id, patch) => update({ scraps: editor.scraps.map(row => row.product_id === id ? { ...row, ...patch } : row) })} />
          {scrapRows.length > 0 && editor.kind === 'complete' && <p className="bom-hint">修改产量或耗料会重算预计数量，已填写的实际废料数量会保留，请重新核对或点击「采用预计数量」。</p>}
          {!scrapRows.length && <p className="bom-hint">本单未配置废料产出。</p>}
        </section>}
        {notices}
        <div className="bom-editor-actions"><Button type="button" disabled={action.busy} onClick={back}>取消</Button>
          {detail && <Button type="button" disabled={action.busy} onClick={() => { if (!dirty || window.confirm('重新读取会丢弃当前填写内容，确定继续？')) open(detail.id); }}>重新读取生产单</Button>}
          <Button type="submit" kind="primary" icon={planning ? Save : editor.kind === 'complete' ? Check : XCircle} busy={action.busy} disabled={!source || !!quantityError}>
            {planning ? '保存生产草稿' : editor.kind === 'complete' ? '确认完工并入库' : '确认作废'}</Button>
        </div>
      </form>
    </div>;
  }

  if (detail) return <div className="bom-page production-page">
    {heading('生产单详情', detail.number)}{notices}
    <section className="panel bom-section"><div className="bom-section-heading"><div><h2>{detail.product_name}</h2><small>{detail.barcode}{detail.specification && ` · ${detail.specification}`}</small></div>{statusBadge(detail.status)}</div>
      <div className="production-summary"><div><small>计划产量</small><strong>{count(detail.planned_quantity)} {detail.unit}</strong></div>
        <div><small>合格成品</small><strong>{detail.completed_at ? `${count(detail.completed_quantity)} ${detail.unit}` : '待完工'}</strong></div>
        {can('finance') && detail.completed_at && <div><small>材料成本合计</small><strong>¥ {money(detail.total_cost_cents)}</strong></div>}
      </div>
      <p className="bom-hint">配方：{detail.bom_name} · 基准产量 {count(detail.base_quantity)} {detail.unit} · 保留建单时的材料配方</p>
      {detail.note && <p className="production-note">{detail.note}</p>}
      <div className="production-audit"><p>创建：{detail.created_by_name} · {time(detail.created_at)}</p><p>更新：{detail.updated_by_name} · {time(detail.updated_at)}</p>
        {detail.completed_at && <p>完工：{detail.completed_by_name} · {time(detail.completed_at)}</p>}
        {detail.voided_at && <><p>作废：{detail.voided_by_name} · {time(detail.voided_at)}</p><p>作废原因：{detail.void_reason}</p></>}
      </div>
      <div className="bom-actions">
        {detail.status === 'draft' && <><Button disabled={action.busy} onClick={() => begin({ kind: 'edit', planned_quantity: String(detail.planned_quantity), note: detail.note })}>编辑草稿</Button>
          <Button kind="primary" icon={Check} disabled={action.busy} onClick={() => begin({ kind: 'complete', completed_quantity: String(detail.planned_quantity), items: detail.items.map(item => ({ product_id: item.product_id, quantity: String(item.planned_quantity), variance_reason: item.variance_reason || '' })), scraps: (detail.scraps || []).map(row => ({ product_id: row.product_id, quantity: String(row.planned_quantity), disposition: 'stock' })) })}>登记完工</Button></>}
        {detail.status !== 'void' && can('corrections') && <Button icon={XCircle} disabled={action.busy} onClick={() => begin({ kind: 'void', reason: '' })}>作废生产单</Button>}
        <Button disabled={action.busy} onClick={() => open(detail.id)}>刷新单据与库存</Button>
      </div>
    </section>
    {(detail.scraps || []).length > 0 && <section className="panel bom-section"><ScrapOutputs rows={detail.scraps} materials={detail.items} completed={!!detail.completed_at} />
      {detail.status === 'void' && detail.completed_at && <p className="bom-hint">本单已作废，以上废料记录保留，已入库数量已扣回。</p>}
    </section>}
    <section className="panel bom-section"><h2>{detail.completed_at ? '耗料记录' : '计划备料'}</h2>
      {detail.completed_at && <p className="bom-hint">标准耗料按本单净用量、标准损耗率快照及实际合格产量计算，已含标准损耗；差异 = 实际耗料 − 标准耗料，差异率 = 差异 ÷ 标准耗料。各材料分别比较，不跨单位合计，也不从实际耗料中再次扣除废料。</p>}
      <Materials rows={detail.items} showActual={!!detail.completed_at} costs={can('finance')} />
      {detail.status === 'void' && detail.completed_at && <p className="bom-hint">以上保留原完工记录；本单已作废，相关库存和成本已回退。</p>}
      {!detail.completed_at && <p className="bom-hint">库存读取于 {time(detail.captured_at)}。草稿未预留库存，完工时重新校验。</p>}
    </section>
  </div>;

  return <div className="bom-page production-page">
    <PageHeading title="生产单" description="按配方安排生产，完工时登记实际耗料和合格成品。">
      <Button kind="primary" icon={Plus} disabled={action.busy} onClick={() => begin({ kind: 'new', note: '', planned_quantity: '1', plan: null })}>新建生产单</Button>
    </PageHeading>{notices}
    <section className="panel bom-section"><div className="bom-list-filters">
      <input type="search" aria-label="搜索生产单" placeholder="搜索单号、成品名称、编码或配方" maxLength={100} value={q} onChange={e => { setQ(e.target.value); setOffset(0); }} />
      <Select aria-label="生产单状态" value={status} onChange={e => { setStatus(e.target.value); setOffset(0); }}><option value="all">全部状态</option>
        {Object.entries(productionStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select>
    </div><QueryStatus query={list} />
      <div className="production-list">{list.result?.orders.map(order => <article className="bom-list-item" key={order.id}>
        <div className="bom-list-info"><strong>{order.product_name}</strong><p>{order.number}</p><small>{order.barcode} · {order.bom_name}</small>
          <small>计划 {count(order.planned_quantity)} {order.unit}{order.completed_at ? ` · 合格 ${count(order.completed_quantity)} ${order.unit}` : ''} · 创建人 {order.created_by_name}</small>
          <small>{time(order.created_at)}</small>{statusBadge(order.status)}</div>
        <Button icon={ClipboardList} disabled={action.busy} onClick={() => open(order.id)} aria-label={`查看生产单 ${order.number}`}>查看详情</Button>
      </article>)}</div>
      {list.result && !list.result.orders.length && <p className="bom-empty">暂无匹配的生产单。选择已有BOM，建立第一张生产草稿。</p>}
      {list.result && (offset > 0 || list.result.has_more) && <div className="bom-actions bom-pagination"><Button disabled={!offset} onClick={() => setOffset(n => n - 30)}>上一页</Button><span>共 {list.result.total} 张</span><Button disabled={!list.result.has_more} onClick={() => setOffset(n => n + 30)}>下一页</Button></div>}
    </section>
  </div>;
}
