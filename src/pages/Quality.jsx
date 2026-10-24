import { Input as AntInput, Button as AntButton, Checkbox as AntCheckbox } from 'antd';

import { parseQualityFile, designQualityFile } from '../quality-local.js';
import { QualityChecksEditor } from './QualityChecksEditor.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FileSpreadsheet, Plus, Upload, Download, Save, Check, X, MousePointer2 } from 'lucide-react';
import { api } from '../api.js';
import { PageHeading, Button, Modal, Badge } from '../components/common.jsx';
import { Select } from '../Dropdown.jsx';
import { usePermissions } from '../permissions.jsx';
import { adjacentRegion, cellAddress, containsCell, logicalRegion, objectHeaders, objectOrientation, objectRecords, parseRegion, previewDefinition, qualityTypeLabels, regionAddress, regionText, validateDefinition } from '../../shared/quality-template.js';
import { TypeRules, ObjectProperties, ObjectTerminationRules, RuleSection } from './QualityFieldRules.jsx';
import { sheetPreviewBounds } from '../../shared/quality-sheet-view.js';
import { downloadExcel, fetchQualityExcel, PreviewTable, WorkbookResults, QualityNavigation } from './quality-shared.jsx';
import { designerDefinition } from '../../shared/quality-designer.js';
import { QualityTemplateDesigner } from './QualityTemplateDesigner.jsx';
import { QualityAcceptances } from './QualityAcceptances.jsx';
import { QualityCharts } from './QualityCharts.jsx';
import '../quality.css';

const uid = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join('-');
const directions = [['up','上'],['down','下'],['left','左'],['right','右']];
const editable = t => ({name:t.name,note:t.note||'',definition:t.definition});
export function Quality({data,onConfigure,initialArea='templates'}) {
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
    const navigate=e=>{if(interrupted&&!window.confirm('模板尚有未保存或未完成的配置，确定离开？'))e.preventDefault();};
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
    }catch(e){setError(wizard?.step==='properties'?`当前为第 1 步（选择属性表头），本次选区 ${region}。${e.message}`:e.message);}
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
  const requireIdle=()=>{if(fieldDraft){setError('请先完成或取消当前字段配置。');return false;}return true;};
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
      if(existing){setError(`${regionAddress(existing)} 已配置 Key，请按住 Shift 点击取消选中后重试。`);return;}
      const fields=selectedKeys.map(r=>{
        const labelRegion=regionAddress(r);
        return {id:uid(),name:regionText(sheet,labelRegion).slice(0,60),labelRegion,labelText:regionText(sheet,labelRegion),valueRegion:adjacentRegion(sheet,labelRegion,direction),type:'string',direction,selectionMode:'direction',configured:true,required:false};
      });
      if(fields.some(f=>!f.valueRegion)){setError('所选方向存在超出工作表边界的 Key，请调整选择。');return;}
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
      updateDefinition(definition);setSelectedId(batch.fields[0].id);setMessage(`已批量添加 ${batch.fields.length} 个普通 Key，默认均为字符串，可分别编辑。`);setBatch(null);setRegion(null);setError('');
    }catch(e){setError(e.message);}
  };
  const finishField=()=>{
    try{const definition=validateDefinition({...form.definition,fields:form.definition.fields.some(f=>f.id===fieldDraft.id)?form.definition.fields.map(f=>f.id===fieldDraft.id?{...fieldDraft,configured:true}:f):[...form.definition.fields,{...fieldDraft,configured:true}]},workbook);
      updateDefinition(definition);setFieldDraft(null);setPicking(false);setError('');setMessage('字段配置已更新，可继续编辑其他字段或保存模板草稿。');
    }catch(e){setError(e.message);}
  };
  const finishObject=()=>{
    try{
      const definition=validateDefinition({...form.definition,fields:[...form.definition.fields.filter(f=>f.id!==wizard.id),objectField(wizard,wizard.valueRegion)]},workbook);
      const field=definition.fields.find(f=>f.id===wizard.id);
      if(wizard.editorDraft){setFieldDraft(field);setFieldTab('config');}
      else{
        updateDefinition({...form.definition,fields:form.definition.fields.some(f=>f.id===field.id)?form.definition.fields.map(f=>f.id===field.id?field:f):[...form.definition.fields,field]});
        setMessage(`已添加对象“${field.name}”，可继续编辑属性规则。`);
      }
      setSelectedId(field.id);setWizard(null);setRegion(parseRegion(field.labelRegion));setError('');
    }catch(e){setError(e.message);}
  };
  const cancelField=()=>{
    const original=form.definition.fields.find(f=>f.id===fieldDraft.id);
    if(original&&JSON.stringify(original)!==JSON.stringify(fieldDraft)&&!window.confirm('当前字段的修改尚未应用，确定放弃修改并返回字段列表？'))return;
    setFieldDraft(null);setPicking(false);setError('');
  };
  const cancelWizard=()=>{
    if(wizard?.editorDraft){setFieldDraft(wizard.editorDraft);setFieldTab('config');setRegion(parseRegion(wizard.editorDraft.labelRegion));}
    else setRegion(null);
    setWizard(null);setError('');
  };
  const persist=async()=>{
    if(wizard||fieldDraft||picking||batch)throw new Error('请先完成或取消当前配置。');
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
    saved.current='';requestRef.current=null;setRegion(null);setBatch(null);setFieldDraft(null);setWizard(null);setMessage('已读取 Excel，可直接添加自定义 Key，或右键单元格添加字段或对象 Key；按住 Shift 点选多个普通 Key 可批量添加。');
  });
  const open=id=>run(async()=>apply(await api(`/quality/templates/${id}`)));
  const openDesigner=(blank=false)=>run(async()=>{
    if(!blank&&(wizard||fieldDraft||picking||batch))throw new Error('请先完成或取消当前字段配置。');
    const file=blank?null:sourceFile||await fetchQualityExcel(`/templates/${form.id}/draft/download`);
    const {model}=await designQualityFile(file,{action:'load'});
    setDesigner({file,model,hasFields:!blank&&!!form?.definition.fields.length});
  });
  const applyDesigner=({commands,definition:starter,keepFields,name})=>run(async()=>{
    name=name.trim();if(!name||name.length>60)throw new Error('请输入 1–60 字模板名称。');
    const filename=`${name.replace(/[\x00-\x1f\x7f/\\]/g,'_')}.xlsx`;
    const result=await designQualityFile(designer.file,{action:'save',commands,filename});
    const base=form?.definition||starter||{schemaVersion:1,sheetName:designer.model.sheets[0].name,fields:[]};
    const mapped=designerDefinition(base,commands);
    let definition;
    try{definition=validateDefinition(keepFields?mapped:{schemaVersion:1,sheetName:mapped.sheetName,fields:[]},result.workbook);}
    catch(e){throw new Error(`表格与现有字段配置不一致：${e.message} 请调整表格，或取消“保留字段配置”后重新配置。`);}
    setWorkbook(result.workbook);setSourceFile(result.file);setForm(v=>({...v,name,note:v?.note||'',filename:result.filename,definition,revisions:v?.revisions||[]}));
    setDesigner(null);setRegion(null);setSelectedId(null);setFieldDraft(null);setWizard(null);setBatch(null);setMenu(null);requestRef.current=null;
    setMessage('表格已生成，可继续配置字段并保存草稿；保存后再发布，供在线填写验收单。');
  });
  const close=()=>{if(interrupted&&!window.confirm('配置尚未保存，确定返回列表？'))return;setForm(null);setWorkbook(null);setFieldDraft(null);setWizard(null);setBatch(null);setRegion(null);setSourceFile(null);setMenu(null);setError('');setMessage('');setRevision(v=>v+1);};
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
      return <td key={col} data-address={address} aria-label={`${address} ${sheet.cells[address]?.text||'空白'}`} className={classes} rowSpan={r.r2-r.r1+1} colSpan={r.c2-r.c1+1}
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
    ? `值区域须覆盖第 ${wizardHeaders.r1}～${wizardHeaders.r2} 行，位于 ${cellAddress(1,wizardHeaders.c2).replace('1','')} 列右侧，每列一条记录。`
    : `值区域须覆盖 ${cellAddress(1,wizardHeaders.c1).replace('1','')}～${cellAddress(1,wizardHeaders.c2).replace('1','')} 列，位于第 ${wizardHeaders.r2} 行下方，每行一条记录。`);

  if(area==='acceptances')return <QualityAcceptances data={data} onTemplates={()=>setArea('templates')} onAreaChange={setArea}/>;
  if(area==='charts')return <section className="quality-page"><QualityCharts data={data} onAreaChange={setArea}/></section>;
  if(designer)return <QualityTemplateDesigner designer={designer} name={form?.name} busy={busy} error={error} onApply={applyDesigner} onClose={()=>{setDesigner(null);setError('');}}/>;
  return <section className="quality-page">
    <input ref={replaceInputRef} type="file" accept=".xlsx" hidden onChange={e=>{const file=e.target.files[0];e.target.value='';if(file)void run(async()=>{const body=new FormData();body.append('file',file);body.append('version',String(form.version));apply(await api(`/quality/templates/${form.id}/file`,{method:'POST',body}));setMessage('草稿已更换原始 Excel，请重新配置字段；已发布版本保留。');});}}/>
    <input ref={inputRef} aria-label="上传模板 Excel" type="file" accept=".xlsx" hidden onChange={e=>{const file=e.target.files[0];e.target.value='';if(file)void importFile(file);}}/>
    {!form?<>
      <QualityNavigation area="templates" onChange={setArea} disabled={busy}/>
      <PageHeading title="品质管理" description="在线制作模板、填写验收单，或导入已有 Excel，保留验收数据及文件。"><Button kind="primary" icon={Plus} busy={busy} onClick={()=>openDesigner(true)}>在线新建模板</Button><Button icon={Upload} busy={busy} onClick={()=>inputRef.current.click()}>上传 Excel 新建模板</Button></PageHeading>
      {storage&&!storage.ready&&<div className="info-box quality-storage">尚未配置 R2，可以先在线制作模板或上传预览并配置字段；保存前需管理员完成 R2 连接设置。{user?.role==='admin'&&<Button onClick={onConfigure}>配置 R2</Button>}</div>}
      <section className="panel"><div className="table-toolbar quality-list-toolbar"><h2>验收单模板</h2><div className="quality-toolbar quality-list-filters"><AntInput aria-label="搜索验收单模板" placeholder="搜索模板名称" value={q} onChange={e=>{setQ(e.target.value);setOffset(0);}}/><Select aria-label="模板状态" value={status} onChange={e=>{setStatus(e);setOffset(0);}}>{[['all','全部状态'],['draft','草稿'],['enabled','已启用'],['disabled','已停用']].map(([v,t])=><option key={v} value={v}>{t}</option>)}</Select></div></div>
      <div className="quality-list-scroll"><table className="quality-list"><colgroup><col/><col/><col/><col/><col/><col className="quality-list-action-column"/></colgroup><thead><tr><th>模板名称</th><th>原始文件 / 工作表</th><th>字段</th><th>状态</th><th>更新人</th><th>操作</th></tr></thead><tbody>{list.map(t=><tr key={t.id}><td><strong>{t.name}</strong>{t.has_draft&&t.revision&&<small>有未发布草稿</small>}</td><td>{t.filename}<small>{t.sheetName}</small></td><td>{t.fields}</td><td><Badge tone={t.enabled?'green':'orange'}>{t.status==='draft'?'草稿':t.enabled?`已启用 v${t.revision}`:'已停用'}</Badge></td><td>{t.updated_by_name}<small>{new Date(t.updated_at).toLocaleString()}</small></td><td><div className="quality-actions"><Button disabled={busy} onClick={()=>open(t.id)}>编辑</Button><Button disabled={busy||!t.enabled} onClick={()=>run(()=>downloadExcel(`/templates/${t.id}/download`))}>下载 Excel</Button><Button disabled={busy} onClick={()=>run(async()=>apply(await api(`/quality/templates/${t.id}/copy`,{method:'POST',body:{}})))}>复制</Button>{t.revision&&<Button disabled={busy} onClick={()=>run(async()=>{await api(`/quality/templates/${t.id}/status`,{method:'POST',body:{version:t.version,enabled:!t.enabled}});setRevision(v=>v+1);})}>{t.enabled?'停用':'启用'}</Button>}</div></td></tr>)}</tbody></table></div>
      {!list.length&&<div className="quality-empty"><FileSpreadsheet size={30}/><p>暂无匹配的验收单模板</p><Button onClick={()=>inputRef.current.click()}>选择 Excel 文件</Button></div>}
      {total>20&&<div className="quality-toolbar quality-pagination"><Button disabled={offset===0} onClick={()=>setOffset(v=>v-20)}>上一页</Button><span>{offset+1}–{Math.min(offset+20,total)} / {total}</span><Button disabled={offset+20>=total} onClick={()=>setOffset(v=>v+20)}>下一页</Button></div>}
      </section>
    </>:<>
      <div className="quality-heading"><div><Button icon={ArrowLeft} disabled={busy} onClick={close}>返回模板列表</Button><h1>{form.id?'编辑验收单模板':'新建验收单模板'}</h1><span className="muted">{dirty?'有未保存修改':form.enabled?'已启用':'草稿'}{form.revisions?.length?` · 已发布 ${form.revisions.length} 个版本`:''}</span></div><div className="quality-actions">
        <Button disabled={busy||!!wizard||!!fieldDraft||picking||!!batch} onClick={()=>openDesigner()}>编辑表格内容与格式</Button>
        <Button icon={Download} disabled={busy||!form.id} onClick={()=>run(()=>downloadExcel(`/templates/${form.id}/draft/download`))}>下载原始 Excel</Button>
        <Button icon={Save} busy={busy} disabled={!!wizard||!!fieldDraft||picking||!!batch} onClick={()=>run(async()=>{await persist();setMessage('模板草稿已保存，原始 Excel 保留在 R2。');})}>保存草稿</Button>
        <Button kind="primary" icon={Check} disabled={busy||!!wizard||!!fieldDraft||picking||!!batch||!!form.published_revision&&!dirty&&!form.has_draft} onClick={()=>run(async()=>{const current=dirty?await persist():form;const result=await api(`/quality/templates/${current.id}/publish`,{method:'POST',body:{version:current.version}});apply(result);setMessage('模板已启用，用户可以下载原始 Excel 填写。');})}>{form.published_revision?'发布新版本':'启用模板'}</Button>
      </div></div>
      <div className="quality-toolbar"><Button disabled={busy||!!wizard||!!fieldDraft||!!batch||picking} onClick={()=>configInputRef.current.click()}>导入字段配置</Button><span className="muted">读取已准备好的模板 JSON 配置，校验通过后替换当前草稿字段，原 Excel 不变。</span></div>
      <input ref={configInputRef} type="file" accept=".json" hidden aria-label="导入模板字段配置" onChange={event=>{const file=event.target.files[0];event.target.value='';if(!file)return;void run(async()=>{
        if(file.size>2*1024*1024)throw new Error('字段配置不能超过 2 MB。');
        const definition=validateDefinition(JSON.parse(await file.text()),workbook);
        if(form.definition.fields.length&&!window.confirm('导入配置将替换当前草稿字段，是否继续？'))return;
        updateDefinition(definition);setSelectedId(null);setRegion(null);setMessage('字段配置已导入，请查看样表解析预览并核对后保存、启用。');
      });}}/>
      <div className="panel quality-meta"><label>模板名称<AntInput value={form.name} maxLength={60} disabled={busy||!!wizard} onChange={e=>setForm(v=>({...v,name:e.target.value}))}/></label><label>说明<AntInput value={form.note||''} maxLength={1000} disabled={busy||!!wizard} onChange={e=>setForm(v=>({...v,note:e.target.value}))}/></label><label>工作表<Select aria-label="模板工作表" value={form.definition.sheetName} disabled={busy||!!wizard||!!fieldDraft||!!batch||picking} onChange={e=>{if(form.definition.fields.length&&!window.confirm('切换工作表会清空当前草稿字段，是否继续？'))return;updateDefinition({schemaVersion:1,sheetName:e,fields:[]});setSelectedId(null);setRegion(null);setMenu(null);}}>{workbook.sheets.map(s=><option key={s.name}>{s.name}</option>)}</Select></label><span className="quality-file"><FileSpreadsheet size={18}/>{form.filename}{form.id&&<Button disabled={busy||!!wizard||!!fieldDraft} onClick={()=>{if(window.confirm('更换 Excel 将清空草稿字段和未保存修改，已发布版本保留。是否继续？'))replaceInputRef.current.click();}}>更换原始 Excel</Button>}</span></div>

      <QualityChecksEditor definition={form.definition} onChange={updateDefinition} disabled={busy||!!wizard||!!fieldDraft||!!batch||picking}/>
      {storage&&!storage.ready&&<div className="info-box quality-storage">原始 Excel 保存需要 R2 连接配置。{user?.role==='admin'&&<Button onClick={onConfigure}>配置 R2</Button>}</div>}
      {wizard&&<div className="quality-wizard-banner" role="status"><span><strong>对象 Key：{wizard.name||'未命名'}</strong> · {wizard.step==='properties'?(wizard.headerMode==='multi'?'第 1 步：仅框选完整的多级表头，不含明细数据':'第 1 步：仅框选属性表头（连续单行或单列），不含明细数据'):wizard.step==='confirm'?'第 2 步：确认对象属性':wizard.step==='values'?(objectOrientation(wizard)==='vertical'?'第 3 步：请框选属性列右侧的值区域，起止行与属性区一致，每列一条记录':'第 3 步：请框选属性行下方的值区域，起止列与属性区一致，每行一条记录'):'第 4 步：预览并完成'}</span><div className="quality-actions">{wizard.step==='values'&&<Button onClick={()=>{setWizard({...wizard,step:'properties'});setRegion(null);setError('');}}>返回重选属性</Button>}<Button onClick={cancelWizard}>{wizard.editorDraft?'取消重选':'取消添加对象'}</Button></div></div>}
      {wizard?.step==='properties'&&<div className="panel quality-header-options"><label>表头模式<Select aria-label="对象表头模式" value={wizard.headerMode||'single'} onChange={event=>{setWizard({...wizard,headerMode:event,orientation:wizard.orientation||'horizontal'});setRegion(null);setError('');}}><option value="single">普通表头（单行或单列逻辑格）</option><option value="multi">多级表头（完整表头区域）</option></Select></label>{wizard.headerMode==='multi'&&<><label>排列方向<Select aria-label="多级表头排列方向" value={wizard.orientation||'horizontal'} onChange={event=>{setWizard({...wizard,orientation:event});setRegion(null);setError('');}}><option value="horizontal">横向表头：下方每行一条记录</option><option value="vertical">竖向表头：右侧每列一条记录</option></Select></label><p className="muted">框选完整的多级表头，按末级列或行生成独立属性；上级分组保留在属性名称中，确认后再框选取值区域。默认均为字符串，可继续修改类型。</p></>}</div>}
      {wizard?.step==='properties'&&<p className="muted quality-header-key-hint">本步只选择属性名称所在的表头；松开鼠标后确认属性，再进入选择值区域。对象 Key 的单元格也可以同时作为属性表头，需要读取时请一并框选。</p>}
      {wizardHeaders&&<ObjectTerminationRules field={wizard} onChange={change=>{setWizard(v=>({...v,...change}));setError('');}}/>}
      {wizardHeaders&&<div className="info-box quality-range-guide" role="note" aria-label="对象值区域要求"><strong>第 3 步：选择明细值区域<br/>已确认表头：{wizard.propertyRegion}</strong><p>{wizardValueRequirement}{wizard.termination?'从框选区域起点按终止策略读取。':'记录范围由你框选，请排除不属于明细的备注、合计行。'}</p></div>}
      {error&&wizard&&['properties','values'].includes(wizard.step)&&<div ref={selectionErrorRef} className="form-error quality-notice quality-selection-error" role="alert">{error}</div>}
      {picking&&<div className="quality-wizard-banner" role="status">请在表格中拖选取值区域，松开鼠标后写入。<Button onClick={()=>setPicking(false)}>取消框选</Button></div>}
      <div className={`quality-editor${fieldDraft?' quality-editing-field':''}`}><section className="panel quality-sheet-panel"><div className="quality-grid-toolbar"><span>{sheet.name} <span className="muted">{multiSelected?`已选择 ${selectedKeys.length} 个 Key`:selection?regionAddress(selection):'右键单元格添加字段'}</span></span><div className="quality-actions">{multiSelected&&<Button onClick={()=>setRegion(null)}>清除多选</Button>}<Button icon={MousePointer2} disabled={!selection||busy||!!wizard||picking} onClick={e=>{const r=e.currentTarget.getBoundingClientRect();setMenu({x:Math.min(r.left,window.innerWidth-260),y:Math.min(r.bottom,window.innerHeight-280)});}}>添加字段</Button></div></div>
        <div className="quality-sheet-scroll" ref={sheetRef}><table className="quality-grid" tabIndex={0} onKeyDown={e=>{
          if(busy||wizard||picking||fieldDraft||batch)return;
          const keys={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'};
          if(keys[e.key]){e.preventDefault();const next=selection?adjacentRegion(sheet,regionAddress(selection),keys[e.key]):'A1';if(next){const r=parseRegion(next);setRegion(r);sheetRef.current.querySelector(`[data-address="${cellAddress(r.r1,r.c1)}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});}}
          if((e.key==='Enter'||e.key==='F10'&&e.shiftKey)&&selection){e.preventDefault();const r=sheetRef.current.getBoundingClientRect();setMenu({x:Math.min(r.left+30,window.innerWidth-260),y:Math.min(r.top+40,window.innerHeight-280)});}
        }} aria-label="Excel 模板表格"><colgroup><col style={{width:32}}/>{sheetView.widths.map((width,i)=><col key={i} style={{width:`calc((100% - 32px) * ${width/sheetView.widths.reduce((a,b)=>a+b,0)})`}}/>)}</colgroup><thead><tr><th></th>{Array.from({length:sheetView.cols},(_,i)=><th key={i}>{cellAddress(1,i+1).replace('1','')}</th>)}</tr></thead><tbody>{cells()}</tbody></table></div><div className="quality-legend"><span>蓝色：Key</span><span>橙色：对象属性</span><span>绿色：取值区域</span><span>按住 Shift 点选多个普通 Key，再右键批量添加；再次点选可取消。</span></div>
      </section><aside className={`panel quality-fields${fieldDraft?' quality-fields-detail':''}`} aria-label={fieldDraft?'字段独立编辑':'字段列表'}>
        {fieldDraft?<>
          <div className="quality-field-detail-heading"><Button icon={ArrowLeft} onClick={cancelField}>返回字段列表</Button><div><h2>{fieldDraft.name||'未命名字段'}</h2><small>{qualityTypeLabels[fieldDraft.type]} · {fieldDraft.customKey?'自定义 Key':`Key ${fieldDraft.labelRegion}`}</small></div></div>
          <div className="quality-field-tabs" role="tablist" aria-label="字段编辑视图">{[['config','字段设置'],['preview','解析预览']].map(([id,label])=><AntButton type="default" key={id} htmlType="button" id={`quality-field-tab-${id}`} role="tab" aria-selected={fieldTab===id} aria-controls="quality-field-editor-content" onClick={()=>setFieldTab(id)}>{label}</AntButton>)}</div>
          <div className="quality-field-body" id="quality-field-editor-content" role="tabpanel" aria-labelledby={`quality-field-tab-${fieldTab}`}>
            <div className="quality-field-form" key={fieldDraft.id} hidden={fieldTab!=='config'}>
              {fieldDraft.type==='object'?<>
                <RuleSection title="基本信息">
                  <label>字段名称<AntInput aria-label="字段名称" value={fieldDraft.name} maxLength={60} onChange={e=>setFieldDraft(v=>({...v,name:e.target.value}))}/></label>
                <p className="quality-field-regions">{fieldDraft.headerMode==='multi'&&<>多级表头 · {objectOrientation(fieldDraft)==='vertical'?'竖向':'横向'}<br/></>}属性字段：{fieldDraft.propertyRegion}<br/>属性值区域：{fieldDraft.valueRegion}</p>
                <Button onClick={()=>{const previous=fieldDraft;setFieldDraft(null);setWizard({...previous,editorDraft:previous,previousProperties:previous.properties,step:'properties'});setRegion(null);}}>重新选择属性和值区域</Button>
                <AntCheckbox className="quality-check" checked={!!fieldDraft.required} onChange={e=>setFieldDraft(v=>({...v,required:e.target.checked}))}>至少填写一条记录</AntCheckbox>
                </RuleSection>
                <ObjectTerminationRules field={fieldDraft} onChange={change=>setFieldDraft(v=>({...v,...change}))}/>
                <ObjectProperties key={fieldDraft.id} field={fieldDraft} sourceTexts={fieldSourceTexts} uniqueKeyOwner={uniqueKeyOwner} onChange={change=>setFieldDraft(v=>({...v,...change}))}/>
              </>:<TypeRules field={fieldDraft} sourceTexts={fieldSourceTexts[fieldDraft.id]} uniqueKeyOwner={uniqueKeyOwner} onChange={change=>setFieldDraft(v=>({...v,...change}))}>
                <label>字段名称<AntInput aria-label="字段名称" placeholder={fieldDraft.customKey?'例如：公司名':undefined} value={fieldDraft.name} maxLength={60} onChange={e=>setFieldDraft(v=>({...v,name:e.target.value}))}/></label>
                {fieldDraft.customKey&&<p className="muted">无需选择标题单元格，填写字段名称并指定内容所在的取值区域即可。</p>}
                <label>取值区域<div className="quality-inline"><AntInput aria-label="取值区域" value={fieldDraft.valueRegion} onChange={e=>setFieldDraft(v=>({...v,valueRegion:e.target.value.toUpperCase(),direction:null,selectionMode:'manual'}))}/><Button disabled={picking} onClick={()=>setPicking(true)}>框选</Button></div></label>
              </TypeRules>}
            </div>
            {fieldTab==='preview'&&<div className="quality-field-preview"><PreviewTable field={fieldDraft} preview={activePreview} resultFirst/>{activePreview?.issues.map((issue,i)=><p key={i} className="form-error">{issue.region}：{issue.message}</p>)}</div>}
            {error&&<p className="form-error quality-field-error" role="alert">{error}</p>}
          </div>
          <div className="quality-field-detail-actions">{fieldDraft.customKey&&form.definition.fields.some(f=>f.id===fieldDraft.id)&&<Button onClick={()=>{updateDefinition({...form.definition,fields:form.definition.fields.filter(f=>f.id!==fieldDraft.id)});setFieldDraft(null);setSelectedId(null);setPicking(false);setRegion(null);setError('');}}>移除字段</Button>}<Button onClick={cancelField}>取消编辑</Button><Button kind="primary" disabled={picking} onClick={finishField}>完成配置</Button></div>
        </>:<>
          <div className="quality-fields-heading"><h2>字段配置</h2><span>{form.definition.fields.filter(f=>f.configured!==false).length} / {form.definition.fields.length} 已配置</span></div>
          <div className="quality-custom-key-actions"><Button icon={Plus} disabled={busy||!!wizard||picking||!!batch} onClick={startCustomField}>添加自定义 Key</Button></div>
          <div className="quality-field-list">{!form.definition.fields.length&&<p className="muted">可直接添加自定义 Key 并指定取值区域；也可在表格中右键单元格，添加普通 Key 或对象 Key。</p>}{form.definition.fields.map(f=><AntButton type="text" key={f.id} htmlType="button" disabled={!!wizard||picking} className={selectedId===f.id?'quality-field active':'quality-field'} onClick={()=>editField(f)}><span>{f.name||'未命名字段'}<small>{qualityTypeLabels[f.type]} · {f.valueRegion}{f.type==='object'?` · ${f.properties.length} 个属性`:''}</small></span><span>{f.configured===false?'待配置':'已配置'}</span></AntButton>)}</div>
          <div className="quality-bottom-actions"><Button disabled={!form.definition.fields.length||!!wizard} onClick={()=>setShowPreview(true)}>查看完整解析预览</Button></div>
        </>}
      </aside></div>
      {form.revisions?.length>0&&<details className="panel quality-history"><summary>已发布版本与原始 Excel</summary>{form.revisions.map(r=><div className="quality-history-row" key={r.id}><span>v{r.revision} · {r.name} · {r.created_by_name} · {new Date(r.created_at).toLocaleString()}</span><Button disabled={busy} onClick={()=>run(()=>downloadExcel(`/templates/${form.id}/revisions/${r.id}/download`))}>下载此版本 Excel</Button></div>)}</details>}
    </>}
    {error&&!batch&&!fieldDraft&&!wizard&&<div className="form-error quality-notice" role="alert">{error}</div>}{message&&<div className="quality-notice quality-success" role="status">{message}</div>}
    {menu&&<div className="quality-context-menu" ref={menuRef} role="menu" aria-label="添加模板字段" style={{left:Math.max(8,menu.x),top:Math.max(8,menu.y)}}>
      {menuExisting?<><AntButton type="default" htmlType="button" role="menuitem" onClick={()=>{setMenu(null);editField(menuExisting);}}>编辑{menuExisting.type==='object'?'对象':'字段'} Key</AntButton><AntButton type="default" htmlType="button" role="menuitem" onClick={()=>{if(!requireIdle()){setMenu(null);return;}updateDefinition({...form.definition,fields:form.definition.fields.filter(f=>f.id!==menuExisting.id)});setMenu(null);setSelectedId(null);}}>移除字段</AntButton></>:<>{directions.map(([value,label])=>{const targets=selectedKeys.map(r=>adjacentRegion(sheet,regionAddress(r),value)),invalid=targets.filter(t=>!t).length;return <AntButton type="default" htmlType="button" role="menuitem" key={value} disabled={invalid>0} onClick={()=>startField(value)}><span>{multiSelected?'批量添加为 Key':'添加为 Key'}（{label}）</span><small>{invalid?`超出边界${multiSelected?`（${invalid} 个）`:''}`:multiSelected?`${targets.length} 个字段`:targets[0]}</small></AntButton>;})}{!multiSelected&&<><hr/><AntButton type="default" htmlType="button" role="menuitem" onClick={startObject}><Plus size={15}/>添加为对象 Key</AntButton></>}</>}
    </div>}
    {batch&&<Modal title="批量添加普通 Key" subtitle={`已选择 ${batch.fields.length} 个 Key，统一向${directions.find(([value])=>value===batch.direction)[1]}取值，默认类型为字符串。`} wide onClose={()=>{setBatch(null);setError('');}}>
      <div className="form-body quality-property-confirm"><div className="quality-preview-table"><table><thead><tr><th>Key 位置</th><th>字段名称</th><th>取值区域</th><th>类型</th></tr></thead><tbody>{batch.fields.map((field,i)=><tr key={field.id}><td>{field.labelRegion}</td><td><AntInput aria-label={`字段名称 ${field.labelRegion}`} value={field.name} maxLength={60} onChange={e=>setBatch(v=>({...v,fields:v.fields.map((f,j)=>j===i?{...f,name:e.target.value}:f)}))}/></td><td>{field.valueRegion}</td><td>字符串</td></tr>)}</tbody></table></div>{error&&<p className="form-error" role="alert">{error}</p>}</div>
      <div className="modal-footer"><Button onClick={()=>{setBatch(null);setError('');}}>取消添加</Button><Button kind="primary" onClick={finishBatch}>确认批量添加</Button></div>
    </Modal>}
    {wizard?.step==='confirm'&&<Modal title="确认对象属性" subtitle={`是否将以下 ${wizard.properties.length} 个字段添加为对象属性？`} wide={wizard.headerMode==='multi'} onClose={cancelWizard}><div className="form-body quality-property-confirm"><label>对象 Key 名称<AntInput aria-label="对象 Key 名称" value={wizard.name} maxLength={60} onChange={e=>setWizard(v=>({...v,name:e.target.value}))}/></label>{wizard.properties.length===1&&wizard.headerMode!=='multi'?<label>属性排列<Select aria-label="属性排列" value={wizard.orientation} onChange={e=>setWizard(v=>({...v,orientation:e}))}><option value="horizontal">横向：下方每行一条记录</option><option value="vertical">竖向：右侧每列一条记录</option></Select></label>:<p className="muted">{objectOrientation(wizard)==='vertical'?'属性竖向排列，右侧每列一条记录。':'属性横向排列，下方每行一条记录。'}</p>}<table><thead><tr><th>位置</th>{wizard.headerMode==='multi'&&<th>原始表头路径</th>}<th>属性名称</th><th>类型</th></tr></thead><tbody>{wizard.properties.map((p,i)=><tr key={p.id}><td>{p.headerCell}</td>{wizard.headerMode==='multi'&&<td className="quality-header-path">{p.headerPath?.map(node=>`${node.text||'（空白）'}（${node.region}）`).join(' → ')}</td>}<td><AntInput aria-label={`属性 ${p.headerCell}`} value={p.name} maxLength={60} onChange={e=>setWizard(v=>({...v,properties:v.properties.map((x,j)=>j===i?{...x,name:e.target.value}:x)}))}/></td><td>{qualityTypeLabels[p.type]}</td></tr>)}</tbody></table>{error&&<p className="form-error" role="alert">{error}</p>}</div><div className="modal-footer"><Button onClick={()=>{setWizard({...wizard,step:'properties'});setRegion(null);setError('');}}>重新框选</Button><Button onClick={cancelWizard}>取消添加</Button><Button kind="primary" onClick={()=>{if(!wizard.name.trim()||wizard.properties.some(p=>!p.name.trim())||new Set(wizard.properties.map(p=>p.name.trim())).size!==wizard.properties.length){setError('请填写对象名称；属性名称不能为空或重复。');return;}setError('');setWizard({...wizard,step:'values'});setRegion(null);}}>确认并选择值区域</Button></div></Modal>}
    {wizard?.step==='preview'&&<Modal title="对象数据预览" subtitle={`${wizard.name} · ${wizard.properties.length} 个属性 · ${objectOrientation(wizard)==='vertical'?'按逻辑列读取':'按逻辑行读取'} · 当前 ${wizardPreview.results[0].rows.length} 条记录`} wide onClose={()=>setWizard({...wizard,step:'values'})}><div className="form-body"><ObjectTerminationRules field={wizard} onChange={change=>{setWizard(v=>({...v,...change}));setError('');}}/><PreviewTable field={objectField(wizard,wizard.valueRegion)} preview={wizardPreview}/>{wizardPreview.issues.map((issue,i)=><p className="form-error" key={i}>{issue.message}</p>)}{error&&<p role="alert" className="form-error">{error}</p>}</div><div className="modal-footer"><Button onClick={()=>{setWizard({...wizard,step:'values'});setRegion(null);}}>重新框选值区域</Button><Button kind="primary" onClick={finishObject}>完成对象配置</Button></div></Modal>}
    {showPreview&&<Modal title="模板解析预览" subtitle="仅验证样表，不生成正式验收记录" wide onClose={()=>setShowPreview(false)}><div className="form-body"><WorkbookResults definition={form.definition} preview={preview} compact/>{preview?.issues.map((issue,i)=><p className="form-error" key={i}>{issue.sheetName?`${issue.sheetName}!`:''}{issue.region}：{issue.message}</p>)}</div></Modal>}
  </section>;
}
