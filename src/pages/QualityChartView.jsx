import { chartSeriesLabel } from '../i18n/production-display.js';
import { productionMessage } from '../i18n/production-errors.js';
import { t as pt, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { Button as AntButton, Input as AntInput } from '../ui/controls.jsx';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Modal } from '../components/common.jsx';
import { FullscreenChart } from '../components/FullscreenChart.jsx';
import { queryPath, useQuery } from '../queries.js';
import { api } from '../api.js';
import { Select } from '../Dropdown.jsx';
import { WorkbookResults, downloadExcel } from './quality-shared.jsx';
import { qualityPieSlices } from '../../shared/quality-charts.js';
import '../quality.css';

const colors=['#2864eb','#00a68a','#e69c31','#985be5','#df6483','#188caf'];
const axisTextWidth=text=>Array.from(text).reduce((width,char)=>width+(/[\x20-\x7e]/.test(char)?7:12),0);
function wrapAxisLabel(value,width) {
  const lines=[];
  for(const paragraph of String(value).split(/\r?\n/)) {
    let line='';
    for(const char of paragraph) {
      if(line&&axisTextWidth(line+char)>width){lines.push(line);line='';}
      line+=char;
    }
    lines.push(line);
  }
  return lines;
}
export const chartNumber=(value,unit='')=>value===null?'—':`${new Intl.NumberFormat(getFormatLocale(),{maximumFractionDigits:4}).format(value)}${unit}`;
export function QualityChartView({result,type,title,onSources}) {
  useLocale();
  if(!result.rows.length)return <div className="quality-chart-empty">{pt("production.noDataAvailableForThisScope")}</div>;
  return <FullscreenChart title={title}>{fullscreen=> <QualityChartContent result={result} type={type} title={title} onSources={onSources} fullscreen={fullscreen}/>}</FullscreenChart>;
}

function QualityChartContent({result,type,title,onSources,fullscreen}) {
  useLocale();
  const plotRef=useRef(null),[plotSize,setPlotSize]=useState({width:820,height:320});
  useEffect(()=>{
    if(!fullscreen||!plotRef.current)return;
    const observer=new ResizeObserver(([entry])=>setPlotSize({width:entry.contentRect.width,height:entry.contentRect.height}));
    observer.observe(plotRef.current);
    return ()=>observer.disconnect();
  },[fullscreen,type]);
  const rows=result.rows,labels=[...new Set(rows.map(row=>row.x))],series=[...new Set(rows.map(row=>row.series))];
  if(!rows.length)return <div className="quality-chart-empty">{pt("production.noDataAvailableForThisScope")}</div>;
  const availableWidth=fullscreen?Math.max(360,plotSize.width):820;
  const max=Math.max(0,...rows.map(row=>row.value)),min=Math.min(0,...rows.map(row=>row.value)),span=max-min||1;
  const yTicks=Array.from({length:5},(_,i)=>min+span*i/4);
  const visibleLabels=fullscreen?labels:labels.filter((_,i)=>i%Math.max(1,Math.ceil(labels.length/7))===0||i===labels.length-1);
  const ticks=visibleLabels.map(value=>({value,lines:wrapAxisLabel(value,fullscreen?132:84)}));
  const labelWidth=Math.max(0,...ticks.flatMap(tick=>tick.lines.map(axisTextWidth)));
  const left=Math.max(74,...yTicks.map(value=>axisTextWidth(chartNumber(value,result.unit))+16)),right=Math.max(24,labelWidth/2+8),top=24;
  const values=labels.map(value=>result.xType==='number'?Number(value):result.xType==='date'?Date.parse(String(value).length===7?`${value}-01`:value):null);
  const linear=result.xType==='number'||result.xType==='date',first=linear?Math.min(...values):0,last=linear?Math.max(...values):labels.length-1;
  const sortedValues=linear?[...new Set(values)].sort((a,b)=>a-b):[];
  const step=linear?Math.min(...sortedValues.slice(1).map((value,i)=>value-sortedValues[i])):1;
  const fullWidth=fullscreen&&last>first?left+right+48+(last-first)/step*Math.max(80,labelWidth+16):availableWidth;
  const width=Math.max(availableWidth,Math.min(28000,Math.max(fullWidth,type==='bar'?labels.length*series.length*24:0)));
  const barWidth=Math.min(38,(width-left-right)/Math.max(1,labels.length)/(series.length+1));
  const padding=type==='bar'?Math.max(24,series.length*barWidth/2):24;
  const x=value=>{const index=labels.indexOf(value),n=linear?values[index]:index;return left+padding+(last===first?0.5:(n-first)/(last-first))*(width-left-right-2*padding);};
  // Keep close numeric/date coordinates on their true scale; stagger labels if
  // the bounded scroll width still leaves too little space between neighbours.
  const lanes=[],lineHeight=14,rowHeight=Math.max(1,...ticks.map(tick=>tick.lines.length))*lineHeight+8;
  for(const tick of [...ticks].sort((a,b)=>x(a.value)-x(b.value))) {
    const halfWidth=Math.max(...tick.lines.map(axisTextWidth))/2,start=x(tick.value)-halfWidth;
    let lane=lanes.findIndex(end=>end+12<=start);
    if(lane<0)lane=lanes.length;
    lanes[lane]=x(tick.value)+halfWidth;tick.offset=lane*rowHeight;
  }
  const bottom=Math.max(66,lanes.length*rowHeight+32),height=Math.max(fullscreen?Math.max(280,plotSize.height):320,bottom+160);
  const y=value=>height-bottom-(value-min)/span*(height-bottom-top);
  const label=key=>chartSeriesLabel(rows.find(row=>row.series===key))||key;
  return <div className="quality-chart-view">
    {type==='pie'&&<QualityPieChart result={result} title={title} onSources={onSources}/>}
    {type!=='table'&&type!=='pie'&&<>
      <div className="quality-chart-legend">{series.map((key,i)=><span key={key}><i style={{background:colors[i%colors.length]}}/>{label(key)}</span>)}</div>
      <div className="quality-chart-scroll" ref={plotRef}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} style={{minWidth:fullscreen||type==='bar'?width:undefined,minHeight:fullscreen?height:undefined}}>
        <title>{title}</title>{yTicks.map((value,i)=><g key={i}><line x1={left} x2={width-right} y1={y(value)} y2={y(value)} stroke="var(--border)"/><text x={left-10} y={y(value)+4} textAnchor="end" className="quality-chart-axis">{chartNumber(value,result.unit)}</text></g>)}
        {ticks.map(tick=><g key={String(tick.value)}>
          {tick.offset>0&&<line x1={x(tick.value)} x2={x(tick.value)} y1={height-bottom+8} y2={height-bottom+tick.offset+12} stroke="var(--border)"/>}
          <text x={x(tick.value)} y={height-bottom+24+tick.offset} textAnchor="middle" className="quality-chart-axis quality-chart-x-label"><title>{String(tick.value)}</title>{tick.lines.map((line,i)=><tspan key={i} x={x(tick.value)} dy={i?lineHeight:0}>{line||'\u00a0'}</tspan>)}</text>
        </g>)}
        {series.map((key,i)=>{
          const points=labels.map(value=>rows.find(row=>row.x===value&&row.series===key)),color=colors[i%colors.length];
          let path='',previous=false;for(const point of points){if(point){path+=`${previous?' L':' M'}${x(point.x)},${y(point.value)}`;previous=true;}else previous=false;}
          return <g key={key}>
            {type==='line'&&<path d={path} fill="none" stroke={color} strokeWidth="2.5"/>}
            {points.filter(Boolean).map(point=>{
              const text=`${point.x} · ${label(key)}：${chartNumber(point.value,result.unit)}`;
              const props={key:String(point.x),fill:color,onClick:onSources?()=>onSources(point):undefined,role:onSources?'button':undefined,tabIndex:onSources?0:undefined,'aria-label':onSources?pt("production.viewSource", { v0: text }):undefined,onKeyDown:onSources?event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onSources(point);}}:undefined,style:{cursor:onSources?'pointer':undefined}};
              return type==='line'?<circle {...props} cx={x(point.x)} cy={y(point.value)} r="5"><title>{text}</title></circle>:<rect {...props} x={x(point.x)+(i-series.length/2)*barWidth} y={Math.min(y(0),y(point.value))} width={Math.max(1,barWidth-3)} height={Math.max(2,Math.abs(y(0)-y(point.value)))} rx="2"><title>{text}</title></rect>;
            })}
          </g>;
        })}
      </svg></div>
    </>}
    <details className="quality-chart-table" open={type==='table'}><summary>{pt("production.viewStatistics")}{rows.length} {pt("production.items")}</summary><div className="quality-preview-table"><table><thead><tr><th>{type==='pie'?pt("production.category"):pt("production.xAxis")}</th><th>{pt("production.group")}</th><th>{pt("production.value")}{result.unit?`（${result.unit}）`:''}</th><th>{pt("production.recordCount")}</th>{onSources&&<th>{pt("production.source")}</th>}</tr></thead><tbody>{rows.map(row=><tr key={JSON.stringify([row.x,row.series])}><td>{String(row.x)}</td><td>{chartSeriesLabel(row)}</td><td>{chartNumber(row.value,result.unit)}</td><td>{row.count}</td>{onSources&&<td><Button onClick={()=>onSources(row)}>{pt("production.viewSource2")}</Button></td>}</tr>)}</tbody></table></div></details>
  </div>;
}

function QualityPieChart({result,title,onSources}) {
  useLocale();
  const series=[...new Set(result.rows.map(row=>row.series))];
  const categories=[...new Set(result.rows.map(row=>row.x))];
  const color=value=>{const i=categories.indexOf(value);return colors[i]||`hsl(${(i*137.508)%360} 65% 45%)`;};
  const percent=value=>new Intl.NumberFormat(getFormatLocale(),{style:'percent',maximumFractionDigits:2}).format(value);
  const point=angle=>[160+120*Math.cos(angle),160+120*Math.sin(angle)];
  return <div className="quality-pie-charts">
    <p className="muted quality-pie-note">{pt("production.sharesAreCategoryTotalsDividedByTheTotal")}</p>
    {series.map(key=>{
      const rows=result.rows.filter(row=>row.series===key),{slices,message}=qualityPieSlices(rows);
      const name=series.length===1?title:`${title} · ${chartSeriesLabel(rows[0])||key}`;
      return <section className="quality-pie-card" key={key} aria-label={name}>
        {series.length>1&&<h3>{chartSeriesLabel(rows[0])||key}</h3>}
        {message?<p className="quality-chart-empty" role="status">{productionMessage(message)}</p>:<>
          <svg className="quality-pie-svg" viewBox="0 0 320 320" role="img" aria-label={name}>
            <title>{name}</title>
            {slices.filter(slice=>slice.share>0).map(slice=>{
              const text=pt("production.share", { v0: slice.x, v1: chartNumber(slice.value,result.unit), v2: percent(slice.share) });
              const props={fill:color(slice.x),stroke:'var(--surface, #fff)',strokeWidth:1.5,
                role:onSources?'button':undefined,tabIndex:onSources?0:undefined,'aria-label':onSources?pt("production.viewSource", { v0: text }):text,
                onClick:onSources?()=>onSources(slice):undefined,onKeyDown:onSources?event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onSources(slice);}}:undefined};
              const [x1,y1]=point(slice.startAngle),[x2,y2]=point(slice.endAngle);
              return <g key={String(slice.x)}>{slice.share===1?<circle {...props} cx="160" cy="160" r="120"><title>{text}</title></circle>:<path {...props} d={`M160,160 L${x1},${y1} A120,120 0 ${slice.share>0.5?1:0},1 ${x2},${y2} Z`}><title>{text}</title></path>}</g>;
            })}
          </svg>
          <ul className="quality-pie-legend" aria-label={pt("production.legend", { v0: name })}>{slices.map(slice=>{
            const content=<><i style={{background:color(slice.x)}} aria-hidden="true"/><span>{String(slice.x)}</span><strong>{chartNumber(slice.value,result.unit)}</strong><span>{percent(slice.share)}</span></>;
            return <li key={String(slice.x)}>{onSources?<AntButton type="text" htmlType="button" onClick={()=>onSources(slice)} aria-label={pt("production.viewSourceShare", { v0: slice.x, v1: chartSeriesLabel(slice), v2: chartNumber(slice.value,result.unit), v3: percent(slice.share) })}>{content}</AntButton>:<div>{content}</div>}</li>;
          })}</ul>
        </>}
      </section>;
    })}
  </div>;
}

export function QualityChartSources({chartId,point,filters,data,onClose}) {
  useLocale();
  const [offset,setOffset]=useState(0),[acceptance,setAcceptance]=useState(null),[error,setError]=useState('');
  const query=useQuery(queryPath(`/quality/charts/${chartId}/sources`,{...filters,x:String(point.x),series:point.series,offset}),data);
  const open=async id=>{try{setError('');setAcceptance(await api(`/quality/acceptances/${id}`));}catch(error){setError(error.message);}};
  return <Modal title={pt("production.chartDataSources")} subtitle={`${point.x} · ${chartSeriesLabel(point)}`} wide onClose={onClose}><div className="form-body quality-chart-sources">
    {(error||query.error)&&<div role="alert" className="form-error">{error||query.error}</div>}
    {query.loading?<p role="status">{pt("production.loadingSources")}</p>:<><div className="quality-preview-table"><table><thead><tr><th>{pt("production.acceptances")}</th><th>{pt("production.worksheetLocation")}</th><th>{pt("production.originalStatisticValue")}</th><th>{pt("production.actions")}</th></tr></thead><tbody>{query.result?.sources.map((source,i)=><tr key={i}>
      <td>{source.name}<small>{source.number}</small></td><td>{source.sheetName}{source.row?pt("production.row", { v0: source.row }):source.column?pt("production.column", { v0: source.column }):''}</td><td>{source.value}</td><td><Button onClick={()=>open(source.acceptanceId)}>{pt("production.viewAcceptance")}</Button></td>
    </tr>)}</tbody></table></div><div className="quality-toolbar"><Button disabled={!offset} onClick={()=>setOffset(value=>value-50)}>{pt("production.previous")}</Button><span>{pt("production.total")} {query.result?.total||0} {pt("production.sources")}</span><Button disabled={offset+50>=(query.result?.total||0)} onClick={()=>setOffset(value=>value+50)}>{pt("production.next")}</Button></div></>}
    {acceptance&&<section className="quality-chart-source-acceptance"><div className="quality-toolbar"><h3>{acceptance.name}</h3><Button onClick={()=>downloadExcel(`/acceptances/${acceptance.id}/download`).catch(error=>setError(error.message))}>{pt("production.downloadUploadedOriginal")}</Button></div><WorkbookResults definition={acceptance.definition} preview={acceptance.result} compact/></section>}
  </div></Modal>;
}

export function QualityChartData({chart,data,productId=null}) {
  useLocale();
  const [from,setFrom]=useState(''),[to,setTo]=useState(''),[point,setPoint]=useState(null),[single,setSingle]=useState(false),[acceptanceId,setAcceptanceId]=useState(''),[search,setSearch]=useState('');
  const acceptances=useQuery(single?queryPath('/quality/chart-acceptances',{template_id:chart.template_id,q:search}):null,data,200);
  const filters={product_id:productId,acceptance_id:single?acceptanceId:null,from,to};
  const query=useQuery(single&&!acceptanceId?null:queryPath(`/quality/charts/${chart.id}/data`,filters),data,150);
  return <div className="quality-chart-data">
    <div className="quality-chart-filters"><label>{pt("production.dataScope")}<Select aria-label={pt("production.chartDataScope")} value={single?'single':'all'} onChange={event=>{setSingle(event==='single');setAcceptanceId('');setPoint(null);}}><option value="all">{pt("production.allAcceptances")}</option><option value="single">{pt("production.singleAcceptance")}</option></Select></label>{single&&<><label>{pt("production.searchAcceptances")}<AntInput aria-label={pt("production.searchChartAcceptances")} value={search} onChange={event=>setSearch(event.target.value)}/></label><label>{pt("production.acceptances")}<Select aria-label={pt("production.chartAcceptance")} value={acceptanceId} onChange={event=>{setAcceptanceId(event);setPoint(null);}}><option value="">{pt("production.selectAnAcceptance")}</option>{acceptances.result?.acceptances.map(item=><option key={item.id} value={item.id}>{item.name} · {item.number}</option>)}</Select></label>{acceptances.error&&<span role="alert">{acceptances.error}</span>}{acceptances.result?.has_more&&<span className="muted">{pt("production.onlyTheFirst100AreShownSearchTo")}</span>}</>}</div>
    {chart.config.dateField&&<div className="quality-chart-filters"><label>{pt("production.startDate")}<AntInput aria-label={pt("production.startDate2", { v0: chart.name })} type="date" value={from} onChange={event=>{setFrom(event.target.value);setPoint(null);}}/></label><label>{pt("production.endDate")}<AntInput aria-label={pt("production.endDate2", { v0: chart.name })} type="date" value={to} onChange={event=>{setTo(event.target.value);setPoint(null);}}/></label><Button onClick={()=>{setFrom('');setTo('');setPoint(null);}}>{pt("production.allTime")}</Button></div>}
    {single&&!acceptanceId?<p className="quality-chart-empty">{pt("production.selectAnAcceptance2")}</p>:query.error?<div className="form-error" role="alert">{query.error}<Button onClick={query.retry}>{pt("production.retry")}</Button></div>:query.loading?<p role="status">{pt("production.loadingChart")}</p>:query.result&&<>
      <QualityChartView result={query.result} type={chart.config.chartType} title={chart.name} onSources={setPoint}/>
      <p className="muted">{query.result.stats.sheets} {pt("production.sheets")} {query.result.stats.records} {pt("production.records")}{query.result.stats.incompatibleSheets?pt("production.sheetsExcludedDueToIncompatibleFieldTypesOr2", { v0: query.result.stats.incompatibleSheets }):''}{query.result.stats.excluded?pt("production.recordsExcludedByFiltersOrEmptyFields", { v0: query.result.stats.excluded }):''}</p>
    </>}
    {point&&createPortal(<QualityChartSources chartId={chart.id} point={point} filters={filters} data={data} onClose={()=>setPoint(null)}/>,document.body)}
  </div>;
}
