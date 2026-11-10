import { useState } from 'react';
import { Button } from '../components/common.jsx';
import { Input } from '../ui/controls.jsx';
import { Select } from '../Dropdown.jsx';
import { useBusiness } from '../business-api.js';
import { usePermissions } from '../permissions.jsx';
import { t } from '../i18n/index.js';
import { productionMessage } from '../i18n/production-errors.js';
import { pooledProductionStages } from '../../shared/production-pools.js';
import { exactQuantity, formatExactQuantity, parseExactQuantity, quantityInput } from '../../shared/exact-quantity.js';
import { ProductionReceiptList } from './ProductionReceipts.jsx';

export function ProductionStageReceipts({ order, data, onSaved, busy, onApprove }) {
  const { can } = usePermissions(), action=useBusiness();
  const [path,setPath]=useState(''),[quantity,setQuantity]=useState(''),[voiding,setVoiding]=useState(null);
  const stages=pooledProductionStages(order).filter(s=>s.path!==''&&s.available_quantity>0);
  const selected=stages.find(s=>s.path===path), documents=order.receipt_documents.filter(d=>d.kind==='stage');
  const locked=busy||action.busy;
  const send=(suffix,body)=>action.send(`/production-orders/${order.id}/${suffix}`,{schema_version:2,stage_schema_version:1,version:order.version,...body},{warehouseId:data.warehouse_id});
  return <section className="panel bom-section" aria-label={t('production.stageReceiptTitle')}>
    <h2>{t('production.stageReceiptTitle')}</h2><p className="bom-hint">{t('production.stageReceiptHint')}</p>
    {order.status==='in_progress'&&<form onSubmit={event=>{event.preventDefault();action.run(async()=>{
      const result=await send('stage-receipts',{path,quantity:parseExactQuantity(quantity,true)});setQuantity('');setPath('');await onSaved(result,t('production.stageReceiptSubmitted'));
    });}}>
      <label>{t('production.stageReceiptProduct')}<Select aria-label={t('production.stageReceiptProduct')} value={path} disabled={locked} onChange={value=>{setPath(value);setQuantity('');}}>
        <option value="">{t('production.stageReceiptSelect')}</option>{stages.map(s=><option key={s.path} value={s.path}>{s.name} · {s.path} · {formatExactQuantity(exactQuantity(s,'available_quantity'))} {s.unit}</option>)}
      </Select></label>
      {selected&&<><p>{t('production.availableInOrder')} {formatExactQuantity(exactQuantity(selected,'available_quantity'))} {selected.unit}</p>
        <label>{t('production.stageReceiptQuantity')}<Input aria-label={t('production.stageReceiptQuantity')} inputMode="text" value={quantity} disabled={locked} onChange={event=>setQuantity(event.target.value)} /></label>
        <div className="bom-actions"><Button disabled={locked} onClick={()=>setQuantity(quantityInput(exactQuantity(selected,'available_quantity')))}>{t('production.stageReceiptAll')}</Button>
          <Button type="submit" kind="primary" disabled={locked||!quantity}>{t('production.stageReceiptSubmit')}</Button></div></>}
      {!stages.length&&<p className="bom-hint">{t('production.stageReceiptEmpty')}</p>}
    </form>}
    {onApprove&&can('stock_approve')&&documents.some(doc=>doc.status==='pending')&&<Button disabled={locked} onClick={onApprove}>{t('production.goToReceiptApproval')}</Button>}
    {documents.map(doc=><div key={doc.id}>
      <ProductionReceiptList documents={[doc]} busy={locked} />
      {doc.status!=='void'&&(doc.status==='pending'||can('corrections')&&can('purchase'))&&<Button disabled={locked} onClick={()=>setVoiding({id:doc.stage_receipt_id,reason:'',confirmed:doc.status==='confirmed'})}>{t(doc.status==='pending'?'production.stageReceiptCancel':'production.stageReceiptVoid')}</Button>}
      {voiding?.id===doc.stage_receipt_id&&<form onSubmit={event=>{event.preventDefault();action.run(async()=>{
        if(!window.confirm(t(voiding.confirmed?'production.stageReceiptVoidConfirm':'production.stageReceiptCancelConfirm')))return;
        const result=await send(`stage-receipts/${voiding.id}/void`,{reason:voiding.reason});setVoiding(null);await onSaved(result,t('production.stageReceiptVoided'));
      });}}><label>{t('production.voidReason')}<Input.TextArea aria-label={t('production.stageReceiptVoidReason')} value={voiding.reason} disabled={locked} maxLength={500} onChange={event=>setVoiding({...voiding,reason:event.target.value})} /></label>
        <div className="bom-actions"><Button disabled={locked} onClick={()=>setVoiding(null)}>{t('production.cancel')}</Button><Button kind="danger" type="submit" disabled={locked||!voiding.reason.trim()}>{t('production.stageReceiptVoidSave')}</Button></div>
      </form>}
    </div>)}
    {action.error&&<p className="form-error" role="alert">{productionMessage(action.error)}</p>}
  </section>;
}
