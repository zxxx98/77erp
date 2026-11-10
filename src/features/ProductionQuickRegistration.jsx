import { ProductionAcceptanceRegistrations } from './ProductionAcceptanceRegistrations.jsx';
import { useOperationAcceptance } from './OperationAcceptance.jsx';
import { stageInputCanBeZero } from '../../shared/production-stages.js';
import { operationAllocation } from '../../shared/operation-overflow.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import { Button, Modal, PageHeading } from '../components/common.jsx';
import { Input, Radio } from '../ui/controls.jsx';
import { OperationWorkerSelect } from './ProductionOperations.jsx';
import { PostProcessingMaterialPreview } from './PostProcessingMaterialPreview.jsx';
import { ScrapOutputs } from './ScrapOutputs.jsx';
import { usePermissions } from '../permissions.jsx';
import { useBusiness } from '../business-api.js';
import { api } from '../api.js';
import { t, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { productionMessage } from '../i18n/production-errors.js';
import { outputRegistrationLocked, registrationDefaults, registrationTargets } from '../production-registration.js';
import { parseExactQuantity as parseQuantity, exactQuantity, exactCompare, formatExactQuantity } from '../../shared/exact-quantity.js';
import { validateProductionCompletion, productionMaterialAnalysis } from '../../shared/production.js';
import { MaterialVariance } from './MaterialVariance.jsx';
import { scrapExpectedQuantity, validateScrapActuals } from '../../shared/scrap.js';
import './production-registration.css';

const count = value => formatExactQuantity(value, getFormatLocale());
const itemKey = (order, item) => order.stage_workflow ? item.path : item.product_id;

function OperationName({ target, compact = false }) {
  return <span className="registration-operation-name"><strong>{target.name}</strong>
    {!compact && (target.context || target.showPath || target.showStep) && <small>{[
      target.context,
      target.showPath && t('registration.layer', { path: target.path || t('production.finalProduct') }),
      target.showStep && t('registration.step', { step: target.step }),
    ].filter(Boolean).join(' · ')}</small>}
  </span>;
}

export function ProductionQuickRegistration({ order, data, initialTargetId, onSaved, onBack, onActivity, presentation = 'page' }) {
  useLocale();
  const drawer = presentation === 'drawer';
  const { user, can } = usePermissions();
  const action = useBusiness();
  const acceptance=useOperationAcceptance();
  const targets = useMemo(() => registrationTargets(order), [order]);
  const [selectedId, setSelectedId] = useState(() => {
    const initial = targets.find(row => row.id === initialTargetId || row.layer.pool_paths?.some(path => JSON.stringify([path, row.node?.id ?? null]) === initialTargetId));
    return initial?.id ?? (targets.length === 1 ? targets[0].id : '');
  });
  const [quantity, setQuantity] = useState(''), [note, setNote] = useState('');
  const [workerId, setWorkerId] = useState(user.id);
  const [overrides, setOverrides] = useState({ items: {}, scraps: {} });
  const [picker, setPicker] = useState(false), [search, setSearch] = useState('');
  const [message, setMessage] = useState(''), [expanded, setExpanded] = useState(false);
  const target = targets.find(row => row.id === selectedId);
  const registerable = order.status === 'in_progress' || !order.material_workflow && order.status === 'draft';
  const outputLocked = outputRegistrationLocked(order, target);
  const dirty = !!quantity || !!note || Object.keys(overrides.items).length > 0 || Object.keys(overrides.scraps).length > 0;
  const guard = useRef({}); guard.current = { dirty, busy: action.busy };
  useEffect(() => {
    const before = event => { if (guard.current.busy || guard.current.dirty && !window.confirm(t('route.unsaved'))) event.preventDefault(); };
    const unload = event => { if (guard.current.dirty || guard.current.busy) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('erp:before-navigate', before); window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('erp:before-navigate', before); window.removeEventListener('beforeunload', unload); };
  }, []);
  useEffect(() => { onActivity?.({ selectedId, quantity, note, overrides, workerId, busy: action.busy }); }, [selectedId, quantity, note, overrides, workerId, action.busy, onActivity]);
  useEffect(() => () => onActivity?.(null), [onActivity]);
  const leave = fn => { if (!action.busy && (!dirty || window.confirm(t('route.unsaved')))) { action.setError(''); fn(); } };
  const clear = () => { setQuantity(''); setNote(''); setOverrides({ items: {}, scraps: {} }); setExpanded(false); };
  const select = row => { setSelectedId(row.id); clear(); setMessage(''); action.setError(''); setPicker(false); };

  let defaults = { items: [], scraps: [] }, defaultsError = '', allocations = [];
  const sourceFor = row => order.stage_workflow ? order.stages.flatMap(stage=>stage.items).find(item => item.path === row.path) : target.layer.items.find(item => item.product_id === row.product_id);
  let outputQuantity;
  if (target && quantity.trim()) {
    try {
      outputQuantity = parseQuantity(quantity, true);
      if (target.postProcessing && !Number.isInteger(outputQuantity)) throw new Error(t('production.postProcessingInteger'));
      if (target.layer.unit_round_up && !Number.isInteger(outputQuantity)) throw new Error(t('registration.wholeQuantity'));
      allocations = target.node && !target.postProcessing ? operationAllocation(order, target.path, target.node.id, outputQuantity) : [];
      defaults = registrationDefaults(order, target, outputQuantity);
      if (target.output && allocations.length) defaults.items = allocations.flatMap(part => registrationDefaults(order, { ...target, path: part.path, layer: part.layer }, part.quantity).items);
    } catch (error) { defaultsError = error.message; }
  }
  const items = defaults.items.map(row => ({ ...row, ...overrides.items[itemKey(order, row)] }));
  const scraps = defaults.scraps.map(row => ({ ...row, ...overrides.scraps[row.product_id] }));
  const patchItem = (key, patch) => { setOverrides(previous => ({ ...previous, items: { ...previous.items, [key]: { ...previous.items[key], ...patch } } })); action.setError(''); };
  const patchScrap = (id, patch) => { setOverrides(previous => ({ ...previous, scraps: { ...previous.scraps, [id]: { ...previous.scraps[id], ...patch } } })); action.setError(''); };
  const scrapRows = scraps.map(row => {
    const source = order.scraps.find(item => item.product_id === row.product_id);
    let expected_quantity = null;
    try { expected_quantity = scrapExpectedQuantity(source, outputQuantity, order.base_quantity,
      items.map(item => ({ product_id: item.product_id, quantity: parseQuantity(item.quantity) })), order.quantity_decimals); } catch { /* Invalid drafts remain editable. */ }
    return { ...source, disposition: row.disposition, actual: row.quantity, expected_quantity };
  });
  const submit = event => {
    event.preventDefault();
    action.run(async () => {
      if (!target) throw new Error(t('registration.chooseOperation'));
      if (!registerable) throw new Error(t('registration.closed'));
      if (outputLocked) throw new Error(t('production.outputRegistrationLocked'));
      if (defaultsError) { if (target.output) setExpanded(true); throw new Error(defaultsError); }
      const value = parseQuantity(quantity, true);
      if (!allocations.length && target.node?.available_quantity != null && exactCompare(value, exactQuantity(target.node, 'available_quantity')) > 0) throw new Error(t('registration.exceedsAvailable'));
      let suffix, body;
      const operation = target.node ? { operation_node_id: target.node.id, worker_id: workerId } : {};
      if (!target.output) {
        suffix = '/operations/report'; body = { path: target.path, ...operation, quantity: value, note, auto_overflow: !target.postProcessing };
      } else {
        const actuals = items.map(row => {
          const source = sourceFor(row);
          return { ...row, quantity: parseQuantity(row.quantity, order.stage_workflow && !stageInputCanBeZero(source, order.stages.find(stage => stage.path === source.parent_path).items)) };
        });
        const actualScraps = scraps.map(row => ({ ...row, quantity: parseQuantity(row.quantity) }));
        body = { ...operation, completed_quantity: value, items: actuals, scraps: actualScraps, note, finish_order: false };
        if (order.stage_workflow) {
          suffix = '/stages/complete'; body.path = target.path;
          if (target.node) {
            body.auto_overflow = true;
            body.allocations = allocations.map(part => ({ path: part.path, quantity: part.quantity,
              items: actuals.filter(item => part.layer.items.some(source => source.path === item.path)) }));
          }
          if (!actuals.some(item => exactCompare(item.quantity, 0) > 0)) throw new Error(t('production.actualInputForAtLeastOneMaterialMust'));
        } else { suffix = '/complete'; validateProductionCompletion(body, order.items.filter(item => !item.is_post_processing_only)); }
        validateScrapActuals(actualScraps, target.path ? [] : order.scraps || []);
      }
      try {
        const result = await action.send(`/production-orders/${order.id}${suffix}`, {
          schema_version: 2, stage_schema_version: 1, operation_schema_version: 1, version: order.version, ...await acceptance.enrich(`/production-orders/${order.id}${suffix}`,body,{warehouseId:data.warehouse_id}),
        }, { warehouseId: data.warehouse_id });
        clear();
        const notice = result.registration_status==='pending' ? t('route.pendingSaved') : t(drawer ? 'registration.savedDrawer' : 'registration.saved', { name: target.name, quantity: count(value), unit: target.unit });
        setMessage(notice);
        await onSaved(result, notice);
      } catch (error) { if (target.output) setExpanded(true); throw error; }
    });
  };
  const choices = rows => <div className="registration-operations" role="group" aria-label={t('registration.chooseOperation')}>
    {rows.map(row => <div key={row.id} className="registration-option-row"><Radio className="registration-operation" checked={selectedId === row.id} name={`registration-${order.id}`}
      disabled={action.busy || !registerable || outputRegistrationLocked(order, row)} onChange={() => select(row)}>
      <span className="registration-option-content"><OperationName target={row} /><span className={`registration-option-quantity${row.node?.available_quantity > 0 ? ' is-available' : ''}`}>{row.node?.available_quantity != null
        ? t('registration.available', { quantity: count(row.node.available_quantity), unit: row.unit })
        : t('registration.completed', { quantity: count(row.node?.completed_quantity ?? row.layer.completed_quantity ?? 0), unit: row.unit })}</span></span>
    </Radio></div>)}
  </div>;
  const filteredTargets = targets.filter(row => `${row.name} ${row.context} ${row.routeName} ${row.bomName} ${row.path}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const pickerContent = <>
    <Input type="search" aria-label={t('registration.search')} placeholder={t('registration.search')} value={search} onChange={event => setSearch(event.target.value)} />
    {choices(filteredTargets)}
    {!filteredTargets.length && <p className="bom-hint" role="status">{t('registration.noMatches')}</p>}
  </>;
  const reload = <details className="production-disclosure registration-tools-disclosure" open={!!action.error}><summary><span>{t('production.registrationTools')}</span><ChevronDown className="registration-details-chevron" size={14} aria-hidden="true" /></summary><div className="registration-tools-body"><Button className="registration-reload" disabled={action.busy} onClick={() => leave(() => action.run(async () => {
    const latest = await api(`/production-orders/${order.id}`, { warehouseId: data.warehouse_id });
    clear(); setMessage(''); await onSaved(latest);
  }))}>{t('production.reloadProductionOrder')}</Button></div></details>;
  const form = <form onSubmit={submit} className="registration-form">
    <div className={drawer ? 'form-body registration-drawer-body' : undefined}>
      <div className="registration-workspace-grid">
        <section className="panel bom-section registration-step-block">
          <div className="bom-section-heading registration-section-head">
            <h2>{t('registration.chooseOperation')}</h2>
          </div>
          {targets.length <= 6 ? choices(targets) : <Button className="registration-picker-trigger" title={drawer ? target?.name : undefined} aria-expanded={picker} disabled={action.busy || !registerable} onClick={() => { setSearch(''); setPicker(value => !value); }}>
            {target ? <OperationName target={target} compact={drawer} /> : t('registration.chooseOperation')}<ChevronDown size={18} aria-hidden="true" />
          </Button>}
          {picker && (drawer ? <div className="registration-inline-picker">{pickerContent}</div> : <Modal title={t('registration.chooseOperation')} className="registration-picker-modal" onClose={() => setPicker(false)}>
            <div className="form-body">{pickerContent}</div>
          </Modal>)}
          {drawer && target && <div className="registration-drawer-context">
            <p>{[target.bomName, target.routeName, !target.postProcessing && t('registration.layer', { path: target.path || t('production.finalProduct') })].filter(Boolean).join(' / ')}</p>
            <div className="registration-drawer-quantities">
              {target.node?.available_quantity != null && <strong>{t('registration.available', { quantity: count(exactQuantity(target.node, 'available_quantity')), unit: target.unit })}</strong>}
              <span>{t('registration.completed', { quantity: count(exactQuantity(target.node || target.layer, 'completed_quantity')), unit: target.unit })}</span>
            </div>
            {target.node?.note && <p className="registration-operation-note">{target.node.note}</p>}
          </div>}
        </section>
        <section className="panel bom-section registration-quantity-block">
          {!drawer && <div className="bom-section-heading registration-section-head">
            <h2>{t('registration.quantity')}</h2>
            {target && <span className="bom-hint registration-selected-target">{target.name}</span>}
          </div>}
          <label className="registration-quantity-label">{t('registration.quantity')}{target && `（${target.unit}）`}
            <Input aria-label={t('registration.quantity')} inputMode={target?.postProcessing ? 'numeric' : 'text'} value={quantity} placeholder={t('registration.enterQuantity')}
              disabled={action.busy || !target || !registerable || outputLocked} onChange={event => { setQuantity(event.target.value); setMessage(''); action.setError(''); }} />
          </label>
          <div className="registration-context-box">
            <p className="bom-hint registration-meta-line">{!drawer && target?.node?.available_quantity != null && `${t('registration.available', { quantity: count(exactQuantity(target.node, 'available_quantity')), unit: target.unit })} · `}{t('registration.worker', { name: workerId === user.id ? t('route.self') : `#${workerId}` })}</p>
            <p className="bom-hint">{t(target?.postProcessing ? 'production.postProcessingInteger' : 'production.fractionRegistrationHint')}</p>
            {outputLocked && <p className="bom-warning">{t('production.outputRegistrationLocked')}</p>}
            {target?.output && <p className="bom-hint">{t('registration.standardUsage')}{!target.path && ` ${t('registration.pendingReceipt')}`}</p>}
            {target?.layer.pool_paths && <p className="bom-hint">{t('production.poolHint')}</p>}
          </div>
          {target?.postProcessing && <PostProcessingMaterialPreview materials={target.node.materials} items={order.items} runs={outputQuantity} />}
          {target?.layer.pool_paths && <label className="registration-pool-note">{t('production.poolBatchNote')}<Input.TextArea aria-label={t('production.poolBatchNote')} maxLength={500} rows={2} value={note} disabled={action.busy} onChange={event => { setNote(event.target.value); action.setError(''); }} /></label>}
          {(allocations.length > 1 || allocations.length === 1 && allocations[0].path !== target.path) && <div className="registration-allocation" role="status"><p className="bom-hint">{t('registration.overflowHint')}</p><ul>{allocations.map(part => <li key={part.path}>{part.layer.name} · {t('registration.layer', { path: part.path || t('production.finalProduct') })}: {count(part.quantity)} {target.unit}</li>)}</ul></div>}
        </section>
      </div>
      {!registerable && <p className="bom-warning registration-closed-warning" role="status">{t('registration.closed')}</p>}
      <details className="panel bom-section registration-details" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
        <summary><span>{t('registration.more')}</span><ChevronDown className="registration-details-chevron" size={16} aria-hidden="true" /></summary>
        <div className="registration-details-body">
          <div className="registration-details-meta">
            {!drawer && target && <p className="bom-hint registration-source">{[target.bomName, target.routeName, target.name, target.postProcessing ? t('production.postProcessing') : t('registration.layer', { path: target.path || t('production.finalProduct') })].filter(Boolean).join(' / ')}</p>}
            {can('production') && target?.node && <OperationWorkerSelect order={order} warehouseId={data.warehouse_id} value={workerId} onChange={setWorkerId} disabled={action.busy} />}
          </div>
          {!drawer && target?.node?.note && <p className="production-note registration-operation-note">{target.node.note}</p>}
          {target?.output && <div className="registration-output-materials">
            <div className="registration-materials-header">
              <h3>{t('production.verifyInputsForThisLevel')}</h3>
              <Button disabled={action.busy || !quantity} onClick={() => setOverrides({ items: {}, scraps: {} })}>{t('production.fillUsageFromThisBatchSOutput')}</Button>
            </div>
            {defaultsError && <p className="bom-warning">{productionMessage(defaultsError)}</p>}
            {!quantity && <p className="bom-hint">{t('registration.enterQuantity')}</p>}
            <div className="registration-materials-list">
              {items.map(row => {
                const key = itemKey(order, row), source = sourceFor(row);
                return <div className="registration-material" key={key}>
                  <div className="registration-material-head">
                    <div className="registration-material-title">
                      <strong>{source.name}</strong>
                      {!!order.stage_workflow && <small className="bom-hint">{source.is_supplemental_input ? t('production.supplementalInput') : t('registration.layer', { path: source.path })} · {t(source.usage_mode === 'explode' ? 'production.supplyProduce' : 'production.supplyStock')}</small>}
                    </div>
                    {source.available_quantity != null && <p className="bom-hint registration-available-pill">{t('production.available')} {count(exactQuantity(source, 'available_quantity'))} {source.unit}</p>}
                  </div>
                  <label>{t('production.actualUsage')}{source.unit}）<Input aria-label={t('production.actualUsage2', { v0: source.is_supplemental_input ? `${source.name}（${t('production.supplementalInput')}）` : source.name })} inputMode="text" disabled={action.busy} value={row.quantity} onChange={event => patchItem(key, { quantity: event.target.value })} /></label>
                  {order.stage_workflow
                    ? <label>{t('production.usageVarianceReason2')}<Input.TextArea rows={2} aria-label={t('production.usageVarianceReason', { v0: source.is_supplemental_input ? `${source.name}（${t('production.supplementalInput')}）` : source.name })} maxLength={500} disabled={action.busy} value={row.variance_reason} onChange={event => patchItem(key, { variance_reason: event.target.value })} /></label>
                    : <MaterialVariance row={{ ...source, ...row }} analysis={productionMaterialAnalysis(source, outputQuantity, order.base_quantity, row.quantity, order.loss_method, order.snapshot_format === 2 ? order.nodes : undefined, order.quantity_decimals)} complete disabled={action.busy} onReason={(_, variance_reason) => patchItem(key, { variance_reason })} />}
                </div>;
              })}
            </div>
            <ScrapOutputs rows={scrapRows} materials={target.layer.items} complete disabled={action.busy} onChange={patchScrap} />
          </div>}
          {!target?.layer.pool_paths && <label className="registration-batch-note">{t('production.batchNote')}<Input.TextArea aria-label={t('production.batchNote')} maxLength={500} rows={2} value={note} disabled={action.busy} onChange={event => { setNote(event.target.value); action.setError(''); }} /></label>}
        </div>
      </details>
      {action.error && <p className="form-error" role="alert">{productionMessage(action.error)}</p>}
      {message && <p className="bom-success" role="status">{message}</p>}
      {drawer && reload}
    </div>
      <div className={drawer ? 'modal-footer registration-drawer-footer' : 'registration-footer-actions'}>
        {drawer ? <Button disabled={action.busy} onClick={() => leave(onBack)}>{t('production.cancel')}</Button> : reload}
        <Button type="submit" className="registration-submit" kind="primary" busy={action.busy} disabled={!target || !quantity.trim() || !registerable || outputLocked}>{t('registration.submit')}</Button>
      </div>
    </form>;
  if (drawer) return <Modal presentation="drawer" className="production-registration-drawer" title={t('production.productionRegistration')}
    subtitle={`${order.number} · ${order.product_name}`} onClose={() => leave(onBack)}>
    {form}<ProductionAcceptanceRegistrations order={order} data={data} onSaved={async(result,notice)=>{setMessage(notice);await onSaved(result,notice);}}/>{acceptance.dialog}
  </Modal>;
  return <div className="production-quick-registration">
    {acceptance.dialog}
    <PageHeading title={t('production.productionRegistration')} description={`${order.number} · ${order.product_name}`}>
      <Button icon={ArrowLeft} disabled={action.busy} onClick={() => leave(onBack)}>{t('production.backToOrderDetails')}</Button>
    </PageHeading>
    {form}<ProductionAcceptanceRegistrations order={order} data={data} onSaved={async(result,notice)=>{setMessage(notice);await onSaved(result,notice);}}/>
  </div>;
}
