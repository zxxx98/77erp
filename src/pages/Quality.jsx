import { productionMessage } from '../i18n/production-errors.js';
import { qualityTypeLabels } from '../i18n/production-display.js';
import { t as pt, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { Input as AntInput, Button as AntButton, Checkbox as AntCheckbox } from '../ui/controls.jsx';

import { parseQualityFile, designQualityFile } from '../quality-local.js';
import { QualityChecksEditor } from './QualityChecksEditor.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FileSpreadsheet, Plus, Upload, Download, Save, Check, X, MousePointer2 } from 'lucide-react';
import { api } from '../api.js';
import { PageHeading, Button, Modal, Badge } from '../components/common.jsx';
import { Select } from '../Dropdown.jsx';
import { usePermissions } from '../permissions.jsx';
import { adjacentRegion, cellAddress, containsCell, logicalRegion, objectHeaders, objectOrientation, objectRecords, parseRegion, previewDefinition, regionAddress, regionText, validateDefinition } from '../../shared/quality-template.js';
import { TypeRules, ObjectProperties, ObjectTerminationRules, RuleSection } from './QualityFieldRules.jsx';
import { sheetPreviewBounds } from '../../shared/quality-sheet-view.js';
import { downloadExcel, fetchQualityExcel, PreviewTable, WorkbookResults, QualityNavigation } from './quality-shared.jsx';
import { designerDefinition } from '../../shared/quality-designer.js';
import { QualityTemplateDesigner } from './QualityTemplateDesigner.jsx';
import { QualityAcceptances } from './QualityAcceptances.jsx';
import { QualityCharts } from './QualityCharts.jsx';
import '../quality.css';

const uid = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join('-');
const directions = () => ([['up',pt("production.up")],['down',pt("production.down")],['left',pt("production.left")],['right',pt("production.right")]]);
const editable = t => ({name:t.name,note:t.note||'',definition:t.definition});
export function Quality({data,onConfigure,initialArea='templates'}) {
  useLocale();
  const {user}=usePermissions();
  const [area,setArea]=useState(initialArea);
  const [list,setList]=useState([]),[total,setTotal]=useState(0),[offset,setOffset]=useState(0),[q,setQ]=useState(''),[status,setStatus]=useState('all');
  const [storage,setStorage]=useState(null),[form,setForm]=useState(null),[workbook,setWorkbook]=useState(null),[sourceFile,setSourceFile]=useState(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [selection,setSelection]=useState(null),[menu,setMenu]=useState(null),[fieldDraft,setFieldDraft]=useState(null),[selectedId,setSelectedId]=useState(null),[picking,setPicking]=useState(false),[wizard,setWizard]=useState(null);
  const [keySelections,setKeySelections]=useState([]),[batch,setBatch]=useState(null);
  const [fieldTab,setFieldTab]=useState('config');
  const [showPreview,setShowPreview]=useState(false),[revision,setRevision]=useState(0);
  const [designer,setDesigner]=useState(null);
  const configInputRef=useRef(), inputRef=useRef(), replaceInputRef=useRef(), lock=useRef(false), saved=useRef(''), drag=useRef(null), selectionRef=useRef(null), menuRef=useRef(), sheetRef=useRef(), selectionErrorRef=useRef();
  const requestRef=useRef(null);
  const sheet=workbook?.sheets.find(s=>s.name===form?.definition.sheetName);
  const dirty=!!form&&(!form.id||!!sourceFile||saved.current!==JSON.stringify(editable(form)));
  const interrupted=dirty||!!wizard||!!fieldDraft||!!batch||!!designer;
  useEffect(()=>{if(error&&wizard&&['properties','values'].includes(wizard.step))selectionErrorRef.current?.scrollIntoView({block:'nearest'});},[error,wizard?.step]);
  useEffect(()=>{
    const unload=e=>{if(interrupted){e.preventDefault();e.returnValue='';}};
    const navigate=e=>{if(interrupted&&!window.confirm(pt("production.theTemplateHasUnsavedOrIncompleteConfigurationLeave")))e.preventDefault();};
    window.addEventListener('beforeunload',unload);window.addEventListener('erp:before-navigate',navigate);
    return()=>{window.removeEventListener('beforeunload',unload);window.removeEventListener('erp:before-navigate',navigate);};
  },[interrupted]);
  useEffect(()=>{
    let live=true;
    api('/quality/storage').then(v=>{if(live)setStorage(v);}).catch(e=>{if(live)setError(e.message);});
    return()=>{live=false;};
  },[revision,data]);
  useEffect(()=>{
    if(form||area!=='templates')return;
    let live=true;
    const timer=setTimeout(()=>api(`/quality/templates?q=${encodeURIComponent(q)}&status=${status}&offset=${offset}`).then(v=>{if(live){setList(v.templates);setTotal(v.total);}}).catch(e=>{if(live)setError(e.message);}),150);
    return()=>{live=false;clearTimeout(timer);};
  },[q,status,offset,form,revision,area]);
  const run=async fn=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');setMessage('');try{return await fn();}catch(e){setError(e.message);}finally{lock.current=false;setBusy(false);}};
  const apply=t=>{setForm(t);setWorkbook(t.workbook);setSourceFile(null);saved.current=JSON.stringify(editable(t));setFieldDraft(null);setWizard(null);setRegion(null);setBatch(null);setSelectedId(null);};
  const updateDefinition=definition=>setForm(v=>({...v,definition}));
  const preview=useMemo(()=>{if(!form||!workbook)return null;try{return previewDefinition(form.definition,workbook);}catch{return null;}},[form?.definition,workbook]);
  const activeField=fieldDraft;
  const uniqueKeyOwner=form?.definition.fields.flatMap(f=>{
    const current=fieldDraft?.id===f.id?fieldDraft:f;
    return current.type==='object'?current.properties: [current];
  }).find(f=>f.type==='uniqueKey');
  const activePreview=useMemo(()=>{if(!activeField||!form)return null;try{return previewDefinition({...form.definition,fields:[activeField]},workbook);}catch{return null;}},[activeField,workbook,form?.definition.sheetName]);
  const fieldSourceTexts=useMemo(()=>{
    if(!activeField||!sheet)return {};
    const read=region=>{try{return regionText(sheet,region,{preserveLines:true});}catch{return '';}};
    if(activeField.type!=='object')return {[activeField.id]:[read(activeField.valueRegion)]};
    try {const records=objectRecords(sheet,activeField);return Object.fromEntries(activeField.properties.map((p,i)=>[p.id,records.map(record=>read(regionAddress(record.cells[i])))]));}catch{return {};}
  },[activeField,sheet]);
  const setRegion=(r,keys=[])=>{selectionRef.current=r;setSelection(r);setKeySelections(keys);};
  const selectedKeys=keySelections.length?keySelections:selection?[selection]:[];
  const multiSelected=selectedKeys.length>1;
  const toggleKey=r=>{
    const address=regionAddress(r),keys=selectedKeys.some(k=>regionAddress(k)===address)?selectedKeys.filter(k=>regionAddress(k)!==address):[...selectedKeys,r];
    setRegion(keys.at(-1)||null,keys);setMenu(null);
  };
  const selectRect=(a,b)=>{
    let r={r1:Math.min(a.r1,b.r1),c1:Math.min(a.c1,b.c1),r2:Math.max(a.r2,b.r2),c2:Math.max(a.c2,b.c2)};
    let expanded=true;
    while(expanded){expanded=false;for(const m of sheet.merges.map(parseRegion))if(r.r1<=m.r2&&r.r2>=m.r1&&r.c1<=m.c2&&r.c2>=m.c1){const next={r1:Math.min(r.r1,m.r1),c1:Math.min(r.c1,m.c1),r2:Math.max(r.r2,m.r2),c2:Math.max(r.c2,m.c2)};if(regionAddress(next)!==regionAddress(r)){r=next;expanded=true;}}}
    setRegion(r);
  };
  const newProperties=region=>{
    const layout=objectHeaders(sheet,region,wizard?.headerMode==='multi'?(wizard.orientation||'horizontal'):undefined,wizard?.headerMode);
    const properties=layout.cells.map((cell,i)=>{
      const addr=cellAddress(cell.r1,cell.c1),previous=wizard?.previousProperties?.find(p=>p.headerCell===addr);
      const headerPath=layout.paths?.[i].map(cell=>({region:regionAddress(cell),text:regionText(sheet,regionAddress(cell))}));
      const labels=headerPath?.map(node=>node.text.replace(/\s+/g,' ').trim()).filter(Boolean),fullName=labels?.join(' / ')||regionText(sheet,addr);
      const name=headerPath&&fullName.length>60?`${labels[0].slice(0,20)}… / ${labels.at(-1).slice(0,35)}`:fullName;
      const {headerPath:previousPath,...previousRules}=previous||{};
      return {...previousRules,id:previous?.id||uid(),name:previous?.name??name,headerCell:addr,...(headerPath?{headerPath}:{}),type:previous?.type||'string',required:previous?.required||false};
    });
    return {orientation:layout.orientation,properties};
  };
  const objectField=(w,region)=>({id:w.id,name:w.name,labelRegion:w.labelRegion,labelText:w.labelText,type:'object',collection:true,propertyRegion:w.propertyRegion,...(w.headerMode==='multi'?{headerMode:'multi'}:{}),orientation:objectOrientation(w),valueRegion:region,...(w.termination?{termination:w.termination}:{}),properties:w.properties,required:!!w.required,configured:true});
  const finishSelection=()=>{
    if(!drag.current)return;drag.current=null;
    const rect=selectionRef.current;if(!rect)return;
    const region=regionAddress(rect);
    try{
      if(wizard?.step==='properties')setWizard({...wizard,step:'confirm',propertyRegion:region,...newProperties(region)});
      else if(wizard?.step==='values'){
        const field=objectField(wizard,region);
        validateDefinition({...form.definition,fields:[...form.definition.fields.filter(f=>f.id!==field.id),field]},workbook);
        setWizard({...wizard,step:'preview',valueRegion:region});
      }else if(picking){setFieldDraft(v=>({...v,valueRegion:region,direction:null,selectionMode:'manual'}));setPicking(false);setFieldTab('config');}
      setError('');
    }catch(e){setError(wizard?.step==='properties'?pt("production.step1SelectPropertyHeadersSelectedRange", { v0: region, v1: productionMessage(e.message) }):e.message);}
  };
  const finishRef=useRef(finishSelection);finishRef.current=finishSelection;
  const extendSelectionRef=useRef(selectRect);extendSelectionRef.current=selectRect;
  useEffect(()=>{
    let frame=0,point=null,edgeSince=0,edgeDirection='';
    const stop=()=>{cancelAnimationFrame(frame);frame=0;point=null;edgeDirection='';edgeSince=0;};
    const tick=()=>{
      frame=0;
      const scroll=sheetRef.current;
      if(!drag.current||!scroll||!point)return;
      const rect=scroll.getBoundingClientRect(),right=Math.min(rect.right,window.innerWidth),bottom=Math.min(rect.bottom,window.innerHeight);
      const dx=point.x>right-28?16:point.x<rect.left+28?-16:0;
      const dy=point.y>bottom-28?16:point.y<Math.max(rect.top,0)+28?-16:0;
      const direction=`${dx}:${dy}`;
      if(direction!==edgeDirection){edgeDirection=direction;edgeSince=performance.now();}
      // A brief pass over an edge should not change the row or column being selected.
      if((dx||dy)&&performance.now()-edgeSince<350){frame=requestAnimationFrame(tick);return;}
      const left=scroll.scrollLeft,top=scroll.scrollTop;
      scroll.scrollLeft+=dx;scroll.scrollTop+=dy;
      if(scroll.scrollLeft!==left||scroll.scrollTop!==top){
        // Stay inside the grid body, clear of the sticky row and column headings.
        const x=Math.max(rect.left+44,Math.min(point.x,right-18)),y=Math.max(rect.top+32,Math.min(point.y,bottom-18));
        const cell=document.elementFromPoint(x,y)?.closest('td[data-address]');
        if(cell&&scroll.contains(cell)){
          const start=parseRegion(cell.dataset.address);
          extendSelectionRef.current(drag.current,{...start,r2:start.r1+cell.rowSpan-1,c2:start.c1+cell.colSpan-1});
        }
      }
      if(dx||dy)frame=requestAnimationFrame(tick);
    };
    const move=event=>{if(!drag.current)return;point={x:event.clientX,y:event.clientY};if(!frame)frame=requestAnimationFrame(tick);};
    const up=()=>{stop();finishRef.current();};
    window.addEventListener('mousemove',move);window.addEventListener('mouseup',up);
    return()=>{stop();window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',up);};
  },[]);
  useEffect(()=>{
    const close=e=>{if(!menuRef.current?.contains(e.target))setMenu(null);};
    const key=e=>{if(e.key==='Escape'){setMenu(null);if(picking)setPicking(false);}};
    document.addEventListener('mousedown',close);document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('mousedown',close);document.removeEventListener('keydown',key);};
  },[picking]);
  const requireIdle=()=>{if(fieldDraft){setError(pt("production.completeOrCancelTheCurrentFieldConfigurationFirst"));return false;}return true;};
  const editField=field=>{
    if(!requireIdle())return;
    setFieldDraft(structuredClone(field));setSelectedId(field.id);setFieldTab('config');setError('');setMenu(null);
    if(!field.labelRegion&&!field.valueRegion){setRegion(null);return;}
    const r=parseRegion(field.labelRegion||field.valueRegion);setRegion(r);
    sheetRef.current?.querySelector(`[data-address="${cellAddress(r.r1,r.c1)}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});
  };
  const startField=direction=>{
    setMenu(null);if(!requireIdle())return;
    if(multiSelected){
      const existing=selectedKeys.find(r=>form.definition.fields.some(f=>f.labelRegion===regionAddress(r)));
      if(existing){setError(pt("production.alreadyHasAKeyHoldShiftAndClick", { v0: regionAddress(existing) }));return;}
      const fields=selectedKeys.map(r=>{
        const labelRegion=regionAddress(r);
        return {id:uid(),name:regionText(sheet,labelRegion).slice(0,60),labelRegion,labelText:regionText(sheet,labelRegion),valueRegion:adjacentRegion(sheet,labelRegion,direction),type:'string',direction,selectionMode:'direction',configured:true,required:false};
      });
      if(fields.some(f=>!f.valueRegion)){setError(pt("production.someKeysInThisDirectionExceedTheWorksheet"));return;}
      setBatch({direction,fields});setError('');return;
    }
    const labelRegion=regionAddress(selection),valueRegion=adjacentRegion(sheet,labelRegion,direction);
    if(!valueRegion)return;
    const field={id:uid(),name:regionText(sheet,labelRegion).slice(0,60),labelRegion,labelText:regionText(sheet,labelRegion),valueRegion,type:'string',direction,selectionMode:'direction',configured:false,required:false};
    updateDefinition({...form.definition,fields:[...form.definition.fields,field]});setFieldDraft(field);setSelectedId(field.id);setFieldTab('config');setError('');
  };
  const startCustomField=()=>{
    setMenu(null);if(!requireIdle())return;
    const field={id:uid(),name:'',customKey:true,valueRegion:'',type:'string',direction:null,selectionMode:'manual',configured:false,required:false};
    setFieldDraft(field);setSelectedId(field.id);setFieldTab('config');setRegion(null);setError('');
  };
  const startObject=()=>{
    setMenu(null);if(!requireIdle())return;
    const labelRegion=regionAddress(selection),labelText=regionText(sheet,labelRegion);
    setWizard({id:uid(),name:labelText.slice(0,60),labelRegion,labelText,step:'properties'});setError('');setRegion(null);
  };
  const finishBatch=()=>{
    try{
      const definition=validateDefinition({...form.definition,fields:[...form.definition.fields,...batch.fields]},workbook);
      updateDefinition(definition);setSelectedId(batch.fields[0].id);setMessage(pt("production.addedRegularKeysAllInitiallyStringsYouCan", { v0: batch.fields.length }));setBatch(null);setRegion(null);setError('');
    }catch(e){setError(e.message);}
  };
  const finishField=()=>{
    try{const definition=validateDefinition({...form.definition,fields:form.definition.fields.some(f=>f.id===fieldDraft.id)?form.definition.fields.map(f=>f.id===fieldDraft.id?{...fieldDraft,configured:true}:f):[...form.definition.fields,{...fieldDraft,configured:true}]},workbook);
      updateDefinition(definition);setFieldDraft(null);setPicking(false);setError('');setMessage(pt("production.fieldConfigurationUpdatedEditOtherFieldsOrSave"));
    }catch(e){setError(e.message);}
  };
  const finishObject=()=>{
    try{
      const definition=validateDefinition({...form.definition,fields:[...form.definition.fields.filter(f=>f.id!==wizard.id),objectField(wizard,wizard.valueRegion)]},workbook);
      const field=definition.fields.find(f=>f.id===wizard.id);
      if(wizard.editorDraft){setFieldDraft(field);setFieldTab('config');}
      else{
        updateDefinition({...form.definition,fields:form.definition.fields.some(f=>f.id===field.id)?form.definition.fields.map(f=>f.id===field.id?field:f):[...form.definition.fields,field]});
        setMessage(pt("production.objectAddedYouCanContinueEditingPropertyRules", { v0: field.name }));
      }
      setSelectedId(field.id);setWizard(null);setRegion(parseRegion(field.labelRegion));setError('');
    }catch(e){setError(e.message);}
  };
  const cancelField=()=>{
    const original=form.definition.fields.find(f=>f.id===fieldDraft.id);
    if(original&&JSON.stringify(original)!==JSON.stringify(fieldDraft)&&!window.confirm(pt("production.changesToThisFieldHaveNotBeenApplied")))return;
    setFieldDraft(null);setPicking(false);setError('');
  };
  const cancelWizard=()=>{
    if(wizard?.editorDraft){setFieldDraft(wizard.editorDraft);setFieldTab('config');setRegion(parseRegion(wizard.editorDraft.labelRegion));}
    else setRegion(null);
    setWizard(null);setError('');
  };
  const persist=async()=>{
    if(wizard||fieldDraft||picking||batch)throw new Error(pt("production.completeOrCancelTheCurrentConfigurationFirst"));
    let result;
    if(!form.id){
      const body=new FormData();body.append('file',sourceFile);body.append('name',form.name);body.append('definition',JSON.stringify(form.definition));
      const signature=JSON.stringify([form.name,form.definition]);
      if(requestRef.current?.signature!==signature)requestRef.current={signature,id:uid()};
      body.append('request_id',requestRef.current.id);result=await api('/quality/templates',{method:'POST',body});
      if(form.note)result=await api(`/quality/templates/${result.id}/draft`,{method:'PUT',body:{name:result.name,note:form.note,definition:result.definition,version:result.version}});
    }else if(sourceFile){
      const body=new FormData();body.append('file',sourceFile);body.append('version',String(form.version));body.append('name',form.name);body.append('note',form.note||'');body.append('definition',JSON.stringify(form.definition));
      result=await api(`/quality/templates/${form.id}/file`,{method:'POST',body});
    }else result=await api(`/quality/templates/${form.id}/draft`,{method:'PUT',body:{...editable(form),version:form.version}});
    apply(result);return result;
  };
  const importFile=file=>run(async()=>{
    if(!file)return;
    const result=await parseQualityFile(file);
    setWorkbook(result.workbook);setSourceFile(file);setForm({name:file.name.replace(/\.xlsx$/i,'').slice(0,60),note:'',filename:result.filename,definition:{schemaVersion:1,sheetName:result.workbook.sheets[0].name,fields:[]},revisions:[]});
    saved.current='';requestRef.current=null;setRegion(null);setBatch(null);setFieldDraft(null);setWizard(null);setMessage(pt("production.excelLoadedAddCustomKeysDirectlyOrRight"));
  });
  const open=id=>run(async()=>apply(await api(`/quality/templates/${id}`)));
  const openDesigner=(blank=false)=>run(async()=>{
    if(!blank&&(wizard||fieldDraft||picking||batch))throw new Error(pt("production.completeOrCancelTheCurrentFieldConfigurationFirst"));
    const file=blank?null:sourceFile||await fetchQualityExcel(`/templates/${form.id}/draft/download`);
    const {model}=await designQualityFile(file,{action:'load'});
    setDesigner({file,model,hasFields:!blank&&!!form?.definition.fields.length});
  });
  const applyDesigner=({commands,definition:starter,keepFields,name})=>run(async()=>{
    name=name.trim();if(!name||name.length>60)throw new Error(pt("production.enterATemplateNameOf160Characters"));
    const filename=`${name.replace(/[\x00-\x1f\x7f/\\]/g,'_')}.xlsx`;
    const result=await designQualityFile(designer.file,{action:'save',commands,filename});
    const base=form?.definition||starter||{schemaVersion:1,sheetName:designer.model.sheets[0].name,fields:[]};
    const mapped=designerDefinition(base,commands);
    let definition;
    try{definition=validateDefinition(keepFields?mapped:{schemaVersion:1,sheetName:mapped.sheetName,fields:[]},result.workbook);}
    catch(e){throw new Error(pt("production.theTableDoesNotMatchExistingFieldConfiguration", { v0: productionMessage(e.message) }));}
    setWorkbook(result.workbook);setSourceFile(result.file);setForm(v=>({...v,name,note:v?.note||'',filename:result.filename,definition,revisions:v?.revisions||[]}));
    setDesigner(null);setRegion(null);setSelectedId(null);setFieldDraft(null);setWizard(null);setBatch(null);setMenu(null);requestRef.current=null;
    setMessage(pt("production.tableGeneratedConfigureFieldsAndSaveTheDraft"));
  });
  const close=()=>{if(interrupted&&!window.confirm(pt("production.configurationIsUnsavedReturnToTheList")))return;setForm(null);setWorkbook(null);setFieldDraft(null);setWizard(null);setBatch(null);setRegion(null);setSourceFile(null);setMenu(null);setError('');setMessage('');setRevision(v=>v+1);};
  const menuExisting=!multiSelected&&selection&&form?.definition.fields.find(f=>f.labelRegion===regionAddress(selection));
  const safeRect=region=>{try{return parseRegion(region);}catch{return null;}};
  const highlights=[];
  for(const f of (form?.definition.fields||[]).map(f=>fieldDraft?.id===f.id?fieldDraft:f)){
    highlights.push({rect:safeRect(f.labelRegion),kind:'key',name:f.name});
    if(f.propertyRegion)highlights.push({rect:safeRect(f.propertyRegion),kind:'property',name:f.name});
    highlights.push({rect:safeRect(f.valueRegion),kind:'value',name:f.name});
  }
  if(fieldDraft?.customKey&&!form.definition.fields.some(f=>f.id===fieldDraft.id))highlights.push({rect:safeRect(fieldDraft.valueRegion),kind:'value',name:fieldDraft.name});
  if(wizard){highlights.push({rect:safeRect(wizard.labelRegion),kind:'key',name:wizard.name});if(wizard.propertyRegion)highlights.push({rect:safeRect(wizard.propertyRegion),kind:'property'});if(wizard.valueRegion)highlights.push({rect:safeRect(wizard.valueRegion),kind:'value'});}
  const sheetView=useMemo(()=>sheetPreviewBounds(sheet,[...(form?.definition.fields||[]),...(fieldDraft?[fieldDraft]:[]),...(wizard?[wizard]:[])].flatMap(field=>[field.labelRegion,field.propertyRegion,field.valueRegion]).concat(selection?[regionAddress(selection)]:[])),[sheet,form?.definition.fields,fieldDraft,wizard,selection]);
  const merged=useMemo(()=>{const map=new Map();for(const region of sheet?.merges||[]){const r=parseRegion(region);for(let row=r.r1;row<=r.r2;row++)for(let col=r.c1;col<=r.c2;col++)map.set(cellAddress(row,col),r);}return map;},[sheet]);
  const cells=()=>Array.from({length:sheetView.rows},(_,i)=>{
    const row=i+1;return <tr key={row}><th className="quality-row-number">{row}</th>{Array.from({length:sheetView.cols},(_,j)=>{
      const col=j+1,address=cellAddress(row,col),r=merged.get(address)||{r1:row,c1:col,r2:row,c2:col};
      if(r.r1!==row||r.c1!==col)return null;
      const marks=highlights.filter(h=>h.rect&&containsCell(h.rect,row,col));
      const isSelected=selectedKeys.some(rect=>containsCell(rect,row,col));
      const classes=['quality-cell',...marks.map(h=>'quality-'+h.kind),isSelected?'quality-selected':''].join(' ');
      return <td key={col} data-address={address} aria-label={`${address} ${sheet.cells[address]?.text||pt("production.blank")}`} className={classes} rowSpan={r.r2-r.r1+1} colSpan={r.c2-r.c1+1}
        onMouseDown={e=>{if(e.button!==0||busy||batch||wizard&& !['properties','values'].includes(wizard.step))return;e.preventDefault();e.currentTarget.closest('table').focus({preventScroll:true});if(e.shiftKey&&!wizard&&!picking){if(requireIdle())toggleKey(r);return;}setMenu(null);drag.current=r;setRegion(r);}}
        onMouseEnter={()=>{if(drag.current)selectRect(drag.current,r);}}
        onDoubleClick={e=>{if(e.shiftKey||wizard||picking||busy||batch)return;const field=form.definition.fields.find(f=>f.labelRegion===regionAddress(r));if(field)editField(field);}}
        onContextMenu={e=>{e.preventDefault();if(busy||wizard||picking||batch)return;if(!multiSelected||!selectedKeys.some(k=>regionAddress(k)===regionAddress(r)))setRegion(r);setMenu({x:Math.min(e.clientX,window.innerWidth-260),y:Math.min(e.clientY,window.innerHeight-280)});}}>
        {sheet.cells[address]?.text||''}{marks.some(m=>m.kind==='key')&&<span className="quality-cell-marker">Key</span>}
      </td>;
    })}</tr>;
  });
  const wizardPreview=wizard?.step==='preview'?previewDefinition({...form.definition,fields:[objectField(wizard,wizard.valueRegion)]},workbook):null;
  const wizardHeaders=wizard?.step==='values'?parseRegion(wizard.propertyRegion):null;
  const wizardValueRequirement=wizardHeaders&&(objectOrientation(wizard)==='vertical'
    ? pt("production.valueRangeMustCoverRowsRightOfColumn", { v0: wizardHeaders.r1, v1: wizardHeaders.r2, v2: cellAddress(1,wizardHeaders.c2).replace('1','') })
    : pt("production.valueRangeMustCoverColumnsBelowRowWith", { v0: cellAddress(1,wizardHeaders.c1).replace('1',''), v1: cellAddress(1,wizardHeaders.c2).replace('1',''), v2: wizardHeaders.r2 }));

  if(area==='acceptances')return <QualityAcceptances data={data} onTemplates={()=>setArea('templates')} onAreaChange={setArea}/>;
  if(area==='charts')return <section className="quality-page"><QualityCharts data={data} onAreaChange={setArea}/></section>;
  if(designer)return <QualityTemplateDesigner designer={designer} name={form?.name} busy={busy} error={productionMessage(error)} onApply={applyDesigner} onClose={()=>{setDesigner(null);setError('');}}/>;
  return <section className="quality-page">
    <input ref={replaceInputRef} type="file" accept=".xlsx" hidden onChange={e=>{const file=e.target.files[0];e.target.value='';if(file)void run(async()=>{const body=new FormData();body.append('file',file);body.append('version',String(form.version));apply(await api(`/quality/templates/${form.id}/file`,{method:'POST',body}));setMessage(pt("production.draftSourceExcelReplacedReconfigureFieldsPublishedVersions"));});}}/>
    <input ref={inputRef} aria-label={pt("production.uploadTemplateExcel")} type="file" accept=".xlsx" hidden onChange={e=>{const file=e.target.files[0];e.target.value='';if(file)void importFile(file);}}/>
    {!form?<>
      <QualityNavigation area="templates" onChange={setArea} disabled={busy}/>
      <PageHeading title={pt("production.qualityManagement")} description={pt("production.createTemplatesAndFillAcceptancesOnlineOrImport")}><Button kind="primary" icon={Plus} busy={busy} onClick={()=>openDesigner(true)}>{pt("production.createTemplateOnline")}</Button><Button icon={Upload} busy={busy} onClick={()=>inputRef.current.click()}>{pt("production.createTemplateFromExcel")}</Button></PageHeading>
      {storage&&!storage.ready&&<div className="info-box quality-storage">{pt("production.r2IsNotConfiguredDesignTemplatesOnlineOr")}{user?.role==='admin'&&<Button onClick={onConfigure}>{pt("production.configureR2")}</Button>}</div>}
      <section className="panel"><div className="table-toolbar quality-list-toolbar"><h2>{pt("production.acceptanceTemplates")}</h2><div className="quality-toolbar quality-list-filters"><AntInput aria-label={pt("production.searchAcceptanceTemplates")} placeholder={pt("production.searchTemplateName")} value={q} onChange={e=>{setQ(e.target.value);setOffset(0);}}/><Select aria-label={pt("production.templateStatus")} value={status} onChange={e=>{setStatus(e);setOffset(0);}}>{[['all',pt("production.allStatuses")],['draft',pt("production.draft")],['enabled',pt("production.enabled")],['disabled',pt("production.disabled2")]].map(([v,t])=><option key={v} value={v}>{t}</option>)}</Select></div></div>
      <div className="quality-list-scroll"><table className="quality-list"><colgroup><col/><col/><col/><col/><col/><col className="quality-list-action-column"/></colgroup><thead><tr><th>{pt("production.templateName")}</th><th>{pt("production.sourceFileWorksheet")}</th><th>{pt("production.fields2")}</th><th>{pt("production.status")}</th><th>{pt("production.updatedBy")}</th><th>{pt("production.actions")}</th></tr></thead><tbody>{list.map(t=><tr key={t.id}><td><strong>{t.name}</strong>{t.has_draft&&t.revision&&<small>{pt("production.unpublishedDraft")}</small>}</td><td>{t.filename}<small>{t.sheetName}</small></td><td>{t.fields}</td><td><Badge tone={t.enabled?'green':'orange'}>{t.status==='draft'?pt("production.draft"):t.enabled?pt("production.enabledV", { v0: t.revision }):pt("production.disabled2")}</Badge></td><td>{t.updated_by_name}<small>{new Date(t.updated_at).toLocaleString(getFormatLocale())}</small></td><td><div className="quality-actions"><Button disabled={busy} onClick={()=>open(t.id)}>{pt("production.edit")}</Button><Button disabled={busy||!t.enabled} onClick={()=>run(()=>downloadExcel(`/templates/${t.id}/download`))}>{pt("production.downloadExcel")}</Button><Button disabled={busy} onClick={()=>run(async()=>apply(await api(`/quality/templates/${t.id}/copy`,{method:'POST',body:{}})))}>{pt("production.copy2")}</Button>{t.revision&&<Button disabled={busy} onClick={()=>run(async()=>{await api(`/quality/templates/${t.id}/status`,{method:'POST',body:{version:t.version,enabled:!t.enabled}});setRevision(v=>v+1);})}>{t.enabled?pt("production.disable"):pt("production.enable")}</Button>}</div></td></tr>)}</tbody></table></div>
      {!list.length&&<div className="quality-empty"><FileSpreadsheet size={30}/><p>{pt("production.noMatchingAcceptanceTemplates")}</p><Button onClick={()=>inputRef.current.click()}>{pt("production.selectExcelFile")}</Button></div>}
      {total>20&&<div className="quality-toolbar quality-pagination"><Button disabled={offset===0} onClick={()=>setOffset(v=>v-20)}>{pt("production.previous")}</Button><span>{offset+1}–{Math.min(offset+20,total)} / {total}</span><Button disabled={offset+20>=total} onClick={()=>setOffset(v=>v+20)}>{pt("production.next")}</Button></div>}
      </section>
    </>:<>
      <div className="quality-heading"><div><Button icon={ArrowLeft} disabled={busy} onClick={close}>{pt("production.backToTemplates")}</Button><h1>{form.id?pt("production.editAcceptanceTemplate"):pt("production.newAcceptanceTemplate")}</h1><span className="muted">{dirty?pt("production.unsavedChanges"):form.enabled?pt("production.enabled"):pt("production.draft")}{form.revisions?.length?pt("production.publishedVersions", { v0: form.revisions.length }):''}</span></div><div className="quality-actions">
        <Button disabled={busy||!!wizard||!!fieldDraft||picking||!!batch} onClick={()=>openDesigner()}>{pt("production.editTableContentAndFormatting")}</Button>
        <Button icon={Download} disabled={busy||!form.id} onClick={()=>run(()=>downloadExcel(`/templates/${form.id}/draft/download`))}>{pt("production.downloadSourceExcel")}</Button>
        <Button icon={Save} busy={busy} disabled={!!wizard||!!fieldDraft||picking||!!batch} onClick={()=>run(async()=>{await persist();setMessage(pt("production.templateDraftSavedSourceExcelRetainedInR2"));})}>{pt("production.saveDraft")}</Button>
        <Button kind="primary" icon={Check} disabled={busy||!!wizard||!!fieldDraft||picking||!!batch||!!form.published_revision&&!dirty&&!form.has_draft} onClick={()=>run(async()=>{const current=dirty?await persist():form;const result=await api(`/quality/templates/${current.id}/publish`,{method:'POST',body:{version:current.version}});apply(result);setMessage(pt("production.templateEnabledUsersCanDownloadTheSourceExcel"));})}>{form.published_revision?pt("production.publishNewVersion"):pt("production.enableTemplate")}</Button>
      </div></div>
      <div className="quality-toolbar"><Button disabled={busy||!!wizard||!!fieldDraft||!!batch||picking} onClick={()=>configInputRef.current.click()}>{pt("production.importFieldConfiguration")}</Button><span className="muted">{pt("production.readAPreparedTemplateJsonConfigurationAfterValidation")}</span></div>
      <input ref={configInputRef} type="file" accept=".json" hidden aria-label={pt("production.importTemplateFieldConfiguration")} onChange={event=>{const file=event.target.files[0];event.target.value='';if(!file)return;void run(async()=>{
        if(file.size>2*1024*1024)throw new Error(pt("production.fieldConfigurationMustNotExceed2Mb"));
        const definition=validateDefinition(JSON.parse(await file.text()),workbook);
        if(form.definition.fields.length&&!window.confirm(pt("production.importingReplacesCurrentDraftFieldsContinue")))return;
        updateDefinition(definition);setSelectedId(null);setRegion(null);setMessage(pt("production.fieldConfigurationImportedVerifyTheSampleParsePreview"));
      });}}/>
      <div className="panel quality-meta"><label>{pt("production.templateName")}<AntInput value={form.name} maxLength={60} disabled={busy||!!wizard} onChange={e=>setForm(v=>({...v,name:e.target.value}))}/></label><label>{pt("production.description")}<AntInput value={form.note||''} maxLength={1000} disabled={busy||!!wizard} onChange={e=>setForm(v=>({...v,note:e.target.value}))}/></label><label>{pt("production.worksheet2")}<Select aria-label={pt("production.templateWorksheet")} value={form.definition.sheetName} disabled={busy||!!wizard||!!fieldDraft||!!batch||picking} onChange={e=>{if(form.definition.fields.length&&!window.confirm(pt("production.switchingWorksheetsClearsCurrentDraftFieldsContinue")))return;updateDefinition({schemaVersion:1,sheetName:e,fields:[]});setSelectedId(null);setRegion(null);setMenu(null);}}>{workbook.sheets.map(s=><option key={s.name}>{s.name}</option>)}</Select></label><span className="quality-file"><FileSpreadsheet size={18}/>{form.filename}{form.id&&<Button disabled={busy||!!wizard||!!fieldDraft} onClick={()=>{if(window.confirm(pt("production.replacingExcelClearsDraftFieldsAndUnsavedChanges")))replaceInputRef.current.click();}}>{pt("production.replaceSourceExcel")}</Button>}</span></div>

      <QualityChecksEditor definition={form.definition} onChange={updateDefinition} disabled={busy||!!wizard||!!fieldDraft||!!batch||picking}/>
      {storage&&!storage.ready&&<div className="info-box quality-storage">{pt("production.savingSourceExcelRequiresAnR2Connection")}{user?.role==='admin'&&<Button onClick={onConfigure}>{pt("production.configureR2")}</Button>}</div>}
      {wizard&&<div className="quality-wizard-banner" role="status"><span><strong>{pt("production.objectKey")}{wizard.name||pt("production.unnamed")}</strong> · {wizard.step==='properties'?(wizard.headerMode==='multi'?pt("production.step1SelectCompleteMultiLevelHeadersOnly"):pt("production.step1SelectPropertyHeadersOnlyOneContinuous")):wizard.step==='confirm'?pt("production.step2ConfirmObjectProperties"):wizard.step==='values'?(objectOrientation(wizard)==='vertical'?pt("production.step3SelectValuesRightOfPropertyColumns"):pt("production.step3SelectValuesBelowPropertyRowsCovering")):pt("production.step4PreviewAndFinish")}</span><div className="quality-actions">{wizard.step==='values'&&<Button onClick={()=>{setWizard({...wizard,step:'properties'});setRegion(null);setError('');}}>{pt("production.reselectProperties")}</Button>}<Button onClick={cancelWizard}>{wizard.editorDraft?pt("production.cancelReselection"):pt("production.cancelAddingObject")}</Button></div></div>}
      {wizard?.step==='properties'&&<div className="panel quality-header-options"><label>{pt("production.headerMode")}<Select aria-label={pt("production.objectHeaderMode")} value={wizard.headerMode||'single'} onChange={event=>{setWizard({...wizard,headerMode:event,orientation:wizard.orientation||'horizontal'});setRegion(null);setError('');}}><option value="single">{pt("production.regularHeaderSingleLogicalRowOrColumn")}</option><option value="multi">{pt("production.multiLevelHeaderCompleteHeaderRange")}</option></Select></label>{wizard.headerMode==='multi'&&<><label>{pt("production.orientation")}<Select aria-label={pt("production.multiLevelHeaderOrientation")} value={wizard.orientation||'horizontal'} onChange={event=>{setWizard({...wizard,orientation:event});setRegion(null);setError('');}}><option value="horizontal">{pt("production.horizontalHeadersOneRecordPerRowBelow")}</option><option value="vertical">{pt("production.verticalHeadersOneRecordPerColumnToThe")}</option></Select></label><p className="muted">{pt("production.selectCompleteMultiLevelHeadersEachFinalColumn")}</p></>}</div>}
      {wizard?.step==='properties'&&<p className="muted quality-header-key-hint">{pt("production.selectOnlyHeadersContainingPropertyNamesReleaseTo")}</p>}
      {wizardHeaders&&<ObjectTerminationRules field={wizard} onChange={change=>{setWizard(v=>({...v,...change}));setError('');}}/>}
      {wizardHeaders&&<div className="info-box quality-range-guide" role="note" aria-label={pt("production.objectValueRangeRequirements")}><strong>{pt("production.step3SelectDetailValueRange")}<br/>{pt("production.confirmedHeaders")}{wizard.propertyRegion}</strong><p>{wizardValueRequirement}{wizard.termination?pt("production.readFromTheSelectedStartUsingTheTermination"):pt("production.selectTheRecordRangeYourselfExcludeNotesAnd")}</p></div>}
      {error&&wizard&&['properties','values'].includes(wizard.step)&&<div ref={selectionErrorRef} className="form-error quality-notice quality-selection-error" role="alert">{productionMessage(error)}</div>}
      {picking&&<div className="quality-wizard-banner" role="status">{pt("production.dragToSelectTheValueRangeThenRelease")}<Button onClick={()=>setPicking(false)}>{pt("production.cancelSelection")}</Button></div>}
      <div className={`quality-editor${fieldDraft?' quality-editing-field':''}`}><section className="panel quality-sheet-panel"><div className="quality-grid-toolbar"><span>{sheet.name} <span className="muted">{multiSelected?pt("production.keysSelected", { v0: selectedKeys.length }):selection?regionAddress(selection):pt("production.rightClickACellToAddFields")}</span></span><div className="quality-actions">{multiSelected&&<Button onClick={()=>setRegion(null)}>{pt("production.clearMultipleSelection")}</Button>}<Button icon={MousePointer2} disabled={!selection||busy||!!wizard||picking} onClick={e=>{const r=e.currentTarget.getBoundingClientRect();setMenu({x:Math.min(r.left,window.innerWidth-260),y:Math.min(r.bottom,window.innerHeight-280)});}}>{pt("production.addField")}</Button></div></div>
        <div className="quality-sheet-scroll" ref={sheetRef}><table className="quality-grid" tabIndex={0} onKeyDown={e=>{
          if(busy||wizard||picking||fieldDraft||batch)return;
          const keys={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'};
          if(keys[e.key]){e.preventDefault();const next=selection?adjacentRegion(sheet,regionAddress(selection),keys[e.key]):'A1';if(next){const r=parseRegion(next);setRegion(r);sheetRef.current.querySelector(`[data-address="${cellAddress(r.r1,r.c1)}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});}}
          if((e.key==='Enter'||e.key==='F10'&&e.shiftKey)&&selection){e.preventDefault();const r=sheetRef.current.getBoundingClientRect();setMenu({x:Math.min(r.left+30,window.innerWidth-260),y:Math.min(r.top+40,window.innerHeight-280)});}
        }} aria-label={pt("production.excelTemplateGrid")}><colgroup><col style={{width:32}}/>{sheetView.widths.map((width,i)=><col key={i} style={{width:`calc((100% - 32px) * ${width/sheetView.widths.reduce((a,b)=>a+b,0)})`}}/>)}</colgroup><thead><tr><th></th>{Array.from({length:sheetView.cols},(_,i)=><th key={i}>{cellAddress(1,i+1).replace('1','')}</th>)}</tr></thead><tbody>{cells()}</tbody></table></div><div className="quality-legend"><span>{pt("production.blueKey")}</span><span>{pt("production.orangeObjectProperties")}</span><span>{pt("production.greenValueRange")}</span><span>{pt("production.holdShiftToSelectRegularKeysThenRight")}</span></div>
      </section><aside className={`panel quality-fields${fieldDraft?' quality-fields-detail':''}`} aria-label={fieldDraft?pt("production.editFieldsIndividually"):pt("production.fieldList")}>
        {fieldDraft?<>
          <div className="quality-field-detail-heading"><Button icon={ArrowLeft} onClick={cancelField}>{pt("production.backToFieldList")}</Button><div><h2>{fieldDraft.name||pt("production.unnamedField")}</h2><small>{qualityTypeLabels[fieldDraft.type]} · {fieldDraft.customKey?pt("production.customKey"):`Key ${fieldDraft.labelRegion}`}</small></div></div>
          <div className="quality-field-tabs" role="tablist" aria-label={pt("production.fieldEditorView")}>{[['config',pt("production.fieldSettings")],['preview',pt("production.parsePreview")]].map(([id,label])=><AntButton type="text" key={id} htmlType="button" id={`quality-field-tab-${id}`} role="tab" aria-selected={fieldTab===id} aria-controls="quality-field-editor-content" onClick={()=>setFieldTab(id)}>{label}</AntButton>)}</div>
          <div className="quality-field-body" id="quality-field-editor-content" role="tabpanel" aria-labelledby={`quality-field-tab-${fieldTab}`}>
            <div className="quality-field-form" key={fieldDraft.id} hidden={fieldTab!=='config'}>
              {fieldDraft.type==='object'?<>
                <RuleSection title={pt("production.basicInformation")}>
                  <label>{pt("production.fieldName")}<AntInput aria-label={pt("production.fieldName")} value={fieldDraft.name} maxLength={60} onChange={e=>setFieldDraft(v=>({...v,name:e.target.value}))}/></label>
                <p className="quality-field-regions">{fieldDraft.headerMode==='multi'&&<>{pt("production.multiLevelHeaders")} {objectOrientation(fieldDraft)==='vertical'?pt("production.vertical"):pt("production.horizontal")}<br/></>}{pt("production.propertyFields")}{fieldDraft.propertyRegion}<br/>{pt("production.propertyValueRange")}{fieldDraft.valueRegion}</p>
                <Button onClick={()=>{const previous=fieldDraft;setFieldDraft(null);setWizard({...previous,editorDraft:previous,previousProperties:previous.properties,step:'properties'});setRegion(null);}}>{pt("production.reselectPropertiesAndValues")}</Button>
                <AntCheckbox className="quality-check" checked={!!fieldDraft.required} onChange={e=>setFieldDraft(v=>({...v,required:e.target.checked}))}>{pt("production.atLeastOneRecordRequired")}</AntCheckbox>
                </RuleSection>
                <ObjectTerminationRules field={fieldDraft} onChange={change=>setFieldDraft(v=>({...v,...change}))}/>
                <ObjectProperties key={fieldDraft.id} field={fieldDraft} sourceTexts={fieldSourceTexts} uniqueKeyOwner={uniqueKeyOwner} onChange={change=>setFieldDraft(v=>({...v,...change}))}/>
              </>:<TypeRules field={fieldDraft} sourceTexts={fieldSourceTexts[fieldDraft.id]} uniqueKeyOwner={uniqueKeyOwner} onChange={change=>setFieldDraft(v=>({...v,...change}))}>
                <label>{pt("production.fieldName")}<AntInput aria-label={pt("production.fieldName")} placeholder={fieldDraft.customKey?pt("production.eGCompanyName"):undefined} value={fieldDraft.name} maxLength={60} onChange={e=>setFieldDraft(v=>({...v,name:e.target.value}))}/></label>
                {fieldDraft.customKey&&<p className="muted">{pt("production.noTitleCellIsNeededEnterAField")}</p>}
                <label>{pt("production.valueRange")}<div className="quality-inline"><AntInput aria-label={pt("production.valueRange")} value={fieldDraft.valueRegion} onChange={e=>setFieldDraft(v=>({...v,valueRegion:e.target.value.toUpperCase(),direction:null,selectionMode:'manual'}))}/><Button disabled={picking} onClick={()=>setPicking(true)}>{pt("production.selectRange")}</Button></div></label>
              </TypeRules>}
            </div>
            {fieldTab==='preview'&&<div className="quality-field-preview"><PreviewTable field={fieldDraft} preview={activePreview} resultFirst/>{activePreview?.issues.map((issue,i)=><p key={i} className="form-error">{issue.region}：{productionMessage(issue.message)}</p>)}</div>}
            {error&&<p className="form-error quality-field-error" role="alert">{productionMessage(error)}</p>}
          </div>
          <div className="quality-field-detail-actions">{fieldDraft.customKey&&form.definition.fields.some(f=>f.id===fieldDraft.id)&&<Button onClick={()=>{updateDefinition({...form.definition,fields:form.definition.fields.filter(f=>f.id!==fieldDraft.id)});setFieldDraft(null);setSelectedId(null);setPicking(false);setRegion(null);setError('');}}>{pt("production.removeField")}</Button>}<Button onClick={cancelField}>{pt("production.cancelEditing")}</Button><Button kind="primary" disabled={picking} onClick={finishField}>{pt("production.finishConfiguration")}</Button></div>
        </>:<>
          <div className="quality-fields-heading"><h2>{pt("production.fieldConfiguration")}</h2><span>{form.definition.fields.filter(f=>f.configured!==false).length} / {form.definition.fields.length} {pt("production.configured")}</span></div>
          <div className="quality-custom-key-actions"><Button icon={Plus} disabled={busy||!!wizard||picking||!!batch} onClick={startCustomField}>{pt("production.addCustomKey")}</Button></div>
          <div className="quality-field-list">{!form.definition.fields.length&&<p className="muted">{pt("production.addACustomKeyAndSpecifyItsValue")}</p>}{form.definition.fields.map(f=><AntButton type="text" key={f.id} htmlType="button" disabled={!!wizard||picking} className={selectedId===f.id?'quality-field active':'quality-field'} onClick={()=>editField(f)}><span>{f.name||pt("production.unnamedField")}<small>{qualityTypeLabels[f.type]} · {f.valueRegion}{f.type==='object'?pt("production.properties", { v0: f.properties.length }):''}</small></span><span>{f.configured===false?pt("production.pendingConfiguration"):pt("production.configured")}</span></AntButton>)}</div>
          <div className="quality-bottom-actions"><Button disabled={!form.definition.fields.length||!!wizard} onClick={()=>setShowPreview(true)}>{pt("production.viewFullParsePreview")}</Button></div>
        </>}
      </aside></div>
      {form.revisions?.length>0&&<details className="panel quality-history"><summary>{pt("production.publishedVersionsAndSourceExcel")}</summary>{form.revisions.map(r=><div className="quality-history-row" key={r.id}><span>v{r.revision} · {r.name} · {r.created_by_name} · {new Date(r.created_at).toLocaleString(getFormatLocale())}</span><Button disabled={busy} onClick={()=>run(()=>downloadExcel(`/templates/${form.id}/revisions/${r.id}/download`))}>{pt("production.downloadThisVersionSExcel")}</Button></div>)}</details>}
    </>}
    {error&&!batch&&!fieldDraft&&!wizard&&<div className="form-error quality-notice" role="alert">{productionMessage(error)}</div>}{message&&<div className="quality-notice quality-success" role="status">{productionMessage(message)}</div>}
    {menu&&<div className="quality-context-menu" ref={menuRef} role="menu" aria-label={pt("production.addTemplateField")} style={{left:Math.max(8,menu.x),top:Math.max(8,menu.y)}}>
      {menuExisting?<><AntButton type="text" htmlType="button" role="menuitem" onClick={()=>{setMenu(null);editField(menuExisting);}}>{pt("production.edit")}{menuExisting.type==='object'?pt("production.object"):pt("production.fields2")} Key</AntButton><AntButton type="text" htmlType="button" role="menuitem" onClick={()=>{if(!requireIdle()){setMenu(null);return;}updateDefinition({...form.definition,fields:form.definition.fields.filter(f=>f.id!==menuExisting.id)});setMenu(null);setSelectedId(null);}}>{pt("production.removeField")}</AntButton></>:<>{directions().map(([value,label])=>{const targets=selectedKeys.map(r=>adjacentRegion(sheet,regionAddress(r),value)),invalid=targets.filter(t=>!t).length;return <AntButton type="text" htmlType="button" role="menuitem" key={value} disabled={invalid>0} onClick={()=>startField(value)}><span>{multiSelected?pt("production.addAsKeysInBulk"):pt("production.addAsKey")}（{label}）</span><small>{invalid?pt("production.outOfBounds", { v0: multiSelected?pt("production.batchSuffix2", { v0: invalid }):'' }):multiSelected?pt("production.fields3", { v0: targets.length }):targets[0]}</small></AntButton>;})}{!multiSelected&&<><hr/><AntButton type="text" htmlType="button" role="menuitem" onClick={startObject}><Plus size={15}/>{pt("production.addAsObjectKey")}</AntButton></>}</>}
    </div>}
    {batch&&<Modal title={pt("production.addRegularKeysInBulk")} subtitle={pt("production.keysSelectedReadingForAllWithStringAs", { v0: batch.fields.length, v1: directions().find(([value])=>value===batch.direction)[1] })} wide onClose={()=>{setBatch(null);setError('');}}>
      <div className="form-body quality-property-confirm"><div className="quality-preview-table"><table><thead><tr><th>{pt("production.keyLocation")}</th><th>{pt("production.fieldName")}</th><th>{pt("production.valueRange")}</th><th>{pt("production.type")}</th></tr></thead><tbody>{batch.fields.map((field,i)=><tr key={field.id}><td>{field.labelRegion}</td><td><AntInput aria-label={pt("production.fieldName2", { v0: field.labelRegion })} value={field.name} maxLength={60} onChange={e=>setBatch(v=>({...v,fields:v.fields.map((f,j)=>j===i?{...f,name:e.target.value}:f)}))}/></td><td>{field.valueRegion}</td><td>{pt("production.string")}</td></tr>)}</tbody></table></div>{error&&<p className="form-error" role="alert">{productionMessage(error)}</p>}</div>
      <div className="modal-footer"><Button onClick={()=>{setBatch(null);setError('');}}>{pt("production.cancelAddition")}</Button><Button kind="primary" onClick={finishBatch}>{pt("production.confirmBulkAddition")}</Button></div>
    </Modal>}
    {wizard?.step==='confirm'&&<Modal title={pt("production.confirmObjectProperties")} subtitle={pt("production.addTheseFieldsAsObjectProperties", { v0: wizard.properties.length })} wide={wizard.headerMode==='multi'} onClose={cancelWizard}><div className="form-body quality-property-confirm"><label>{pt("production.objectKeyName")}<AntInput aria-label={pt("production.objectKeyName")} value={wizard.name} maxLength={60} onChange={e=>setWizard(v=>({...v,name:e.target.value}))}/></label>{wizard.properties.length===1&&wizard.headerMode!=='multi'?<label>{pt("production.propertyOrientation")}<Select aria-label={pt("production.propertyOrientation")} value={wizard.orientation} onChange={e=>setWizard(v=>({...v,orientation:e}))}><option value="horizontal">{pt("production.horizontalOneRecordPerRowBelow")}</option><option value="vertical">{pt("production.verticalOneRecordPerColumnToTheRight")}</option></Select></label>:<p className="muted">{objectOrientation(wizard)==='vertical'?pt("production.propertiesAreVerticalEachColumnToTheRight"):pt("production.propertiesAreHorizontalEachRowBelowIsA")}</p>}<table><thead><tr><th>{pt("production.location")}</th>{wizard.headerMode==='multi'&&<th>{pt("production.originalHeaderPath")}</th>}<th>{pt("production.propertyName")}</th><th>{pt("production.type")}</th></tr></thead><tbody>{wizard.properties.map((p,i)=><tr key={p.id}><td>{p.headerCell}</td>{wizard.headerMode==='multi'&&<td className="quality-header-path">{p.headerPath?.map(node=>`${node.text||pt("production.blank2")}（${node.region}）`).join(' → ')}</td>}<td><AntInput aria-label={pt("production.property", { v0: p.headerCell })} value={p.name} maxLength={60} onChange={e=>setWizard(v=>({...v,properties:v.properties.map((x,j)=>j===i?{...x,name:e.target.value}:x)}))}/></td><td>{qualityTypeLabels[p.type]}</td></tr>)}</tbody></table>{error&&<p className="form-error" role="alert">{productionMessage(error)}</p>}</div><div className="modal-footer"><Button onClick={()=>{setWizard({...wizard,step:'properties'});setRegion(null);setError('');}}>{pt("production.reselectRange")}</Button><Button onClick={cancelWizard}>{pt("production.cancelAddition")}</Button><Button kind="primary" onClick={()=>{if(!wizard.name.trim()||wizard.properties.some(p=>!p.name.trim())||new Set(wizard.properties.map(p=>p.name.trim())).size!==wizard.properties.length){setError(pt("production.enterAnObjectNamePropertyNamesCannotBe"));return;}setError('');setWizard({...wizard,step:'values'});setRegion(null);}}>{pt("production.confirmAndSelectValues")}</Button></div></Modal>}
    {wizard?.step==='preview'&&<Modal title={pt("production.objectDataPreview")} subtitle={pt("production.propertiesRecordsNow", { v0: wizard.name, v1: wizard.properties.length, v2: objectOrientation(wizard)==='vertical'?pt("production.readByLogicalColumn"):pt("production.readByLogicalRow"), v3: wizardPreview.results[0].rows.length })} wide onClose={()=>setWizard({...wizard,step:'values'})}><div className="form-body"><ObjectTerminationRules field={wizard} onChange={change=>{setWizard(v=>({...v,...change}));setError('');}}/><PreviewTable field={objectField(wizard,wizard.valueRegion)} preview={wizardPreview}/>{wizardPreview.issues.map((issue,i)=><p className="form-error" key={i}>{productionMessage(issue.message)}</p>)}{error&&<p role="alert" className="form-error">{productionMessage(error)}</p>}</div><div className="modal-footer"><Button onClick={()=>{setWizard({...wizard,step:'values'});setRegion(null);}}>{pt("production.reselectValueRange")}</Button><Button kind="primary" onClick={finishObject}>{pt("production.finishObjectConfiguration")}</Button></div></Modal>}
    {showPreview&&<Modal title={pt("production.templateParsePreview")} subtitle={pt("production.validatesTheSampleOnlyNoOfficialAcceptanceRecord")} wide onClose={()=>setShowPreview(false)}><div className="form-body"><WorkbookResults definition={form.definition} preview={preview} compact/>{preview?.issues.map((issue,i)=><p className="form-error" key={i}>{issue.sheetName?`${issue.sheetName}!`:''}{issue.region}：{productionMessage(issue.message)}</p>)}</div></Modal>}
  </section>;
}
