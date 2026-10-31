import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Button, Modal } from '../components/common.jsx';
import { Checkbox } from '../ui/controls.jsx';
import { usePermissions } from '../permissions.jsx';
import { t } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { parseQualityFile } from '../quality-local.js';
import { QualityOnlineEditor } from '../pages/QualityOnlineEditor.jsx';
import { WorkbookResults } from '../pages/quality-shared.jsx';
import { needsQualityReview } from '../../shared/quality-checks.js';
import '../quality.css';

export function operationAcceptanceAllowed(node,can) {
  if(node?.acceptance_template_id && !can('operation_accept')) {
    window.alert(t('route.acceptancePermission'));
    return false;
  }
  return true;
}

// All registration forms use the same entry and submit the same server-validated
// cell values. Nothing is persisted until the enclosing production request commits.
export function useOperationAcceptance() {
  useLocale();
  const { can }=usePermissions();
  const [draft,setDraft]=useState(null), [busy,setBusy]=useState(false), [error,setError]=useState('');
  const pending=useRef(null), cached=useRef(null);
  useEffect(()=>()=>{pending.current?.reject(new Error(t('route.acceptanceCancelled')));pending.current=null;},[]);
  const close=()=>{if(busy)return;pending.current?.reject(new Error(t('route.acceptanceCancelled')));pending.current=null;setDraft(null);};
  const enrich=async(endpoint,body,options={})=>{
    if(!body.operation_node_id || !/\/(?:operations\/report|(?:stages\/)?complete)$/.test(endpoint))return body;
    const orderEndpoint=endpoint.replace(/\/(?:operations\/report|(?:stages\/)?complete)$/,'');
    const query=new URLSearchParams({path:body.path??'',node_id:body.operation_node_id});
    const data=await api(`${orderEndpoint}/operations/acceptance-template?${query}`,{warehouseId:options.warehouseId});
    if(!data.required)return body;
    if(!can('operation_accept')) {window.alert(t('route.acceptancePermission'));throw new Error(t('route.acceptancePermission'));}
    const key=JSON.stringify([orderEndpoint,options.warehouseId,body,data.template.template.revision_id]);
    let online=cached.current?.key===key?cached.current.online:null;
    if(!online){
      const sourceFile=new File([Uint8Array.from(atob(data.source_base64),char=>char.charCodeAt(0))],'验收模板.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const parsed=await parseQualityFile(sourceFile,data.template,[data.template.definition.sheetName],[],{});
      online={...parsed.online,template:data.template,sourceFile,workbook:parsed.workbook,issues:[]};
    }
    setError('');
    const acceptance=await new Promise((resolve,reject)=>{
      pending.current={resolve,reject};setDraft({key,online,context:`${data.context.number} · ${data.context.operation} · ${t('route.quantity')}: ${body.quantity??body.completed_quantity}`,validated:false,passed:false});
    });
    return {...body,operation_acceptance:acceptance};
  };
  const change=(address,value)=>setDraft(previous=>{
    const next={...previous,online:{...previous.online,values:{...previous.online.values,[address]:value},issues:[]},validated:false,passed:false,preview:null};
    cached.current={key:next.key,online:next.online};return next;
  });
  const validate=async()=>{
    if(busy)return;setBusy(true);setError('');
    try{
      const result=await parseQualityFile(draft.online.sourceFile,draft.online.template,[draft.online.template.definition.sheetName],[],{values:draft.online.values});
      setDraft(previous=>({...previous,online:{...previous.online,issues:result.preview.sheets.flatMap(s=>s.issues)},
        preview:result.preview,validated:!result.preview.issues.length&&!needsQualityReview(result.preview),passed:false}));
      if(result.preview.issues.length||needsQualityReview(result.preview))setError(t('route.acceptanceInvalid'));
    }catch(e){setError(e.message);}finally{setBusy(false);}
  };
  const dialog=draft&&<Modal title={t('route.acceptanceTitle')} wide className="operation-acceptance-modal" subtitle={`${draft.online.template.template.name} · v${draft.online.template.template.revision} · ${draft.context}`} onClose={close}>
    <div className="form-body" onSubmit={event=>{event.preventDefault();event.stopPropagation();}}>
      <QualityOnlineEditor online={draft.online} busy={busy} validated={draft.validated} onChange={change} onValidate={validate}/>
      {draft.preview&&<WorkbookResults definition={draft.online.template.definition} preview={draft.preview}/>}
      {error&&<p role="alert" className="form-error">{error}</p>}
      <Checkbox checked={draft.passed} disabled={!draft.validated||busy} onChange={event=>setDraft(previous=>({...previous,passed:event.target.checked}))}>{t('route.acceptancePassed')}</Checkbox>
      <p className="bom-hint">{t('route.acceptanceHint')}</p>
      <div className="bom-actions"><Button disabled={busy} onClick={close}>{t('route.cancel')}</Button><Button kind="primary" disabled={busy||!draft.validated||!draft.passed} onClick={()=>{
        const value={revision_id:draft.online.template.template.revision_id,values:draft.online.values,passed:true};
        cached.current={key:draft.key,online:draft.online};pending.current?.resolve(value);pending.current=null;setDraft(null);
      }}>{t('route.acceptanceSubmit')}</Button></div>
    </div>
  </Modal>;
  return {enrich,dialog};
}
