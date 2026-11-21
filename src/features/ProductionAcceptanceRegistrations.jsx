import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button, Badge } from '../components/common.jsx';
import { Input } from '../ui/controls.jsx';
import { usePermissions } from '../permissions.jsx';
import { useBusiness } from '../business-api.js';
import { useOperationAcceptance } from './OperationAcceptance.jsx';
import { t, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { productionUsesFraction } from '../../shared/production.js';
import { formatExactQuantity, registrationQuantityInput } from '../../shared/exact-quantity.js';
import './production-registration.css';

function RegistrationInputEditor({ inputs, draft, disabled, onChange, onSave, onCancel }) {
  const groups = new Map();
  const sourcesByName = new Map();
  inputs.forEach((item, index) => {
    const key = item.product_id == null ? `row:${index}` : `${item.part_index}:${item.product_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ item, index });
    if (item.source) {
      if (!sourcesByName.has(item.name)) sourcesByName.set(item.name, new Set());
      sourcesByName.get(item.name).add(item.source);
    }
  });
  const locale = getFormatLocale();
  const quantityLabel = t('production.registration.inputQuantity');
  const reasonLabel = t('production.registration.inputReason');
  const balances = [
    ['stock', t('production.registration.warehouseBalance')],
    ['self_produced_available', t('production.registration.selfProducedBalance')],
    ['issued_available', t('production.registration.issuedBalance')],
  ];
  return <section className="registration-input-editor" aria-label={t('production.registration.editInputs')}>
    <p className="bom-hint">{t('production.registration.inputsHint')}</p>
    <div className="registration-input-materials">
      {[...groups].map(([key, rows]) => {
        const { item: material } = rows[0];
        return <section key={key} className="registration-input-material" aria-label={[material.name, material.barcode].filter(Boolean).join(' · ')}>
          <header className="registration-input-material-header">
            <strong>{material.name}{material.barcode && <> <span className="registration-input-code">· {material.barcode}</span></>}</strong>
            <dl className="registration-input-balances">
              {balances.map(([field, label]) => <div key={field}>
                <dt>{label}</dt>
                <dd>{material[field] == null ? '—' : `${formatExactQuantity(material[field], locale)} ${material.unit}`}</dd>
              </div>)}
            </dl>
          </header>
          {rows.map(({ item, index }) => {
            const source = item.source && sourcesByName.get(item.name)?.size > 1
              ? t(item.source === 'production' ? 'production.registration.sourceProduction' : 'production.registration.sourceStock') : '';
            const position = item.path.startsWith('@stock:') ? item.stage_path : item.path;
            const identity = [item.barcode, source, position].filter(Boolean);
            const inputLabel = label => [item.name, label, ...identity].join(' ');
            return <div className="registration-input-row" key={`${item.part_index}:${item.item_index}`}>
              {(source || position) && <div className="registration-input-source">
                {source}{position && <span>{source && ' · '}{position}</span>}
              </div>}
              <label className="registration-input-quantity">{quantityLabel} ({item.unit})
                <Input aria-label={inputLabel(quantityLabel)} inputMode="text" disabled={disabled} value={draft[index].quantity}
                  onChange={event => onChange(index, { quantity: event.target.value })} />
              </label>
              <label>{reasonLabel}
                <Input aria-label={inputLabel(reasonLabel)} maxLength={500} disabled={disabled} value={draft[index].variance_reason}
                  onChange={event => onChange(index, { variance_reason: event.target.value })} />
              </label>
            </div>;
          })}
        </section>;
      })}
    </div>
    <div className="bom-actions">
      <Button kind="primary" disabled={disabled} onClick={onSave}>{t('production.registration.saveInputs')}</Button>
      <Button disabled={disabled} onClick={onCancel}>{t('production.registration.cancelInputs')}</Button>
    </div>
  </section>;
}

function registrationInputValue(order, item) {
  const node = order.nodes?.find(node => node.path === item.path);
  const fraction = node ? node.quantity_fraction : !order.stage_workflow && (order.items || []).some(row => (item.product_id != null ? row.product_id === item.product_id : row.name === item.name) && productionUsesFraction(order, row));
  return fraction ? String(item.quantity) : registrationQuantityInput(item.quantity);
}

const awaitsSettlement = row => row.status === 'pending' && (row.kind === 'settlement' || row.acceptance_id != null);
const registrationPriority = row => awaitsSettlement(row) ? 0 : row.status === 'pending' ? 1 : 2;

export function ProductionAcceptanceRegistrations({order,data,onSaved,path,pendingOnly=false}) {
  useLocale();
  const {can,user}=usePermissions(), action=useBusiness(), acceptance=useOperationAcceptance();
  const [editing,setEditing]=useState(null);
  const matchesPath = row => path === undefined || row.path === path;
  const scoped = (order.operation_registrations || []).filter(matchesPath);
  const counts = order.registration_counts?.filter(matchesPath).reduce((sum, row) => ({
    pending: sum.pending + row.pending, total: sum.total + row.total,
  }), { pending: 0, total: 0 }) ?? { pending: scoped.filter(row => row.status === 'pending').length, total: scoped.length };
  const rows = (pendingOnly ? scoped.filter(row => row.status === 'pending') : scoped).sort((a, b) =>
    registrationPriority(a) - registrationPriority(b) || (a.status === 'pending' ? a.id - b.id : b.id - a.id));
  if (!counts.total || (pendingOnly && !rows.length)) return null;
  const locale = getFormatLocale();
  const formatNumber = new Intl.NumberFormat(locale);
  const reconcile=()=>action.run(async()=>{
    const result=await action.send(`/production-orders/${order.id}/operations/registrations/reconcile`,{schema_version:2,stage_schema_version:1,operation_schema_version:1,version:order.version},{warehouseId:data.warehouse_id});
    await onSaved(result,t(result.pending_registration_count?'production.registration.stillPending':'production.registration.settled'));
    if(result.settlement_errors?.length) action.setError(result.settlement_errors.map(row=>row.error).join('\n'));
  });
  const resolve=(row,kind)=>action.run(async()=>{
    const endpoint=`/production-orders/${order.id}/operations/registrations/${row.id}/${kind}`;
    const body=kind==='approve'&&row.kind!=='settlement'&&row.acceptance_id==null?await acceptance.enrich(endpoint,{path:row.path,operation_node_id:row.node_id,quantity:row.quantity},{warehouseId:data.warehouse_id}):{};
    const result=await action.send(endpoint,{schema_version:2,stage_schema_version:1,operation_schema_version:1,version:order.version,...body},{warehouseId:data.warehouse_id});
    await onSaved(result,t(kind==='approve'?(row.kind==='settlement'?'production.registration.settled':'route.registrationPassed'):'route.registrationCancelled'));
  });
  const saveInputs=()=>action.run(async()=>{
    const items=editing.items.map(item=>({quantity:item.quantity === item.initialQuantity ? item.originalQuantity : item.quantity.includes('/')?item.quantity:item.quantity.trim()===''?null:Number(item.quantity),variance_reason:item.variance_reason}));
    const result=await action.send(`/production-orders/${order.id}/operations/registrations/${editing.id}/inputs`,{schema_version:2,stage_schema_version:1,operation_schema_version:1,version:editing.version,items},{warehouseId:data.warehouse_id});
    setEditing(null);
    await onSaved(result,t('production.registration.inputsSaved'));
  });
  return <section className="bom-section production-acceptance-registrations" aria-label={t('production.registration.pendingRecords')}>
    {acceptance.dialog}
    <header className="registration-records-header">
      <h2>{t('production.registration.pendingRecords')} <span className="registration-record-count" aria-live="polite">{t('production.registration.recordCounts', {
        pending: formatNumber.format(counts.pending), total: formatNumber.format(counts.total),
      })}</span></h2>
      {can('production') && rows.some(awaitsSettlement) && <Button disabled={action.busy} onClick={reconcile}>{t('production.registration.reconcileAll')}</Button>}
    </header>
    <p className="bom-hint">{t('production.registration.pendingHint')}</p>
    {(order.registration_issues||[]).map(issue=><p className="bom-hint" key={issue.key}>{t(`production.registration.issue.${issue.kind}`)} · {issue.name} · {t('production.registration.missing',{quantity:formatExactQuantity(issue.missing_quantity_fraction||issue.missing_quantity,getFormatLocale()),unit:issue.unit})}</p>)}
    {!pendingOnly && rows.length < counts.total && <p className="bom-hint">{t('production.registration.recordsShown', { shown: formatNumber.format(rows.length) })}</p>}
    {rows.length > 0 && <ol className="registration-records" role="list">
    {rows.map((row, index)=>{
      const route = order.operation_routes.find(route => route.path === row.path);
      const node = route?.operations.find(node => node.id === row.node_id);
      const stage = order.stages?.find(stage => stage.path === row.path);
      const settlement = awaitsSettlement(row);
      const status = row.status === 'pending' ? (settlement ? 'production.registration.unsettled' : 'route.acceptancePending')
        : row.status === 'approved' ? (row.kind === 'settlement' ? 'production.registration.settled' : 'route.registrationPassed') : 'route.registrationCancelled';
      return <li key={row.id}><details className="registration-record">
        <summary className="registration-record-summary">
          <ChevronRight size={16} aria-hidden="true" />
          <span className="registration-record-number">{formatNumber.format(index + 1)}</span>
          <span className="registration-record-title">
            <strong>{node?.name || stage?.name || order.product_name} · {formatExactQuantity(row.quantity, locale)} {route?.unit || stage?.unit || order.unit}</strong>
            <time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString(locale)}</time>
          </span>
          <Badge tone={row.status === 'pending' ? 'orange' : row.status === 'approved' ? 'green' : 'gray'}>{t(status)}</Badge>
        </summary>
        <div className="registration-record-body">
          <p>{stage?.name || order.product_name}{row.path&&` · ${row.path}`}</p>
          <p>{t('route.worker')}: {row.worker_name} · {t('route.recorder')}: {row.registered_by_name}</p>
          {row.resolved_by_name && <p>{t('production.registration.resolvedBy', { name: row.resolved_by_name })}</p>}
          {row.kind==='acceptance'&&row.acceptance_id!=null&&<p>{t('production.registration.inspected')}</p>}
          {row.note&&<p>{row.note}</p>}
          {!!row.actual_inputs?.length&&<details><summary>{t('production.registration.recordedInputs')}</summary>{row.actual_inputs.map(item=><p key={item.key}>{item.name} · {formatExactQuantity(item.quantity_fraction||item.quantity,getFormatLocale())} {item.unit}{item.path&&` · ${item.path}`}</p>)}</details>}
          {!!row.input_adjustments?.length&&<details><summary>{t('production.registration.inputHistory')}</summary>{row.input_adjustments.map((change,index)=><div key={index}><p>{new Date(change.at).toLocaleString(getFormatLocale())} · {change.by}</p>{change.items.map((item,itemIndex)=><p key={itemIndex}>{row.editable_inputs?.[itemIndex]?.name} · {String(change.previous[itemIndex].quantity)} → {String(item.quantity)} · {item.variance_reason}</p>)}</div>)}</details>}
          {editing?.id===row.id&&<RegistrationInputEditor inputs={row.editable_inputs} draft={editing.items} disabled={action.busy}
            onChange={(index, changes) => setEditing(previous => ({ ...previous, items: previous.items.map((item, i) => i === index ? { ...item, ...changes } : item) }))}
            onSave={saveInputs} onCancel={() => setEditing(null)} />}
          {!!row.initial_issues?.length&&<details><summary>{t('production.registration.originalIssues')}</summary>{row.initial_issues.map(issue=><p key={issue.key}>{issue.name} · {t('production.registration.missing',{quantity:formatExactQuantity(issue.missing_quantity_fraction||issue.missing_quantity,getFormatLocale()),unit:issue.unit})}</p>)}</details>}
          {row.issues?.map(issue=><p className="bom-hint" key={issue.key}>{t(`production.registration.issue.${issue.kind}`)} · {issue.name} · {t('production.registration.missing',{quantity:formatExactQuantity(issue.missing_quantity_fraction||issue.missing_quantity,getFormatLocale()),unit:issue.unit})}</p>)}
          {row.status==='pending'&&order.status!=='void'&&<div className="registration-record-actions bom-actions">
            {(settlement?can('production'):can('operation_accept'))&&<Button kind="primary" disabled={action.busy} onClick={()=>resolve(row,'approve')}>{t(settlement?'production.registration.reconcile':'route.inspectRegistration')}</Button>}
            {can('production')&&row.editable_inputs?.length>0&&<Button disabled={action.busy||editing?.id===row.id} onClick={()=>setEditing({id:row.id,version:order.version,items:row.editable_inputs.map(item=>({quantity:registrationInputValue(order,item),initialQuantity:registrationInputValue(order,item),originalQuantity:item.quantity,variance_reason:item.variance_reason}))})}>{t('production.registration.editInputs')}</Button>}
            {(row.registered_by===user.id||can('production')||can('operation_accept'))&&<Button disabled={action.busy} onClick={()=>resolve(row,'cancel')}>{t('route.cancelRegistration')}</Button>}
          </div>}
        </div>
      </details></li>;
    })}
    </ol>}
    {action.error&&<p role="alert" className="form-error">{action.error}</p>}
  </section>;
}
