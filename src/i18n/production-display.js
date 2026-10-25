import { t } from './index.js';

// Accessors keep shared business identifiers unchanged and translate only UI labels.
// Reading a label after a locale change always returns the current language.
const labels = keys => Object.defineProperties({}, Object.fromEntries(Object.entries(keys).map(([value, key]) => [value, { enumerable: true, get: () => t(key) }])));
export const chartTypeLabels = labels({line:'production.chart.line',bar:'production.chart.bar',pie:'production.chart.pie',table:'production.chart.table'});
export const metricLabels = labels({sum:'production.metric.sum',avg:'production.metric.avg',min:'production.metric.min',max:'production.metric.max',count:'production.metric.count'});
export const qualityTypeLabels = labels({string:'production.type.string',uniqueKey:'production.type.uniqueKey',number:'production.type.number',date:'production.type.date',datetime:'production.type.datetime',boolean:'production.type.boolean',single:'production.type.single',multi:'production.type.multi',measurements:'production.type.measurements',object:'production.type.object'});
export const checkLabels = labels({range:'production.check.range',sum:'production.check.sum',acceptance:'production.check.acceptance',decision:'production.check.decision'});
export const productionStatusLabels = labels({draft:'production.status.draft',awaiting_materials:'production.status.awaitingMaterials',in_progress:'production.status.inProgress',completed:'production.status.completed',void:'production.status.void'});
export const bomLossMethodLabels = labels({internal:'production.loss.internal',external:'production.loss.external'});
export const bomLossMethodFormulas = labels({internal:'production.loss.internalFormula',external:'production.loss.externalFormula'});
export const bomUsageLabels = labels({stock:'production.issueThisMaterial',explode:'production.expandChildBom'});

export function chartSeriesLabel(row) {
  const key = {statistic:'production.series.statistic',empty:'production.series.empty',unboundMaterial:'production.series.unboundMaterial'}[row?.seriesLabelKey];
  return key ? t(key) : row?.seriesLabel || row?.series || '';
}
