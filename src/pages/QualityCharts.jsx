import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Plus, Save } from 'lucide-react';
import { api } from '../api.js';
import { Button, Modal, PageHeading, Badge } from '../components/common.jsx';
import { Select } from '../Dropdown.jsx';
import { queryPath, useQuery } from '../queries.js';
import { chartDateTypes, chartDimensionTypes, chartFields, chartTypeLabels, metricLabels, refKey } from '../../shared/quality-charts.js';
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
  return <label>{label}<Select aria-label={label} value={refKey(value)} onChange={event=>onChange(fields.find(field=>refKey(field.ref)===event.target.value)?.ref||null)}>
    <option value="" disabled={!emptyLabel}>{emptyLabel||'请选择字段'}</option>{fields.map(field=><option key={refKey(field.ref)} value={refKey(field.ref)}>{field.name}{field.unit?`（${field.unit}）`:''}</option>)}
  </Select></label>;
}
function PreviewScope({mode,onMode,data,sourceId,acceptanceId,onAcceptance}) {
  const [q,setQ]=useState('');
  const query=useQuery(mode==='single'?queryPath('/quality/chart-acceptances',{template_id:sourceId,q}):null,data,200);
  return <>
    <label>预览数据范围<Select aria-label="预览数据范围" value={mode} onChange={event=>{onMode(event.target.value);onAcceptance(null);}}><option value="saved">同一模板的已保存验收数据</option><option value="single">单张已保存验收单</option><option value="sample">模板样表</option></Select></label>
    {mode==='single'&&<><label>搜索预览验收单<input aria-label="搜索预览验收单" value={q} maxLength={100} onChange={event=>setQ(event.target.value)}/></label><label>预览验收单<Select aria-label="预览验收单" value={acceptanceId||''} onChange={event=>onAcceptance(Number(event.target.value))}><option value="" disabled>请选择验收单</option>{query.result?.acceptances.map(row=><option key={row.id} value={row.id}>{row.name} · {row.number}</option>)}</Select></label>{query.error&&<p className="form-error">{query.error}</p>}{query.result?.has_more&&<p className="muted">仅显示前 100 张，请输入名称或单号缩小范围。</p>}</>}
  </>;
}

function ChartEditor({data,chart,onClose,onSaved}) {
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
    const navigate=event=>{if(dirty&&!window.confirm('图表配置尚未保存，确定离开？'))event.preventDefault();};
    window.addEventListener('beforeunload',unload);window.addEventListener('erp:before-navigate',navigate);return()=>{window.removeEventListener('beforeunload',unload);window.removeEventListener('erp:before-navigate',navigate);};
  },[dirty]);
  const close=()=>{if(!busy&&(!dirty||window.confirm('图表配置尚未保存，确定放弃修改？')))onClose();};
  const change=next=>{setConfig(value=>({...value,...next}));setPreview(null);setError('');};
  const run=async fn=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn();}catch(error){setError(error.message);}finally{lock.current=false;setBusy(false);}};
  const payload=()=>({name,template_id:source.template_id,revision_id:source.revision_id,config});
  const fields=source?chartFields(source.definition,config.objectId):[],x=fields.find(field=>refKey(field.ref)===refKey(config.x));
  const numeric=fields.filter(field=>field.type==='number'),dates=fields.filter(field=>chartDateTypes.includes(field.type));
  const options=source&&!sources.some(row=>row.revision_id===source.revision_id)?[source,...sources]:sources;
  return <section className="quality-chart-editor">
    <PageHeading title={chart?'编辑品质图表':'新建品质图表'} description="选择模板与取数方式，配置字段和统计规则；物料图表按查看时的当前物料取数。">
      <Button icon={ArrowLeft} disabled={busy} onClick={close}>返回图表列表</Button><Button icon={Save} kind="primary" busy={busy} disabled={!source} onClick={()=>run(async()=>{
        const body=payload(),fingerprint=JSON.stringify(body);
        if(request.current?.fingerprint!==fingerprint)request.current={fingerprint,id:qualityUid()};
        const row=await api(chart?`/quality/charts/${chart.id}`:'/quality/charts',{method:chart?'PUT':'POST',body:{...body,...(chart?{version:chart.version}:{request_id:request.current.id})}});saved.current=JSON.stringify([name,sourceId,config]);onSaved(row);
      })}>保存图表</Button>
    </PageHeading>
    {error&&<p className="form-error quality-notice" role="alert">{error}</p>}
    <div className="quality-chart-editor-layout"><section className="panel quality-chart-config"><h2>图表配置</h2>
      <fieldset disabled={busy}>
        <label>图表名称<input aria-label="图表名称" maxLength={60} value={name} onChange={event=>{setName(event.target.value);setPreview(null);}}/></label>
        <label>图表分类<Select aria-label="图表分类" value={config.kind} onChange={event=>change({kind:event.target.value,groupBy:config.groupBy?.system==='material'?null:config.groupBy})}><option value="ordinary">普通图表</option><option value="material">物料图表</option></Select></label>
        {config.kind==='material'&&<p className="muted">配置供多个物料共用。在物料详情展示时，只读取绑定当前物料的 Sheet；没有对应模板数据的物料不显示此图表。</p>}
        <label>数据模板<Select aria-label="图表数据模板" value={sourceId} onChange={event=>{setSourceId(Number(event.target.value));setPreview(null);setAcceptanceId(null);}}><option value="" disabled>请选择已发布模板</option>{options.map(row=><option key={row.revision_id} value={row.revision_id}>{row.name} · v{row.revision}</option>)}</Select></label>
        {source&&<>
          <p className="muted">使用所选版本的字段规则，读取同一模板中字段 ID、类型和单位兼容的历史及后续验收数据。</p>
          <label>取数方式<Select aria-label="图表取数方式" value={config.objectId||''} onChange={event=>change(defaultConfig(source.definition,{...config,objectId:event.target.value||null}))}><option value="">Sheet 普通字段（每个 Sheet 一条记录）</option>{source.definition.fields.filter(field=>field.type==='object').map(field=><option key={field.id} value={field.id}>对象明细：{field.name}</option>)}</Select></label>
          {config.objectId&&<p className="muted">每条对象明细参与统计；同时使用 Sheet 普通字段时，该值会应用于每条明细。</p>}
          <FieldSelect label="横轴字段" fields={fields.filter(field=>dimensions.includes(field.type))} value={config.x} onChange={ref=>change({x:ref,dateField:chartDateTypes.includes(fields.find(field=>refKey(field.ref)===refKey(ref))?.type)?ref:config.dateField})}/>
          {chartDateTypes.includes(x?.type)&&<label>日期汇总<Select aria-label="日期汇总" value={config.bucket} onChange={event=>change({bucket:event.target.value})}><option value="day">按日</option><option value="week">按周（周一开始）</option><option value="month">按月</option></Select></label>}
          <label>分组字段<Select aria-label="分组字段" value={refKey(config.groupBy)} onChange={event=>change({groupBy:event.target.value==='$material'?{system:'material'}:fields.find(field=>refKey(field.ref)===event.target.value)?.ref||null})}><option value="">不分组</option>{config.kind==='ordinary'&&<option value="$material">按绑定物料分组</option>}{fields.filter(field=>dimensions.includes(field.type)).map(field=><option key={refKey(field.ref)} value={refKey(field.ref)}>{field.name}</option>)}</Select></label>
          <label>统计方式<Select aria-label="图表统计方式" value={config.metric.aggregation} onChange={event=>change({metric:event.target.value==='count'?{aggregation:'count'}:{aggregation:event.target.value,value:config.metric.value||numeric[0]?.ref||null}})}>{Object.entries(metricLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</Select></label>
          {config.metric.aggregation!=='count'&&<FieldSelect label="数值字段" fields={numeric} value={config.metric.value} onChange={ref=>change({metric:{...config.metric,value:ref}})}/>}
          {!numeric.length&&config.metric.aggregation!=='count'&&<p className="muted">此取数范围没有数字字段，请先配置模板数据类型，或选择统计记录数。</p>}
          <FieldSelect label="日期筛选字段" fields={dates} value={config.dateField} emptyLabel="不启用日期筛选" onChange={ref=>change({dateField:ref})}/>
          <label>图表样式<Select aria-label="图表样式" value={config.chartType} onChange={event=>change({chartType:event.target.value})}>{Object.entries(chartTypeLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</Select></label>
        </>}
      </fieldset>
    </section><section className="panel quality-chart-preview"><h2>数据预览</h2>
      <fieldset disabled={busy}><PreviewScope mode={mode} onMode={value=>{setMode(value);setPreview(null);}} sourceId={source?.template_id} acceptanceId={acceptanceId} onAcceptance={id=>{setAcceptanceId(id);setPreview(null);}} data={data}/></fieldset>
      {config.kind==='material'&&<div className="quality-chart-preview-product"><span>{product?`${product.name} · ${product.barcode}`:'未选择预览物料'}</span><Button disabled={busy} onClick={()=>setPicking(true)}>选择预览物料</Button><p className="muted">预览物料仅用于检查效果，不保存为图表的固定筛选条件。模板样表可直接预览。</p></div>}
      <Button disabled={!source||busy||mode==='single'&&!acceptanceId||config.kind==='material'&&mode!=='sample'&&!product} busy={busy} onClick={()=>run(async()=>setPreview(await api('/quality/charts/preview',{method:'POST',body:{...payload(),sample:mode==='sample',...(mode==='single'?{acceptance_id:acceptanceId}:{}),...(product&&config.kind==='material'?{product_id:product.id}:{})}})))}>生成预览</Button>
      {preview?<><p className="muted">{preview.sample?'模板样表预览，不代表正式验收数据':`已保存验收数据 · ${preview.stats.sheets} 个 Sheet · ${preview.stats.records} 条记录`}</p><QualityChartView result={preview} type={config.chartType} title={`${name}预览`}/>{!!preview.stats.incompatibleSheets&&<p className="muted">{preview.stats.incompatibleSheets} 个 Sheet 字段类型或单位不兼容，未参与统计。</p>}</>:<div className="quality-chart-empty">选择数据范围后生成预览，保存规则后新验收数据会自动参与统计。</div>}
    </section></div>
    {picking&&<MaterialPicker data={data} title="选择预览物料" subtitle="仅用于检查图表效果，不固定绑定此物料" onClose={()=>setPicking(false)} onChoose={product=>{setProduct(product);setPicking(false);setPreview(null);}}/>}
  </section>;
}

function ChartViewer({chart,data,onClose}) {
  const [product,setProduct]=useState(null),[picking,setPicking]=useState(false);
  return <Modal title={chart.name} subtitle={chart.config.kind==='material'?'物料图表预览':'普通图表'} wide onClose={onClose}><div className="form-body quality-chart-modal">
    <div className="quality-toolbar"><span>{product?`${product.name} · ${product.barcode}`:chart.config.kind==='material'?'请选择一个物料预览':'全部物料及未绑定的 Sheet'}</span><Button onClick={()=>setPicking(true)}>选择物料筛选</Button>{product&&chart.config.kind==='ordinary'&&<Button onClick={()=>setProduct(null)}>清除物料筛选</Button>}</div>
    {(chart.config.kind==='ordinary'||product)&&<QualityChartData key={product?.id||'all'} chart={chart} data={data} productId={product?.id}/>}
    {picking&&<MaterialPicker data={data} title="选择预览物料" subtitle="按当前仓库物料筛选图表数据" onClose={()=>setPicking(false)} onChoose={product=>{setProduct(product);setPicking(false);}}/>}
  </div></Modal>;
}

export function QualityCharts({data,onAreaChange}) {
  const [q,setQ]=useState(''),[kind,setKind]=useState('all'),[offset,setOffset]=useState(0),[editor,setEditor]=useState(null),[view,setView]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const list=useQuery(queryPath('/quality/charts',{q,kind,offset}),data,150);
  const lock=useRef(false),run=async fn=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn();}catch(error){setError(error.message);}finally{lock.current=false;setBusy(false);}};
  if(editor)return <ChartEditor key={editor.id||'new'} data={data} chart={editor.id?editor:null} onClose={()=>setEditor(null)} onSaved={()=>{setEditor(null);list.retry();setMessage('图表已保存。');}}/>;
  return <>
    <QualityNavigation area="charts" onChange={onAreaChange} disabled={busy}/>
    <PageHeading title="品质图表" description="配置普通图表和供多个物料复用的物料图表，读取已保存的验收数据。"><Button kind="primary" icon={Plus} onClick={()=>{setEditor({});setMessage('');}}>新建图表</Button></PageHeading>
    {(error||list.error)&&<div className="form-error quality-notice" role="alert">{error||list.error}</div>}{message&&<p className="quality-notice quality-success" role="status">{message}</p>}
    <section className="panel"><div className="table-toolbar quality-list-toolbar"><h2>图表列表</h2><div className="quality-toolbar quality-list-filters"><input aria-label="搜索品质图表" placeholder="搜索图表名称" value={q} onChange={event=>{setQ(event.target.value);setOffset(0);}}/><Select aria-label="图表分类筛选" value={kind} onChange={event=>{setKind(event.target.value);setOffset(0);}}><option value="all">全部图表</option><option value="ordinary">普通图表</option><option value="material">物料图表</option></Select></div></div>
      <div className="quality-list-scroll"><table className="quality-list"><colgroup><col/><col/><col/><col/><col className="quality-list-action-column"/></colgroup><thead><tr><th>图表名称</th><th>分类 / 样式</th><th>数据模板</th><th>状态</th><th>操作</th></tr></thead><tbody>{list.result?.charts.map(chart=><tr key={chart.id}>
        <td><strong>{chart.name}</strong></td><td>{chart.config.kind==='material'?'物料图表':'普通图表'}<small>{chartTypeLabels[chart.config.chartType]}</small></td><td>{chart.template_name}<small>字段规则 v{chart.revision}</small></td><td><Badge tone={chart.enabled?'green':'orange'}>{chart.enabled?'已启用':'已停用'}</Badge></td><td><div className="quality-actions"><Button disabled={busy} onClick={()=>setView(chart)}>查看图表</Button><Button disabled={busy} onClick={()=>run(async()=>setEditor(await api(`/quality/charts/${chart.id}`)))}>编辑图表</Button><Button disabled={busy} onClick={()=>run(async()=>{await api(`/quality/charts/${chart.id}/status`,{method:'POST',body:{version:chart.version,enabled:!chart.enabled}});list.retry();})}>{chart.enabled?'停用图表':'启用图表'}</Button><Button disabled={busy} onClick={()=>{if(window.confirm(`确定删除图表“${chart.name}”？`))void run(async()=>{await api(`/quality/charts/${chart.id}`,{method:'DELETE',body:{version:chart.version}});list.retry();});}}>删除图表</Button></div></td>
      </tr>)}</tbody></table></div>{list.loading?<p className="quality-empty" role="status">正在读取图表…</p>:!list.result?.charts.length&&<p className="quality-empty">暂无匹配的品质图表。</p>}
      {(list.result?.total||0)>20&&<div className="quality-toolbar quality-pagination"><Button disabled={!offset} onClick={()=>setOffset(value=>value-20)}>上一页</Button><span>{offset+1}–{Math.min(offset+20,list.result.total)} / {list.result.total}</span><Button disabled={offset+20>=list.result.total} onClick={()=>setOffset(value=>value+20)}>下一页</Button></div>}
    </section>{view&&<ChartViewer chart={view} data={data} onClose={()=>setView(null)}/>}
  </>;
}
