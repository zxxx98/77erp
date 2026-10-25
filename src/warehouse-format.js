import { t, getFormatLocale } from './i18n/index.js';
import { describeStockExpression as describeExpression } from '../shared/stock-compare.js';

export const inspectionUnitLabel = unit => ['day', 'month', 'year'].includes(unit) ? t('warehouse.inspection.' + unit) : unit;
export const inspectionUnits = Object.defineProperties({}, Object.fromEntries(['day', 'month', 'year'].map(unit => [unit, { enumerable: true, get: () => inspectionUnitLabel(unit) }])));
export const inspectionCycleLabel = product => product.inspection_interval
  ? t('warehouse.inspection.every', { interval: Number(product.inspection_interval).toLocaleString(getFormatLocale()), unit: inspectionUnitLabel(product.inspection_unit) })
  : t('warehouse.inspection.manual');
export function describeStockExpression(expression, nameById) {
  if (!expression || !Number.isSafeInteger(expression.left)) return '';
  const names = { ...nameById };
  for (const id of [expression.left, ...(expression.terms || []).map(term => term.warehouse_id)]) {
    if (names[id] == null) names[id] = t('warehouse.expression.warehouse', { id });
  }
  return describeExpression(expression, names);
}
