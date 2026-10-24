import { Button as AntButton } from '../ui/controls.jsx';

import { useState } from 'react';
import { Button } from '../components/common.jsx';
import { useQuery } from '../queries.js';
import { QualityChartData } from './QualityChartView.jsx';
import { chartTypeLabels } from '../../shared/quality-charts.js';

export function ProductQualityCharts({product,data}) {
  const query=useQuery(`/quality/products/${product.id}/charts`,data),[expanded,setExpanded]=useState(null);
  return <section className="quality-product-charts" aria-label="当前物料品质图表">
    {query.error?<div className="form-error" role="alert">{query.error}<Button onClick={query.retry}>重试</Button></div>:query.loading?<p role="status">正在读取品质图表…</p>:!query.result?.charts.length?<p className="quality-chart-empty">暂无品质图表。</p>:query.result.charts.map(chart=><section className="quality-product-chart" key={chart.id}>
      <AntButton type="text" htmlType="button" className="quality-product-chart-heading" aria-expanded={expanded===chart.id} onClick={()=>setExpanded(value=>value===chart.id?null:chart.id)}><span><strong>{chart.name}</strong><small>{chart.template_name} · {chartTypeLabels[chart.config.chartType]}</small></span><span>{expanded===chart.id?'收起':'查看图表'}</span></AntButton>
      {expanded===chart.id&&<QualityChartData chart={chart} productId={product.id} data={data}/>}
    </section>)}
  </section>;
}
