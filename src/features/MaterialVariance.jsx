import { productionMessage } from '../i18n/production-errors.js';
import { t as pt, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { Input as AntInput } from '../ui/controls.jsx';

const count = value => Number(value).toLocaleString(getFormatLocale(), { maximumFractionDigits: 4 });
const rate = value => value !== 0 && Math.abs(value) < 0.000001
  ? `${value < 0 ? '-' : '+'}<0.000001%`
  : `${value > 0 ? '+' : ''}${Number(value).toLocaleString(getFormatLocale(), { maximumFractionDigits: 6 })}%`;

export function MaterialVariance({ row, analysis, complete, disabled, onReason }) {
  useLocale();
  const available = analysis.standard_quantity != null;
  const difference = analysis.variance_quantity;
  const direction = difference > 0 ? pt("production.overuse") : difference < 0 ? pt("production.saving") : pt("production.noVariance");
  return <div className="production-variance" role="group" aria-label={pt("production.usageVarianceAnalysis", { v0: row.name })}>
    <div className="production-variance-numbers">
      <div><small>{pt("production.standardUsageAcceptedOutput")}</small><span>{available ? `${count(analysis.standard_quantity)} ${row.unit}` : '—'}</span></div>
      <div className={available && difference > 0 ? 'production-overuse' : available && difference < 0 ? 'production-saving' : ''}>
        <small>{pt("production.usageVariance")}{available ? ` · ${direction}` : ''}</small><span>{available ? `${difference > 0 ? '+' : ''}${count(difference)} ${row.unit}` : '—'}</span>
      </div>
      <div><small>{pt("production.varianceRate")}</small><span>{available ? rate(analysis.variance_rate) : '—'}</span></div>
    </div>
    {productionMessage(analysis.analysis_error) && <p className="bom-warning">{productionMessage(analysis.analysis_error)}</p>}
    {complete ? <label>{pt("production.usageVarianceReasonOptional")}<AntInput.TextArea aria-label={pt("production.usageVarianceReason", { v0: row.name })} rows={2} maxLength={500}
      placeholder={pt("production.eGSetupReworkMaterialIssues")} disabled={disabled} value={row.variance_reason ?? ''}
      onChange={event => onReason(row.product_id, event.target.value)} /></label>
      : <div className="production-variance-reason"><small>{pt("production.usageVarianceReason2")}</small>{row.variance_reasons?.length
        ? row.variance_reasons.map(entry => <p key={entry.batch_number}>{pt("production.batch")} {entry.batch_number} {pt("production.batches")}{entry.reason}</p>)
        : <p>{row.variance_reason || pt("production.notEntered")}</p>}</div>}
  </div>;
}
