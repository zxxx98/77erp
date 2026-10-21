import { getWarehouseId } from '../api.js';
import { Badge, Button } from '../components/common.jsx';
import { cellAddress, hasTextProcessing, objectOrientation, preprocessText, previewChoice, qualityTypeLabels } from '../../shared/quality-template.js';

export const qualityUid = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join('-');
export function QualityNavigation({area,onChange,disabled}) {
  return <nav className="quality-section-tabs" aria-label="品质管理功能"><Button disabled={disabled} kind={area==='acceptances'?'primary':'secondary'} onClick={()=>onChange('acceptances')}>验收单</Button><Button disabled={disabled} kind={area==='templates'?'primary':'secondary'} onClick={()=>onChange('templates')}>模板配置</Button><Button disabled={disabled} kind={area==='charts'?'primary':'secondary'} onClick={()=>onChange('charts')}>图表</Button></nav>;
}
export async function downloadExcel(path) {
  const response = await fetch('/api/quality'+path,{credentials:'same-origin',headers:{'X-Warehouse-ID':String(getWarehouseId())}});
  if(!response.ok) {const data=await response.json();throw new Error(data.error||'下载失败。');}
  const disposition=response.headers.get('content-disposition')||'';
  const encoded=/filename\*=UTF-8''([^;]+)/i.exec(disposition), plain=/filename="([^"]+)"/i.exec(disposition);
  const filename=encoded?decodeURIComponent(encoded[1]):plain?.[1]||'验收单模板.xlsx';
  const url=URL.createObjectURL(await response.blob()), link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function ChoiceSplitPreview({field,raw,compact=false}) {
  if(!['single','multi'].includes(field?.type))return null;
  let processed;
  try {processed=preprocessText(raw,field);}catch{return null;}
  if(field.specialValues?.some(rule=>rule.text===processed.trim()))return null;
  const parsed=previewChoice(processed,field);
  const labels={selected:'已选中',unselected:'未选中',unmarked:'未识别标记',invalid:'无法拆分',empty:'空白片段'};
  const content=<section className="quality-choice-split" aria-label="选项拆分结果">
    <div className="quality-choice-heading"><strong>拆分结果（{parsed.parts.length} 项）</strong><small>{parsed.mode==='separator'?'按指定分隔符拆分':'按选项标记拆分'}</small></div>
    {!parsed.parts.length&&<p className="muted">{parsed.error?'请先完成选项规则配置，再查看拆分结果。':`${hasTextProcessing(field)?'处理后的内容':'原始内容'}为空，没有可拆分的选项。`}</p>}
    {parsed.parts.map((part,index)=><div className="quality-choice-part" key={index}>
      <div className="quality-choice-part-heading"><strong>第 {index+1} 项</strong><Badge tone={part.status==='selected'?'green':part.status==='unselected'?'blue':'gray'}>{labels[part.status]}</Badge><small>{part.matched?'匹配允许选项':'未匹配允许选项'}</small></div>
      <dl><dt>拆分原文</dt><dd><code>{part.raw||'（空）'}</code></dd><dt>选项文字</dt><dd>{part.label||'（空）'}</dd><dt>识别标记</dt><dd><code>{part.marker||'（无）'}</code></dd></dl>
    </div>)}
  </section>;
  return compact?<details className="quality-choice-details"><summary>查看拆分结果（{parsed.parts.length} 项）</summary>{content}</details>:content;
}
const statusLabel=result=>result.status==='not_applicable'?'不适用':result.status==='missing'?'未填写':null;
export function PreviewTable({preview,field}) {
  const result=preview?.results?.find(r=>r.id===field.id);
  if(!result)return null;
  if(field.type!=='object')return <div className="quality-value-preview"><span>原始内容</span><pre>{result.raw||'（空）'}</pre><ProcessedTextPreview field={field} raw={result.raw}/><ChoiceSplitPreview field={field} raw={result.raw}/><span>解析值</span><pre>{statusLabel(result)||JSON.stringify(result.value)}</pre></div>;
  const vertical=objectOrientation(field)==='vertical';
  return <div className="quality-preview-table"><table><thead><tr><th>{vertical?'源列':'源行'}</th>{field.properties.map(p=><th key={p.id}>{p.name}</th>)}</tr></thead><tbody>{result.rows.map(row=><tr key={vertical?row.column:row.row}><th>{vertical?cellAddress(1,row.column).slice(0,-1):row.row}</th>{row.cells.map(c=>{
    const property=field.properties.find(p=>p.id===c.id),rule=property?.itemRules?.[c.ruleIndex],config=rule?.config||property;
    const invalid=preview.issues?.some(issue=>issue.fieldId===field.id&&issue.propertyId===c.id&&issue.region===c.region);
    return <td key={c.id}>{invalid?'（无效）':statusLabel(c)||(c.value===null||c.value===''?'（未填写）':Array.isArray(c.value)?JSON.stringify(c.value):String(c.value))}{rule&&<small className="quality-rule-match">项目规则：{rule.equals} · {qualityTypeLabels[config.type]}</small>}{c.status&&<small>原文：{c.raw}</small>}<ProcessedTextPreview field={config} raw={c.raw} compact/><ChoiceSplitPreview field={config} raw={c.raw} compact/></td>;
  })}</tr>)}</tbody></table>{!result.rows.length&&<p className="quality-empty">值区域尚无填写记录。</p>}</div>;
}

function ProcessedTextPreview({field,raw,compact=false}) {
  if(!field||!hasTextProcessing(field))return null;
  let processed,error;
  try {processed=preprocessText(raw,field);}catch(e){error=e.message;}
  const content=<div className="quality-processed-text">{compact&&<><span>原始内容</span><pre>{raw||'（空）'}</pre></>}<span>处理后内容</span>{error?<p className="form-error">{error}</p>:<pre>{processed||'（空）'}</pre>}</div>;
  return compact?<details className="quality-choice-details"><summary>查看内容处理</summary>{content}</details>:content;
}

export function QualityCheckResults({checks,onLocate}) {
  if(!checks?.length)return null;
  const labels={pass:'核对通过',fail:'发现差异',review:'待人工核对',not_applicable:'不适用'};
  const order={fail:0,review:1,pass:2,not_applicable:3};
  return <section className="panel quality-check-results" aria-label="系统核对结果"><h3>系统核对结果</h3><p className="muted">以下为模板规则的核对结果，原报告判定保持原样。没有核对规则覆盖的项目不代表已通过检查。</p>
    <div className="quality-toolbar">{Object.entries(labels).map(([status,label])=><span key={status}>{label} {checks.filter(c=>c.status===status).length}</span>)}</div>
    {[...checks].sort((a,b)=>order[a.status]-order[b.status]).map((check,index)=><article key={`${check.id}-${index}`} className={`quality-check-result quality-check-${check.status}`}>
      <strong>{check.name} · {labels[check.status]}</strong><p>{check.message}</p>
      {check.measurements&&<div className="quality-preview-table"><table><thead><tr><th>样本／部位</th><th>实测值</th><th>下限</th><th>上限</th><th>核对</th></tr></thead><tbody>{check.measurements.map((m,i)=><tr key={i}><td>{m.name}</td><td>{m.value}{check.unit}</td><td>{m.min===null?'不限':`${m.minInclusive?'≥':'>'} ${m.min}${check.unit||''}`}</td><td>{m.max===null?'不限':`${m.maxInclusive?'≤':'<'} ${m.max}${check.unit||''}`}</td><td>{m.pass?'范围内':'超限'}</td></tr>)}</tbody></table></div>}
      {!!check.locations.length&&<details><summary>查看来源位置</summary><div className="quality-toolbar">{[...new Set(check.locations.map(p=>p.region))].map(region=>onLocate?<Button key={region} onClick={()=>onLocate(region)}>{region} · 定位</Button>:<span key={region}>{region}</span>)}</div></details>}
    </article>)}
  </section>;
}

export function WorkbookResults({definition,preview,compact=false,renderSheet,onLocate}) {
  const groups=preview?.sheets || [{sheetName:definition.sheetName,...preview}];
  return <section className={compact?'quality-all-preview':'quality-acceptance-results'} aria-label={compact?'模板各工作表解析结果':'验收解析结果'}>{groups.map(config=>{
    const parsed=config;
    return <section key={config.sheetName} className="quality-sheet-results" aria-label={`工作表 ${config.sheetName}`}>
      {preview?.sheets&&<div className="quality-sheet-result-heading"><h2>{config.sheetName}</h2><span className="muted">{definition.fields.length} 个字段{parsed?.issues.length?` · ${parsed.issues.length} 处问题`:''}</span></div>}
      {renderSheet?.(config.sheetName)}
      <QualityCheckResults checks={parsed.checks} onLocate={onLocate?region=>onLocate(config.sheetName,region):undefined}/>
      {definition.fields.map(field=><section className={compact?'quality-sheet-preview-field':'panel quality-acceptance-result'} key={field.id}>
        <div className="quality-acceptance-result-heading"><h3>{field.name}</h3><span className="muted">{qualityTypeLabels[field.type]} · {config.sheetName}!{field.valueRegion}</span>{field.type==='object'&&<Badge tone="blue">{parsed?.results?.find(r=>r.id===field.id)?.rows.length||0} 条记录</Badge>}</div>
        <PreviewTable field={field} preview={parsed}/>
      </section>)}
    </section>;
  })}</section>;
}
