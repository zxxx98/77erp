import { productionMessage } from '../i18n/production-errors.js';
import { t as pt, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { Input as AntInput, Checkbox as AntCheckbox } from '../ui/controls.jsx';

import { acceptanceSheetResults } from '../../shared/quality-bindings.js';
import { parseQualityFile } from '../quality-local.js';
import { needsQualityReview } from '../../shared/quality-checks.js';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Download, FileSpreadsheet, Plus, Upload, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { Button, Modal, PageHeading } from '../components/common.jsx';
import { Select } from '../Dropdown.jsx';
import { cellAddress, containsCell, logicalRegion, parseRegion } from '../../shared/quality-template.js';
import { downloadExcel, fetchQualityExcel, WorkbookResults, QualityNavigation, qualityUid } from './quality-shared.jsx';
import { QualityMaterialBinding } from './QualityMaterialBinding.jsx';
import { QualityOnlineEditor } from './QualityOnlineEditor.jsx';

function SourceSheet({workbook,sheetName,region,corrections,issues,busy,onCorrect,onClose}) {
  useLocale();
  const [name,setName]=useState(sheetName);
  const [editingAddress,setAddress]=useState(()=>{const r=parseRegion(region||'A1');const sheet=workbook.sheets.find(s=>s.name===sheetName)||workbook.sheets[0];const cell=logicalRegion(sheet,r.r1,r.c1);return cellAddress(cell.r1,cell.c1);});
  const [value,setValue]=useState(''),[correctionError,setCorrectionError]=useState('');
  const selected=useMemo(()=>parseRegion(region||'A1'),[region]);
  const target=useRef(null);
  const sheet=workbook.sheets.find(s=>s.name===name)||workbook.sheets[0];
  const correctionMap=useMemo(()=>new Map(corrections.filter(c=>c.sheetName===sheet.name).map(c=>[c.address,c])),[corrections,sheet.name]);
  const correction=correctionMap.get(editingAddress);
  const original=sheet.cells[editingAddress]?.text||'';
  const current=correction?.text??original;
  useLayoutEffect(()=>{setValue(current);setCorrectionError('');},[sheet.name,editingAddress,current]);
  const submit=async restore=>{setCorrectionError('');try{await onCorrect(sheet.name,editingAddress,restore?original:value);}catch(e){setCorrectionError(e.message);}};
  const merged=useMemo(()=>{
    const map=new Map();
    for(const address of sheet.merges){const r=parseRegion(address);for(let row=r.r1;row<=r.r2;row++)for(let col=r.c1;col<=r.c2;col++)map.set(cellAddress(row,col),r);}
    return map;
  },[sheet]);
  useEffect(()=>{
    const cell=target.current,viewport=cell?.closest('.quality-source-sheet');
    if(!viewport)return;
    const bounds=cell.getBoundingClientRect(),container=viewport.getBoundingClientRect();
    viewport.scrollTop+=bounds.top-container.top-(viewport.clientHeight-bounds.height)/2;
    viewport.scrollLeft+=bounds.left-container.left-(viewport.clientWidth-bounds.width)/2;
  },[sheet,selected]);
  return <Modal title={pt("production.locateUploadedFileCells")} subtitle={`${sheetName} · ${region||'A1'}`} wide onClose={onClose}><div className="form-body">
    <label>{pt("production.worksheet2")}<Select aria-label={pt("production.worksheet2")} disabled={busy} value={sheet.name} onChange={e=>{setName(e);setAddress('A1');}}>{workbook.sheets.map(s=><option key={s.name}>{s.name}</option>)}</Select></label>
    <section className="quality-source-correction" aria-label={pt("production.correctCellManually")}>
      <h3>{sheet.name}!{editingAddress}{correction&&<span className="quality-manual-marker">{pt("production.manuallyCorrected")}</span>}</h3>
      <p className="muted">{pt("production.selectACellBelowToCorrectItParsing")}</p>
      <label>{pt("production.originalContent")}<pre>{original||pt("production.empty")}</pre></label>
      <label>{pt("production.correctionText")}<AntInput.TextArea aria-label={pt("production.correctionText")} value={value} maxLength={10000} rows={3} disabled={busy} onChange={e=>setValue(e.target.value)}/></label>
      {issues.filter(issue=>issue.sheetName===sheet.name).map((issue,i)=><p className="form-error" key={i}>{issue.region}：{productionMessage(issue.message)}</p>)}
      {correctionError&&<p role="alert" className="form-error">{productionMessage(correctionError)}</p>}
      <div className="quality-actions"><Button kind="primary" busy={busy} disabled={value===current} onClick={()=>submit(false)}>{pt("production.applyManualCorrection")}</Button>{correction&&<Button disabled={busy} onClick={()=>submit(true)}>{pt("production.restoreOriginalContent")}</Button>}</div>
    </section>
    <div className="quality-sheet-scroll quality-source-sheet"><table className="quality-grid"><colgroup><col style={{width:46}}/>{sheet.widths.map((width,i)=><col key={i} style={{width}}/>)}</colgroup><thead><tr><th>{pt("production.rowColumn")}</th>{sheet.widths.map((_,i)=><th key={i}>{cellAddress(1,i+1).slice(0,-1)}</th>)}</tr></thead><tbody>{Array.from({length:sheet.rows},(_,i)=><tr key={i}><th className="quality-row-number">{i+1}</th>{Array.from({length:sheet.cols},(_,j)=>{
      const row=i+1,col=j+1,address=cellAddress(row,col),r=merged.get(address)||{r1:row,c1:col,r2:row,c2:col};
      if(r.r1!==row||r.c1!==col)return null;
      const active=sheet.name===sheetName&&r.r1<=selected.r2&&r.r2>=selected.r1&&r.c1<=selected.c2&&r.c2>=selected.c1;
      const edited=correctionMap.get(address);
      return <td key={j} tabIndex={busy?-1:0} aria-label={pt("production.selectCell", { v0: address })} aria-selected={address===editingAddress} onClick={()=>{if(!busy)setAddress(address);}} onKeyDown={e=>{if(!busy&&['Enter',' '].includes(e.key)){e.preventDefault();setAddress(address);}}} ref={active&&containsCell(r,selected.r1,selected.c1)?target:undefined} className={`quality-cell${active?' quality-source-error':''}${address===editingAddress?' quality-source-selected':''}`} data-address={address} rowSpan={r.r2-r.r1+1} colSpan={r.c2-r.c1+1}>{edited?.text??sheet.cells[address]?.text??''}{edited&&<small className="quality-manual-marker">{pt("production.manuallyCorrected")}</small>}</td>;
    })}</tr>)}</tbody></table></div>
  </div></Modal>;
}

export function QualityAcceptances({data,onTemplates,onAreaChange}) {
  useLocale();
  const [templates,setTemplates]=useState([]),[list,setList]=useState([]),[total,setTotal]=useState(0),[q,setQ]=useState(''),[offset,setOffset]=useState(0),[refresh,setRefresh]=useState(0);
  const [draft,setDraft]=useState(null),[parsed,setParsed]=useState(null),[detail,setDetail]=useState(null),[source,setSource]=useState(null);
  const [bindings,setBindings]=useState([]);
  const [corrections,setCorrections]=useState([]);
  const [online,setOnline]=useState(null),[keepValues,setKeepValues]=useState(false);
  const [resultSheet,setResultSheet]=useState(null);
  useEffect(()=>{setResultSheet(null);setSource(null);},[draft?.file]);
  const [checksAcknowledged,setChecksAcknowledged]=useState(false);
  useEffect(()=>setChecksAcknowledged(false),[parsed]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const input=useRef(),lock=useRef(false),request=useRef(null);
  const interrupted=!!draft;
  useEffect(()=>{
    const unload=e=>{if(interrupted){e.preventDefault();e.returnValue='';}};
    const navigate=e=>{if(interrupted&&!window.confirm(pt("production.thisAcceptanceHasUnsavedChangesLeave")))e.preventDefault();};
    window.addEventListener('beforeunload',unload);window.addEventListener('erp:before-navigate',navigate);
    return()=>{window.removeEventListener('beforeunload',unload);window.removeEventListener('erp:before-navigate',navigate);};
  },[interrupted]);
  useEffect(()=>{
    let live=true;
    api('/quality/acceptance-templates').then(result=>{if(live)setTemplates(result.templates);}).catch(e=>{if(live)setError(e.message);});
    return()=>{live=false;};
  },[data,refresh]);
  useEffect(()=>{
    if(draft||detail)return;
    let live=true;
    const timer=setTimeout(()=>api(`/quality/acceptances?q=${encodeURIComponent(q)}&offset=${offset}`).then(result=>{if(live){setList(result.acceptances);setTotal(result.total);}}).catch(e=>{if(live)setError(e.message);}),150);
    return()=>{live=false;clearTimeout(timer);};
  },[q,offset,refresh,draft,detail,data]);
  const run=async fn=>{
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try{return await fn();}catch(e){setError(e.message);if(e.status===409){setParsed(null);setRefresh(v=>v+1);}}finally{lock.current=false;setBusy(false);}
  };
  const leave=fn=>{if(busy)return;if(draft&&!window.confirm(pt("production.thisAcceptanceHasUnsavedChangesLeave")))return;setDraft(null);setParsed(null);setDetail(null);setSource(null);setOnline(null);setError('');setMessage('');fn?.();};
  const start=(mode='upload')=>{const template=templates[0]||null;setDraft({mode,template,name:template?pt("production.acceptance", { v0: template.name }):'',note:'',file:null,workbook:null,sheetNames:[]});setParsed(null);setDetail(null);setOnline(null);setKeepValues(false);setError('');setMessage('');request.current=null;setCorrections([]);setBindings([]);};
  const loadOnline=()=>run(async()=>{
    const template=await api(`/quality/acceptance-templates/${draft.template.id}?revision_id=${draft.template.revision_id}`);
    const sourceFile=await fetchQualityExcel(`/templates/${draft.template.id}/revisions/${draft.template.revision_id}/download`);
    const result=await parseQualityFile(sourceFile,template,[template.definition.sheetName],[],{keepValues});
    setOnline({...result.online,template,sourceFile,workbook:result.workbook,issues:[]});
    setDraft(v=>({...v,file:null,workbook:null,sheetNames:[template.definition.sheetName]}));setParsed(null);setCorrections([]);setBindings([]);request.current=null;
  });
  const changeOnline=(address,value)=>{
    if(lock.current)return;
    setOnline(v=>({...v,values:{...v.values,[address]:value},issues:[]}));setParsed(null);setDraft(v=>({...v,file:null}));setCorrections([]);setChecksAcknowledged(false);setError('');request.current=null;
  };
  const validateOnline=()=>run(async()=>{
    // Recheck the active revision before generating a file or suggesting materials.
    const template=await api(`/quality/acceptance-templates/${draft.template.id}?revision_id=${draft.template.revision_id}`);
    const filename=`${draft.name.trim().replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,100)||pt("production.fillAcceptanceOnline")}.xlsx`;
    const result=await parseQualityFile(online.sourceFile,template,[template.definition.sheetName],[],{values:online.values,filename});
    const suggestions=await api('/quality/binding-suggestions',{method:'POST',body:{keys:result.keys}});
    setBindings(suggestions.bindings.map(binding=>{
      const previous=bindings.find(item=>item.sheetName===binding.sheetName);
      return {...binding,enabled:previous?.enabled??true,...(previous?.mode==='manual'?{mode:'manual',product_id:previous.product_id,product:previous.product}:{})};
    }));
    setOnline(v=>({...v,issues:result.preview.issues}));setParsed({...result,localId:qualityUid()});
    setDraft(v=>({...v,file:result.file,workbook:result.workbook,sheetNames:result.sheet_names}));setChecksAcknowledged(false);request.current=null;
  });
  const parse=async file=>{
    if(!draft.template)return;
    setCorrections([]);setDraft(v=>({...v,file,workbook:null,sheetNames:[]}));setParsed(null);setBindings([]);setChecksAcknowledged(false);request.current=null;
    await run(async()=>{
      const template=await api(`/quality/acceptance-templates/${draft.template.id}?revision_id=${draft.template.revision_id}`);
      const result=await parseQualityFile(file,template);
      const {bindings}=await api('/quality/binding-suggestions',{method:'POST',body:{keys:result.keys}});
      setParsed({...result,localId:qualityUid()});setBindings(bindings.map(binding=>({...binding,enabled:true})));setDraft(v=>({...v,workbook:result.workbook,sheetNames:result.sheet_names}));
    });
  };
  const correct=async(sheetName,address,text)=>{
    if(lock.current)return;
    lock.current=true;setBusy(true);setError('');
    try {
      const next=corrections.filter(c=>c.sheetName!==sheetName||c.address!==address);
      if(text!==(parsed.workbook.sheets.find(s=>s.name===sheetName).cells[address]?.text||''))next.push({sheetName,address,text});
      const template=await api(`/quality/acceptance-templates/${draft.template.id}?revision_id=${draft.template.revision_id}`);
      const result=await parseQualityFile(draft.file,template,undefined,next);
      const suggestions=await api('/quality/binding-suggestions',{method:'POST',body:{keys:result.keys.filter(key=>key.sheetName===sheetName)}});
      setBindings(values=>values.map(binding=>{
        const suggestion=suggestions.bindings.find(s=>s.sheetName===binding.sheetName);
        return suggestion?{...suggestion,enabled:binding.enabled,...(binding.mode==='manual'?{mode:'manual',product_id:binding.product_id,product:binding.product}:{})}:binding;
      }));
      setCorrections(next);setParsed({...result,localId:qualityUid()});setChecksAcknowledged(false);request.current=null;
    } finally {lock.current=false;setBusy(false);}
  };
  const selectSheets=names=>{setDraft(v=>({...v,sheetNames:names}));setChecksAcknowledged(false);setError('');};
  const selectedNames=draft?.sheetNames||[];
  const activeBindings=draft?bindings.filter(binding=>selectedNames.includes(binding.sheetName)):bindings;
  const save=()=>run(async()=>{
    const sheetNames=selectedNames;
    const choices=activeBindings.map(binding=>({sheetName:binding.sheetName,mode:binding.enabled?binding.mode:'none',product_id:binding.enabled?binding.product_id:null}));
    const selectedCorrections=corrections.filter(c=>sheetNames.includes(c.sheetName));
    const fingerprint=JSON.stringify([draft.name,draft.note,parsed.localId,sheetNames,choices,checksAcknowledged,selectedCorrections]);
    if(request.current?.fingerprint!==fingerprint)request.current={fingerprint,id:qualityUid()};
    const body=new FormData();body.append('file',draft.file);body.append('template_id',parsed.template.id);body.append('revision_id',parsed.template.revision_id);
    body.append('name',draft.name);body.append('note',draft.note);body.append('request_id',request.current.id);body.append('sheet_names',JSON.stringify(sheetNames));
    body.append('bindings',JSON.stringify(choices));
    if(selectedCorrections.length)body.append('corrections',JSON.stringify(selectedCorrections));
    if(checksAcknowledged)body.append('checks_acknowledged','true');
    const saved=await api('/quality/acceptances',{method:'POST',body});
    setDetail(saved);setDraft(null);setParsed(null);setOnline(null);setRefresh(v=>v+1);setMessage(pt("production.acceptanceSavedWithParsedDataTemplateVersionAnd"));
  });
  const remove=row=>{
    if(!window.confirm(pt("production.deleteAcceptanceItCannotBeRestoredFromThis", { v0: row.name, v1: row.number })))return;
    void run(async()=>{
      await api(`/quality/acceptances/${row.id}`,{method:'DELETE',body:{}});
      setDetail(null);setSource(null);setOffset(value=>Math.max(0,value-(list.length===1?20:0)));setRefresh(value=>value+1);setMessage(pt("production.acceptanceDeleted"));
    });
  };
  const preview=useMemo(()=>{
    const source=draft?parsed?.preview:detail?.result;
    if(!source||!draft)return source;
    const selected=new Set(draft.sheetNames||[]);
    const selectedSheets=(source.sheets||[]).filter(sheet=>selected.has(sheet.sheetName));
    return {...source,sheets:selectedSheets,value:Object.fromEntries(selectedSheets.map(sheet=>[sheet.sheetName,sheet.value])),
      issues:selectedSheets.flatMap(sheet=>sheet.issues.map(issue=>({...issue,sheetName:sheet.sheetName})))};
  },[draft,parsed,detail]);
  const definition=draft?parsed?.definition:detail?.definition;
  const sheets=preview?acceptanceSheetResults(definition,preview):[];
  const selectedSheet=draft&&sheets.find(sheet=>sheet.sheetName===resultSheet);
  const reviewNeeded=needsQualityReview(preview);
  const noSheets=!!draft&&!selectedNames.length;
  const pendingBindings=!!parsed&&activeBindings.some(binding=>binding.enabled&&!binding.product_id);
  const isOnline=draft?.mode==='online';
  const title=draft?(isOnline?pt("production.newOnlineAcceptance"):pt("production.importAcceptance")):detail?pt("production.acceptanceDetails"):pt("production.acceptances");
  return <section className="quality-page">
    <QualityNavigation area="acceptances" disabled={busy} onChange={area=>{if(area==='templates')leave(onTemplates);else if(area==='charts')leave(()=>onAreaChange('charts'));}}/>
    <PageHeading title={title} description={draft?(isOnline?pt("production.selectATemplateFillInOnlineValidateAnd"):pt("production.selectAnActiveTemplateVersionUploadCompletedExcel")):detail?`${detail.number} · ${detail.template_name} v${detail.revision}`:pt("production.fillATemplateOnlineOrUploadExcelTo")}>
      {(draft||detail)?<Button icon={ArrowLeft} disabled={busy} onClick={()=>leave()}>{pt("production.backToAcceptances")}</Button>:<><Button kind="primary" icon={Plus} disabled={!templates.length} onClick={()=>start('online')}>{pt("production.newOnlineAcceptance")}</Button><Button icon={Upload} disabled={!templates.length} onClick={()=>start()}>{pt("production.importAcceptance")}</Button></>}
      {detail&&<><Button icon={Download} busy={busy} onClick={()=>run(()=>downloadExcel(`/acceptances/${detail.id}/download`))}>{pt("production.downloadUploadedOriginal")}</Button><Button icon={Trash2} disabled={busy} onClick={()=>remove(detail)}>{pt("production.deleteAcceptance")}</Button></>}
    </PageHeading>
    {error&&<div className="form-error quality-notice" role="alert">{productionMessage(error)}</div>}
    {message&&<div className="quality-success quality-notice" role="status">{productionMessage(message)}</div>}
    {!draft&&!detail&&<>
      {!templates.length&&<div className="info-box quality-storage">{pt("production.noActiveTemplatesPublishAVersionInTemplate")}<Button onClick={onTemplates}>{pt("production.goToTemplateConfiguration")}</Button></div>}
      <section className="panel"><div className="table-toolbar quality-list-toolbar"><h2>{pt("production.savedAcceptances")}</h2><div className="quality-toolbar quality-list-filters"><AntInput aria-label={pt("production.searchAcceptances")} placeholder={pt("production.searchNameOrNumber")} value={q} onChange={e=>{setQ(e.target.value);setOffset(0);}}/><span className="muted">{pt("production.total")} {total} {pt("production.orders")}</span></div></div>
        <div className="quality-list-scroll"><table className="quality-list"><colgroup><col/><col/><col/><col/><col className="quality-list-action-column"/></colgroup><thead><tr><th>{pt("production.acceptanceName")}</th><th>{pt("production.templateVersion")}</th><th>{pt("production.uploadedFile")}</th><th>{pt("production.submittedByTime")}</th><th>{pt("production.actions")}</th></tr></thead><tbody>{list.map(row=><tr key={row.id}><td><strong>{row.name}</strong><small>{row.number}</small></td><td>{row.template_name}<small>v{row.revision}</small></td><td>{row.filename}</td><td>{row.created_by_name}<small>{new Date(row.created_at).toLocaleString(getFormatLocale())}</small></td><td><div className="quality-actions"><Button disabled={busy} onClick={()=>run(async()=>{setDetail(await api(`/quality/acceptances/${row.id}`));setMessage('');})}>{pt("production.viewDetails")}</Button><Button disabled={busy} onClick={()=>run(()=>downloadExcel(`/acceptances/${row.id}/download`))}>{pt("production.downloadOriginal")}</Button><Button icon={Trash2} disabled={busy} onClick={()=>remove(row)}>{pt("production.delete")}</Button></div></td></tr>)}</tbody></table></div>
        {!list.length&&<div className="quality-empty"><FileSpreadsheet size={30}/><p>{pt("production.noMatchingAcceptances")}</p></div>}
        {total>20&&<div className="quality-toolbar quality-pagination"><Button disabled={offset===0} onClick={()=>setOffset(v=>v-20)}>{pt("production.previous")}</Button><span>{offset+1}–{Math.min(offset+20,total)} / {total}</span><Button disabled={offset+20>=total} onClick={()=>setOffset(v=>v+20)}>{pt("production.next")}</Button></div>}
      </section>
    </>}
    {draft&&<>
      <section className="panel quality-acceptance-form"><div className="quality-acceptance-steps"><span className={!parsed?'active':''}>{isOnline?pt("production.label1SelectTemplateAndFillIn"):pt("production.label1SelectTemplateAndUpload")}</span><span className={parsed?'active':''}>{pt("production.label2ReviewParseResults")}</span><span>{pt("production.label3ConfirmAndSave")}</span></div>
        <div className="quality-meta"><label>{pt("production.acceptanceTemplate")}<Select aria-label={pt("production.acceptanceTemplate")} disabled={busy} value={draft.template?.id||''} onChange={e=>{
          if(online&&!window.confirm(pt("production.switchingTemplatesClearsCurrentEntriesContinue")))return;
          const template=templates.find(t=>t.id===Number(e));setDraft(v=>({...v,template,file:null,workbook:null,sheetNames:[],name:pt("production.acceptance", { v0: template.name })}));setParsed(null);setOnline(null);setBindings([]);setCorrections([]);setError('');request.current=null;
        }}><option value="" disabled>{pt("production.selectAnActiveTemplate")}</option>{templates.map(t=><option key={t.id} value={t.id}>{t.name} · v{t.revision}</option>)}</Select></label>
          <label>{pt("production.acceptanceName2")}<AntInput aria-label={pt("production.acceptanceName2")} maxLength={100} value={draft.name} disabled={busy} onChange={e=>setDraft(v=>({...v,name:e.target.value}))}/></label>
          <label>{pt("production.note")}<AntInput aria-label={pt("production.acceptanceNote")} maxLength={1000} value={draft.note} disabled={busy} onChange={e=>setDraft(v=>({...v,note:e.target.value}))}/></label>
          <div className="quality-file"><span>{pt("production.template")}{draft.template?`${draft.template.name} v${draft.template.revision}`:pt("production.notSelected")}</span><Button icon={Download} disabled={busy||!draft.template} onClick={()=>run(()=>downloadExcel(`/templates/${draft.template.id}/revisions/${draft.template.revision_id}/download`))}>{pt("production.downloadThisVersionSExcel")}</Button></div>
        </div>
        {isOnline?(!online&&<div className="quality-acceptance-upload"><FileSpreadsheet size={32}/><div><strong>{pt("production.fillOnlineUsingAPublishedTemplate")}</strong><p className="muted">{pt("production.configuredInputAreasAreClearedByDefaultSo")}</p><AntCheckbox className="quality-check" disabled={busy} checked={keepValues} onChange={e=>setKeepValues(e.target.checked)}>{pt("production.includeTemplatePrefilledContentVerifyEveryItem")}</AntCheckbox></div><Button kind="primary" busy={busy} disabled={!draft.template} onClick={loadOnline}>{pt("production.startFilling")}</Button></div>):<div className="quality-acceptance-upload"><FileSpreadsheet size={32}/><div><strong>{draft.file?.name||pt("production.uploadCompletedExcel")}</strong><p className="muted">{pt("production.supportsXlsxUpTo10MbParsedIn")}</p></div><Button icon={Upload} busy={busy} disabled={!draft.template} onClick={()=>input.current.click()}>{draft.file?pt("production.reuploadAndParse"):pt("production.selectExcelAndParse")}</Button></div>}
        {!isOnline&&draft.workbook&&<div className="quality-data-sheets"><div><h2>{pt("production.selectDataWorksheetsToParse")}</h2><p className="muted">{pt("production.eachSelectedWorksheetIsParsedUsingTheSame")}</p></div><div className="quality-inline">{draft.workbook.sheets.map(sheet=><AntCheckbox className="quality-check" key={sheet.name} aria-label={pt("production.parseWorksheet", { v0: sheet.name })} disabled={busy} checked={draft.sheetNames.includes(sheet.name)} onChange={e=>selectSheets(e.target.checked?draft.workbook.sheets.filter(s=>draft.sheetNames.includes(s.name)||s.name===sheet.name).map(s=>s.name):draft.sheetNames.filter(name=>name!==sheet.name))}>{sheet.name}</AntCheckbox>)}</div></div>}
        <input ref={input} aria-label={pt("production.uploadAcceptanceExcel")} type="file" accept=".xlsx" hidden disabled={busy||!draft.template} onChange={e=>{const file=e.target.files[0];e.target.value='';if(file)void parse(file);}}/>
      </section>
      {isOnline&&online&&<QualityOnlineEditor online={online} busy={busy} validated={!!parsed} onChange={changeOnline} onValidate={validateOnline}/>}
      {parsed&&<section className={`quality-acceptance-validation ${noSheets||preview.issues.length||pendingBindings?'has-errors':'is-valid'}`} role="status"><div><strong>{noSheets?pt("production.selectAtLeastOneDataWorksheetToParse"):preview.issues.length?pt("production.foundIssues", { v0: preview.issues.length, v1: isOnline?pt("production.correctTheEntriesAndValidateAgain"):pt("production.correctCellsInTheLocationPanelOrEdit") }):pendingBindings?pt("production.parsingPassedBindAMaterialOrTurnOff"):reviewNeeded?pt("production.parsingPassedSystemChecksRequireConfirmation"):pt("production.parsingPassedReadyToConfirmAndSave")}</strong><p>{parsed.template.name} v{parsed.template.revision} · {pt("production.worksheets2", { v0: sheets.length })} {pt("production.eachWorksheet")} {definition.fields.length} {pt("production.fields")}</p></div>{!isOnline&&<Button disabled={busy} onClick={()=>setSource({sheetName:preview.sheets?.[0]?.sheetName||definition.sheetName,region:'A1'})}>{pt("production.viewUploadedTable")}</Button>}</section>}

    </>}
    {detail&&<section className="panel quality-acceptance-detail"><div><span className="muted">{pt("production.acceptanceName2")}</span><h2>{detail.name}</h2></div><div><span className="muted">{pt("production.submittedBy")}</span><p>{detail.created_by_name}</p></div><div><span className="muted">{pt("production.savedAt")}</span><p>{new Date(detail.created_at).toLocaleString(getFormatLocale())}</p></div><div><span className="muted">{pt("production.note")}</span><p>{detail.note||'—'}</p></div></section>}
    {detail&&preview&&<WorkbookResults key={detail.id} sheetNavigation definition={definition} preview={preview} onLocate={draft?(sheetName,region)=>setSource({sheetName,region}):undefined} renderSheet={sheetName=><QualityMaterialBinding key={sheetName} sheetName={sheetName} data={data} busy={busy} readOnly={!draft} binding={(draft?bindings:detail.bindings)?.find(binding=>binding.sheetName===sheetName)} onChange={changed=>setBindings(values=>values.map(binding=>binding.sheetName===sheetName?changed:binding))}/>}/>}
    {draft&&parsed&&<section className="panel quality-sheet-summaries" aria-label={pt("production.worksheetParseList")}>{sheets.map(sheet=><QualityMaterialBinding key={sheet.sheetName} compact sheetName={sheet.sheetName} data={data} busy={busy} issueCount={sheet.issues.length} reviewNeeded={needsQualityReview(sheet)} binding={bindings.find(binding=>binding.sheetName===sheet.sheetName)} onChange={changed=>setBindings(values=>values.map(binding=>binding.sheetName===sheet.sheetName?changed:binding))} onPreview={()=>setResultSheet(sheet.sheetName)}/>)}</section>}
    {selectedSheet&&!source&&<Modal title={pt("production.worksheetParseResults")} subtitle={selectedSheet.sheetName} wide onClose={()=>setResultSheet(null)}><div className="form-body">
      {!!selectedSheet?.issues.length&&<section className="panel quality-acceptance-issues" aria-label={pt("production.parseIssues")}><h2>{pt("production.cellsRequiringCorrection")}</h2>{selectedSheet.issues.map((issue,i)=>{
        const name=selectedSheet.sheetName;
        const field=definition.fields.find(f=>f.id===issue.fieldId),property=field?.properties?.find(p=>p.id===issue.propertyId);
        return <div key={i}><div><strong>{field?.name||pt("production.worksheet2")}{property?` / ${property.name}`:''}</strong><p>{productionMessage(issue.message)}</p></div>{isOnline?<span>{name}!{issue.region}</span>:<Button onClick={()=>setSource({sheetName:name,region:issue.region})}>{name}!{issue.region} {pt("production.locate")}</Button>}</div>;
      })}</section>}
      <WorkbookResults definition={definition} preview={{sheets:[selectedSheet]}} onLocate={isOnline?undefined:(sheetName,region)=>setSource({sheetName,region})}/>
    </div></Modal>}
    {draft&&reviewNeeded&&<AntCheckbox className="quality-review-confirm" aria-label={pt("production.systemNoticesReviewed")} checked={checksAcknowledged} disabled={busy} onChange={e=>setChecksAcknowledged(e.target.checked)}>{pt("production.iReviewedTheDifferencesAndPendingItemsFound")}</AntCheckbox>}
    {detail?.checks_acknowledged===1&&<p className="quality-success quality-notice">{detail.created_by_name} {pt("production.systemCheckNoticesConfirmedOriginalDecisionsAndSystem")}</p>}
    {draft&&<div className="quality-acceptance-footer"><span className="muted">{isOnline?(parsed?pt("production.confirmationSavesInspectionDataMaterialBindingsAndGenerated"):pt("production.afterFillingSelectValidateAndPreviewReviewResults")):parsed?pt("production.confirmationSavesSelectedWorksheetResultsMaterialBindingsAnd"):pt("production.reviewParsedResultsAfterUploadBeforeConfirmingSave")}</span><Button kind="primary" icon={Check} busy={busy} disabled={!parsed||noSheets||!!preview?.issues.length||pendingBindings||reviewNeeded&&!checksAcknowledged||!draft.name.trim()} onClick={save}>{pt("production.confirmAndSaveAcceptance")}</Button></div>}
    {source&&parsed&&<SourceSheet workbook={parsed.workbook} sheetName={source.sheetName} region={source.region} corrections={corrections} issues={parsed.preview.issues} busy={busy} onCorrect={correct} onClose={()=>{if(!busy)setSource(null);}}/>}
  </section>;
}
