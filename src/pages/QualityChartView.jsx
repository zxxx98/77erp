import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Modal } from '../components/common.jsx';
import { FullscreenChart } from '../components/FullscreenChart.jsx';
import { queryPath, useQuery } from '../queries.js';
import { api } from '../api.js';
import { Select } from '../Dropdown.jsx';
import { WorkbookResults, downloadExcel } from './quality-shared.jsx';
import '../quality.css';

const colors=['#2864eb','#00a68a','#e69c31','#985be5','#df6483','#188caf'];
export const chartNumber=(value,unit='')=>value===null?'—':`${new Intl.NumberFormat('zh-CN',{maximumFractionDigits:4}).format(value)}${unit}`;
export function QualityChartView({result,type,title,onSources}) {
  if(!result.rows.length)return <div className="quality-chart-empty">该范围暂无可用数据。</div>;
  return <FullscreenChart title={title}>{fullscreen=> <QualityChartContent result={result} type={type} title={title} onSources={onSources} fullscreen={fullscreen}/>}</FullscreenChart>;
}

function QualityChartContent({result,type,title,onSources,fullscreen}) {
  const plotRef=useRef(null),[plotSize,setPlotSize]=useState({width:820,height:320});
  useEffect(()=>{
    if(!fullscreen||!plotRef.current)return;
    const observer=new ResizeObserver(([entry])=>setPlotSize({width:entry.contentRect.width,height:entry.contentRect.height}));
    observer.observe(plotRef.current);
    return ()=>observer.disconnect();
  },[fullscreen,type]);
  const rows=result.rows,labels=[...new Set(rows.map(row=>row.x))],series=[...new Set(rows.map(row=>row.series))];
  if(!rows.length)return <div className="quality-chart-empty">该范围暂无可用数据。</div>;
  const availableWidth=fullscreen?Math.max(360,plotSize.width):820;
  const width=type==='bar'?Math.max(availableWidth,Math.min(28000,labels.length*series.length*24)):availableWidth,height=fullscreen?Math.max(280,plotSize.height):320,left=74,right=24,top=24,bottom=66;
  const max=Math.max(0,...rows.map(row=>row.value)),min=Math.min(0,...rows.map(row=>row.value)),span=max-min||1;
  const y=value=>height-bottom-(value-min)/span*(height-bottom-top);
  const values=labels.map(value=>result.xType==='number'?Number(value):result.xType==='date'?Date.parse(String(value).length===7?`${value}-01`:value):null);
  const linear=result.xType==='number'||result.xType==='date',first=linear?Math.min(...values):0,last=linear?Math.max(...values):labels.length-1;
  const barWidth=Math.min(38,(width-left-right)/Math.max(1,labels.length)/(series.length+1));
  const padding=type==='bar'?Math.max(24,series.length*barWidth/2):24;
  const x=value=>{const index=labels.indexOf(value),n=linear?values[index]:index;return left+padding+(last===first?0.5:(n-first)/(last-first))*(width-left-right-2*padding);};
  const label=key=>rows.find(row=>row.series===key)?.seriesLabel||key;
  return <div className="quality-chart-view">
    {type!=='table'&&<>
      <div className="quality-chart-legend">{series.map((key,i)=><span key={key}><i style={{background:colors[i%colors.length]}}/>{label(key)}</span>)}</div>
      <div className="quality-chart-scroll" ref={plotRef}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} style={{minWidth:type==='bar'?width:undefined}}>
        <title>{title}</title>{Array.from({length:5},(_,i)=>{const value=min+span*i/4;return <g key={i}><line x1={left} x2={width-right} y1={y(value)} y2={y(value)} stroke="var(--border)"/><text x={left-10} y={y(value)+4} textAnchor="end" className="quality-chart-axis">{chartNumber(value,result.unit)}</text></g>;})}
        {labels.filter((_,i)=>i%Math.max(1,Math.ceil(labels.length/7))===0||i===labels.length-1).map(value=><text key={String(value)} x={x(value)} y={height-bottom+24} textAnchor="middle" className="quality-chart-axis"><title>{String(value)}</title>{String(value).length>14?`${String(value).slice(0,13)}…`:String(value)}</text>)}
        {series.map((key,i)=>{
          const points=labels.map(value=>rows.find(row=>row.x===value&&row.series===key)),color=colors[i%colors.length];
          let path='',previous=false;for(const point of points){if(point){path+=`${previous?' L':' M'}${x(point.x)},${y(point.value)}`;previous=true;}else previous=false;}
          return <g key={key}>
            {type==='line'&&<path d={path} fill="none" stroke={color} strokeWidth="2.5"/>}
            {points.filter(Boolean).map(point=>{
              const text=`${point.x} · ${label(key)}：${chartNumber(point.value,result.unit)}`;
              const props={key:String(point.x),fill:color,onClick:onSources?()=>onSources(point):undefined,role:onSources?'button':undefined,tabIndex:onSources?0:undefined,'aria-label':onSources?`查看来源 ${text}`:undefined,onKeyDown:onSources?event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onSources(point);}}:undefined,style:{cursor:onSources?'pointer':undefined}};
              return type==='line'?<circle {...props} cx={x(point.x)} cy={y(point.value)} r="5"><title>{text}</title></circle>:<rect {...props} x={x(point.x)+(i-series.length/2)*barWidth} y={Math.min(y(0),y(point.value))} width={Math.max(1,barWidth-3)} height={Math.max(2,Math.abs(y(0)-y(point.value)))} rx="2"><title>{text}</title></rect>;
            })}
          </g>;
        })}
      </svg></div>
    </>}
    <details className="quality-chart-table" open={type==='table'}><summary>查看统计数据（{rows.length} 项）</summary><div className="quality-preview-table"><table><thead><tr><th>横轴</th><th>分组</th><th>数值{result.unit?`（${result.unit}）`:''}</th><th>参与记录数</th>{onSources&&<th>来源</th>}</tr></thead><tbody>{rows.map(row=><tr key={JSON.stringify([row.x,row.series])}><td>{String(row.x)}</td><td>{row.seriesLabel}</td><td>{chartNumber(row.value,result.unit)}</td><td>{row.count}</td>{onSources&&<td><Button onClick={()=>onSources(row)}>查看来源</Button></td>}</tr>)}</tbody></table></div></details>
  </div>;
}

export function QualityChartSources({chartId,point,filters,data,onClose}) {
  const [offset,setOffset]=useState(0),[acceptance,setAcceptance]=useState(null),[error,setError]=useState('');
  const query=useQuery(queryPath(`/quality/charts/${chartId}/sources`,{...filters,x:String(point.x),series:point.series,offset}),data);
  const open=async id=>{try{setError('');setAcceptance(await api(`/quality/acceptances/${id}`));}catch(error){setError(error.message);}};
  return <Modal title="图表数据来源" subtitle={`${point.x} · ${point.seriesLabel}`} wide onClose={onClose}><div className="form-body quality-chart-sources">
    {(error||query.error)&&<div role="alert" className="form-error">{error||query.error}</div>}
    {query.loading?<p role="status">正在读取来源…</p>:<><div className="quality-preview-table"><table><thead><tr><th>验收单</th><th>工作表 / 位置</th><th>统计原值</th><th>操作</th></tr></thead><tbody>{query.result?.sources.map((source,i)=><tr key={i}>
      <td>{source.name}<small>{source.number}</small></td><td>{source.sheetName}{source.row?` · 第 ${source.row} 行`:source.column?` · 第 ${source.column} 列`:''}</td><td>{source.value}</td><td><Button onClick={()=>open(source.acceptanceId)}>查看验收单</Button></td>
    </tr>)}</tbody></table></div><div className="quality-toolbar"><Button disabled={!offset} onClick={()=>setOffset(value=>value-50)}>上一页</Button><span>共 {query.result?.total||0} 条来源</span><Button disabled={offset+50>=(query.result?.total||0)} onClick={()=>setOffset(value=>value+50)}>下一页</Button></div></>}
    {acceptance&&<section className="quality-chart-source-acceptance"><div className="quality-toolbar"><h3>{acceptance.name}</h3><Button onClick={()=>downloadExcel(`/acceptances/${acceptance.id}/download`).catch(error=>setError(error.message))}>下载上传原文件</Button></div><WorkbookResults definition={acceptance.definition} preview={acceptance.result} compact/></section>}
  </div></Modal>;
}

export function QualityChartData({chart,data,productId=null}) {
  const [from,setFrom]=useState(''),[to,setTo]=useState(''),[point,setPoint]=useState(null),[single,setSingle]=useState(false),[acceptanceId,setAcceptanceId]=useState(''),[search,setSearch]=useState('');
  const acceptances=useQuery(single?queryPath('/quality/chart-acceptances',{template_id:chart.template_id,q:search}):null,data,200);
  const filters={product_id:productId,acceptance_id:single?acceptanceId:null,from,to};
  const query=useQuery(single&&!acceptanceId?null:queryPath(`/quality/charts/${chart.id}/data`,filters),data,150);
  return <div className="quality-chart-data">
    <div className="quality-chart-filters"><label>数据范围<Select aria-label="图表数据范围" value={single?'single':'all'} onChange={event=>{setSingle(event.target.value==='single');setAcceptanceId('');setPoint(null);}}><option value="all">全部验收单</option><option value="single">单张验收单</option></Select></label>{single&&<><label>搜索验收单<input aria-label="搜索图表验收单" value={search} onChange={event=>setSearch(event.target.value)}/></label><label>验收单<Select aria-label="图表验收单" value={acceptanceId} onChange={event=>{setAcceptanceId(event.target.value);setPoint(null);}}><option value="">请选择验收单</option>{acceptances.result?.acceptances.map(item=><option key={item.id} value={item.id}>{item.name} · {item.number}</option>)}</Select></label>{acceptances.error&&<span role="alert">{acceptances.error}</span>}{acceptances.result?.has_more&&<span className="muted">仅显示前 100 张，请搜索缩小范围。</span>}</>}</div>
    {chart.config.dateField&&<div className="quality-chart-filters"><label>开始日期<input aria-label={`${chart.name} 开始日期`} type="date" value={from} onChange={event=>{setFrom(event.target.value);setPoint(null);}}/></label><label>结束日期<input aria-label={`${chart.name} 结束日期`} type="date" value={to} onChange={event=>{setTo(event.target.value);setPoint(null);}}/></label><Button onClick={()=>{setFrom('');setTo('');setPoint(null);}}>全部时间</Button></div>}
    {single&&!acceptanceId?<p className="quality-chart-empty">请选择一张验收单。</p>:query.error?<div className="form-error" role="alert">{query.error}<Button onClick={query.retry}>重试</Button></div>:query.loading?<p role="status">正在读取图表…</p>:query.result&&<>
      <QualityChartView result={query.result} type={chart.config.chartType} title={chart.name} onSources={setPoint}/>
      <p className="muted">{query.result.stats.sheets} 个 Sheet · {query.result.stats.records} 条记录{query.result.stats.incompatibleSheets?` · ${query.result.stats.incompatibleSheets} 个 Sheet 字段类型或单位不兼容，未参与统计`:''}{query.result.stats.excluded?` · ${query.result.stats.excluded} 条记录因筛选或字段空值未参与统计`:''}</p>
    </>}
    {point&&createPortal(<QualityChartSources chartId={chart.id} point={point} filters={filters} data={data} onClose={()=>setPoint(null)}/>,document.body)}
  </div>;
}
