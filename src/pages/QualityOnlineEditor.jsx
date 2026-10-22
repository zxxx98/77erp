import { useMemo, useState } from 'react';
import { Check, FileSpreadsheet, List } from 'lucide-react';
import { Button } from '../components/common.jsx';
import { cellAddress, choiceModeOf, containsCell, hasTextProcessing, parseRegion, previewChoice, qualityTypeLabels } from '../../shared/quality-template.js';
import { onlineCellConfig, onlineChoiceOptions, onlineChoiceText } from '../../shared/quality-online.js';
import { sheetPreviewBounds } from '../../shared/quality-sheet-view.js';

function Entry({input,inputs,values,busy,onChange,issues,inline=false}) {
  const [editing,setEditing]=useState(false);
  const [original,setOriginal]=useState('');
  const config=onlineCellConfig(input,inputs,values), value=values[input.address]||'';
  const position=parseRegion(input.address);
  const errors=issues.filter(issue=>containsCell(parseRegion(issue.region),position.r1,position.c1));
  const choice=input.simple&&['single','multi'].includes(config.type)&&!hasTextProcessing(config)&&!config.specialValues?.length;
  const props={'aria-label':`${input.label} · ${input.address}`,'aria-invalid':!!errors.length,disabled:busy};
  const begin=()=>{if(!busy){setOriginal(value);setEditing(true);}};
  return <div className={`quality-online-entry${inline&&editing&&!choice?' is-editing':''}${errors.length?' has-errors':''}`}>
    {choice?<div className="quality-online-choices" role={config.type==='single'?'radiogroup':'group'} aria-label={props['aria-label']} aria-invalid={!!errors.length}>
      {onlineChoiceOptions(config).map(option=>{
        const parsed=previewChoice(value,config), selected=Array.isArray(parsed.value)?parsed.value:parsed.value?[parsed.value]:[];
        const checked=selected.includes(option), marker=checked?config.checkChar:(config.uncheckChars||'').split('\n').find(Boolean)||'○';
        return <button type="button" className="quality-online-option" key={option} role={config.type==='single'?'radio':'checkbox'} aria-label={`${input.label} · ${input.address} · ${option}`} aria-checked={checked} disabled={busy} onClick={()=>{
          const next=checked?selected.filter(item=>item!==option):(config.type==='single'||choiceModeOf(config)==='plain'?[option]:[...selected,option]);
          onChange(input.address,onlineChoiceText(next,config));
        }}><span aria-hidden="true">{choiceModeOf(config)==='plain'?option:config.markerPosition==='after'?`${option}${marker}`:`${marker}${option}`}</span></button>;
      })}
    </div>:inline&&!editing?<button type="button" className="quality-online-cell-value" {...props} title="双击填写，触屏轻点填写，也可按 Enter" onDoubleClick={begin}
      onPointerUp={event=>{if(event.pointerType==='touch'||event.pointerType==='pen')begin();}}
      onKeyDown={event=>{if(event.key==='Enter'||event.key==='F2'){event.preventDefault();begin();}}}>{value||'\u00a0'}</button>:<textarea {...props} autoFocus={inline} rows={config.type==='measurements'||value.includes('\n')?3:1} maxLength={10000}
      inputMode={config.type==='number'?'decimal':undefined} placeholder={`${config.required?'必填 · ':''}${config.type==='date'?(config.dateFormat||'YYYY-MM-DD'):{string:'填写内容',uniqueKey:'填写编号'}[config.type]||qualityTypeLabels[config.type]||'填写内容'}`}
      value={value} onChange={e=>onChange(input.address,e.target.value)} onBlur={()=>setEditing(false)} onKeyDown={event=>{
        if(!inline||event.nativeEvent.isComposing)return;
        if(event.key==='Escape'){event.preventDefault();onChange(input.address,original);setEditing(false);}
        if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();setEditing(false);}
      }}/>}
    {!!errors.length&&<small className="form-error">{[...new Set(errors.map(issue=>issue.message))].join('；')}</small>}
  </div>;
}

export function QualityOnlineEditor({online,busy,validated,onChange,onValidate}) {
  const [view,setView]=useState(()=>window.matchMedia('(max-width: 700px)').matches?'fields':'sheet');
  const {inputs,values,styles,heights,template,workbook,issues=[]}=online;
  const sheet=workbook.sheets.find(s=>s.name===template.definition.sheetName);
  const bounds=useMemo(()=>sheetPreviewBounds(sheet,template.definition.fields.map(field=>field.valueRegion)),[sheet,template]);
  const cells=useMemo(()=>new Map(inputs.map(input=>[input.address,input])),[inputs]);
  const merges=useMemo(()=>{
    const result=new Map();
    for(const address of sheet.merges){const r=parseRegion(address);for(let row=r.r1;row<=r.r2;row++)for(let col=r.c1;col<=r.c2;col++)result.set(cellAddress(row,col),r);}
    return result;
  },[sheet]);
  const entry=(input,inline=false)=><Entry input={input} inputs={inputs} values={values} busy={busy} onChange={onChange} issues={issues} inline={inline}/>;
  return <section className="panel quality-online-editor" aria-label="在线填写验收单">
    <div className="quality-grid-toolbar"><div><h2>在线填写 · {sheet.name}</h2><p className="muted">浅黄色为待填写，浅绿色为已填写。双击格子填写（手机轻点），选项直接点选。{validated?'当前内容已校验。':'填写后请校验并预览，再确认保存。'}</p></div>
      <div className="quality-actions"><Button icon={FileSpreadsheet} disabled={busy} aria-pressed={view==='sheet'} onClick={()=>setView('sheet')}>表格填写</Button><Button icon={List} disabled={busy} aria-pressed={view==='fields'} onClick={()=>setView('fields')}>字段填写</Button></div>
    </div>
    {online.hasFormulas&&<p className="quality-online-formula-note">模板含公式，在线填写不会自动计算，请填写本次实际结果；下载后可在 Excel 中重新计算。</p>}
    {view==='sheet'?<div className="quality-online-scroll"><table className="quality-grid" aria-label="模板填写表格" style={{width:46+bounds.widths.reduce((sum,width)=>sum+width,0)}}>
      <colgroup><col style={{width:46}}/>{bounds.widths.map((width,i)=><col key={i} style={{width}}/>)}</colgroup>
      <thead><tr><th>行 / 列</th>{bounds.widths.map((_,i)=><th key={i}>{cellAddress(1,i+1).slice(0,-1)}</th>)}</tr></thead>
      <tbody>{Array.from({length:bounds.rows},(_,i)=><tr key={i} style={{height:heights[i+1]}}><th className="quality-row-number">{i+1}</th>{Array.from({length:bounds.cols},(_,j)=>{
        const row=i+1,col=j+1,address=cellAddress(row,col),rect=merges.get(address)||{r1:row,c1:col,r2:row,c2:col};
        if(rect.r1!==row||rect.c1!==col)return null;
        const input=cells.get(address);
        return <td key={j} data-address={address} rowSpan={rect.r2-row+1} colSpan={rect.c2-col+1} style={input?{...styles[address],backgroundColor:values[address]?.trim()?'#f1f8f2':'#fff8e6'}:styles[address]} className={`quality-cell${input?' quality-online-writable':''}`}>
          {input?entry(input,true):sheet.cells[address]?.text||''}
        </td>;
      })}</tr>)}</tbody>
    </table></div>:<div className="quality-online-fields">{template.definition.fields.map(field=><section key={field.id} aria-label={`填写 ${field.name}`}>
      <h3>{field.name}{field.required?' *':''}</h3>
      <div className="quality-online-field-list">{inputs.filter(input=>input.fieldId===field.id).map(input=><div className="quality-online-field" key={input.address}>
        {(field.type==='object'||!input.simple)&&<span>{field.type==='object'?`第 ${input.record+1} 条 · ${input.config.name}`:input.label}<small>{input.region}</small></span>}{entry(input)}
      </div>)}</div>
    </section>)}</div>}
    <div className="quality-grid-toolbar"><span className="muted">{inputs.length} 个填写位置 · 仅保存为新验收单，模板保持原样</span><Button kind="primary" icon={Check} busy={busy} onClick={onValidate}>校验并预览</Button></div>
  </section>;
}
