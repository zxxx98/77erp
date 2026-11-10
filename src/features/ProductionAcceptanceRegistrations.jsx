import { Button, Badge } from '../components/common.jsx';
import { usePermissions } from '../permissions.jsx';
import { useBusiness } from '../business-api.js';
import { useOperationAcceptance } from './OperationAcceptance.jsx';
import { t, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { formatExactQuantity } from '../../shared/exact-quantity.js';

export function ProductionAcceptanceRegistrations({order,data,onSaved,path}) {
  useLocale();
  const {can,user}=usePermissions(), action=useBusiness(), acceptance=useOperationAcceptance();
  const rows=(order.operation_registrations||[]).filter(row=>path===undefined||row.path===path);
  if(!rows.length) return null;
  const resolve=(row,kind)=>action.run(async()=>{
    const endpoint=`/production-orders/${order.id}/operations/registrations/${row.id}/${kind}`;
    const body=kind==='approve'?await acceptance.enrich(endpoint,{path:row.path,operation_node_id:row.node_id,quantity:row.quantity},{warehouseId:data.warehouse_id}):{};
    const result=await action.send(endpoint,{schema_version:2,stage_schema_version:1,operation_schema_version:1,version:order.version,...body},{warehouseId:data.warehouse_id});
    await onSaved(result,t(kind==='approve'?'route.registrationPassed':'route.registrationCancelled'));
  });
  return <section className="panel bom-section" aria-label={t('route.acceptanceRegistrations')}>
    {acceptance.dialog}<h2>{t('route.acceptanceRegistrations')}</h2>
    <p className="bom-hint">{t('route.pendingHint')}</p>
    {rows.map(row=>{
      const route=order.operation_routes.find(r=>r.path===row.path),node=route?.operations.find(n=>n.id===row.node_id);
      const status=row.status==='pending'?'route.acceptancePending':row.status==='approved'?'route.registrationPassed':'route.registrationCancelled';
      return <article className="process-operation process-history-card" key={row.id}>
        <div className="production-list-title"><strong>{node?.name||row.node_id} · {formatExactQuantity(row.quantity,getFormatLocale())} {route?.unit||order.stages?.find(s=>s.path===row.path)?.unit||order.unit}</strong><Badge tone={row.status==='pending'?'orange':row.status==='approved'?'green':'gray'}>{t(status)}</Badge></div>
        <p>{order.stages?.find(s=>s.path===row.path)?.name||order.product_name}{row.path&&` · ${row.path}`}</p>
        <p>{t('route.worker')}: {row.worker_name} · {t('route.recorder')}: {row.registered_by_name}</p>
        <p>{new Date(row.created_at).toLocaleString(getFormatLocale())}{row.resolved_by_name&&` · ${row.resolved_by_name}`}</p>
        {row.note&&<p>{row.note}</p>}
        {row.status==='pending'&&order.status!=='void'&&<div className="bom-actions">
          {can('operation_accept')&&<Button kind="primary" disabled={action.busy} onClick={()=>resolve(row,'approve')}>{t('route.inspectRegistration')}</Button>}
          {(row.registered_by===user.id||can('production')||can('operation_accept'))&&<Button disabled={action.busy} onClick={()=>resolve(row,'cancel')}>{t('route.cancelRegistration')}</Button>}
        </div>}
      </article>;
    })}
    {action.error&&<p role="alert" className="form-error">{action.error}</p>}
  </section>;
}
