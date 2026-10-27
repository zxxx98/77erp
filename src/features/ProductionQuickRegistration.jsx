import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import { Button, Modal, PageHeading } from '../components/common.jsx';
import { Input, Radio } from '../ui/controls.jsx';
import { OperationWorkerSelect } from './ProductionOperations.jsx';
import { ScrapOutputs } from './ScrapOutputs.jsx';
import { usePermissions } from '../permissions.jsx';
import { useBusiness } from '../business-api.js';
import { api } from '../api.js';
import { t, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { productionMessage } from '../i18n/production-errors.js';
import { registrationDefaults, registrationTargets } from '../production-registration.js';
import { materialQuantity, parseQuantity } from '../../shared/quantity.js';
import { validateProductionCompletion } from '../../shared/production.js';
import { scrapExpectedQuantity, validateScrapActuals } from '../../shared/scrap.js';
import './production-registration.css';

const count = value => Number(value).toLocaleString(getFormatLocale(), { maximumFractionDigits: 6 });
const itemKey = (order, item) => order.stage_workflow ? item.path : item.product_id;

function OperationName({ target }) {
  return <span className="registration-operation-name"><strong>{target.name}</strong>
    {(target.context || target.showPath || target.showStep) && <small>{[
      target.context,
      target.showPath && t('registration.layer', { path: target.path || t('production.finalProduct') }),
      target.showStep && t('registration.step', { step: target.step }),
    ].filter(Boolean).join(' · ')}</small>}
  </span>;
}

export function ProductionQuickRegistration({ order, data, onSaved, onBack, onActivity }) {
  useLocale();
  const { user, can } = usePermissions();
  const action = useBusiness();
  const targets = useMemo(() => registrationTargets(order), [order]);
  const [selectedId, setSelectedId] = useState(() => targets.length === 1 ? targets[0].id : '');
  const [quantity, setQuantity] = useState(''), [note, setNote] = useState('');
  const [workerId, setWorkerId] = useState(user.id);
  const [overrides, setOverrides] = useState({ items: {}, scraps: {} });
  const [picker, setPicker] = useState(false), [search, setSearch] = useState('');
  const [message, setMessage] = useState(''), [expanded, setExpanded] = useState(false);
  const target = targets.find(row => row.id === selectedId);
  const registerable = order.status === 'in_progress' || !order.material_workflow && order.status === 'draft';
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

  let defaults = { items: [], scraps: [] }, defaultsError = '';
  let outputQuantity;
  if (target && quantity.trim()) {
    try {
      outputQuantity = parseQuantity(quantity, true);
      if (target.layer.unit_round_up && !Number.isInteger(outputQuantity)) throw new Error(t('registration.wholeQuantity'));
      defaults = registrationDefaults(order, target, outputQuantity);
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
      if (defaultsError) { if (target.output) setExpanded(true); throw new Error(defaultsError); }
      const value = parseQuantity(quantity, true);
      if (target.node?.available_quantity != null && value > target.node.available_quantity) throw new Error(t('registration.exceedsAvailable'));
      let suffix, body;
      const operation = target.node ? { operation_node_id: target.node.id, worker_id: workerId } : {};
      if (!target.output) {
        suffix = '/operations/report'; body = { path: target.path, ...operation, quantity: value, note };
      } else {
        const actuals = items.map(row => {
          const source = target.layer.items.find(item => itemKey(order, item) === itemKey(order, row));
          return { ...row, quantity: materialQuantity(parseQuantity(row.quantity, order.stage_workflow && source.usage_mode === 'explode'), source) };
        });
        const actualScraps = scraps.map(row => ({ ...row, quantity: materialQuantity(parseQuantity(row.quantity), order.scraps.find(item => item.product_id === row.product_id)) }));
        body = { ...operation, completed_quantity: value, items: actuals, scraps: actualScraps, note, finish_order: false };
        if (order.stage_workflow) {
          suffix = '/stages/complete'; body.path = target.path;
          if (!actuals.some(item => item.quantity > 0)) throw new Error(t('production.actualInputForAtLeastOneMaterialMust'));
        } else { suffix = '/complete'; validateProductionCompletion(body, order.items); }
        validateScrapActuals(actualScraps, target.path ? [] : order.scraps || []);
      }
      try {
        const result = await action.send(`/production-orders/${order.id}${suffix}`, {
          schema_version: 2, stage_schema_version: 1, operation_schema_version: 1, version: order.version, ...body,
        }, { warehouseId: data.warehouse_id });
        clear();
        setMessage(t('registration.saved', { name: target.name, quantity: count(value), unit: target.unit }));
        await onSaved(result, target.output);
      } catch (error) { if (target.output) setExpanded(true); throw error; }
    });
  };
  const choices = rows => <div className="registration-operations" role="group" aria-label={t('registration.chooseOperation')}>
    {rows.map(row => <div key={row.id} className="registration-option-row"><Radio className="registration-operation" checked={selectedId === row.id} name={`registration-${order.id}`}
      disabled={action.busy || !registerable || row.node?.available_quantity === 0} onChange={() => select(row)}>
      <span className="registration-option-content"><OperationName target={row} /><span className="registration-option-quantity">{row.node?.available_quantity != null
        ? t('registration.available', { quantity: count(row.node.available_quantity), unit: row.unit })
        : t('registration.completed', { quantity: count(row.node?.completed_quantity ?? row.layer.completed_quantity ?? 0), unit: row.unit })}</span></span>
    </Radio></div>)}
  </div>;
  return <div className="production-quick-registration">
    <PageHeading title={t('production.productionRegistration')} description={`${order.number} · ${order.product_name}`}>
      <Button icon={ArrowLeft} disabled={action.busy} onClick={() => leave(onBack)}>{t('production.backToOrderDetails')}</Button>
    </PageHeading>
    <form onSubmit={submit} className="panel bom-section registration-form">
      <h2>{t('registration.chooseOperation')}</h2>
      {targets.length <= 6 ? choices(targets) : <Button className="registration-picker-trigger" disabled={action.busy || !registerable} onClick={() => { setSearch(''); setPicker(true); }}>
        {target ? <OperationName target={target} /> : t('registration.chooseOperation')}<ChevronDown size={18} />
      </Button>}
      {picker && <Modal title={t('registration.chooseOperation')} className="registration-picker-modal" onClose={() => setPicker(false)}>
        <div className="form-body"><Input type="search" aria-label={t('registration.search')} placeholder={t('registration.search')} value={search} onChange={event => setSearch(event.target.value)} />
          {choices(targets.filter(row => `${row.name} ${row.routeName} ${row.bomName} ${row.path}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())))}
        </div>
      </Modal>}
      <label className="registration-quantity-label">{t('registration.quantity')}{target && `（${target.unit}）`}
        <Input aria-label={t('registration.quantity')} inputMode="decimal" value={quantity} placeholder={t('registration.enterQuantity')}
          disabled={action.busy || !target || !registerable} onChange={event => { setQuantity(event.target.value); setMessage(''); action.setError(''); }} />
      </label>
      <p className="bom-hint">{target?.node?.available_quantity != null && `${t('registration.available', { quantity: count(target.node.available_quantity), unit: target.unit })} · `}{t('registration.worker', { name: workerId === user.id ? t('route.self') : `#${workerId}` })}</p>
      {target?.output && <p className="bom-hint">{t('registration.standardUsage')}{!target.path && ` ${t('registration.pendingReceipt')}`}</p>}
      {!registerable && <p className="bom-warning" role="status">{t('registration.closed')}</p>}
      <details className="registration-details" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
        <summary>{t('registration.more')}</summary>
        {target && <p className="bom-hint registration-source">{[target.bomName, target.routeName, target.name, t('registration.layer', { path: target.path || t('production.finalProduct') })].filter(Boolean).join(' / ')}</p>}
        {can('production') && target?.node && <OperationWorkerSelect order={order} warehouseId={data.warehouse_id} value={workerId} onChange={setWorkerId} disabled={action.busy} />}
        {target?.node?.note && <p className="production-note">{target.node.note}</p>}
        {target?.output && <>
          <h3>{t('production.verifyInputsForThisLevel')}</h3>
          {defaultsError && <p className="bom-warning">{productionMessage(defaultsError)}</p>}
          {!quantity && <p className="bom-hint">{t('registration.enterQuantity')}</p>}
          {items.map(row => {
            const key = itemKey(order, row), source = target.layer.items.find(item => itemKey(order, item) === key);
            return <div className="registration-material" key={key}>
              <strong>{source.name}</strong>
              {order.stage_workflow && <small className="bom-hint">{t('registration.layer', { path: source.path })}</small>}
              {source.available_quantity != null && <p className="bom-hint">{t('production.available')} {count(source.available_quantity)} {source.unit}</p>}
              <label>{t('production.actualUsage')}{source.unit}）<Input aria-label={t('production.actualUsage2', { v0: source.name })} inputMode="decimal" disabled={action.busy} value={row.quantity} onChange={event => patchItem(key, { quantity: event.target.value })} /></label>
              <label>{t('production.usageVarianceReason2')}<Input aria-label={t('production.usageVarianceReason', { v0: source.name })} maxLength={500} disabled={action.busy} value={row.variance_reason} onChange={event => patchItem(key, { variance_reason: event.target.value })} /></label>
            </div>;
          })}
          <Button disabled={action.busy || !quantity} onClick={() => setOverrides({ items: {}, scraps: {} })}>{t('production.fillUsageFromThisBatchSOutput')}</Button>
          <ScrapOutputs rows={scrapRows} materials={target.layer.items} complete disabled={action.busy} onChange={patchScrap} />
        </>}
        <label>{t('route.batchNote')}<Input.TextArea aria-label={t('route.batchNote')} maxLength={500} rows={2} value={note} disabled={action.busy} onChange={event => { setNote(event.target.value); action.setError(''); }} /></label>
      </details>
      {action.error && <p className="form-error" role="alert">{productionMessage(action.error)}</p>}
      {message && <p className="bom-success" role="status">{message}</p>}
      <Button type="submit" className="registration-submit" kind="primary" busy={action.busy} disabled={!target || !quantity.trim() || !registerable || target.node?.available_quantity === 0}>{t('registration.submit')}</Button>
      <Button className="registration-reload" disabled={action.busy} onClick={() => leave(() => action.run(async () => {
        const latest = await api(`/production-orders/${order.id}`, { warehouseId: data.warehouse_id });
        clear(); setMessage(''); await onSaved(latest, false);
      }))}>{t('production.reloadProductionOrder')}</Button>
    </form>
  </div>;
}
