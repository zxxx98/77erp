import { ColorPicker, ConfigProvider as AntConfigProvider } from 'antd';
import { Input as AntInput, Checkbox as AntCheckbox, Button as AntButton } from '../ui/controls.jsx';

import { Select } from './../Dropdown.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bold, Italic, Undo2, Redo2, Check } from 'lucide-react';
import { Button, PageHeading } from '../components/common.jsx';
import { cellAddress, containsCell, parseRegion, regionAddress } from '../../shared/quality-template.js';
import { changeDesigner, designerCellStyle, designerRegion, inspectionDesigner } from '../../shared/quality-designer.js';

export function QualityTemplateDesigner({designer,name,busy,error,onApply,onClose}) {
  const [state,setState]=useState(()=>({model:designer.model,commands:[],past:[],future:[]}));
  const [sheetName,setSheetName]=useState(designer.model.sheets[0].name),[selection,setSelection]=useState(parseRegion('A1'));
  const [range,setRange]=useState('A1'),[localError,setError]=useState(''),[templateName,setName]=useState(name||'未命名检验模板');
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
  const leave=()=>{if(state.commands.length&&!window.confirm('表格编辑尚未应用，确定放弃这些修改？'))return;onClose();};
  const insertExample=()=>{
    if(state.commands.length&&!window.confirm('使用示例会替换当前未保存的表格，确定继续？'))return;
    const example=inspectionDesigner();setState({model:example.model,commands:example.commands,past:[],future:[]});setSheetName(example.definition.sheetName);setStarter(example.definition);setKeepFields(true);setSelection(parseRegion('A1'));setError('');
  };
  const extend=rect=>{if(!drag.current)return;const start=drag.current;select(regionAddress({r1:Math.min(start.r1,rect.r1),c1:Math.min(start.c1,rect.c1),r2:Math.max(start.r2,rect.r2),c2:Math.max(start.c2,rect.c2)}));};
  const editableText=cell?.text||'';
  return <section className="quality-page quality-designer-page">
    <PageHeading title={designer.file?'编辑模板表格':'在线新建模板'} description="先编辑表格内容与排版，再配置检验字段并发布。">
      <Button icon={ArrowLeft} disabled={busy} onClick={leave}>返回</Button>
      <Button kind="primary" icon={Check} busy={busy} onClick={()=>onApply({commands:state.commands,definition:starter,keepFields,name:templateName})}>继续配置字段</Button>
    </PageHeading>
    {(localError||error)&&<p role="alert" className="form-error quality-notice">{localError||error}</p>}
    <div className="panel quality-designer-meta"><label>模板名称<AntInput aria-label="模板名称" maxLength={60} disabled={busy} value={templateName} onChange={e=>setName(e.target.value)}/></label>
      <label>工作表<Select aria-label="编辑工作表" disabled={busy} value={sheetName} onChange={e=>{setSheetName(e);setSelection(parseRegion('A1'));}}>{state.model.sheets.map(sheet=><option key={sheet.name}>{sheet.name}</option>)}</Select></label>
      {!designer.file&&<Button disabled={busy} onClick={insertExample}>使用检验单示例</Button>}
      {(designer.hasFields||starter)&&<AntCheckbox className="quality-check" checked={keepFields} disabled={busy} onChange={e=>setKeepFields(e.target.checked)}>保留字段配置（会重新校验）</AntCheckbox>}
    </div>
    <section className="panel quality-designer" aria-label="模板表格编辑器">
      <AntConfigProvider componentDisabled={busy}><fieldset className="quality-designer-controls" disabled={busy}>
        <div className="quality-designer-toolbar">
          <label>区域<AntInput aria-label="选择区域" value={range} onChange={e=>setRange(e.target.value.toUpperCase())} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();select(range);}}}/></label><Button onClick={()=>select(range)}>选中区域</Button>
          <Button icon={Undo2} disabled={!state.past.length} onClick={()=>restore(state.past.at(-1),state.past.slice(0,-1),[{model:state.model,commands:state.commands},...state.future])}>撤销</Button>
          <Button icon={Redo2} disabled={!state.future.length} onClick={()=>restore(state.future[0],state.past.concat({model:state.model,commands:state.commands}),state.future.slice(1))}>重做</Button>
          <Button onClick={()=>perform({type:'merge'})}>合并单元格</Button><Button onClick={()=>perform({type:'unmerge'})}>取消合并</Button><Button onClick={()=>perform({type:'clear'})}>清空内容</Button>
        </div>
        <div className="quality-designer-toolbar">
          <label>字体<Select aria-label="字体" value={font.name||'微软雅黑'} onChange={e=>patch({font:{name:e}})}>{[...new Set(['微软雅黑','宋体','Arial','Calibri',font.name].filter(Boolean))].map(name=><option key={name}>{name}</option>)}</Select></label>
          <label>字号<AntInput type="number" aria-label="字号" min={6} max={96} defaultValue={font.size||11} key={`${sheetName}-${address}-${font.size||11}`} onBlur={e=>{if(e.target.value&&Number(e.target.value)!==(font.size||11))patch({font:{size:Number(e.target.value)}});}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label>
          <Button icon={Bold} aria-pressed={!!font.bold} onClick={()=>patch({font:{bold:!font.bold}})}>加粗</Button><Button icon={Italic} aria-pressed={!!font.italic} onClick={()=>patch({font:{italic:!font.italic}})}>斜体</Button>
          <label>水平对齐<Select aria-label="水平对齐" value={alignment.horizontal||'left'} onChange={e=>patch({alignment:{horizontal:e}})}>{[['left','左对齐'],['center','居中'],['right','右对齐']].map(([v,label])=><option key={v} value={v}>{label}</option>)}</Select></label>
          <label>垂直对齐<Select aria-label="垂直对齐" value={alignment.vertical||'middle'} onChange={e=>patch({alignment:{vertical:e}})}>{[['top','顶部'],['middle','居中'],['bottom','底部']].map(([v,label])=><option key={v} value={v}>{label}</option>)}</Select></label>
          <Button aria-pressed={!!alignment.wrapText} onClick={()=>patch({alignment:{wrapText:!alignment.wrapText}})}>自动换行</Button>
          <label>文字颜色<ColorPicker aria-label="文字颜色" disabledAlpha value={/^([A-F\d]{8})$/i.test(font.color?.argb||'')?`#${font.color.argb.slice(2)}`:'#24354b'} onChange={color=>patch({font:{color:{argb:`FF${color.toHex().toUpperCase()}`}}})}/></label>
          <label>背景色<ColorPicker aria-label="背景色" disabledAlpha value={/^([A-F\d]{8})$/i.test(format.fill?.fgColor?.argb||'')?`#${format.fill.fgColor.argb.slice(2)}`:'#ffffff'} onChange={color=>patch({fill:{type:'pattern',pattern:'solid',fgColor:{argb:`FF${color.toHex().toUpperCase()}`}}})}/></label>
          <Button onClick={()=>perform({type:'border',mode:'all'})}>全部边框</Button><Button onClick={()=>perform({type:'border',mode:'outer'})}>外边框</Button><Button onClick={()=>perform({type:'border',mode:'none'})}>无边框</Button>
        </div>
        <div className="quality-designer-content"><label>单元格内容 · {address}<AntInput.TextArea ref={content} aria-label="单元格内容" maxLength={10000} rows={2} value={editableText} onChange={e=>perform({type:'text',region:address,text:e.target.value})}/></label><p className="muted">点击单元格输入文字，拖动或填写区域选择多个格子。Enter 编辑内容，Delete 清空所选内容。</p></div>
      </fieldset></AntConfigProvider>
      <div className="quality-designer-scroll"><table ref={table} className="quality-grid" tabIndex={busy?-1:0} aria-label="在线模板表格" style={{width:46+sheet.widths.reduce((sum,width)=>sum+width,0)}} onKeyDown={e=>{
        if(busy||e.target!==e.currentTarget)return;
        if(e.key==='Enter'){e.preventDefault();content.current?.focus();}
        else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();perform({type:'clear'});}
        else if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){
          e.preventDefault();const row=e.key==='ArrowUp'?selection.r1-1:e.key==='ArrowDown'?selection.r2+1:selection.r1,col=e.key==='ArrowLeft'?selection.c1-1:e.key==='ArrowRight'?selection.c2+1:selection.c1;
          if(row>0&&row<=sheet.rows&&col>0&&col<=sheet.cols)select(cellAddress(row,col));
        }
      }}>
        <colgroup><col style={{width:46}}/>{sheet.widths.map((width,i)=><col key={i} style={{width}}/>)}</colgroup>
        <thead><tr><th>行 / 列</th>{sheet.widths.map((_,i)=><th key={i}><AntButton type="text" htmlType="button" disabled={busy} onClick={()=>select(`${cellAddress(1,i+1)}:${cellAddress(sheet.rows,i+1)}`)}>{cellAddress(1,i+1).slice(0,-1)}</AntButton></th>)}</tr></thead>
        <tbody>{Array.from({length:sheet.rows},(_,i)=><tr key={i} style={{height:sheet.heights[i+1]||32}}><th className="quality-row-number"><AntButton type="text" htmlType="button" disabled={busy} onClick={()=>select(`A${i+1}:${cellAddress(i+1,sheet.cols)}`)}>{i+1}</AntButton></th>{Array.from({length:sheet.cols},(_,j)=>{
          const row=i+1,col=j+1,address=cellAddress(row,col),rect=merges.get(address)||{r1:row,c1:col,r2:row,c2:col};
          if(row!==rect.r1||col!==rect.c1)return null;
          const value=sheet.cells[address],selected=containsCell(selection,row,col);
          return <td key={j} data-address={address} aria-selected={selected} aria-label={`${address} ${value?.text||'空白'}`} rowSpan={rect.r2-row+1} colSpan={rect.c2-col+1} style={designerCellStyle(value)} className={`quality-cell${selected?' quality-selected':''}`} onPointerDown={e=>{
            if(busy||e.button>0)return;if(e.pointerType==='mouse'){e.preventDefault();drag.current=rect;table.current?.focus({preventScroll:true});}select(regionAddress(rect));
          }} onPointerEnter={e=>{if(e.pointerType==='mouse'&&e.buttons===1)extend(rect);}} onDoubleClick={()=>{if(!busy)content.current?.focus();}}>{value?.text||''}</td>;
        })}</tr>)}</tbody>
      </table></div>
      <AntConfigProvider componentDisabled={busy}><fieldset className="quality-designer-controls quality-designer-dimensions" disabled={busy}>
        <label>行高<AntInput aria-label="行高" type="number" min={20} max={240} defaultValue={Math.round(sheet.heights[selection.r1]||32)} key={`row-${sheetName}-${selection.r1}-${sheet.heights[selection.r1]}`} onBlur={e=>{if(Number(e.target.value)!==Math.round(sheet.heights[selection.r1]||32))perform({type:'rowHeight',value:Number(e.target.value)});}}/></label>
        <label>列宽<AntInput aria-label="列宽" type="number" min={40} max={480} defaultValue={Math.round(sheet.widths[selection.c1-1])} key={`col-${sheetName}-${selection.c1}-${sheet.widths[selection.c1-1]}`} onBlur={e=>{if(Number(e.target.value)!==Math.round(sheet.widths[selection.c1-1]))perform({type:'columnWidth',value:Number(e.target.value)});}}/></label>
        <label>行数<AntInput aria-label="表格行数" type="number" value={size.rows} onChange={e=>setSize(v=>({...v,rows:Number(e.target.value)}))}/></label><label>列数<AntInput aria-label="表格列数" type="number" value={size.cols} onChange={e=>setSize(v=>({...v,cols:Number(e.target.value)}))}/></label><Button onClick={()=>perform({type:'resize',...size})}>调整表格范围</Button>
        <label>工作表名称<AntInput aria-label="工作表名称" maxLength={31} value={sheetTitle} onChange={e=>setSheetTitle(e.target.value)}/></label><Button onClick={()=>perform({type:'rename',name:sheetTitle})}>重命名工作表</Button>
      </fieldset></AntConfigProvider>
    </section>
  </section>;
}
