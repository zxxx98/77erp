import { productionMessage } from '../i18n/production-errors.js';
import { qualityTypeLabels } from '../i18n/production-display.js';
import { t as pt } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { getWarehouseId } from '../api.js';
import { Badge, Button } from '../components/common.jsx';
import { cellAddress, hasTextProcessing, objectOrientation, preprocessText, previewChoice } from '../../shared/quality-template.js';
import { isManuallyCorrected } from '../../shared/quality-acceptance.js';
import { useState } from 'react';
import { Select } from '../Dropdown.jsx';

export const qualityUid = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join('-');
export function QualityNavigation({area,onChange,disabled}) {
  useLocale();
  return <nav className="quality-section-tabs" aria-label={pt("production.qualityManagementFeatures")}><Button disabled={disabled} kind={area==='acceptances'?'primary':'secondary'} onClick={()=>onChange('acceptances')}>{pt("production.acceptances")}</Button><Button disabled={disabled} kind={area==='templates'?'primary':'secondary'} onClick={()=>onChange('templates')}>{pt("production.templateConfiguration")}</Button><Button disabled={disabled} kind={area==='charts'?'primary':'secondary'} onClick={()=>onChange('charts')}>{pt("production.charts")}</Button></nav>;
}
export async function fetchQualityExcel(path) {
  const response = await fetch('/api/quality'+path,{credentials:'same-origin',headers:{'X-Warehouse-ID':String(getWarehouseId())}});
  if(!response.ok) {const data=await response.json();throw new Error(data.error||pt("production.downloadFailed"));}
  const disposition=response.headers.get('content-disposition')||'';
  const encoded=/filename\*=UTF-8''([^;]+)/i.exec(disposition), plain=/filename="([^"]+)"/i.exec(disposition);
  const filename=encoded?decodeURIComponent(encoded[1]):plain?.[1]||pt("production.acceptanceTemplateXlsx");
  return new File([await response.blob()],filename,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
export async function downloadExcel(path) {
  const file=await fetchQualityExcel(path);
  const url=URL.createObjectURL(file), link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function ChoiceSplitPreview({field,raw,compact=false}) {
  useLocale();
  if(!['single','multi'].includes(field?.type))return null;
  let processed;
  try {processed=preprocessText(raw,field);}catch{return null;}
  if(field.specialValues?.some(rule=>rule.text===processed.trim()))return null;
  const parsed=previewChoice(processed,field);
  const labels={selected:pt("production.selected"),unselected:pt("production.unselected"),unmarked:pt("production.unrecognizedMarker"),invalid:pt("production.cannotSplit"),empty:pt("production.blankSegment")};
  const content=<section className="quality-choice-split" aria-label={pt("production.optionSplitResults")}>
    <div className="quality-choice-heading"><strong>{pt("production.splitResults")}{parsed.parts.length} {pt("production.items")}</strong><small>{parsed.mode==='plain'?pt("production.exactWholeCellMatchPlain"):parsed.mode==='separator'?pt("production.splitBySpecifiedDelimiter"):pt("production.splitByOptionMarkers")}</small></div>
    {!parsed.parts.length&&<p className="muted">{parsed.error?pt("production.configureOptionRulesBeforeViewingSplitResults"):pt("production.isEmptyThereAreNoOptionsToSplit", { v0: hasTextProcessing(field)?pt("production.processedContent"):pt("production.originalContent") })}</p>}
    {parsed.parts.map((part,index)=><div className="quality-choice-part" key={index}>
      <div className="quality-choice-part-heading"><strong>{pt("production.batch")} {index+1} {pt("production.item")}</strong><Badge tone={part.status==='selected'?'green':part.status==='unselected'?'blue':'gray'}>{labels[part.status]}</Badge><small>{part.matched?pt("production.matchesAnAllowedOption"):pt("production.doesNotMatchAllowedOptions")}</small></div>
      <dl><dt>{pt("production.rawSegment")}</dt><dd><code>{part.raw||pt("production.empty")}</code></dd><dt>{pt("production.optionText")}</dt><dd>{part.label||pt("production.empty")}</dd><dt>{pt("production.detectedMarker")}</dt><dd><code>{part.marker||pt("production.none")}</code></dd></dl>
    </div>)}
  </section>;
  return compact?<details className="quality-choice-details"><summary>{pt("production.viewSplitResults")}{parsed.parts.length} {pt("production.items")}</summary>{content}</details>:content;
}
function PercentHint({field}) {
  useLocale();
  return field?.type==='number'&&field.numberMode==='percent'?<small className="muted">{pt("production.percentageValueUnit9595")}</small>:null;
}
const statusLabel=result=>result.status==='not_applicable'?pt("production.notApplicable"):result.status==='missing'?pt("production.notEntered"):null;
export function PreviewTable({preview,field,resultFirst=false}) {
  useLocale();
  const result=preview?.results?.find(r=>r.id===field.id);
  if(!result)return null;
  if(field.type!=='object'&&resultFirst)return <div className="quality-value-preview quality-result-first">
    <section className="quality-preview-result" aria-label={pt("production.parseResult")}><strong>{pt("production.parsedValue")}</strong><pre>{statusLabel(result)||JSON.stringify(result.value)}{isManuallyCorrected(preview,field.valueRegion)&&<small className="quality-manual-marker">{pt("production.manuallyCorrected")}</small>}</pre><PercentHint field={field}/></section>
    <div className="quality-preview-raw"><span>{isManuallyCorrected(preview,field.valueRegion)?pt("production.correctedContent"):pt("production.originalContent")}</span><pre>{result.raw||pt("production.empty")}</pre></div>
    {(hasTextProcessing(field)||['single','multi'].includes(field.type))&&<details className="quality-preview-details"><summary>{pt("production.viewProcessingAndSplitting")}</summary><ProcessedTextPreview field={field} raw={result.raw}/><ChoiceSplitPreview field={field} raw={result.raw}/></details>}
  </div>;
  if(field.type!=='object')return <div className="quality-value-preview"><span>{isManuallyCorrected(preview,field.valueRegion)?pt("production.correctedContent"):pt("production.originalContent")}</span><pre>{result.raw||pt("production.empty")}</pre><ProcessedTextPreview field={field} raw={result.raw}/><ChoiceSplitPreview field={field} raw={result.raw}/><span>{pt("production.parsedValue")}</span><pre>{statusLabel(result)||JSON.stringify(result.value)}{isManuallyCorrected(preview,field.valueRegion)&&<small className="quality-manual-marker">{pt("production.manuallyCorrected")}</small>}</pre><PercentHint field={field}/></div>;
  const vertical=objectOrientation(field)==='vertical';
  return <div className="quality-preview-table">{result.readCount!==undefined&&<p className="muted" aria-label={pt("production.actualObjectReadRange")}>{pt("production.read")} {result.readCount} {vertical?pt("production.columns"):pt("production.rows")} · {result.actualRegion||pt("production.noDataRange")} · {({fixed:pt("production.endOfFixedRange"),blank:vertical?pt("production.consecutiveBlankColumns"):pt("production.consecutiveBlankRows"),label:pt("production.endLabelReached"),usedRange:pt("production.endOfWorksheetUsedRange")})[result.stopReason]} · {result.rows.length} {pt("production.records")}</p>}<table><thead><tr><th>{vertical?pt("production.sourceColumn"):pt("production.sourceRow")}</th>{field.properties.map(p=><th key={p.id}>{p.name}</th>)}</tr></thead><tbody>{result.rows.map(row=><tr key={vertical?row.column:row.row}><th>{vertical?cellAddress(1,row.column).slice(0,-1):row.row}</th>{row.cells.map(c=>{
    const property=field.properties.find(p=>p.id===c.id),rule=property?.itemRules?.[c.ruleIndex],config=rule?.config||property;
    const invalid=preview.issues?.some(issue=>issue.fieldId===field.id&&issue.propertyId===c.id&&issue.region===c.region);
    return <td key={c.id}>{invalid?pt("production.invalid"):statusLabel(c)||(c.value===null||c.value===''?pt("production.notEntered2"):Array.isArray(c.value)?JSON.stringify(c.value):String(c.value))}{isManuallyCorrected(preview,c.region)&&<small className="quality-manual-marker">{pt("production.manuallyCorrected")}</small>}{rule&&<small className="quality-rule-match">{pt("production.itemRule")}{rule.equals} · {qualityTypeLabels[config.type]}</small>}{c.status&&<small>{pt("production.original")}{c.raw}</small>}<PercentHint field={config}/><ProcessedTextPreview field={config} raw={c.raw} compact/><ChoiceSplitPreview field={config} raw={c.raw} compact/></td>;
  })}</tr>)}</tbody></table>{!result.rows.length&&<p className="quality-empty">{pt("production.noEntriesInTheValueRangeYet")}</p>}</div>;
}

function ProcessedTextPreview({field,raw,compact=false}) {
  useLocale();
  if(!field||!hasTextProcessing(field))return null;
  let processed,error;
  try {processed=preprocessText(raw,field);}catch(e){error=e.message;}
  const content=<div className="quality-processed-text">{compact&&<><span>{pt("production.originalContent")}</span><pre>{raw||pt("production.empty")}</pre></>}<span>{pt("production.processedContent2")}</span>{error?<p className="form-error">{productionMessage(error)}</p>:<pre>{processed||pt("production.empty")}</pre>}</div>;
  return compact?<details className="quality-choice-details"><summary>{pt("production.viewContentProcessing")}</summary>{content}</details>:content;
}

export function QualityCheckResults({checks,onLocate}) {
  useLocale();
  if(!checks?.length)return null;
  const labels={pass:pt("production.checkPassed"),fail:pt("production.differencesFound"),review:pt("production.manualReviewRequired"),not_applicable:pt("production.notApplicable")};
  const order={fail:0,review:1,pass:2,not_applicable:3};
  return <section className="panel quality-check-results" aria-label={pt("production.systemCheckResults")}><h3>{pt("production.systemCheckResults")}</h3><p className="muted">{pt("production.theseChecksUseTemplateRulesOriginalReportDecisions")}</p>
    <div className="quality-toolbar">{Object.entries(labels).map(([status,label])=><span key={status}>{label} {checks.filter(c=>c.status===status).length}</span>)}</div>
    {[...checks].sort((a,b)=>order[a.status]-order[b.status]).map((check,index)=><article key={`${check.id}-${index}`} className={`quality-check-result quality-check-${check.status}`}>
      <strong>{check.name} · {labels[check.status]}</strong><p>{productionMessage(check.message)}</p>
      {check.measurements&&<div className="quality-preview-table"><table><thead><tr><th>{pt("production.samplePart")}</th><th>{pt("production.measuredValue")}</th><th>{pt("production.lowerLimit")}</th><th>{pt("production.upperLimit")}</th><th>{pt("production.check")}</th></tr></thead><tbody>{check.measurements.map((m,i)=><tr key={i}><td>{m.name}</td><td>{m.value}{check.unit}</td><td>{m.min===null?pt("production.noLimit"):`${m.minInclusive?'≥':'>'} ${m.min}${check.unit||''}`}</td><td>{m.max===null?pt("production.noLimit"):`${m.maxInclusive?'≤':'<'} ${m.max}${check.unit||''}`}</td><td>{m.pass?pt("production.withinRange"):pt("production.outOfRange")}</td></tr>)}</tbody></table></div>}
      {!!check.locations.length&&<details><summary>{pt("production.viewSourceLocations")}</summary><div className="quality-toolbar">{[...new Set(check.locations.map(p=>p.region))].map(region=>onLocate?<Button key={region} onClick={()=>onLocate(region)}>{region} {pt("production.locate")}</Button>:<span key={region}>{region}</span>)}</div></details>}
    </article>)}
  </section>;
}

export function WorkbookResults({definition,preview,compact=false,renderSheet,onLocate,sheetNavigation=false}) {
  useLocale();
  const [sheetName,setSheetName]=useState(null);
  const groups=preview?.sheets || [{sheetName:definition.sheetName,...preview}];
  const index=Math.max(0,groups.findIndex(group=>group.sheetName===sheetName));
  const paged=sheetNavigation&&groups.length>1;
  const visibleGroups=paged?[groups[index]]:groups;
  return <section className={compact?'quality-all-preview':'quality-acceptance-results'} aria-label={compact?pt("production.parsedResultsForTemplateWorksheets"):pt("production.acceptanceParseResults")}>
    {paged&&<nav className="panel quality-sheet-navigation" aria-label={pt("production.switchWorksheet")}>
      <Select label={pt("production.currentWorksheet")} searchable value={groups[index].sheetName} onChange={event=>setSheetName(event)}>{groups.map(group=><option key={group.sheetName} value={group.sheetName}>{group.sheetName}</option>)}</Select>
      <div className="quality-sheet-navigation-actions"><span className="muted" aria-live="polite">{index+1} / {groups.length} {pt("production.worksheets")}</span><Button disabled={index===0} onClick={()=>setSheetName(groups[index-1].sheetName)}>{pt("production.previousSheet")}</Button><Button disabled={index===groups.length-1} onClick={()=>setSheetName(groups[index+1].sheetName)}>{pt("production.nextSheet")}</Button></div>
    </nav>}
    {visibleGroups.map(config=>{
    const parsed=config;
    return <section key={config.sheetName} className="quality-sheet-results" aria-label={pt("production.worksheet", { v0: config.sheetName })}>
      {preview?.sheets&&<div className="quality-sheet-result-heading"><h2>{config.sheetName}</h2><span className="muted">{definition.fields.length} {pt("production.fields")}{parsed?.issues.length?pt("production.issues", { v0: parsed.issues.length }):''}</span></div>}
      {renderSheet?.(config.sheetName)}
      {!!parsed.manualCorrections?.length&&<section className="panel quality-correction-history" aria-label={pt("production.manualCorrectionHistory")}><h3>{pt("production.manualCorrections")} {parsed.manualCorrections.length} {pt("production.locations")}</h3><p className="muted">{pt("production.theFollowingDataWasManuallyCorrectedTheOriginal")}</p><div className="quality-preview-table"><table><thead><tr><th>{pt("production.location")}</th><th>{pt("production.originalContent")}</th><th>{pt("production.correctedContent")}</th></tr></thead><tbody>{parsed.manualCorrections.map(c=><tr key={c.address}><td>{onLocate?<Button onClick={()=>onLocate(config.sheetName,c.address)}>{c.address} {pt("production.locate")}</Button>:c.address}<small className="quality-manual-marker">{pt("production.manuallyCorrected")}</small></td><td><pre>{c.original||pt("production.empty")}</pre></td><td><pre>{c.text||pt("production.empty")}</pre></td></tr>)}</tbody></table></div></section>}
      <QualityCheckResults checks={parsed.checks} onLocate={onLocate?region=>onLocate(config.sheetName,region):undefined}/>
      {definition.fields.map(field=><section className={compact?'quality-sheet-preview-field':'panel quality-acceptance-result'} key={field.id}>
        <div className="quality-acceptance-result-heading"><h3>{field.name}</h3><span className="muted">{qualityTypeLabels[field.type]} · {config.sheetName}!{field.valueRegion}</span>{field.type==='object'&&<Badge tone="blue">{parsed?.results?.find(r=>r.id===field.id)?.rows.length||0} {pt("production.records")}</Badge>}</div>
        <PreviewTable field={field} preview={parsed}/>
      </section>)}
    </section>;
  })}</section>;
}
