import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { postProcessingLimit } from '../../shared/post-processing.js';
import { parseQuantity } from '../../shared/quantity.js';
import { Button } from '../components/common.jsx';
import { Input } from '../ui/controls.jsx';
import { FormField } from '../ui/FormField.jsx';
import { t, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { IndependentOperationPicker } from './IndependentOperationPicker.jsx';

function estimatedRuns(plannedQuantity, coefficient) {
  try { return postProcessingLimit(parseQuantity(plannedQuantity, true), parseQuantity(coefficient, true), true); }
  catch { return null; }
}

export function PostProcessingPlan({ rows, onChange, data, unit, plannedQuantity, disabled }) {
  useLocale();
  const [picker, setPicker] = useState(false);
  return <section className="panel bom-section post-processing-plan">
    <h2>{t('production.postProcessing')}</h2>
    <p className="bom-hint">{t('production.postProcessingPlanHint')}</p>
    {rows.map((row, index) => {
      const estimate = estimatedRuns(plannedQuantity, row.product_coefficient);
      const label = `${t('production.productCoefficient')} ${row.name}`;
      return <section key={`${row.route_id}:${row.node_id}`} className="post-processing-binding">
        <div className="production-material">
          <div className="production-material-name"><strong>{row.name}</strong><small>{row.route_name}</small></div>
          <label>{t('production.productCoefficient')}（{unit}）<FormField required value={row.product_coefficient} label={label}>
            <Input aria-label={label} inputMode="decimal" value={row.product_coefficient} disabled={disabled}
              onChange={event => onChange(rows.map((item, i) => i === index ? { ...item, product_coefficient: event.target.value } : item))} />
          </FormField></label>
          <Button icon={Trash2} aria-label={`${t('production.removePostProcessing')} ${row.name}`} disabled={disabled}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}>{t('production.removePostProcessing')}</Button>
        </div>
        {estimate != null && <p className="bom-hint">{t('production.postProcessingEstimate', { count: estimate.toLocaleString(getFormatLocale()) })}</p>}
      </section>;
    })}
    <Button icon={Plus} disabled={disabled || rows.length >= 50} onClick={() => setPicker(true)}>{t('production.addPostProcessing')}</Button>
    {picker && <IndependentOperationPicker data={data} routeKind="post_processing" title={t('production.addPostProcessing')} emptyMessage={t('production.noPostProcessing')}
      rows={rows} onSelect={row => onChange([...rows, { ...row, product_coefficient: '' }])} onClose={() => setPicker(false)} />}
  </section>;
}
