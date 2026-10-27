import { ProductionAssignments } from '../features/ProductionAssignments.jsx';
import { productionAssignments, productionAssignmentNames } from '../../shared/production-assignment.js';
import { ProductionOperations, OperationWorkerSelect } from '../features/ProductionOperations.jsx';
import { ProductionProcessOverview } from '../features/ProcessOverview.jsx';
import { ProcessFlowStrip } from '../features/ProcessGraph.jsx';
import { productionMessage } from '../i18n/production-errors.js';
import { bomLossMethodLabels, bomLossMethodFormulas, productionStatusLabels } from '../i18n/production-display.js';
import { t as pt, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
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
import { bomShortage } from '../../shared/bom.js';
import { productionItemQuantity, validateProductionPlan, validateProductionCompletion, productionMaterialAnalysis } from '../../shared/production.js';
import { scrapExpectedQuantity, validateScrapActuals } from '../../shared/scrap.js';
import { MaterialVariance } from '../features/MaterialVariance.jsx';
import { ScrapOutputs } from '../features/ScrapOutputs.jsx';
import { MaterialDocumentList } from '../features/ProductionMaterialDocuments.jsx';
import { ProductionReceiptList } from '../features/ProductionReceipts.jsx';
import { useProductionRegistration } from '../features/ProductionRegistration.jsx';
import { ProductionStages, ProductionStageSummary } from '../features/ProductionStages.jsx';
import { downloadProductionPdf } from '../production-pdf.js';
import './bom.css';
import './production.css';
import { ProductionDetailTabs } from '../features/ProductionDetailTabs.jsx';
import { ProductionMaterialLedger } from '../features/ProductionMaterialLedger.jsx';
import { money as formatMoney, currencySymbol } from '../app/format.js';

const count = value => Number(value).toLocaleString(getFormatLocale(), { maximumFractionDigits: 4 });
const money = value => `${currencySymbol()}${formatMoney(value / 100)}`;
const time = value => new Date(value).toLocaleString(getFormatLocale(), { hour12: false });
const statusBadge = status => <Badge tone={status === 'completed' ? 'green' : status === 'draft' ? 'blue' : 'orange'}>{productionStatusLabels[status]}</Badge>;
const batchReceived = batch => batch.receipt_status === 'confirmed' || !batch.receipt_required;

function BomPicker({ data, disabled, onSelect }) {
  useLocale();
  const [q, setQ] = useState(''), [offset, setOffset] = useState(0);
  const list = useQuery(queryPath('/production-orders/boms', { q, offset, limit: 10 }), data, 150);
  return <section className="panel bom-section"><h2>{pt("production.selectProductRecipe")}</h2>
    <AntInput type="search" aria-label={pt("production.searchProductionRecipes")} placeholder={pt("production.searchProductNameCodeOrRecipeName")} maxLength={100} value={q} disabled={disabled}
      onChange={e => { setQ(e.target.value); setOffset(0); }} />
    <QueryStatus query={list} />
    <div className="production-bom-options">{list.result?.boms.map(bom => <div className="bom-search-product" key={bom.id}>
      <div><strong>{bom.product_name}</strong><small>{bom.barcode} · {bom.name} #{bom.id} {pt("production.baseOutput2")} {count(bom.base_quantity)} {bom.base_unit}</small></div>
      <Button type="button" disabled={disabled || !bom.product_active} onClick={() => onSelect(bom)} aria-label={pt("production.selectRecipe", { v0: bom.product_name, v1: bom.name, v2: bom.id })}>{pt("production.select")}</Button>
    </div>)}</div>
    {list.result && !list.result.boms.length && <p className="bom-empty">{pt("production.noMatchingActiveRecipesConfigureABomFirst")}</p>}
    {(offset > 0 || list.result?.has_more) && <div className="bom-actions bom-pagination">
      <Button type="button" disabled={disabled || !offset || list.loading} onClick={() => setOffset(n => n - 10)}>{pt("production.previousRecipes")}</Button>
      <Button type="button" disabled={disabled || !list.result?.has_more || list.loading} onClick={() => setOffset(n => n + 10)}>{pt("production.nextRecipes")}</Button>
    </div>}
  </section>;
}

function Materials({ rows, complete, disabled, onQuantity, onReason, completedQuantity, baseQuantity, lossMethod, nodes, showActual, costs, issued }) {
  useLocale();
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
      catch { analysis = { standard_quantity: null, variance_quantity: null, variance_rate: null, analysis_error: pt("production.enterValidAcceptedOutputAndActualMaterialUsage") }; }
    }
    return <article className="production-material" key={row.product_id}>
      <div className="production-material-name"><strong>{row.name}</strong><small>{row.barcode}{row.specification && ` · ${row.specification}`}</small>
        {row.base_quantity === null ? <small>{pt("production.multiLevelRecipeSummarySeeStructureSourcesFor")}</small> : <small>{pt("production.baseNetUsage")} {row.base_quantity_fraction || count(row.base_quantity)} {row.unit} {pt("production.standardLossRate4")} {count(row.loss_rate ?? 0)}%</small>}
        {row.note && <small>{row.note}</small>}
        {row.product && row.unit !== row.product.unit && <p className="bom-warning">{pt("production.currentUnitChangedTo")} {row.product.unit}{pt("production.thisOrderRetains")} {row.unit}。</p>}
        {row.product && !row.product.active && <p className="bom-warning">{pt("production.materialDisabled")}</p>}</div>
      <div><small>{pt("production.plannedUsage")}</small><span>{count(row.planned_quantity)} {row.unit}</span></div>
      {complete ? <label>{pt("production.actualUsage")}{row.unit}）<FormField value={row.quantity} required label={pt("production.actualUsage2", { v0: row.name })}><AntInput aria-label={pt("production.actualUsage2", { v0: row.name })} inputMode="decimal"  disabled={disabled} value={row.quantity}
        onBlur={() => { if (row.unit_round_up && validQuantity(Number(row.quantity))) onQuantity(row.product_id, materialQuantity(Number(row.quantity), row)); }}
        onChange={e => onQuantity(row.product_id, e.target.value)} /></FormField></label> : showActual && <div><small>{pt("production.actualUsage3")}</small><span>{count(row.actual_quantity)} {row.unit}</span></div>}
      {!showActual && row.product && (issued || row.product.stock !== undefined) && <div><small>{issued ? pt("production.issuedBalance") : pt("production.bookStock")}</small><span>{count(issued ? row.available_quantity : row.product.stock)} {row.unit}</span>
        {shortage > 0 && <strong className="bom-shortage">{issued ? pt("production.supplementNeeded") : pt("production.shortage")} {count(shortage)} {row.unit}</strong>}</div>}
      {costs && showActual && <div><small>{pt("production.materialCost")}</small><span>{money(row.cost_cents)}</span></div>}
      {(complete || showActual) && <MaterialVariance row={row} analysis={analysis} complete={complete} disabled={disabled} onReason={onReason} />}
    </article>;
  })}</div>;
}

function ProductionBatches({ order, costs, canVoid, canReceive, disabled, onVoid }) {
  useLocale();
  const [expanded, setExpanded] = useState(null);
  if (!order.batches?.length) return null;
  return <section className="panel bom-section production-batches" aria-label={pt("production.completionBatches")}>
    <h2>{pt("production.completionBatches")}</h2><p className="bom-hint">{pt("production.cumulativeOutputAndUsageIncludeValidBatchesOnly")}</p>
    {order.batches.map(batch => <article key={batch.id} className="production-batch">
      <div className="bom-section-heading"><strong>{pt("production.batch")} {batch.batch_number} {pt("production.batchSuffix")} {count(batch.completed_quantity)} {order.unit}</strong><Badge tone={batch.status !== 'active' ? 'gray' : batchReceived(batch) ? 'green' : 'orange'}>{batch.status !== 'active' ? pt("production.batchVoided") : batchReceived(batch) ? (batch.receipt_required ? pt("production.received") : pt("production.receivedHistoricalBatch")) : pt("production.pendingReceipt")}</Badge></div>
      <small>{pt("production.registeredBy")}{batch.created_by_name || pt("production.history")} · {batch.production_group_name || pt("production.ungrouped")} · {time(batch.created_at)}{costs && pt("production.materialCost2", { v0: money(batch.total_cost_cents) })}</small>
      {batch.note && <p className="production-note">{batch.note}</p>}
      {batch.status === 'void' && <p className="bom-hint">{pt("production.voided")}{batch.voided_by_name} · {time(batch.voided_at)} · {batch.void_reason}</p>}
      <div className="bom-actions"><Button disabled={disabled} aria-expanded={expanded === batch.id} onClick={() => setExpanded(expanded === batch.id ? null : batch.id)}>{expanded === batch.id ? pt("production.collapse") : pt("production.view")}{pt("production.batch")} {batch.batch_number} {pt("production.batchDetails")}</Button>
        {batch.receipt_id && <Button disabled={disabled} onClick={() => {
          const receipt = document.getElementById(`production-receipt-${batch.receipt_id}`);
          receipt?.scrollIntoView({ block: 'start' });
          receipt?.focus({ preventScroll: true });
        }}>{pt("production.viewReceiptForBatch")} {batch.batch_number} {pt("production.receipt")}</Button>}
        {canVoid && (!batchReceived(batch) || canReceive) && batch.status === 'active' && order.status !== 'void' && <Button disabled={disabled} onClick={() => onVoid(batch)}>{pt("production.voidBatch")} {batch.batch_number} {pt("production.batch2")}</Button>}</div>
      {canVoid && !canReceive && batch.status === 'active' && batchReceived(batch) && <p className="bom-hint">{pt("production.voidingAReceivedBatchAlsoRequiresReceiptPermission")}</p>}
      {expanded === batch.id && <div className="production-batch-detail">
        {batch.items.map(item => <div className="production-batch-material" key={item.product_id}><strong>{item.name}</strong><p>{pt("production.actualUsage3")} {count(item.actual_quantity)} {item.unit}{costs && pt("production.materialCost2", { v0: money(item.cost_cents) })}</p><MaterialVariance row={item} analysis={item} /></div>)}
        <ScrapOutputs rows={batch.scraps} materials={batch.items} completed showPlan={false} receiptStatus={batch.status === 'void' ? 'void' : batchReceived(batch) ? 'confirmed' : 'pending'} />
      </div>}
    </article>)}
  </section>;
}

export function Production({ data, initialBom, onChanged, onNavigate, onSwitchWarehouse }) {
  const { locale } = useLocale();
  const [outputLanguage, setOutputLanguage] = useState(null);
  const { can } = usePermissions();
  const management = can('production');
  const [q, setQ] = useState(''), [status, setStatus] = useState('all'), [offset, setOffset] = useState(0), [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState(null), [editor, setEditor] = useState(null), [baseline, setBaseline] = useState(''), [message, setMessage] = useState('');
  const [stageActivity, setStageActivity] = useState(null);
  const [detailTab, setDetailTab] = useState('overview');
  const stageSession = useRef(0);
  const action = useBusiness();
  const send = (path, body, options) => action.send(path, { schema_version: 2, stage_schema_version: 1, operation_schema_version: 1, ...body }, options);
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
    const before = event => { if (guard.current.busy || guard.current.dirty && !window.confirm(pt("production.thisProductionOrderHasUnsavedChangesLeave"))) event.preventDefault(); };
    const unload = event => { if (guard.current.dirty || guard.current.busy) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('erp:before-navigate', before); window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('erp:before-navigate', before); window.removeEventListener('beforeunload', unload); };
  }, []);
  const begin = value => { const next = value.kind === 'stages' ? { ...value, session: ++stageSession.current } : value; setEditor(next); setBaseline(JSON.stringify(next)); setMessage(''); action.setError(''); };
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
    if (action.busy || dirty && !window.confirm(pt("production.thisProductionOrderHasUnsavedChangesLeave"))) return;
    if (editor) setEditor(null); else setDetail(null);
    action.setError(''); setMessage('');
  };
  const open = id => action.run(async () => {
    const order = await api(`/production-orders/${id}`, { warehouseId: data.warehouse_id });
    if (detail?.id !== order.id) setDetailTab('overview');
    setDetail(order); setEditor(null); setMessage('');
  });
  const saved = async (order, text, stockChanged = false) => {
    if (detail?.id !== order.id) setDetailTab('overview');
    setDetail(order); setEditor(null); setMessage(text); setRevision(n => n + 1);
    if (stockChanged) await onChanged?.();
  };
  const remove = order => {
    if (!window.confirm(pt("production.deleteVoidedProductionOrderThisCannotBeUndone", { v0: order.number }))) return;
    action.run(async () => {
      setMessage('');
      await send(`/production-orders/${order.id}/delete`, { version: order.version }, { warehouseId: data.warehouse_id });
      setDetail(null); setEditor(null);
      if (list.result?.orders.length === 1 && offset > 0) setOffset(n => Math.max(0, n - 30));
      setRevision(n => n + 1); setMessage(pt("production.productionOrderDeleted"));
    });
  };
  const batchDefaults = (quantity, order = detail) => {
    const standards = order.snapshot_format === 2 ? new Map(calculateBomNodes(order.nodes, quantity, order.quantity_decimals).rows.map(row => [row.product_id, row.required])) : null;
    const items = order.items.map(item => ({ product_id: item.product_id,
      quantity: String(productionItemQuantity(item, quantity, order, standards)), variance_reason: '' }));
    const scraps = (order.scraps || []).map(row => ({ product_id: row.product_id,
      quantity: String(scrapExpectedQuantity(row, quantity, order.base_quantity, items.map(item => ({ ...item, quantity: Number(item.quantity) })))), disposition: 'stock' }));
    return { items, scraps };
  };
  const beginCompletion = () => action.run(async () => {
    if (detail.stage_workflow) { begin({ kind: 'stages' }); return; }
    if (detail.operation_routes?.length) { begin({ kind: 'operations' }); return; }
    const remaining = Math.max(0, quantityUnits(detail.planned_quantity) - quantityUnits(detail.completed_quantity ?? 0)) / QUANTITY_SCALE;
    const quantity = remaining || 1;
    begin({ kind: 'complete', completed_quantity: String(quantity), note: '', ...batchDefaults(quantity) });
  });
  const registration = useProductionRegistration({ data, onSwitchWarehouse, navigationState: stageActivity || editor, navigationBusy: action.busy || !!stageActivity?.busy, onError: action.setError, onOrder: order => {
    if (detail?.id !== order.id) setDetailTab('overview');
    setDetail(order); setEditor(null); setMessage(''); action.setError('');
    if (order.status === 'in_progress' || !order.material_workflow && order.status === 'draft') {
      if (order.stage_workflow) { begin({ kind: 'stages' }); return; }
      if (order.operation_routes?.length) { begin({ kind: 'operations' }); return; }
      const quantity = Math.max(0, quantityUnits(order.planned_quantity) - quantityUnits(order.completed_quantity ?? 0)) / QUANTITY_SCALE || 1;
      begin({ kind: 'complete', completed_quantity: String(quantity), note: '', ...batchDefaults(quantity, order) });
    } else {
      setMessage(({ draft: pt("production.productionHasNotStartedAskTheSupervisorTo"), awaiting_materials: pt("production.waitingForWarehouseMaterialConfirmationBeforeRegistration"), completed: pt("production.productionHasEndedRegistrationIsClosed"), void: pt("production.thisOrderIsVoidedRegistrationIsUnavailable") })[order.status] || pt("production.registrationIsUnavailableInTheCurrentStatusCheck"));
    }
  } });
  const startProduction = () => begin({ kind: 'material_request', initial: true, type: 'out', note: '',
    items: detail.items.map(item => ({ product_id: item.product_id, quantity: String(item.planned_quantity) })) });
  const requestMaterials = type => begin({ kind: 'material_request', type, note: '',
    items: detail.items.map(item => ({ product_id: item.product_id, quantity: type === 'in' ? String(item.available_quantity) : '0' })) });
  const cancelMaterialRequest = (doc, reason) => action.run(async () => {
    await send(`/production-material-documents/${doc.id}/cancel`, { version: doc.version, reason }, { warehouseId: data.warehouse_id });
    await saved(await api(`/production-orders/${detail.id}`, { warehouseId: data.warehouse_id }), doc.issues?.length ? pt("production.remainingRequestClosed", { number: doc.number }) : pt("production.materialRequestCancelledStockUnchanged"), true);
  });
  const finishOrder = () => action.run(async () => {
    if (!window.confirm(pt("production.endThisProductionOrderPendingBatchesStillRequire"))) return;
    await saved(await send(`/production-orders/${detail.id}/finish`, { version: detail.version }, { warehouseId: data.warehouse_id }), pt("production.productionEndedPendingReceiptsStillRequireWarehouseApproval"));
  });
  const submitter = useRef(null);
  const submit = () => {

    const finishOrder = management && submitter.current !== 'continue';
    action.run(async () => {
      const options = { warehouseId: data.warehouse_id };
      if (editor.kind === 'new' || editor.kind === 'edit') {
        const body = { planned_quantity: parseQuantity(editor.planned_quantity, true), note: editor.note };
        validateProductionPlan(body);
        const path = editor.kind === 'new' ? '/production-orders' : `/production-orders/${detail.id}`;
        if (editor.kind === 'new') { body.bom_id = editor.plan.bom_id; body.bom_version = editor.plan.version; body.structure_token = editor.plan.structure_token; }
        else body.version = detail.version;
        await saved(await send(path, body, options), pt("production.productionDraftSavedStockUnchanged"));
      } else if (editor.kind === 'complete') {
        const body = { version: detail.version, ...(editor.operation_node_id ? { operation_node_id: editor.operation_node_id, worker_id: editor.worker_id } : {}), completed_quantity: materialQuantity(parseQuantity(editor.completed_quantity, true), detail), finish_order: finishOrder, note: editor.note,
          items: editor.items.map(row => ({ product_id: row.product_id, quantity: materialQuantity(parseQuantity(row.quantity), row), variance_reason: row.variance_reason })),
          scraps: editor.scraps.map(row => ({ product_id: row.product_id, quantity: materialQuantity(parseQuantity(row.quantity), row), disposition: row.disposition })) };
        validateProductionCompletion(body, detail.items);
        validateScrapActuals(body.scraps, detail.scraps || []);
        if (!window.confirm(pt("production.registerThisBatchOfAndRecordScrapThen", { v0: count(body.completed_quantity), v1: detail.unit, v2: detail.product_name, v3: detail.material_workflow ? pt("production.recordUsageFromTheIssuedBalance") : pt("production.deductStockByThisBatchSActualUsage"), v4: finishOrder ? pt("production.endTheProductionOrder") : pt("production.continueProduction") }))) return;
        await saved(await send(`/production-orders/${detail.id}/complete`, body, options), pt("production.batchRegisteredProductsAndReceivedScrapAwaitWarehouse", { v0: detail.material_workflow ? pt("production.actualUsageRecorded") : pt("production.actualUsageDeductedFromStock"), v1: finishOrder ? pt("production.productionEnded") : pt("production.productionOrderRemainsOpen") }), true);
      } else {
        if (!editor.reason.trim()) throw new Error(pt("production.enterAReasonForVoiding"));
        if (editor.kind === 'void_batch') {
          const batch = detail.batches.find(value => value.id === editor.batchId);
          if (!window.confirm(pt("production.voidThisBatchTheProductionOrderWillReopen", { v0: batchReceived(batch) ? pt("production.receivedProductsAndScrapInThisBatchWill") : pt("production.thePendingReceiptWillAlsoBeVoidedNo"), v1: detail.material_workflow ? pt("production.usageAndOriginalCostsReturnToThisOrder") : pt("production.materialsReturnAtThisBatchSOriginalQuantities") }))) return;
          await saved(await send(`/production-orders/${detail.id}/batches/${editor.batchId}/void`, { version: detail.version, reason: editor.reason }, options), pt("production.batchAndRelatedReceiptVoidedOriginalUsageAnd"), true);
          return;
        }
        if (!window.confirm(detail.material_workflow ? pt("production.voidThisProductionOrderFirstVoidAllRegistered") : detail.completed_at ? pt("production.voidThisProductionOrderPendingReceiptsWillBe") : pt("production.voidThisProductionDraft"))) return;
        await saved(await send(`/production-orders/${detail.id}/void`, { version: detail.version, reason: editor.reason }, options),
          detail.completed_at ? pt("production.productionOrderVoidedStockAndOriginalCostsReversed") : pt("production.productionDraftVoidedStockUnchanged"), !!detail.completed_at);
      }
    });
  };

  const heading = (title, description, label = pt("production.backToProductionOrders")) => <PageHeading title={title} description={description}>
    <Button icon={ArrowLeft} disabled={action.busy} onClick={back}>{label}</Button>
  </PageHeading>;
  const notices = <>{registration.scanner}{registration.busy && <p role="status">{pt("production.loadingProductionOrder")}</p>}{message && <p className="bom-success" role="status">{productionMessage(message)}</p>}{productionMessage(action.error) && !registration.scanner && <p className="form-error" role="alert">{productionMessage(action.error)}</p>}</>;

  if (editor?.kind === 'operations') return <div className="bom-page production-page"><ProductionOperations order={detail} data={listData} canRegister={detail.status === 'in_progress'} onActivity={setStageActivity} onSaved={(order, text) => saved(order, text, true)} onBack={back} onOutput={(node, worker_id) => {
    const quantity = node.available_quantity ?? (Math.max(0, detail.planned_quantity - (detail.completed_quantity || 0)) || 1);
    begin({ kind: 'complete', operation_node_id: node.id, worker_id, completed_quantity: String(quantity || 1), note: '', ...batchDefaults(quantity || 1) });
  }} />{notices}</div>;

  if (editor?.kind === 'stages') return <div className="bom-page production-page">
    <ProductionStages key={`${detail.id}:${editor.session}`} order={detail} data={listData} canRegister={detail.status === 'in_progress'} canVoid={management && can('corrections')} canReceive={can('purchase')} management={management}
      busy={action.busy} initialOperationPath={editor.operationPath} onActivity={setStageActivity} onSaved={(order, text) => saved(order, text, true)} onBack={back} />{notices}
  </div>;

  if (editor?.kind === 'material_request') {
    const returning = editor.type === 'in', label = returning ? pt("production.returnMaterials") : editor.initial ? pt("production.issueMaterials") : pt("production.supplementMaterials");
    const submitRequest = event => {
      event.preventDefault();
      action.run(async () => {
        const items = editor.items.map(row => ({ product_id: row.product_id,
          quantity: materialQuantity(parseQuantity(row.quantity), detail.items.find(item => item.product_id === row.product_id)) })).filter(row => row.quantity > 0);
        if (!items.length) throw new Error(pt("production.enterAQuantityForAtLeastOneMaterial", { v0: label }));
        await saved(await send(`/production-orders/${detail.id}/${editor.initial ? 'start' : 'material-requests'}`, { version: detail.version, type: editor.type, items, note: editor.note }, { warehouseId: data.warehouse_id }), pt("production.requestSubmittedAwaitingWarehouseConfirmation", { v0: label, v1: returning ? pt("production.receipt2") : pt("production.issue") }), true);
      });
    };
    return <div className="bom-page production-page">{heading(pt("production.request", { v0: label }), `${detail.number} · ${detail.product_name}`, pt("production.backToOrderDetails"))}
      <form onSubmit={submitRequest}><section className="panel bom-section"><h2>{label}{pt("production.material")}</h2>
        <p className="bom-hint">{returning ? pt("production.enterUnusedMaterialsToReturnStockIncreasesOnly") : editor.initial ? pt("production.initialPartialRequestHint") : pt("production.enterExtraMaterialsNeededTheOrderSAvailable")}{pt("production.enter0ForMaterialsNotRequested")}</p>
        {detail.items.map(item => <div className="production-material" key={item.product_id}><div className="production-material-name"><strong>{item.name}</strong><small>{item.barcode}</small></div>
          <div><small>{pt("production.plannedRequirement")}</small><span>{count(item.planned_quantity)} {item.unit}</span></div>
          <div><small>{pt("production.issuedBalance")}</small><span>{count(item.available_quantity)} {item.unit}</span></div>
          <label>{label}{pt("production.quantity")}{item.unit}）<AntInput aria-label={pt("production.quantity2", { v0: item.name, v1: label })} inputMode="decimal" value={editor.items.find(row => row.product_id === item.product_id).quantity} disabled={action.busy}
            onChange={event => update({ items: editor.items.map(row => row.product_id === item.product_id ? { ...row, quantity: event.target.value } : row) })} /></label>
        </div>)}
        <label className="bom-note">{pt("production.requestNote")}<AntInput.TextArea aria-label={pt("production.materialRequestNote")} maxLength={500} rows={2} value={editor.note} disabled={action.busy} onChange={event => update({ note: event.target.value })} /></label>
      </section>{notices}<div className="bom-editor-actions"><Button disabled={action.busy} onClick={back}>{pt("production.cancel")}</Button><Button type="submit" kind="primary" busy={action.busy}>{pt("production.submit")}{label}{pt("production.request2")}</Button></div></form>
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
      {heading({ new: pt("production.newProductionOrder"), edit: pt("production.editProductionDraft"), complete: pt("production.productionRegistration"), void: pt("production.voidProductionOrder"), void_batch: pt("production.voidCompletionBatch") }[editor.kind], planning ? pt("production.selectARecipeAndPlannedOutputThenSave") : `${detail.number} · ${detail.product_name}`, detail ? pt("production.backToOrderDetails") : pt("production.backToProductionOrders"))}
      <AntForm noValidate layout="vertical" scrollToFirstError={{ focus: true }} onSubmitCapture={event => { submitter.current = event.nativeEvent.submitter?.value; }} onFinish={submit}>
        {editor.kind === 'new' && <BomPicker data={listData} disabled={action.busy} onSelect={bom => action.run(() => chooseBom(bom))} />}
        {source && <section className="panel bom-section">
          <h2>{name}</h2><small>{editor.kind === 'new' ? source.product.barcode : detail.barcode} · {editor.kind === 'new' ? source.name : detail.bom_name} #{source.bom_id}</small>
          <p className="bom-hint">{source.snapshot_format === 2 || source.multi_level ? pt("production.rootRecipeLossCalculation") : pt("production.standardLossCalculation")}：{bomLossMethodLabels[source.loss_method]}{pt("production.standardInput")}{bomLossMethodFormulas[source.loss_method]}。</p>
          {planning ? <>
            <div className="bom-form-grid production-fields"><label>{pt("production.plannedOutput")}{unit}）<FormField value={editor.planned_quantity} required label={pt("production.plannedOutput2")}><AntInput aria-label={pt("production.plannedOutput2")} inputMode="decimal"  value={editor.planned_quantity} disabled={action.busy} onChange={e => update({ planned_quantity: e.target.value })} /></FormField></label>
              <label>{pt("production.productionNote")}<AntInput.TextArea aria-label={pt("production.productionNote")} rows={2} maxLength={500} value={editor.note} disabled={action.busy} onChange={e => update({ note: e.target.value })} /></label></div>
            <p className="bom-hint">{pt("production.netUsageStandardLossRateAndMethodAre")}{editor.kind === 'new' || source.material_workflow ? pt("production.startingProductionRequestsMaterialsStockIsDeductedAfter") : pt("production.thisHistoricalOrderVerifiesActualUsageAndDeducts")}</p>
          </> : editor.kind === 'complete' ? <>
            <p className="bom-hint">{pt("production.plannedOutput2")} {count(detail.planned_quantity)} {unit}{pt("production.acceptedToDate")} {count(detail.completed_quantity ?? 0)} {unit}{pt("production.enterThisBatchOnlyActualUsageDefaultsFrom")}</p>
            <label className="production-output">{pt("production.acceptedProductQuantity")}{unit}）<FormField value={editor.completed_quantity} required label={pt("production.acceptedProductQuantity2")}><AntInput aria-label={pt("production.acceptedProductQuantity2")} inputMode="decimal"  disabled={action.busy} value={editor.completed_quantity} onBlur={() => { if (validQuantity(Number(editor.completed_quantity), true)) update({ completed_quantity: String(materialQuantity(Number(editor.completed_quantity), detail)) }); }} onChange={e => update({ completed_quantity: e.target.value })} /></FormField></label>
            {editor.operation_node_id && <OperationWorkerSelect order={detail} warehouseId={data.warehouse_id} value={editor.worker_id} onChange={worker_id => setEditor(previous => ({ ...previous, worker_id }))} disabled={action.busy} />}
            <p className="bom-hint">{pt("production.registerAcceptedOutputToCreateAPendingReceipt")}</p>
            {detail.material_workflow === 1 && <p className="bom-hint">{pt("production.usageIsRecordedAgainstIssuedMaterialsWithoutDeducting")}</p>}
            <Button type="button" disabled={action.busy} onClick={() => action.run(async () => {
              const defaults = batchDefaults(parseQuantity(editor.completed_quantity, true));
              update({ items: defaults.items.map(item => ({ ...item, variance_reason: editor.items.find(row => row.product_id === item.product_id).variance_reason })) });
            })}>{pt("production.fillUsageFromThisBatchSOutput")}</Button>
            <label className="bom-note">{pt("production.batchNote")}<AntInput.TextArea aria-label={pt("production.batchNote")} rows={2} maxLength={500} disabled={action.busy} value={editor.note} onChange={e => update({ note: e.target.value })} /></label>
            <p className="bom-hint">{management ? pt("production.registerAndContinueKeepsTheOrderOpenRegister") : pt("production.productionContinuesAfterThisRegistrationAProductionManager")}</p>
          </> : <>
            <p className="bom-warning">{editor.kind === 'void_batch' ? pt("production.onlyBatchIsReversedOtherBatchesRetainTheir", { v0: detail.batches.find(batch => batch.id === editor.batchId).batch_number, v1: detail.material_workflow ? pt("production.materialsReturnToThisOrderSIssuedBalance") : '' }) : detail.material_workflow ? pt("production.beforeVoidingVoidEveryRegisteredBatchCancelPending") : detail.completed_at ? pt("production.pendingReceiptsWillBeVoidedReceivedProductsAnd") : pt("production.thisOrderHasNoValidCompletedStockProduction")}</p>
            <label>{pt("production.voidReason")}<FormField value={editor.reason} required maxLength={500} label={pt("production.voidReason")}><AntInput.TextArea aria-label={pt("production.voidReason")}  rows={3} maxLength={500} value={editor.reason} disabled={action.busy} onChange={e => update({ reason: e.target.value })} /></FormField></label>
          </>}
        </section>}
        {source && !correcting && <section className="panel bom-section"><div className="bom-section-heading"><h2>{editor.kind === 'complete' ? pt("production.verifyActualUsage") : pt("production.plannedMaterials")}</h2><span className="bom-hint">{pt("production.total")} {rows.length} {pt("production.materials2")}</span></div>
          {quantityError && <p className="form-error" role="alert">{productionMessage(quantityError)}</p>}
          {editor.kind === 'complete' && <p className="bom-hint">{pt("production.standardUsageIsCalculatedFromThisOrderS")}</p>}
          {(source.multi_level || source.snapshot_format === 2) && <>
            <p className="bom-warning">{pt("production.expandedByGrossRequirementsWithoutDeductingIntermediateStock")}</p>
            <BomStructure nodes={source.nodes} quantity={planning ? editor.planned_quantity : editor.completed_quantity || source.planned_quantity} isSnapshot={source.snapshot_format === 2} />
          </>}
          <Materials rows={rows} issued={!!source.material_workflow && editor.kind === 'complete'} nodes={source.snapshot_format === 2 || source.multi_level ? source.nodes : undefined} completedQuantity={editor.completed_quantity} baseQuantity={source.base_quantity} lossMethod={source.loss_method}
            onReason={(id, variance_reason) => update({ items: editor.items.map(item => item.product_id === id ? { ...item, variance_reason } : item) })} complete={editor.kind === 'complete'} disabled={action.busy}
            onQuantity={(id, quantity) => update({ items: editor.items.map(item => item.product_id === id ? { ...item, quantity } : item) })} />
          <p className="bom-hint">{pt("production.quantitiesReadAt")} {time(source.captured_at)}{pt("production.revalidatedOnSubmission")}{source.material_workflow && editor.kind === 'complete' ? pt("production.availableIssuedBalance") : pt("production.stock")}。</p>
        </section>}
        {source && !correcting && <section className="panel bom-section"><ScrapOutputs rows={scrapRows} materials={rows} complete={editor.kind === 'complete'} disabled={action.busy}
          onChange={(id, patch) => update({ scraps: editor.scraps.map(row => row.product_id === id ? { ...row, ...patch } : row) })} />
          {scrapRows.length > 0 && editor.kind === 'complete' && <p className="bom-hint">{pt("production.changingOutputOrUsageRecalculatesEstimatesEnteredActual")}</p>}
          {!scrapRows.length && <p className="bom-hint">{pt("production.noScrapOutputConfiguredForThisOrder")}</p>}
        </section>}
        {notices}
        <div className="bom-editor-actions"><Button type="button" disabled={action.busy} onClick={back}>{pt("production.cancel")}</Button>
          {detail && <Button type="button" disabled={action.busy} onClick={() => { if (!dirty || window.confirm(pt("production.reloadingWillDiscardCurrentEntriesContinue"))) open(detail.id); }}>{pt("production.reloadProductionOrder")}</Button>}
          {management && editor.kind === 'complete' && <Button type="submit" value="continue" disabled={action.busy}>{pt("production.registerBatchAndContinue")}</Button>}
          <Button type="submit" kind="primary" icon={planning ? Save : editor.kind === 'complete' ? Check : XCircle} busy={action.busy} disabled={!source || !!quantityError}>
            {planning ? pt("production.saveProductionDraft") : editor.kind === 'complete' ? (management ? pt("production.registerBatchAndEndProduction") : pt("production.registerBatchAndContinue")) : pt("production.confirmVoid")}</Button>
        </div>
      </AntForm>
    </div>;
  }

  if (detail) return <div className="bom-page production-page">
    {heading(pt("production.productionOrderDetails"), detail.number)}{notices}
    <div className="production-detail-header"><div className="bom-section-heading"><div><h2>{detail.product_name}</h2><small>{detail.barcode}{detail.specification && ` · ${detail.specification}`}</small></div>{statusBadge(detail.status)}</div>
      <div className="bom-actions">
        {management && detail.status === 'draft' && !detail.batches?.length && <Button disabled={action.busy} onClick={() => begin({ kind: 'edit', planned_quantity: String(detail.planned_quantity), note: detail.note })}>{pt("production.editDraft")}</Button>}
        {management && detail.material_workflow === 1 && detail.status === 'draft' && <Button kind="primary" disabled={action.busy} onClick={startProduction}>{pt("production.startProduction")}</Button>}
        {(detail.status === 'in_progress' || !detail.material_workflow && detail.status === 'draft') && <Button kind="primary" icon={Check} disabled={action.busy} onClick={beginCompletion}>{pt("production.register")}</Button>}
        {management && detail.status === 'in_progress' && <Button disabled={action.busy || !detail.batch_count || detail.material_documents?.some(doc => doc.status === 'pending')} onClick={finishOrder}>{pt("production.endProduction")}</Button>}
        {management && detail.status !== 'void' && can('corrections') && <Button icon={XCircle} disabled={action.busy || !detail.material_workflow && detail.received_quantity > 0 && !can('purchase')} onClick={() => begin({ kind: 'void', reason: '' })}>{pt("production.voidProductionOrder")}</Button>}
        {management && detail.status === 'void' && can('corrections') && <Button kind="danger" icon={Trash2} disabled={action.busy} onClick={() => remove(detail)}>{pt("production.deleteProductionOrder")}</Button>}
        <Button disabled={action.busy} onClick={() => open(detail.id)}>{pt("production.refreshOrderAndStock")}</Button>
      </div>
    <div className="bom-actions production-detail-export"><Select aria-label={pt("production.outputLanguage")} value={outputLanguage || locale} onChange={setOutputLanguage}><option value="zh-CN">简体中文</option><option value="en">English</option><option value="vi">Tiếng Việt</option></Select><Button disabled={action.busy} onClick={() => action.run(() => downloadProductionPdf(detail, data.warehouse_id, outputLanguage || locale))}>{pt("production.exportPdf")}</Button></div>
    </div>
    <ProductionDetailTabs key={detail.id} active={detailTab} onChange={setDetailTab} items={[
      { key: 'overview', label: pt('production.overviewTab'), children: <>
    <section className="panel bom-section">
      <section className="production-summary" aria-label={pt("production.productionReceiptProgress")}><div><small>{pt("production.plannedOutput2")}</small><strong>{count(detail.planned_quantity)} {detail.unit}</strong></div>
        <div><small>{pt("production.cumulativeOutput")}</small><strong>{count(detail.completed_quantity ?? 0)} {detail.unit}</strong></div>
        <div><small>{pt("production.received")}</small><strong>{count(detail.received_quantity ?? 0)} {detail.unit}</strong></div>
        <div><small>{pt("production.pendingReceipt")}</small><strong>{count(detail.pending_receipt_quantity ?? 0)} {detail.unit}</strong></div>
        <div><small>{pt("production.remainingPlan")}</small><strong>{count(Math.max(0, quantityUnits(detail.planned_quantity) - quantityUnits(detail.completed_quantity ?? 0)) / QUANTITY_SCALE)} {detail.unit}</strong></div>
        {management && can('finance') && detail.completed_at && <div><small>{pt("production.totalMaterialCost")}</small><strong>{money(detail.total_cost_cents)}</strong></div>}
      </section>
      {detail.status === 'completed' && detail.pending_receipt_quantity > 0 && <p className="bom-warning">{pt("production.productionEndedAwaitingWarehouseReceiptAcceptedProductsAnd")}</p>}
      {detail.status === 'void' && <p className="bom-hint">{pt("production.orderVoidedCumulativeOutputRetainsHistoricalRecordsReceipts")}</p>}
      <div className="production-assignment-panel">
        <div className="production-assignment-current">
          <p className="bom-hint production-assignment-chip">{pt("production.productionGroup")}{productionAssignments(detail).assigned_groups.map(group => group.name).join("、") || pt("production.ungrouped")}</p>
          {!!productionAssignments(detail).assigned_users.length && <p className="bom-hint production-assignment-chip">{pt('production.assignedUsers')}{productionAssignments(detail).assigned_users.map(user => user.name).join('、')}</p>}
        </div>
        {management && ['draft', 'awaiting_materials', 'in_progress'].includes(detail.status) && <ProductionAssignments key={`${detail.id}:${detail.version}`} order={detail} busy={action.busy}
          onSave={targets => action.run(async () => { await saved(await send(`/production-orders/${detail.id}/assign`, { ...targets, version: detail.version }, { warehouseId: data.warehouse_id }), pt('production.assignmentsUpdated')); })} />}
      </div>
      <p className="bom-hint">{pt("production.recipe")}{detail.bom_name} #{detail.bom_id} {pt("production.baseOutput2")} {count(detail.base_quantity)} {detail.unit} {pt("production.recipeRetainedFromOrderCreation")}</p>
      <p className="bom-hint">{detail.snapshot_format === 2 ? pt("production.rootRecipeLossCalculation") : pt("production.standardLossCalculation")}：{bomLossMethodLabels[detail.loss_method]}{pt("production.standardInput")}{bomLossMethodFormulas[detail.loss_method]}。</p>
      {detail.note && <p className="production-note">{detail.note}</p>}
      <div className="production-audit"><p>{pt("production.created")}{detail.created_by_name} · {time(detail.created_at)}</p><p>{pt("production.updated")}{detail.updated_by_name} · {time(detail.updated_at)}</p>
        {detail.completed_at && <p>{pt("production.lastCompletion")}{detail.completed_by_name} · {time(detail.completed_at)}</p>}
        {detail.voided_at && <><p>{pt("production.voided")}{detail.voided_by_name} · {time(detail.voided_at)}</p><p>{pt("production.voidReason2")}{detail.void_reason}</p></>}
      </div>

      {management && detail.status !== 'void' && can('corrections') && !detail.material_workflow && detail.received_quantity > 0 && !can('purchase') && <p className="bom-hint">{pt("production.thisHistoricalOrderContainsReceivedProductsVoidingThe")}</p>}
    </section>
    <p className="bom-hint">{pt("production.thePdfQrCodeUsesThisAddressThe")} {location.origin}{pt("production.andSignInWithAnAuthorizedAccountTo")}</p>
      </> },
      { key: 'progress', label: pt('production.progressTab'), children: <>
    {!detail.stage_workflow && !!detail.operation_routes?.length && <section className="panel bom-section process-order-summary-panel">
      <div className="bom-section-heading">
        <div>
          <h2>{pt('route.progress')}</h2>
          <p className="bom-hint">{detail.operation_routes[0].route_name} · {pt('route.version', { version: detail.operation_routes[0].route_version })}</p>
        </div>
        <Button disabled={action.busy} onClick={() => begin({ kind: 'operations' })}>{pt('route.viewProgress')}</Button>
      </div>
      <ProcessFlowStrip graph={detail.operation_routes[0].graph} operations={detail.operation_routes[0].operations} />
    </section>}
    {!!detail.stage_workflow && <ProductionStageSummary order={detail} disabled={action.busy} onOpen={() => begin({ kind: 'stages' })} />}
    {!!detail.stage_workflow && <ProductionProcessOverview key={`overview:${detail.id}`} order={detail} disabled={action.busy} onOpen={path => begin({ kind: 'stages', operationPath: path })} />}
    {!detail.stage_workflow && detail.snapshot_format === 2 && <section className="panel bom-section">
      <p className="bom-hint">{pt("production.thisOrderUsesWholeOrderRegistrationWithNo")}</p>
      {management && detail.material_workflow && detail.status === 'draft' && !detail.batches.length && !detail.material_documents.length && !detail.receipt_documents.length && <Button disabled={action.busy} onClick={() => action.run(async () => {
        if (!window.confirm(pt("production.enableLevelRegistrationUsingTheSavedRecipeRegister"))) return;
        await saved(await send(`/production-orders/${detail.id}/stages/enable`, { version: detail.version }, { warehouseId: data.warehouse_id }), pt("production.levelRegistrationEnabled"));
      })}>{pt("production.enableLevelRegistration")}</Button>}
    </section>}
    {!detail.stage_workflow && !detail.operation_routes?.length && <section className="panel bom-section"><p className="bom-hint">{pt('production.noProcessProgress')}</p></section>}
      </> },
      { key: 'materials', label: pt('production.materialsTab'), children: <>
    {detail.material_workflow === 1 && <section className="panel bom-section" aria-label={pt("production.productionMaterialIssuesAndReturns")}><h2>{pt("production.materialLedger")}</h2>
      {detail.status === 'awaiting_materials' && <p className="bom-warning">{pt("production.collectMaterialsFromTheWarehouseAfterIssueConfirmation")}</p>}
      {detail.status === 'completed' && detail.items.some(item => item.available_quantity > 0) && <p className="bom-warning">{pt("production.unusedMaterialsRemainVerifyAndRequestAReturn")}</p>}
      {detail.items.some(item => item.pending_issue_quantity > 0) && detail.status === 'in_progress' && <p className="bom-warning">{pt("production.partialIssueProductionHint")}</p>}
      <p className="bom-hint">{pt("production.issuedBalanceConfirmedIssuesValidRegisteredUsageConfirmed")}</p>
      <div className="bom-actions">
        {management && detail.status === 'in_progress' && <Button disabled={action.busy || detail.material_documents?.some(doc => doc.status === 'pending')} onClick={() => requestMaterials('out')}>{pt("production.requestSupplement")}</Button>}
        {management && ['in_progress', 'completed'].includes(detail.status) && <Button disabled={action.busy || detail.material_documents?.some(doc => doc.status === 'pending') || !detail.items.some(item => item.available_quantity > 0)} onClick={() => requestMaterials('in')}>{pt("production.requestReturn")}</Button>}
        {onNavigate && can('sale') && <Button disabled={action.busy} onClick={() => onNavigate('sales', { approval: 'issues', q: detail.number })}>{pt("production.goToIssues")}</Button>}
        {onNavigate && can('purchase') && <Button disabled={action.busy} onClick={() => onNavigate('purchases', { approval: 'returns', q: detail.number })}>{pt("production.goToReceipts")}</Button>}
      </div>
      {detail.material_documents?.some(doc => doc.status === 'pending') && <p className="bom-hint">{pt("production.aMaterialRequestIsPendingHaveTheWarehouse")}</p>}
      <ProductionMaterialLedger key={detail.id} order={detail} costs={management && can('finance')} busy={action.busy} />
      {!detail.completed_at && <p className="bom-hint">{pt("production.stockReadAt2")} {time(detail.captured_at)}。{pt("production.draftsAndPendingIssueRequestsDoNotReserve")}</p>}
      {detail.status === 'void' && detail.completed_at && <p className="bom-hint">{pt("production.originalCompletionRecordsRetainedAboveThisOrderIs")}</p>}
      {!!detail.material_documents?.length && <div className="production-ledger-documents"><h3>{pt('production.materialDocumentHistory')}</h3>
        <MaterialDocumentList documents={detail.material_documents} busy={action.busy} onCancel={management && detail.status !== 'void' ? cancelMaterialRequest : undefined} />
      </div>}
    </section>}
    {!!detail.stage_workflow && management && can('finance') && <section className="panel bom-section"><h2>{pt("production.materialCostsByLevel")}</h2>
      <div className="material-balance"><div><small>{pt("production.rawMaterialCostInvestedInAllLevels")}</small><span>{money(detail.direct_material_cost_cents)}</span></div><div><small>{pt("production.remainingSemiFinishedCostInOrder")}</small><span>{money(detail.work_in_progress_cost_cents)}</span></div></div>
      <p className="bom-hint">{pt("production.productCostIncludesOnlyInputsTransferredIntoRoot")}</p>
    </section>}
    {!detail.material_workflow && <section className="panel bom-section"><h2>{detail.completed_at ? pt("production.usageRecords") : pt("production.plannedMaterials")}</h2>
      {!!detail.stage_workflow && <p className="bom-hint">{pt("production.actualUsageHereIsGroupedByFinalProduct")}</p>}
      {detail.completed_at && <p className="bom-hint">{pt("production.standardUsageUsesTheSavedNetUsageLoss")}</p>}
      <Materials rows={detail.items} issued={!!detail.material_workflow && ['in_progress', 'completed'].includes(detail.status)} showActual={!!detail.completed_at} costs={management && can('finance')} />
      {detail.status === 'void' && detail.completed_at && <p className="bom-hint">{pt("production.originalCompletionRecordsRetainedAboveThisOrderIs")}</p>}
      {!detail.completed_at && <p className="bom-hint">{pt("production.stockReadAt2")} {time(detail.captured_at)}。{detail.material_workflow ? pt("production.draftsAndPendingIssueRequestsDoNotReserve") : pt("production.thisHistoricalOrderVerifiesActualUsageAndDeducts")}</p>}
    </section>}
      </> },
      { key: 'records', label: pt('production.recordsTab'), children: <>
    <ProductionBatches key={detail.id} order={detail} costs={management && can('finance')} canVoid={management && can('corrections') && !detail.stage_workflow} canReceive={can('purchase')} disabled={action.busy}
      onVoid={batch => begin({ kind: 'void_batch', batchId: batch.id, reason: '' })} />
    {!!detail.receipt_documents?.length && <section className="panel bom-section" aria-label={pt("production.productionProductReceipts")}><h2>{pt("production.productionProductReceipts")}</h2>
      <p className="bom-hint">{pt("production.approveEachBatchSeparatelyPendingReceiptsDoNot")}</p>
      {onNavigate && can('purchase') && <Button className="production-receipt-action" disabled={action.busy} onClick={() => onNavigate('purchases', { approval: 'receipts', q: detail.number })}>{pt("production.goToReceiptApproval")}</Button>}
      <ProductionReceiptList documents={detail.receipt_documents} busy={action.busy} />
    </section>}
    {(detail.scraps || []).length > 0 && <section className="panel bom-section"><ScrapOutputs rows={detail.scraps} materials={detail.items} completed={!!detail.completed_at} receiptStatus={detail.status === 'void' ? 'void' : undefined} />
      {detail.completed_at && detail.status !== 'void' && <p className="bom-hint">{pt("production.registeredReceiptsIncludePendingAndReceivedScrapCheck")}</p>}
      {detail.status === 'void' && detail.completed_at && <p className="bom-hint">{pt("production.orderVoidedScrapRecordsRemainReceivedQuantitiesHave")}</p>}
    </section>}
    {!detail.batches?.length && !detail.receipt_documents?.length && !(detail.scraps || []).length && <section className="panel bom-section"><p className="bom-hint">{pt('production.noCompletionRecords')}</p></section>}
      </> },
      { key: 'recipe', label: pt('production.recipeStructure'), children: <>
    {detail.snapshot_format === 2 && <section className="panel bom-section"><h2>{pt("production.recipeStructureSnapshot")}</h2>
      <BomStructure nodes={detail.nodes} quantity={detail.planned_quantity} isSnapshot horizontal active={detailTab === 'recipe'} />
    </section>}
    {detail.snapshot_format !== 2 && <section className="panel bom-section"><p className="bom-hint">{pt('production.noRecipeSnapshot')}</p></section>}
      </> },
    ]} />
  </div>;

  return <div className="bom-page production-page">
    <PageHeading title={pt("production.productionOrders")} description={management ? pt("production.planProductionFromRecipesCollectWarehouseMaterialsRegister") : pt("production.viewOrdersAssignedToYourGroupAndRegister")}>
      <Button disabled={action.busy || registration.busy} onClick={registration.openScanner}>{pt("production.scanToRegister")}</Button>
      {management && <Button kind="primary" icon={Plus} disabled={action.busy} onClick={() => begin({ kind: 'new', note: '', planned_quantity: '1', plan: null })}>{pt("production.newProductionOrder")}</Button>}
    </PageHeading>{notices}
    <section className="panel bom-section"><div className="bom-list-filters">
      <AntInput type="search" aria-label={pt("production.searchProductionOrders")} placeholder={pt("production.searchOrderNumberProductCodeOrRecipe")} maxLength={100} value={q} onChange={e => { setQ(e.target.value); setOffset(0); }} />
      <Select aria-label={pt("production.productionOrderStatus")} value={status} onChange={e => { setStatus(e); setOffset(0); }}><option value="all">{pt("production.allStatuses")}</option>
        {Object.entries(productionStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select>
    </div><QueryStatus query={list} />
      <div className="production-list">{list.result?.orders.map(order => <article className="bom-list-item" key={order.id}>
        <div className="bom-list-info"><strong>{order.product_name}</strong><p>{order.number}</p><small>{order.barcode} · {order.bom_name} #{order.bom_id}</small>
          <small>{pt("production.planned")} {count(order.planned_quantity)} {order.unit}{order.completed_at ? pt("production.accepted", { v0: count(order.completed_quantity), v1: order.unit }) : ''} {pt("production.createdBy")} {order.created_by_name}</small>
          <small>{pt("production.productionGroup")}{productionAssignmentNames(order) || pt("production.ungrouped")}</small><small>{time(order.created_at)}</small>{statusBadge(order.status)}</div>
        <div className="bom-actions"><Button icon={ClipboardList} disabled={action.busy} onClick={() => open(order.id)} aria-label={pt("production.viewProductionOrder", { v0: order.number })}>{pt("production.viewDetails")}</Button>
          {management && order.status === 'void' && can('corrections') && <Button kind="danger" icon={Trash2} disabled={action.busy} onClick={() => remove(order)}>{pt("production.deleteProductionOrder")}</Button>}</div>
      </article>)}</div>
      {list.result && !list.result.orders.length && <p className="bom-empty">{management ? pt("production.noMatchingProductionOrdersSelectAnExistingBom") : pt("production.noAssignedOrders")}</p>}
      {list.result && (offset > 0 || list.result.has_more) && <div className="bom-actions bom-pagination"><Button disabled={!offset} onClick={() => setOffset(n => n - 30)}>{pt("production.previous")}</Button><span>{pt("production.total")} {list.result.total} {pt("production.orders")}</span><Button disabled={!list.result.has_more} onClick={() => setOffset(n => n + 30)}>{pt("production.next")}</Button></div>}
    </section>
  </div>;
}
