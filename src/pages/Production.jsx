import { Form as AntForm } from 'antd';
import { Input as AntInput } from '../ui/controls.jsx';
import { FormField } from './../ui/FormField.jsx';

import { calculateBomNodes } from '../../shared/bom-expansion.js';
import { BomStructure } from '../features/BomStructure.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ClipboardList, Plus, Save, Trash2, XCircle } from 'lucide-react';
import { api } from '../api.js';
import { useBusiness } from '../business-api.js';
import { useQuery, queryPath } from '../queries.js';
import { usePermissions } from '../permissions.jsx';
import { PageHeading, Button, Badge, QueryStatus } from '../components/common.jsx';
import { Select } from '../Dropdown.jsx';
import { parseQuantity, quantityUnits, QUANTITY_SCALE, materialQuantity, validQuantity } from '../../shared/quantity.js';
import { bomShortage, bomLossMethodLabels, bomLossMethodFormulas } from '../../shared/bom.js';
import { productionStatusLabels, productionItemQuantity, validateProductionPlan, validateProductionCompletion, productionMaterialAnalysis } from '../../shared/production.js';
import { scrapExpectedQuantity, validateScrapActuals } from '../../shared/scrap.js';
import { MaterialVariance } from '../features/MaterialVariance.jsx';
import { ScrapOutputs } from '../features/ScrapOutputs.jsx';
import { MaterialDocumentList } from '../features/ProductionMaterialDocuments.jsx';
import './bom.css';
import './production.css';
import { money as formatMoney, currencySymbol } from '../app/format.js';

const count = value => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 4 });
const money = value => `${currencySymbol()}${formatMoney(value / 100)}`;
const time = value => new Date(value).toLocaleString('zh-CN', { hour12: false });
const statusBadge = status => <Badge tone={status === 'completed' ? 'green' : status === 'draft' ? 'blue' : 'orange'}>{productionStatusLabels[status]}</Badge>;

function BomPicker({ data, disabled, onSelect }) {
  const [q, setQ] = useState(''), [offset, setOffset] = useState(0);
  const list = useQuery(queryPath('/production-orders/boms', { q, offset, limit: 10 }), data, 150);
  return <section className="panel bom-section"><h2>选择成品配方</h2>
    <AntInput type="search" aria-label="搜索生产配方" placeholder="搜索成品名称、编码或清单名称" maxLength={100} value={q} disabled={disabled}
      onChange={e => { setQ(e.target.value); setOffset(0); }} />
    <QueryStatus query={list} />
    <div className="production-bom-options">{list.result?.boms.map(bom => <div className="bom-search-product" key={bom.id}>
      <div><strong>{bom.product_name}</strong><small>{bom.barcode} · {bom.name} #{bom.id} · 基准产量 {count(bom.base_quantity)} {bom.base_unit}</small></div>
      <Button type="button" disabled={disabled || !bom.product_active} onClick={() => onSelect(bom)} aria-label={`选择配方 ${bom.product_name} · ${bom.name} #${bom.id}`}>选择</Button>
    </div>)}</div>
    {list.result && !list.result.boms.length && <p className="bom-empty">没有匹配的已启用配方，请先在BOM中配置。</p>}
    {(offset > 0 || list.result?.has_more) && <div className="bom-actions bom-pagination">
      <Button type="button" disabled={disabled || !offset || list.loading} onClick={() => setOffset(n => n - 10)}>上一页配方</Button>
      <Button type="button" disabled={disabled || !list.result?.has_more || list.loading} onClick={() => setOffset(n => n + 10)}>下一页配方</Button>
    </div>}
  </section>;
}

function Materials({ rows, complete, disabled, onQuantity, onReason, completedQuantity, baseQuantity, lossMethod, nodes, showActual, costs, issued }) {
  let standards;
  if (nodes && complete) {
    try { standards = new Map(calculateBomNodes(nodes, Number(completedQuantity)).rows.map(row => [row.product_id, row.required])); }
    catch { standards = new Map(); }
  }
  return <div className="production-materials">{rows.map(row => {
    const raw = complete ? row.quantity : showActual ? row.actual_quantity : row.planned_quantity;
    const value = Number(raw), valid = raw !== '' && Number.isFinite(value) && value >= 0;
    const shortage = valid && row.product ? bomShortage(value, issued ? row.available_quantity : row.product.stock) : 0;
    let analysis = row;
    if (complete) {
      try { analysis = productionMaterialAnalysis(row, parseQuantity(completedQuantity, true), baseQuantity, parseQuantity(row.quantity), lossMethod, standards); }
      catch { analysis = { standard_quantity: null, variance_quantity: null, variance_rate: null, analysis_error: '请先填写有效的合格成品数量和实际耗料。' }; }
    }
    return <article className="production-material" key={row.product_id}>
      <div className="production-material-name"><strong>{row.name}</strong><small>{row.barcode}{row.specification && ` · ${row.specification}`}</small>
        {row.base_quantity === null ? <small>多层配方汇总，基准用量与损耗见结构来源。</small> : <small>基准净用量 {row.base_quantity_fraction || count(row.base_quantity)} {row.unit} · 标准损耗率 {count(row.loss_rate ?? 0)}%</small>}
        {row.note && <small>{row.note}</small>}
        {row.product && row.unit !== row.product.unit && <p className="bom-warning">当前单位已变为 {row.product.unit}，此单保留 {row.unit}。</p>}
        {row.product && !row.product.active && <p className="bom-warning">材料已停用</p>}</div>
      <div><small>计划用量</small><span>{count(row.planned_quantity)} {row.unit}</span></div>
      {complete ? <label>实际耗料（{row.unit}）<FormField value={row.quantity} required label={`${row.name}实际耗料`}><AntInput aria-label={`${row.name}实际耗料`} inputMode="decimal"  disabled={disabled} value={row.quantity}
        onBlur={() => { if (row.unit_round_up && validQuantity(Number(row.quantity))) onQuantity(row.product_id, materialQuantity(Number(row.quantity), row)); }}
        onChange={e => onQuantity(row.product_id, e.target.value)} /></FormField></label> : showActual && <div><small>实际耗料</small><span>{count(row.actual_quantity)} {row.unit}</span></div>}
      {!showActual && row.product && <div><small>{issued ? '已领可用' : '账面库存'}</small><span>{count(issued ? row.available_quantity : row.product.stock)} {row.unit}</span>
        {shortage > 0 && <strong className="bom-shortage">{issued ? '需补料' : '缺料'} {count(shortage)} {row.unit}</strong>}</div>}
      {costs && showActual && <div><small>材料成本</small><span>{money(row.cost_cents)}</span></div>}
      {(complete || showActual) && <MaterialVariance row={row} analysis={analysis} complete={complete} disabled={disabled} onReason={onReason} />}
    </article>;
  })}</div>;
}

function ProductionBatches({ order, costs, canVoid, disabled, onVoid }) {
  const [expanded, setExpanded] = useState(null);
  if (!order.batches?.length) return null;
  return <section className="panel bom-section production-batches" aria-label="完工批次">
    <h2>完工批次</h2><p className="bom-hint">累计进度和耗料仅汇总有效批次。作废记录保留供追溯，整单作废后累计数为作废前的历史记录。</p>
    {order.batches.map(batch => <article key={batch.id} className="production-batch">
      <div className="bom-section-heading"><strong>第 {batch.batch_number} 批 · {count(batch.completed_quantity)} {order.unit}</strong><Badge tone={batch.status === 'active' ? 'green' : 'orange'}>{batch.status === 'active' ? '有效' : '本批已作废'}</Badge></div>
      <small>{batch.created_by_name} · {time(batch.created_at)}{costs && ` · 材料成本 ${money(batch.total_cost_cents)}`}</small>
      {batch.note && <p className="production-note">{batch.note}</p>}
      {batch.status === 'void' && <p className="bom-hint">作废：{batch.voided_by_name} · {time(batch.voided_at)} · {batch.void_reason}</p>}
      <div className="bom-actions"><Button disabled={disabled} aria-expanded={expanded === batch.id} onClick={() => setExpanded(expanded === batch.id ? null : batch.id)}>{expanded === batch.id ? '收起' : '查看'}第 {batch.batch_number} 批明细</Button>
        {canVoid && batch.status === 'active' && order.status !== 'void' && <Button disabled={disabled} onClick={() => onVoid(batch)}>作废第 {batch.batch_number} 批</Button>}</div>
      {expanded === batch.id && <div className="production-batch-detail">
        {batch.items.map(item => <div className="production-batch-material" key={item.product_id}><strong>{item.name}</strong><p>实际耗料 {count(item.actual_quantity)} {item.unit}{costs && ` · 材料成本 ${money(item.cost_cents)}`}</p><MaterialVariance row={item} analysis={item} /></div>)}
        <ScrapOutputs rows={batch.scraps} materials={batch.items} completed showPlan={false} />
      </div>}
    </article>)}
  </section>;
}

export function Production({ data, initialBom, onChanged, onNavigate }) {
  const { can } = usePermissions();
  const [q, setQ] = useState(''), [status, setStatus] = useState('all'), [offset, setOffset] = useState(0), [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState(null), [editor, setEditor] = useState(null), [baseline, setBaseline] = useState(''), [message, setMessage] = useState('');
  const action = useBusiness();
  const send = (path, body, options) => action.send(path, { schema_version: 2, ...body }, options);
  const listData = useMemo(() => ({ ...data, productionRevision: revision }), [data, revision]);
  const list = useQuery(queryPath('/production-orders', { q, status, offset }), listData, 150);
  const dirty = !!editor && JSON.stringify(editor) !== baseline;
  // A workspace refresh after warehouse approval must refresh an open detail too.
  // Leave edits untouched; their version is checked when submitted.
  const detailId = detail?.id, editing = !!editor;
  useEffect(() => {
    if (!detailId || editing || action.busy) return;
    const controller = new AbortController();
    api(`/production-orders/${detailId}`, { warehouseId: data.warehouse_id, signal: controller.signal })
      .then(order => { if (!controller.signal.aborted) setDetail(order); })
      .catch(error => { if (!controller.signal.aborted) action.setError(error.message); });
    return () => controller.abort();
  }, [data, detailId, editing, action.busy]);
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
      body: { bom_id: bom.id, schema_version: 2, bom_version: bom.version, planned_quantity: bom.planned_quantity || bom.base_quantity } });
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
  const remove = order => {
    if (!window.confirm(`确定删除已作废生产单「${order.number}」？删除无法恢复，耗料、废料、完工批次、配方快照及相关物料操作历史将一并清理，库存和成本保持作废后的结果。`)) return;
    action.run(async () => {
      setMessage('');
      await send(`/production-orders/${order.id}/delete`, { version: order.version }, { warehouseId: data.warehouse_id });
      setDetail(null); setEditor(null);
      if (list.result?.orders.length === 1 && offset > 0) setOffset(n => Math.max(0, n - 30));
      setRevision(n => n + 1); setMessage('生产单已删除。');
    });
  };
  const batchDefaults = quantity => {
    const standards = detail.snapshot_format === 2 ? new Map(calculateBomNodes(detail.nodes, quantity, detail.quantity_decimals).rows.map(row => [row.product_id, row.required])) : null;
    const items = detail.items.map(item => ({ product_id: item.product_id,
      quantity: String(productionItemQuantity(item, quantity, detail, standards)), variance_reason: '' }));
    const scraps = (detail.scraps || []).map(row => ({ product_id: row.product_id,
      quantity: String(scrapExpectedQuantity(row, quantity, detail.base_quantity, items.map(item => ({ ...item, quantity: Number(item.quantity) })))), disposition: 'stock' }));
    return { items, scraps };
  };
  const beginCompletion = () => action.run(async () => {
    const remaining = Math.max(0, quantityUnits(detail.planned_quantity) - quantityUnits(detail.completed_quantity ?? 0)) / QUANTITY_SCALE;
    const quantity = remaining || 1;
    begin({ kind: 'complete', completed_quantity: String(quantity), note: '', ...batchDefaults(quantity) });
  });
  const startProduction = () => action.run(async () => {
    if (!window.confirm('确认开始生产？将按本单计划用量生成待批准领料出库单，仓库确认出库后才能登记。')) return;
    await saved(await send(`/production-orders/${detail.id}/start`, { version: detail.version }, { warehouseId: data.warehouse_id }), '领料申请已生成，请前往仓库领料。', true);
  });
  const requestMaterials = type => begin({ kind: 'material_request', type, note: '',
    items: detail.items.map(item => ({ product_id: item.product_id, quantity: type === 'in' ? String(item.available_quantity) : '0' })) });
  const cancelMaterialRequest = (doc, reason) => action.run(async () => {
    await send(`/production-material-documents/${doc.id}/cancel`, { version: doc.version, reason }, { warehouseId: data.warehouse_id });
    await saved(await api(`/production-orders/${detail.id}`, { warehouseId: data.warehouse_id }), '材料申请已取消，库存未变动。', true);
  });
  const finishOrder = () => action.run(async () => {
    if (!window.confirm('确认结束此生产单？已登记批次和库存保持当前结果，结束后不能继续登记，作废批次后会重新开放。')) return;
    await saved(await send(`/production-orders/${detail.id}/finish`, { version: detail.version }, { warehouseId: data.warehouse_id }), '生产单已结束，已登记批次和库存保持当前结果。');
  });
  const submitter = useRef(null);
  const submit = () => {

    const finishOrder = submitter.current !== 'continue';
    action.run(async () => {
      const options = { warehouseId: data.warehouse_id };
      if (editor.kind === 'new' || editor.kind === 'edit') {
        const body = { planned_quantity: parseQuantity(editor.planned_quantity, true), note: editor.note };
        validateProductionPlan(body);
        const path = editor.kind === 'new' ? '/production-orders' : `/production-orders/${detail.id}`;
        if (editor.kind === 'new') { body.bom_id = editor.plan.bom_id; body.bom_version = editor.plan.version; body.structure_token = editor.plan.structure_token; }
        else body.version = detail.version;
        await saved(await send(path, body, options), '生产草稿已保存，库存未变动。');
      } else if (editor.kind === 'complete') {
        const body = { version: detail.version, completed_quantity: materialQuantity(parseQuantity(editor.completed_quantity, true), detail), finish_order: finishOrder, note: editor.note,
          items: editor.items.map(row => ({ product_id: row.product_id, quantity: materialQuantity(parseQuantity(row.quantity), row), variance_reason: row.variance_reason })),
          scraps: editor.scraps.map(row => ({ product_id: row.product_id, quantity: materialQuantity(parseQuantity(row.quantity), row), disposition: row.disposition })) };
        validateProductionCompletion(body, detail.items);
        validateScrapActuals(body.scraps, detail.scraps || []);
        if (!window.confirm(`确认本批入库 ${count(body.completed_quantity)} ${detail.unit}${detail.product_name}，${detail.material_workflow ? '从已领材料余额记录耗料' : '按本批实际耗料扣库'}并登记废料，随后${finishOrder ? '结束生产单' : '继续生产'}？`)) return;
        await saved(await send(`/production-orders/${detail.id}/complete`, body, options), detail.material_workflow
          ? (finishOrder ? '生产单已完工，合格成品已入库。实际耗料已登记，仓库材料未重复扣减。' : '本批合格成品已入库，实际耗料已登记，生产单继续生产。')
          : (finishOrder ? '生产单已完工，材料已扣减，合格成品已入库。' : '本批已入库，材料已扣减，生产单继续生产。'), true);
      } else {
        if (!editor.reason.trim()) throw new Error('请填写作废原因。');
        if (editor.kind === 'void_batch') {
          if (!window.confirm(detail.material_workflow ? '确认作废此批次？扣回本批成品及已入库废料，耗料及原成本恢复至本单已领材料余额。实际退仓需另行申请退料。' : '确认作废此批次？仅扣回本批成品及已入库废料，按本批原数量和原成本退回材料，生产单重新开放。')) return;
          await saved(await send(`/production-orders/${detail.id}/batches/${editor.batchId}/void`, { version: detail.version, reason: editor.reason }, options), '本批已作废，库存与原成本已回退，生产单已重新开放。', true);
          return;
        }
        if (!window.confirm(detail.material_workflow ? '确认作废此生产单？须已撤销全部登记批次、取消待批准申请，并由仓库确认退完材料。' : detail.completed_at ? '确认作废此生产单？系统将扣回成品，并按原数量和原成本退回材料，同时扣回已入库废料。' : '确认作废此生产草稿？')) return;
        await saved(await send(`/production-orders/${detail.id}/void`, { version: detail.version, reason: editor.reason }, options),
          detail.completed_at ? '生产单已作废，库存与原成本已回退。' : '生产草稿已作废，库存未变动。', !!detail.completed_at);
      }
    });
  };

  const heading = (title, description, label = '返回生产单') => <PageHeading title={title} description={description}>
    <Button icon={ArrowLeft} disabled={action.busy} onClick={back}>{label}</Button>
  </PageHeading>;
  const notices = <>{message && <p className="bom-success" role="status">{message}</p>}{action.error && <p className="form-error" role="alert">{action.error}</p>}</>;

  if (editor?.kind === 'material_request') {
    const returning = editor.type === 'in', label = returning ? '退料' : '补料';
    const submitRequest = event => {
      event.preventDefault();
      action.run(async () => {
        const items = editor.items.map(row => ({ product_id: row.product_id,
          quantity: materialQuantity(parseQuantity(row.quantity), detail.items.find(item => item.product_id === row.product_id)) })).filter(row => row.quantity > 0);
        if (!items.length) throw new Error(`请填写至少一种材料的${label}数量。`);
        await saved(await send(`/production-orders/${detail.id}/material-requests`, { version: detail.version, type: editor.type, items, note: editor.note }, { warehouseId: data.warehouse_id }), `${label}申请已提交，等待仓库确认${returning ? '入库' : '出库'}。`, true);
      });
    };
    return <div className="bom-page production-page">{heading(`申请${label}`, `${detail.number} · ${detail.product_name}`, '返回单据详情')}
      <form onSubmit={submitRequest}><section className="panel bom-section"><h2>{label}材料</h2>
        <p className="bom-hint">{returning ? '填写本次退回仓库的未用材料。仓库确认入库后才增加库存，确认前请保留实物并核对可退数量。' : '填写额外需要领取的材料。仓库确认出库后才增加本单可用材料余额。'}不申请的材料填 0。</p>
        {detail.items.map(item => <div className="production-material" key={item.product_id}><div className="production-material-name"><strong>{item.name}</strong><small>{item.barcode}</small></div>
          <div><small>已领可用</small><span>{count(item.available_quantity)} {item.unit}</span></div>
          <label>{label}数量（{item.unit}）<AntInput aria-label={`${item.name}${label}数量`} inputMode="decimal" value={editor.items.find(row => row.product_id === item.product_id).quantity} disabled={action.busy}
            onChange={event => update({ items: editor.items.map(row => row.product_id === item.product_id ? { ...row, quantity: event.target.value } : row) })} /></label>
        </div>)}
        <label className="bom-note">申请备注<AntInput.TextArea aria-label="材料申请备注" maxLength={500} rows={2} value={editor.note} disabled={action.busy} onChange={event => update({ note: event.target.value })} /></label>
      </section>{notices}<div className="bom-editor-actions"><Button disabled={action.busy} onClick={back}>取消</Button><Button type="submit" kind="primary" busy={action.busy}>提交{label}申请</Button></div></form>
    </div>;
  }

  if (editor) {
    const planning = ['new', 'edit'].includes(editor.kind), source = editor.kind === 'new' ? editor.plan : detail;
    const correcting = ['void', 'void_batch'].includes(editor.kind);
    let rows = source?.items || source?.rows.map(row => ({ ...row, base_quantity: row.quantity, base_quantity_fraction: row.quantity_fraction, planned_quantity: row.required, product: { stock: row.stock, unit: row.unit, active: 1 } })) || [];
    let quantityError = '';
    if (planning && source) {
      try {
        const quantity = parseQuantity(editor.planned_quantity, true);
        const standards = source.snapshot_format === 2 || source.multi_level ? new Map(calculateBomNodes(source.nodes, quantity, source.quantity_decimals ?? 4).rows.map(row => [row.product_id, row.required])) : null;
        rows = rows.map(row => ({ ...row, planned_quantity: productionItemQuantity(row, quantity, source, standards) }));
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
      {heading({ new: '新建生产单', edit: '编辑生产草稿', complete: '生产登记', void: '作废生产单', void_batch: '作废完工批次' }[editor.kind], planning ? '选择配方和计划产量，保存草稿后安排生产。' : `${detail.number} · ${detail.product_name}`, detail ? '返回单据详情' : '返回生产单')}
      <AntForm noValidate layout="vertical" scrollToFirstError={{ focus: true }} onSubmitCapture={event => { submitter.current = event.nativeEvent.submitter?.value; }} onFinish={submit}>
        {editor.kind === 'new' && <BomPicker data={listData} disabled={action.busy} onSelect={bom => action.run(() => chooseBom(bom))} />}
        {source && <section className="panel bom-section">
          <h2>{name}</h2><small>{editor.kind === 'new' ? source.product.barcode : detail.barcode} · {editor.kind === 'new' ? source.name : detail.bom_name} #{source.bom_id}</small>
          <p className="bom-hint">{source.snapshot_format === 2 || source.multi_level ? '根配方损耗计算方式' : '标准损耗计算方式'}：{bomLossMethodLabels[source.loss_method]}，标准投入＝{bomLossMethodFormulas[source.loss_method]}。</p>
          {planning ? <>
            <div className="bom-form-grid production-fields"><label>计划产量（{unit}）<FormField value={editor.planned_quantity} required label="计划产量"><AntInput aria-label="计划产量" inputMode="decimal"  value={editor.planned_quantity} disabled={action.busy} onChange={e => update({ planned_quantity: e.target.value })} /></FormField></label>
              <label>生产备注<AntInput.TextArea aria-label="生产备注" rows={2} maxLength={500} value={editor.note} disabled={action.busy} onChange={e => update({ note: e.target.value })} /></label></div>
            <p className="bom-hint">净用量、标准损耗率与计算方式随生产单保存，计划用量已含标准损耗。草稿不预留、不扣减库存。{editor.kind === 'new' || source.material_workflow ? '开始生产后申请领料，仓库确认出库才扣库存。' : '此历史单在登记时核对实际耗料并扣库存。'}</p>
          </> : editor.kind === 'complete' ? <>
            <p className="bom-hint">计划产量 {count(detail.planned_quantity)} {unit}，累计合格 {count(detail.completed_quantity ?? 0)} {unit}。仅填写本批数量，实际耗料默认按剩余计划产量带出，请核对。</p>
            <label className="production-output">合格成品数量（{unit}）<FormField value={editor.completed_quantity} required label="合格成品数量"><AntInput aria-label="合格成品数量" inputMode="decimal"  disabled={action.busy} value={editor.completed_quantity} onBlur={() => { if (validQuantity(Number(editor.completed_quantity), true)) update({ completed_quantity: String(materialQuantity(Number(editor.completed_quantity), detail)) }); }} onChange={e => update({ completed_quantity: e.target.value })} /></FormField></label>
            <p className="bom-hint">只入库本次合格成品；实际耗料包含生产损耗。未使用的材料填 0，至少一种材料需大于 0。</p>
            {detail.material_workflow === 1 && <p className="bom-hint">本次耗料从已领可用材料中登记，不再次扣仓库库存。超出余额须先补料，未用材料可申请退回仓库。</p>}
            <Button type="button" disabled={action.busy} onClick={() => action.run(async () => {
              const defaults = batchDefaults(parseQuantity(editor.completed_quantity, true));
              update({ items: defaults.items.map(item => ({ ...item, variance_reason: editor.items.find(row => row.product_id === item.product_id).variance_reason })) });
            })}>按本批产量带出耗料</Button>
            <label className="bom-note">本批备注<AntInput.TextArea aria-label="本批备注" rows={2} maxLength={500} disabled={action.busy} value={editor.note} onChange={e => update({ note: e.target.value })} /></label>
            <p className="bom-hint">「本批入库并继续生产」保持单据开放；「本批入库并结束生产」完成本单。允许少于或超过计划，达到计划数量也不会自动结束。</p>
          </> : <>
            <p className="bom-warning">{editor.kind === 'void_batch' ? `仅回退第 ${detail.batches.find(batch => batch.id === editor.batchId).batch_number} 批，其他批次保持原记录。${detail.material_workflow ? '材料回到本单已领余额，实际退仓需申请退料。' : ''}` : detail.material_workflow ? '作废前需先撤销全部登记批次，取消待批准材料单，并由仓库确认退完已领材料。' : detail.completed_at ? `将扣回 ${count(detail.completed_quantity)} ${unit}成品和已入库废料，并按各批原数量、原成本退回材料。成品库存或成本不足、物料单位变化时无法作废。` : '此单当前没有有效完工库存，作废后不能继续生产。'}</p>
            <label>作废原因<FormField value={editor.reason} required maxLength={500} label="作废原因"><AntInput.TextArea aria-label="作废原因"  rows={3} maxLength={500} value={editor.reason} disabled={action.busy} onChange={e => update({ reason: e.target.value })} /></FormField></label>
          </>}
        </section>}
        {source && !correcting && <section className="panel bom-section"><div className="bom-section-heading"><h2>{editor.kind === 'complete' ? '核对实际耗料' : '计划备料'}</h2><span className="bom-hint">共 {rows.length} 种材料</span></div>
          {quantityError && <p className="form-error" role="alert">{quantityError}</p>}
          {editor.kind === 'complete' && <p className="bom-hint">标准耗料按本单保存的净用量、标准损耗率和实际合格产量计算，已包含允许的标准损耗。差异 = 实际耗料 − 标准耗料，正数为超耗、负数为节省；差异率以标准耗料为分母。废料单独核对，耗料差异不直接视为损耗或废料。</p>}
          {(source.multi_level || source.snapshot_format === 2) && <>
            <p className="bom-warning">按毛需求展开；中间半成品库存未抵扣。各层按自己的损耗算法计算。</p>
            <BomStructure nodes={source.nodes} quantity={planning ? editor.planned_quantity : editor.completed_quantity || source.planned_quantity} />
          </>}
          <Materials rows={rows} issued={!!source.material_workflow && editor.kind === 'complete'} nodes={source.snapshot_format === 2 || source.multi_level ? source.nodes : undefined} completedQuantity={editor.completed_quantity} baseQuantity={source.base_quantity} lossMethod={source.loss_method}
            onReason={(id, variance_reason) => update({ items: editor.items.map(item => item.product_id === id ? { ...item, variance_reason } : item) })} complete={editor.kind === 'complete'} disabled={action.busy}
            onQuantity={(id, quantity) => update({ items: editor.items.map(item => item.product_id === id ? { ...item, quantity } : item) })} />
          <p className="bom-hint">数量读取于 {time(source.captured_at)}，提交时会重新校验{source.material_workflow && editor.kind === 'complete' ? '已领可用余额' : '库存'}。</p>
        </section>}
        {source && !correcting && <section className="panel bom-section"><ScrapOutputs rows={scrapRows} materials={rows} complete={editor.kind === 'complete'} disabled={action.busy}
          onChange={(id, patch) => update({ scraps: editor.scraps.map(row => row.product_id === id ? { ...row, ...patch } : row) })} />
          {scrapRows.length > 0 && editor.kind === 'complete' && <p className="bom-hint">修改产量或耗料会重算预计数量，已填写的实际废料数量会保留，请重新核对或点击「采用预计数量」。</p>}
          {!scrapRows.length && <p className="bom-hint">本单未配置废料产出。</p>}
        </section>}
        {notices}
        <div className="bom-editor-actions"><Button type="button" disabled={action.busy} onClick={back}>取消</Button>
          {detail && <Button type="button" disabled={action.busy} onClick={() => { if (!dirty || window.confirm('重新读取会丢弃当前填写内容，确定继续？')) open(detail.id); }}>重新读取生产单</Button>}
          {editor.kind === 'complete' && <Button type="submit" value="continue" disabled={action.busy}>本批入库并继续生产</Button>}
          <Button type="submit" kind="primary" icon={planning ? Save : editor.kind === 'complete' ? Check : XCircle} busy={action.busy} disabled={!source || !!quantityError}>
            {planning ? '保存生产草稿' : editor.kind === 'complete' ? '本批入库并结束生产' : '确认作废'}</Button>
        </div>
      </AntForm>
    </div>;
  }

  if (detail) return <div className="bom-page production-page">
    {heading('生产单详情', detail.number)}{notices}
    <section className="panel bom-section"><div className="bom-section-heading"><div><h2>{detail.product_name}</h2><small>{detail.barcode}{detail.specification && ` · ${detail.specification}`}</small></div>{statusBadge(detail.status)}</div>
      <div className="production-summary"><div><small>计划产量</small><strong>{count(detail.planned_quantity)} {detail.unit}</strong></div>
        <div><small>合格成品</small><strong>{detail.completed_at ? `${count(detail.completed_quantity)} ${detail.unit}` : '待完工'}</strong></div>
        <div><small>剩余计划</small><strong>{count(Math.max(0, quantityUnits(detail.planned_quantity) - quantityUnits(detail.completed_quantity ?? 0)) / QUANTITY_SCALE)} {detail.unit}</strong></div>
        {can('finance') && detail.completed_at && <div><small>材料成本合计</small><strong>{money(detail.total_cost_cents)}</strong></div>}
      </div>
      <p className="bom-hint">配方：{detail.bom_name} #{detail.bom_id} · 基准产量 {count(detail.base_quantity)} {detail.unit} · 保留建单时的材料配方</p>
      <p className="bom-hint">{detail.snapshot_format === 2 ? '根配方损耗计算方式' : '标准损耗计算方式'}：{bomLossMethodLabels[detail.loss_method]}，标准投入＝{bomLossMethodFormulas[detail.loss_method]}。</p>
      {detail.note && <p className="production-note">{detail.note}</p>}
      <div className="production-audit"><p>创建：{detail.created_by_name} · {time(detail.created_at)}</p><p>更新：{detail.updated_by_name} · {time(detail.updated_at)}</p>
        {detail.completed_at && <p>最近完工：{detail.completed_by_name} · {time(detail.completed_at)}</p>}
        {detail.voided_at && <><p>作废：{detail.voided_by_name} · {time(detail.voided_at)}</p><p>作废原因：{detail.void_reason}</p></>}
      </div>
      <div className="bom-actions">
        {detail.status === 'draft' && !detail.batches?.length && <Button disabled={action.busy} onClick={() => begin({ kind: 'edit', planned_quantity: String(detail.planned_quantity), note: detail.note })}>编辑草稿</Button>}
        {detail.material_workflow === 1 && detail.status === 'draft' && <Button kind="primary" disabled={action.busy} onClick={startProduction}>开始生产</Button>}
        {(detail.status === 'in_progress' || !detail.material_workflow && detail.status === 'draft') && <Button kind="primary" icon={Check} disabled={action.busy} onClick={beginCompletion}>登记</Button>}
        {detail.status === 'in_progress' && <Button disabled={action.busy || !detail.batch_count || detail.material_documents?.some(doc => doc.status === 'pending')} onClick={finishOrder}>结束生产</Button>}
        {detail.status !== 'void' && can('corrections') && <Button icon={XCircle} disabled={action.busy} onClick={() => begin({ kind: 'void', reason: '' })}>作废生产单</Button>}
        {detail.status === 'void' && can('corrections') && <Button kind="danger" icon={Trash2} disabled={action.busy} onClick={() => remove(detail)}>删除生产单</Button>}
        <Button disabled={action.busy} onClick={() => open(detail.id)}>刷新单据与库存</Button>
      </div>
    </section>
    {detail.material_workflow === 1 && <section className="panel bom-section" aria-label="生产领退料"><h2>领料与退料</h2>
      {detail.status === 'awaiting_materials' && <p className="bom-warning">请前往仓库领料。仓库确认出库后，生产单将进入生产中，届时可登记。</p>}
      {detail.status === 'completed' && detail.items.some(item => item.available_quantity > 0) && <p className="bom-warning">本单还有未用材料，请核对并申请退料，由仓库确认退回。</p>}
      <p className="bom-hint">已领可用 = 已出库领料 − 有效登记耗料 − 已确认退料。待批准申请尚未变动库存。</p>
      {detail.items.map(item => <div className="production-batch" key={item.product_id}><strong>{item.name}</strong><div className="material-balance">
        <div><small>已领</small><span>{count(item.issued_quantity)} {item.unit}</span></div><div><small>已耗</small><span>{count(item.actual_quantity ?? 0)} {item.unit}</span></div>
        <div><small>已退</small><span>{count(item.returned_quantity)} {item.unit}</span></div><div><small>已领可用</small><span>{count(item.available_quantity)} {item.unit}</span></div>
        {can('finance') && <div><small>剩余材料成本</small><span>{money(item.available_cost_cents)}</span></div>}
      </div></div>)}
      <div className="bom-actions">
        {detail.status === 'in_progress' && <Button disabled={action.busy || detail.material_documents?.some(doc => doc.status === 'pending')} onClick={() => requestMaterials('out')}>申请补料</Button>}
        {['in_progress', 'completed'].includes(detail.status) && <Button disabled={action.busy || detail.material_documents?.some(doc => doc.status === 'pending') || !detail.items.some(item => item.available_quantity > 0)} onClick={() => requestMaterials('in')}>申请退料</Button>}
        {onNavigate && can('sale') && <Button disabled={action.busy} onClick={() => onNavigate('sales')}>前往出库</Button>}
        {onNavigate && can('purchase') && <Button disabled={action.busy} onClick={() => onNavigate('purchases')}>前往入库</Button>}
      </div>
      {detail.material_documents?.some(doc => doc.status === 'pending') && <p className="bom-hint">已有待批准材料单，请先由仓库确认或取消后再提交补料、退料申请。</p>}
      <MaterialDocumentList documents={detail.material_documents || []} busy={action.busy} onCancel={detail.status !== 'void' ? cancelMaterialRequest : undefined} />
    </section>}
    {detail.snapshot_format === 2 && <section className="panel bom-section"><h2>配方结构快照</h2>
      <BomStructure nodes={detail.nodes} quantity={detail.planned_quantity} />
    </section>}
    <ProductionBatches key={detail.id} order={detail} costs={can('finance')} canVoid={can('corrections')} disabled={action.busy}
      onVoid={batch => begin({ kind: 'void_batch', batchId: batch.id, reason: '' })} />
    {(detail.scraps || []).length > 0 && <section className="panel bom-section"><ScrapOutputs rows={detail.scraps} materials={detail.items} completed={!!detail.completed_at} />
      {detail.status === 'void' && detail.completed_at && <p className="bom-hint">本单已作废，以上废料记录保留，已入库数量已扣回。</p>}
    </section>}
    <section className="panel bom-section"><h2>{detail.completed_at ? '耗料记录' : '计划备料'}</h2>
      {detail.completed_at && <p className="bom-hint">标准耗料按本单净用量、标准损耗率快照及实际合格产量计算，已含标准损耗；差异 = 实际耗料 − 标准耗料，差异率 = 差异 ÷ 标准耗料。各材料分别比较，不跨单位合计，也不从实际耗料中再次扣除废料。</p>}
      <Materials rows={detail.items} issued={!!detail.material_workflow && ['in_progress', 'completed'].includes(detail.status)} showActual={!!detail.completed_at} costs={can('finance')} />
      {detail.status === 'void' && detail.completed_at && <p className="bom-hint">以上保留原完工记录；本单已作废，相关库存和成本已回退。</p>}
      {!detail.completed_at && <p className="bom-hint">库存读取于 {time(detail.captured_at)}。{detail.material_workflow ? '草稿与待批准领料单不预留库存，仓库确认出库时重新校验。' : '此历史单在登记时核对实际耗料并扣库存。'}</p>}
    </section>
  </div>;

  return <div className="bom-page production-page">
    <PageHeading title="生产单" description="按配方安排生产，仓库领料后登记实际耗料和合格成品。">
      <Button kind="primary" icon={Plus} disabled={action.busy} onClick={() => begin({ kind: 'new', note: '', planned_quantity: '1', plan: null })}>新建生产单</Button>
    </PageHeading>{notices}
    <section className="panel bom-section"><div className="bom-list-filters">
      <AntInput type="search" aria-label="搜索生产单" placeholder="搜索单号、成品名称、编码或配方" maxLength={100} value={q} onChange={e => { setQ(e.target.value); setOffset(0); }} />
      <Select aria-label="生产单状态" value={status} onChange={e => { setStatus(e); setOffset(0); }}><option value="all">全部状态</option>
        {Object.entries(productionStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select>
    </div><QueryStatus query={list} />
      <div className="production-list">{list.result?.orders.map(order => <article className="bom-list-item" key={order.id}>
        <div className="bom-list-info"><strong>{order.product_name}</strong><p>{order.number}</p><small>{order.barcode} · {order.bom_name} #{order.bom_id}</small>
          <small>计划 {count(order.planned_quantity)} {order.unit}{order.completed_at ? ` · 合格 ${count(order.completed_quantity)} ${order.unit}` : ''} · 创建人 {order.created_by_name}</small>
          <small>{time(order.created_at)}</small>{statusBadge(order.status)}</div>
        <div className="bom-actions"><Button icon={ClipboardList} disabled={action.busy} onClick={() => open(order.id)} aria-label={`查看生产单 ${order.number}`}>查看详情</Button>
          {order.status === 'void' && can('corrections') && <Button kind="danger" icon={Trash2} disabled={action.busy} onClick={() => remove(order)}>删除生产单</Button>}</div>
      </article>)}</div>
      {list.result && !list.result.orders.length && <p className="bom-empty">暂无匹配的生产单。选择已有BOM，建立第一张生产草稿。</p>}
      {list.result && (offset > 0 || list.result.has_more) && <div className="bom-actions bom-pagination"><Button disabled={!offset} onClick={() => setOffset(n => n - 30)}>上一页</Button><span>共 {list.result.total} 张</span><Button disabled={!list.result.has_more} onClick={() => setOffset(n => n + 30)}>下一页</Button></div>}
    </section>
  </div>;
}
