import { ProductionOperations, OperationWorkerSelect } from './ProductionOperations.jsx';
import { productionMessage } from '../i18n/production-errors.js';
import { t as pt, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { Input } from '../ui/controls.jsx';
import { Button, Badge, PageHeading, QueryStatus } from '../components/common.jsx';
import { useBusiness } from '../business-api.js';
import { useQuery } from '../queries.js';
import { api } from '../api.js';
import { parseQuantity, materialQuantity, addQuantity } from '../../shared/quantity.js';
import { stageDisplayStandardQuantity, stageStandardQuantity } from '../../shared/production-stages.js';
import { scrapExpectedQuantity, validateScrapActuals } from '../../shared/scrap.js';
import { ScrapOutputs } from './ScrapOutputs.jsx';
import './production-stages.css';

const count = value => Number(value ?? 0).toLocaleString(getFormatLocale(), { maximumFractionDigits: 6 });
const time = value => new Date(value).toLocaleString(getFormatLocale(), { hour12: false });

export function ProductionStageSummary({ order, onOpen, disabled }) {
  useLocale();
  const children = order.stages.filter(stage => stage.path !== '');
  const started = children.filter(stage => stage.completed_quantity > 0).length;
  const remaining = children.filter(stage => stage.available_quantity > 0);
  return <section className="panel bom-section" aria-label={pt("production.productionProgressByLevel")}>
    <div className="bom-section-heading"><h2>{pt("production.productionByLevel")}</h2><span>{started} / {children.length} {pt("production.semiFinishedLevelsRegistered")}</span></div>
    <p className="bom-hint">{pt("production.registerLowerLevelSemiFinishedOutputFirstFor")}</p>
    {remaining.length > 0 && <p className="bom-hint">{remaining.length} {pt("production.semiFinishedLevelsStillHaveAvailableQuantitiesConsume")}</p>}
    <Button disabled={disabled} onClick={onOpen}>{pt("production.viewProgressAndBatchesByLevel")}</Button>
  </section>;
}

export function ProductionStages({ order, data, canRegister, canVoid, canReceive, management, busy = false, initialOperationPath, initialHistoryPath, onRegister, onActivity, onSaved, onBack }) {
  useLocale();
  const [operationPath, setOperationPath] = useState(initialOperationPath ?? null), [operationActivity, setOperationActivity] = useState(null);
  const [scope, setScope] = useState(''), [search, setSearch] = useState('');
  const [form, setForm] = useState(null), [baseline, setBaseline] = useState('');
  const [history, setHistory] = useState(() => initialHistoryPath !== undefined ? { path: initialHistoryPath, offset: 0 } : null), [voiding, setVoiding] = useState(null);
  const action = useBusiness(), locked = busy || action.busy;
  const byPath = useMemo(() => new Map(order.stages.map(stage => [stage.path, stage])), [order.stages]);
  const stage = form ? byPath.get(form.path) : null;
  const pathLabel = value => {
    const parts = [], seen = new Set();
    for (let current = value; current && !seen.has(current.path); current = current.path ? byPath.get(current.parent_path) : null) {
      seen.add(current.path); parts.unshift(current.name);
    }
    return parts.join(' / ');
  };
  const dirty = (!!form && JSON.stringify(form) !== baseline) || !!voiding?.reason;
  useEffect(() => { onActivity?.({ form, history, voiding, operationActivity, busy: locked || !!operationActivity?.busy }); }, [form, history, voiding, operationActivity, locked, onActivity]);
  useEffect(() => () => onActivity?.(null), [onActivity]);
  const guard = useRef({}); guard.current = { dirty, locked };
  useEffect(() => {
    const navigate = event => { if (guard.current.locked || guard.current.dirty && !window.confirm(pt("production.levelRegistrationIsUnsavedLeave"))) event.preventDefault(); };
    const unload = event => { if (guard.current.dirty || guard.current.locked) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('erp:before-navigate', navigate); window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('erp:before-navigate', navigate); window.removeEventListener('beforeunload', unload); };
  }, []);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [form?.path, history?.path, scope]);
  const leave = fn => { if (!locked && (!dirty || window.confirm(pt("production.levelRegistrationIsUnsavedLeave")))) { action.setError(''); fn(); } };
  const back = () => leave(() => {
    if (form) { if (form.operation_node_id) setOperationPath(form.path); setForm(null); }
    else if (history) { if (initialHistoryPath !== undefined) onBack(); else { setHistory(null); setVoiding(null); } }
    else onBack();
  });
  const defaults = (target, quantity) => target.items.map(item => ({ path: item.path, quantity: String(stageStandardQuantity(item, quantity)), variance_reason: '' }));
  const begin = (target, operation = null, workerId = undefined) => action.run(async () => {
    if (!operation && order.operation_routes?.some(route => route.path === target.path)) { setOperationPath(target.path); return; }
    const quantity = materialQuantity(operation?.available_quantity ?? (Math.max(0, target.planned_quantity - target.completed_quantity) || 1), target);
    const next = { path: target.path, ...(operation ? { operation_node_id: operation.id, worker_id: workerId } : {}), completed_quantity: String(quantity), items: defaults(target, quantity), note: '',
      scraps: target.path ? [] : order.scraps.map(row => ({ product_id: row.product_id, quantity: '0', disposition: 'stock' })) };
    setOperationPath(null); setForm(next); setBaseline(JSON.stringify(next)); setHistory(null);
  });
  const patch = update => { setForm(previous => ({ ...previous, ...update })); action.setError(''); };
  const historyQuery = useQuery(history ? `/production-orders/${order.id}/stages/batches?${new URLSearchParams({ path: history.path, offset: String(history.offset), limit: '20' })}` : null, data);
  const send = (path, body) => action.send(`/production-orders/${order.id}${path}`, { schema_version: 2, stage_schema_version: 1, operation_schema_version: 1, version: order.version, ...body }, { warehouseId: data.warehouse_id });
  const submit = event => {
    event.preventDefault();
    const finish = management && stage.path === '' && event.nativeEvent.submitter?.value === 'finish';
    action.run(async () => {
      const quantity = materialQuantity(parseQuantity(form.completed_quantity, true), stage);
      const items = form.items.map(row => {
        const item = stage.items.find(item => item.path === row.path);
        const actual = materialQuantity(parseQuantity(row.quantity, item.usage_mode === 'explode'), item);
        if (actual > item.available_quantity) throw new Error(pt("production.insufficientAvailableFirst", { v0: item.name, v1: item.usage_mode === 'explode' ? pt("production.registerLowerLevelSemiFinishedOutput") : pt("production.supplementMaterials") }));
        return { ...row, quantity: actual };
      });
      if (!items.some(item => item.quantity > 0)) throw new Error(pt("production.actualInputForAtLeastOneMaterialMust"));
      const scraps = form.scraps.map(row => ({ ...row, quantity: materialQuantity(parseQuantity(row.quantity), order.scraps.find(item => item.product_id === row.product_id)) }));
      if (stage.path === '') validateScrapActuals(scraps, order.scraps);
      if (!window.confirm(pt("production.register2", { v0: stage.name, v1: count(quantity), v2: stage.unit, v3: stage.path ? pt("production.thisSemiFinishedBatchStaysWithinTheOrder") : pt("production.thisProductBatchAwaitsWarehouseReceiptApproval"), v4: finish ? pt("production.alsoEndTheProductionOrder") : '' }))) return;
      const result = await send('/stages/complete', { path: stage.path, ...(form.operation_node_id ? { operation_node_id: form.operation_node_id, worker_id: form.worker_id } : {}), completed_quantity: quantity, items, scraps, note: form.note, finish_order: finish });
      setForm(null); setBaseline('');
      await onSaved(result, stage.path ? pt("production.semiFinishedBatchRegisteredForParentUseWarehouse") : pt("production.productBatchRegisteredAwaitingWarehouseApproval", { v0: finish ? pt("production.productionEnded") : '' }));
    });
  };
  let standardError = '';
  const standards = new Map();
  if (stage) {
    try { for (const item of stage.items) standards.set(item.path, stageDisplayStandardQuantity(item, parseQuantity(form.completed_quantity, true))); }
    catch (error) { standardError = error.message; }
  }
  const scrapRows = stage?.path === '' ? order.scraps.map(row => {
    let expected_quantity = null;
    try { expected_quantity = scrapExpectedQuantity(row, parseQuantity(form.completed_quantity, true), order.base_quantity,
      form.items.map(input => ({ product_id: stage.items.find(item => item.path === input.path).product_id, quantity: parseQuantity(input.quantity) })), order.quantity_decimals); } catch { /* Keep invalid input visible until corrected. */ }
    const actual = form.scraps.find(item => item.product_id === row.product_id);
    return { ...row, expected_quantity, actual: actual.quantity, disposition: actual.disposition };
  }) : [];
  const heading = stage ? pt("production.register3", { v0: stage.path ? pt("production.semiFinishedProduct") : pt("production.finishedProduct") }) : history ? pt("production.levelBatchRecords") : pt("production.selectProductionLevel");
  const notices = <>{productionMessage(action.error) && <p className="form-error" role="alert">{productionMessage(action.error)}</p>}</>;
  const visible = order.stages.filter(item => search.trim()
    ? `${item.name} ${item.path}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    : item.path === scope || item.path !== '' && item.parent_path === scope);
  const requiresReceiptPermission = batch => {
    const root = batch.root_batch_id && order.batches.find(row => row.id === batch.root_batch_id);
    return root && (root.receipt_status === 'confirmed' || !root.receipt_required);
  };
  if (operationPath !== null) return <ProductionOperations order={order} path={operationPath} data={data} canRegister={canRegister} onRegister={onRegister} onActivity={setOperationActivity} onSaved={onSaved} onBack={() => initialOperationPath !== undefined ? onBack() : setOperationPath(null)} onOutput={(node, workerId) => begin(byPath.get(operationPath), node, workerId)} />;
  return <div className="production-stages">
    <PageHeading title={heading} description={`${order.number} · ${stage ? pathLabel(stage) : history ? pathLabel(byPath.get(history.path)) : order.product_name}`}>
      <Button icon={ArrowLeft} disabled={locked} onClick={back}>{form || history && initialHistoryPath === undefined ? pt("production.backToLevelSelection") : pt("production.backToOrderDetails")}</Button>
    </PageHeading>
    {form && stage ? <form onSubmit={submit}>
      <section className="panel bom-section">
        {form.operation_node_id && <OperationWorkerSelect order={order} warehouseId={data.warehouse_id} value={form.worker_id} onChange={worker_id => patch({ worker_id })} disabled={locked} />}
        <h2>{stage.name}</h2><p className="stage-path">{pathLabel(stage)}</p>
        <p className="bom-hint">{pt("production.planned")} {count(stage.planned_quantity)} {stage.unit}{pt("production.acceptedToDate")} {count(stage.completed_quantity)} {stage.unit}{pt("production.enterThisBatchSQuantity")}</p>
        <label className="production-output">{pt("production.acceptedBatchQuantity")}{stage.unit}）<Input aria-label={pt("production.acceptedBatchQuantity2")} inputMode="decimal" value={form.completed_quantity} disabled={locked} onChange={event => patch({ completed_quantity: event.target.value })} /></label>
        {Number(form.completed_quantity) + stage.completed_quantity > stage.planned_quantity && <p className="bom-warning">{pt("production.thisRegistrationWillExceedPlannedOutputVerifyActual")}</p>}
        <Button disabled={locked} onClick={() => action.run(async () => patch({ items: defaults(stage, parseQuantity(form.completed_quantity, true)).map(item => ({ ...item, variance_reason: form.items.find(row => row.path === item.path).variance_reason })) }))}>{pt("production.fillUsageFromThisBatchSOutput")}</Button>
      </section>
      <section className="panel bom-section"><h2>{pt("production.verifyInputsForThisLevel")}</h2><p className="bom-hint">{pt("production.rawMaterialsUseTheIssuedBalanceSemiFinished")}</p>
        {standardError && <p className="bom-warning">{productionMessage(standardError)}</p>}
        {stage.items.map(item => {
          const actual = form.items.find(row => row.path === item.path), standard = standards.get(item.path);
          return <article className="stage-input" key={item.path}>
            <div><strong>{item.name}</strong><p className="bom-hint">{item.usage_mode === 'explode' ? pt("production.semiFinishedInThisOrder") : pt("production.issuedRawMaterials")} · {item.usage_mode === 'explode' ? pathLabel(byPath.get(item.path)) : item.path}</p></div>
            <div className="stage-input-numbers"><span>{pt("production.standardInput2")} <strong>{standard === undefined ? '—' : count(standard)} {item.unit}</strong></span><span>{pt("production.available")} <strong>{count(item.available_quantity)} {item.unit}</strong></span></div>
            <label>{pt("production.actualInput")}{item.unit}）<Input aria-label={pt("production.actualInput2", { v0: item.name })} inputMode="decimal" disabled={locked} value={actual.quantity} onChange={event => patch({ items: form.items.map(row => row.path === item.path ? { ...row, quantity: event.target.value } : row) })} /></label>
            {Number(actual.quantity) > item.available_quantity && <p className="bom-warning">{pt("production.insufficientAvailableQuantityFirst")}{item.usage_mode === 'explode' ? pt("production.registerLowerLevelSemiFinishedOutput") : pt("production.supplementMaterials")}。</p>}
            <label>{pt("production.usageVarianceReason2")}<Input aria-label={pt("production.usageVarianceReason", { v0: item.name })} maxLength={500} value={actual.variance_reason} disabled={locked} onChange={event => patch({ items: form.items.map(row => row.path === item.path ? { ...row, variance_reason: event.target.value } : row) })} /></label>
          </article>;
        })}
      </section>
      {scrapRows.length > 0 && <section className="panel bom-section"><ScrapOutputs rows={scrapRows} materials={stage.items} complete disabled={locked}
        onChange={(id, changes) => patch({ scraps: form.scraps.map(row => row.product_id === id ? { ...row, ...changes } : row) })} /></section>}
      <section className="panel bom-section"><label>{pt("production.batchNote")}<Input.TextArea aria-label={pt("production.batchNote")} maxLength={500} rows={2} value={form.note} disabled={locked} onChange={event => patch({ note: event.target.value })} /></label></section>
      {notices}<div className="bom-editor-actions"><Button disabled={locked} onClick={back}>{pt("production.cancel")}</Button>
        <Button disabled={locked} onClick={() => leave(() => action.run(async () => onSaved(await api(`/production-orders/${order.id}`, { warehouseId: data.warehouse_id }), pt("production.productionOrderReloadedSelectALevelAndVerify"))))}>{pt("production.reloadProductionOrder")}</Button>
        <Button type="submit" kind="primary" value="continue" busy={locked}>{stage.path ? pt("production.registerSemiFinishedBatch") : pt("production.registerBatchAndContinue")}</Button>
        {stage.path === '' && management && <Button type="submit" value="finish" disabled={locked}>{pt("production.registerBatchAndEndProduction")}</Button>}
      </div>
    </form> : history ? <section className="panel bom-section">
      <h2>{byPath.get(history.path)?.name}</h2><QueryStatus query={historyQuery} />
      {historyQuery.result?.batches.length === 0 && <p className="bom-hint">{pt("production.noRegisteredBatchesAtThisLevel")}</p>}
      {historyQuery.result?.batches.map(batch => <article className="production-batch" key={batch.id}>
        <div className="bom-section-heading"><strong>{pt("production.batch")} {batch.batch_number} {pt("production.batchSuffix")} {count(batch.completed_quantity)} {byPath.get(history.path)?.unit}</strong><Badge tone={batch.status === 'active' ? 'green' : 'gray'}>{batch.status === 'active' ? pt("production.valid") : pt("production.voided2")}</Badge></div>
        <p className="bom-hint">{batch.created_by_name} · {time(batch.created_at)}</p>
        {batch.note && <p className="production-note">{batch.note}</p>}
        <details><summary>{pt("production.viewBatchInputs")}</summary>{batch.items?.map(item => {
          const source = byPath.get(history.path)?.items.find(input => input.path === item.path);
          let standard = null;
          try { if (source) standard = stageDisplayStandardQuantity(source, batch.completed_quantity); } catch { /* Show actual records if standards exceed limits. */ }
          return <div className="production-batch-material" key={item.path ?? item.id}><strong>{item.name}</strong>
            <p>{pt("production.actualInput3")} {count(item.quantity ?? item.actual_quantity)} {item.unit}{standard !== null && pt("production.standard", { v0: count(standard), v1: item.unit })}</p>
            {item.variance_reason && <p>{pt("production.varianceReason")}{item.variance_reason}</p>}
            {item.allocations?.map(allocation => <p className="bom-hint" key={allocation.id}>{pt("production.sourceLevel")} {allocation.source_path} {pt("production.batch3")} {allocation.source_batch_number} {pt("production.batchSuffix")} {count(allocation.quantity)} {item.unit}</p>)}
          </div>;
        })}</details>
        {batch.status === 'void' && <p className="bom-hint">{pt("production.voidReason2")}{batch.void_reason}</p>}
        {canVoid && batch.status === 'active' && order.status !== 'void' && (requiresReceiptPermission(batch) && !canReceive
          ? <p className="bom-hint">{pt("production.thisProductBatchIsReceivedVoidingAlsoRequires")}</p>
          : <div className="bom-actions"><Button disabled={locked} onClick={() => leave(() => setVoiding({ id: batch.id, reason: '' }))}>{pt("production.voidBatch")} {batch.batch_number} {pt("production.batch2")}</Button></div>)}
        {voiding?.id === batch.id && <form onSubmit={event => { event.preventDefault(); action.run(async () => {
          if (!voiding.reason.trim()) throw new Error(pt("production.enterAReasonForVoiding"));
          const consequence = batch.path === ''
            ? requiresReceiptPermission(batch) ? pt("production.receivedProductsAndScrapWillReverseAtOriginal") : pt("production.thePendingReceiptForThisBatchWillAlso")
            : pt("production.ifSemiFinishedOutputWasUsedByA");
          if (!window.confirm(pt("production.voidThisBatchAndRestoreOriginalInputs", { v0: consequence }))) return;
          const result = await send(`/stages/batches/${batch.id}/void`, { reason: voiding.reason });
          setVoiding(null); await onSaved(result, pt("production.batchVoidedOriginalInputQuantitiesAndCostsRestored"));
        }); }}><label>{pt("production.voidReason")}<Input.TextArea aria-label={pt("production.levelBatchVoidReason")} rows={2} maxLength={500} disabled={locked} value={voiding.reason} onChange={event => setVoiding({ ...voiding, reason: event.target.value })} /></label>
          <div className="bom-actions"><Button disabled={locked} onClick={() => leave(() => setVoiding(null))}>{pt("production.cancelVoid")}</Button><Button type="submit" kind="danger" busy={locked}>{pt("production.confirmBatchVoid")}</Button></div></form>}
      </article>)}
      <div className="bom-actions"><Button disabled={locked || !history.offset} onClick={() => leave(() => setHistory({ ...history, offset: history.offset - 20 }))}>{pt("production.previousBatches")}</Button><Button disabled={locked || !historyQuery.result?.has_more} onClick={() => leave(() => setHistory({ ...history, offset: history.offset + 20 }))}>{pt("production.nextBatches")}</Button></div>{notices}
    </section> : <section className="panel bom-section">
      <h2>{pt("production.productionByLevel")}</h2><p className="bom-hint">{pt("production.selectAFinishedOrSemiFinishedProductTo")}</p>
      <Input type="search" aria-label={pt("production.searchProductionLevels")} placeholder={pt("production.searchProductSemiFinishedItemOrLevelPath")} value={search} disabled={locked} onChange={event => setSearch(event.target.value)} />
      {scope && !search && <div className="bom-actions"><Button icon={ArrowLeft} disabled={locked} onClick={() => setScope(byPath.get(scope)?.parent_path || '')}>{pt("production.backToParent2")}</Button><span className="stage-path">{pathLabel(byPath.get(scope))}</span></div>}
      {!visible.length && <p className="bom-hint">{pt("production.noMatchingProductionLevels")}</p>}
      {visible.map(item => <article className="stage-row" key={item.path}>
        <div className="stage-row-heading"><div><strong>{item.name}</strong><p className="stage-path">{item.path ? pt("production.path", { v0: pathLabel(item), v1: item.path }) : pt("production.finalProduct")}</p></div><Badge tone={item.completed_quantity >= item.planned_quantity ? 'green' : item.completed_quantity ? 'blue' : 'gray'}>{item.completed_quantity >= item.planned_quantity ? pt("production.planReached") : item.completed_quantity ? pt("production.registered2") : pt("production.notRegistered")}</Badge></div>
        <dl className="stage-progress"><div><dt>{pt("production.planned")}</dt><dd>{count(item.planned_quantity)} {item.unit}</dd></div><div><dt>{pt("production.completed")}</dt><dd>{count(item.completed_quantity)} {item.unit}</dd></div>
          <div><dt>{pt("production.remainingPlan2")}</dt><dd>{count(Math.max(0, addQuantity(item.planned_quantity, -item.completed_quantity)))} {item.unit}</dd></div>
          {item.path !== '' && <><div><dt>{pt("production.suppliedToParent")}</dt><dd>{count(item.consumed_quantity)} {item.unit}</dd></div><div><dt>{pt("production.availableInOrder")}</dt><dd>{count(item.available_quantity)} {item.unit}</dd></div></>}
        </dl>
        <details><summary>{pt("production.viewCumulativeInputVariance")}</summary><p className="bom-hint">{pt("production.standardIsCalculatedOnceFromThisLevelS")}</p>
          {item.items.map(input => <div className="stage-cumulative-input" key={input.path}>
            <strong>{input.name}</strong><p>{pt("production.cumulativeActual")} {count(input.actual_quantity)} {input.unit} {pt("production.cumulativeStandard")} {input.standard_quantity == null ? pt("production.outsideCalculationRange") : `${count(input.standard_quantity)} ${input.unit}`}</p>
            {input.standard_quantity != null && <p>{pt("production.variance")} {count(addQuantity(input.actual_quantity, -input.standard_quantity))} {input.unit}</p>}
          </div>)}
        </details><div className="bom-actions">
          {canRegister && <Button kind="primary" disabled={locked} aria-label={pt("production.register4", { v0: item.name })} onClick={() => onRegister ? onRegister(JSON.stringify([item.path, null])) : begin(item)}>{pt("production.register")}</Button>}
          {order.operation_routes?.some(route => route.path === item.path) && <Button disabled={locked} onClick={() => setOperationPath(item.path)}>{pt('route.viewProgress')}</Button>}
          <Button disabled={locked} aria-label={pt("production.viewBatches", { v0: item.name })} onClick={() => { setHistory({ path: item.path, offset: 0 }); action.setError(''); }}>{pt("production.batchRecords")}</Button>
          {item.path !== scope && item.items.some(input => input.usage_mode === 'explode') && <Button disabled={locked} icon={ChevronRight} aria-label={pt("production.viewChildLevel", { v0: item.name })} onClick={() => { setScope(item.path); setSearch(''); }}>{pt("production.viewChildLevel2")}</Button>}
        </div>
      </article>)}{notices}
    </section>}
  </div>;
}
