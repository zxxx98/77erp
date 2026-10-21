import { acceptanceSheetResults } from '../../shared/quality-bindings.js';
import { parseQualityFile } from '../quality-local.js';
import { needsQualityReview } from '../../shared/quality-checks.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Download, FileSpreadsheet, Upload, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { Button, Modal, PageHeading } from '../components/common.jsx';
import { Select } from '../Dropdown.jsx';
import { cellAddress, containsCell, parseRegion } from '../../shared/quality-template.js';
import { downloadExcel, WorkbookResults, QualityNavigation, qualityUid } from './quality-shared.jsx';
import { QualityMaterialBinding } from './QualityMaterialBinding.jsx';

function SourceSheet({workbook,sheetName,region,onClose}) {
  const [name,setName]=useState(sheetName);
  const selected=useMemo(()=>parseRegion(region||'A1'),[region]);
  const target=useRef(null);
  const sheet=workbook.sheets.find(s=>s.name===name)||workbook.sheets[0];
  const merged=useMemo(()=>{
    const map=new Map();
    for(const address of sheet.merges){const r=parseRegion(address);for(let row=r.r1;row<=r.r2;row++)for(let col=r.c1;col<=r.c2;col++)map.set(cellAddress(row,col),r);}
    return map;
  },[sheet]);
  useEffect(()=>{target.current?.scrollIntoView({block:'center',inline:'nearest'});},[sheet,selected]);
  return <Modal title="上传文件单元格定位" subtitle={`${sheetName} · ${region||'A1'}`} wide onClose={onClose}><div className="form-body">
    <label>工作表<Select value={sheet.name} onChange={e=>setName(e.target.value)}>{workbook.sheets.map(s=><option key={s.name}>{s.name}</option>)}</Select></label>
    <div className="quality-sheet-scroll quality-source-sheet"><table className="quality-grid"><colgroup><col style={{width:46}}/>{sheet.widths.map((width,i)=><col key={i} style={{width}}/>)}</colgroup><thead><tr><th>行 / 列</th>{sheet.widths.map((_,i)=><th key={i}>{cellAddress(1,i+1).slice(0,-1)}</th>)}</tr></thead><tbody>{Array.from({length:sheet.rows},(_,i)=><tr key={i}><th className="quality-row-number">{i+1}</th>{Array.from({length:sheet.cols},(_,j)=>{
      const row=i+1,col=j+1,address=cellAddress(row,col),r=merged.get(address)||{r1:row,c1:col,r2:row,c2:col};
      if(r.r1!==row||r.c1!==col)return null;
      const active=sheet.name===sheetName&&r.r1<=selected.r2&&r.r2>=selected.r1&&r.c1<=selected.c2&&r.c2>=selected.c1;
      return <td key={j} ref={active&&containsCell(r,selected.r1,selected.c1)?target:undefined} className={`quality-cell${active?' quality-source-error':''}`} data-address={address} rowSpan={r.r2-r.r1+1} colSpan={r.c2-r.c1+1}>{sheet.cells[address]?.text||''}</td>;
    })}</tr>)}</tbody></table></div>
  </div></Modal>;
}

export function QualityAcceptances({data,onTemplates,onAreaChange}) {
  const [templates,setTemplates]=useState([]),[list,setList]=useState([]),[total,setTotal]=useState(0),[q,setQ]=useState(''),[offset,setOffset]=useState(0),[refresh,setRefresh]=useState(0);
  const [draft,setDraft]=useState(null),[parsed,setParsed]=useState(null),[detail,setDetail]=useState(null),[source,setSource]=useState(null);
  const [bindings,setBindings]=useState([]);
  const [resultSheet,setResultSheet]=useState(null);
  useEffect(()=>{setResultSheet(null);setSource(null);},[parsed]);
  const [checksAcknowledged,setChecksAcknowledged]=useState(false);
  useEffect(()=>setChecksAcknowledged(false),[parsed]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const input=useRef(),lock=useRef(false),request=useRef(null);
  const interrupted=!!draft;
  useEffect(()=>{
    const unload=e=>{if(interrupted){e.preventDefault();e.returnValue='';}};
    const navigate=e=>{if(interrupted&&!window.confirm('验收单尚未保存，确定离开？'))e.preventDefault();};
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
  const leave=fn=>{if(busy)return;if(draft&&!window.confirm('验收单尚未保存，确定离开？'))return;setDraft(null);setParsed(null);setDetail(null);setSource(null);setError('');setMessage('');fn?.();};
  const start=()=>{const template=templates[0]||null;setDraft({template,name:template?`${template.name}验收`:'',note:'',file:null,workbook:null,sheetNames:[]});setParsed(null);setDetail(null);setError('');setMessage('');request.current=null;};
  const parse=async file=>{
    if(!draft.template)return;
    setDraft(v=>({...v,file,workbook:null,sheetNames:[]}));setParsed(null);setBindings([]);setChecksAcknowledged(false);request.current=null;
    await run(async()=>{
      const template=await api(`/quality/acceptance-templates/${draft.template.id}?revision_id=${draft.template.revision_id}`);
      const result=await parseQualityFile(file,template);
      const {bindings}=await api('/quality/binding-suggestions',{method:'POST',body:{keys:result.keys}});
      setParsed({...result,localId:qualityUid()});setBindings(bindings.map(binding=>({...binding,enabled:true})));setDraft(v=>({...v,workbook:result.workbook,sheetNames:result.sheet_names}));
    });
  };
  const selectSheets=names=>{setDraft(v=>({...v,sheetNames:names}));setChecksAcknowledged(false);setError('');};
  const selectedNames=draft?.sheetNames||[];
  const activeBindings=draft?bindings.filter(binding=>selectedNames.includes(binding.sheetName)):bindings;
  const save=()=>run(async()=>{
    const sheetNames=selectedNames;
    const choices=activeBindings.map(binding=>({sheetName:binding.sheetName,mode:binding.enabled?binding.mode:'none',product_id:binding.enabled?binding.product_id:null}));
    const fingerprint=JSON.stringify([draft.name,draft.note,parsed.localId,sheetNames,choices,checksAcknowledged]);
    if(request.current?.fingerprint!==fingerprint)request.current={fingerprint,id:qualityUid()};
    const body=new FormData();body.append('file',draft.file);body.append('template_id',parsed.template.id);body.append('revision_id',parsed.template.revision_id);
    body.append('name',draft.name);body.append('note',draft.note);body.append('request_id',request.current.id);body.append('sheet_names',JSON.stringify(sheetNames));
    body.append('bindings',JSON.stringify(choices));
    if(checksAcknowledged)body.append('checks_acknowledged','true');
    const saved=await api('/quality/acceptances',{method:'POST',body});
    setDetail(saved);setDraft(null);setParsed(null);setRefresh(v=>v+1);setMessage('验收单已保存，解析数据、模板版本和上传原始 Excel 已保留。');
  });
  const remove=row=>{
    if(!window.confirm(`确定删除验收单“${row.name}”（${row.number}）？删除后无法在页面恢复，该单将不再参与图表统计。`))return;
    void run(async()=>{
      await api(`/quality/acceptances/${row.id}`,{method:'DELETE',body:{}});
      setDetail(null);setSource(null);setOffset(value=>Math.max(0,value-(list.length===1?20:0)));setRefresh(value=>value+1);setMessage('验收单已删除。');
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
  const title=draft?'导入验收单':detail?'验收单详情':'验收单';
  return <section className="quality-page">
    <QualityNavigation area="acceptances" disabled={busy} onChange={area=>{if(area==='templates')leave(onTemplates);else if(area==='charts')leave(()=>onAreaChange('charts'));}}/>
    <PageHeading title={title} description={draft?'选择已启用的模板版本，上传填写后的 Excel，检查解析结果后保存。':detail?`${detail.number} · ${detail.template_name} v${detail.revision}`:'下载已发布模板，填写后上传解析，保留每次验收的原文件与结果。'}>
      {(draft||detail)?<Button icon={ArrowLeft} disabled={busy} onClick={()=>leave()}>返回验收单列表</Button>:<Button kind="primary" icon={Upload} disabled={!templates.length} onClick={start}>导入验收单</Button>}
      {detail&&<><Button icon={Download} busy={busy} onClick={()=>run(()=>downloadExcel(`/acceptances/${detail.id}/download`))}>下载上传原文件</Button><Button icon={Trash2} disabled={busy} onClick={()=>remove(detail)}>删除验收单</Button></>}
    </PageHeading>
    {error&&<div className="form-error quality-notice" role="alert">{error}</div>}
    {message&&<div className="quality-success quality-notice" role="status">{message}</div>}
    {!draft&&!detail&&<>
      {!templates.length&&<div className="info-box quality-storage">暂无已启用的模板，请先在模板配置中发布一个版本。<Button onClick={onTemplates}>前往模板配置</Button></div>}
      <section className="panel"><div className="table-toolbar"><h2>已保存验收单</h2><div className="quality-toolbar"><input aria-label="搜索验收单" placeholder="搜索名称或单号" value={q} onChange={e=>{setQ(e.target.value);setOffset(0);}}/><span className="muted">共 {total} 张</span></div></div>
        <div className="quality-list-scroll"><table className="quality-list"><thead><tr><th>验收单 / 名称</th><th>模板版本</th><th>上传文件</th><th>提交人 / 时间</th><th>操作</th></tr></thead><tbody>{list.map(row=><tr key={row.id}><td><strong>{row.name}</strong><small>{row.number}</small></td><td>{row.template_name}<small>v{row.revision}</small></td><td>{row.filename}</td><td>{row.created_by_name}<small>{new Date(row.created_at).toLocaleString()}</small></td><td><div className="quality-actions"><Button disabled={busy} onClick={()=>run(async()=>{setDetail(await api(`/quality/acceptances/${row.id}`));setMessage('');})}>查看详情</Button><Button disabled={busy} onClick={()=>run(()=>downloadExcel(`/acceptances/${row.id}/download`))}>下载原文件</Button><Button icon={Trash2} disabled={busy} onClick={()=>remove(row)}>删除</Button></div></td></tr>)}</tbody></table></div>
        {!list.length&&<div className="quality-empty"><FileSpreadsheet size={30}/><p>暂无匹配的验收单</p></div>}
        {total>20&&<div className="quality-toolbar quality-pagination"><Button disabled={offset===0} onClick={()=>setOffset(v=>v-20)}>上一页</Button><span>{offset+1}–{Math.min(offset+20,total)} / {total}</span><Button disabled={offset+20>=total} onClick={()=>setOffset(v=>v+20)}>下一页</Button></div>}
      </section>
    </>}
    {draft&&<>
      <section className="panel quality-acceptance-form"><div className="quality-acceptance-steps"><span className={!parsed?'active':''}>1 选择模板并上传</span><span className={parsed?'active':''}>2 检查解析结果</span><span>3 确认保存</span></div>
        <div className="quality-meta"><label>验收模板<Select aria-label="验收模板" disabled={busy} value={draft.template?.id||''} onChange={e=>{
          const template=templates.find(t=>t.id===Number(e.target.value));setDraft(v=>({...v,template,file:null,workbook:null,sheetNames:[],name:`${template.name}验收`}));setParsed(null);setError('');request.current=null;
        }}><option value="" disabled>请选择已启用模板</option>{templates.map(t=><option key={t.id} value={t.id}>{t.name} · v{t.revision}</option>)}</Select></label>
          <label>验收单名称<input aria-label="验收单名称" maxLength={100} value={draft.name} disabled={busy} onChange={e=>setDraft(v=>({...v,name:e.target.value}))}/></label>
          <label>备注<input aria-label="验收备注" maxLength={1000} value={draft.note} disabled={busy} onChange={e=>setDraft(v=>({...v,note:e.target.value}))}/></label>
          <div className="quality-file"><span>使用模板：{draft.template?`${draft.template.name} v${draft.template.revision}`:'未选择'}</span><Button icon={Download} disabled={busy||!draft.template} onClick={()=>run(()=>downloadExcel(`/templates/${draft.template.id}/revisions/${draft.template.revision_id}/download`))}>下载此版本 Excel</Button></div>
        </div>
        <div className="quality-acceptance-upload"><FileSpreadsheet size={32}/><div><strong>{draft.file?.name||'上传填写后的 Excel'}</strong><p className="muted">支持 .xlsx，最大 10 MB。文件在浏览器内解析，确认保存时才上传。各数据工作表使用同一套模板规则，名称可以不同；请保留字段标题、属性和单元格位置。</p></div><Button icon={Upload} busy={busy} disabled={!draft.template} onClick={()=>input.current.click()}>{draft.file?'重新上传解析':'选择 Excel 并解析'}</Button></div>
        {draft.workbook&&<div className="quality-data-sheets"><div><h2>选择需要解析的数据工作表</h2><p className="muted">每个勾选的工作表均按同一份模板的字段位置和类型解析；说明页或其他非数据页可以取消勾选。勾选变化会即时更新下方结果，无需重新解析。</p></div><div className="quality-inline">{draft.workbook.sheets.map(sheet=><label className="quality-check" key={sheet.name}><input type="checkbox" aria-label={`解析工作表 ${sheet.name}`} disabled={busy} checked={draft.sheetNames.includes(sheet.name)} onChange={e=>selectSheets(e.target.checked?draft.workbook.sheets.filter(s=>draft.sheetNames.includes(s.name)||s.name===sheet.name).map(s=>s.name):draft.sheetNames.filter(name=>name!==sheet.name))}/>{sheet.name}</label>)}</div></div>}
        <input ref={input} aria-label="上传验收单 Excel" type="file" accept=".xlsx" hidden disabled={busy||!draft.template} onChange={e=>{const file=e.target.files[0];e.target.value='';if(file)void parse(file);}}/>
      </section>
      {parsed&&<section className={`quality-acceptance-validation ${noSheets||preview.issues.length||pendingBindings?'has-errors':'is-valid'}`} role="status"><div><strong>{noSheets?'请选择至少一个需要解析的数据工作表':preview.issues.length?`发现 ${preview.issues.length} 处问题，请修正原文件后重新上传`:pendingBindings?'解析通过，请选择绑定物料或取消该 Sheet 的物料绑定':reviewNeeded?'解析通过，系统核对有待确认项':'解析通过，可以确认保存'}</strong><p>{parsed.template.name} v{parsed.template.revision} · {`${sheets.length} 个工作表`} · 每个工作表 {definition.fields.length} 个字段</p></div><Button disabled={busy} onClick={()=>setSource({sheetName:preview.sheets?.[0]?.sheetName||definition.sheetName,region:'A1'})}>查看上传表格</Button></section>}

    </>}
    {detail&&<section className="panel quality-acceptance-detail"><div><span className="muted">验收单名称</span><h2>{detail.name}</h2></div><div><span className="muted">提交人</span><p>{detail.created_by_name}</p></div><div><span className="muted">保存时间</span><p>{new Date(detail.created_at).toLocaleString()}</p></div><div><span className="muted">备注</span><p>{detail.note||'—'}</p></div></section>}
    {detail&&preview&&<WorkbookResults definition={definition} preview={preview} onLocate={draft?(sheetName,region)=>setSource({sheetName,region}):undefined} renderSheet={sheetName=><QualityMaterialBinding key={sheetName} sheetName={sheetName} data={data} busy={busy} readOnly={!draft} binding={(draft?bindings:detail.bindings)?.find(binding=>binding.sheetName===sheetName)} onChange={changed=>setBindings(values=>values.map(binding=>binding.sheetName===sheetName?changed:binding))}/>}/>}
    {draft&&parsed&&<section className="panel quality-sheet-summaries" aria-label="工作表解析列表">{sheets.map(sheet=><QualityMaterialBinding key={sheet.sheetName} compact sheetName={sheet.sheetName} data={data} busy={busy} issueCount={sheet.issues.length} reviewNeeded={needsQualityReview(sheet)} binding={bindings.find(binding=>binding.sheetName===sheet.sheetName)} onChange={changed=>setBindings(values=>values.map(binding=>binding.sheetName===sheet.sheetName?changed:binding))} onPreview={()=>setResultSheet(sheet.sheetName)}/>)}</section>}
    {selectedSheet&&!source&&<Modal title="工作表解析结果" subtitle={selectedSheet.sheetName} wide onClose={()=>setResultSheet(null)}><div className="form-body">
      {!!selectedSheet?.issues.length&&<section className="panel quality-acceptance-issues" aria-label="解析问题"><h2>需要修正的单元格</h2>{selectedSheet.issues.map((issue,i)=>{
        const name=selectedSheet.sheetName;
        const field=definition.fields.find(f=>f.id===issue.fieldId),property=field?.properties?.find(p=>p.id===issue.propertyId);
        return <div key={i}><div><strong>{field?.name||'工作表'}{property?` / ${property.name}`:''}</strong><p>{issue.message}</p></div><Button onClick={()=>setSource({sheetName:name,region:issue.region})}>{name}!{issue.region} · 定位</Button></div>;
      })}</section>}
      <WorkbookResults definition={definition} preview={{sheets:[selectedSheet]}} onLocate={(sheetName,region)=>setSource({sheetName,region})}/>
    </div></Modal>}
    {draft&&reviewNeeded&&<label className="quality-review-confirm"><input type="checkbox" aria-label="已核对系统提示" checked={checksAcknowledged} disabled={busy} onChange={e=>setChecksAcknowledged(e.target.checked)}/>我已核对系统发现的差异及待确认项，确认保留原报告结果并保存。</label>}
    {detail?.checks_acknowledged===1&&<p className="quality-success quality-notice">{detail.created_by_name} 已确认系统核对提示，原报告判定与系统核对结果均已保留。</p>}
    {draft&&<div className="quality-acceptance-footer"><span className="muted">{parsed?'确认后保存所选工作表的解析结果、物料绑定和上传原文件，后续模板修改不会影响此记录。':'上传后先检查解析结果，再确认保存。'}</span><Button kind="primary" icon={Check} busy={busy} disabled={!parsed||noSheets||!!preview?.issues.length||pendingBindings||reviewNeeded&&!checksAcknowledged||!draft.name.trim()} onClick={save}>确认保存验收单</Button></div>}
    {source&&parsed&&<SourceSheet workbook={parsed.workbook} sheetName={source.sheetName} region={source.region} onClose={()=>setSource(null)}/>}
  </section>;
}
