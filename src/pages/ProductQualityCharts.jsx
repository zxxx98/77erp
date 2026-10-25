import { chartTypeLabels } from '../i18n/production-display.js';
import { t as pt } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { Button as AntButton } from '../ui/controls.jsx';

import { useState } from 'react';
import { Button } from '../components/common.jsx';
import { useQuery } from '../queries.js';
import { QualityChartData } from './QualityChartView.jsx';


export function ProductQualityCharts({product,data}) {
  useLocale();
  const query=useQuery(`/quality/products/${product.id}/charts`,data),[expanded,setExpanded]=useState(null);
  return <section className="quality-product-charts" aria-label={pt("production.qualityChartsForThisMaterial")}>
    {query.error?<div className="form-error" role="alert">{query.error}<Button onClick={query.retry}>{pt("production.retry")}</Button></div>:query.loading?<p role="status">{pt("production.loadingQualityCharts")}</p>:!query.result?.charts.length?<p className="quality-chart-empty">{pt("production.noQualityCharts")}</p>:query.result.charts.map(chart=><section className="quality-product-chart" key={chart.id}>
      <AntButton type="text" htmlType="button" className="quality-product-chart-heading" aria-expanded={expanded===chart.id} onClick={()=>setExpanded(value=>value===chart.id?null:chart.id)}><span><strong>{chart.name}</strong><small>{chart.template_name} · {chartTypeLabels[chart.config.chartType]}</small></span><span>{expanded===chart.id?pt("production.collapse"):pt("production.viewChart")}</span></AntButton>
      {expanded===chart.id&&<QualityChartData chart={chart} productId={product.id} data={data}/>}
    </section>)}
  </section>;
}
