import { Button, Badge } from '../components/common.jsx';
import { usePermissions } from '../permissions.jsx';
import { useBusiness } from '../business-api.js';
import { useOperationAcceptance } from './OperationAcceptance.jsx';
import { t, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { formatExactQuantity } from '../../shared/exact-quantity.js';
import './production-registration.css';

export function ProductionAcceptanceRegistrations({order,data,onSaved,path}) {
  useLocale();
  const {can,user}=usePermissions(), action=useBusiness(), acceptance=useOperationAcceptance();
  const rows=(order.operation_registrations||[]).filter(row=>path===undefined||row.path===path);
  if(!rows.length) return null;
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
  return <section className="panel bom-section production-acceptance-registrations" aria-label={t('production.registration.pendingRecords')}>
    {acceptance.dialog}<h2>{t('production.registration.pendingRecords')}</h2>
    <p className="bom-hint">{t('production.registration.pendingHint')}</p>
    {can('production')&&rows.some(row=>(row.kind==='settlement'||row.acceptance_id!=null)&&row.status==='pending')&&<Button disabled={action.busy} onClick={reconcile}>{t('production.registration.reconcileAll')}</Button>}
    {(order.registration_issues||[]).map(issue=><p className="bom-hint" key={issue.key}>{t(`production.registration.issue.${issue.kind}`)} · {issue.name} · {t('production.registration.missing',{quantity:formatExactQuantity(issue.missing_quantity_fraction||issue.missing_quantity,getFormatLocale()),unit:issue.unit})}</p>)}
    <div className="process-history-list">
    {rows.map(row=>{
      const route=order.operation_routes.find(r=>r.path===row.path),node=route?.operations.find(n=>n.id===row.node_id);
      const status=row.status==='pending'?(row.kind==='settlement'||row.acceptance_id!=null?'production.registration.unsettled':'route.acceptancePending'):row.status==='approved'?(row.kind==='settlement'?'production.registration.settled':'route.registrationPassed'):'route.registrationCancelled';
      return <article className="process-operation process-history-card" key={row.id}>
        <div className="process-history-main">
          <div className="production-list-title"><strong>{node?.name||order.stages?.find(s=>s.path===row.path)?.name||order.product_name} · {formatExactQuantity(row.quantity,getFormatLocale())} {route?.unit||order.stages?.find(s=>s.path===row.path)?.unit||order.unit}</strong><Badge tone={row.status==='pending'?'orange':row.status==='approved'?'green':'gray'}>{t(status)}</Badge></div>
          <p>{order.stages?.find(s=>s.path===row.path)?.name||order.product_name}{row.path&&` · ${row.path}`}</p>
          <p>{t('route.worker')}: {row.worker_name} · {t('route.recorder')}: {row.registered_by_name}</p>
          <p>{new Date(row.created_at).toLocaleString(getFormatLocale())}{row.resolved_by_name&&` · ${row.resolved_by_name}`}</p>
          {row.kind==='acceptance'&&row.acceptance_id!=null&&<p>{t('production.registration.inspected')}</p>}
          {row.note&&<p>{row.note}</p>}
          {!!row.actual_inputs?.length&&<details><summary>{t('production.registration.recordedInputs')}</summary>{row.actual_inputs.map(item=><p key={item.key}>{item.name} · {formatExactQuantity(item.quantity_fraction||item.quantity,getFormatLocale())} {item.unit}{item.path&&` · ${item.path}`}</p>)}</details>}
          {!!row.initial_issues?.length&&<details><summary>{t('production.registration.originalIssues')}</summary>{row.initial_issues.map(issue=><p key={issue.key}>{issue.name} · {t('production.registration.missing',{quantity:formatExactQuantity(issue.missing_quantity_fraction||issue.missing_quantity,getFormatLocale()),unit:issue.unit})}</p>)}</details>}
          {row.issues?.map(issue=><p className="bom-hint" key={issue.key}>{t(`production.registration.issue.${issue.kind}`)} · {issue.name} · {t('production.registration.missing',{quantity:formatExactQuantity(issue.missing_quantity_fraction||issue.missing_quantity,getFormatLocale()),unit:issue.unit})}</p>)}
        </div>
        {row.status==='pending'&&order.status!=='void'&&<div className="process-history-action bom-actions">
          {(row.kind==='settlement'||row.acceptance_id!=null?can('production'):can('operation_accept'))&&<Button kind="primary" disabled={action.busy} onClick={()=>resolve(row,'approve')}>{t(row.kind==='settlement'||row.acceptance_id!=null?'production.registration.reconcile':'route.inspectRegistration')}</Button>}
          {(row.registered_by===user.id||can('production')||can('operation_accept'))&&<Button disabled={action.busy} onClick={()=>resolve(row,'cancel')}>{t('route.cancelRegistration')}</Button>}
        </div>}
      </article>;
    })}
    </div>
    {action.error&&<p role="alert" className="form-error">{action.error}</p>}
  </section>;
}
