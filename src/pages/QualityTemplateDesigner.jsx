import { t as pt } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { ColorPicker, ConfigProvider as AntConfigProvider } from 'antd';
import { Input as AntInput, Checkbox as AntCheckbox, Button as AntButton } from '../ui/controls.jsx';

import { Select } from './../Dropdown.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bold, Italic, Undo2, Redo2, Check } from 'lucide-react';
import { Button, PageHeading } from '../components/common.jsx';
import { cellAddress, containsCell, parseRegion, regionAddress } from '../../shared/quality-template.js';
import { changeDesigner, designerCellStyle, designerRegion, inspectionDesigner } from '../../shared/quality-designer.js';

export function QualityTemplateDesigner({designer,name,busy,error,onApply,onClose}) {
  useLocale();
  const [state,setState]=useState(()=>({model:designer.model,commands:[],past:[],future:[]}));
  const [sheetName,setSheetName]=useState(designer.model.sheets[0].name),[selection,setSelection]=useState(parseRegion('A1'));
  const [range,setRange]=useState('A1'),[localError,setError]=useState(''),[templateName,setName]=useState(name||pt("production.untitledInspectionTemplate"));
  const [sheetTitle,setSheetTitle]=useState(sheetName),[size,setSize]=useState({rows:designer.model.sheets[0].rows,cols:designer.model.sheets[0].cols});
  const [keepFields,setKeepFields]=useState(true),[starter,setStarter]=useState(null);
  const drag=useRef(null),content=useRef(null),table=useRef(null);
  const sheet=state.model.sheets.find(sheet=>sheet.name===sheetName),address=cellAddress(selection.r1,selection.c1),cell=sheet.cells[address];
  const format=cell?.format||{},font=format.font||{},alignment=format.alignment||{};
  useEffect(()=>{setRange(regionAddress(selection));},[selection]);
  useEffect(()=>{setSheetTitle(sheet.name);setSize({rows:sheet.rows,cols:sheet.cols});},[sheet.name,sheet.rows,sheet.cols]);
  useEffect(()=>{const end=()=>{drag.current=null;};window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);return()=>{window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end);};},[]);
  const merges=useMemo(()=>{
    const result=new Map();for(const region of sheet.merges){const r=parseRegion(region);for(let row=r.r1;row<=r.r2;row++)for(let col=r.c1;col<=r.c2;col++)result.set(cellAddress(row,col),r);}return result;
  },[sheet.merges]);
  const select=region=>{try{setSelection(designerRegion(sheet,region));setError('');}catch(e){setError(e.message);}};
  const perform=operation=>{
    if(busy)return;
    try{
      const command={sheetName,region:regionAddress(selection),...operation},model=changeDesigner(state.model,command);
      const previous=state.commands.at(-1),coalesce=command.type==='text'&&previous?.type==='text'&&previous.sheetName===sheetName&&previous.region===command.region;
      const snapshot={model:state.model,commands:state.commands};
      setState({model,commands:(coalesce?state.commands.slice(0,-1):state.commands).concat(command),past:coalesce?state.past:state.past.concat(snapshot).slice(-40),future:[]});
      if(command.type==='rename')setSheetName(command.name.trim());
      if(command.type==='resize')setSelection(parseRegion('A1'));
      setError('');
    }catch(e){setError(e.message);}
  };
  const patch=patch=>perform({type:'format',patch});
  const restore=(target,from,to)=>{
    if(!target)return;
    setState({...target,past:from,future:to});setSheetName(target.model.sheets.find(s=>s.name===sheetName)?.name||target.model.sheets[0].name);setSelection(parseRegion('A1'));setError('');
  };
  const leave=()=>{if(state.commands.length&&!window.confirm(pt("production.tableEditsAreNotAppliedDiscardTheseChanges")))return;onClose();};
  const insertExample=()=>{
    if(state.commands.length&&!window.confirm(pt("production.usingTheExampleReplacesTheCurrentUnsavedTable")))return;
    const example=inspectionDesigner();setState({model:example.model,commands:example.commands,past:[],future:[]});setSheetName(example.definition.sheetName);setStarter(example.definition);setKeepFields(true);setSelection(parseRegion('A1'));setError('');
  };
  const extend=rect=>{if(!drag.current)return;const start=drag.current;select(regionAddress({r1:Math.min(start.r1,rect.r1),c1:Math.min(start.c1,rect.c1),r2:Math.max(start.r2,rect.r2),c2:Math.max(start.c2,rect.c2)}));};
  const editableText=cell?.text||'';
  return <section className="quality-page quality-designer-page">
    <PageHeading title={designer.file?pt("production.editTemplateTable"):pt("production.createTemplateOnline")} description={pt("production.editTableContentAndLayoutFirstThenConfigure")}>
      <Button icon={ArrowLeft} disabled={busy} onClick={leave}>{pt("production.back")}</Button>
      <Button kind="primary" icon={Check} busy={busy} onClick={()=>onApply({commands:state.commands,definition:starter,keepFields,name:templateName})}>{pt("production.continueToFieldConfiguration")}</Button>
    </PageHeading>
    {(localError||error)&&<p role="alert" className="form-error quality-notice">{productionMessage(localError||error)}</p>}
    <div className="panel quality-designer-meta"><label>{pt("production.templateName")}<AntInput aria-label={pt("production.templateName")} maxLength={60} disabled={busy} value={templateName} onChange={e=>setName(e.target.value)}/></label>
      <label>{pt("production.worksheet2")}<Select aria-label={pt("production.editWorksheet")} disabled={busy} value={sheetName} onChange={e=>{setSheetName(e);setSelection(parseRegion('A1'));}}>{state.model.sheets.map(sheet=><option key={sheet.name}>{sheet.name}</option>)}</Select></label>
      {!designer.file&&<Button disabled={busy} onClick={insertExample}>{pt("production.useInspectionExample")}</Button>}
      {(designer.hasFields||starter)&&<AntCheckbox className="quality-check" checked={keepFields} disabled={busy} onChange={e=>setKeepFields(e.target.checked)}>{pt("production.keepFieldConfigurationRevalidated")}</AntCheckbox>}
    </div>
    <section className="panel quality-designer" aria-label={pt("production.templateTableEditor")}>
      <AntConfigProvider componentDisabled={busy}><fieldset className="quality-designer-controls" disabled={busy}>
        <div className="quality-designer-toolbar">
          <label>{pt("production.range")}<AntInput aria-label={pt("production.selectRange2")} value={range} onChange={e=>setRange(e.target.value.toUpperCase())} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();select(range);}}}/></label><Button onClick={()=>select(range)}>{pt("production.selectRange3")}</Button>
          <Button icon={Undo2} disabled={!state.past.length} onClick={()=>restore(state.past.at(-1),state.past.slice(0,-1),[{model:state.model,commands:state.commands},...state.future])}>{pt("production.undo")}</Button>
          <Button icon={Redo2} disabled={!state.future.length} onClick={()=>restore(state.future[0],state.past.concat({model:state.model,commands:state.commands}),state.future.slice(1))}>{pt("production.redo")}</Button>
          <Button onClick={()=>perform({type:'merge'})}>{pt("production.mergeCells")}</Button><Button onClick={()=>perform({type:'unmerge'})}>{pt("production.unmerge")}</Button><Button onClick={()=>perform({type:'clear'})}>{pt("production.clearContent")}</Button>
        </div>
        <div className="quality-designer-toolbar">
          <label>{pt("production.font")}<Select aria-label={pt("production.font")} value={font.name||'微软雅黑'} onChange={e=>patch({font:{name:e}})}>{[...new Set(['微软雅黑','宋体','Arial','Calibri',font.name].filter(Boolean))].map(name=><option key={name}>{name}</option>)}</Select></label>
          <label>{pt("production.fontSize")}<AntInput type="number" aria-label={pt("production.fontSize")} min={6} max={96} defaultValue={font.size||11} key={`${sheetName}-${address}-${font.size||11}`} onBlur={e=>{if(e.target.value&&Number(e.target.value)!==(font.size||11))patch({font:{size:Number(e.target.value)}});}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label>
          <Button icon={Bold} aria-pressed={!!font.bold} onClick={()=>patch({font:{bold:!font.bold}})}>{pt("production.bold")}</Button><Button icon={Italic} aria-pressed={!!font.italic} onClick={()=>patch({font:{italic:!font.italic}})}>{pt("production.italic")}</Button>
          <label>{pt("production.horizontalAlignment")}<Select aria-label={pt("production.horizontalAlignment")} value={alignment.horizontal||'left'} onChange={e=>patch({alignment:{horizontal:e}})}>{[['left',pt("production.alignLeft")],['center',pt("production.center")],['right',pt("production.alignRight")]].map(([v,label])=><option key={v} value={v}>{label}</option>)}</Select></label>
          <label>{pt("production.verticalAlignment")}<Select aria-label={pt("production.verticalAlignment")} value={alignment.vertical||'middle'} onChange={e=>patch({alignment:{vertical:e}})}>{[['top',pt("production.top")],['middle',pt("production.center")],['bottom',pt("production.bottom")]].map(([v,label])=><option key={v} value={v}>{label}</option>)}</Select></label>
          <Button aria-pressed={!!alignment.wrapText} onClick={()=>patch({alignment:{wrapText:!alignment.wrapText}})}>{pt("production.wrapText")}</Button>
          <label>{pt("production.textColor")}<ColorPicker aria-label={pt("production.textColor")} disabledAlpha value={/^([A-F\d]{8})$/i.test(font.color?.argb||'')?`#${font.color.argb.slice(2)}`:'#24354b'} onChange={color=>patch({font:{color:{argb:`FF${color.toHex().toUpperCase()}`}}})}/></label>
          <label>{pt("production.backgroundColor")}<ColorPicker aria-label={pt("production.backgroundColor")} disabledAlpha value={/^([A-F\d]{8})$/i.test(format.fill?.fgColor?.argb||'')?`#${format.fill.fgColor.argb.slice(2)}`:'#ffffff'} onChange={color=>patch({fill:{type:'pattern',pattern:'solid',fgColor:{argb:`FF${color.toHex().toUpperCase()}`}}})}/></label>
          <Button onClick={()=>perform({type:'border',mode:'all'})}>{pt("production.allBorders")}</Button><Button onClick={()=>perform({type:'border',mode:'outer'})}>{pt("production.outerBorders")}</Button><Button onClick={()=>perform({type:'border',mode:'none'})}>{pt("production.noBorders")}</Button>
        </div>
        <div className="quality-designer-content"><label>{pt("production.cellContent")} {address}<AntInput.TextArea ref={content} aria-label={pt("production.cellContent2")} maxLength={10000} rows={2} value={editableText} onChange={e=>perform({type:'text',region:address,text:e.target.value})}/></label><p className="muted">{pt("production.clickACellToEnterTextDragOr")}</p></div>
      </fieldset></AntConfigProvider>
      <div className="quality-designer-scroll"><table ref={table} className="quality-grid" tabIndex={busy?-1:0} aria-label={pt("production.onlineTemplateGrid")} style={{width:46+sheet.widths.reduce((sum,width)=>sum+width,0)}} onKeyDown={e=>{
        if(busy||e.target!==e.currentTarget)return;
        if(e.key==='Enter'){e.preventDefault();content.current?.focus();}
        else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();perform({type:'clear'});}
        else if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){
          e.preventDefault();const row=e.key==='ArrowUp'?selection.r1-1:e.key==='ArrowDown'?selection.r2+1:selection.r1,col=e.key==='ArrowLeft'?selection.c1-1:e.key==='ArrowRight'?selection.c2+1:selection.c1;
          if(row>0&&row<=sheet.rows&&col>0&&col<=sheet.cols)select(cellAddress(row,col));
        }
      }}>
        <colgroup><col style={{width:46}}/>{sheet.widths.map((width,i)=><col key={i} style={{width}}/>)}</colgroup>
        <thead><tr><th>{pt("production.rowColumn")}</th>{sheet.widths.map((_,i)=><th key={i}><AntButton type="text" htmlType="button" disabled={busy} onClick={()=>select(`${cellAddress(1,i+1)}:${cellAddress(sheet.rows,i+1)}`)}>{cellAddress(1,i+1).slice(0,-1)}</AntButton></th>)}</tr></thead>
        <tbody>{Array.from({length:sheet.rows},(_,i)=><tr key={i} style={{height:sheet.heights[i+1]||32}}><th className="quality-row-number"><AntButton type="text" htmlType="button" disabled={busy} onClick={()=>select(`A${i+1}:${cellAddress(i+1,sheet.cols)}`)}>{i+1}</AntButton></th>{Array.from({length:sheet.cols},(_,j)=>{
          const row=i+1,col=j+1,address=cellAddress(row,col),rect=merges.get(address)||{r1:row,c1:col,r2:row,c2:col};
          if(row!==rect.r1||col!==rect.c1)return null;
          const value=sheet.cells[address],selected=containsCell(selection,row,col);
          return <td key={j} data-address={address} aria-selected={selected} aria-label={`${address} ${value?.text||pt("production.blank")}`} rowSpan={rect.r2-row+1} colSpan={rect.c2-col+1} style={designerCellStyle(value)} className={`quality-cell${selected?' quality-selected':''}`} onPointerDown={e=>{
            if(busy||e.button>0)return;if(e.pointerType==='mouse'){e.preventDefault();drag.current=rect;table.current?.focus({preventScroll:true});}select(regionAddress(rect));
          }} onPointerEnter={e=>{if(e.pointerType==='mouse'&&e.buttons===1)extend(rect);}} onDoubleClick={()=>{if(!busy)content.current?.focus();}}>{value?.text||''}</td>;
        })}</tr>)}</tbody>
      </table></div>
      <AntConfigProvider componentDisabled={busy}><fieldset className="quality-designer-controls quality-designer-dimensions" disabled={busy}>
        <label>{pt("production.rowHeight")}<AntInput aria-label={pt("production.rowHeight")} type="number" min={20} max={240} defaultValue={Math.round(sheet.heights[selection.r1]||32)} key={`row-${sheetName}-${selection.r1}-${sheet.heights[selection.r1]}`} onBlur={e=>{if(Number(e.target.value)!==Math.round(sheet.heights[selection.r1]||32))perform({type:'rowHeight',value:Number(e.target.value)});}}/></label>
        <label>{pt("production.columnWidth")}<AntInput aria-label={pt("production.columnWidth")} type="number" min={40} max={480} defaultValue={Math.round(sheet.widths[selection.c1-1])} key={`col-${sheetName}-${selection.c1}-${sheet.widths[selection.c1-1]}`} onBlur={e=>{if(Number(e.target.value)!==Math.round(sheet.widths[selection.c1-1]))perform({type:'columnWidth',value:Number(e.target.value)});}}/></label>
        <label>{pt("production.rows2")}<AntInput aria-label={pt("production.tableRows")} type="number" value={size.rows} onChange={e=>setSize(v=>({...v,rows:Number(e.target.value)}))}/></label><label>{pt("production.columns2")}<AntInput aria-label={pt("production.tableColumns")} type="number" value={size.cols} onChange={e=>setSize(v=>({...v,cols:Number(e.target.value)}))}/></label><Button onClick={()=>perform({type:'resize',...size})}>{pt("production.resizeTableRange")}</Button>
        <label>{pt("production.worksheetName")}<AntInput aria-label={pt("production.worksheetName")} maxLength={31} value={sheetTitle} onChange={e=>setSheetTitle(e.target.value)}/></label><Button onClick={()=>perform({type:'rename',name:sheetTitle})}>{pt("production.renameWorksheet")}</Button>
      </fieldset></AntConfigProvider>
    </section>
  </section>;
}
