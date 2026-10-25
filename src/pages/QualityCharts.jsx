import { productionMessage } from '../i18n/production-errors.js';
import { chartTypeLabels, metricLabels } from '../i18n/production-display.js';
import { t as pt } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { ConfigProvider as AntConfigProvider } from 'antd';
import { Input as AntInput } from '../ui/controls.jsx';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Plus, Save } from 'lucide-react';
import { api } from '../api.js';
import { Button, Modal, PageHeading, Badge } from '../components/common.jsx';
import { Select } from '../Dropdown.jsx';
import { queryPath, useQuery } from '../queries.js';
import { chartDateTypes, chartDimensionTypes, chartFields, refKey } from '../../shared/quality-charts.js';
import { QualityNavigation, qualityUid } from './quality-shared.jsx';
import { MaterialPicker } from './QualityMaterialBinding.jsx';
import { QualityChartData, QualityChartView } from './QualityChartView.jsx';

const initialConfig={schemaVersion:1,kind:'ordinary',chartType:'line',objectId:null,x:null,dateField:null,bucket:'day',groupBy:null,metric:{aggregation:'avg',value:null}};
const dimensions=chartDimensionTypes;
function defaultConfig(definition,previous=initialConfig) {
  const fields=chartFields(definition,previous.objectId),x=fields.find(field=>chartDateTypes.includes(field.type))||fields.find(field=>dimensions.includes(field.type)),value=fields.find(field=>field.type==='number');
  return {...previous,x:x?.ref||null,dateField:chartDateTypes.includes(x?.type)?x.ref:null,groupBy:null,metric:value?{aggregation:'avg',value:value.ref}:{aggregation:'count'}};
}
function FieldSelect({label,fields,value,onChange,emptyLabel}) {
  useLocale();
  return <label>{label}<Select aria-label={label} value={refKey(value)} onChange={event=>onChange(fields.find(field=>refKey(field.ref)===event)?.ref||null)}>
    <option value="" disabled={!emptyLabel}>{emptyLabel||pt("production.selectAField")}</option>{fields.map(field=><option key={refKey(field.ref)} value={refKey(field.ref)}>{field.name}{field.unit?`（${field.unit}）`:''}</option>)}
  </Select></label>;
}
function PreviewScope({mode,onMode,data,sourceId,acceptanceId,onAcceptance}) {
  useLocale();
  const [q,setQ]=useState('');
  const query=useQuery(mode==='single'?queryPath('/quality/chart-acceptances',{template_id:sourceId,q}):null,data,200);
  return <>
    <label>{pt("production.previewDataScope")}<Select aria-label={pt("production.previewDataScope")} value={mode} onChange={event=>{onMode(event);onAcceptance(null);}}><option value="saved">{pt("production.savedAcceptanceDataFromThisTemplate")}</option><option value="single">{pt("production.oneSavedAcceptance")}</option><option value="sample">{pt("production.templateSample")}</option></Select></label>
    {mode==='single'&&<><label>{pt("production.searchPreviewAcceptances")}<AntInput aria-label={pt("production.searchPreviewAcceptances")} value={q} maxLength={100} onChange={event=>setQ(event.target.value)}/></label><label>{pt("production.previewAcceptance")}<Select aria-label={pt("production.previewAcceptance")} value={acceptanceId||''} onChange={event=>onAcceptance(Number(event))}><option value="" disabled>{pt("production.selectAnAcceptance")}</option>{query.result?.acceptances.map(row=><option key={row.id} value={row.id}>{row.name} · {row.number}</option>)}</Select></label>{query.error&&<p className="form-error">{query.error}</p>}{query.result?.has_more&&<p className="muted">{pt("production.onlyTheFirst100AreShownEnterA")}</p>}</>}
  </>;
}

function ChartEditor({data,chart,onClose,onSaved}) {
  useLocale();
  const [name,setName]=useState(chart?.name||''),[config,setConfig]=useState(chart?.config||initialConfig),[source,setSource]=useState(chart?.source||null);
  const [sources,setSources]=useState([]),[sourceId,setSourceId]=useState(chart?.revision_id||''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [mode,setMode]=useState('saved'),[acceptanceId,setAcceptanceId]=useState(null),[preview,setPreview]=useState(null),[product,setProduct]=useState(null),[picking,setPicking]=useState(false);
  const saved=useRef(JSON.stringify([chart?.name||'',chart?.revision_id||'',chart?.config||initialConfig])),request=useRef(null),lock=useRef(false);
  const dirty=JSON.stringify([name,sourceId,config])!==saved.current;
  useEffect(()=>{
    const controller=new AbortController();api('/quality/chart-sources',{signal:controller.signal}).then(result=>setSources(result.sources)).catch(error=>{if(!controller.signal.aborted)setError(error.message);});return()=>controller.abort();
  },[data]);
  useEffect(()=>{
    if(!sourceId||source?.revision_id===Number(sourceId))return;
    const controller=new AbortController();setSource(null);setPreview(null);
    api(`/quality/chart-sources/${sourceId}`,{signal:controller.signal}).then(result=>{setSource(result);setConfig(value=>defaultConfig(result.definition,{...value,objectId:null}));}).catch(error=>{if(!controller.signal.aborted)setError(error.message);});return()=>controller.abort();
  },[sourceId,source?.revision_id]);
  useEffect(()=>{
    const unload=event=>{if(dirty){event.preventDefault();event.returnValue='';}};
    const navigate=event=>{if(dirty&&!window.confirm(pt("production.chartConfigurationIsUnsavedLeave")))event.preventDefault();};
    window.addEventListener('beforeunload',unload);window.addEventListener('erp:before-navigate',navigate);return()=>{window.removeEventListener('beforeunload',unload);window.removeEventListener('erp:before-navigate',navigate);};
  },[dirty]);
  const close=()=>{if(!busy&&(!dirty||window.confirm(pt("production.chartConfigurationIsUnsavedDiscardChanges"))))onClose();};
  const change=next=>{setConfig(value=>({...value,...next}));setPreview(null);setError('');};
  const run=async fn=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn();}catch(error){setError(error.message);}finally{lock.current=false;setBusy(false);}};
  const payload=()=>({name,template_id:source.template_id,revision_id:source.revision_id,config});
  const fields=source?chartFields(source.definition,config.objectId):[],x=fields.find(field=>refKey(field.ref)===refKey(config.x));
  const numeric=fields.filter(field=>field.type==='number'),dates=fields.filter(field=>chartDateTypes.includes(field.type));
  const options=source&&!sources.some(row=>row.revision_id===source.revision_id)?[source,...sources]:sources;
  return <section className="quality-chart-editor">
    <PageHeading title={chart?pt("production.editQualityChart"):pt("production.newQualityChart")} description={pt("production.selectATemplateAndDataSourceThenConfigure")}>
      <Button icon={ArrowLeft} disabled={busy} onClick={close}>{pt("production.backToCharts")}</Button><Button icon={Save} kind="primary" busy={busy} disabled={!source} onClick={()=>run(async()=>{
        const body=payload(),fingerprint=JSON.stringify(body);
        if(request.current?.fingerprint!==fingerprint)request.current={fingerprint,id:qualityUid()};
        const row=await api(chart?`/quality/charts/${chart.id}`:'/quality/charts',{method:chart?'PUT':'POST',body:{...body,...(chart?{version:chart.version}:{request_id:request.current.id})}});saved.current=JSON.stringify([name,sourceId,config]);onSaved(row);
      })}>{pt("production.saveChart")}</Button>
    </PageHeading>
    {error&&<p className="form-error quality-notice" role="alert">{productionMessage(error)}</p>}
    <div className="quality-chart-editor-layout"><section className="panel quality-chart-config"><h2>{pt("production.chartConfiguration")}</h2>
      <AntConfigProvider componentDisabled={busy}><fieldset disabled={busy}>
        <label>{pt("production.chartName")}<AntInput aria-label={pt("production.chartName")} maxLength={60} value={name} onChange={event=>{setName(event.target.value);setPreview(null);}}/></label>
        <label>{pt("production.chartCategory")}<Select aria-label={pt("production.chartCategory")} value={config.kind} onChange={event=>change({kind:event,groupBy:config.groupBy?.system==='material'?null:config.groupBy})}><option value="ordinary">{pt("production.generalChart")}</option><option value="material">{pt("production.materialChart")}</option></Select></label>
        {config.kind==='material'&&<p className="muted">{pt("production.sharedByMultipleMaterialsInMaterialDetailsOnly")}</p>}
        <label>{pt("production.dataTemplate")}<Select aria-label={pt("production.chartDataTemplate")} value={sourceId} onChange={event=>{setSourceId(Number(event));setPreview(null);setAcceptanceId(null);}}><option value="" disabled>{pt("production.selectAPublishedTemplate")}</option>{options.map(row=><option key={row.revision_id} value={row.revision_id}>{row.name} · v{row.revision}</option>)}</Select></label>
        {source&&<>
          <p className="muted">{pt("production.usesTheSelectedVersionSFieldRulesTo")}</p>
          <label>{pt("production.dataSource")}<Select aria-label={pt("production.chartDataSource")} value={config.objectId||''} onChange={event=>change(defaultConfig(source.definition,{...config,objectId:event||null}))}><option value="">{pt("production.sheetFieldsOneRecordPerSheet")}</option>{source.definition.fields.filter(field=>field.type==='object').map(field=><option key={field.id} value={field.id}>{pt("production.objectDetails")}{field.name}</option>)}</Select></label>
          {config.objectId&&<p className="muted">{pt("production.eachObjectDetailContributesToStatisticsSheetLevel")}</p>}
          <FieldSelect label={config.chartType==='pie'?pt("production.categoryField"):pt("production.xAxisField")} fields={fields.filter(field=>dimensions.includes(field.type))} value={config.x} onChange={ref=>change({x:ref,dateField:chartDateTypes.includes(fields.find(field=>refKey(field.ref)===refKey(ref))?.type)?ref:config.dateField})}/>
          {chartDateTypes.includes(x?.type)&&<label>{pt("production.dateAggregation")}<Select aria-label={pt("production.dateAggregation")} value={config.bucket} onChange={event=>change({bucket:event})}><option value="day">{pt("production.daily")}</option><option value="week">{pt("production.weeklyStartingMonday")}</option><option value="month">{pt("production.monthly")}</option></Select></label>}
          <label>{pt("production.groupField")}<Select aria-label={pt("production.groupField")} value={refKey(config.groupBy)} onChange={event=>change({groupBy:event==='$material'?{system:'material'}:fields.find(field=>refKey(field.ref)===event)?.ref||null})}><option value="">{pt("production.noGrouping")}</option>{config.kind==='ordinary'&&<option value="$material">{pt("production.groupByBoundMaterial")}</option>}{fields.filter(field=>dimensions.includes(field.type)).map(field=><option key={refKey(field.ref)} value={refKey(field.ref)}>{field.name}</option>)}</Select></label>
          <label>{pt("production.aggregation")}<Select aria-label={pt("production.chartAggregation")} value={config.metric.aggregation} onChange={event=>change({metric:event==='count'?{aggregation:'count'}:{aggregation:event,value:config.metric.value||numeric[0]?.ref||null}})}>{Object.entries(metricLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</Select></label>
          {config.metric.aggregation!=='count'&&<FieldSelect label={pt("production.numericField")} fields={numeric} value={config.metric.value} onChange={ref=>change({metric:{...config.metric,value:ref}})}/>}
          {!numeric.length&&config.metric.aggregation!=='count'&&<p className="muted">{pt("production.thisScopeHasNoNumericFieldsConfigureTemplate")}</p>}
          <FieldSelect label={pt("production.dateFilterField")} fields={dates} value={config.dateField} emptyLabel={pt("production.noDateFilter")} onChange={ref=>change({dateField:ref})}/>
          <label>{pt("production.chartStyle")}<Select aria-label={pt("production.chartStyle")} value={config.chartType} onChange={event=>change({chartType:event})}>{Object.entries(chartTypeLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</Select></label>
          {config.chartType==='pie'&&<p className="muted">{pt("production.sharesUseTheCategoryFieldAndSelectedAggregation")}</p>}
        </>}
      </fieldset></AntConfigProvider>
    </section><section className="panel quality-chart-preview"><h2>{pt("production.dataPreview")}</h2>
      <AntConfigProvider componentDisabled={busy}><fieldset disabled={busy}><PreviewScope mode={mode} onMode={value=>{setMode(value);setPreview(null);}} sourceId={source?.template_id} acceptanceId={acceptanceId} onAcceptance={id=>{setAcceptanceId(id);setPreview(null);}} data={data}/></fieldset></AntConfigProvider>
      {config.kind==='material'&&<div className="quality-chart-preview-product"><span>{product?`${product.name} · ${product.barcode}`:pt("production.noPreviewMaterialSelected")}</span><Button disabled={busy} onClick={()=>setPicking(true)}>{pt("production.selectPreviewMaterial")}</Button><p className="muted">{pt("production.previewMaterialIsOnlyForCheckingResultsNot")}</p></div>}
      <Button disabled={!source||busy||mode==='single'&&!acceptanceId||config.kind==='material'&&mode!=='sample'&&!product} busy={busy} onClick={()=>run(async()=>setPreview(await api('/quality/charts/preview',{method:'POST',body:{...payload(),sample:mode==='sample',...(mode==='single'?{acceptance_id:acceptanceId}:{}),...(product&&config.kind==='material'?{product_id:product.id}:{})}})))}>{pt("production.generatePreview")}</Button>
      {preview?<><p className="muted">{preview.sample?pt("production.templateSamplePreviewNotOfficialAcceptanceData"):pt("production.savedAcceptanceDataSheetsRecords", { v0: preview.stats.sheets, v1: preview.stats.records })}</p><QualityChartView result={preview} type={config.chartType} title={pt("production.preview", { v0: name })}/>{!!preview.stats.incompatibleSheets&&<p className="muted">{preview.stats.incompatibleSheets} {pt("production.sheetsExcludedDueToIncompatibleFieldTypesOr")}</p>}</>:<div className="quality-chart-empty">{pt("production.selectADataScopeAndGenerateAPreview")}</div>}
    </section></div>
    {picking&&<MaterialPicker data={data} title={pt("production.selectPreviewMaterial")} subtitle={pt("production.onlyChecksChartAppearanceDoesNotPermanentlyBind")} onClose={()=>setPicking(false)} onChoose={product=>{setProduct(product);setPicking(false);setPreview(null);}}/>}
  </section>;
}

function ChartViewer({chart,data,onClose}) {
  useLocale();
  const [product,setProduct]=useState(null),[picking,setPicking]=useState(false);
  return <Modal title={chart.name} subtitle={chart.config.kind==='material'?pt("production.materialChartPreview"):pt("production.generalChart")} wide onClose={onClose}><div className="form-body quality-chart-modal">
    <div className="quality-toolbar"><span>{product?`${product.name} · ${product.barcode}`:chart.config.kind==='material'?pt("production.selectAMaterialToPreview"):pt("production.allMaterialsAndUnboundSheets")}</span><Button onClick={()=>setPicking(true)}>{pt("production.selectMaterialFilter")}</Button>{product&&chart.config.kind==='ordinary'&&<Button onClick={()=>setProduct(null)}>{pt("production.clearMaterialFilter")}</Button>}</div>
    {(chart.config.kind==='ordinary'||product)&&<QualityChartData key={product?.id||'all'} chart={chart} data={data} productId={product?.id}/>}
    {picking&&<MaterialPicker data={data} title={pt("production.selectPreviewMaterial")} subtitle={pt("production.filterChartDataByMaterialsInTheCurrent")} onClose={()=>setPicking(false)} onChoose={product=>{setProduct(product);setPicking(false);}}/>}
  </div></Modal>;
}

export function QualityCharts({data,onAreaChange}) {
  useLocale();
  const [q,setQ]=useState(''),[kind,setKind]=useState('all'),[offset,setOffset]=useState(0),[editor,setEditor]=useState(null),[view,setView]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const list=useQuery(queryPath('/quality/charts',{q,kind,offset}),data,150);
  const lock=useRef(false),run=async fn=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn();}catch(error){setError(error.message);}finally{lock.current=false;setBusy(false);}};
  if(editor)return <ChartEditor key={editor.id||'new'} data={data} chart={editor.id?editor:null} onClose={()=>setEditor(null)} onSaved={()=>{setEditor(null);list.retry();setMessage(pt("production.chartSaved"));}}/>;
  return <>
    <QualityNavigation area="charts" onChange={onAreaChange} disabled={busy}/>
    <PageHeading title={pt("production.qualityCharts")} description={pt("production.configureGeneralChartsAndReusableMaterialChartsFrom")}><Button kind="primary" icon={Plus} onClick={()=>{setEditor({});setMessage('');}}>{pt("production.newChart")}</Button></PageHeading>
    {(error||list.error)&&<div className="form-error quality-notice" role="alert">{error||list.error}</div>}{message&&<p className="quality-notice quality-success" role="status">{productionMessage(message)}</p>}
    <section className="panel"><div className="table-toolbar quality-list-toolbar"><h2>{pt("production.chartList")}</h2><div className="quality-toolbar quality-list-filters"><AntInput aria-label={pt("production.searchQualityCharts")} placeholder={pt("production.searchChartName")} value={q} onChange={event=>{setQ(event.target.value);setOffset(0);}}/><Select aria-label={pt("production.chartCategoryFilter")} value={kind} onChange={event=>{setKind(event);setOffset(0);}}><option value="all">{pt("production.allCharts")}</option><option value="ordinary">{pt("production.generalChart")}</option><option value="material">{pt("production.materialChart")}</option></Select></div></div>
      <div className="quality-list-scroll"><table className="quality-list"><colgroup><col/><col/><col/><col/><col className="quality-list-action-column"/></colgroup><thead><tr><th>{pt("production.chartName")}</th><th>{pt("production.categoryStyle")}</th><th>{pt("production.dataTemplate")}</th><th>{pt("production.status")}</th><th>{pt("production.actions")}</th></tr></thead><tbody>{list.result?.charts.map(chart=><tr key={chart.id}>
        <td><strong>{chart.name}</strong></td><td>{chart.config.kind==='material'?pt("production.materialChart"):pt("production.generalChart")}<small>{chartTypeLabels[chart.config.chartType]}</small></td><td>{chart.template_name}<small>{pt("production.fieldRulesV")}{chart.revision}</small></td><td><Badge tone={chart.enabled?'green':'orange'}>{chart.enabled?pt("production.enabled"):pt("production.disabled2")}</Badge></td><td><div className="quality-actions"><Button disabled={busy} onClick={()=>setView(chart)}>{pt("production.viewChart")}</Button><Button disabled={busy} onClick={()=>run(async()=>setEditor(await api(`/quality/charts/${chart.id}`)))}>{pt("production.editChart")}</Button><Button disabled={busy} onClick={()=>run(async()=>{await api(`/quality/charts/${chart.id}/status`,{method:'POST',body:{version:chart.version,enabled:!chart.enabled}});list.retry();})}>{chart.enabled?pt("production.disableChart"):pt("production.enableChart")}</Button><Button disabled={busy} onClick={()=>{if(window.confirm(pt("production.deleteChart", { v0: chart.name })))void run(async()=>{await api(`/quality/charts/${chart.id}`,{method:'DELETE',body:{version:chart.version}});list.retry();});}}>{pt("production.deleteChart2")}</Button></div></td>
      </tr>)}</tbody></table></div>{list.loading?<p className="quality-empty" role="status">{pt("production.loadingChart")}</p>:!list.result?.charts.length&&<p className="quality-empty">{pt("production.noMatchingQualityCharts")}</p>}
      {(list.result?.total||0)>20&&<div className="quality-toolbar quality-pagination"><Button disabled={!offset} onClick={()=>setOffset(value=>value-20)}>{pt("production.previous")}</Button><span>{offset+1}–{Math.min(offset+20,list.result.total)} / {list.result.total}</span><Button disabled={offset+20>=list.result.total} onClick={()=>setOffset(value=>value+20)}>{pt("production.next")}</Button></div>}
    </section>{view&&<ChartViewer chart={view} data={data} onClose={()=>setView(null)}/>}
  </>;
}
