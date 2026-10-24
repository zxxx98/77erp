import { Input as AntInput } from '../ui/controls.jsx';

const count = value => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 6 });
const rate = value => value !== 0 && Math.abs(value) < 0.000001
  ? `${value < 0 ? '-' : '+'}<0.000001%`
  : `${value > 0 ? '+' : ''}${count(value)}%`;

export function MaterialVariance({ row, analysis, complete, disabled, onReason }) {
  const available = analysis.standard_quantity != null;
  const difference = analysis.variance_quantity;
  const direction = difference > 0 ? '超耗' : difference < 0 ? '节省' : '无差异';
  return <div className="production-variance" role="group" aria-label={`${row.name}耗料差异分析`}>
    <div className="production-variance-numbers">
      <div><small>标准耗料（按合格产量）</small><span>{available ? `${count(analysis.standard_quantity)} ${row.unit}` : '—'}</span></div>
      <div className={available && difference > 0 ? 'production-overuse' : available && difference < 0 ? 'production-saving' : ''}>
        <small>耗料差异{available ? ` · ${direction}` : ''}</small><span>{available ? `${difference > 0 ? '+' : ''}${count(difference)} ${row.unit}` : '—'}</span>
      </div>
      <div><small>差异率</small><span>{available ? rate(analysis.variance_rate) : '—'}</span></div>
    </div>
    {analysis.analysis_error && <p className="bom-warning">{analysis.analysis_error}</p>}
    {complete ? <label>耗料差异原因（可选）<AntInput.TextArea aria-label={`${row.name}耗料差异原因`} rows={2} maxLength={500}
      placeholder="例如：调机耗料、返工、材料问题" disabled={disabled} value={row.variance_reason ?? ''}
      onChange={event => onReason(row.product_id, event.target.value)} /></label>
      : <div className="production-variance-reason"><small>耗料差异原因</small>{row.variance_reasons?.length
        ? row.variance_reasons.map(entry => <p key={entry.batch_number}>第 {entry.batch_number} 批：{entry.reason}</p>)
        : <p>{row.variance_reason || '未填写'}</p>}</div>}
  </div>;
}
